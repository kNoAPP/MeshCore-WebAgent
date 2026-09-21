// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { mnemonicToSeed } from './seed';

/**
 * SLIP-0010 private derivation over Ed25519, hardened only, shared by every
 * branch of the `m / 77698372'` tree specified in
 * `docs/identity-derivation.md`.
 *
 * @see https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */

/**
 * First path level: `"MESH"` as the decimal ASCII codes 77 69 83 72, in the
 * style BIP-85 uses for its own purpose number. Applied hardened.
 */
export const MESH_PURPOSE = 77698372;

/** A SLIP-0010 node: its 32-byte private key and 32-byte chain code. */
export interface Slip10Node {
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

function splitNode(i: Uint8Array<ArrayBuffer>): Slip10Node {
  const node = { key: i.slice(0, 32), chainCode: i.slice(32) };
  i.fill(0);
  return node;
}

/** Zeroes a node's key and chain code in place. */
export function wipeNode(node: Slip10Node): void {
  node.key.fill(0);
  node.chainCode.fill(0);
}

/**
 * The hardened child at `index` (before the `2^31` offset):
 * `HMAC-SHA512(c_par, 0x00 || k_par || ser32(index + 2^31))`.
 *
 * @remarks The parent is left intact; the caller wipes both when done.
 * @throws RangeError if `index` is not an integer in `[0, 2^31)`, which
 * `ser32` would otherwise wrap into a different, valid-looking child.
 */
export async function hardenedChild(
  parent: Slip10Node,
  index: number,
): Promise<Slip10Node> {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw new RangeError('Hardened index must be an integer in [0, 2^31)');
  }
  const data = new Uint8Array(37);
  data.set(parent.key, 1);
  new DataView(data.buffer).setUint32(33, index + HARDENED_OFFSET);
  const i = await hmacSha512(parent.chainCode, data);
  data.fill(0);
  return splitNode(i);
}

/**
 * Validates the phrase, stretches it to its BIP-39 seed, and walks the
 * hardened `path` from the SLIP-0010 master node.
 *
 * @remarks The caller owns the returned node and should {@link wipeNode} it.
 * Every intermediate node and the BIP-39 seed are zeroed here.
 * @throws `SeedPhraseError` `wordCount`, `unknownWord` or `checksum` for a
 * malformed phrase.
 * @throws RangeError if a `path` level is out of range; see
 * {@link hardenedChild}.
 */
export async function deriveNode(
  phrase: string,
  path: readonly number[],
): Promise<Slip10Node> {
  const seed = await mnemonicToSeed(phrase);
  let node = splitNode(await hmacSha512(MASTER_KEY, seed));
  seed.fill(0);
  for (const level of path) {
    const child = await hardenedChild(node, level);
    wipeNode(node);
    node = child;
  }
  return node;
}
