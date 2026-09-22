// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  addVaultRecord,
  deleteVaultRecord,
  listVaultFingerprints,
  loadVaultRecord,
  replaceVaultRecord,
  saveSeedMarker,
} from '@/lib/storage';
import { bytesEqual, fromHex, isRecord, toHex } from '@/lib/utils';
import {
  deriveIdentityStorageKey,
  deriveStorageRoot,
  registerIdentityKey,
} from './storageRoot';
import { MAX_SUB_IDENTITY_INDEX } from './subIdentity';

/**
 * The identity vault: what this device remembers about the identities one
 * recovery phrase has minted, sealed under a passphrase the user chooses.
 *
 * Everything else in IndexedDB is per-radio, encrypted under a key derived
 * from that radio's own secrets. The vault cannot be: it spans identities
 * whose storage keys differ by construction, and the storage root it carries
 * is what must survive losing the radio. So it has its own store, keyed by
 * seed fingerprint, and its own key, stretched from the passphrase with the
 * same KDF as the backup file.
 *
 * What it holds, all inside the ciphertext: the phrase's storage root (see
 * `./storageRoot`), the identities minted from the phrase with their labels,
 * indices and public keys, and — only when the user opted in — the phrase
 * itself. Only the fingerprint and the parameters needed to unseal (version,
 * salt, IV, passphrase check value) are in the clear.
 *
 * @remarks The identity list is sealed too, not just the root. Labels and
 * public keys in the clear would tell anyone holding the browser profile which
 * personas belong to one operator, with no secret at all; sealed, that takes
 * the profile and the passphrase, the same bar as reading the personas'
 * records under the root.
 *
 * Without the remembered phrase, nothing in the vault can mint an identity:
 * the root is a domain-separated node whose chain code is discarded, so no
 * radio key is derivable from it.
 */

/**
 * Why a vault could not be created or opened: `notFound` means no vault has
 * this fingerprint; `exists` means the phrase already has one;
 * `unsupportedVersion` means a newer build wrote it; `wrongPassphrase` and
 * `corrupt` are distinguished as {@link VaultError} describes; `stale` means
 * the stored vault changed since this copy last read or wrote it.
 */
export type VaultErrorCode =
  | 'notFound'
  | 'exists'
  | 'unsupportedVersion'
  | 'wrongPassphrase'
  | 'corrupt'
  | 'stale';

/**
 * Thrown by {@link createVault}, {@link unlockVault} and {@link saveVault}.
 * The {@link code} is stable so the UI can map it to localized copy.
 *
 * @remarks `wrongPassphrase` and `corrupt` are told apart by a check value
 * stored beside the ciphertext, so a damaged record is not blamed on the
 * user's typing. A record whose salt or check value was itself damaged still
 * reads as `wrongPassphrase`: nothing can tell those from a wrong guess.
 */
export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode) {
    super(code);
    this.name = 'VaultError';
  }
}

/** One identity a vault's phrase has minted. */
export interface VaultIdentity {
  /**
   * The sub-identity's raw derivation index, as `deriveSubIdentity` returns
   * it, or null for the phrase's primary identity, which sits on no path.
   */
  index: number | null;
  /** The identity's public key, lowercase hex, as `SELF_INFO` reports it. */
  publicKey: string;
  /** The user's name for this persona. Free text; may be empty. */
  label: string;
  /**
   * Whether a persona switch from this device last made this identity live
   * on a radio, and no switch has taken it off since. Absent means false.
   *
   * @remarks Only switches through the vault set or clear it, so it can be
   * stale — a radio reset or re-flashed out of band still counts as live. So
   * can a switch that the next connect finds did not land: the flags were
   * set before the key was written, and with the vault locked by then they
   * stay set, the incoming identity live and the outgoing one not, until a
   * later switch rewrites them. It is a reason to warn, never to refuse.
   */
  live?: boolean;
}

/**
 * An unlocked vault. Edit {@link identities} or {@link phrase} in place, then
 * {@link saveVault}; call {@link lockVault} once it is no longer needed.
 */
