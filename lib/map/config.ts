// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Theme } from '@/lib/theme/config';

/**
 * Public CARTO basemap key, required on every raster tile request. This is a
 * domain-scoped, client-side key (it ships in the bundle by design, like a Maps
 * JS key) — it grants tile access only and is not a secret.
 */
const CARTO_KEY = 'cb1_2zjs_1_d225a9fcb1726184a3787e95';

/**
 * Raster tile templates for the online basemap, keyed by app theme so the map
 * matches light/dark. CARTO's Positron (`light_all`) and Dark Matter
 * (`dark_all`) basemaps are used: they are web-app friendly (unlike OSM's
 * donation tiles) and only require attribution plus {@link CARTO_KEY}.
 *
 * @remarks Provider choice is a maintainer decision (see issue #68). The URL is
 * intentionally a single configurable constant so it can be swapped without
 * touching the map component. `{s}` is the Leaflet subdomain token and `{r}`
 * resolves to `@2x` on hi-DPI displays (via the layer's `detectRetina`), so
 * labels stay crisp under the app's 1.25 CSS zoom — matching CARTO's standard
 * Leaflet integration examples.
 */
export const TILE_URLS: Record<Theme, string> = {
  dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
  light: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
};

/** Attribution shown on the online basemap, required by the tile provider. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Upper bound on plotted markers, so a busy mesh can't stall the renderer. Each
 * marker is a plain Leaflet `divIcon` (one DOM node), so this is effectively a
 * DOM-node budget; beyond a few thousand, prefer marker clustering over a
 * higher cap.
 */
export const MAX_MAP_MARKERS = 2000;

/**
 * Edge length, in pixels, of a node marker (the colored shape and its square
 * bounding box). Small shapes keep clusters legible when zoomed out; adjust
 * this single value to resize every marker.
 */
export const MAP_MARKER_SIZE_PX = 16;

/**
 * Stroke weight, in pixels, of a link polyline (e.g. a repeater→neighbor edge
 * on the Neighbors map). The line's color follows the theme via the
 * `.meshcore-edge` rule in `app/globals.css`.
 */
export const MAP_EDGE_WEIGHT = 2.5;

/** Opacity of a link polyline, softened so it reads under its node markers. */
export const MAP_EDGE_OPACITY = 0.8;

/**
 * The opening viewport for a Leaflet map: either a fixed `center`/`zoom`, or a
 * set of `bounds` (one `[lat, lon]` per node) to frame with
 * {@link https://leafletjs.com/reference.html#map-fitbounds | fitBounds}.
 */
export type StartView =
  { center: [number, number]; zoom: number } | { bounds: [number, number][] };

/**
 * Persisted, user-tunable map state. `center`/`zoom` restore the last viewport.
 */
export interface MapPrefs {
  center: [number, number]; // [lat, lon] in decimal degrees
  zoom: number;
}

/** Default viewport (a whole-world view). */
export const DEFAULT_MAP_PREFS: MapPrefs = {
  center: [20, 0],
  zoom: 2,
};

/**
 * Zoom range the basemap can actually render. The floor the map enforces is
 * higher and depends on the container size, but a restored viewport only has
 * to land inside the tile layer's own range for Leaflet to clamp the rest.
 */
export const MAP_MIN_ZOOM = 0;
export const MAP_MAX_ZOOM = 20;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampedOr(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, finiteOr(value, fallback)));
}

/**
 * Normalizes an arbitrary (persisted or corrupt) value into valid
 * {@link MapPrefs}, validating each field against {@link DEFAULT_MAP_PREFS}.
 * Any missing or non-finite value (a `NaN`, `Infinity`, or corrupted/tampered
 * entry) falls back to the default, and every number is clamped to the range
 * Leaflet accepts, so a broken record can neither feed the map a `NaN` nor
 * strand it at an unreachable zoom. Returns `null` when nothing is stored
 * (`null`/`undefined`) so callers can tell a never-panned user — who should get
 * smart initial centering — apart from one whose saved viewport simply happens
 * to equal the default.
 */
export function normalizeMapPrefs(raw: unknown): MapPrefs | null {
  if (raw == null || typeof raw !== 'object') return null;
  const parsed = raw as Partial<MapPrefs>;
  return {
    center:
      Array.isArray(parsed.center) && parsed.center.length === 2
        ? [
            clampedOr(parsed.center[0], DEFAULT_MAP_PREFS.center[0], -90, 90),
            clampedOr(parsed.center[1], DEFAULT_MAP_PREFS.center[1], -180, 180),
          ]
        : DEFAULT_MAP_PREFS.center,
    zoom: clampedOr(
      parsed.zoom,
      DEFAULT_MAP_PREFS.zoom,
      MAP_MIN_ZOOM,
      MAP_MAX_ZOOM,
    ),
  };
}
