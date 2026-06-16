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

/**
 * English UI strings — the source-of-truth locale. All other locale files must
 * satisfy `typeof en` so TypeScript catches missing or extra keys at compile
 * time.
 *
 * Strings may contain `{{varName}}` placeholders; the runtime substitutes them
 * with caller-supplied values via {@link translate}.
 */
export const en = {
  // ── Header ────────────────────────────────────────────────────────────────
  headerConnecting: 'Connecting\u2026',
  headerConnected: 'Connected',
  headerDisconnected: 'Disconnected',
  headerStats: '\uD83D\uDCCA Stats',
  headerDisconnect: 'Disconnect',

  // ── ConnectPanel — sync progress ──────────────────────────────────────────
  syncTitle: 'Syncing with radio',
  syncSubtitleNamed: 'Loading stored data from {{name}}.',
  syncSubtitleUnnamed: 'Loading stored data from your companion radio.',
  syncStageDevice: 'Reading device info',
  syncStageContacts: 'Syncing contacts',
  syncStageChannels: 'Syncing channels',
  syncStageMessages: 'Syncing messages',
  syncDetailReceived: '({{n}} received)',
  syncDetailOf: '({{current}} of {{total}})',

  // ── ConnectPanel — connect form ───────────────────────────────────────────
  connectTitle: 'Connect to MeshCore',
  connectSubtitle:
    'Connect via USB, Bluetooth, or WiFi to your Companion Radio.',
  tabUSB: '\uD83D\uDD0C USB',
  tabBLE: '\uD83D\uDCE1 BLE',
  tabWifi: '\uD83C\uDF10 WiFi',
  usbInfo:
    'Uses Web Serial API (Chrome / Edge). Connect your MeshCore Companion via USB cable.',
  usbUnsupported:
    'USB is not supported in this browser. Use a supported browser like Chrome to connect over USB.',
  labelBaudRate: 'Baud Rate',
  btnConnectUSB: 'Connect USB',
  bleInfo:
    'Uses Web Bluetooth API (Chrome). Scans for devices advertising the Nordic UART service.',
  bleInfoExtra:
    'Don\u2019t see your companion? It may already be connected to another device, like your phone\u2019s MeshCore app. Disconnect it there first.',
  bleUnsupported:
    'Bluetooth is not supported in this browser. Use a supported browser like Chrome to connect over BLE.',
  btnScanBLE: 'Scan & Connect BLE',
  btnScanning: 'Scanning\u2026',
  wifiInfo: 'Connects via WebSocket. Same frame protocol as USB serial.',
  wifiInfoExtra:
    'Can\u2019t reach your companion? It may already be connected to another device, like your phone\u2019s MeshCore app. Disconnect it there first.',
  labelWebSocketURL: 'WebSocket URL',
  btnConnectWifi: 'Connect WiFi',
  btnConnecting: 'Connecting\u2026',

  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebarChannels: 'Channels',
  sidebarContacts: 'Contacts',
  sidebarAddChannel: 'Add channel',
  sidebarAutoAddSettings: 'Auto-add settings',
  sidebarAddContact: 'Add contact',
  sidebarManage: 'Manage',
  sidebarDragToResize: 'Drag to resize',
  channelN: 'Channel {{n}}',

  // ── ChatArea ──────────────────────────────────────────────────────────────
  chatSelectPrompt: 'Select a channel or contact to start chatting',
  chatChannelLabel: 'Channel {{n}}',
  chatNoMessages: 'No messages yet',
  chatSenderYou: 'You',
  chatNoAck: 'No acknowledgment',
  chatNoAckTitle:
    'The message may still have arrived \u2014 the acknowledgment can be lost in route',
  chatRetry: 'Retry?',
  chatResetRetry: 'Reset route & retry',
  chatResetRetryTitle:
    'Discard the saved route to this contact and resend via flood',
  chatRepeaterBlock: 'Repeaters can\u2019t be messaged',
  chatPlaceholder:
    'Type a message\u2026 (Enter to send, Shift+Enter for newline)',

  // ── StatsModal ────────────────────────────────────────────────────────────
  statsTitle: '\uD83D\uDCCA Device Stats',
  statsRefresh: '\u21BB Refresh',
  statsRefreshing: '\u27F3 Refreshing\u2026',
  statsCardStorage: '\uD83D\uDCBE Storage & Battery',
  statsCardCore: '\uD83D\uDDA5\uFE0F Core',
  statsCardRadio: '\uD83D\uDCFB Radio',
  statsCardPackets: '\uD83D\uDCE6 Packets',
  statsVoltage: 'Voltage',
  statsUsed: 'Used',
  statsTotal: 'Total',
  statsFree: 'Free',
  statsUsage: 'Usage',
  statsUptime: 'Uptime',
  statsBattery: 'Battery',
  statsErrors: 'Errors',
  statsQueueLength: 'Queue Length',
  statsNoiseFloor: 'Noise Floor',
  statsLastRSSI: 'Last RSSI',
  statsLastSNR: 'Last SNR',
  statsTxAirtime: 'TX Airtime',
  statsRxAirtime: 'RX Airtime',
  statsPacketsReceived: 'Received',
  statsPacketsSent: 'Sent',
  statsFloodTx: 'Flood TX',
  statsFloodRx: 'Flood RX',
  statsDirectTx: 'Direct TX',
  statsDirectRx: 'Direct RX',
  statsRxErrors: 'RX Errors',

  // ── ManagePanel — contact ─────────────────────────────────────────────────
  manageLabelType: 'Type',
  manageLabelPublicKey: 'Public key',
  manageLabelRoute: 'Route',
  manageLabelPath: 'Path',
  manageLabelLastAdvert: 'Last advert',
  manageLabelUnknown: 'Unknown',
  manageRouteNoRoute: 'No route \u2014 floods',
  manageRouteDirect: 'Direct (0 hops)',
  manageRouteHop: '{{n}} hop',
  manageRouteHops: '{{n}} hops',
  manageConfirmRemoveContact: 'Remove this contact from the radio?',
  manageBtnFavorite: '\u2606 Favorite',
  manageBtnUnfavorite: '\u2605 Unfavorite',
  manageBtnResetRoute: 'Reset route',
  manageBtnShare: 'Share',
  manageBtnShareSoon: 'Coming soon',
  manageBtnRemove: 'Remove',
  manageBtnCancel: 'Cancel',

  // ── ManagePanel — channel ─────────────────────────────────────────────────
  manageChannelName: 'Name',
  manageChannelIndex: 'Index',
  manageChannelType: 'Type',
  manageChannelHash: 'Channel hash',
  manageChannelMessages: 'Messages',
  manageChannelSecret: 'Secret key',
  manageChannelReveal: 'Reveal secret key',
  manageChannelHide: 'Hide secret key',
  manageChannelTypePublic: 'Public',
  manageChannelTypeHashtag: 'Hashtag',
  manageChannelTypePrivate: 'Private',
  manageConfirmRemoveChannel: 'Remove this channel from the radio?',
  manageBtnRemoveChannel: 'Remove channel',
  managePublicChannelProtected: 'The Public channel cannot be removed',

  // ── DiscoverPanel ─────────────────────────────────────────────────────────
  discoverTitle: '\uD83D\uDCE1 Discovered nodes',
  discoverEmpty:
    'No adverts heard yet. Discovered nodes appear here as their adverts arrive.',
  discoverAdded: '\u2713 Added',
  discoverBtnAdd: 'Add',
  discoverNodeFallback: 'Node',

  // ── AddChannelModal ───────────────────────────────────────────────────────
  addChannelTitle: '\u2795 Add channel',
  addChannelModeCreate: 'Create Private',
  addChannelModeJoinPrivate: 'Join Private',
  addChannelModeJoinHashtag: 'Join Hashtag',
  addChannelHintCreate:
    'Generates a random secret key. Share it so others can join.',
  addChannelHintJoinPrivate:
    'Enter the channel name and its 16-byte secret key (hex).',
  addChannelHintJoinHashtag:
    'Hashtag channels are public \u2014 anyone entering the same name joins. Use a\u2013z, 0\u20139, and hyphens only.',
  addChannelLabelName: 'Name',
  addChannelLabelSecretGenerated: 'Secret key (generated)',
  addChannelBtnRegenerate: 'Regenerate',
  addChannelLabelSecretHex: 'Secret key (hex, 16 bytes)',
  addChannelErrorHashtagChars: 'Use only a\u2013z, 0\u20139, and hyphens.',
  addChannelErrorNoName: 'Enter a channel name.',
  addChannelErrorSecretLen: 'Secret key must be 32 hex characters (16 bytes).',
  addChannelBtnCancel: 'Cancel',
  addChannelBtnCreate: 'Create',
  addChannelBtnJoin: 'Join',

  // ── AutoAddSettings ───────────────────────────────────────────────────────
  autoAddTitle: '\u2699 Auto-add settings',
  autoAddModeAll: 'Auto Add All',
  autoAddModeAllHint: 'Save every node the radio hears',
  autoAddModeSelected: 'Auto Add Selected',
  autoAddModeSelectedHint: 'Only save the node types you choose',
  autoAddTypesLabel: 'Auto-add types',
  autoAddTypeChatUsers: 'Chat users',
  autoAddTypeRepeaters: 'Repeaters',
  autoAddTypeRoomServers: 'Room servers',
  autoAddTypeSensors: 'Sensors',
  autoAddOverwriteOldest:
    'Overwrite oldest non-favorite when contacts are full',
  autoAddMaxHops: 'Auto-add max hops',
  autoAddMaxHopsNoLimit: 'No limit',
  autoAddMaxHopsHint:
    'Only add nodes heard within this many hops (0 = direct only; far right = no limit).',
  autoAddShowPublicKeys: 'Show public keys in contact details',
  autoAddBtnCancel: 'Cancel',
  autoAddBtnSave: 'Save',

  // ── ModalShell ────────────────────────────────────────────────────────────
  modalClose: 'Close',

  // ── Toast messages (useMeshCore) ──────────────────────────────────────────
  toastNewMessageIn: 'New message in {{name}}',
  toastNewMessageFrom: 'New message from {{name}}',
  toastConnected: 'Connected \u2014 {{name}}',
  toastDisconnected: 'Disconnected',
  toastContactNotFound: 'Contact not found',
  toastRepeaterCantMessage: 'Repeaters can\u2019t be messaged',
  toastSendFailed: 'Send failed: {{msg}}',
  toastRouteReset: 'Route reset \u2014 next message will flood',
  toastRouteResetFailed: 'Route reset failed: {{msg}}',
  toastAddedToFavorites: 'Added to favorites',
  toastRemovedFromFavorites: 'Removed from favorites',
  toastFavoriteFailed: 'Failed to update favorite: {{msg}}',
  toastInvalidPublicKey: 'Invalid public key',
  toastContactAdded: 'Added {{name}}',
  toastContactAddFailed: 'Failed to add contact: {{msg}}',
  toastContactRemoved: 'Contact removed',
  toastContactRemoveFailed: 'Failed to remove contact: {{msg}}',
  toastAlreadyJoined: 'Already joined "{{name}}"',
  toastChannelsFull: 'All channel slots are full',
  toastChannelAdded: 'Channel "{{name}}" added',
  toastChannelAddFailed: 'Failed to add channel: {{msg}}',
  toastChannelRemoved: 'Channel removed',
  toastChannelRemoveFailed: 'Failed to remove channel: {{msg}}',
  toastAutoAddSaved: 'Auto-add settings saved',
  toastAutoAddFailed: 'Failed to save settings: {{msg}}',
  toastConnectionFailed: 'Connection failed: {{msg}}',
  toastUsbError: 'USB error: {{msg}}',
  toastBleError: 'BLE error: {{msg}}',
  toastWifiError: 'WiFi error: {{msg}}',

  // ── MessageBubble ─────────────────────────────────────────────────────────
  msgStatusSending: 'Sending\u2026',
  msgStatusBroadcastSent:
    'Broadcast sent \u2014 channels have no delivery receipts',
  msgStatusSentFlood: 'Sent via flood \u2014 awaiting delivery confirmation',
  msgStatusSent: 'Sent \u2014 awaiting delivery confirmation',
  msgStatusDeliveredIn: 'Delivered in {{time}}s',
  msgStatusDelivered: 'Delivered',
  msgSNR: 'SNR: {{snr}} dB',
  msgDirect: 'Direct',
  msgHop: '{{n}} hop',
  msgHops: '{{n}} hops',
  msgHeardByRepeater: 'Heard by {{n}} repeater',
  msgHeardByRepeaters: 'Heard by {{n}} repeaters',

  // ── lib/utils — formatRelative ────────────────────────────────────────────
  relativeJustNow: 'just now',
  relativeMinutesAgo: '{{n}}m ago',
  relativeHoursAgo: '{{n}}h ago',
  relativeDaysAgo: '{{n}}d ago',

  // ── lib/utils — ADV_LABEL ─────────────────────────────────────────────────
  advLabelContact: 'Contact',
  advLabelChat: 'Chat',
  advLabelRepeater: 'Repeater',
  advLabelRoomServer: 'Room Server',
} as const;
