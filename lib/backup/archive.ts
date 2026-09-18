// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';
import type { RadioPreferences } from '@/store/meshStore';

/**
 * The passphrase-encrypted backup file: the per-radio blobs this browser holds
 * (message history, advert cache, automation rules, preferences, channel
 * metadata) and, optionally, the radio's own Ed25519 identity.
 *
 * Unlike everything in `lib/storage.ts`, a backup is **not** encrypted under
 * the radio-derived key — it is encrypted under a key stretched from a
 * user-supplied passphrase, which is the whole point: it has to be restorable
 * on a machine that has never seen the radio.
 *
 * The BYO LLM API key is deliberately absent. It lives in the separate
 * `secrets` store and never enters this file.
 */

/** File magic — the first six bytes of every backup file. */
const MAGIC = new Uint8Array([0x4d, 0x43, 0x57, 0x42, 0x41, 0x4b]); // "MCWBAK"

/**
 * Envelope version. Bumped only for a breaking change to the header or crypto
 * parameters; the JSON payload carries its own {@link BACKUP_PAYLOAD_VERSION}.
 */
const ENVELOPE_VERSION = 1;

/** Schema version of the decrypted JSON payload. */
export const BACKUP_PAYLOAD_VERSION = 1;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = MAGIC.length + 1 + 1 + SALT_BYTES + IV_BYTES;

/**
 * PBKDF2-HMAC-SHA256 stretching for the passphrase. Far above the 100k used for
 * the radio-derived key in `lib/storage.ts`, because a human-chosen passphrase
 * carries much less entropy than concatenated channel secrets and this file is
 * expected to sit on disk or in cloud storage.
 */
const PBKDF2_ITERATIONS = 600_000;

/** Filename extension this app writes and expects on import. */
export const BACKUP_FILE_EXT = '.mcbak';

/** A channel slot as carried in a backup: the 16-byte secret as hex. */
export interface BackupChannel {
  idx: number;
  name: string;
  /**
   * 32 hex characters — the slot's 16-byte secret, or `''` for an empty
   * slot.
   */
  secretHex: string;
}

/** The decrypted contents of a backup file. */
export interface BackupPayload {
  version: number;
  /** When the backup was written, Unix epoch **milliseconds**. */
  createdAt: number;
  /** Public key hex of the radio the backup was taken from. */
  pubkey: string;
  /** The node's advertised name at backup time, for display in the preview. */
  nodeName: string;
  msgHistory: Record<string, Message[]>;
  advertCache: Record<string, Advert>;
  automationRules: AutomationRule[];
  preferences: RadioPreferences | null;
  channels: BackupChannel[];
  /**
   * The radio's 64-byte Ed25519 private key as 128 hex characters, present
   * only when the user explicitly asked to include the identity. Anyone
   * holding this — and the passphrase — can impersonate the node.
   */
  identityHex?: string;
}

/** Why {@link decryptBackup} could not produce a payload. */
export type BackupReadErrorCode =
  'notABackup' | 'unsupportedVersion' | 'wrongPassphrase' | 'corrupt';

/**
 * Thrown by {@link decryptBackup}. The {@link code} is stable so the import UI
 * can distinguish "you typed the wrong passphrase" from "this isn't a backup
 * file" — two mistakes with very different fixes.
 */
export class BackupReadError extends Error {
  constructor(readonly code: BackupReadErrorCode) {
    super(code);
    this.name = 'BackupReadError';
  }
}

// Stretches the passphrase into the AES-256-GCM key. NFKC-normalized first so a
// passphrase typed with combining accents on one machine still matches the same
// passphrase typed pre-composed on another.
async function deriveBackupKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = new TextEncoder().encode(passphrase.normalize('NFKC'));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    material,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// The plaintext header, also fed to AES-GCM as additional authenticated data —
// so a file whose magic, version, or salt was edited fails the tag check
// instead of decrypting into something unexpected.
function buildHeader(
  salt: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[MAGIC.length] = ENVELOPE_VERSION;
  header[MAGIC.length + 1] = 0; // reserved
  header.set(salt, MAGIC.length + 2);
  header.set(iv, MAGIC.length + 2 + SALT_BYTES);
  return header;
}

/**
 * Encrypts a backup payload under a passphrase.
 *
 * @returns the complete file bytes: plaintext header (magic, version, salt, IV)
 * followed by the AES-256-GCM ciphertext of the UTF-8 JSON payload.
 * @remarks The salt and IV are freshly random per call, so backing up the same
 * radio twice with the same passphrase produces two unrelated files.
 */
