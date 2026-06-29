// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useState } from 'react';
import { useMeshCore } from './useMeshCore';

/**
 * Wraps {@link useMeshCore.advertiseSelf} with the `sending` flag that both
 * advertise affordances — the header's {@link AdvertMenu} and the Settings
 * {@link AdvertiseCard} — gate their buttons on, so the busy lifecycle lives
 * in one place instead of being re-derived at each call site.
 *
 * @returns `advertise(flood)` to broadcast (whole mesh when `flood`, else
 * zero-hop) and `sending`, true while a broadcast is in flight.
 */
export function useAdvertise() {
  const { advertiseSelf } = useMeshCore();
  const [sending, setSending] = useState(false);

  const advertise = useCallback(
    async (flood: boolean) => {
      setSending(true);
      try {
        await advertiseSelf(flood);
      } finally {
        setSending(false);
      }
    },
    [advertiseSelf],
  );

  return { advertise, sending };
}
