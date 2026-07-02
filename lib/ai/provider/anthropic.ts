// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { getApiKey, forgetApiKey } from '@/lib/ai/secret';
import {
  LLMError,
  type LLMErrorKind,
  type LLMModel,
  type LLMProvider,
  type LLMRequest,
  type LLMStreamEvent,
  type TokenUsage,
} from './types';

// Anthropic Messages API provider — a hand-rolled `fetch`/SSE client, no SDK
// (the official SDK pulls in Node-oriented code and would bloat the static
// export; AGENTS.md also forbids `node:` imports). See docs/design/
// ai-automation.md §1 and https://docs.claude.com/en/api/messages.

/**
 * The ONLY origin this provider ever contacts. There is deliberately no
 * configurable base URL in v1 — a configurable endpoint is exactly how a proxy
 * would sneak in and defeat the browser → provider-only guarantee.
 */
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com';

/** Wire version pinned per the Messages API contract. */
const ANTHROPIC_VERSION = '2023-06-01';

/** Ceiling on how long a single 429 back-off may pause a manual test call. */
const RETRY_AFTER_CAP_MS = 15_000;

/**
 * Consecutive 401/403 responses. On the second, the in-memory (and any
 * persisted) key is dropped so a known-bad key can't keep re-sending — the
 * anti-spam rule from the design's error handling. Reset on any non-auth
 * outcome.
 */
let consecutiveAuthFailures = 0;

/** Curated Anthropic model aliases; first is the default. */
const MODELS: readonly LLMModel[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

/**
 * Builds the Messages API request URL and enforces the no-proxy guarantee: the
 * result must start with the hardcoded official origin. A mismatch (a tampered
 * constant, say) throws rather than silently leaking the key to another host.
 */
function messagesUrl(): string {
  const url = `${ANTHROPIC_ORIGIN}/v1/messages`;
  if (!url.startsWith(`${ANTHROPIC_ORIGIN}/`)) {
    throw new LLMError('unknown');
  }
  return url;
}

/** Shapes an {@link LLMRequest} into the Anthropic Messages request body. */
function requestBody(req: LLMRequest): string {
  return JSON.stringify({
    model: req.model,
    max_tokens: req.maxTokens,
    stream: true,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.tools && req.tools.length > 0
      ? {
          tools: req.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
        }
      : {}),
  });
}

/** Maps a non-2xx HTTP status to a typed {@link LLMError}. */
function errorForStatus(status: number, retryAfter?: number): LLMError {
  if (status === 401 || status === 403) return new LLMError('auth');
  if (status === 429) return new LLMError('rateLimit', retryAfter);
  if (status === 402) return new LLMError('billing');
  if (status === 400) return new LLMError('badRequest');
  if (status === 413) return new LLMError('tooLarge');
  if (status >= 500) return new LLMError('server');
  return new LLMError('unknown');
}

