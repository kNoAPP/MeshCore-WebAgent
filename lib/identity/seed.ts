// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { etc, Point } from '@noble/ed25519';
import { PRIVATE_KEY_BYTES } from '@/lib/meshcore/constants';
import { BIP39_ENGLISH } from './wordlist';

/**
 * Seed-phrase identities: a BIP-39 mnemonic turned into the exact 64 bytes
 * `CMD_IMPORT_PRIVATE_KEY` expects, plus the public key the radio will derive
 * from them.
 *
 * The path is one-way by construction. The radio stores the *expanded* key
 * `clamp(SHA-512(seed))`, never the seed, so a phrase can move an identity onto
 * a radio but no radio identity can ever be turned back into a phrase.
 */

/** Word counts BIP-39 defines: 128 to 256 bits of entropy in 32-bit steps. */
export type MnemonicLength = 12 | 15 | 18 | 21 | 24;

/**
 * Why a phrase could not be turned into an identity — a stable code the UI
 * maps to localized copy.
 *
 * `wordCount` means the phrase is not 12, 15, 18, 21 or 24 words;
 * `unknownWord` means a word is not in the BIP-39 English list; `checksum`
 * means every word is valid but the phrase's checksum does not match, which is
 * what a single mistyped-but-real word produces; `reservedKey` means the
 * phrase is well-formed but derives a public key the firmware refuses (see
 * {@link isImportablePublicKey}).
 */
export type SeedPhraseErrorCode =
  'wordCount' | 'unknownWord' | 'checksum' | 'reservedKey';

/**
 * Thrown when a phrase is malformed or derives an identity the radio would
 * reject. A phrase that fails here must never be imported: the alternative to
 * failing loudly is silently deriving a different identity than the one on
 * the user's paper.
 */
export class SeedPhraseError extends Error {
  /**
   * @param wordIndex - for `unknownWord`, the zero-based position of the first
   * word not in the list.
   */
  constructor(
    readonly code: SeedPhraseErrorCode,
    readonly wordIndex?: number,
  ) {
    super(code);
    this.name = 'SeedPhraseError';
  }
}

/** A seed-born identity, in the shapes the radio speaks. */
export interface SeedIdentity {
  /**
   * The 64-byte expanded Ed25519 private key, exactly as
   * `MeshCoreClient.importPrivateKey` sends it. Callers own it and should zero
   * it once it has been written to the radio.
   */
  privateKey: Uint8Array;
  /** The 32-byte public key the radio will report after the import. */
  publicKey: Uint8Array;
}

const WORD_INDEX = new Map(BIP39_ENGLISH.map((w, i) => [w, i]));
const PBKDF2_ITERATIONS = 2048;
const ED25519_SEED_BYTES = 32;

// BIP-39 requires NFKD on both the phrase and the salt. The English list is
// plain ASCII, so this only matters for pasted input carrying compatibility
// characters, but a phrase must hash identically to every other wallet's.
function splitPhrase(phrase: string): string[] {
  return phrase.normalize('NFKD').toLowerCase().trim().split(/\s+/);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function isMnemonicLength(n: number): n is MnemonicLength {
  return n === 12 || n === 15 || n === 18 || n === 21 || n === 24;
}

/**
 * Encodes BIP-39 entropy as its mnemonic.
 *
 * @param entropy - 16, 20, 24, 28 or 32 bytes.
 * @returns the words, single-space separated.
 * @throws RangeError for any other entropy length.
 */
export async function entropyToMnemonic(
  entropy: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const ent = entropy.length * 8;
  if (ent < 128 || ent > 256 || ent % 32 !== 0) {
    throw new RangeError(`BIP-39 entropy must be 16-32 bytes in steps of 4`);
  }
  const cs = ent / 32;
  const checksum = (await sha256(entropy))[0] >> (8 - cs);
  let bits = 0n;
  for (const b of entropy) bits = (bits << 8n) | BigInt(b);
  bits = (bits << BigInt(cs)) | BigInt(checksum);
  const count = (ent + cs) / 11;
  const words: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    words.push(BIP39_ENGLISH[Number((bits >> BigInt(i * 11)) & 0x7ffn)]);
  }
  return words.join(' ');
}

/**
 * Decodes a mnemonic back to its entropy, verifying the checksum. Case and
 * surrounding or repeated whitespace are ignored.
 *
 * @throws {@link SeedPhraseError} `wordCount`, `unknownWord` or `checksum`.
 */
export async function mnemonicToEntropy(phrase: string): Promise<Uint8Array> {
  const words = splitPhrase(phrase);
  if (!isMnemonicLength(words.length)) {
    throw new SeedPhraseError('wordCount');
  }
  let bits = 0n;
  for (const [i, w] of words.entries()) {
    const idx = WORD_INDEX.get(w);
    if (idx === undefined) throw new SeedPhraseError('unknownWord', i);
    bits = (bits << 11n) | BigInt(idx);
  }
  const cs = words.length / 3;
  const entropy = new Uint8Array((words.length * 11 - cs) / 8);
  const body = bits >> BigInt(cs);
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = Number((body >> BigInt((entropy.length - 1 - i) * 8)) & 0xffn);
  }
  const expected = (await sha256(entropy))[0] >> (8 - cs);
  if (Number(bits & ((1n << BigInt(cs)) - 1n)) !== expected) {
    throw new SeedPhraseError('checksum');
  }
  return entropy;
}

