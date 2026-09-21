// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import type { PrivateKeyAccess } from '@/types/meshcore';
import { useMeshStore } from '@/store/meshStore';

// The probe in flight, so two identity features opened together share one
// export instead of pulling the key over the link twice.
let inflight: {
  client: MeshCoreClient;
  probe: Promise<PrivateKeyAccess | null>;
} | null = null;

/**
 * Whether the connected radio exports its private key, probing it once per
 * session and caching the verdict in the store's `privateKeyAccess`.
 *
 * Call it as the user reaches for an identity feature, so an unavailable one
 * can be explained before they invest in it rather than at its final write.
 *
 * @returns the verdict, or `null` when there is no live session or the probe
 * was inconclusive (a timeout or dropped link). Nothing is cached for `null`,
 * so the next call probes again.
 */
export async function ensurePrivateKeyAccess(): Promise<PrivateKeyAccess | null> {
  const { client, privateKeyAccess } = useMeshStore.getState();
  if (privateKeyAccess) return privateKeyAccess;
  if (!client || client.closed) return null;
  if (inflight?.client === client) return inflight.probe;
  const probe = client.probePrivateKeyExport().then(
    (access) => {
      // The verdict describes this client's radio. If the session was torn
      // down or replaced while it ran, the store — and the caller's dialog —
      // now belong to another, so neither may act on it.
      if (useMeshStore.getState().client !== client) return null;
      useMeshStore.getState().setPrivateKeyAccess(access);
      return access;
    },
    () => null,
  );
  inflight = { client, probe };
  void probe.finally(() => {
    if (inflight?.probe === probe) inflight = null;
  });
  return probe;
}
