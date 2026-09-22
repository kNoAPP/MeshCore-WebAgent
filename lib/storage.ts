// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';

// Per-radio message history persisted in IndexedDB, encrypted at rest with
// AES-256-GCM under a key derived from the radio's own secrets (see
// deriveStorageKey) — so the data is unreadable without that radio's channels.
const DB_NAME = 'meshcore';
const DB_VERSION = 3;
const STORE_NAME = 'radios';
// Secrets (e.g. a BYO LLM API key) live in their own object store so they're
// never entangled with message history, keyed by `${pubkey}:${name}` and
// encrypted under the same per-radio key as everything else.
const SECRETS_STORE = 'secrets';
// Passphrase-sealed identity vaults (`lib/identity/vault.ts`), keyed by seed
// fingerprint rather than by radio public key. The one store not encrypted
// under a per-radio key: a vault spans identities and must outlive the radio.
const VAULT_STORE = 'vault';

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
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
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

async function idbGet<T = EncryptedRecord>(
  store: string,
  key: string,
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(
  store: string,
  key: string,
  record: EncryptedRecord,
): Promise<void> {
  return idbWrite(store, key, record, 'put');
}

// `add` fails with a `ConstraintError` when the key is already taken, inside
// the transaction, so a create cannot race another writer the way a read
// followed by a `put` can.
async function idbWrite(
  store: string,
  key: string,
  record: object,
  mode: 'put' | 'add',
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store)[mode](record, key);
    tx.oncomplete = () => resolve();
    // The request's own error: a failed request bubbles to the transaction
    // before `tx.error` is set, so that would reject with null here.
    tx.onerror = () => reject(req.error ?? tx.error);
    tx.onabort = () => reject(tx.error);
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
 * @returns whether the write landed, for callers that report persistence state.
 */
export async function saveRadioData(
  pubkey: string,
  key: CryptoKey,
  data: PersistedRadioData,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    radioRecordKey(pubkey, 'history'),
    key,
    JSON.stringify(data),
  );
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
  const plaintext = await getDecrypted(
    STORE_NAME,
    radioRecordKey(pubkey, 'history'),
    key,
  );
  return plaintext === null
    ? null
    : (JSON.parse(plaintext) as PersistedRadioData);
}

// Namespaced IndexedDB key for a per-radio record: the pubkey plus a fixed
// suffix (a secret's name, `automation-rules`, `advert-cache`, `preferences`,
// `persona`, `persona-pending`).
// Namespacing by pubkey keeps one radio's records from colliding with
// another's in a shared store. The bare pubkey (no suffix) is the message
// history record.
function recordKey(pubkey: string, suffix: string): string {
  return `${pubkey}:${suffix}`;
}

// The one list of the records each identity keeps in the radios store under
// its channel-secret key. The session save (`saveSessionNamespace`) must write
// every member of it to type-check, and `deleteRadioRecords` deletes exactly
// its members, so no record can be saved there and never deleted. `persona`
// and `persona-pending` stay out: they are sealed under the vault's storage
// root, and a handover must not delete them.
const RADIO_RECORDS = [
  'history',
  'advert-cache',
  'automation-rules',
  'preferences',
] as const;

/**
 * One of the records each identity keeps in the `radios` store under the key
 * from {@link deriveStorageKey}: its message history, advert cache,
 * automation rules and preferences.
 *
 * @remarks A new record joins this list, which makes the session save fail to
 * type-check until it writes it and makes {@link deleteRadioRecords} delete it.
 */
export type RadioRecord = (typeof RADIO_RECORDS)[number];

// The history record is the bare pubkey; every other one is namespaced.
function radioRecordKey(pubkey: string, record: RadioRecord): string {
  return record === 'history' ? pubkey : recordKey(pubkey, record);
}

