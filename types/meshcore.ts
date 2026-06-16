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

/**
 * A node saved in the radio's contact table, keyed in the store by
 * {@link Contact.pubkeyPrefix}.
 */
export interface Contact {
  pubkey: string;
  pubkeyPrefix: string;
  pubkeyBytes: Uint8Array;
  advType: number; // 0=none 1=chat 2=repeater 3=room
  flags: number;
  outPathLen: number; // 255 = no route (flood), 0 = direct neighbor, 1-63 = hops
  path: Uint8Array; // one repeater hash byte per hop
  name: string;
  lastAdvert?: number; // Unix epoch secs of the advert that last refreshed this contact
  advLat?: number; // GPS latitude in microdegrees (0 = unset)
  advLon?: number; // GPS longitude in microdegrees (0 = unset)
}

/**
 * A node we've heard advertise but have not necessarily saved as a
 * {@link Contact}.
 */
export interface Advert {
  pubkey: string;
  pubkeyPrefix: string;
  name: string;
  advType: number;
  lastHeard: number; // Unix epoch secs we last heard this node
  advLat?: number;
  advLon?: number;
}

/**
 * Sentinel {@link AutoAddConfig.maxHops} value meaning "no hop limit" — the
 * radio's raw `0`. Distinct from the 0–63 display hop counts (which encode as
 * raw `hop + 1`), so it occupies the slider's far-right position.
 */
export const MAX_HOPS_NO_LIMIT = 64;

/**
 * Mirrors the radio's auto-add preferences (`manual_add_contacts` +
 * `autoadd_config`), plus one app-only field.
 *
 * @remarks `maxHops` is the display hop count (0–63), or
 * {@link MAX_HOPS_NO_LIMIT} for no limit — not the radio's raw hop+1 byte.
 * `showPublicKeys` is a local display preference and is never sent to the
 * radio.
 */
export interface AutoAddConfig {
  mode: 'all' | 'selected';
  chat: boolean;
  repeater: boolean;
  room: boolean;
  sensor: boolean;
  overwriteOldest: boolean;
  maxHops: number; // 0-63 display hops, or MAX_HOPS_NO_LIMIT
  showPublicKeys: boolean;
}

/** A channel slot. Index 0 is the reserved Public channel. */
export interface Channel {
  idx: number;
  name: string;
  secret?: Uint8Array; // 16-byte channel secret from CHANNEL_INFO (bytes 34-49)
}

/** Which conversation surface a {@link Message} belongs to. */
export type MessageKind = 'channel' | 'direct' | 'system';

/**
 * Delivery state of an outbound message. `sent` means the radio transmitted it;
 * `delivered` means the recipient's radio acked (direct messages only — channel
 * broadcasts have no receipts).
 */
export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'failed';

/**
 * A chat message, inbound or outbound, as stored in the conversation history.
 */
export interface Message {
  id?: string; // stable UUID, assigned on creation and preserved through IndexedDB
  kind: MessageKind;
  text: string;
  own?: boolean;
  timestamp?: number;
  channelIdx?: number;
  pubkeyPrefix?: string;
  senderName?: string;
  snr?: number | null;
  pathLen?: number; // hops the received message traveled (0 = heard directly)
  system?: boolean;
  status?: DeliveryStatus;
  routeFlood?: boolean;
  roundTripMs?: number;
  attempt?: number;
  heardByRepeaters?: number;
  _unread?: boolean;
}

/**
 * A decoded raw RX-log packet (from `PUSH_LOG_RX_DATA`), used to count repeater
 * rebroadcasts.
 */
export interface RawRxPacket {
  snr: number;
  rssi: number;
  routeType: number;
  payloadType: number;
  hopCount: number;
  hashSize: number; // bytes per path hop hash (1 or 2)
  path: Uint8Array;
  payload: Uint8Array;
}

/**
 * The radio's `SENT` reply for an outbound direct message, used to track
 * delivery.
 */
export interface SendReceipt {
  routeFlood: boolean;
  expectedAck: number;
  suggestedTimeoutMs: number;
}

/** This radio's own identity and config, from the `APP_START` handshake. */
export interface SelfInfo {
  name: string;
  pubkey: string;
  manualAdd?: number; // 0 = auto-add all, 1 = selective (from APP_START offset 47)
}

/** Hardware/firmware info from `DEVICE_QUERY`. */
export interface DeviceInfo {
  fwVersion: number;
  maxContacts: number;
  maxChannels: number;
  blePin: number | null;
  model: string;
  version: string;
}

/** Battery voltage (mV) and flash storage usage (KB). */
export interface BatteryInfo {
  voltage: number; // mV
  usedKB: number;
  totalKB: number;
}

/** Core `STATS` page: battery, uptime, error count, outbound queue depth. */
export interface StatsCore {
  battMv: number;
  uptimeSecs: number;
  errors: number;
  queueLen: number;
}

/**
 * Radio `STATS` page: noise floor, last RSSI/SNR, and TX/RX airtime in seconds.
 */
export interface StatsRadio {
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
}

/**
 * Packet `STATS` page: lifetime counters. `recvErrors` is null on firmware that
 * omits it.
 */
export interface StatsPackets {
  recv: number;
  sent: number;
  floodTx: number;
  directTx: number;
  floodRx: number;
  directRx: number;
  recvErrors: number | null;
}

/**
 * The three stats pages bundled together; each is optional since any page may
 * fail to fetch.
 */
export interface StatsResult {
  core?: StatsCore;
  radio?: StatsRadio;
  packets?: StatsPackets;
}

/** The conversation currently open in the UI. */
export interface ActiveConvo {
  kind: 'channel' | 'direct';
  id: string; // e.g. "channel:0" or "direct:b6cf429f4882"
  rawId: string | number;
  label: string;
}

/** Connection lifecycle state. */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** Progress of the initial connect sync, for the loading UI. */
export interface SyncProgress {
  stage: 'device' | 'contacts' | 'channels' | 'messages';
  percent: number;
  current?: number;
  total?: number;
}

/** The three supported connection transports. */
export type TransportKind = 'usb' | 'ble' | 'wifi';

/** Supported UI locale codes. */
export type Locale = 'en' | 'ja';

/**
 * Transport abstraction the {@link MeshCoreClient} talks through, implemented
 * by the USB, BLE, and WiFi transports.
 */
export interface ITransport {
  /**
   * Sends a command payload (framing, if any, is the transport's
   * responsibility).
   */
  send(payload: Uint8Array): Promise<void>;
  /**
   * Begins delivering inbound frames to `onFrame`; may be called again to swap
   * the sink.
   */
  startReading(onFrame: (d: Uint8Array) => void): void;
  /** Closes the underlying connection and releases resources. */
  close(): Promise<void>;
}
