// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { useMeshStore } from '@/store/meshStore';

/**
 * Whether the radio may be written to right now.
 *
 * @remarks
 * The single gate every send funnels through: a live client whose transport is
 * still open AND a fully connected session (not connecting/reconnecting behind
 * the overlay). The `!client.closed` check matters because status flips to
 * 'connected' before the post-init hydrate awaits finish, so a drop in that
 * window leaves status 'connected' while the transport is already dead.
 */
export function canTransmit(
  client: MeshCoreClient | null,
): client is MeshCoreClient {
  return (
    !!client && !client.closed && useMeshStore.getState().status === 'connected'
  );
}
