// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
  PUBLIC_CHANNEL_SECRET,
} from '@/lib/meshcore/constants';
import type { ActiveConvo, Advert, Contact } from '@/types/meshcore';

/**
 * Hex-encodes bytes as lowercase, two chars per byte.
 *
 * @param separator - inserted between bytes (e.g. `' '`); default none.
 */
export function toHex(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(separator);
}

/**
 * Generates a fresh random 16-byte channel secret for a new private channel.
 */
export function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * How old a `lastHeard` timestamp is, in seconds, clamped against a skewed
 * sender clock: the magnitude of its offset from now, so a node whose clock
 * runs ahead reads as *that far* old instead of as freshly heard.
 *
 * @param nowSecs - the reference clock in epoch seconds; pass one captured
 * value when ranking or filtering a whole set, so every entry is measured
 * against the same instant.
 */
export function heardAgeSecs(
  lastHeard: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): number {
  return Math.abs(nowSecs - lastHeard);
}

// How far past now a skew-corrected claim may land and still be trusted. A
// small overshoot is drift between the measurement and this claim, and clamps
// to "just now". A large one means the node's clock moved again after we
// measured it, so the correction no longer describes this claim at all —
// without this, a node whose owner set its RTC forward and then powered it
// off would read "just now" and pass every freshness window forever.
const SKEW_OVERSHOOT_TOLERANCE_SECS = 60;

/**
 * Our-clock estimate of when a node was last heard, across the contact table
 * and the advert cache, or `undefined` when neither carries a sighting. Never
 * returns a future timestamp, so callers may subtract it from now directly.
 *
 * @remarks The raw timestamps are the *sender's* clock and MeshCore nodes
 * routinely run without a synchronized RTC, so this is the single place the
 * two are reconciled. Each source is converted to our clock independently and
 * the most recent estimate wins:
 *
 * - `advert.observedAt` — our clock at a live push, so exact.
 * - a raw claim minus {@link Advert.clockSkewSecs} — the receive time
 *   recovered from a skew measured earlier, which is what makes a
 *   contact-table read usable long after the push that measured it.
 * - a raw claim folded into the past by {@link heardAgeSecs} — skew unknown,
 *   so fall back to the magnitude. That is the same rule the age filters
 *   already apply, which is why a node's displayed age agrees with where it
 *   sorts.
 *
 * Taking the most recent rather than preferring one source matters because
 * `observedAt` persists in the advert cache: a sighting from a previous
 * session would otherwise outrank a contact row showing the node advertised
 * minutes ago. Each estimate is a lower bound on "last heard", so the newest
 * is the best one.
 *
 * A measured skew is believed until a later sighting replaces it, so a node
 * whose owner corrects its clock and then goes quiet keeps being aged by the
 * offset it no longer has. That cannot be detected from a claim alone: given
 * one timestamp and a skew, "corrected clock, heard minutes ago" and "still
 * skewed, heard a day ago" are the same two numbers. Ranking the corrected
 * estimate against the uncorrected one does not resolve it either — it would
 * trade this case for the commoner one of a genuinely skewed node heard
 * longer ago than its own offset, which the uncorrected estimate reads as far
 * too fresh. The next advert we hear live re-measures and heals it.
 *
 * Every surface that shows or filters on this age shares this helper, or
 * selecting a row would change the apparent age of the node it selects.
 *
 * @param nowSecs - the reference clock in epoch seconds; pass one captured
 * value when ranking or filtering a whole set.
 */
export function normalizedLastHeard(
  contact?: Contact,
  advert?: Advert,
  nowSecs: number = Math.floor(Date.now() / 1000),
): number | undefined {
  const skew = advert?.clockSkewSecs;
  const estimates: number[] = [];
  if (advert?.observedAt !== undefined) estimates.push(advert.observedAt);
  for (const claim of [contact?.lastAdvert, advert?.lastHeard]) {
    if (typeof claim !== 'number' || claim <= 0) continue;
    const corrected = skew === undefined ? undefined : claim - skew;
    estimates.push(
      corrected !== undefined &&
        corrected <= nowSecs + SKEW_OVERSHOOT_TOLERANCE_SECS
        ? corrected
        : nowSecs - heardAgeSecs(claim, nowSecs),
    );
  }
  if (estimates.length === 0) return undefined;
  // Clamped even though every branch above aims at the past: `observedAt` is
  // written from a live `Date.now()` while callers pass a tick that can be
  // seconds stale, and a correction may land just inside the tolerance above.
  return Math.min(Math.max(...estimates), nowSecs);
}

