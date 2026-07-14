// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type {
  Contact,
  Channel,
  SelfInfo,
  DeviceInfo,
  BatteryInfo,
  StatsCore,
  StatsRadio,
  StatsPackets,
  Message,
  SendReceipt,
  RawRxPacket,
  RepeaterStatus,
} from '@/types/meshcore';
import { ROUTE_TYPE_FLOOD, RADIO_PARAM_SCALE, TXT_TYPE } from './constants';
import { toHex } from '@/lib/utils';

// Decoders for inbound frame payloads → typed objects. Each takes the full
// frame bytes (including the leading RESP code at index 0). Integers are
// little-endian; offsets and field widths match the firmware's wire layout.
// Length-guarded parsers return null on a short/malformed frame rather than
// throw.
const dec = new TextDecoder('utf-8');

function nullTermStr(
  bytes: Uint8Array,
  offset: number,
  maxLen: number,
): string {
  let end = offset;
  while (end < offset + maxLen && bytes[end] !== 0) end++;
  return dec.decode(bytes.slice(offset, end));
}

function hexBytes(bytes: Uint8Array, from: number, to: number): string {
  return toHex(bytes.slice(from, to));
}

// path_len byte: upper 2 bits select hash size ((mode + 1) bytes per hop,
// mode 3 reserved), lower 6 bits are the hop count
function decodePathLenByte(
  b: number,
): { hashSize: number; hopCount: number } | null {
  const mode = b >> 6;
  if (mode === 3) return null;
  return { hashSize: mode + 1, hopCount: b & 63 };
}

// Message frames carry the raw packet path_len byte for flood routes,
// or 0xFF for direct delivery
function decodeMsgPathLen(b: number): number | undefined {
  if (b === 0xff) return undefined;
  return decodePathLenByte(b)?.hopCount;
}

/**
 * Parses the `SELF_INFO` handshake reply (`RESP_CODE_SELF_INFO`, `0x05`): this
 * radio's identity (public key, name), advertised location, and radio
 * parameters.
 *
 * @remarks
 * Wire layout, confirmed against the firmware
 * (`examples/companion_radio/MyMesh.cpp`, the `RESP_CODE_SELF_INFO` reply to
 * `CMD_APP_START`). Byte 0 is the response code:
 *
 * | Offset | Field                              |
 * | ------ | ---------------------------------- |
 * | 1      | adv_type                           |
 * | 2      | tx_power (int8 dBm)                |
 * | 3      | max_tx_power (int8 dBm)            |
 * | 4–35   | public_key (32 bytes)              |
 * | 36–39  | adv_lat (int32 LE, ÷1e6)           |
 * | 40–43  | adv_lon (int32 LE, ÷1e6)           |
 * | 44     | multi_acks                         |
 * | 45     | adv_loc_policy                     |
 * | 46     | telemetry_mode (bitfield)          |
 * | 47     | manual_add_contacts                |
 * | 48–51  | radio_freq (uint32 LE, ÷1000 → MHz)|
 * | 52–55  | radio_bw (uint32 LE, ÷1000 → kHz)  |
 * | 56     | radio_sf                           |
 * | 57     | radio_cr                           |
 * | 58+    | name (UTF-8, no null terminator)   |
 *
 * Every field past the pubkey is read only when the frame covers it, so
 * shorter frames from older firmware still yield a usable name + pubkey.
 */
