// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { heardAgeSecs, microToDeg } from '@/lib/utils';
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
  /**
   * Unix epoch seconds of the most recent advert from this node, or
   * `undefined` when neither store carries one. It is the *sender's* clock, so
   * every reader must measure it with `heardAgeSecs` rather than subtracting.
   */
  lastHeard?: number;
}

/**
 * A link drawn between two located nodes, with an optional label rendered as a
 * permanent tooltip along the line (e.g. a repeater→neighbor edge labeled with
 * its link SNR). Endpoints are decimal degrees.
 */
export interface MapEdge {
  /** Stable key, distinct across the plotted edge set. */
  key: string;
  from: [number, number];
  to: [number, number];
  /**
   * Label text, already localized/formatted by the caller. Where it lands is
   * decided per zoom by `lib/map/edgeLabel.ts`: the midpoint when that is
   * clear, otherwise further along the edge, and nowhere at all at a zoom where
   * the edges have collapsed into each other — so a caller must not assume the
   * label is drawn, or drawn at the midpoint.
   */
  label?: string;
}

type DegCoords = { lat: number; lon: number } | null;

/**
 * The freshest last-advert timestamp a node has, across the contact table and
 * the advert cache, or `undefined` when neither carries one.
 *
 * @remarks Not `Math.max`: these are the *sender's* clocks, so a contact row
 * still holding a future timestamp would outrank the advert that just corrected
 * it — and the node would then fail every "heard within" window while still
 * reading as freshly heard. Ranking by clock-clamped age is the rule
 * `sortByHeardAge` and `mergeAdvertCache` already apply. Every surface that
 * shows or filters on this age shares this helper, or selecting a row would
 * change the apparent age of the node it selects.
 *
 * @param nowSecs - the reference clock in epoch seconds; pass one captured
 * value when ranking a whole set.
 */
export function freshestHeard(
  contact?: Contact,
  advert?: Advert,
  nowSecs: number = Math.floor(Date.now() / 1000),
): number | undefined {
  const known = [contact?.lastAdvert, advert?.lastHeard].filter(
    (t): t is number => typeof t === 'number' && t > 0,
  );
  if (known.length === 0) return undefined;
  return known.reduce((best, t) =>
    heardAgeSecs(t, nowSecs) < heardAgeSecs(best, nowSecs) ? t : best,
  );
}

// The firmware writes `0` for an unset coordinate, so a zero (or missing) lat
// or lon — including `(0, 0)` "Null Island" — counts as no location.
function contactCoords(latMicro?: number, lonMicro?: number): DegCoords {
  if (!latMicro || !lonMicro) return null;
  return { lat: microToDeg(latMicro), lon: microToDeg(lonMicro) };
}

// The firmware reports a `SelfInfo` fix in degrees already — unlike contacts,
// it must not be divided by 1e6 again. `0` is unset.
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
  // Read once, so every node in this set is measured against the same instant.
  const nowSecs = Math.floor(Date.now() / 1000);

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
      lastHeard: freshestHeard(contact, adverts[contact.pubkeyPrefix], nowSecs),
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
      lastHeard: advert.lastHeard,
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

// A neighbor prefix (8 hex, 4 bytes) is shorter than a stored contact/advert
// prefix (12 hex), so a match is a stored key that begins with it; the reverse
// is kept so an unusually short stored prefix still resolves.
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

/** The one node a neighbor prefix names, seen from each store that knows it. */
interface NeighborMatch {
  contact: Contact | null;
  advert: Advert | null;
}

// Four bytes are not enough to be unique, so both stores are searched together
// and the candidates deduplicated by full public key: the same node commonly
// appears as both a saved contact and a cached advert, but two *different*
// keys sharing the prefix means the repeater has not told us which one it
// heard. Naming, plotting or adding either would be a guess, so an ambiguous
// prefix resolves to nothing.
function matchNeighbor(
  prefix: string,
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): NeighborMatch | null {
  const keys = new Set<string>();
  let contact: Contact | null = null;
  let advert: Advert | null = null;
  for (const c of Object.values(contacts)) {
    if (!neighborPrefixMatches(prefix, c.pubkey, c.pubkeyPrefix)) continue;
    keys.add(c.pubkey.toLowerCase());
    contact ??= c;
  }
  for (const a of Object.values(adverts)) {
    if (!neighborPrefixMatches(prefix, a.pubkey, a.pubkeyPrefix)) continue;
    keys.add(a.pubkey.toLowerCase());
    advert ??= a;
  }
  return keys.size === 1 ? { contact, advert } : null;
}

