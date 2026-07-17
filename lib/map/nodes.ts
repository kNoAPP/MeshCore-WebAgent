// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { microToDeg } from '@/lib/utils';
import { FAVORITE_FLAG } from '@/lib/meshcore/constants';
import type { Advert, Contact, SelfInfo } from '@/types/meshcore';

/**
 * A node placed on the map, with coordinates already normalized to decimal
 * degrees. This is the single boundary where the two on-wire encodings are
 * reconciled (see {@link collectMapNodes}), so everything downstream — markers,
 * centering, the list fallback — works in one unit.
 */
export interface MapNode {
  /** Stable key: `pubkeyPrefix` for radios, `"self"` for this node. */
  key: string;
  pubkeyPrefix: string;
  name: string;
  advType: number;
  lat: number;
  lon: number;
  kind: 'self' | 'contact' | 'advert';
  /** Favorited contact — flagged with a gold marker outline. */
  favorite: boolean;
}

/**
 * A link drawn between two located nodes, with an optional label rendered as a
 * permanent tooltip at the line's midpoint (e.g. a repeater→neighbor edge
 * labeled with its link SNR). Endpoints are decimal degrees.
 */
export interface MapEdge {
  /** Stable key, distinct across the plotted edge set. */
  key: string;
  from: [number, number];
  to: [number, number];
  /** Midpoint label, already localized/formatted by the caller. */
  label?: string;
}

/** Decimal-degree coordinates of a node with a fix, or `null` if unset. */
type DegCoords = { lat: number; lon: number } | null;

/**
 * Normalizes a {@link Contact}/{@link Advert} micro-degree fix to degrees.
 * The firmware writes `0` for an unset coordinate, so a zero (or missing) lat
 * **or** lon — including `(0, 0)` "Null Island" — counts as no location.
 */
function contactCoords(latMicro?: number, lonMicro?: number): DegCoords {
  if (!latMicro || !lonMicro) return null;
  return { lat: microToDeg(latMicro), lon: microToDeg(lonMicro) };
}

/**
 * Reads a {@link SelfInfo} fix, which the firmware already reports in degrees —
 * so, unlike contacts, it must **not** be divided by 1e6 again. `0` is unset.
 */
function selfCoords(latDeg?: number, lonDeg?: number): DegCoords {
  if (!latDeg || !lonDeg) return null;
  return { lat: latDeg, lon: lonDeg };
}

/** This node's own position in degrees, or `null` when it has no fix. */
export function selfMapNode(self: SelfInfo | null): MapNode | null {
  if (!self) return null;
  const coords = selfCoords(self.advLat, self.advLon);
  if (!coords) return null;
  return {
    key: 'self',
    pubkeyPrefix: self.pubkey.slice(0, 12),
    name: self.name,
    advType: self.advType ?? 1,
    lat: coords.lat,
    lon: coords.lon,
    kind: 'self',
    favorite: false,
  };
}

/**
 * Builds the full set of located map nodes from store data, normalizing both
 * coordinate encodings to degrees at this single boundary: `SelfInfo` is in
 * degrees, while `Contact`/`Advert` are micro-degrees (÷1e6). Saved contacts
 * win over an advert from the same node (the contact opens the manage panel);
 * adverts only contribute nodes not already in the contact table. This node's
 * own `selfPrefix` is excluded so it never doubles up the ringed self marker
 * from {@link selfMapNode} (e.g. when the mesh echoes back our own advert).
 */
export function collectMapNodes(
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
  selfPrefix?: string,
): MapNode[] {
  const nodes: MapNode[] = [];
  const seen = new Set<string>();
  if (selfPrefix) seen.add(selfPrefix);

  for (const contact of Object.values(contacts)) {
    if (seen.has(contact.pubkeyPrefix)) continue;
    const coords = contactCoords(contact.advLat, contact.advLon);
    if (!coords) continue;
    seen.add(contact.pubkeyPrefix);
    nodes.push({
      key: contact.pubkeyPrefix,
      pubkeyPrefix: contact.pubkeyPrefix,
      name: contact.name || contact.pubkeyPrefix.slice(0, 8),
      advType: contact.advType,
      lat: coords.lat,
      lon: coords.lon,
      kind: 'contact',
      favorite: (contact.flags & FAVORITE_FLAG) !== 0,
    });
  }

  for (const advert of Object.values(adverts)) {
    if (seen.has(advert.pubkeyPrefix)) continue;
    const coords = contactCoords(advert.advLat, advert.advLon);
    if (!coords) continue;
    seen.add(advert.pubkeyPrefix);
    nodes.push({
      key: advert.pubkeyPrefix,
      pubkeyPrefix: advert.pubkeyPrefix,
      name: advert.name || advert.pubkeyPrefix.slice(0, 8),
      advType: advert.advType,
      lat: coords.lat,
      lon: coords.lon,
      kind: 'advert',
      favorite: false,
    });
  }

  return nodes;
}

