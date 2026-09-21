// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import {
  beginIdentityHandover,
  markUnsavedRestore,
} from '@/lib/session/persistence';
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
 * A {@link regenerateIdentity} failure that is not the radio refusing the key.
 *
 * `vault` means the vault could not be written, before the radio was touched;
 * `unconfirmed` means the import timed out or the link dropped, so the radio
 * may or may not hold the new identity. The message is the underlying
 * failure's.
 */
export class RegenerateError extends Error {
  readonly stage: 'vault' | 'unconfirmed';

  constructor(stage: 'vault' | 'unconfirmed', cause: unknown) {
    super((cause as Error).message, { cause });
    this.name = 'RegenerateError';
    this.stage = stage;
  }
}

/** What {@link regenerateIdentity} left behind once the radio took the key. */
export interface RegenerateResult {
  /** The public key the phrase derives, lowercase hex. */
  publicKey: string;
  /**
   * Whether this browser's data for the outgoing identity reached encrypted
   * storage under the incoming one. False leaves it in memory only, protected
   * for the next connect as {@link RegenerateResult.publicKey} but lost to a
   * reload.
   */
  persisted: boolean;
}

/**
 * Replaces the radio's identity with the one a freshly generated recovery
 * phrase derives, recording it in a new vault first.
 *
 * @remarks
 * The vault is written before the radio is touched, so a device that cannot
 * store it stops the run while the outgoing identity is still intact. A radio
 * that then refuses the key takes the vault with it: it would otherwise list
 * an identity that was never installed.
 *
 * On success the session is handed over to the incoming identity exactly as a
 * backup restore does it ({@link beginIdentityHandover}), because the import
 * does not reboot the radio and this browser's data must already sit under the
 * public key the radio comes back as.
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
 * changed on the radio or in the vault.
 * @throws {@link RegenerateError} `vault` when the vault could not be written,
 * and `unconfirmed` when the import neither succeeded nor was refused — the
 * vault is kept then, as the one record of what the radio may now hold.
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
    try {
      await client.importPrivateKey(privateKey);
    } catch (err) {
      // Only a refusal proves the radio kept its identity. A timeout or a
      // dropped link may have landed after the write, and then the vault is
      // the one record of which identity the radio now holds.
      if (!(err instanceof PrivateKeyError)) {
        throw new RegenerateError('unconfirmed', err);
      }
      await deleteVault(fingerprint);
      throw err;
    }
  } finally {
    privateKey.fill(0);
  }

  const persisted = await beginIdentityHandover(client, pubkey);
  // As for a backup restore: the next connect as this identity must keep the
  // store's data rather than normalize it away against an absent blob.
  if (!persisted) markUnsavedRestore(pubkey);
  return { publicKey: pubkey, persisted };
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
    throw new RegenerateError('vault', err);
  }
  try {
    vault.identities.push(identity);
    if (!(await saveVault(vault))) throw new Error('IndexedDB write failed');
    return vault.fingerprint;
  } catch (err) {
    // Nothing reached the radio, so a vault listing no identity would only
    // meet the next attempt as a leftover.
    await deleteVault(vault.fingerprint);
    throw new RegenerateError('vault', err);
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
