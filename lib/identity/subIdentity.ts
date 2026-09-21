// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  derivePublicKey,
  expandSeed,
  isImportablePublicKey,
  mnemonicToSeed,
  type SeedIdentity,
} from './seed';

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

/**
 * First path level: `"MESH"` as the decimal ASCII codes 77 69 83 72, in the
 * style BIP-85 uses for its own purpose number. Applied hardened.
 */
export const SUB_IDENTITY_PURPOSE = 77698372;

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

interface Node {
  key: Uint8Array<ArrayBuffer>;
  chainCode: Uint8Array<ArrayBuffer>;
}

const HARDENED_OFFSET = 0x80000000;
const MASTER_KEY = new TextEncoder().encode('ed25519 seed');

async function hmacSha512(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function splitNode(i: Uint8Array<ArrayBuffer>): Node {
  const node = { key: i.slice(0, 32), chainCode: i.slice(32) };
  i.fill(0);
  return node;
}

function wipe(node: Node): void {
  node.key.fill(0);
  node.chainCode.fill(0);
}

// SLIP-0010 private child derivation for Ed25519, hardened only:
// HMAC-SHA512(c_par, 0x00 || k_par || ser32(i + 2^31)).
async function hardenedChild(parent: Node, index: number): Promise<Node> {
  const data = new Uint8Array(37);
  data.set(parent.key, 1);
  new DataView(data.buffer).setUint32(33, index + HARDENED_OFFSET);
  const i = await hmacSha512(parent.chainCode, data);
  data.fill(0);
  return splitNode(i);
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
  const seed = await mnemonicToSeed(phrase);
  let branch = splitNode(await hmacSha512(MASTER_KEY, seed));
  seed.fill(0);
  try {
    for (const level of [SUB_IDENTITY_PURPOSE, SUB_IDENTITY_BRANCH]) {
      const child = await hardenedChild(branch, level);
      wipe(branch);
      branch = child;
    }
    for (let index = fromIndex; index <= MAX_SUB_IDENTITY_INDEX; index++) {
      const leaf = await hardenedChild(branch, index);
      const privateKey = await expandSeed(leaf.key);
      wipe(leaf);
      const publicKey = derivePublicKey(privateKey);
      if (isImportablePublicKey(publicKey)) {
        return { index, privateKey, publicKey };
      }
      privateKey.fill(0);
    }
  } finally {
    wipe(branch);
  }
  throw new RangeError('No importable sub-identity at or after this index');
}
