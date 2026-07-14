// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback } from 'react';
import { MeshCoreClient } from '@/lib/meshcore/client';
import { MeshConnectError } from '@/lib/meshcore/errors';
import {
  createUSBTransport,
  createBLETransport,
  createWiFiTransport,
} from '@/lib/meshcore/transports';
import {
  useMeshStore,
  channelConvoId,
  directConvoId,
  selectPreferences,
} from '@/store/meshStore';
import { mergeAdvertCache } from '@/lib/map/advertCache';
import {
  loadRadioData,
  saveRadioData,
  deriveStorageKey,
  loadAutomationRules,
  loadAdvertCache,
  saveAdvertCache,
  loadPreferences,
  savePreferences,
} from '@/lib/storage';
import {
  setSecretContext,
  loadPersistedApiKey,
  wipeApiKey,
} from '@/lib/ai/secret';
import { emit, emitAdvertDiff, resetEventBus } from '@/lib/ai/eventBus';
import {
  ROUTE_TYPE_FLOOD,
  PAYLOAD_TYPE_GRP_TXT,
  ADV_TYPE_REPEATER,
  FAVORITE_FLAG,
  ERR_CODE,
  ADVERT_LOC_POLICY,
  MAX_MSG_BYTES,
} from '@/lib/meshcore/constants';
import { splitPathHashes } from '@/lib/meshcore/parsers';
import { toHex, fromHex, bytesEqual, truncateUtf8 } from '@/lib/utils';
import i18n from '@/lib/i18n';
import type {
  ActiveConvo,
  Contact,
  Advert,
  AutoAddConfig,
  RadioParams,
  Message,
  RawRxPacket,
  ITransport,
} from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';

interface PendingAck {
  convoId: string;
  msgId: string;
  timer: ReturnType<typeof setTimeout>;
}

// Counts repeater rebroadcasts of our last channel TX heard in the RX log.
// payloadKey locks onto the first group-text echo after sending; rebroadcasts
// of the same packet carry identical payload bytes.
interface EchoWindow {
  convoId: string;
  msgId: string;
  payloadKey: string | null;
  heard: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

// LoRa round trips are spiky — give the radio's suggested timeout some slack
const ACK_TIMEOUT_GRACE = 1.5;
const MIN_ACK_TIMEOUT_MS = 5000;
const DEFAULT_ACK_TIMEOUT_MS = 30000;
const ECHO_WINDOW_MS = 15000;
const SAVE_DEBOUNCE_MS = 1000;
// Raw RX-log packets are buffered briefly so an inbound channel message can be
// correlated to the repeater path it traveled (the decoded message frame only
// carries the hop count, never the path bytes). Best-effort: matched by hop
// count within this window.
const RX_PATH_BUFFER_MS = 15000;
const RX_PATH_BUFFER_MAX = 32;
// Auto-reconnect backoff (ms), capped at the last entry. Tuned for LoRa radios
// that reboot slowly; we give up after MAX_RECONNECT_ATTEMPTS tries.
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 15000];
const MAX_RECONNECT_ATTEMPTS = 8;
// Upper bound on a single reopen+resync attempt. A transport reopen that hangs
// (e.g. a serial read loop that never unwinds) must not stall the backoff loop
// forever behind the reconnecting overlay — time it out so the loop can retry.
const RECONNECT_ATTEMPT_TIMEOUT_MS = 20000;

// Module scope, not per-instance refs: useMeshCore is mounted by several
// components but the client callbacks are wired once, so send-tracking state
// must be shared across all hook instances.
const pendingAcks = new Map<number, PendingAck>();
// ACK codes whose timeout already fired — kept so a late ACK can upgrade the
// message from 'failed' to 'delivered' instead of being dropped
const expiredAcks = new Map<number, Omit<PendingAck, 'timer'>>();
const EXPIRED_ACK_LIMIT = 50;
let echoWindow: EchoWindow | null = null;
// Recent group-text RX-log packets awaiting correlation to a decoded inbound
// channel message. Each entry holds the ordered per-hop repeater hashes.
const rxPathBuffer: { hopCount: number; path: string[]; at: number }[] = [];
let saveUnsub: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let storageKey: CryptoKey | null = null;
// Independent save subscription/timer for the per-radio advert cache, kept
// separate from message history so a burst of adverts doesn't rewrite the
// (larger) history blob, and vice versa.
let advertSaveUnsub: (() => void) | null = null;
let advertSaveTimer: ReturnType<typeof setTimeout> | null = null;
// Independent save subscription/timer for the per-radio user-preferences blob
// (unit system, contacts view, auto-add config, automation switch, map
// viewport, AI picker). Kept separate from history/advert so a preference
// change writes only the tiny prefs record.
let prefsSaveUnsub: (() => void) | null = null;
let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let syntheticAckSeq = 0;

// Auto-reconnect state. Reopens the last device without a new user gesture
// (the granted handle stays valid for the page session).
// userInitiatedDisconnect distinguishes a deliberate Disconnect from a dropped
// link so only the latter triggers the loop.
let lastTransportFactory: (() => Promise<ITransport>) | null = null;
let userInitiatedDisconnect = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
}

// Rejects if `p` doesn't settle within `ms`. The underlying promise is left to
// dangle — the caller has already moved on — so this only bounds the wait, not
// the work.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Records the active transport as the source the reconnect loop reopens after a
// drop. The granted port/device/URL stays valid for the page session, so no new
// user gesture is needed.
function setReconnectSource(transport: ITransport): void {
  lastTransportFactory = async () => {
    await transport.reopen();
    return transport;
  };
}

// Shared by a deliberate disconnect() and the reconnect loop's give-up path so
// the teardown order lives in one place. `flush` persists the last messages
// first (a deliberate disconnect); the give-up path skips it — the drop already
// flushed and the link's been down since.
function teardownSession(flush = false): void {
  if (flush) {
    const c = useMeshStore.getState().client;
    flushHistory(c);
    flushAdvertCache(c);
    flushPreferences(c);
  }
  clearReconnect();
  lastTransportFactory = null;
  const store = useMeshStore.getState();
  store.client?.destroy();
  clearSessionState();
  // A real teardown (deliberate disconnect or a reconnect that gave up) is the
  // point to overwrite the in-memory API key — not a transient drop, whose
  // reconnect must keep a memory-only key alive for the same radio.
  wipeApiKey();
  store.setClient(null);
  store.reset();
}

