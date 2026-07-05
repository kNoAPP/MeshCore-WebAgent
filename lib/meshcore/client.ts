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
} from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';
import { MeshConnectError } from './errors';
import {
  RESP,
  ERR_CODE,
  FAVORITE_FLAG,
  AUTOADD,
  MANUAL_ADD_OFF,
  MANUAL_ADD_ON,
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
} from './parsers';
import { toHex } from '@/lib/utils';

// Cap the heard-adverts log so a long session on a busy mesh can't grow
// unbounded
const ADVERTS_LIMIT = 200;

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

type RespCode = number;

interface PendingCmd {
  types: RespCode[];
  resolve: (d: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
   * The contact table changed (after a sync, add, remove, or favorite toggle).
   */
  onContactsUpdated?: (contacts: Record<string, Contact>) => void;
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

  private handlers: PendingCmd[] = [];
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

  /**
   * Runs one initial-sync step then verifies the link survived it, so a
   * mid-sync drop aborts {@link init} instead of letting a best-effort step
   * finish partial — any step routed through here is close-safe by default.
   * With `bestEffort`, the step's own error (a slow or unsupported radio) is
   * swallowed; a transport close always aborts.
   */
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
  private cmd(
    payload: Uint8Array,
    types: RespCode[],
    timeout = 5000,
    retries = 0,
  ): Promise<Uint8Array> {
    const attempt = () => this.sendCmd(payload, types, timeout);
    const run = this.cmdChain.then(
      () => this.attemptCmd(attempt, retries),
      () => this.attemptCmd(attempt, retries),
    );
    // Advance the chain on settle (success or failure) without leaking the
    // rejection into the next command or retaining the resolved frame.
    this.cmdChain = run.then(
      () => undefined,
      () => undefined,
    );
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
        this.recordAdvert(c);
        this.scheduleContactResync();
      }
      return;
    }
    if (type === RESP.PUSH_LOG_RX_DATA) {
      const pkt = parseLogRxData(d);
      if (pkt) this.callbacks.onLogRx?.(pkt);
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
        return;
      }
      if (type === RESP.CONTACT && this.contactsStarted) {
        this.rearmContactsIdle?.();
        const c = parseContact(d);
        if (c) this.contacts[c.pubkeyPrefix] = c;
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
      if (ch?.name) {
        this.channels[ch.idx] = ch;
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
      if (parsed) this.callbacks.onMessage?.({ kind: 'direct', ...parsed });
    }

    this.resolveHandler(type, d);
  }

  private scheduleContactResync(): void {
    this.pathSyncTimer ??= setTimeout(() => {
      this.pathSyncTimer = null;
      if (!this.collectingContacts) this.syncContacts();
    }, 2000);
  }

  private recordAdvert(c: Contact): void {
    this.adverts[c.pubkeyPrefix] = {
      pubkey: c.pubkey,
      pubkeyPrefix: c.pubkeyPrefix,
      name: c.name,
      advType: c.advType,
      lastHeard: c.lastAdvert ?? Math.floor(Date.now() / 1000),
      advLat: c.advLat,
      advLon: c.advLon,
    };
    this.evictOldAdverts();
    this.callbacks.onAdvertsUpdated?.(this.adverts);
  }

  private evictOldAdverts(): void {
    const keys = Object.keys(this.adverts);
    if (keys.length <= ADVERTS_LIMIT) return;
    keys
      .sort((a, b) => this.adverts[a].lastHeard - this.adverts[b].lastHeard)
      .slice(0, keys.length - ADVERTS_LIMIT)
      .forEach((k) => delete this.adverts[k]);
  }

  private touchAdvert(d: Uint8Array): void {
    const prefix = toHex(d.slice(1, 7));
    const existing = this.adverts[prefix];
    if (existing) {
      this.adverts[prefix] = {
        ...existing,
        lastHeard: Math.floor(Date.now() / 1000),
      };
      this.callbacks.onAdvertsUpdated?.(this.adverts);
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
    for (let i = 0; i <= 7; i++) {
      this.reportSync('channels', 45 + (30 * i) / 8, i + 1, 8);
      try {
        await this.cmd(buildGetChannelInfo(i), [RESP.CHANNEL_INFO], 2000);
      } catch {}
    }
    if (!this.channels[0]) this.channels[0] = { idx: 0, name: 'Public' };
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
   * Writes a channel slot (create or join).
   *
   * @param idx - channel slot 0–7.
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
   * Removes a channel slot by clearing its name and secret.
   *
   * @throws if `idx` is 0 — the Public channel is reserved and not removable.
   */
  async removeChannel(idx: number): Promise<void> {
    if (idx === 0) throw new Error('The Public channel cannot be removed');
    await this.cmd(
      buildSetChannel(idx, '', new Uint8Array(16)),
      [RESP.OK],
      5000,
    );
    delete this.channels[idx];
    this.callbacks.onChannelsUpdated?.(this.channels);
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

  /** Clears the poll and contact-resync timers. */
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

  // Shared teardown for both an unexpected drop and a deliberate destroy: mark
  // closed, fail in-flight commands, and unblock the contact collector.
  private teardown(err: Error): void {
    this._closed = true;
    this.stopTimers();
    this.rejectPending(err);
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
