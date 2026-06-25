// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { CMD } from './constants';
import type { Contact } from '@/types/meshcore';

// Builders that encode outbound command payloads. Each returns the raw command
// bytes (first byte is a CMD code); USB/WiFi transports wrap them with
// encodeUSBFrame, BLE sends them as-is. Text fields are UTF-8, multi-byte
// integers little-endian — matching the firmware's struct layouts.
const enc = new TextEncoder();

/**
 * Wraps a command payload in the USB/WiFi outbound (host→radio) frame: `0x3C`
 * (`<`) + uint16 LE length + payload, matching the firmware's serial receiver
 * (`ArduinoSerialInterface::checkRecvFrame`, which keys on `<`). The radio's
 * replies use `0x3E` (`>`) instead — see {@link USBFrameParser}. BLE has no
 * such delimiter and sends the payload directly.
 */
export function encodeUSBFrame(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(3 + payload.length);
  frame[0] = 0x3c;
  frame[1] = payload.length & 0xff;
  frame[2] = (payload.length >> 8) & 0xff;
  frame.set(payload, 3);
  return frame;
}

/** Opens a companion session and prompts the radio's `SELF_INFO` reply. */
export function buildAppStart(): Uint8Array {
  const name = enc.encode('MeshCoreWeb');
  const payload = new Uint8Array(1 + 7 + name.length);
  payload[0] = CMD.APP_START;
  payload.set(name, 8);
  return payload;
}

/** Requests `DEVICE_INFO` (firmware version, capacities, model). */
export function buildDeviceQuery(): Uint8Array {
  return new Uint8Array([CMD.DEVICE_QUERY, 0x03]);
}

/**
 * Pops the next queued inbound message; the radio replies with a message frame
 * or `NO_MORE_MESSAGES`.
 */
export function buildSyncNextMessage(): Uint8Array {
  return new Uint8Array([CMD.SYNC_NEXT_MESSAGE]);
}

/**
 * Requests the contact table.
 *
 * @param sinceTs - only return contacts modified at/after this Unix epoch
 * (seconds); 0 returns all.
 */
export function buildGetContacts(sinceTs = 0): Uint8Array {
  const p = new Uint8Array(5);
  p[0] = CMD.GET_CONTACTS;
  new DataView(p.buffer).setUint32(1, sinceTs, true);
  return p;
}

/** Requests battery voltage and storage usage (`BATT_AND_STORAGE`). */
export function buildGetBattery(): Uint8Array {
  return new Uint8Array([CMD.GET_BATT_AND_STORAGE]);
}

/**
 * Requests one channel slot's `CHANNEL_INFO`.
 *
 * @param idx - channel index 0–7; 0 is the reserved Public channel.
 */
export function buildGetChannelInfo(idx: number): Uint8Array {
  return new Uint8Array([CMD.GET_CHANNEL_INFO, idx]);
}

/**
 * Requests a `STATS` page.
 *
 * @param subtype - which page: 0 = core, 1 = radio, 2 = packets.
 */
export function buildGetStats(subtype: number): Uint8Array {
  return new Uint8Array([CMD.GET_STATS, subtype]);
}

/**
 * Builds a channel (group) text message.
 *
 * @param channelIdx - target channel slot 0–7.
 * @param text - message body; truncated to 160 bytes.
 */
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

/**
 * Builds a direct (1:1) text message addressed by public-key prefix.
 *
 * @param pubkeyPrefix6 - first 6 bytes of the recipient's public key.
 * @param text - message body; truncated to 160 bytes.
 * @param attempt - retry counter; lets the radio vary routing on resends.
 */
export function buildSendDirectMsg(
  pubkeyPrefix6: Uint8Array,
  text: string,
  attempt = 0,
): Uint8Array {
  const textBytes = enc.encode(text.slice(0, 160));
  const p = new Uint8Array(13 + textBytes.length);
  p[0] = CMD.SEND_TXT_MSG;
  p[1] = 0x00; // txt_type = plain
  p[2] = attempt & 0xff;
  new DataView(p.buffer).setUint32(3, Math.floor(Date.now() / 1000), true);
  p.set(pubkeyPrefix6.slice(0, 6), 7);
  p.set(textBytes, 13);
  return p;
}

/**
 * Clears a contact's stored route so its next message floods to rediscover a
 * path.
 */
