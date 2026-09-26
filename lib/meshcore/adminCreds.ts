// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import {
  saveSecret,
  loadSecret,
  clearSecret,
  reencryptSecrets,
} from '@/lib/storage';
import { getStorageContext, awaitStorageContext } from '@/lib/ai/secret';
import type { LoginKind } from '@/types/meshcore';

// A remembered repeater login lives ONLY as an encrypted record in the
// per-radio `secrets` store — never in `localStorage`, the preferences blob,
// the Zustand store, logs, notifications, or URLs. It reuses the one
// per-radio crypto context bound in `useMeshCore` (via `getStorageContext`),
// so a different radio literally cannot decrypt another's remembered login.

/**
 * A repeater login credential the user chose to persist, one per repeater.
 * `access` records which password was entered, not the role the node granted
 * back, so it is one of the two login choices {@link isRememberedCred}
 * accepts.
 */
export interface RememberedCred {
  access: LoginKind;
  password: string;
}

function credName(prefix: string): string {
  return `repeater-cred:${prefix}`;
}

function isRememberedCred(value: unknown): value is RememberedCred {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.password === 'string' &&
    (rec.access === 'admin' || rec.access === 'guest')
  );
}

// All at-rest credential I/O funnels through this promise chain so overlapping
// operations hit IndexedDB in call order. Without it, a save whose encryption
// finishes after a later clear could recreate a credential the user just
// forgot (mirrors the ordering guarantee in `lib/ai/secret.ts`).
let ioChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = ioChain.then(op, op);
  ioChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Re-encrypts every remembered repeater credential for `pubkey` from one
 * storage key to another, in this module's I/O order.
 *
 * @remarks Call in the same synchronous step that rebinds the storage
 * context, as for `reencryptApiKey` in `lib/ai/secret.ts`.
 * @returns whether every record that decrypted under `from` was rewritten.
 */
export function reencryptRepeaterCreds(
  pubkey: string,
  from: CryptoKey,
  to: CryptoKey,
): Promise<boolean> {
  return enqueue(() => reencryptSecrets(pubkey, credName(''), from, to));
}

/**
 * Persists a repeater's login credential, encrypted under the connected
 * radio's key. Best-effort — a no-op when no radio session is bound.
 *
 * @returns true if the encrypted record was written.
 */
export async function saveRepeaterCred(
  prefix: string,
  cred: RememberedCred,
): Promise<boolean> {
  const ctx = getStorageContext();
  if (!ctx) return false;
  return enqueue(() =>
    saveSecret(
      ctx.pubkey,
      ctx.storageKey,
      credName(prefix),
      JSON.stringify(cred),
    ),
  );
}

/**
 * Loads a repeater's remembered credential for the connected radio, or null if
 * none is stored (or the record is missing/corrupt/from another radio).
 *
 * @remarks
 * Waits for the session's encryption context instead of reading its absence as
 * "none stored": this is called from a gate that mounts the moment the app
 * reports connected, which can be before the connect flow has finished
 * deriving the key, and a null answer there is terminal — the gate shows a
 * bare login form and never probes again.
 */
export async function loadRepeaterCred(
  prefix: string,
): Promise<RememberedCred | null> {
  const ctx = await awaitStorageContext();
  if (!ctx) return null;
  const raw = await enqueue(() =>
    loadSecret(ctx.pubkey, ctx.storageKey, credName(prefix)),
  );
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRememberedCred(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Deletes a repeater's remembered credential for the connected radio.
 * Best-effort — a no-op when no radio session is bound.
 */
export async function clearRepeaterCred(prefix: string): Promise<void> {
  const ctx = getStorageContext();
  if (!ctx) return;
  await enqueue(() => clearSecret(ctx.pubkey, credName(prefix)));
}