/**
 * Orders adverts freshest first by {@link normalizedLastHeard}, returning a
 * new array.
 *
 * @remarks Ranked on the our-clock estimate rather than the raw `lastHeard`,
 * which is the sender's claim: a live push records `observedAt` without
 * touching `lastHeard`, so ranking on the raw value would sort a node we just
 * heard by whatever its own clock last claimed. Used for display order and for
 * cache eviction, so a node heard moments ago can neither rank below nor be
 * evicted by one we have not heard since.
 */
export function sortAdvertsByHeard(adverts: readonly Advert[]): Advert[] {
  const nowSecs = Math.floor(Date.now() / 1000);
  // Keyed once per entry rather than on each comparison: the Discover list
  // re-sorts the whole cache (up to ADVERT_CACHE_LIMIT) on every keystroke,
  // and this helper walks both claim sources per call.
  return adverts
    .map((advert) => ({
      advert,
      heard: normalizedLastHeard(undefined, advert, nowSecs) ?? 0,
    }))
    .sort((a, b) => b.heard - a.heard)
    .map(({ advert }) => advert);
}

const utf8 = new TextEncoder();

/**
 * Splits a channel message into its sender and body. The firmware formats the
 * text as `<sender>: <body>`; `sender` is `null` when it doesn't.
 */
export function splitChannelMessage(text: string): {
  sender: string | null;
  body: string;
} {
  const colonIdx = text.indexOf(': ');
  if (colonIdx === -1) return { sender: null, body: text };
  return { sender: text.slice(0, colonIdx), body: text.slice(colonIdx + 2) };
}

/**
 * Whether a message body at-mentions this radio. Mentions are written as
 * `@[Node name]` — the bracketed form the composer inserts — and matched
 * case-insensitively against the radio's own name.
 *
 * @param body - Message text with any channel `sender: ` prefix removed.
 */
export function mentionsSelf(body: string, deviceName: string): boolean {
  if (deviceName.length === 0) return false;
  return body.toLowerCase().includes(`@[${deviceName.toLowerCase()}]`);
}

/** UTF-8 byte length of a string — what the radio measures text against. */
export function utf8ByteLength(text: string): number {
  return utf8.encode(text).length;
}

/**
 * Truncates `text` to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte code point. Counts each code point's encoded length in a single
 * pass and stops at the first one that would overflow, so a huge paste is only
 * scanned up to the cut point and the original string is sliced once. Iterating
 * by code point keeps emoji and accents intact, so the result is always valid
 * UTF-8 the radio can decode.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0; // UTF-16 index just past the last code point that fits
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const chBytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes + chBytes > maxBytes) return text.slice(0, end);
    bytes += chBytes;
    end += ch.length;
  }
  return text;
}

/**
 * Derives a hashtag channel's shared secret from its name.
 *
 * @param name - the channel name **without** the leading `#`.
 * @returns the first 16 bytes of `SHA-256("#" + name)`, so anyone entering the
 * same name joins the same channel.
 */