/**
 * The identity a `neighbors` reply's public-key prefix resolves to, whether or
 * not that node has a location. Saved contacts win over the advert cache, so a
 * neighbor the user already keeps shows the name they know it by.
 */
export interface NeighborIdentity {
  pubkeyPrefix: string;
  name: string;
  advType: number;
  kind: 'contact' | 'advert';
  favorite: boolean;
  /** Full public key, for actions that need more than the stored prefix. */
  pubkey: string;
}

/**
 * What a neighbor prefix resolves to: the node's identity, and its map node
 * when it also has a fix. Both come out of one pass over the stores, because
 * the advert cache is large and refreshes on every heard advert.
 */
export interface ResolvedNeighbor {
  /** `null` when the prefix is unknown or ambiguous. */
  identity: NeighborIdentity | null;
  /** `null` when {@link identity} is, or when that node has no GPS fix. */
  node: MapNode | null;
}

/**
 * Resolves a neighbor's public-key prefix (from a `neighbors` reply) against
 * the saved contacts and the advert cache. A saved contact wins — it is the
 * name the user knows the node by, and its marker opens a manage panel — and
 * an unlocated contact falls back to the cached advert's fix, which
 * {@link matchNeighbor} guarantees belongs to that same node; it stays a
 * `contact` either way. An unknown or ambiguous prefix resolves to nothing, so
 * a caller neither names nor plots a guess.
 */
export function resolveNeighbor(
  prefix: string,
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): ResolvedNeighbor {
  const match = matchNeighbor(prefix, contacts, adverts);
  if (!match) return { identity: null, node: null };
  const { contact, advert } = match;

  if (contact) {
    const name = contact.name || contact.pubkeyPrefix.slice(0, 8);
    const favorite = (contact.flags & FAVORITE_FLAG) !== 0;
    const coords =
      contactCoords(contact.advLat, contact.advLon) ??
      (advert ? contactCoords(advert.advLat, advert.advLon) : null);
    return {
      identity: {
        pubkeyPrefix: contact.pubkeyPrefix,
        name,
        advType: contact.advType,
        kind: 'contact',
        favorite,
        pubkey: contact.pubkey,
      },
      node: coords
        ? {
            key: contact.pubkeyPrefix,
            pubkeyPrefix: contact.pubkeyPrefix,
            name,
            advType: contact.advType,
            lat: coords.lat,
            lon: coords.lon,
            kind: 'contact',
            favorite,
          }
        : null,
    };
  }

  if (advert) {
    const name = advert.name || advert.pubkeyPrefix.slice(0, 8);
    const coords = contactCoords(advert.advLat, advert.advLon);
    return {
      identity: {
        pubkeyPrefix: advert.pubkeyPrefix,
        name,
        advType: advert.advType,
        kind: 'advert',
        favorite: false,
        pubkey: advert.pubkey,
      },
      node: coords
        ? {
            key: advert.pubkeyPrefix,
            pubkeyPrefix: advert.pubkeyPrefix,
            name,
            advType: advert.advType,
            lat: coords.lat,
            lon: coords.lon,
            kind: 'advert',
            favorite: false,
          }
        : null,
    };
  }

  return { identity: null, node: null };
}

/**
 * The located map node a neighbor prefix resolves to, or `null` when it has no
 * fix or the prefix is ambiguous. A caller that also needs the node's identity
 * should use {@link resolveNeighbor} instead of pairing this with a second
 * lookup.
 */
export function locateNeighborNode(
  prefix: string,
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): MapNode | null {
  return resolveNeighbor(prefix, contacts, adverts).node;
}
