// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

// Remote reads currently in flight, so a component that remounts mid-read joins
// the running one instead of starting a duplicate or briefly showing a false
// empty. Entries are removed once the read settles.
//
// The key must identify the *session*, not just the node: a read inherited
// across a log-out and re-login would hand the new session a result the old
// one's privileges earned, which is exactly what the token guard on the store
// actions exists to prevent — and joining a stale promise slips past it,
// because the joiner stamps the result with its own current token.
const reads = new Map<string, Promise<unknown>>();

/**
 * Joins the read already running under `key`, or starts one and shares it.
 *
 * @param key - must identify the session the read belongs to, not only the node
 *   — see {@link sessionReadKey}.
 * @returns the shared promise, so every caller settles on the same exchange.
 */
export function joinRead<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = reads.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = run().finally(() => {
    // Only clear our own entry: a reset between start and settle may already
    // have replaced it.
    if (reads.get(key) === started) reads.delete(key);
  });
  reads.set(key, started);
  return started;
}

/**
 * Builds a key that scopes a shared read to one node *and* one admin session.
 *
 * @param token - the `AdminSession.token` the read is issued under; a
 *   re-login mints a new one, so the next session cannot join this read.
 */
export function sessionReadKey(
  kind: string,
  prefix: string,
  token: number | undefined,
): string {
  return `${kind}:${prefix}:${token ?? 'none'}`;
}

/**
 * Drops every shared read.
 *
 * @remarks
 * Called on session teardown. The token in the key does not cover a transport
 * reconnect — that swaps in a fresh `MeshCoreClient` without clearing
 * `adminSessions`, so the token can survive while the client that owns the
 * in-flight promise does not. Clearing here is what stops the next view from
 * joining a read belonging to a dead link.
 */
export function resetSharedReads(): void {
  reads.clear();
}
