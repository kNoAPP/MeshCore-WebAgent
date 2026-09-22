// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { useMeshStore } from '@/store/meshStore';
import { flushSession } from '@/lib/session/persistence';
import i18n from '@/lib/i18n';
import type { ITransport, TransportKind } from '@/types/meshcore';

/** The session's connect path, re-run for every reconnect attempt. */
export type ConnectFn = (
  transport: ITransport,
  isReconnect: boolean,
) => Promise<boolean>;

/**
 * What the reconnect loop borrows from the session layer.
 *
 * @remarks
 * Injected rather than imported so this module stays free of the session
 * lifecycle it tears down — and so the loop can be driven from a plain script
 * with stubs.
 */
export interface ReconnectDeps {
  /** Rebuilds the session over a reopened transport. */
  connect: ConnectFn;
  /** Ends the session once the loop has exhausted its attempts. */
  teardown: () => void;
}

// Auto-reconnect backoff (ms), capped at the last entry. Tuned for LoRa radios
// that reboot slowly; we give up after MAX_RECONNECT_ATTEMPTS tries.
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 15000];
const MAX_RECONNECT_ATTEMPTS = 8;
// Upper bound on a single reopen+resync attempt. A transport reopen that hangs
// (e.g. a serial read loop that never unwinds) must not stall the backoff loop
// forever behind the reconnecting overlay — time it out so the loop can retry.
const RECONNECT_ATTEMPT_TIMEOUT_MS = 20000;

// Auto-reconnect state. Reopens the last device without a new user gesture
// (the granted handle stays valid for the page session).
// userInitiatedDisconnect distinguishes a deliberate Disconnect from a dropped
// link so only the latter triggers the loop.
let lastTransportFactory: (() => Promise<ITransport>) | null = null;
// How the current session was opened, so the connect screen can name the radio
// and re-run the matching connect after the loop gives up.
let lastConnectSource: { kind: TransportKind; url?: string } | null = null;
let userInitiatedDisconnect = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Records that the user asked to disconnect, suppressing the loop. */
export function markUserDisconnect(): void {
  userInitiatedDisconnect = true;
}

/** Clears the deliberate-disconnect intent as a fresh session begins. */
export function clearUserDisconnect(): void {
  userInitiatedDisconnect = false;
}

/** Whether the current teardown was asked for rather than suffered. */
export function isUserDisconnect(): boolean {
  return userInitiatedDisconnect;
}

/** Whether a dropped link can still be reopened without a user gesture. */
export function hasReconnectSource(): boolean {
  return lastTransportFactory !== null;
}

/**
 * Records the active transport as the source the reconnect loop reopens after a
 * drop.
 *
 * @remarks
 * The granted port/device/URL stays valid for the page session, so no new user
 * gesture is needed.
 * @param url - the WebSocket address of a WiFi session.
 */
export function setReconnectSource(
  transport: ITransport,
  kind: TransportKind,
  url?: string,
): void {
  lastConnectSource = { kind, url };
  lastTransportFactory = async () => {
    await transport.reopen();
    return transport;
  };
}

/**
 * Forgets which radio to reopen, so a teardown cannot be undone by the loop.
 */
export function clearReconnectSource(): void {
  lastTransportFactory = null;
  lastConnectSource = null;
}

/** Cancels a pending attempt and retires the reconnecting overlay. */
export function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  useMeshStore.getState().setReconnectProgress(null);
}

