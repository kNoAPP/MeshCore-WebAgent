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
import {
  RESP,
  FAVORITE_FLAG,
  AUTOADD,
  MANUAL_ADD_OFF,
  MANUAL_ADD_ON,
} from './constants';
import {
  buildAppStart,
  buildDeviceQuery,
  buildGetContacts,
  buildGetChannelInfo,
  buildSyncNextMessage,
  buildGetBattery,
  buildGetStats,
  buildSendChannelMsg,
  buildSendDirectMsg,
  buildResetPath,
  buildAddOrUpdateContact,
  buildRemoveContact,
  buildShareContact,
  buildSetChannel,
  buildSetOtherParams,
  buildSetAutoAddConfig,
  buildGetAutoAddConfig,
} from './frames';
import {
  parseSelfInfo,
  parseDeviceInfo,
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
} from './parsers';
import { toHex } from '@/lib/utils';

// Cap the heard-adverts log so a long session on a busy mesh can't grow
// unbounded
const ADVERTS_LIMIT = 200;

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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pathSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private collectingContacts = false;
  private contactsStarted = false;
  private contactsResolve: (() => void) | null = null;
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
   * full contact + channel sync, and a first message drain, reporting progress
   * via {@link MeshCoreCallbacks.onSyncProgress}. Then starts the 5s message
   * poll. Individual steps are best-effort — a timeout is swallowed so a slow
   * radio still finishes connecting.
   */
  async init(): Promise<void> {
    this.transport.startReading((d) => this.handleFrame(d));
    this.transport.onClose(() => this.handleClose());
    this.initialSync = true;
    this.reportSync('device', 0);
    try {
      await this.cmd(buildAppStart(), [RESP.SELF_INFO], 6000);
    } catch {}
    this.throwIfClosed();
    // AppStart must yield SELF_INFO for a usable link. A radio that's powered
    // but still rebooting can accept the transport (the USB/WiFi/GATT link
    // reopens) yet answer nothing — without this the best-effort sync below
    // would finish empty and we'd wrongly declare a mute link "connected",
    // wiping the last-synced contacts. Fail instead so the connect retries.
    if (!this.selfInfo) {
      throw new Error('Radio did not respond — try reconnecting');
    }
    this.reportSync('device', 5);
    try {
      await this.cmd(buildDeviceQuery(), [RESP.DEVICE_INFO], 5000);
    } catch {}
    this.throwIfClosed();
    this.reportSync('contacts', 10);
    await this.syncContacts();
    this.throwIfClosed();
    await this.syncChannels();
    this.throwIfClosed();
    await this.pollMessages();
    this.throwIfClosed();
    this.reportSync('messages', 100);
    this.initialSync = false;
    this.pollTimer = setInterval(() => this.pollMessages(), 5000);
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
  // is in `types` (an ERR frame rejects any pending command). Rejects on
  // timeout.
  private cmd(
    payload: Uint8Array,
    types: RespCode[],
    timeout = 5000,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const h: PendingCmd = {
        types,
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.handlers.indexOf(h);
          if (i !== -1) this.handlers.splice(i, 1);
          reject(new Error(`Timeout waiting for 0x${types[0].toString(16)}`));
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
        // Bytes 1-4: uint32 LE total contact count
        this.contactsTotal =
          d.length >= 5
            ? new DataView(d.buffer, d.byteOffset).getUint32(1, true)
            : 0;
        this.contactsSeen = 0;
        return;
      }
      if (type === RESP.CONTACT && this.contactsStarted) {
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
      const timer = setTimeout(() => {
        this.collectingContacts = false;
        resolve();
      }, 8000);
      this.contactsResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.transport.send(buildGetContacts(0));
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
   * Writes the auto-add preferences to the radio (`SET_OTHER_PARAMS` for the
   * mode, then `SET_AUTOADD_CONFIG` for the filter + hop limit).
   *
   * @remarks The hop count is converted to the radio's hop+1 encoding here; see
   * {@link readAutoAddBits} for the inverse. `showPublicKeys` is app-only and
   * not sent.
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

  /** Fetches battery and storage stats, or null if the request times out. */
  async getBattery(): Promise<BatteryInfo | null> {
    try {
      return parseBattAndStorage(
        await this.cmd(buildGetBattery(), [RESP.BATT_AND_STORAGE], 3000),
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
    const result: StatsResult = {};
    try {
      const d = await this.cmd(buildGetStats(0), [RESP.STATS], 3000);
      result.core = parseStatsCore(d) ?? undefined;
    } catch {}
    try {
      const d = await this.cmd(buildGetStats(1), [RESP.STATS], 3000);
      result.radio = parseStatsRadio(d) ?? undefined;
    } catch {}
    try {
      const d = await this.cmd(buildGetStats(2), [RESP.STATS], 3000);
      result.packets = parseStatsPackets(d) ?? undefined;
    } catch {}
    return result;
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
    this.teardown(new Error('Transport closed'));
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
