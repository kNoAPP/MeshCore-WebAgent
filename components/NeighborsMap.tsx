// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useClockTick } from '@/hooks/useClockTick';
import {
  locateNeighborNode,
  repeaterAnchorNode,
  type MapEdge,
  type MapNode,
} from '@/lib/map/nodes';
import type { StartView } from '@/lib/map/config';
import { formatSnr } from '@/lib/i18n/format';
import { LEGEND_CATEGORIES } from '@/lib/map/markers';
import { contactCategory, heardAgeSecs } from '@/lib/utils';
import type { Neighbor } from '@/types/meshcore';
import type { Advert, Contact } from '@/types/meshcore';
import { BaseLeafletMap } from './BaseLeafletMap';
import { HeardWithinFilter } from './HeardWithinFilter';
import { MapLegend } from './MapLegend';
import { renderNodePopup } from './MapNodePopup';

// A neighbor resolving to the same stored node (or to the anchor itself) is
// drawn once. One that resolves to nothing is counted but not drawn: the
// repeater reported its SNR, not its position, and there is no honest place to
// put it on terrain — the legend says how many were left off.
function buildNeighborMap(
  contact: Contact,
  neighbors: Neighbor[],
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
): { nodes: MapNode[]; edges: MapEdge[]; unplacedCount: number } {
  const anchor = repeaterAnchorNode(contact);
  if (!anchor) return { nodes: [], edges: [], unplacedCount: 0 };

  const nodes: MapNode[] = [anchor];
  const edges: MapEdge[] = [];
  const seen = new Set<string>([anchor.key]);
  let unplacedCount = 0;

  for (const neighbor of neighbors) {
    const node = locateNeighborNode(neighbor.prefix, contacts, adverts);
    // A neighbor that resolves back to the anchor is a self-edge and carries no
    // information.
    if (node?.key === anchor.key) continue;
    if (!node) {
      unplacedCount++;
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

  return { nodes, edges, unplacedCount };
}

/**
 * A spatial view of a repeater's recently-heard neighbors: the repeater at the
 * center, each located neighbor plotted with its category marker, and an
 * SNR-labeled link between them. A neighbor whose position is unknown is left
 * off and reported as a count in the legend — the reply carries no bearing or
 * distance, so any placement would be invented. Reuses {@link BaseLeafletMap}
 * and the shared marker styling/legend so it matches the Map page. Loaded via
 * `dynamic` with `ssr: false` (Leaflet needs the DOM); render only when the
 * repeater itself is located.
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
  // The same per-radio window the Map page uses: one "how recent is relevant"
  // preference rather than two that drift apart.
  const heardWithinDays = useMeshStore((s) => s.mapFilters.heardWithinDays);
  // Measured against the wall clock, so the window has to keep advancing while
  // the tab sits open on a `neighbors` reply that is no longer changing.
  const nowSecs = useClockTick();
  // Subscribes to the locale so a language switch re-renders (and, via the
  // memo dependency below, rebuilds the localized SNR edge labels).
  const { t, i18n } = useTranslation();

  // Filtered before the map is built, so a neighbor and its SNR link leave
  // together — an edge to a node that is no longer plotted would draw to
  // nowhere. `Neighbor.lastHeard` is this radio's clock minus the age the
  // repeater reported, so it needs no skew allowance of its own.
  const shown = useMemo(() => {
    if (heardWithinDays === null) return neighbors;
    const maxAgeSecs = heardWithinDays * 86400;
    return neighbors.filter(
      (n) => heardAgeSecs(n.lastHeard, nowSecs) <= maxAgeSecs,
    );
  }, [neighbors, heardWithinDays, nowSecs]);
  const hiddenByAge = neighbors.length - shown.length;

  const { nodes, edges, unplacedCount } = useMemo(
    () => buildNeighborMap(contact, shown, contacts, adverts),
    // `i18n.language` isn't referenced in the callback, but it drives the
    // localized SNR edge labels through `formatSnr`, so a locale switch must
    // rebuild the map data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contact, shown, contacts, adverts, i18n.language],
  );
  // A `neighbors` reply is whatever the repeater last heard advertise, so the
  // mix is not known ahead of time; listing only what is actually plotted keeps
  // the key to the handful of shapes on screen.
  const listed = useMemo(() => {
    const present = new Set(nodes.map((n) => contactCategory(n.advType)));
    return LEGEND_CATEGORIES.filter((c) => present.has(c));
  }, [nodes]);
  const anyFavorite = nodes.some((n) => n.favorite);

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
        // Named in place, the same as the Map page. Clustering stays off: a
        // collapsed endpoint would detach an SNR link from the node it belongs
        // to, and a repeater reports at most eight neighbors anyway.
        labels
        renderPopup={renderNodePopup}
      >
        <MapLegend listed={listed} showFavorite={anyFavorite}>
          <div className='flex w-44 flex-col gap-2 border-t border-border px-2.5 py-2'>
            <HeardWithinFilter
              value={heardWithinDays}
              onChange={(days) =>
                useMeshStore.getState().setMapFilters({
                  ...useMeshStore.getState().mapFilters,
                  heardWithinDays: days,
                })
              }
            />
            {(unplacedCount > 0 || hiddenByAge > 0) && (
              // Capped so it wraps instead of stretching the whole legend to
              // the width of one long line.
              <p className='max-w-44 text-xs text-balance text-text2'>
                {unplacedCount > 0 &&
                  t('repeaterAdmin.neighbors.unplacedLegend', {
                    count: unplacedCount,
                  })}{' '}
                {hiddenByAge > 0 &&
                  t('repeaterAdmin.neighbors.hiddenByAge', {
                    count: hiddenByAge,
                  })}
              </p>
            )}
          </div>
        </MapLegend>
      </BaseLeafletMap>
    </div>
  );
}
