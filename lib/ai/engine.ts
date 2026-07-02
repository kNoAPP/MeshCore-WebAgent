// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// The automation engine (task 6.4): on a matching MeshEvent it evaluates a
// rule, optionally runs the LLM with a constrained tool set, and applies the
// result — gated by the rule's autonomy and the guardrails in §4 (allowlist,
// airtime rate limiting, human-in-the-loop staging, kill switch, audit log).
// It never runs the LLM inline on the emit path: prompt work is serialized
// through a single queue so a burst of events can't race the provider or the
// radio, and transmit actions reuse the same `canTransmit` gate manual sends
// take (via the ActionContext). See `docs/design/ai-automation.md` §4–§5.

import { useMeshStore } from '@/store/meshStore';
import i18n from '@/lib/i18n';
import { getApiKey } from '@/lib/ai/secret';
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  type LLMContentBlock,
  type LLMMessage,
} from '@/lib/ai/provider';
import {
  callTool,
  describeAction,
  isGatedTool,
  isToolName,
  toolClass,
  toolSchemas,
  type ActionContext,
  type ToolName,
} from '@/lib/ai/tools';
import type { MeshEvent } from '@/lib/ai/eventBus';
import type {
  AuditEntry,
  AuditOutcome,
  AutomationRule,
  RuleTrigger,
} from '@/types/automation';

/** Default generated-token cap per response, when a rule doesn't set one. */
export const DEFAULT_MAX_TOKENS = 1024;
/** Lower bound a rule's per-response token cap is clamped to. */
export const MIN_MAX_TOKENS = 256;
/** Upper bound a rule's per-response token cap is clamped to. */
export const MAX_MAX_TOKENS = 8192;

// The agentic loop's LLM round-trips per event, capping cost. The model ends
// the loop naturally by finishing a turn with no tool call; the cap is only the
// backstop if it never does. A single turn may batch many tool calls, so a
// fan-out (e.g. a broadcast list) fits in a few turns.
/** Default turn cap, when a rule doesn't set one. */
export const DEFAULT_MAX_TURNS = 8;
/** Lower bound a rule's turn cap is clamped to. */
export const MIN_MAX_TURNS = 1;
/** Upper bound a rule's turn cap is clamped to. */
export const MAX_MAX_TURNS = 20;

// Backstop on how many transmit/write (gated) actions one event may produce, so
// a runaway prompt can't flood the approval inbox or the radio. Reads are
// unlimited; this is sized above a typical fan-out but well short of abuse.
const MAX_GATED_ACTIONS_PER_RUN = 25;

/** Clamps an optional user-supplied integer to a range, else the fallback. */
function clampInt(
  value: number | undefined,
  fallback: number,
  lo: number,
  hi: number,
): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Airtime token bucket for transmit actions: a small burst capacity that
// refills slowly, because LoRa airtime is shared and scarce. Conservative
// defaults, surfaced in the UI.
/** Max transmit actions that can burst before the bucket empties. */
export const AIRTIME_BURST = 3;
/** Milliseconds to regain one transmit token (sustained ~4/min). */
export const AIRTIME_REFILL_MS = 15_000;

/**
 * A leaky token bucket bounding transmit airtime. Bursts up to {@link capacity}
 * then throttles to one token per {@link refillMs}. Purely time-based — no
 * timers to leak.
 */
class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const gained = Math.floor((now - this.last) / this.refillMs);
    if (gained > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.last += gained * this.refillMs;
    }
  }

  /** Removes one token if available; returns whether it succeeded. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Refills to full — called when automation is (re)armed. */
  reset(): void {
    this.tokens = this.capacity;
    this.last = Date.now();
  }
}

function audit(entry: Omit<AuditEntry, 'id' | 'at'>): void {
  useMeshStore.getState().addAuditEntry({
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  });
}

/** A short label for the triggering event, for the audit log. */
function eventLabel(event: MeshEvent): string {
  switch (event.type) {
    case 'message': {
      const who =
        event.msg.senderName ??
        event.msg.pubkeyPrefix ??
        i18n.t('automation.event.channelMessage');
      return i18n.t('automation.event.message', { who });
    }
    case 'advert':
      return i18n.t('automation.event.advert', {
        name: event.advert.name || event.advert.pubkeyPrefix,
      });
    case 'ack':
      return i18n.t('automation.event.ack');
    case 'connection':
      return i18n.t('automation.event.connection', { status: event.status });
  }
}

