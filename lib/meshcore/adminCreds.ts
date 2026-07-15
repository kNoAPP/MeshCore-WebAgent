// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { saveSecret, loadSecret, clearSecret } from '@/lib/storage';
import { getStorageContext } from '@/lib/ai/secret';
import type { RepeaterAccess } from '@/types/meshcore';

// A remembered repeater login lives ONLY as an encrypted record in the
// per-radio `secrets` store — never in `localStorage`, the preferences blob,
// the Zustand store, logs, toasts, or URLs. It reuses the single per-radio
// crypto context bound in `useMeshCore` (via `getStorageContext`), so a
// different radio literally cannot decrypt another radio's remembered login.

/** A repeater login credential the user chose to persist, one per repeater. */
export interface RememberedCred {
  access: RepeaterAccess;
  password: string;
}

/** The per-repeater secret name, namespaced by the repeater's pubkey prefix. */
function credName(prefix: string): string {
  return `repeater-cred:${prefix}`;
}

/** Narrows an untrusted parsed record to a {@link RememberedCred}. */
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
 */
export async function loadRepeaterCred(
  prefix: string,
): Promise<RememberedCred | null> {
  const ctx = getStorageContext();
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
