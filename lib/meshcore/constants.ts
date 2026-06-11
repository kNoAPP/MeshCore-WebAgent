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

export const CMD = {
  APP_START: 0x01,
  SEND_TXT_MSG: 0x02,
  SEND_CHANNEL_TXT_MSG: 0x03,
  GET_CONTACTS: 0x04,
  GET_DEVICE_TIME: 0x05,
  SET_DEVICE_TIME: 0x06,
  SEND_SELF_ADVERT: 0x07,
  SET_ADVERT_NAME: 0x08,
  SYNC_NEXT_MESSAGE: 0x0a,
  RESET_PATH: 0x0d,
  REMOVE_CONTACT: 0x0f,
  EXPORT_CONTACT: 0x11,
  IMPORT_CONTACT: 0x12,
  REBOOT: 0x13,
  GET_BATT_AND_STORAGE: 0x14,
  DEVICE_QUERY: 0x16,
  GET_CHANNEL_INFO: 0x1f,
  SET_CHANNEL: 0x20,
  GET_STATS: 0x38,
} as const;

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
  PUSH_ADVERT: 0x80,
  PUSH_PATH_UPDATED: 0x81,
  PUSH_SEND_CONFIRMED: 0x82,
  PUSH_MSG_WAITING: 0x83,
  PUSH_LOG_RX_DATA: 0x88,
  PUSH_NEW_ADVERT: 0x8a,
} as const;

// Raw MeshCore packet header (PUSH_LOG_RX_DATA payload)
export const ROUTE_TYPE_FLOOD = 0x01;
export const PAYLOAD_TYPE_GRP_TXT = 0x05;

export const ADV_TYPE_REPEATER = 2;
// Contact.outPathLen sentinel: no route known, messages flood
export const NO_PATH = 255;

export const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