export function parseSelfInfo(d: Uint8Array): SelfInfo {
  try {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const name =
      d.length > 58 ? dec.decode(d.slice(58)).replace(/\0.*$/, '') : '';
    const info: SelfInfo = {
      name: name || 'MeshCore Device',
      pubkey: d.length >= 36 ? hexBytes(d, 4, 36) : '',
    };
    if (d.length >= 2) info.advType = d[1];
    if (d.length >= 3) info.txPower = v.getInt8(2);
    if (d.length >= 4) info.maxTxPower = v.getInt8(3);
    if (d.length >= 40) info.advLat = v.getInt32(36, true) / 1e6;
    if (d.length >= 44) info.advLon = v.getInt32(40, true) / 1e6;
    if (d.length >= 45) info.multiAcks = d[44];
    if (d.length >= 46) info.advLocPolicy = d[45];
    if (d.length >= 47) info.telemetryMode = d[46];
    if (d.length >= 48) info.manualAdd = d[47];
    if (d.length >= 52)
      info.radioFreq = v.getUint32(48, true) / RADIO_PARAM_SCALE;
    if (d.length >= 56)
      info.radioBw = v.getUint32(52, true) / RADIO_PARAM_SCALE;
    if (d.length >= 57) info.radioSf = d[56];
    if (d.length >= 58) info.radioCr = d[57];
    return info;
  } catch {
    return { name: 'MeshCore Device', pubkey: '' };
  }
}

/**
 * Parses the `AUTOADD_CONFIG` reply into the raw `autoadd_config` bitmask and
 * raw `autoadd_max_hops` byte.
 *
 * @remarks
 * Frame layout: `[code] autoadd_config(1) autoadd_max_hops(1)`. `maxHops` is
 * the
 * radio's raw encoding (hop + 1; 0 = no limit) — callers convert for display.
 */
export function parseAutoAddConfig(d: Uint8Array): {
  config: number;
  maxHops: number;
} {
  return { config: d[1] ?? 0, maxHops: d[2] ?? 0 };
}

/**
 * Parses the `CURR_TIME` reply (`RESP_CODE_CURR_TIME`, `0x09`): the radio's
 * clock as Unix epoch seconds (uint32 LE at offset 1).
 *
 * @returns the epoch seconds, or null if the frame is too short.
 */
export function parseCurrentTime(d: Uint8Array): number | null {
  if (d.length < 5) return null;
  return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(1, true);
}

/**
 * Parses the `DEVICE_INFO` reply: firmware version, capacities, BLE pin, model.
 *
 * @remarks `maxContacts` is sent halved, so it is doubled back here.
 */
export function parseDeviceInfo(d: Uint8Array): DeviceInfo {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    fwVersion: d[1] ?? 0,
    maxContacts: (d[2] ?? 0) * 2,
    maxChannels: d[3] ?? 0,
    blePin: d.length >= 8 ? v.getUint32(4, true) : null,
    model: d.length >= 60 ? nullTermStr(d, 20, 40) : '',
    version: d.length >= 80 ? nullTermStr(d, 60, 20) : '',
  };
}

/**
 * Parses a `CUSTOM_VARS` reply into a `name → value` map. The payload after the
 * RESP code is an ASCII string of comma-separated `name:value` pairs (e.g.
 * `gps:1,gps_interval:30`); an empty list yields an empty map.
 *
 * @see `CMD_GET_CUSTOM_VARS` in the companion radio's `MyMesh.cpp`.
 */
export function parseCustomVars(d: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (d.length <= 1) return out;
  for (const pair of dec.decode(d.subarray(1)).split(',')) {
    const sep = pair.indexOf(':');
    if (sep === -1) continue;
    out[pair.slice(0, sep)] = pair.slice(sep + 1);
  }
  return out;
}

/**
 * Parses the `BATT_AND_STORAGE` reply: battery millivolts and flash usage in
 * KB.
 */
export function parseBattAndStorage(d: Uint8Array): BatteryInfo {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    voltage: v.getUint16(1, true),
    usedKB: v.getUint32(3, true),
    totalKB: d.length >= 11 ? v.getUint32(7, true) : 0,
  };
}

/**
 * Parses one `CONTACT` frame (also the payload of a `PUSH_NEW_ADVERT`).
 *
 * @returns the contact, or null if the frame is too short to hold the struct.
 * @remarks
 * Layout: `d[0]` RESP code, `d[1..32]` pubkey(32), `d[33]` adv_type,
 * `d[34]` flags, `d[35]` out_path_len, `d[36..99]` path buffer (always 64
 * bytes), `d[100..131]` name(32), `d[132..135]` last_advert ts,
 * `d[136..139]` gps_lat, `d[140..143]` gps_lon. The trailing GPS fields are
 * present only on newer firmware.
 */
