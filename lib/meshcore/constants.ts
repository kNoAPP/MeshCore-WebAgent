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
  RESET_PATH: 0x0d,
  REMOVE_CONTACT: 0x0f,
  SHARE_CONTACT: 0x10,
  EXPORT_CONTACT: 0x11,
  IMPORT_CONTACT: 0x12,
  REBOOT: 0x13,
  GET_BATT_AND_STORAGE: 0x14,
  DEVICE_QUERY: 0x16,
  GET_CHANNEL_INFO: 0x1f,
  SET_CHANNEL: 0x20,
  SET_OTHER_PARAMS: 0x26,
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
  CONTACT_MSG_V3: 0x10,
  CHANNEL_MSG_V3: 0x11,
  CHANNEL_INFO: 0x12,
  STATS: 0x18,
  AUTOADD_CONFIG: 0x19,
  PUSH_ADVERT: 0x80,
  PUSH_PATH_UPDATED: 0x81,
  PUSH_SEND_CONFIRMED: 0x82,
  PUSH_MSG_WAITING: 0x83,
  PUSH_LOG_RX_DATA: 0x88,
  PUSH_NEW_ADVERT: 0x8a,
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
 * `route_type` in a raw MeshCore packet header (the `PUSH_LOG_RX_DATA`
 * payload): flood routed.
 */
export const ROUTE_TYPE_FLOOD = 0x01;
/**
 * `payload_type` in a raw MeshCore packet header: group (channel) text message.
 */
export const PAYLOAD_TYPE_GRP_TXT = 0x05;

/** {@link Contact.advType} value for a repeater node. */
export const ADV_TYPE_REPEATER = 2;
/** {@link Contact.advType} value for a room-server node. */
export const ADV_TYPE_ROOM = 3;
/** {@link Contact.advType} value for a sensor node. */
export const ADV_TYPE_SENSOR = 4;
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
