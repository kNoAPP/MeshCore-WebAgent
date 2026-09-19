// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { saveSecret, loadSecret, clearSecret } from '@/lib/storage';
import { useMeshStore } from '@/store/meshStore';

// The BYO LLM API key lives ONLY in this module-scoped variable for the tab's
// lifetime (mirroring how useMeshCore holds storageKey at module scope). It is
// never placed in any serialized slice, log, toast, error, audit entry, or URL
// — the sole egress is the provider request's `x-api-key` header (task 6.3).
// The masked lifecycle status is mirrored into the store for reactive UI; the
// value itself never is.

const API_KEY_NAME = 'llm-api-key';

let apiKey: string | null = null;
let persisted = false;

/**
 * The per-radio crypto context every encrypted record is read and written
 * under: the radio's public key hex (the record namespace) and the AES-256-GCM
 * key derived from that radio's own secrets.
 */
export interface StorageContext {
  pubkey: string;
  storageKey: CryptoKey;
}

// The per-radio crypto context used for at-rest encryption, set on connect and
// cleared on teardown. Reuses the CryptoKey derived by useMeshCore — there is
// no second key-derivation path.
let ctx: StorageContext | null = null;

// Binding that context is asynchronous — useMeshCore derives the key with
// PBKDF2 at 100k iterations — and every encrypted read is gated on it, so a
// read that arrives first would take the unbound context for an empty store and
// keep that answer forever. The connect flow declares the binding pending as
// soon as it knows which radio is there; `awaitStorageContext` holds those
// reads until it lands, or until the session ends without one.
let pendingCtx: {
  promise: Promise<StorageContext | null>;
  settle: (value: StorageContext | null) => void;
} | null = null;

/** Releases every read waiting on the binding with its outcome. */
function settlePending(value: StorageContext | null): void {
  pendingCtx?.settle(value);
  pendingCtx = null;
}

// Bumped by every explicit key mutation (set/forget/wipe). A key mutation
// racing an in-flight async op (persist, or a restore reading from disk) is
// detected by comparing this counter across the await, so the slower op never
// clobbers a newer value.
let generation = 0;

// All at-rest secret I/O funnels through this promise chain so overlapping
// mutations hit IndexedDB in call order. Without it, two rapid saves whose
// encryption finishes out of order could land in the wrong order and leave a
// stale key on disk to resurface on the next connect.
let ioChain: Promise<unknown> = Promise.resolve();

// A "don't remember this" save or an explicit Forget can be made before the
// session binds its encryption context — the app reports `connected` first — or
// its delete can simply fail. Either way the removal is still owed, so it is
// recorded against the radio it belongs to and retried on the next connect to
// that radio. Keyed by pubkey rather than held as one flag: two radios can each
// be owed one, and a debt must never be settled against the wrong record.
const clearOwedFor = new Set<string>();

/**
 * The radio a deletion requested right now would belong to. Falls back to
 * `selfInfo`, which the sync fills in before the encryption context is bound,
 * so a request made in that window is still attributed correctly.
 */
function owingPubkey(): string | null {
  return ctx?.pubkey ?? useMeshStore.getState().selfInfo?.pubkey ?? null;
}

/** Whether the record for {@link pubkey} is one the user asked to be rid of. */
function clearIsOwed(pubkey: string): boolean {
  return clearOwedFor.has(pubkey);
}

/** Runs an owed delete for {@link pubkey}, keeping the debt if it fails. */
async function settleOwedClear(pubkey: string): Promise<boolean> {
  const ok = await enqueue(() => clearSecret(pubkey, API_KEY_NAME));
  if (ok) clearOwedFor.delete(pubkey);
  else clearOwedFor.add(pubkey);
  return ok;
}

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = ioChain.then(op, op);
  // Keep the chain alive whether the op resolved or rejected, and drop the
  // settled value so the tail doesn't retain it.
  ioChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function syncStatus(): void {
  useMeshStore
    .getState()
    .setAiKeyStatus(
      apiKey === null ? 'none' : persisted ? 'persisted' : 'memory',
    );
}

/**
 * Returns the in-memory API key for a provider request, or null if none is
 * loaded. The only caller should be the provider layer (task 6.3); never log
 * or copy the result.
 */
