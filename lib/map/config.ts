// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Theme } from '@/lib/theme/config';

/**
 * Path (relative to the static export root) of the bundled low-resolution world
 * outline. Natural Earth `countries-110m`, shipped as TopoJSON so it needs no
 * network. Rendered as a vector underlay *beneath* the raster tiles: invisible
 * while tiles are present, but it shows country shapes (instead of blank gaps)
 * for areas that were never cached when the connection is offline. Cached by
 * the service worker so it survives a cold, offline reload.
 */
export const OFFLINE_BASEMAP_URL = '/map/countries-110m.json';

/**
 * Highest zoom level the background warm-up pre-fetches for the whole world (in
 * both themes), so a freshly offline client has at least coarse coverage of
 * places it never browsed. Tile count grows ~4x per level, so keep this low;
 * detail for areas the user actually visits is filled in by the service
 * worker's runtime tile caching.
 */
export const WARMUP_MAX_ZOOM = 4;

/**
 * Raster tile templates for the online basemap, keyed by app theme so the map
 * matches light/dark. CARTO's Positron/Dark Matter basemaps are used: they are
 * web-app friendly (unlike OSM's donation tiles) and only require attribution.
 *
 * @remarks Provider choice is a maintainer decision (see issue #68). The URL is
 * intentionally a single configurable constant so it can be swapped without
 * touching the map component. `{s}` is the Leaflet subdomain token. Tiles are
 * requested at `@2x` (512 px) and drawn in the default 256 px slots so labels
 * stay crisp under the app's 1.25 CSS zoom and on hi-DPI displays.
 */
export const TILE_URLS: Record<Theme, string> = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
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

/**
 * Reads the persisted map preferences from localStorage, merging onto defaults
 * and falling back to them on SSR/static build or any parse error.
 */
export function loadMapPrefs(): MapPrefs {
  if (typeof window === 'undefined') return DEFAULT_MAP_PREFS;
  try {
    const raw = window.localStorage.getItem(MAP_PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MapPrefs>;
      return {
        center:
          Array.isArray(parsed.center) && parsed.center.length === 2
            ? [Number(parsed.center[0]), Number(parsed.center[1])]
            : DEFAULT_MAP_PREFS.center,
        zoom:
          typeof parsed.zoom === 'number'
            ? parsed.zoom
            : DEFAULT_MAP_PREFS.zoom,
      };
    }
  } catch {}
  return DEFAULT_MAP_PREFS;
}

/** Writes the map preferences to localStorage, ignoring quota/SSR failures. */
export function saveMapPrefs(prefs: MapPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}
