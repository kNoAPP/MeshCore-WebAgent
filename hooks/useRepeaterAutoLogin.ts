// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useMeshStore, isAuthedLogin } from '@/store/meshStore';
import { loadRepeaterCred } from '@/lib/meshcore/adminCreds';
import { NO_PATH } from '@/lib/meshcore/constants';
import type { Contact, LoginKind } from '@/types/meshcore';

/**
 * Sign-in attempts a credential gets — a remembered one on entering a node, or
 * one just typed into the form — the initial try plus its retries. Bounded,
 * because a node whose password really did change (or was mistyped) will never
 * answer, and an unbounded cycle would spend a shared LoRa mesh's airtime
 * proving it.
 */
export const LOGIN_ATTEMPTS = 3;

// Breathing room between automatic attempts. A mesh that is merely busy — a
// neighbor mid-transmission, a queue backed up behind a flood — settles in
// about this long, where retrying immediately would mostly collide with
// whatever swallowed the previous attempt.
const LOGIN_RETRY_BACKOFF_MS = 3000;

/** Why a sign-in attempt ended, once one has failed. */
export type LoginFailure = 'timeout' | 'failed';

/**
 * The state of one node's sign-in and the actions that drive it. `attempt` is 0
 * whenever nothing is in flight.
 */
export interface RepeaterAutoLogin {
  /** True only while the encrypted store is probed, before any attempt. */
  checking: boolean;
  /**
   * Which password the encrypted store holds for this node, or null when it
   * holds none. Strictly the *remembered* credential — a password merely typed
   * into the form never lands here, so this stays a true answer to "is there
   * something to replay?". The password itself is deliberately not exposed: it
   * never leaves the hook.
   */
  credAccess: LoginKind | null;
  /** 1-based attempt in flight, or 0 when idle. */
  attempt: number;
  /** Attempts the cycle in flight budgets — {@link LOGIN_ATTEMPTS} or 1. */
  attempts: number;
  /**
   * How the last attempt ended, or null when the last one succeeded. A dropped
   * link leaves it untouched: the reconnect overlay owns that story, and the
   * failure it would erase is still the last thing the node actually said.
   */
  failure: LoginFailure | null;
  /**
   * Replays the remembered credential once. `resetRoute` discards the node's
   * stored path first, so the attempt floods to rediscover one. A no-op when
   * nothing is remembered.
   */
  retry: (resetRoute: boolean) => void;
  /**
   * Signs in with a password the user just typed, retrying a timeout like a
   * remembered credential does, and superseding any cycle in flight.
   */
  signIn: (password: string, kind: LoginKind, remember: boolean) => void;
  /**
   * Drops the remembered credential from memory and cancels any cycle using
   * it. The caller pairs this with `clearRepeaterCred` on an explicit log-out,
   * so forgetting a credential on disk also forgets the copy this hook holds.
   */
  forget: () => void;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives sign-in for one repeater or room server: probes the encrypted
 * `secrets` store for a remembered credential on entry and replays it. Either
 * that or a typed password retries a timed-out attempt up to
 * {@link LOGIN_ATTEMPTS} times — flooding the last one — before handing the
 * user the failure and the actions to retry it.
 *
 * @remarks
 * Only a timeout is retried. A rejection the radio reported stops the cycle at
 * once, and a wrong password is indistinguishable from a lost packet on the
 * wire, which is why the cycle is bounded and why it never clears the stored
 * credential. Call this once per node — the caller is expected to remount it
 * when the selection changes.
 */
export function useRepeaterAutoLogin(contact: Contact): RepeaterAutoLogin {
  const { repeaterLogin, resetContactPath } = useMeshCore();
  const prefix = contact.pubkeyPrefix;
  const login =
    useMeshStore((s) => s.adminSessions[prefix]?.login) ?? 'loggedOut';

  // True only during the initial credential probe from a clean logged-out
  // state, so the caller shows a brief spinner instead of flashing the login
  // form before the first attempt runs.
  const [checking, setChecking] = useState(login === 'loggedOut');
  const [credAccess, setCredAccess] = useState<LoginKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [attempts, setAttempts] = useState(1);
  const [failure, setFailure] = useState<LoginFailure | null>(null);

  // The remembered credential a retry replays, held here rather than in state
  // so the password is never a render input and can never reach the Zustand
  // store, a notification, or a DOM value. Cleared by `forget` on log-out, so
  // it never outlives the record it was read from.
  const credRef = useRef<{ password: string; kind: LoginKind } | null>(null);
  // Bumped by every new cycle and by unmount. A cycle compares its own snapshot
  // against this before touching anything after an await, so a straggling
  // attempt can neither clobber a login that has since resolved nor write back
  // into a view that is gone.
  const runRef = useRef(0);
  // Read without being listed as effect dependencies, so an unrelated contact
  // or action-identity change cannot cancel a cycle mid-flight. The pubkey is
  // immutable, so the mount-time contact stays valid for the login command.
  const contactRef = useRef(contact);
  const repeaterLoginRef = useRef(repeaterLogin);
  const resetPathRef = useRef(resetContactPath);
  const loginRef = useRef(login);

  // Declared before the probe effect below so a render's values are in place
  // before that effect consults them.
  useEffect(() => {
    repeaterLoginRef.current = repeaterLogin;
    resetPathRef.current = resetContactPath;
    loginRef.current = login;
  });

  useEffect(
    () => () => {
      runRef.current++;
    },
    [],
  );

  // The contact as the radio holds it now, so a route decision reads the path
  // in place rather than the one captured at mount.
  const liveContact = useCallback(
    (): Contact =>
      useMeshStore.getState().contacts[prefix] ?? contactRef.current,
    [prefix],
  );

  // One sign-in cycle: up to `total` attempts of the same credential, stopping
  // at the first success, the first non-timeout failure, or a dead link.
  const runCycle = useCallback(
    async (
      password: string,
      kind: LoginKind,
      remember: boolean,
      total: number,
      resetRouteFirst = false,
    ) => {
      const run = ++runRef.current;
      const live = () => runRef.current === run;
      // The previous failure is deliberately left standing until this cycle
      // produces an outcome of its own. Clearing it here would make a cycle cut
      // short by a dropped link erase the banner and its retry buttons, leaving
      // a bare form over a credential that is still remembered — and nothing
      // remounts this view on reconnect to bring it back. The gate renders the
      // attempt counter, not the banner, while `attempt` is non-zero, so
      // holding it costs no stale UI.
      setAttempts(total);
      setAttempt(1);

      if (resetRouteFirst) {
        await resetPathRef.current(liveContact());
        if (!live()) return;
      }

      for (let i = 1; i <= total; i++) {
        // A login that resolved while this cycle sat between attempts — a
        // manual one, or the node answering late — is the outcome already;
        // don't send over the top of it.
        if (isAuthedLogin(loginRef.current)) {
          setFailure(null);
          break;
        }
        // Two timeouts have condemned the stored route, so let the last attempt
        // flood rather than repeat the same lost path. Mirrors
        // `applyRoutePolicy`'s two-failures-then-reset: one loss is not enough
        // to throw away a path every other message to this node also uses.
        if (i === total && total > 1 && liveContact().outPathLen !== NO_PATH) {
          // Quiet, like the attempts around it: the user asked to open a node,
          // not to reset its route, so this one stays part of the sign-in the
          // gate is already narrating.
          await resetPathRef.current(liveContact(), true);
          if (!live()) return;
        }
        setAttempt(i);
        const outcome = await repeaterLoginRef.current(
          contactRef.current,
          password,
          kind,
          remember,
          // A timeout this cycle will retry needs no notice of its own;
          // only the attempt that gives up speaks.
          i < total,
        );
        if (!live()) return;
        if (outcome === 'ok') {
          setFailure(null);
          break;
        }
        // A dropped link is the reconnect overlay's story, not a sign-in
        // failure, so it leaves the gate exactly as it was — including any
        // earlier failure, which is still the last thing the node said.
        if (outcome === 'offline') break;
        if (outcome === 'failed') {
          setFailure('failed');
          break;
        }
        if (i === total) {
          setFailure('timeout');
          break;
        }
        await delay(LOGIN_RETRY_BACKOFF_MS);
        if (!live()) return;
      }
      setAttempt(0);
    },
    [liveContact],
  );

  // On entry, when there is no live session yet, probe the encrypted store for
  // a remembered credential and auto-log-in with it. Keyed by the stable
  // `prefix`, so it runs once per node (remounted when the selection changes).
  useEffect(() => {
    // Only probe from a clean logged-out state. Skipping `admin`/`guest` avoids
    // clobbering a live session; skipping `pending` avoids queuing a second
    // login when the view remounts mid-login (e.g. switching away and back
    // during a multi-hop handshake).
    if (loginRef.current !== 'loggedOut') return;
    let cancelled = false;
    void (async () => {
      const cred = await loadRepeaterCred(prefix);
      if (cancelled) return;
      setChecking(false);
      if (!cred) return;
      // A failed cycle leaves the stale credential in place: the failure may be
      // transient, and only an explicit log-out forgets it.
      credRef.current = { password: cred.password, kind: cred.access };
      setCredAccess(cred.access);
      void runCycle(cred.password, cred.access, true, LOGIN_ATTEMPTS);
    })();
    return () => {
      cancelled = true;
    };
  }, [prefix, runCycle]);

  const retry = useCallback(
    (resetRoute: boolean) => {
      const cred = credRef.current;
      if (!cred) return;
      // Already remembered by definition — this is the stored credential — so
      // a success simply rewrites the record it came from.
      void runCycle(cred.password, cred.kind, true, 1, resetRoute);
    },
    [runCycle],
  );

  const signIn = useCallback(
    (password: string, kind: LoginKind, remember: boolean) => {
      // A node at the edge of range drops a typed password's attempt as readily
      // as a remembered one's, so it gets the same retries. The cost lands on a
      // mistyped password, which is silence on the wire too: it takes the whole
      // cycle to fail, and its last attempt resets the node's route to flood,
      // with no reply to learn a new one from. That reset is also what
      // reaches a node whose stored route went stale, so it applies here all
      // the same. It deliberately does *not* become the remembered
      // credential: only a successful login is ever persisted, and treating a
      // typed password as remembered would offer to replay a wrong one under
      // copy promising the password is not the problem.
      void runCycle(password, kind, remember, LOGIN_ATTEMPTS);
    },
    [runCycle],
  );

  const forget = useCallback(() => {
    // Cancels any cycle mid-flight, so a straggling attempt can't sign back in
    // with the credential the user just told us to forget.
    runRef.current++;
    credRef.current = null;
    setCredAccess(null);
    setFailure(null);
    setAttempt(0);
  }, []);

  return {
    checking,
    credAccess,
    attempt,
    attempts,
    failure,
    retry,
    signIn,
    forget,
  };
}
