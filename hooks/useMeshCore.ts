// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useRef } from 'react';
import { MeshCoreClient } from '@/lib/meshcore/client';
import { PickerDismissedError, PushTimeoutError } from '@/lib/meshcore/errors';
import {
  createUSBTransport,
  createBLETransport,
  createWiFiTransport,
} from '@/lib/meshcore/transports';
import {
  useMeshStore,
  channelConvoId,
  directConvoId,
  roomConvoId,
  openConvo,
  isConvoVisible,
  canPostToRoom,
  selectPreferences,
} from '@/store/meshStore';
import { mergeAdvertCache } from '@/lib/map/advertCache';
import {
  hydrateBurnerSession,
  settleIdentityOnConnect,
} from '@/lib/identity/connect';
import { registeredIdentityKey } from '@/lib/identity/storageRoot';
import {
  loadRadioData,
  loadAutomationRules,
  loadAdvertCache,
  loadPreferences,
  hasSeedMarker,
} from '@/lib/storage';
import {
  expectSecretContext,
  releaseSecretContext,
  setSecretContext,
  loadPersistedApiKey,
  wipeApiKey,
} from '@/lib/ai/secret';
import { emit, emitAdvertDiff } from '@/lib/ai/eventBus';
import { canTransmit } from '@/lib/session/guards';
import {
  connectErrorCode,
  clearSessionState,
  teardownSession,
} from '@/lib/session/lifecycle';
import {
  claimUnsavedRestore,
  deriveSessionKey,
  flushAdvertCache,
  flushSessionAsync,
  followChannelSecrets,
  retryUnsavedRestore,
  setStorageKey,
  wirePersistence,
} from '@/lib/session/persistence';
import {
  beginReconnect,
  clearReconnect,
  clearUserDisconnect,
  hasReconnectSource,
  isUserDisconnect,
  markUserDisconnect,
  retryReconnectNow as runRetryReconnectNow,
  setReconnectSource,
  type ConnectFn,
  type ReconnectDeps,
} from '@/lib/session/reconnect';
import { handleAck, startDeliveryCycle } from '@/lib/session/delivery';
import {
  handleLogRx,
  matchRxPath,
  openEchoWindow,
} from '@/lib/session/rxCorrelation';
import {
  CliTimeoutError,
  handleCliReply,
  rejectCliWaitersFor,
  repeaterCliRequest as sendCliRequest,
  runStatusRequest,
} from '@/lib/session/cliQueue';
import { readNeighbors } from '@/lib/session/neighbors';
import {
  ADV_TYPE_ROOM,
  FAVORITE_FLAG,
  ERR_CODE,
  ADVERT_LOC_POLICY,
  MAX_CHANNEL_SLOTS,
} from '@/lib/meshcore/constants';
import { saveRepeaterCred } from '@/lib/meshcore/adminCreds';
import { isErrorReply } from '@/lib/meshcore/repeaterConfig';
import {
  toHex,
  fromHex,
  bytesEqual,
  splitChannelMessage,
  mentionsSelf,
} from '@/lib/utils';
import { showNotification, playNotifyTone } from '@/lib/notify';
import i18n from '@/lib/i18n';
import type {
  ActiveConvo,
  Contact,
  Advert,
  AutoAddConfig,
  RadioParams,
  Message,
  LoginKind,
  RepeaterLoginOutcome,
  ITransport,
  Neighbor,
  AclEntry,
} from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';

/**
 * How a fire-and-forget repeater CLI send ended.
 *
 * - `'ok'` — the node replied, and the reply was not an error.
 * - `'timeout'` — the send was accepted but no reply arrived in time. Success
 *   only for the verbs that never reply by design (`reboot`, `poweroff`); the
 *   caller owns that judgement, since it alone knows which verb it sent.
 * - `'error'` — the send failed, the session was gone, or the node rejected
 *   the command. Already surfaced as a notification.
 */
export type RepeaterCliOutcome = 'ok' | 'timeout' | 'error';

/**
 * The outcome of a write to the connected radio.
 *
 * @remarks
 * A discriminated union, so a failure cannot be constructed without saying
 * why. The reason travels with the result rather than going straight to a
 * notification, so it can live next to the field that failed for as long as it
 * is wrong — a transient line is gone by the time the user looks.
 */
export type WriteResult = { ok: true } | { ok: false; error: string };

// The reconnect loop needs the session's own connect path, and a way to hand
// the session back once it gives up — injected here rather than imported by
// `lib/session/reconnect.ts`, which must not depend on the lifecycle it ends.
function reconnectDeps(connect: ConnectFn): ReconnectDeps {
  return { connect, teardown: () => teardownSession() };
}

// When a message reached us, in epoch seconds. Our clock rather than the
// frame's: a sender's timestamp is its own RTC — the firmware notes it "could
// be wrong" — and the bar counts up from the moment it landed here.
function arrivedAt(): number {
  return Math.floor(Date.now() / 1000);
}

// How many messages the background drain has handed over since it started.
// One summary stands in for every per-message notification the drain
// suppresses, and this is the count it reports. Module scope like the rest of
// the session's bookkeeping: the hook mounts in several components but wires
// the client callbacks once.
let backlogDelivered = 0;

// A message that landed unread raises a desktop notification when the tab
// isn't the one the user is looking at, the radio's notification preference
// covers it, and permission has been granted. The visibility test is the same
// `isConvoVisible` the unread flag uses, so a notification and the unread
// badge can never disagree; `windowFocused` additionally keeps a message that
// merely arrived on another *page* of a focused tab quiet, where the drawer is
// already the right cue.
function notifyArrival(convo: ActiveConvo, sender: string, body: string): void {
  const state = useMeshStore.getState();
  const { mode, sound } = state.notifyPref;
  if (mode === 'off' || state.windowFocused) return;
  if (
    mode === 'mentions' &&
    convo.kind !== 'direct' &&
    !mentionsSelf(body, state.deviceName)
  ) {
    return;
  }
  const client = state.client;
  const shown = showNotification({
    title:
      convo.kind === 'direct'
        ? sender
        : i18n.t('notify.titleIn', { sender, convo: convo.label }),
    // Unwrap `@[Name]` to `@Name`, matching how the bubble renders a mention —
    // the notification body is plain text and can't style the token.
    body: body.replace(/@\[([^\]]+)\]/g, '@$1'),
    tag: convo.id,
    onClick: () => {
      // The banner outlives the session it was raised in, and a conversation
      // id names a channel slot or a key prefix rather than a radio — opening
      // it after a disconnect or against a different radio would select a
      // thread the user never had.
      if (useMeshStore.getState().client !== client) return;
      openConvo(convo);
      useMeshStore.getState().setView('chat');
    },
  });
  if (shown && sound) playNotifyTone();
}

