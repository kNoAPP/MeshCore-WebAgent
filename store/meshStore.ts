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
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
import type {
  AutomationRule,
  StagedAction,
  AuditEntry,
} from '@/types/automation';
import type { MeshCoreClient } from '@/lib/meshcore/client';
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
import { loadMapPrefs, saveMapPrefs, type MapPrefs } from '@/lib/map/config';
import {
  loadAdvertCache,
  saveAdvertCache,
  mergeAdvertCache,
} from '@/lib/map/advertCache';

/** localStorage key for the persisted {@link AutoAddConfig}. */
const AUTOADD_STORAGE_KEY = 'meshcore.autoAddConfig';

/** localStorage key for the persisted automation master switch. */
const AUTOMATION_ENABLED_STORAGE_KEY = 'meshcore.automationEnabled';

/** Cap on the in-memory automation audit log, newest kept. */
const AUDIT_LOG_LIMIT = 200;

const DEFAULT_AUTOADD_CONFIG: AutoAddConfig = {
  mode: 'all',
  chat: true,
  repeater: true,
  room: true,
  sensor: false,
  overwriteOldest: false,
  maxHops: MAX_HOPS_NO_LIMIT,
  showPublicKeys: false,
};

/**
 * Reads the persisted auto-add config from localStorage, falling back to
 * defaults (and on SSR).
 */
function loadAutoAddConfig(): AutoAddConfig {
  if (typeof window === 'undefined') return DEFAULT_AUTOADD_CONFIG;
  try {
    const raw = window.localStorage.getItem(AUTOADD_STORAGE_KEY);
    if (raw) return { ...DEFAULT_AUTOADD_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_AUTOADD_CONFIG;
}

/**
 * Reads the persisted automation master switch from localStorage, defaulting to
 * off (and on SSR) so automation never silently arms on a fresh device.
 */
function loadAutomationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(AUTOMATION_ENABLED_STORAGE_KEY) === 'true'
    );
  } catch {
    return false;
  }
}

/** Persists the automation master switch to localStorage (best-effort). */
function saveAutomationEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      AUTOMATION_ENABLED_STORAGE_KEY,
      String(enabled),
    );
  } catch {}
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

/** localStorage key for the persisted {@link ContactView}. */
const CONTACT_VIEW_STORAGE_KEY = 'meshcore.contactView';

const DEFAULT_CONTACT_VIEW: ContactView = {
  filter: 'all',
  sort: 'az',
  pinFavorites: true,
};

/**
 * Reads the persisted contacts-list view preferences from localStorage, falling
 * back to defaults (and on SSR).
 */
