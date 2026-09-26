// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  Plus,
  Settings2,
  MoreHorizontal,
  Check,
} from 'lucide-react';
import {
  useMeshStore,
  openConvo,
  contactConvo,
  channelConvoId,
  directConvoId,
  roomConvoId,
  unreadCount,
  clampSidebarWidth,
  CONTACT_SORTS,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  type ContactSort,
} from '@/store/meshStore';
import {
  ADV_ICON,
  isPublicChannelSecret,
  normalizedLastHeard,
} from '@/lib/utils';
import { ADV_TYPE_ROOM, FAVORITE_FLAG } from '@/lib/meshcore/constants';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useClockTick } from '@/hooks/useClockTick';
import { Switch } from './Switch';
import type { Advert, Contact, Message } from '@/types/meshcore';

const MIN_SECTION_PX = 40;
// One arrow-key press on either resize handle.
const RESIZE_STEP_PX = 16;

// Matches on the display name or the pubkey prefix, so a contact can be found
// by either the name it advertises or the key a QR/share card carries.
function matchesQuery(c: Contact, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    c.name.toLowerCase().includes(q) || c.pubkeyPrefix.toLowerCase().includes(q)
  );
}

const SORT_LABEL_KEYS = {
  az: 'sidebar.orderAz',
  heard: 'sidebar.orderHeard',
  latest: 'sidebar.orderLatest',
} as const satisfies Record<ContactSort, string>;

// Order and membership come from CONTACT_SORTS (also the persistence
// allowlist), so the menu can't drift from the stored values.
const SORT_OPTIONS = CONTACT_SORTS.map((value) => ({
  value,
  labelKey: SORT_LABEL_KEYS[value],
}));

// Scans all messages rather than trusting append order, since a delayed or
// retransmitted message can arrive after one with a newer timestamp.
function lastMessageTime(
  msgHistory: Record<string, Message[]>,
  contact: Contact,
): number {
  // A room's activity is its post feed, which is keyed separately from chats.
  const msgs =
    msgHistory[
      contact.advType === ADV_TYPE_ROOM
        ? roomConvoId(contact.pubkeyPrefix)
        : directConvoId(contact.pubkeyPrefix)
    ];
  if (!msgs?.length) return 0;
  let latest = 0;
  for (const m of msgs) {
    if ((m.timestamp ?? 0) > latest) latest = m.timestamp ?? 0;
  }
  return latest;
}

// Shared, so orders that don't need per-contact times keep a stable reference.
const EMPTY_LATEST_TIMES: ReadonlyMap<string, number> = new Map();
const EMPTY_ADVERTS: Record<string, Advert> = {};

