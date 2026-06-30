// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// MeshCore Companion service worker. Gives the app an offline-capable shell so
// the page (and the map) load after a cold reload with no network. Strategy:
//   - /version.json   → always network (never cached); drives the in-app
//                       update prompt, so it must reflect the live deploy.
//   - /_next/static/* → cache-first; these are content-hashed and immutable.
//   - CARTO basemap tiles → network-first, write-through to a size-capped tile
//                       cache, so an online session warms an offline copy and a
//                       dropped connection keeps rendering transparently.
//   - everything else same-origin (incl. navigations) → network-first with a
//                       cache fallback, so an online visit always gets the
//                       freshest build but an offline reload still works.

const CACHE = 'meshcore-shell-v1';
const TILE_CACHE = 'meshcore-tiles-v1';

// Host that serves the online basemap tiles (CARTO). Tile requests to this host
// are cached so the map keeps working offline.
const TILE_HOST = 'basemaps.cartocdn.com';

// Maximum bytes of basemap tiles to retain for offline use. Oldest tiles are
// evicted first once this is exceeded. This is the single knob for the offline
// tile budget — raise or lower it freely.
const TILE_CACHE_MAX_BYTES = 200 * 1024 * 1024;

// Tiles are loaded as opaque cross-origin images, whose byte size can't be read
// back, so the budget is enforced by an entry count derived from this estimate
// of an average @2x basemap tile.
const AVG_TILE_BYTES = 30 * 1024;
const MAX_TILES = Math.floor(TILE_CACHE_MAX_BYTES / AVG_TILE_BYTES);

// Run the (O(n)) eviction sweep only every N puts to keep tile loads cheap.
const TRIM_EVERY = 50;
let putsSinceTrim = 0;

// Precached on install so the vector underlay is available on a cold, offline
// reload (it backs the raster tiles wherever they are missing).
const PRECACHE_URLS = ['/map/countries-110m.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== TILE_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.hostname.endsWith(TILE_HOST)) {
    event.respondWith(tileCache(req));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/version.json') return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

// Network-first for basemap tiles: serve (and cache) the freshest tile when
// online, fall back to the cached copy when offline. Tiles are opaque
// cross-origin responses, so they are cached regardless of `ok` status and the
// budget is enforced by entry count (see MAX_TILES).
async function tileCache(req) {
  const cache = await caches.open(TILE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req, res.clone());
      if (++putsSinceTrim >= TRIM_EVERY) {
        putsSinceTrim = 0;
        await trimTileCache(cache);
      }
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

// Evict the oldest tiles (Cache keys are returned in insertion order) until the
// cache is back within the budget.
async function trimTileCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_TILES;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}
