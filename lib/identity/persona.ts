// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { ADVERT_LOC_POLICY, MAX_CHANNEL_SLOTS } from '@/lib/meshcore/constants';
import {
  loadPendingPersona,
  loadPersonaState,
  savePendingPersona,
  savePersonaState,
} from '@/lib/storage';
import { fromHex, toHex } from '@/lib/utils';
import type { Contact } from '@/types/meshcore';
import { deriveIdentityStorageKey } from './storageRoot';
import type { Vault } from './vault';

/**
 * A persona's radio-side state, and the capture and apply that move it
 * between the radio and this device.
 *
 * `CMD_IMPORT_PRIVATE_KEY` replaces only the key pair: the node name,
 * location, channels and contacts in the radio's flash all survive it. A new
 * key broadcasting the old persona's name, from its coordinates, on its
 * channels would announce the link it was meant to hide, so each persona owns
 * that state and it is written back whenever the persona goes live.
 *
 * Browser-side data (history, adverts, preferences, rules, secrets) is not
 * here: it is already per identity through the `${pubkey}:` record namespace.
 * Radio parameters are not here either — they choose which mesh the radio is
 * on, not who it is on it, and replaying them could strand the user off-air.
 *
 * @remarks Every section is nullable, and null means "leave the radio as it
 * is". A record from another build or a damaged one loses the sections that
 * fail validation, never whatever the radio holds for them: an unreadable
 * contact list is skipped rather than applied as an empty one.
 */

/** A channel slot as a persona holds it. */
export interface PersonaChannel {
  /** The slot, which is also what the channel's conversation is keyed by. */
  idx: number;
  name: string;
  /** The 16-byte channel secret as lowercase hex. */
  secret: string;
}

/**
 * A contact as a persona holds it: every field `CMD_ADD_UPDATE_CONTACT`
 * writes, so re-adding it restores the route and flags it was captured with.
 */
export interface PersonaContact {
  /** The contact's 32-byte public key as lowercase hex. */
  pubkey: string;
  advType: number;
  flags: number;
  /**
   * The firmware's `out_path_len` byte: hop count in the low six bits, hash
   * size in the top two, or 255 for no known route.
   */
  outPathLen: number;
  /** The route's hop hashes, as lowercase hex; as long as the byte implies. */
  path: string;
  name: string;
  /** Unix epoch seconds by the contact's clock; 0 when unknown. */
  lastAdvert: number;
  /** Advertised latitude in microdegrees; 0 when unset. */
  advLat: number;
  /** Advertised longitude in microdegrees; 0 when unset. */
  advLon: number;
}

/** The radio-side state a persona owns. Null sections are left untouched. */
export interface PersonaState {
  /** The advert name. */
  name: string | null;
  /** The fixed advert coordinate, in decimal degrees. */
  location: { lat: number; lon: number } | null;
  /** One of the {@link ADVERT_LOC_POLICY} values. */
  locationPolicy: number | null;
  /** Every occupied channel slot, by index. */
  channels: PersonaChannel[] | null;
  /** Every contact in the radio's table, by public key. */
  contacts: PersonaContact[] | null;
}

/** Hooks for a long {@link applyPersona}; both optional. */
export interface ApplyPersonaOptions {
  /**
   * Stops the apply before its next radio command. The command in flight
   * still completes.
   */
  signal?: AbortSignal;
  /**
   * Called before the first command with `done` 0, then after each one.
   * `total` is fixed when the apply starts.
   */
  onProgress?: (done: number, total: number) => void;
}

const LATLON_SCALE = 1e6;
const PUBKEY_HEX = /^[0-9a-f]{64}$/;
const SECRET_HEX = /^[0-9a-f]{32}$/;
const PATH_HEX = /^(?:[0-9a-f]{2}){0,64}$/;
const LOC_POLICIES: readonly number[] = Object.values(ADVERT_LOC_POLICY);

