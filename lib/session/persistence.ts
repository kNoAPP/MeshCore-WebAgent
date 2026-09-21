// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { useMeshStore, selectPreferences } from '@/store/meshStore';
import {
  deleteRadioRecords,
  deriveStorageKey,
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
// Set by {@link beginIdentityHandover} when the radio's key has been replaced
// mid-session. It takes precedence over the pair above, because from that
// moment the outgoing identity is gone from the radio and every further write
// belongs to the incoming one.
let handover: { pubkey: string; key: CryptoKey } | null = null;
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
  // A session binding its own key ends any handover: the reconnect after an
  // identity swap derives exactly the namespace the handover was redirecting
  // to, so leaving it set would shadow the live session's own key forever.
  handover = null;
}

/**
 * Encrypts and writes the current history immediately (bypassing the debounce)
 * so a drop or disconnect can't lose the last messages.
 */
export function flushHistory(client: MeshCoreClient | null): void {
  const t = writeTarget(client);
  if (t) {
    saveRadioData(t.pubkey, t.key, {
      msgHistory: useMeshStore.getState().msgHistory,
    });
  }
}

/**
 * Encrypts and writes the current advert cache immediately (bypassing the
 * debounce) so a drop or disconnect can't lose the latest discovered nodes.
 */
export function flushAdvertCache(client: MeshCoreClient | null): void {
  const t = writeTarget(client);
  if (t) {
    saveAdvertCache(t.pubkey, t.key, useMeshStore.getState().advertCache);
  }
}

/**
 * Encrypts and writes the current per-radio preferences immediately (bypassing
 * the debounce) so a drop or disconnect can't lose the latest preference edit.
 */
export function flushPreferences(client: MeshCoreClient | null): void {
  const t = writeTarget(client);
  if (t) {
    savePreferences(
      t.pubkey,
      t.key,
      selectPreferences(useMeshStore.getState()),
    );
  }
}

/**
 * Encrypts and writes the current automation rules immediately.
 *
 * @remarks The rule editor saves through this rather than reaching for the
 * connect-bound storage context directly, so an identity handover redirects
 * rule edits with everything else — writing them to the outgoing namespace
 * would both lose the edit at the next reboot and recreate the orphan record
 * the handover just collected.
 *
 * Callers must still gate on `prefsHydrated`: the runner mounts with the
 * app's empty default set before the connect flow's restore lands, and writing
 * there would put that empty set over the radio's saved rules.
 */
export function flushAutomationRules(client: MeshCoreClient | null): void {
  const t = writeTarget(client);
  if (t) {
    saveAutomationRules(
      t.pubkey,
      t.key,
      useMeshStore.getState().automationRules,
    );
  }
}

/**
 * Flushes all four per-radio records — history, advert cache, preferences and
 * automation rules. The two paths that end a session — a deliberate disconnect
 * and a drop into the reconnect loop — both have to persist everything, so they
 * share one call rather than each listing them.
 *
 * @remarks Fire-and-forget: the writes are started, not awaited, because
 * the teardown paths run where nothing can wait on IndexedDB. Callers that must
 * know the data actually reached disk before continuing use
 * {@link flushSessionAsync}.
 */
export function flushSession(client: MeshCoreClient | null): void {
  void flushSessionAsync(client);
}

/**
 * {@link flushSession}, awaitable — resolves once all four encrypted writes
 * have been attempted.
 *
 * @remarks For the backup restore, which must not report success while the
 * imported data is still only in memory: a reload in that window would lose it.
 * Individual writes are best-effort and swallow their own failures, so this
 * resolves rather than rejecting. After {@link beginIdentityHandover} this
 * writes the incoming identity's namespace, not the connected radio's.
 *
 * Covers automation rules too, which the debounced path above does not: they
 * are saved by an effect in `useAutomation` that nothing awaits, so a restore
 * would otherwise race that write.
 *
 * @returns whether the data is actually on disk — false when no session key is
 * bound (a reconnect cleared it, or none was ever derived) and false when any
 * of the four writes failed. A caller that reports persistence state must not
 * read a resolved promise as a successful write.
 */
export async function flushSessionAsync(
  client: MeshCoreClient | null,
): Promise<boolean> {
  const t = writeTarget(client);
  return t ? saveSessionNamespace(t.pubkey, t.key) : false;
}

