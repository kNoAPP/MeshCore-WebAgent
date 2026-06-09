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

import { CMD } from './constants';

const enc = new TextEncoder();

/** USB/WiFi outbound framing: 0x3E + uint16_LE(len) + payload */
export function encodeUSBFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(3 + payload.length);
  frame[0] = 0x3e;
  frame[1] = payload.length & 0xff;
  frame[2] = (payload.length >> 8) & 0xff;
  frame.set(payload, 3);
  return frame;
}

export function buildAppStart(): Uint8Array {
  const name = enc.encode('MeshCoreWeb');
  const payload = new Uint8Array(1 + 7 + name.length);
  payload[0] = CMD.APP_START;
  payload.set(name, 8);
  return payload;
}

export function buildDeviceQuery(): Uint8Array {
  return new Uint8Array([CMD.DEVICE_QUERY, 0x03]);
}

export function buildSyncNextMessage(): Uint8Array {
  return new Uint8Array([CMD.SYNC_NEXT_MESSAGE]);
}

export function buildGetContacts(sinceTs = 0): Uint8Array {
  const p = new Uint8Array(5);
  p[0] = CMD.GET_CONTACTS;
  new DataView(p.buffer).setUint32(1, sinceTs, true);
  return p;
}

export function buildGetBattery(): Uint8Array {
  return new Uint8Array([CMD.GET_BATT_AND_STORAGE]);
}

export function buildGetChannelInfo(idx: number): Uint8Array {
  return new Uint8Array([CMD.GET_CHANNEL_INFO, idx]);
}

export function buildGetStats(subtype: number): Uint8Array {
  return new Uint8Array([CMD.GET_STATS, subtype]);
}

export function buildSendChannelMsg(
  channelIdx: number,
  text: string,
): Uint8Array {
  const textBytes = enc.encode(text.slice(0, 160));
  const p = new Uint8Array(7 + textBytes.length);
  p[0] = CMD.SEND_CHANNEL_TXT_MSG;
  p[1] = 0x00; // txt_type = plain
  p[2] = channelIdx;
  new DataView(p.buffer).setUint32(3, Math.floor(Date.now() / 1000), true);
  p.set(textBytes, 7);
  return p;
}

export function buildSendDirectMsg(
  pubkeyPrefix6: Uint8Array,
  text: string,
): Uint8Array {
  const textBytes = enc.encode(text.slice(0, 160));
  const p = new Uint8Array(13 + textBytes.length);
  p[0] = CMD.SEND_TXT_MSG;
  p[1] = 0x00; // txt_type = plain
  p[2] = 0x00; // attempt
  new DataView(p.buffer).setUint32(3, Math.floor(Date.now() / 1000), true);
  p.set(pubkeyPrefix6.slice(0, 6), 7);
  p.set(textBytes, 13);
  return p;
}