export function getApiKey(): string | null {
  return apiKey;
}

/**
 * Declares that a per-radio encryption context is on its way, so encrypted
 * reads made before it is bound wait for it rather than concluding that
 * nothing is stored.
 *
 * @remarks
 * Called by the connect flow as soon as the radio's pubkey is known and before
 * the key derivation it then awaits. {@link setSecretContext} settles the wait
 * with the context, {@link releaseSecretContext} with whatever is bound when
 * the attempt ends without binding one, and {@link wipeApiKey} with null on a
 * teardown. A second call while one is already pending keeps the first — both
 * are waiting on the same binding.
 */
export function expectSecretContext(): void {
  if (pendingCtx) return;
  let settle!: (value: StorageContext | null) => void;
  const promise = new Promise<StorageContext | null>((resolve) => {
    settle = resolve;
  });
  pendingCtx = { promise, settle };
}

/**
 * Answers every read still waiting on a declared binding with null, the
 * truthful answer for a session that ended before it bound one. A no-op once
 * {@link setSecretContext} has settled the wait.
 *
 * @remarks
 * Pairs with {@link expectSecretContext} in a `finally`, so a key derivation
 * that throws, or a session torn down while it ran, cannot leave a read
 * waiting on a binding that will never be made. Deliberately not the context
 * that happens to be bound: a reconnect keeps the previous session's one
 * alive, and that session may be a different radio (see
 * {@link setSecretContext}) whose key must never answer this radio's read.
 */
export function releaseSecretContext(): void {
  settlePending(null);
}

/**
 * Binds the per-radio encryption context for later persistence. Called once
 * per session after {@link deriveStorageKey} in useMeshCore.
 */
export function setSecretContext(pubkey: string, storageKey: CryptoKey): void {
  // A reconnect keeps the in-memory key alive for the same radio, but if the
  // link came back on a *different* radio (e.g. a shared WiFi address now
  // answered by another device), that key must not carry over — drop it so it
  // can't be used for the wrong radio and so this radio's own remembered key
  // can load in its place.
  if (ctx !== null && ctx.pubkey !== pubkey && apiKey !== null) {
    generation++;
    apiKey = null;
    persisted = false;
    syncStatus();
  }
  ctx = { pubkey, storageKey };
  settlePending(ctx);
  // Settle a deletion the user asked for but that never landed — before this
  // context existed, or because its write failed — so a remembered copy they
  // declined or forgot can't survive into this session. `enqueue` runs it ahead
  // of the restore useMeshCore kicks off next, which checks the obligation
  // before loading anything.
  if (clearIsOwed(pubkey)) {
    void settleOwedClear(pubkey);
  }
}

/**
 * The active per-radio storage context (pubkey + AES key), or null when no
 * session is bound. Reused by automation-rule persistence so it shares the
 * single {@link deriveStorageKey} path rather than inventing a second one.
 *
 * @remarks
 * Null here means "not bound *yet*" just as readily as "no session", so a read
 * that must tell an empty store from an unfinished connect uses
 * {@link awaitStorageContext} instead.
 */
export function getStorageContext(): StorageContext | null {
  return ctx;
}

/**
 * The active per-radio storage context, waiting for the binding when the
 * connect flow has declared one is coming.
 *
 * @returns the bound context, or null once it is settled that there will be
 * none — which, unlike a null from {@link getStorageContext}, is a final answer
 * and so safe to read as "this radio has nothing stored".
 */
export function awaitStorageContext(): Promise<StorageContext | null> {
  // A declared binding wins over one already bound, because a reconnect can
  // land on a *different* radio (see setSecretContext) — answering from the
  // previous session's context would hand out the wrong radio's key, and the
  // whole point of deriving one per radio is that it cannot read another's
  // records.
  if (pendingCtx) return pendingCtx.promise;
  return Promise.resolve(ctx);
}

/**
 * Sets the active API key in memory, optionally persisting an encrypted copy on
 * this device.
 *
 * @param value - the plaintext key the user provided.
 * @param remember - when true, encrypt-at-rest with the connected radio's key
 * so it restores on the next connect to the same radio; a different radio can't
 * decrypt it. Fails without an active radio encryption context.
 * @returns whether persistence or removal of a previous remembered copy
 * succeeded without being superseded. The in-memory key is set either way.
 */