function compareBySort(
  a: Contact,
  b: Contact,
  sort: ContactSort,
  latestTimes: ReadonlyMap<string, number>,
  adverts: Record<string, Advert>,
  nowSecs: number,
): number {
  switch (sort) {
    case 'heard': {
      // Through the shared helper, like every other last-heard surface:
      // `lastAdvert` is the sender's clock, and the cached advert is what
      // carries our correction for it. Ranking on the raw field would pin a
      // node advertising from the future to the top of this list while the
      // Nodes table ages it normally — the same disagreement, relocated.
      const heard = (c: Contact): number | undefined =>
        normalizedLastHeard(c, adverts[c.pubkeyPrefix], nowSecs);
      // Never-heard contacts sort last, and compare equal to each other rather
      // than subtracting to NaN, which would strand them in map order.
      const at = heard(a) ?? -Infinity;
      const bt = heard(b) ?? -Infinity;
      const diff = at === bt ? 0 : bt - at;
      // Fall back to A–Z so contacts sharing a timestamp (e.g. never-heard
      // contacts all at 0) keep a stable, alphabetical order.
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'latest': {
      const diff =
        (latestTimes.get(b.pubkeyPrefix) ?? 0) -
        (latestTimes.get(a.pubkeyPrefix) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }
    case 'az':
    default:
      return a.name.localeCompare(b.name);
  }
}

/**
 * Left navigation: a Channels section over a Contacts section, split by a
 * draggable divider, with a Room Servers section between them once at least
 * one room is saved. Auto-sizes the channels section to fit (until the user
 * drags it), lets contacts be searched and ordered — rooms follow the same
 * order — and exposes add/settings/manage affordances. Selecting an item opens
 * that conversation.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const channels = useMeshStore((s) => s.channels);
  const contacts = useMeshStore((s) => s.contacts);
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const contactView = useMeshStore((s) => s.contactView);
  const setContactView = useMeshStore((s) => s.setContactView);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const setAutoAddOpen = useMeshStore((s) => s.setAutoAddOpen);
  const setAddChannelOpen = useMeshStore((s) => s.setAddChannelOpen);
  const setView = useMeshStore((s) => s.setView);
  const {
    sort: contactSort,
    pinFavorites,
    width: sidebarWidth,
    channelsHeight: storedChannelsHeight,
  } = contactView;
  // The height the Channels section wants when the user hasn't dragged the
  // divider. Transient: derived from a measurement, never persisted.
  const [query, setQuery] = useState('');
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef(160);
  const sidebarRef = useRef<HTMLElement>(null);
  const channelsSectionRef = useRef<HTMLDivElement>(null);
  const channelsContentRef = useRef<HTMLDivElement>(null);
  const channelsHeaderRef = useRef<HTMLDivElement>(null);
  const roomsSectionRef = useRef<HTMLDivElement>(null);
  const contactsSectionRef = useRef<HTMLDivElement>(null);
  const contactsHeaderRef = useRef<HTMLDivElement>(null);
  const contactsSearchRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLLIElement>(null);
  const filterInputId = useId();

  const sortedChannels = Object.values(channels).sort((a, b) => a.idx - b.idx);
  // The Room Servers section only exists once a room is saved.
  const hasRooms = useMeshStore((s) =>
    Object.values(s.contacts).some((c) => c.advType === ADV_TYPE_ROOM),
  );

  // Pixel height the channels section needs to show every row without
  // scrolling.
  const measureChannelsFitHeight = useCallback(() => {
    const section = channelsSectionRef.current;
    const style = section ? getComputedStyle(section) : null;
    const sectionPadding = style
      ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      : 0;
    const headerH = channelsHeaderRef.current?.offsetHeight ?? 0;
    const contentH = channelsContentRef.current?.offsetHeight ?? 9999;
    return Math.ceil(contentH + headerH + sectionPadding) + 1;
  }, []);
  // The heights the Channels section can take: `fit` is what its content needs
  // (the drag ceiling), `auto` is where the divider sits before the user drags
  // it. Both are measured, never persisted.
  const [sectionBounds, setSectionBounds] = useState({ fit: 160, auto: 160 });

  useLayoutEffect(() => {
    const aside = sidebarRef.current;
    if (!aside) return;
    const measure = () => {
      const dividerH = dividerRef.current?.offsetHeight ?? 0;
      const available = aside.offsetHeight - dividerH;
      // Contacts keeps its own minimum: a maximized split must never leave the
      // lower section with nothing to render into.
      const contactsStyle = contactsSectionRef.current
        ? getComputedStyle(contactsSectionRef.current)
        : null;
      const contactsPadding = contactsStyle
        ? parseFloat(contactsStyle.paddingTop) +
          parseFloat(contactsStyle.paddingBottom)
        : 0;
      // The Room Servers section sits between the two and sizes to its own
      // content, so whatever it takes comes out of what Channels may grow to.
      const contactsMinimum =
        contactsPadding +
        (contactsHeaderRef.current?.offsetHeight ?? 0) +
        (contactsSearchRef.current?.offsetHeight ?? 0) +
        (roomsSectionRef.current?.offsetHeight ?? 0) +
        MIN_SECTION_PX;
      const ceiling = Math.max(MIN_SECTION_PX, available - contactsMinimum);
      const fit = Math.max(
        MIN_SECTION_PX,
        Math.min(measureChannelsFitHeight(), ceiling),
      );
      setSectionBounds({
        fit,
        auto: Math.max(
          MIN_SECTION_PX,
          Math.min(fit, Math.floor(available / 2)),
        ),
      });
    };
    measure();
    // The window can be resized without any of this effect's inputs changing,
    // and a bound measured against the old height would then hide Contacts.
    const observer = new ResizeObserver(measure);
    observer.observe(aside);
    if (contactsHeaderRef.current) observer.observe(contactsHeaderRef.current);
    if (contactsSearchRef.current) observer.observe(contactsSearchRef.current);
    if (roomsSectionRef.current) observer.observe(roomsSectionRef.current);
    return () => observer.disconnect();
    // `hasRooms` re-runs this when the Room Servers section mounts or unmounts,
    // so the new section is observed (and a removed one stops counting).
  }, [sortedChannels.length, measureChannelsFitHeight, hasRooms]);

  // A stored height is clamped on every render, not just on load: the same
  // value that fit a tall window would otherwise clip the Channels header or
  // push Contacts off the bottom in a short one.
  const channelsHeight = Math.max(
    MIN_SECTION_PX,
    Math.min(sectionBounds.fit, storedChannelsHeight ?? sectionBounds.auto),
  );

  // Precompute each contact's latest-message timestamp once so the comparator
  // doesn't recompute it on every comparison during sort. Only the 'latest'
  // order needs it, so other orders reuse a shared empty map — that keeps this
  // memo's result stable across message arrivals and stops them from forcing a
  // re-sort below.
  // Only the "heard" order reads the clock or the advert cache. The other
  // orders run no timer and select a constant, so neither a tick nor an
  // advert on a busy mesh re-renders these rows — the same trick as
  // EMPTY_LATEST_TIMES. The selector must return the shared empty object
  // rather than be skipped: a fresh `{}` per store change would re-render on
  // every advert anyway.
  const heardOrder = contactSort === 'heard';
  const nowSecs = useClockTick(heardOrder);
  const adverts = useMeshStore((s) =>
    heardOrder ? s.advertCache : EMPTY_ADVERTS,
  );
  // Only the nodes that are conversations: repeaters are managed from the Nodes
  // page, and a sensor joins only once it has messaged. Selected as a joined
  // string, so an arrival that doesn't change who is listed doesn't re-sort.
  const chatPrefixes = useMeshStore((s) =>
    Object.values(s.contacts)
      .filter((c) => contactConvo(c, s.msgHistory) !== null)
      .map((c) => c.pubkeyPrefix)
      .join(','),
  );
  const chatContacts = useMemo(
    () =>
      chatPrefixes
        .split(',')
        .map((prefix) => contacts[prefix])
        .filter((c): c is Contact => c !== undefined),
    [chatPrefixes, contacts],
  );
  const latestTimes = useMemo(() => {
    if (contactSort !== 'latest') return EMPTY_LATEST_TIMES;
    const times = new Map<string, number>();
    for (const c of chatContacts) {
      times.set(c.pubkeyPrefix, lastMessageTime(msgHistory, c));
    }
    return times;
  }, [chatContacts, contactSort, msgHistory]);
  const sortedChats = useMemo(
    () =>
      [...chatContacts].sort((a, b) => {
        // When pinning, favorites float above non-favorites but are still
        // ordered among themselves by the selected order below.
        if (pinFavorites) {
          const aFav = (a.flags & FAVORITE_FLAG) !== 0;
          const bFav = (b.flags & FAVORITE_FLAG) !== 0;
          if (aFav !== bFav) return aFav ? -1 : 1;
        }
        return compareBySort(a, b, contactSort, latestTimes, adverts, nowSecs);
      }),
    [chatContacts, contactSort, pinFavorites, latestTimes, adverts, nowSecs],
  );
  // Rooms get their own section; the search box sits in, and narrows, only
  // the Contacts section below it.
  const sortedRooms = useMemo(
    () => sortedChats.filter((c) => c.advType === ADV_TYPE_ROOM),
    [sortedChats],
  );
  const people = useMemo(
    () => sortedChats.filter((c) => c.advType !== ADV_TYPE_ROOM),
    [sortedChats],
  );
  const sortedContacts = useMemo(
    () => people.filter((c) => matchesQuery(c, query)),
    [people, query],
  );
  const hasContacts = people.length > 0;

  // Scroll the active row into view when the open conversation changes, so a
  // selection made elsewhere (e.g. the command palette) reveals its item even
  // when it sits far down the list.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeConvo?.id]);

  // Both resize handles write straight into the per-radio prefs blob, whose
  // save is already debounced — a drag coalesces into one encrypted write.
  const setChannelsHeight = useCallback(
    (next: number) => {
      setContactView({
        ...useMeshStore.getState().contactView,
        channelsHeight: next,
      });
    },
    [setContactView],
  );

  const setSidebarWidth = useCallback(
    (next: number) => {
      setContactView({
        ...useMeshStore.getState().contactView,
        width: clampSidebarWidth(next),
      });
    },
    [setContactView],
  );

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartH.current = channelsHeight;

      const onMove = (ev: MouseEvent) => {
        if (dragStartY.current === null || !sidebarRef.current) return;
        const delta = ev.clientY - dragStartY.current;
        const next = Math.min(
          sectionBounds.fit,
          Math.max(MIN_SECTION_PX, dragStartH.current + delta),
        );
        setChannelsHeight(next);
      };

      const onUp = () => {
        dragStartY.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [channelsHeight, sectionBounds.fit, setChannelsHeight],
  );

  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step =
        e.key === 'ArrowUp'
          ? -RESIZE_STEP_PX
          : e.key === 'ArrowDown'
            ? RESIZE_STEP_PX
            : 0;
      if (!step) return;
      e.preventDefault();
      // Live, not the render's copy: a held arrow key repeats faster than
      // React re-renders, and a stale base would swallow every repeat but one.
      const current = Math.min(
        sectionBounds.fit,
        Math.max(
          MIN_SECTION_PX,
          useMeshStore.getState().contactView.channelsHeight ?? channelsHeight,
        ),
      );
      setChannelsHeight(
        Math.min(sectionBounds.fit, Math.max(MIN_SECTION_PX, current + step)),
      );
    },
    [channelsHeight, sectionBounds.fit, setChannelsHeight],
  );

  const onWidthMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;

      const onMove = (ev: MouseEvent) =>
        setSidebarWidth(startW + (ev.clientX - startX));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [sidebarWidth, setSidebarWidth],
  );

  const onWidthKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step =
        e.key === 'ArrowLeft'
          ? -RESIZE_STEP_PX
          : e.key === 'ArrowRight'
            ? RESIZE_STEP_PX
            : 0;
      if (!step) return;
      e.preventDefault();
      setSidebarWidth(useMeshStore.getState().contactView.width + step);
    },
    [setSidebarWidth],
  );

  // One row for a contact or room: a room opens its post feed, a contact its
  // direct chat.
  const contactItem = (c: Contact) => {
    const convo = contactConvo(c, msgHistory);
    if (!convo) return null;
    const { id, label } = convo;
    const active = activeConvo?.id === id;
    const isFav = (c.flags & FAVORITE_FLAG) !== 0;
    return (
      <SidebarItem
        key={id}
        innerRef={active ? activeItemRef : undefined}
        icon={
          // The same star the chat header shows for a favorite, so the row
          // and the open conversation read as one.
          isFav ? (
            <>
              <span aria-hidden='true'>⭐</span>
              <span className='sr-only'>{t('sidebar.favorite')}</span>
            </>
          ) : (
            (ADV_ICON[c.advType] ?? '👤')
          )
        }
        label={label}
        active={active}
        unread={unreadCount(msgHistory, id)}
        onManage={() => setManagePanel({ kind: 'contact', id: c.pubkeyPrefix })}
        onClick={() => openConvo(convo)}
      />
    );
  };

  return (
    <aside
      ref={sidebarRef}
      className='relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface'
      // Only the dragged width is genuinely dynamic; the colors are utilities.
      style={{ width: sidebarWidth }}
    >
      {/* Channels */}
      <div
        ref={channelsSectionRef}
        className='flex shrink-0 flex-col pt-2 pb-1'
        style={{ height: channelsHeight }}
      >
        <div
          ref={channelsHeaderRef}
          className='flex shrink-0 items-center justify-between px-3.5 pb-1'
        >
          <h2
            id='sidebar-channels'
            className='text-[11px] font-semibold tracking-widest text-text2 uppercase'
          >
            {t('sidebar.channels')}
          </h2>
          <button
            onClick={() => setAddChannelOpen(true)}
            title={t('sidebar.addChannel')}
            aria-label={t('sidebar.addChannel')}
            className='text-text2 hover:text-accent'
          >
            <Plus size={16} aria-hidden='true' />
          </button>
        </div>
        <div className='flex-1 overflow-y-auto'>
          {/* The measured content area: the empty state has to be inside it,
              or a channel-less sidebar auto-sizes down to the header and
              hides its own Add action. */}
          <div ref={channelsContentRef}>
            <ul aria-labelledby='sidebar-channels'>
              {sortedChannels.map((ch) => {
                const id = channelConvoId(ch.idx);
                const unread = unreadCount(msgHistory, id);
                const active = activeConvo?.id === id;
                return (
                  <SidebarItem
                    key={id}
                    innerRef={active ? activeItemRef : undefined}
                    icon={isPublicChannelSecret(ch.secret) ? '📢' : '🔒'}
                    label={
                      ch.name || t('common.channelName', { index: ch.idx })
                    }
                    active={active}
                    unread={unread}
                    onManage={() =>
                      setManagePanel({ kind: 'channel', id: String(ch.idx) })
                    }
                    onClick={() =>
                      openConvo({
                        kind: 'channel',
                        id,
                        rawId: ch.idx,
                        label:
                          ch.name || t('common.channelName', { index: ch.idx }),
                      })
                    }
                  />
                );
              })}
            </ul>
            {sortedChannels.length === 0 && (
              <EmptyState
                message={t('sidebar.noChannels')}
                actionLabel={t('sidebar.addChannel')}
                onAction={() => setAddChannelOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Draggable divider */}
      <div
        ref={dividerRef}
        role='separator'
        aria-orientation='horizontal'
        aria-label={t('sidebar.dragResize')}
        aria-valuenow={channelsHeight}
        aria-valuemin={MIN_SECTION_PX}
        aria-valuemax={sectionBounds.fit}
        tabIndex={0}
        onMouseDown={onDividerMouseDown}
        onKeyDown={onDividerKeyDown}
        className='group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-border bg-surface focus-visible:outline-2 focus-visible:outline-accent'
        title={t('sidebar.dragResize')}
      >
        <div className='h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-accent' />
      </div>

      {/* Room Servers — only once one is saved. Sized to its rows, scrolling
          past a cap so it can never crowd out Contacts. */}
      {sortedRooms.length > 0 && (
        <div
          ref={roomsSectionRef}
          className='flex max-h-[35%] shrink-0 flex-col border-b border-border pt-2 pb-1'
        >
          <h2
            id='sidebar-rooms'
            className='shrink-0 px-3.5 pb-1 text-[11px] font-semibold tracking-widest text-text2 uppercase'
          >
            {t('sidebar.rooms')}
          </h2>
          <div className='min-h-0 overflow-y-auto'>
            <ul aria-labelledby='sidebar-rooms'>
              {sortedRooms.map(contactItem)}
            </ul>
          </div>
        </div>
      )}

      {/* Contacts */}
      <div
        ref={contactsSectionRef}
        className='flex min-h-0 flex-1 flex-col overflow-hidden pt-2'
      >
        <div
          ref={contactsHeaderRef}
          className='flex shrink-0 items-center justify-between px-3.5 pb-1'
        >
          <h2
            id='sidebar-contacts'
            className='text-[11px] font-semibold tracking-widest text-text2 uppercase'
          >
            {t('sidebar.contacts')}
          </h2>
          <div className='flex items-center gap-2'>
            <ContactsOrderMenu
              sort={contactSort}
              pinFavorites={pinFavorites}
              onSortChange={(sort) =>
                setContactView({
                  ...useMeshStore.getState().contactView,
                  sort,
                })
              }
              onPinFavoritesChange={(pinFavorites) =>
                setContactView({
                  ...useMeshStore.getState().contactView,
                  pinFavorites,
                })
              }
            />
            <button
              onClick={() => setAutoAddOpen(true)}
              title={t('sidebar.autoAddSettings')}
              aria-label={t('sidebar.autoAddSettings')}
              className='text-text2 hover:text-accent'
            >
              <Settings2 size={15} aria-hidden='true' />
            </button>
          </div>
        </div>
        <div ref={contactsSearchRef} className='shrink-0 px-3.5 pt-1 pb-2'>
          <label className='sr-only' htmlFor={filterInputId}>
            {t('sidebar.searchContacts')}
          </label>
          <input
            id={filterInputId}
            type='search'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.searchContacts')}
            className='w-full rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none placeholder:text-text2 focus:border-accent'
          />
        </div>
        <div className='flex-1 overflow-y-auto'>
          <ul aria-labelledby='sidebar-contacts'>
            {sortedContacts.map(contactItem)}
          </ul>
          {sortedContacts.length === 0 &&
            (hasContacts ? (
              <EmptyState
                message={t('sidebar.noContactsMatch')}
                actionLabel={t('sidebar.clearSearch')}
                onAction={() => setQuery('')}
              />
            ) : (
              <EmptyState
                message={t('sidebar.noContacts')}
                actionLabel={t('sidebar.browseNodes')}
                onAction={() => setView('nodes')}
              />
            ))}
        </div>
      </div>

      {/* Width handle, on the sidebar's own right edge. */}
      <div
        role='separator'
        aria-orientation='vertical'
        aria-label={t('sidebar.dragWidth')}
        aria-valuenow={sidebarWidth}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        tabIndex={0}
        onMouseDown={onWidthMouseDown}
        onKeyDown={onWidthKeyDown}
        title={t('sidebar.dragWidth')}
        className='absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
      />
    </aside>
  );
}

function ContactsOrderMenu({
  sort,
  pinFavorites,
  onSortChange,
  onPinFavoritesChange,
}: {
  sort: ContactSort;
  pinFavorites: boolean;
  onSortChange: (s: ContactSort) => void;
  onPinFavoritesChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useClickOutside(rootRef, open, () => setOpen(false));

  return (
    <div ref={rootRef} className='relative flex items-center'>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t('sidebar.orderContacts')}
        aria-label={t('sidebar.orderContacts')}
        aria-expanded={open}
        className='text-text2 hover:text-accent'
      >
        <ArrowUpDown size={14} aria-hidden='true' />
      </button>
      {open && (
        <div className='absolute top-full right-0 z-10 mt-1.5 w-44 rounded-card border border-border bg-surface2 py-1.5 text-xs shadow-pop'>
          <MenuHeading label={t('sidebar.orderHeading')} />
          <MenuToggle
            label={t('sidebar.pinFavorites')}
            checked={pinFavorites}
            onClick={() => onPinFavoritesChange(!pinFavorites)}
          />
          {SORT_OPTIONS.map((opt) => (
            <MenuRow
              key={opt.value}
              label={t(opt.labelKey)}
              selected={sort === opt.value}
              onClick={() => onSortChange(opt.value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuToggle({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <Switch
      checked={checked}
      onChange={onClick}
      label={label}
      className='px-3 py-1.5 transition-colors hover:bg-surface'
    />
  );
}

function MenuHeading({ label }: { label: string }) {
  return (
    <div className='px-3 py-1 text-[10px] font-semibold tracking-widest text-text2 uppercase'>
      {label}
    </div>
  );
}

function MenuRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-surface ${
        selected ? 'text-accent' : 'text-text'
      }`}
    >
      <span className='truncate'>{label}</span>
      {selected && <Check size={16} className='shrink-0' aria-hidden='true' />}
    </button>
  );
}

// Disabled rows (e.g. repeaters) aren't clickable to open.
function SidebarItem({
  icon,
  label,
  active,
  unread,
  disabled,
  title,
  innerRef,
  onManage,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  unread: number;
  disabled?: boolean;
  title?: string;
  innerRef?: React.Ref<HTMLLIElement>;
  onManage: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      ref={innerRef}
      className={`group flex w-full items-center gap-2 px-3.5 py-2 text-sm transition-colors ${
        disabled
          ? 'text-text2'
          : active
            ? 'bg-accent/10 text-accent'
            : 'text-text hover:bg-surface2'
      }`}
    >
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={title}
        aria-current={active ? 'true' : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${disabled ? 'cursor-default' : ''}`}
      >
        <span className='shrink-0 text-base'>{icon}</span>
        <span className='flex-1 truncate'>{label}</span>
      </button>
      {unread > 0 && (
        <span className='min-w-4.5 rounded-full bg-accent-solid px-1.5 py-0.5 text-center text-[10px] font-bold text-white'>
          {unread}
        </span>
      )}
      <button
        onClick={onManage}
        title={t('sidebar.manage')}
        aria-label={t('sidebar.manage')}
        className='shrink-0 text-text2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-text'
      >
        <MoreHorizontal size={16} aria-hidden='true' />
      </button>
    </li>
  );
}

// Shown in place of an empty section list, so "nothing here yet" reads
// differently from "nothing matched" and both offer the way out.
function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className='px-3.5 py-3 text-center text-xs text-text2'>
      <p>{message}</p>
      <button
        onClick={onAction}
        className='mt-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-surface2'
      >
        {actionLabel}
      </button>
    </div>
  );
}
