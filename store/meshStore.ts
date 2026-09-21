// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { create } from 'zustand';
import type {
  Contact,
  Channel,
  Advert,
  AutoAddConfig,
  Message,
  ActiveConvo,
  ConnectionStatus,
  BatteryInfo,
  SelfInfo,
  DeviceInfo,
  SyncProgress,
  RepeaterStatus,
  RepeaterAccess,
  TelemetryReading,
  StatsResult,
  TransportKind,
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
import type {
  AutomationRule,
  StagedAction,
  AuditEntry,
} from '@/types/automation';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import type { AclEntry, Neighbor } from '@/types/meshcore';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import { convoId } from '@/lib/utils';
import i18n from '@/lib/i18n';
import {
  LOCALE_STORAGE_KEY,
  resolveInitialLocale,
  type SupportedLocale,
} from '@/lib/i18n/config';
import {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  type Theme,
} from '@/lib/theme/config';
import {
  DEFAULT_UNIT_SYSTEM,
  normalizeUnitSystem,
  type UnitSystem,
} from '@/lib/units/config';
import { normalizeMapPrefs, type MapPrefs } from '@/lib/map/config';
import {
  DEFAULT_MAP_FILTERS,
  MAP_FILTER_KEYS,
  normalizeMapFilters,
  type MapFilters,
} from '@/lib/map/filters';
import { DEFAULT_AI_PREF, normalizeAiPref, type AiPref } from '@/lib/ai/pref';
import {
  DEFAULT_NOTIFY_PREF,
  normalizeNotifyPref,
  type NotifyPref,
} from '@/lib/notify/pref';
import { mergeAdvertCache } from '@/lib/map/advertCache';

const AUDIT_LOG_LIMIT = 200;

const CLI_LOG_LIMIT = 200;

// Deliberately far shorter than the transcript: the console's ↑/↓ buffer is for
// re-running the last few commands, not for auditing the session.
const CLI_HISTORY_LIMIT = 50;

// Fresh token per session, so a queued CLI command can tell whether the session
// it was enqueued under is still the current one.
let adminSessionSeq = 0;
const nextAdminSessionToken = (): number => ++adminSessionSeq;

const DEFAULT_AUTOADD_CONFIG: AutoAddConfig = {
  mode: 'all',
  chat: true,
  repeater: true,
  room: true,
  sensor: false,
  overwriteOldest: false,
  maxHops: MAX_HOPS_NO_LIMIT,
};

function normalizeAutoAddConfig(raw: unknown): AutoAddConfig {
  if (typeof raw === 'object' && raw !== null) {
    return { ...DEFAULT_AUTOADD_CONFIG, ...(raw as Partial<AutoAddConfig>) };
  }
  return DEFAULT_AUTOADD_CONFIG;
}

/** All filter values, in menu order; also the allowlist for persisted state. */
export const CONTACT_FILTERS = [
  'all',
  'favorites',
  'users',
  'repeaters',
  'rooms',
  'sensors',
] as const;

/** Which subset of contacts the sidebar shows. */
export type ContactFilter = (typeof CONTACT_FILTERS)[number];

/** All sort values, in menu order; also the allowlist for persisted state. */
export const CONTACT_SORTS = ['az', 'heard', 'latest'] as const;

/** How the visible contacts are ordered. */
export type ContactSort = (typeof CONTACT_SORTS)[number];

/** Every top-level page; also the allowlist for URL-hash parsing. */
export const APP_VIEWS = ['chat', 'nodes', 'stats', 'settings', 'map'] as const;

/** Which top-level page the connected app is showing. */
export type AppView = (typeof APP_VIEWS)[number];

/** The cards on the Settings page, in render order; used for deep-linking. */
export const SETTINGS_SECTIONS = [
  'device',
  'radio',
  'identity',
  'location',
  'display',
  'notifications',
  'ai',
  'automation',
  'backup',
  'danger',
] as const;

/** A deep-link target for a specific {@link SettingsPage} section card. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Masked lifecycle state of the BYO LLM API key, mirrored for reactive UI. The
 * key value itself is never stored here (or in any serialized slice) — only
 * whether one is loaded in memory and whether an encrypted copy is persisted on
 * this device. See `lib/ai/secret.ts`.
 */
export type AiKeyStatus = 'none' | 'memory' | 'persisted';

/**
 * Persisted sidebar state: the contacts list's filter, order and favorite
 * pinning, plus the layout the user dragged it to. `channelsHeight` is `null`
 * until the divider is dragged, which is what keeps the Channels section
 * auto-sizing to its content.
 */
export interface ContactView {
  filter: ContactFilter;
  sort: ContactSort;
  pinFavorites: boolean;
  /** Sidebar width in CSS pixels. */
  width: number;
  /** Dragged height of the Channels section in px, or `null` for auto. */
  channelsHeight: number | null;
}

/** Narrowest the sidebar can be dragged, in CSS pixels. */
export const SIDEBAR_MIN_WIDTH = 180;
/** Widest the sidebar can be dragged, in CSS pixels. */
export const SIDEBAR_MAX_WIDTH = 480;
/** Sidebar width before the user drags it, in CSS pixels. */
export const SIDEBAR_DEFAULT_WIDTH = 240;

const DEFAULT_CONTACT_VIEW: ContactView = {
  filter: 'all',
  sort: 'az',
  pinFavorites: true,
  width: SIDEBAR_DEFAULT_WIDTH,
  channelsHeight: null,
};

// A persisted filter/sort value must never reach the sidebar's exhaustive
// switches unrecognized, and a persisted size must never render the sidebar
// unusable.
function normalizeContactView(raw: unknown): ContactView {
  const parsed = {
    ...DEFAULT_CONTACT_VIEW,
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
  } as ContactView;
  return {
    filter: CONTACT_FILTERS.includes(parsed.filter)
      ? parsed.filter
      : DEFAULT_CONTACT_VIEW.filter,
    sort: CONTACT_SORTS.includes(parsed.sort)
      ? parsed.sort
      : DEFAULT_CONTACT_VIEW.sort,
    pinFavorites:
      typeof parsed.pinFavorites === 'boolean'
        ? parsed.pinFavorites
        : DEFAULT_CONTACT_VIEW.pinFavorites,
    width: clampSidebarWidth(parsed.width),
    // Only sanity-checked here — the real ceiling is the sidebar's own height,
    // which only the component can measure, so it clamps on every render.
    channelsHeight:
      typeof parsed.channelsHeight === 'number' &&
      Number.isFinite(parsed.channelsHeight) &&
      parsed.channelsHeight > 0
        ? parsed.channelsHeight
        : null,
  };
}

/** Keeps a sidebar width inside the draggable range. */
export function clampSidebarWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * The per-radio user preferences persisted as one encrypted blob in IndexedDB
 * (see `savePreferences`/`loadPreferences` in `lib/storage.ts`). Every field is
 * settable only while a radio is connected, so none of these belong in
 * localStorage — that layer is reserved for the pre-connect preferences
 * (`locale`, `theme`). Loaded on connect via
 * {@link MeshActions.restorePreferences} and saved on change from the
 * `useMeshCore` connect flow.
 */
export interface RadioPreferences {
  unitSystem: UnitSystem;
  contactView: ContactView;
  autoAddConfig: AutoAddConfig;
  automationEnabled: boolean;
  mapPrefs: MapPrefs | null;
  mapFilters: MapFilters;
  aiPref: AiPref;
  notifyPref: NotifyPref;
  showFullPublicKeys: boolean;
}

/**
 * Severity of a {@link Notification} row, driving its icon and color in the
 * action bar's drawer and the tint of its transient line. `warning` covers a
 * degraded success — an operation that completed with nothing to do, or
 * declined for a reason that is not a failure.
 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * Where a {@link MeshActions.notify} call shows up, beyond the screen-reader
 * announcer that every one of them feeds.
 *
 * - `'bar'` — a transient line in the action bar *and* a drawer row.
 * - `'silent'` — a drawer row only, for events too frequent to flash a line.
 * - `'none'` — a transient line only; nothing is kept.
 */
export type NotifySurface = 'bar' | 'silent' | 'none';

/**
 * A notice as the action bar's transient line and the screen-reader announcer
 * see it. The drawer keeps its own richer {@link Notification} row.
 */
export interface Notice {
  /**
   * Distinguishes two notices carrying identical text, so the announcer can
   * re-announce a repeat and the bar can restart its fade.
   */
  id: number;
  level: NotificationLevel;
  /** Already localized at notify time, like {@link Notification.text}. */
  text: string;
}

/** One call to {@link MeshActions.notify}. */
export interface NotifyInput {
  level: NotificationLevel;
  /** Localized at the call site — the store never translates. */
  text: string;
  /**
   * Dedup key; repeats collapse into one drawer row. Unused by `'none'`,
   * which keeps no row, but still required so a later re-routing of that call
   * site has the key it needs.
   */
  key: string;
  /**
   * Makes the drawer row a jump to this conversation, and ties the row to it:
   * opening the conversation drops the row. It does not reach the transient
   * line, which carries no controls at all.
   */
  convo?: ActiveConvo;
  /** Defaults to `'bar'`. */
  surface?: NotifySurface;
}

/**
 * One row of the action bar's notification history — the record that outlives
 * the transient line raised for the same event, and the only surface a
 * `'silent'` notice reaches.
 */
export interface Notification {
  /**
   * Stable for the row's whole life, including across a merge, so the drawer
   * can key on it without remounting a row that merely grew a repeat.
   */
  id: number;
  /**
   * Bumped on every push that touches the row, a merge included. This — not
   * {@link Notification.id} — is what {@link MeshState.notificationsSeenAt}
   * is measured against, so a repeat of an already-read event counts as
   * unread again.
   */
  seq: number;
  level: NotificationLevel;
  /** Already localized at push time, like {@link Notice.text}. */
  text: string;
  /** Epoch seconds, for the drawer's relative timestamp. */
  at: number;
  /** When set, the row is a button that opens this conversation. */
  convo?: ActiveConvo;
  /** Repeats of the same event collapse into one row and bump this. */
  count: number;
  /**
   * Dedup key. A push whose key matches *any* row bumps that row's `count`
   * and moves it back to the top instead of inserting, so a repeated event
   * cannot flood the list even when other notices land between the repeats.
   */
  key: string;
}

/**
 * Stable code for the connect-screen error, resolved to localized copy at
 * render time so the message follows a language change made while disconnected.
 */
export type ConnectErrorCode = 'connectionFailed' | 'radioNoResponse';

/**
 * A message that just landed, recorded by {@link MeshActions.addMessage}. Kept
 * flat rather than as a pointer into `msgHistory` so a reader can't
 * accidentally resolve it against a later, rebuilt list.
 */
export interface MessageArrival {
  convoId: string;
  msgId: string;
  text: string;
  senderName?: string;
  own: boolean;
  system: boolean;
  /**
   * Whether the conversation was on screen *when this landed* — captured here
   * rather than re-derived later, so returning to a blurred tab can't replay
   * an announcement for a message the arrival notice already covered.
   */
  visible: boolean;
}

/**
 * The newest inbound message of the session, for the action bar's quick link
 * back to the conversation it landed in.
 *
 * @remarks Separate from {@link MessageArrival}, which is shaped for the
 * screen-reader announcer: that one is withheld for own sends and for an
 * arrival that would displace an announcement still pending, and names its
 * conversation by id alone. This one carries the descriptor {@link openConvo}
 * needs and is written for every inbound message a connected session
 * receives, on screen or not — the backlog a connect or reconnect drains
 * before reporting `connected` is not one, and stays unread like the drawer's
 * row.
 */
export interface LatestInbound {
  convo: ActiveConvo;
  /**
   * Display name of whoever wrote it — the author, for a room post — or
   * `null` when the frame identifies nobody: a channel text with no
   * `sender: ` prefix, or an unsigned room post. The bar names the
   * conversation instead of asserting an author it doesn't have.
   */
  sender: string | null;
  /** Epoch seconds, for the bar's live-ticking relative stamp. */
  at: number;
}

/**
 * Whether the newest message in a conversation was on screen when it landed.
 * Recorded for *every* append, including the user's own sends and arrivals
 * that {@link MessageArrival} withholds, so a reader can always ask "was the
 * latest message on screen when it arrived?" and get an answer about the
 * latest message.
 */
export interface MessageAppend {
  msgId: string;
  visible: boolean;
}
/**
 * The radio auto-reconnect gave up on, kept past the session teardown so the
 * connect screen can say what was lost and offer a one-click retry.
 */
export interface ConnectFailure {
  /** Display name of the radio at the time the link dropped. */
  device: string;
  transport: TransportKind;
  /** WebSocket URL of a `wifi` session, so the retry reuses it. */
  url?: string;
}

/**
 * How far the auto-reconnect loop has got, for the overlay's counter.
 */
export interface ReconnectProgress {
  /** 1-based index of the attempt about to run, or already running. */
  attempt: number;
  /** Attempts the loop makes before giving up. */
  total: number;
  /** True while waiting out the backoff delay that precedes `attempt`. */
  waiting: boolean;
  /** `Date.now()` the pending attempt starts at, for the countdown. */
  resumeAt: number | null;
}

/**
 * Login state of a remote-admin session with a repeater or room server.
 * `pending` covers the in-flight login handshake; the {@link RepeaterAccess}
 * levels (`admin`/`guest`) are the accepted, server-granted states; `loggedOut`
 * is the initial and post-failure state.
 */
export type AdminLoginState = 'loggedOut' | 'pending' | RepeaterAccess;

/**
 * Whether a session reached an accepted, server-granted login — any of the
 * {@link RepeaterAccess} levels, as opposed to the handshake or logged-out
 * states.
 */
export function isAuthedLogin(
  login: AdminLoginState | undefined,
): login is RepeaterAccess {
  return login != null && login !== 'loggedOut' && login !== 'pending';
}

/**
 * Whether a room session's granted role may publish posts. Read-only roles
 * have their post dropped by the server without an ack, so every path that can
 * put a post on the air — composer, retry, automation — gates on this.
 */
export function canPostToRoom(
  login: AdminLoginState | null | undefined,
): boolean {
  return login === 'admin' || login === 'readWrite';
}

/** One line of a repeater CLI transcript. */
export interface CliLine {
  /** `true` for a command we sent, `false` for the repeater's reply. */
  own: boolean;
  text: string;
  /** `Date.now()` when the line was appended. */
  ts: number;
  /**
   * `true` for a client-side note about the exchange (e.g. "no reply from the
   * node") rather than traffic with the repeater. Rendered muted and without a
   * prompt marker.
   */
  note?: boolean;
  /**
   * `true` for repeater output that arrived with no request outstanding —
   * unprompted node output, or the late answer to a command already reported
   * as unanswered. Marked so it can't be read as the reply to the command
   * above it, which is the one it would otherwise sit under.
   */
  unsolicited?: boolean;
}

/**
 * A per-repeater remote-admin session: login state, the latest decoded status,
 * and the bounded CLI transcript. Deliberately ephemeral — never persisted, and
 * cleared on disconnect. The password is not part of the session; a remembered
 * password lives only in the encrypted per-radio `secrets` store (see
 * `lib/meshcore/adminCreds.ts`).
 */
export interface AdminSession {
  login: AdminLoginState;
  /**
   * Unique per-instance token, assigned when the session is created and
   * preserved across all its later mutations (status/CLI/config/neighbors).
   * Lets a queued CLI command detect that the session it was enqueued under has
   * since been reset (logout) or replaced by a re-login — so a stale command
   * (e.g. a write queued before logout) is rejected instead of transmitting
   * from a different session.
   */
  token: number;
  status?: RepeaterStatus;
  /**
   * Unix epoch seconds, from *this computer's* clock, when {@link status} was
   * read — the dashboard refreshes on a manual button, so the values carry no
   * age of their own.
   */
  statusAt?: number;
  cli: CliLine[];
  /**
   * Commands the user submitted at this repeater's console, oldest first and
   * capped at {@link CLI_HISTORY_LIMIT}. Session state rather than console
   * state so the ↑/↓ buffer survives switching tabs, and ephemeral like the
   * rest of the session — a command line can carry a password, so it must not
   * outlive the login that typed it.
   */
  cliHistory?: string[];
  /**
   * How many CLI commands are outstanding for this repeater — queued or
   * awaiting a reply. Session state rather than console-component state, so
   * the pending indicator survives navigating away from the transcript and
   * back while a slow round trip is still in flight.
   */
  cliPending?: number;
  /**
   * Cache of the repeater's loaded/confirmed Config-tab values, keyed by
   * setting id. Ephemeral (part of the session), so the Config fields stay
   * populated when the user navigates away and back without re-reading, and
   * clears on disconnect.
   */
  config?: Record<string, string>;
  /**
   * Cache of the repeater's last-read neighbors list. Ephemeral (part of the
   * session), so the Neighbors tab stays populated when the user navigates
   * away and back without re-reading, and clears on disconnect. `undefined`
   * until the first read; an empty array is a settled "no neighbors" result.
   */
  neighbors?: Neighbor[];
  /**
   * Whether the newest attempt to refresh {@link neighbors} failed, so the
   * cached rows are the last good read rather than a confirmed current one.
   * Session state for the same reason as {@link accessListStale}: the tab
   * unmounts on navigation, so component state would reset and the stale list
   * would come back looking freshly confirmed.
   */
  neighborsStale?: boolean;
  /**
   * Cache of the node's last-read access control list. Ephemeral like the rest
   * of the session — it names who may administer this node, so it must not
   * outlive the admin login that was allowed to read it. `undefined` until the
   * first read; an empty array is a settled "no entries", which a node holding
   * none does answer with.
   */
  accessList?: AclEntry[];
  /**
   * Whether the newest attempt to refresh {@link accessList} failed, so the
   * cached rows are the last good read rather than a confirmed current one.
   * Kept here rather than in the tab because the tab unmounts on navigation:
   * component state would reset and the stale list would come back looking
   * freshly confirmed.
   */
  accessListStale?: boolean;
}

/**
 * One node's last telemetry reply. Unlike {@link AdminSession} this needs no
 * login, so it is keyed by node rather than by session and survives a logout.
 */
export interface TelemetrySnapshot {
  /** Decoded readings in wire order; empty when the node disclosed none. */
  readings: TelemetryReading[];
  /**
   * Unix epoch seconds, from *this computer's* clock, when the reply arrived —
   * the reply carries no timestamp, and reads only happen on a manual refresh.
   */
  readAt: number;
}

interface MeshState {
  // Connection
  client: MeshCoreClient | null;
  status: ConnectionStatus;
  deviceName: string;
  selfInfo: SelfInfo | null;
  deviceInfo: DeviceInfo | null;
  battery: BatteryInfo | null;
  syncProgress: SyncProgress | null;

  /**
   * Cached device Stats-page snapshot, so the cards stay populated when the
   * user leaves the Stats view and returns without re-reading. Ephemeral
   * (never persisted); cleared on disconnect. `deviceClock` holds the last read
   * device time and its skew from this computer.
   */
  deviceStats: StatsResult | null;
  /**
   * The snapshot {@link deviceStats} replaced, so the Stats page can show what
   * each counter did between the last two reads. Null until a second read.
   */
  prevDeviceStats: StatsResult | null;
  /**
   * Unix epoch seconds, from *this computer's* clock, when {@link deviceStats}
   * was read. The cards refresh on a manual button, so without it there is no
   * way to tell a live reading from one taken an hour ago.
   */
  deviceStatsAt: number | null;
  deviceClock: { time: number; skew: number } | null;
  /**
   * The Stats page's own battery/storage snapshot (including `null` when the
   * device didn't report it), link-scoped alongside {@link deviceStats} so a
   * radio switch or a timed-out read can't surface another link's reading. The
   * action bar's {@link battery} is separate and deliberately retained on a
   * null read.
   */
  deviceBattery: BatteryInfo | null;

  // Mesh data
  contacts: Record<string, Contact>;
  channels: Record<number, Channel>;
  adverts: Record<string, Advert>;
  /**
   * Metadata for every advert heard from the connected radio, keyed by
   * `pubkeyPrefix`. A superset of {@link adverts}, restored on connect and
   * persisted per-radio (encrypted, like message history) so the map can plot
   * discovered nodes the radio's bounded contact table can't hold — a different
   * radio unlocks a different cache. See `lib/map/advertCache.ts` and
   * `lib/storage.ts`.
   */
  advertCache: Record<string, Advert>;
  autoAddConfig: AutoAddConfig;

  // Conversations
  msgHistory: Record<string, Message[]>;
  /**
   * The last message {@link MeshActions.addMessage} appended that was not the
   * user's own — the one signal that a message *arrived now*, as opposed to
   * `msgHistory` merely changing, which `restoreHistory` also does with
   * messages the user read days ago. An own send leaves this alone so it can't
   * displace an arrival the announcer hasn't rendered yet. `null` until one
   * arrives.
   */
  lastArrival: MessageArrival | null;
  /**
   * The newest inbound message of the session, or `null` until one arrives.
   * One slot: a newer arrival replaces it outright. Session state, so a
   * disconnect clears it with everything else.
   */
  latestInbound: LatestInbound | null;
  /**
   * Whether the background drain is still catching up on an offline queue too
   * large for the connect-time pass.
   *
   * @remarks Indeterminate by necessity — the companion protocol has no
   * queue-depth query, so there is no remaining count or fraction to report.
   * While it is set, arrivals are collapsed into one summary instead of each
   * raising its own notification. Session state, cleared by `reset()` and
   * never persisted.
   */
  backlogDraining: boolean;
  /**
   * The newest append to each conversation, and whether that conversation was
   * on screen at that moment. Unlike {@link lastArrival} this is written on
   * every append, because withholding it to protect a pending announcement
   * would also withhold the record {@link ChatArea} needs: focus can return
   * between the append and its scroll effect, and without an arrival-time
   * answer an off-screen arrival reads as an on-screen one and scrolls the
   * user past the unread boundary. Keyed by conversation rather than a single
   * slot, because the frame parser hands over a whole chunk at once and a
   * second conversation's message must not erase the first's record.
   */
  lastAppends: Record<string, MessageAppend>;
  activeConvo: ActiveConvo | null;
  /**
   * Bumped on every selection, including re-selecting the conversation already
   * open. The repeater/room view is keyed by node and so does not remount on a
   * repeat selection; this is how it notices one and returns to its default
   * tab.
   */
  convoOpenSeq: number;
  /**
   * Id of a message the open conversation should scroll to and briefly
   * highlight, set when navigating from the command palette. One-shot: cleared
   * by {@link ChatArea} once consumed.
   */
  scrollToMsgId: string | null;
  /**
   * Per-conversation id of the first unread message captured when the
   * conversation was last opened, so {@link ChatArea} can draw a "last unread"
   * divider above it. Frozen at open time (before {@link markRead} clears the
   * flags) and left in place while viewing, so the boundary doesn't jump as
   * live messages arrive. Absent when the conversation had no unread messages.
   */
  unreadMarkers: Record<string, string>;
  /**
   * Unsent composer text per conversation id, so a draft typed in one
   * conversation can't be re-targeted at another by switching away from it.
   * Session state only: never persisted, and dropped on disconnect. A
   * conversation with no draft has no entry.
   */
  drafts: Record<string, string>;

  // UI
  contactView: ContactView;
  locale: SupportedLocale;
  theme: Theme;
  /** Measurement system used for displayed distances. */
  unitSystem: UnitSystem;
  /**
   * Whether public keys for contacts and adverts are shown full-length
   * (otherwise truncated to a 4 + … + 4 hex preview).
   */
  showFullPublicKeys: boolean;
  /** Provider/model the AI settings picker last selected (never the key). */
  aiPref: AiPref;
  /** Desktop notification scope and sound choice for this radio. */
  notifyPref: NotifyPref;
  /** Persisted viewport, or `null` until the user first pans/zooms the map. */
  mapPrefs: MapPrefs | null;
  /** Which node types, ages and favorites the map is plotting. */
  mapFilters: MapFilters;
  /**
   * True once this radio's preferences blob has been read. The session reports
   * `connected` before that read finishes, so a `null` preference means "not
   * loaded yet" until this flips.
   */
  prefsHydrated: boolean;
  /**
   * The newest notice, for the session-wide screen-reader announcer. Every
   * {@link MeshActions.notify} feeds it, `'silent'` included — a drawer badge
   * and a fading line announce nothing by themselves. Never cleared on a
   * timer: the regions are invisible, and a live region only speaks when its
   * content changes.
   */
  notice: Notice | null;
  /**
   * The notice the action bar is currently showing as its transient line, or
   * `null` once it has aged out. One slot — a newer notice replaces it
   * outright — and no dismiss control: anything worth keeping is a drawer row.
   * Only ever written while the status is `connected`, since the bar is
   * unmounted otherwise and a notice held across that boundary would surface
   * in the wrong session.
   */
  barNotice: Notice | null;
  /**
   * Notification history for the action bar's drawer, newest first and
   * capped at 50 rows. Session-only: rows carry message text, so persisting
   * them would mean a new encrypted per-radio record for what is no more
   * than a log of the current session.
   */
  notifications: Notification[];
  /**
   * The {@link Notification.seq} high-water mark from the last time the
   * drawer was open. The bell badge counts the rows above it.
   */
  notificationsSeenAt: number;
  /**
   * True once a newer build has been deployed while a session was live, so the
   * update banner offers a reload instead of taking one unasked.
   */
  updateAvailable: boolean;
  /**
   * Code for the reason the last connection attempt failed, resolved to
   * localized copy on the connect screen; `null` when there is no error to
   * show. User-cancelled device pickers never set this.
   */
  connectError: ConnectErrorCode | null;
  /**
   * The radio whose auto-reconnect ran out of attempts, surfaced on the connect
   * screen; `null` when the last session ended any other way. Outlives the
   * session reset that follows the give-up and the one a failed retry runs
   * through, and is cleared once a radio connects again or the user
   * disconnects deliberately.
   */
  lastConnectFailure: ConnectFailure | null;
  /**
   * Where the auto-reconnect loop is: the attempt it is waiting to start or
   * already running. `null` when no loop is in flight.
   */
  reconnectProgress: ReconnectProgress | null;
  view: AppView;
  /**
   * Whether this browser tab currently has focus. A conversation only counts
   * as being read when its tab is the one the user is looking at, so an
   * alt-tabbed window keeps accumulating unread messages.
   */
  windowFocused: boolean;
  /**
   * Conversation id of the room post feed currently rendered, or `null`. A
   * room shares its pane with the admin tabs and sits behind a login gate, so
   * unlike a chat it can be the open conversation while its feed is off
   * screen. Set by the view that renders the feed.
   */
  visibleRoomFeed: string | null;
  /**
   * True while the map is in location-pick mode (opened from the Location card
   * in Settings). Drives the map's confirm/cancel banner and click-to-place
   * marker; cleared by any navigation.
   */
  mapPicking: boolean;
  /**
   * Public-key prefix of a node the map should frame and open the popup for,
   * set when another page hands a node over to the map. Cleared by the next
   * {@link MeshActions.setView}, and {@link MapView} honors a given prefix only
   * once, so a popup the operator closed does not spring back open.
   */
  mapFocus: string | null;
  /**
   * A location the user just confirmed on the map, in decimal degrees, awaiting
   * consumption by the Location card. One-shot: cleared once read.
   */
  pendingLocation: { lat: number; lon: number } | null;
  /**
   * The view the map picker returns to once a coordinate is confirmed or the
   * pick is started — `settings` for the Settings location card, `chat` for a
   * repeater's config tab. Both reuse the one-shot {@link pendingLocation}.
   */
  locationPickReturn: AppView;
  managePanel: {
    kind: 'contact' | 'channel' | 'advert';
    id: string;
    share?: boolean;
  } | null;
  autoAddOpen: boolean;
  addChannelOpen: boolean;
  addContactOpen: boolean;
  /**
   * How many `ModalShell` dialogs are currently mounted. A count rather than a
   * flag because dialogs stack: the page behind them only becomes interactive
   * again once the last one closes.
   */
  openModals: number;
  advertising: boolean;
  /** Whether the global "Find Anything" command palette is open. */
  commandPaletteOpen: boolean;
  /**
   * A Settings section to scroll to and highlight after switching to the
   * settings view. One-shot: cleared by {@link SettingsPage} once consumed.
   */
  settingsSection: SettingsSection | null;

  // AI
  /**
   * Masked indicator of whether a BYO LLM API key is loaded this session and
   * whether it's persisted on this device. Never holds the key value itself.
   */
  aiKeyStatus: AiKeyStatus;

  // Automation (task 6.4)
  /** Master switch: while off, the engine is unsubscribed and fully inert. */
  automationEnabled: boolean;
  /** Per-radio automation rules, restored on connect and saved on change. */
  automationRules: AutomationRule[];
  /** Transmit/write actions awaiting human approval in the inbox. */
  stagedActions: StagedAction[];
  /** Append-only log of AI decisions (newest first, never the key). */
  auditLog: AuditEntry[];

  // Remote administration (task 7.3)
  /**
   * Per-repeater remote-admin sessions, keyed by the target's
   * `contact.pubkeyPrefix`. Ephemeral in-memory state (never persisted); reset
   * to `{}` on disconnect.
   */
  adminSessions: Record<string, AdminSession>;
  /**
   * The last telemetry reply from each node, keyed by `pubkeyPrefix`, so the
   * panel stays populated between refreshes instead of blanking. Ephemeral
   * in-memory state (never persisted); reset to `{}` on disconnect.
   */
  telemetry: Record<string, TelemetrySnapshot>;
}

interface MeshActions {
  setClient: (c: MeshCoreClient | null) => void;
  setStatus: (s: ConnectionStatus) => void;
  setDeviceName: (name: string) => void;
  setSelfInfo: (info: SelfInfo | null) => void;
  setDeviceInfo: (info: DeviceInfo | null) => void;
  setBattery: (b: BatteryInfo | null) => void;
  setSyncProgress: (p: SyncProgress | null) => void;
  /** Caches the device Stats-page snapshot so it survives leaving the view. */
  setDeviceStats: (s: StatsResult | null) => void;
  /** Caches the last-read device clock (epoch seconds) and its skew. */
  setDeviceClock: (c: { time: number; skew: number } | null) => void;
  /** Caches the Stats page's own battery snapshot (link-scoped, incl. null). */
  setDeviceBattery: (b: BatteryInfo | null) => void;
  setContacts: (c: Record<string, Contact>) => void;
  setChannels: (ch: Record<number, Channel>) => void;
  setAdverts: (a: Record<string, Advert>) => void;
  /** Folds freshly heard adverts into the in-memory advert cache. */
  cacheAdverts: (a: Record<string, Advert>) => void;
  /** Replaces the advert cache (from per-radio persistence on connect). */
  restoreAdvertCache: (cache: Record<string, Advert>) => void;
  setAutoAddConfig: (cfg: AutoAddConfig) => void;
  setContactView: (view: ContactView) => void;
  setLocale: (locale: SupportedLocale) => void;
  setTheme: (theme: Theme) => void;
  setUnitSystem: (unitSystem: UnitSystem) => void;
  setShowFullPublicKeys: (showFullPublicKeys: boolean) => void;
  setAiPref: (aiPref: AiPref) => void;
  setNotifyPref: (pref: NotifyPref) => void;
  setMapPrefs: (prefs: MapPrefs) => void;
  setMapFilters: (filters: MapFilters) => void;
  /**
   * Folds a decrypted per-radio preferences blob into the store, normalizing
   * every field so a corrupt or partial record falls back to defaults. See
   * {@link RadioPreferences}.
   *
   * @param explicit - true for a deliberate restore (a backup import), which
   * overrides the map viewport and filters the user touched this session.
   * False (the default) is connect-time hydration, where a pan made while the
   * blob was still loading is newer intent than the stored value and wins.
   */
  restorePreferences: (raw: unknown, explicit?: boolean) => void;
  addMessage: (id: string, msg: Message) => void;
  /**
   * Records the arrival the action bar's quick link points at, or retracts it
   * with `null` when its conversation stops being one the link may open — a
   * removed channel slot, which the radio can hand to an unrelated channel.
   */
  setLatestInbound: (latest: LatestInbound | null) => void;
  /** Reports whether the background message drain is still catching up. */
  setBacklogDraining: (draining: boolean) => void;
  updateMessage: (id: string, msgId: string, patch: Partial<Message>) => void;
  setActiveConvo: (convo: ActiveConvo | null) => void;
  setScrollToMsgId: (msgId: string | null) => void;
  /**
   * Freezes (or clears, with `null`) the "last unread" divider position for a
   * conversation.
   */
  setUnreadMarker: (id: string, msgId: string | null) => void;
  /**
   * Stores a conversation's unsent composer text, dropping the entry when the
   * draft is empty.
   */
  setDraft: (id: string, text: string) => void;
  markRead: (id: string) => void;
  /** Clears the unread flag on every conversation at once. */
  markAllRead: () => void;
  /**
   * Folds a persisted history back onto the live one, de-duplicating by message
   * id (the live copy of a shared id wins).
   *
   * @param interleave - order each merged conversation by timestamp instead of
   * placing every persisted message ahead of every live one. A reconnect
   * hydrate wants the default: its records are a strictly older prefix of the
   * same transcript, and arrival order is the more truthful ordering when a
   * sender's clock is skewed. A backup import wants `true` — a file from
   * another browser interleaves with what this one already holds.
   */
  restoreHistory: (
    persisted: Record<string, Message[]>,
    interleave?: boolean,
  ) => void;
  /**
   * The app's one notification entry point. Always announces to the
   * screen-reader regions; {@link NotifyInput.surface} decides whether it also
   * flashes a transient line in the action bar, keeps a drawer row, or both.
   *
   * @remarks Routing rule for a call site: a success the user asked for, next
   * to a control that can show its own ✓, raises nothing at all; one with no
   * such control takes `'none'`; a failure or anything that happened unasked
   * takes `'bar'`; and an event frequent enough to flood the bar takes
   * `'silent'`.
   */
  notify: (input: NotifyInput) => void;
  /**
   * Appends a row to the notification history. Reached only through
   * {@link MeshActions.notify} — a row pushed directly would skip the
   * screen-reader announcement every notice owes its reader.
   *
   * When `key` matches a row
   * already in the list the two collapse: that row's `count`, `at` and `seq`
   * are bumped and it moves back to the top, while its `id` is left alone, so
   * the row keeps one identity for its whole life and still reads as unread
   * again. Matching the whole list rather than only the newest row is what
   * keeps two people talking in one channel from alternating their way
   * through all 50 slots.
   *
   * @param key - dedup key; anything that identifies "the same event again".
   * It has to separate events a reader would not want conflated, so for a
   * message arrival that is the conversation *and* the rendered text.
   */
  pushNotification: (
    text: string,
    level: NotificationLevel,
    key: string,
    convo?: ActiveConvo,
  ) => void;
  /** Removes one row from the history; unknown ids are a no-op. */
  dismissNotification: (id: number) => void;
  /**
   * Drops every row aimed at one conversation. Opening that conversation is
   * the answer its rows were asking for, and a removed channel's rows would
   * otherwise jump to whatever channel reuses the slot.
   */
  dismissConvoNotifications: (convoId: string) => void;
  /** Empties the history. Does not reset the unread high-water mark. */
  clearNotifications: () => void;
  /** Marks every current row read, clearing the bell badge but keeping rows. */
  markNotificationsSeen: () => void;
  /** Raises (or dismisses) the "new version deployed" update banner. */
  setUpdateAvailable: (available: boolean) => void;
  /** Sets (or clears, with `null`) the inline connect-screen error code. */
  setConnectError: (code: ConnectErrorCode | null) => void;
  /** Records (or clears, with `null`) the radio auto-reconnect gave up on. */
  setLastConnectFailure: (failure: ConnectFailure | null) => void;
  /** Reports (or clears, with `null`) the current reconnect-loop position. */
  setReconnectProgress: (progress: ReconnectProgress | null) => void;
  setView: (view: AppView) => void;
  /** Records whether this browser tab has focus. */
  setWindowFocused: (focused: boolean) => void;
  setVisibleRoomFeed: (convoId: string | null) => void;
  /** Opens the map to pick a location, returning to `returnTo` on confirm. */
  startLocationPick: (returnTo?: AppView) => void;
  /** Confirms the picked coordinate (degrees) and returns to the caller. */
  confirmLocationPick: (lat: number, lon: number) => void;
  /** Aborts location picking without a result, staying on the map. */
  cancelLocationPick: () => void;
  /** Opens the map framed on one node, with its popup open. */
  showNodeOnMap: (pubkeyPrefix: string) => void;
  /** Clears the one-shot {@link MeshState.pendingLocation} after it's read. */
  clearPendingLocation: () => void;
  setManagePanel: (
    panel: {
      kind: 'contact' | 'channel' | 'advert';
      id: string;
      /** Open a contact straight on its share sub-page. */
      share?: boolean;
    } | null,
  ) => void;
  setAutoAddOpen: (open: boolean) => void;
  setAddChannelOpen: (open: boolean) => void;
  setAddContactOpen: (open: boolean) => void;
  /** Registers a mounted dialog, making the page behind it inert. */
  pushModal: () => void;
  /** Drops a dialog's registration as it unmounts. */
  popModal: () => void;
  setAdvertising: (advertising: boolean) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  /** Switches to the settings view, deep-linking to a specific section card. */
  openSettingsSection: (section: SettingsSection) => void;
  clearSettingsSection: () => void;
  closeConnectionOverlays: () => void;
  /** Updates the masked AI key indicator (never the value). */
  setAiKeyStatus: (status: AiKeyStatus) => void;
  /** Flips the automation master switch. */
  setAutomationEnabled: (enabled: boolean) => void;
  /** Replaces the rule set (from per-radio persistence on connect). */
  restoreAutomationRules: (rules: AutomationRule[]) => void;
  addAutomationRule: (rule: AutomationRule) => void;
  updateAutomationRule: (id: string, patch: Partial<AutomationRule>) => void;
  removeAutomationRule: (id: string) => void;
  /** Queues a transmit/write action for human approval. */
  stageAction: (action: StagedAction) => void;
  /** Removes a staged action once approved or denied. */
  resolveStagedAction: (id: string) => void;
  /** Appends an audit record (newest first, capped). */
  addAuditEntry: (entry: AuditEntry) => void;
  clearAuditLog: () => void;
  /** Kill switch: disable the master switch and clear the staged queue. */
  killSwitch: () => void;

  /** Sets a repeater admin session's login state (creates it if new). */
  setAdminLogin: (prefix: string, login: AdminLoginState) => void;
  /** Stores the latest decoded status for a repeater's admin session. */
  /**
   * Records a repeater's status reply against its admin session, stamping
   * {@link AdminSession.statusAt}.
   *
   * @param token - the {@link AdminSession.token} the request was issued
   * under; the reply is dropped when the session has since been replaced.
   */
  setRepeaterStatus: (
    prefix: string,
    status: RepeaterStatus,
    token?: number,
  ) => void;
  /**
   * Caches the last-read neighbors list for a repeater's admin session.
   *
   * @param token - the {@link AdminSession.token} the read was issued under;
   *   the result is dropped when the session has since been replaced.
   */
  setRepeaterNeighbors: (
    prefix: string,
    neighbors: Neighbor[],
    token?: number,
  ) => void;
  /**
   * Caches the last-read access control list for a node's admin session.
   *
   * @param token - as {@link MeshActions.setRepeaterNeighbors}, and more
   *   load-bearing here: only an admin may read this list, so a reply landing
   *   in a session that replaced the one which asked must not be kept.
   */
  setRepeaterAccessList: (
    prefix: string,
    entries: AclEntry[],
    token?: number,
  ) => void;
  /**
   * Marks a node's cached access list as not confirmed by the latest attempt.
   *
   * @param token - as {@link MeshActions.setRepeaterAccessList}.
   */
  setRepeaterAccessStale: (prefix: string, token?: number) => void;
  /**
   * Marks a repeater's cached neighbors list as not confirmed by the latest
   * attempt.
   *
   * @param token - as {@link MeshActions.setRepeaterNeighbors}.
   */
  setRepeaterNeighborsStale: (prefix: string, token?: number) => void;
  /** Merges loaded/confirmed Config values into a repeater's session cache. */
  mergeRepeaterConfig: (prefix: string, patch: Record<string, string>) => void;
  /** Appends one line to a repeater's CLI transcript, capped to the newest. */
  appendCliLine: (prefix: string, line: CliLine) => void;
  /**
   * Records a command the user submitted at a repeater's console into its
   * ↑/↓ history. A repeat of the newest entry is folded into it rather than
   * stored twice, so re-running one command doesn't push the rest out.
   */
  pushCliHistory: (prefix: string, cmd: string) => void;
  /**
   * Adjusts a repeater's outstanding CLI command count by {@link delta} (`1`
   * when one is enqueued, `-1` when it settles). Applied only while the
   * session the command was issued under is still current, so a request that
   * settles after a logout can't zero a replacement session's count. Clamped
   * at zero.
   */
  addCliPending: (
    prefix: string,
    delta: number,
    token: number | undefined,
  ) => void;
  /** Clears a repeater's CLI transcript, leaving the session intact. */
  clearCliLog: (prefix: string) => void;
  /** Drops a repeater's admin session entirely (e.g. on log out). */
  resetAdminSession: (prefix: string) => void;
  /** Caches a node's decoded telemetry reply, stamped with the read time. */
  setNodeTelemetry: (prefix: string, readings: TelemetryReading[]) => void;
  reset: () => void;
}

const initialState: MeshState = {
  client: null,
  status: 'disconnected',
  deviceName: '',
  selfInfo: null,
  deviceInfo: null,
  battery: null,
  syncProgress: null,
  deviceStats: null,
  prevDeviceStats: null,
  deviceStatsAt: null,
  deviceClock: null,
  deviceBattery: null,
  contacts: {},
  channels: {},
  adverts: {},
  advertCache: {},
  autoAddConfig: DEFAULT_AUTOADD_CONFIG,
  msgHistory: {},
  lastArrival: null,
  latestInbound: null,
  backlogDraining: false,
  lastAppends: {},
  activeConvo: null,
  convoOpenSeq: 0,
  scrollToMsgId: null,
  unreadMarkers: {},
  drafts: {},
  contactView: DEFAULT_CONTACT_VIEW,
  locale: resolveInitialLocale(),
  theme: resolveInitialTheme(),
  unitSystem: DEFAULT_UNIT_SYSTEM,
  showFullPublicKeys: false,
  aiPref: DEFAULT_AI_PREF,
  notifyPref: DEFAULT_NOTIFY_PREF,
  mapPrefs: null,
  mapFilters: DEFAULT_MAP_FILTERS,
  prefsHydrated: false,
  notice: null,
  barNotice: null,
  notifications: [],
  notificationsSeenAt: 0,
  updateAvailable: false,
  connectError: null,
  lastConnectFailure: null,
  reconnectProgress: null,
  view: 'chat',
  windowFocused: true,
  visibleRoomFeed: null,
  mapPicking: false,
  mapFocus: null,
  pendingLocation: null,
  locationPickReturn: 'settings',
  managePanel: null,
  autoAddOpen: false,
  addChannelOpen: false,
  addContactOpen: false,
  openModals: 0,
  advertising: false,
  commandPaletteOpen: false,
  settingsSection: null,
  aiKeyStatus: 'none',
  automationEnabled: false,
  automationRules: [],
  stagedActions: [],
  auditLog: [],
  adminSessions: {},
  telemetry: {},
};

let noticeSeq = 0;
let notificationSeq = 0;

/** How many notification rows the drawer keeps before dropping the oldest. */
const NOTIFICATION_LIMIT = 50;

/**
 * How long the action bar holds a transient line before dropping it. The
 * `.notice-line` animation in `app/globals.css` runs for exactly this long, so
 * the line finishes fading as it leaves the DOM rather than blinking out
 * mid-fade; the two have to move together.
 */
const BAR_NOTICE_MS = 4000;

// Whether the *user* has moved the map since the current session began
// hydrating. `restorePreferences` may only carry a live `mapPrefs` over the
// stored one when this is set: a reconnect doesn't reset the store and can
// come back as a different radio on a shared endpoint, so an untouched value
// is the previous radio's viewport and must not survive into this one's blob.
let mapPrefsTouched = false;
// The same rule for the map's filters, but per field: the controls are spread
// across two legends, so a user who moves one slider before the blob lands must
// not have that stand in for the whole object and discard the incoming radio's
// saved categories and favorites.
const mapFiltersTouched = new Set<keyof MapFilters>();

/**
 * The global Zustand store: connection state, mirrored mesh data, conversation
 * history, and UI flags. All mutations go through the actions defined here —
 * components subscribe to slices and re-render on change.
 */
export const useMeshStore = create<MeshState & MeshActions>((set, get) => ({
  ...initialState,

  setClient: (client) => set({ client }),
  // Every transition that can uncover the open conversation runs the catch-up,
  // or a message drained behind a reconnect overlay (or a dialog) stays unread
  // with no divider until something unrelated happens to fire it.
  setStatus: (status) => {
    // A reconnect re-runs the hydrate, so the next blob has to be able to
    // announce itself again to anything waiting on it — and the viewport the
    // last radio left behind stops counting as something to preserve.
    if (status === 'connecting' || status === 'reconnecting') {
      mapPrefsTouched = false;
      mapFiltersTouched.clear();
    }
    set(
      status === 'connecting' || status === 'reconnecting'
        ? { status, prefsHydrated: false }
        : { status },
    );
    if (status === 'connected') catchUpVisibleConvo();
  },
  setDeviceName: (deviceName) => set({ deviceName }),
  setSelfInfo: (selfInfo) => set({ selfInfo }),
  setDeviceInfo: (deviceInfo) => set({ deviceInfo }),
  setBattery: (battery) => set({ battery }),
  setSyncProgress: (syncProgress) => set({ syncProgress }),
  setDeviceStats: (deviceStats) =>
    set((state) => ({
      deviceStats,
      // A null write ends the link session, so there is nothing to compare to.
      prevDeviceStats: deviceStats ? state.deviceStats : null,
      deviceStatsAt: deviceStats ? Math.floor(Date.now() / 1000) : null,
    })),
  setDeviceClock: (deviceClock) => set({ deviceClock }),
  setDeviceBattery: (deviceBattery) => set({ deviceBattery }),
  setContacts: (contacts) => set({ contacts }),
  setChannels: (channels) => set({ channels }),
  setAdverts: (adverts) => set({ adverts }),

  cacheAdverts: (adverts) =>
    set((state) => ({
      advertCache: mergeAdvertCache(state.advertCache, adverts),
    })),

  restoreAdvertCache: (cache) => set({ advertCache: cache }),

  setAutoAddConfig: (autoAddConfig) => set({ autoAddConfig }),

  setContactView: (contactView) => set({ contactView }),

  setLocale: (locale) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {}
      document.documentElement.lang = locale;
    }
    void i18n.changeLanguage(locale);
    set({ locale });
  },

  setMapPrefs: (mapPrefs) => {
    mapPrefsTouched = true;
    set({ mapPrefs });
  },

  setMapFilters: (mapFilters) => {
    const prev = get().mapFilters;
    for (const key of MAP_FILTER_KEYS) {
      if (mapFilters[key] !== prev[key]) mapFiltersTouched.add(key);
    }
    set({ mapFilters });
  },

  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {}
      document.documentElement.dataset.theme = theme;
    }
    set({ theme });
  },

  setUnitSystem: (unitSystem) => set({ unitSystem }),

  setShowFullPublicKeys: (showFullPublicKeys) => set({ showFullPublicKeys }),

  setAiPref: (aiPref) => set({ aiPref }),

  setNotifyPref: (notifyPref) => set({ notifyPref }),

  restorePreferences: (raw, explicit = false) => {
    const p = (
      typeof raw === 'object' && raw !== null ? raw : {}
    ) as Partial<RadioPreferences>;
    // A pan made while this blob was still loading is newer intent than the
    // stored viewport, and is the value the debounced save is about to write
    // back, so it wins. It has to win at the source rather than in `MapView`,
    // which may have unmounted before the read finished and so can't put it
    // back itself. Only *this* session's move counts: the store isn't reset
    // between reconnects, and the radio that comes back may not be the one
    // that left.
    // Those guards exist for the *hydrate* race only. An explicit import is a
    // deliberate act on a settled session, and the preview told the user the
    // file's preferences replace theirs — so it clears the touched marks and
    // lets every field come from the blob.
    const keepMapPrefs = explicit ? false : mapPrefsTouched;
    mapPrefsTouched = false;
    const keptFilters = explicit
      ? new Set<keyof MapFilters>()
      : new Set(mapFiltersTouched);
    mapFiltersTouched.clear();
    const storedFilters = normalizeMapFilters(p.mapFilters);
    set((state) => ({
      unitSystem: normalizeUnitSystem(p.unitSystem),
      contactView: normalizeContactView(p.contactView),
      autoAddConfig: normalizeAutoAddConfig(p.autoAddConfig),
      automationEnabled:
        typeof p.automationEnabled === 'boolean' ? p.automationEnabled : false,
      mapPrefs: keepMapPrefs ? state.mapPrefs : normalizeMapPrefs(p.mapPrefs),
      // Field by field, so an untouched one still adopts this radio's stored
      // value instead of inheriting the default (or the last radio's choice).
      mapFilters: {
        favoritesOnly: keptFilters.has('favoritesOnly')
          ? state.mapFilters.favoritesOnly
          : storedFilters.favoritesOnly,
        categories: keptFilters.has('categories')
          ? state.mapFilters.categories
          : storedFilters.categories,
        heardWithinDays: keptFilters.has('heardWithinDays')
          ? state.mapFilters.heardWithinDays
          : storedFilters.heardWithinDays,
      },
      aiPref: normalizeAiPref(p.aiPref),
      notifyPref: normalizeNotifyPref(p.notifyPref),
      showFullPublicKeys:
        typeof p.showFullPublicKeys === 'boolean'
          ? p.showFullPublicKeys
          : false,
      prefsHydrated: true,
    }));
  },

  addMessage: (id, msg) =>
    set((state) => {
      const prev = state.msgHistory[id] ?? [];
      const visible = isConvoVisible(state, id);
      const enriched: Message = {
        ...msg,
        id: msg.id ?? crypto.randomUUID(),
        // Only inbound traffic can be unread: an automation's own send lands
        // in a conversation the user isn't looking at, and a system note is
        // not something to come back to.
        _unread: !visible && !msg.own && !msg.system,
      };
      // The frame parser hands over a whole input chunk at once, so an
      // off-screen frame can land in the same tick as an on-screen one. Only
      // an on-screen arrival may displace another on-screen arrival, or the
      // announcement for the one the user is looking at is lost.
      const keepArrival =
        enriched.own || (!visible && (state.lastArrival?.visible ?? false));
      return {
        msgHistory: { ...state.msgHistory, [id]: [...prev, enriched] },
        lastAppends: {
          ...state.lastAppends,
          [id]: { msgId: enriched.id as string, visible },
        },
        // An own send has nothing to announce and must not displace an inbound
        // arrival the announcer hasn't rendered yet.
        lastArrival: keepArrival
          ? state.lastArrival
          : {
              convoId: id,
              msgId: enriched.id as string,
              text: enriched.text,
              senderName: enriched.senderName,
              own: false,
              system: enriched.system ?? false,
              visible,
            },
      };
    }),

  setLatestInbound: (latestInbound) => set({ latestInbound }),

  setBacklogDraining: (backlogDraining) => set({ backlogDraining }),

  updateMessage: (id, msgId, patch) =>
    set((state) => {
      const msgs = state.msgHistory[id];
      if (!msgs) return {};
      return {
        msgHistory: {
          ...state.msgHistory,
          [id]: msgs.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
        },
      };
    }),

  setActiveConvo: (activeConvo) =>
    set((s) => ({ activeConvo, convoOpenSeq: s.convoOpenSeq + 1 })),

  setScrollToMsgId: (scrollToMsgId) => set({ scrollToMsgId }),

  setUnreadMarker: (id, msgId) =>
    set((state) => {
      const next = { ...state.unreadMarkers };
      if (msgId) next[id] = msgId;
      else delete next[id];
      return { unreadMarkers: next };
    }),

  setDraft: (id, text) =>
    set((state) => {
      if ((state.drafts[id] ?? '') === text) return {};
      const drafts = { ...state.drafts };
      if (text) drafts[id] = text;
      else delete drafts[id];
      return { drafts };
    }),

  restoreHistory: (persisted, interleave = false) =>
    set((state) => {
      // Prepend persisted messages before any newly-polled messages (old → new
      // order).
      const merged: Record<string, Message[]> = {};
      const allKeys = new Set([
        ...Object.keys(persisted),
        ...Object.keys(state.msgHistory),
      ]);
      for (const id of allKeys) {
        const current = state.msgHistory[id] ?? [];
        // A single id set drives both jobs. Claim current's ids first so the
        // live copy stays authoritative: a reconnect flushes the live history
        // and then restores that same data back onto the still-in-memory list,
        // and any id already present in `current` keeps the live copy.
        // Deduping `current` first also heals duplicate ids an older build may
        // have persisted within one list (first occurrence wins).
        const seen = new Set<string>();
        const keptCurrent = current.filter((m) => {
          if (m.id !== undefined && seen.has(m.id)) return false;
          if (m.id !== undefined) seen.add(m.id);
          return true;
        });
        // Persisted messages, normalized: assign ids predating the field,
        // downgrade a never-confirmed in-flight send, clear unread. Drop any id
        // already claimed by `current` (or duplicated within the persisted
        // list) so the persisted copy never collides with the live one.
        const old = (persisted[id] ?? [])
          .map((m) => ({
            ...m,
            id: m.id ?? crypto.randomUUID(),
            status: inFlightOnRestore(m) ? ('failed' as const) : m.status,
            _unread: false,
          }))
          .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
        const list = [...old, ...keptCurrent];
        merged[id] = interleave ? byTimestamp(list) : list;
      }
      return { msgHistory: merged };
    }),

  markRead: (id) =>
    set((state) => {
      const msgs = state.msgHistory[id];
      if (!msgs) return {};
      return {
        msgHistory: {
          ...state.msgHistory,
          [id]: msgs.map((m) => ({ ...m, _unread: false })),
        },
      };
    }),

  markAllRead: () =>
    set((state) => {
      const next: Record<string, Message[]> = {};
      let cleared = false;
      for (const [id, msgs] of Object.entries(state.msgHistory)) {
        if (!msgs.some((m) => m._unread)) {
          next[id] = msgs;
          continue;
        }
        next[id] = msgs.map((m) => (m._unread ? { ...m, _unread: false } : m));
        cleared = true;
      }
      // Nothing was unread: returning the same object keeps every subscriber
      // (the title, the sidebar badges) from re-running for no change.
      return cleared ? { msgHistory: next } : {};
    }),

  notify: ({ level, text, key, convo, surface = 'bar' }) => {
    const id = ++noticeSeq;
    const notice: Notice = { id, level, text };
    // The line only exists while the action bar does, so a notice raised
    // outside a live session must not claim the slot: it would either never
    // be painted, or be painted into the *next* session on a fresh animation
    // that its already-running timer then cuts off mid-fade. Both the connect
    // catch-up summary (raised from a callback while the status is still
    // 'connecting') and the Disconnect sign-off (raised after the teardown)
    // land in exactly that window.
    const line = surface !== 'silent' && get().status === 'connected';
    // The line is the glance and the drawer is the record, but the announcer
    // is neither optional nor conditional: a badge that only changes count
    // and a line that only fades say nothing to a screen reader.
    set(line ? { notice, barNotice: notice } : { notice });
    if (surface !== 'none') get().pushNotification(text, level, key, convo);
    if (!line) return;
    // The line always ages out on its own; it carries no dismiss control,
    // because anything worth clearing by hand is a drawer row instead.
    setTimeout(() => {
      if (get().barNotice?.id === id) set({ barNotice: null });
    }, BAR_NOTICE_MS);
  },

  pushNotification: (text, level, key, convo) =>
    set((state) => {
      const at = Math.floor(Date.now() / 1000);
      const seq = ++notificationSeq;
      const index = state.notifications.findIndex((n) => n.key === key);
      // A merge keeps the row's `id` — the drawer keys on it, and a fresh one
      // would remount the row and drop the keyboard focus a reader may be
      // holding on its buttons — but still takes the new `seq`, or a repeat
      // of an already-read event would never light the bell again.
      if (index >= 0) {
        const prev = state.notifications[index];
        const merged: Notification = {
          ...prev,
          seq,
          text,
          level,
          at,
          convo,
          count: prev.count + 1,
        };
        const rest = state.notifications.filter((_, i) => i !== index);
        return { notifications: [merged, ...rest] };
      }
      const row: Notification = {
        id: seq,
        seq,
        level,
        text,
        at,
        convo,
        count: 1,
        key,
      };
      return {
        notifications: [row, ...state.notifications].slice(
          0,
          NOTIFICATION_LIMIT,
        ),
      };
    }),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  dismissConvoNotifications: (convoId) =>
    set((state) => {
      const kept = state.notifications.filter((n) => n.convo?.id !== convoId);
      // Every conversation selection runs through here, and most match
      // nothing. Returning the same array keeps the drawer and the bell badge
      // from re-rendering for a filter that changed nothing.
      return kept.length === state.notifications.length
        ? {}
        : { notifications: kept };
    }),

  clearNotifications: () => set({ notifications: [] }),

  // The sequence, not the newest row's id: dismissing the top row must not
  // walk the high-water mark back down.
  markNotificationsSeen: () => set({ notificationsSeenAt: notificationSeq }),

  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
  setConnectError: (code) => set({ connectError: code }),

  setLastConnectFailure: (lastConnectFailure) => set({ lastConnectFailure }),

  setReconnectProgress: (reconnectProgress) => set({ reconnectProgress }),
  // Any manual tab switch also aborts an in-progress location pick, and drops
  // a node handover that never reached the map.
  setView: (view) => {
    set({ view, mapPicking: false, mapFocus: null, settingsSection: null });
    catchUpVisibleConvo();
  },
  setWindowFocused: (windowFocused) => {
    set({ windowFocused });
    if (windowFocused) catchUpVisibleConvo();
  },
  setVisibleRoomFeed: (visibleRoomFeed) => {
    if (get().visibleRoomFeed === visibleRoomFeed) return;
    set({ visibleRoomFeed });
    // Revealing the feed is the moment its backlog becomes seen, the same way
    // refocusing the tab is for a chat.
    if (visibleRoomFeed) catchUpVisibleConvo();
  },
  startLocationPick: (returnTo = 'settings') =>
    set({ mapPicking: true, view: 'map', locationPickReturn: returnTo }),
  confirmLocationPick: (lat, lon) => {
    set((s) => ({
      mapPicking: false,
      view: s.locationPickReturn,
      pendingLocation: { lat, lon },
    }));
    catchUpVisibleConvo();
  },
  cancelLocationPick: () => set({ mapPicking: false }),
  // `setView` clears any previous handover (and runs the view-switch side
  // effects), so the new target is written after it rather than alongside.
  showNodeOnMap: (mapFocus) => {
    get().setView('map');
    set({ mapFocus });
  },
  clearPendingLocation: () => set({ pendingLocation: null }),
  setManagePanel: (managePanel) => set({ managePanel }),
  setAutoAddOpen: (autoAddOpen) => set({ autoAddOpen }),
  setAddChannelOpen: (addChannelOpen) => set({ addChannelOpen }),
  setAddContactOpen: (addContactOpen) => set({ addContactOpen }),
  pushModal: () => set((s) => ({ openModals: s.openModals + 1 })),
  // Clamped at zero: a disconnect resets the count while dialogs are still
  // mounted, and their unmount then pops a counter that is already back to 0.
  popModal: () => {
    set((s) => ({ openModals: Math.max(0, s.openModals - 1) }));
    // The last dialog closing uncovers the conversation behind it.
    if (get().openModals === 0) catchUpVisibleConvo();
  },
  setAdvertising: (advertising) => set({ advertising }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openSettingsSection: (settingsSection) =>
    set({
      view: 'settings',
      mapPicking: false,
      mapFocus: null,
      settingsSection,
    }),
  clearSettingsSection: () => set({ settingsSection: null }),
  // Closes every connection-scoped overlay/panel at once. Called when the link
  // drops so a panel left open doesn't silently reappear once reconnect
  // remounts the connected UI. Resetting `view` to 'chat' also drops the Stats
  // and Settings pages.
  closeConnectionOverlays: () =>
    set({
      view: 'chat',
      mapPicking: false,
      mapFocus: null,
      pendingLocation: null,
      locationPickReturn: 'settings',
      managePanel: null,
      autoAddOpen: false,
      addChannelOpen: false,
      addContactOpen: false,
      commandPaletteOpen: false,
      settingsSection: null,
    }),

  setAiKeyStatus: (aiKeyStatus) => set({ aiKeyStatus }),

  setAutomationEnabled: (automationEnabled) => set({ automationEnabled }),
  restoreAutomationRules: (automationRules) => set({ automationRules }),
  addAutomationRule: (rule) =>
    set((state) => ({ automationRules: [...state.automationRules, rule] })),
  updateAutomationRule: (id, patch) =>
    set((state) => ({
      automationRules: state.automationRules.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    })),
  removeAutomationRule: (id) =>
    set((state) => ({
      automationRules: state.automationRules.filter((r) => r.id !== id),
      // Drop any pending approvals for a rule the user just deleted.
      stagedActions: state.stagedActions.filter((a) => a.ruleId !== id),
    })),
  stageAction: (action) =>
    set((state) => ({ stagedActions: [...state.stagedActions, action] })),
  resolveStagedAction: (id) =>
    set((state) => ({
      stagedActions: state.stagedActions.filter((a) => a.id !== id),
    })),
  addAuditEntry: (entry) =>
    set((state) => ({
      auditLog: [entry, ...state.auditLog].slice(0, AUDIT_LOG_LIMIT),
    })),
  clearAuditLog: () => set({ auditLog: [] }),
  killSwitch: () => {
    // The kill switch disarms automation for good, not just this session.
    set({ automationEnabled: false, stagedActions: [] });
  },

  setAdminLogin: (prefix, login) =>
    set((state) => {
      const session = state.adminSessions[prefix] ?? {
        login,
        cli: [],
        token: nextAdminSessionToken(),
      };
      const next: AdminSession = { ...session, login };
      // The role can change without the token doing so, and the access list is
      // the one cached read that requires `admin`. Dropping it on the way out
      // is what makes the next admin login read the node again rather than show
      // the previous login's copy: the tab skips its automatic read whenever a
      // list is already cached, so leaving it would outlive the session that
      // earned it.
      if (login !== 'admin') {
        delete next.accessList;
        delete next.accessListStale;
      }
      return {
        adminSessions: { ...state.adminSessions, [prefix]: next },
      };
    }),
  setRepeaterStatus: (prefix, status, token) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Status belongs to a live, authenticated session. If a late reply lands
    // after log-out (session gone) or before login completes, drop it rather
    // than resurrecting a logged-out session with stale status that would then
    // leak into the next login. A reply whose issuing session has since been
    // replaced by a re-login is dropped for the same reason: it is not this
    // session's status, and `statusAt` would date it to now. Return before
    // `set` so no listeners are woken.
    if (!isAuthedLogin(session?.login)) return;
    if (token !== undefined && session?.token !== token) return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: {
          ...session,
          status,
          statusAt: Math.floor(Date.now() / 1000),
        },
      },
    });
  },
  setRepeaterNeighbors: (prefix, neighbors, token) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Neighbors belong to the live, authenticated session that asked for them.
    // Drop a late reply that lands after log-out or before login completes, and
    // one issued under a session since replaced by a log-out and re-login —
    // matching setRepeaterStatus. A structured read walks several pages, so
    // that window is wide enough to hit in practice.
    if (!isAuthedLogin(session?.login)) return;
    if (token !== undefined && session?.token !== token) return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, neighbors, neighborsStale: false },
      },
    });
  },
  setRepeaterNeighborsStale: (prefix, token) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Same gate as the rows the flag describes.
    if (!isAuthedLogin(session?.login)) return;
    if (token !== undefined && session?.token !== token) return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, neighborsStale: true },
      },
    });
  },
  setRepeaterAccessList: (prefix, entries, token) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Only an admin may read this list, so only an admin session may hold it.
    // `isAuthedLogin` is not enough on two counts: it accepts guest and
    // readWrite, and `setAdminLogin` can drop an existing session to one of
    // those *without* minting a new token — so the role must be checked as well
    // as the token, or a demoted session keeps the rows its predecessor earned.
    if (session?.login !== 'admin') return;
    if (token !== undefined && session.token !== token) return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, accessList: entries, accessListStale: false },
      },
    });
  },
  setRepeaterAccessStale: (prefix, token) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Same gate as setRepeaterAccessList: the flag describes those rows.
    if (session?.login !== 'admin') return;
    if (token !== undefined && session.token !== token) return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, accessListStale: true },
      },
    });
  },
  appendCliLine: (prefix, line) =>
    set((state) => {
      const session = state.adminSessions[prefix] ?? {
        login: 'loggedOut',
        cli: [],
        token: nextAdminSessionToken(),
      };
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: {
            ...session,
            cli: [...session.cli, line].slice(-CLI_LOG_LIMIT),
          },
        },
      };
    }),
  pushCliHistory: (prefix, cmd) =>
    set((state) => {
      const session = state.adminSessions[prefix];
      // No session means no console to have typed at; a history entry would
      // have nowhere to live and nothing to clear it.
      if (!session) return {};
      const history = session.cliHistory ?? [];
      if (history[history.length - 1] === cmd) return {};
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: {
            ...session,
            cliHistory: [...history, cmd].slice(-CLI_HISTORY_LIMIT),
          },
        },
      };
    }),
  addCliPending: (prefix, delta, token) =>
    set((state) => {
      const session = state.adminSessions[prefix];
      // A session that was logged out or replaced took its count with it, so a
      // command issued under it has nothing left to adjust.
      if (!session || session.token !== token) return {};
      const cliPending = Math.max(0, (session.cliPending ?? 0) + delta);
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: { ...session, cliPending },
        },
      };
    }),
  mergeRepeaterConfig: (prefix, patch) =>
    set((state) => {
      const session = state.adminSessions[prefix] ?? {
        login: 'loggedOut',
        cli: [],
        token: nextAdminSessionToken(),
      };
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: {
            ...session,
            config: { ...(session.config ?? {}), ...patch },
          },
        },
      };
    }),
  clearCliLog: (prefix) =>
    set((state) => {
      const session = state.adminSessions[prefix];
      if (!session) return {};
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: { ...session, cli: [] },
        },
      };
    }),
  resetAdminSession: (prefix) =>
    set((state) => {
      if (!(prefix in state.adminSessions)) return {};
      const adminSessions = { ...state.adminSessions };
      delete adminSessions[prefix];
      return { adminSessions };
    }),

  setNodeTelemetry: (prefix, readings) =>
    set((state) => ({
      telemetry: {
        ...state.telemetry,
        // This computer's clock, not the node's: the reply carries no
        // timestamp of its own, and the panel only ages it relatively.
        [prefix]: { readings, readAt: Math.floor(Date.now() / 1000) },
      },
    })),

  reset: () =>
    set({
      ...initialState,
      // The deployed build doesn't change with the radio, so a pending update
      // outlives the session it was noticed in.
      updateAvailable: get().updateAvailable,
      // Locale is a global (pre-connect) preference kept in localStorage, not
      // per-radio session state.
      locale: get().locale,
      // Theme is a global (pre-connect) preference kept in localStorage, not
      // per-radio session state.
      theme: get().theme,
      // The connect screen's give-up notice describes a session that is
      // already gone, so it has to outlive this reset — including the one a
      // failed retry runs through. Cleared on a successful connect, and
      // explicitly by a deliberate Disconnect.
      lastConnectFailure: get().lastConnectFailure,
      // A browser-window fact, not a session one: the tab is just as focused
      // after a disconnect as it was before.
      windowFocused: get().windowFocused,
      // Every other preference is per-radio (encrypted in IndexedDB) and
      // reloaded on the next connect, so it resets to defaults here.
    }),
}));

