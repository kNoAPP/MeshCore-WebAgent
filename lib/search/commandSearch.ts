// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { IFuseOptions } from 'fuse.js';
import type { AppView, SettingsSection } from '@/store/meshStore';
import type { SupportedLocale } from '@/lib/i18n/config';
import type { UnitSystem } from '@/lib/units/config';
import type {
  ActiveConvo,
  Advert,
  Channel,
  Contact,
  Message,
} from '@/types/meshcore';

/** The kinds of thing the command palette can surface. */
export type CommandKind =
  'message' | 'contact' | 'advert' | 'channel' | 'page' | 'action';

/**
 * A verb the palette can run. Every variant maps onto a store action or a
 * `useMeshCore` function that some other surface already calls — the palette
 * is a second entry point, never a second implementation.
 */
export type PaletteAction =
  | { kind: 'advertise'; flood: boolean }
  | { kind: 'disconnect' }
  | { kind: 'reboot' }
  | { kind: 'toggleTheme' }
  | { kind: 'setLocale'; locale: SupportedLocale }
  | { kind: 'setUnitSystem'; unitSystem: UnitSystem }
  | { kind: 'markAllRead' }
  | { kind: 'addContact' }
  | { kind: 'addChannel' }
  | { kind: 'repeaterStatus'; prefix: string }
  | { kind: 'repeaterLogOut'; prefix: string }
  | { kind: 'contactResetRoute'; prefix: string }
  | { kind: 'contactFavorite'; prefix: string }
  | { kind: 'contactShare'; prefix: string }
  | { kind: 'contactMap'; prefix: string };

/**
 * What selecting a result does: open a conversation (optionally scrolled to a
 * message), open a cached advert's detail popup, navigate to a page/settings
 * section, or run a {@link PaletteAction}.
 */
export type CommandAction =
  | { type: 'message'; convo: ActiveConvo; msgId: string }
  | { type: 'convo'; convo: ActiveConvo }
  | { type: 'advert'; prefix: string }
  | { type: 'page'; view: AppView; section?: SettingsSection }
  | { type: 'run'; run: PaletteAction };

/**
 * A ranked, display-ready palette row. `highlight` holds Fuse match ranges into
 * `primary` (from `includeMatches`), for snippet emphasis. `destructive` styles
 * the row and makes the palette confirm before running it.
 */
export interface CommandResult {
  kind: CommandKind;
  id: string;
  primary: string;
  secondary?: string;
  timestamp?: number;
  highlight?: ReadonlyArray<readonly [number, number]>;
  destructive?: boolean;
  action: CommandAction;
}

/** A flattened message, indexed by body with sender/conversation context. */
export interface MessageRecord {
  msgId: string;
  convo: ActiveConvo;
  body: string;
  sender: string;
  timestamp?: number;
}

/** A contact, indexed by display name and public-key prefix. */
export interface ContactRecord {
  convo: ActiveConvo;
  name: string;
  prefix: string;
}

/**
 * A cached advert (a discovered node not saved on the radio), indexed by
 * display name and public-key prefix.
 */
export interface AdvertRecord {
  prefix: string;
  name: string;
}

/** A channel slot, indexed by name and its `Channel N` label. */
export interface ChannelRecord {
  convo: ActiveConvo;
  name: string;
  indexLabel: string;
}

/** A navigation target (page or settings section) with search keywords. */
export interface PageRecord {
  id: string;
  label: string;
  keywords: string;
  action: Extract<CommandAction, { type: 'page' }>;
}

/**
 * A runnable verb with search keywords. `hint` names what the verb applies to
 * (a contact, a repeater) for the row's second line; `destructive` routes it
 * through the palette's confirmation.
 */
export interface ActionRecord {
  id: string;
  label: string;
  keywords: string;
  hint?: string;
  destructive?: boolean;
  action: Extract<CommandAction, { type: 'run' }>;
}

/**
 * Static navigation targets, resolved to localized labels/keywords in the hook.
 * `section` deep-links a Settings card via {@link SettingsSection}.
 */
export const PAGE_TARGETS = [
  { id: 'chat', view: 'chat' },
  { id: 'map', view: 'map' },
  { id: 'stats', view: 'stats' },
  { id: 'settings', view: 'settings' },
  { id: 'device', view: 'settings', section: 'device' },
  { id: 'radio', view: 'settings', section: 'radio' },
  { id: 'identity', view: 'settings', section: 'identity' },
  { id: 'location', view: 'settings', section: 'location' },
  { id: 'display', view: 'settings', section: 'display' },
  { id: 'ai', view: 'settings', section: 'ai' },
  { id: 'automation', view: 'settings', section: 'automation' },
  { id: 'danger', view: 'settings', section: 'danger' },
] as const satisfies ReadonlyArray<{
  id: string;
  view: AppView;
  section?: SettingsSection;
}>;

/**
 * The radio-wide verbs, in display order, resolved to localized labels and
 * keywords in the hook. Each `id` is also the `command.action.*` /
 * `command.actionKeywords.*` key. Everything here needs a live link, which the
 * palette always has: it only mounts while connected.
 */
export const ACTION_TARGETS = [
  { id: 'advertiseFlood', run: { kind: 'advertise', flood: true } },
  { id: 'advertiseZeroHop', run: { kind: 'advertise', flood: false } },
  { id: 'markAllRead', run: { kind: 'markAllRead' } },
  { id: 'addContact', run: { kind: 'addContact' } },
  { id: 'addChannel', run: { kind: 'addChannel' } },
  { id: 'toggleTheme', run: { kind: 'toggleTheme' } },
  { id: 'reboot', run: { kind: 'reboot' }, destructive: true },
  { id: 'disconnect', run: { kind: 'disconnect' }, destructive: true },
] as const satisfies ReadonlyArray<{
  id: string;
  run: PaletteAction;
  destructive?: boolean;
}>;

