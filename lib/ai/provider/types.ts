// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// Provider-agnostic types for the in-browser LLM layer (task 6.3). A concrete
// provider (see anthropic.ts) implements {@link LLMProvider} by translating
// these shapes to and from its wire format. Everything here is transport- and
// vendor-neutral so a second provider is additive, not a rewrite.

/**
 * Stable id of a shipped provider. The union grows by one entry per provider
 * added; the provider registry is keyed by it.
 */
export type ProviderId = 'anthropic';

/** Token counts a provider reports for a completion, when it returns them. */
export interface TokenUsage {
  /** Prompt tokens billed for the request. */
  inputTokens: number;
  /** Completion tokens billed for the response. */
  outputTokens: number;
}

/**
 * An MCP-shaped tool definition offered to the model. Unused by the manual test
 * chat in v1; the autonomous loop (task 6.4) fills {@link LLMRequest.tools}.
 */
export interface ToolSchema {
  /** Unique tool name the model calls. */
  name: string;
  /** Natural-language description the model uses to decide when to call it. */
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** One conversation turn sent to the model. */
export interface LLMMessage {
  role: 'user' | 'assistant';
  /**
   * Plain text for a simple turn, or structured {@link LLMContentBlock}s when
   * relaying the assistant's tool calls and the tool results fed back to it
   * during the agentic loop (task 6.4).
   */
  content: string | LLMContentBlock[];
}

/**
 * A content block within a structured {@link LLMMessage}. Used by the
 * automation tool loop to echo the model's `toolUse` calls back as an assistant
 * turn and return each `toolResult` as the following user turn, so a
 * read-then-act rule can continue across turns. Vendor-neutral; the provider
 * maps these to its wire format.
 */
export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: unknown }
  | { type: 'toolResult'; toolUseId: string; content: string };

/** A single, provider-agnostic completion request. */
export interface LLMRequest {
  /** Provider-specific model id (see {@link LLMProvider.models}). */
  model: string;
  /** Optional system prompt applied ahead of {@link messages}. */
  system?: string;
  messages: LLMMessage[];
  /** Tool definitions exposed to the model; omitted for a plain chat turn. */
  tools?: ToolSchema[];
  /** Hard cap on generated tokens, required by providers like Anthropic. */
  maxTokens: number;
}

/**
 * A single event from a streamed completion. The stream is self-describing via
 * the `type` discriminant and, by contract, never throws mid-stream:
 * failures arrive as a terminal `error` event so the consumer decides how to
 * react. `tool_call` args arrive only after all streamed fragments are
 * reassembled and parsed.
 */
export type LLMStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'done'; stopReason: string; usage: TokenUsage }
  | { type: 'error'; error: LLMError };

/**
 * Stable failure classes the UI maps to localized copy — the LLM-layer analog
 * of {@link MeshErrorCode}. Keeps provider HTTP/stream details out of the view.
 *
 * - `auth` — missing/invalid/blocked key (HTTP 401/403).
 * - `rateLimit` — throttled (HTTP 429); {@link LLMError.retryAfterSeconds} set
 *   when the provider reports it.
 * - `billing` — a billing/payment problem (HTTP 402); the key is valid but the
 *   account can't be charged.
 * - `badRequest` — malformed request (HTTP 400); usually a caller bug.
 * - `tooLarge` — request exceeds the provider limit (HTTP 413); trim history.
 * - `network` — CORS rejection or offline (a bare `fetch` `TypeError`).
 * - `server` — provider-side error (HTTP 5xx / timeout / overloaded).
 * - `aborted` — the caller aborted via the request `AbortSignal`.
 * - `unknown` — anything unclassified.
 */
export type LLMErrorKind =
  | 'auth'
  | 'rateLimit'
  | 'billing'
  | 'badRequest'
  | 'tooLarge'
  | 'network'
  | 'server'
  | 'aborted'
  | 'unknown';

/**
 * A provider-agnostic LLM failure carrying a stable {@link kind} the UI maps to
 * a localized message. Mirrors the {@link MeshConnectError} pattern so
 * user-facing copy stays out of the provider layer. Never carries the API key
 * or a raw provider body (which can echo request content).
 */
export class LLMError extends Error {
  /**
   * @param kind - the stable failure class.
   * @param retryAfterSeconds - seconds to wait before retrying, from a 429
   * `retry-after` header, when the provider supplied it.
   */
  constructor(
    readonly kind: LLMErrorKind,
    readonly retryAfterSeconds?: number,
  ) {
    super(kind);
    this.name = 'LLMError';
  }
}

/** A model a provider offers, for the settings picker. */
export interface LLMModel {
  /** Provider-specific model id sent as {@link LLMRequest.model}. */
  id: string;
  /** Human-readable brand label shown in the picker (a proper noun). */
  label: string;
}

/**
 * A provider-agnostic client that talks directly to one LLM vendor from the
 * browser with the user's BYO key — no proxy, no SDK. Implementations own their
 * wire format, streaming, and error mapping, and constrain every request to a
 * hardcoded official origin (the no-proxy guarantee).
 */
export interface LLMProvider {
  /** Stable provider id; the registry key. */
  readonly id: ProviderId;
  /** Human-readable provider name (a proper noun, not localized). */
  readonly label: string;
  /**
   * The provider's developer console page where a user generates an API key.
   * Shown as a link beneath the key entry in settings.
   */
  readonly apiKeyUrl: string;
  /** Models this provider offers, first is the sensible default. */
  readonly models: readonly LLMModel[];
  /**
   * Streams a completion for {@link req}. Yields typed {@link LLMStreamEvent}s
   * and, by contract, never throws mid-stream — errors (including an aborted
   * {@link signal}) are yielded as a terminal `{ type: 'error' }` event. The
   * user's key is read from the secret module at call time and only ever leaves
   * the tab in the request to this provider's official origin.
   */
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<LLMStreamEvent>;
}
