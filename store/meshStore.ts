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
  StatsResult,
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
import type {
  AutomationRule,
  StagedAction,
  AuditEntry,
} from '@/types/automation';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import type { Neighbor } from '@/lib/meshcore/repeaterCli';
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
import { DEFAULT_AI_PREF, normalizeAiPref, type AiPref } from '@/lib/ai/pref';
import { mergeAdvertCache } from '@/lib/map/advertCache';

const AUDIT_LOG_LIMIT = 200;

const CLI_LOG_LIMIT = 200;

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

/** Which top-level page the connected app is showing. */
export type AppView = 'chat' | 'stats' | 'settings' | 'map';

/** The cards on the Settings page, in render order; used for deep-linking. */
export const SETTINGS_SECTIONS = [
  'device',
  'radio',
  'identity',
  'location',
  'display',
  'ai',
  'automation',
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

/** Persisted contacts-list view: filter, order, and favorite pinning. */
export interface ContactView {
  filter: ContactFilter;
  sort: ContactSort;
  pinFavorites: boolean;
}

const DEFAULT_CONTACT_VIEW: ContactView = {
  filter: 'all',
  sort: 'az',
  pinFavorites: true,
};

// A persisted filter/sort value must never reach the sidebar's exhaustive
// switches unrecognized.
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
  };
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
  aiPref: AiPref;
  showFullPublicKeys: boolean;
}

/**
 * A transient notification banner. `id` lets a later toast supersede an earlier
 * auto-dismiss.
 */
export interface Toast {
  text: string;
  variant: 'success' | 'error' | '';
  id: number;
}

/**
 * Login state of a remote-admin session with a repeater or room server.
 * `pending` covers the in-flight login handshake; the {@link RepeaterAccess}
 * levels (`admin`/`guest`) are the accepted, server-granted states; `loggedOut`
 * is the initial and post-failure state.
 */
export type AdminLoginState = 'loggedOut' | 'pending' | RepeaterAccess;

/** One line of a repeater CLI transcript. */
export interface CliLine {
  /** `true` for a command we sent, `false` for the repeater's reply. */
  own: boolean;
  text: string;
  /** `Date.now()` when the line was appended. */
  ts: number;
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
  cli: CliLine[];
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
  deviceClock: { time: number; skew: number } | null;
  /**
   * The Stats page's own battery/storage snapshot (including `null` when the
   * device didn't report it), link-scoped alongside {@link deviceStats} so a
   * radio switch or a timed-out read can't surface another link's reading. The
   * header's {@link battery} is separate and deliberately retained on a null
   * read.
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
  activeConvo: ActiveConvo | null;
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
  /** Persisted viewport, or `null` until the user first pans/zooms the map. */
  mapPrefs: MapPrefs | null;
  toast: Toast | null;
  /**
   * Localized reason the last connection attempt failed, shown inline on the
   * connect screen; `null` when there is no error to show. User-cancelled
   * device pickers never set this.
   */
  connectError: string | null;
  view: AppView;
  /**
   * True while the map is in location-pick mode (opened from the Location card
   * in Settings). Drives the map's confirm/cancel banner and click-to-place
   * marker; cleared by any navigation.
   */
  mapPicking: boolean;
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
  managePanel: { kind: 'contact' | 'channel' | 'advert'; id: string } | null;
  autoAddOpen: boolean;
  addChannelOpen: boolean;
  addContactOpen: boolean;
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
  setMapPrefs: (prefs: MapPrefs) => void;
  /**
   * Folds a decrypted per-radio preferences blob into the store on connect,
   * normalizing every field so a corrupt or partial record falls back to
   * defaults. See {@link RadioPreferences}.
   */
  restorePreferences: (raw: unknown) => void;
  addMessage: (id: string, msg: Message) => void;
  updateMessage: (id: string, msgId: string, patch: Partial<Message>) => void;
  setActiveConvo: (convo: ActiveConvo | null) => void;
  setScrollToMsgId: (msgId: string | null) => void;
  /**
   * Freezes (or clears, with `null`) the "last unread" divider position for a
   * conversation.
   */
  setUnreadMarker: (id: string, msgId: string | null) => void;
  markRead: (id: string) => void;
  restoreHistory: (persisted: Record<string, Message[]>) => void;
  showToast: (text: string, variant?: Toast['variant']) => void;
  dismissToast: () => void;
  /** Sets (or clears, with `null`) the inline connect-screen error message. */
  setConnectError: (message: string | null) => void;
  setView: (view: AppView) => void;
  /** Opens the map to pick a location, returning to `returnTo` on confirm. */
  startLocationPick: (returnTo?: AppView) => void;
  /** Confirms the picked coordinate (degrees) and returns to the caller. */
  confirmLocationPick: (lat: number, lon: number) => void;
  /** Aborts location picking without a result, staying on the map. */
  cancelLocationPick: () => void;
  /** Clears the one-shot {@link MeshState.pendingLocation} after it's read. */
  clearPendingLocation: () => void;
  setManagePanel: (
    panel: { kind: 'contact' | 'channel' | 'advert'; id: string } | null,
  ) => void;
  setAutoAddOpen: (open: boolean) => void;
  setAddChannelOpen: (open: boolean) => void;
  setAddContactOpen: (open: boolean) => void;
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
  setRepeaterStatus: (prefix: string, status: RepeaterStatus) => void;
  /** Caches the last-read neighbors list for a repeater's admin session. */
  setRepeaterNeighbors: (prefix: string, neighbors: Neighbor[]) => void;
  /** Merges loaded/confirmed Config values into a repeater's session cache. */
  mergeRepeaterConfig: (prefix: string, patch: Record<string, string>) => void;
  /** Appends one line to a repeater's CLI transcript, capped to the newest. */
  appendCliLine: (prefix: string, line: CliLine) => void;
  /** Clears a repeater's CLI transcript, leaving the session intact. */
  clearCliLog: (prefix: string) => void;
  /** Drops a repeater's admin session entirely (e.g. on log out). */
  resetAdminSession: (prefix: string) => void;
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
  deviceClock: null,
  deviceBattery: null,
  contacts: {},
  channels: {},
  adverts: {},
  advertCache: {},
  autoAddConfig: DEFAULT_AUTOADD_CONFIG,
  msgHistory: {},
  activeConvo: null,
  scrollToMsgId: null,
  unreadMarkers: {},
  contactView: DEFAULT_CONTACT_VIEW,
  locale: resolveInitialLocale(),
  theme: resolveInitialTheme(),
  unitSystem: DEFAULT_UNIT_SYSTEM,
  showFullPublicKeys: false,
  aiPref: DEFAULT_AI_PREF,
  mapPrefs: null,
  toast: null,
  connectError: null,
  view: 'chat',
  mapPicking: false,
  pendingLocation: null,
  locationPickReturn: 'settings',
  managePanel: null,
  autoAddOpen: false,
  addChannelOpen: false,
  addContactOpen: false,
  advertising: false,
  commandPaletteOpen: false,
  settingsSection: null,
  aiKeyStatus: 'none',
  automationEnabled: false,
  automationRules: [],
  stagedActions: [],
  auditLog: [],
  adminSessions: {},
};

