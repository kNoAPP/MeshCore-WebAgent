// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import L from 'leaflet';
import 'leaflet.markercluster';
import i18n from '@/lib/i18n';
import { MAP_CLUSTER_SIZES_PX, MAP_MARKER_SIZE_PX } from '@/lib/map/config';
import {
  FAVORITE_OUTLINE,
  FAVORITE_OUTLINE_WIDTH,
  MARKER_STYLES,
  markerStyle,
  shapeSvg,
} from '@/lib/map/markers';
import type { MapNode } from '@/lib/map/nodes';
import { contactCategory, type ContactCategory } from '@/lib/utils';

/**
 * Client-only Leaflet icon helpers shared by every map surface (the Map page
 * and the Neighbors map). Imports `leaflet`, so it must only be pulled into a
 * chunk that already loads lazily behind `ssr: false`.
 */

/** Escapes a string for safe insertion into marker/tooltip HTML. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}

/**
 * A plotted marker tagged with the node it draws, so a cluster glyph can read
 * its children's categories back out of the cluster the plugin hands it.
 */
export type NodeMarker = L.Marker & { meshNode: MapNode };

/**
 * Builds a `divIcon` for a node — category shape/color, self ringed, and a
 * gold border on favorited contacts.
 *
 * @param label - the node's name, rendered beside the glyph; omit to draw the
 * glyph alone. The caller decides which markers are worth naming.
 */
export function nodeIcon(node: MapNode, label?: string): L.DivIcon {
  const size = MAP_MARKER_SIZE_PX;
  // Escaped, because unlike the static category shapes this is node-supplied
  // text going into `divIcon` HTML.
  const text =
    label === undefined
      ? ''
      : `<span class="map-marker-label">${escapeHtml(label)}</span>`;
  const { shape, color } = markerStyle(node.advType);
  const cls =
    node.kind === 'self'
      ? 'map-marker map-marker-self'
      : node.kind === 'advert'
        ? 'map-marker map-marker-cached'
        : 'map-marker';
  const svg = node.favorite
    ? shapeSvg(shape, color, size, FAVORITE_OUTLINE, FAVORITE_OUTLINE_WIDTH)
    : shapeSvg(shape, color, size);
  return L.divIcon({
    html: `<div class="${cls}" style="width:${size}px;height:${size}px">${svg}${text}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// The one category every child shares, or `null` when they disagree.
function commonCategory(markers: L.Marker[]): ContactCategory | null {
  let shared: ContactCategory | null = null;
  for (const marker of markers) {
    const node = (marker as NodeMarker).meshNode;
    if (!node) return null;
    const category = contactCategory(node.advType);
    if (shared === null) shared = category;
    else if (shared !== category) return null;
  }
  return shared;
}

/**
 * Builds the glyph for a collapsed cluster: how many nodes it holds, on a disc
 * that grows with that count. A cluster whose nodes are all one category is
 * ringed in that category's color, so the legend keeps reading at regional
 * zoom; a mixed one takes a neutral shade rather than the accent, which is
 * already the companion category's color.
 *
 * @remarks Handed to `markerClusterGroup` as its `iconCreateFunction`, so the
 * plugin calls it for every cluster it forms and again after each re-cluster.
 * The count is the accessible name — the digits themselves are decorative, and
 * the node list beside the map is the navigable view of the same set.
 */
export function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const { size } =
    MAP_CLUSTER_SIZES_PX.find((bucket) => count <= bucket.maxCount) ??
    MAP_CLUSTER_SIZES_PX[MAP_CLUSTER_SIZES_PX.length - 1];
  const category = commonCategory(cluster.getAllChildMarkers());
  const color =
    category === null
      ? 'var(--map-cluster-mixed)'
      : MARKER_STYLES[category].color;
  return L.divIcon({
    html:
      `<div class="map-cluster" role="img" style="width:${size}px;height:${size}px;--map-cluster-color:${color}" ` +
      `aria-label="${escapeHtml(i18n.t('map.cluster', { count }))}">` +
      `<span aria-hidden="true">${count}</span></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