export interface Vault {
  /** Hex record key; see {@link fingerprintPhrase}. */
  readonly fingerprint: string;
  /**
   * The phrase's 32-byte storage root, for `deriveIdentityStorageKey`. Zeroed
   * by {@link lockVault}.
   */
  readonly root: Uint8Array<ArrayBuffer>;
  identities: VaultIdentity[];
  /**
   * The recovery phrase, when the user chose to remember it on this device;
   * null otherwise, which is the default. Set it to null and save to forget
   * it.
   *
   * @remarks A JS string, so it cannot be wiped from memory, and anyone
   * holding it and the browser profile's passphrase can mint every identity
   * of the phrase. Only ever set it on an explicit opt-in.
   */
  phrase: string | null;
  /** Sealing material for {@link saveVault}. Opaque to callers. */
  readonly seal: VaultSeal;
}

/** The passphrase-derived key a {@link Vault} is re-sealed under. */
export interface VaultSeal {
  readonly key: CryptoKey;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly check: Uint8Array<ArrayBuffer>;
}

// The record as stored. `check` is derived from the passphrase alongside the
// key, so a mismatch means the wrong passphrase without attempting the
// decryption at all.
interface SealedVault {
  version: number;
  salt: Uint8Array<ArrayBuffer>;
  check: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

// The JSON half of the plaintext; the root travels as raw bytes in front of
// it, so it never becomes a hex string that cannot be wiped.
interface VaultBody {
  identities: VaultIdentity[];
  phrase: string | null;
}

const VAULT_VERSION = 1;
// The backup file's cost (`lib/backup/archive.ts`), for the same threat: a
// human-chosen passphrase guarding something at rest. Deliberately its own
// constant rather than shared — the record does not store it, so changing it
// makes every existing vault unreadable, and the backup's may move
// independently.
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const CHECK_BYTES = 32;
const ROOT_BYTES = 32;
const FINGERPRINT_BYTES = 16;
const FINGERPRINT_LABEL = 'MeshCore vault fingerprint';

// The IV of the record each open vault last read or wrote. A fresh IV is drawn
// on every save, so a stored record with any other IV was written elsewhere —
// another tab — since. Kept off the Vault itself so callers cannot reset it.
const lastSeen = new WeakMap<Vault, Uint8Array>();
// The latest save of each open vault, so the next one starts after it.
const saving = new WeakMap<Vault, Promise<boolean>>();

/**
 * The record key for a phrase's vault: the first 16 bytes of
 * `SHA-256("MeshCore vault fingerprint" || root)`, as hex.
 *
 * @remarks For finding a vault from a typed phrase — the restore flow's "this
 * device knows this phrase" — without unlocking anything. The root carries at
 * least 128 bits of the phrase's entropy, so the fingerprint cannot be walked
 * back to it, and it has no relation to any public key the radio advertises.
 * @throws `SeedPhraseError` `wordCount`, `unknownWord` or `checksum` for a
 * malformed phrase.
 */
export async function fingerprintPhrase(phrase: string): Promise<string> {
  const root = await deriveStorageRoot(phrase);
  try {
    return await fingerprintRoot(root);
  } finally {
    root.fill(0);
  }
}

/** The seed fingerprints of every vault on this device. */
export async function listVaults(): Promise<string[]> {
  return listVaultFingerprints();
}

/**
 * Opens, with one passphrase, whichever vault on this device lists
 * `publicKey`, for an identity whose vault is not otherwise known — the
 * record names no vault by design.
 *
 * @remarks Every vault the passphrase opens is adopted on the way, as any
 * unlock is, and locked again unless it is the one returned. Vaults it does
 * not open — the wrong passphrase, or a record this build cannot read — are
 * skipped.
 * @param publicKey - lowercase hex.
 * @returns the unlocked vault, which the caller locks; null when no vault the
 * passphrase opens lists the identity.
 * @throws whatever IndexedDB throws.
 */
export async function openVaultFor(
  publicKey: string,
  passphrase: string,
): Promise<Vault | null> {
  for (const fingerprint of await listVaults()) {
    let vault: Vault;
    try {
      vault = await unlockVault(fingerprint, passphrase);
    } catch (err) {
      if (err instanceof VaultError) continue;
      throw err;
    }
    if (vault.identities.some((i) => i.publicKey === publicKey)) return vault;
    lockVault(vault);
  }
  return null;
}

/**
 * Creates a vault for a phrase, sealed under `passphrase`, and writes it at
 * once with no identities. Writing up front claims the fingerprint in the same
 * transaction that checks it, so two tabs creating a vault for one phrase
 * cannot both succeed. Add the first identity, then {@link saveVault}.
 *
 * @remarks The empty vault stays behind if the flow that created it is
 * abandoned before an identity is added — a failed import, a closed tab. A
 * retry then meets `exists` for a vault that lists nothing and may be sealed
 * under a passphrase the user no longer recalls, so a wizard that gets
 * `exists` should offer to delete and recreate as well as to unlock.
 *
 * @param rememberPhrase - keep the phrase itself in the vault, so new personas
 * can be minted without re-typing it. Off unless the user explicitly opts in.
 * @throws `SeedPhraseError` for a malformed phrase.
 * @throws {@link VaultError} `exists` when this device already has a vault for
 * the phrase. Unlock that one rather than overwrite its labels — or, when it
 * is an empty vault a previous attempt left behind, delete and recreate it.
 * @throws whatever IndexedDB throws when the record cannot be written.
 */
export async function createVault(
  phrase: string,
  passphrase: string,
  rememberPhrase: boolean,
): Promise<Vault> {
  const root = await deriveStorageRoot(phrase);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const vault: Vault = {
      fingerprint: await fingerprintRoot(root),
      root,
      identities: [],
      phrase: rememberPhrase ? phrase : null,
      seal: { salt, ...(await deriveSeal(passphrase, salt)) },
    };
    const record = await sealVault(vault);
    if (!(await addVaultRecord(vault.fingerprint, record))) {
      throw new VaultError('exists');
    }
    lastSeen.set(vault, record.iv);
    return vault;
  } catch (err) {
    root.fill(0);
    throw err;
  }
}

