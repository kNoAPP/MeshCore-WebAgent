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
  FAVORITE_FLAG,
} from '@/lib/meshcore/constants';
import { toHex, fromHex, bytesEqual } from '@/lib/utils';
import i18n from '@/lib/i18n';
import type {
  ActiveConvo,
  Contact,
  Advert,
  AutoAddConfig,
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

/**
 * The bridge between {@link MeshCoreClient} and the Zustand store.
 *
 * @returns connect/disconnect entry points and the action handlers components
 * call (send/retry messages, manage contacts and channels, apply settings).
 * @remarks
 * Wires the client's {@link MeshCoreCallbacks} into store updates, owns
 * outbound-message delivery tracking (acks, retries, repeater-echo counting),
 * and handles encrypted history persistence. Send-tracking state lives at
 * module scope because the hook is mounted by several components but the
 * client callbacks are wired once.
 */
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
    setAdverts,
    setAutoAddConfig,
    addMessage,
    updateMessage,
    restoreHistory,
    showToast,
    reset,
  } = useMeshStore();

  // Installs the client callbacks that funnel radio events into the store and
  // route incoming messages to the right conversation with a toast.
  const wireClient = useCallback(
    (c: MeshCoreClient) => {
      c.callbacks = {
        onSelfInfo: (info) => setDeviceName(info.name),
        onDeviceInfo: () => {},
        onBattery: (b) => setBattery(b),
        onSyncProgress: (p) => setSyncProgress(p),
        onContactsUpdated: (contacts) => setContacts({ ...contacts }),
        onChannelsUpdated: (channels) => setChannels({ ...channels }),
        onAdvertsUpdated: (adverts) => setAdverts({ ...adverts }),
        onLogRx: handleEchoPacket,
        onAck: handleAck,
        onMessage: (msg) => {
          if (msg.kind === 'channel' && msg.channelIdx !== undefined) {
            const id = channelConvoId(msg.channelIdx);
            addMessage(id, { ...msg, senderName: undefined });
            const chName =
              c.channels[msg.channelIdx]?.name ||
              i18n.t('common.channelName', { index: msg.channelIdx });
            showToast(i18n.t('toast.newMessageIn', { channel: chName }));
          } else if (msg.kind === 'direct' && msg.pubkeyPrefix) {
            const id = directConvoId(msg.pubkeyPrefix);
            const contact = c.lookupContact(msg.pubkeyPrefix);
            addMessage(id, {
              ...msg,
              senderName: contact?.name ?? msg.pubkeyPrefix.slice(0, 8),
            });
            showToast(
              i18n.t('toast.newMessageFrom', {
                sender: contact?.name ?? msg.pubkeyPrefix.slice(0, 8),
              }),
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
      setAdverts,
      addMessage,
      showToast,
    ],
  );

  // Shared connect path for all transports: build + wire the client, run the
  // initial sync, hydrate settings/history, then subscribe history to be saved.
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
        const deviceName =
          c.selfInfo?.name ?? c.deviceInfo?.model ?? i18n.t('common.device');
        setDeviceName(deviceName);
        const batt = await c.getBattery();
        if (batt) setBattery(batt);
        showToast(
          i18n.t('toast.connected', {
            device: deviceName,
          }),
          'success',
        );

        // Hydrate auto-add settings FROM the radio so the app reflects the
        // device's persisted state (shared with any other companion client)
        // instead of overwriting it. The mode always comes from the handshake;
        // the per-type bitmask needs CMD_GET_AUTOADD_CONFIG, which older
        // firmware lacks — when it's absent we keep the existing local values
        // rather than wiping them. showPublicKeys is app-only, always local.
        const mode = c.manualAddMode;
        const bits = await c.readAutoAddBits();
        if (mode || bits) {
          setAutoAddConfig({
            ...useMeshStore.getState().autoAddConfig,
            ...(mode ? { mode } : {}),
            ...(bits ?? {}),
          });
        }

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
        showToast(
          i18n.t('toast.connectionFailed', { error: (err as Error).message }),
          'error',
        );
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
      setAutoAddConfig,
    ],
  );

  /** Prompts for a USB serial port and connects. */
  const connectUSB = useCallback(
    async (baud: number) => {
      try {
        const transport = await createUSBTransport(baud);
        await connect(transport);
      } catch (err) {
        showToast(
          i18n.t('toast.usbError', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [connect, showToast],
  );

  /** Prompts for a BLE companion and connects. */
  const connectBLE = useCallback(async () => {
    try {
      const transport = await createBLETransport();
      await connect(transport);
    } catch (err) {
      showToast(
        i18n.t('toast.bleError', { error: (err as Error).message }),
        'error',
      );
    }
  }, [connect, showToast]);

  /** Connects to a radio's WiFi WebSocket bridge at `url`. */
  const connectWiFi = useCallback(
    async (url: string) => {
      try {
        const transport = await createWiFiTransport(url);
        await connect(transport);
      } catch (err) {
        showToast(
          i18n.t('toast.wifiError', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [connect, showToast],
  );

  /**
   * Persists history, tears down the client and session state, and resets the
   * store.
   */
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
    showToast(i18n.t('toast.disconnected'));
  }, [client, setClient, reset, showToast]);

  // Core send routine for an existing message bubble: transmits to a channel or
  // contact, then tracks delivery — opens a repeater-echo window for channels,
  // or registers an ack timeout for direct messages (with a synthetic key when
  // the radio gives no receipt, so the bubble can't hang at 'sent' forever).
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
          showToast(i18n.t('toast.contactNotFound'), 'error');
          return;
        }
        if (contact.advType === ADV_TYPE_REPEATER) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          showToast(i18n.t('toast.repeaterCantMessage'), 'error');
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
        showToast(
          i18n.t('toast.sendFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, updateMessage, showToast],
  );

  /**
   * Adds an outgoing message bubble to the active conversation and transmits
   * it.
   */
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

  /**
   * Re-sends a failed message, bumping its attempt counter.
   *
   * @param resetRoute - if true, clears the contact's route first so the resend
   * floods.
   */
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

  /**
   * Resets a contact's route on the radio so its next message floods to
   * rediscover a path.
   */
  const resetContactPath = useCallback(
    async (contact: Contact) => {
      if (!client) return;
      try {
        await client.resetPath(contact);
        showToast(i18n.t('toast.routeReset'), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.routeResetFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Flips a contact's favorite flag on the radio. */
  const toggleFavorite = useCallback(
    async (contact: Contact) => {
      if (!client) return;
      const fav = (contact.flags & FAVORITE_FLAG) === 0;
      try {
        await client.setFavorite(contact, fav);
        showToast(
          fav
            ? i18n.t('toast.addedToFavorites')
            : i18n.t('toast.removedFromFavorites'),
        );
      } catch (err) {
        showToast(
          i18n.t('toast.favoriteUpdateFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Saves a heard advert as a contact on the radio. */
  const addDiscoveredContact = useCallback(
    async (advert: Advert) => {
      if (!client) return;
      const pubkeyBytes = fromHex(advert.pubkey, 32);
      if (!pubkeyBytes) {
        showToast(i18n.t('toast.invalidPublicKey'), 'error');
        return;
      }
      const contact: Contact = {
        pubkey: advert.pubkey,
        pubkeyPrefix: advert.pubkeyPrefix,
        pubkeyBytes,
        advType: advert.advType,
        flags: 0,
        outPathLen: 255,
        path: new Uint8Array(0),
        name: advert.name,
        lastAdvert: advert.lastHeard,
        advLat: advert.advLat,
        advLon: advert.advLon,
      };
      try {
        await client.addContact(contact);
        showToast(
          i18n.t('toast.added', {
            name: advert.name || advert.pubkeyPrefix,
          }),
          'success',
        );
      } catch (err) {
        showToast(
          i18n.t('toast.addContactFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Deletes a contact from the radio. */
  const removeContact = useCallback(
    async (contact: Contact) => {
      if (!client) return;
      try {
        await client.removeContact(contact);
        showToast(i18n.t('toast.contactRemoved'));
      } catch (err) {
        showToast(
          i18n.t('toast.removeContactFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Joins or creates a channel, placing it in the lowest free slot (1–7).
   *
   * @remarks No-ops with a toast if the secret already matches a joined
   * channel, or if all private slots are full.
   */
  const addChannel = useCallback(
    async (name: string, secret: Uint8Array) => {
      if (!client) return;
      // A channel is identified by its secret — don't create a duplicate slot
      const existing = Object.values(client.channels).find(
        (ch) => ch.secret && bytesEqual(ch.secret, secret),
      );
      if (existing) {
        showToast(
          i18n.t('toast.alreadyJoined', { name: existing.name || name }),
        );
        return;
      }
      // Indices 1-7 are private channels; pick the lowest free slot
      let idx = -1;
      for (let i = 1; i <= 7; i++) {
        if (!client.channels[i]) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        showToast(i18n.t('toast.allSlotsFull'), 'error');
        return;
      }
      try {
        await client.setChannel(idx, name, secret);
        showToast(i18n.t('toast.channelAdded', { name }), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.addChannelFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Removes a channel slot (rejected by the client for the Public channel). */
  const removeChannel = useCallback(
    async (idx: number) => {
      if (!client) return;
      try {
        await client.removeChannel(idx);
        showToast(i18n.t('toast.channelRemoved'));
      } catch (err) {
        showToast(
          i18n.t('toast.removeChannelFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Persists auto-add settings locally and writes them to the radio. */
  const applyAutoAddConfig = useCallback(
    async (cfg: AutoAddConfig) => {
      // Persist locally only after the radio write succeeds, so a failed write
      // doesn't leave the app showing settings the radio never accepted.
      if (!client) {
        setAutoAddConfig(cfg);
        return;
      }
      try {
        await client.setAutoAddPrefs(cfg);
        setAutoAddConfig(cfg);
        showToast(i18n.t('toast.settingsSaved'), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.saveSettingsFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, setAutoAddConfig, showToast],
  );

  return {
    connectUSB,
    connectBLE,
    connectWiFi,
    disconnect,
    sendMessage,
    retryMessage,
    resetContactPath,
    toggleFavorite,
    addDiscoveredContact,
    removeContact,
    addChannel,
    removeChannel,
    applyAutoAddConfig,
  };
}
