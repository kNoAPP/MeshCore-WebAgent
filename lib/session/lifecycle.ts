// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { MeshConnectError } from '@/lib/meshcore/errors';
import { useMeshStore, type ConnectErrorCode } from '@/store/meshStore';
import { resetDelivery } from '@/lib/session/delivery';
import { resetCliQueue } from '@/lib/session/cliQueue';
import { resetSharedReads } from '@/lib/session/sharedReads';
import { resetRxCorrelation } from '@/lib/session/rxCorrelation';
import {
  flushSession,
  releaseStore,
  resetPersistence,
} from '@/lib/session/persistence';
import { clearReconnect, clearReconnectSource } from '@/lib/session/reconnect';
import { wipeApiKey } from '@/lib/ai/secret';
import { resetEventBus } from '@/lib/ai/eventBus';

/**
 * Maps a connect/sync failure to a stable code the connect screen resolves to
 * localized copy.
 *
 * @remarks
 * Typed errors carry a code that maps to a specific message; anything else
 * falls back to a generic failure code so a raw error never reaches the user.
 */
export function connectErrorCode(err: unknown): ConnectErrorCode {
  if (err instanceof MeshConnectError) {
    switch (err.code) {
      case 'radioNoResponse':
        return 'radioNoResponse';
    }
  }
  return 'connectionFailed';
}

/**
 * Resets every per-session subsystem.
 *
 * @remarks
 * Called when a session begins as well as when one ends: a dropped transport
 * never reaches `disconnect()`, so stale timers and the previous radio's save
 * subscription must not survive into the next connection.
 */
export function clearSessionState(): void {
  resetDelivery();
  resetRxCorrelation();
  resetCliQueue();
  resetSharedReads();
  // The Stats snapshot describes one link session. A reconnect swaps in a fresh
  // client without going through reset(), so drop it here or the cards would
  // sit frozen on pre-drop counters against the new link.
  const store = useMeshStore.getState();
  store.setDeviceStats(null);
  store.setDeviceClock(null);
  store.setDeviceBattery(null);
  // Same reason, one surface over: the action bar's quick link names the
  // newest message we know of, and the reconnect drain lands its whole
  // backlog while the status is still 'reconnecting' — too early to update
  // it. Retract it rather than let it name a pre-drop arrival the sidebar's
  // unread badges already contradict.
  store.setLatestInbound(null);
  // And the catch-up indicator, for the same reason: it describes one link's
  // backlog. The client that raised it is gone, so nothing is left to lower
  // it, and a stale flag would suppress every notification of the new session
  // rather than merely mislabel a surface.
  store.setBacklogDraining(false);
  // And the bar's transient line, which is the same kind of claim: it names
  // something that just happened on a link this call is replacing. Its own
  // timer would clear it, but the bar can remount inside that window — the
  // first reconnect backoff is a second — and repaint the previous session's
  // notice on a fresh animation that the original timer then cuts off.
  store.clearBarNotice();
  resetPersistence();
  // Drop the advert-diff baseline so the next session doesn't replay a prior
  // radio's adverts as "new" the moment automation subscribes.
  resetEventBus();
}

/**
 * Ends the session: destroys the client, clears subsystem state, and resets the
 * store.
 *
 * @remarks
 * Shared by a deliberate `disconnect()` and the reconnect loop's give-up path
 * so the teardown order lives in one place.
 * @param flush - persist the last messages first (a deliberate disconnect); the
 * give-up path skips it — the drop already flushed and the link's been down
 * since.
 */
export function teardownSession(flush = false): void {
  if (flush) flushSession();
  clearReconnect();
  clearReconnectSource();
  const store = useMeshStore.getState();
  store.client?.destroy();
  clearSessionState();
  // A real teardown (deliberate disconnect or a reconnect that gave up) is the
  // point to overwrite the in-memory API key — not a transient drop, whose
  // reconnect must keep a memory-only key alive for the same radio.
  wipeApiKey();
  // The reset below discards the unsaved restore itself, so nothing is left
  // for the mark to protect — and a later connect as that identity must load
  // its stored data over the reset defaults, not keep them. Nor does the
  // store belong to any identity afterwards.
  releaseStore();
  store.setClient(null);
  store.reset();
}