// The single gate every send funnels through: a live client whose transport is
// still open AND a fully connected session (not connecting/reconnecting behind
// the overlay). The `!client.closed` check matters because status flips to
// 'connected' before the post-init hydrate awaits finish, so a drop in that
// window leaves status 'connected' while the transport is already dead.
function canTransmit(client: MeshCoreClient | null): client is MeshCoreClient {
  return (
    !!client && !client.closed && useMeshStore.getState().status === 'connected'
  );
}

// Encrypts and writes the current history immediately (bypassing the debounce)
// so a drop or disconnect can't lose the last messages.
function flushHistory(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    saveRadioData(pubkey, storageKey, {
      msgHistory: useMeshStore.getState().msgHistory,
    });
  }
}

// Encrypts and writes the current advert cache immediately (bypassing the
// debounce) so a drop or disconnect can't lose the latest discovered nodes.
function flushAdvertCache(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    saveAdvertCache(pubkey, storageKey, useMeshStore.getState().advertCache);
  }
}

// Encrypts and writes the current per-radio preferences immediately (bypassing
// the debounce) so a drop or disconnect can't lose the latest preference edit.
function flushPreferences(client: MeshCoreClient | null): void {
  const pubkey = client?.selfInfo?.pubkey;
  if (pubkey && storageKey) {
    savePreferences(
      pubkey,
      storageKey,
      selectPreferences(useMeshStore.getState()),
    );
  }
}

// Maps a connect/sync failure to a localized toast message: typed errors carry
// a code that resolves to a specific string; anything else falls back to a
// generic localized message so a raw English error never reaches the user.
function connectErrorMessage(err: unknown): string {
  if (err instanceof MeshConnectError) {
    switch (err.code) {
      case 'radioNoResponse':
        return i18n.t('toast.radioNoResponse');
    }
  }
  return i18n.t('toast.connectionFailed');
}

function clearPendingAcks(): void {
  for (const p of pendingAcks.values()) clearTimeout(p.timer);
  pendingAcks.clear();
}

// Called when a session begins as well as when one ends: a dropped transport
// never reaches disconnect(), so stale timers and the previous radio's save
// subscription must not survive into the next connection
function clearSessionState(): void {
  clearPendingAcks();
  expiredAcks.clear();
  closeEchoWindow();
  rxPathBuffer.length = 0;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveUnsub?.();
  saveUnsub = null;
  if (advertSaveTimer) clearTimeout(advertSaveTimer);
  advertSaveTimer = null;
  advertSaveUnsub?.();
  advertSaveUnsub = null;
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = null;
  prefsSaveUnsub?.();
  prefsSaveUnsub = null;
  storageKey = null;
  // Drop the advert-diff baseline so the next session doesn't replay a prior
  // radio's adverts as "new" the moment automation subscribes.
  resetEventBus();
}

function closeEchoWindow(): void {
  if (echoWindow) clearTimeout(echoWindow.timer);
  echoWindow = null;
}

function openEchoWindow(convoId: string, msgId: string): void {
  closeEchoWindow();
  echoWindow = {
    convoId,
    msgId,
    payloadKey: null,
    heard: new Set(),
    timer: setTimeout(closeEchoWindow, ECHO_WINDOW_MS),
  };
}

// Channel messages are flood-routed group text; only such packets carry a
// meaningful repeater path (a transport-routed packet would surface a wrong
// one). Shared by the echo window and the inbound-correlation buffer.
function isFloodGrpTxt(pkt: RawRxPacket): boolean {
  return (
    pkt.routeType === ROUTE_TYPE_FLOOD &&
    pkt.payloadType === PAYLOAD_TYPE_GRP_TXT &&
    pkt.hopCount >= 1
  );
}

// Correlates a flood group-text RX-log packet to the outbound message whose
// echo window is open, tracking which repeaters rebroadcast it. Returns true
// when the packet is that own-message echo (so it must not also be treated as
// an inbound path candidate).
function handleEchoPacket(pkt: RawRxPacket): boolean {
  const w = echoWindow;
  if (!w || !isFloodGrpTxt(pkt)) return false;
  const key = toHex(pkt.payload);
  if (w.payloadKey === null) w.payloadKey = key;
  else if (w.payloadKey !== key) return false;
  // The repeater that just rebroadcast is the last hash appended to the path
  const lastHop = toHex(pkt.path.slice(-pkt.hashSize));
  if (!w.heard.has(lastHop)) {
    w.heard.add(lastHop);
    useMeshStore.getState().updateMessage(w.convoId, w.msgId, {
      heardByRepeaters: w.heard.size,
      heardVia: Array.from(w.heard),
    });
  }
  return true;
}

// Records a flood group-text RX-log packet so a soon-to-arrive decoded channel
// message can adopt its repeater path. Old entries are pruned by age and count.
function bufferRxPath(pkt: RawRxPacket): void {
  if (!isFloodGrpTxt(pkt)) return;
  const now = Date.now();
  while (rxPathBuffer.length && now - rxPathBuffer[0].at > RX_PATH_BUFFER_MS) {
    rxPathBuffer.shift();
  }
  rxPathBuffer.push({
    hopCount: pkt.hopCount,
    path: splitPathHashes(pkt.path, pkt.hashSize),
    at: now,
  });
  if (rxPathBuffer.length > RX_PATH_BUFFER_MAX) rxPathBuffer.shift();
}

// Best-effort: pops the most recent buffered path whose hop count matches the
// decoded message. Returns undefined when nothing correlates.
function matchRxPath(hopCount: number): string[] | undefined {
  const now = Date.now();
  for (let i = rxPathBuffer.length - 1; i >= 0; i--) {
    const e = rxPathBuffer[i];
    if (now - e.at > RX_PATH_BUFFER_MS) continue;
    if (e.hopCount === hopCount) {
      rxPathBuffer.splice(i, 1);
      return e.path.length ? e.path : undefined;
    }
  }
  return undefined;
}

// Single onLogRx sink: an own-message echo is consumed by the echo window and
// stops there; anything else is buffered as an inbound path candidate. Routing
// echoes away from the buffer keeps our own send's repeaters from being
// mis-attributed to an inbound message that happens to share its hop count.
function handleLogRx(pkt: RawRxPacket): void {
  if (handleEchoPacket(pkt)) return;
  bufferRxPath(pkt);
}

function rememberExpiredAck(
  ackCode: number,
  convoId: string,
  msgId: string,
): void {
  expiredAcks.set(ackCode, { convoId, msgId });
  if (expiredAcks.size > EXPIRED_ACK_LIMIT) {
    expiredAcks.delete(expiredAcks.keys().next().value!);
  }
}