function loadContactView(): ContactView {
  if (typeof window === 'undefined') return DEFAULT_CONTACT_VIEW;
  try {
    const raw = window.localStorage.getItem(CONTACT_VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = { ...DEFAULT_CONTACT_VIEW, ...JSON.parse(raw) };
      // Drop unrecognized filter/sort values (corrupt or stale schema) back to
      // their defaults so they can't reach the sidebar's exhaustive switches.
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
  } catch {}
  return DEFAULT_CONTACT_VIEW;
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

interface MeshState {
  // Connection
  client: MeshCoreClient | null;
  status: ConnectionStatus;
  deviceName: string;
  selfInfo: SelfInfo | null;
  deviceInfo: DeviceInfo | null;
  battery: BatteryInfo | null;
  syncProgress: SyncProgress | null;

  // Mesh data
  contacts: Record<string, Contact>;
  channels: Record<number, Channel>;
  adverts: Record<string, Advert>;
  /**
   * Browser-persisted metadata for every advert ever heard, keyed by
   * `pubkeyPrefix`. A superset of {@link adverts} that survives reloads and
   * reconnects, so the map can plot discovered nodes the radio's bounded
   * contact table can't hold. See `lib/map/advertCache.ts`.
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
  /** Persisted viewport, or `null` until the user first pans/zooms the map. */
  mapPrefs: MapPrefs | null;
  toast: Toast | null;
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
}

interface MeshActions {
  setClient: (c: MeshCoreClient | null) => void;
  setStatus: (s: ConnectionStatus) => void;
  setDeviceName: (name: string) => void;
  setSelfInfo: (info: SelfInfo | null) => void;
  setDeviceInfo: (info: DeviceInfo | null) => void;
  setBattery: (b: BatteryInfo | null) => void;
  setSyncProgress: (p: SyncProgress | null) => void;
  setContacts: (c: Record<string, Contact>) => void;
  setChannels: (ch: Record<number, Channel>) => void;
  setAdverts: (a: Record<string, Advert>) => void;
  /** Folds freshly heard adverts into the persisted advert cache. */
  cacheAdverts: (a: Record<string, Advert>) => void;
  setAutoAddConfig: (cfg: AutoAddConfig) => void;
  setContactView: (view: ContactView) => void;
  setLocale: (locale: SupportedLocale) => void;
  setTheme: (theme: Theme) => void;
  setMapPrefs: (prefs: MapPrefs) => void;
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
  setView: (view: AppView) => void;
  /** Opens the map in location-pick mode. */
  startLocationPick: () => void;
  /** Confirms the picked coordinate (degrees) and returns to Settings. */
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
  contacts: {},
  channels: {},
  adverts: {},
  advertCache: loadAdvertCache(),
  autoAddConfig: loadAutoAddConfig(),
  msgHistory: {},
  activeConvo: null,
  scrollToMsgId: null,
  unreadMarkers: {},
  contactView: loadContactView(),
  locale: resolveInitialLocale(),
  theme: resolveInitialTheme(),
  mapPrefs: loadMapPrefs(),
  toast: null,
  view: 'chat',
  mapPicking: false,
  pendingLocation: null,
  managePanel: null,
  autoAddOpen: false,
  addChannelOpen: false,
  addContactOpen: false,
  advertising: false,
  commandPaletteOpen: false,
  settingsSection: null,
  aiKeyStatus: 'none',
  automationEnabled: loadAutomationEnabled(),
  automationRules: [],
  stagedActions: [],
  auditLog: [],
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
  setContacts: (contacts) => set({ contacts }),
  setChannels: (channels) => set({ channels }),
  setAdverts: (adverts) => set({ adverts }),

  cacheAdverts: (adverts) =>
    set((state) => {
      const advertCache = mergeAdvertCache(state.advertCache, adverts);
      saveAdvertCache(advertCache);
      return { advertCache };
    }),

  setAutoAddConfig: (autoAddConfig) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          AUTOADD_STORAGE_KEY,
          JSON.stringify(autoAddConfig),
        );
      } catch {}
    }
    set({ autoAddConfig });
  },

  setContactView: (contactView) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          CONTACT_VIEW_STORAGE_KEY,
          JSON.stringify(contactView),
        );
      } catch {}
    }
    set({ contactView });
  },

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
    saveMapPrefs(mapPrefs);
    set({ mapPrefs });
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
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3000);
  },

  dismissToast: () => set({ toast: null }),
  // Any manual tab switch also aborts an in-progress location pick.
  setView: (view) => set({ view, mapPicking: false, settingsSection: null }),
  startLocationPick: () => set({ mapPicking: true, view: 'map' }),
  confirmLocationPick: (lat, lon) =>
    set({ mapPicking: false, view: 'settings', pendingLocation: { lat, lon } }),
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
      managePanel: null,
      autoAddOpen: false,
      addChannelOpen: false,
      addContactOpen: false,
      commandPaletteOpen: false,
      settingsSection: null,
    }),

  setAiKeyStatus: (aiKeyStatus) => set({ aiKeyStatus }),

  setAutomationEnabled: (automationEnabled) => {
    saveAutomationEnabled(automationEnabled);
    set({ automationEnabled });
  },
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
    saveAutomationEnabled(false);
    set({ automationEnabled: false, stagedActions: [] });
  },

  reset: () =>
    set({
      ...initialState,
      toast: get().toast,
      // Auto-add config is a persistent user preference, not session state
      autoAddConfig: get().autoAddConfig,
      // Contacts-list view is a persistent user preference, not session state
      contactView: get().contactView,
      // Locale is a persistent user preference, not session state
      locale: get().locale,
      // Theme is a persistent user preference, not session state
      theme: get().theme,
      // Map preferences are a persistent user preference, not session state
      mapPrefs: get().mapPrefs,
      // The advert cache persists across sessions so discovered nodes stay on
      // the map after a disconnect or reconnect
      advertCache: get().advertCache,
      // The automation master switch persists across sessions/reconnects
      automationEnabled: get().automationEnabled,
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
