// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useSyncExternalStore } from 'react';

// Cached snapshot — useSyncExternalStore compares by reference, so the result
// must stay reference-stable across renders. Device class never changes within
// a session, so detect once and reuse.
let isDesktop: boolean | null = null;

// Pointer/touch capability is checked alongside the user-agent to catch iPadOS
// Safari, which reports a desktop user-agent but exposes multi-touch.
function detectIsDesktop(): boolean {
  const ua = navigator.userAgent;

  // iPadOS Safari masquerades as macOS; multi-touch on a "Mac" means an iPad.
  const isIPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;

  const isMobileOrTabletUA =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle|PlayBook/i.test(
      ua,
    );

  // A primary pointer that's coarse and can't hover is a touchscreen — i.e. a
  // phone or tablet. Touch-capable laptops still report a fine primary pointer.
  const isTouchPrimary =
    matchMedia('(pointer: coarse)').matches &&
    matchMedia('(hover: none)').matches;

  return !(isIPadOS || isMobileOrTabletUA || isTouchPrimary);
}

function getSnapshot(): boolean {
  isDesktop ??= detectIsDesktop();
  return isDesktop;
}

// The static export has no `navigator`; resolve on the client after hydration.
const getServerSnapshot = () => null;
const subscribe = () => () => {};

/**
 * Returns whether the visitor is on a desktop/laptop, or `null` during the
 * prerender and first client render (before device detection runs).
 */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
