// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { deriveNode, MESH_PURPOSE, wipeNode } from './slip10';

/**
 * The encryption root for a seed-born identity's browser data, and the
 * per-identity storage keys derived from it.
 *
 * `deriveStorageKey` in `lib/storage.ts` stretches a radio's channel secrets,
 * salted with its public key. On a factory-fresh radio the only channel is
 * Public, whose secret is a published constant, and the public key is in
 * every advert — so anyone holding the IndexedDB file can rebuild that key. An
 * identity minted from a phrase instead keys its records from a root on a
 * domain-separated branch of the same seed, which nothing on the radio or the
 * air can reach.
 *
 * The derivation is frozen in `docs/identity-derivation.md` §7. Changing the
 * path or the HKDF parameters makes every record written under it unreadable.
 *
 * @remarks Every persona of a phrase is encrypted under one root, so whoever
 * holds the root — the browser profile plus the passphrase that wraps it —
 * can read every persona's records, and so learns which personas belong to
 * one operator. That is the right trade for separating roles, and the wrong
 * one for a burner: burner identities must not persist anything, rather than
 * persist under this root.
 */

/**
 * Second path level for the storage root, applied hardened. Branch `0'` is
 * radio identities; this one never yields a signing key.
 */
export const STORAGE_ROOT_BRANCH = 1;

const KEY_BYTES = 32;

/**
 * The 32-byte storage root of a phrase: the SLIP-0010 private key at
 * `m / 77698372' / 1'`.
 *
 * @remarks Only the node's key is returned. Its chain code is discarded, so
 * the root cannot be used to derive anything below it. The caller owns the
 * root and should zero it once it is wrapped or no longer needed.
 * @throws `SeedPhraseError` `wordCount`, `unknownWord` or `checksum` for a
 * malformed phrase.
 */
export async function deriveStorageRoot(
  phrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const node = await deriveNode(phrase, [MESH_PURPOSE, STORAGE_ROOT_BRANCH]);
  const root = node.key.slice();
  wipeNode(node);
  return root;
}

/**
 * The AES-256-GCM key for one identity's records, from a storage root:
 * HKDF-SHA256 with an empty salt and the identity's raw 32-byte public key as
 * `info`.
 *
 * Personas of one phrase get independent keys, so a leaked key exposes only
 * its own persona. The key is a drop-in for `deriveStorageKey`'s: records stay
 * in the `${pubkey}:` namespace, only the key that seals them changes.
 *
 * @param root - the 32 bytes from {@link deriveStorageRoot}. Not modified.
 * @param publicKey - the identity's 32-byte Ed25519 public key.
 * @returns a non-extractable key for `encrypt` and `decrypt`.
 * @throws RangeError if `root` or `publicKey` is not 32 bytes.
 */
export async function deriveIdentityStorageKey(
  root: Uint8Array<ArrayBuffer>,
  publicKey: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (root.length !== KEY_BYTES) {
    throw new RangeError('Storage root must be 32 bytes');
  }
  if (publicKey.length !== KEY_BYTES) {
    throw new RangeError('Public key must be 32 bytes');
  }
  const ikm = await crypto.subtle.importKey('raw', root, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: publicKey,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
