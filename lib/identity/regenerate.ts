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
 * phrase derives.
 *
 * @remarks
 * This browser's data is written under the incoming identity first
 * ({@link seedIdentityNamespace}), so it is there whichever identity the radio
 * comes back as. A radio that refuses the key takes it with it.
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
 * @throws `SeedPhraseError` for a malformed phrase.
 * @throws `PrivateKeyError` when the radio refuses the key; nothing has
 * changed on the radio or in storage.
 */
export async function regenerateIdentity(
  client: MeshCoreClient,
  phrase: string,
): Promise<RegenerateResult> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  const pubkey = toHex(publicKey);
  try {
    const seeded = await seedIdentityNamespace(client, pubkey);
    // The next connect as this identity must keep the store's data rather
    // than normalize it away against an absent blob, as for a backup restore.
    if (!seeded) markUnsavedRestore(pubkey);
    try {
      await client.importPrivateKey(privateKey);
    } catch (err) {
      // Only a refusal proves the radio kept its identity. Anything else may
      // have landed after the write, and then the seeded records are what the
      // radio's new identity will need.
      if (!(err instanceof PrivateKeyError)) {
        // If the key did land, the store's data moves with it as a handover's
        // would: it is newer than the seeded records, and the next session as
        // this identity must keep it rather than start from them.
        markUnsavedRestore(pubkey);
        return { publicKey: pubkey, confirmed: false, persisted: seeded };
      }
      // Unconditionally: a partial seed still left records behind.
      await deleteRadioRecords(pubkey);
      throw err;
    }
  } finally {
    privateKey.fill(0);
  }

  const persisted = await beginIdentityHandover(client, pubkey);
  if (!persisted) markUnsavedRestore(pubkey);
  return { publicKey: pubkey, confirmed: true, persisted };
}

/**
 * Tidies up after an unacknowledged {@link regenerateIdentity} once the
 * restarted radio has shown which identity it holds.
 *
 * @remarks An acknowledged import is tidied by the handover itself. An
 * unacknowledged one leaves both namespaces written, since either identity
 * could come back: once one has, the other's records describe a node that
 * does not exist.
 *
 * @param landed - whether the radio came back as the incoming identity. If it
 * did, the outgoing identity's records go; if not, the incoming identity's
 * do, since that identity was never installed.
 */
export async function settleUnconfirmed(
  incoming: string,
  outgoing: string,
  landed: boolean,
): Promise<void> {
  await deleteRadioRecords(landed ? outgoing : incoming);
}
