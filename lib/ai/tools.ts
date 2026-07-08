// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// The MCP-shaped tool registry the automation engine (task 6.4) exposes to the
// LLM loop and to deterministic `fixed` rule actions. Every tool is a thin
// adapter over an existing useMeshCore action or store read — no new radio
// capability is invented. Tools are partitioned by side-effect risk so the
// guardrails (§4) can gate transmit/write calls while leaving reads always
// safe. Destructive/config actions (radio params, reboot, remove channel, set
// location) are deliberately excluded from the tool set in v1.
// See `docs/design/ai-automation.md` §4 and §6.

import { useMeshStore } from '@/store/meshStore';
import i18n from '@/lib/i18n';
import type { ToolSchema } from '@/lib/ai/provider';
import { FAVORITE_FLAG, MAX_MSG_BYTES } from '@/lib/meshcore/constants';
import { utf8ByteLength } from '@/lib/utils';

/** Every tool the engine can call, in menu order. */
export const TOOL_NAMES = [
  'read_contacts',
  'read_channels',
  'read_adverts',
  'read_messages',
  'read_self_info',
  'read_stats',
  'send_direct_message',
  'send_channel_message',
  'advertise',
  'add_contact',
  'remove_contact',
  'toggle_favorite',
  'reset_contact_path',
] as const;

/** A tool name the model calls / a rule references. */
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Invariant MeshCore operating knowledge prepended to every automation prompt,
 * ahead of the rule author's own system text (see {@link buildSystemPrompt}).
 * It teaches the model the mesh constraints every rule needs — message size,
 * addressing, airtime cost — so users don't have to restate them per rule.
 * Model-facing (never shown in the UI), so it is intentionally not localized;
 * the byte cap is interpolated from {@link MAX_MSG_BYTES} to stay in lockstep
 * with the send path that enforces it.
 */
export const SYSTEM_PREAMBLE = `You are an automation agent operating a MeshCore LoRa mesh radio through a fixed set of tools.

MeshCore constraints you must respect:
- The mesh is low-bandwidth and airtime is shared. Transmit sparingly and keep every message terse.
- Text messages are capped at ${MAX_MSG_BYTES} UTF-8 bytes; longer text is rejected and must be shortened and resent. Multi-byte characters (emoji, accents) use several bytes each, so stay well under the limit.
- Contacts are addressed by public-key prefix, never by name. Resolve the prefix with read_contacts or read_adverts before sending a direct message.
- Channels are addressed by index (0-7).
- To mention a user inside message text, write their exact name wrapped as @[Name], including the square brackets (e.g. @[Alice Smith]); the name may contain spaces. Use the exact name from read_contacts, and remember the token counts toward the byte limit.
- Prefer reading current state (read_contacts, read_messages, read_channels, ...) before any transmit or write action.
- Transmit and write actions may require human approval and are rate-limited. Do not retry them aggressively.`;

/**
 * Composes the full system prompt for a prompt rule: the invariant
 * {@link SYSTEM_PREAMBLE} first, then the rule author's task-specific system
 * text. Rule text comes last so a user can add nuance while the mesh invariants
 * always apply.
 */
export function buildSystemPrompt(ruleSystem: string): string {
  const rule = ruleSystem.trim();
  return rule ? `${SYSTEM_PREAMBLE}\n\n${rule}` : SYSTEM_PREAMBLE;
}

/**
 * A tool's side-effect class. `read` is always safe; `transmit` uses shared
 * LoRa airtime and is rate-limited; `write` mutates the radio's tables (cheap,
 * still allowlisted). Only `transmit`/`write` are staged for approval.
 */
export type ToolClass = 'read' | 'transmit' | 'write';

/** The id-based action surface the engine runs transmit/write tools through.
 * Implemented in `useAutomation` over the useMeshCore actions, resolving ids to
 * the Contact/Advert/ActiveConvo shapes those actions expect and reusing the
 * same `canTransmit` gate manual sends use. */
export interface ActionContext {
  sendDirectMessage(pubkeyPrefix: string, text: string): Promise<void>;
  sendChannelMessage(channelIdx: number, text: string): Promise<void>;
  advertise(flood: boolean): Promise<void>;
  addContact(pubkeyPrefix: string): Promise<void>;
  removeContact(pubkeyPrefix: string): Promise<void>;
  toggleFavorite(pubkeyPrefix: string): Promise<void>;
  resetContactPath(pubkeyPrefix: string): Promise<void>;
}

interface ToolDef {
  cls: ToolClass;
  schema: ToolSchema;
}

const STRING = { type: 'string' } as const;