export function parseContact(d: Uint8Array): Contact | null {
  if (d.length < 132) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const outPathLen = d[35];
  const hopCount = outPathLen > 0 && outPathLen <= 64 ? outPathLen : 0;
  return {
    pubkey: hexBytes(d, 1, 33),
    pubkeyPrefix: hexBytes(d, 1, 7),
    pubkeyBytes: d.slice(1, 33),
    advType: d[33],
    flags: d[34],
    outPathLen,
    path: d.slice(36, 36 + hopCount),
    name: nullTermStr(d, 100, 32),
    lastAdvert: d.length >= 136 ? v.getUint32(132, true) : undefined,
    advLat: d.length >= 140 ? v.getInt32(136, true) : undefined,
    advLon: d.length >= 144 ? v.getInt32(140, true) : undefined,
  };
}

/**
 * Parses a `CHANNEL_INFO` frame: slot index, name, and 16-byte secret.
 *
 * @remarks Layout: `[code] idx(1) name(32) secret(16)`.
 */
export function parseChannelInfo(d: Uint8Array): Channel | null {
  if (d.length < 50) return null;
  return {
    idx: d[1],
    name: nullTermStr(d, 2, 32),
    secret: d.slice(34, 50),
  };
}

/**
 * Parses a v1 channel (group) message frame. SNR is unavailable in v1 (null).
 */
export function parseChannelMsg(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 8) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    channelIdx: d[1],
    pathLen: decodeMsgPathLen(d[2]),
    timestamp: v.getUint32(4, true),
    text: dec.decode(d.slice(8)),
    snr: null,
  };
}

/**
 * Parses a v3 channel message frame, which adds an SNR byte (quarter-dB units).
 */
export function parseChannelMsgV3(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 12) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    snr: new Int8Array([d[1]])[0] / 4,
    channelIdx: d[4],
    pathLen: decodeMsgPathLen(d[5]),
    timestamp: v.getUint32(7, true),
    text: dec.decode(d.slice(11)),
  };
}

/**
 * Parses a v1 direct (1:1) message frame. SNR is unavailable in v1 (null).
 *
 * @remarks `txt_type` 2 (signed) carries a 4-byte prefix before the text.
 */
export function parseContactMsg(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 13) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const txtType = d[8];
  const textOffset = txtType === TXT_TYPE.SIGNED ? 17 : 13;
  return {
    pubkeyPrefix: hexBytes(d, 1, 7),
    timestamp: v.getUint32(9, true),
    text: dec.decode(d.slice(textOffset)),
    snr: null,
    txtType,
  };
}

/**
 * Parses a v3 direct message frame, which adds an SNR byte (quarter-dB units).
 */
export function parseContactMsgV3(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 17) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const txtType = d[11];
  const textOffset = txtType === TXT_TYPE.SIGNED ? 20 : 16;
  return {
    snr: new Int8Array([d[1]])[0] / 4,
    pubkeyPrefix: hexBytes(d, 4, 10),
    timestamp: v.getUint32(12, true),
    text: dec.decode(d.slice(textOffset)),
    txtType,
  };
}

/**
 * Parses the `SENT` reply to an outbound message: whether it flooded, the
 * expected ack code, and a suggested ack timeout in ms.
 */
export function parseMsgSent(d: Uint8Array): SendReceipt | null {
  if (d.length < 10) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    routeFlood: d[1] !== 0,
    expectedAck: v.getUint32(2, true),
    suggestedTimeoutMs: v.getUint32(6, true),
  };
}

/**
 * Parses a `PUSH_SEND_CONFIRMED` ack: the ack code (matched against the
 * expected ack from {@link parseMsgSent}) and round-trip time in ms.
 */
