// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type {
  ITransport,
  Contact,
  Channel,
  Advert,
  AutoAddConfig,
  SelfInfo,
  DeviceInfo,
  BatteryInfo,
  StatsResult,
  Message,
  SyncProgress,
  SendReceipt,
  RawRxPacket,
  RepeaterStatus,
  RepeaterAccess,
  NodeTelemetry,
  NeighborsPage,
  AclEntry,
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
import { MeshConnectError, PrivateKeyError, PushTimeoutError } from './errors';
import {
  RESP,
  ERR_CODE,
  FAVORITE_FLAG,
  AUTOADD,
  MANUAL_ADD_OFF,
  MANUAL_ADD_ON,
  MAX_CHANNEL_SLOTS,
  TXT_TYPE,
} from './constants';
import {
  buildAppStart,
  buildDeviceQuery,
  buildGetDeviceTime,
  buildSetDeviceTime,
  buildGetContacts,
  buildGetChannelInfo,
  buildSyncNextMessage,
  buildGetBattery,
  buildGetCustomVars,
  buildSetCustomVar,
  buildGetStats,
  buildSendChannelMsg,
  buildSendDirectMsg,
  buildResetPath,
  buildAddOrUpdateContact,
  buildRemoveContact,
  buildShareContact,
  buildExportPrivateKey,
  buildImportPrivateKey,
  buildSendSelfAdvert,
  buildSetChannel,
  buildSetAdvertName,
  buildSetRadioParams,
  buildSetTxPower,
  buildSetAdvertLatLon,
  buildSetOtherParams,
  buildSetAdvertLocPolicy,
  buildSetAutoAddConfig,
  buildGetAutoAddConfig,
  buildReboot,
  buildSendLogin,
  buildSendStatusReq,
  buildSendTelemetryReq,
  buildGetNeighborsReq,
  buildGetAccessListReq,
  type NeighborsQuery,
} from './frames';
import {
  parseSelfInfo,
  parseDeviceInfo,
  parseCustomVars,
  parseBattAndStorage,
  parseContact,
  parseChannelInfo,
  parseChannelMsg,
  parseChannelMsgV3,
  parseContactMsg,
  parseContactMsgV3,
  parseMsgSent,
  parseSendConfirmed,
  parseLogRxData,
  parseStatsCore,
  parseStatsRadio,
  parseStatsPackets,
  parseAutoAddConfig,
  parseCurrentTime,
  parseStatusResponse,
  parseLoginPush,
  parseTelemetryResponse,
  parsePrivateKey,
  parseBinaryResponse,
  parseNeighborsResponse,
  parseAccessList,
} from './parsers';
import { sortAdvertsByHeard, toHex } from '@/lib/utils';

// Cap the heard-adverts log so a long session on a busy mesh can't grow
// unbounded
const ADVERTS_LIMIT = 200;

// How long a live-push observation stays paired with the contact-table read
// that follows it, for the clock-skew measurement in `recordAdvert`.
// `scheduleContactResync` coalesces bursts on a 2 s timer, so the resync
// carrying the same advert lands well inside this window; the slack absorbs a
// slow sync without ever reaching the next advert from the same node.
const ADVERT_OBSERVATION_WINDOW_SECS = 30;

// Extra time added to a login/status push wait beyond the radio's estimated
// round-trip (read from the SENT receipt), absorbing push-delivery jitter on
// top of that estimate. Kept small so a genuinely unanswered request (e.g. a
// wrong repeater password, which yields no response) still fails promptly.
const PUSH_GRACE_MS = 2000;

// Fallback push-wait budget used only when the SENT receipt carries no usable
// round-trip estimate (a malformed or too-short receipt). Sized to cover a
// typical multi-hop path so a slow-but-valid reply isn't cut off; the receipt's
// own estimate is preferred whenever it provides one.
const PUSH_FALLBACK_TIMEOUT_MS = 8000;

// How many unmatched binary responses to hold while a request is between its
// SENT receipt and registering its waiter. Only one request is in flight at a
// time, so this needs to cover that request's own push plus any stragglers owed
// to ones that already timed out — a handful is ample, and the map is cleared
// at the start of every request anyway.
const ORPHAN_BINARY_LIMIT = 8;

/**
 * Maximum tolerated drift, in seconds, between the device clock and the
 * browser clock. On connect, the radio's clock is only corrected once it
 * drifts past this — small enough that inbound timestamps stay trustworthy,
 * large enough to ignore normal transport/parse latency. The stats UI reuses
 * the same threshold to decide when to show the clock as "in sync".
 */
export const CLOCK_SKEW_THRESHOLD_SECS = 30;

/**
 * How long contact collection waits for the *next* `CONTACT` frame before
 * giving up. This is an inactivity timeout, re-armed on every frame — not an
 * overall budget — so an arbitrarily large contact table syncs in full as long
 * as the radio keeps streaming, while a silent or stalled radio still aborts
 * promptly. A fixed overall budget truncated large tables (a 164-contact dump
 * over BLE outran an 8s cap, dropping the tail).
 */
export const CONTACTS_IDLE_TIMEOUT_MS = 8000;

/**
 * How long the initial `APP_START` waits for `SELF_INFO`, sized to outlast a
 * first-time BLE pairing. Chrome accepts the write but queues it *in progress*
 * behind the OS pairing dialog, delivering it only once bonding completes and
 * the radio answers — a short 6s wait expired mid-pairing and tore the link
 * down. Not retried: a second write during pairing is rejected with "GATT
 * operation already in progress", so we wait once and let the queued write
 * flush. USB/WiFi and bonded BLE links answer in well under a second.
 */
export const APP_START_TIMEOUT_MS = 40000;

// A full contact table makes the radio push CONTACTS_FULL for every node it
// hears, so the notification is rate-limited to keep it from drowning the UI.
const CONTACTS_FULL_NOTIFY_INTERVAL_MS = 300000;

type RespCode = number;

