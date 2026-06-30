// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// MeshCore Companion service worker. Gives the app an offline-capable shell so
// the page (and the bundled offline map basemap) load after a cold reload with
// no network. Strategy:
//   - /version.json   → always network (never cached); drives the in-app
//                       update prompt, so it must reflect the live deploy.
//   - /_next/static/* → cache-first; these are content-hashed and immutable.
//   - everything else same-origin (incl. navigations) → network-first with a
//                       cache fallback, so an online visit always gets the
//                       freshest build but an offline reload still works.
// Cross-origin requests (e.g. raster map tiles) are left untouched: they hit
// the network directly and simply fail when offline, where the geoJSON basemap
// takes over.

const CACHE = 'meshcore-shell-v1';

// Precached on install so the offline basemap is available on a cold, offline
// reload (it is never requested during a normal online session unless the user
// goes offline).
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
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
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
