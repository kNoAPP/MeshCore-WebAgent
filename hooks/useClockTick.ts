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
 * @param enabled - pass `false` where the caller is mounted but nothing it
 * renders reads the clock, e.g. a list under a sort order that ignores time.
 * No timer runs then, so the caller stops re-rendering on the tick, and the
 * returned value is frozen — do not read it while disabled. Switching back to
 * `true` re-seeds it before the first tick.
 * @returns the current Unix epoch seconds, so the value that drives the
 * rendered text is the same one that changed.
 */
export function useClockTick(enabled = true): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const read = (): void => setNow(Math.floor(Date.now() / 1000));
    // Re-seed on enable: the initializer ran at mount, so a caller disabled
    // then would otherwise read a session-stale clock until the first
    // interval fires. Deferred rather than called here, so enabling does not
    // set state during the effect.
    const seed = setTimeout(read, 0);
    const id = setInterval(read, TICK_MS);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, [enabled]);
  return now;
}
