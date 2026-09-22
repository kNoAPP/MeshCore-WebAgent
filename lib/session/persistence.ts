// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import type { Channel } from '@/types/meshcore';
import { useMeshStore, selectPreferences } from '@/store/meshStore';
import {
  getStorageContext,
  reencryptApiKey,
  setSecretContext,
  wipeApiKey,
} from '@/lib/ai/secret';
import { reencryptRepeaterCreds } from '@/lib/meshcore/adminCreds';
import {
  onIdentityKeyRegistered,
  registeredIdentityKey,
} from '@/lib/identity/storageRoot';
import { toHex } from '@/lib/utils';
import {
  deleteRadioRecords,
  hasSeedMarker,
  deriveStorageKey,
  reencryptRadioRecords,
  saveRadioData,
  saveAdvertCache,
  savePreferences,
  saveAutomationRules,
  type RadioRecord,
} from '@/lib/storage';

const SAVE_DEBOUNCE_MS = 1000;

// The namespace every write below goes to and the AES-GCM key it is written
// under, bound together. Every write is a no-op until the connect flow binds
// them, so a blob can never be written under the wrong radio's key. Held as a
// pair rather than read from `selfInfo` at write time: an identity import
// refreshes `selfInfo` without the store's data necessarily moving with it,
// and a namespace written under another identity's key is a record nothing
// can decrypt. The channel set the key was derived from rides along, so a
// later change to it can be told apart from a mirror update that changed
// nothing the key depends on (see {@link followChannelSecrets}).
let binding: Binding | null = null;
// The last binding made, kept past {@link resetPersistence} while a re-key is
// still queued: a session torn down mid re-key left its records under this
// key, and the re-key still has to move them. Dropped by the reset or once
// the queue drains with nothing bound; an identity switch, which unbinds
// without a reset, keeps it until the restart's reset.
let lastBound: Binding | null = null;
// Serializes re-keys, so two channel updates in quick succession cannot
// derive in parallel and bind whichever finishes last.
let rekeyChain: Promise<unknown> = Promise.resolve();
let rekeysPending = 0;
// Set by {@link beginIdentitySwitch}: the store holds an identity's data that
// may be written nowhere until the session restarts. Distinct from a merely
// unbound session, which has simply not derived a key yet.
let switchPending = false;
// The public key a backup restore was meant for, while that restore exists
// only in the live store because its encrypted write failed. Deliberately
// outlives the per-session reset in {@link resetPersistence}: the reconnect
// it protects runs that reset first. See {@link claimUnsavedRestore}.
let unsavedRestore: string | null = null;
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
 * A per-radio storage key and the channel set it was derived from.
 */
export interface ChannelKey {
  key: CryptoKey;
  /**
   * The client's live channel mirror the key was derived from, by reference:
   * it identifies the session the key belongs to.
   */
  channels: Record<number, Channel>;
  /**
   * The derivation's secret material as hex, in slot order; null for a
   * seed-born identity's key, which comes from its vault's storage root and
   * so does not follow the channels (see {@link deriveSessionKey}).
   */
  material: string | null;
}

/**
 * The storage key an identity's records are sealed under: its vault-derived
 * key when it is seed-born and this tab holds one (`registeredIdentityKey`),
 * otherwise the key derived from the radio's channel secrets.
 *
 * @remarks A seed-born identity (`hasSeedMarker`) whose key is not held here
 * has no key to give: the channel-secret one would seal its records under
 * public material and hide the ones already written. Every caller binds
 * nothing for it then, until its vault is opened.
 * @param channels - the client's channel mirror, keyed by slot.
 * @param pubkey - as for {@link deriveChannelKey}.
 * @returns null for a seed-born identity whose vault has not been opened in
 * this tab.
 */
export async function deriveSessionKey(
  channels: Record<number, Channel>,
  pubkey: string,
): Promise<ChannelKey | null> {
  const key = registeredIdentityKey(pubkey);
  if (key) return { key, channels, material: null };
  if (await hasSeedMarker(pubkey)) return null;
  return deriveChannelKey(channels, pubkey);
}

