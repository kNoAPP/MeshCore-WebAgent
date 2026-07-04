// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// A tiny, synchronous, tab-scoped pub/sub bus that re-emits the mesh events the
// automation engine (task 6.4) reacts to. It is fed from the existing
// MeshCoreCallbacks inside useMeshCore's wireClient — we wrap, never replace,
// those callbacks — and emits a normalized MeshEvent *after* the store has been
// updated, so subscribers see a consistent world. Zero cost when nobody is
// subscribed (automation off): emitters short-circuit when `listeners` is
// empty. See `docs/design/ai-automation.md` §3.

import type { Message, Advert, ConnectionStatus } from '@/types/meshcore';

/**
 * A normalized mesh event, one per meaningful edge in the radio's activity.
 * Each maps to an existing client callback / store transition (never new
 * protocol code):
 *
 * - `message` ← `onMessage` (direct or channel, already unified).
 * - `advert` ← `onAdvertsUpdated`, diffed to one event per new/changed advert.
 * - `ack` ← `onAck` (delivery confirmation with round-trip).
 * - `connection` — a synthetic `{ status: 'connected' }` fired by
 *   `useAutomation` when the engine arms; drop/reconnecting states unsubscribe
 *   the engine rather than emitting an event (execution is live-only).
 * - `schedule` — a synthetic tick fired by `useAutomation` once per wall-clock
 *   minute while armed; `schedule`-trigger rules match their cron against `at`.
 */
export type MeshEvent =
  | { type: 'message'; msg: Message }
  | { type: 'advert'; advert: Advert }
  | { type: 'ack'; ackCode: number; roundTripMs: number }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'schedule'; at: number };

/** A bus subscriber; gets each {@link MeshEvent} in arrival order. */
export type MeshEventListener = (event: MeshEvent) => void;

const listeners = new Set<MeshEventListener>();

/**
 * Subscribes to the bus.
 *
 * @returns an unsubscribe function; call it to detach (kill switch / unmount).
 */
export function subscribe(listener: MeshEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Delivers an event to every subscriber synchronously, in arrival order. A
 * throwing listener is isolated so one bad subscriber can't starve the others
 * or disturb the emit path (the transport read loop). No-op when unsubscribed.
 */
export function emit(event: MeshEvent): void {
  if (listeners.size === 0) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A subscriber's failure must never bubble into the store/callback path.
    }
  }
}

// The previous adverts snapshot, kept so onAdvertsUpdated (which hands us the
// whole map every poll) can be diffed down to per-advert edge events. Module
// scope mirrors how useMeshCore keeps its send-tracking state.
let lastAdverts: Record<string, Advert> = {};

/**
 * Diffs a fresh adverts map against the previous snapshot and emits an `advert`
 * event for each new or refreshed entry (by `lastHeard`). Cheap and skipped
 * entirely when nobody is subscribed. Called from `onAdvertsUpdated` after the
 * store is updated.
 */
export function emitAdvertDiff(adverts: Record<string, Advert>): void {
  if (listeners.size === 0) {
    // Keep the snapshot current even while idle so re-enabling automation
    // doesn't replay every already-known advert as "new".
    lastAdverts = adverts;
    return;
  }
  for (const [key, advert] of Object.entries(adverts)) {
    const prev = lastAdverts[key];
    if (!prev || prev.lastHeard !== advert.lastHeard) {
      emit({ type: 'advert', advert });
    }
  }
  lastAdverts = adverts;
}

/**
 * Resets the advert-diff snapshot. Called on disconnect so the next session
 * doesn't treat a prior radio's adverts as a baseline.
 */
export function resetEventBus(): void {
  lastAdverts = {};
}
