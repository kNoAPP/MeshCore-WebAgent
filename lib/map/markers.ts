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
  /**
   * CSS color for the fill — a `var(--map-*)` token, so the marker follows the
   * theme the way the basemap does. Leaflet `divIcon` HTML lives in the
   * document, so `var()` resolves normally.
   */
  color: string;
  /** `map.legend.*` translation key naming this category. */
  labelKey:
    | 'map.legend.companion'
    | 'map.legend.repeater'
    | 'map.legend.roomServer'
    | 'map.legend.sensor';
}

/**
 * Shape + color for each {@link ContactCategory}. Companions (users) are blue
 * squares, repeaters red circles, room servers green hexagons, and sensors
 * yellow triangles — the same pairings the on-map legend spells out.
 */
export const MARKER_STYLES = {
  user: {
    shape: 'square',
    color: 'var(--map-user)',
    labelKey: 'map.legend.companion',
  },
  repeater: {
    shape: 'circle',
    color: 'var(--map-repeater)',
    labelKey: 'map.legend.repeater',
  },
  room: {
    shape: 'hexagon',
    color: 'var(--map-room)',
    labelKey: 'map.legend.roomServer',
  },
  sensor: {
    shape: 'triangle',
    color: 'var(--map-sensor)',
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

// Drawn inside a `0 0 24 24` viewBox, centered on (12, 12). Shared by the
// Leaflet marker string and the React legend swatch so the two never drift.
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

/** Stroke width, in viewBox units, of the contrast ring around every glyph. */
const OUTLINE_WIDTH = 1.5;

/** Stroke width of the gold band that marks a favorite. */
const FAVORITE_BAND_WIDTH = 3.5;

/**
 * Stroke width of the neutral halo drawn outside the gold band, so a favorite
 * still reads against both basemaps.
 */
const FAVORITE_HALO_WIDTH = 5.5;

/** viewBox units of margin the favorite bands need on every side. */
const FAVORITE_MARGIN = 4;

/** Base viewBox extent every glyph is drawn in. */
const VIEW_EXTENT = 24;

/**
 * Rendered box size, in pixels, that keeps a favorite glyph's core shape the
 * same size as a plain glyph drawn at `size` — the favorite variant spends part
 * of its box on the bands, so the box has to grow by the same proportion.
 */
export function favoriteSizePx(size: number): number {
  return (size * (VIEW_EXTENT + 2 * FAVORITE_MARGIN)) / VIEW_EXTENT;
}

/**
 * A self-contained `<svg>` string for a shape at the given pixel size. The
 * contrast ring plus the marker's drop-shadow keep every color visible on both
 * the light and dark basemaps; both are `var(--map-*)` tokens that invert with
 * the basemap. The markup is fully static (no user input), so it is safe to
 * inject into a Leaflet `divIcon` or a legend swatch.
 *
 * @param favorite - wraps the glyph in a gold band with the neutral contrast
 * ring on both sides of it, so the amber never abuts the fill and cannot shift
 * how the category color reads. The bands are drawn in the box's margin, so
 * pass {@link favoriteSizePx} for `size` to keep the core shape unchanged.
 */
export function shapeSvg(
  shape: MapShape,
  color: string,
  size: number,
  favorite = false,
): string {
  const inner = shapeInner(shape);
  const extent = VIEW_EXTENT + (favorite ? 2 * FAVORITE_MARGIN : 0);
  const origin = favorite ? -FAVORITE_MARGIN : 0;
  // Painted outermost-first — halo, gold band, then the glyph itself — so each
  // layer covers the middle of the one beneath it and only its outer edge
  // survives as a band.
  const bands = favorite
    ? `<g fill="none" stroke="var(--map-outline)" stroke-width="${FAVORITE_HALO_WIDTH}">${inner}</g>` +
      `<g fill="none" stroke="var(--map-favorite)" stroke-width="${FAVORITE_BAND_WIDTH}">${inner}</g>`
    : '';
  return `<svg width="${size}" height="${size}" viewBox="${origin} ${origin} ${extent} ${extent}" fill="${color}" stroke="var(--map-outline)" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round" aria-hidden="true">${bands}${inner}</svg>`;
}
