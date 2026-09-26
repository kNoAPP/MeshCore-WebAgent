// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import { useMeshStore, canPostToRoom } from '@/store/meshStore';
import { canTransmit } from '@/lib/session/guards';
import { ADV_TYPE_REPEATER, NO_PATH } from '@/lib/meshcore/constants';
import { toHex } from '@/lib/utils';
import i18n from '@/lib/i18n';
import type { ActiveConvo, Contact, SendReceipt } from '@/types/meshcore';

interface PendingAck {
  convoId: string;
  msgId: string;
  // Recipient's pubkey prefix, carried here so an ACK that outlives its
  // delivery cycle can still clear the contact's failure counter.
  contactKey: string;
  timer: ReturnType<typeof setTimeout>;
}

// One own direct message's automatic delivery cycle. `text` and `contactKey`
// are held rather than a Contact snapshot so every attempt re-reads the route
// the radio currently holds for that contact.
interface DeliveryCycle {
  convo: ActiveConvo;
  msgId: string;
  text: string;
  contactKey: string;
  // Zero-based index of the attempt in flight; also the protocol's attempt
  // byte, which lets the radio vary its routing on a resend.
  attempt: number;
  // Route the in-flight attempt went out over, so its failure is counted
  // against that route rather than one the radio has learned since.
  attemptRoute: string;
  // ACK key of the attempt in flight, or null between attempts.
  ackKey: number | null;
}

// LoRa round trips are spiky — give the radio's suggested timeout some slack
const ACK_TIMEOUT_GRACE = 1.5;
const MIN_ACK_TIMEOUT_MS = 5000;
const DEFAULT_ACK_TIMEOUT_MS = 30000;
const EXPIRED_ACK_LIMIT = 50;
// Consecutive delivery failures to one contact — shared by every message in
// flight to it — before its stored route is discarded so sends fall back to
// flood. One lost ACK is not enough: throwing away a working path forces a slow
// rediscovery for everyone.
const PATH_RESET_FAILURES = 2;

/**
 * Delivery attempts a direct message gets — the initial send plus automatic
 * retries. Each retry fires as soon as the previous attempt's ACK timeout
 * expires; the radio's suggested timeout is the only pacing.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

// Module scope, not per-instance refs: useMeshCore is mounted by several
// components but the client callbacks are wired once, so send-tracking state
// must be shared across all hook instances.
const pendingAcks = new Map<number, PendingAck>();
// ACK codes whose timeout already fired — kept so a late ACK can upgrade the
// message from 'failed' to 'delivered' instead of being dropped
const expiredAcks = new Map<number, Omit<PendingAck, 'timer'>>();
// Own direct messages mid-retry-cycle, keyed by message id. Membership is what
// authorizes an attempt: delivery, exhaustion, an unreachable contact, and
// teardown all drop the entry, and an attempt already awaiting the radio checks
// it is still registered before touching the message again.
const deliveryCycles = new Map<string, DeliveryCycle>();
// Consecutive delivery failures per contact (by pubkey prefix), tagged with the
// route they were counted against so a timeout from a superseded path can never
// condemn the one now in place. Shared across the contact's in-flight messages
// so a broken route is detected once and reset once, not once per message.
const contactFailures = new Map<string, { route: string; count: number }>();
// The path reset in flight for a contact, if any. A failure that arrives while
// one is running joins it instead of queuing a second RESET_PATH for the same
// route — `client.contacts` only shows the cleared path once the radio answers.
const pathResets = new Map<string, Promise<void>>();
let syntheticAckSeq = 0;

function rememberExpiredAck(
  ackCode: number,
  convoId: string,
  msgId: string,
  contactKey: string,
): void {
  expiredAcks.set(ackCode, { convoId, msgId, contactKey });
  if (expiredAcks.size > EXPIRED_ACK_LIMIT) {
    expiredAcks.delete(expiredAcks.keys().next().value!);
  }
}

/**
 * Settles the message an inbound ACK answers, whether or not its attempt's
 * timeout has already fired.
 *
 * @param roundTripMs - the radio's measured round trip, shown on the bubble.
 */
export function handleAck(ackCode: number, roundTripMs: number): void {
  const pending = pendingAcks.get(ackCode);
  if (pending) {
    pendingAcks.delete(ackCode);
    clearTimeout(pending.timer);
    markDelivered(pending, roundTripMs);
    return;
  }
  // Late ACK — the timeout already marked the message 'failed'; upgrade it
  const expired = expiredAcks.get(ackCode);
  if (!expired) return; // unknown or duplicate ACK
  expiredAcks.delete(ackCode);
  markDelivered(expired, roundTripMs);
}