interface PendingCmd {
  types: RespCode[];
  resolve: (d: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// A caller awaiting an asynchronous push (PUSH_LOGIN_SUCCESS /
// PUSH_STATUS_RESPONSE / PUSH_TELEMETRY_RESPONSE / PUSH_BINARY_RESPONSE) that
// the radio delivers well after its SENT receipt.
// Keyed by the target node's 6-byte pubkey prefix — or, for a binary request,
// by the tag the receipt carried — so concurrent requests never cross-talk.
// `timer` is armed only once the SENT receipt reveals the estimated round-trip,
// so it is null between registration and that receipt.
interface PushWaiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Event hooks the client fires as radio state changes. The `useMeshCore` hook
 * wires these into the Zustand store. All are optional; collection callbacks
 * receive a fresh snapshot of the relevant map.
 */
export interface MeshCoreCallbacks {
  /** A new inbound channel or direct message arrived. */
  onMessage?: (msg: Message) => void;
  /**
   * A remote-admin CLI reply arrived (a `CONTACT_MSG` with `CLI_DATA`). Routed
   * here rather than {@link onMessage} so console output never lands in chat
   * history. `pubkeyPrefix` identifies the repeater/room-server it came from.
   */
  onCliReply?: (reply: { pubkeyPrefix: string; text: string }) => void;
  /**
   * The contact table changed (after a sync, add, remove, or favorite toggle).
   */
  onContactsUpdated?: (contacts: Record<string, Contact>) => void;
  /**
   * The radio's contact storage is full, so a heard node was discarded rather
   * than added. Throttled to at most once per
   * {@link CONTACTS_FULL_NOTIFY_INTERVAL_MS}.
   */
  onContactsFull?: () => void;
  /** The channel list changed. */
  onChannelsUpdated?: (channels: Record<number, Channel>) => void;
  /** The heard-adverts log changed (a node advertised or re-advertised). */
  onAdvertsUpdated?: (adverts: Record<string, Advert>) => void;
  /** This radio's identity/config (from the `APP_START` handshake). */
  onSelfInfo?: (info: SelfInfo) => void;
  /** Device hardware/firmware info (from `DEVICE_QUERY`). */
  onDeviceInfo?: (info: DeviceInfo) => void;
  /** Battery and storage stats. */
  onBattery?: (info: BatteryInfo) => void;
  /** A delivery ack arrived: the ack code and measured round-trip in ms. */
  onAck?: (ackCode: number, roundTripMs: number) => void;
  /** A raw RX-log packet (used to count repeater rebroadcasts). */
  onLogRx?: (pkt: RawRxPacket) => void;
  /** Progress updates during the initial connect sync. */
  onSyncProgress?: (progress: SyncProgress) => void;
  /**
   * The transport link dropped unexpectedly (not a caller-initiated
   * disconnect). Fired after the client stops its own timers; the hook uses it
   * to surface the `reconnecting` state and drive auto-reconnect.
   */
  onDisconnect?: () => void;
}

/**
 * Stateful client for the MeshCore Companion Protocol over an
 * {@link ITransport}.
 *
 * @remarks
 * Owns the local mirror of radio state (`contacts`, `channels`, `adverts`,
 * `selfInfo`, `deviceInfo`) and a request/response correlator: {@link cmd}
 * sends a payload and resolves when a matching {@link RESP} frame arrives.
 * After {@link init} completes it polls for queued messages every 5s. Inbound
 * frames are dispatched in {@link handleFrame}; pushes update state and fire
 * {@link MeshCoreCallbacks}. One instance per connection — call {@link destroy}
 * to tear it down.
 */
export class MeshCoreClient {
  contacts: Record<string, Contact> = {};
  channels: Record<number, Channel> = {};
  adverts: Record<string, Advert> = {};
  selfInfo: SelfInfo | null = null;
  deviceInfo: DeviceInfo | null = null;

  // Prefix → our clock when a live advert push was seen, waiting on the
  // contact read that carries that same advert's sender timestamp. Entries are
  // consumed by `foldAdvertObservations` and expire with
  // ADVERT_OBSERVATION_WINDOW_SECS.
  private advertObservations: Record<string, number> = {};

  private handlers: PendingCmd[] = [];
  // Slots whose SET_CHANNEL clear has been sent but not yet acked. The mirror
  // entry stays put so allocation keeps reserving the slot, but sends must
  // already treat it as gone — cmd() serializes, so anything issued now lands
  // after the clear.
  private pendingRemovals = new Set<number>();
  // Login and status replies arrive as unsolicited pushes long after the SENT
  // receipt, so they can't ride the `handlers` queue. Each is matched back to
  // its request by the target's 6-byte pubkey prefix (hex).
  private loginWaiters = new Map<string, PushWaiter<RepeaterAccess | null>>();
  private statusWaiters = new Map<string, PushWaiter<RepeaterStatus>>();
  private telemetryWaiters = new Map<string, PushWaiter<NodeTelemetry>>();
  // Binary requests correlate by the tag from their SENT receipt instead of by
  // pubkey prefix, so a reply is tied to the one request that asked for it —
  // a straggler from a timed-out read can never be claimed by the next one.
  private binaryWaiters = new Map<number, PushWaiter<Uint8Array>>();
  // Binary responses that arrived before their requester learned the tag it
  // must wait on — possible because the frame parser dispatches a read chunk's
  // frames synchronously, so a push sharing a chunk with the SENT receipt lands
  // before the `await` on that receipt resumes.
  //
  // Keyed by tag rather than held in a single slot, because more than one can
  // land in that window: a straggler owed to an earlier request that already
  // timed out arrives unmatched too, and with one slot it would overwrite the
  // response actually being waited for — losing a good reply and timing the
  // request out. Bounded and cleared when a request starts, so it cannot grow.
  private orphanBinaryResponses = new Map<number, Uint8Array>();
  // Set once this radio rejects SEND_BINARY_REQ as a command it does not know,
  // so every later structured request skips straight to its fallback instead of
  // paying another round trip to be told the same thing. A property of the
  // connected radio, so it dies with this client.
  private binaryReqUnsupported = false;
  // Serializes the full login/status/telemetry handshake (the SENT receipt
  // *and* the async push that follows). Current firmware retains only one
  // pending remote request and clears it on each request command
  // (`clearPendingReqs`), so overlapping requests — even to different nodes —
  // would cancel each other radio-side and leave the earlier waiter to time
  // out. Each operation runs to completion (or failure) before the next
  // begins.
  private remoteChain: Promise<unknown> = Promise.resolve();
  // Serializes command/response exchanges: each cmd() waits for the previous to
  // settle before sending. The radio handles one exchange at a time, so this
  // stops the 5s message poll (or any other command) from racing a fetch for
  // the shared handler queue and intermittently stealing an ERR rejection or
  // delaying a reply past its timeout.
  private cmdChain: Promise<unknown> = Promise.resolve();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pathSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private collectingContacts = false;
  private contactsStarted = false;
  private contactsResolve: (() => void) | null = null;
  private rearmContactsIdle: (() => void) | null = null;
  private contactsTotal = 0;
  private contactsSeen = 0;
  // Contacts streamed by the in-flight enumeration. Swapped in wholesale at
  // END_OF_CONTACTS so the table reconciles (entries the radio no longer
  // reports are dropped); a stalled sync discards it and keeps the last good
  // snapshot rather than pruning against a partial read.
  private pendingContacts: Record<string, Contact> | null = null;
  private contactsFullNotifiedAt = 0;
  private initialSync = false;
  private _closed = false;

  constructor(
    private transport: ITransport,
    public callbacks: MeshCoreCallbacks = {},
  ) {}

  /**
   * Runs the connect handshake and initial sync: `APP_START`, `DEVICE_QUERY`,
   * a best-effort clock sync, full contact + channel sync, and a first message
   * drain, reporting progress via {@link MeshCoreCallbacks.onSyncProgress}.
   * Then starts the 5s message
   * poll. Individual steps are best-effort — a timeout is swallowed so a slow
   * radio still finishes connecting.
   */
  async init(): Promise<void> {
    // Register the close handler before starting the read loop: a transport
    // that drops immediately could otherwise fire close before the listener is
    // installed, leaving the client stuck mid-sync.
    this.transport.onClose(() => this.handleClose());
    // Await in case the transport's read setup is async (BLE subscribes to GATT
    // notifications) so the handshake below can't be sent before inbound frames
    // can arrive.
    await this.transport.startReading((d) => this.handleFrame(d));
    this.initialSync = true;
    this.reportSync('device', 0);
    // The handshake commands are best-effort: a slow radio's timeout is
    // swallowed so it still connects. The sync helpers below propagate their
    // own errors. Either way syncStep aborts init() if the link closed under
    // the step, so a mid-sync drop fails the connect instead of finishing
    // partial.
    await this.syncStep(
      () => this.cmd(buildAppStart(), [RESP.SELF_INFO], APP_START_TIMEOUT_MS),
      true,
    );
    // AppStart must yield SELF_INFO for a usable link. A radio that's powered
    // but still rebooting can accept the transport (the USB/WiFi/GATT link
    // reopens) yet answer nothing — without this the best-effort sync below
    // would finish empty and we'd wrongly declare a mute link "connected",
    // wiping the last-synced contacts. Fail instead so the connect retries.
    if (!this.selfInfo) {
      throw new MeshConnectError('radioNoResponse');
    }
    this.reportSync('device', 5);
    await this.syncStep(
      () => this.cmd(buildDeviceQuery(), [RESP.DEVICE_INFO], 5000),
      true,
    );
    // Probe hardware capabilities (GPS presence) right after DEVICE_QUERY, so
    // the parsed deviceInfo is already in place to fold the flag into.
    // Best-effort: firmware without CMD_GET_CUSTOM_VARS answers ERR and the
    // radio still connects, leaving hasGps unset (treated as no GPS).
    await this.syncStep(() => this.syncDeviceCapabilities(), true);
    // Best-effort clock sync runs right after DEVICE_QUERY, per the companion
    // protocol, so the radio's clock is corrected before the message drain —
    // inbound messages then get the right device timestamp instead of a stale
    // one. Older firmware that lacks GET_DEVICE_TIME is skipped silently.
    this.reportSync('clock', 7);
    await this.syncStep(() => this.syncClock(), true);
    this.reportSync('contacts', 10);
    await this.syncStep(() => this.syncContacts());
    await this.syncStep(() => this.syncChannels());
    await this.syncStep(() => this.pollMessages());
    this.reportSync('messages', 100);
    this.initialSync = false;
    this.pollTimer = setInterval(() => this.pollMessages(), 5000);
  }

  // Verifies the link survived the step, so a mid-sync drop aborts `init`
  // instead of letting a best-effort step finish partial — any step routed
  // through here is close-safe by default. With `bestEffort`, the step's own
  // error (a slow or unsupported radio) is swallowed; a close always aborts.
  private async syncStep(
    step: () => Promise<unknown>,
    bestEffort = false,
  ): Promise<void> {
    try {
      await step();
    } catch (err) {
      if (this._closed || !bestEffort) throw err;
    }
    this.throwIfClosed();
  }

  private reportSync(
    stage: SyncProgress['stage'],
    percent: number,
    current?: number,
    total?: number,
  ): void {
    if (this.initialSync) {
      this.callbacks.onSyncProgress?.({
        stage,
        percent: Math.round(percent),
        current,
        total,
      });
    }
  }

  // Sends a command and resolves with the first inbound frame whose RESP code
  // is in `types` (an ERR frame rejects the pending command). Rejects on
  // timeout. Exchanges are serialized through `cmdChain` so only one is ever
  // outstanding — the radio answers one request at a time, and a single pending
  // handler keeps response/ERR matching unambiguous. `retries` re-sends the
  // command that many extra times if it times out (read-only commands pass 1 to
  // ride out a transient drop under load); other failures propagate on the
  // first try.
  // Serializes `op` behind everything already queued on `chain`: `op` runs once
  // the chain settles (success or failure), the caller awaits `run` for `op`'s
  // own result, and the returned `tail` — which the caller stores back as the
  // new chain head — settles without ever rejecting, so a failed `op` never
  // leaks its rejection or resolved value into the next queued operation.
  // Shared by the command (`cmdChain`) and remote-admin (`remoteChain`) chains.
  private serialize<T>(
    chain: Promise<unknown>,
    op: () => Promise<T>,
  ): { run: Promise<T>; tail: Promise<unknown> } {
    const run = chain.then(op, op);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    return { run, tail };
  }

  // Maps a refused private-key exchange onto a PrivateKeyError the Settings UI
  // can explain. Only the device ERR codes the two firmware handlers actually
  // emit are translated; timeouts and transport failures stay as they are so
  // the generic retry/reconnect copy still applies to them.
  private static privateKeyError(err: unknown): unknown {
    const code = (err as { code?: number }).code;
    if (code === ERR_CODE.UNSUPPORTED_CMD)
      return new PrivateKeyError('unsupported');
    if (code === ERR_CODE.ILLEGAL_ARG) return new PrivateKeyError('rejected');
    if (code === ERR_CODE.FILE_IO_ERROR)
      return new PrivateKeyError('writeFailed');
    return err;
  }

  private cmd(
    payload: Uint8Array,
    types: RespCode[],
    timeout = 5000,
    retries = 0,
  ): Promise<Uint8Array> {
    const attempt = () => this.sendCmd(payload, types, timeout);
    const { run, tail } = this.serialize(this.cmdChain, () =>
      this.attemptCmd(attempt, retries),
    );
    this.cmdChain = tail;
    return run;
  }

  // Runs one exchange, re-running it up to `retries` more times when it rejects
  // with a timeout. A timeout is the one transient worth retrying — a device
  // ERR is a definitive answer, and a closed transport fails fast (see
  // `sendCmd`), so re-requesting either just doubles the wait. The single home
  // for the timeout-retry policy: callers opt in with `cmd`'s `retries` arg
  // instead of hand-rolling their own loop.
  private async attemptCmd(
    attempt: () => Promise<Uint8Array>,
    retries: number,
  ): Promise<Uint8Array> {
    for (let left = retries; ; left--) {
      try {
        return await attempt();
      } catch (err) {
        if (left <= 0 || !(err as { timeout?: boolean }).timeout) throw err;
      }
    }
  }

  // Performs one command/response exchange: registers a pending handler, arms
  // the timeout, and writes the payload. Always call through `cmd` so it stays
  // serialized.
  private sendCmd(
    payload: Uint8Array,
    types: RespCode[],
    timeout: number,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      // The chain may still hold commands that were queued before the link
      // dropped; fail them immediately rather than arming a timeout against a
      // dead transport (a closed BLE characteristic's write often never
      // rejects, so the handler would otherwise sit until its full timeout).
      if (this._closed) {
        reject(new Error('Transport closed'));
        return;
      }
      const h: PendingCmd = {
        types,
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.handlers.indexOf(h);
          if (i !== -1) this.handlers.splice(i, 1);
          const err: Error & { timeout?: true } = new Error(
            `Timeout waiting for 0x${types[0].toString(16)}`,
          );
          err.timeout = true;
          reject(err);
        }, timeout),
      };
      this.handlers.push(h);
      this.transport.send(payload).catch((err: Error) => {
        const i = this.handlers.indexOf(h);
        if (i !== -1) this.handlers.splice(i, 1);
        clearTimeout(h.timer);
        reject(err);
      });
    });
  }

  private resolveHandler(type: RespCode, d: Uint8Array): boolean {
    const i = this.handlers.findIndex(
      // Match explicit type, or treat ERR as a wildcard rejection for any
      // pending handler.
      // Do NOT wildcard OK — it's already listed explicitly in types arrays
      // that expect it.
      (h) =>
        h.types.includes(type) || (type === RESP.ERR && h.types.length > 0),
    );
    if (i === -1) return false;
    const h = this.handlers.splice(i, 1)[0];
    clearTimeout(h.timer);
    if (type === RESP.ERR) {
      const err: Error & { code?: number } = new Error(
        `Device error code ${d[1]}`,
      );
      err.code = d[1];
      h.reject(err);
    } else h.resolve(d);
    return true;
  }

  private handleFrame(d: Uint8Array): void {
    if (!d.length) return;
    const type = d[0];

    if (type === RESP.PUSH_MSG_WAITING) {
      this.pollMessages();
      return;
    }
    if (type === RESP.PUSH_SEND_CONFIRMED) {
      const ack = parseSendConfirmed(d);
      if (ack) this.callbacks.onAck?.(ack.ackCode, ack.roundTripMs);
      return;
    }
    if (type === RESP.PUSH_PATH_UPDATED || type === RESP.PUSH_ADVERT) {
      // The mesh found (or lost) a route to a contact, or a known node
      // re-advertised (0x80 carries only the 32-byte pubkey) — refresh the
      // heard timestamp and re-sync contact data, coalescing bursts.
      if (type === RESP.PUSH_ADVERT && d.length >= 7) this.touchAdvert(d);
      this.scheduleContactResync();
      return;
    }
    if (type === RESP.PUSH_NEW_ADVERT) {
      // A newly heard node; payload matches the CONTACT response layout. Record
      // it in the heard-adverts list and let the debounced re-sync pull the
      // authoritative contact table (the radio may or may not have auto-added
      // it).
      const c = parseContact(d);
      if (c) {
        // This push *is* the sighting and it carries the node's own timestamp,
        // so both clocks are already in hand for one advert — no resync
        // pairing needed, and the measurement is proven by construction.
        this.recordAdvert(c, {
          at: Math.floor(Date.now() / 1000),
          measure: true,
        });
        this.scheduleContactResync();
      }
      return;
    }
    if (type === RESP.PUSH_CONTACT_DELETED && d.length >= 7) {
      // The radio evicted this contact to make room for a newly heard node.
      // Its advert entry stays: the node is still on the air, so the map keeps
      // showing it and the user can add it back.
      const prefix = toHex(d.slice(1, 7));
      if (this.contacts[prefix]) {
        delete this.contacts[prefix];
        this.callbacks.onContactsUpdated?.(this.contacts);
      }
      return;
    }
    if (type === RESP.PUSH_CONTACTS_FULL) {
      const now = Date.now();
      if (
        now - this.contactsFullNotifiedAt >=
        CONTACTS_FULL_NOTIFY_INTERVAL_MS
      ) {
        this.contactsFullNotifiedAt = now;
        this.callbacks.onContactsFull?.();
      }
      return;
    }
    if (type === RESP.PUSH_LOG_RX_DATA) {
      const pkt = parseLogRxData(d);
      if (pkt) this.callbacks.onLogRx?.(pkt);
      return;
    }
    if (type === RESP.PUSH_LOGIN_SUCCESS) {
      // A repeater/room-server accepted a login; match the pending request by
      // its pubkey prefix and resolve it with the server-granted access level.
      // Pushes with no matching waiter are dropped.
      const login = parseLoginPush(d);
      if (login)
        this.settlePush(this.loginWaiters, login.pubkeyPrefix, login.access);
      return;
    }
    if (type === RESP.PUSH_STATUS_RESPONSE) {
      // A repeater answered a status request; resolve the matching waiter with
      // its parsed stats.
      const status = parseStatusResponse(d);
      if (status)
        this.settlePush(this.statusWaiters, status.pubkeyPrefix, status);
      return;
    }
    if (type === RESP.PUSH_TELEMETRY_RESPONSE) {
      // A node answered a telemetry request; resolve the matching waiter with
      // its decoded readings.
      const telemetry = parseTelemetryResponse(d);
      if (telemetry)
        this.settlePush(
          this.telemetryWaiters,
          telemetry.pubkeyPrefix,
          telemetry,
        );
      return;
    }
    if (type === RESP.PUSH_BINARY_RESPONSE) {
      // A node answered a structured request. The tag names the exact request,
      // so a response nobody is waiting on is either a duplicate or one whose
      // requester has not resumed from its SENT receipt yet — hold the latter
      // case in the orphan slot for `runBinaryRequest` to claim.
      const res = parseBinaryResponse(d);
      if (res) {
        if (this.binaryWaiters.has(res.tag)) {
          this.settlePush(this.binaryWaiters, res.tag, res.data);
        } else {
          this.stashOrphanBinaryResponse(res.tag, res.data);
        }
      }
      return;
    }

    if (this.collectingContacts) {
      if (type === RESP.CONTACTS_START) {
        this.contactsStarted = true;
        this.rearmContactsIdle?.();
        // Bytes 1-4: uint32 LE total contact count
        this.contactsTotal =
          d.length >= 5
            ? new DataView(d.buffer, d.byteOffset).getUint32(1, true)
            : 0;
        this.contactsSeen = 0;
        this.pendingContacts = {};
        return;
      }
      if (type === RESP.CONTACT && this.contactsStarted) {
        this.rearmContactsIdle?.();
        const c = parseContact(d);
        if (c && this.pendingContacts) this.pendingContacts[c.pubkeyPrefix] = c;
        this.contactsSeen++;
        if (this.contactsTotal > 0) {
          const frac = Math.min(1, this.contactsSeen / this.contactsTotal);
          this.reportSync(
            'contacts',
            10 + 35 * frac,
            this.contactsSeen,
            this.contactsTotal,
          );
        }
        return;
      }
      if (type === RESP.END_OF_CONTACTS) {
        this.collectingContacts = false;
        // A complete enumeration is authoritative, so it replaces the table —
        // contacts deleted on the radio (evicted, or removed from another
        // client) disappear instead of lingering for the session.
        if (this.pendingContacts) this.contacts = this.pendingContacts;
        this.foldAdvertObservations();
        this.contactsResolve?.();
        return;
      }
    }

    if (type === RESP.SELF_INFO) {
      this.selfInfo = parseSelfInfo(d);
      this.callbacks.onSelfInfo?.(this.selfInfo);
    }
    if (type === RESP.DEVICE_INFO) {
      this.deviceInfo = parseDeviceInfo(d);
      this.callbacks.onDeviceInfo?.(this.deviceInfo);
    }
    if (type === RESP.BATT_AND_STORAGE) {
      const b = parseBattAndStorage(d);
      this.callbacks.onBattery?.(b);
    }
    if (type === RESP.CHANNEL_INFO) {
      const ch = parseChannelInfo(d);
      if (ch) {
        // A free slot answers with an empty name and a zeroed secret (that's
        // also how a channel is removed), so drop it from the mirror instead of
        // listing a channel the radio doesn't have.
        if (ch.name || ch.secret?.some((b) => b !== 0)) {
          this.channels[ch.idx] = ch;
        } else {
          delete this.channels[ch.idx];
        }
        this.callbacks.onChannelsUpdated?.(this.channels);
      }
    }

    if (type === RESP.CHANNEL_MSG || type === RESP.CHANNEL_MSG_V3) {
      const parsed =
        type === RESP.CHANNEL_MSG ? parseChannelMsg(d) : parseChannelMsgV3(d);
      if (parsed) this.callbacks.onMessage?.({ kind: 'channel', ...parsed });
    }
    if (type === RESP.CONTACT_MSG || type === RESP.CONTACT_MSG_V3) {
      const parsed =
        type === RESP.CONTACT_MSG ? parseContactMsg(d) : parseContactMsgV3(d);
      if (parsed) {
        if (parsed.txtType === TXT_TYPE.CLI_DATA) {
          // Remote-admin console output — keep it out of chat history. The
          // sender's key prefix is the only thing tying a reply to the request
          // that asked for it, so a frame without one cannot be routed and is
          // dropped rather than delivered under an empty key, where it would
          // silently match nothing.
          if (parsed.pubkeyPrefix) {
            this.callbacks.onCliReply?.({
              pubkeyPrefix: parsed.pubkeyPrefix,
              text: parsed.text,
            });
          }
        } else {
          this.callbacks.onMessage?.({ kind: 'direct', ...parsed });
        }
      }
    }

    this.resolveHandler(type, d);
  }

  private scheduleContactResync(): void {
    this.pathSyncTimer ??= setTimeout(() => {
      this.pathSyncTimer = null;
      if (!this.collectingContacts) this.syncContacts();
    }, 2000);
  }

  /**
   * Folds a contact-shaped advert record into the heard-adverts map.
   *
   * @param observation - the live sighting this record came from, when there
   * was one. `at` is our clock at the push; a stamp older than
   * {@link ADVERT_OBSERVATION_WINDOW_SECS} belongs to an earlier advert and is
   * dropped. `measure` says whether `c.lastAdvert` is known to be the *same*
   * advert we heard at `at` — only then are both clocks known for one advert,
   * which is what makes "how far off is this node's clock" a fact distinct
   * from "how old is this sighting". Pairing our clock with a contact row that
   * has not moved would invent a skew the size of the gap between two adverts,
   * so an unproven pairing records the sighting and leaves the skew alone.
   */
  private recordAdvert(
    c: Contact,
    observation?: { at: number; measure: boolean },
  ): void {
    const nowSecs = Math.floor(Date.now() / 1000);
    const existing = this.adverts[c.pubkeyPrefix];
    const lastHeard = c.lastAdvert ?? nowSecs;
    const observed =
      observation !== undefined &&
      nowSecs - observation.at <= ADVERT_OBSERVATION_WINDOW_SECS
        ? observation
        : undefined;
    this.adverts[c.pubkeyPrefix] = {
      pubkey: c.pubkey,
      pubkeyPrefix: c.pubkeyPrefix,
      name: c.name,
      advType: c.advType,
      lastHeard,
      advLat: c.advLat,
      advLon: c.advLon,
      observedAt: observed?.at ?? existing?.observedAt,
      // Skew is a property of the node's badly-set clock, not of one advert,
      // so a measurement outlives the observation that produced it and keeps
      // normalizing later contact-table reads.
      clockSkewSecs:
        observed?.measure === true
          ? lastHeard - observed.at
          : existing?.clockSkewSecs,
    };
    this.evictOldAdverts();
    this.callbacks.onAdvertsUpdated?.(this.adverts);
  }

  private evictOldAdverts(): void {
    const entries = Object.values(this.adverts);
    if (entries.length <= ADVERTS_LIMIT) return;
    const kept = new Set(
      sortAdvertsByHeard(entries)
        .slice(0, ADVERTS_LIMIT)
        .map((a) => a.pubkeyPrefix),
    );
    for (const key of Object.keys(this.adverts)) {
      if (!kept.has(key)) delete this.adverts[key];
    }
  }

  // A known node re-advertised. The 0x80 push carries only the pubkey, so the
  // matching sender timestamp arrives with the contact resync this schedules —
  // hold our clock until then rather than writing it over `lastHeard`, which
  // is what used to leave the two facts indistinguishable.
  private touchAdvert(d: Uint8Array): void {
    const prefix = toHex(d.slice(1, 7));
    const nowSecs = Math.floor(Date.now() / 1000);
    // Kept whether or not this node has an advert record yet: a saved contact
    // that has never been in the cache still gets its skew measured, by the
    // fold that creates the record from the contact row.
    this.advertObservations[prefix] = nowSecs;
    const existing = this.adverts[prefix];
    if (existing) {
      this.adverts[prefix] = { ...existing, observedAt: nowSecs };
      this.callbacks.onAdvertsUpdated?.(this.adverts);
    }
  }

  // Pairs each pending live-push observation with the contact row the resync
  // just delivered, which carries that advert's sender timestamp. Both clocks
  // for one advert are known only here, so this is where skew is measured.
  // Entries that no contact row answered, or that have aged past the window,
  // are dropped rather than left to measure a later advert.
  private foldAdvertObservations(): void {
    const nowSecs = Math.floor(Date.now() / 1000);
    for (const [prefix, observedAt] of Object.entries(
      this.advertObservations,
    )) {
      const contact = this.contacts[prefix];
      if (contact?.lastAdvert) {
        delete this.advertObservations[prefix];
        // `scheduleContactResync` drops its resync when a sync is already in
        // flight, so this enumeration may have started *before* the push and
        // be carrying the previous advert's timestamp. A row whose claim has
        // moved past what we already hold can only be the advert we just
        // heard; an unchanged one proves nothing, so record the sighting but
        // leave the skew to a later, provable pairing.
        const known = this.adverts[prefix]?.lastHeard;
        const measure = known !== undefined && contact.lastAdvert > known;
        this.recordAdvert(contact, { at: observedAt, measure });
      } else if (nowSecs - observedAt > ADVERT_OBSERVATION_WINDOW_SECS) {
        delete this.advertObservations[prefix];
      }
    }
  }

  private async syncContacts(): Promise<void> {
    this.collectingContacts = true;
    this.contactsStarted = false;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timer);
        this.collectingContacts = false;
        this.pendingContacts = null;
        this.rearmContactsIdle = null;
        this.contactsResolve = null;
        resolve();
      };
      // Re-armed on every CONTACTS_START/CONTACT frame (see handleFrame), so
      // the whole table streams in regardless of size; only a stall aborts.
      this.rearmContactsIdle = () => {
        clearTimeout(timer);
        timer = setTimeout(finish, CONTACTS_IDLE_TIMEOUT_MS);
      };
      this.contactsResolve = finish;
      this.rearmContactsIdle();
      // This write bypasses the serialized `cmd` chain, so guard it: a failed
      // initial GetContacts (a dropped link or a GATT collision) must end
      // collection here instead of hanging on the idle timeout or surfacing as
      // an unhandled rejection.
      this.transport.send(buildGetContacts(0)).catch(() => finish());
    });
    this.callbacks.onContactsUpdated?.(this.contacts);
  }

  private async syncChannels(): Promise<void> {
    const slots = this.deviceInfo?.maxChannels || MAX_CHANNEL_SLOTS;
    for (let i = 0; i < slots; i++) {
      this.reportSync('channels', 45 + (30 * i) / slots, i + 1, slots);
      try {
        await this.cmd(buildGetChannelInfo(i), [RESP.CHANNEL_INFO], 2000);
      } catch {}
    }
    this.callbacks.onChannelsUpdated?.(this.channels);
  }

  // Probes the radio's hardware capabilities via CMD_GET_CUSTOM_VARS and folds
  // the result into deviceInfo. A GPS-equipped radio lists a `gps` sensor
  // setting (boards without one list none), whose value (`1`/`0`) is the live
  // GPS enable — the radio's location *source*. Both feed Settings: `hasGps`
  // gates whether the GPS source is offered, `gpsEnabled` reflects the current
  // choice. Fires onDeviceInfo again so Settings updates once it's known.
  private async syncDeviceCapabilities(): Promise<void> {
    const d = await this.cmd(buildGetCustomVars(), [RESP.CUSTOM_VARS], 5000);
    const vars = parseCustomVars(d);
    const hasGps = 'gps' in vars;
    if (this.deviceInfo) {
      this.deviceInfo = {
        ...this.deviceInfo,
        hasGps,
        gpsEnabled: hasGps ? vars.gps === '1' : undefined,
      };
      this.callbacks.onDeviceInfo?.(this.deviceInfo);
    }
  }

  // Best-effort device clock sync: read the radio's clock and, if it has
  // drifted past CLOCK_SKEW_THRESHOLD_SECS from the browser, correct it. A
  // radio that rejects GET_DEVICE_TIME (older firmware) returns null and is
  // left untouched; a transient read failure throws and is swallowed upstream.
  private async syncClock(): Promise<void> {
    const deviceSecs = await this.getDeviceTime();
    if (deviceSecs === null) return;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (Math.abs(deviceSecs - nowSecs) > CLOCK_SKEW_THRESHOLD_SECS) {
      await this.setDeviceTime(nowSecs);
    }
  }

  private async pollMessages(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const msgTypes = [
      RESP.CHANNEL_MSG,
      RESP.CHANNEL_MSG_V3,
      RESP.CONTACT_MSG,
      RESP.CONTACT_MSG_V3,
      // Group datagrams share the offline queue with text messages. Nothing
      // consumes them here, but they must be accepted or the drain stalls on a
      // timeout and leaves real messages queued behind them.
      RESP.CHANNEL_DATA_RECV,
      RESP.NO_MORE_MESSAGES,
    ];
    try {
      for (let i = 0; i < 64; i++) {
        // Queue depth is unknown ahead of time — creep toward the end of the
        // bar
        this.reportSync('messages', Math.min(99, 75 + i * 2), i);
        const d = await this.cmd(buildSyncNextMessage(), msgTypes, 3000);
        if (d[0] === RESP.NO_MORE_MESSAGES) break;
      }
    } catch {}
    this.polling = false;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Sends a text message to a channel slot. */
  async sendChannelMessage(channelIdx: number, text: string): Promise<void> {
    await this.cmd(
      buildSendChannelMsg(channelIdx, text),
      [RESP.SENT, RESP.OK],
      10000,
    );
  }

  /**
   * Sends a direct message to a contact.
   *
   * @param attempt - retry counter, passed through to vary routing on resends.
   * @returns the send receipt (flood flag, expected ack, suggested timeout)
   * when the radio replies `SENT`, or null if it only acked `OK`.
   */
  async sendDirectMessage(
    contact: Contact,
    text: string,
    attempt = 0,
  ): Promise<SendReceipt | null> {
    const prefix = contact.pubkeyBytes.slice(0, 6);
    const d = await this.cmd(
      buildSendDirectMsg(prefix, text, attempt),
      [RESP.SENT, RESP.OK],
      10000,
    );
    return d[0] === RESP.SENT ? parseMsgSent(d) : null;
  }

  /**
   * Logs in to a repeater or room server for remote administration.
   *
   * @remarks
   * Two-stage handshake: the radio first replies `SENT` (carrying an estimated
   * round-trip timeout), then the target node's acceptance arrives later as an
   * unsolicited `PUSH_LOGIN_SUCCESS` matched by pubkey prefix. The wait for
   * that push is derived from the `SENT` receipt (which can be several seconds
   * over a multi-hop path), not the fixed command timeout. An empty password is
   * a valid guest login.
   * @returns the access level the server granted, decoded from the success
   * push — the server decides this from the password, so it is authoritative.
   * `null` when the response is a legacy `"OK"` that cannot report the role, in
   * which case the caller falls back to the level it attempted.
   * @throws if the radio answers `ERR`, or no success push arrives in time (a
   * wrong password typically produces no response, so it surfaces as a
   * timeout).
   */
  async login(
    contact: Contact,
    password: string,
  ): Promise<RepeaterAccess | null> {
    return this.remoteRequest(
      this.loginWaiters,
      contact.pubkeyBytes,
      buildSendLogin(contact.pubkeyBytes, password),
    );
  }

  /**
   * Requests a repeater's live stats. Same `SENT` → async-push handshake as
   * {@link login} (requires a prior successful login), resolving the parsed
   * {@link RepeaterStatus} from `PUSH_STATUS_RESPONSE`.
   *
   * @throws if the radio answers `ERR`, or no status push arrives in time.
   */
  async requestStatus(contact: Contact): Promise<RepeaterStatus> {
    return this.remoteRequest(
      this.statusWaiters,
      contact.pubkeyBytes,
      buildSendStatusReq(contact.pubkeyBytes),
    );
  }

  /**
   * Requests a node's sensor telemetry. Same `SENT` → async-push handshake as
   * {@link requestStatus}, resolving the {@link NodeTelemetry} decoded from
   * `PUSH_TELEMETRY_RESPONSE`, but open to any node — no login required.
   *
   * @remarks The target's own `telemetry_mode` permissions decide what it
   * discloses, so a successful request can still resolve with no readings.
   * @throws if the radio answers `ERR`, or no telemetry push arrives in time.
   */
  async requestTelemetry(contact: Contact): Promise<NodeTelemetry> {
    return this.remoteRequest(
      this.telemetryWaiters,
      contact.pubkeyBytes,
      buildSendTelemetryReq(contact.pubkeyBytes),
    );
  }

  /**
   * Whether this radio has already rejected {@link CMD.SEND_BINARY_REQ} as an
   * unknown command. Lets a caller with a fallback path take it directly
   * instead of re-learning the same answer one round trip at a time.
   *
   * @remarks Only ever set by a rejection actually seen, so it is `false` until
   * a structured request has been attempted — never a prediction from a version
   * number.
   */
  get binaryRequestsUnsupported(): boolean {
    return this.binaryReqUnsupported;
  }

  /**
   * Reads one page of a repeater's neighbor table over a structured
   * `GET_NEIGHBOURS` request — the binary path that replaces scraping the
   * `neighbors` CLI reply, whose rows the firmware truncates to fit one
   * 160-byte text message.
   *
   * @remarks
   * Requires a prior {@link login}, but **not** an admin one: unlike the
   * `neighbors` CLI command it replaces, the firmware's `GET_NEIGHBOURS`
   * handler has no `isAdmin()` check, so any authenticated session may call it.
   * (The app still gates its Neighbors tab on admin, an assumption inherited
   * from the CLI path.) The returned `total` counts the repeater's whole table,
   * so a caller pages by re-requesting with a larger `offset` until it has that
   * many rows.
   * @throws on a timeout, which is also how firmware with no `GET_NEIGHBOURS`
   * handler answers — it returns an empty reply that the companion radio never
   * pushes. A local radio too old to know `SEND_BINARY_REQ` rejects it sooner,
   * with a device error carrying {@link ERR_CODE.UNSUPPORTED_CMD}.
   */
  async requestNeighbors(
    contact: Contact,
    query: NeighborsQuery,
  ): Promise<NeighborsPage> {
    const data = await this.binaryRequest(
      buildGetNeighborsReq(contact.pubkeyBytes, query),
    );
    const page = parseNeighborsResponse(data);
    if (!page) throw new Error('Malformed GET_NEIGHBOURS response');
    return page;
  }

  /**
   * Reads a repeater's or room server's access control list — which clients
   * may administer it.
   *
   * @remarks
   * Requires a prior admin {@link login}: the firmware answers this request
   * only for `isAdmin()` senders, and a room server reports only its admin
   * entries where a repeater reports every role.
   * @returns every entry the node reported, and an empty array when it holds
   * none — a node with an empty list still replies, so that is a real answer
   * rather than the silence a timeout would raise on.
   * @throws on a timeout. It does *not* throw on a reply whose length is not a
   * multiple of the 7-byte entry: cipher padding makes that the normal case,
   * and `parseAccessList` drops it.
   */
  async requestAccessList(contact: Contact): Promise<AclEntry[]> {
    return parseAccessList(
      await this.binaryRequest(buildGetAccessListReq(contact.pubkeyBytes)),
    );
  }

  /**
   * Sends a remote-admin CLI command to a repeater or room server. The command
   * travels as a direct message tagged {@link TXT_TYPE.CLI_DATA}; the reply
   * arrives asynchronously and is delivered via
   * {@link MeshCoreCallbacks.onCliReply}, never the chat stream.
   *
   * @returns the send receipt (carrying the radio's estimated round-trip
   * timeout) when the radio replies `SENT`, or `null` if it only acked `OK`.
   * The caller uses the estimate to wait long enough for the CLI reply over a
   * multi-hop path instead of a fixed budget.
   */
  async sendCliCommand(
    contact: Contact,
    command: string,
  ): Promise<SendReceipt | null> {
    const prefix = contact.pubkeyBytes.slice(0, 6);
    const d = await this.cmd(
      buildSendDirectMsg(prefix, command, 0, TXT_TYPE.CLI_DATA),
      [RESP.SENT, RESP.OK],
      10000,
    );
    return d[0] === RESP.SENT ? parseMsgSent(d) : null;
  }

  /**
   * Clears a contact's route locally and on the radio so its next message
   * floods to rediscover a path.
   */
  async resetPath(contact: Contact): Promise<void> {
    await this.cmd(buildResetPath(contact.pubkeyBytes), [RESP.OK], 5000);
    const c = this.contacts[contact.pubkeyPrefix];
    if (c) {
      this.contacts[contact.pubkeyPrefix] = {
        ...c,
        outPathLen: 255,
        path: new Uint8Array(0),
      };
      this.callbacks.onContactsUpdated?.(this.contacts);
    }
  }

  /**
   * Sets or clears a contact's favorite flag (bit 0 of {@link Contact.flags})
   * and re-sends it.
   */
  async setFavorite(contact: Contact, fav: boolean): Promise<void> {
    const flags = fav
      ? contact.flags | FAVORITE_FLAG
      : contact.flags & ~FAVORITE_FLAG;
    const updated = { ...contact, flags };
    await this.cmd(buildAddOrUpdateContact(updated), [RESP.OK], 5000);
    this.contacts[contact.pubkeyPrefix] = updated;
    this.callbacks.onContactsUpdated?.(this.contacts);
  }

  /**
   * Adds a discovered node as a contact (creates it on the radio if unknown).
   */
  async addContact(contact: Contact): Promise<void> {
    await this.cmd(buildAddOrUpdateContact(contact), [RESP.OK], 5000);
    this.contacts[contact.pubkeyPrefix] = contact;
    this.callbacks.onContactsUpdated?.(this.contacts);
  }

  /**
   * Shares a contact by having the radio zero-hop re-broadcast that contact's
   * original advert, letting direct neighbors hear and add it.
   */
  async shareContact(contact: Contact): Promise<void> {
    await this.cmd(buildShareContact(contact.pubkeyBytes), [RESP.OK], 5000);
  }

  /**
   * Broadcasts this radio's own advert so other nodes can hear and add it.
   *
   * @param flood - `true` floods across the whole mesh (more airtime); `false`
   * sends a zero-hop advert heard only by direct neighbors.
   */
  async sendSelfAdvert(flood: boolean): Promise<void> {
    await this.cmd(buildSendSelfAdvert(flood), [RESP.OK], 5000);
  }

  /** Deletes a contact from the radio and the local mirror. */
  async removeContact(contact: Contact): Promise<void> {
    await this.cmd(buildRemoveContact(contact.pubkeyBytes), [RESP.OK], 5000);
    delete this.contacts[contact.pubkeyPrefix];
    this.callbacks.onContactsUpdated?.(this.contacts);
  }

  /**
   * Writes a channel slot (create, join, or restore).
   *
   * @param idx - channel slot index, 0 to the radio's channel count minus 1.
   * @param secret - 16-byte channel secret.
   */
  async setChannel(
    idx: number,
    name: string,
    secret: Uint8Array,
  ): Promise<void> {
    await this.cmd(buildSetChannel(idx, name, secret), [RESP.OK], 5000);
    this.channels[idx] = { idx, name, secret };
    this.callbacks.onChannelsUpdated?.(this.channels);
  }

  /**
   * Removes a channel slot by clearing its name and secret. Every slot is
   * removable — including the one holding the Public channel, which the radio
   * treats like any other channel and which can be restored later.
   *
   * @remarks Coalesces with a removal already in flight for the same slot, so
   * the pending flag can't be cleared by the first call while a second clear is
   * still queued.
   */
  async removeChannel(idx: number): Promise<void> {
    if (this.pendingRemovals.has(idx)) return;
    this.pendingRemovals.add(idx);
    try {
      await this.cmd(
        buildSetChannel(idx, '', new Uint8Array(16)),
        [RESP.OK],
        5000,
      );
      delete this.channels[idx];
      this.callbacks.onChannelsUpdated?.(this.channels);
    } finally {
      this.pendingRemovals.delete(idx);
    }
  }

  /**
   * Whether a slot's removal is in flight — its mirror entry still exists but
   * the radio is about to clear it, so nothing may be transmitted on it.
   */
  isRemovingChannel(idx: number): boolean {
    return this.pendingRemovals.has(idx);
  }

  /**
   * Renames this radio (`SET_ADVERT_NAME`). On success, updates the local
   * `selfInfo` mirror and fires {@link MeshCoreCallbacks.onSelfInfo} so the
   * header and Settings reflect the new name immediately; peers learn it on the
   * radio's next advert.
   */
  async setNodeName(name: string): Promise<void> {
    await this.cmd(buildSetAdvertName(name), [RESP.OK], 5000);
    if (this.selfInfo) {
      this.selfInfo = { ...this.selfInfo, name };
      this.callbacks.onSelfInfo?.(this.selfInfo);
    }
  }

  /**
   * Sets the core LoRa parameters (`SET_RADIO_PARAMS`: frequency, bandwidth,
   * spreading factor, coding rate). On success, updates the local `selfInfo`
   * mirror with the applied values and fires
   * {@link MeshCoreCallbacks.onSelfInfo} so Settings reflects them immediately
   * — the firmware has no clean re-read of `SELF_INFO`, so the echoed values
   * are trusted.
   *
   * @throws if the radio rejects the values (`ERR` — e.g. out of the accepted
   * range) or the command times out, so the caller can surface the failure
   * without overwriting the displayed values.
   */
  async setRadioParams(
    freqMhz: number,
    bwKhz: number,
    sf: number,
    cr: number,
  ): Promise<void> {
    await this.cmd(
      buildSetRadioParams(freqMhz, bwKhz, sf, cr),
      [RESP.OK],
      5000,
    );
    if (this.selfInfo) {
      this.selfInfo = {
        ...this.selfInfo,
        radioFreq: freqMhz,
        radioBw: bwKhz,
        radioSf: sf,
        radioCr: cr,
      };
      this.callbacks.onSelfInfo?.(this.selfInfo);
    }
  }

  /**
   * Sets the transmit power (`SET_TX_POWER`). On success, updates the local
   * `selfInfo` mirror and fires {@link MeshCoreCallbacks.onSelfInfo}.
   *
   * @param dbm - TX power in dBm; the firmware rejects values outside
   * `[-9, maxTxPower]`.
   * @throws if the radio rejects the value or the command times out.
   */
  async setTxPower(dbm: number): Promise<void> {
    await this.cmd(buildSetTxPower(dbm), [RESP.OK], 5000);
    if (this.selfInfo) {
      this.selfInfo = { ...this.selfInfo, txPower: dbm };
      this.callbacks.onSelfInfo?.(this.selfInfo);
    }
  }

  /**
   * Sets this radio's advertised location (`SET_ADVERT_LATLON`). On success,
   * updates the local `selfInfo` mirror (in decimal degrees, matching
   * {@link parseSelfInfo}) and fires {@link MeshCoreCallbacks.onSelfInfo} so
   * Settings and the map reflect it immediately; peers learn it on the radio's
   * next advert.
   *
   * @param latDeg - latitude in decimal degrees; the firmware rejects values
   * outside ±90°.
   * @param lonDeg - longitude in decimal degrees; the firmware rejects values
   * outside ±180°.
   * @throws if the radio rejects the coordinate (`ERR`) or the command times
   * out, so the caller can surface the failure without overwriting the shown
   * values.
   */
  async setLocation(latDeg: number, lonDeg: number): Promise<void> {
    await this.cmd(buildSetAdvertLatLon(latDeg, lonDeg), [RESP.OK], 5000);
    if (this.selfInfo) {
      this.selfInfo = { ...this.selfInfo, advLat: latDeg, advLon: lonDeg };
      this.callbacks.onSelfInfo?.(this.selfInfo);
    }
  }

  /**
   * Sets this radio's advert location policy — where (if anywhere) its adverts
   * take their coordinate from.
   *
   * @param policy - one of the `ADVERT_LOC_POLICY` values: `NONE` (attach
   * nothing), `PREFS` (the fixed coordinate set via {@link setLocation}), or
   * `SHARE` (the live fix from the radio's own GPS module, on GPS-capable
   * hardware).
   * @remarks The current `manual_add`, `telemetry_mode`, and `multi_acks` prefs
   * are echoed back so only the location policy changes.
   */
  async setLocationPolicy(policy: number): Promise<void> {
    const info = this.selfInfo;
    // SET_OTHER_PARAMS is positional: the location policy (byte 3) can only be
    // reached by resending the earlier prefs. If this radio's SELF_INFO was too
    // short to report them, sending 0 would silently reset the user's other
    // settings — refuse rather than clobber them.
    if (
      info?.manualAdd === undefined ||
      info.telemetryMode === undefined ||
      info.multiAcks === undefined
    ) {
      throw new Error('Radio did not report the prefs needed to change this');
    }
    await this.cmd(
      buildSetAdvertLocPolicy(
        info.manualAdd,
        info.telemetryMode,
        policy,
        info.multiAcks,
      ),
      [RESP.OK],
      5000,
    );
    this.selfInfo = { ...info, advLocPolicy: policy };
    this.callbacks.onSelfInfo?.(this.selfInfo);
  }

  /**
   * Enables or disables the radio's GPS module (`SET_CUSTOM_VAR` `gps`) — the
   * radio's advert location *source*. Enabled attaches the live GPS fix,
   * disabled attaches the fixed coordinate set via {@link setLocation}. Mirrors
   * the official app's Position Settings → GPS Mode. On success, updates the
   * local `deviceInfo` mirror and fires {@link MeshCoreCallbacks.onDeviceInfo}
   * so Settings reflects it immediately.
   *
   * @param enabled - whether the GPS module should be on.
   * @throws if the radio rejects the write (`ERR`) or the command times out.
   */
  async setGpsEnabled(enabled: boolean): Promise<void> {
    await this.cmd(
      buildSetCustomVar('gps', enabled ? '1' : '0'),
      [RESP.OK],
      5000,
    );
    if (this.deviceInfo) {
      this.deviceInfo = { ...this.deviceInfo, gpsEnabled: enabled };
      this.callbacks.onDeviceInfo?.(this.deviceInfo);
    }
  }

  /**
   * Re-reads this radio's `SELF_INFO` by re-issuing `APP_START`. The frame
   * handler parses the reply, refreshes the local `selfInfo` mirror, and fires
   * {@link MeshCoreCallbacks.onSelfInfo}. Used after switching the location
   * source (Fixed↔GPS): the newly-active advertised coordinate — a GPS module's
   * live fix, say — is only observable on a fresh read, so unlike a written
   * value it can't be echoed back optimistically.
   *
   * @throws if the radio doesn't answer with `SELF_INFO` before the timeout.
   */
  async refreshSelfInfo(): Promise<void> {
    await this.cmd(buildAppStart(), [RESP.SELF_INFO], 5000);
  }

  /**
   * Writes the auto-add preferences to the radio (`SET_OTHER_PARAMS` for the
   * mode, then `SET_AUTOADD_CONFIG` for the filter + hop limit).
   *
   * @remarks The hop count is converted to the radio's hop+1 encoding here; see
   * {@link readAutoAddBits} for the inverse.
   */
  async setAutoAddPrefs(cfg: AutoAddConfig): Promise<void> {
    const manual = cfg.mode === 'all' ? MANUAL_ADD_OFF : MANUAL_ADD_ON;
    await this.cmd(buildSetOtherParams(manual), [RESP.OK], 5000);
    // Always write the config: overwrite-oldest and max-hops apply in both
    // modes, and persisting the type bits in 'all' mode keeps the user's
    // selection remembered when they switch back to 'selected'.
    let bits = 0;
    if (cfg.chat) bits |= AUTOADD.CHAT;
    if (cfg.repeater) bits |= AUTOADD.REPEATER;
    if (cfg.room) bits |= AUTOADD.ROOM;
    if (cfg.sensor) bits |= AUTOADD.SENSOR;
    if (cfg.overwriteOldest) bits |= AUTOADD.OVERWRITE_OLDEST;
    // Convert the displayed hop count back to the radio's hop+1 encoding
    // (clamped to the firmware's 64 ceiling). The "no limit" sentinel maps to
    // raw 0, which the firmware reads as unlimited.
    const rawHops =
      cfg.maxHops >= MAX_HOPS_NO_LIMIT ? 0 : Math.min(cfg.maxHops + 1, 64);
    await this.cmd(buildSetAutoAddConfig(bits, rawHops), [RESP.OK], 5000);
  }

  /**
   * Reads the radio's Ed25519 private key for an identity backup
   * (`EXPORT_PRIVATE_KEY`).
   *
   * @returns the raw {@link PRIVATE_KEY_BYTES}-byte key. The caller is
   * responsible for it: write it straight into the passphrase-encrypted backup
   * and zero the array — it must never reach the store, the DOM, or a log.
   * @throws PrivateKeyError with `disabled` when the build has
   * `ENABLE_PRIVATE_KEY_EXPORT` unset, or `unsupported` on firmware predating
   * the command. Other device errors, timeouts, and transport failures
   * propagate unchanged.
   */
  async exportPrivateKey(): Promise<Uint8Array> {
    let d: Uint8Array;
    try {
      d = await this.cmd(
        buildExportPrivateKey(),
        [RESP.PRIVATE_KEY, RESP.DISABLED],
        5000,
      );
    } catch (err) {
      throw MeshCoreClient.privateKeyError(err);
    }
    if (d[0] === RESP.DISABLED) throw new PrivateKeyError('disabled');
    try {
      // `parsePrivateKey` copies the key out, so the response frame is a second
      // readable copy of the identity. Zero it on every path — including the
      // malformed-frame one — rather than leaving it resident until GC.
      const key = parsePrivateKey(d);
      if (!key) throw new PrivateKeyError('unsupported');
      return key;
    } finally {
      d.fill(0);
    }
  }

  /**
   * Replaces the radio's Ed25519 identity from a backup
   * (`IMPORT_PRIVATE_KEY`). The radio rewrites its stored identity and reloads
   * contacts to invalidate their cached ECDH shared secrets; it needs a reboot
   * before the new identity is fully in effect, which this method does not
   * perform.
   *
   * @param prvKey - the {@link PRIVATE_KEY_BYTES}-byte key from a backup.
   * @throws PrivateKeyError with `disabled`, `unsupported`, `rejected` (the
   * radio failed `validatePrivateKey`), or `writeFailed` (the radio could not
   * persist it). Timeouts and transport failures propagate unchanged.
   */
  async importPrivateKey(prvKey: Uint8Array): Promise<void> {
    // The command frame is a second copy of the identity, and the command chain
    // holds the closure that captured it until the next command displaces it —
    // so it is kept in a local and zeroed once the exchange has settled, rather
    // than being left to GC.
    const frame = buildImportPrivateKey(prvKey);
    let d: Uint8Array;
    try {
      d = await this.cmd(frame, [RESP.OK, RESP.DISABLED], 10000);
    } catch (err) {
      throw MeshCoreClient.privateKeyError(err);
    } finally {
      frame.fill(0);
    }
    if (d[0] === RESP.DISABLED) throw new PrivateKeyError('disabled');
  }

  /**
   * Reboots the radio (`REBOOT`). The radio usually restarts before it can
   * reply, dropping the transport link as part of the command, so the command
   * resolving as a bare response timeout — or the link dropping first — is
   * treated as success. A device `ERR` (e.g. the firmware doesn't support the
   * command) or a transport/send failure is surfaced as a failure.
   * The dropped link then flows through {@link MeshCoreCallbacks.onDisconnect}
   * into the hook's auto-reconnect loop, which recovers the session once the
   * device comes back.
   */
  async reboot(): Promise<void> {
    try {
      await this.cmd(buildReboot(), [RESP.OK], 1000);
    } catch (err) {
      // Two outcomes are expected: a bare response timeout (the radio replied
      // too slowly) or the link dropping as the radio restarts, which rejects
      // the in-flight command with the tagged `transportClosed` error. Surface
      // everything else: a device ERR (numeric `code`) or a transport/send
      // failure means the reboot never took effect.
      const e = err as { timeout?: true; transportClosed?: true };
      if (!e.timeout && !e.transportClosed) throw err;
    }
  }

  /**
   * The auto-add mode, derived from the `manual_add` byte in the `APP_START`
   * handshake (so always available after {@link init}); undefined on older
   * firmware that omits it.
   */
  get manualAddMode(): 'all' | 'selected' | undefined {
    const m = this.selfInfo?.manualAdd;
    if (m === undefined) return undefined;
    return m === MANUAL_ADD_OFF ? 'all' : 'selected';
  }

  /**
   * Reads the auto-add filter and hop limit via `GET_AUTOADD_CONFIG`.
   *
   * @returns the type flags, overwrite-oldest flag, and display hop count, or
   * null when the device doesn't answer (older firmware lacks the command) — so
   * the caller can keep its existing values instead of clobbering them.
   * @remarks Converts the radio's hop+1 byte back to a display hop count.
   */
  async readAutoAddBits(): Promise<Pick<
    AutoAddConfig,
    'chat' | 'repeater' | 'room' | 'sensor' | 'overwriteOldest' | 'maxHops'
  > | null> {
    try {
      const d = await this.cmd(
        buildGetAutoAddConfig(),
        [RESP.AUTOADD_CONFIG],
        3000,
      );
      const { config, maxHops } = parseAutoAddConfig(d);
      return {
        chat: (config & AUTOADD.CHAT) !== 0,
        repeater: (config & AUTOADD.REPEATER) !== 0,
        room: (config & AUTOADD.ROOM) !== 0,
        sensor: (config & AUTOADD.SENSOR) !== 0,
        overwriteOldest: (config & AUTOADD.OVERWRITE_OLDEST) !== 0,
        // The radio stores hop+1 (raw 1 = direct/0 hops); the official app
        // shows the hop count, so subtract 1 to match. raw 0 = "no limit",
        // surfaced as the MAX_HOPS_NO_LIMIT sentinel so it round-trips.
        maxHops: maxHops === 0 ? MAX_HOPS_NO_LIMIT : maxHops - 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * Reads the radio's clock as Unix epoch seconds, or null if the device
   * rejects the request (older firmware lacks `GET_DEVICE_TIME`). A transient
   * timeout or transport drop is rethrown so callers can tell it apart from
   * genuinely-unsupported firmware; a short/malformed `CURR_TIME` frame is
   * likewise treated as an error rather than silently reported as unsupported.
   */
  async getDeviceTime(): Promise<number | null> {
    let secs: number | null;
    try {
      secs = parseCurrentTime(
        await this.cmd(buildGetDeviceTime(), [RESP.CURR_TIME], 3000, 1),
      );
    } catch (err) {
      // Only an ERR frame from `resolveHandler` carrying the explicit
      // `UNSUPPORTED_CMD` code means the firmware rejected the command — report
      // that as unsupported. Match its specific error shape (the `Device error
      // code` message it builds) so transport-layer failures (e.g. a
      // `DOMException` that also carries a numeric `code`) and timeouts
      // propagate as transient. Other ERR codes (e.g. `BAD_STATE`,
      // `ILLEGAL_ARG`) are device-state failures, also rethrown so they aren't
      // silently masked as "unsupported".
      if (
        err instanceof Error &&
        err.message.startsWith('Device error code ') &&
        (err as { code?: number }).code === ERR_CODE.UNSUPPORTED_CMD
      ) {
        return null;
      }
      throw err;
    }
    // A well-formed reply that fails to parse is a bad/transient response, not
    // an unsupported command — surface it so it can be retried/handled.
    if (secs === null) throw new Error('Malformed CURR_TIME frame');
    return secs;
  }

  /** Sets the radio's clock to the given Unix epoch seconds (UTC). */
  async setDeviceTime(epochSecs: number): Promise<void> {
    await this.cmd(buildSetDeviceTime(epochSecs), [RESP.OK], 5000);
  }

  /** Fetches battery and storage stats, or null if the request fails. */
  async getBattery(): Promise<BatteryInfo | null> {
    // One timeout retry (via cmd) so a single dropped read under load doesn't
    // intermittently blank the card.
    try {
      return parseBattAndStorage(
        await this.cmd(buildGetBattery(), [RESP.BATT_AND_STORAGE], 3000, 1),
      );
    } catch {
      return null;
    }
  }

  /**
   * Fetches all three `STATS` pages (core, radio, packets); each is omitted if
   * its request fails.
   */
  async getStats(): Promise<StatsResult> {
    return {
      core: await this.getStatsPage(0, parseStatsCore),
      radio: await this.getStatsPage(1, parseStatsRadio),
      packets: await this.getStatsPage(2, parseStatsPackets),
    };
  }

  // Requests one `STATS` page and parses it, retrying once on timeout (via cmd)
  // so a transient drop under load doesn't blank the card. Returns undefined if
  // the page times out, errors, or comes back malformed.
  private async getStatsPage<T>(
    subtype: number,
    parse: (d: Uint8Array) => T | null,
  ): Promise<T | undefined> {
    try {
      return (
        parse(await this.cmd(buildGetStats(subtype), [RESP.STATS], 3000, 1)) ??
        undefined
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Finds a contact by public-key prefix, tolerating either side being the
   * shorter prefix (incoming frames and stored contacts use different lengths).
   */
  lookupContact(pubkeyPrefix: string): Contact | undefined {
    return Object.values(this.contacts).find(
      (c) =>
        c.pubkeyPrefix.startsWith(pubkeyPrefix) ||
        pubkeyPrefix.startsWith(c.pubkeyPrefix),
    );
  }

  private stopTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pathSyncTimer) {
      clearTimeout(this.pathSyncTimer);
      this.pathSyncTimer = null;
    }
  }

  /**
   * Whether the link has closed — dropped unexpectedly or been torn down.
   * {@link init} resolves even against a dead transport (steps are
   * best-effort), so callers check this to avoid declaring a partial sync
   * "connected".
   */
  get closed(): boolean {
    return this._closed;
  }

  // Aborts the initial sync if the link closed underneath it, so a mid-sync
  // drop fails the connect (and reconnects) instead of finishing partial.
  private throwIfClosed(): void {
    if (this._closed) throw new Error('Transport closed during sync');
  }

  // Rejects every in-flight command so awaiting callers (notably init's sync
  // steps) unwind immediately instead of waiting out their own timeouts.
  private rejectPending(err: Error): void {
    const pending = this.handlers.splice(0);
    for (const h of pending) {
      clearTimeout(h.timer);
      h.reject(err);
    }
  }

  // Runs one complete remote-admin handshake, serialized against every other so
  // the radio's single pending-request slot is never clobbered mid-flight (see
  // `remoteChain`).
  private remoteRequest<T>(
    waiters: Map<string, PushWaiter<T>>,
    pubkey: Uint8Array,
    payload: Uint8Array,
  ): Promise<T> {
    const { run, tail } = this.serialize(this.remoteChain, () =>
      this.runRemoteRequest(waiters, pubkey, payload),
    );
    this.remoteChain = tail;
    return run;
  }

  // The handshake body: register the push waiter, send the command, then arm a
  // receipt-derived timeout and await the matching push. The waiter is
  // registered *before* sending because the frame parser dispatches a read
  // chunk's frames synchronously — a SENT and its push arriving together would
  // otherwise drop the push before a post-await continuation could register a
  // waiter (meshcore.js likewise installs its listener before sending).
  //
  // `promise` is the single settlement channel and is always returned, so every
  // failure path — an ERR/timeout on the SENT exchange, or a teardown that
  // already rejected the waiter — flows through it and can never leave an
  // unhandled rejected promise behind (which a bare `throw` here would, since
  // the pre-registered `promise` would then never gain a handler).
  private async runRemoteRequest<T>(
    waiters: Map<string, PushWaiter<T>>,
    pubkey: Uint8Array,
    payload: Uint8Array,
  ): Promise<T> {
    const prefixHex = toHex(pubkey.slice(0, 6));

    // Supersede any stale waiter for the same prefix, then register this one
    // with no timer yet — the timeout is armed from the SENT receipt below.
    const prior = waiters.get(prefixHex);
    if (prior) {
      if (prior.timer) clearTimeout(prior.timer);
      prior.reject(new Error('Superseded by a newer request'));
    }
    let waiter!: PushWaiter<T>;
    const promise = new Promise<T>((resolve, reject) => {
      waiter = { resolve, reject, timer: null };
    });
    waiters.set(prefixHex, waiter);

    let sent: Uint8Array;
    try {
      sent = await this.cmd(payload, [RESP.SENT], 5000);
    } catch (err) {
      // Reject through the waiter so the returned `promise` carries the
      // failure, then drop the entry. Both are no-ops if teardown already
      // rejected and removed it (the promise then already holds that error).
      waiter.reject(err as Error);
      if (waiters.get(prefixHex) === waiter) waiters.delete(prefixHex);
      return promise;
    }

    // Arm the timeout unless the push already settled the waiter (delivered in
    // the same read chunk as SENT). The wait derives from the receipt's
    // estimated round-trip — several seconds over a multi-hop path — plus a
    // grace margin; if the receipt carries no usable estimate, fall back to a
    // safe budget rather than collapsing to just the grace.
    if (waiters.get(prefixHex) === waiter) {
      const estimate = parseMsgSent(sent)?.suggestedTimeoutMs;
      const base =
        estimate && estimate > 0 ? estimate : PUSH_FALLBACK_TIMEOUT_MS;
      waiter.timer = setTimeout(() => {
        waiters.delete(prefixHex);
        waiter.reject(new PushTimeoutError(prefixHex));
      }, base + PUSH_GRACE_MS);
    }
    return promise;
  }

  // Runs one binary request, serialized on `remoteChain` alongside the
  // login/status/telemetry handshakes: the radio keeps a single pending-request
  // slot (`clearPendingReqs`), so an overlapping request would cancel this one
  // radio-side.
  private binaryRequest(payload: Uint8Array): Promise<Uint8Array> {
    const { run, tail } = this.serialize(this.remoteChain, () =>
      this.runBinaryRequest(payload),
    );
    this.remoteChain = tail;
    return run;
  }

  // The handshake body. Unlike `runRemoteRequest` the waiter cannot be
  // registered before sending: its key is the tag, which only the SENT receipt
  // reveals. The orphan slot covers the gap that leaves, so a response sharing
  // a read chunk with that receipt is still delivered.
  private async runBinaryRequest(payload: Uint8Array): Promise<Uint8Array> {
    // Checked here, inside the serialized operation, so it also covers requests
    // queued before the first rejection settled — and so every caller is
    // covered, not only the ones that consult the flag themselves.
    if (this.binaryReqUnsupported) {
      throw new Error('Radio does not support SEND_BINARY_REQ');
    }
    this.orphanBinaryResponses.clear();
    let sent: Uint8Array;
    try {
      sent = await this.cmd(payload, [RESP.SENT], 5000);
    } catch (err) {
      // `UNSUPPORTED_CMD` here is the radio disowning the command byte itself,
      // not the target node declining the request — so it is the whole radio
      // that cannot do this, for every node. Matched on the full shape
      // `resolveHandler` builds, message included: this decision is permanent
      // for the session, and `UNSUPPORTED_CMD` is 1, which a transport
      // `DOMException` (`INDEX_SIZE_ERR`) also carries — a dropped link would
      // otherwise disown a command the radio speaks perfectly well.
      if (
        err instanceof Error &&
        err.message.startsWith('Device error code ') &&
        (err as { code?: number }).code === ERR_CODE.UNSUPPORTED_CMD
      ) {
        this.binaryReqUnsupported = true;
      }
      throw err;
    }
    const receipt = parseMsgSent(sent);
    // Every SENT the firmware writes for this command carries the tag, so a
    // receipt without one is a frame this client cannot correlate at all.
    if (!receipt) throw new Error('Binary request receipt carried no tag');
    const tag = receipt.expectedAck;

    // The receipt is an await, so a disconnect can land between it and here:
    // teardown has already rejected and cleared the waiter maps by then, and a
    // waiter registered after that would simply sit on a dead client until its
    // own timeout. Nothing else rechecks this — `cmd` only guards the send.
    if (this._closed) throw new Error('Transport closed during binary request');

    const early = this.takeOrphanBinaryResponse(tag);
    if (early) return early;

    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter: PushWaiter<Uint8Array> = { resolve, reject, timer: null };
      this.binaryWaiters.set(tag, waiter);
      // Same budget as the other remote requests: the radio's estimated
      // round-trip plus a grace margin, falling back to a safe figure when the
      // receipt carries no usable estimate.
      const base =
        receipt.suggestedTimeoutMs > 0
          ? receipt.suggestedTimeoutMs
          : PUSH_FALLBACK_TIMEOUT_MS;
      waiter.timer = setTimeout(() => {
        this.binaryWaiters.delete(tag);
        reject(new Error(`Timeout waiting for binary response ${tag}`));
      }, base + PUSH_GRACE_MS);
    });
  }

  // Claims the unmatched response carrying `tag`, if one is parked. Only that
  // tag is taken: anything else belongs to a request that has already given up,
  // and is left to be discarded when the next request clears the map.
  private takeOrphanBinaryResponse(tag: number): Uint8Array | null {
    const data = this.orphanBinaryResponses.get(tag);
    if (data === undefined) return null;
    this.orphanBinaryResponses.delete(tag);
    return data;
  }

  // Parks a response nobody is waiting on yet, evicting the oldest once the map
  // is full. Insertion order is arrival order, so the oldest is the least
  // likely to still be claimed.
  private stashOrphanBinaryResponse(tag: number, data: Uint8Array): void {
    if (this.orphanBinaryResponses.size >= ORPHAN_BINARY_LIMIT) {
      const oldest = this.orphanBinaryResponses.keys().next().value;
      if (oldest !== undefined) this.orphanBinaryResponses.delete(oldest);
    }
    this.orphanBinaryResponses.set(tag, data);
  }

  // Resolves the login/status/telemetry waiter matching an inbound push's
  // pubkey prefix. A push with no pending waiter is dropped (a stray or
  // duplicate reply), mirroring meshcore.js.
  //
  // Matching is best-effort by prefix only: the wire push carries nothing that
  // ties it to a specific request instance. If a request times out (or a push
  // is duplicated by mesh flooding) and the same repeater is queried again, a
  // straggler from the earlier request can resolve the later waiter with its
  // (still real, but staler) snapshot. Serialization via `remoteChain` keeps at
  // most one waiter per prefix, bounding this to the retry/duplicate window.
  private settlePush<K, T>(
    waiters: Map<K, PushWaiter<T>>,
    key: K,
    value: T,
  ): void {
    const w = waiters.get(key);
    if (!w) return;
    waiters.delete(key);
    if (w.timer) clearTimeout(w.timer);
    w.resolve(value);
  }

  // Rejects every pending push waiter on teardown so callers awaiting a remote
  // reply unwind with the link error instead of hanging until their derived
  // timeout.
  private rejectPushWaiters(err: Error): void {
    this.rejectWaiterMap(this.loginWaiters, err);
    this.rejectWaiterMap(this.statusWaiters, err);
    this.rejectWaiterMap(this.telemetryWaiters, err);
    this.rejectWaiterMap(this.binaryWaiters, err);
    this.orphanBinaryResponses.clear();
  }

  private rejectWaiterMap<K, T>(
    waiters: Map<K, PushWaiter<T>>,
    err: Error,
  ): void {
    for (const w of waiters.values()) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(err);
    }
    waiters.clear();
  }

  // Shared teardown for both an unexpected drop and a deliberate destroy: mark
  // closed, fail in-flight commands, and unblock the contact collector.
  private teardown(err: Error): void {
    this._closed = true;
    this.stopTimers();
    this.rejectPending(err);
    this.rejectPushWaiters(err);
    this.collectingContacts = false;
    this.contactsResolve?.();
  }

  // Fired by the transport when the link drops unexpectedly: tear down and
  // notify the hook. Idempotent.
  private handleClose(): void {
    if (this._closed) return;
    // Tag the rejection as a link drop so callers can tell it apart from a
    // genuine command failure — `reboot()` uses this to treat the expected
    // restart-induced drop as success.
    const err: Error & { transportClosed?: true } = new Error(
      'Transport closed',
    );
    err.transportClosed = true;
    this.teardown(err);
    // The link is already gone — do NOT close the transport here.
    this.callbacks.onDisconnect?.();
  }

  /**
   * Stops the poll/resync timers and closes the transport. Call once when
   * disconnecting.
   */
  destroy(): void {
    this.teardown(new Error('Disconnected'));
    this.transport.close();
  }
}
