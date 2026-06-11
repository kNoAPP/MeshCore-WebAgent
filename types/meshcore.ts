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

export interface Contact {
  pubkey: string;
  pubkeyPrefix: string;
  pubkeyBytes: Uint8Array;
  advType: number; // 0=none 1=chat 2=repeater 3=room
  flags: number;
  outPathLen: number;
  name: string;
}

export interface Channel {
  idx: number;
  name: string;
  secret?: Uint8Array; // 16-byte channel secret from CHANNEL_INFO (bytes 34-49)
}

export type MessageKind = 'channel' | 'direct' | 'system';

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
  system?: boolean;
  _unread?: boolean;
}

export interface SelfInfo {
  name: string;
  pubkey: string;
}

export interface DeviceInfo {
  fwVersion: number;
  maxContacts: number;
  maxChannels: number;
  blePin: number | null;
  model: string;
  version: string;
}

export interface BatteryInfo {
  voltage: number; // mV
  usedKB: number;
  totalKB: number;
}

export interface StatsCore {
  battMv: number;
  uptimeSecs: number;
  errors: number;
  queueLen: number;
}

export interface StatsRadio {
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
}

export interface StatsPackets {
  recv: number;
  sent: number;
  floodTx: number;
  directTx: number;
  floodRx: number;
  directRx: number;
  recvErrors: number | null;
}

export interface StatsResult {
  core?: StatsCore;
  radio?: StatsRadio;
  packets?: StatsPackets;
}

export interface ActiveConvo {
  kind: 'channel' | 'direct';
  id: string; // e.g. "channel:0" or "direct:b6cf429f4882"
  rawId: string | number;
  label: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface SyncProgress {
  stage: 'device' | 'contacts' | 'channels' | 'messages';
  percent: number;
  current?: number;
  total?: number;
}

export type TransportKind = 'usb' | 'ble' | 'wifi';

export interface ITransport {
  send(payload: Uint8Array): Promise<void>;
  startReading(onFrame: (d: Uint8Array) => void): void;
  close(): Promise<void>;
}
