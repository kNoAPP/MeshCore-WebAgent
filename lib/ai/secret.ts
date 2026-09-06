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

// The per-radio crypto context used for at-rest encryption, set on connect and
// cleared on teardown. Reuses the CryptoKey derived by useMeshCore — there is
// no second key-derivation path.
let ctx: { pubkey: string; storageKey: CryptoKey } | null = null;

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
}

/**
 * The active per-radio storage context (pubkey + AES key), or null when no
 * session is bound. Reused by automation-rule persistence so it shares the
 * single {@link deriveStorageKey} path rather than inventing a second one.
 */
export function getStorageContext(): {
  pubkey: string;
  storageKey: CryptoKey;
} | null {
  return ctx;
}

/**
 * Sets the active API key in memory, optionally persisting an encrypted copy on
 * this device.
 *
 * @param value - the plaintext key the user provided.
 * @param remember - when true, encrypt-at-rest with the connected radio's key
 * so it restores on the next connect to the same radio; a different radio can't
 * decrypt it. Ignored when no radio is connected.
 */
export async function setApiKey(
  value: string,
  remember: boolean,
): Promise<void> {
  const mine = ++generation;
  apiKey = value;
  persisted = false;
  syncStatus();
  // Capture the context so the queued write targets this radio even if the
  // session is torn down (ctx nulled) before the op runs.
  const active = ctx;
  if (!active) return;

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
    await enqueue(() => clearSecret(active.pubkey, API_KEY_NAME));
  }
  // A wipe/forget/another setApiKey during the await supersedes this one; don't
  // report persistence state for a key that's no longer active.
  if (generation !== mine) return;
  persisted = landed;
  syncStatus();
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
  // connect window must not be overwritten by the remembered one.
  if (
    value === null ||
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
 */
export async function forgetApiKey(): Promise<void> {
  generation++;
  apiKey = null;
  persisted = false;
  const active = ctx;
  syncStatus();
  if (active) await enqueue(() => clearSecret(active.pubkey, API_KEY_NAME));
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
  syncStatus();
}

// Belt-and-suspenders: overwrite the in-memory key as the tab goes away so it
// can't linger in a frozen/cached page. Registered once at module load.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', wipeApiKey);
}
