// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  derivePublicKey,
  expandSeed,
  isImportablePublicKey,
  type SeedIdentity,
} from './seed';
import { deriveNode, hardenedChild, MESH_PURPOSE, wipeNode } from './slip10';

/**
 * Sub-identities: any number of unlinkable radio identities from one BIP-39
 * phrase, by SLIP-0010 hardened derivation over Ed25519.
 *
 * The scheme is a frozen contract, specified byte for byte in
 * `docs/identity-derivation.md`. Changing the path, the skip rule or the
 * expansion orphans every identity already minted from a phrase, so none of
 * them may ever change.
 *
 * @remarks Ed25519 has no non-hardened derivation, so there is no extended
 * public key and nothing short of the seed can enumerate a user's personas.
 * Do not add a watch-only or xpub-style export: that property is the point.
 */

/** First path level, applied hardened: see {@link MESH_PURPOSE}. */
export const SUB_IDENTITY_PURPOSE = MESH_PURPOSE;

/**
 * Second path level for radio identities, applied hardened. Every other value
 * at this level is reserved for domain-separated uses of the same seed, and
 * must never produce a radio identity.
 */
export const SUB_IDENTITY_BRANCH = 0;

/** Largest index a hardened child can take: `2^31 - 1`. */
export const MAX_SUB_IDENTITY_INDEX = 0x7fffffff;

/** A sub-identity, and the raw derivation index it sits at. */
export interface SubIdentity extends SeedIdentity {
  /**
   * The hardened index of the path's last level, before the `2^31` offset.
   * This is what to store to re-derive the identity later.
   */
  index: number;
}

/**
 * Derives the first importable sub-identity at or after `fromIndex`, along
 * the path `m / 77698372' / 0' / index'`.
 *
 * The skip rule: an index whose public key the firmware refuses (see
 * {@link isImportablePublicKey}; about 2 in 256) is passed over, and the next
 * index is tried. So the n-th sub-identity of a phrase is the n-th importable
 * index counting up from 0 — mint the first with `fromIndex` 0 and each next
 * one from the previous `index + 1`, and re-derive a stored one from its own
 * `index`, which returns it unchanged.
 *
 * @remarks None of these is the phrase's primary identity from
 * `identityFromMnemonic`, which takes the BIP-39 seed directly and sits on no
 * path. The caller owns `privateKey` and should zero it once used.
 * @param fromIndex - an integer from 0 to {@link MAX_SUB_IDENTITY_INDEX}.
 * @throws `SeedPhraseError` `wordCount`, `unknownWord` or `checksum` for a
 * malformed phrase.
 * @throws RangeError if `fromIndex` is out of range, or if no index from it
 * to the last yields an importable key.
 */
export async function deriveSubIdentity(
  phrase: string,
  fromIndex: number,
): Promise<SubIdentity> {
  if (
    !Number.isInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex > MAX_SUB_IDENTITY_INDEX
  ) {
    throw new RangeError('Sub-identity index must be an integer in [0, 2^31)');
  }
  const branch = await deriveNode(phrase, [
    SUB_IDENTITY_PURPOSE,
    SUB_IDENTITY_BRANCH,
  ]);
  try {
    for (let index = fromIndex; index <= MAX_SUB_IDENTITY_INDEX; index++) {
      const leaf = await hardenedChild(branch, index);
      const privateKey = await expandSeed(leaf.key);
      wipeNode(leaf);
      const publicKey = derivePublicKey(privateKey);
      if (isImportablePublicKey(publicKey)) {
        return { index, privateKey, publicKey };
      }
      privateKey.fill(0);
    }
  } finally {
    wipeNode(branch);
  }
  throw new RangeError('No importable sub-identity at or after this index');
}
