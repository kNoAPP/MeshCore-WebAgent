// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Theme } from '@/lib/theme/config';
import { TILE_URLS, WARMUP_MAX_ZOOM } from '@/lib/map/config';

/** Themes to warm so the map can switch light/dark while offline. */
const THEMES: Theme[] = ['light', 'dark'];

/** Parallel tile fetches; kept low so warm-up never starves live requests. */
const CONCURRENCY = 6;

/** Run the (bandwidth-spending) warm-up at most once per page load. */
let started = false;

/** Expands a tile template for one tile coordinate. */
function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{s}', 'a')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** Every tile URL for the whole world from z0 to {@link WARMUP_MAX_ZOOM}. */
function worldTileUrls(): string[] {
  const urls: string[] = [];
  for (const theme of THEMES) {
    const template = TILE_URLS[theme];
    for (let z = 0; z <= WARMUP_MAX_ZOOM; z++) {
      const span = 2 ** z;
      for (let x = 0; x < span; x++) {
        for (let y = 0; y < span; y++) {
          urls.push(tileUrl(template, z, x, y));
        }
      }
    }
  }
  return urls;
}

/**
 * Pre-fetches the low-zoom world basemap (both themes) so a client that later
 * goes offline still has coarse coverage of places it never browsed. Fetches
 * pass through the service worker, which caches them; failures are ignored.
 *
 * @remarks Safe to call repeatedly — it self-limits to one run per page load
 * and skips entirely when the user is on a metered/Save-Data connection. Call
 * it only when online.
 */
export function warmOfflineTiles(): void {
  if (started || typeof window === 'undefined') return;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return;
  started = true;

  const urls = worldTileUrls();
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        await fetch(url, { mode: 'no-cors' });
      } catch {
        // Offline or blocked mid-run: stop quietly, runtime caching covers it.
        return;
      }
    }
  };

  void Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