export async function encryptBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = buildHeader(salt, iv);
  const key = await deriveBackupKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header },
    key,
    plaintext.buffer as ArrayBuffer,
  );
  const file = new Uint8Array(header.length + ciphertext.byteLength);
  file.set(header, 0);
  file.set(new Uint8Array(ciphertext), header.length);
  return file;
}

/**
 * Decrypts and validates a backup file.
 *
 * @throws BackupReadError — `notABackup` when the magic doesn't match,
 * `unsupportedVersion` for an envelope this build can't read,
 * `wrongPassphrase` when the GCM tag fails (which is also what a truncated or
 * tampered file looks like), and `corrupt` when the plaintext isn't a backup
 * payload.
 */
export async function decryptBackup(
  file: Uint8Array,
  passphrase: string,
): Promise<BackupPayload> {
  if (file.length <= HEADER_BYTES) throw new BackupReadError('notABackup');
  for (let i = 0; i < MAGIC.length; i++) {
    if (file[i] !== MAGIC[i]) throw new BackupReadError('notABackup');
  }
  if (file[MAGIC.length] !== ENVELOPE_VERSION) {
    throw new BackupReadError('unsupportedVersion');
  }
  // Copied into fresh arrays rather than sub-viewed: WebCrypto's types require
  // a plain ArrayBuffer backing, which a slice of the caller's array can't
  // promise.
  const salt = new Uint8Array(SALT_BYTES);
  salt.set(file.subarray(MAGIC.length + 2, MAGIC.length + 2 + SALT_BYTES));
  const iv = new Uint8Array(IV_BYTES);
  iv.set(file.subarray(MAGIC.length + 2 + SALT_BYTES, HEADER_BYTES));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(file.subarray(0, HEADER_BYTES));
  const body = new Uint8Array(file.length - HEADER_BYTES);
  body.set(file.subarray(HEADER_BYTES));
  const key = await deriveBackupKey(passphrase, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: header },
      key,
      body,
    );
  } catch {
    // AES-GCM gives one failure for a wrong key and for tampering alike; the
    // passphrase is overwhelmingly the likelier of the two.
    throw new BackupReadError('wrongPassphrase');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new BackupReadError('corrupt');
  }
  // Separate from the envelope check above: the envelope can be unchanged
  // while the payload schema moves, and "written by a newer build" is a
  // different thing to tell the user than "unreadable".
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as Partial<BackupPayload>).version === 'number' &&
    (parsed as BackupPayload).version !== BACKUP_PAYLOAD_VERSION
  ) {
    throw new BackupReadError('unsupportedVersion');
  }
  const payload = normalizeBackupPayload(parsed);
  if (!payload) throw new BackupReadError('corrupt');
  return payload;
}

// Coerces a decrypted object into a BackupPayload, dropping anything of the
// wrong shape rather than letting it reach the store. The file decrypted under
// the user's own passphrase, so this guards against an older/newer build or a
// partial write — not against an attacker.
function normalizeBackupPayload(raw: unknown): BackupPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Partial<BackupPayload>;
  if (typeof p.pubkey !== 'string' || !p.pubkey) return null;
  if (p.version !== BACKUP_PAYLOAD_VERSION) return null;
  return {
    version: BACKUP_PAYLOAD_VERSION,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
    pubkey: p.pubkey.toLowerCase(),
    nodeName: typeof p.nodeName === 'string' ? p.nodeName : '',
    msgHistory: normalizeHistory(p.msgHistory),
    advertCache: normalizeRecord<Advert>(p.advertCache),
    automationRules: Array.isArray(p.automationRules)
      ? p.automationRules.filter(
          (r): r is AutomationRule =>
            typeof r === 'object' && r !== null && typeof r.id === 'string',
        )
      : [],
    preferences:
      typeof p.preferences === 'object' && p.preferences !== null
        ? p.preferences
        : null,
    channels: Array.isArray(p.channels)
      ? p.channels.filter(
          (c): c is BackupChannel =>
            typeof c === 'object' &&
            c !== null &&
            typeof c.idx === 'number' &&
            typeof c.name === 'string' &&
            typeof c.secretHex === 'string',
        )
      : [],
    ...(typeof p.identityHex === 'string' && p.identityHex
      ? { identityHex: p.identityHex }
      : {}),
  };
}

function normalizeHistory(raw: unknown): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, msgs] of Object.entries(raw)) {
    if (Array.isArray(msgs)) out[id] = msgs as Message[];
  }
  return out;
}

function normalizeRecord<T>(raw: unknown): Record<string, T> {
  return typeof raw === 'object' && raw !== null
    ? (raw as Record<string, T>)
    : {};
}
