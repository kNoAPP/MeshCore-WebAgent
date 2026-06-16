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

// cspell:disable — Japanese locale; spell-check is English-only
import type { TranslationKey } from '@/lib/i18n';

/**
 * Japanese UI strings. Must cover every {@link TranslationKey} —
 * TypeScript enforces coverage.
 */
export const ja: Record<TranslationKey, string> = {
  // ── Header ────────────────────────────────────────────────────────────────
  headerConnecting: '接続中\u2026',
  headerConnected: '接続済み',
  headerDisconnected: '切断済み',
  headerStats: '\uD83D\uDCCA 統計',
  headerDisconnect: '切断',

  // ── ConnectPanel — sync progress ──────────────────────────────────────────
  syncTitle: '無線機と同期中',
  syncSubtitleNamed: '{{name}} のデータを読み込んでいます。',
  syncSubtitleUnnamed: 'コンパニオン無線機のデータを読み込んでいます。',
  syncStageDevice: 'デバイス情報を読み込み中',
  syncStageContacts: '連絡先を同期中',
  syncStageChannels: 'チャンネルを同期中',
  syncStageMessages: 'メッセージを同期中',
  syncDetailReceived: '({{n}} 件受信)',
  syncDetailOf: '({{current}} / {{total}})',

  // ── ConnectPanel — connect form ───────────────────────────────────────────
  connectTitle: 'MeshCore に接続',
  connectSubtitle:
    'USB、Bluetooth、または WiFi 経由でコンパニオン無線機に接続します。',
  tabUSB: '\uD83D\uDD0C USB',
  tabBLE: '\uD83D\uDCE1 BLE',
  tabWifi: '\uD83C\uDF10 WiFi',
  usbInfo:
    'Web Serial API（Chrome / Edge）を使用します。MeshCore コンパニオンを USB ケーブルで接続してください。',
  usbUnsupported:
    'このブラウザは USB に対応していません。Chrome など対応ブラウザをお使いください。',
  labelBaudRate: 'ボーレート',
  btnConnectUSB: 'USB 接続',
  bleInfo:
    'Web Bluetooth API（Chrome）を使用します。Nordic UART サービスを広告するデバイスをスキャンします。',
  bleInfoExtra:
    'コンパニオンが見つかりませんか？スマートフォンの MeshCore アプリなど別のデバイスに接続されている可能性があります。先にそちらで切断してください。',
  bleUnsupported:
    'このブラウザは Bluetooth に対応していません。Chrome など対応ブラウザをお使いください。',
  btnScanBLE: 'BLE をスキャン＆接続',
  btnScanning: 'スキャン中\u2026',
  wifiInfo:
    'WebSocket 経由で接続します。USB シリアルと同じフレームプロトコルを使用します。',
  wifiInfoExtra:
    'コンパニオンに接続できませんか？スマートフォンの MeshCore アプリなど別のデバイスに接続されている可能性があります。先にそちらで切断してください。',
  labelWebSocketURL: 'WebSocket URL',
  btnConnectWifi: 'WiFi 接続',
  btnConnecting: '接続中\u2026',

  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebarChannels: 'チャンネル',
  sidebarContacts: '連絡先',
  sidebarAddChannel: 'チャンネルを追加',
  sidebarAutoAddSettings: '自動追加設定',
  sidebarAddContact: '連絡先を追加',
  sidebarManage: '管理',
  sidebarDragToResize: 'ドラッグしてサイズ変更',
  channelN: 'チャンネル {{n}}',

  // ── ChatArea ──────────────────────────────────────────────────────────────
  chatSelectPrompt: 'チャンネルまたは連絡先を選択してチャットを開始',
  chatChannelLabel: 'チャンネル {{n}}',
  chatNoMessages: 'まだメッセージはありません',
  chatSenderYou: 'あなた',
  chatNoAck: '配信確認なし',
  chatNoAckTitle:
    'メッセージは届いている可能性があります。経路上で確認が失われることがあります。',
  chatRetry: '再試行？',
  chatResetRetry: 'ルートをリセットして再試行',
  chatResetRetryTitle:
    'この連絡先への保存済みルートを破棄してフラッドで再送します',
  chatRepeaterBlock: 'リピーターにはメッセージを送れません',
  chatPlaceholder: 'メッセージを入力\u2026（Enter で送信、Shift+Enter で改行）',

  // ── StatsModal ────────────────────────────────────────────────────────────
  statsTitle: '\uD83D\uDCCA デバイス統計',
  statsRefresh: '\u21BB 更新',
  statsRefreshing: '\u27F3 更新中\u2026',
  statsCardStorage: '\uD83D\uDCBE ストレージ＆バッテリー',
  statsCardCore: '\uD83D\uDDA5\uFE0F コア',
  statsCardRadio: '\uD83D\uDCFB 無線',
  statsCardPackets: '\uD83D\uDCE6 パケット',
  statsVoltage: '電圧',
  statsUsed: '使用量',
  statsTotal: '合計',
  statsFree: '空き容量',
  statsUsage: '使用率',
  statsUptime: '稼働時間',
  statsBattery: 'バッテリー',
  statsErrors: 'エラー',
  statsQueueLength: 'キュー長',
  statsNoiseFloor: 'ノイズフロア',
  statsLastRSSI: '最後の RSSI',
  statsLastSNR: '最後の SNR',
  statsTxAirtime: 'TX 送信時間',
  statsRxAirtime: 'RX 受信時間',
  statsPacketsReceived: '受信',
  statsPacketsSent: '送信',
  statsFloodTx: 'フラッド TX',
  statsFloodRx: 'フラッド RX',
  statsDirectTx: 'ダイレクト TX',
  statsDirectRx: 'ダイレクト RX',
  statsRxErrors: 'RX エラー',

  // ── ManagePanel — contact ─────────────────────────────────────────────────
  manageLabelType: 'タイプ',
  manageLabelPublicKey: '公開鍵',
  manageLabelRoute: 'ルート',
  manageLabelPath: 'パス',
  manageLabelLastAdvert: '最終広告',
  manageLabelUnknown: '不明',
  manageRouteNoRoute: 'ルートなし \u2014 フラッド',
  manageRouteDirect: 'ダイレクト（0 ホップ）',
  manageRouteHop: '{{n}} ホップ',
  manageRouteHops: '{{n}} ホップ',
  manageConfirmRemoveContact: 'この連絡先を無線機から削除しますか？',
  manageBtnFavorite: '\u2606 お気に入り',
  manageBtnUnfavorite: '\u2605 お気に入り解除',
  manageBtnResetRoute: 'ルートをリセット',
  manageBtnShare: '共有',
  manageBtnShareSoon: '近日公開',
  manageBtnRemove: '削除',
  manageBtnCancel: 'キャンセル',

  // ── ManagePanel — channel ─────────────────────────────────────────────────
  manageChannelName: '名前',
  manageChannelIndex: 'インデックス',
  manageChannelType: 'タイプ',
  manageChannelHash: 'チャンネルハッシュ',
  manageChannelMessages: 'メッセージ',
  manageChannelSecret: '秘密鍵',
  manageChannelReveal: '秘密鍵を表示',
  manageChannelHide: '秘密鍵を隠す',
  manageChannelTypePublic: 'パブリック',
  manageChannelTypeHashtag: 'ハッシュタグ',
  manageChannelTypePrivate: 'プライベート',
  manageConfirmRemoveChannel: 'このチャンネルを無線機から削除しますか？',
  manageBtnRemoveChannel: 'チャンネルを削除',
  managePublicChannelProtected: 'パブリックチャンネルは削除できません',

  // ── DiscoverPanel ─────────────────────────────────────────────────────────
  discoverTitle: '\uD83D\uDCE1 発見されたノード',
  discoverEmpty:
    'まだ広告が受信されていません。広告が届くとここに表示されます。',
  discoverAdded: '\u2713 追加済み',
  discoverBtnAdd: '追加',
  discoverNodeFallback: 'ノード',

  // ── AddChannelModal ───────────────────────────────────────────────────────
  addChannelTitle: '\u2795 チャンネルを追加',
  addChannelModeCreate: 'プライベートを作成',
  addChannelModeJoinPrivate: 'プライベートに参加',
  addChannelModeJoinHashtag: 'ハッシュタグに参加',
  addChannelHintCreate:
    'ランダムな秘密鍵を生成します。他の人が参加できるよう共有してください。',
  addChannelHintJoinPrivate:
    'チャンネル名と 16 バイトの秘密鍵（16 進数）を入力してください。',
  addChannelHintJoinHashtag:
    'ハッシュタグチャンネルは公開です。同じ名前を入力した人は誰でも参加できます。a〜z、0〜9、ハイフンのみ使用できます。',
  addChannelLabelName: '名前',
  addChannelLabelSecretGenerated: '秘密鍵（生成済み）',
  addChannelBtnRegenerate: '再生成',
  addChannelLabelSecretHex: '秘密鍵（16 進数、16 バイト）',
  addChannelErrorHashtagChars: 'a〜z、0〜9、ハイフンのみ使用してください。',
  addChannelErrorNoName: 'チャンネル名を入力してください。',
  addChannelErrorSecretLen:
    '秘密鍵は 32 桁の 16 進数（16 バイト）である必要があります。',
  addChannelBtnCancel: 'キャンセル',
  addChannelBtnCreate: '作成',
  addChannelBtnJoin: '参加',

  // ── AutoAddSettings ───────────────────────────────────────────────────────
  autoAddTitle: '\u2699 自動追加設定',
  autoAddModeAll: '全て自動追加',
  autoAddModeAllHint: '無線機が聞いたすべてのノードを保存',
  autoAddModeSelected: '選択して自動追加',
  autoAddModeSelectedHint: '選択したノードタイプのみ保存',
  autoAddTypesLabel: '自動追加タイプ',
  autoAddTypeChatUsers: 'チャットユーザー',
  autoAddTypeRepeaters: 'リピーター',
  autoAddTypeRoomServers: 'ルームサーバー',
  autoAddTypeSensors: 'センサー',
  autoAddOverwriteOldest:
    '連絡先がいっぱいのとき、最も古い非お気に入りを上書き',
  autoAddMaxHops: '自動追加最大ホップ数',
  autoAddMaxHopsNoLimit: '制限なし',
  autoAddMaxHopsHint:
    'この範囲のホップ数内で聞こえたノードのみ追加します（0 = 直接のみ、右端 = 制限なし）。',
  autoAddShowPublicKeys: '連絡先詳細に公開鍵を表示',
  autoAddBtnCancel: 'キャンセル',
  autoAddBtnSave: '保存',

  // ── ModalShell ────────────────────────────────────────────────────────────
  modalClose: '閉じる',

  // ── Toast messages (useMeshCore) ──────────────────────────────────────────
  toastNewMessageIn: '{{name}} に新しいメッセージ',
  toastNewMessageFrom: '{{name}} からメッセージ',
  toastConnected: '接続しました \u2014 {{name}}',
  toastDisconnected: '切断しました',
  toastContactNotFound: '連絡先が見つかりません',
  toastRepeaterCantMessage: 'リピーターにはメッセージを送れません',
  toastSendFailed: '送信失敗: {{msg}}',
  toastRouteReset:
    'ルートをリセットしました \u2014 次のメッセージはフラッドします',
  toastRouteResetFailed: 'ルートのリセットに失敗しました: {{msg}}',
  toastAddedToFavorites: 'お気に入りに追加しました',
  toastRemovedFromFavorites: 'お気に入りから削除しました',
  toastFavoriteFailed: 'お気に入りの更新に失敗しました: {{msg}}',
  toastInvalidPublicKey: '無効な公開鍵',
  toastContactAdded: '{{name}} を追加しました',
  toastContactAddFailed: '連絡先の追加に失敗しました: {{msg}}',
  toastContactRemoved: '連絡先を削除しました',
  toastContactRemoveFailed: '連絡先の削除に失敗しました: {{msg}}',
  toastAlreadyJoined: '「{{name}}」には既に参加しています',
  toastChannelsFull: 'すべてのチャンネルスロットが満杯です',
  toastChannelAdded: 'チャンネル「{{name}}」を追加しました',
  toastChannelAddFailed: 'チャンネルの追加に失敗しました: {{msg}}',
  toastChannelRemoved: 'チャンネルを削除しました',
  toastChannelRemoveFailed: 'チャンネルの削除に失敗しました: {{msg}}',
  toastAutoAddSaved: '自動追加設定を保存しました',
  toastAutoAddFailed: '設定の保存に失敗しました: {{msg}}',
  toastConnectionFailed: '接続に失敗しました: {{msg}}',
  toastUsbError: 'USB エラー: {{msg}}',
  toastBleError: 'BLE エラー: {{msg}}',
  toastWifiError: 'WiFi エラー: {{msg}}',

  // ── MessageBubble ─────────────────────────────────────────────────────────
  msgStatusSending: '送信中\u2026',
  msgStatusBroadcastSent:
    'ブロードキャスト送信済み \u2014 チャンネルには配信確認がありません',
  msgStatusSentFlood: 'フラッドで送信済み \u2014 配信確認待ち',
  msgStatusSent: '送信済み \u2014 配信確認待ち',
  msgStatusDeliveredIn: '{{time}} 秒で配信済み',
  msgStatusDelivered: '配信済み',
  msgSNR: 'SNR: {{snr}} dB',
  msgDirect: 'ダイレクト',
  msgHop: '{{n}} ホップ',
  msgHops: '{{n}} ホップ',
  msgHeardByRepeater: 'リピーター {{n}} 台が受信',
  msgHeardByRepeaters: 'リピーター {{n}} 台が受信',

  // ── lib/utils — formatRelative ────────────────────────────────────────────
  relativeJustNow: 'たった今',
  relativeMinutesAgo: '{{n}} 分前',
  relativeHoursAgo: '{{n}} 時間前',
  relativeDaysAgo: '{{n}} 日前',

  // ── lib/utils — ADV_LABEL ─────────────────────────────────────────────────
  advLabelContact: '連絡先',
  advLabelChat: 'チャット',
  advLabelRepeater: 'リピーター',
  advLabelRoomServer: 'ルームサーバー',
};
