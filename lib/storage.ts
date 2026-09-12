// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';

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
  const promise = (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Set once we give up on this open (blocked): the open request can't be
    // aborted, so a success that arrives afterwards must close the connection
    // rather than leak a second live handle to the DB.
    let abandoned = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(SECRETS_STORE)) {
        db.createObjectStore(SECRETS_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (abandoned) {
        db.close();
        return;
      }
      // If another tab opens a newer DB version, close this connection so we
      // don't block its upgrade, dropping the cache so the next call reopens —
      // but only if this promise is still the cached one, so a newer connection
      // that already replaced it isn't evicted.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === promise) dbPromise = null;
      };
      resolve(db);
    };
    // A connection held by another tab at an older version blocks this upgrade.
    // Fail fast instead of hanging forever; callers are best-effort and the
    // dropped cache lets a later call retry once that tab closes.
    req.onblocked = () => {
      abandoned = true;
      if (dbPromise === promise) dbPromise = null;
      reject(new Error('IndexedDB upgrade blocked by another open connection'));
    };
    req.onerror = () => {
      if (dbPromise === promise) dbPromise = null;
      reject(req.error);
    };
  }));
  return promise;
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

// The single encrypt-and-write path behind every `save*` helper. Best-effort:
// any failure (e.g. IndexedDB unavailable) is swallowed and reported as `false`
// so callers that surface persistence state don't report a success.
async function putEncrypted(
  store: string,
  key: string,
  cryptoKey: CryptoKey,
  value: string,
): Promise<boolean> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(value);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext.buffer as ArrayBuffer,
    );
    await idbPut(store, key, { iv, data: ciphertext });
    return true;
  } catch {
    return false;
  }
}

// The single read-and-decrypt path behind every `load*` helper. Null covers
// both nothing stored and a failed decryption (wrong key / different radio /
// corrupt record) — a different radio is indistinguishable from an absent
// record, which is the intended property.
async function getDecrypted(
  store: string,
  key: string,
  cryptoKey: CryptoKey,
): Promise<string | null> {
  try {
    const record = await idbGet(store, key);
    if (!record) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      cryptoKey,
      record.data,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
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
  await putEncrypted(STORE_NAME, pubkey, key, JSON.stringify(data));
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
  const plaintext = await getDecrypted(STORE_NAME, pubkey, key);
  return plaintext === null
    ? null
    : (JSON.parse(plaintext) as PersistedRadioData);
}

// Namespaced IndexedDB key for a per-radio record: the pubkey plus a fixed
// suffix (a secret's name, `automation-rules`, `advert-cache`, `preferences`).
// Namespacing by pubkey keeps one radio's records from colliding with
// another's in a shared store. The bare pubkey (no suffix) is the message
// history record.
function recordKey(pubkey: string, suffix: string): string {
  return `${pubkey}:${suffix}`;
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
 * @returns true if the encrypted record was written, false if the write failed
 * (so callers don't report a secret as persisted when it never reached disk).
 */
export async function saveSecret(
  pubkey: string,
  key: CryptoKey,
  name: string,
  value: string,
): Promise<boolean> {
  return putEncrypted(SECRETS_STORE, recordKey(pubkey, name), key, value);
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
  return getDecrypted(SECRETS_STORE, recordKey(pubkey, name), key);
}

/**
 * Deletes a named secret for a radio from IndexedDB.
 * @returns whether the deletion transaction completed successfully.
 */
export async function clearSecret(
  pubkey: string,
  name: string,
): Promise<boolean> {
  try {
    await idbDelete(SECRETS_STORE, recordKey(pubkey, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts and stores a radio's automation rules. Best-effort — any failure is
 * swallowed, exactly like {@link saveRadioData}.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @param rules - the JSON-serializable rule list to persist.
 */
export async function saveAutomationRules(
  pubkey: string,
  key: CryptoKey,
  rules: unknown,
): Promise<void> {
  await putEncrypted(
    STORE_NAME,
    recordKey(pubkey, 'automation-rules'),
    key,
    JSON.stringify(rules),
  );
}

/**
 * Loads and decrypts a radio's stored automation rules.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @returns the parsed rule list, or null if nothing is stored or decryption
 * fails (wrong key / different radio / corrupt record).
 */
export async function loadAutomationRules<T>(
  pubkey: string,
  key: CryptoKey,
): Promise<T | null> {
  const plaintext = await getDecrypted(
    STORE_NAME,
    recordKey(pubkey, 'automation-rules'),
    key,
  );
  return plaintext === null ? null : (JSON.parse(plaintext) as T);
}

// The advert cache (discovered nodes not held in the radio's contact table) is
// stored per-radio, encrypted under the same per-radio key as message history,
// in its own namespaced record so it never entangles with the msgHistory blob
// (keyed by bare pubkey).

/**
 * Encrypts and stores a radio's advert cache. Best-effort — any failure is
 * swallowed, exactly like {@link saveRadioData}.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @param cache - the advert map (keyed by `pubkeyPrefix`) to persist.
 */
export async function saveAdvertCache(
  pubkey: string,
  key: CryptoKey,
  cache: Record<string, Advert>,
): Promise<void> {
  await putEncrypted(
    STORE_NAME,
    recordKey(pubkey, 'advert-cache'),
    key,
    JSON.stringify(cache),
  );
}

/**
 * Loads and decrypts a radio's advert cache.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @returns the advert map, or null if nothing is stored or decryption fails
 * (wrong key / different radio / corrupt record) — a different radio is
 * indistinguishable from an absent cache, which is the intended property.
 */
export async function loadAdvertCache(
  pubkey: string,
  key: CryptoKey,
): Promise<Record<string, Advert> | null> {
  const plaintext = await getDecrypted(
    STORE_NAME,
    recordKey(pubkey, 'advert-cache'),
    key,
  );
  return plaintext === null
    ? null
    : (JSON.parse(plaintext) as Record<string, Advert>);
}

// The user-preferences blob (unit system, contacts-list view, auto-add config,
// automation master switch, map viewport, AI provider/model picker) is stored
// per-radio, encrypted under the same per-radio key as everything else, in its
// own namespaced record so each radio carries its own preferences. This is the
// canonical home for any app preference that isn't settable before a radio is
// connected — localStorage is reserved for the pre-connect prefs (locale,
// theme) only. Keyed by `${pubkey}:preferences` in the radios store.

/**
 * Encrypts and stores a radio's user-preferences blob. Best-effort — any
 * failure is swallowed, exactly like {@link saveRadioData}.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @param prefs - the JSON-serializable preferences object to persist.
 */
export async function savePreferences(
  pubkey: string,
  key: CryptoKey,
  prefs: unknown,
): Promise<void> {
  await putEncrypted(
    STORE_NAME,
    recordKey(pubkey, 'preferences'),
    key,
    JSON.stringify(prefs),
  );
}

/**
 * Loads and decrypts a radio's user-preferences blob.
 *
 * @param key - the key from {@link deriveStorageKey} for this radio.
 * @returns the parsed preferences object, or null if nothing is stored or
 * decryption fails (wrong key / different radio / corrupt record) — callers
 * fall back to defaults, so an absent blob is indistinguishable from a fresh
 * radio.
 */
export async function loadPreferences<T>(
  pubkey: string,
  key: CryptoKey,
): Promise<T | null> {
  const plaintext = await getDecrypted(
    STORE_NAME,
    recordKey(pubkey, 'preferences'),
    key,
  );
  return plaintext === null ? null : (JSON.parse(plaintext) as T);
}
