// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

import type {
  ITransport,
  Contact,
  Channel,
  SelfInfo,
  DeviceInfo,
  BatteryInfo,
  StatsResult,
  Message,
  SyncProgress,
  SendReceipt,
  RawRxPacket,
} from '@/types/meshcore';
import { RESP } from './constants';
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
} from './parsers';

type RespCode = number;

interface PendingCmd {
  types: RespCode[];
  resolve: (d: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MeshCoreCallbacks {
  onMessage?: (msg: Message) => void;
  onContactsUpdated?: (contacts: Record<string, Contact>) => void;
  onChannelsUpdated?: (channels: Record<number, Channel>) => void;
  onSelfInfo?: (info: SelfInfo) => void;
  onDeviceInfo?: (info: DeviceInfo) => void;
  onBattery?: (info: BatteryInfo) => void;
  onAck?: (ackCode: number, roundTripMs: number) => void;
  onLogRx?: (pkt: RawRxPacket) => void;
  onSyncProgress?: (progress: SyncProgress) => void;
}

export class MeshCoreClient {
  contacts: Record<string, Contact> = {};
  channels: Record<number, Channel> = {};
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

  constructor(
    private transport: ITransport,
    public callbacks: MeshCoreCallbacks = {},
  ) {}

  async init(): Promise<void> {
    this.transport.startReading((d) => this.handleFrame(d));
    this.initialSync = true;
    this.reportSync('device', 0);
    try {
      await this.cmd(buildAppStart(), [RESP.SELF_INFO], 6000);
    } catch {}
    this.reportSync('device', 5);
    try {
      await this.cmd(buildDeviceQuery(), [RESP.DEVICE_INFO], 5000);
    } catch {}
    this.reportSync('contacts', 10);
    await this.syncContacts();
    await this.syncChannels();
    await this.pollMessages();
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
      // Match explicit type, or treat ERR as a wildcard rejection for any pending handler.
      // Do NOT wildcard OK — it's already listed explicitly in types arrays that expect it.
      (h) =>
        h.types.includes(type) || (type === RESP.ERR && h.types.length > 0),
    );
    if (i === -1) return false;
    const h = this.handlers.splice(i, 1)[0];
    clearTimeout(h.timer);
    if (type === RESP.ERR) h.reject(new Error(`Device error code ${d[1]}`));
    else h.resolve(d);
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
      // The mesh found (or lost) a route to a contact, or a known contact
      // re-advertised — refresh contact data, coalescing bursts into one re-sync
      this.pathSyncTimer ??= setTimeout(() => {
        this.pathSyncTimer = null;
        if (!this.collectingContacts) this.syncContacts();
      }, 2000);
      return;
    }
    if (type === RESP.PUSH_NEW_ADVERT) {
      // Fired when the radio auto-adds a discovered contact; payload matches
      // the CONTACT response frame layout
      const c = parseContact(d);
      if (c) {
        this.contacts[c.pubkeyPrefix] = c;
        this.callbacks.onContactsUpdated?.(this.contacts);
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
        // Queue depth is unknown ahead of time — creep toward the end of the bar
        this.reportSync('messages', Math.min(99, 75 + i * 2), i);
        const d = await this.cmd(buildSyncNextMessage(), msgTypes, 3000);
        if (d[0] === RESP.NO_MORE_MESSAGES) break;
      }
    } catch {}
    this.polling = false;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async sendChannelMessage(channelIdx: number, text: string): Promise<void> {
    await this.cmd(
      buildSendChannelMsg(channelIdx, text),
      [RESP.SENT, RESP.OK],
      10000,
    );
  }

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

  async getBattery(): Promise<BatteryInfo | null> {
    try {
      return parseBattAndStorage(
        await this.cmd(buildGetBattery(), [RESP.BATT_AND_STORAGE], 3000),
      );
    } catch {
      return null;
    }
  }

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

  lookupContact(pubkeyPrefix: string): Contact | undefined {
    return Object.values(this.contacts).find(
      (c) =>
        c.pubkeyPrefix.startsWith(pubkeyPrefix) ||
        pubkeyPrefix.startsWith(c.pubkeyPrefix),
    );
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pathSyncTimer) clearTimeout(this.pathSyncTimer);
    this.transport.close();
  }
}