// An ACK settles the whole message, not just the attempt it answers: a late one
// can land while a later attempt is in flight, or after the budget ran out, so
// the cycle is retired before the status is written. The contact's path
// evidently works either way, so its shared failure counter goes back to zero.
function markDelivered(
  ack: Omit<PendingAck, 'timer'>,
  roundTripMs: number,
): void {
  contactFailures.delete(ack.contactKey);
  endDeliveryCycle(ack.msgId);
  useMeshStore.getState().updateMessage(ack.convoId, ack.msgId, {
    status: 'delivered',
    roundTripMs,
  });
}

// Cancels a message's remaining attempts and disarms the in-flight attempt's
// ACK timeout, so nothing fires for a message that is already settled.
function endDeliveryCycle(msgId: string): void {
  const cycle = deliveryCycles.get(msgId);
  if (!cycle) return;
  deliveryCycles.delete(msgId);
  if (cycle.ackKey === null) return;
  const pending = pendingAcks.get(cycle.ackKey);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingAcks.delete(cycle.ackKey);
}

/**
 * Begins (or restarts, for a manual "try again") the automatic delivery cycle
 * for an own direct message.
 *
 * @returns once the first attempt has been handed to the radio; any retries run
 * on from the ACK timeout it arms.
 */
export function startDeliveryCycle(
  convo: ActiveConvo,
  msgId: string,
  text: string,
): Promise<void> {
  endDeliveryCycle(msgId);
  const cycle: DeliveryCycle = {
    convo,
    msgId,
    text,
    contactKey: String(convo.rawId),
    attempt: 0,
    attemptRoute: '',
    ackKey: null,
  };
  deliveryCycles.set(msgId, cycle);
  return runDeliveryAttempt(cycle);
}

// Sends one attempt and arms its ACK timeout. The contact is re-read from the
// client every time, so a path the radio learned since the last attempt (via
// PUSH_PATH_UPDATED) is used instead of a snapshot taken when the message was
// composed.
async function runDeliveryAttempt(cycle: DeliveryCycle): Promise<void> {
  const store = useMeshStore.getState();
  const client = store.client;
  if (!canTransmit(client)) {
    settleUndelivered(cycle);
    return;
  }
  const contact = client.contacts[cycle.contactKey];
  // A contact deleted (or re-read as a repeater) mid-cycle can never be
  // reached; abandon the cycle rather than looping on the same notice.
  if (!contact || contact.advType === ADV_TYPE_REPEATER) {
    settleUndelivered(cycle);
    store.notify({
      level: 'error',
      text: i18n.t(
        contact ? 'notify.repeaterCantMessage' : 'notify.contactNotFound',
      ),
      key: `undeliverable:${cycle.contactKey}`,
    });
    return;
  }
  // Every attempt is re-gated on post access, not just the first: logging out
  // (or being downgraded) between an attempt and its ACK timeout would
  // otherwise keep transmitting into a room that silently drops the post.
  if (
    cycle.convo.kind === 'room' &&
    !canPostToRoom(store.adminSessions[cycle.contactKey]?.login)
  ) {
    settleUndelivered(cycle);
    store.notify({
      level: 'warning',
      text: i18n.t('notify.roomPostNoAccess'),
      key: `roomPostNoAccess:${cycle.contactKey}`,
    });
    return;
  }
  store.updateMessage(cycle.convo.id, cycle.msgId, {
    status: 'sending',
    attempt: cycle.attempt,
  });
  cycle.attemptRoute = routeSignature(contact);
  let receipt: SendReceipt | null;
  try {
    receipt = await client.sendDirectMessage(
      contact,
      cycle.text,
      cycle.attempt,
    );
  } catch (err) {
    if (deliveryCycles.get(cycle.msgId) !== cycle) return;
    store.notify({
      level: 'error',
      text: i18n.t('notify.sendFailed', { error: (err as Error).message }),
      key: `sendFailed:${cycle.convo.id}`,
    });
    // A refused send is a failed attempt like any other — it counts toward the
    // contact's route policy and spends one of the message's tries.
    void handleDeliveryFailure(cycle);
    return;
  }
  // A late ACK (or a teardown) retired the cycle while the send was in flight;
  // the message is already settled, so don't reopen it.
  if (deliveryCycles.get(cycle.msgId) !== cycle) return;
  store.updateMessage(cycle.convo.id, cycle.msgId, {
    status: 'sent',
    routeFlood: receipt?.routeFlood,
  });
  // Without a receipt (OK-only reply) no ACK can ever match — a synthetic
  // negative key still gives the attempt a timeout so the cycle can't stall
  const ackKey = receipt ? receipt.expectedAck : --syntheticAckSeq;
  const timeoutMs = receipt
    ? Math.max(
        MIN_ACK_TIMEOUT_MS,
        receipt.suggestedTimeoutMs * ACK_TIMEOUT_GRACE,
      )
    : DEFAULT_ACK_TIMEOUT_MS;
  cycle.ackKey = ackKey;
  const timer = setTimeout(() => {
    pendingAcks.delete(ackKey);
    if (ackKey >= 0) {
      rememberExpiredAck(ackKey, cycle.convo.id, cycle.msgId, cycle.contactKey);
    }
    cycle.ackKey = null;
    void handleDeliveryFailure(cycle);
  }, timeoutMs);
  pendingAcks.set(ackKey, {
    convoId: cycle.convo.id,
    msgId: cycle.msgId,
    contactKey: cycle.contactKey,
    timer,
  });
}

