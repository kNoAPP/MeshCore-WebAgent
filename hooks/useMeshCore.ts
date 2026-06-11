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

import { useCallback } from 'react';
import { MeshCoreClient } from '@/lib/meshcore/client';
import {
  createUSBTransport,
  createBLETransport,
  createWiFiTransport,
} from '@/lib/meshcore/transports';
import { useMeshStore, channelConvoId, directConvoId } from '@/store/meshStore';
import { loadRadioData, saveRadioData, deriveStorageKey } from '@/lib/storage';
import {
  ROUTE_TYPE_FLOOD,
  PAYLOAD_TYPE_GRP_TXT,
  ADV_TYPE_REPEATER,
} from '@/lib/meshcore/constants';
import { toHex } from '@/lib/utils';
import type {
  ActiveConvo,
  Contact,
  Message,
  RawRxPacket,
  ITransport,
} from '@/types/meshcore';

interface PendingAck {
  convoId: string;
  msgId: string;
  timer: ReturnType<typeof setTimeout>;
}

// Counts repeater rebroadcasts of our last channel TX heard in the RX log.
// payloadKey locks onto the first group-text echo after sending; rebroadcasts
// of the same packet carry identical payload bytes.
interface EchoWindow {
  convoId: string;
  msgId: string;
  payloadKey: string | null;
  heard: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

// LoRa round trips are spiky — give the radio's suggested timeout some slack
const ACK_TIMEOUT_GRACE = 1.5;
const MIN_ACK_TIMEOUT_MS = 5000;
const DEFAULT_ACK_TIMEOUT_MS = 30000;
const ECHO_WINDOW_MS = 15000;
const SAVE_DEBOUNCE_MS = 1000;

// Module scope, not per-instance refs: useMeshCore is mounted by several
// components but the client callbacks are wired once, so send-tracking state
// must be shared across all hook instances.
const pendingAcks = new Map<number, PendingAck>();
// ACK codes whose timeout already fired — kept so a late ACK can upgrade the
// message from 'failed' to 'delivered' instead of being dropped
const expiredAcks = new Map<number, Omit<PendingAck, 'timer'>>();
const EXPIRED_ACK_LIMIT = 50;
let echoWindow: EchoWindow | null = null;
let saveUnsub: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let storageKey: CryptoKey | null = null;
let syntheticAckSeq = 0;

function clearPendingAcks(): void {
  for (const p of pendingAcks.values()) clearTimeout(p.timer);
  pendingAcks.clear();
}

// Called when a session begins as well as when one ends: a dropped transport
// never reaches disconnect(), so stale timers and the previous radio's save
// subscription must not survive into the next connection
function clearSessionState(): void {
  clearPendingAcks();
  expiredAcks.clear();
  closeEchoWindow();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveUnsub?.();
  saveUnsub = null;
  storageKey = null;
}

function closeEchoWindow(): void {
  if (echoWindow) clearTimeout(echoWindow.timer);
  echoWindow = null;
}

function openEchoWindow(convoId: string, msgId: string): void {
  closeEchoWindow();
  echoWindow = {
    convoId,
    msgId,
    payloadKey: null,
    heard: new Set(),
    timer: setTimeout(closeEchoWindow, ECHO_WINDOW_MS),
  };
}

function handleEchoPacket(pkt: RawRxPacket): void {
  const w = echoWindow;
  if (!w) return;
  if (
    pkt.routeType !== ROUTE_TYPE_FLOOD ||
    pkt.payloadType !== PAYLOAD_TYPE_GRP_TXT ||
    pkt.hopCount < 1
  ) {
    return;
  }
  const key = toHex(pkt.payload);
  if (w.payloadKey === null) w.payloadKey = key;
  else if (w.payloadKey !== key) return;
  // The repeater that just rebroadcast is the last hash appended to the path
  const lastHop = toHex(pkt.path.slice(-pkt.hashSize));
  if (!w.heard.has(lastHop)) {
    w.heard.add(lastHop);
    useMeshStore
      .getState()
      .updateMessage(w.convoId, w.msgId, { heardByRepeaters: w.heard.size });
  }
}

function rememberExpiredAck(
  ackCode: number,
  convoId: string,
  msgId: string,
): void {
  expiredAcks.set(ackCode, { convoId, msgId });
  if (expiredAcks.size > EXPIRED_ACK_LIMIT) {
    expiredAcks.delete(expiredAcks.keys().next().value!);
  }
}

function handleAck(ackCode: number, roundTripMs: number): void {
  const pending = pendingAcks.get(ackCode);
  if (pending) {
    pendingAcks.delete(ackCode);
    clearTimeout(pending.timer);
    useMeshStore.getState().updateMessage(pending.convoId, pending.msgId, {
      status: 'delivered',
      roundTripMs,
    });
    return;
  }
  // Late ACK — the timeout already marked the message 'failed'; upgrade it
  const expired = expiredAcks.get(ackCode);
  if (!expired) return; // unknown or duplicate ACK
  expiredAcks.delete(ackCode);
  useMeshStore.getState().updateMessage(expired.convoId, expired.msgId, {
    status: 'delivered',
    roundTripMs,
  });
}

export function useMeshCore() {
  const {
    client,
    setClient,
    setStatus,
    setDeviceName,
    setBattery,
    setSyncProgress,
    setContacts,
    setChannels,
    addMessage,
    updateMessage,
    restoreHistory,
    showToast,
    reset,
  } = useMeshStore();

  const wireClient = useCallback(
    (c: MeshCoreClient) => {
      c.callbacks = {
        onSelfInfo: (info) => setDeviceName(info.name),
        onDeviceInfo: () => {},
        onBattery: (b) => setBattery(b),
        onSyncProgress: (p) => setSyncProgress(p),
        onContactsUpdated: (contacts) => setContacts({ ...contacts }),
        onChannelsUpdated: (channels) => setChannels({ ...channels }),
        onLogRx: handleEchoPacket,
        onAck: handleAck,
        onMessage: (msg) => {
          if (msg.kind === 'channel' && msg.channelIdx !== undefined) {
            const id = channelConvoId(msg.channelIdx);
            addMessage(id, { ...msg, senderName: undefined });
            const chName =
              c.channels[msg.channelIdx]?.name || `Channel ${msg.channelIdx}`;
            showToast(`New message in ${chName}`);
          } else if (msg.kind === 'direct' && msg.pubkeyPrefix) {
            const id = directConvoId(msg.pubkeyPrefix);
            const contact = c.lookupContact(msg.pubkeyPrefix);
            addMessage(id, {
              ...msg,
              senderName: contact?.name ?? msg.pubkeyPrefix.slice(0, 8),
            });
            showToast(
              `New message from ${contact?.name ?? msg.pubkeyPrefix.slice(0, 8)}`,
            );
          }
        },
      };
    },
    [
      setDeviceName,
      setBattery,
      setSyncProgress,
      setContacts,
      setChannels,
      addMessage,
      showToast,
    ],
  );

  const connect = useCallback(
    async (transport: ITransport) => {
      setStatus('connecting');
      clearSessionState();
      try {
        const c = new MeshCoreClient(transport);
        wireClient(c);
        setClient(c);
        await c.init();
        setSyncProgress(null);
        setStatus('connected');
        setDeviceName(
          c.selfInfo?.name ?? c.deviceInfo?.model ?? 'MeshCore Device',
        );
        const batt = await c.getBattery();
        if (batt) setBattery(batt);
        showToast(
          `Connected — ${c.selfInfo?.name ?? 'MeshCore Device'}`,
          'success',
        );

        const pubkey = c.selfInfo?.pubkey;
        if (pubkey) {
          const secrets = Object.values(c.channels)
            .map((ch) => ch.secret)
            .filter((s): s is Uint8Array => s != null && s.length > 0);
          const key = await deriveStorageKey(secrets, pubkey);
          storageKey = key;

          const saved = await loadRadioData(pubkey, key);
          if (saved?.msgHistory) restoreHistory(saved.msgHistory);

          saveUnsub = useMeshStore.subscribe((state, prev) => {
            if (state.msgHistory === prev.msgHistory) return;
            // Status flickers arrive in bursts — debounce the full-history
            // encrypt-and-write
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              saveTimer = null;
              saveRadioData(pubkey, key, {
                msgHistory: useMeshStore.getState().msgHistory,
              });
            }, SAVE_DEBOUNCE_MS);
          });
        }
      } catch (err) {
        setSyncProgress(null);
        setStatus('disconnected');
        showToast(`Connection failed: ${(err as Error).message}`, 'error');
      }
    },
    [
      setStatus,
      setClient,
      setDeviceName,
      setBattery,
      setSyncProgress,
      showToast,
      wireClient,
      restoreHistory,
    ],
  );

  const connectUSB = useCallback(
    async (baud: number) => {
      try {
        const transport = await createUSBTransport(baud);
        await connect(transport);
      } catch (err) {
        showToast(`USB error: ${(err as Error).message}`, 'error');
      }
    },
    [connect, showToast],
  );

  const connectBLE = useCallback(async () => {
    try {
      const transport = await createBLETransport();
      await connect(transport);
    } catch (err) {
      showToast(`BLE error: ${(err as Error).message}`, 'error');
    }
  }, [connect, showToast]);

  const connectWiFi = useCallback(
    async (url: string) => {
      try {
        const transport = await createWiFiTransport(url);
        await connect(transport);
      } catch (err) {
        showToast(`WiFi error: ${(err as Error).message}`, 'error');
      }
    },
    [connect, showToast],
  );

  const disconnect = useCallback(() => {
    const pubkey = client?.selfInfo?.pubkey;
    if (pubkey && storageKey) {
      saveRadioData(pubkey, storageKey, {
        msgHistory: useMeshStore.getState().msgHistory,
      });
    }
    clearSessionState();
    client?.destroy();
    setClient(null);
    reset();
    showToast('Disconnected');
  }, [client, setClient, reset, showToast]);

  const transmit = useCallback(
    async (
      convo: ActiveConvo,
      msgId: string,
      text: string,
      attempt: number,
      resetRoute = false,
    ) => {
      if (!client) return;
      updateMessage(convo.id, msgId, { status: 'sending', attempt });
      try {
        if (convo.kind === 'channel') {
          await client.sendChannelMessage(Number(convo.rawId), text);
          updateMessage(convo.id, msgId, { status: 'sent' });
          openEchoWindow(convo.id, msgId);
          return;
        }
        const contact = client.contacts[convo.rawId as string];
        if (!contact) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          showToast('Contact not found', 'error');
          return;
        }
        if (contact.advType === ADV_TYPE_REPEATER) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          showToast('Repeaters can’t be messaged', 'error');
          return;
        }
        if (resetRoute) {
          try {
            await client.resetPath(contact);
          } catch {}
        }
        const receipt = await client.sendDirectMessage(contact, text, attempt);
        updateMessage(convo.id, msgId, {
          status: 'sent',
          routeFlood: receipt?.routeFlood,
        });
        // Without a receipt (OK-only reply) no ACK can ever match — a
        // synthetic negative key still gives the message a timeout so it
        // can't sit at 'sent' forever
        const ackKey = receipt ? receipt.expectedAck : --syntheticAckSeq;
        const timeoutMs = receipt
          ? Math.max(
              MIN_ACK_TIMEOUT_MS,
              receipt.suggestedTimeoutMs * ACK_TIMEOUT_GRACE,
            )
          : DEFAULT_ACK_TIMEOUT_MS;
        const timer = setTimeout(() => {
          pendingAcks.delete(ackKey);
          if (ackKey >= 0) rememberExpiredAck(ackKey, convo.id, msgId);
          const current = useMeshStore
            .getState()
            .msgHistory[convo.id]?.find((m) => m.id === msgId);
          // A late ACK from an earlier attempt may have already delivered it
          if (current?.status !== 'delivered') {
            updateMessage(convo.id, msgId, { status: 'failed' });
          }
        }, timeoutMs);
        pendingAcks.set(ackKey, { convoId: convo.id, msgId, timer });
      } catch (err) {
        updateMessage(convo.id, msgId, { status: 'failed' });
        showToast(`Send failed: ${(err as Error).message}`, 'error');
      }
    },
    [client, updateMessage, showToast],
  );

  const sendMessage = useCallback(
    async (text: string, activeConvo: ActiveConvo | null) => {
      if (!client || !activeConvo || !text.trim()) return;
      const trimmed = text.trim();
      const msgId = crypto.randomUUID();
      addMessage(activeConvo.id, {
        id: msgId,
        kind: activeConvo.kind,
        text: trimmed,
        own: true,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'sending',
      });
      await transmit(activeConvo, msgId, trimmed, 0);
    },
    [client, addMessage, transmit],
  );

  const retryMessage = useCallback(
    async (msg: Message, convo: ActiveConvo | null, resetRoute = false) => {
      if (!client || !convo || !msg.id || msg.status !== 'failed') return;
      await transmit(
        convo,
        msg.id,
        msg.text,
        (msg.attempt ?? 0) + 1,
        resetRoute,
      );
    },
    [client, transmit],
  );

  const resetContactPath = useCallback(
    async (contact: Contact) => {
      if (!client) return;
      try {
        await client.resetPath(contact);
        showToast('Route reset — next message will flood', 'success');
      } catch (err) {
        showToast(`Route reset failed: ${(err as Error).message}`, 'error');
      }
    },
    [client, showToast],
  );

  return {
    connectUSB,
    connectBLE,
    connectWiFi,
    disconnect,
    sendMessage,
    retryMessage,
    resetContactPath,
  };
}