export async function setApiKey(
  value: string,
  remember: boolean,
): Promise<boolean> {
  const mine = ++generation;
  apiKey = value;
  persisted = false;
  syncStatus();
  // Capture the context so the queued write targets this radio even if the
  // session is torn down (ctx nulled) before the op runs.
  const active = ctx;
  if (!active) {
    // Nothing can be written or deleted yet. Owe the deletion against the radio
    // being connected to, so a remembered copy the user has just declined is
    // removed as soon as a context exists, and report the failure rather than
    // claiming a removal that hasn't happened.
    if (!remember) {
      const owed = owingPubkey();
      if (owed) clearOwedFor.add(owed);
    }
    return false;
  }

  let landed = false;
  if (remember) {
    // Only report the key as persisted if the encrypted write actually landed;
    // saveSecret is best-effort and can silently fail (quota, private mode).
    landed = await enqueue(() =>
      saveSecret(active.pubkey, active.storageKey, API_KEY_NAME, value),
    );
  } else {
    // Drop any previously remembered copy so a stale key can't silently
    // resurface on the next connect to this radio.
    if (!(await settleOwedClear(active.pubkey))) return false;
  }
  // A wipe/forget/another setApiKey during the await supersedes this one; don't
  // report persistence state for a key that's no longer active.
  if (generation !== mine) return false;
  if (remember && landed) {
    // The user has deliberately replaced the record an earlier failed removal
    // was owed on, so that debt is settled by the replacement.
    clearOwedFor.delete(active.pubkey);
  }
  persisted = landed;
  syncStatus();
  return remember ? landed : true;
}

/**
 * Restores a previously "remembered" key for the connected radio into memory.
 *
 * @returns true if a persisted key was found and loaded.
 */
export async function loadPersistedApiKey(): Promise<boolean> {
  const active = ctx;
  if (!active) return false;
  const mine = generation;
  const value = await enqueue(() =>
    loadSecret(active.pubkey, active.storageKey, API_KEY_NAME),
  );
  // Discard the restore if, during the await, the session was torn down /
  // switched radios (ctx changed) or the user explicitly set/forgot a key
  // (generation changed) — never resurrect a key onto a dead context or clobber
  // a newer value the user just chose. Also stand down if a key is already in
  // memory: a reconnect keeps the live key, and a key entered during the
  // connect window must not be overwritten by the remembered one. A deletion
  // still owed means this record is one the user already asked to be rid of.
  if (
    value === null ||
    clearIsOwed(active.pubkey) ||
    ctx !== active ||
    generation !== mine ||
    apiKey !== null
  ) {
    return false;
  }
  apiKey = value;
  persisted = true;
  syncStatus();
  return true;
}

/**
 * Wipes the in-memory key and deletes any persisted copy for the connected
 * radio. Use for an explicit "forget key" action.
 * @returns whether the persisted copy was removed. False when no context is
 * bound yet or the delete failed — the removal stays owed either way, and is
 * retried on the next connect to that radio, so the key can't come back.
 */
export async function forgetApiKey(): Promise<boolean> {
  generation++;
  apiKey = null;
  persisted = false;
  const active = ctx;
  syncStatus();
  if (!active) {
    const owed = owingPubkey();
    if (owed) clearOwedFor.add(owed);
    return false;
  }
  return settleOwedClear(active.pubkey);
}

/**
 * Wipes only the in-memory key and context (disconnect, kill switch, page
 * unload). Any persisted copy stays on the device for the next connect.
 * Overwrites the variable rather than relying on GC timing.
 */
export function wipeApiKey(): void {
  generation++;
  apiKey = null;
  persisted = false;
  ctx = null;
  // A session that ends before its context was ever bound still owes every
  // waiting read an answer, and for a torn-down session that answer is null.
  settlePending(null);
  syncStatus();
}

// Belt-and-suspenders: overwrite the in-memory key as the tab goes away so it
// can't linger in a frozen/cached page. Registered once at module load.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', wipeApiKey);
}
