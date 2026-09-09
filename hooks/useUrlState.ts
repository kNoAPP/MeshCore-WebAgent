// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect } from 'react';
import i18n from '@/lib/i18n';
import {
  APP_VIEWS,
  SETTINGS_SECTIONS,
  channelConvoId,
  directConvoId,
  isActiveStatus,
  openConvo,
  repeaterConvoId,
  useMeshStore,
  type AppView,
  type SettingsSection,
} from '@/store/meshStore';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import type { ActiveConvo, Message } from '@/types/meshcore';

/**
 * The slice of app state carried in the URL hash: the top-level page, plus a
 * Settings section or an open conversation for the pages that have one. Only
 * ids the mesh already broadcasts in the clear (a channel slot or a public-key
 * prefix) go in — never a contact name, a channel secret, or any other value
 * that would leak through a shared link or browser history.
 */
interface UrlRoute {
  view: AppView;
  section: SettingsSection | null;
  /** Conversation id (`"direct:a1b2…"`), or `null` for no open conversation. */
  convo: string | null;
}

/** The hash the app falls back to when there is no route to show. */
const ROOT_HASH = '#/';

/** Channel slots are small integers; contacts are hex public-key prefixes. */
const CHANNEL_SLOT_RE = /^\d{1,3}$/;
const PUBKEY_PREFIX_RE = /^[0-9a-f]{2,64}$/;

/**
 * Validates a `<kind>:<id>` conversation reference from the URL and returns it
 * in canonical form, or `null` if it is malformed. Rejecting anything that
 * isn't a slot number or a hex prefix keeps a hand-edited hash from reaching
 * the store's record lookups as an arbitrary key.
 */
function parseConvoRef(raw: string): string | null {
  const sep = raw.indexOf(':');
  if (sep < 0) return null;
  const kind = raw.slice(0, sep);
  const rawId = raw.slice(sep + 1).toLowerCase();
  if (kind === 'channel') {
    return CHANNEL_SLOT_RE.test(rawId) ? channelConvoId(Number(rawId)) : null;
  }
  if (!PUBKEY_PREFIX_RE.test(rawId)) return null;
  if (kind === 'direct') return directConvoId(rawId);
  if (kind === 'repeater') return repeaterConvoId(rawId);
  return null;
}

/**
 * Parses a `location.hash` into a route, or `null` when it names no known
 * page (including the empty hash a first visit arrives with).
 */
function parseHash(hash: string): UrlRoute | null {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const view = APP_VIEWS.find((v) => v === parts[0]);
  if (!view) return null;
  const arg = parts[1] ?? '';
  if (view === 'settings') {
    return {
      view,
      section: SETTINGS_SECTIONS.find((s) => s === arg) ?? null,
      convo: null,
    };
  }
  if (view === 'chat') {
    return { view, section: null, convo: arg ? parseConvoRef(arg) : null };
  }
  return { view, section: null, convo: null };
}

/** Renders a route back into a `location.hash` value. */
function formatHash(route: UrlRoute): string {
  if (route.view === 'settings') {
    return route.section ? `#/settings/${route.section}` : '#/settings';
  }
  if (route.view === 'chat') {
    return route.convo ? `#/chat/${route.convo}` : '#/chat';
  }
  return `#/${route.view}`;
}

/**
 * Turns a conversation id from the URL into an openable conversation, or
 * `null` when the connected radio has no such channel or contact.
 */
function resolveConvo(ref: string): ActiveConvo | null {
  const { contacts, channels } = useMeshStore.getState();
  const rawId = ref.slice(ref.indexOf(':') + 1);
  if (ref.startsWith('channel:')) {
    const idx = Number(rawId);
    const ch = channels[idx];
    if (!ch) return null;
    return {
      kind: 'channel',
      id: channelConvoId(idx),
      rawId: idx,
      label: ch.name || i18n.t('common.channelName', { index: idx }),
    };
  }
  const contact = contacts[rawId];
  if (!contact) return null;
  // The contact's advert type — not the kind in the hash — decides whether this
  // is a chat or an admin view, mirroring the sidebar, so a hand-edited link
  // can't open the wrong surface for a node.
  const isAdminNode =
    contact.advType === ADV_TYPE_REPEATER || contact.advType === ADV_TYPE_ROOM;
  const label = contact.name || rawId.slice(0, 8);
  return isAdminNode
    ? { kind: 'repeater', id: repeaterConvoId(rawId), rawId, label }
    : { kind: 'direct', id: directConvoId(rawId), rawId, label };
}

/** Total unread messages across every conversation. */
function totalUnread(msgHistory: Record<string, Message[]>): number {
  let total = 0;
  for (const msgs of Object.values(msgHistory)) {
    for (const m of msgs) if (m._unread) total++;
  }
  return total;
}