/** The user-turn content handed to the LLM describing the trigger. */
function eventPromptContent(event: MeshEvent): string {
  if (event.type === 'message') {
    const who = event.msg.senderName ?? event.msg.pubkeyPrefix ?? 'unknown';
    if (event.msg.kind === 'channel') {
      const idx = event.msg.channelIdx ?? '?';
      return `A new channel message arrived on channel ${idx} from ${who}: "${event.msg.text}". To reply, use send_channel_message with channelIdx=${idx}.`;
    }
    // Surface the sender's contact id so the model can reply in a single turn
    // (via send_direct_message with to=<id>) without a read_contacts lookup.
    const id = event.msg.pubkeyPrefix ?? '';
    const idHint = id ? ` (sender contact id: ${id})` : '';
    return `A new direct message arrived from ${who}${idHint}: "${event.msg.text}". To reply, use send_direct_message with to="${id}".`;
  }
  return eventLabel(event);
}

function messageText(event: MeshEvent): string | null {
  return event.type === 'message' ? event.msg.text : null;
}

function triggerMatches(trigger: RuleTrigger, event: MeshEvent): boolean {
  switch (trigger.on) {
    case 'message': {
      if (event.type !== 'message') return false;
      const { kind } = event.msg;
      if (trigger.scope === 'direct' && kind !== 'direct') return false;
      if (trigger.scope === 'channel' && kind !== 'channel') return false;
      return true;
    }
    case 'advert':
      return event.type === 'advert';
    case 'ack':
      return event.type === 'ack';
    case 'connection':
      if (event.type !== 'connection') return false;
      return !trigger.status || trigger.status === event.status;
  }
}

function conditionMatches(rule: AutomationRule, event: MeshEvent): boolean {
  const contains = rule.condition?.contains?.trim();
  if (!contains) return true;
  const text = messageText(event);
  if (text === null) return false;
  return text.toLowerCase().includes(contains.toLowerCase());
}

/**
 * The disposition of a user-approved staged action, so the inbox can keep a
 * rate-limited proposal for retry instead of silently dropping it.
 */
export type ApprovalOutcome = 'executed' | 'rateLimited' | 'failed';

/**
 * The singleton automation engine. Holds the latest {@link ActionContext} (from
 * `useAutomation`), the transmit airtime limiter, and the serial prompt queue.
 * A single instance survives re-renders; the hook only feeds it events and
 * updates its context.
 */
class AutomationEngine {
  private ctx: ActionContext | null = null;
  private readonly bucket = new TokenBucket(AIRTIME_BURST, AIRTIME_REFILL_MS);
  // Serializes LLM runs so two rules can't race the provider or the radio.
  private queue: Promise<void> = Promise.resolve();
  // Aborts every in-flight prompt stream on the kill switch.
  private abort: AbortController | null = null;
  // Set by the kill switch and checked before each turn and each tool. The
  // abort signal only covers the streaming phase; during tool execution (a
  // radio round-trip) `abort` is null, so this flag is what actually halts a
  // run that is already past its stream.
  private stopped = false;

  /** Points the engine at the current id-based action surface. */
  setContext(ctx: ActionContext): void {
    this.ctx = ctx;
  }

  /** Re-arms the engine; called when the master switch turns on. */
  arm(): void {
    this.stopped = false;
    this.bucket.reset();
  }

