// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { useMeshStore, isAuthedLogin } from '@/store/meshStore';
import { canTransmit } from '@/lib/session/guards';
import { MAX_MSG_BYTES } from '@/lib/meshcore/constants';
import { isSilentCommand } from '@/lib/meshcore/consoleCatalog';
import { truncateUtf8 } from '@/lib/utils';
import i18n from '@/lib/i18n';
import type { Contact } from '@/types/meshcore';

// The single CLI request outstanding for one repeater, resolved (or timed out)
// when its reply arrives via onCliReply. reject fires on timeout or session
// teardown. `timer` is armed only after the send is acked, so it may be unset
// while the send is still in flight. `token` is the admin-session token this
// command was sent under, so a reply arriving after a logout/re-login can be
// kept out of the new session's transcript.
interface CliWaiter {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  token: number | undefined;
}

/**
 * The repeater accepted the send but never answered.
 *
 * @remarks
 * Distinct from a send failure because some commands (`reboot`, `poweroff`)
 * never reply by design, so a fire-and-forget caller can tell "no answer" from
 * "couldn't transmit".
 */
export class CliTimeoutError extends Error {
  constructor() {
    super(i18n.t('repeaterAdmin.cli.timedOut'));
    this.name = 'CliTimeoutError';
  }
}

// A remote-admin CLI reply is not an ACK, so the SENT receipt's estimate badly
// under-budgets it: the node must run the command, build a whole reply message
// and win its own transmit slot, and the companion radio only hands that
// message over on its 5 s SYNC_NEXT_MESSAGE poll. Scaling the ACK estimate the
// same way an ACK is scaled put the floor at 5 s — under the poll interval
// alone — so a reply the node did send routinely landed after its request had
// been given up on. These budget the full exchange instead: the floor clears
// the poll plus a multi-hop round trip, and the estimate still raises it on a
// long path.
const CLI_REPLY_GRACE = 4;
const MIN_CLI_REPLY_TIMEOUT_MS = 20000;
const DEFAULT_CLI_REPLY_TIMEOUT_MS = 30000;
// A verb the node never answers (`reboot`) has no reply to budget for, so the
// full exchange wait would only be time the caller spends before it can report
// the send and time the per-repeater queue spends blocked. Still long enough to
// catch a rejection (`Err: …`) coming back.
const CLI_SILENT_TIMEOUT_MS = 5000;

// The resolver awaiting a CLI reply from each repeater, keyed by pubkeyPrefix.
//
// MeshCore gives remote-admin CLI replies no correlation id of any kind: the
// firmware passes the command straight to CommonCLI::handleCommand, which
// dispatches on a byte-0 literal match ("get "/"set "), and the reply packet
// carries the repeater's own clock rather than the request's timestamp. So a
// reply can only be matched to its request by send order, which holds only
// while at most one command is outstanding per repeater — hence cliQueues.
const cliWaiters = new Map<string, CliWaiter>();
// Per-repeater send queues. Every CLI command — structured get/set and
// fire-and-forget console/action lines alike — chains here, so the next one
// leaves only after the previous reply lands (or times out) and the waiter
// above is never ambiguous.
const cliQueues = new Map<string, Promise<unknown>>();
// The window after a timed-out command in which that repeater may still answer
// it, and the promise the next queued command waits on.
//
// A timeout releases the queue, so without this the next command would be on
// the air before the previous one's reply can be ruled out — and with no
// correlation id on the wire that straggler would be claimed by the new
// command's waiter and reported as its answer, a stale `neighbors` list read as
// a fresh one. While a repeater is quarantined nothing new is sent to it, so
// there is never a second command for a straggler to be misread against. The
// window ends as soon as the straggler lands (`endCliQuarantine`, which also
// keeps that frame away from the waiter) or lapses after the same budget the
// request itself waited, at which point the reply is taken as lost — holding it
// longer would start discarding genuine replies instead.
const cliQuarantines = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>;
    lift: () => void;
    ended: Promise<void>;
  }
