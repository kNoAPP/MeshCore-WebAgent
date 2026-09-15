// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import {
  locateNeighborNode,
  repeaterAnchorNode,
  type MapEdge,
  type MapNode,
} from '@/lib/map/nodes';
import type { StartView } from '@/lib/map/config';
import { formatSnr } from '@/lib/i18n/format';
import { destinationPoint, haversineKm } from '@/lib/utils';
import type { Neighbor } from '@/lib/meshcore/repeaterCli';
import type { Advert, Contact } from '@/types/meshcore';
import { BaseLeafletMap } from './BaseLeafletMap';
import { MapLegend } from './MapLegend';

// Fallback ring radius when no neighbor has a fix, so the unplaced ones still
// frame sensibly instead of collapsing onto the anchor.
const DEFAULT_RING_KM = 5;

// How far past the furthest located neighbor the unplaced ring sits, so it
// reads as outside the known set rather than among it.
const RING_MARGIN = 1.25;

// A neighbor resolving to the same stored node (or to the anchor itself) is
// drawn once. Neighbors that resolve to nothing still appear: the repeater told
// us their SNR, so they are parked on a ring around the anchor and drawn as
// unplaced rather than dropped.
function buildNeighborMap(
  contact: Contact,
  neighbors: Neighbor[],
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): { nodes: MapNode[]; edges: MapEdge[] } {
  const anchor = repeaterAnchorNode(contact);
  if (!anchor) return { nodes: [], edges: [] };

  const nodes: MapNode[] = [anchor];
  const edges: MapEdge[] = [];
  const seen = new Set<string>([anchor.key]);
  const unplaced: Neighbor[] = [];

  for (const neighbor of neighbors) {
    const node = locateNeighborNode(neighbor.prefix, contacts, adverts);
    // A neighbor that resolves back to the anchor is a self-edge and carries no
    // information; one that resolves to nothing goes on the ring below.
    if (node?.key === anchor.key) continue;
    if (!node) {
      unplaced.push(neighbor);
      continue;
    }
    if (!seen.has(node.key)) {
      seen.add(node.key);
      nodes.push(node);
    }
    edges.push({
      key: neighbor.prefix,
      from: [anchor.lat, anchor.lon],
      to: [node.lat, node.lon],
      label: formatSnr(neighbor.snr),
    });
  }

  if (unplaced.length > 0) {
    const furthestKm = nodes
      .slice(1)
      .reduce(
        (max, n) =>
          Math.max(max, haversineKm(anchor.lat, anchor.lon, n.lat, n.lon)),
        0,
      );
    const ringKm = (furthestKm || DEFAULT_RING_KM) * RING_MARGIN;
    // Spread evenly from due north; the bearing is arbitrary by definition, so
    // an even spread is the only honest arrangement.
    unplaced.forEach((neighbor, i) => {
      const bearing = (360 / unplaced.length) * i;
      const at = destinationPoint(anchor.lat, anchor.lon, ringKm, bearing);
      nodes.push({
        key: `unplaced:${neighbor.prefix}`,
        pubkeyPrefix: neighbor.prefix,
        name: neighbor.prefix,
        advType: 0,
        lat: at.lat,
        lon: at.lon,
        kind: 'advert',
        favorite: false,
        positionUnknown: true,
      });
      edges.push({
        key: neighbor.prefix,
        from: [anchor.lat, anchor.lon],
        to: [at.lat, at.lon],
        label: formatSnr(neighbor.snr),
        provisional: true,
      });
    });
  }

  return { nodes, edges };
}

/**
 * A spatial view of a repeater's recently-heard neighbors: the repeater at the
 * center, each located neighbor plotted with its category marker, and an
 * SNR-labeled link between them. Neighbors with no known position are parked on
 * a ring around the anchor rather than dropped, so a repeater whose neighbors
 * are all unlocated still gets a map. Reuses {@link BaseLeafletMap} and the
 * shared marker styling/legend so it matches the Map page. Loaded via `dynamic`
 * with `ssr: false` (Leaflet needs the DOM); render only when the repeater
 * itself is located.
 */
export function NeighborsMap({
  contact,
  neighbors,
}: {
  contact: Contact;
  neighbors: Neighbor[];
}) {
  const contacts = useMeshStore((s) => s.contacts);
  const adverts = useMeshStore((s) => s.advertCache);
  // Subscribes to the locale so a language switch re-renders (and, via the
  // memo dependency below, rebuilds the localized SNR edge labels).
  const { t, i18n } = useTranslation();

  const { nodes, edges } = useMemo(
    () => buildNeighborMap(contact, neighbors, contacts, adverts),
    // `i18n.language` isn't referenced in the callback, but it drives the
    // localized SNR edge labels through `formatSnr`, so a locale switch must
    // rebuild the map data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contact, neighbors, contacts, adverts, i18n.language],
  );
  const unplacedCount = nodes.filter((n) => n.positionUnknown).length;

  // Capture the opening viewport once, framing the initial node set; later
  // refreshes update the markers in place without yanking the viewport.
  const [startView] = useState<StartView>(() => ({
    bounds: nodes.map((n) => [n.lat, n.lon] as [number, number]),
  }));

  return (
    <div className='relative flex h-full w-full overflow-hidden rounded-lg border border-border'>
      <BaseLeafletMap
        nodes={nodes}
        edges={edges}
        startView={startView}
        // Embedded in the Neighbors tab's scroll container: wheeling over it
        // should scroll the tab, not zoom the map.
        scrollWheelZoom={false}
        onNodeClick={(node) => {
          // The anchor is the repeater already open in this admin view, so only
          // neighbor markers (always contacts/adverts, never self) open a
          // manage panel. An unplaced node has nothing to open — the repeater's
          // four bytes are everything we know about it.
          if (
            node.kind === 'self' ||
            node.positionUnknown ||
            node.pubkeyPrefix === contact.pubkeyPrefix
          )
            return;
          useMeshStore
            .getState()
            .setManagePanel({ kind: node.kind, id: node.pubkeyPrefix });
        }}
      >
        <MapLegend>
          {unplacedCount > 0 && (
            // Capped so it wraps instead of stretching the whole legend to the
            // width of one long line.
            <p className='max-w-44 border-t border-border px-2.5 py-1.5 text-xs text-balance text-text2'>
              {t('repeaterAdmin.neighbors.unplacedLegend', {
                count: unplacedCount,
              })}
            </p>
          )}
        </MapLegend>
      </BaseLeafletMap>
    </div>
  );
}
