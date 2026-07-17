// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMeshStore } from '@/store/meshStore';
import {
  locateNeighborNode,
  repeaterAnchorNode,
  type MapEdge,
  type MapNode,
} from '@/lib/map/nodes';
import type { StartView } from '@/lib/map/config';
import { formatSnr } from '@/lib/i18n/format';
import type { Neighbor } from '@/lib/meshcore/repeaterCli';
import type { Advert, Contact } from '@/types/meshcore';
import { BaseLeafletMap } from './BaseLeafletMap';
import { MapLegend } from './MapLegend';

/**
 * Builds the located node/edge set for the Neighbors map: the administered
 * repeater as the anchor, each locatable neighbor as a node, and a labeled
 * SNR link from the anchor to each. Neighbors that resolve to the same stored
 * node (or the anchor itself) are drawn once. Coordinates come from the shared
 * `lib/map/nodes` resolvers; SNR labels are localized here.
 */
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

  for (const neighbor of neighbors) {
    const node = locateNeighborNode(neighbor.prefix, contacts, adverts);
    // Skip neighbors with no located node, and any that resolve back to the
    // anchor (a self-edge carries no information).
    if (!node || node.key === anchor.key) continue;
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

  return { nodes, edges };
}

/**
 * A spatial view of a repeater's recently-heard neighbors: the repeater at the
 * center, each locatable neighbor plotted with its category marker, and an
 * SNR-labeled link between them. Reuses {@link BaseLeafletMap} and the shared
 * marker styling/legend so it matches the Map page. Loaded via `dynamic` with
 * `ssr: false` (Leaflet needs the DOM); render only when the repeater is
 * located and at least one neighbor can be placed.
 *
 * @param control - overlay pinned to the map's top-right corner (the Refresh
 *   button), rendered above the tiles.
 */
export function NeighborsMap({
  contact,
  neighbors,
  control,
}: {
  contact: Contact;
  neighbors: Neighbor[];
  control?: ReactNode;
}) {
  const contacts = useMeshStore((s) => s.contacts);
  const adverts = useMeshStore((s) => s.advertCache);

  const { nodes, edges } = useMemo(
    () => buildNeighborMap(contact, neighbors, contacts, adverts),
    [contact, neighbors, contacts, adverts],
  );

  // Capture the opening viewport once, framing the initial node set; later
  // refreshes update the markers in place without yanking the viewport.
  const [startView] = useState<StartView>(() => ({
    bounds: nodes.map((n) => [n.lat, n.lon] as [number, number]),
  }));

  return (
    <div className='relative flex h-80 w-full overflow-hidden rounded-lg border border-(--border) sm:h-96'>
      <BaseLeafletMap
        nodes={nodes}
        edges={edges}
        startView={startView}
        onNodeClick={(node) => {
          // The anchor is the repeater already open in this admin view, so only
          // neighbor markers (always contacts/adverts, never self) open a
          // manage panel.
          if (
            node.kind === 'self' ||
            node.pubkeyPrefix === contact.pubkeyPrefix
          )
            return;
          useMeshStore
            .getState()
            .setManagePanel({ kind: node.kind, id: node.pubkeyPrefix });
        }}
      >
        {control && (
          <div className='pointer-events-auto absolute top-3 right-3 z-1000'>
            {control}
          </div>
        )}
        <MapLegend />
      </BaseLeafletMap>
    </div>
  );
}
