// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import {
  beginIdentityHandover,
  markUnsavedRestore,
  seedIdentityNamespace,
} from '@/lib/session/persistence';
import { deleteRadioRecords } from '@/lib/storage';
import { toHex } from '@/lib/utils';
import { identityFromMnemonic } from './seed';
import {
  createVault,
  deleteVault,
  fingerprintPhrase,
  lockVault,
  saveVault,
  VaultError,
  type Vault,
  type VaultIdentity,
} from './vault';

/**
 * The vault for a {@link regenerateIdentity} run could not be written. Nothing
 * reached the radio. The message is the underlying failure's.
 */
export class RegenerateError extends Error {
  constructor(cause: unknown) {
    super((cause as Error).message, { cause });
    this.name = 'RegenerateError';
  }
}

/** What {@link regenerateIdentity} left behind once the key was sent. */
export interface RegenerateResult {
  /** The public key the phrase derives, lowercase hex. */
  publicKey: string;
  /**
   * Whether the radio acknowledged the import. False when the exchange timed
   * out, the link dropped, or the device answered with an error this app does
   * not map to a refusal: the radio may or may not hold the new identity, and
   * only the public key it reports after a restart can tell.
   */
  confirmed: boolean;
  /**
   * Whether this browser's data reached encrypted storage under the incoming
   * identity. False leaves it in memory only, protected for the next connect
   * as {@link RegenerateResult.publicKey} but lost to a reload.
   */
  persisted: boolean;
}

/**
 * Replaces the radio's identity with the one a freshly generated recovery
 * phrase derives, recording it in a new vault first.
 *
 * @remarks
 * The vault is written before the radio is touched, so a device that cannot
 * store it stops the run while the outgoing identity is still intact. This
 * browser's data is then written under the incoming identity too
 * ({@link seedIdentityNamespace}), so it is there whichever identity the radio
 * comes back as. A radio that refuses the key takes both with it.
 *
 * An acknowledged import hands the session over to the incoming identity
 * exactly as a backup restore does ({@link beginIdentityHandover}), because
 * the import does not reboot the radio. An unacknowledged one is reported
 * rather than thrown, and leaves the outgoing namespace in place: the radio
 * may still be on it.
 *
 * Does not reboot the radio, and proves nothing about what it will report:
 * that needs a restart and a fresh `SELF_INFO`, which is the caller's to do.
 *
 * @param phrase - a phrase this flow generated. Only for one: a vault that
 * already exists for it is taken to be an earlier, failed attempt of the same
 * run and replaced.
 * @param label - the identity's name in the vault.
 * @throws `SeedPhraseError` for a malformed phrase.
 * @throws `PrivateKeyError` when the radio refuses the key; nothing has
 * changed on the radio, in the vault, or in storage.
 * @throws {@link RegenerateError} when the vault could not be written.
 */
export async function regenerateIdentity(
  client: MeshCoreClient,
  phrase: string,
  passphrase: string,
  rememberPhrase: boolean,
  label: string,
): Promise<RegenerateResult> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  const pubkey = toHex(publicKey);
  try {
    const fingerprint = await writeVault(phrase, passphrase, rememberPhrase, {
      index: null,
      publicKey: pubkey,
      label,
    });
    const seeded = await seedIdentityNamespace(client, pubkey);
    // The next connect as this identity must keep the store's data rather
    // than normalize it away against an absent blob, as for a backup restore.
    if (!seeded) markUnsavedRestore(pubkey);
    try {
      await client.importPrivateKey(privateKey);
    } catch (err) {
      // Only a refusal proves the radio kept its identity. Anything else may
      // have landed after the write, and then the vault and the seeded
      // records are what the radio's new identity will need.
      if (!(err instanceof PrivateKeyError)) {
        return { publicKey: pubkey, confirmed: false, persisted: seeded };
      }
      await deleteVault(fingerprint);
      if (seeded) await deleteRadioRecords(pubkey);
      throw err;
    }
  } finally {
    privateKey.fill(0);
  }

  const persisted = await beginIdentityHandover(client, pubkey);
  if (!persisted) markUnsavedRestore(pubkey);
  return { publicKey: pubkey, confirmed: true, persisted };
}

// Creates the vault listing `identity`, and returns its fingerprint.
async function writeVault(
  phrase: string,
  passphrase: string,
  rememberPhrase: boolean,
  identity: VaultIdentity,
): Promise<string> {
  let vault: Vault;
  try {
    vault = await createFreshVault(phrase, passphrase, rememberPhrase);
  } catch (err) {
    throw new RegenerateError(err);
  }
  try {
    vault.identities.push(identity);
    if (!(await saveVault(vault))) throw new Error('IndexedDB write failed');
    return vault.fingerprint;
  } catch (err) {
    // Nothing reached the radio, so a vault listing no identity would only
    // meet the next attempt as a leftover.
    await deleteVault(vault.fingerprint);
    throw new RegenerateError(err);
  } finally {
    lockVault(vault);
  }
}

async function createFreshVault(
  phrase: string,
  passphrase: string,
  rememberPhrase: boolean,
) {
  try {
    return await createVault(phrase, passphrase, rememberPhrase);
  } catch (err) {
    if (!(err instanceof VaultError && err.code === 'exists')) throw err;
    // A generated phrase is new to every device, so the only vault that can
    // already hold it is one an earlier attempt of this run left behind.
    await deleteVault(await fingerprintPhrase(phrase));
    return createVault(phrase, passphrase, rememberPhrase);
  }
}
