// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef } from 'react';

/** How often to poll `/version.json` for a new deploy. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Fetches the deployed build version, or null if unavailable. */
async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

/**
 * Reloads the page when a new build is deployed. Records the version at mount,
 * then polls every {@link CHECK_INTERVAL_MS}; renders nothing.
 */
export function VersionCheck() {
  const initialVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      initialVersion.current = await fetchVersion();
    }

    async function check() {
      if (initialVersion.current === null) return;
      const current = await fetchVersion();
      if (
        !cancelled &&
        current !== null &&
        current !== initialVersion.current
      ) {
        window.location.reload();
      }
    }

    init();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