/**
 * The per-contact verbs, in display order. `route` is only offered when the
 * contact has a stored path and `map` only when it has advertised a fix, so a
 * verb the target UI would render disabled never reaches the palette.
 */
export const CONTACT_VERBS = ['favorite', 'route', 'share', 'map'] as const;

/** One of the per-contact verbs the palette can run. */
export type ContactVerb = (typeof CONTACT_VERBS)[number];

/** Fuse options for message bodies: extended (token) search for out-of-order,
 * multi-word queries, with match indices for snippet highlighting. */
export const MESSAGE_FUSE_OPTIONS: IFuseOptions<MessageRecord> = {
  keys: [
    { name: 'body', weight: 0.7 },
    { name: 'sender', weight: 0.2 },
    { name: 'convo.label', weight: 0.1 },
  ],
  includeMatches: true,
  ignoreLocation: true,
  useExtendedSearch: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

/** Fuse options for contacts: name weighted over key prefix. */
export const CONTACT_FUSE_OPTIONS: IFuseOptions<ContactRecord> = {
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'prefix', weight: 0.3 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

/** Fuse options for cached adverts: name weighted over key prefix. */
export const ADVERT_FUSE_OPTIONS: IFuseOptions<AdvertRecord> = {
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'prefix', weight: 0.3 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 2,
};

/** Fuse options for channels: name and `Channel N` label. */
export const CHANNEL_FUSE_OPTIONS: IFuseOptions<ChannelRecord> = {
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'indexLabel', weight: 0.3 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 1,
};

/** Fuse options for page/settings targets: label plus alias keywords. */
export const PAGE_FUSE_OPTIONS: IFuseOptions<PageRecord> = {
  keys: [
    { name: 'label', weight: 0.6 },
    { name: 'keywords', weight: 0.4 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 1,
};

/**
 * Fuse options for runnable verbs. `hint` carries the contact or repeater a
 * verb applies to and is weighted alongside the label, so "reset gold-saddle"
 * ranks that contact's route verb above the same verb on every other node.
 */
export const ACTION_FUSE_OPTIONS: IFuseOptions<ActionRecord> = {
  keys: [
    { name: 'label', weight: 0.5 },
    { name: 'hint', weight: 0.3 },
    { name: 'keywords', weight: 0.2 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 1,
};

// Received channel messages are firmware-formatted as `<sender>: <body>`; own
// and direct messages carry only the body, with the sender from `senderName`.
function bodyAndSender(
  msg: Message,
  kind: ActiveConvo['kind'],
): { body: string; sender: string } {
  if (kind === 'channel' && !msg.own) {
    const idx = msg.text.indexOf(': ');
    if (idx !== -1) {
      return { body: msg.text.slice(idx + 2), sender: msg.text.slice(0, idx) };
    }
  }
  return { body: msg.text, sender: msg.senderName ?? '' };
}

/**
 * Flattens conversation history into searchable message records, newest first
 * and capped at `limit` to keep large histories responsive. System and id-less
 * messages are skipped. `resolveConvo` maps a conversation id to its display
 * target, returning `null` for orphaned histories (dropped contact/channel).
 */
export function buildMessageRecords(
  msgHistory: Record<string, Message[]>,
  resolveConvo: (convoId: string) => ActiveConvo | null,
  limit: number,
): MessageRecord[] {
  const records: MessageRecord[] = [];
  for (const [convoId, msgs] of Object.entries(msgHistory)) {
    const convo = resolveConvo(convoId);
    if (!convo) continue;
    for (const msg of msgs) {
      if (msg.system || !msg.id || !msg.text) continue;
      const { body, sender } = bodyAndSender(msg, convo.kind);
      records.push({
        msgId: msg.id,
        convo,
        body,
        sender,
        timestamp: msg.timestamp,
      });
    }
  }
  records.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return records.slice(0, limit);
}

/** Builds searchable contact records from the store's contact table. */
export function buildContactRecords(
  contacts: Record<string, Contact>,
  resolveConvo: (prefix: string, name: string) => ActiveConvo,
): ContactRecord[] {
  return Object.values(contacts).map((c) => {
    const name = c.name || c.pubkeyPrefix.slice(0, 8);
    return {
      convo: resolveConvo(c.pubkeyPrefix, name),
      name,
      prefix: c.pubkeyPrefix,
    };
  });
}

/**
 * Builds searchable records for cached adverts (discovered nodes), skipping any
 * already saved as a contact so they don't duplicate the contacts group.
 */
export function buildAdvertRecords(
  advertCache: Record<string, Advert>,
  contacts: Record<string, Contact>,
): AdvertRecord[] {
  return Object.values(advertCache)
    .filter((a) => contacts[a.pubkeyPrefix] === undefined)
    .map((a) => ({
      prefix: a.pubkeyPrefix,
      name: a.name || a.pubkeyPrefix.slice(0, 8),
    }));
}

/** Builds searchable channel records from the store's channel slots. */
export function buildChannelRecords(
  channels: Record<number, Channel>,
  resolveConvo: (idx: number, name: string) => ActiveConvo,
  indexLabel: (idx: number) => string,
): ChannelRecord[] {
  return Object.values(channels).map((ch) => {
    const fallback = indexLabel(ch.idx);
    const name = ch.name || fallback;
    return {
      convo: resolveConvo(ch.idx, name),
      name,
      indexLabel: fallback,
    };
  });
}