/**
 * The bridge between {@link MeshCoreClient} and the Zustand store.
 *
 * @returns connect/disconnect entry points and the action handlers components
 * call (send/retry messages, manage contacts and channels, apply settings).
 * @remarks
 * Wires the client's {@link MeshCoreCallbacks} into store updates and drives
 * the per-subsystem session modules under `lib/session/` — delivery tracking,
 * RX correlation, the repeater CLI queue, persistence, and the reconnect loop.
 * Those modules keep their state at module scope because the hook is mounted by
 * several components but the client callbacks are wired once.
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
    setLatestInbound,
    setBacklogDraining,
    updateMessage,
    restoreHistory,
    restoreAdvertCache,
    restoreAutomationRules,
    restorePreferences,
    setAdminLogin,
    setRepeaterStatus,
    setNodeTelemetry,
    setActiveConvo,
    setDraft,
    notify,
    clearNotifications,
    dismissConvoNotifications,
    retractNotification,
    setConnectError,
    setLastConnectFailure,
  } = useMeshStore();

  // Installs the client callbacks that funnel radio events into the store and
  // route incoming messages to the right conversation. `connect`
  // is threaded in so onDisconnect lives in this single assignment — keeping it
  // out (a later mutation) would let any re-wire silently wipe auto-reconnect.
  const wireClient = useCallback(
    (c: MeshCoreClient, connect: ConnectFn) => {
      c.callbacks = {
        onSelfInfo: (info) => {
          setDeviceName(info.name);
          setSelfInfo(info);
        },
        onDeviceInfo: (info) => setDeviceInfo(info),
        onBattery: (b) => setBattery(b),
        onSyncProgress: (p) => setSyncProgress(p),
        onBacklogDraining: (draining) => {
          setBacklogDraining(draining);
          if (draining) {
            backlogDelivered = 0;
            return;
          }
          const count = backlogDelivered;
          backlogDelivered = 0;
          // A drop or a Disconnect ends the drain loop too, and that session's
          // summary has nobody left to read it — it would land on the connect
          // screen reporting a radio that is already gone. The test is the
          // session, not the status: `init` hands back before
          // `setStatus('connected')`, and the key derivation in between is
          // PBKDF2 at 100k iterations, so a short overflow drain can finish
          // inside that window and a status test would silently drop its
          // summary. `c` stays the store's client from before `init` until a
          // teardown replaces it, which is exactly the span that should
          // report.
          if (count > 0 && useMeshStore.getState().client === c && !c.closed) {
            notify({
              level: 'success',
              text: i18n.t('notify.caughtUp', { count }),
              key: 'caughtUp',
            });
          }
        },
        onContactsUpdated: (contacts) => setContacts({ ...contacts }),
        onContactsFull: () =>
          notify({
            level: 'warning',
            text: i18n.t('notify.contactsFull'),
            key: 'contactsFull',
          }),
        onContactsIncomplete: () =>
          notify({
            level: 'warning',
            text: i18n.t('notify.contactsIncomplete'),
            key: 'contactsIncomplete',
          }),
        onContactsSynced: () => retractNotification('contactsIncomplete'),
        onChannelsUpdated: (channels) => {
          setChannels({ ...channels });
          followChannelSecrets(channels);
        },
        onCliReply: ({ pubkeyPrefix, text }) =>
          handleCliReply(c, pubkeyPrefix, text),
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
            // Read before addMessage, which is what makes it visible.
            const state = useMeshStore.getState();
            const visible = isConvoVisible(state, id);
            addMessage(id, enriched);
            if (state.backlogDraining) backlogDelivered++;
            // `c.init()` drains the radio's backlog while the connect screen is
            // still up, where a "go to this conversation" cue leads nowhere —
            // the action bar isn't mounted either. Those messages stay unread
            // instead.
            if (state.status === 'connected') {
              const chName =
                c.channels[msg.channelIdx]?.name ||
                i18n.t('common.channelName', { index: msg.channelIdx });
              const { sender, body } = splitChannelMessage(msg.text);
              const convo: ActiveConvo = {
                kind: 'channel',
                id,
                rawId: msg.channelIdx,
                label: chName,
              };
              setLatestInbound({
                convo,
                // No `sender: ` prefix means the author is unknowable. Say so
                // rather than inventing one: the bar names the conversation
                // instead, the way the notice below switches to `newMessageIn`.
                sender: sender || null,
                at: arrivedAt(),
              });
              // The quick link takes every arrival; the drawer row and the
              // desktop banner still only cover a conversation that is off
              // screen — and, while the backlog drains, not even then. That
              // drain runs past 'connected', so without this the exemption
              // above would stop at the connect-time pass and the rest of a
              // 300-message queue would take a row each, pushing every other
              // notice out of a 50-row drawer. One summary covers them when
              // the drain ends.
              if (!visible && !state.backlogDraining) {
                const text = sender
                  ? i18n.t('notify.newMessageInFrom', {
                      sender,
                      channel: chName,
                    })
                  : i18n.t('notify.newMessageIn', { channel: chName });
                notify({
                  level: 'info',
                  text,
                  // The conversation alone is too coarse a key: a channel
                  // arrival renders as "{sender} in {channel}", so merging on
                  // it would relabel the older senders' rows as the newest
                  // one. The text alone is too coarse the other way, since two
                  // contacts can share a name.
                  key: `${convo.id}\n${text}`,
                  convo,
                  // Drawer row only: the bar already carries the newest
                  // arrival as a standing quick link, and a mesh under load
                  // would let arrivals claim the transient line permanently.
                  surface: 'silent',
                });
                notifyArrival(
                  convo,
                  sender || i18n.t('common.unknown'),
                  sender ? body : msg.text,
                );
              }
            }
            // Emit after the store update so subscribers see a settled world.
            emit({ type: 'message', msg: enriched });
          } else if (msg.kind === 'direct' && msg.pubkeyPrefix) {
            const contact = c.lookupContact(msg.pubkeyPrefix);
            // A v3 frame's prefix can be longer than the one stored for the
            // contact. The sidebar keys conversations off the contact, so use
            // its prefix or the thread splits in two.
            const prefix = contact?.pubkeyPrefix ?? msg.pubkeyPrefix;
            // A room server's traffic is its post feed, which lives in its own
            // namespace so it never shares a transcript with the admin CLI.
            const isRoom = contact?.advType === ADV_TYPE_ROOM;
            const id = isRoom ? roomConvoId(prefix) : directConvoId(prefix);
            // A post is signed by the member who wrote it, so the frame's own
            // prefix names only the room. Contacts are keyed on six bytes and
            // the signature carries four, which `lookupContact` matches either
            // way; an author we have never heard of keeps its raw hex.
            const author =
              isRoom && msg.authorPrefix
                ? c.lookupContact(msg.authorPrefix)
                : undefined;
            // An empty contact name would leave "New message from " dangling,
            // so fall back to the prefix exactly as the sidebar does.
            const sender = isRoom
              ? author?.name || msg.authorPrefix || prefix.slice(0, 8)
              : contact?.name || prefix.slice(0, 8);
            // Carry the contact's prefix on the message too: automation
            // filters and direct-reply lookups match this field exactly, so a
            // longer v3 prefix would skip a contact-scoped rule or fail a
            // reply against a contact that is right there in the table.
            const enriched: Message = {
              ...msg,
              pubkeyPrefix: prefix,
              senderName: sender,
            };
            const state = useMeshStore.getState();
            const visible = isConvoVisible(state, id);
            addMessage(id, enriched);
            if (state.backlogDraining) backlogDelivered++;
            if (state.status === 'connected') {
              const room = contact?.name || prefix.slice(0, 8);
              const convo: ActiveConvo = {
                kind: isRoom ? 'room' : 'direct',
                id,
                rawId: prefix,
                label: isRoom ? room : sender,
              };
              setLatestInbound({
                convo,
                // An unsigned room frame carries no author at all, and `sender`
                // has already fallen through to the *room's* raw prefix by
                // here — a bare hex string that names neither. Report the
                // absence and let the bar name the room.
                sender: isRoom
                  ? (author?.name ?? msg.authorPrefix ?? null)
                  : sender,
                at: arrivedAt(),
              });
              // Silent while the backlog drains, for the reason given on the
              // channel branch above.
              if (!visible && !state.backlogDraining) {
                const text = isRoom
                  ? i18n.t('notify.newPostIn', { room })
                  : i18n.t('notify.newMessageFrom', { sender });
                // Keyed and surfaced exactly as the channel branch above.
                notify({
                  level: 'info',
                  text,
                  key: `${convo.id}\n${text}`,
                  convo,
                  surface: 'silent',
                });
                notifyArrival(convo, sender, msg.text);
              }
            }
            emit({ type: 'message', msg: enriched });
          }
        },
        // A drop only triggers the reconnect loop once we're fully connected; a
        // drop mid-sync (status still 'connecting'/'reconnecting') is handled
        // by connect's own success/failure path instead. The user-initiated
        // flag suppresses the loop on a deliberate Disconnect.
        onDisconnect: () => {
          if (
            isUserDisconnect() ||
            useMeshStore.getState().status !== 'connected'
          ) {
            return;
          }
          beginReconnect(reconnectDeps(connect));
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
      setLatestInbound,
      setBacklogDraining,
      notify,
      retractNotification,
    ],
  );

  // Loads a bound session's records into the store and subscribes them to be
  // saved: the saved history merged under whatever arrived first, the
  // preferences, automation rules and advert cache, and a remembered API key.
  // Shared by the connect flow and a seed-born identity's late unlock.
  // Resolves false, having changed nothing, when the session ended during the
  // reads.
  const hydrateSession = useCallback(
    async (
      pubkey: string,
      key: CryptoKey,
      alive: () => boolean,
    ): Promise<boolean> => {
      // Restore a "remembered" LLM API key, the saved history, any
      // per-radio automation rules, the advert cache, and the preferences
      // blob in parallel — independent IndexedDB reads with no ordering
      // dependency.
      const [, saved, rules, advertCache, prefs] = await Promise.all([
        loadPersistedApiKey(),
        loadRadioData(pubkey, key),
        loadAutomationRules<AutomationRule[]>(pubkey, key),
        loadAdvertCache(pubkey, key),
        loadPreferences(pubkey, key),
      ]);
      // Those reads outlive their own session when the link drops or the
      // user disconnects during them: the store has already been reset,
      // and folding this radio's history and preferences back in would
      // repopulate it — and mark it hydrated — for a radio that is gone,
      // leaving the next session to frame from the previous one's saved
      // viewport. Wiring persistence to it would be just as wrong, so the
      // whole hydrate stops here and the teardown keeps the empty store.
      if (!alive()) return false;
      if (saved?.msgHistory) restoreHistory(saved.msgHistory);
      // A backup restored into this identity whose write failed is only in
      // the store, and the blobs just read predate it (or are absent), so
      // loading them would wipe it. Its own values are re-applied instead,
      // which still marks the preferences hydrated.
      const unsaved = claimUnsavedRestore(pubkey);
      if (unsaved) {
        restorePreferences(selectPreferences(useMeshStore.getState()), true);
      } else {
        restoreAutomationRules(rules ?? []);
        // Fold this radio's saved preferences in before the auto-add
        // hydrate below, so the radio-sourced fields it merges over sit on
        // top of the persisted app-only ones (e.g. showFullPublicKeys). A
        // null/absent blob normalizes to defaults inside the action.
        restorePreferences(prefs);
      }
      // Merge the persisted cache under any adverts already heard during
      // this sync (the live entries are fresher).
      if (advertCache) {
        restoreAdvertCache(
          mergeAdvertCache(advertCache, useMeshStore.getState().advertCache),
        );
      }
      // Persist the current cache now — even on a first connect with no
      // stored record — so adverts already heard during this sync (before
      // the subscriptions below are wired) aren't lost until the next one.
      flushAdvertCache();
      // Nothing at all stored for this identity means this browser has
      // never connected it — how a replacement radio arrives, when its
      // owner most wants their old identity back. The write just above
      // means the offer is made once per identity, not once per connect.
      // A pending identity check is a restore or regenerate still being
      // verified, whose incoming identity is new here by design.
      // Assigned rather than only raised: the store survives a reconnect,
      // so an offer left open by a restore run from Settings would
      // otherwise resurface once that restore's identity check closes.
      const store = useMeshStore.getState();
      store.setRestoreOffer(
        !saved &&
          !rules &&
          !advertCache &&
          !prefs &&
          !unsaved &&
          !store.identityCheck &&
          store.personaSwitch?.target !== pubkey.toLowerCase(),
      );
      // A persona new to this device arrives with nothing stored too, by
      // design; its switch is complete once its session is hydrated.
      if (
        store.personaSwitch?.stage === 'done' &&
        store.personaSwitch.target === pubkey.toLowerCase()
      ) {
        store.setPersonaSwitch(null);
      }

      wirePersistence();
      // Now that this session has a key, give the restore another chance
      // to reach disk.
      if (unsaved) void retryUnsavedRestore();
      return true;
    },
    [
      restoreHistory,
      restoreAdvertCache,
      restoreAutomationRules,
      restorePreferences,
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
      if (isReconnect && isUserDisconnect()) return false;
      setStatus(isReconnect ? 'reconnecting' : 'connecting');
      // A fresh connect starts a clean session — reset intent, drop any
      // reconnect loop still pending from a previous session, and overwrite any
      // in-memory API key so a previous radio's key can't carry into this one.
      // A reconnect deliberately skips the wipe so a memory-only key survives.
      if (!isReconnect) {
        clearUserDisconnect();
        clearReconnect();
        wipeApiKey();
        // `reset()` clears the notification history, but the reconnect loop's
        // give-up notice is raised *after* the teardown that runs it, so that
        // row outlives the session it describes. Drop it here rather than
        // opening this radio's drawer on the last one's sign-off.
        clearNotifications();
      }
      clearSessionState();
      const c = new MeshCoreClient(transport);
      // True while this session is still worth finishing: the link is up and
      // the user hasn't asked to disconnect. A drop or Disconnect during any of
      // the post-connect awaits makes it false, so the steps below bail
      // instead of wiring persistence or reporting against a torn-down session.
      const sessionAlive = () => !c.closed && !isUserDisconnect();
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

        // Bind this radio's encryption key BEFORE reporting 'connected': the
        // whole connected UI mounts off that status, and every encrypted read
        // is gated on the context, so a view that mounts while it is unbound
        // reads an empty store and keeps that answer. Deriving it is PBKDF2 at
        // 100k iterations, so the window is tens to hundreds of milliseconds,
        // not a knife-edge. Setting the history key here too means a send the
        // now-live link accepts can't land before there is a key to save it
        // under.
        const pubkey = c.selfInfo?.pubkey;
        // This session's key, kept for the hydrate reads below; null when the
        // radio reported no pubkey to derive one from, which leaves the session
        // running with persistence off rather than under a shared key.
        let key: CryptoKey | null = null;
        // Settles any persona switch this session lands in, and decides
        // whether it may bind persistence at all; see settleIdentityOnConnect.
        const reported = pubkey?.toLowerCase();
        const { unfinishedSwitch, burner } = await settleIdentityOnConnect(
          c,
          reported,
          sessionAlive,
        );
        // A seed-born identity whose vault has not been opened in this tab has
        // no key to bind: the channel-secret one would seal its records under
        // public material and hide the ones already written. The session runs
        // unsaved until the vault is unlocked (see unlockSeedSession).
        const seedLocked =
          !!reported &&
          !unfinishedSwitch &&
          !burner &&
          !registeredIdentityKey(reported) &&
          (await hasSeedMarker(reported));
        if (
          pubkey &&
          sessionAlive() &&
          !unfinishedSwitch &&
          !burner &&
          !seedLocked
        ) {
          // Declared before the await, so a read that still beats the binding
          // waits for it rather than concluding nothing is stored; the finally
          // answers those reads on every path that never binds one.
          expectSecretContext();
          try {
            const derived = await deriveSessionKey(c.channels, pubkey);
            key = derived.key;
            // This is now the last await before the UI goes live, and a drop or
            // a Disconnect during it is nobody else's to catch: `onDisconnect`
            // stands down while the status is still 'connecting'. Bail exactly
            // like the post-sync check above, so the catch routes a drop into
            // the reconnect loop instead of parking the connected UI on a dead
            // link — and so a torn-down session can't be re-armed with a key.
            if (!sessionAlive()) {
              throw new Error('Closed during sync');
            }
            setStorageKey(pubkey, derived);
            // Reuse the same per-radio key for secret storage — there is no
            // second key-derivation path.
            setSecretContext(pubkey, key);
          } finally {
            releaseSecretContext();
          }
        }

        setStatus('connected');
        clearReconnect();
        const deviceName =
          c.selfInfo?.name ?? c.deviceInfo?.model ?? i18n.t('common.device');
        setDeviceName(deviceName);

        if (burner && reported && sessionAlive()) {
          hydrateBurnerSession(c, reported, burner);
        }
        if (seedLocked && reported && sessionAlive()) {
          useMeshStore
            .getState()
            .setSeedLock({ pubkey: reported, dismissed: false });
        }

        // Wire history persistence FIRST — before the best-effort hydrate
        // round-trips below — so the now-'connected' link can't accept a send
        // that lands before the subscriptions exist and so goes unpersisted.
        // Skip it if the link dropped or the user disconnected during the key
        // derivation or the post-sync hydrate, so we don't bind a save
        // subscription to a torn-down session.
        if (pubkey && key && sessionAlive()) {
          if (!(await hydrateSession(pubkey, key, sessionAlive))) return false;
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
        // lost" notice), so a stale "connected" line here would just confuse.
        // A first connect is a receipt for something the user just asked for,
        // and the connected UI replacing the connect screen already confirms
        // it — transient, no row. A reconnect is not asked for: it closes a
        // drop the user may have missed entirely, so it keeps the row that
        // finishes the story the "connection lost" row started.
        if (sessionAlive()) {
          notify({
            level: 'success',
            text: i18n.t(
              isReconnect ? 'notify.reconnected' : 'notify.connected',
              { device: deviceName },
            ),
            key: isReconnect ? 'reconnected' : 'connected',
            surface: isReconnect ? 'bar' : 'none',
          });
        }
        // The radio is back, so the connect screen's give-up card has served
        // its purpose. Cleared only once the whole session is built: an await
        // above that rejects tears the session down as a failed connect, and
        // the card (and the tab it pre-selects) has to survive that.
        setLastConnectFailure(null);
        return true;
      } catch (err) {
        setSyncProgress(null);
        // A failed reconnect attempt: stay on 'reconnecting' and let the loop
        // reschedule or give up with its own messaging.
        if (isReconnect) return false;
        // User cancelled mid-sync — disconnect() already reset the UI; stay
        // quiet so this in-flight connect doesn't undo it.
        if (isUserDisconnect()) return false;
        // The link dropped mid-sync. If the same device can be reopened,
        // recover it via the reconnect loop (a full re-sync) rather than
        // dead-ending at the connect screen with partial data.
        if (c.closed && hasReconnectSource()) {
          beginReconnect(reconnectDeps(connectImpl));
          return false;
        }
        // A genuine connect failure (bad handshake, etc.). Tear down the
        // half-built session so the created client/transport can't leak while
        // the UI returns to the connect screen.
        teardownSession();
        setConnectError(connectErrorCode(err));
        return false;
      }
    },
    [
      setStatus,
      setClient,
      setDeviceName,
      setBattery,
      clearNotifications,
      setSyncProgress,
      notify,
      setConnectError,
      setLastConnectFailure,
      wireClient,
      hydrateSession,
      setAutoAddConfig,
    ],
  );

  /** Connects over USB serial, prompting for a port unless `port` is given. */
  const connectUSB = useCallback(
    async (port?: SerialPort) => {
      setConnectError(null);
      try {
        const transport = await createUSBTransport(port);
        setReconnectSource(transport, 'usb');
        await connect(transport);
      } catch (err) {
        if (err instanceof PickerDismissedError) return;
        setConnectError(connectErrorCode(err));
      }
    },
    [connect, setConnectError],
  );

  /** Prompts for a BLE companion and connects. */
  const connectBLE = useCallback(async () => {
    setConnectError(null);
    try {
      const transport = await createBLETransport();
      setReconnectSource(transport, 'ble');
      await connect(transport);
    } catch (err) {
      if (err instanceof PickerDismissedError) return;
      setConnectError(connectErrorCode(err));
    }
  }, [connect, setConnectError]);

  /** Connects to a radio's WiFi WebSocket bridge at `url`. */
  const connectWiFi = useCallback(
    async (url: string) => {
      setConnectError(null);
      try {
        const transport = await createWiFiTransport(url);
        setReconnectSource(transport, 'wifi', url);
        await connect(transport);
      } catch (err) {
        setConnectError(connectErrorCode(err));
      }
    },
    [connect, setConnectError],
  );

  /**
   * Skips the remaining backoff wait and runs the pending reconnect attempt
   * now. No-op unless the loop is currently waiting out a delay.
   */
  const retryReconnectNow = useCallback(() => {
    runRetryReconnectNow(reconnectDeps(connect));
  }, [connect]);

  /**
   * Restarts the session over the same transport, exactly as a dropped link
   * would: the reconnect loop reopens it and runs a full sync.
   *
   * @remarks For a radio that restarted, or whose identity changed, under a
   * live link: a reboot does not always drop it (native USB serial can survive
   * the restart). A session that carried on would miss the connect sync, and
   * after an identity change would keep a store hydrated for the outgoing
   * identity, along with whatever storage key and secrets context the import
   * left it bound to. No-op once the link has already dropped, since the loop
   * is then running anyway.
   */
  const restartSession = useCallback(() => {
    const c = useMeshStore.getState().client;
    if (!c || c.closed) return;
    // Started before the close: a deliberate close suppresses `onDisconnect`,
    // so nothing else would begin the loop, and the flush it opens with needs
    // the session still bound.
    beginReconnect(reconnectDeps(connect));
    c.destroy();
  }, [connect]);

  /**
   * Binds a seed-born identity's session once its vault has been opened,
   * which registers the identity's storage key (`registerIdentityKey`), and
   * hydrates it exactly as a connect would.
   *
   * @remarks The session ran unsaved until now, so what arrived meanwhile is
   * in the store only: the saved history is merged under it, and the whole
   * session is then written under the vault-derived key.
   * @returns whether the session is now saved; false when there is no live
   * session, its identity's key is not held, or the session ended during the
   * hydrate.
   */
  const unlockSeedSession = useCallback(async (): Promise<boolean> => {
    const c = useMeshStore.getState().client;
    const pubkey = c?.selfInfo?.pubkey?.toLowerCase();
    if (!c || c.closed || !pubkey) return false;
    const key = registeredIdentityKey(pubkey);
    if (!key) return false;
    const alive = () =>
      !c.closed && !isUserDisconnect() && useMeshStore.getState().client === c;
    setStorageKey(pubkey, { key, channels: c.channels, material: null });
    setSecretContext(pubkey, key);
    if (!(await hydrateSession(pubkey, key, alive))) return false;
    useMeshStore.getState().setSeedLock(null);
    return flushSessionAsync();
  }, [hydrateSession]);

  /**
   * Persists history, tears down the client and session state, and resets the
   * store.
   */
  const disconnect = useCallback(() => {
    // Mark intent first so an in-flight or pending reconnect can't bounce the
    // session back up; also cancels a drop's GATT/close event from looping.
    markUserDisconnect();
    teardownSession(true);
    // reset() deliberately carries the give-up notice through a teardown; the
    // user leaving on purpose is the one case that retires it.
    setLastConnectFailure(null);
    // Announced and nothing more: the user pressed Disconnect and the connect
    // screen came up, which is the confirmation. A drawer row would describe a
    // session that no longer has a drawer to sit in.
    notify({
      level: 'info',
      text: i18n.t('notify.disconnected'),
      key: 'disconnected',
      surface: 'none',
    });
  }, [notify, setLastConnectFailure]);

  // Core send routine for an existing message bubble: broadcasts to a channel
  // and opens a repeater-echo window, or hands a direct message to the
  // automatic delivery cycle that owns its retries and ACK tracking.
  const transmit = useCallback(
    async (convo: ActiveConvo, msgId: string, text: string) => {
      // The single gate every send funnels through: never transmit into a link
      // that isn't fully connected (defense in depth behind the overlay's
      // `inert`).
      if (!canTransmit(client)) return;
      if (convo.kind === 'channel') {
        updateMessage(convo.id, msgId, { status: 'sending' });
        try {
          const idx = Number(convo.rawId);
          // The slot may have been removed since this conversation was opened
          // (history keeps it reachable), and its secret is now zeroed.
          if (!client.channels[idx] || client.isRemovingChannel(idx)) {
            updateMessage(convo.id, msgId, { status: 'failed' });
            notify({
              level: 'error',
              text: i18n.t('notify.channelNotFound'),
              key: 'channelNotFound',
            });
            return;
          }
          await client.sendChannelMessage(idx, text);
          updateMessage(convo.id, msgId, { status: 'sent' });
          openEchoWindow(convo.id, msgId);
        } catch (err) {
          updateMessage(convo.id, msgId, { status: 'failed' });
          notify({
            level: 'error',
            text: i18n.t('notify.sendFailed', {
              error: (err as Error).message,
            }),
            key: `sendFailed:${convo.id}`,
          });
        }
        return;
      }
      // Repeater conversations are remote-admin consoles, not chats. A room
      // post is an ordinary plain-text direct message to the room contact,
      // acked by the room once it accepts the post.
      if (convo.kind !== 'direct' && convo.kind !== 'room') return;
      await startDeliveryCycle(convo, msgId, text);
    },
    [client, updateMessage, notify],
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
      // Repeater admin views have no composer, so a repeater convo never sends
      // a chat message; guard both to be safe and to narrow the message kind.
      if (activeConvo.kind === 'repeater') return;
      const trimmed = text.trim();
      const msgId = crypto.randomUUID();
      addMessage(activeConvo.id, {
        id: msgId,
        // A room post travels as a direct message; only its conversation
        // namespace differs, so the bubble keeps the direct-message kind and
        // its delivery reporting.
        kind: activeConvo.kind === 'room' ? 'direct' : activeConvo.kind,
        text: trimmed,
        own: true,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'sending',
      });
      await transmit(activeConvo, msgId, trimmed);
    },
    [client, addMessage, transmit],
  );

  /**
   * Restarts delivery of a message that gave up, from a fresh attempt budget.
   *
   * @remarks
   * The only manual retry left: a direct message exhausts
   * {@link MAX_DELIVERY_ATTEMPTS} automatic attempts before the UI offers this,
   * and the route policy is handled by the cycle itself rather than by the
   * user.
   */
  const retryMessage = useCallback(
    async (msg: Message, convo: ActiveConvo | null) => {
      if (
        !canTransmit(client) ||
        !convo ||
        !msg.id ||
        msg.status !== 'failed'
      ) {
        return;
      }
      // The session may have been downgraded (or logged out) since the post
      // failed, and a read-only member's retry would be dropped by the room.
      if (
        convo.kind === 'room' &&
        !canPostToRoom(
          useMeshStore.getState().adminSessions[String(convo.rawId)]?.login,
        )
      ) {
        return;
      }
      await transmit(convo, msg.id, msg.text);
    },
    [client, transmit],
  );

  /**
   * Resets a contact's route on the radio so its next message floods to
   * rediscover a path.
   *
   * @param quiet - suppress the success receipt, for a reset the user did not
   * ask for. Announcing a background route reset would put an unexplained
   * green line in the action bar mid-way through an operation of its own; a
   * failure still speaks, since it changes what that operation can expect.
   */
  const resetContactPath = useCallback(
    async (contact: Contact, quiet = false) => {
      if (!canTransmit(client)) return;
      try {
        await client.resetPath(contact);
        if (!quiet) {
          notify({
            level: 'success',
            text: i18n.t('notify.routeReset'),
            key: 'routeReset',
            surface: 'none',
          });
        }
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.routeResetFailed', {
            error: (err as Error).message,
          }),
          key: `routeResetFailed:${contact.pubkeyPrefix}`,
        });
      }
    },
    [client, notify],
  );

  /** Flips a contact's favorite flag on the radio. */
  const toggleFavorite = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      const fav = (contact.flags & FAVORITE_FLAG) === 0;
      try {
        await client.setFavorite(contact, fav);
        notify({
          level: 'info',
          text: fav
            ? i18n.t('notify.addedToFavorites')
            : i18n.t('notify.removedFromFavorites'),
          key: `favorite:${contact.pubkeyPrefix}`,
          surface: 'none',
        });
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.favoriteUpdateFailed', {
            error: (err as Error).message,
          }),
          key: `favoriteFailed:${contact.pubkeyPrefix}`,
        });
      }
    },
    [client, notify],
  );

  /**
   * Logs in to a repeater/room server for remote admin. Marks the session
   * `pending`, then on success the granted level, or `loggedOut` on failure
   * (surfaced as a notification). A room server's own reported role wins,
   * because it is what decides whether the member may post; a repeater's is
   * ignored in favour of the level the user selected (`kind`), since a
   * blank/guest login re-uses an admin-enrolled node's stored ACL role and
   * would otherwise show a guest session as admin. When `remember` is set, the
   * password is persisted encrypted per-radio in the `secrets` store (never in
   * the store, prefs blob, or localStorage); otherwise it is not persisted.
   *
   * @param quiet - suppress the *timeout* notice, for a caller that shows the
   * outcome itself. An automatic retry cycle sets it on every attempt but its
   * last, so one unreachable node speaks once rather than once per attempt.
   * A rejection the radio reported still speaks: it ends such a cycle at once,
   * so its message has no later attempt to carry it.
   * @returns how the attempt ended, so a caller can retry only the transient
   * shape. See {@link RepeaterLoginOutcome}.
   */
  const repeaterLogin = useCallback(
    async (
      contact: Contact,
      password: string,
      kind: LoginKind,
      remember: boolean,
      quiet = false,
    ): Promise<RepeaterLoginOutcome> => {
      if (!canTransmit(client)) return 'offline';
      setAdminLogin(contact.pubkeyPrefix, 'pending');
      try {
        const granted = await client.login(contact, password);
        // A drop during login can tear the session down; don't revive it.
        if (!canTransmit(client)) return 'offline';
        // A room grants three roles and the middle one (the room password)
        // is what decides whether the composer may post, so its
        // server-reported role is authoritative. A repeater reflects the
        // level the user chose instead: it re-uses your existing ACL role for
        // a blank/guest login, so an admin-enrolled node would otherwise
        // report admin even when you intended a read-only guest session. The
        // node still enforces real permissions either way.
        const isRoom = contact.advType === ADV_TYPE_ROOM;
        setAdminLogin(contact.pubkeyPrefix, (isRoom && granted) || kind);
        // Only a successful login is ever remembered, so a wrong password can't
        // be persisted. The credential lives solely in the encrypted per-radio
        // secrets store — never the store, prefs blob, or localStorage.
        if (remember) {
          void saveRepeaterCred(contact.pubkeyPrefix, {
            access: kind,
            password,
          });
        }
        return 'ok';
      } catch (err) {
        // A disconnect/drop rejects the pending login and runs its own
        // teardown; don't clobber that outcome with a stale login error. A full
        // disconnect already cleared the slice (leave it gone); a transient
        // drop keeps the entry, so just clear its `pending` spinner silently.
        if (!canTransmit(client)) {
          if (useMeshStore.getState().adminSessions[contact.pubkeyPrefix]) {
            setAdminLogin(contact.pubkeyPrefix, 'loggedOut');
          }
          return 'offline';
        }
        setAdminLogin(contact.pubkeyPrefix, 'loggedOut');
        // The node never answered — the raw "Timeout waiting for push from
        // <prefix>" says nothing a user can act on, so name the two causes it
        // actually has instead.
        const timedOut = err instanceof PushTimeoutError;
        // `quiet` covers only the silence a retry cycle is about to answer for
        // itself. A reported rejection stops that cycle where it stands, so
        // swallowing its message would lose the one thing that explains why.
        if (!quiet || !timedOut) {
          notify({
            level: 'error',
            text: timedOut
              ? i18n.t('notify.repeaterLoginTimedOut', {
                  name: contact.name || contact.pubkeyPrefix.slice(0, 8),
                })
              : i18n.t('notify.repeaterLoginFailed', {
                  error: (err as Error).message,
                }),
            key: `repeaterLogin:${contact.pubkeyPrefix}`,
          });
        }
        return timedOut ? 'timeout' : 'failed';
      }
    },
    [client, setAdminLogin, notify],
  );

  /**
   * Requests a repeater's live status and stores it on its admin session.
   *
   * @returns the read in flight for this repeater — a second call while one is
   * running joins it instead of starting another, so every caller's spinner
   * follows the same exchange.
   */
  const repeaterStatus = useCallback(
    (contact: Contact): Promise<void> => {
      if (!canTransmit(client)) return Promise.resolve();
      const prefix = contact.pubkeyPrefix;
      // The session this request belongs to. A log-out and re-login between the
      // send and the reply mints a new token, and the old snapshot must not
      // land on the new session — it would read as freshly updated.
      const token = useMeshStore.getState().adminSessions[prefix]?.token;
      return runStatusRequest(prefix, async () => {
        try {
          const status = await client.requestStatus(contact);
          // Skip a stale update if the session dropped mid-request.
          if (!canTransmit(client)) return;
          setRepeaterStatus(prefix, status, token);
        } catch (err) {
          // A disconnect rejects the in-flight request; its teardown owns the
          // user-facing notice, so suppress this stale operation error.
          if (!canTransmit(client)) return;
          notify({
            level: 'error',
            text: i18n.t('notify.repeaterStatusFailed', {
              error: (err as Error).message,
            }),
            key: `repeaterStatus:${prefix}`,
          });
        }
      });
    },
    [client, setRepeaterStatus, notify],
  );

  /**
   * Requests a node's sensor telemetry and caches the decoded readings. Open
   * to any contact — unlike {@link repeaterStatus} it needs no admin login.
   */
  const requestTelemetry = useCallback(
    async (contact: Contact) => {
      if (!canTransmit(client)) return;
      try {
        const telemetry = await client.requestTelemetry(contact);
        // Skip a stale update if the link dropped mid-request.
        if (!canTransmit(client)) return;
        setNodeTelemetry(contact.pubkeyPrefix, telemetry.readings);
      } catch (err) {
        // A disconnect rejects the in-flight request; its teardown owns the
        // user-facing notice, so suppress this stale operation error.
        if (!canTransmit(client)) return;
        notify({
          level: 'error',
          text: i18n.t('notify.telemetryFailed', {
            error: (err as Error).message,
          }),
          key: `telemetry:${contact.pubkeyPrefix}`,
        });
      }
    },
    [client, setNodeTelemetry, notify],
  );

  /**
   * Reads a repeater's neighbor table, structured where the firmware supports
   * it and scraped from the `neighbors` CLI reply where it does not.
   *
   * @remarks See {@link readNeighbors} for why the structured path is preferred
   * and how the fallback is chosen.
   * @throws if the link is down, or neither path produced a list — a repeater
   * with no neighbors resolves with an empty array instead.
   */
  const repeaterNeighbors = useCallback(
    (contact: Contact): Promise<Neighbor[]> => {
      if (!canTransmit(client)) {
        return Promise.reject(
          new Error(i18n.t('repeaterAdmin.cli.disconnected')),
        );
      }
      return readNeighbors(client, contact);
    },
    [client],
  );

  /**
   * Reads which clients may administer a repeater or room server.
   *
   * @remarks Structured-only — there is no CLI command that lists the ACL — so
   * a node whose firmware predates `GET_ACCESS_LIST` simply never answers.
   * @throws if the link is down, or the node did not answer. A node with an
   * empty list answers with nothing at all, so it fails the same way.
   */
  const repeaterAccessList = useCallback(
    (contact: Contact): Promise<AclEntry[]> => {
      if (!canTransmit(client)) {
        return Promise.reject(
          new Error(i18n.t('repeaterAdmin.cli.disconnected')),
        );
      }
      return client.requestAccessList(contact);
    },
    [client],
  );

  /**
   * Sends a CLI command to a repeater and resolves with its reply text, for the
   * structured Config editor's `get`/`set` round-trips.
   *
   * @remarks
   * Bound to the connected client; see {@link sendCliRequest} for the queueing,
   * correlation and timeout rules it obeys.
   * @throws if the send fails, the session drops, or no reply arrives in time.
   */
  const repeaterCliRequest = useCallback(
    (contact: Contact, cmd: string): Promise<string> =>
      sendCliRequest(client, contact, cmd),
    [client],
  );

  /**
   * Sends a remote-admin CLI command to a repeater and discards its reply — the
   * transcript already shows it. For the console and the Config tab's action
   * verbs, where nothing needs the reply text.
   *
   * @remarks
   * Still waits for the reply (via {@link repeaterCliRequest}) rather than
   * returning at the send ack, so the reply is consumed by this request instead
   * of being mistaken for the answer to whatever is sent next.
   * @param silent - the verb never answers (`reboot`), so the wait is shortened
   *   to what a rejection needs; the caller still decides whether the resulting
   *   `'timeout'` counts as success.
   * @returns the {@link RepeaterCliOutcome}. A silent node is reported as
   *   `'timeout'`, never folded into success — only the caller knows whether
   *   the verb it sent answers at all.
   */
  const repeaterCli = useCallback(
    async (contact: Contact, cmd: string): Promise<RepeaterCliOutcome> => {
      if (!canTransmit(client)) return 'error';
      try {
        const reply = await repeaterCliRequest(contact, cmd);
        // A received reply can still be a rejection (e.g. `ERR: clock cannot go
        // backwards`); surface it and report failure rather than "sent".
        if (isErrorReply(reply)) {
          notify({
            level: 'error',
            text: i18n.t('notify.repeaterCliFailed', { error: reply.trim() }),
            key: `repeaterCli:${contact.pubkeyPrefix}`,
          });
          return 'error';
        }
        return 'ok';
      } catch (err) {
        // Nothing raised: whether silence is a failure depends on the verb, so
        // the caller reports it (transcript line, notification, or nothing).
        if (err instanceof CliTimeoutError) return 'timeout';
        // A disconnect rejects the pending send; its teardown owns the notice,
        // so only surface failures from a still-live session.
        if (!canTransmit(client)) return 'error';
        notify({
          level: 'error',
          text: i18n.t('notify.repeaterCliFailed', {
            error: (err as Error).message,
          }),
          key: `repeaterCli:${contact.pubkeyPrefix}`,
        });
        return 'error';
      }
    },
    [client, repeaterCliRequest, notify],
  );

  /** Drops any pending CLI request for a repeater (e.g. on panel unmount). */
  const clearRepeaterCli = useCallback((prefix: string) => {
    rejectCliWaitersFor(prefix);
  }, []);

  /**
   * Saves a heard advert as a contact on the radio.
   *
   * @returns whether the radio accepted the write. The failure is already
   * surfaced as a notification; the result is for a caller running a batch,
   * which has to tell a contact that landed from one the radio refused.
   */
  const addDiscoveredContact = useCallback(
    async (advert: Advert): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      const pubkeyBytes = fromHex(advert.pubkey, 32);
      if (!pubkeyBytes) {
        notify({
          level: 'error',
          text: i18n.t('notify.invalidPublicKey'),
          key: 'invalidPublicKey',
        });
        return false;
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
        notify({
          level: 'success',
          text: i18n.t('notify.added', {
            name: advert.name || advert.pubkeyPrefix,
          }),
          key: `added:${advert.pubkeyPrefix}`,
          surface: 'none',
        });
        return true;
      } catch (err) {
        // Keyed on the reason, not the contact: "Add all" over a directory
        // selection writes these one at a time, and the text names no contact,
        // so per-contact keys would fill the drawer with rows a reader cannot
        // tell apart. One row per distinct failure, counted, says more.
        notify({
          level: 'error',
          text: i18n.t('notify.addContactFailed', {
            error: (err as Error).message,
          }),
          key: `addContactFailed:${(err as Error).message}`,
        });
        return false;
      }
    },
    [client, notify],
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
        notify({
          level: 'error',
          text: i18n.t('notify.invalidPublicKey'),
          key: 'invalidPublicKey',
        });
        return;
      }
      const pubkeyPrefix = toHex(pubkeyBytes.slice(0, 6));
      if (client.contacts[pubkeyPrefix]) {
        notify({
          level: 'warning',
          text: i18n.t('notify.contactAlreadyAdded', {
            name: client.contacts[pubkeyPrefix].name || pubkeyPrefix,
          }),
          key: `contactAlreadyAdded:${pubkeyPrefix}`,
        });
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
        notify({
          level: 'success',
          text: i18n.t('notify.added', { name: name || pubkeyPrefix }),
          key: `added:${pubkeyPrefix}`,
          surface: 'none',
        });
      } catch (err) {
        // Keyed on the reason like the discovered-contact path, so one
        // string never carries two key schemes.
        notify({
          level: 'error',
          text: i18n.t('notify.addContactFailed', {
            error: (err as Error).message,
          }),
          key: `addContactFailed:${(err as Error).message}`,
        });
      }
    },
    [client, notify],
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
        notify({
          level: 'success',
          text: i18n.t('notify.advertSent'),
          key: `advertSent:${contact.pubkeyPrefix}`,
          surface: 'none',
        });
      } catch (err) {
        // The radio rebroadcasts a cached copy of the contact's signed advert;
        // if it never heard one over the air (e.g. a QR-imported contact) it
        // returns TABLE_FULL with nothing to send. Surface that distinct case.
        if ((err as { code?: number }).code === ERR_CODE.TABLE_FULL) {
          notify({
            level: 'warning',
            text: i18n.t('notify.advertNoRecent'),
            key: `advertNoRecent:${contact.pubkeyPrefix}`,
          });
        } else {
          notify({
            level: 'error',
            text: i18n.t('notify.advertFailed', {
              error: (err as Error).message,
            }),
            key: `advertFailed:${contact.pubkeyPrefix}`,
          });
        }
      }
    },
    [client, notify],
  );

  /**
   * Advertises this node to the mesh, choosing flood (whole mesh) or zero-hop
   * (direct neighbors only). Low-risk and not a persistent device change, so
   * the outcome is a transient receipt rather than a kept one.
   */
  const advertiseSelf = useCallback(
    async (flood: boolean) => {
      if (!canTransmit(client)) return;
      try {
        await client.sendSelfAdvert(flood);
        notify({
          level: 'success',
          text: flood
            ? i18n.t('notify.selfAdvertFloodSent')
            : i18n.t('notify.selfAdvertZeroHopSent'),
          key: 'selfAdvert',
          surface: 'none',
        });
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.selfAdvertFailed', {
            error: (err as Error).message,
          }),
          key: 'selfAdvertFailed',
        });
      }
    },
    [client, notify],
  );

  /**
   * Deletes a contact from the radio.
   *
   * @returns whether the radio accepted the delete, for the same batching
   * reason as {@link addDiscoveredContact}.
   */
  const removeContact = useCallback(
    async (contact: Contact): Promise<boolean> => {
      if (!canTransmit(client)) return false;
      try {
        await client.removeContact(contact);
        notify({
          level: 'info',
          text: i18n.t('notify.contactRemoved'),
          key: `contactRemoved:${contact.pubkeyPrefix}`,
          surface: 'none',
        });
        return true;
      } catch (err) {
        // Keyed on the reason for the same batching reason as
        // {@link addDiscoveredContact}.
        notify({
          level: 'error',
          text: i18n.t('notify.removeContactFailed', {
            error: (err as Error).message,
          }),
          key: `removeContactFailed:${(err as Error).message}`,
        });
        return false;
      }
    },
    [client, notify],
  );

  /**
   * Joins, creates, or restores a channel, placing it in the lowest free slot.
   * Slot 0 is included — it is only free once the Public channel the firmware
   * ships there has been removed.
   *
   * @remarks No-ops with a notification if the secret already matches a joined
   * channel, or if all slots are full.
   */
  const addChannel = useCallback(
    async (name: string, secret: Uint8Array) => {
      if (!canTransmit(client)) return;
      // A channel is identified by its secret — don't create a duplicate slot
      const existing = Object.values(client.channels).find(
        (ch) => ch.secret && bytesEqual(ch.secret, secret),
      );
      if (existing) {
        notify({
          level: 'warning',
          text: i18n.t('notify.alreadyJoined', { name: existing.name || name }),
          // Scoped to the slot, like `contactAlreadyAdded` is to its contact:
          // the text names a channel, so a bare key would relabel an earlier
          // channel's row with a later one's name.
          key: `alreadyJoined:${existing.idx}`,
        });
        return;
      }
      let idx = -1;
      const slots = client.deviceInfo?.maxChannels || MAX_CHANNEL_SLOTS;
      for (let i = 0; i < slots; i++) {
        if (!client.channels[i]) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        notify({
          level: 'error',
          text: i18n.t('notify.allSlotsFull'),
          key: 'allSlotsFull',
        });
        return;
      }
      try {
        await client.setChannel(idx, name, secret);
        notify({
          level: 'success',
          text: i18n.t('notify.channelAdded', { name }),
          key: 'channelAdded',
          surface: 'none',
        });
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.addChannelFailed', {
            error: (err as Error).message,
          }),
          key: 'addChannelFailed',
        });
      }
    },
    [client, notify],
  );

  /** Removes a channel slot; the Public channel is removable like any other. */
  const removeChannel = useCallback(
    async (idx: number) => {
      if (!canTransmit(client)) return;
      try {
        await client.removeChannel(idx);
        // The slot can be reallocated to an unrelated channel, so leaving it
        // open would let the user transmit on the cleared secret. For the same
        // reason the slot's unsent draft goes with it — conversation ids are
        // slot-based, so a replacement channel would otherwise inherit it.
        const { activeConvo } = useMeshStore.getState();
        if (activeConvo?.kind === 'channel' && activeConvo.rawId === idx) {
          setActiveConvo(null);
        }
        const convoId = channelConvoId(idx);
        setDraft(convoId, '');
        // Same reason again: a notification row or the action bar's quick link
        // aimed at the freed slot would open the replacement channel, and the
        // row's dedup key would merge that channel's next arrival into the old
        // channel's row. The transient line needs no such handling — it
        // carries no jump, and the receipt below replaces it anyway.
        dismissConvoNotifications(convoId);
        if (useMeshStore.getState().latestInbound?.convo.id === convoId) {
          setLatestInbound(null);
        }
        notify({
          level: 'info',
          text: i18n.t('notify.channelRemoved'),
          key: `channelRemoved:${idx}`,
          surface: 'none',
        });
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.removeChannelFailed', {
            error: (err as Error).message,
          }),
          key: `removeChannelFailed:${idx}`,
        });
      }
    },
    [
      client,
      setActiveConvo,
      setDraft,
      dismissConvoNotifications,
      setLatestInbound,
      notify,
    ],
  );

  /**
   * Renames the radio on the device; the store updates via `onSelfInfo`.
   *
   * @returns whether the write succeeded and, when it didn't, the localized
   * reason — so the caller can keep its editor open (preserving the typed
   * name) and show the reason where the field is. Failures also raise a
   * notification so navigation away from the field cannot hide a late error.
   */
  const setNodeName = useCallback(
    async (name: string): Promise<WriteResult> => {
      if (!canTransmit(client))
        return { ok: false, error: i18n.t('notify.notConnected') };
      try {
        await client.setNodeName(name);
        return { ok: true };
      } catch (err) {
        const error = i18n.t('notify.nodeNameSaveFailed', {
          error: (err as Error).message,
        });
        notify({ level: 'error', text: error, key: 'nodeNameSaveFailed' });
        return { ok: false, error };
      }
    },
    [client, notify],
  );

  /**
   * Writes this radio's advertised location to the device; the store updates
   * via `onSelfInfo`.
   *
   * @param latDeg - latitude in decimal degrees.
   * @param lonDeg - longitude in decimal degrees.
   * @returns whether the write succeeded, with the localized reason when it
   * didn't.
   */
  const setLocation = useCallback(
    async (latDeg: number, lonDeg: number): Promise<WriteResult> => {
      if (!canTransmit(client))
        return { ok: false, error: i18n.t('notify.notConnected') };
      try {
        await client.setLocation(latDeg, lonDeg);
        return { ok: true };
      } catch (err) {
        const error = i18n.t('notify.locationSaveFailed', {
          error: (err as Error).message,
        });
        notify({ level: 'error', text: error, key: 'locationSaveFailed' });
        return { ok: false, error };
      }
    },
    [client, notify],
  );

  /**
   * Sets where the radio's adverts take their location from — nothing, the
   * stored fixed coordinate, or the radio's own GPS module.
   *
   * @returns whether the write succeeded, with the localized reason when it
   * didn't, so the caller can revert its selection.
   */
  // Both location writes touch `advert_loc_policy`, and `setLocationSource`
  // decides what to write from the *current* one — so they have to settle in
  // order, or a stale read undoes the edit that preceded it.
  const locationChain = useRef<Promise<void>>(Promise.resolve());
  const serializeLocation = useCallback(
    (op: () => Promise<WriteResult>): Promise<WriteResult> => {
      const run = locationChain.current.then(op);
      locationChain.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [],
  );

  const setLocationPolicy = useCallback(
    (policy: number): Promise<WriteResult> =>
      serializeLocation(async () => {
        if (!canTransmit(client))
          return { ok: false, error: i18n.t('notify.notConnected') };
        try {
          await client.setLocationPolicy(policy);
          return { ok: true };
        } catch (err) {
          const error = i18n.t('notify.sharePositionSaveFailed', {
            error: (err as Error).message,
          });
          notify({
            level: 'error',
            text: error,
            key: 'sharePositionSaveFailed',
          });
          return { ok: false, error };
        }
      }),
    [client, notify, serializeLocation],
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
   * @returns whether every needed write succeeded, with the localized reason
   * when one didn't.
   */
  const setLocationSource = useCallback(
    (useGps: boolean): Promise<WriteResult> =>
      serializeLocation(async () => {
        if (!canTransmit(client))
          return { ok: false, error: i18n.t('notify.notConnected') };
        try {
          const policy = client.selfInfo?.advLocPolicy;
          const realigned =
            policy !== undefined && policy !== ADVERT_LOC_POLICY.NONE;
          if (realigned) {
            await client.setLocationPolicy(
              useGps ? ADVERT_LOC_POLICY.SHARE : ADVERT_LOC_POLICY.PREFS,
            );
          }
          try {
            await client.setGpsEnabled(useGps);
          } catch (err) {
            // The policy already moved, and Settings reads the source back off
            // it — so leaving it would report a source the module isn't using
            // and make re-picking it look like a no-op.
            if (realigned) {
              await client.setLocationPolicy(policy).catch(() => {});
            }
            throw err;
          }
          // Re-read SELF_INFO so the map's self marker reflects the source just
          // picked: the newly-active advertised coordinate (a GPS module's live
          // fix, or the stored fixed one) is only reported on a fresh read, not
          // echoed from the write. Best-effort — the switch itself succeeded.
          await client.refreshSelfInfo().catch(() => {});
          return { ok: true };
        } catch (err) {
          const error = i18n.t('notify.locationSourceSaveFailed', {
            error: (err as Error).message,
          });
          notify({
            level: 'error',
            text: error,
            key: 'locationSourceSaveFailed',
          });
          return { ok: false, error };
        }
      }),
    [client, notify, serializeLocation],
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
        // The editor closes on success, which is the lasting confirmation; the
        // receipt is transient and keeps no row.
        notify({
          level: 'success',
          text: i18n.t('notify.radioParamsSaved'),
          key: 'radioParamsSaved',
          surface: 'none',
        });
        return true;
      } catch (err) {
        notify({
          level: 'error',
          text: i18n.t('notify.radioParamsSaveFailed', {
            error: (err as Error).message,
          }),
          key: 'radioParamsSaveFailed',
        });
        return false;
      }
    },
    [client, notify],
  );

  /**
   * Reboots the radio, and once it has restarted reports "Rebooting…" and
   * restarts the session through the auto-reconnect loop
   * ({@link restartSession}), which re-runs the connect sync against the
   * restarted radio.
   *
   * @remarks Never {@link disconnect}, which would set
   * `userInitiatedDisconnect` and suppress the reconnect. A restart that
   * dropped the link (BLE, for one) already started the loop, and
   * {@link restartSession} is then a no-op; a USB serial link — native USB on
   * an ESP32-S3, or a bridge chip that stays enumerated — can survive the
   * restart, and without this the session would carry on unsynced against a
   * radio that has booted since.
   */
  const rebootDevice = useCallback(async () => {
    if (!canTransmit(client)) return;
    try {
      await client.reboot();
    } catch (err) {
      notify({
        level: 'error',
        text: i18n.t('notify.rebootFailed', { error: (err as Error).message }),
        key: 'rebootFailed',
      });
      return;
    }
    // Kept, not just flashed: the reconnect overlay takes the screen next, so
    // the drawer row is what explains why once the session is back.
    notify({
      level: 'info',
      text: i18n.t('notify.rebooting'),
      key: 'rebooting',
    });
    restartSession();
  }, [client, notify, restartSession]);

  // A save writes two commands, and the client's queue only serializes
  // individual exchanges — so two overlapping saves could leave the radio with
  // the mode from one edit and the per-type bitmask from the other.
  const autoAddChain = useRef<Promise<void>>(Promise.resolve());

  /** Persists auto-add settings locally and writes them to the radio. */
  const applyAutoAddConfig = useCallback(
    (cfg: AutoAddConfig): Promise<WriteResult> => {
      const write = autoAddChain.current.then(
        async (): Promise<WriteResult> => {
          // Persist locally only after the radio write succeeds, so a failed
          // write doesn't leave the app showing settings the radio never
          // accepted. The panel is only reachable while connected, so a link
          // that has dropped behind an earlier queued save is a failure, not
          // an offline preference edit.
          if (!canTransmit(client))
            return { ok: false, error: i18n.t('notify.notConnected') };
          try {
            await client.setAutoAddPrefs(cfg);
            setAutoAddConfig(cfg);
            return { ok: true };
          } catch (err) {
            const error = i18n.t('notify.saveSettingsFailed', {
              error: (err as Error).message,
            });
            notify({ level: 'error', text: error, key: 'saveSettingsFailed' });
            return { ok: false, error };
          }
        },
      );
      autoAddChain.current = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
    [client, setAutoAddConfig, notify],
  );

  return {
    connectUSB,
    connectBLE,
    connectWiFi,
    disconnect,
    retryReconnectNow,
    restartSession,
    unlockSeedSession,
    sendMessage,
    retryMessage,
    resetContactPath,
    toggleFavorite,
    repeaterLogin,
    repeaterStatus,
    requestTelemetry,
    repeaterCli,
    repeaterCliRequest,
    repeaterNeighbors,
    repeaterAccessList,
    clearRepeaterCli,
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