/**
 * Snapshots the radio's persona state from the client's mirror of it.
 *
 * @remarks Reads the mirror, not the radio: the connect sync fills it and
 * every write through the client keeps it current, so no command is sent. A
 * section the mirror cannot vouch for is null — the radio never reported it,
 * the contact enumeration never completed, or a channel slot went unread — so
 * a sync that failed quietly is never saved as an empty list that a later
 * apply would enforce.
 */
export function capturePersona(client: MeshCoreClient): PersonaState {
  const info = client.selfInfo;
  return {
    name: info?.name ?? null,
    location:
      info?.advLat !== undefined && info.advLon !== undefined
        ? { lat: info.advLat, lon: info.advLon }
        : null,
    locationPolicy: info?.advLocPolicy ?? null,
    channels:
      client.unreadChannelSlots.size > 0
        ? null
        : Object.values(client.channels)
            .filter((ch) => ch.secret?.length === 16)
            .map((ch) => ({
              idx: ch.idx,
              name: ch.name,
              secret: toHex(ch.secret as Uint8Array),
            }))
            .sort((a, b) => a.idx - b.idx),
    contacts: !client.contactsSynced
      ? null
      : Object.values(client.contacts)
          .map(toPersonaContact)
          .sort((a, b) =>
            a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0,
          ),
  };
}

/**
 * Writes a persona's state onto the radio, sending only what differs from
 * the client's mirror of it.
 *
 * Contacts are reconciled by public key: ones the persona lacks are removed
 * before missing ones are added, so a full table has room for them. A contact
 * both hold keeps the radio's copy, whose route and last advert are at least
 * as fresh, and takes only the persona's flags. A route whose hop bytes the
 * contact parser does not keep (a multi-byte path hash) is written as no
 * route, so the contact floods and rediscovers one rather than being sent
 * through repeaters that do not exist.
 *
 * Channels are reconciled slot by slot, including slots the connect sync
 * could not read, which are written or cleared since their content is
 * unknown. Slots beyond the radio's channel count are skipped: this radio
 * cannot hold them.
 *
 * @remarks
 * Idempotent: the plan is recomputed from the mirror on every call, so after
 * an abort, a dropped link or a rejected command, applying the same state
 * again finishes the job instead of repeating it. Until then the radio holds
 * a mix of both personas.
 *
 * Writes through the client only. The store's session state that follows a
 * channel slot (an open conversation, a draft) is the caller's to settle. The
 * storage key a channel change moves is not: the session re-keys to follow
 * the mirror.
 *
 * The plan is fixed from the mirror when the apply starts, so a contact the
 * radio evicts or auto-adds meanwhile, or a background contact resync that
 * replaces the mirror mid-apply, can fail a step or leave a difference. A
 * second apply settles either.
 *
 * Sends no advert; peers learn the persona when the caller sends one.
 * @throws Error before sending anything when the state has contacts but the
 * client's contact enumeration never completed: the mirror may be partial,
 * and diffing against it would leave the previous persona's contacts behind.
 * @throws whatever the failing radio command throws — a device `ERR`, for
 * instance a contact table already full — or the signal's reason on abort.
 * Commands before it have been applied.
 */
export async function applyPersona(
  client: MeshCoreClient,
  state: PersonaState,
  options: ApplyPersonaOptions = {},
): Promise<void> {
  const { signal, onProgress } = options;
  const steps = planApply(client, state);
  onProgress?.(0, steps.length);
  for (let i = 0; i < steps.length; i++) {
    signal?.throwIfAborted();
    await steps[i]();
    onProgress?.(i + 1, steps.length);
  }
}

/**
 * The public keys of the contacts an apply of `state` would remove from the
 * radio: every one the client's mirror holds that the persona lacks.
 *
 * @returns lowercase hex keys; empty when `state` leaves contacts alone or
 * the mirror cannot vouch for the table.
 */