/**
 * Rewrites `document.title` so a tab left in the background is identifiable
 * among many and shows an unread count. Carries the connected radio's own name
 * only — never a contact or conversation, which the title would expose to
 * anyone looking at the tab strip or a screen share.
 */
function updateTitle(): void {
  const { deviceName, status, msgHistory } = useMeshStore.getState();
  if (!isActiveStatus(status) || !deviceName) {
    document.title = i18n.t('title.app');
    return;
  }
  const unread = totalUnread(msgHistory);
  document.title =
    unread > 0
      ? i18n.t('title.deviceUnread', { device: deviceName, unread })
      : i18n.t('title.device', { device: deviceName });
}

/**
 * Mirrors the app's navigation state into the URL hash and the document title,
 * and drives it back from Back/Forward.
 *
 * @remarks
 * The static export serves a single document, so the hash — not the path —
 * carries the route: `#/stats`, `#/settings/radio`, `#/chat/channel:0`. The
 * route is only applied once a radio is connected, since resolving a
 * conversation needs its contacts and channels; until then the deep link is
 * held so a refresh-then-connect still lands on the right page. Mount once,
 * from {@link AppShell}.
 */
export function useUrlState(): void {
  useEffect(() => {
    // The route the page was opened with, held until a radio is connected.
    let pending = parseHash(window.location.hash);
    // The store clears `settingsSection` as soon as SettingsPage consumes it,
    // so the URL keeps its own copy for as long as Settings stays open.
    let section: SettingsSection | null = null;
    // Set while a parsed route is being pushed into the store, so the store
    // updates it causes aren't echoed straight back into the URL.
    let applying = false;

    const currentHash = (): string => {
      const state = useMeshStore.getState();
      return formatHash({
        view: state.view,
        section,
        convo: state.activeConvo?.id ?? null,
      });
    };

    const writeHash = (hash: string): void => {
      if (hash === window.location.hash) return;
      // Replace rather than push when the current hash isn't a route of ours
      // (a first visit, or a session that just ended): there is no app state
      // at that entry to go Back to.
      if (parseHash(window.location.hash)) {
        window.history.pushState(null, '', hash);
      } else {
        window.history.replaceState(null, '', hash);
      }
    };

    const apply = (route: UrlRoute): void => {
      applying = true;
      try {
        const store = useMeshStore.getState();
        if (route.view === 'settings' && route.section) {
          store.openSettingsSection(route.section);
        } else {
          store.setView(route.view);
        }
        if (route.view === 'chat') {
          const convo = route.convo ? resolveConvo(route.convo) : null;
          if (convo) openConvo(convo);
          else store.setActiveConvo(null);
        }
        section = route.section;
      } finally {
        applying = false;
      }
      // The applied state may differ from what was asked for (an unknown
      // contact, or a node that opens the admin view instead of a chat), so
      // normalize the entry we are already on rather than adding another.
      const hash = currentHash();
      if (hash !== window.location.hash) {
        window.history.replaceState(null, '', hash);
      }
    };

    const onPopState = (): void => {
      if (!isActiveStatus(useMeshStore.getState().status)) return;
      const route = parseHash(window.location.hash);
      // A hash that names no page of ours would otherwise sit in the address
      // bar describing something the app isn't showing.
      if (!route) {
        window.history.replaceState(null, '', currentHash());
        return;
      }
      apply(route);
    };

    const onLanguageChanged = (): void => updateTitle();

    const unsub = useMeshStore.subscribe((state, prev) => {
      if (
        state.msgHistory !== prev.msgHistory ||
        state.deviceName !== prev.deviceName ||
        state.status !== prev.status
      ) {
        updateTitle();
      }
      if (applying) return;
      if (!isActiveStatus(state.status)) {
        // A session ending takes its route with it, so the address bar doesn't
        // keep pointing at a conversation on a radio that is no longer there.
        if (isActiveStatus(prev.status)) {
          section = null;
          window.history.replaceState(null, '', ROOT_HASH);
        }
        return;
      }
      if (pending) {
        // Contacts and channels only exist once the initial sync has finished.
        if (state.status !== 'connected') return;
        const route = pending;
        pending = null;
        apply(route);
        return;
      }
      if (state.settingsSection) section = state.settingsSection;
      else if (state.view !== prev.view) section = null;
      writeHash(currentHash());
    });

    updateTitle();
    window.addEventListener('popstate', onPopState);
    i18n.on('languageChanged', onLanguageChanged);
    return () => {
      unsub();
      window.removeEventListener('popstate', onPopState);
      i18n.off('languageChanged', onLanguageChanged);
    };
  }, []);
}