/** Parses a `retry-after` header (seconds) into a number, if present. */
function retryAfterSeconds(res: Response): number | undefined {
  const raw = Number(res.headers.get('retry-after'));
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/** Resolves after `ms`, or rejects early if `signal` aborts during the wait. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // `onAbort` and `timer` reference each other; both uses live inside
    // deferred callbacks, so neither runs before the other is initialized.
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Sends the request, honoring a single 429 back-off (capped so a manual test
 * can't hang indefinitely on a large `retry-after`). Drains a retried 429 body
 * so the connection can be reused.
 */
async function send(
  apiKey: string,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  let retried = false;
  for (;;) {
    const res = await fetch(messagesUrl(), {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    });
    if (res.status === 429 && !retried) {
      retried = true;
      const secs = retryAfterSeconds(res);
      await res.text().catch(() => undefined);
      await delay(Math.min((secs ?? 1) * 1000, RETRY_AFTER_CAP_MS), signal);
      continue;
    }
    return res;
  }
}

/** A decoded Server-Sent-Events frame: its `event:` name and `data:` body. */
interface SseFrame {
  event: string;
  data: string;
}

/**
 * Parses a `text/event-stream` body into frames. Splits on the blank-line
 * boundary (`\n\n`), tolerating CRLF, and concatenates multi-line `data:`
 * fields per the SSE spec.
 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let data = '';
        let hasData = false;
        for (const line of frame.split('\n')) {
          // Per the SSE spec, a field value drops one optional leading space,
          // and multiple `data:` fields join with a newline — never `trim`,
          // which would alter payload bytes.
          if (line.startsWith('event:')) {
            event = line.slice(6).replace(/^ /, '');
          } else if (line.startsWith('data:')) {
            const chunk = line.slice(5).replace(/^ /, '');
            data = hasData ? `${data}\n${chunk}` : chunk;
            hasData = true;
          }
        }
        if (hasData) yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Maps an in-stream Anthropic `error` event to a typed {@link LLMError}. */
function streamErrorKind(type: unknown): LLMErrorKind {
  if (type === 'authentication_error' || type === 'permission_error') {
    return 'auth';
  }
  if (type === 'rate_limit_error') return 'rateLimit';
  if (type === 'billing_error') return 'billing';
  if (type === 'invalid_request_error') return 'badRequest';
  if (type === 'request_too_large') return 'tooLarge';
  if (
    type === 'overloaded_error' ||
    type === 'api_error' ||
    type === 'timeout_error'
  ) {
    return 'server';
  }
  return 'unknown';
}

/** In-flight tool-use block accumulating its streamed JSON-arg fragments. */
interface ToolAccumulator {
  id: string;
  name: string;
  json: string;
}

/**
 * Consumes the SSE body, yielding typed events. Never throws: an aborted signal
 * or a broken stream is yielded as a terminal `error` event.
 */
async function* readStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<LLMStreamEvent> {
  const tools = new Map<number, ToolAccumulator>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'end_turn';
  try {
    for await (const { data } of readSse(body)) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'message_start': {
          const input = (ev.message as { usage?: { input_tokens?: number } })
            ?.usage?.input_tokens;
          if (typeof input === 'number') usage.inputTokens = input;
          break;
        }
        case 'content_block_start': {
          const block = ev.content_block as {
            type?: string;
            id?: string;
            name?: string;
          };
          if (block?.type === 'tool_use') {
            tools.set(ev.index as number, {
              id: block.id ?? '',
              name: block.name ?? '',
              json: '',
            });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = ev.delta as {
            type?: string;
            text?: string;
            partial_json?: string;
          };
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text', delta: delta.text };
          } else if (delta?.type === 'input_json_delta') {
            const acc = tools.get(ev.index as number);
            if (acc) acc.json += delta.partial_json ?? '';
          }
          break;
        }
        case 'content_block_stop': {
          const acc = tools.get(ev.index as number);
          if (acc) {
            tools.delete(ev.index as number);
            let args: unknown = {};
            try {
              args = acc.json ? JSON.parse(acc.json) : {};
            } catch {
              args = {};
            }
            yield { type: 'tool_call', id: acc.id, name: acc.name, args };
          }
          break;
        }
        case 'message_delta': {
          const delta = ev.delta as { stop_reason?: string };
          if (delta?.stop_reason) stopReason = delta.stop_reason;
          const output = (ev.usage as { output_tokens?: number })
            ?.output_tokens;
          if (typeof output === 'number') usage.outputTokens = output;
          break;
        }
        case 'message_stop':
          yield { type: 'done', stopReason, usage };
          return;
        case 'error': {
          const err = ev.error as { type?: string };
          yield {
            type: 'error',
            error: new LLMError(streamErrorKind(err?.type)),
          };
          return;
        }
      }
    }
  } catch {
    yield {
      type: 'error',
      error: new LLMError(signal.aborted ? 'aborted' : 'network'),
    };
    return;
  }
  // Stream closed without an explicit message_stop — report what we gathered.
  yield { type: 'done', stopReason, usage };
}

/**
 * Streams a completion from Anthropic. Reads the BYO key from the secret module
 * at call time (the sole egress point for the secret) and yields typed events;
 * per the {@link LLMProvider} contract it never throws mid-stream.
 */
async function* stream(
  req: LLMRequest,
  signal: AbortSignal,
): AsyncIterable<LLMStreamEvent> {
  const apiKey = getApiKey();
  if (!apiKey) {
    yield { type: 'error', error: new LLMError('auth') };
    return;
  }

  let res: Response;
  try {
    res = await send(apiKey, requestBody(req), signal);
  } catch {
    yield {
      type: 'error',
      error: new LLMError(signal.aborted ? 'aborted' : 'network'),
    };
    return;
  }

  if (!res.ok || !res.body) {
    // Drain but never surface the body — it can echo request content.
    await res.text().catch(() => undefined);
    if (res.status === 401 || res.status === 403) {
      if (++consecutiveAuthFailures >= 2) {
        consecutiveAuthFailures = 0;
        void forgetApiKey();
      }
    } else {
      consecutiveAuthFailures = 0;
    }
    yield {
      type: 'error',
      error: errorForStatus(res.status, retryAfterSeconds(res)),
    };
    return;
  }

  consecutiveAuthFailures = 0;
  yield* readStream(res.body, signal);
}

/** The Anthropic provider singleton, registered in the provider registry. */
export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  models: MODELS,
  stream,
};
