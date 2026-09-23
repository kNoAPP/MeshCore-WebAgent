// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { PrivateKeyError } from '@/lib/meshcore/errors';
import { beginIdentitySwitch } from '@/lib/session/persistence';
import { toHex } from '@/lib/utils';
import { identityFromMnemonic } from './seed';

/**
 * The public key a typed recovery phrase derives, lowercase hex, worked out
 * entirely client-side before anything is written.
 *
 * @throws `SeedPhraseError` for a malformed phrase, or one that derives a key
 * the firmware refuses. Such a phrase must never reach the radio.
 */
export async function previewPhrase(phrase: string): Promise<string> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  privateKey.fill(0);
  return toHex(publicKey);
}

/**
 * Writes the identity a recovery phrase derives onto the radio.
 *
 * @remarks
 * Unlike a regenerate, nothing in this browser moves: the incoming identity's
 * records, if this device has any, are its own history and are left exactly
 * as they are, and so are the outgoing identity's. Unless the radio refused
 * the key, the session is moved onto the incoming identity without the
 * outgoing one's data ({@link beginIdentitySwitch}), and must then be
 * restarted to hydrate whichever identity the radio reports, which is the
 * caller's to do. An unacknowledged import is moved too: it may have landed,
 * and a restart as the outgoing identity reloads that identity's records,
 * losing only what was never saved, such as drafts and unread markers.
 *
 * @returns whether the radio acknowledged the import. False when the exchange
 * timed out, the link dropped, or the device answered with an error this app
 * does not map to a refusal: only the public key it reports after a restart
 * can tell whether the key landed.
 * @throws `SeedPhraseError` for a malformed phrase.
 * @throws `PrivateKeyError` when the radio refuses the key and keeps its
 * identity.
 */
export async function restoreIdentity(
  client: MeshCoreClient,
  phrase: string,
): Promise<boolean> {
  const { privateKey, publicKey } = await identityFromMnemonic(phrase);
  let acknowledged = true;
  try {
    await client.importPrivateKey(privateKey);
  } catch (err) {
    if (err instanceof PrivateKeyError) throw err;
    acknowledged = false;
  } finally {
    privateKey.fill(0);
  }
  await beginIdentitySwitch(client, toHex(publicKey));
  return acknowledged;
}