export function parseSendConfirmed(
  d: Uint8Array,
): { ackCode: number; roundTripMs: number } | null {
  if (d.length < 5) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    ackCode: v.getUint32(1, true),
    roundTripMs: d.length >= 9 ? v.getUint32(5, true) : 0,
  };
}

/**
 * Parses a `PUSH_LOG_RX_DATA` raw-packet log entry — used to count repeater
 * rebroadcasts of our own channel sends.
 *
 * @returns the decoded packet, or null if it isn't a flood/transport-routed
 * frame or is truncated.
 * @remarks
 * Frame: `[0x88, snr*4, rssi, <raw packet>]`. The raw packet is a header byte
 * (route in bits 0–1, payload type in bits 2–5), a path_len byte, the path,
 * then
 * the payload.
 */
export function parseLogRxData(d: Uint8Array): RawRxPacket | null {
  if (d.length < 6) return null;
  const header = d[3];
  const routeType = header & 0x03;
  const payloadType = (header >> 2) & 0x0f;
  if (routeType !== ROUTE_TYPE_FLOOD && routeType !== 0x02) return null;
  const path = decodePathLenByte(d[4]);
  if (!path) return null;
  const pathByteLen = path.hopCount * path.hashSize;
  if (d.length < 5 + pathByteLen + 1) return null;
  return {
    snr: new Int8Array([d[1]])[0] / 4,
    rssi: new Int8Array([d[2]])[0],
    routeType,
    payloadType,
    hopCount: path.hopCount,
    hashSize: path.hashSize,
    path: d.slice(5, 5 + pathByteLen),
    payload: d.slice(5 + pathByteLen),
  };
}

/**
 * Splits a raw packet path buffer into ordered per-hop repeater hashes, each
 * `hashSize` bytes wide, rendered as hex (first hop first). Trailing bytes that
 * don't fill a whole hash are ignored.
 */
export function splitPathHashes(path: Uint8Array, hashSize: number): string[] {
  if (hashSize < 1) return [];
  const hashes: string[] = [];
  for (let i = 0; i + hashSize <= path.length; i += hashSize) {
    hashes.push(toHex(path.slice(i, i + hashSize)));
  }
  return hashes;
}

/**
 * Parses the core `STATS` page (subtype 0): battery, uptime, error count, queue
 * depth.
 */
export function parseStatsCore(d: Uint8Array): StatsCore | null {
  if (d.length < 11) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    battMv: v.getUint16(2, true),
    uptimeSecs: v.getUint32(4, true),
    errors: v.getUint16(8, true),
    queueLen: d[10],
  };
}

/**
 * Parses the radio `STATS` page (subtype 1): noise floor, last RSSI/SNR, TX/RX
 * airtime.
 */
export function parseStatsRadio(d: Uint8Array): StatsRadio | null {
  if (d.length < 14) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    noiseFloor: v.getInt16(2, true),
    lastRssi: v.getInt8(4),
    lastSnr: v.getInt8(5) / 4,
    txAirSecs: v.getUint32(6, true),
    rxAirSecs: v.getUint32(10, true),
  };
}

/**
 * Parses the packet `STATS` page (subtype 2): recv/sent totals and flood/direct
 * TX/RX counters. `recvErrors` is present only on newer firmware (else null).
 */
export function parseStatsPackets(d: Uint8Array): StatsPackets | null {
  if (d.length < 26) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    recv: v.getUint32(2, true),
    sent: v.getUint32(6, true),
    floodTx: v.getUint32(10, true),
    directTx: v.getUint32(14, true),
    floodRx: v.getUint32(18, true),
    directRx: v.getUint32(22, true),
    recvErrors: d.length >= 30 ? v.getUint32(26, true) : null,
  };
}