// A restored message whose delivery was still open when the tab went away. ACK
// tracking and the retry cycle are module state in `useMeshCore` and do not
// survive a reload, so nothing will ever settle these — a direct message left
// awaiting an ACK would otherwise sit at 'sent' forever. Channel sends settle
// at 'sent' by design (no receipts), so only a direct one is downgraded.
function inFlightOnRestore(msg: Message): boolean {
  return (
    msg.status === 'sending' || (msg.kind === 'direct' && msg.status === 'sent')
  );
}

// Orders a merged conversation chronologically, for the backup import: a file
// from another browser holds messages both older and newer than the live ones,
// and the chat's date dividers and sender grouping read adjacent entries, so an
// unordered list renders repeated day headers and broken groups. A message with
// no timestamp (they predate the field) inherits the one before it, keeping it
// beside the neighbors it was stored with instead of collapsing to the top;
// `sort` is stable, so equal keys hold the merge's own order.
function byTimestamp(msgs: Message[]): Message[] {
  let last = 0;
  return msgs
    .map((msg) => {
      if (msg.timestamp !== undefined) last = msg.timestamp;
      return { msg, at: last };
    })
    .sort((a, b) => a.at - b.at)
    .map((k) => k.msg);
}

/** Counts unread messages in one conversation. */
export function unreadCount(
  msgHistory: Record<string, Message[]>,
  id: string,
): number {
  return (msgHistory[id] ?? []).filter((m) => m._unread).length;
}

