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

import { useCallback, useRef } from 'react';
import { MeshCoreClient } from '@/lib/meshcore/client';
import {
  createUSBTransport,
  createBLETransport,
  createWiFiTransport,
} from '@/lib/meshcore/transports';
import { useMeshStore, channelConvoId, directConvoId } from '@/store/meshStore';
import { loadRadioData, saveRadioData, deriveStorageKey } from '@/lib/storage';
import type { ActiveConvo, Contact, ITransport } from '@/types/meshcore';

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
    restoreHistory,
    showToast,
    reset,
  } = useMeshStore();

  const saveUnsubRef = useRef<(() => void) | null>(null);
  const storageKeyRef = useRef<CryptoKey | null>(null);

  const wireClient = useCallback(
    (c: MeshCoreClient) => {
      c.callbacks = {
        onSelfInfo: (info) => setDeviceName(info.name),
        onDeviceInfo: () => {},
        onBattery: (b) => setBattery(b),
        onSyncProgress: (p) => setSyncProgress(p),
        onContactsUpdated: (contacts) => setContacts({ ...contacts }),
        onChannelsUpdated: (channels) => setChannels({ ...channels }),
        onAck: () => showToast('✓ Message delivered', 'success'),
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
          const storageKey = await deriveStorageKey(secrets, pubkey);
          storageKeyRef.current = storageKey;

          const saved = await loadRadioData(pubkey, storageKey);
          if (saved?.msgHistory) restoreHistory(saved.msgHistory);

          saveUnsubRef.current?.();
          saveUnsubRef.current = useMeshStore.subscribe((state, prev) => {
            if (state.msgHistory !== prev.msgHistory) {
              saveRadioData(pubkey, storageKey, {
                msgHistory: state.msgHistory,
              });
            }
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
    const storageKey = storageKeyRef.current;
    if (pubkey && storageKey) {
      saveRadioData(pubkey, storageKey, {
        msgHistory: useMeshStore.getState().msgHistory,
      });
    }
    saveUnsubRef.current?.();
    saveUnsubRef.current = null;
    storageKeyRef.current = null;
    client?.destroy();
    setClient(null);
    reset();
    showToast('Disconnected');
  }, [client, setClient, reset, showToast]);

  const sendMessage = useCallback(
    async (text: string, activeConvo: ActiveConvo | null) => {
      if (!client || !activeConvo || !text.trim()) return;
      const trimmed = text.trim();
      try {
        if (activeConvo.kind === 'channel') {
          await client.sendChannelMessage(Number(activeConvo.rawId), trimmed);
        } else {
          const contact: Contact | undefined =
            client.contacts[activeConvo.rawId as string];
          if (!contact) {
            showToast('Contact not found', 'error');
            return;
          }
          await client.sendDirectMessage(contact, trimmed);
        }
        addMessage(activeConvo.id, {
          kind: activeConvo.kind,
          text: trimmed,
          own: true,
          timestamp: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        showToast(`Send failed: ${(err as Error).message}`, 'error');
      }
    },
    [client, addMessage, showToast],
  );

  return { connectUSB, connectBLE, connectWiFi, disconnect, sendMessage };
}
