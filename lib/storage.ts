// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Message } from '@/types/meshcore';

// Per-radio message history persisted in IndexedDB, encrypted at rest with
// AES-256-GCM under a key derived from the radio's own secrets (see
// deriveStorageKey) — so the data is unreadable without that radio's channels.
const DB_NAME = 'meshcore';
const DB_VERSION = 2;
const STORE_NAME = 'radios';
// Secrets (e.g. a BYO LLM API key) live in their own object store so they're
// never entangled with message history, keyed by `${pubkey}:${name}` and
// encrypted under the same per-radio key as everything else.
const SECRETS_STORE = 'secrets';

/**
 * The decrypted payload stored per radio: its conversation history keyed by
 * conversation id.
 */
export interface PersistedRadioData {
  msgHistory: Record<string, Message[]>;
}

interface EncryptedRecord {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

/**
 * Derives the AES-256-GCM key used to encrypt a radio's stored data.
 *
 * @param channelSecrets - the radio's channel secrets (16 bytes each),
 * concatenated as PBKDF2 password material.
 * @param pubkey - the radio's public key hex, used as the salt so two radios
 * never share a key even if their channel secrets coincide.
 * @remarks Falls back to fixed password material when the radio has no channel
 * secrets, so persistence still works (with weaker key separation).
 */
export async function deriveStorageKey(
  channelSecrets: Uint8Array[],
  pubkey: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  const secretBytes = new Uint8Array(
    channelSecrets.reduce((acc, s) => acc + s.length, 0),
  );
  let offset = 0;
  for (const s of channelSecrets) {
    secretBytes.set(s, offset);
    offset += s.length;
  }

  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes.length > 0 ? secretBytes : enc.encode('meshcore-fallback'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(pubkey),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(SECRETS_STORE)) {
        db.createObjectStore(SECRETS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function idbGet(
  store: string,
  key: string,
): Promise<EncryptedRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as EncryptedRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(
  store: string,
  key: string,
  record: EncryptedRecord,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(record, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Encrypts and stores a radio's data under its public key. Best-effort — any
 * failure (e.g. IndexedDB unavailable) is swallowed.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 */
export async function saveRadioData(
  pubkey: string,
  key: CryptoKey,
  data: PersistedRadioData,
): Promise<void> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext.buffer as ArrayBuffer,
    );
    await idbPut(STORE_NAME, pubkey, { iv, data: ciphertext });
  } catch {}
}

/**
 * Loads and decrypts a radio's stored data.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @returns the data, or null if nothing is stored or decryption fails (wrong
 * key / different radio / corrupt record).
 */
export async function loadRadioData(
  pubkey: string,
  key: CryptoKey,
): Promise<PersistedRadioData | null> {
  try {
    const record = await idbGet(STORE_NAME, pubkey);
    if (!record) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      key,
      record.data,
    );
    return JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as PersistedRadioData;
  } catch {
    // Decryption failure = wrong key (different radio) or corrupt data — treat
    // as empty
    return null;
  }
}

// The IndexedDB key under which a named secret is stored for a given radio.
// Namespacing by pubkey keeps one radio's secrets from colliding with another's
// in the shared secrets store.
function secretRecordKey(pubkey: string, name: string): string {
  return `${pubkey}:${name}`;
}

/**
 * Encrypts and stores a named secret (e.g. an LLM API key) for a radio,
 * scoped by its public key. Best-effort — any failure is swallowed, exactly
 * like {@link saveRadioData}.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @param name - a stable identifier for the secret within this radio's scope.
 * @param value - the plaintext secret; never logged, only ever written as
 * AES-256-GCM ciphertext.
 */
export async function saveSecret(
  pubkey: string,
  key: CryptoKey,
  name: string,
  value: string,
): Promise<void> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(value);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext.buffer as ArrayBuffer,
    );
    await idbPut(SECRETS_STORE, secretRecordKey(pubkey, name), {
      iv,
      data: ciphertext,
    });
  } catch {}
}

/**
 * Loads and decrypts a named secret for a radio.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @returns the plaintext secret, or null if nothing is stored or decryption
 * fails (wrong key / different radio / corrupt record) — a different radio is
 * indistinguishable from an absent secret, which is the intended property.
 */
export async function loadSecret(
  pubkey: string,
  key: CryptoKey,
  name: string,
): Promise<string | null> {
  try {
    const record = await idbGet(SECRETS_STORE, secretRecordKey(pubkey, name));
    if (!record) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      key,
      record.data,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * Deletes a named secret for a radio from IndexedDB. Best-effort — any failure
 * is swallowed.
 */
export async function clearSecret(pubkey: string, name: string): Promise<void> {
  try {
    await idbDelete(SECRETS_STORE, secretRecordKey(pubkey, name));
  } catch {}
}