/**
 * Extracts the per-radio {@link RadioPreferences} slice from the store state,
 * for encrypting into the preferences blob. See `savePreferences` in
 * `lib/storage.ts` and the save subscription in `useMeshCore`.
 */
export function selectPreferences(
  state: MeshState & MeshActions,
): RadioPreferences {
  return {
    unitSystem: state.unitSystem,
    contactView: state.contactView,
    autoAddConfig: state.autoAddConfig,
    automationEnabled: state.automationEnabled,
    mapPrefs: state.mapPrefs,
    mapFilters: state.mapFilters,
    aiPref: state.aiPref,
    notifyPref: state.notifyPref,
    showFullPublicKeys: state.showFullPublicKeys,
  };
}

/**
 * Whether a session is active — a live link or one being auto-restored — and so
 * the chat UI / device row stays mounted instead of the connect screen. Shared
 * so the header and shell can't disagree about what counts as active.
 */
export function isActiveStatus(status: ConnectionStatus): boolean {
  return status === 'connected' || status === 'reconnecting';
}

/** Selects a conversation, marking it read only when it is visible. */
export function openConvo(convo: ActiveConvo): void {
  const { setActiveConvo, markRead, setUnreadMarker, msgHistory } =
    useMeshStore.getState();
  setActiveConvo(convo);
  if (!isConvoVisible(useMeshStore.getState(), convo.id)) return;
  // Freeze the "last unread" divider at the first unread message before
  // markRead clears the flags, so the boundary the user left off at stays
  // visible for this viewing.
  const firstUnread = (msgHistory[convo.id] ?? []).find((m) => m._unread);
  setUnreadMarker(convo.id, firstUnread?.id ?? null);
  markRead(convo.id);
  // The drawer's rows for this conversation were asking to be opened; they
  // just have been.
  useMeshStore.getState().dismissConvoNotifications(convo.id);
}

