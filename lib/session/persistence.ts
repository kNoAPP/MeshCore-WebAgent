// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { useMeshStore, selectPreferences } from '@/store/meshStore';
import {
  saveRadioData,
  saveAdvertCache,
  savePreferences,
  saveAutomationRules,
} from '@/lib/storage';

const SAVE_DEBOUNCE_MS = 1000;

// The AES-GCM key derived from the connected radio's own secrets. Every write
// below is a no-op until the connect flow hands it over, so a blob can never be
// written under the wrong radio's key.
let storageKey: CryptoKey | null = null;
let saveUnsub: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Independent save subscription/timer for the per-radio advert cache, kept
// separate from message history so a burst of adverts doesn't rewrite the
// (larger) history blob, and vice versa.
let advertSaveUnsub: (() => void) | null = null;
let advertSaveTimer: ReturnType<typeof setTimeout> | null = null;
// Independent save subscription/timer for the per-radio user-preferences blob
// (unit system, contacts view, auto-add config, automation switch, map
// viewport, AI picker). Kept separate from history/advert so a preference
// change writes only the tiny prefs record.
let prefsSaveUnsub: (() => void) | null = null;
let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Hands this session's per-radio encryption key to the persistence layer.
 *
 * @remarks
 * Must be set before {@link wirePersistence}: every flush below silently does
 * nothing without it.
 */
export function setStorageKey(key: CryptoKey): void {
  storageKey = key;
}

/**
 * Encrypts and writes the current history immediately (bypassing the debounce)
 * so a drop or disconnect can't lose the last messages.
 */
export function flushHistory(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    saveRadioData(pubkey, storageKey, {
      msgHistory: useMeshStore.getState().msgHistory,
    });
  }
}

/**
 * Encrypts and writes the current advert cache immediately (bypassing the
 * debounce) so a drop or disconnect can't lose the latest discovered nodes.
 */
export function flushAdvertCache(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    saveAdvertCache(pubkey, storageKey, useMeshStore.getState().advertCache);
  }
}

/**
 * Encrypts and writes the current per-radio preferences immediately (bypassing
 * the debounce) so a drop or disconnect can't lose the latest preference edit.
 */
export function flushPreferences(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    savePreferences(
      pubkey,
      storageKey,
      selectPreferences(useMeshStore.getState()),
    );
  }
}

/**
 * Flushes all three per-radio blobs. The two paths that end a session — a
 * deliberate disconnect and a drop into the reconnect loop — both have to
 * persist everything, so they share one call rather than each listing them.
 *
 * @remarks Fire-and-forget: the three writes are started, not awaited, because
 * the teardown paths run where nothing can wait on IndexedDB. Callers that must
 * know the data actually reached disk before continuing use
 * {@link flushSessionAsync}.
 */
export function flushSession(client: MeshCoreClient | null): void {
  void flushSessionAsync(client);
}

/**
 * {@link flushSession}, awaitable — resolves once all three encrypted writes
 * have been attempted.
 *
 * @remarks For the backup restore, which must not report success (or start a
 * radio write) while the imported data is still only in memory: a reload in
 * that window would lose it. Individual writes are best-effort and swallow
 * their own failures, so this resolves rather than rejecting.
 *
 * Covers automation rules too, which the debounced path above does not: they
 * are saved by an effect in `useAutomation` that nothing awaits, so a restore
 * ending in a reboot would otherwise race that write.
 *
 * @returns whether the data is actually on disk — false when no session key is
 * bound (a reconnect cleared it, or none was ever derived) and false when any
 * of the four writes failed. A caller that reports persistence state must not
 * read a resolved promise as a successful write.
 */
export async function flushSessionAsync(
  client: MeshCoreClient | null,
): Promise<boolean> {
  const pubkey = client?.selfInfo?.pubkey;
  if (!pubkey || !storageKey) return false;
  const state = useMeshStore.getState();
  const results = await Promise.all([
    saveRadioData(pubkey, storageKey, { msgHistory: state.msgHistory }),
    saveAdvertCache(pubkey, storageKey, state.advertCache),
    savePreferences(pubkey, storageKey, selectPreferences(state)),
    saveAutomationRules(pubkey, storageKey, state.automationRules),
  ]);
  return results.every(Boolean);
}

/**
 * Subscribes the three per-radio blobs to their store slices, each on its own
 * debounce.
 *
 * @remarks
 * Wired before the connect flow's best-effort hydrate round-trips, so the
 * now-'connected' link can't accept a send that lands before the subscriptions
 * exist and so goes unpersisted. {@link resetPersistence} undoes all of it.
 */
export function wirePersistence(client: MeshCoreClient): void {
  saveUnsub = useMeshStore.subscribe((state, prev) => {
    if (state.msgHistory === prev.msgHistory) return;
    // Status flickers arrive in bursts — debounce the full-history
    // encrypt-and-write (flushHistory reads the live storageKey set above, so
    // the debounced and immediate writes stay in lock-step).
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushHistory(client);
    }, SAVE_DEBOUNCE_MS);
  });

  advertSaveUnsub = useMeshStore.subscribe((state, prev) => {
    if (state.advertCache === prev.advertCache) return;
    // Debounce the encrypt-and-write like history, so a busy mesh's stream of
    // adverts coalesces into one write.
    if (advertSaveTimer) clearTimeout(advertSaveTimer);
    advertSaveTimer = setTimeout(() => {
      advertSaveTimer = null;
      flushAdvertCache(client);
    }, SAVE_DEBOUNCE_MS);
  });

  prefsSaveUnsub = useMeshStore.subscribe((state, prev) => {
    // Any of the per-radio preference fields changing triggers one debounced
    // encrypt-and-write of the whole (tiny) prefs blob.
    if (
      state.unitSystem === prev.unitSystem &&
      state.contactView === prev.contactView &&
      state.autoAddConfig === prev.autoAddConfig &&
      state.automationEnabled === prev.automationEnabled &&
      state.mapPrefs === prev.mapPrefs &&
      state.mapFilters === prev.mapFilters &&
      state.aiPref === prev.aiPref &&
      state.notifyPref === prev.notifyPref &&
      state.showFullPublicKeys === prev.showFullPublicKeys
    ) {
      return;
    }
    // Disarming automation (kill switch or toggle) is safety-relevant and must
    // persist "for good" — write it immediately rather than risking the
    // debounce window to a tab close or a link drop.
    if (prev.automationEnabled && !state.automationEnabled) {
      if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
      prefsSaveTimer = null;
      flushPreferences(client);
      return;
    }
    if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(() => {
      prefsSaveTimer = null;
      flushPreferences(client);
    }, SAVE_DEBOUNCE_MS);
  });
}

/**
 * Drops every pending write, subscription, and the radio-derived key, so a
 * previous radio's persistence can't survive into the next session.
 */
export function resetPersistence(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveUnsub?.();
  saveUnsub = null;
  if (advertSaveTimer) clearTimeout(advertSaveTimer);
  advertSaveTimer = null;
  advertSaveUnsub?.();
  advertSaveUnsub = null;
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = null;
  prefsSaveUnsub?.();
  prefsSaveUnsub = null;
  storageKey = null;
}
