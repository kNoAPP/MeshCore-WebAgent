// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
} from '@/lib/meshcore/constants';
import type { Contact } from '@/types/meshcore';

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

/** Constant-time-agnostic byte-array equality (length, then element-wise). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
  kind: 'channel' | 'direct',
  rawId: string | number,
): string {
  return `${kind}:${rawId}`;
}

/**
 * Formats a duration in seconds as a compact `1d 2h 3m 4s` string (zero units
 * dropped).
 */
export function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`]
    .filter(Boolean)
    .join(' ');
}

/**
 * Formats airtime seconds with a unit that scales: `s` under a minute, `m`,
 * then `h`.
 */
export function fmtAirtime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${(secs / 60).toFixed(1)}m`;
  return `${(secs / 3600).toFixed(2)}h`;
}

/** Formats millivolts as volts, e.g. `4.16 V`. */
export function fmtVoltage(mv: number): string {
  return `${(mv / 1000).toFixed(2)} V`;
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