function handleAck(ackCode: number, roundTripMs: number): void {
  const pending = pendingAcks.get(ackCode);
  if (pending) {
    pendingAcks.delete(ackCode);
    clearTimeout(pending.timer);
    useMeshStore.getState().updateMessage(pending.convoId, pending.msgId, {
      status: 'delivered',
      roundTripMs,
    });
    return;
  }
  // Late ACK — the timeout already marked the message 'failed'; upgrade it
  const expired = expiredAcks.get(ackCode);
  if (!expired) return; // unknown or duplicate ACK
  expiredAcks.delete(ackCode);
  useMeshStore.getState().updateMessage(expired.convoId, expired.msgId, {
    status: 'delivered',
    roundTripMs,
  });
}

// Drives the reconnect loop after an unexpected drop: waits out the backoff,
// reopens the same device, and rebuilds the client through the normal connect
// path (so sync/hydration/persistence wiring is identical to a first connect).
// Recurses on failure until MAX_RECONNECT_ATTEMPTS, then gives up cleanly.
function scheduleReconnect(
  connect: (transport: ITransport, isReconnect: boolean) => Promise<boolean>,
): void {
  if (!lastTransportFactory) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    // Capture the name before teardownSession()'s reset() clears it. The drop
    // already flushed history (via onDisconnect) and the link's been down
    // since, so there's nothing new to persist here.
    // deviceName defaults to '' (empty until SELF_INFO), so fall back on any
    // falsy value, not just null/undefined.
    const device =
      useMeshStore.getState().deviceName || i18n.t('common.device');
    teardownSession();
    useMeshStore
      .getState()
      .showToast(i18n.t('toast.reconnectFailed', { device }), 'error');
    return;
  }
  const delay =
    RECONNECT_BACKOFF_MS[
      Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
    ];
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnectAttempt++;
    if (userInitiatedDisconnect) return;
    let ok = false;
    try {
      // Bound the reopen so a hung transport (a read loop that never unwinds)
      // can't freeze the loop here forever — on timeout we fall through to a
      // reschedule like any other failed attempt.
      const transport = await withTimeout(
        lastTransportFactory!(),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
      );
      // Reopening can take seconds (GATT/serial); re-check intent in case the
      // user hit Disconnect while we were awaiting it.
      if (userInitiatedDisconnect) return;
      ok = await connect(transport, true);
    } catch {
      ok = false;
    }
    if (!ok && !userInitiatedDisconnect) scheduleReconnect(connect);
  }, delay);
}

// Shared drop-recovery: persist the last messages, flip the UI into the
// reconnecting state, warn the user, and start the backoff loop. Used by both a
// post-connect drop (the client's onDisconnect) and a mid-sync drop (connect's
// catch) so the two paths can't drift. flushHistory is a no-op before the sync
// wired storageKey, so the mid-sync caller pays nothing for it.
function beginReconnect(
  client: MeshCoreClient,
  connect: (transport: ITransport, isReconnect: boolean) => Promise<boolean>,
): void {
  flushHistory(client);
  flushAdvertCache(client);
  flushPreferences(client);
  const store = useMeshStore.getState();
  store.setStatus('reconnecting');
  // Close any connection-scoped panel so it doesn't reappear on reconnect.
  store.closeConnectionOverlays();
  store.showToast(i18n.t('toast.connectionLost'));
  scheduleReconnect(connect);
}

/**
 * The bridge between {@link MeshCoreClient} and the Zustand store.
 *
 * @returns connect/disconnect entry points and the action handlers components
 * call (send/retry messages, manage contacts and channels, apply settings).
 * @remarks
 * Wires the client's {@link MeshCoreCallbacks} into store updates, owns
 * outbound-message delivery tracking (acks, retries, repeater-echo counting),
 * and handles encrypted history persistence. Send-tracking state lives at
 * module scope because the hook is mounted by several components but the
 * client callbacks are wired once.
 */
