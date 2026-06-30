// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect } from 'react';
import { useMeshStore } from '@/store/meshStore';

/**
 * Keeps the store's `isOnline` flag in sync with the browser. The flag itself
 * lives in Zustand (per project convention); this hook uses `useEffect` only to
 * wire the `online`/`offline` window events to the `setOnline` action and to
 * seed the current value on mount. Mount it once near the app root.
 */
export function useOnlineStatus(): void {
  const setOnline = useMeshStore((s) => s.setOnline);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [setOnline]);
}
