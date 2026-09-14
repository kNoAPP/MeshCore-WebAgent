// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';

/** How often a clock-derived readout is refreshed. */
const TICK_MS = 30_000;

/**
 * Re-renders the caller on a fixed interval, for a readout derived from the
 * wall clock rather than from state — the "updated N ago" freshness labels on
 * the stats surfaces, which would otherwise sit at "just now" for as long as
 * the page stays open. The timer runs only while the component is mounted.
 *
 * @returns the current Unix epoch seconds, so the value that drives the
 * rendered text is the same one that changed.
 */
export function useClockTick(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      TICK_MS,
    );
    return () => clearInterval(id);
  }, []);
  return now;
}
