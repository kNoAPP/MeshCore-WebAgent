// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  CMD,
  BINARY_REQ,
  MAX_MSG_BYTES,
  PRIVATE_KEY_BYTES,
  MAX_ADVERT_NAME_BYTES,
  NEIGHBOR_PREFIX_BYTES,
  NEIGHBOR_ORDER,
  RADIO_PARAM_SCALE,
  LATLON_SCALE,
  TXT_TYPE,
} from './constants';
import { truncateUtf8 } from '@/lib/utils';
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
 * Requests the radio's Ed25519 private key for an identity backup
 * (`EXPORT_PRIVATE_KEY`). The payload is the bare command byte; the firmware's
 * handler takes no arguments.
 */
export function buildExportPrivateKey(): Uint8Array {
  return new Uint8Array([CMD.EXPORT_PRIVATE_KEY]);
}

/**
 * Replaces the radio's Ed25519 identity from a backup (`IMPORT_PRIVATE_KEY`).
 *
 * @param prvKey - the 64-byte private key, exactly as
 * {@link buildExportPrivateKey} read it back. The firmware requires a 65-byte
 * frame and re-derives the public key, so a shorter key is rejected here
 * rather than sent as a frame the radio would silently ignore.
 * @throws RangeError when `prvKey` is not {@link PRIVATE_KEY_BYTES} long.
 */
export function buildImportPrivateKey(prvKey: Uint8Array): Uint8Array {
  if (prvKey.length !== PRIVATE_KEY_BYTES) {
    throw new RangeError(
      `Private key must be ${PRIVATE_KEY_BYTES} bytes, got ${prvKey.length}`,
    );
  }
  const p = new Uint8Array(1 + PRIVATE_KEY_BYTES);
  p[0] = CMD.IMPORT_PRIVATE_KEY;
  p.set(prvKey, 1);
  return p;
}

/** Requests the radio's clock (`CURR_TIME`, a uint32 LE epoch-seconds). */
export function buildGetDeviceTime(): Uint8Array {
  return new Uint8Array([CMD.GET_DEVICE_TIME]);
}

/**
 * Sets the radio's clock.
 *
 * @param epochSecs - Unix epoch seconds (UTC), encoded as a uint32 LE — the
 * timezone-agnostic value the firmware stores.
 */
