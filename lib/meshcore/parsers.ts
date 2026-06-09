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
  Contact,
  Channel,
  SelfInfo,
  DeviceInfo,
  BatteryInfo,
  StatsCore,
  StatsRadio,
  StatsPackets,
  Message,
} from '@/types/meshcore';

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
  return Array.from(bytes.slice(from, to))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function parseSelfInfo(d: Uint8Array): SelfInfo {
  try {
    const pubkey = d.length >= 33 ? hexBytes(d, 1, 33) : '';
    const name =
      d.length > 58 ? dec.decode(d.slice(58)).replace(/\0.*$/, '') : '';
    return { name: name || 'MeshCore Device', pubkey };
  } catch {
    return { name: 'MeshCore Device', pubkey: '' };
  }
}

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

export function parseBattAndStorage(d: Uint8Array): BatteryInfo {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    voltage: v.getUint16(1, true),
    usedKB: v.getUint32(3, true),
    totalKB: d.length >= 11 ? v.getUint32(7, true) : 0,
  };
}

export function parseContact(d: Uint8Array): Contact | null {
  // d[0]: type | d[1..32]: pubkey(32) | d[33]: adv_type | d[34]: flags | d[35]: out_path_len
  // d[36..99]: path buffer (always 64 bytes) | d[100..131]: name(32)
  if (d.length < 132) return null;
  return {
    pubkey: hexBytes(d, 1, 33),
    pubkeyPrefix: hexBytes(d, 1, 7),
    pubkeyBytes: d.slice(1, 33),
    advType: d[33],
    flags: d[34],
    outPathLen: d[35],
    name: nullTermStr(d, 100, 32),
  };
}

export function parseChannelInfo(d: Uint8Array): Channel | null {
  if (d.length < 50) return null;
  return {
    idx: d[1],
    name: nullTermStr(d, 2, 32),
    secret: d.slice(34, 50),
  };
}

export function parseChannelMsg(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 8) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    channelIdx: d[1],
    timestamp: v.getUint32(4, true),
    text: dec.decode(d.slice(8)),
    snr: null,
  };
}

export function parseChannelMsgV3(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 12) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    snr: new Int8Array([d[1]])[0] * 4,
    channelIdx: d[4],
    timestamp: v.getUint32(7, true),
    text: dec.decode(d.slice(11)),
  };
}

export function parseContactMsg(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 13) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const txtType = d[8];
  const textOffset = txtType === 2 ? 17 : 13;
  return {
    pubkeyPrefix: hexBytes(d, 1, 7),
    timestamp: v.getUint32(9, true),
    text: dec.decode(d.slice(textOffset)),
    snr: null,
  };
}

export function parseContactMsgV3(d: Uint8Array): Omit<Message, 'kind'> | null {
  if (d.length < 17) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const txtType = d[11];
  const textOffset = txtType === 2 ? 21 : 17;
  return {
    snr: new Int8Array([d[1]])[0] * 4,
    pubkeyPrefix: hexBytes(d, 4, 10),
    timestamp: v.getUint32(12, true),
    text: dec.decode(d.slice(textOffset)),
  };
}

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
