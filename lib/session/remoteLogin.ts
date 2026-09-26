// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { PushTimeoutError } from '@/lib/meshcore/errors';
import { ADV_TYPE_ROOM, NO_PATH } from '@/lib/meshcore/constants';
import { loadRepeaterCred, saveRepeaterCred } from '@/lib/meshcore/adminCreds';
import { canTransmit } from '@/lib/session/guards';
import { useMeshStore, isAuthedLogin, roomConvoId } from '@/store/meshStore';
import i18n from '@/lib/i18n';
import type {
  Contact,
  LoginKind,
  Message,
  RepeaterLoginOutcome,
} from '@/types/meshcore';

/**
 * Sign-in attempts a credential gets — a remembered one on entering a node or
 * on connect, or one just typed into the form — the initial try plus its
 * retries. Bounded, because a node whose password really did change (or was
 * mistyped) will never answer, and an unbounded cycle would spend a shared LoRa
 * mesh's airtime proving it.
 */
export const LOGIN_ATTEMPTS = 3;

/**
 * Breathing room between automatic attempts. A mesh that is merely busy — a
 * neighbor mid-transmission, a queue backed up behind a flood — settles in
 * about this long, where retrying immediately would mostly collide with
 * whatever swallowed the previous attempt.
 */
export const LOGIN_RETRY_BACKOFF_MS = 3000;

/**
 * Logins the connect-time sync spends pulling one room's history.
 *
 * @remarks A room pushes its stored posts one at a time, each waiting on our
 * ACK, and stops pushing to us after three in a row go unacknowledged. Only
 * another login resumes it — the companion firmware sends no keep-alive — and
 * it resumes from the last post the radio received, so nothing repeats. A
 * replay that went quiet after delivering posts may therefore have stalled
 * rather than finished, and gets another login; one that delivers nothing ends
 * the pull.
 */
const ROOM_PULL_ROUNDS = 3;

/**
 * How long a room's replay goes without a post before its round is over.
 *
 * @remarks Longer than a stall takes to show: the room waits 2s after a login
 * before its first push, gives each push up to 12s for our ACK over flood, and
 * gives up after three.
 */
const ROOM_REPLAY_QUIET_MS = 45_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Logs in to a repeater/room server for remote admin. Marks the session
 * `pending`, then on success the granted level, or `loggedOut` on failure
 * (surfaced as a notification). A room server's own reported role wins,
 * because it is what decides whether the member may post; a repeater's is
 * ignored in favour of the level the user selected (`kind`), since a
 * blank/guest login re-uses an admin-enrolled node's stored ACL role and
 * would otherwise show a guest session as admin. When `remember` is set, the
 * password is persisted encrypted per-radio in the `secrets` store (never in
 * the store, prefs blob, or localStorage); otherwise it is not persisted.
 *
 * @remarks The session goes `pending` in the same synchronous step as the
 * link check, so a caller that has just read the node as `loggedOut` can
 * claim it without another sign-in slipping in between. A login over a
 * session that is already signed in renews it instead: the session stays up
 * throughout, since the node accepted us once and a reader of its feed
 * should not be put back behind the login gate, and a failed renewal leaves
 * it as it was. A renewal the user logged out from meanwhile is dropped,
 * credential and all.
 * @param quiet - suppress the *timeout* notice, for a caller that shows the
 * outcome itself. An automatic retry cycle sets it on every attempt but its
 * last, so one unreachable node speaks once rather than once per attempt.
 * A rejection the radio reported still speaks: it ends such a cycle at once,
 * so its message has no later attempt to carry it.
 * @returns how the attempt ended, so a caller can retry only the transient
 * shape. See {@link RepeaterLoginOutcome}.
 */
