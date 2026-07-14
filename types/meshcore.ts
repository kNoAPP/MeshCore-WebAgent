// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * A node saved in the radio's contact table, keyed in the store by
 * {@link Contact.pubkeyPrefix}.
 */
export interface Contact {
  pubkey: string;
  pubkeyPrefix: string;
  pubkeyBytes: Uint8Array;
  advType: number; // 0=none 1=chat 2=repeater 3=room 4=sensor
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
 * `autoadd_config`).
 *
 * @remarks `maxHops` is the display hop count (0–63), or
 * {@link MAX_HOPS_NO_LIMIT} for no limit — not the radio's raw hop+1 byte.
 */
export interface AutoAddConfig {
  mode: 'all' | 'selected';
  chat: boolean;
  repeater: boolean;
  room: boolean;
  sensor: boolean;
  overwriteOldest: boolean;
  maxHops: number; // 0-63 display hops, or MAX_HOPS_NO_LIMIT
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
  path?: string[]; // ordered per-hop repeater hashes (hex) of a received message's flood route, when correlated
  heardVia?: string[]; // distinct repeaters (hex) that rebroadcast an own message; unordered (arrival order)
  system?: boolean;
  status?: DeliveryStatus;
  routeFlood?: boolean;
  roundTripMs?: number;
  attempt?: number;
  heardByRepeaters?: number;
  txtType?: number; // TXT_TYPE of a received message (plain/CLI/signed); routes CLI replies
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

/**
 * This radio's own identity and config, from the `APP_START` handshake.
 *
 * @remarks All fields past {@link SelfInfo.pubkey} are optional: they are read
 * only when the `SELF_INFO` frame is long enough, so shorter frames from older
 * firmware still yield a usable name + pubkey.
 */
export interface SelfInfo {
  name: string;
  pubkey: string;
  advType?: number;
  txPower?: number; // current TX power (dBm)
  maxTxPower?: number; // max TX power the radio supports (dBm)
  advLat?: number; // degrees (already ÷1e6)
  advLon?: number; // degrees (already ÷1e6)
  multiAcks?: number;
  advLocPolicy?: number;
  telemetryMode?: number; // raw bitfield; decode in a follow-up if needed
  manualAdd?: number; // 0 = auto-add all, 1 = selective (SELF_INFO offset 47)
  radioFreq?: number; // MHz
  radioBw?: number; // kHz
  radioSf?: number;
  radioCr?: number;
}

/**
 * The editable LoRa parameters, applied together by the radio settings editor.
 * Units match {@link SelfInfo}: `radioFreq` in MHz, `radioBw` in kHz, `txPower`
 * in dBm.
 */
export interface RadioParams {
  radioFreq: number;
  radioBw: number;
  radioSf: number;
  radioCr: number;
  txPower: number;
}

/** Hardware/firmware info from `DEVICE_QUERY`. */
export interface DeviceInfo {
  fwVersion: number;
  maxContacts: number;
  maxChannels: number;
  blePin: number | null;
  model: string;
  version: string;
  /**
   * Whether the radio has a GPS module, probed from `CUSTOM_VARS` (a `gps`
   * sensor setting is present). `undefined` until that query completes or on
   * firmware too old to support it.
   */
  hasGps?: boolean;
  /**
   * Whether the radio's GPS module is enabled — the value of the `gps` custom
   * var (`gps:1`). This is the radio's location *source*: enabled advertises a
   * live fix, disabled advertises the fixed coordinate set via
   * `SET_ADVERT_LATLON`. Mirrors the official app's Position Settings → GPS
   * Mode. `undefined` until `CUSTOM_VARS` is read, or on a radio without GPS.
   */
  gpsEnabled?: boolean;
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

/**
 * A repeater's live stats from a `PUSH_STATUS_RESPONSE` (`0x87`), decoded by
 * `parseStatusResponse`. Mirrors the firmware's `repeaterStats` struct (all
 * little-endian). Every field past `currTxQueueLen` is optional: older firmware
 * may send a shorter blob, so the parser returns only the fields present.
 *
 * @see `getStatus` / `onStatusResponsePush` in `meshcore.js`.
 */
export interface RepeaterStatus {
  /** 6-byte public-key prefix (hex) this status is from, to match the reply. */
  pubkeyPrefix: string;
  battMilliVolts: number;
  currTxQueueLen: number;
  noiseFloor?: number;
  lastRssi?: number;
  nPacketsRecv?: number;
  nPacketsSent?: number;
  totalAirTimeSecs?: number;
  totalUpTimeSecs?: number;
  nSentFlood?: number;
  nSentDirect?: number;
  nRecvFlood?: number;
  nRecvDirect?: number;
  errEvents?: number;
  lastSnr?: number; // dB (raw quarter-dB value ÷ 4)
  nDirectDups?: number;
  nFloodDups?: number;
}

/** The conversation currently open in the UI. */
export interface ActiveConvo {
  kind: 'channel' | 'direct';
  id: string; // e.g. "channel:0" or "direct:b6cf429f4882"
  rawId: string | number;
  label: string;
}

/** Connection lifecycle state. */
export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Progress of the initial connect sync, for the loading UI. */
export interface SyncProgress {
  stage: 'device' | 'clock' | 'contacts' | 'channels' | 'messages';
  percent: number;
  current?: number;
  total?: number;
}

/** The three supported connection transports. */
export type TransportKind = 'usb' | 'ble' | 'wifi';

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
   * the sink. May be async (BLE awaits its notification subscription) — callers
   * should await it before sending so the first reply can't be missed.
   */
  startReading(onFrame: (d: Uint8Array) => void): void | Promise<void>;
  /**
   * Registers a listener fired when the underlying link drops unexpectedly
   * (BLE out of range, USB unplug, WiFi socket close) — but not on a
   * caller-initiated {@link close}. Guarantees at most one invocation per open
   * session; the latest registration wins.
   */
  onClose(cb: () => void): void;
  /**
   * Re-opens the same underlying link after a drop, without a new user gesture
   * (the granted port/device/URL stays valid for the page session). Re-arms
   * drop detection; the caller must call {@link startReading} again to resume
   * delivery. Drives auto-reconnect alongside {@link onClose}.
   */
  reopen(): Promise<void>;
  /** Closes the underlying connection and releases resources. */
  close(): Promise<void>;
}
