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
  SyncProgress,
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
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

/** localStorage key for the persisted {@link AutoAddConfig}. */
const AUTOADD_STORAGE_KEY = 'meshcore.autoAddConfig';

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
  battery: BatteryInfo | null;
  syncProgress: SyncProgress | null;

  // Mesh data
  contacts: Record<string, Contact>;
  channels: Record<number, Channel>;
  adverts: Record<string, Advert>;
  autoAddConfig: AutoAddConfig;

  // Conversations
  msgHistory: Record<string, Message[]>;
  activeConvo: ActiveConvo | null;

  // UI
  contactView: ContactView;
  locale: SupportedLocale;
  theme: Theme;
  toast: Toast | null;
  statsOpen: boolean;
  managePanel: { kind: 'contact' | 'channel'; id: string } | null;
  discoverOpen: boolean;
  autoAddOpen: boolean;
  addChannelOpen: boolean;
}

interface MeshActions {
  setClient: (c: MeshCoreClient | null) => void;
  setStatus: (s: ConnectionStatus) => void;
  setDeviceName: (name: string) => void;
  setBattery: (b: BatteryInfo | null) => void;
  setSyncProgress: (p: SyncProgress | null) => void;
  setContacts: (c: Record<string, Contact>) => void;
  setChannels: (ch: Record<number, Channel>) => void;
  setAdverts: (a: Record<string, Advert>) => void;
  setAutoAddConfig: (cfg: AutoAddConfig) => void;
  setContactView: (view: ContactView) => void;
  setLocale: (locale: SupportedLocale) => void;
  setTheme: (theme: Theme) => void;
  addMessage: (id: string, msg: Message) => void;
  updateMessage: (id: string, msgId: string, patch: Partial<Message>) => void;
  setActiveConvo: (convo: ActiveConvo | null) => void;
  markRead: (id: string) => void;
  restoreHistory: (persisted: Record<string, Message[]>) => void;
  showToast: (text: string, variant?: Toast['variant']) => void;
  dismissToast: () => void;
  setStatsOpen: (open: boolean) => void;
  setManagePanel: (
    panel: { kind: 'contact' | 'channel'; id: string } | null,
  ) => void;
  setDiscoverOpen: (open: boolean) => void;
  setAutoAddOpen: (open: boolean) => void;
  setAddChannelOpen: (open: boolean) => void;
  reset: () => void;
}

const initialState: MeshState = {
  client: null,
  status: 'disconnected',
  deviceName: '',
  battery: null,
  syncProgress: null,
  contacts: {},
  channels: {},
  adverts: {},
  autoAddConfig: loadAutoAddConfig(),
  msgHistory: {},
  activeConvo: null,
  contactView: loadContactView(),
  locale: resolveInitialLocale(),
  theme: resolveInitialTheme(),
  toast: null,
  statsOpen: false,
  managePanel: null,
  discoverOpen: false,
  autoAddOpen: false,
  addChannelOpen: false,
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
  setBattery: (battery) => set({ battery }),
  setSyncProgress: (syncProgress) => set({ syncProgress }),
  setContacts: (contacts) => set({ contacts }),
  setChannels: (channels) => set({ channels }),
  setAdverts: (adverts) => set({ adverts }),

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

  restoreHistory: (persisted) =>
    set((state) => {
      // Prepend persisted messages before any newly-polled messages (old → new
      // order).
      // Assign IDs to any persisted messages that predate the id field.
      const merged: Record<string, Message[]> = {};
      const allKeys = new Set([
        ...Object.keys(persisted),
        ...Object.keys(state.msgHistory),
      ]);
      for (const id of allKeys) {
        const old = (persisted[id] ?? []).map((m) => ({
          ...m,
          id: m.id ?? crypto.randomUUID(),
          // A send still in flight when the session ended can never confirm
          status: m.status === 'sending' ? ('failed' as const) : m.status,
          _unread: false,
        }));
        merged[id] = [...old, ...(state.msgHistory[id] ?? [])];
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
  setStatsOpen: (statsOpen) => set({ statsOpen }),
  setManagePanel: (managePanel) => set({ managePanel }),
  setDiscoverOpen: (discoverOpen) => set({ discoverOpen }),
  setAutoAddOpen: (autoAddOpen) => set({ autoAddOpen }),
  setAddChannelOpen: (addChannelOpen) => set({ addChannelOpen }),

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
    }),
}));

/** Counts unread messages in one conversation. */
export function unreadCount(
  msgHistory: Record<string, Message[]>,
  id: string,
): number {
  return (msgHistory[id] ?? []).filter((m) => m._unread).length;
}

/** Opens a conversation and marks it read in one step. */
export function openConvo(convo: ActiveConvo): void {
  const { setActiveConvo, markRead } = useMeshStore.getState();
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