/**
 * Opens a stored vault.
 *
 * @throws {@link VaultError} `notFound` when there is no vault with this
 * fingerprint, `unsupportedVersion` for a record this build cannot read,
 * `wrongPassphrase` when the passphrase does not match, and `corrupt` when it
 * matches but the record is damaged.
 * @throws whatever IndexedDB throws when the record cannot be read.
 */
export async function unlockVault(
  fingerprint: string,
  passphrase: string,
): Promise<Vault> {
  const raw = await loadVaultRecord(fingerprint);
  if (raw === undefined) throw new VaultError('notFound');
  if (!isRecord(raw)) throw new VaultError('corrupt');
  if (raw.version !== VAULT_VERSION) {
    throw new VaultError(
      typeof raw.version === 'number' ? 'unsupportedVersion' : 'corrupt',
    );
  }
  const sealed = asSealedVault(raw);
  if (!sealed) throw new VaultError('corrupt');

  const { key, check } = await deriveSeal(passphrase, sealed.salt);
  if (!bytesEqual(check, sealed.check)) {
    throw new VaultError('wrongPassphrase');
  }

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv, additionalData: aad(fingerprint) },
        key,
        sealed.data,
      ),
    );
  } catch {
    // The check value matched, so the key is right: the ciphertext, or the
    // fingerprint it was filed under, is what changed.
    throw new VaultError('corrupt');
  }
  try {
    if (plaintext.length <= ROOT_BYTES) throw new VaultError('corrupt');
    const body = parseBody(plaintext.subarray(ROOT_BYTES));
    if (!body) throw new VaultError('corrupt');
    const vault: Vault = {
      fingerprint,
      root: plaintext.slice(0, ROOT_BYTES),
      identities: body.identities,
      phrase: body.phrase,
      seal: { key, salt: sealed.salt, check: sealed.check },
    };
    lastSeen.set(vault, sealed.iv);
    await adoptIdentities(await identityKeys(vault));
    return vault;
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Seals the vault's current state and writes it over the stored record. Each
 * save draws a fresh IV under the passphrase key derived at create or unlock,
 * so saving does not ask for the passphrase again.
 *
 * @remarks Refuses to write over a record that changed since this copy last
 * read or wrote it. The vault is meant to be open in more than one session at
 * once, and a stale copy's save would silently drop an identity another tab
 * minted — and with it the record of which identities are seed-born.
 * @returns whether the write landed; false when IndexedDB failed.
 * @throws {@link VaultError} `stale` when the stored vault changed since this
 * copy last read or wrote it, or was deleted. Unlock again, re-apply the edit
 * and save that copy.
 * @throws RangeError when an identity is malformed, or two share a public key
 * or an index — a record like that would fail to unlock as `corrupt`, so it is
 * refused here rather than written.
 * @throws Error when the vault has been locked: sealing it would store an
 * all-zero root over the real one, and every persona's records with it.
 */
export async function saveVault(vault: Vault): Promise<boolean> {
  // Chained per copy: two saves in flight would both compare against the IV
  // read before either wrote, and the second would call the first stale.
  const run = (saving.get(vault) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeVault(vault));
  saving.set(vault, run);
  return run;
}

async function writeVault(vault: Vault): Promise<boolean> {
  const seen = lastSeen.get(vault);
  // Started before the first await, so each derivation's importKey copies the
  // root now, in the same step sealVault checks it is not locked: a lock can
  // land during any await below, and a zeroed root would derive keys anyone
  // can compute.
  const keys = identityKeys(vault);
  // Observed here too, so a save sealVault refuses leaves no unhandled
  // rejection behind; the await below still sees the original outcome.
  keys.catch(() => {});
  const record = await sealVault(vault);
  const result = await replaceVaultRecord(
    vault.fingerprint,
    record,
    (stored) =>
      seen !== undefined &&
      isRecord(stored) &&
      stored.iv instanceof Uint8Array &&
      bytesEqual(stored.iv, seen),
  );
  if (result === 'stale') throw new VaultError('stale');
  if (result === 'failed') return false;
  lastSeen.set(vault, record.iv);
  await adoptIdentities(await keys);
  return true;
}

// Each listed identity's storage key, from the vault's root.
function identityKeys(vault: Vault): Promise<[string, CryptoKey][]> {
  return Promise.all(
    vault.identities.map(async (i): Promise<[string, CryptoKey]> => [
      i.publicKey,
      await deriveIdentityStorageKey(
        vault.root,
        new Uint8Array(fromHex(i.publicKey, 32) as Uint8Array),
      ),
    ]),
  );
}

// From here on these identities' records are sealed under the vault's root,
// not the radio's channel secrets: each is marked seed-born, so a connect
// before its vault is next opened binds nothing, and its key is held for this
// tab. The marker write is best-effort, like every other record write: one
// that failed leaves a connect after a reload on the channel-secret key until
// the vault is next opened here.
async function adoptIdentities(keys: [string, CryptoKey][]): Promise<void> {
  for (const [publicKey, key] of keys) registerIdentityKey(publicKey, key);
  await Promise.all(keys.map(([publicKey]) => saveSeedMarker(publicKey)));
}

/**
 * Zeroes the vault's storage root. {@link saveVault} refuses the vault from
 * then on; the remembered phrase, being a string, is only dropped with the
 * object.
 *
 * @remarks Await any pending {@link saveVault} first. Saves are queued and
 * seal when they run, so one still waiting when the root is zeroed rejects as
 * locked and its edit is not stored.
 */
export function lockVault(vault: Vault): void {
  vault.root.fill(0);
}

/**
 * Whether {@link lockVault} has run on this copy. A real root is 32 bytes of
 * HMAC output, so all zeros means it was zeroed.
 */
export function isVaultLocked(vault: Vault): boolean {
  return vault.root.every((b) => b === 0);
}

/**
 * Deletes a vault from this device. The identities it listed are untouched —
 * on the radio, and in their per-identity records — but their storage keys can
 * then only be re-derived from the phrase.
 *
 * @returns whether the delete landed.
 */
export async function deleteVault(fingerprint: string): Promise<boolean> {
  return deleteVaultRecord(fingerprint);
}

async function sealVault(vault: Vault): Promise<SealedVault> {
  if (isVaultLocked(vault)) throw new Error('Vault is locked');
  const body: VaultBody = {
    identities: vault.identities.map((i) => ({ ...i })),
    phrase: vault.phrase,
  };
  if (!isVaultBody(body)) {
    throw new RangeError('Vault identities are malformed or duplicated');
  }
  const json = new TextEncoder().encode(JSON.stringify(body));
  const plaintext = new Uint8Array(ROOT_BYTES + json.length);
  plaintext.set(vault.root, 0);
  plaintext.set(json, ROOT_BYTES);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(vault.fingerprint) },
      vault.seal.key,
      plaintext,
    );
    return {
      version: VAULT_VERSION,
      salt: vault.seal.salt,
      check: vault.seal.check,
      iv,
      data,
    };
  } finally {
    plaintext.fill(0);
  }
}