// A seed-born identity's key registered while the session is bound to that
// identity under its channel-secret key — its vault opened only now, as for an
// identity minted before its records were keyed from the root. Everything the
// session keeps for it moves onto the vault-derived key, as a re-key does,
// so nothing more is written under public material.
onIdentityKeyRegistered((pubkey, key) => {
  if (binding?.pubkey === pubkey && binding.material !== null) {
    rebindToIdentityKey(pubkey, key);
  }
});

// Queued like a re-key. Like one, it waits while the session is bound but not
// yet wired: the connect flow's hydrate is still reading under the channel
// key, and writing under it would race those reads. wirePersistence catches
// up then.
function rebindToIdentityKey(pubkey: string, key: CryptoKey): void {
  rekeysPending++;
  rekeyChain = rekeyChain
    .then(async () => {
      const from = binding;
      if (from?.pubkey !== pubkey || from.material === null || !saveUnsub) {
        return;
      }
      setStorageKey(pubkey, { key, channels: from.channels, material: null });
      if (getStorageContext()?.pubkey === pubkey) setSecretContext(pubkey, key);
      await Promise.all([
        saveSessionNamespace(pubkey, key),
        reencryptApiKey(pubkey, from.key, key),
        reencryptRepeaterCreds(pubkey, from.key, key),
      ]);
    })
    .catch(() => {})
    .finally(() => {
      if (--rekeysPending === 0 && !binding) lastBound = null;
    });
}

/**
 * Derives the storage key for `pubkey` from a radio's current channel
 * secrets, recording which secrets it came from.
 *
 * @param channels - the client's channel mirror, keyed by slot.
 * @param pubkey - the identity's public key hex, lowercase, as `SELF_INFO`
 * reports it: it is the derivation's salt.
 */
export async function deriveChannelKey(
  channels: Record<number, Channel>,
  pubkey: string,
): Promise<ChannelKey> {
  // Read before the derivation's await, so the material recorded is the one
  // the key was actually derived from even if the mirror moves meanwhile.
  const secrets = Object.values(channels)
    .map((ch) => ch.secret)
    .filter((s): s is Uint8Array => s != null && s.length > 0);
  const material = secrets.map((s) => toHex(s)).join('');
  return { key: await deriveStorageKey(secrets, pubkey), channels, material };
}

/**
 * Binds this session's persistence to a radio identity: the namespace its
 * records are written under, and the per-radio key that encrypts them.
 *
 * @remarks
 * Must be set before {@link wirePersistence}: every flush below silently does
 * nothing without it.
 *
 * @param pubkey - the identity's public key hex, lowercase, as `SELF_INFO`
 * reports it; `key` must have been derived with it by
 * {@link deriveSessionKey}.
 */
export function setStorageKey(pubkey: string, key: ChannelKey): void {
  binding = lastBound = { pubkey, ...key };
  switchPending = false;
}

type Binding = { pubkey: string } & ChannelKey;

/**
 * Keeps the session's storage key in step with the radio's channel secrets,
 * which it is derived from.
 *
 * @remarks Call on every channel mirror update. When the secrets differ from
 * the ones the bound key came from — a channel added, removed or rewritten,
 * or a slot the connect sync could not read arriving later — the next connect
 * will derive a different key, and every record written under this one would
 * read as absent there and then be overwritten. So the key is re-derived and
 * rebound, the four per-radio records are written under it straight away, and
 * the secrets store is re-encrypted to it.
 *
 * A session torn down before its re-key finished (a disconnect or a drop
 * right after a channel change) flushed its records under the outgoing key
 * and reset the store, so those records are re-encrypted on disk instead.
 * An update for a mirror no binding came from is a no-op: a session that has
 * not bound a key yet, or an older client's. So is one that arrives while
 * an identity handover owns the session, which follows the channels itself
 * once bound. An update before {@link wirePersistence} waits for it: the store
 * has not been hydrated yet, and writing it would put an empty session over
 * the records the hydrate is still reading under the outgoing key.
 *
 * A seed-born identity's key does not come from the channels, so a binding
 * made with one (`material` null) never re-keys.
 *
 * Fire-and-forget, and best-effort like the writes it makes. The records the
 * outgoing key encrypted are overwritten in place rather than deleted.
 */
