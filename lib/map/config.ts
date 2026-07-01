// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Theme } from '@/lib/theme/config';

/**
 * Raster tile templates for the online basemap, keyed by app theme so the map
 * matches light/dark. CARTO's Positron (`light_all`) and Dark Matter
 * (`dark_all`) basemaps are used: they are web-app friendly (unlike OSM's
 * donation tiles) and only require attribution.
 *
 * @remarks Provider choice is a maintainer decision (see issue #68). The URL is
 * intentionally a single configurable constant so it can be swapped without
 * touching the map component. `{s}` is the Leaflet subdomain token and `{r}`
 * resolves to `@2x` on hi-DPI displays (via the layer's `detectRetina`), so
 * labels stay crisp under the app's 1.25 CSS zoom — matching CARTO's standard
 * Leaflet integration examples.
 */
export const TILE_URLS: Record<Theme, string> = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

/** Attribution shown on the online basemap, required by the tile provider. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Upper bound on plotted markers, so a busy mesh can't stall the renderer. */
export const MAX_MAP_MARKERS = 500;

/**
 * Persisted, user-tunable map state. `center`/`zoom` restore the last viewport.
 */
export interface MapPrefs {
  center: [number, number]; // [lat, lon] in decimal degrees
  zoom: number;
}

/** localStorage key for the persisted {@link MapPrefs}. */
export const MAP_PREFS_STORAGE_KEY = 'meshcore.mapPrefs';

/** Default viewport (a whole-world view). */
export const DEFAULT_MAP_PREFS: MapPrefs = {
  center: [20, 0],
  zoom: 2,
};

/** Returns `value` when it is a finite number, otherwise `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads the persisted map preferences from localStorage, validating each field
 * against {@link DEFAULT_MAP_PREFS}. Any missing or non-finite value (a `NaN`,
 * `Infinity`, or corrupted/tampered entry) falls back to the default, so a
 * broken store can never feed Leaflet a `NaN` center/zoom. Returns `null` when
 * nothing is stored yet (or on SSR/static build or a parse error) so callers
 * can tell a never-panned user — who should get smart initial centering — apart
 * from one whose saved viewport simply happens to equal the default.
 */
export function loadMapPrefs(): MapPrefs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MAP_PREFS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapPrefs>;
    return {
      center:
        Array.isArray(parsed.center) && parsed.center.length === 2
          ? [
              finiteOr(parsed.center[0], DEFAULT_MAP_PREFS.center[0]),
              finiteOr(parsed.center[1], DEFAULT_MAP_PREFS.center[1]),
            ]
          : DEFAULT_MAP_PREFS.center,
      zoom: finiteOr(parsed.zoom, DEFAULT_MAP_PREFS.zoom),
    };
  } catch {
    return null;
  }
}

/** Writes the map preferences to localStorage, ignoring quota/SSR failures. */
export function saveMapPrefs(prefs: MapPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}
