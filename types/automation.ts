// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// Shapes for the in-browser automation engine (task 6.4): user-defined rules
// that react to live mesh events, optionally run an LLM, and take radio actions
// behind strict guardrails. Persisted per-radio, encrypted at rest. See
// `docs/design/ai-automation.md` §3–§5.

import type { ConnectionStatus } from '@/types/meshcore';
import type { ProviderId } from '@/lib/ai/provider';
import type { ToolName } from '@/lib/ai/tools';

/**
 * Which normalized {@link MeshEvent} kind a rule fires on, plus the optional
 * filters that narrow it before the (optional) {@link RuleCondition} runs.
 */
export type RuleTrigger =
  | {
      on: 'message';
      scope: 'direct' | 'channel' | 'any';
      /**
       * For `channel` scope: channel indices to fire on. Omitted or empty
       * matches any channel; otherwise the message's `channelIdx` must be in
       * the list.
       */
      channels?: number[];
      /**
       * For `direct` scope: contact `pubkeyPrefix`es to fire on. Omitted or
       * empty matches any sender; otherwise the message's `pubkeyPrefix` must
       * be in the list.
       */
      contacts?: string[];
    }
  | {
      on: 'advert';
      /**
       * Advert node types (`advType`) to fire on. Omitted or empty matches any
       * type; otherwise the advertising node's type must be in the list.
       */
      advTypes?: number[];
    }
  | { on: 'ack' }
  | { on: 'connection'; status?: ConnectionStatus }
  | {
      on: 'schedule';
      /**
       * A standard 5-field cron expression (minute, hour, day-of-month, month,
       * day-of-week) evaluated against the local clock once per minute while
       * automation is armed and connected. A malformed expression never fires.
       */
      cron: string;
    };

/**
 * An optional content filter applied after the {@link RuleTrigger} matches.
 * Kept deliberately small — richer matching belongs in an LLM `prompt` action.
 */
export interface RuleCondition {
  /**
   * Case-insensitive regular expression the event's message text must match.
   */
  contains?: string;
}

/**
 * What a rule does when it fires. A `fixed` action is a deterministic tool call
 * that needs no LLM or API key; a `prompt` action runs the provider loop with a
 * constrained tool set.
 */
export type RuleAction =
  | { kind: 'fixed'; tool: ToolName; args: Record<string, unknown> }
  | {
      kind: 'prompt';
      /** System prompt framing the task for the model. */
      system: string;
      /** Tools the model may call for this rule (subset of the allowlist). */
      allowTools: ToolName[];
      /** Provider to run against; defaults to the app's chosen provider. */
      providerId?: ProviderId;
      /** Provider-specific model id; defaults to the provider's first model. */
      model?: string;
      /**
       * Max LLM round-trips (tool-use turns) the agentic loop may take before
       * stopping. Clamped to a safe range by the engine; omitted uses a
       * default.
       */
      maxTurns?: number;
      /**
       * Max tokens the model may generate per response. Clamped by the engine;
       * omitted uses a default. Raise it for large single-response batches.
       */
      maxTokens?: number;
    };

/**
 * Per-rule autonomy. `approve` stages every transmit/write for human sign-off;
 * `auto` executes allowlisted actions without a prompt (still rate-limited and
 * stoppable via the kill switch).
 */
export type RuleAutonomy = 'approve' | 'auto';

/** A single automation rule: trigger → condition → action, with guardrails. */
export interface AutomationRule {
  id: string;
  /** Whether the rule is armed; disabled rules are skipped by the engine. */
  enabled: boolean;
  /** User-provided display name (localized only by the user's own input). */
  name: string;
  trigger: RuleTrigger;
  condition?: RuleCondition;
  action: RuleAction;
  autonomy: RuleAutonomy;
  /** Tools this rule may call; a call outside it is rejected pre-staging. */
  allowlist: ToolName[];
  /**
   * Optional per-rule cooldown in seconds. Once the rule fires it is skipped
   * until this many seconds elapse, breaking bot-to-bot reply loops (e.g. two
   * radios that each auto-reply "Good morning"). Keyed by rule id, so other
   * rules are unaffected. Omitted or `0` disables the cooldown.
   */
  cooldownSec?: number;
}

/**
 * A transmit/write action awaiting human approval in the inbox. Carries exactly
 * what is needed to render the proposal and, on approval, execute it — never a
 * secret.
 */
export interface StagedAction {
  id: string;
  ruleId: string;
  ruleName: string;
  tool: ToolName;
  args: Record<string, unknown>;
  /** Human-readable, pre-localized description of the proposed action. */
  summary: string;
  createdAt: number;
}

/** The disposition recorded for one audit-log line. */
export type AuditOutcome =
  | 'proposed'
  | 'approved'
  | 'denied'
  | 'auto'
  | 'executed'
  | 'failed'
  | 'rateLimited'
  | 'blocked';

/**
 * One append-only accountability record: what a rule proposed or did, when, and
 * how it resolved. Never contains the API key or a raw provider body.
 */
export interface AuditEntry {
  id: string;
  at: number;
  ruleId: string;
  ruleName: string;
  /** Short description of the triggering event. */
  event: string;
  tool?: ToolName;
  args?: Record<string, unknown>;
  outcome: AuditOutcome;
  /** Optional reason/result detail (e.g. an error message). Never the key. */
  detail?: string;
}