export function buildSetDeviceTime(epochSecs: number): Uint8Array {
  const p = new Uint8Array(5);
  p[0] = CMD.SET_DEVICE_TIME;
  new DataView(p.buffer).setUint32(1, epochSecs, true);
  return p;
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
 * Requests the radio's custom vars (`GET_CUSTOM_VARS`) — the comma-separated
 * `name:value` list of sensor-manager settings the firmware exposes. Used to
 * probe hardware capabilities: a GPS-equipped radio reports a `gps` entry,
 * boards without one report none.
 *
 * @see `CMD_GET_CUSTOM_VARS` in the companion radio's `MyMesh.cpp`, which walks
 * `sensors.getSettingName/Value`.
 */
export function buildGetCustomVars(): Uint8Array {
  return new Uint8Array([CMD.GET_CUSTOM_VARS]);
}

/**
 * Sets one sensor-manager custom var (`SET_CUSTOM_VAR`) — the payload is the
 * command byte followed by an ASCII `name:value` pair (no terminator). Used to
 * toggle the radio's GPS module via `gps:1` / `gps:0`, which the firmware folds
 * into its persisted `gps_enabled` pref.
 *
 * @param name - the var name (e.g. `gps`).
 * @param value - the var value (e.g. `1` or `0`).
 * @see `CMD_SET_CUSTOM_VAR` in the companion radio's `MyMesh.cpp`, which splits
 * on the `:` and calls `sensors.setSettingValue(name, value)`.
 */
export function buildSetCustomVar(name: string, value: string): Uint8Array {
  const body = enc.encode(`${name}:${value}`);
  const p = new Uint8Array(1 + body.length);
  p[0] = CMD.SET_CUSTOM_VAR;
  p.set(body, 1);
  return p;
}

/**
 * Requests one channel slot's `CHANNEL_INFO`.
 *
 * @param idx - channel slot index, 0 to the radio's channel count minus 1.
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
 * @param text - message body; truncated to {@link MAX_MSG_BYTES} UTF-8 bytes.
 */
export function buildSendChannelMsg(
  channelIdx: number,
  text: string,
): Uint8Array {
  const textBytes = enc.encode(truncateUtf8(text, MAX_MSG_BYTES));
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
 * @param text - message body; truncated to {@link MAX_MSG_BYTES} UTF-8 bytes.
 * @param attempt - retry counter; lets the radio vary routing on resends.
 * @param txtType - message class ({@link TXT_TYPE}); defaults to `PLAIN`. A
 * remote-admin CLI command is the same frame with `txtType = CLI_DATA`.
 */
export function buildSendDirectMsg(
  pubkeyPrefix6: Uint8Array,
  text: string,
  attempt = 0,
  txtType: number = TXT_TYPE.PLAIN,
): Uint8Array {
  const textBytes = enc.encode(truncateUtf8(text, MAX_MSG_BYTES));
  const p = new Uint8Array(13 + textBytes.length);
  p[0] = CMD.SEND_TXT_MSG;
  p[1] = txtType & 0xff;
  p[2] = attempt & 0xff;
  new DataView(p.buffer).setUint32(3, Math.floor(Date.now() / 1000), true);
  p.set(pubkeyPrefix6.slice(0, 6), 7);
  p.set(textBytes, 13);
  return p;
}

/**
 * Builds a login command for a repeater or room server:
 * `[0x1a][32-byte pubkey][password UTF-8]`. The password is the remainder of
 * the frame, capped at 15 UTF-8 bytes by the firmware, so it is truncated here.
 *
 * @param pubkey - the destination node's 32-byte public key.
 * @param password - the admin or guest password (empty string for guest).
 * @see `sendCommandSendLogin` in `meshcore.js`.
 */
export function buildSendLogin(
  pubkey: Uint8Array,
  password: string,
): Uint8Array {
  const pw = enc.encode(truncateUtf8(password, 15));
  const p = new Uint8Array(1 + 32 + pw.length);
  p[0] = CMD.SEND_LOGIN;
  p.set(pubkey.slice(0, 32), 1);
  p.set(pw, 33);
  return p;
}

/**
 * Builds a status-request command for a repeater or room server:
 * `[0x1b][32-byte pubkey]`. Requires a prior {@link buildSendLogin}; the radio
 * answers with a `PUSH_STATUS_RESPONSE` push.
 *
 * @param pubkey - the destination node's 32-byte public key.
 * @see `sendCommandSendStatusReq` in `meshcore.js`.
 */
export function buildSendStatusReq(pubkey: Uint8Array): Uint8Array {
  const p = new Uint8Array(1 + 32);
  p[0] = CMD.SEND_STATUS_REQ;
  p.set(pubkey.slice(0, 32), 1);
  return p;
}

/**
 * Builds a telemetry request for any node, as
 * `[0x27][3 reserved][32-byte pubkey]`. Needs no login; the radio answers
 * `SENT`, then pushes `PUSH_TELEMETRY_RESPONSE` once the target replies.
 *
 * @param pubkey - the target node's 32-byte public key.
 * @remarks The three reserved bytes are not padding the firmware ignores: it
 * gates this command on `len >= 4 + PUB_KEY_SIZE` and reads the key from
 * offset 4, so a 33-byte frame matches neither that branch nor the `len == 4`
 * "self telemetry" one, and is dropped without a reply.
 * @see the `CMD_SEND_TELEMETRY_REQ` handler in the firmware's
 * `examples/companion_radio/MyMesh.cpp`.
 */
export function buildSendTelemetryReq(pubkey: Uint8Array): Uint8Array {
  const p = new Uint8Array(4 + 32);
  p[0] = CMD.SEND_TELEMETRY_REQ;
  p.set(pubkey.slice(0, 32), 4);
  return p;
}

/**
 * Builds a structured request to another node:
 * `[0x32][32-byte pubkey][request code][params…]`. The radio answers `SENT`
 * with the tag that identifies the eventual `PUSH_BINARY_RESPONSE`.
 *
 * @param pubkey - the target node's 32-byte public key.
 * @param reqCode - one of {@link BINARY_REQ}.
 * @param params - request-specific bytes following the code; omitted for a
 *   request that takes none.
 * @see the `CMD_SEND_BINARY_REQ` handler in the firmware's
 * `examples/companion_radio/MyMesh.cpp`, which forwards everything past the
 * public key verbatim as the request packet.
 */
export function buildSendBinaryReq(
  pubkey: Uint8Array,
  reqCode: number,
  params: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const p = new Uint8Array(1 + 32 + 1 + params.length);
  p[0] = CMD.SEND_BINARY_REQ;
  p.set(pubkey.slice(0, 32), 1);
  p[33] = reqCode;
  p.set(params, 34);
  return p;
}

/** One page of a repeater's neighbor table to ask for. */
export interface NeighborsQuery {
  /** How many rows this page may carry. */
  count: number;
  /** How many rows to skip, counted in the requested order. */
  offset: number;
  /**
   * One of {@link NEIGHBOR_ORDER}; the repeater sorts before paging. Defaults
   * to {@link NEIGHBOR_ORDER.NEWEST_FIRST}.
   */
  orderBy?: number;
}

/**
 * Builds a `GET_NEIGHBOURS` request: request version 0, then the page window,
 * ordering, and how many bytes of each neighbor's public key to return.
 *
 * @remarks
 * The trailing four bytes are random. They are not a correlation id — the tag
 * on the `SENT` receipt is — but padding that varies per request, so two
 * identical queries do not hash to the same packet and get suppressed as
 * duplicates by the mesh.
 * @see the `REQ_TYPE_GET_NEIGHBOURS` branch of `MyMesh::handleRequest` in
 * `examples/simple_repeater/MyMesh.cpp`.
 */
export function buildGetNeighborsReq(
  pubkey: Uint8Array,
  { count, offset, orderBy = NEIGHBOR_ORDER.NEWEST_FIRST }: NeighborsQuery,
): Uint8Array {
  const params = new Uint8Array(10);
  const v = new DataView(params.buffer);
  params[0] = 0; // request_version
  params[1] = count;
  v.setUint16(2, offset, true);
  params[4] = orderBy;
  params[5] = NEIGHBOR_PREFIX_BYTES;
  crypto.getRandomValues(params.subarray(6, 10));
  return buildSendBinaryReq(pubkey, BINARY_REQ.GET_NEIGHBOURS, params);
}

/**
 * Builds a `GET_ACCESS_LIST` request. The two zero bytes are reserved query
 * params the firmware insists on: it answers only when both are zero.
 *
 * @remarks Admin-only, and answered only when the list is non-empty — the
 * firmware suppresses a reply body of nothing but the tag, so a node with an
 * empty ACL is indistinguishable from one that never answered.
 * @see the `REQ_TYPE_GET_ACCESS_LIST` branch of `MyMesh::handleRequest` in
 * `examples/simple_repeater/MyMesh.cpp`.
 */
export function buildGetAccessListReq(pubkey: Uint8Array): Uint8Array {
  return buildSendBinaryReq(
    pubkey,
    BINARY_REQ.GET_ACCESS_LIST,
    new Uint8Array(2),
  );
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

/**
 * Broadcasts this node's own advert so other nodes can hear and add it.
 *
 * @param flood - `true` floods the advert across the whole mesh (more airtime);
 * `false` sends a zero-hop advert heard only by direct neighbors. The type byte
 * matches `meshcore.js`'s `SelfAdvertTypes` (zero-hop = 0, flood = 1).
 * @see `CMD_SEND_SELF_ADVERT` in the companion radio's `MyMesh.cpp`.
 */
export function buildSendSelfAdvert(flood: boolean): Uint8Array {
  return new Uint8Array([CMD.SEND_SELF_ADVERT, flood ? 1 : 0]);
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
 * @param idx - channel slot index, 0 to the radio's channel count minus 1; any
 * slot may be written or cleared.
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
 * Sets the radio's advertised node name — what other mesh users see in their
 * contact list and in channel messages.
 *
 * @param name - the new name; truncated to {@link MAX_ADVERT_NAME_BYTES} UTF-8
 * bytes (the firmware's `node_name` buffer) so it isn't silently clipped on the
 * radio. The change takes effect on the radio's next advert.
 */
export function buildSetAdvertName(name: string): Uint8Array {
  const nameBytes = enc.encode(truncateUtf8(name, MAX_ADVERT_NAME_BYTES));
  const p = new Uint8Array(1 + nameBytes.length);
  p[0] = CMD.SET_ADVERT_NAME;
  p.set(nameBytes, 1);
  return p;
}

/**
 * Sets the core LoRa parameters in one command (`SET_RADIO_PARAMS`): frequency,
 * bandwidth, spreading factor, and coding rate.
 *
 * @param freqMhz - carrier frequency in MHz; sent as a uint32 LE of
 * `freqMhz * 1000` ({@link RADIO_PARAM_SCALE}), mirroring the parse side.
 * @param bwKhz - bandwidth in kHz; sent as a uint32 LE of `bwKhz * 1000`.
 * @param sf - spreading factor (the firmware accepts 5–12).
 * @param cr - coding rate denominator `n` of `4/n` (the firmware accepts 5–8).
 * @remarks
 * The firmware also reads an optional trailing `client_repeat` byte; it is
 * omitted here so the radio keeps its existing repeat setting. Layout confirmed
 * against `CMD_SET_RADIO_PARAMS` in the companion radio's `MyMesh.cpp`.
 */
export function buildSetRadioParams(
  freqMhz: number,
  bwKhz: number,
  sf: number,
  cr: number,
): Uint8Array {
  const p = new Uint8Array(11);
  const v = new DataView(p.buffer);
  p[0] = CMD.SET_RADIO_PARAMS;
  v.setUint32(1, Math.round(freqMhz * RADIO_PARAM_SCALE), true);
  v.setUint32(5, Math.round(bwKhz * RADIO_PARAM_SCALE), true);
  p[9] = sf;
  p[10] = cr;
  return p;
}

/**
 * Sets the transmit power (`SET_TX_POWER`).
 *
 * @param dbm - TX power in dBm as a signed byte; the firmware clamps to
 * `[-9, maxTxPower]` and rejects values outside that range.
 * @see `CMD_SET_RADIO_TX_POWER` in the companion radio's `MyMesh.cpp`.
 */
export function buildSetTxPower(dbm: number): Uint8Array {
  const p = new Uint8Array(2);
  p[0] = CMD.SET_TX_POWER;
  new DataView(p.buffer).setInt8(1, dbm);
  return p;
}

/**
 * Sets the radio's advertised location (`SET_ADVERT_LATLON`) — the coordinate
 * peers plot on the map. Sent whenever the advert location policy shares a
 * fixed position rather than a live GPS fix.
 *
 * @param latDeg - latitude in decimal degrees; sent as a signed int32 LE of
 * `latDeg * 1e6` ({@link LATLON_SCALE}), mirroring the parse side. The firmware
 * rejects values outside ±90°.
 * @param lonDeg - longitude in decimal degrees; sent as a signed int32 LE of
 * `lonDeg * 1e6`. The firmware rejects values outside ±180°.
 * @remarks
 * The 9-byte frame omits the optional trailing altitude int32 (reserved for
 * future firmware use), matching the `len >= 9` guard in
 * `CMD_SET_ADVERT_LATLON` in the companion radio's `MyMesh.cpp`.
 */
export function buildSetAdvertLatLon(
  latDeg: number,
  lonDeg: number,
): Uint8Array {
  const p = new Uint8Array(9);
  const v = new DataView(p.buffer);
  p[0] = CMD.SET_ADVERT_LATLON;
  v.setInt32(1, Math.round(latDeg * LATLON_SCALE), true);
  v.setInt32(5, Math.round(lonDeg * LATLON_SCALE), true);
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
 * Sets `advert_loc_policy` via {@link CMD.SET_OTHER_PARAMS}.
 *
 * @param manualAdd - current `manual_add_contacts` value.
 * @param telemetryMode - current packed `telemetry_mode` byte.
 * @param locPolicy - one of {@link ADVERT_LOC_POLICY}.
 * @param multiAcks - current `multi_acks` value.
 * @remarks
 * The firmware reads these prefs positionally, so the policy (byte 3) can only
 * be reached by resending the earlier bytes. The current `manual_add`,
 * `telemetry_mode`, and `multi_acks` are echoed back unchanged so this write
 * touches only the location policy.
 */
export function buildSetAdvertLocPolicy(
  manualAdd: number,
  telemetryMode: number,
  locPolicy: number,
  multiAcks: number,
): Uint8Array {
  return new Uint8Array([
    CMD.SET_OTHER_PARAMS,
    manualAdd & 0xff,
    telemetryMode & 0xff,
    locPolicy & 0xff,
    multiAcks & 0xff,
  ]);
}

/**
 * Reboots the radio (`REBOOT`). The payload is the command byte followed by the
 * ASCII confirmation word `"reboot"` (no terminator) — a guard the firmware
 * checks before restarting, matching `sendCommandReboot` in `meshcore.js`. The
 * radio typically restarts before replying, so the link drops as part of the
 * command; the caller treats that as success (see
 * {@link MeshCoreClient.reboot}).
 */
export function buildReboot(): Uint8Array {
  const magic = enc.encode('reboot');
  const p = new Uint8Array(1 + magic.length);
  p[0] = CMD.REBOOT;
  p.set(magic, 1);
  return p;
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