/**
 * Whether conversation {@link id} is actually on screen: it is the open
 * conversation, the chat view is the one showing, this tab has focus, the link
 * is live (a reconnect overlay covers and inerts the app), and no dialog is
 * over it. Messages arriving in a visible conversation are read on arrival and
 * raise no notification; everything else is unread and worth announcing.
 */
export function isConvoVisible(state: MeshState, id: string): boolean {
  return (
    state.status === 'connected' &&
    state.openModals === 0 &&
    state.activeConvo?.id === id &&
    state.view === 'chat' &&
    state.windowFocused &&
    // Selecting a room is not enough: its feed is one tab of a pane that also
    // holds the admin surfaces, and is hidden entirely until the login lands.
    (state.activeConvo.kind !== 'room' || state.visibleRoomFeed === id)
  );
}

/**
 * Clears the unread backlog the open conversation built up while it was out of
 * sight, freezing the divider at the boundary first. No-op when nothing is
 * unread, so an existing divider survives an idle tab switch.
 */
function catchUpVisibleConvo(): void {
  const state = useMeshStore.getState();
  const convo = state.activeConvo;
  if (!convo || !isConvoVisible(state, convo.id)) return;
  state.dismissConvoNotifications(convo.id);
  if (unreadCount(state.msgHistory, convo.id) === 0) return;
  openConvo(convo);
}

