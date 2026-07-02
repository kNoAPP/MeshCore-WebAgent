// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMeshStore, channelConvoId, directConvoId } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { subscribe, emit } from '@/lib/ai/eventBus';
import { automationEngine } from '@/lib/ai/engine';
import { getStorageContext } from '@/lib/ai/secret';
import { saveAutomationRules } from '@/lib/storage';
import type { ActionContext } from '@/lib/ai/tools';
import i18n from '@/lib/i18n';

/**
 * Drives the automation engine (task 6.4): builds the id-based
 * {@link ActionContext} over useMeshCore's actions, subscribes the engine to
 * the event bus while the master switch is on and the link is connected
 * (tab-open, live-only per §5), and persists rule edits per-radio. Mounted once
 * by {@link AutomationRunner}. Does not render anything.
 */
export function useAutomation(): void {
  const actions = useMeshCore();
  const enabled = useMeshStore((s) => s.automationEnabled);
  const connected = useMeshStore((s) => s.status === 'connected');
  const rules = useMeshStore((s) => s.automationRules);

  // The useMeshCore actions read the live client from their own closure and get
  // new identities as it changes; hold the latest in a ref so the stable
  // ActionContext below always calls through to the current ones. Updated in an
  // effect (never during render).
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  // Stable id-based surface: resolves contact/channel/advert ids to the objects
  // the useMeshCore actions expect, so transmit/write tools reuse the same
  // `canTransmit` gate manual sends take. Never depends on `actions` identity.
  const actionContext = useMemo<ActionContext>(
    () => ({
      sendDirectMessage: async (prefix, text) => {
        const contact = useMeshStore.getState().contacts[prefix];
        if (!contact) throw new Error(`Unknown contact ${prefix}`);
        await actionsRef.current.sendMessage(text, {
          kind: 'direct',
          id: directConvoId(prefix),
          rawId: prefix,
          label: contact.name,
        });
      },
      sendChannelMessage: async (idx, text) => {
        const channel = useMeshStore.getState().channels[idx];
        if (!channel) throw new Error(`Unknown channel ${idx}`);
        await actionsRef.current.sendMessage(text, {
          kind: 'channel',
          id: channelConvoId(idx),
          rawId: idx,
          label: channel.name || i18n.t('common.channelName', { index: idx }),
        });
      },
      advertise: (flood) => actionsRef.current.advertiseSelf(flood),
      addContact: async (prefix) => {
        const advert = Object.values(useMeshStore.getState().adverts).find(
          (a) => a.pubkeyPrefix === prefix,
        );
        if (!advert) throw new Error(`Unknown advert ${prefix}`);
        await actionsRef.current.addDiscoveredContact(advert);
      },
      removeContact: async (prefix) => {
        const contact = useMeshStore.getState().contacts[prefix];
        if (!contact) throw new Error(`Unknown contact ${prefix}`);
        await actionsRef.current.removeContact(contact);
      },
      toggleFavorite: async (prefix) => {
        const contact = useMeshStore.getState().contacts[prefix];
        if (!contact) throw new Error(`Unknown contact ${prefix}`);
        await actionsRef.current.toggleFavorite(contact);
      },
      resetContactPath: async (prefix) => {
        const contact = useMeshStore.getState().contacts[prefix];
        if (!contact) throw new Error(`Unknown contact ${prefix}`);
        await actionsRef.current.resetContactPath(contact);
      },
    }),
    [],
  );

  // Keep the engine pointed at the current action surface.
  useEffect(() => {
    automationEngine.setContext(actionContext);
  }, [actionContext]);

  // Subscribe only while armed and connected: automation is live-only and
  // tab-open only (§5). On teardown, unsubscribe and abort any in-flight run so
  // a disabled/dropped session goes fully inert.
  useEffect(() => {
    if (!enabled || !connected) return;
    automationEngine.arm();
    const unsub = subscribe((event) => automationEngine.handleEvent(event));
    // Fire a connected edge so connection-status rules can react on arm.
    emit({ type: 'connection', status: 'connected' });
    return () => {
      unsub();
      automationEngine.stop();
    };
  }, [enabled, connected]);

  // Persist rule edits per-radio, encrypted with the same key as history. Only
  // once a session is bound (getStorageContext non-null); the initial restore
  // re-saves the loaded set harmlessly.
  useEffect(() => {
    const ctx = getStorageContext();
    if (!ctx) return;
    void saveAutomationRules(ctx.pubkey, ctx.storageKey, rules);
  }, [rules]);
}