>();
// The status read in flight for a repeater, if any. Every entry point — the
// admin dashboard's Refresh button and the command palette — joins the running
// one rather than queuing a second exchange behind it: remote admin is slow and
// lossy, and two reads of the same thing only take the link away from the user.
const statusRequests = new Map<string, Promise<void>>();

/**
 * Rejects and drops the CLI request outstanding for one repeater.
 *
 * @remarks
 * Used on panel unmount so a gone owner can't leave a stale waiter that later
 * consumes a reply meant for the next mount. Deliberately leaves the repeater's
 * send queue in place: a rejected request settles its own link in the chain,
 * and dropping the entry would let the next command start a second chain
 * running alongside this one's tail — breaking the single-outstanding-command
 * invariant that makes replies attributable at all.
 */
export function rejectCliWaitersFor(prefix: string): void {
  takeCliWaiter(prefix)?.reject(
    new Error(i18n.t('repeaterAdmin.cli.superseded')),
  );
}

// Removes the repeater's outstanding waiter and stops its reply timer, so every
// settle path (reply, timeout, teardown) disarms the timer exactly once.
function takeCliWaiter(prefix: string): CliWaiter | undefined {
  const waiter = cliWaiters.get(prefix);
  if (!waiter) return undefined;
  cliWaiters.delete(prefix);
  if (waiter.timer) clearTimeout(waiter.timer);
  return waiter;
}

// Holds this repeater's queue for `ms` while a command that just timed out may
// still be answered. See cliQuarantines.
function quarantineCli(prefix: string, ms: number): void {
  endCliQuarantine(prefix);
  let lift!: () => void;
  const ended = new Promise<void>((resolve) => {
    lift = resolve;
  });
  cliQuarantines.set(prefix, {
    lift,
    ended,
    timer: setTimeout(() => endCliQuarantine(prefix), ms),
  });
}

// Lifts a repeater's quarantine, releasing whatever is queued behind it.
// Returns whether one was in force — which is also the answer to "was this
// reply owed to a request already given up on?".
function endCliQuarantine(prefix: string): boolean {
  const quarantine = cliQuarantines.get(prefix);
  if (!quarantine) return false;
  cliQuarantines.delete(prefix);
  clearTimeout(quarantine.timer);
  quarantine.lift();
  return true;
}