/**
 * The administered repeater's own advertised position as an anchor map node,
 * or `null` when it reports no fix. Plotted with its normal category style (a
 * red repeater circle) so the Neighbors map can radiate SNR links from it.
 */
export function repeaterAnchorNode(contact: Contact): MapNode | null {
  const coords = contactCoords(contact.advLat, contact.advLon);
  if (!coords) return null;
  return {
    key: contact.pubkeyPrefix,
    pubkeyPrefix: contact.pubkeyPrefix,
    name: contact.name || contact.pubkeyPrefix.slice(0, 8),
    advType: contact.advType,
    lat: coords.lat,
    lon: coords.lon,
    kind: 'contact',
    favorite: (contact.flags & FAVORITE_FLAG) !== 0,
  };
}

/**
 * Whether a neighbor's `neighbors`-reply prefix identifies a stored node. The
 * neighbor prefix (8 hex, 4 bytes) is shorter than a stored contact/advert
 * prefix (12 hex), so a match is a stored key that begins with it; the reverse
 * (`prefix.startsWith(keyPrefix)`) is kept so an unusually short stored prefix
 * still resolves. Comparison is case-insensitive.
 */
function neighborPrefixMatches(
  prefix: string,
  pubkey: string,
  keyPrefix: string,
): boolean {
  const lower = prefix.toLowerCase();
  const key = pubkey.toLowerCase();
  const kp = keyPrefix.toLowerCase();
  return key.startsWith(lower) || kp.startsWith(lower) || lower.startsWith(kp);
}

/**
 * Resolves a neighbor's public-key prefix (from a `neighbors` reply) to a
 * located map node, matching saved contacts first — a contact opens its manage
 * panel — then the advert cache. A matched contact prefers its own fix but
 * falls back to a cached advert fix for the *same* node, matched by the
 * contact's full public key (not the shorter neighbor prefix) so a 4-byte
 * prefix collision can't lend another node's coordinates; it stays a `contact`
 * node either way. Returns `null` when no corresponding node has a GPS fix, so
 * the caller keeps that neighbor out of the map. See
 * {@link neighborPrefixMatches} for the prefix rule.
 */
export function locateNeighborNode(
  prefix: string,
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): MapNode | null {
  const contact = Object.values(contacts).find((c) =>
    neighborPrefixMatches(prefix, c.pubkey, c.pubkeyPrefix),
  );
  if (contact) {
    // Back up an unlocated contact only with an advert for the exact same node
    // (full-key match), never one merely sharing the 4-byte neighbor prefix.
    const cached = Object.values(adverts).find(
      (a) => a.pubkey.toLowerCase() === contact.pubkey.toLowerCase(),
    );
    const coords =
      contactCoords(contact.advLat, contact.advLon) ??
      (cached ? contactCoords(cached.advLat, cached.advLon) : null);
    if (!coords) return null;
    return {
      key: contact.pubkeyPrefix,
      pubkeyPrefix: contact.pubkeyPrefix,
      name: contact.name || contact.pubkeyPrefix.slice(0, 8),
      advType: contact.advType,
      lat: coords.lat,
      lon: coords.lon,
      kind: 'contact',
      favorite: (contact.flags & FAVORITE_FLAG) !== 0,
    };
  }

  // No saved contact: locate via the advert cache, matched by the neighbor
  // prefix.
  const advert = Object.values(adverts).find((a) =>
    neighborPrefixMatches(prefix, a.pubkey, a.pubkeyPrefix),
  );
  if (advert) {
    const coords = contactCoords(advert.advLat, advert.advLon);
    if (!coords) return null;
    return {
      key: advert.pubkeyPrefix,
      pubkeyPrefix: advert.pubkeyPrefix,
      name: advert.name || advert.pubkeyPrefix.slice(0, 8),
      advType: advert.advType,
      lat: coords.lat,
      lon: coords.lon,
      kind: 'advert',
      favorite: false,
    };
  }

  return null;
}