let toastSeq = 0;

/**
 * The global Zustand store: connection state, mirrored mesh data, conversation
 * history, and UI flags. All mutations go through the actions defined here —
 * components subscribe to slices and re-render on change.
 */
export const useMeshStore = create<MeshState & MeshActions>((set, get) => ({
  ...initialState,

  setClient: (client) => set({ client }),
  setStatus: (status) => set({ status }),
  setDeviceName: (deviceName) => set({ deviceName }),
  setSelfInfo: (selfInfo) => set({ selfInfo }),
  setDeviceInfo: (deviceInfo) => set({ deviceInfo }),
  setBattery: (battery) => set({ battery }),
  setSyncProgress: (syncProgress) => set({ syncProgress }),
  setDeviceStats: (deviceStats) => set({ deviceStats }),
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

  setMapPrefs: (mapPrefs) => set({ mapPrefs }),

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

  restorePreferences: (raw) => {
    const p = (
      typeof raw === 'object' && raw !== null ? raw : {}
    ) as Partial<RadioPreferences>;
    set({
      unitSystem: normalizeUnitSystem(p.unitSystem),
      contactView: normalizeContactView(p.contactView),
      autoAddConfig: normalizeAutoAddConfig(p.autoAddConfig),
      automationEnabled:
        typeof p.automationEnabled === 'boolean' ? p.automationEnabled : false,
      mapPrefs: normalizeMapPrefs(p.mapPrefs),
      aiPref: normalizeAiPref(p.aiPref),
      showFullPublicKeys:
        typeof p.showFullPublicKeys === 'boolean'
          ? p.showFullPublicKeys
          : false,
    });
  },

  addMessage: (id, msg) =>
    set((state) => {
      const prev = state.msgHistory[id] ?? [];
      const isActive = state.activeConvo?.id === id;
      const enriched: Message = {
        ...msg,
        id: msg.id ?? crypto.randomUUID(),
        _unread: !isActive,
      };
      return { msgHistory: { ...state.msgHistory, [id]: [...prev, enriched] } };
    }),

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

  setActiveConvo: (activeConvo) => set({ activeConvo }),

  setScrollToMsgId: (scrollToMsgId) => set({ scrollToMsgId }),

  setUnreadMarker: (id, msgId) =>
    set((state) => {
      const next = { ...state.unreadMarkers };
      if (msgId) next[id] = msgId;
      else delete next[id];
      return { unreadMarkers: next };
    }),

  restoreHistory: (persisted) =>
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
            status: m.status === 'sending' ? ('failed' as const) : m.status,
            _unread: false,
          }))
          .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
        merged[id] = [...old, ...keptCurrent];
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

  showToast: (text, variant = '') => {
    const id = ++toastSeq;
    set({ toast: { text, variant, id } });
    // Errors persist until dismissed; transient variants auto-clear.
    if (variant === 'error') return;
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3000);
  },

  dismissToast: () => set({ toast: null }),
  setConnectError: (message) => set({ connectError: message }),
  // Any manual tab switch also aborts an in-progress location pick.
  setView: (view) => set({ view, mapPicking: false, settingsSection: null }),
  startLocationPick: (returnTo = 'settings') =>
    set({ mapPicking: true, view: 'map', locationPickReturn: returnTo }),
  confirmLocationPick: (lat, lon) =>
    set((s) => ({
      mapPicking: false,
      view: s.locationPickReturn,
      pendingLocation: { lat, lon },
    })),
  cancelLocationPick: () => set({ mapPicking: false }),
  clearPendingLocation: () => set({ pendingLocation: null }),
  setManagePanel: (managePanel) => set({ managePanel }),
  setAutoAddOpen: (autoAddOpen) => set({ autoAddOpen }),
  setAddChannelOpen: (addChannelOpen) => set({ addChannelOpen }),
  setAddContactOpen: (addContactOpen) => set({ addContactOpen }),
  setAdvertising: (advertising) => set({ advertising }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openSettingsSection: (settingsSection) =>
    set({ view: 'settings', mapPicking: false, settingsSection }),
  clearSettingsSection: () => set({ settingsSection: null }),
  // Closes every connection-scoped overlay/panel at once. Called when the link
  // drops so a panel left open doesn't silently reappear once reconnect
  // remounts the connected UI. Resetting `view` to 'chat' also drops the Stats
  // and Settings pages.
  closeConnectionOverlays: () =>
    set({
      view: 'chat',
      mapPicking: false,
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
      return {
        adminSessions: {
          ...state.adminSessions,
          [prefix]: { ...session, login },
        },
      };
    }),
  setRepeaterStatus: (prefix, status) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Status belongs to a live, authenticated session. If a late reply lands
    // after log-out (session gone) or before login completes, drop it rather
    // than resurrecting a logged-out session with stale status that would then
    // leak into the next login. Return before `set` so no listeners are woken.
    if (session?.login !== 'admin' && session?.login !== 'guest') return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, status },
      },
    });
  },
  setRepeaterNeighbors: (prefix, neighbors) => {
    const { adminSessions } = get();
    const session = adminSessions[prefix];
    // Neighbors belong to a live, authenticated session. Drop a late reply
    // that lands after log-out or before login completes, matching
    // setRepeaterStatus, so it can't resurrect a logged-out session.
    if (session?.login !== 'admin' && session?.login !== 'guest') return;
    set({
      adminSessions: {
        ...adminSessions,
        [prefix]: { ...session, neighbors },
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

  reset: () =>
    set({
      ...initialState,
      toast: get().toast,
      // Locale is a global (pre-connect) preference kept in localStorage, not
      // per-radio session state.
      locale: get().locale,
      // Theme is a global (pre-connect) preference kept in localStorage, not
      // per-radio session state.
      theme: get().theme,
      // Every other preference is per-radio (encrypted in IndexedDB) and
      // reloaded on the next connect, so it resets to defaults here.
    }),
}));

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
    aiPref: state.aiPref,
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

/** Opens a conversation and marks it read in one step. */
export function openConvo(convo: ActiveConvo): void {
  const { setActiveConvo, markRead, setUnreadMarker, msgHistory } =
    useMeshStore.getState();
  // Freeze the "last unread" divider at the first unread message before
  // markRead clears the flags, so the boundary the user left off at stays
  // visible for this viewing.
  const firstUnread = (msgHistory[convo.id] ?? []).find((m) => m._unread);
  setUnreadMarker(convo.id, firstUnread?.id ?? null);
  setActiveConvo(convo);
  markRead(convo.id);
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