export function personaRemovals(
  client: MeshCoreClient,
  state: PersonaState,
): string[] {
  if (state.contacts === null || !client.contactsSynced) return [];
  const wanted = new Set(state.contacts.map((c) => c.pubkey));
  return Object.values(client.contacts)
    .map((c) => c.pubkey)
    .filter((pubkey) => !wanted.has(pubkey));
}

/**
 * Whether the radio's contact table, as the client mirrors it, shows an apply
 * of `state` survived the radio restarting.
 *
 * @remarks The firmware saves contact writes lazily, so a restart can undo an
 * apply that every command acknowledged. Only what that leaves behind
 * counts: a contact of `state` missing or with other flags, or one of
 * `removed` back on the radio. A contact the radio added by itself from an
 * advert it heard meanwhile is neither.
 * @param removed - the public keys the apply removed, as
 * {@link personaRemovals} listed them before it.
 * @returns true when `state` leaves contacts alone; false when the mirror
 * cannot vouch for the table, since an unread table proves nothing.
 */
export function personaContactsApplied(
  client: MeshCoreClient,
  state: PersonaState,
  removed: readonly string[],
): boolean {
  if (state.contacts === null) return true;
  if (!client.contactsSynced) return false;
  const held = new Map(
    Object.values(client.contacts).map((c) => [c.pubkey, c]),
  );
  return (
    state.contacts.every(
      (want) => held.get(want.pubkey)?.flags === want.flags,
    ) && !removed.some((pubkey) => held.has(pubkey))
  );
}

/**
 * Validates a stored persona record section by section, so a record from
 * another build or a damaged one keeps whatever still reads correctly.
 *
 * @returns a state whose invalid or missing sections are null.
 */
export function normalizePersona(raw: unknown): PersonaState {
  const r = isRecord(raw) ? raw : {};
  return {
    name: typeof r.name === 'string' && r.name !== '' ? r.name : null,
    location: normalizeLocation(r.location),
    locationPolicy:
      typeof r.locationPolicy === 'number' &&
      LOC_POLICIES.includes(r.locationPolicy)
        ? r.locationPolicy
        : null,
    channels: normalizeList(r.channels, isPersonaChannel, (c) => c.idx),
    contacts: normalizeList(r.contacts, isPersonaContact, (c) => c.pubkey),
  };
}

/**
 * Encrypts and stores a persona's state under the key the vault's storage
 * root derives for that identity.
 *
 * @param publicKey - the identity's public key, lowercase hex, as `SELF_INFO`
 * reports it: it names the record.
 * @returns whether the write landed.
 * @throws RangeError for a malformed public key.
 * @throws Error when the vault has been locked, whose zeroed root would seal
 * the record under a key anyone can derive.
 */
export async function savePersona(
  vault: Vault,
  publicKey: string,
  state: PersonaState,
): Promise<boolean> {
  const key = await personaKey(vault, publicKey);
  return savePersonaState(publicKey, key, state);
}

/**
 * Loads a persona's state, stored by {@link savePersona}.
 *
 * @returns the normalized state, or null when this device has none for the
 * identity or it does not decrypt under the vault's root.
 * @throws RangeError for a malformed public key.
 * @throws Error when the vault has been locked.
 */
export async function loadPersona(
  vault: Vault,
  publicKey: string,
): Promise<PersonaState | null> {
  const key = await personaKey(vault, publicKey);
  const raw = await loadPersonaState(publicKey, key);
  return raw === null ? null : normalizePersona(raw);
}

/**
 * Seals the state a persona switch onto `publicKey` is about to apply, so a
 * switch cut off by a page reload can still be recognized and finished.
 *
 * @returns whether the write landed.
 * @throws as {@link savePersona} does.
 */
export async function savePendingSwitch(
  vault: Vault,
  publicKey: string,
  state: PersonaState,
): Promise<boolean> {
  const key = await personaKey(vault, publicKey);
  return savePendingPersona(publicKey, key, state);
}