/**
 * Deletes every {@link RadioRecord} belonging to one identity — message
 * history, advert cache, automation rules and preferences.
 *
 * @remarks For a deliberate identity handover: once the radio's key has been
 * replaced, the outgoing identity's records describe a node that no longer
 * exists and nothing will ever read them again.
 *
 * Entries in the `secrets` store are left behind rather than collected. They
 * are orphaned just as thoroughly — nothing derives that identity's key again,
 * so a remembered API key or saved repeater password simply stops resolving
 * after the reboot — but they are not this function's to destroy, and an
 * identity change has always left them that way.
 *
 * The `persona` record is left too, deliberately: it is sealed under the
 * vault's storage root rather than this radio's key, so an outgoing persona
 * that is switched back to later still needs it. So is `persona-pending`,
 * which {@link deletePendingPersona} collects once its switch is settled.
 * @returns whether every delete landed; best-effort, like the `save*` helpers.
 */
export async function deleteRadioRecords(pubkey: string): Promise<boolean> {
  try {
    await Promise.all(
      RADIO_RECORDS.map((r) =>
        idbDelete(STORE_NAME, radioRecordKey(pubkey, r)),
      ),
    );
    return true;
  } catch {
    return false;
  }
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
 * Re-encrypts, in place, a radio's secrets whose names start with
 * `namePrefix`, from one key to another.
 *
 * @remarks For a session whose storage key has moved under it (the channel
 * secrets it derives from changed). Callers run it inside the same I/O queue
 * as that secret's saves and clears, so a value the user replaces or forgets
 * meanwhile cannot be written back. A record that does not decrypt under
 * `from` is left as it is: it is already under `to`, or an orphan no key of
 * this session could ever read.
 * @returns whether every record that decrypted under `from` was rewritten;
 * best-effort, like the `save*` helpers.
 */
export async function reencryptSecrets(
  pubkey: string,
  namePrefix: string,
  from: CryptoKey,
  to: CryptoKey,
): Promise<boolean> {
  return reencryptRange(SECRETS_STORE, recordKey(pubkey, namePrefix), from, to);
}

/**
 * Re-encrypts, in place, every per-radio record stored for a radio, from one
 * key to another.
 *
 * @remarks For a session torn down while its storage key was moving: its
 * last writes landed under `from`, and the next connect derives `to`. Records
 * that do not decrypt under `from` are left alone, which covers the `persona`
 * record (sealed under the vault's storage root) and anything already under
 * `to`.
 * @returns whether every record that decrypted under `from` was rewritten.
 */
export async function reencryptRadioRecords(
  pubkey: string,
  from: CryptoKey,
  to: CryptoKey,
): Promise<boolean> {
  return reencryptRange(STORE_NAME, pubkey, from, to);
}

// Rewrites every record in `store` whose key starts with `prefix` and which
// decrypts under `from`, encrypted under `to`.
async function reencryptRange(
  store: string,
  prefix: string,
  from: CryptoKey,
  to: CryptoKey,
): Promise<boolean> {
  try {
    const db = await openDB();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db
        .transaction(store, 'readonly')
        .objectStore(store)
        .getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const results = await Promise.all(
      keys.map(async (k) => {
        const value = await getDecrypted(store, String(k), from);
        return value === null || putEncrypted(store, String(k), to, value);
      }),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
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
 * @returns whether the write landed, for callers that report persistence state.
 */
export async function saveAutomationRules(
  pubkey: string,
  key: CryptoKey,
  rules: unknown,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    radioRecordKey(pubkey, 'automation-rules'),
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
    radioRecordKey(pubkey, 'automation-rules'),
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
 * @returns whether the write landed, for callers that report persistence state.
 */
export async function saveAdvertCache(
  pubkey: string,
  key: CryptoKey,
  cache: Record<string, Advert>,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    radioRecordKey(pubkey, 'advert-cache'),
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
    radioRecordKey(pubkey, 'advert-cache'),
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
 * @returns whether the write landed, for callers that report persistence state.
 */
export async function savePreferences(
  pubkey: string,
  key: CryptoKey,
  prefs: unknown,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    radioRecordKey(pubkey, 'preferences'),
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
    radioRecordKey(pubkey, 'preferences'),
    key,
  );
  return plaintext === null ? null : (JSON.parse(plaintext) as T);
}

// A persona's radio-side state (`lib/identity/persona.ts`): what gets written
// back onto the radio when that persona goes live. Keyed by
// `${pubkey}:persona` in the radios store, like every other per-identity
// record, but sealed under the key its phrase's storage root derives for it
// rather than the channel-secret key, so it can be read before the persona is
// live — and after the channels it restores have changed.

/**
 * Encrypts and stores an identity's persona state. Best-effort — any failure
 * is swallowed, exactly like {@link saveRadioData}.
 *
 * @param key - the identity's key from `deriveIdentityStorageKey`.
 * @param state - the JSON-serializable persona state to persist.
 * @returns whether the write landed, for callers that report persistence state.
 */
export async function savePersonaState(
  pubkey: string,
  key: CryptoKey,
  state: unknown,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    recordKey(pubkey, 'persona'),
    key,
    JSON.stringify(state),
  );
}

/**
 * Loads and decrypts an identity's persona state.
 *
 * @param key - the identity's key from `deriveIdentityStorageKey`.
 * @returns the parsed record, not yet validated, or null if nothing is stored
 * or decryption fails (wrong key / corrupt record).
 */
export async function loadPersonaState(
  pubkey: string,
  key: CryptoKey,
): Promise<unknown> {
  const plaintext = await getDecrypted(
    STORE_NAME,
    recordKey(pubkey, 'persona'),
    key,
  );
  return plaintext === null ? null : (JSON.parse(plaintext) as unknown);
}

// A persona switch in progress: the incoming persona's state, sealed like the
// `persona` record, at `${pubkey}:persona-pending` under the incoming key. Its
// existence alone is what the connect flow reads, before any key is at hand;
// the record key is a public key like every other one here, so it says no
// more than they do about which personas belong together.

/**
 * Encrypts and stores the state a persona switch onto `pubkey` is applying.
 * Best-effort, like {@link savePersonaState}.
 *
 * @param key - the identity's key from `deriveIdentityStorageKey`.
 * @returns whether the write landed.
 */
export async function savePendingPersona(
  pubkey: string,
  key: CryptoKey,
  state: unknown,
): Promise<boolean> {
  return putEncrypted(
    STORE_NAME,
    recordKey(pubkey, 'persona-pending'),
    key,
    JSON.stringify(state),
  );
}

/**
 * Loads and decrypts the state of a persona switch onto `pubkey`.
 *
 * @returns the parsed record, not yet validated, or null if there is none or
 * it does not decrypt under `key`.
 */
export async function loadPendingPersona(
  pubkey: string,
  key: CryptoKey,
): Promise<unknown> {
  const plaintext = await getDecrypted(
    STORE_NAME,
    recordKey(pubkey, 'persona-pending'),
    key,
  );
  return plaintext === null ? null : (JSON.parse(plaintext) as unknown);
}

/**
 * Whether a persona switch onto `pubkey` was started and never finished.
 * Needs no key.
 *
 * @returns false when IndexedDB cannot be read.
 */
export async function hasPendingPersona(pubkey: string): Promise<boolean> {
  try {
    return (
      (await idbGet(STORE_NAME, recordKey(pubkey, 'persona-pending'))) !==
      undefined
    );
  } catch {
    return false;
  }
}

/**
 * Deletes the record of a persona switch onto `pubkey`, once it is finished
 * or known not to have happened.
 *
 * @returns whether the delete landed.
 */
export async function deletePendingPersona(pubkey: string): Promise<boolean> {
  try {
    await idbDelete(STORE_NAME, recordKey(pubkey, 'persona-pending'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether anything at all is stored in the `radios` store for `pubkey`: its
 * history, advert cache, automation rules, preferences, persona or pending
 * switch. Needs no key.
 *
 * @returns false when IndexedDB cannot be read, which is also what an
 * identity new to this browser reports.
 */
export async function hasRadioRecords(pubkey: string): Promise<boolean> {
  try {
    const db = await openDB();
    const count = await new Promise<number>((resolve, reject) => {
      const req = db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .count(IDBKeyRange.bound(pubkey, `${pubkey}\uffff`));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return count > 0;
  } catch {
    return false;
  }
}

// A burner may be live on a radio: see `lib/identity/burner.ts`. The record
// is empty and its key names no identity — every other key in the store is
// a public key, so it cannot collide with one — so it says only that a
// burner was started from this browser and not yet known to have ended.
const BURNER_GUARD_KEY = 'burner-live';

/**
 * Records that a burner may be live on a radio, so a connect after a page
 * reload saves nothing for an identity this browser has no records of.
 *
 * @returns whether the write landed.
 */
export async function saveBurnerGuard(): Promise<boolean> {
  try {
    await idbWrite(STORE_NAME, BURNER_GUARD_KEY, {}, 'put');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether {@link saveBurnerGuard} was called and the guard not deleted since.
 *
 * @returns false when IndexedDB cannot be read.
 */
export async function hasBurnerGuard(): Promise<boolean> {
  try {
    return (await idbGet(STORE_NAME, BURNER_GUARD_KEY)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Deletes the burner guard, once no burner is known to be live.
 *
 * @returns whether the delete landed.
 */
export async function deleteBurnerGuard(): Promise<boolean> {
  try {
    await idbDelete(STORE_NAME, BURNER_GUARD_KEY);
    return true;
  } catch {
    return false;
  }
}

/** How a {@link replaceVaultRecord} call ended. */
export type VaultWriteResult = 'saved' | 'stale' | 'failed';

/**
 * Replaces a sealed identity vault, but only if the stored record is still the
 * one the caller last saw. The read and the write share one transaction, so
 * another tab's save cannot land between them.
 *
 * @param isCurrent - tests the record as stored now (undefined once deleted);
 * the write goes ahead only when it returns true.
 * @returns `stale` when `isCurrent` refused, `failed` when IndexedDB did.
 */
export async function replaceVaultRecord(
  fingerprint: string,
  record: object,
  isCurrent: (stored: unknown) => boolean,
): Promise<VaultWriteResult> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE, 'readwrite');
      const store = tx.objectStore(VAULT_STORE);
      let result: VaultWriteResult = 'saved';
      const read = store.get(fingerprint);
      read.onsuccess = () => {
        if (isCurrent(read.result)) {
          store.put(record, fingerprint);
        } else {
          result = 'stale';
        }
      };
      tx.oncomplete = () => resolve(result);
      // The failing request's error: `tx.error` is still null while a request
      // error bubbles, as in `idbWrite`.
      tx.onerror = (e) => reject((e.target as IDBRequest).error ?? tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return 'failed';
  }
}

/**
 * Stores a sealed identity vault under a fingerprint that must not be taken
 * yet. The existence check and the write are one transaction, so two tabs
 * creating a vault for the same phrase cannot both succeed.
 *
 * @returns false when a vault with this fingerprint already exists.
 * @throws when the write fails for any other reason.
 */
export async function addVaultRecord(
  fingerprint: string,
  record: object,
): Promise<boolean> {
  try {
    await idbWrite(VAULT_STORE, fingerprint, record, 'add');
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'ConstraintError') {
      return false;
    }
    throw err;
  }
}

/**
 * Reads the sealed vault record for one seed fingerprint.
 *
 * @returns the record as stored, not yet validated; undefined when there is
 * none.
 * @throws when IndexedDB cannot be read. Unlike the per-radio `load*` helpers,
 * a failed read is not folded into "nothing stored", so an unlock can tell a
 * missing vault from one it could not read.
 */
export async function loadVaultRecord(fingerprint: string): Promise<unknown> {
  return idbGet<unknown>(VAULT_STORE, fingerprint);
}

/**
 * The seed fingerprints of every vault on this device.
 *
 * @returns an empty list when IndexedDB cannot be read.
 */
export async function listVaultFingerprints(): Promise<string[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db
        .transaction(VAULT_STORE, 'readonly')
        .objectStore(VAULT_STORE)
        .getAllKeys();
      req.onsuccess = () =>
        resolve(req.result.filter((k): k is string => typeof k === 'string'));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Deletes one vault record.
 *
 * @returns whether the delete landed.
 */
export async function deleteVaultRecord(fingerprint: string): Promise<boolean> {
  try {
    await idbDelete(VAULT_STORE, fingerprint);
    return true;
  } catch {
    return false;
  }
}
