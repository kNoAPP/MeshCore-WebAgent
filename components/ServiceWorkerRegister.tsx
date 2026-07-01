// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker — served at `/sw.js` (from
 * `public/sw.js`) — once on mount. Renders nothing.
 *
 * @remarks Production-only: a service worker in `next dev` interferes with HMR,
 * and the static export is what actually ships the worker. Registration failure
 * (e.g. unsupported browser) is non-fatal — the app just runs without offline
 * support.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