  /**
   * Kill switch: halts everything immediately. Sets the `stopped` flag the run
   * loop checks between every turn and tool (so a run already in its
   * tool-execution phase, past the abortable stream, still stops), aborts any
   * in-flight provider stream, and drops the queued prompt work. The store's
   * `killSwitch` clears the staged queue and disables the master switch; the
   * hook then unsubscribes from the bus.
   */
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.abort = null;
    this.queue = Promise.resolve();
  }

  /** Entry point from the event bus: evaluates every enabled rule in order. */
  handleEvent(event: MeshEvent): void {
    const rules = useMeshStore.getState().automationRules;
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!triggerMatches(rule.trigger, event)) continue;
      if (!conditionMatches(rule, event)) continue;
      this.runRule(rule, event);
    }
  }

  private runRule(rule: AutomationRule, event: MeshEvent): void {
    if (rule.action.kind === 'fixed') {
      this.dispatchTool(rule, event, rule.action.tool, rule.action.args);
      return;
    }
    // Prompt actions are serialized through the queue so the provider and radio
    // are never raced. Each run gets its own AbortController the kill switch
    // can trip. The trailing catch isolates a run's rejection: an unexpected
    // throw (outside the provider's error-event contract) must not leave the
    // queue permanently rejected, which would silently skip every later prompt
    // rule until stop() resets it.
    this.queue = this.queue
      .then(() => this.runPrompt(rule, event))
      .catch(() => {});
  }

  private async runPrompt(
    rule: AutomationRule,
    event: MeshEvent,
  ): Promise<void> {
    if (rule.action.kind !== 'prompt') return;
    const label = eventLabel(event);
    if (getApiKey() === null) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: label,
        outcome: 'blocked',
        detail: i18n.t('automation.audit.noKey'),
      });
      return;
    }
    const providerId = rule.action.providerId ?? DEFAULT_PROVIDER_ID;
    const provider = getProvider(providerId);
    const model = rule.action.model ?? provider.models[0].id;
    // Only expose tools that are both requested by the rule and on its
    // allowlist — the model can never reach a tool the rule didn't grant.
    const allowed = rule.action.allowTools.filter((t) =>
      rule.allowlist.includes(t),
    );
    const schemas = toolSchemas(allowed);
    // Per-rule loop and length caps, clamped to safe bounds (a bad stored value
    // can't make the loop run away or the request exceed the provider).
    const maxTurns = clampInt(
      rule.action.maxTurns,
      DEFAULT_MAX_TURNS,
      MIN_MAX_TURNS,
      MAX_MAX_TURNS,
    );
    const maxTokens = clampInt(
      rule.action.maxTokens,
      DEFAULT_MAX_TOKENS,
      MIN_MAX_TOKENS,
      MAX_MAX_TOKENS,
    );
    // The running conversation. Read-tool results are appended so a
    // read-then-act rule (e.g. look up a contact, then draft a reply) can
    // continue across turns instead of stalling after the first read.
    const messages: LLMMessage[] = [
      { role: 'user', content: eventPromptContent(event) },
    ];
    // Counts transmit/write actions across the whole run against the backstop.
    let gatedActions = 0;

    for (let step = 0; step < maxTurns; step++) {
      // Halt between turns if the kill switch fired during the previous turn's
      // tool execution, when there was no stream left to abort.
      if (this.stopped) return;
      const controller = new AbortController();
      this.abort = controller;
      const calls: { id: string; name: string; args: unknown }[] = [];
      let failed = false;
      try {
        const streamed = provider.stream(
          {
            model,
            system: rule.action.system,
            messages,
            tools: schemas,
            maxTokens,
          },
          controller.signal,
        );
        for await (const ev of streamed) {
          if (ev.type === 'tool_call') {
            calls.push({ id: ev.id, name: ev.name, args: ev.args });
          } else if (ev.type === 'error') {
            if (ev.error.kind !== 'aborted') {
              audit({
                ruleId: rule.id,
                ruleName: rule.name,
                event: label,
                outcome: 'failed',
                detail: i18n.t('automation.audit.llmError', {
                  kind: ev.error.kind,
                }),
              });
            }
            failed = true;
            break;
          } else if (ev.type === 'done') {
            break;
          }
        }
      } finally {
        if (this.abort === controller) this.abort = null;
      }
      if (failed || controller.signal.aborted || this.stopped) return;

      // No tool call this turn — the model has signaled it is finished.
      if (calls.length === 0) return;

      // Echo the model's tool calls back as an assistant turn, then run each
      // and return its result so the model can keep going — read → look up →
      // send, or fan out to many recipients — and stop when it ends a turn with
      // no tool call. Tools run sequentially by design: reads are instant
      // in-memory lookups and the radio link serializes transmits anyway, so
      // ordering the work keeps the audit trail readable and can't overrun the
      // companion.
      const assistantBlocks: LLMContentBlock[] = calls.map((c) => ({
        type: 'toolUse',
        id: c.id,
        name: c.name,
        input: c.args,
      }));
      const resultBlocks: LLMContentBlock[] = [];
      for (const c of calls) {
        // Halt mid-batch the instant the kill switch fires — do not run the
        // remaining tool calls in this turn.
        if (this.stopped) return;
        const args =
          c.args && typeof c.args === 'object'
            ? (c.args as Record<string, unknown>)
            : {};
        let content: string;
        if (!isToolName(c.name) || !allowed.includes(c.name)) {
          audit({
            ruleId: rule.id,
            ruleName: rule.name,
            event: label,
            tool: isToolName(c.name) ? c.name : undefined,
            outcome: 'blocked',
            detail: i18n.t('automation.audit.notAllowed', { tool: c.name }),
          });
          content = `Error: tool "${c.name}" is not allowed`;
        } else if (!isGatedTool(c.name)) {
          content = await this.runReadForResult(rule, event, c.name, args);
        } else if (gatedActions >= MAX_GATED_ACTIONS_PER_RUN) {
          audit({
            ruleId: rule.id,
            ruleName: rule.name,
            event: label,
            tool: c.name,
            args,
            outcome: 'blocked',
            detail: i18n.t('automation.audit.actionLimit'),
          });
          content = JSON.stringify({
            status: 'error',
            error: 'action limit reached for this event',
          });
        } else {
          gatedActions++;
          content = await this.runGatedForResult(rule, event, c.name, args);
        }
        resultBlocks.push({
          type: 'toolResult',
          toolUseId: c.id,
          content,
        });
      }
      messages.push({ role: 'assistant', content: assistantBlocks });
      messages.push({ role: 'user', content: resultBlocks });
    }

    // Exhausted the per-event turn cap while the model was still calling tools
    // (a turn with no tool call would have returned above). The run may already
    // have staged or sent transmit/write actions before hitting the cap.
    audit({
      ruleId: rule.id,
      ruleName: rule.name,
      event: label,
      outcome: 'failed',
      detail: i18n.t('automation.audit.maxSteps'),
    });
  }

  /**
   * Runs a read tool for the agentic loop, auditing it and returning its result
   * as a JSON string to feed back to the model (or an error string on failure,
   * so the model can recover rather than the loop crashing).
   */
  private async runReadForResult(
    rule: AutomationRule,
    event: MeshEvent,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.ctx) return 'Error: not connected';
    try {
      const result = await callTool(name, args, this.ctx);
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'executed',
      });
      return JSON.stringify(result ?? null);
    } catch (err) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'failed',
        detail: (err as Error).message,
      });
      return `Error: ${(err as Error).message}`;
    }
  }

  /**
   * Runs one transmit/write tool from the agentic loop under the rule's
   * autonomy and returns a JSON status the model reads to decide its next step.
   * In `approve` mode the action is staged for human sign-off (reported as
   * `staged_for_approval`); in `auto` mode it runs immediately, with transmits
   * subject to the airtime limiter. Every path is audited.
   */
  private async runGatedForResult(
    rule: AutomationRule,
    event: MeshEvent,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.ctx) {
      return JSON.stringify({ status: 'error', error: 'not connected' });
    }
    if (rule.autonomy === 'approve') {
      useMeshStore.getState().stageAction({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        tool: name,
        args,
        summary: describeAction(name, args),
        createdAt: Date.now(),
      });
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'proposed',
      });
      return JSON.stringify({ status: 'staged_for_approval' });
    }
    // Autonomous: gate transmit airtime, then execute.
    if (toolClass(name) === 'transmit' && !this.bucket.tryConsume()) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'rateLimited',
        detail: i18n.t('automation.audit.rateLimited'),
      });
      return JSON.stringify({ status: 'rate_limited', sent: false });
    }
    try {
      const result = await callTool(name, args, this.ctx);
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'auto',
      });
      return JSON.stringify({ status: 'done', result: result ?? null });
    } catch (err) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'failed',
        detail: (err as Error).message,
      });
      return JSON.stringify({
        status: 'error',
        error: (err as Error).message,
      });
    }
  }

  /**
   * Applies a rule's fixed-action tool call: enforces the allowlist, routes
   * reads straight through, and gates transmit/write calls by the airtime
   * limiter and the rule's autonomy (auto executes; approve stages for human
   * sign-off). Every path is audited. The LLM path does not go through here —
   * it uses the tool loop's runReadForResult / runGatedForResult.
   */
  private dispatchTool(
    rule: AutomationRule,
    event: MeshEvent,
    name: string,
    rawArgs: unknown,
  ): void {
    const label = eventLabel(event);
    if (!isToolName(name) || !rule.allowlist.includes(name)) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: label,
        tool: isToolName(name) ? name : undefined,
        outcome: 'blocked',
        detail: i18n.t('automation.audit.notAllowed', { tool: name }),
      });
      return;
    }
    const args =
      rawArgs && typeof rawArgs === 'object'
        ? (rawArgs as Record<string, unknown>)
        : {};
    const cls = toolClass(name);

    // Reads are always safe — run immediately, no staging or rate limit.
    if (cls === 'read') {
      void this.execute(rule, event, name, args, 'executed');
      return;
    }

    if (rule.autonomy === 'approve') {
      useMeshStore.getState().stageAction({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        tool: name,
        args,
        summary: describeAction(name, args),
        createdAt: Date.now(),
      });
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: label,
        tool: name,
        args,
        outcome: 'proposed',
      });
      return;
    }

    // Autonomous: gate transmit airtime, then execute.
    if (cls === 'transmit' && !this.bucket.tryConsume()) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: label,
        tool: name,
        args,
        outcome: 'rateLimited',
        detail: i18n.t('automation.audit.rateLimited'),
      });
      return;
    }
    void this.execute(rule, event, name, args, 'auto');
  }

  /** Runs a tool through the action surface and records the result. */
  private async execute(
    rule: AutomationRule,
    event: MeshEvent,
    name: ToolName,
    args: Record<string, unknown>,
    outcome: AuditOutcome,
  ): Promise<void> {
    if (!this.ctx) return;
    try {
      await callTool(name, args, this.ctx);
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome,
      });
    } catch (err) {
      audit({
        ruleId: rule.id,
        ruleName: rule.name,
        event: eventLabel(event),
        tool: name,
        args,
        outcome: 'failed',
        detail: (err as Error).message,
      });
    }
  }

  /**
   * Executes a staged action the user approved. Consumes an airtime token for
   * transmit tools (approval is the execution point) and audits the outcome.
   *
   * @returns how it resolved, so the inbox can retain a `rateLimited` proposal
   * for retry rather than dropping a transmit the user explicitly approved.
   */
  async runApproved(
    tool: ToolName,
    args: Record<string, unknown>,
    ruleId: string,
    ruleName: string,
  ): Promise<ApprovalOutcome> {
    if (!this.ctx) return 'failed';
    const event = i18n.t('automation.event.approved');
    if (toolClass(tool) === 'transmit' && !this.bucket.tryConsume()) {
      audit({
        ruleId,
        ruleName,
        event,
        tool,
        args,
        outcome: 'rateLimited',
        detail: i18n.t('automation.audit.rateLimited'),
      });
      return 'rateLimited';
    }
    try {
      await callTool(tool, args, this.ctx);
      audit({ ruleId, ruleName, event, tool, args, outcome: 'approved' });
      return 'executed';
    } catch (err) {
      audit({
        ruleId,
        ruleName,
        event,
        tool,
        args,
        outcome: 'failed',
        detail: (err as Error).message,
      });
      return 'failed';
    }
  }

  /** Records that the user denied a staged action. */
  recordDenied(
    tool: ToolName,
    args: Record<string, unknown>,
    ruleId: string,
    ruleName: string,
  ): void {
    audit({
      ruleId,
      ruleName,
      event: i18n.t('automation.event.approved'),
      tool,
      args,
      outcome: 'denied',
    });
  }
}

/** The single, tab-scoped automation engine instance. */
export const automationEngine = new AutomationEngine();