/**
 * Redirects this session's persistence onto an identity the radio has just
 * been given, and writes the four per-radio records there immediately.
 *
 * @remarks For a deliberate identity handover (a backup restore that replaces
 * the radio's key). `CMD_IMPORT_PRIVATE_KEY` does not reboot the radio: the
 * firmware saves the identity, replies OK and reloads contacts, and the app
 * asks the user to reboot. So the link stays up while `selfInfo` still reports
 * the outgoing public key, and every later write — the debounced save
 * subscriptions, the drop into reconnect, a deliberate disconnect — would go
 * on filing data under a namespace the user stops reading from the moment they
 * reboot. Redirecting here keeps the rest of the session's data with the
 * identity that will actually come back, and writing up front makes it durable
 * even when the reboot arrives as a power-cycle or after a reload, where no
 * reconnect in this page session could write anything.
 *
 * Only the four `radios`-store records move. The secrets context in
 * `lib/ai/secret.ts` stays bound to the outgoing identity, so an API key or
 * repeater password saved between the handover and the reboot lands in a
 * namespace nothing reads again — a pre-existing consequence of `selfInfo` not
 * being refreshed, not something this redirect introduces.
 *
 * Cleared by {@link setStorageKey} when the next session binds its own key,
 * and by {@link resetPersistence}.
 *
 * @param pubkey - the incoming identity's public key hex, lowercase, as
 * `SELF_INFO` will report it after the reboot; it is both the record namespace
 * and the key-derivation salt, so its case must match.
 * @returns whether all four writes landed, for callers that report persistence
 * state.
 */
export async function beginIdentityHandover(
  client: MeshCoreClient,
  pubkey: string,
): Promise<boolean> {
  // Read before the derivation below, and from the live write target rather
  // than `selfInfo` — `importPrivateKey` never refreshes `selfInfo`, so on a
  // second restore in one session that would still name the original identity
  // and leave the first restore's namespace behind as a full, readable orphan.
  const outgoing = writeTarget(client)?.pubkey;
  // Channel secrets survive an identity import untouched — the firmware's
  // handler replaces the key pair and reloads contacts, nothing else — so the
  // key the next connect derives is this radio's current secrets salted with
  // the new pubkey.
  const secrets = Object.values(client.channels)
    .map((ch) => ch.secret)
    .filter((s): s is Uint8Array => s != null && s.length > 0);
  handover = { pubkey, key: await deriveStorageKey(secrets, pubkey) };
  const persisted = await saveSessionNamespace(handover.pubkey, handover.key);
  // Only once the data is safely under the incoming identity: a failed write
  // would otherwise make this delete the user's last copy.
  if (persisted && outgoing && outgoing !== pubkey) {
    await deleteRadioRecords(outgoing);
  }
  return persisted;
}

/**
 * The public key whose namespace this session is persisting to right now.
 *
 * @remarks Not the same as `client.selfInfo.pubkey` once a handover has run:
 * `importPrivateKey` never refreshes `selfInfo`, so callers deciding whether a
 * restore changes the identity must ask this rather than the client, or a
 * second restore in one session compares against a public key the radio no
 * longer has.
 *
 * Falls back to the client's own key so a session with no storage key bound
 * still reports the identity it is connected as.
 */
export function persistenceNamespace(
  client: MeshCoreClient | null,
): string | undefined {
  return writeTarget(client)?.pubkey ?? client?.selfInfo?.pubkey;
}

// Where the per-radio records belong right now: the identity a handover moved
// this session onto, or the connected radio's own namespace and session key.
function writeTarget(
  client: MeshCoreClient | null,
): { pubkey: string; key: CryptoKey } | null {
  if (handover) return handover;
  const pubkey = client?.selfInfo?.pubkey;
  return pubkey && storageKey ? { pubkey, key: storageKey } : null;
}

// The one place the set of per-radio records is listed. Both the live-session
// flush and the identity handover write the same four, so a fifth added later
// cannot be wired into one path and forgotten in the other.
async function saveSessionNamespace(
  pubkey: string,
  key: CryptoKey,
): Promise<boolean> {
  const state = useMeshStore.getState();
  const results = await Promise.all([
    saveRadioData(pubkey, key, { msgHistory: state.msgHistory }),
    saveAdvertCache(pubkey, key, state.advertCache),
    savePreferences(pubkey, key, selectPreferences(state)),
    saveAutomationRules(pubkey, key, state.automationRules),
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
  handover = null;
}
