// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import L from 'leaflet';
import { MAP_MARKER_SIZE_PX } from '@/lib/map/config';
import {
  FAVORITE_OUTLINE,
  FAVORITE_OUTLINE_WIDTH,
  markerStyle,
  shapeSvg,
} from '@/lib/map/markers';
import type { MapNode } from '@/lib/map/nodes';

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
 * Builds a `divIcon` for a node — category shape/color, self ringed, and a
 * gold border on favorited contacts. A node with no real position gets a
 * neutral dashed glyph instead of a category one, because its category is as
 * unknown as its location.
 */
export function nodeIcon(node: MapNode): L.DivIcon {
  const size = MAP_MARKER_SIZE_PX;
  if (node.positionUnknown) {
    const svg =
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="var(--map-unplaced)" stroke-width="2.5" stroke-dasharray="4 3" ` +
      `aria-hidden="true"><circle cx="12" cy="12" r="8.5" /></svg>`;
    return L.divIcon({
      html: `<div class="map-marker map-marker-unplaced" style="width:${size}px;height:${size}px">${svg}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }
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
    html: `<div class="${cls}" style="width:${size}px;height:${size}px">${svg}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