/**
 * Loads the state of an unfinished switch onto `publicKey`, stored by
 * {@link savePendingSwitch}.
 *
 * @returns the normalized state, or null when there is none or it does not
 * decrypt under the vault's root — the switch was made from another vault.
 * @throws as {@link loadPersona} does.
 */
export async function loadPendingSwitch(
  vault: Vault,
  publicKey: string,
): Promise<PersonaState | null> {
  const key = await personaKey(vault, publicKey);
  const raw = await loadPendingPersona(publicKey, key);
  return raw === null ? null : normalizePersona(raw);
}

async function personaKey(vault: Vault, publicKey: string): Promise<CryptoKey> {
  if (!PUBKEY_HEX.test(publicKey)) {
    throw new RangeError('Public key must be 64 lowercase hex characters');
  }
  // A real root is 32 bytes of HMAC output; all zeros means lockVault ran.
  if (vault.root.every((b) => b === 0)) throw new Error('Vault is locked');
  return deriveIdentityStorageKey(
    vault.root,
    new Uint8Array(fromHex(publicKey, 32) as Uint8Array),
  );
}

// The commands that take the radio from its mirrored state to `state`, in
// order. Each is a closure over what it writes, so the plan is fixed before
// the first one runs.
function planApply(
  client: MeshCoreClient,
  state: PersonaState,
): (() => Promise<void>)[] {
  const steps: (() => Promise<void>)[] = [];
  const info = client.selfInfo;

  const { name, location, locationPolicy } = state;
  if (name !== null && info?.name !== name) {
    steps.push(() => client.setNodeName(name));
  }
  if (
    location !== null &&
    (info?.advLat === undefined ||
      info.advLon === undefined ||
      scaled(info.advLat) !== scaled(location.lat) ||
      scaled(info.advLon) !== scaled(location.lon))
  ) {
    steps.push(() => client.setLocation(location.lat, location.lon));
  }
  if (locationPolicy !== null && info?.advLocPolicy !== locationPolicy) {
    steps.push(() => client.setLocationPolicy(locationPolicy));
  }

  if (state.channels !== null) {
    const slotCount = client.deviceInfo?.maxChannels || MAX_CHANNEL_SLOTS;
    const wanted = new Map(state.channels.map((ch) => [ch.idx, ch]));
    const unread = client.unreadChannelSlots;
    const slots = new Set([
      ...Object.values(client.channels).map((ch) => ch.idx),
      ...unread,
      ...wanted.keys(),
    ]);
    for (const idx of [...slots].sort((a, b) => a - b)) {
      if (idx >= slotCount) continue;
      const want = wanted.get(idx);
      const have = client.channels[idx];
      if (!want) {
        steps.push(() => client.removeChannel(idx));
      } else if (
        unread.has(idx) ||
        !have?.secret ||
        have.name !== want.name ||
        toHex(have.secret) !== want.secret
      ) {
        const secret = fromHex(want.secret, 16) as Uint8Array;
        steps.push(() => client.setChannel(idx, want.name, secret));
      }
    }
  }

  if (state.contacts !== null) {
    if (!client.contactsSynced) {
      throw new Error('The radio contact table has not been read');
    }
    const wanted = new Map(state.contacts.map((c) => [c.pubkey, c]));
    const held = new Map(
      Object.values(client.contacts).map((c) => [c.pubkey, c]),
    );
    for (const [pubkey, have] of held) {
      if (!wanted.has(pubkey)) steps.push(() => client.removeContact(have));
    }
    for (const [pubkey, want] of wanted) {
      const have = held.get(pubkey);
      if (!have) {
        const contact = toContact(want);
        steps.push(() => client.addContact(contact));
      } else if (have.flags !== want.flags) {
        // Re-sending the contact re-sends its route, so a multi-byte-hash
        // route the mirror holds without its hops goes out as flood.
        const contact = withKnownRoute({ ...have, flags: want.flags });
        steps.push(() => client.addContact(contact));
      }
    }
  }
  return steps;
}

