// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from './useMeshCore';

/**
 * Wraps {@link useMeshCore.advertiseSelf} with the shared `sending` flag that
 * both advertise affordances — the header's {@link AdvertMenu} and the Settings
 * "Share my node" {@link ShareCard} — gate their buttons on. The flag lives in
 * the store so the two surfaces share one busy lock and can't fire overlapping
 * broadcasts.
 *
 * @returns `advertise(flood)` to broadcast (whole mesh when `flood`, else
 * zero-hop) and `sending`, true while a broadcast is in flight.
 */
export function useAdvertise() {
  const { advertiseSelf } = useMeshCore();
  const sending = useMeshStore((s) => s.advertising);
  const setAdvertising = useMeshStore((s) => s.setAdvertising);

  const advertise = useCallback(
    async (flood: boolean) => {
      setAdvertising(true);
      try {
        await advertiseSelf(flood);
      } finally {
        setAdvertising(false);
      }
    },
    [advertiseSelf, setAdvertising],
  );

  return { advertise, sending };
}