export async function loginNode(
  client: MeshCoreClient | null,
  contact: Contact,
  password: string,
  kind: LoginKind,
  remember: boolean,
  quiet = false,
): Promise<RepeaterLoginOutcome> {
  if (!canTransmit(client)) return 'offline';
  const prefix = contact.pubkeyPrefix;
  const { setAdminLogin, cacheAdverts, notify } = useMeshStore.getState();
  const prior = useMeshStore.getState().adminSessions[prefix];
  const renewing = isAuthedLogin(prior?.login);
  // Whether a renewal still has the session it set out to renew: a log-out
  // deletes it, and any session opened after that carries a new token.
  const renewedAway = () =>
    renewing &&
    useMeshStore.getState().adminSessions[prefix]?.token !== prior?.token;
  if (!renewing) setAdminLogin(prefix, 'pending');
  try {
    const { access: granted, clockSkewSecs } = await client.login(
      contact,
      password,
    );
    // A drop during login can tear the session down; don't revive it.
    if (!canTransmit(client)) return 'offline';
    if (renewedAway()) return 'failed';
    // A room grants three roles and the middle one (the room password)
    // is what decides whether the composer may post, so its
    // server-reported role is authoritative. A repeater reflects the
    // level the user chose instead: it re-uses your existing ACL role for
    // a blank/guest login, so an admin-enrolled node would otherwise
    // report admin even when you intended a read-only guest session. The
    // node still enforces real permissions either way.
    const isRoom = contact.advType === ADV_TYPE_ROOM;
    setAdminLogin(
      prefix,
      (isRoom && granted) || kind,
      clockSkewSecs ?? undefined,
    );
    // The radio stays connected to a room it logged into, so its posts
    // keep arriving on later connects before any login measures the
    // room again: the connect-time backlog drain, and pushes landing
    // before the room is signed in to again. Carrying the skew in the
    // persisted advert cache gives `roomPostTime` a measurement for those.
    // (Posts the drain lands before the cache is restored go without, but
    // `restoreHistory` puts the saved history ahead of those posts.)
    const cached = useMeshStore.getState().advertCache[prefix];
    if (isRoom && cached && clockSkewSecs !== null) {
      cacheAdverts({ [prefix]: { ...cached, clockSkewSecs } });
    }
    // Only a successful login is ever remembered, so a wrong password can't
    // be persisted. The credential lives solely in the encrypted per-radio
    // secrets store — never the store, prefs blob, or localStorage.
    if (remember) {
      void saveRepeaterCred(prefix, { access: kind, password });
    }
    return 'ok';
  } catch (err) {
    // A disconnect/drop rejects the pending login and runs its own
    // teardown; don't clobber that outcome with a stale login error. A full
    // disconnect already cleared the slice (leave it gone); a transient
    // drop keeps the entry, so just clear its `pending` spinner silently.
    if (!canTransmit(client)) {
      if (!renewing && useMeshStore.getState().adminSessions[prefix]) {
        setAdminLogin(prefix, 'loggedOut');
      }
      return 'offline';
    }
    if (renewedAway()) return 'failed';
    if (!renewing) setAdminLogin(prefix, 'loggedOut');
    // The node never answered — the raw "Timeout waiting for push from
    // <prefix>" says nothing a user can act on, so name the two causes it
    // actually has instead.
    const timedOut = err instanceof PushTimeoutError;
    // `quiet` covers only the silence a retry cycle is about to answer for
    // itself. A reported rejection stops that cycle where it stands, so
    // swallowing its message would lose the one thing that explains why.
    if (!quiet || !timedOut) {
      notify({
        level: 'error',
        text: timedOut
          ? i18n.t('notify.repeaterLoginTimedOut', {
              name: contact.name || prefix.slice(0, 8),
            })
          : i18n.t('notify.repeaterLoginFailed', {
              error: (err as Error).message,
            }),
        key: `repeaterLogin:${prefix}`,
      });
    }
    return timedOut ? 'timeout' : 'failed';
  }
}

// Rooms whose history the connect-time sync is pulling right now, each with
// when its pull began, in epoch seconds on our clock.
const replaying = new Map<string, number>();

/**
 * Whether a room post is replayed history rather than live traffic: the
 * connect-time sync is pulling the room, and the post was written before the
 * pull began.
 *
 * @param timestamp - the post's time already converted to our clock, as
 * `roomPostTime` gives it.
 */
export function isReplayedRoomPost(
  prefix: string,
  timestamp: number | undefined,
): boolean {
  const since = replaying.get(prefix);
  return since !== undefined && timestamp !== undefined && timestamp < since;
}

// Resolves once the backlog drain is not running, at once when it already
// isn't. A teardown lowers the flag too, so a session that ends mid-drain
// resolves here and leaves the caller's liveness check to stop it.
function backlogSettled(): Promise<void> {
  return new Promise((resolve) => {
    if (!useMeshStore.getState().backlogDraining) {
      resolve();
      return;
    }
    const unsub = useMeshStore.subscribe((state) => {
      if (state.backlogDraining) return;
      unsub();
      resolve();
    });
  });
}