/** The registry: each tool's risk class and MCP JSON-Schema description. */
export const TOOL_REGISTRY: Record<ToolName, ToolDef> = {
  read_contacts: {
    cls: 'read',
    schema: {
      name: 'read_contacts',
      description:
        "List the radio's saved contacts (name, id, type, favorite).",
      inputSchema: { type: 'object', properties: {} },
    },
  },
  read_channels: {
    cls: 'read',
    schema: {
      name: 'read_channels',
      description: 'List the joined channels (index and name).',
      inputSchema: { type: 'object', properties: {} },
    },
  },
  read_adverts: {
    cls: 'read',
    schema: {
      name: 'read_adverts',
      description: 'List nodes recently heard advertising on the mesh.',
      inputSchema: { type: 'object', properties: {} },
    },
  },
  read_messages: {
    cls: 'read',
    schema: {
      name: 'read_messages',
      description:
        'Read recent messages for a conversation id (e.g. "channel:0" or "direct:<prefix>").',
      inputSchema: {
        type: 'object',
        properties: {
          convoId: STRING,
          limit: { type: 'number' },
        },
        required: ['convoId'],
      },
    },
  },
  read_self_info: {
    cls: 'read',
    schema: {
      name: 'read_self_info',
      description: "Read this radio's own name, public key, and battery level.",
      inputSchema: { type: 'object', properties: {} },
    },
  },
  read_stats: {
    cls: 'read',
    schema: {
      name: 'read_stats',
      description:
        "Read the radio's runtime statistics (core, radio, packets).",
      inputSchema: { type: 'object', properties: {} },
    },
  },
  send_direct_message: {
    cls: 'transmit',
    schema: {
      name: 'send_direct_message',
      description: `Send a direct message to a contact by public-key prefix. "text" is limited to ${MAX_MSG_BYTES} UTF-8 bytes and is rejected if longer, so keep it brief.`,
      inputSchema: {
        type: 'object',
        properties: { to: STRING, text: STRING },
        required: ['to', 'text'],
      },
    },
  },
  send_channel_message: {
    cls: 'transmit',
    schema: {
      name: 'send_channel_message',
      description: `Send a message to a channel by index. "text" is limited to ${MAX_MSG_BYTES} UTF-8 bytes and is rejected if longer, so keep it brief.`,
      inputSchema: {
        type: 'object',
        properties: { channelIdx: { type: 'number' }, text: STRING },
        required: ['channelIdx', 'text'],
      },
    },
  },
  advertise: {
    cls: 'transmit',
    schema: {
      name: 'advertise',
      description:
        'Advertise this node to the mesh. Set flood=true for the whole mesh, false for direct neighbors.',
      inputSchema: {
        type: 'object',
        properties: { flood: { type: 'boolean' } },
      },
    },
  },
  add_contact: {
    cls: 'write',
    schema: {
      name: 'add_contact',
      description: 'Save a heard node (by public-key prefix) as a contact.',
      inputSchema: {
        type: 'object',
        properties: { pubkeyPrefix: STRING },
        required: ['pubkeyPrefix'],
      },
    },
  },
  remove_contact: {
    cls: 'write',
    schema: {
      name: 'remove_contact',
      description: 'Delete a contact by public-key prefix.',
      inputSchema: {
        type: 'object',
        properties: { pubkeyPrefix: STRING },
        required: ['pubkeyPrefix'],
      },
    },
  },
  toggle_favorite: {
    cls: 'write',
    schema: {
      name: 'toggle_favorite',
      description:
        'Toggle the favorite flag on a contact by public-key prefix.',
      inputSchema: {
        type: 'object',
        properties: { pubkeyPrefix: STRING },
        required: ['pubkeyPrefix'],
      },
    },
  },
  reset_contact_path: {
    cls: 'write',
    schema: {
      name: 'reset_contact_path',
      description:
        "Clear a contact's saved route so its next message floods to rediscover a path.",
      inputSchema: {
        type: 'object',
        properties: { pubkeyPrefix: STRING },
        required: ['pubkeyPrefix'],
      },
    },
  },
};

/** Whether a tool call must be staged/rate-limited (anything but a read). */
export function isGatedTool(name: ToolName): boolean {
  return TOOL_REGISTRY[name].cls !== 'read';
}

/** The class of a tool, for guardrail decisions. */
export function toolClass(name: ToolName): ToolClass {
  return TOOL_REGISTRY[name].cls;
}

/** Narrows an arbitrary string to a known {@link ToolName}. */
export function isToolName(value: string): value is ToolName {
  return Object.hasOwn(TOOL_REGISTRY, value);
}

/** The MCP tool schemas for a set of allowed tools, for the LLM request. */
export function toolSchemas(names: readonly ToolName[]): ToolSchema[] {
  return names.map((n) => TOOL_REGISTRY[n].schema);
}

// --- argument coercion (system boundary: LLM/rule-authored, so validate) -----

function reqString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Missing or invalid "${key}"`);
  }
  return v;
}

function reqNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Missing or invalid "${key}"`);
  }
  return n;
}

/**
 * Like {@link reqString}, but rejects a message body over {@link MAX_MSG_BYTES}
 * UTF-8 bytes instead of letting the frame builder silently truncate it. The
 * error is surfaced back to the model as a tool result so it can shorten and
 * resend rather than transmitting a clipped fragment.
 */
function reqMsgText(args: Record<string, unknown>, key: string): string {
  const text = reqString(args, key);
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_MSG_BYTES) {
    throw new Error(
      `Message is ${bytes}/${MAX_MSG_BYTES} UTF-8 bytes; shorten it and resend.`,
    );
  }
  return text;
}