export function followChannelSecrets(channels: Record<number, Channel>): void {
  rekeysPending++;
  rekeyChain = rekeyChain
    .then(() => rekey(channels))
    .catch(() => {})
    .finally(() => {
      if (--rekeysPending === 0 && !binding) lastBound = null;
    });
}

async function rekey(channels: Record<number, Channel>): Promise<void> {
  // Not the last binding while an identity switch is pending: its records
  // were flushed under the outgoing identity's channels, which are the ones
  // that identity gets back when it next goes live. A channel change now is
  // the incoming identity's, and following it would lock them away.
  const from =
    binding?.channels === channels
      ? binding
      : lastBound?.channels === channels && !binding && !switchPending
        ? lastBound
        : null;
  if (!from || from.material === null || (from === binding && !saveUnsub)) {
    return;
  }
  const next = await deriveChannelKey(channels, from.pubkey);
  if (next.material === from.material) return;
  // Another binding for this mirror (an identity handover) owns the session
  // now, and follows the channels itself once it is bound.
  if (binding !== from && binding?.channels === channels) return;
  const live = binding === from && saveUnsub !== null;
  if (live) {
    setStorageKey(from.pubkey, next);
    if (getStorageContext()?.pubkey === from.pubkey) {
      setSecretContext(from.pubkey, next.key);
    }
  } else if (lastBound === from) {
    lastBound = { pubkey: from.pubkey, ...next };
  }
  // A torn-down session's flush is fire-and-forget; its writes started before
  // the derivation above and are assumed to have landed before the re-encrypt
  // reads them.
  // Queued in the same synchronous step as the rebind above: each secret
  // module's saves and clears already queued run first, under the key they
  // captured, and every later one captures the new key.
  await Promise.all([
    live
      ? saveSessionNamespace(from.pubkey, next.key)
      : reencryptRadioRecords(from.pubkey, from.key, next.key),
    reencryptApiKey(from.pubkey, from.key, next.key),
    reencryptRepeaterCreds(from.pubkey, from.key, next.key),
  ]);
}

/**
 * Encrypts and writes the current history immediately (bypassing the debounce)
 * so a drop or disconnect can't lose the last messages.
 */