export async function deriveHashtagSecret(name: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`#${name}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash).slice(0, 16);
}

/**
 * Computes the 1-byte channel identifier carried in group packet headers.
 *
 * @returns the first byte of `SHA-256(secret)` as two hex chars.
 */
export async function channelHashHex(secret: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(secret));
  return toHex(new Uint8Array(hash).slice(0, 1));
}

/**
 * Byte-array equality, in constant time for arrays of equal length.
 *
 * @remarks Every byte is compared, rather than stopping at the first
 * difference, so the loop's running time does not depend on where the arrays
 * first differ and cannot say how much of them matched. That matters where
 * one side is secret, such as a channel secret;
 * elsewhere it costs a few extra iterations. Arrays of different lengths
 * return at once: the length is never hidden, only the contents.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Whether `v` is an object whose fields can be read by name: any object but
 * null and arrays. It says nothing about which fields are present.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether a channel secret is MeshCore's well-known Public channel key. The
 * slot index says nothing: the Public channel can be removed and re-added in
 * any slot, so it is only ever identified by {@link PUBLIC_CHANNEL_SECRET}.
 */
export function isPublicChannelSecret(secret?: Uint8Array): boolean {
  return !!secret && bytesEqual(secret, PUBLIC_CHANNEL_SECRET);
}

/**
 * Decodes a hex string to bytes, tolerating whitespace.
 *
 * @param expectedLen - if given, the result must be exactly this many bytes.
 * @returns the bytes, or null if the input isn't valid hex of the expected
 * length.
 */
export function fromHex(hex: string, expectedLen?: number): Uint8Array | null {
  const clean = hex.trim().replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (expectedLen !== undefined && bytes.length !== expectedLen) return null;
  return bytes;
}

/** Builds a conversation key like `"channel:0"` or `"direct:b6cf429f4882"`. */
export function convoId(
  kind: ActiveConvo['kind'],
  rawId: string | number,
): string {
  return `${kind}:${rawId}`;
}

/**
 * Formats a number with the active locale's digit grouping (e.g. `1,024`).
 *
 * @param lang - the active `i18n.language` (a BCP-47 tag).
 */
export function fmtNum(n: number, lang: string): string {
  return n.toLocaleString(lang);
}

/**
 * Emoji icon for each {@link Contact.advType} (0/1 chat, 2 repeater, 3 room,
 * 4 sensor).
 */
export const ADV_ICON: Record<number, string> = {
  0: '👤',
  1: '👤',
  2: '📡',
  3: '🏠',
  4: '🌡️',
};

/**
 * Formats a hex public key for display: the full string when `full` is set,
 * otherwise a `4 + … + 4` hex preview (e.g. `a1b2…9f0e`). Keys shorter than the
 * preview length are returned unchanged.
 */
export function formatPubkey(pubkey: string, full: boolean): string {
  if (full || pubkey.length <= 8) return pubkey;
  return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

/**
 * Builds the `meshcore://contact/add` share URI for a contact — the same format
 * the official app encodes in its contact QR codes and accepts on import, so a
 * QR rendered from this string scans cleanly there. The `type` is the advert
 * type (1=companion, 2=repeater, 3=room, 4=sensor); our `advType` 0 ("none")
 * maps to 1. See https://docs.meshcore.io/qr_codes/.
 */
export function contactShareUri(
  contact: Pick<Contact, 'name' | 'pubkey' | 'advType'>,
): string {
  const params = new URLSearchParams({
    name: contact.name,
    public_key: contact.pubkey,
    type: String(contact.advType || 1),
  });
  return `meshcore://contact/add?${params.toString()}`;
}

/** A contact parsed from a `meshcore://contact/add` link. */
export interface ParsedContactUri {
  name: string;
  pubkey: string;
  advType: number;
}

/**
 * Parses a `meshcore://contact/add` link — the inverse of
 * {@link contactShareUri} and the format the official app encodes in contact QR
 * codes. The URI must carry a 64-hex `public_key`; `name` is URL-decoded and
 * `type` defaults to 1 (companion) when absent. Tolerant of malformed input:
 * returns `null` rather than throwing on any bad scheme, host, path, or key.
 *
 * @see https://docs.meshcore.io/qr_codes/
 */
export function parseContactUri(uri: string): ParsedContactUri | null {
  let parsed: URL;
  try {
    parsed = new URL(uri.trim());
  } catch {
    return null;
  }
  // The custom scheme keeps the prefix in `host` + `pathname` (e.g.
  // host `contact`, pathname `/add`), so join the two and match the literal.
  if (parsed.protocol !== 'meshcore:') return null;
  const path = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  if (path !== 'contact/add') return null;
  const pubkey = parsed.searchParams.get('public_key') ?? '';
  if (!fromHex(pubkey, 32)) return null;
  // `type` is the advert type (1–4); anything missing or unrecognized falls
  // back to 1 (companion), mirroring how {@link contactShareUri} encodes it.
  const advType = Number(parsed.searchParams.get('type'));
  return {
    advType: advType >= 1 && advType <= 4 ? advType : 1,
    name: parsed.searchParams.get('name') ?? '',
    pubkey: pubkey.toLowerCase(),
  };
}

/** A channel parsed from a `meshcore://channel/add` link. */
export interface ParsedChannelUri {
  name: string;
  secret: string;
}

/**
 * Parses a `meshcore://channel/add` link — the format the official app encodes
 * in channel QR codes. The URI must carry a 32-hex `secret`; `name` is
 * URL-decoded and defaults to empty when absent. Tolerant of malformed input:
 * returns `null` rather than throwing on any bad scheme, host, path, or secret.
 *
 * @see https://docs.meshcore.io/qr_codes/
 */
export function parseChannelUri(uri: string): ParsedChannelUri | null {
  let parsed: URL;
  try {
    parsed = new URL(uri.trim());
  } catch {
    return null;
  }
  // The custom scheme keeps the prefix in `host` + `pathname` (e.g.
  // host `channel`, pathname `/add`), so join the two and match the literal.
  if (parsed.protocol !== 'meshcore:') return null;
  const path = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  if (path !== 'channel/add') return null;
  const secret = parsed.searchParams.get('secret') ?? '';
  if (!fromHex(secret, 16)) return null;
  return {
    name: parsed.searchParams.get('name') ?? '',
    secret: secret.toLowerCase(),
  };
}

/** Translation key for each {@link Contact.advType}. */
export const ADV_LABEL_KEY = {
  0: 'advType.contact',
  1: 'advType.chat',
  2: 'advType.repeater',
  3: 'advType.roomServer',
  4: 'advType.sensor',
} as const;

/** Coarse category a contact falls into, used to filter the contacts list. */
export type ContactCategory = 'user' | 'repeater' | 'room' | 'sensor';

/**
 * Maps a {@link Contact.advType} to its category. Unknown/future advert types
 * fall back to "user" so they stay reachable in the contacts list rather than
 * disappearing from every filter.
 */
export function contactCategory(advType: number): ContactCategory {
  switch (advType) {
    case ADV_TYPE_REPEATER:
      return 'repeater';
    case ADV_TYPE_ROOM:
      return 'room';
    case ADV_TYPE_SENSOR:
      return 'sensor';
    default:
      return 'user';
  }
}

/**
 * Converts the firmware's micro-degree latitude/longitude encoding (an `int32`
 * scaled by 1e6) to decimal degrees.
 */
export function microToDeg(micro: number): number {
  return micro / 1e6;
}

/**
 * The inverse of {@link microToDeg}, for handing a coordinate that has already
 * been normalized to degrees (a `MapNode`) to a helper that takes the
 * firmware's encoding.
 */
export function degToMicro(deg: number): number {
  return Math.round(deg * 1e6);
}

/**
 * Formats a contact/advert location (micro-degree lat/lon) as
 * `"47.6062, -122.3321"`, or `null` when unset.
 *
 * @remarks The firmware writes `0` for an unset coordinate, so a zero (or
 * missing) latitude **or** longitude — including the `(0, 0)` "Null Island"
 * point — is treated as no location. Coordinates use a `.` decimal regardless
 * of locale: the pair is comma-separated, so a locale comma decimal would be
 * ambiguous, and `lat, lon` with a dot decimal is the standard geographic
 * notation the official app shows.
 */
export function formatLatLon(
  latMicro?: number,
  lonMicro?: number,
): string | null {
  if (!latMicro || !lonMicro) return null;
  return `${microToDeg(latMicro).toFixed(4)}, ${microToDeg(lonMicro).toFixed(4)}`;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in kilometers between two points, each in decimal
 * degrees, via the haversine formula.
 */
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Initial compass bearing from point A to point B, both in decimal degrees, as
 * degrees clockwise from north in the range `[0, 360)`.
 */
export function bearingDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLon = toRad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * The point `km` away from a start position along a compass `bearing`, in
 * decimal degrees — the inverse of {@link haversineKm}/{@link bearingDeg}.
 */
export function destinationPoint(
  lat: number,
  lon: number,
  km: number,
  bearing: number,
): { lat: number; lon: number } {
  const angular = km / EARTH_RADIUS_KM;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const brg = toRad(bearing);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/** Translation keys for the 8-point compass, ordered clockwise from north. */
export const COMPASS_KEYS = [
  'compass.n',
  'compass.ne',
  'compass.e',
  'compass.se',
  'compass.s',
  'compass.sw',
  'compass.w',
  'compass.nw',
] as const;

/**
 * Maps a bearing in degrees to its 8-point compass translation key (N, NE, E,
 * …), rounding to the nearest 45° sector.
 */
export function compassKey(bearing: number): (typeof COMPASS_KEYS)[number] {
  return COMPASS_KEYS[Math.round(bearing / 45) % 8];
}
