// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Outbound command codes — the first payload byte of a frame sent to the radio.
 *
 * @see {@link https://docs.meshcore.io/companion_protocol/} and the firmware
 * `CMD_*` defines in `examples/companion_radio/MyMesh.cpp`.
 */
export const CMD = {
  APP_START: 0x01,
  SEND_TXT_MSG: 0x02,
  SEND_CHANNEL_TXT_MSG: 0x03,
  GET_CONTACTS: 0x04,
  GET_DEVICE_TIME: 0x05,
  SET_DEVICE_TIME: 0x06,
  SEND_SELF_ADVERT: 0x07,
  SET_ADVERT_NAME: 0x08,
  ADD_UPDATE_CONTACT: 0x09,
  SYNC_NEXT_MESSAGE: 0x0a,
  SET_RADIO_PARAMS: 0x0b,
  SET_TX_POWER: 0x0c,
  RESET_PATH: 0x0d,
  SET_ADVERT_LATLON: 0x0e,
  REMOVE_CONTACT: 0x0f,
  SHARE_CONTACT: 0x10,
  EXPORT_CONTACT: 0x11,
  IMPORT_CONTACT: 0x12,
  REBOOT: 0x13,
  GET_BATT_AND_STORAGE: 0x14,
  /**
   * Reads the radio's Ed25519 identity for backup: the payload is the bare
   * code byte. The radio answers {@link RESP.PRIVATE_KEY} with the 64-byte
   * private key, or {@link RESP.DISABLED} on a build compiled without
   * `ENABLE_PRIVATE_KEY_EXPORT`.
   *
   * @see `CMD_EXPORT_PRIVATE_KEY` (23) in the firmware's
   * `examples/companion_radio/MyMesh.cpp`. Not listed on the published
   * protocol page.
   */
  EXPORT_PRIVATE_KEY: 0x17,
  /**
   * Replaces the radio's Ed25519 identity: `[0x18][64-byte private key]`. The
   * firmware re-derives the public key, rewrites the stored identity, and
   * reloads contacts to invalidate their cached ECDH shared secrets; it
   * answers {@link RESP.OK}, {@link RESP.ERR} with
   * {@link ERR_CODE.ILLEGAL_ARG} when the key fails `validatePrivateKey`, or
   * {@link RESP.DISABLED} on a build compiled without
   * `ENABLE_PRIVATE_KEY_IMPORT`.
   *
   * @see `CMD_IMPORT_PRIVATE_KEY` (24) in the firmware's
   * `examples/companion_radio/MyMesh.cpp`. Not listed on the published
   * protocol page.
   */
  IMPORT_PRIVATE_KEY: 0x18,
  DEVICE_QUERY: 0x16,
  /**
   * Logs in to a repeater or room server for remote admin:
   * `[0x1a][32-byte pubkey][password]`. The radio replies `SENT`, then pushes
   * {@link RESP.PUSH_LOGIN_SUCCESS} once the destination acknowledges.
   *
   * @see `sendCommandSendLogin` in `meshcore.js` (`CommandCodes.SendLogin` =
   * 26) and the firmware's `CMD_SEND_LOGIN` handler.
   */
  SEND_LOGIN: 0x1a,
  /**
   * Requests a repeater's live stats: `[0x1b][32-byte pubkey]`. The radio
   * replies `SENT`, then pushes {@link RESP.PUSH_STATUS_RESPONSE} with the
   * repeater-stats struct once the destination answers. Requires a prior
   * {@link CMD.SEND_LOGIN}.
   *
   * @see `sendCommandSendStatusReq` in `meshcore.js`
   * (`CommandCodes.SendStatusReq` = 27).
   */
  SEND_STATUS_REQ: 0x1b,
  GET_CHANNEL_INFO: 0x1f,
  SET_CHANNEL: 0x20,
  SET_OTHER_PARAMS: 0x26,
  /**
   * Asks another node for its sensor telemetry:
   * `[0x27][3 reserved][32-byte pubkey]`. The radio replies `SENT`, then
   * pushes {@link RESP.PUSH_TELEMETRY_RESPONSE} with the node's CayenneLPP
   * blob once it answers. Unlike {@link CMD.SEND_STATUS_REQ} this needs no
   * login — the target decides what to disclose from its own `telemetry_mode`
   * permissions.
   *
   * @see `CMD_SEND_TELEMETRY_REQ` (39) in the firmware's
   * `examples/companion_radio/MyMesh.cpp`, which dispatches it as a
   * `REQ_TYPE_GET_TELEMETRY_DATA` request packet.
   */
  SEND_TELEMETRY_REQ: 0x27,
  GET_CUSTOM_VARS: 0x28,
  SET_CUSTOM_VAR: 0x29,
  /**
   * Asks the radio to relay a structured request to another node:
   * `[0x32][32-byte pubkey][request code][params…]`. The radio replies `SENT`
   * with a 4-byte **tag**, then pushes {@link RESP.PUSH_BINARY_RESPONSE}
   * carrying that same tag once the target answers. Unlike
   * {@link CMD.SEND_STATUS_REQ} and {@link CMD.SEND_TELEMETRY_REQ} — which the
   * firmware marks as deprecated in its favour — correlation is by tag rather
   * than by pubkey prefix, so a reply can never be claimed by a request to the
   * same node that preceded it.
   *
   * @see `CMD_SEND_BINARY_REQ` (50) in the firmware's
   * `examples/companion_radio/MyMesh.cpp` and `sendBinaryRequest` in
   * `meshcore.js`. Not listed on the published protocol page.
   */
  SEND_BINARY_REQ: 0x32,
  GET_STATS: 0x38,
  SET_AUTOADD_CONFIG: 0x3a,
  GET_AUTOADD_CONFIG: 0x3b,
} as const;

/**
 * Inbound response and push codes — the first byte of a frame from the radio.
 * Codes `>= 0x80` are unsolicited pushes (adverts, acks, incoming messages);
 * the rest are replies to a {@link CMD}.
 */
export const RESP = {
  OK: 0x00,
  ERR: 0x01,
  CONTACTS_START: 0x02,
  CONTACT: 0x03,
  END_OF_CONTACTS: 0x04,
  SELF_INFO: 0x05,
  SENT: 0x06,
  CONTACT_MSG: 0x07,
  CHANNEL_MSG: 0x08,
  CURR_TIME: 0x09,
  NO_MORE_MESSAGES: 0x0a,
  BATT_AND_STORAGE: 0x0c,
  DEVICE_INFO: 0x0d,
  /**
   * The radio's Ed25519 identity, answering {@link CMD.EXPORT_PRIVATE_KEY}:
   * `[0x0e][64-byte private key]`. The firmware writes the key with a 64-byte
   * budget, which is exactly `PRV_KEY_SIZE`, so the 32-byte public key does
   * *not* follow — an importing radio re-derives it.
   *
   * @see `RESP_CODE_PRIVATE_KEY` (14) in the firmware's
   * `examples/companion_radio/MyMesh.cpp` and `LocalIdentity::writeTo` in
   * `src/Identity.cpp`.
   */
  PRIVATE_KEY: 0x0e,
  /**
   * The command exists but this build has it compiled out: the payload is the
   * bare code byte, with no error code. Emitted by `writeDisabledFrame` for
   * the private-key commands when `ENABLE_PRIVATE_KEY_EXPORT` /
   * `ENABLE_PRIVATE_KEY_IMPORT` are unset.
   *
   * @see `RESP_CODE_DISABLED` (15) in the firmware's
   * `examples/companion_radio/MyMesh.cpp`.
   */
  DISABLED: 0x0f,
  CONTACT_MSG_V3: 0x10,
  CHANNEL_MSG_V3: 0x11,
  CHANNEL_INFO: 0x12,
  CUSTOM_VARS: 0x15,
  STATS: 0x18,
  AUTOADD_CONFIG: 0x19,
  /**
   * An inbound group datagram (radio-level `PAYLOAD_TYPE_GRP_DATA`) handed
   * back by {@link CMD.SYNC_NEXT_MESSAGE}: `[0x1b][SNR][2 reserved]` followed
   * by `[channel idx][path len][data type (uint16)][data len][payload]`. The
   * app has no consumer for datagrams, so it only needs to be drained from the
   * offline queue like any other queued message.
   *
   * @see ["Receive Channel Data Datagram"](https://docs.meshcore.io/companion_protocol/#receive-channel-data-datagram)
   * and `MyMesh::onChannelDataRecv` in `companion_radio/MyMesh.cpp`.
   */
  CHANNEL_DATA_RECV: 0x1b,
  PUSH_ADVERT: 0x80,
  PUSH_PATH_UPDATED: 0x81,
  PUSH_SEND_CONFIRMED: 0x82,
  PUSH_MSG_WAITING: 0x83,
  /**
   * Push confirming a {@link CMD.SEND_LOGIN} succeeded:
   * `[0x85][permissions][6-byte pubkey prefix]`, optionally followed by
   * `[server timestamp (uint32)][ACL permissions][firmware level]`. Byte 1 is
   * the login permissions (e.g. is-admin), zero for legacy `"OK"` responses;
   * the prefix identifies which login request it answers.
   *
   * @see `onLoginSuccessPush` in `meshcore.js` (`PushCodes.LoginSuccess`) and
   * `onContactResponse` in the firmware's `companion_radio/MyMesh.cpp`.
   */
  PUSH_LOGIN_SUCCESS: 0x85,
  /**
   * Push signalling a failed login: `[0x86][reserved][6-byte pubkey prefix]`.
   * Emitted by the firmware's `onContactResponse` when a login response is not
   * a success. Note a wrong repeater password produces no response at all (the
   * request just times out), so a failure often surfaces as a timeout rather
   * than this push.
   *
   * @see `PushCodes.LoginFail` in `meshcore.js` (still marked "not usable yet"
   * there) and `onContactResponse` in `companion_radio/MyMesh.cpp`.
   */
  PUSH_LOGIN_FAIL: 0x86,
  /**
   * Push carrying a repeater's stats in response to
   * {@link CMD.SEND_STATUS_REQ}:
   * `[0x87][reserved][6-byte pubkey prefix][repeater-stats struct]`. Decoded by
   * `parseStatusResponse`.
   *
   * @see `onStatusResponsePush` / `getStatus` in `meshcore.js`
   * (`PushCodes.StatusResponse`).
   */
  PUSH_STATUS_RESPONSE: 0x87,
  PUSH_LOG_RX_DATA: 0x88,
  PUSH_NEW_ADVERT: 0x8a,
  /**
   * Push carrying a node's telemetry in response to
   * {@link CMD.SEND_TELEMETRY_REQ}:
   * `[0x8b][reserved][6-byte pubkey prefix][CayenneLPP blob]`. Decoded by
   * `parseTelemetryResponse`. The blob is **big-endian**, unlike every other
   * field in this protocol.
   *
   * @see `PUSH_CODE_TELEMETRY_RESPONSE` in the firmware's
   * `examples/companion_radio/MyMesh.cpp` (`onContactResponse`).
   */
  PUSH_TELEMETRY_RESPONSE: 0x8b,
  /**
   * Push announcing the radio evicted a contact: `[0x8f][32-byte pubkey]`.
   * Emitted when auto-add's "overwrite oldest" mode
   * ({@link AUTOADD.OVERWRITE_OLDEST}) reclaims a slot for a newly heard node,
   * so the contact no longer exists on the radio.
   *
   * @see `PUSH_CODE_CONTACT_DELETED` and `MyMesh::onContactOverwrite` in the
   * firmware's `examples/companion_radio/MyMesh.cpp`. Not yet listed in the
   * published protocol docs.
   */
  /**
   * Push carrying another node's answer to a {@link CMD.SEND_BINARY_REQ}:
   * `[0x8c][reserved][tag (uint32 LE)][response bytes]`. The tag matches the
   * one the `SENT` receipt returned; the response bytes are whatever the
   * target's request handler produced, with its own reflected tag already
   * stripped by the companion radio.
   *
   * @remarks
   * The firmware only emits this when the target's reply body is non-empty
   * (`len > 4`), so a handler that returns nothing — an unknown request type,
   * or an access list with no entries — produces no push at all and the
   * request times out.
   * @see `PUSH_CODE_BINARY_RESPONSE` and `MyMesh::onContactResponse` in the
   * firmware's `examples/companion_radio/MyMesh.cpp`.
   */
  PUSH_BINARY_RESPONSE: 0x8c,
  PUSH_CONTACT_DELETED: 0x8f,
  /**
   * Push signalling contact storage is full, so a heard node was discarded
   * instead of added. Payload is the code byte alone.
   *
   * @see `PUSH_CODE_CONTACTS_FULL` and `MyMesh::onContactsFull` in the
   * firmware's `examples/companion_radio/MyMesh.cpp`. Not yet listed in the
   * published protocol docs.
   */
  PUSH_CONTACTS_FULL: 0x90,
} as const;

/**
 * Device error codes carried in the second byte of a {@link RESP.ERR} frame.
 *
 * @remarks
 * `TABLE_FULL` is overloaded: `SHARE_CONTACT` returns it both when the packet
 * pool is exhausted and — far more commonly — when the radio has no cached
 * advert packet to rebroadcast (it never heard this contact advert over the
 * air, e.g. a QR-imported contact). The firmware can't synthesize the signed
 * advert, so the share simply isn't possible until the contact adverts again.
 */
export const ERR_CODE = {
  UNSUPPORTED_CMD: 1,
  NOT_FOUND: 2,
  TABLE_FULL: 3,
  BAD_STATE: 4,
  FILE_IO_ERROR: 5,
  ILLEGAL_ARG: 6,
} as const;

/**
 * Request codes carried as the first byte of a {@link CMD.SEND_BINARY_REQ}
 * payload, mirroring the firmware's `REQ_TYPE_*` defines. Which ones a node
 * answers depends on its role and firmware: a node that does not recognize a
 * code returns an empty reply, which reaches this app as a timeout rather than
 * an error.
 *
 * @see the `REQ_TYPE_*` defines in `examples/simple_repeater/MyMesh.cpp` and
 * `Constants.BinaryRequestTypes` in `meshcore.js`.
 */
export const BINARY_REQ = {
  /**
   * The node's CayenneLPP sensor telemetry — the same payload
   * {@link CMD.SEND_TELEMETRY_REQ} fetches over its own command.
   */
  GET_TELEMETRY_DATA: 0x03,
  /**
   * Aggregated min/average/max sensor stats. Listed for completeness: no
   * shipping repeater or room-server firmware implements a handler for it, so
   * a request would simply time out.
   */
  GET_AVG_MIN_MAX: 0x04,
  /**
   * The node's access control list — who may administer it. Admin-only, and
   * answered by both repeaters and room servers (a room reports only its admin
   * entries).
   */
  GET_ACCESS_LIST: 0x05,
  /**
   * The node's neighbor table, structured and paged rather than squeezed into
   * one 160-byte CLI reply. Repeater-only.
   */
  GET_NEIGHBOURS: 0x06,
} as const;

/**
 * `order_by` values for a {@link BINARY_REQ.GET_NEIGHBOURS} request. The
 * repeater sorts its whole table by this before applying the page window, so
 * paging with a fixed order walks the list in that order.
 *
 * @see the `order_by` branches in `MyMesh::handleRequest`
 * (`examples/simple_repeater/MyMesh.cpp`).
 */
export const NEIGHBOR_ORDER = {
  NEWEST_FIRST: 0,
  OLDEST_FIRST: 1,
  STRONGEST_FIRST: 2,
  WEAKEST_FIRST: 3,
} as const;

/**
 * How many bytes of each neighbor's public key a
 * {@link BINARY_REQ.GET_NEIGHBOURS} request asks for. Eight is twice what the
 * `neighbors` CLI reply carries, which matters because the app resolves a
 * neighbor to a node by prefix and refuses to name an ambiguous one — and it
 * still leaves room for a useful page size. The repeater clamps anything above
 * 32 to the full key.
 */
export const NEIGHBOR_PREFIX_BYTES = 8;

/**
 * How many neighbors one {@link BINARY_REQ.GET_NEIGHBOURS} page asks for.
 * The repeater builds its results into a fixed 130-byte buffer and stops early
 * once the next entry would not fit, so asking for more than fits only wastes
 * the request: an entry is {@link NEIGHBOR_PREFIX_BYTES} + 4 (age) + 1 (SNR)
 * bytes.
 *
 * @see the `results_buffer[130]` cap in `MyMesh::handleRequest`
 * (`examples/simple_repeater/MyMesh.cpp`).
 */
export const NEIGHBORS_PAGE_SIZE = Math.floor(
  130 / (NEIGHBOR_PREFIX_BYTES + 5),
);

/**
 * Upper bound on how many neighbors are read across pages, matching the
 * largest `MAX_NEIGHBOURS` the firmware is built with (50). Each page is its
 * own mesh round trip, so this caps the walk even if a node reports an absurd
 * total.
 */
export const NEIGHBORS_READ_LIMIT = 50;

/**
 * `route_type` in a raw MeshCore packet header (the `PUSH_LOG_RX_DATA`
 * payload): flood routed.
 */
export const ROUTE_TYPE_FLOOD = 0x01;
/**
 * `payload_type` in a raw MeshCore packet header: group (channel) text message.
 */
export const PAYLOAD_TYPE_GRP_TXT = 0x05;

/**
 * `txt_type` classifies how the radio treats a text message body. It is
 * payload byte 1 of an outbound {@link CMD.SEND_TXT_MSG}, but on inbound frames
 * it sits deeper: offset 8 in a `CONTACT_MSG` and offset 11 in a
 * `CONTACT_MSG_V3` (after the SNR byte).
 *
 * @see `TxtTypes` in `meshcore.js` (`src/constants.js`) and the firmware's
 * `TXT_TYPE_*` defines.
 */
export const TXT_TYPE = {
  /** A normal chat message. */
  PLAIN: 0,
  /**
   * A remote-admin CLI command/reply — a direct message routed to the node's
   * console.
   */
  CLI_DATA: 1,
  /**
   * A signed plain message (carries a 4-byte signature prefix before the
   * text).
   */
  SIGNED: 2,
} as const;

/**
 * Maximum outgoing text message length in **UTF-8 bytes**, matching the
 * firmware's `MAX_TEXT_LEN` (`10 * CIPHER_BLOCK_SIZE` = `10 * 16`). The radio
 * measures this in bytes, not characters: a direct message over the limit is
 * rejected outright (`MSG_SEND_FAILED`), and a channel message is silently
 * truncated — so the send path and composer must cap by encoded byte length.
 *
 * @see `BaseChatMesh::sendMessage` / `sendGroupMessage` and `MAX_TEXT_LEN` in
 * `BaseChatMesh.h`. Note: channel messages also carry a `"<sender>: "` prefix
 * that counts toward this limit on the radio.
 */
export const MAX_MSG_BYTES = 160;

/**
 * Length of a MeshCore Ed25519 private key, in bytes — the firmware's
 * `PRV_KEY_SIZE`. It is the payload of both {@link CMD.IMPORT_PRIVATE_KEY} and
 * {@link RESP.PRIVATE_KEY}; the 32-byte public key is not carried alongside it
 * (an importing radio derives it from the private key).
 *
 * @see `PRV_KEY_SIZE` in the firmware's `src/MeshCore.h`.
 */
export const PRIVATE_KEY_BYTES = 64;

/**
 * The well-known 16-byte secret of MeshCore's default **Public** channel
 * (`PUBLIC_GROUP_PSK`, base64 `izOH6cXN6mrJ5e26oRXNcg==`). The Public channel
 * is identified by this secret, never by its slot: the firmware pre-configures
 * it into the first free slot on a factory-fresh radio, but `SET_CHANNEL`
 * treats every slot alike, so it can be removed, re-added, or live anywhere.
 *
 * @see `PUBLIC_GROUP_PSK` in the companion radio's `MyMesh.cpp` and the
 * "Channel Types" section of
 * {@link https://docs.meshcore.io/companion_protocol/}.
 */
export const PUBLIC_CHANNEL_SECRET = new Uint8Array([
  0x8b, 0x33, 0x87, 0xe9, 0xc5, 0xcd, 0xea, 0x6a, 0xc9, 0xe5, 0xed, 0xba, 0xa1,
  0x15, 0xcd, 0x72,
]);

/**
 * The name the firmware gives the Public channel when it pre-configures it —
 * reused when the user restores it after a removal.
 *
 * @see `addChannel("Public", PUBLIC_GROUP_PSK)` in the companion radio's
 * `MyMesh.cpp`.
 */
export const PUBLIC_CHANNEL_NAME = 'Public';

/**
 * Channel slot count to assume when the radio does not report its own in
 * `DEVICE_INFO` (`maxChannels` is `0` on firmware that predates the field).
 * The real limit is board dependent; 8 is the common build.
 */
export const MAX_CHANNEL_SLOTS = 8;

/**
 * Maximum node (advert) name length in **UTF-8 bytes**, matching the firmware's
 * `node_name[32]` buffer with one byte reserved for the null terminator. A
 * `SET_ADVERT_NAME` payload longer than this is truncated by the firmware, so
 * the app caps it client-side to keep the live counter honest.
 *
 * @see `CMD_SET_ADVERT_NAME` in the companion radio's `MyMesh.cpp` and
 * `node_name` in `NodePrefs.h`.
 */
export const MAX_ADVERT_NAME_BYTES = 31;

/**
 * Wire scale for the `radio_freq` and `radio_bw` fields: both travel as a
 * uint32 of the value times 1000 (frequency in kHz, bandwidth in Hz), so the
 * displayed MHz/kHz multiply by this on the way out and {@link parseSelfInfo}
 * divides by it on the way in.
 *
 * @see `CMD_SET_RADIO_PARAMS` in the companion radio's `MyMesh.cpp`, which
 * reads the uint32s and stores `freq = raw / 1000` (MHz) and `bw = raw / 1000`
 * (kHz).
 */
export const RADIO_PARAM_SCALE = 1000;

/**
 * Inclusive frequency bounds (MHz) the firmware accepts for
 * {@link CMD.SET_RADIO_PARAMS}; values outside are rejected with
 * `ERR_CODE.ILLEGAL_ARG`, so the editor validates against them client-side.
 *
 * @see the `freq >= 150000 && freq <= 2500000` guard (wire scale) in
 * `MyMesh.cpp`.
 */
export const RADIO_FREQ_MIN_MHZ = 150;
/** @see {@link RADIO_FREQ_MIN_MHZ}. */
export const RADIO_FREQ_MAX_MHZ = 2500;

/**
 * Lowest TX power (dBm) the firmware accepts for {@link CMD.SET_TX_POWER}; the
 * upper bound is the device's reported `maxTxPower`.
 *
 * @see the `power < -9 || power > MAX_LORA_TX_POWER` guard in `MyMesh.cpp`.
 */
export const TX_POWER_MIN_DBM = -9;

/**
 * Wire scale for the advertised latitude/longitude sent with
 * {@link CMD.SET_ADVERT_LATLON} and reported in `SELF_INFO`: degrees travel as
 * a signed int32 of `degrees * 1e6`.
 *
 * @see `CMD_SET_ADVERT_LATLON` in the companion radio's `MyMesh.cpp`, which
 * reads the int32s and stores `node_lat = raw / 1e6`.
 */
export const LATLON_SCALE = 1e6;

/**
 * Inclusive latitude bounds (decimal degrees) the firmware accepts for
 * {@link CMD.SET_ADVERT_LATLON}; values outside are rejected with
 * `ERR_CODE.ILLEGAL_ARG`, so the editor validates against them client-side.
 *
 * @see the `lat <= 90 * 1E6 && lat >= -90 * 1E6` guard in `MyMesh.cpp`.
 */
export const ADVERT_LAT_MIN = -90;
/** @see {@link ADVERT_LAT_MIN}. */
export const ADVERT_LAT_MAX = 90;

/**
 * Inclusive longitude bounds (decimal degrees) the firmware accepts for
 * {@link CMD.SET_ADVERT_LATLON}.
 *
 * @see the `lon <= 180 * 1E6 && lon >= -180 * 1E6` guard in `MyMesh.cpp`.
 */
export const ADVERT_LON_MIN = -180;
/** @see {@link ADVERT_LON_MIN}. */
export const ADVERT_LON_MAX = 180;

/**
 * `advert_loc_policy` values (`SELF_INFO` byte 45, and byte 3 of the
 * {@link CMD.SET_OTHER_PARAMS} frame) that decide whether — and from where —
 * this radio's location is attached to its adverts.
 *
 * @see the `ADVERT_LOC_*` defines and `CMD_SET_OTHER_PARAMS` handler in the
 * companion radio's `CommonCLI.h` / `MyMesh.cpp`.
 */
export const ADVERT_LOC_POLICY = {
  /** Never attach a location to adverts. */
  NONE: 0,
  /** Attach the live GPS fix (from the sensor manager), when available. */
  SHARE: 1,
  /** Attach the coordinate stored via {@link CMD.SET_ADVERT_LATLON}. */
  PREFS: 2,
} as const;

/**
 * Spreading-factor options offered in the radio editor (SF7–SF12). The firmware
 * tolerates SF5–SF12, but SF7+ is the usable LoRa range MeshCore configs use.
 */
export const RADIO_SF_VALUES = [7, 8, 9, 10, 11, 12] as const;

/**
 * Coding-rate options offered in the radio editor: the denominator `n` of a
 * `4/n` rate, matching the firmware's accepted `cr` range (5–8).
 */
export const RADIO_CR_VALUES = [5, 6, 7, 8] as const;

/**
 * Bandwidth options (kHz) offered in the radio editor — the standard SX126x
 * LoRa bandwidths within the firmware's accepted 7–500 kHz range.
 */
export const RADIO_BW_VALUES_KHZ = [62.5, 125, 250, 500] as const;

/** {@link Contact.advType} value for a repeater node. */
export const ADV_TYPE_REPEATER = 2;
/** {@link Contact.advType} value for a room-server node. */
export const ADV_TYPE_ROOM = 3;
/** {@link Contact.advType} value for a sensor node. */
export const ADV_TYPE_SENSOR = 4;
/**
 * CayenneLPP data channel a node reports its *own* readings on (battery
 * voltage, MCU temperature); attached sensors are assigned channels above it.
 *
 * @see `TELEM_CHANNEL_SELF` in the firmware's `src/helpers/SensorManager.h`.
 */
export const TELEM_CHANNEL_SELF = 1;
/**
 * {@link Contact.outPathLen} sentinel: no route known, so messages flood the
 * mesh.
 */
export const NO_PATH = 255;

/**
 * Bit 0 of {@link Contact.flags} marks a favorite; upper bits encode telemetry
 * permissions.
 */
export const FAVORITE_FLAG = 0x01;

/**
 * Mask for the ACL role in a repeater/room-server login permissions byte (the
 * byte carried by {@link RESP.PUSH_LOGIN_SUCCESS}). The lower two bits hold the
 * role; `0x3` (`PERM_ACL_ADMIN`) is the only role that grants remote admin.
 *
 * @see `PERM_ACL_*` and `ClientInfo::isAdmin` in the firmware's
 * `helpers/ClientACL.h`.
 */
export const PERM_ACL_ROLE_MASK = 0x03;
/**
 * ACL role granting read/write: a room server assigns it to a login that gave
 * the room (guest) password. This client treats it as the lowest role allowed
 * to post, so the two roles the firmware declares read-only
 * (`PERM_ACL_GUEST`, `PERM_ACL_READ_ONLY`) get no composer — a policy read off
 * the role names, not off the server's own check, which today drops a post
 * only for `PERM_ACL_GUEST`.
 *
 * @see `onAnonDataRecv` / `onPeerDataRecv` in the firmware's
 * `examples/simple_room_server/MyMesh.cpp`.
 */
export const PERM_ACL_READ_WRITE = 0x02;
/** ACL role value granting full remote administration. */
export const PERM_ACL_ADMIN = 0x03;
/**
 * ACL role value for an anonymous or password-less client — the role a node
 * assigns a guest login.
 */
export const PERM_ACL_GUEST = 0x00;
/** ACL role value granting reads but no posts. */
export const PERM_ACL_READ_ONLY = 0x01;

/**
 * `autoadd_config` bitmask sent with {@link CMD.SET_AUTOADD_CONFIG}.
 * `OVERWRITE_OLDEST`
 * applies in every mode; the type bits filter which node types are auto-added
 * when in
 * selective mode (see {@link MANUAL_ADD_ON}).
 */
export const AUTOADD = {
  OVERWRITE_OLDEST: 0x01,
  CHAT: 0x02,
  REPEATER: 0x04,
  ROOM: 0x08,
  SENSOR: 0x10,
} as const;

/**
 * `manual_add_contacts` value for {@link CMD.SET_OTHER_PARAMS}: auto-add every
 * heard node.
 */
export const MANUAL_ADD_OFF = 0;
/**
 * `manual_add_contacts` value for {@link CMD.SET_OTHER_PARAMS}: only add the
 * {@link AUTOADD} types.
 */
export const MANUAL_ADD_ON = 1;

/**
 * Nordic UART Service UUID — the BLE GATT service a companion radio advertises.
 */
export const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/**
 * Nordic UART RX characteristic — the app writes outbound frames here (chunked
 * at 512 bytes).
 */
export const BLE_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
/**
 * Nordic UART TX characteristic — the radio notifies inbound frames here, one
 * frame per notification.
 */
export const BLE_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