export function flushHistory(): void {
  const t = binding;
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
export function flushAdvertCache(): void {
  const t = binding;
  if (t) {
    saveAdvertCache(t.pubkey, t.key, useMeshStore.getState().advertCache);
  }
}

/**
 * Encrypts and writes the current per-radio preferences immediately (bypassing
 * the debounce) so a drop or disconnect can't lose the latest preference edit.
 */
export function flushPreferences(): void {
  const t = binding;
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
 * secrets context, so rule edits follow the same binding as everything else —
 * writing them anywhere else after an identity handover would both lose the
 * edit at the next reboot and recreate the orphan record the handover just
 * collected.
 *
 * Callers must still gate on `prefsHydrated`: the runner mounts with the
 * app's empty default set before the connect flow's restore lands, and writing
 * there would put that empty set over the radio's saved rules.
 */
export function flushAutomationRules(): void {
  const t = binding;
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
export function flushSession(): void {
  void flushSessionAsync();
}

/**
 * {@link flushSession}, awaitable — resolves once all four encrypted writes
 * have been attempted.
 *
 * @remarks For the backup restore, which must not report success while the
 * imported data is still only in memory: a reload in that window would lose it.
 * Individual writes are best-effort and swallow their own failures, so this
 * resolves rather than rejecting. It writes whichever identity the session is
 * bound to, which after {@link beginIdentityHandover} is the incoming one.
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
export async function flushSessionAsync(): Promise<boolean> {
  const t = binding;
  return t ? saveSessionNamespace(t.pubkey, t.key) : false;
}

/**
 * Moves this session onto an identity the radio has just been given: binds
 * persistence and the secrets context to it, writes the four per-radio
 * records there immediately, and re-reads `SELF_INFO` so the session reports
 * the key the radio now holds.
 *
 * @remarks For a deliberate identity handover, where this browser's data moves
 * with the key (a backup restore, a regenerate). `CMD_IMPORT_PRIVATE_KEY` does
 * not reboot the radio and the link stays up, so the records are written here:
 * the data must survive a later reboot or reconnect, which may be a
 * power-cycle or follow a page reload, where nothing in this page session
 * could write it.
 *
 * `APP_START` reports the incoming key from the import on, so the re-read
 * shows it in Settings and pairs a backup exported before the radio next
 * restarts with the private key the radio exports. Moving the secrets context
 * files a secret saved before the next session where that session looks for
 * it, and unloads the outgoing identity's in-memory API key: secrets never
 * cross identities.
 *
 * The re-read is best-effort; the next reconnect reads `SELF_INFO` afresh.
 * Persistence is bound to `pubkey` either way, so nothing in between is filed
 * under the outgoing identity, and where this session's data lives is a
 * question for {@link boundPubkey}, not `selfInfo`.
 *
 * The outgoing identity's records are deleted once the incoming ones have
 * landed: that identity is gone from the radio, and its namespace would be an
 * orphan nothing collects.
 *
 * @param pubkey - the incoming identity's public key hex, lowercase, derived
 * from the private key that was imported; it is both the record namespace and
 * the key-derivation salt, so its case must match.
 * @returns whether all four writes landed, for callers that report persistence
 * state; false, with nothing written or bound, for a seed-born identity whose
 * vault is not open in this tab.
 */
export async function beginIdentityHandover(
  client: MeshCoreClient,
  pubkey: string,
): Promise<boolean> {
  const outgoing = binding?.pubkey;
  const key = await deriveSessionKey(client.channels, pubkey);
  if (!key) {
    // A seed-born identity whose vault is not open here: nothing may be
    // written for it yet, and the store already holds its data, so nothing
    // may be written for the outgoing identity either. The session runs
    // unbound until the restart asks for the vault; the caller marks the
    // store's data an unsaved restore, which that unlock then writes.
    binding = null;
    switchPending = true;
    wipeApiKey();
    await client.refreshSelfInfo().catch(() => {});
    return false;
  }
  // Bound before the re-read, which hands the refreshed `selfInfo` to the
  // store: whatever reacts to the new identity finds its namespace and its
  // secrets already in place.
  setStorageKey(pubkey, key);
  setSecretContext(pubkey, key.key);
  // The key was derived from the channels as they were before its await; a
  // channel change during it was left for this binding to follow.
  followChannelSecrets(client.channels);
  const persisted = await saveSessionNamespace(pubkey, key.key);
  await client.refreshSelfInfo().catch(() => {});
  // Only once the data is safely under the incoming identity: a failed write
  // would otherwise make this delete the user's last copy.
  if (persisted && outgoing && outgoing !== pubkey) {
    await deleteRadioRecords(outgoing);
  }
  return persisted;
}

/**
 * Moves this session onto an identity the radio has just been given whose
 * data this store does not hold: persists the outgoing identity's records
 * where they are, then stops writing them, binds the secrets context to the
 * incoming identity, re-reads `SELF_INFO`, and clears the outgoing identity's
 * data from the store (`resetIdentityData`).
 *
 * @remarks For a restore from a recovery phrase or a persona switch, where
 * the incoming identity keeps whatever records it already has here. Nothing
 * persists until the session restarts and binds the incoming identity, which
 * is the caller's to do. That restart merges the identity's saved history into
 * the store rather than replacing it, as every reconnect does, so the store is
 * cleared here: whatever it still held of the outgoing identity would be filed
 * under the incoming one, linking the two. Until the restart
 * {@link identitySwitchPending} reports true, so nothing merges more data into
 * the store. The secrets context has no such conflict, so a secret saved
 * before that restart is filed where the next session looks for it.
 *
 * A channel change after this is the incoming identity's, and does not re-key
 * the outgoing identity's records: they stay under the channel set that
 * identity had, which is the one a persona switch gives back to it.
 *
 * @param pubkey - as for {@link beginIdentityHandover}; null for a burner,
 * for which nothing may be stored at all: the secrets context is dropped
 * instead, along with any API key held in memory for the outgoing identity.
 */
export async function beginIdentitySwitch(
  client: MeshCoreClient,
  pubkey: string | null,
): Promise<void> {
  // A re-key still queued is the outgoing identity's, and has to land before
  // the flush below writes under whichever key is bound.
  await rekeyChain;
  await flushSessionAsync();
  binding = null;
  switchPending = true;
  const incoming =
    pubkey === null ? null : await deriveSessionKey(client.channels, pubkey);
  // A burner stores nothing, and a seed-born identity whose vault is not open
  // has no key yet: either way no secrets context carries over.
  if (pubkey === null || !incoming) {
    wipeApiKey();
  } else {
    setSecretContext(pubkey, incoming.key);
  }
  await client.refreshSelfInfo().catch(() => {});
  // After the last await: a persona switch installs the key only once this
  // returns, so the radio is still the outgoing identity until then, and
  // anything it received meanwhile has to be cleared along with the rest.
  useMeshStore.getState().resetIdentityData();
}

/**
 * Whether {@link beginIdentitySwitch} has moved the radio onto an identity the
 * store's data does not belong to, and the session has not restarted since.
 * Nothing may add to the store's persisted data meanwhile: there is no
 * namespace it could be written to.
 */
export function identitySwitchPending(): boolean {
  return switchPending;
}

/**
 * The public key whose namespace this session's records are written to, or
 * undefined while nothing is bound.
 *
 * @remarks Usually `selfInfo.pubkey`, but it is what decides where data lives:
 * after an identity handover whose `SELF_INFO` re-read failed, `selfInfo`
 * still names the outgoing identity while the binding has already moved.
 */
export function boundPubkey(): string | undefined {
  return binding?.pubkey;
}

/**
 * Writes the four per-radio records under an identity the radio is about to
 * be given, without redirecting this session to it.
 *
 * @remarks For an import whose outcome may never be confirmed: a timeout or a
 * dropped link can hide a key the radio did install, and the reconnect then
 * comes back under a namespace nothing was written to. Writing it first means
 * the data is there whichever identity returns; the outgoing namespace is left
 * alone, since the radio may still be on it. Follow a confirmed import with
 * {@link beginIdentityHandover}, and a refused one with `deleteRadioRecords`.
 *
 * @param pubkey - as for {@link beginIdentityHandover}.
 * @returns whether all four writes landed; false, with nothing written, for a
 * seed-born identity whose vault is not open in this tab.
 */
export async function seedIdentityNamespace(
  client: MeshCoreClient,
  pubkey: string,
): Promise<boolean> {
  const derived = await deriveSessionKey(client.channels, pubkey);
  return derived ? saveSessionNamespace(pubkey, derived.key) : false;
}

/**
 * Records that a backup restore for `pubkey` is live in the store but did not
 * reach encrypted storage.
 *
 * @remarks Without this, the next connect as `pubkey` — the reboot after an
 * identity restore, or any drop and reconnect — reads a blob that is absent
 * (or older than the restore) and normalizes the restored preferences and
 * automation rules out of the live store, a loss the "session only" warning
 * never mentioned. Scoped to one public key rather than to "any empty read":
 * a reconnect can come back as a different radio on a shared endpoint, and
 * that one must still get its own defaults, not this restore's values.
 *
 * @param pubkey - the namespace the restore should have been written to, in
 * the lowercase hex `SELF_INFO` reports.
 */
export function markUnsavedRestore(pubkey: string): void {
  unsavedRestore = pubkey;
}

/**
 * Whether the connect-time hydrate for `pubkey` must keep the store's
 * preferences and automation rules rather than load the stored ones.
 *
 * @remarks True only for the identity {@link markUnsavedRestore} named. Any
 * other radio's hydrate clears the mark, because it replaces the store with
 * that radio's data and the restore is no longer what memory holds. A match
 * leaves the mark set until {@link retryUnsavedRestore} actually lands the
 * data, so a write that fails again is still protected on the next reconnect.
 */
export function claimUnsavedRestore(pubkey: string): boolean {
  if (unsavedRestore === pubkey) return true;
  unsavedRestore = null;
  return false;
}

/**
 * Writes the four per-radio records for a session whose hydrate honoured an
 * unsaved restore, and clears the mark once they are on disk.
 */
export async function retryUnsavedRestore(): Promise<void> {
  const pubkey = unsavedRestore;
  if (pubkey && (await flushSessionAsync()) && unsavedRestore === pubkey) {
    unsavedRestore = null;
  }
}

/**
 * Forgets an unsaved restore. For a session teardown, which resets the store
 * and so discards the in-memory data the mark was protecting.
 */
export function dropUnsavedRestore(): void {
  unsavedRestore = null;
}

// Writes every per-radio record, keyed by `RadioRecord`: the list in
// `lib/storage.ts` that `deleteRadioRecords` also derives from, so a record
// added there fails to type-check here until it is written. Both the
// live-session flush and the identity handover save through this.
async function saveSessionNamespace(
  pubkey: string,
  key: CryptoKey,
): Promise<boolean> {
  const state = useMeshStore.getState();
  const writes: Record<RadioRecord, Promise<boolean>> = {
    history: saveRadioData(pubkey, key, { msgHistory: state.msgHistory }),
    'advert-cache': saveAdvertCache(pubkey, key, state.advertCache),
    preferences: savePreferences(pubkey, key, selectPreferences(state)),
    'automation-rules': saveAutomationRules(pubkey, key, state.automationRules),
  };
  const results = await Promise.all(Object.values(writes));
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
 *
 * Also catches the storage key up with a channel change that arrived before
 * the store was hydrated (see {@link followChannelSecrets}), and with a
 * seed-born identity's key registered meanwhile.
 */
export function wirePersistence(): void {
  saveUnsub = useMeshStore.subscribe((state, prev) => {
    if (state.msgHistory === prev.msgHistory) return;
    // Status flickers arrive in bursts — debounce the full-history
    // encrypt-and-write (flushHistory reads the live binding, so the debounced
    // and immediate writes stay in lock-step).
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushHistory();
    }, SAVE_DEBOUNCE_MS);
  });

  advertSaveUnsub = useMeshStore.subscribe((state, prev) => {
    if (state.advertCache === prev.advertCache) return;
    // Debounce the encrypt-and-write like history, so a busy mesh's stream of
    // adverts coalesces into one write.
    if (advertSaveTimer) clearTimeout(advertSaveTimer);
    advertSaveTimer = setTimeout(() => {
      advertSaveTimer = null;
      flushAdvertCache();
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
      state.showFullPublicKeys === prev.showFullPublicKeys &&
      state.identityAccent === prev.identityAccent
    ) {
      return;
    }
    // Disarming automation (kill switch or toggle) is safety-relevant and must
    // persist "for good" — write it immediately rather than risking the
    // debounce window to a tab close or a link drop.
    if (prev.automationEnabled && !state.automationEnabled) {
      if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
      prefsSaveTimer = null;
      flushPreferences();
      return;
    }
    if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(() => {
      prefsSaveTimer = null;
      flushPreferences();
    }, SAVE_DEBOUNCE_MS);
  });

  if (binding) {
    followChannelSecrets(binding.channels);
    // A seed-born identity's key registered while the hydrate ran: the rebind
    // waited for this.
    const key = registeredIdentityKey(binding.pubkey);
    if (key && binding.material !== null) {
      rebindToIdentityKey(binding.pubkey, key);
    }
  }
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
  binding = null;
  if (rekeysPending === 0) lastBound = null;
  switchPending = false;
}