/**
 * The 64-byte BIP-39 seed: PBKDF2-HMAC-SHA512 over the phrase, 2048
 * iterations, salt `"mnemonic"`. The phrase is validated first, so a mistyped
 * phrase throws rather than stretching into an unrelated seed.
 *
 * @remarks No BIP-39 passphrase ("25th word") is supported; the salt is always
 * the bare `"mnemonic"`.
 * @throws {@link SeedPhraseError} `wordCount`, `unknownWord` or `checksum`.
 */
export async function mnemonicToSeed(phrase: string): Promise<Uint8Array> {
  await mnemonicToEntropy(phrase);
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(splitPhrase(phrase).join(' ')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt: enc.encode('mnemonic'.normalize('NFKD')),
      iterations: PBKDF2_ITERATIONS,
    },
    base,
    512,
  );
  return new Uint8Array(bits);
}

/**
 * Expands a 32-byte Ed25519 seed into the 64-byte private key MeshCore
 * stores: `SHA-512(seed)` with the scalar half clamped.
 *
 * @see https://github.com/meshcore-dev/MeshCore/blob/main/lib/ed25519/keypair.c
 * — `ed25519_create_keypair`, which `LocalIdentity(RNG*)` calls.
 * @throws RangeError if `seed` is not 32 bytes.
 */
export async function expandSeed(
  seed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  if (seed.length !== ED25519_SEED_BYTES) {
    throw new RangeError('Ed25519 seed must be 32 bytes');
  }
  const prv = new Uint8Array(await crypto.subtle.digest('SHA-512', seed));
  prv[0] &= 248;
  prv[31] &= 63;
  prv[31] |= 64;
  return prv;
}

/**
 * The public key for a 64-byte expanded private key: the first 32 bytes, read
 * little-endian, times the Ed25519 base point. This is the step WebCrypto
 * cannot do — it imports Ed25519 private keys but never exposes the public
 * half.
 *
 * @remarks Mirrors the firmware's `ed25519_derive_pub`, which an importing
 * radio runs on the key it is handed. Only the scalar half is read; the
 * nonce-prefix half does not affect the public key.
 * @throws RangeError if `privateKey` is not 64 bytes.
 */
export function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== PRIVATE_KEY_BYTES) {
    throw new RangeError('Expanded Ed25519 private key must be 64 bytes');
  }
  let scalar = 0n;
  for (let i = 31; i >= 0; i--) scalar = (scalar << 8n) | BigInt(privateKey[i]);
  const n = etc.mod(scalar, Point.CURVE().n);
  return Point.BASE.multiply(n).toBytes();
}

/**
 * Whether the firmware will accept an identity with this public key.
 * `LocalIdentity::validatePrivateKey` refuses any key whose public key starts
 * with `0x00` or `0xFF`.
 *
 * @remarks The firmware also runs an ECDH round-trip against a fixed test
 * keypair; every correctly clamped key passes it, so it is not repeated here.
 * @see https://github.com/meshcore-dev/MeshCore/blob/main/src/Identity.cpp
 */
export function isImportablePublicKey(publicKey: Uint8Array): boolean {
  return publicKey[0] !== 0x00 && publicKey[0] !== 0xff;
}

/**
 * Derives the radio identity a phrase stands for: BIP-39 seed, first 32 bytes
 * as the Ed25519 seed, expanded and clamped, plus the predicted public key.
 *
 * @throws {@link SeedPhraseError} `wordCount`, `unknownWord` or `checksum` for
 * a malformed phrase, `reservedKey` for one the firmware would refuse.
 */
export async function identityFromMnemonic(
  phrase: string,
): Promise<SeedIdentity> {
  const bip39Seed = await mnemonicToSeed(phrase);
  const edSeed = bip39Seed.slice(0, ED25519_SEED_BYTES);
  bip39Seed.fill(0);
  const privateKey = await expandSeed(edSeed);
  edSeed.fill(0);
  const publicKey = derivePublicKey(privateKey);
  if (!isImportablePublicKey(publicKey)) {
    privateKey.fill(0);
    throw new SeedPhraseError('reservedKey');
  }
  return { privateKey, publicKey };
}

/**
 * Generates a fresh random mnemonic whose identity the radio will accept.
 * About 1 phrase in 128 derives a reserved public key; those are discarded and
 * redrawn, so every phrase this returns can be restored.
 */
export async function generateMnemonic(words: MnemonicLength): Promise<string> {
  const entropy = new Uint8Array((words * 11 * 32) / 33 / 8);
  for (;;) {
    crypto.getRandomValues(entropy);
    const phrase = await entropyToMnemonic(entropy);
    try {
      (await identityFromMnemonic(phrase)).privateKey.fill(0);
      entropy.fill(0);
      return phrase;
    } catch (err) {
      if (!(err instanceof SeedPhraseError && err.code === 'reservedKey')) {
        throw err;
      }
    }
  }
}