async function fingerprintRoot(root: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = new TextEncoder().encode(FINGERPRINT_LABEL);
  const input = new Uint8Array(label.length + root.length);
  input.set(label, 0);
  input.set(root, label.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  input.fill(0);
  return toHex(digest.subarray(0, FINGERPRINT_BYTES));
}

// PBKDF2 once, at the backup file's cost, then HKDF to split the stretched
// secret into the sealing key and the check value. Deriving both straight from
// PBKDF2 would mean two 600k-iteration blocks, doubling the unlock time for
// nothing — a guesser only ever needs the cheaper of the two.
async function deriveSeal(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ key: CryptoKey; check: Uint8Array<ArrayBuffer> }> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    // NFKC, as in `lib/backup/archive.ts`, so the same passphrase typed with
    // combining or pre-composed accents unlocks the same vault.
    enc.encode(passphrase.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const stretched = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      material,
      256,
    ),
  );
  const ikm = await crypto.subtle.importKey('raw', stretched, 'HKDF', false, [
    'deriveKey',
    'deriveBits',
  ]);
  stretched.fill(0);
  const hkdf = (info: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: enc.encode(info),
  });
  const [key, check] = await Promise.all([
    crypto.subtle.deriveKey(
      hkdf('MeshCore vault key'),
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
    crypto.subtle.deriveBits(
      hkdf('MeshCore vault check'),
      ikm,
      CHECK_BYTES * 8,
    ),
  ]);
  return { key, check: new Uint8Array(check) };
}

