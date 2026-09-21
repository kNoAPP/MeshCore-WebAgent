// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { toHex } from '@/lib/utils';
import { identityFromMnemonic } from './seed';
import {
  createVault,
  deleteVault,
  fingerprintPhrase,
  listVaults,
  lockVault,
  saveVault,
  type Vault,
  type VaultIdentity,
} from './vault';

/**
 * What a typed recovery phrase stands for, worked out before anything is
 * written: the identity it derives and whether this device already has a
 * vault for it.
 */
export interface PhrasePreview {
  /** The public key the phrase derives, lowercase hex. */
  publicKey: string;
  /** The phrase's vault fingerprint; see `fingerprintPhrase`. */
  fingerprint: string;
  /** Whether this device has a vault for {@link PhrasePreview.fingerprint}. */
  vaultExists: boolean;
}

/**
 * Derives what a phrase would restore, entirely client-side.
 *
 * @throws `SeedPhraseError` for a malformed phrase, or one that derives a key
 * the firmware refuses. Such a phrase must never reach the radio.
 */
export async function previewPhrase(phrase: string): Promise<PhrasePreview> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  privateKey.fill(0);
  const fingerprint = await fingerprintPhrase(phrase);
  return {
    publicKey: toHex(publicKey),
    fingerprint,
    vaultExists: (await listVaults()).includes(fingerprint),
  };
}

/**
 * How a restore records its identity in this device's vault: unlocked
 * already, or a vault created for it under a new passphrase.
 *
 * @remarks `replace` deletes the phrase's existing vault first — for a user
 * who no longer knows the passphrase it was sealed under. The phrase restores
 * its storage root, so only the other identities' labels and indices are lost.
 */
export type VaultPlan =
  | { mode: 'unlocked'; vault: Vault }
  | {
      mode: 'create';
      passphrase: string;
      remember: boolean;
      replace: boolean;
    };

/**
 * The vault could not be written for a restore. Nothing reached the radio.
 * The cause is the underlying failure, often a `VaultError`.
 */
export class RestoreVaultError extends Error {
  constructor(cause: unknown) {
    super((cause as Error).message, { cause });
    this.name = 'RestoreVaultError';
  }
}

/**
 * Lists the phrase's primary identity in its vault, so the restored persona is
 * manageable on this device rather than orphaned.
 *
 * @remarks Does nothing to an unlocked vault that already lists it. Leaves an
 * unlocked vault unlocked, and unchanged when the save fails, so a retry
 * starts from what is stored; a vault this creates is locked before returning.
 * @param label - the identity's name in the vault, when it is added.
 * @throws {@link RestoreVaultError} when the vault could not be written.
 */
export async function recordInVault(
  phrase: string,
  publicKey: string,
  label: string,
  plan: VaultPlan,
): Promise<void> {
  const entry: VaultIdentity = { index: null, publicKey, label };
  try {
    if (plan.mode === 'unlocked') {
      const { vault } = plan;
      if (vault.identities.some((i) => i.publicKey === publicKey)) return;
      const before = vault.identities;
      vault.identities = [...before, entry];
      try {
        if (!(await saveVault(vault)))
          throw new Error('IndexedDB write failed');
      } catch (err) {
        vault.identities = before;
        throw err;
      }
      return;
    }
    if (plan.replace) await deleteVault(await fingerprintPhrase(phrase));
    const vault = await createVault(phrase, plan.passphrase, plan.remember);
    try {
      vault.identities.push(entry);
      if (!(await saveVault(vault))) throw new Error('IndexedDB write failed');
    } catch (err) {
      // An empty vault would only meet the retry as `exists`, sealed under a
      // passphrase the user may not have settled on.
      await deleteVault(vault.fingerprint);
      throw err;
    } finally {
      lockVault(vault);
    }
  } catch (err) {
    throw new RestoreVaultError(err);
  }
}

/**
 * Writes the identity a recovery phrase derives onto the radio, after
 * recording it in the vault.
 *
 * @remarks
 * Unlike a regenerate, nothing in this browser moves: the incoming identity's
 * records, if this device has any, are its own history and are left exactly
 * as they are, and so are the outgoing identity's. The session keeps
 * persisting under the outgoing identity until the radio restarts, which is
 * the caller's to do.
 *
 * The vault is written first and kept whatever the radio does: it records only
 * that the phrase derives this identity, which a refusal does not change.
 *
 * @returns whether the radio acknowledged the import. False when the exchange
 * timed out, the link dropped, or the device answered with an error this app
 * does not map to a refusal: only the public key it reports after a restart
 * can tell whether the key landed.
 * @throws `SeedPhraseError` for a malformed phrase.
 * @throws {@link RestoreVaultError} when the vault could not be written;
 * nothing reached the radio.
 * @throws `PrivateKeyError` when the radio refuses the key and keeps its
 * identity.
 */
export async function restoreIdentity(
  client: MeshCoreClient,
  phrase: string,
  label: string,
  plan: VaultPlan,
): Promise<boolean> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  try {
    await recordInVault(phrase, toHex(publicKey), label, plan);
    try {
      await client.importPrivateKey(privateKey);
      return true;
    } catch (err) {
      if (err instanceof PrivateKeyError) throw err;
      return false;
    }
  } finally {
    privateKey.fill(0);
  }
}