/**
 * Renders a short, localized, human-readable description of a proposed tool
 * call for the approval inbox and audit log. Resolves contact/channel ids to
 * names where possible. Never includes a secret.
 */
export function describeAction(
  name: ToolName,
  args: Record<string, unknown>,
): string {
  const state = useMeshStore.getState();
  const contactName = (prefix: unknown): string => {
    if (typeof prefix !== 'string') return String(prefix);
    return state.contacts[prefix]?.name || prefix;
  };
  switch (name) {
    case 'send_direct_message':
      return i18n.t('automation.action.sendDirect', {
        to: contactName(args.to),
        text: String(args.text ?? ''),
      });
    case 'send_channel_message': {
      const idx = Number(args.channelIdx);
      const chName =
        state.channels[idx]?.name ||
        i18n.t('common.channelName', { index: idx });
      return i18n.t('automation.action.sendChannel', {
        channel: chName,
        text: String(args.text ?? ''),
      });
    }
    case 'advertise':
      return i18n.t(
        args.flood
          ? 'automation.action.advertiseFlood'
          : 'automation.action.advertiseZeroHop',
      );
    case 'add_contact':
      return i18n.t('automation.action.addContact', {
        name: contactName(args.pubkeyPrefix),
      });
    case 'remove_contact':
      return i18n.t('automation.action.removeContact', {
        name: contactName(args.pubkeyPrefix),
      });
    case 'toggle_favorite':
      return i18n.t('automation.action.toggleFavorite', {
        name: contactName(args.pubkeyPrefix),
      });
    case 'reset_contact_path':
      return i18n.t('automation.action.resetPath', {
        name: contactName(args.pubkeyPrefix),
      });
    default:
      return name;
  }
}

/**
 * Read-tool results are appended to the conversation and re-sent on every
 * subsequent turn, so bloated reads compound across the agentic loop. These
 * caps bound worst-case token growth while staying behavior-preserving for
 * typical small meshes (which fall under every cap).
 */
const READ_MESSAGES_DEFAULT = 10;
const READ_MESSAGES_CAP = 50;
/** Max rows a single read_contacts / read_adverts call returns. */
const READ_TABLE_CAP = 50;

/**
 * Executes a tool call. Read tools return JSON-serializable data from the
 * store; transmit/write tools run through the {@link ActionContext} (the same
 * useMeshCore action surface, and thus the same `canTransmit` gate, manual use
 * takes). Throws on invalid args or a failed action so the caller can audit it.
 */
export async function callTool(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<unknown> {
  const state = useMeshStore.getState();
  switch (name) {
    case 'read_contacts':
      return Object.values(state.contacts)
        .slice(0, READ_TABLE_CAP)
        .map((c) => ({
          name: c.name,
          pubkeyPrefix: c.pubkeyPrefix,
          advType: c.advType,
          favorite: (c.flags & FAVORITE_FLAG) !== 0,
        }));
    case 'read_channels':
      return Object.values(state.channels).map((ch) => ({
        idx: ch.idx,
        name: ch.name,
      }));
    case 'read_adverts':
      return Object.values(state.adverts)
        .slice(0, READ_TABLE_CAP)
        .map((a) => ({
          name: a.name,
          pubkeyPrefix: a.pubkeyPrefix,
          advType: a.advType,
          lastHeard: a.lastHeard,
        }));
    case 'read_messages': {
      const convoId = reqString(args, 'convoId');
      const limit =
        typeof args.limit === 'number' ? args.limit : READ_MESSAGES_DEFAULT;
      const msgs = state.msgHistory[convoId] ?? [];
      return msgs
        .slice(-Math.max(1, Math.min(limit, READ_MESSAGES_CAP)))
        .map((m) => ({
          text: m.text,
          own: m.own ?? false,
          senderName: m.senderName,
          timestamp: m.timestamp,
        }));
    }
    case 'read_self_info':
      return {
        name: state.selfInfo?.name,
        pubkey: state.selfInfo?.pubkey,
        batteryMv: state.battery?.voltage,
      };
    case 'read_stats':
      return state.client ? await state.client.getStats() : null;
    case 'send_direct_message':
      await ctx.sendDirectMessage(
        reqString(args, 'to'),
        reqMsgText(args, 'text'),
      );
      return { ok: true };
    case 'send_channel_message':
      await ctx.sendChannelMessage(
        reqNumber(args, 'channelIdx'),
        reqMsgText(args, 'text'),
      );
      return { ok: true };
    case 'advertise':
      await ctx.advertise(args.flood === true);
      return { ok: true };
    case 'add_contact':
      await ctx.addContact(reqString(args, 'pubkeyPrefix'));
      return { ok: true };
    case 'remove_contact':
      await ctx.removeContact(reqString(args, 'pubkeyPrefix'));
      return { ok: true };
    case 'toggle_favorite':
      await ctx.toggleFavorite(reqString(args, 'pubkeyPrefix'));
      return { ok: true };
    case 'reset_contact_path':
      await ctx.resetContactPath(reqString(args, 'pubkeyPrefix'));
      return { ok: true };
  }
}