// Rejects if `p` doesn't settle within `ms`. The underlying promise is left to
// dangle — the caller has already moved on — so this only bounds the wait, not
// the work.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// One reconnect attempt: reopen the same device and rebuild the client through
// the normal connect path (so sync/hydration/persistence wiring is identical to
// a first connect), rescheduling the loop if it fails.
async function runReconnectAttempt(deps: ReconnectDeps): Promise<void> {
  const factory = lastTransportFactory;
  if (!factory) return;
  reconnectAttempt++;
  if (userInitiatedDisconnect) return;
  useMeshStore.getState().setReconnectProgress({
    attempt: reconnectAttempt,
    total: MAX_RECONNECT_ATTEMPTS,
    waiting: false,
    resumeAt: null,
  });
  let ok = false;
  try {
    // Bound the reopen so a hung transport (a read loop that never unwinds)
    // can't freeze the loop here forever — on timeout we fall through to a
    // reschedule like any other failed attempt.
    const transport = await withTimeout(
      factory(),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
    );
    // Reopening can take seconds (GATT/serial); re-check intent in case the
    // user hit Disconnect while we were awaiting it.
    if (userInitiatedDisconnect) return;
    ok = await deps.connect(transport, true);
  } catch {
    ok = false;
  }
  if (!ok && !userInitiatedDisconnect) scheduleReconnect(deps);
}

// Drives the reconnect loop after an unexpected drop: waits out the backoff,
// then runs an attempt. Recurses on failure until MAX_RECONNECT_ATTEMPTS, then
// gives up — tearing the session down but remembering which radio was lost, so
// the connect screen can explain it and offer a retry.
function scheduleReconnect(deps: ReconnectDeps): void {
  if (!lastTransportFactory) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    // Capture the name and source before the teardown clears them. The drop
    // already flushed history (via onDisconnect) and the link's been down
    // since, so there's nothing new to persist here.
    // deviceName defaults to '' (empty until SELF_INFO), so fall back on any
    // falsy value, not just null/undefined.
    const device =
      useMeshStore.getState().deviceName || i18n.t('common.device');
    const source = lastConnectSource;
    deps.teardown();
    const store = useMeshStore.getState();
    // Announcement only, in practice. The row is pushed for the record, but
    // the teardown above has already unmounted the bar that opens the drawer,
    // and the next connect clears the history before it comes back — so what
    // the user actually reads is the connect screen's own give-up card, built
    // from the `lastConnectFailure` set just below.
    store.notify({
      level: 'error',
      text: i18n.t('toast.reconnectFailed', { device }),
      key: 'reconnectFailed',
      surface: 'silent',
    });
    if (source) {
      store.setLastConnectFailure({
        device,
        transport: source.kind,
        url: source.url,
      });
    }
    return;
  }
  const delay =
    RECONNECT_BACKOFF_MS[
      Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
    ];
  useMeshStore.getState().setReconnectProgress({
    attempt: reconnectAttempt + 1,
    total: MAX_RECONNECT_ATTEMPTS,
    waiting: true,
    resumeAt: Date.now() + delay,
  });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void runReconnectAttempt(deps);
  }, delay);
}

/**
 * Shared drop-recovery: persist the last messages, flip the UI into the
 * reconnecting state, record the drop, and start the backoff loop.
 *
 * @remarks
 * Used by both a post-connect drop (the client's `onDisconnect`) and a mid-sync
 * drop (connect's catch) so the two paths can't drift. The flush is a no-op
 * before the sync wired the storage key, so the mid-sync caller pays nothing
 * for it.
 */
export function beginReconnect(deps: ReconnectDeps): void {
  flushSession();
  const store = useMeshStore.getState();
  store.setStatus('reconnecting');
  // Close any connection-scoped panel so it doesn't reappear on reconnect.
  store.closeConnectionOverlays();
  // The reconnect overlay that comes up with 'reconnecting' is the surface
  // here — it covers the app and reports the attempts. This keeps the record
  // for the drawer and announces the drop, and nothing more.
  store.notify({
    level: 'info',
    text: i18n.t('toast.connectionLost'),
    key: 'connectionLost',
    surface: 'silent',
  });
  scheduleReconnect(deps);
}

/**
 * Skips the remaining backoff wait and runs the pending reconnect attempt now.
 * No-op unless the loop is currently waiting out a delay.
 */
export function retryReconnectNow(deps: ReconnectDeps): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  void runReconnectAttempt(deps);
}
