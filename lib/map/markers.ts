// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { contactCategory, type ContactCategory } from '@/lib/utils';

/** A small geometric glyph used to plot a node on the map. */
export type MapShape = 'circle' | 'square' | 'hexagon' | 'triangle';

/**
 * The colored shape a node category draws as, plus the legend label key. Small
 * shapes (rather than large emoji icons) keep clusters legible when zoomed out,
 * and the shape/color pairing is what the on-map legend documents.
 */
export interface MarkerStyle {
  shape: MapShape;
  /** Fixed hex fill, chosen to read on both the light and dark basemaps. */
  color: string;
  /** `map.legend.*` translation key naming this category. */
  labelKey: string;
}

/**
 * Shape + color for each {@link ContactCategory}. Companions (users) are blue
 * squares, repeaters red circles, room servers green hexagons, and sensors
 * yellow triangles — the same pairings the on-map legend spells out.
 */
export const MARKER_STYLES = {
  user: { shape: 'square', color: '#3b82f6', labelKey: 'map.legend.companion' },
  repeater: {
    shape: 'circle',
    color: '#ef4444',
    labelKey: 'map.legend.repeater',
  },
  room: {
    shape: 'hexagon',
    color: '#22c55e',
    labelKey: 'map.legend.roomServer',
  },
  sensor: {
    shape: 'triangle',
    color: '#eab308',
    labelKey: 'map.legend.sensor',
  },
} as const satisfies Record<ContactCategory, MarkerStyle>;

/** Legend/marker categories in the order the legend lists them. */
export const LEGEND_CATEGORIES: ContactCategory[] = [
  'user',
  'repeater',
  'room',
  'sensor',
];

/** The {@link MarkerStyle} a node's `advType` maps to. */
export function markerStyle(advType: number): MarkerStyle {
  return MARKER_STYLES[contactCategory(advType)];
}

/**
 * The SVG child element(s) for a shape, drawn inside a `0 0 24 24` viewBox and
 * centered on (12, 12). Shared by the Leaflet marker string and the React
 * legend swatch so the two never drift.
 */
function shapeInner(shape: MapShape): string {
  switch (shape) {
    case 'circle':
      return '<circle cx="12" cy="12" r="8.5" />';
    case 'square':
      return '<rect x="4" y="4" width="16" height="16" rx="2.5" />';
    case 'hexagon':
      return '<polygon points="12,2.5 20.4,7.25 20.4,16.75 12,21.5 3.6,16.75 3.6,7.25" />';
    case 'triangle':
      return '<polygon points="12,4 21,20 3,20" />';
  }
}

/**
 * A self-contained `<svg>` string for a shape at the given pixel size. The
 * outline (white by default, gold for favorites) plus the marker's drop-shadow
 * keep every color visible on both the light and dark basemaps. The markup is
 * fully static (no user input), so it is safe to inject into a Leaflet
 * `divIcon` or a legend swatch.
 *
 * @param outline - stroke color; defaults to a white contrast ring.
 * @param outlineWidth - stroke width in viewBox units; defaults to `1.5`.
 */
export function shapeSvg(
  shape: MapShape,
  color: string,
  size: number,
  outline = '#ffffff',
  outlineWidth = 1.5,
): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${outline}" stroke-width="${outlineWidth}" stroke-linejoin="round" aria-hidden="true">${shapeInner(shape)}</svg>`;
}

/** Gold outline color marking a favorited contact's map marker. */
export const FAVORITE_OUTLINE = '#fbbf24';

/** Stroke width, in viewBox units, of a favorited marker's gold outline. */
export const FAVORITE_OUTLINE_WIDTH = 3;