// Chains `op` after whatever CLI command is already queued for this repeater,
// so only one is ever in flight and replies stay matchable by send order. A
// command whose predecessor timed out also waits out that repeater's
// quarantine, so the straggler it may still be owed cannot be mistaken for this
// command's answer.
function enqueueCli<T>(prefix: string, op: () => Promise<T>): Promise<T> {
  const prev = cliQueues.get(prefix) ?? Promise.resolve();
  const start = () =>
    (cliQuarantines.get(prefix)?.ended ?? Promise.resolve()).then(op);
  const run = prev.then(start, start);
  cliQueues.set(
    prefix,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Routes an inbound remote-admin CLI reply to the transcript and to whatever
 * request is waiting on it.
 */
export function handleCliReply(
  client: MeshCoreClient,
  pubkeyPrefix: string,
  text: string,
): void {
  // A queued frame can fire this after teardown; skip it so a late reply can't
  // recreate adminSessions that reset() just cleared.
  if (!canTransmit(client)) return;
  // A reply the repeater still owed for a command already given up on is not an
  // answer to the one outstanding now, however plausible the timing looks —
  // lifting the quarantine claims it as the straggler it is and leaves the
  // waiter alone.
  const waiter = endCliQuarantine(pubkeyPrefix)
    ? undefined
    : takeCliWaiter(pubkeyPrefix);
  const state = useMeshStore.getState();
  const currentToken = state.adminSessions[pubkeyPrefix]?.token;
  // Append to the transcript only when the reply belongs to the current
  // session. A waiter carries the token of the session that issued the command,
  // so a reply to a command from a session that has since ended — logout leaves
  // the transport connected — is dropped from the new session's transcript. A
  // reply with no waiter (unsolicited, or late after a timeout) is shown only
  // while some session is active.
  const belongsToCurrent = waiter
    ? waiter.token === currentToken
    : currentToken != null;
  if (belongsToCurrent) {
    // A reply with no waiter answers nothing on screen: either the node spoke
    // unprompted, or this is the late answer to a command already reported as
    // unanswered. Flagged so the transcript can't present it as the reply to
    // whatever was sent most recently.
    state.appendCliLine(pubkeyPrefix, {
      own: false,
      text,
      ts: Date.now(),
      unsolicited: waiter === undefined,
    });
  }
  // Replies carry no correlation id, so this one answers the single command
  // outstanding for this repeater (enqueueCli guarantees there is at most one).
  // The stale waiter is still resolved so its queued slot drains, even when its
  // reply was dropped from the transcript.
  waiter?.resolve(text);
}

/**
 * Sends a CLI command to a repeater and resolves with its reply text, for the
 * structured Config editor's `get`/`set` round-trips. Echoes the sent line to
 * the transcript (so the console tab sees it too), then registers the waiter
 * that {@link handleCliReply} fulfils with that repeater's next reply.
 *
 * @remarks
 * MeshCore replies carry no correlation id, so commands to one repeater are
 * queued and sent strictly one at a time — a reply is only attributable to a
 * request while it is the sole one outstanding. Callers may therefore fire
 * requests freely without serializing, but they complete one round trip at a
 * time. Every CLI send goes through here, including fire-and-forget ones, so
 * that nothing else can consume a pending request's reply. A round trip that
 * goes unanswered leaves a muted note in the transcript, so a non-answer never
 * reads as a reply still in flight. A verb the node cannot answer
 * ({@link isSilentCommand}) waits only long enough for a rejection and leaves
 * no quarantine behind — there is no straggler to protect the next command
 * from.
 * @throws if the send fails, the session drops, or no reply arrives in time.
 */
export function repeaterCliRequest(
  client: MeshCoreClient | null,
  contact: Contact,
  cmd: string,
): Promise<string> {
  const prefix = contact.pubkeyPrefix;
  const silent = isSilentCommand(cmd);
  const { appendCliLine, addCliPending, adminSessions } =
    useMeshStore.getState();
  // Capture the session identity at enqueue time so a command can be tied to
  // the exact login it was issued under, not merely "some authed session". A
  // logout + re-login (even as a guest, which firmware may still treat as admin
  // via a retained ACL) mints a new token, so a write queued under the old
  // session is rejected rather than transmitted.
  const enqueuedToken = adminSessions[prefix]?.token;
  // Counted from enqueue, not from the send, so a command still waiting behind
  // an earlier round trip also reads as pending. Tagged with the issuing
  // session so a logout mid-flight can't leave the next session holding this
  // command's count.
  addCliPending(prefix, 1, enqueuedToken);
  return enqueueCli(prefix, () => {
    // Re-checked inside the queue: the link can drop while queued behind an
    // earlier command's full round trip.
    if (!canTransmit(client)) {
      return Promise.reject(
        new Error(i18n.t('repeaterAdmin.cli.disconnected')),
      );
    }
    // Also re-check the admin session: logging out clears it *without*
    // disconnecting the radio, so a command still queued behind a slow reply
    // must not transmit afterwards — that would let a write (e.g. `reboot`)
    // fire from a session the user already ended. The token must still match
    // the session captured at enqueue, so a reset-then-re-login can't inherit a
    // stale command either.
    const session = useMeshStore.getState().adminSessions[prefix];
    if (
      !session ||
      !isAuthedLogin(session.login) ||
      session.token !== enqueuedToken
    ) {
      return Promise.reject(new Error(i18n.t('repeaterAdmin.cli.loggedOut')));
    }
    // `sendCliCommand` truncates to MAX_MSG_BYTES UTF-8 bytes, so normalize
    // once and echo exactly what the repeater will receive.
    const line = truncateUtf8(cmd, MAX_MSG_BYTES);
    appendCliLine(prefix, { own: true, text: line, ts: Date.now() });
    return new Promise<string>((resolve, reject) => {
      // Tag the waiter with the session it was sent under, so a reply that
      // lands after a logout/re-login is dropped from the new session's
      // transcript (see handleCliReply).
      const waiter: CliWaiter = { resolve, reject, token: enqueuedToken };
      // Register *before* sending so a reply that beats the SENT/OK ack still
      // lands. Arm the reply timeout only once the send is acked, so it
      // measures the reply round trip, not time spent queued in the radio.
      cliWaiters.set(prefix, waiter);
      client.sendCliCommand(contact, line).then(
        (receipt) => {
          if (cliWaiters.get(prefix) !== waiter) return;
          // Wait the radio's estimated round-trip scaled for a CLI exchange,
          // not a fixed budget: a reply over a multi-hop path can take far
          // longer than a couple of seconds. A too-short wait would time out
          // prematurely, and the caller's retry would re-send while the real
          // reply is still in flight — flooding the mesh and stranding the late
          // reply with no waiter. A receipt whose estimate is missing or
          // non-positive carries no usable round trip, so it falls back to a
          // safe budget rather than the floor.
          const estimate = receipt?.suggestedTimeoutMs ?? 0;
          const timeoutMs = silent
            ? CLI_SILENT_TIMEOUT_MS
            : estimate > 0
              ? Math.max(MIN_CLI_REPLY_TIMEOUT_MS, estimate * CLI_REPLY_GRACE)
              : DEFAULT_CLI_REPLY_TIMEOUT_MS;
          waiter.timer = setTimeout(() => {
            if (cliWaiters.get(prefix) !== waiter) return;
            takeCliWaiter(prefix);
            // The node may still answer after this: releasing the queue would
            // otherwise put the next command on the air before a late reply can
            // be ruled out. Hold this repeater until the straggler lands or the
            // window lapses. A verb that never replies has no straggler to wait
            // for.
            if (!silent) quarantineCli(prefix, timeoutMs);
            // Record the non-answer in the transcript here rather than in the
            // caller: rejecting releases the queue, so a caller's continuation
            // would land after the next command's echo and pin "no reply" on
            // the wrong line. Guarded by the issuing session's token for the
            // same reason as handleCliReply — a logout in the meantime must not
            // carry the note into the next login.
            if (
              useMeshStore.getState().adminSessions[prefix]?.token ===
              enqueuedToken
            ) {
              appendCliLine(prefix, {
                own: false,
                note: true,
                text: i18n.t('repeaterAdmin.cli.timedOut'),
                ts: Date.now(),
              });
            }
            reject(new CliTimeoutError());
          }, timeoutMs);
        },
        (err: Error) => {
          if (cliWaiters.get(prefix) === waiter) takeCliWaiter(prefix);
          reject(err);
        },
      );
    });
  }).finally(() => addCliPending(prefix, -1, enqueuedToken));
}

/**
 * Runs a repeater status read, or joins the one already in flight for that
 * repeater.
 *
 * @returns the shared request, so every caller's spinner follows the same
 * exchange.
 */
export function runStatusRequest(
  prefix: string,
  run: () => Promise<void>,
): Promise<void> {
  const running = statusRequests.get(prefix);
  if (running) return running;
  const request = run().finally(() => {
    statusRequests.delete(prefix);
  });
  statusRequests.set(prefix, request);
  return request;
}

/**
 * Rejects and drops every outstanding CLI request, queue, and quarantine.
 *
 * @remarks
 * Called on session teardown so a structured get/set can't hang forever after
 * the link goes down.
 */
export function resetCliQueue(): void {
  for (const prefix of [...cliWaiters.keys()]) rejectCliWaitersFor(prefix);
  cliQueues.clear();
  for (const prefix of [...cliQuarantines.keys()]) endCliQuarantine(prefix);
  statusRequests.clear();
}
