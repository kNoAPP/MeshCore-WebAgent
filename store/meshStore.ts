// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

'use client';

import { create } from 'zustand';
import type {
  Contact,
  Channel,
  Message,
  ActiveConvo,
  ConnectionStatus,
  BatteryInfo,
  SyncProgress,
} from '@/types/meshcore';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import { convoId } from '@/lib/utils';

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

  // Conversations
  msgHistory: Record<string, Message[]>;
  activeConvo: ActiveConvo | null;

  // UI
  toast: Toast | null;
  statsOpen: boolean;
}

interface MeshActions {
  setClient: (c: MeshCoreClient | null) => void;
  setStatus: (s: ConnectionStatus) => void;
  setDeviceName: (name: string) => void;
  setBattery: (b: BatteryInfo | null) => void;
  setSyncProgress: (p: SyncProgress | null) => void;
  setContacts: (c: Record<string, Contact>) => void;
  setChannels: (ch: Record<number, Channel>) => void;
  addMessage: (id: string, msg: Message) => void;
  setActiveConvo: (convo: ActiveConvo | null) => void;
  markRead: (id: string) => void;
  restoreHistory: (persisted: Record<string, Message[]>) => void;
  showToast: (text: string, variant?: Toast['variant']) => void;
  dismissToast: () => void;
  setStatsOpen: (open: boolean) => void;
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
  msgHistory: {},
  activeConvo: null,
  toast: null,
  statsOpen: false,
};

let toastSeq = 0;

export const useMeshStore = create<MeshState & MeshActions>((set, get) => ({
  ...initialState,

  setClient: (client) => set({ client }),
  setStatus: (status) => set({ status }),
  setDeviceName: (deviceName) => set({ deviceName }),
  setBattery: (battery) => set({ battery }),
  setSyncProgress: (syncProgress) => set({ syncProgress }),
  setContacts: (contacts) => set({ contacts }),
  setChannels: (channels) => set({ channels }),

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

  setActiveConvo: (activeConvo) => set({ activeConvo }),

  restoreHistory: (persisted) =>
    set((state) => {
      // Prepend persisted messages before any newly-polled messages (old → new order).
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

  reset: () =>
    set({
      ...initialState,
      toast: get().toast,
    }),
}));

export function unreadCount(
  msgHistory: Record<string, Message[]>,
  id: string,
): number {
  return (msgHistory[id] ?? []).filter((m) => m._unread).length;
}

export function openConvo(convo: ActiveConvo): void {
  const { setActiveConvo, markRead } = useMeshStore.getState();
  setActiveConvo(convo);
  markRead(convo.id);
}

export function channelConvoId(idx: number): string {
  return convoId('channel', idx);
}

export function directConvoId(prefix: string): string {
  return convoId('direct', prefix);
}
