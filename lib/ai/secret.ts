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

/** The stable secret name the LLM API key is stored under, per radio. */
const API_KEY_NAME = 'llm-api-key';

let apiKey: string | null = null;
let persisted = false;

// The per-radio crypto context used for at-rest encryption, set on connect and
// cleared on teardown. Reuses the CryptoKey derived by useMeshCore — there is
// no second key-derivation path.
let ctx: { pubkey: string; storageKey: CryptoKey } | null = null;

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
  ctx = { pubkey, storageKey };
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
  apiKey = value;
  persisted = false;
  if (remember && ctx) {
    await saveSecret(ctx.pubkey, ctx.storageKey, API_KEY_NAME, value);
    persisted = true;
  }
  syncStatus();
}

/**
 * Restores a previously "remembered" key for the connected radio into memory.
 *
 * @returns true if a persisted key was found and loaded.
 */
export async function loadPersistedApiKey(): Promise<boolean> {
  if (!ctx) return false;
  const value = await loadSecret(ctx.pubkey, ctx.storageKey, API_KEY_NAME);
  if (value === null) return false;
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
  apiKey = null;
  persisted = false;
  if (ctx) await clearSecret(ctx.pubkey, API_KEY_NAME);
  syncStatus();
}

/**
 * Wipes only the in-memory key and context (disconnect, kill switch, page
 * unload). Any persisted copy stays on the device for the next connect.
 * Overwrites the variable rather than relying on GC timing.
 */
export function wipeApiKey(): void {
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