export function buildResetPath(pubkey: Uint8Array): Uint8Array {
  const p = new Uint8Array(1 + 32);
  p[0] = CMD.RESET_PATH;
  p.set(pubkey.slice(0, 32), 1);
  return p;
}

/**
 * Adds a new contact or updates an existing one (matched by public key) — the
 * single command behind "add discovered node" and the favorite toggle.
 *
 * @remarks
 * Serializes the 144-byte contact struct the firmware expects: it memcpy's
 * fixed-size fields, so every field through `last_advert` must be present. The
 * trailing `gps_lat`/`gps_lon` (microdegrees) are optional to the firmware but
 * sent here so a discovered node keeps its location. The layout mirrors the
 * inbound `CONTACT` frame parsed by {@link parseContact}; see
 * `updateContactFromFrame` in the firmware's `MyMesh.cpp`.
 */
export function buildAddOrUpdateContact(contact: Contact): Uint8Array {
  const nameBytes = enc.encode(contact.name).slice(0, 32);
  const p = new Uint8Array(144);
  const v = new DataView(p.buffer);
  p[0] = CMD.ADD_UPDATE_CONTACT;
  p.set(contact.pubkeyBytes.slice(0, 32), 1);
  p[33] = contact.advType;
  p[34] = contact.flags;
  p[35] = contact.outPathLen;
  p.set(contact.path.slice(0, 64), 36);
  p.set(nameBytes, 100);
  v.setUint32(132, contact.lastAdvert ?? 0, true);
  v.setInt32(136, contact.advLat ?? 0, true);
  v.setInt32(140, contact.advLon ?? 0, true);
  return p;
}

/**
 * Shares a contact by asking the radio to zero-hop re-broadcast that contact's
 * original advert packet, so direct neighbors can hear and add it.
 */
export function buildShareContact(pubkey: Uint8Array): Uint8Array {
  const p = new Uint8Array(1 + 32);
  p[0] = CMD.SHARE_CONTACT;
  p.set(pubkey.slice(0, 32), 1);
  return p;
}

/** Deletes a contact from the radio by full public key. */
export function buildRemoveContact(pubkey: Uint8Array): Uint8Array {
  const p = new Uint8Array(1 + 32);
  p[0] = CMD.REMOVE_CONTACT;
  p.set(pubkey.slice(0, 32), 1);
  return p;
}

/**
 * Writes a channel slot. Joining/creating passes a name + secret; removing a
 * slot passes an empty name and zeroed secret.
 *
 * @param idx - channel slot 0–7 (0 = Public, not removable).
 * @param name - channel name; truncated to 32 bytes.
 * @param secret - 16-byte channel secret; truncated/used as the first 16 bytes.
 */
export function buildSetChannel(
  idx: number,
  name: string,
  secret: Uint8Array,
): Uint8Array {
  const nameBytes = enc.encode(name).slice(0, 32);
  const p = new Uint8Array(50);
  p[0] = CMD.SET_CHANNEL;
  p[1] = idx;
  p.set(nameBytes, 2);
  p.set(secret.slice(0, 16), 34);
  return p;
}

/**
 * Sets `manual_add_contacts` (the auto-add mode).
 *
 * @param manualAdd - {@link MANUAL_ADD_OFF} (auto-add all) or
 * {@link MANUAL_ADD_ON} (selective).
 * @remarks
 * The 2-byte frame is intentional: the firmware length-guards the optional
 * later bytes (telemetry/advert-loc/multi-ack), so omitting them leaves those
 * prefs untouched.
 */
export function buildSetOtherParams(manualAdd: number): Uint8Array {
  return new Uint8Array([CMD.SET_OTHER_PARAMS, manualAdd & 0xff]);
}

/**
 * Sets the auto-add filter and hop limit.
 *
 * @param configByte - {@link AUTOADD} bitmask.
 * @param maxHops - raw hop limit byte (radio encoding: hop + 1, so 1 = direct;
 * 0 = no limit). Clamped to 64 by the firmware.
 */
export function buildSetAutoAddConfig(
  configByte: number,
  maxHops: number,
): Uint8Array {
  return new Uint8Array([
    CMD.SET_AUTOADD_CONFIG,
    configByte & 0xff,
    maxHops & 0xff,
  ]);
}

/**
 * Requests the radio's persisted `AUTOADD_CONFIG` (bitmask + raw max-hops
 * byte).
 */
export function buildGetAutoAddConfig(): Uint8Array {
  return new Uint8Array([CMD.GET_AUTOADD_CONFIG]);
}
