// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { microToDeg } from '@/lib/utils';
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
    });
  }

  return nodes;
}

/**
 * Mean latitude/longitude of the given located nodes, or `null` when the list
 * is empty. Used to center the map when this node reports no fix of its own.
 */
export function averageCenter(nodes: MapNode[]): [number, number] | null {
  if (nodes.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const node of nodes) {
    lat += node.lat;
    lon += node.lon;
  }
  return [lat / nodes.length, lon / nodes.length];
}