export function useMeshCore() {
  const {
    client,
    setClient,
    setStatus,
    setDeviceName,
    setSelfInfo,
    setDeviceInfo,
    setBattery,
    setSyncProgress,
    setContacts,
    setChannels,
    setAdverts,
    cacheAdverts,
    setAutoAddConfig,
    addMessage,
    updateMessage,
    restoreHistory,
    restoreAdvertCache,
    restoreAutomationRules,
    restorePreferences,
    appendCliLine,
    setAdminLogin,
    setRepeaterStatus,
    showToast,
  } = useMeshStore();

  // Installs the client callbacks that funnel radio events into the store and
  // route incoming messages to the right conversation with a toast. `connect`
  // is threaded in so onDisconnect lives in this single assignment — keeping it
  // out (a later mutation) would let any re-wire silently wipe auto-reconnect.
  const wireClient = useCallback(
    (
      c: MeshCoreClient,
      connect: (
        transport: ITransport,
        isReconnect: boolean,
      ) => Promise<boolean>,
    ) => {
      c.callbacks = {
        onSelfInfo: (info) => {
          setDeviceName(info.name);
          setSelfInfo(info);
        },
        onDeviceInfo: (info) => setDeviceInfo(info),
        onBattery: (b) => setBattery(b),
        onSyncProgress: (p) => setSyncProgress(p),
        onContactsUpdated: (contacts) => setContacts({ ...contacts }),
        onChannelsUpdated: (channels) => setChannels({ ...channels }),
        onCliReply: ({ pubkeyPrefix, text }) =>
          appendCliLine(pubkeyPrefix, { own: false, text, ts: Date.now() }),
        onAdvertsUpdated: (adverts) => {
          const next = { ...adverts };
          setAdverts(next);
          // Persist advert metadata so the map keeps discovered nodes across
          // reloads/reconnects, even ones the radio can't hold as contacts.
          cacheAdverts(next);
          // Diffed to per-advert edge events for the automation engine; a no-op
          // when nobody is subscribed (automation off).
          emitAdvertDiff(next);
        },
        onLogRx: handleLogRx,
        onAck: (ackCode, roundTripMs) => {
          handleAck(ackCode, roundTripMs);
          emit({ type: 'ack', ackCode, roundTripMs });
        },
        onMessage: (msg) => {
          if (msg.kind === 'channel' && msg.channelIdx !== undefined) {
            const id = channelConvoId(msg.channelIdx);
            const path =
              msg.pathLen != null && msg.pathLen > 0
                ? matchRxPath(msg.pathLen)
                : undefined;
            const enriched: Message = { ...msg, senderName: undefined, path };
            addMessage(id, enriched);
            const chName =
              c.channels[msg.channelIdx]?.name ||
              i18n.t('common.channelName', { index: msg.channelIdx });
            showToast(i18n.t('toast.newMessageIn', { channel: chName }));
            // Emit after the store update so subscribers see a settled world.
            emit({ type: 'message', msg: enriched });
          } else if (msg.kind === 'direct' && msg.pubkeyPrefix) {
            const id = directConvoId(msg.pubkeyPrefix);
            const contact = c.lookupContact(msg.pubkeyPrefix);
            const enriched: Message = {
              ...msg,
              senderName: contact?.name ?? msg.pubkeyPrefix.slice(0, 8),
            };
            addMessage(id, enriched);
            showToast(
              i18n.t('toast.newMessageFrom', {
                sender: contact?.name ?? msg.pubkeyPrefix.slice(0, 8),
              }),
            );
            emit({ type: 'message', msg: enriched });
          }
        },
        // A drop only triggers the reconnect loop once we're fully connected; a
        // drop mid-sync (status still 'connecting'/'reconnecting') is handled
        // by connect's own success/failure path instead. The user-initiated
        // flag suppresses the loop on a deliberate Disconnect.
        onDisconnect: () => {
          if (
            userInitiatedDisconnect ||
            useMeshStore.getState().status !== 'connected'
          ) {
            return;
          }
          beginReconnect(c, connect);
        },
      };
    },
    [
      setDeviceName,
      setSelfInfo,
      setDeviceInfo,
      setBattery,
      setSyncProgress,
      setContacts,
      setChannels,
      setAdverts,
      cacheAdverts,
      addMessage,
      appendCliLine,
      showToast,
    ],
  );

  // Shared connect path for all transports: build + wire the client, run the
  // initial sync, hydrate settings/history, then subscribe history to be saved.
  const connect = useCallback(
    async function connectImpl(
      transport: ITransport,
      isReconnect = false,
    ): Promise<boolean> {
      // A deliberate Disconnect during the backoff/reopen window sets the
      // intent flag; bail before touching the UI so a late reconnect attempt
      // can't resurrect the session the user just tore down.
      if (isReconnect && userInitiatedDisconnect) return false;
      setStatus(isReconnect ? 'reconnecting' : 'connecting');
      // A fresh connect starts a clean session — reset intent, drop any
      // reconnect loop still pending from a previous session, and overwrite any
      // in-memory API key so a previous radio's key can't carry into this one.
      // A reconnect deliberately skips the wipe so a memory-only key survives.
      if (!isReconnect) {
        userInitiatedDisconnect = false;
        clearReconnect();
        wipeApiKey();
      }
      clearSessionState();
      const c = new MeshCoreClient(transport);
      // True while this session is still worth finishing: the link is up and
      // the user hasn't asked to disconnect. A drop or Disconnect during any of
      // the post-connect awaits makes it false, so the steps below bail
      // instead of wiring persistence or toasting against a torn-down session.
      const sessionAlive = () => !c.closed && !userInitiatedDisconnect;
      try {
        wireClient(c, connectImpl);
        setClient(c);
        await c.init();
        // init() resolves even on a dead transport (its steps are
        // best-effort), so a drop or a user Disconnect during the sync would
        // otherwise flip us to 'connected' with only partial contacts and
        // messages. Bail here instead; the catch routes a drop into the
        // reconnect loop for a full re-sync.
        if (!sessionAlive()) {
          throw new Error('Closed during sync');
        }
        setSyncProgress(null);
        setStatus('connected');
        clearReconnect();
        const deviceName =
          c.selfInfo?.name ?? c.deviceInfo?.model ?? i18n.t('common.device');
        setDeviceName(deviceName);

        // Wire history persistence FIRST — before the best-effort hydrate
        // round-trips below — so the now-'connected' link can't accept a send
        // that lands before storageKey/saveUnsub exist and so goes unpersisted.
        // Skip it if the link dropped or the user disconnected during the
        // post-sync hydrate, so we don't bind a save subscription to a
        // torn-down session.
        const pubkey = c.selfInfo?.pubkey;
        if (pubkey && sessionAlive()) {
          const secrets = Object.values(c.channels)
            .map((ch) => ch.secret)
            .filter((s): s is Uint8Array => s != null && s.length > 0);
          const key = await deriveStorageKey(secrets, pubkey);
          storageKey = key;

          // Reuse the same per-radio key for secret storage, then restore a
          // "remembered" LLM API key, the saved history, any per-radio
          // automation rules, and the advert cache in parallel — independent
          // IndexedDB reads with no ordering dependency.
          setSecretContext(pubkey, key);
          const [, saved, rules, advertCache, prefs] = await Promise.all([
            loadPersistedApiKey(),
            loadRadioData(pubkey, key),
            loadAutomationRules<AutomationRule[]>(pubkey, key),
            loadAdvertCache(pubkey, key),
            loadPreferences(pubkey, key),
          ]);
          if (saved?.msgHistory) restoreHistory(saved.msgHistory);
          restoreAutomationRules(rules ?? []);
          // Fold this radio's saved preferences in before the auto-add hydrate
          // below, so the radio-sourced fields it merges over sit on top of the
          // persisted app-only ones (e.g. showFullPublicKeys). A null/absent
          // blob normalizes to defaults inside the action.
          restorePreferences(prefs);
          // Merge the persisted cache under any adverts already heard during
          // this sync (the live entries are fresher).
          if (advertCache) {
            restoreAdvertCache(
              mergeAdvertCache(
                advertCache,
                useMeshStore.getState().advertCache,
              ),
            );
          }
          // Persist the current cache now — even on a first connect with no
          // stored record — so adverts already heard during this sync (before
          // the subscription below is wired) aren't lost until the next one.
          flushAdvertCache(c);

          saveUnsub = useMeshStore.subscribe((state, prev) => {
            if (state.msgHistory === prev.msgHistory) return;
            // Status flickers arrive in bursts — debounce the full-history
            // encrypt-and-write (flushHistory reads the live storageKey set
            // above, so the debounced and immediate writes stay in lock-step).
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              saveTimer = null;
              flushHistory(c);
            }, SAVE_DEBOUNCE_MS);
          });

          advertSaveUnsub = useMeshStore.subscribe((state, prev) => {
            if (state.advertCache === prev.advertCache) return;
            // Debounce the encrypt-and-write like history, so a busy mesh's
            // stream of adverts coalesces into one write.
            if (advertSaveTimer) clearTimeout(advertSaveTimer);
            advertSaveTimer = setTimeout(() => {
              advertSaveTimer = null;
              flushAdvertCache(c);
            }, SAVE_DEBOUNCE_MS);
          });

          prefsSaveUnsub = useMeshStore.subscribe((state, prev) => {
            // Any of the per-radio preference fields changing triggers one
            // debounced encrypt-and-write of the whole (tiny) prefs blob.
            if (
              state.unitSystem === prev.unitSystem &&
              state.contactView === prev.contactView &&
              state.autoAddConfig === prev.autoAddConfig &&
              state.automationEnabled === prev.automationEnabled &&
              state.mapPrefs === prev.mapPrefs &&
              state.aiPref === prev.aiPref &&
              state.showFullPublicKeys === prev.showFullPublicKeys
            ) {
              return;
            }
            // Disarming automation (kill switch or toggle) is safety-relevant
            // and must persist "for good" — write it immediately rather than
            // risking the debounce window to a tab close or a link drop.
            if (prev.automationEnabled && !state.automationEnabled) {
              if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
              prefsSaveTimer = null;
              flushPreferences(c);
              return;
            }
            if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
            prefsSaveTimer = setTimeout(() => {
              prefsSaveTimer = null;
              flushPreferences(c);
            }, SAVE_DEBOUNCE_MS);
          });
        }

        const batt = await c.getBattery();
        if (batt) setBattery(batt);

        // Hydrate auto-add settings FROM the radio so the app reflects the
        // device's persisted state (shared with any other companion client)
        // instead of overwriting it. The mode always comes from the handshake;
        // the per-type bitmask needs CMD_GET_AUTOADD_CONFIG, which older
        // firmware lacks — when it's absent we keep the existing local values
        // rather than wiping them.
        const mode = c.manualAddMode;
        const bits = await c.readAutoAddBits();
        if (mode || bits) {
          setAutoAddConfig({
            ...useMeshStore.getState().autoAddConfig,
            ...(mode ? { mode } : {}),
            ...(bits ?? {}),
          });
        }

        // Announce success only after the hydrate survived: a drop during it
        // already flipped us back to 'reconnecting' (with its own "connection
        // lost" toast), so a stale "connected" toast here would just confuse.
        if (sessionAlive()) {
          showToast(
            i18n.t(isReconnect ? 'toast.reconnected' : 'toast.connected', {
              device: deviceName,
            }),
            'success',
          );
        }
        return true;
      } catch (err) {
        setSyncProgress(null);
        // A failed reconnect attempt: stay on 'reconnecting' and let the loop
        // reschedule or give up with its own messaging.
        if (isReconnect) return false;
        // User cancelled mid-sync — disconnect() already reset the UI; stay
        // quiet so this in-flight connect doesn't undo it.
        if (userInitiatedDisconnect) return false;
        // The link dropped mid-sync. If the same device can be reopened,
        // recover it via the reconnect loop (a full re-sync) rather than
        // dead-ending at the connect screen with partial data.
        if (c.closed && lastTransportFactory) {
          beginReconnect(c, connectImpl);
          return false;
        }
        // A genuine connect failure (bad handshake, etc.). Tear down the
        // half-built session so the created client/transport can't leak while
        // the UI returns to the connect screen.
        teardownSession();
        showToast(connectErrorMessage(err), 'error');
        return false;
      }
    },
    [
      setStatus,
      setClient,
      setDeviceName,
      setBattery,
      setSyncProgress,
      showToast,
      wireClient,
      restoreHistory,
      restoreAdvertCache,
      restoreAutomationRules,
      restorePreferences,
      setAutoAddConfig,
    ],
  );

  /** Prompts for a USB serial port and connects. */
  const connectUSB = useCallback(async () => {
    try {
      const transport = await createUSBTransport();
      setReconnectSource(transport);
      await connect(transport);
    } catch (err) {
      showToast(
        i18n.t('toast.usbError', { error: (err as Error).message }),
        'error',
      );
    }
  }, [connect, showToast]);

  /** Prompts for a BLE companion and connects. */
  const connectBLE = useCallback(async () => {
    try {
      const transport = await createBLETransport();
      setReconnectSource(transport);
      await connect(transport);
    } catch (err) {
      showToast(
        i18n.t('toast.bleError', { error: (err as Error).message }),
        'error',
      );
    }
  }, [connect, showToast]);

  /** Connects to a radio's WiFi WebSocket bridge at `url`. */
  const connectWiFi = useCallback(
    async (url: string) => {
      try {
        const transport = await createWiFiTransport(url);
        setReconnectSource(transport);
        await connect(transport);
      } catch (err) {
        showToast(
          i18n.t('toast.wifiError', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [connect, showToast],
  );

  /**
   * Persists history, tears down the client and session state, and resets the
   * store.
   */
  const disconnect = useCallback(() => {
    // Mark intent first so an in-flight or pending reconnect can't bounce the
    // session back up; also cancels a drop's GATT/close event from looping.
    userInitiatedDisconnect = true;
    teardownSession(true);
    showToast(i18n.t('toast.disconnected'));
  }, [showToast]);

  // Core send routine for an existing message bubble: transmits to a channel or
  // contact, then tracks delivery — opens a repeater-echo window for channels,
  // or registers an ack timeout for direct messages (with a synthetic key when
  // the radio gives no receipt, so the bubble can't hang at 'sent' forever).
  const transmit = useCallback(
    async (
      convo: ActiveConvo,
      msgId: string,
      text: string,
      attempt: number,
      resetRoute = false,
    ) => {
      // The single gate every send funnels through: never transmit into a link
      // that isn't fully connected (defense in depth behind the overlay's
      // `inert`).
      if (!canTransmit(client)) return;
      updateMessage(convo.id, msgId, { status: 'sending', attempt });
      try {
        if (convo.kind === 'channel') {
          await client.sendChannelMessage(Number(convo.rawId), text);
          updateMessage(convo.id, msgId, { status: 'sent' });
          openEchoWindow(convo.id, msgId);
          return;
        }
        const contact = client.contacts[convo.rawId as string];
        if (!contact) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          showToast(i18n.t('toast.contactNotFound'), 'error');
          return;
        }
        if (contact.advType === ADV_TYPE_REPEATER) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          showToast(i18n.t('toast.repeaterCantMessage'), 'error');
          return;
        }
        if (resetRoute) {
          try {
            await client.resetPath(contact);
          } catch {}
        }
        const receipt = await client.sendDirectMessage(contact, text, attempt);
        updateMessage(convo.id, msgId, {
          status: 'sent',
          routeFlood: receipt?.routeFlood,
        });
        // Without a receipt (OK-only reply) no ACK can ever match — a
        // synthetic negative key still gives the message a timeout so it
        // can't sit at 'sent' forever
        const ackKey = receipt ? receipt.expectedAck : --syntheticAckSeq;
        const timeoutMs = receipt
          ? Math.max(
              MIN_ACK_TIMEOUT_MS,
              receipt.suggestedTimeoutMs * ACK_TIMEOUT_GRACE,
            )
          : DEFAULT_ACK_TIMEOUT_MS;
        const timer = setTimeout(() => {
          pendingAcks.delete(ackKey);
          if (ackKey >= 0) rememberExpiredAck(ackKey, convo.id, msgId);
          const current = useMeshStore
            .getState()
            .msgHistory[convo.id]?.find((m) => m.id === msgId);
          // A late ACK from an earlier attempt may have already delivered it
          if (current?.status !== 'delivered') {
            updateMessage(convo.id, msgId, { status: 'failed' });
          }
        }, timeoutMs);
        pendingAcks.set(ackKey, { convoId: convo.id, msgId, timer });
      } catch (err) {
        updateMessage(convo.id, msgId, { status: 'failed' });
        showToast(
          i18n.t('toast.sendFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, updateMessage, showToast],
  );

  /**
   * Adds an outgoing message bubble to the active conversation and transmits
   * it.
   */
  const sendMessage = useCallback(
    async (text: string, activeConvo: ActiveConvo | null) => {
      // Check before the optimistic bubble so a blocked send leaves no orphan
      // 'sending' message; transmit() re-checks too as the authoritative gate.
      if (!canTransmit(client) || !activeConvo || !text.trim()) return;
      const trimmed = text.trim();
      const msgId = crypto.randomUUID();
      addMessage(activeConvo.id, {
        id: msgId,
        kind: activeConvo.kind,
        text: trimmed,
        own: true,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'sending',
      });
      await transmit(activeConvo, msgId, trimmed, 0);
    },
    [client, addMessage, transmit],
  );

  /**
   * Re-sends a failed message, bumping its attempt counter.
   *
   * @param resetRoute - if true, clears the contact's route first so the resend
   * floods.
   */
  const retryMessage = useCallback(
    async (msg: Message, convo: ActiveConvo | null, resetRoute = false) => {
      if (
        !canTransmit(client) ||
        !convo ||
        !msg.id ||
        msg.status !== 'failed'
      ) {
        return;
      }
      await transmit(
        convo,
        msg.id,
        msg.text,
        (msg.attempt ?? 0) + 1,
        resetRoute,
      );
    },
    [client, transmit],
  );

  /**
   * Resets a contact's route on the radio so its next message floods to
   * rediscover a path.
   */
  const resetContactPath = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      try {
        await client.resetPath(contact);
        showToast(i18n.t('toast.routeReset'), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.routeResetFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Flips a contact's favorite flag on the radio. */
  const toggleFavorite = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      const fav = (contact.flags & FAVORITE_FLAG) === 0;
      try {
        await client.setFavorite(contact, fav);
        showToast(
          fav
            ? i18n.t('toast.addedToFavorites')
            : i18n.t('toast.removedFromFavorites'),
        );
      } catch (err) {
        showToast(
          i18n.t('toast.favoriteUpdateFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Logs in to a repeater/room server for remote admin. Marks the session
   * `pending`, then the server-granted `admin`/`guest` level on success or
   * `loggedOut` on failure (surfaced via toast). The granted level comes from
   * the login response, not the caller — the server decides it from the
   * password. The password is never stored, only the resulting access level.
   */
  const repeaterLogin = useCallback(
    async (contact: Contact, password: string) => {
      if (!canTransmit(client)) return;
      setAdminLogin(contact.pubkeyPrefix, 'pending');
      try {
        const access = await client.login(contact, password);
        // A drop during login can tear the session down; don't revive it.
        if (!canTransmit(client)) return;
        setAdminLogin(contact.pubkeyPrefix, access);
      } catch (err) {
        // A disconnect/drop rejects the pending login and runs its own
        // teardown; don't clobber that outcome with a stale login error. A full
        // disconnect already cleared the slice (leave it gone); a transient
        // drop keeps the entry, so just clear its `pending` spinner silently.
        if (!canTransmit(client)) {
          if (useMeshStore.getState().adminSessions[contact.pubkeyPrefix]) {
            setAdminLogin(contact.pubkeyPrefix, 'loggedOut');
          }
          return;
        }
        setAdminLogin(contact.pubkeyPrefix, 'loggedOut');
        showToast(
          i18n.t('toast.repeaterLoginFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, setAdminLogin, showToast],
  );

  /** Requests a repeater's live status and stores it on its admin session. */
  const repeaterStatus = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      try {
        const status = await client.requestStatus(contact);
        // Skip a stale update if the session dropped mid-request.
        if (!canTransmit(client)) return;
        setRepeaterStatus(contact.pubkeyPrefix, status);
      } catch (err) {
        // A disconnect rejects the in-flight request; its teardown owns the
        // user-facing toast, so suppress this stale operation error.
        if (!canTransmit(client)) return;
        showToast(
          i18n.t('toast.repeaterStatusFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, setRepeaterStatus, showToast],
  );

  /**
   * Sends a remote-admin CLI command to a repeater. Echoes the outgoing line to
   * the transcript immediately; the reply arrives later via `onCliReply`.
   */
  const repeaterCli = useCallback(
    async (contact: Contact, cmd: string) => {
      if (!canTransmit(client)) return;
      // `sendCliCommand` truncates to MAX_MSG_BYTES UTF-8 bytes, so normalize
      // once and echo exactly what the repeater will receive.
      const line = truncateUtf8(cmd, MAX_MSG_BYTES);
      appendCliLine(contact.pubkeyPrefix, {
        own: true,
        text: line,
        ts: Date.now(),
      });
      try {
        await client.sendCliCommand(contact, line);
      } catch (err) {
        // A disconnect rejects the pending send; its teardown owns the toast,
        // so only surface failures from a still-live session.
        if (!canTransmit(client)) return;
        showToast(
          i18n.t('toast.repeaterCliFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, appendCliLine, showToast],
  );

  /** Saves a heard advert as a contact on the radio. */
  const addDiscoveredContact = useCallback(
    async (advert: Advert) => {
      if (!canTransmit(client)) return;
      const pubkeyBytes = fromHex(advert.pubkey, 32);
      if (!pubkeyBytes) {
        showToast(i18n.t('toast.invalidPublicKey'), 'error');
        return;
      }
      const contact: Contact = {
        pubkey: advert.pubkey,
        pubkeyPrefix: advert.pubkeyPrefix,
        pubkeyBytes,
        advType: advert.advType,
        flags: 0,
        outPathLen: 255,
        path: new Uint8Array(0),
        name: advert.name,
        lastAdvert: advert.lastHeard,
        advLat: advert.advLat,
        advLon: advert.advLon,
      };
      try {
        await client.addContact(contact);
        showToast(
          i18n.t('toast.added', {
            name: advert.name || advert.pubkeyPrefix,
          }),
          'success',
        );
      } catch (err) {
        showToast(
          i18n.t('toast.addContactFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Adds a contact from a shared link or manual key entry (name + 64-hex
   * public key + advert type). Builds the same {@link Contact} shape as
   * {@link addDiscoveredContact} and writes it via the
   * {@link CMD.ADD_UPDATE_CONTACT} path — the route the official app uses for
   * QR/manual imports (`ImportContact` is reserved for whole signed advert
   * packets, which a name+key+type contact doesn't carry).
   */
  const importContact = useCallback(
    async ({
      name,
      pubkey,
      advType,
    }: {
      name: string;
      pubkey: string;
      advType: number;
    }) => {
      if (!canTransmit(client)) return;
      const pubkeyBytes = fromHex(pubkey, 32);
      if (!pubkeyBytes) {
        showToast(i18n.t('toast.invalidPublicKey'), 'error');
        return;
      }
      const pubkeyPrefix = toHex(pubkeyBytes.slice(0, 6));
      if (client.contacts[pubkeyPrefix]) {
        showToast(
          i18n.t('toast.contactAlreadyAdded', {
            name: client.contacts[pubkeyPrefix].name || pubkeyPrefix,
          }),
        );
        return;
      }
      const contact: Contact = {
        pubkey: toHex(pubkeyBytes),
        pubkeyPrefix,
        pubkeyBytes,
        advType,
        flags: 0,
        outPathLen: 255,
        path: new Uint8Array(0),
        name,
      };
      try {
        await client.addContact(contact);
        showToast(
          i18n.t('toast.added', { name: name || pubkeyPrefix }),
          'success',
        );
      } catch (err) {
        showToast(
          i18n.t('toast.addContactFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Shares a contact via a zero-hop advert: the radio re-broadcasts that
   * contact's advert to direct neighbors so they can hear and add it.
   */
  const shareContact = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      try {
        await client.shareContact(contact);
        showToast(i18n.t('toast.advertSent'), 'success');
      } catch (err) {
        // The radio rebroadcasts a cached copy of the contact's signed advert;
        // if it never heard one over the air (e.g. a QR-imported contact) it
        // returns TABLE_FULL with nothing to send. Surface that distinct case.
        if ((err as { code?: number }).code === ERR_CODE.TABLE_FULL) {
          showToast(i18n.t('toast.advertNoRecent'), 'error');
        } else {
          showToast(
            i18n.t('toast.advertFailed', { error: (err as Error).message }),
            'error',
          );
        }
      }
    },
    [client, showToast],
  );

  /**
   * Advertises this node to the mesh, choosing flood (whole mesh) or zero-hop
   * (direct neighbors only). Low-risk and not a persistent device change, so it
   * just toasts the outcome.
   */
  const advertiseSelf = useCallback(
    async (flood: boolean) => {
      if (!canTransmit(client)) return;
      try {
        await client.sendSelfAdvert(flood);
        showToast(
          flood
            ? i18n.t('toast.selfAdvertFloodSent')
            : i18n.t('toast.selfAdvertZeroHopSent'),
          'success',
        );
      } catch (err) {
        showToast(
          i18n.t('toast.selfAdvertFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Deletes a contact from the radio. */
  const removeContact = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      try {
        await client.removeContact(contact);
        showToast(i18n.t('toast.contactRemoved'));
      } catch (err) {
        showToast(
          i18n.t('toast.removeContactFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Joins or creates a channel, placing it in the lowest free slot (1–7).
   *
   * @remarks No-ops with a toast if the secret already matches a joined
   * channel, or if all private slots are full.
   */
  const addChannel = useCallback(
    async (name: string, secret: Uint8Array) => {
      if (!canTransmit(client)) return;
      // A channel is identified by its secret — don't create a duplicate slot
      const existing = Object.values(client.channels).find(
        (ch) => ch.secret && bytesEqual(ch.secret, secret),
      );
      if (existing) {
        showToast(
          i18n.t('toast.alreadyJoined', { name: existing.name || name }),
        );
        return;
      }
      // Indices 1-7 are private channels; pick the lowest free slot
      let idx = -1;
      for (let i = 1; i <= 7; i++) {
        if (!client.channels[i]) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        showToast(i18n.t('toast.allSlotsFull'), 'error');
        return;
      }
      try {
        await client.setChannel(idx, name, secret);
        showToast(i18n.t('toast.channelAdded', { name }), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.addChannelFailed', { error: (err as Error).message }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /** Removes a channel slot (rejected by the client for the Public channel). */
  const removeChannel = useCallback(
    async (idx: number) => {
      if (!canTransmit(client)) return;
      try {
        await client.removeChannel(idx);
        showToast(i18n.t('toast.channelRemoved'));
      } catch (err) {
        showToast(
          i18n.t('toast.removeChannelFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, showToast],
  );

  /**
   * Renames the radio on the device; the store updates via `onSelfInfo`.
   *
   * @returns whether the write succeeded, so the caller can keep its editor
   * open (preserving the typed name) on failure.
   */
  const setNodeName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      try {
        await client.setNodeName(name);
        showToast(i18n.t('toast.nodeNameSaved'), 'success');
        return true;
      } catch (err) {
        showToast(
          i18n.t('toast.nodeNameSaveFailed', { error: (err as Error).message }),
          'error',
        );
        return false;
      }
    },
    [client, showToast],
  );

  /**
   * Writes this radio's advertised location to the device; the store updates
   * via `onSelfInfo`.
   *
   * @param latDeg - latitude in decimal degrees.
   * @param lonDeg - longitude in decimal degrees.
   * @returns whether the write succeeded, so the caller can keep its editor
   * open (preserving the typed values) on failure.
   */
  const setLocation = useCallback(
    async (latDeg: number, lonDeg: number): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      try {
        await client.setLocation(latDeg, lonDeg);
        showToast(i18n.t('toast.locationSaved'), 'success');
        return true;
      } catch (err) {
        showToast(
          i18n.t('toast.locationSaveFailed', { error: (err as Error).message }),
          'error',
        );
        return false;
      }
    },
    [client, showToast],
  );

  /**
   * Sets where the radio's adverts take their location from — nothing, the
   * stored fixed coordinate, or the radio's own GPS module.
   *
   * @returns whether the write succeeded, so the caller can revert its
   * selection on failure.
   */
  const setLocationPolicy = useCallback(
    async (policy: number): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      try {
        await client.setLocationPolicy(policy);
        showToast(i18n.t('toast.sharePositionSaved'), 'success');
        return true;
      } catch (err) {
        showToast(
          i18n.t('toast.sharePositionSaveFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
        return false;
      }
    },
    [client, showToast],
  );

  /**
   * Sets the radio's advert location *source* (Fixed vs GPS) by toggling its
   * GPS module (`SET_CUSTOM_VAR` `gps`) — the field the radio actually uses to
   * decide whether an advert carries the live fix or the stored fixed
   * coordinate, and the one the official app's Position Settings → GPS Mode
   * reads. While location is being advertised (policy not `NONE`), the
   * `advert_loc_policy` is realigned to `SHARE`/`PREFS` so the choice also
   * round-trips on repeater/sensor firmware, where those values differ. When
   * off, only the GPS var is written so the source is remembered for next time.
   *
   * The policy realignment runs first: its prefs-guard throw (older firmware
   * whose `SELF_INFO` was too short to echo the other prefs) is the one
   * deterministic failure here, so surfacing it before the GPS module is
   * touched keeps a rejected write from leaving the source and policy out of
   * sync.
   *
   * @returns whether every needed write succeeded.
   */
  const setLocationSource = useCallback(
    async (useGps: boolean): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      try {
        const policy = client.selfInfo?.advLocPolicy;
        if (policy !== undefined && policy !== ADVERT_LOC_POLICY.NONE) {
          await client.setLocationPolicy(
            useGps ? ADVERT_LOC_POLICY.SHARE : ADVERT_LOC_POLICY.PREFS,
          );
        }
        await client.setGpsEnabled(useGps);
        // Re-read SELF_INFO so the map's self marker reflects the source just
        // picked: the newly-active advertised coordinate (a GPS module's live
        // fix, or the stored fixed one) is only reported on a fresh read, not
        // echoed from the write. Best-effort — the switch itself succeeded.
        await client.refreshSelfInfo().catch(() => {});
        showToast(i18n.t('toast.locationSourceSaved'), 'success');
        return true;
      } catch (err) {
        showToast(
          i18n.t('toast.locationSourceSaveFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
        return false;
      }
    },
    [client, showToast],
  );

  /**
   * Writes the radio parameters to the device. Frequency/bandwidth/SF/CR go in
   * one `SET_RADIO_PARAMS` command and TX power in a separate `SET_TX_POWER`;
   * each is sent only when its value actually changed, and the store updates
   * via `onSelfInfo` as each write lands. A failed write leaves the radio's
   * other (already-applied) values intact and reports the error.
   *
   * @returns whether every needed write succeeded, so the caller can keep its
   * editor open on failure.
   */
  const applyRadioParams = useCallback(
    async (params: RadioParams): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      const cur = client.selfInfo;
      const radioChanged =
        cur?.radioFreq !== params.radioFreq ||
        cur?.radioBw !== params.radioBw ||
        cur?.radioSf !== params.radioSf ||
        cur?.radioCr !== params.radioCr;
      const powerChanged = cur?.txPower !== params.txPower;
      try {
        if (radioChanged) {
          await client.setRadioParams(
            params.radioFreq,
            params.radioBw,
            params.radioSf,
            params.radioCr,
          );
        }
        if (powerChanged) await client.setTxPower(params.txPower);
        showToast(i18n.t('toast.radioParamsSaved'), 'success');
        return true;
      } catch (err) {
        showToast(
          i18n.t('toast.radioParamsSaveFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
        return false;
      }
    },
    [client, showToast],
  );

  /**
   * Reboots the radio. The command drops the transport link as the device
   * restarts; we deliberately do *not* call {@link disconnect} (which would set
   * `userInitiatedDisconnect` and suppress reconnect). Instead the drop flows
   * through the client's `onDisconnect` into the auto-reconnect loop, which
   * recovers the session once the radio comes back. Just toast "Rebooting…".
   */
  const rebootDevice = useCallback(async () => {
    if (!canTransmit(client)) return;
    try {
      await client.reboot();
      showToast(i18n.t('toast.rebooting'));
    } catch (err) {
      showToast(
        i18n.t('toast.rebootFailed', { error: (err as Error).message }),
        'error',
      );
    }
  }, [client, showToast]);

  /** Persists auto-add settings locally and writes them to the radio. */
  const applyAutoAddConfig = useCallback(
    async (cfg: AutoAddConfig) => {
      // Persist locally only after the radio write succeeds, so a failed write
      // doesn't leave the app showing settings the radio never accepted. With
      // no transmittable link (disconnected or mid-reconnect), just remember
      // the preference locally.
      if (!canTransmit(client)) {
        setAutoAddConfig(cfg);
        return;
      }
      try {
        await client.setAutoAddPrefs(cfg);
        setAutoAddConfig(cfg);
        showToast(i18n.t('toast.settingsSaved'), 'success');
      } catch (err) {
        showToast(
          i18n.t('toast.saveSettingsFailed', {
            error: (err as Error).message,
          }),
          'error',
        );
      }
    },
    [client, setAutoAddConfig, showToast],
  );

  return {
    connectUSB,
    connectBLE,
    connectWiFi,
    disconnect,
    sendMessage,
    retryMessage,
    resetContactPath,
    toggleFavorite,
    repeaterLogin,
    repeaterStatus,
    repeaterCli,
    addDiscoveredContact,
    importContact,
    shareContact,
    advertiseSelf,
    removeContact,
    addChannel,
    removeChannel,
    setNodeName,
    setLocation,
    setLocationPolicy,
    setLocationSource,
    applyRadioParams,
    applyAutoAddConfig,
    rebootDevice,
  };
}