/**
 * Parses a `PUSH_STATUS_RESPONSE` (`0x87`) into a repeater's live stats.
 *
 * @remarks
 * Frame: `[code] reserved(1) pubkey_prefix(6) <RepeaterStats struct>`. The
 * struct starts at offset 8 and is all little-endian. `meshcore.js`'s
 * `getStatus` stops at `nFloodDups`; the two trailing fields are sent by
 * current firmware (see `RepeaterStats` in `simple_repeater/MyMesh.h`):
 *
 * | Offset | Field              | Type   |
 * | ------ | ------------------ | ------ |
 * | 8      | battMilliVolts     | uint16 |
 * | 10     | currTxQueueLen     | uint16 |
 * | 12     | noiseFloor         | int16  |
 * | 14     | lastRssi           | int16  |
 * | 16     | nPacketsRecv       | uint32 |
 * | 20     | nPacketsSent       | uint32 |
 * | 24     | totalAirTimeSecs   | uint32 |
 * | 28     | totalUpTimeSecs    | uint32 |
 * | 32     | nSentFlood         | uint32 |
 * | 36     | nSentDirect        | uint32 |
 * | 40     | nRecvFlood         | uint32 |
 * | 44     | nRecvDirect        | uint32 |
 * | 48     | errEvents          | uint16 |
 * | 50     | lastSnr            | int16 (÷4 → dB) |
 * | 52     | nDirectDups        | uint16 |
 * | 54     | nFloodDups         | uint16 |
 * | 56     | totalRxAirTimeSecs | uint32 |
 * | 60     | nRecvErrors        | uint32 |
 *
 * Each field is read only when the frame covers it, so a shorter blob from
 * older firmware still yields the leading fields. Returns null when the frame
 * is too short for the pubkey prefix and the first two struct fields.
 */
export function parseStatusResponse(d: Uint8Array): RepeaterStatus | null {
  if (d.length < 12) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const status: RepeaterStatus = {
    pubkeyPrefix: hexBytes(d, 2, 8),
    battMilliVolts: v.getUint16(8, true),
    currTxQueueLen: v.getUint16(10, true),
  };
  if (d.length >= 14) status.noiseFloor = v.getInt16(12, true);
  if (d.length >= 16) status.lastRssi = v.getInt16(14, true);
  if (d.length >= 20) status.nPacketsRecv = v.getUint32(16, true);
  if (d.length >= 24) status.nPacketsSent = v.getUint32(20, true);
  if (d.length >= 28) status.totalAirTimeSecs = v.getUint32(24, true);
  if (d.length >= 32) status.totalUpTimeSecs = v.getUint32(28, true);
  if (d.length >= 36) status.nSentFlood = v.getUint32(32, true);
  if (d.length >= 40) status.nSentDirect = v.getUint32(36, true);
  if (d.length >= 44) status.nRecvFlood = v.getUint32(40, true);
  if (d.length >= 48) status.nRecvDirect = v.getUint32(44, true);
  if (d.length >= 50) status.errEvents = v.getUint16(48, true);
  if (d.length >= 52) status.lastSnr = v.getInt16(50, true) / 4;
  if (d.length >= 54) status.nDirectDups = v.getUint16(52, true);
  if (d.length >= 56) status.nFloodDups = v.getUint16(54, true);
  if (d.length >= 60) status.totalRxAirTimeSecs = v.getUint32(56, true);
  if (d.length >= 64) status.nRecvErrors = v.getUint32(60, true);
  return status;
}

/**
 * Parses a `PUSH_LOGIN_SUCCESS` (`0x85`): the 6-byte public-key prefix (hex) of
 * the node that accepted the login, so the client can match it to the request.
 *
 * @remarks Frame: `[code] permissions(1) pubkey_prefix(6)`, optionally followed
 * by `[server timestamp (uint32)][ACL permissions][firmware level]`. Byte 1 is
 * the login permissions (e.g. is-admin), zero for legacy `"OK"` responses; only
 * the prefix is decoded here.
 * @returns the pubkey prefix, or null if the frame is too short.
 */
export function parseLoginPush(d: Uint8Array): string | null {
  if (d.length < 8) return null;
  return hexBytes(d, 2, 8);
}
