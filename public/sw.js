// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// MeshCore Companion service worker. Gives the app an offline-capable shell so
// the page loads after a cold reload with no network. Strategy:
//   - /version.json   → always network (never cached); drives the in-app
//                       update prompt, so it must reflect the live deploy.
//   - /_next/static/* → cache-first; these are content-hashed and immutable.
//   - everything else same-origin (incl. navigations) → network-first with a
//                       cache fallback, so an online visit always gets the
//                       freshest build but an offline reload still works.
//
// The map basemap is online-only: its CARTO tiles are not cached here.

const CACHE = 'meshcore-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Precache the app shell so the network-first navigation fallback
      // (`cache.match('/')`) always has something to serve on a cold offline
      // reload — even before any online, SW-controlled navigation has populated
      // the runtime cache. Content-hashed `/_next/static/*` chunks aren't known
      // here; they fill in via cache-first on the first controlled load.
      const cache = await caches.open(CACHE);
      await cache.add('/').catch(() => {});
      await self.skipWaiting();
    })(),
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