// Binds the ciphertext to the fingerprint it is filed under, so a record
// copied onto another vault's key fails to decrypt instead of opening there.
function aad(fingerprint: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `MeshCore vault ${VAULT_VERSION}:${fingerprint}`,
  );
}

function asSealedVault(raw: Record<string, unknown>): SealedVault | null {
  const { salt, check, iv, data } = raw;
  if (
    !(salt instanceof Uint8Array) ||
    salt.length !== SALT_BYTES ||
    !(check instanceof Uint8Array) ||
    check.length !== CHECK_BYTES ||
    !(iv instanceof Uint8Array) ||
    iv.length !== IV_BYTES ||
    !(data instanceof ArrayBuffer)
  ) {
    return null;
  }
  // Fresh copies: WebCrypto wants a plain ArrayBuffer backing, which a
  // structured-clone view does not promise.
  return {
    version: VAULT_VERSION,
    salt: new Uint8Array(salt),
    check: new Uint8Array(check),
    iv: new Uint8Array(iv),
    data,
  };
}

function parseBody(json: Uint8Array): VaultBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  return isVaultBody(parsed) ? parsed : null;
}

// Strict, all-or-nothing: the record decrypted under the user's own key, so a
// failure here is a partial write or a build mismatch, and a half-read
// identity list would show personas that don't match what was minted.
function isVaultBody(v: unknown): v is VaultBody {
  if (!isRecord(v)) return false;
  if (v.phrase !== null && typeof v.phrase !== 'string') return false;
  if (!Array.isArray(v.identities)) return false;
  // Keys and indices are both unique, and null — the primary identity — counts
  // as an index, so there is at most one.
  const keys = new Set<string>();
  const indices = new Set<number | null>();
  for (const id of v.identities) {
    if (
      !isVaultIdentity(id) ||
      keys.has(id.publicKey) ||
      indices.has(id.index)
    ) {
      return false;
    }
    keys.add(id.publicKey);
    indices.add(id.index);
  }
  return true;
}

function isVaultIdentity(v: unknown): v is VaultIdentity {
  return (
    isRecord(v) &&
    (v.index === null ||
      (Number.isInteger(v.index) &&
        (v.index as number) >= 0 &&
        (v.index as number) <= MAX_SUB_IDENTITY_INDEX)) &&
    typeof v.publicKey === 'string' &&
    /^[0-9a-f]{64}$/.test(v.publicKey) &&
    typeof v.label === 'string' &&
    (v.live === undefined || typeof v.live === 'boolean')
  );
}