// One login round with the remembered credential: up to LOGIN_ATTEMPTS tries,
// the last flooding after a route reset, as the room view's own cycle does.
// Gives way to a sign-in the room view has in flight, whose outcome is its to
// report.
async function signInRoom(
  client: MeshCoreClient,
  prefix: string,
  alive: () => boolean,
): Promise<boolean> {
  const start = useMeshStore.getState().adminSessions[prefix]?.login;
  for (let i = 1; i <= LOGIN_ATTEMPTS; i++) {
    if (!alive()) return false;
    const stale = useMeshStore.getState().contacts[prefix];
    const now = useMeshStore.getState().adminSessions[prefix]?.login;
    // Checked before the reset as well as after it, so a sign-in the room view
    // has in flight doesn't lose the route it is using. One that already won
    // during this round's backoff signed us in: its login set the replay off
    // just as ours would have.
    if (now === 'pending') return false;
    if (!isAuthedLogin(start) && isAuthedLogin(now)) return true;
    if (i === LOGIN_ATTEMPTS && stale && stale.outPathLen !== NO_PATH) {
      // Best-effort: a failed reset leaves the path in place, and the last
      // attempt still goes out on it.
      await client.resetPath(stale).catch(() => undefined);
      if (!alive()) return false;
    }
    // Re-read before every attempt: a log-out clears the record, and a pull
    // that outlived it would sign the user back in and store the password
    // they just told us to forget. The two share one I/O queue, so a log-out
    // that lands first is seen here; one that lands during the read is caught
    // below by the session it tore down.
    const before = useMeshStore.getState().adminSessions[prefix]?.login;
    const cred = await loadRepeaterCred(prefix);
    if (!cred || !alive()) return false;
    // Read after every await, and claimed by `loginNode` in the same
    // synchronous step, so the room view's cycle can't be mid-handshake when
    // this one is sent. A contact deleted meanwhile ends the round.
    const state = useMeshStore.getState();
    const contact = state.contacts[prefix];
    const login = state.adminSessions[prefix]?.login;
    if (
      !contact ||
      login === 'pending' ||
      (isAuthedLogin(before) && !isAuthedLogin(login))
    ) {
      return false;
    }
    const outcome = await loginNode(
      client,
      contact,
      cred.password,
      cred.access,
      true,
      true,
    );
    if (outcome === 'ok') return true;
    if (outcome !== 'timeout') return false;
    if (i < LOGIN_ATTEMPTS) await delay(LOGIN_RETRY_BACKOFF_MS);
  }
  return false;
}

// How many of a feed's posts are replayed history: inbound, and written before
// the pull began. A live post already raised its own notice and says nothing
// about whether the replay has stalled.
const replayedCount = (prefix: string, list: Message[] | undefined): number =>
  list?.reduce(
    (n, m) => (!m.own && isReplayedRoomPost(prefix, m.timestamp) ? n + 1 : n),
    0,
  ) ?? 0;

// Waits until the room's feed has gone ROOM_REPLAY_QUIET_MS without a replayed
// post, or the session ends, and resolves with how many landed.
function replayQuiet(prefix: string, alive: () => boolean): Promise<number> {
  const id = roomConvoId(prefix);
  let posts = 0;
  let lastAt = Date.now();
  const unsub = useMeshStore.subscribe((state, prev) => {
    const list = state.msgHistory[id];
    const before = prev.msgHistory[id];
    if (list === before) return;
    const added = replayedCount(prefix, list) - replayedCount(prefix, before);
    if (added <= 0) return;
    posts += added;
    lastAt = Date.now();
  });
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (alive() && Date.now() - lastAt < ROOM_REPLAY_QUIET_MS) return;
      clearInterval(timer);
      unsub();
      resolve(posts);
    }, 1000);
  });
}

/**
 * Pulls the history of every room server in the contact table that has a
 * remembered credential, one room at a time, once the connect-time message
 * drain has finished.
 *
 * @remarks A room replays the posts it has stored since it last delivered to
 * us once we log in, so each pull is a login — up to {@link LOGIN_ATTEMPTS}
 * of them — and then a wait for the replay to go quiet. A replay that
 * delivered posts may have stalled rather than finished, so it is resumed
 * with another login, up to {@link ROOM_PULL_ROUNDS} per room. A room the
 * room view is signing in to meanwhile is left to it.
 * @param alive - whether the session this sync belongs to is still up.
 */
export async function signInRememberedRooms(
  client: MeshCoreClient,
  alive: () => boolean,
): Promise<void> {
  await backlogSettled();
  const prefixes = Object.values(useMeshStore.getState().contacts)
    .filter((c) => c.advType === ADV_TYPE_ROOM)
    .map((c) => c.pubkeyPrefix);
  for (const prefix of prefixes) {
    if (!alive()) return;
    if (!(await loadRepeaterCred(prefix))) continue;
    replaying.set(prefix, Math.floor(Date.now() / 1000));
    let pulled = 0;
    try {
      for (let round = 1; round <= ROOM_PULL_ROUNDS; round++) {
        if (!(await signInRoom(client, prefix, alive))) break;
        const posts = await replayQuiet(prefix, alive);
        if (posts === 0) break;
        pulled += posts;
      }
    } finally {
      replaying.delete(prefix);
    }
    // The replay's own arrivals raise no notice of their own (see
    // `isReplayedRoomPost`), so one summary stands in for them, as the
    // backlog drain's does.
    const room = useMeshStore.getState().contacts[prefix];
    if (pulled > 0 && alive() && room) {
      useMeshStore.getState().notify({
        level: 'success',
        text: i18n.t('notify.roomCaughtUp', {
          count: pulled,
          room: room.name || prefix.slice(0, 8),
        }),
        key: `roomCaughtUp:${prefix}`,
      });
    }
  }
}