// The firmware stores coordinates as integer microdegrees, so two readings of
// one stored value can differ in the last float bits.
function scaled(deg: number): number {
  return Math.round(deg * LATLON_SCALE);
}

// The number of path bytes an `out_path_len` byte stands for: its top two
// bits select the hash size (mode + 1 bytes per hop, mode 3 reserved), its
// low six the hop count; 255 is no route. -1 for a reserved mode.
function routeBytes(outPathLen: number): number {
  if (outPathLen === 255) return 0;
  const mode = outPathLen >> 6;
  return mode === 3 ? -1 : (outPathLen & 63) * (mode + 1);
}

// `parseContact` keeps a path only for single-byte-hash routes, so a contact
// on any other has a hop count but no hops. Re-adding it as is would route it
// through zeroed hashes; no route makes it flood instead.
function withKnownRoute(c: Contact): Contact {
  return routeBytes(c.outPathLen) === c.path.length
    ? c
    : { ...c, outPathLen: 255, path: new Uint8Array(0) };
}

function toPersonaContact(contact: Contact): PersonaContact {
  const c = withKnownRoute(contact);
  return {
    pubkey: c.pubkey,
    advType: c.advType,
    flags: c.flags,
    outPathLen: c.outPathLen,
    path: toHex(c.path),
    name: c.name,
    lastAdvert: c.lastAdvert ?? 0,
    advLat: c.advLat ?? 0,
    advLon: c.advLon ?? 0,
  };
}

function toContact(c: PersonaContact): Contact {
  return {
    pubkey: c.pubkey,
    pubkeyPrefix: c.pubkey.slice(0, 12),
    pubkeyBytes: fromHex(c.pubkey, 32) as Uint8Array,
    advType: c.advType,
    flags: c.flags,
    outPathLen: c.outPathLen,
    path: fromHex(c.path) as Uint8Array,
    name: c.name,
    lastAdvert: c.lastAdvert,
    advLat: c.advLat,
    advLon: c.advLon,
  };
}

function normalizeLocation(v: unknown): PersonaState['location'] {
  if (!isRecord(v)) return null;
  const { lat, lon } = v;
  return typeof lat === 'number' &&
    typeof lon === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
}

// All or nothing per list: applying a list with an entry dropped would remove
// that entry from the radio.
function normalizeList<T>(
  v: unknown,
  valid: (item: unknown) => item is T,
  id: (item: T) => unknown,
): T[] | null {
  if (!Array.isArray(v) || !v.every(valid)) return null;
  const ids = new Set(v.map(id));
  return ids.size === v.length ? v : null;
}

function isPersonaChannel(v: unknown): v is PersonaChannel {
  return (
    isRecord(v) &&
    isByte(v.idx) &&
    typeof v.name === 'string' &&
    typeof v.secret === 'string' &&
    SECRET_HEX.test(v.secret)
  );
}

function isPersonaContact(v: unknown): v is PersonaContact {
  return (
    isRecord(v) &&
    typeof v.pubkey === 'string' &&
    PUBKEY_HEX.test(v.pubkey) &&
    isByte(v.advType) &&
    isByte(v.flags) &&
    isByte(v.outPathLen) &&
    typeof v.path === 'string' &&
    PATH_HEX.test(v.path) &&
    routeBytes(v.outPathLen) * 2 === v.path.length &&
    typeof v.name === 'string' &&
    isIntIn(v.lastAdvert, 0, 0xffffffff) &&
    isIntIn(v.advLat, -0x80000000, 0x7fffffff) &&
    isIntIn(v.advLon, -0x80000000, 0x7fffffff)
  );
}

function isByte(v: unknown): v is number {
  return isIntIn(v, 0, 255);
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