// One attempt went unacknowledged or was refused. The contact's route policy
// runs first, so a reset it triggers is already in effect when the next attempt
// goes out and that attempt floods.
async function handleDeliveryFailure(cycle: DeliveryCycle): Promise<void> {
  if (deliveryCycles.get(cycle.msgId) !== cycle) return;
  await applyRoutePolicy(cycle.contactKey, cycle.attemptRoute);
  if (deliveryCycles.get(cycle.msgId) !== cycle) return;
  if (cycle.attempt + 1 >= MAX_DELIVERY_ATTEMPTS) {
    settleUndelivered(cycle);
    return;
  }
  cycle.attempt++;
  await runDeliveryAttempt(cycle);
}

// Identifies the route the radio currently holds for a contact, so a failure
// can be attributed to the exact path the attempt went out over.
function routeSignature(contact: Contact): string {
  return contact.outPathLen === NO_PATH
    ? 'flood'
    : `${contact.outPathLen}:${toHex(contact.path)}`;
}

// Counts one consecutive failure against a contact's current path and, once the
// count trips, discards that path with a single RESET_PATH — every message in
// flight to the contact then floods on its next attempt.
async function applyRoutePolicy(
  contactKey: string,
  attemptRoute: string,
): Promise<void> {
  // A reset already running covers this failure too — it is the same broken
  // route — so wait for it rather than counting or resetting a second time.
  const running = pathResets.get(contactKey);
  if (running) {
    await running;
    return;
  }
  const client = useMeshStore.getState().client;
  if (!canTransmit(client)) return;
  const contact = client.contacts[contactKey];
  if (!contact) return;
  // The count condemns one specific stored route. While the contact floods
  // there is none to condemn, and any tally left over from the route it dropped
  // must not survive to greet a relearned one with a head start.
  if (contact.outPathLen === NO_PATH) {
    contactFailures.delete(contactKey);
    return;
  }
  // A failure that went out over a route the radio has since replaced says
  // nothing about the one now in place, and must not touch its tally.
  const route = routeSignature(contact);
  if (route !== attemptRoute) return;
  const recorded = contactFailures.get(contactKey);
  const failures = recorded?.route === route ? recorded.count + 1 : 1;
  contactFailures.set(contactKey, { route, count: failures });
  if (failures < PATH_RESET_FAILURES) return;
  // Only a reset the radio confirmed clears the count; one that failed leaves
  // it at the threshold, so the next failure tries again rather than stranding
  // the cycle here.
  const reset = client
    .resetPath(contact)
    .then(() => {
      contactFailures.delete(contactKey);
    })
    .catch(() => {})
    .finally(() => {
      pathResets.delete(contactKey);
    });
  pathResets.set(contactKey, reset);
  await reset;
}

// Retires a cycle with the message left at 'failed' — the UI's "Not delivered"
// state, whose one action starts a fresh cycle.
function settleUndelivered(cycle: DeliveryCycle): void {
  endDeliveryCycle(cycle.msgId);
  useMeshStore.getState().updateMessage(cycle.convo.id, cycle.msgId, {
    status: 'failed',
    attempt: cycle.attempt,
  });
}

/**
 * Drops every in-flight delivery cycle and its ACK bookkeeping, leaving each
 * affected message at 'failed'.
 *
 * @remarks
 * Cycles, not pending ACKs, are the full set of messages still in play: one
 * awaiting `sendDirectMessage` or a path reset has no ACK registered yet, and
 * its continuation bails once the cycle is gone. Settle them all here, or the
 * bubble stays at 'sending' for the rest of the session.
 */
export function resetDelivery(): void {
  for (const p of pendingAcks.values()) clearTimeout(p.timer);
  pendingAcks.clear();
  const { updateMessage } = useMeshStore.getState();
  for (const cycle of deliveryCycles.values()) {
    updateMessage(cycle.convo.id, cycle.msgId, { status: 'failed' });
  }
  deliveryCycles.clear();
  contactFailures.clear();
  pathResets.clear();
  expiredAcks.clear();
}