/** Builds the conversation id for a channel slot (e.g. `"channel:0"`). */
export function channelConvoId(idx: number): string {
  return convoId('channel', idx);
}

/**
 * Builds the conversation id for a direct chat with a contact (by pubkey
 * prefix).
 */
export function directConvoId(prefix: string): string {
  return convoId('direct', prefix);
}

/**
 * Builds the conversation id for a repeater/room admin view (by pubkey prefix).
 * A distinct namespace from {@link directConvoId} keeps admin selections from
 * colliding with a chat's `msgHistory` keys.
 */
export function repeaterConvoId(prefix: string): string {
  return convoId('repeater', prefix);
}

/**
 * Builds the conversation id for a room server's post feed (by pubkey prefix).
 * Separate from {@link repeaterConvoId} so the posts never share a transcript
 * with the room's remote-admin CLI.
 */
export function roomConvoId(prefix: string): string {
  return convoId('room', prefix);
}

/**
 * The conversation a contact opens into. Its advert type — not the surface the
 * user clicked from — decides which one, so the sidebar, the map popup and the
 * Nodes directory can never land a node on different surfaces. The label
 * follows the sidebar's fallback so an unnamed contact reads the same
 * everywhere.
 */
export function contactConvo(contact: Contact): ActiveConvo {
  const prefix = contact.pubkeyPrefix;
  const label = contact.name || prefix.slice(0, 8);
  if (contact.advType === ADV_TYPE_REPEATER) {
    return {
      kind: 'repeater',
      id: repeaterConvoId(prefix),
      rawId: prefix,
      label,
    };
  }
  if (contact.advType === ADV_TYPE_ROOM) {
    return { kind: 'room', id: roomConvoId(prefix), rawId: prefix, label };
  }
  return { kind: 'direct', id: directConvoId(prefix), rawId: prefix, label };
}
