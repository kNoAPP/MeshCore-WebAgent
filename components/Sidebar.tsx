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

'use client';

import {
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useMeshStore,
  openConvo,
  channelConvoId,
  directConvoId,
  unreadCount,
} from '@/store/meshStore';
import { ADV_ICON } from '@/lib/utils';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
  FAVORITE_FLAG,
} from '@/lib/meshcore/constants';
import type { Contact, Message } from '@/types/meshcore';

/**
 * Minimum height (px) either sidebar section can be collapsed to via the
 * divider.
 */
const MIN_SECTION_PX = 40;

/** Which subset of contacts the sidebar shows. */
type ContactFilter =
  | 'all'
  | 'favorites'
  | 'users'
  | 'repeaters'
  | 'rooms'
  | 'sensors';

/** How the visible contacts are ordered. */
type ContactSort = 'az' | 'heard' | 'latest';

/** Filter options in the order they appear in the menu. */
const FILTER_OPTIONS: ContactFilter[] = [
  'all',
  'favorites',
  'users',
  'repeaters',
  'rooms',
  'sensors',
];

/** Order options in the order they appear in the menu. */
const SORT_OPTIONS: ContactSort[] = ['az', 'heard', 'latest'];

/** Localized label for a contact filter. */
function filterLabel(t: TFunction, filter: ContactFilter): string {
  switch (filter) {
    case 'all':
      return t('sidebar.filterAll');
    case 'favorites':
      return t('sidebar.filterFavorites');
    case 'users':
      return t('sidebar.filterUsers');
    case 'repeaters':
      return t('sidebar.filterRepeaters');
    case 'rooms':
      return t('sidebar.filterRooms');
    case 'sensors':
      return t('sidebar.filterSensors');
  }
}

/** Localized label for a contact sort order. */
function sortLabel(t: TFunction, sort: ContactSort): string {
  switch (sort) {
    case 'az':
      return t('sidebar.orderAz');
    case 'heard':
      return t('sidebar.orderHeard');
    case 'latest':
      return t('sidebar.orderLatest');
  }
}

/** Whether a contact belongs in the given filter subset. */
function matchesFilter(c: Contact, filter: ContactFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'favorites':
      return (c.flags & FAVORITE_FLAG) !== 0;
    case 'users':
      // advType 0 ("none") and 1 ("chat") are both plain companion users.
      return (
        c.advType !== ADV_TYPE_REPEATER &&
        c.advType !== ADV_TYPE_ROOM &&
        c.advType !== ADV_TYPE_SENSOR
      );
    case 'repeaters':
      return c.advType === ADV_TYPE_REPEATER;
    case 'rooms':
      return c.advType === ADV_TYPE_ROOM;
    case 'sensors':
      return c.advType === ADV_TYPE_SENSOR;
  }
}

/**
 * Timestamp (Unix secs) of the most recent message in a contact's
 * conversation, or 0 if there are none. Messages are appended chronologically,
 * so the last entry is newest.
 */
function lastMessageTime(
  msgHistory: Record<string, Message[]>,
  prefix: string,
): number {
  const msgs = msgHistory[directConvoId(prefix)];
  return msgs?.length ? (msgs[msgs.length - 1].timestamp ?? 0) : 0;
}

/** Compares two contacts by the selected order (newest/most-recent first). */
function compareBySort(
  a: Contact,
  b: Contact,
  sort: ContactSort,
  latestTimes: Map<string, number>,
): number {
  switch (sort) {
    case 'heard':
      return (b.lastAdvert ?? 0) - (a.lastAdvert ?? 0);
    case 'latest':
      return (
        (latestTimes.get(b.pubkeyPrefix) ?? 0) -
        (latestTimes.get(a.pubkeyPrefix) ?? 0)
      );
    case 'az':
    default:
      return a.name.localeCompare(b.name);
  }
}

/**
 * Left navigation: a Channels section over a Contacts section, split by a
 * draggable divider. Auto-sizes the channels section to fit (until the user
 * drags it), lets contacts be filtered and ordered, and exposes
 * add/settings/manage affordances. Selecting an item opens that conversation.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const {
    channels,
    contacts,
    msgHistory,
    activeConvo,
    setManagePanel,
    setDiscoverOpen,
    setAutoAddOpen,
    setAddChannelOpen,
  } = useMeshStore();
  const [channelsHeight, setChannelsHeight] = useState(160);
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [contactSort, setContactSort] = useState<ContactSort>('az');
  const [pinFavorites, setPinFavorites] = useState(true);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef(160);
  const userResized = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const channelsSectionRef = useRef<HTMLDivElement>(null);
  const channelsContentRef = useRef<HTMLDivElement>(null);
  const channelsHeaderRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  const sortedChannels = Object.values(channels).sort((a, b) => a.idx - b.idx);

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

  useLayoutEffect(() => {
    if (userResized.current || !sidebarRef.current) return;
    const dividerH = dividerRef.current?.offsetHeight ?? 0;
    const contactsMatchHeight = Math.floor(
      (sidebarRef.current.offsetHeight - dividerH) / 2,
    );
    setChannelsHeight(
      Math.max(
        MIN_SECTION_PX,
        Math.min(measureChannelsFitHeight(), contactsMatchHeight),
      ),
    );
  }, [sortedChannels.length, measureChannelsFitHeight]);
  const sortedContacts = (() => {
    const filtered = Object.values(contacts).filter((c) =>
      matchesFilter(c, contactFilter),
    );
    // Precompute each contact's latest-message timestamp once so the
    // comparator doesn't recompute it on every comparison during sort.
    const latestTimes = new Map<string, number>();
    if (contactSort === 'latest') {
      for (const c of filtered) {
        latestTimes.set(
          c.pubkeyPrefix,
          lastMessageTime(msgHistory, c.pubkeyPrefix),
        );
      }
    }
    return filtered.sort((a, b) => {
      // When pinning, favorites float above non-favorites but are still
      // ordered among themselves by the selected order below.
      if (pinFavorites) {
        const aFav = (a.flags & FAVORITE_FLAG) !== 0;
        const bFav = (b.flags & FAVORITE_FLAG) !== 0;
        if (aFav !== bFav) return aFav ? -1 : 1;
      }
      return compareBySort(a, b, contactSort, latestTimes);
    });
  })();

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartH.current = channelsHeight;
      userResized.current = true;

      const onMove = (ev: MouseEvent) => {
        if (dragStartY.current === null || !sidebarRef.current) return;
        const delta = ev.clientY - dragStartY.current;
        const next = Math.min(
          measureChannelsFitHeight(),
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
    [channelsHeight, measureChannelsFitHeight],
  );

  return (
    <aside
      ref={sidebarRef}
      className='flex w-60 shrink-0 flex-col overflow-hidden border-r'
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
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
          <span className='text-[11px] font-semibold tracking-widest text-(--text2) uppercase'>
            {t('sidebar.channels')}
          </span>
          <button
            onClick={() => setAddChannelOpen(true)}
            title={t('sidebar.addChannel')}
            aria-label={t('sidebar.addChannel')}
            className='text-(--text2) hover:text-(--accent)'
          >
            ＋
          </button>
        </div>
        <div className='flex-1 overflow-y-auto'>
          <div ref={channelsContentRef}>
            {sortedChannels.map((ch) => {
              const id = channelConvoId(ch.idx);
              const unread = unreadCount(msgHistory, id);
              const active = activeConvo?.id === id;
              return (
                <SidebarItem
                  key={id}
                  icon={ch.idx === 0 ? '📢' : '🔒'}
                  label={ch.name || t('common.channelName', { index: ch.idx })}
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
          </div>
        </div>
      </div>

      {/* Draggable divider */}
      <div
        ref={dividerRef}
        onMouseDown={onDividerMouseDown}
        className='group flex h-2 shrink-0 cursor-row-resize items-center justify-center'
        style={{
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
        title={t('sidebar.dragResize')}
      >
        <div className='h-0.5 w-8 rounded-full bg-(--border) transition-colors group-hover:bg-(--accent)' />
      </div>

      {/* Contacts */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden pt-2'>
        <div className='flex shrink-0 items-center justify-between px-3.5 pb-1'>
          <span className='text-[11px] font-semibold tracking-widest text-(--text2) uppercase'>
            {t('sidebar.contacts')}
          </span>
          <div className='flex items-center gap-2'>
            <ContactsFilterMenu
              filter={contactFilter}
              sort={contactSort}
              pinFavorites={pinFavorites}
              onFilterChange={setContactFilter}
              onSortChange={setContactSort}
              onPinFavoritesChange={setPinFavorites}
            />
            <button
              onClick={() => setAutoAddOpen(true)}
              title={t('sidebar.autoAddSettings')}
              aria-label={t('sidebar.autoAddSettings')}
              className='text-(--text2) hover:text-(--accent)'
            >
              ⚙
            </button>
            <button
              onClick={() => setDiscoverOpen(true)}
              title={t('sidebar.addContact')}
              aria-label={t('sidebar.addContact')}
              className='text-(--text2) hover:text-(--accent)'
            >
              ＋
            </button>
          </div>
        </div>
        <div className='flex-1 overflow-y-auto'>
          {sortedContacts.map((c) => {
            const id = directConvoId(c.pubkeyPrefix);
            const unread = unreadCount(msgHistory, id);
            const active = activeConvo?.id === id;
            const isFav = (c.flags & FAVORITE_FLAG) !== 0;
            const isRepeater = c.advType === ADV_TYPE_REPEATER;
            return (
              <SidebarItem
                key={id}
                icon={isFav ? '⭐' : (ADV_ICON[c.advType] ?? '👤')}
                label={c.name || c.pubkeyPrefix.slice(0, 8)}
                active={active}
                unread={unread}
                disabled={isRepeater}
                title={
                  isRepeater ? t('sidebar.repeaterCantMessage') : undefined
                }
                onManage={() =>
                  setManagePanel({ kind: 'contact', id: c.pubkeyPrefix })
                }
                onClick={() =>
                  openConvo({
                    kind: 'direct',
                    id,
                    rawId: c.pubkeyPrefix,
                    label: c.name || c.pubkeyPrefix.slice(0, 8),
                  })
                }
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/**
 * Funnel glyph for the contacts filter button, sized to sit alongside the
 * sibling emoji affordances and inheriting the current text color.
 */
function FunnelIcon() {
  return (
    <svg
      viewBox='0 0 16 16'
      className='h-3.5 w-3.5'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M2 3h12l-4.5 5.5V13L6.5 11V8.5L2 3Z' />
    </svg>
  );
}

/**
 * Filter-and-order popover for the contacts list. Lets the user narrow the
 * list to a contact category and choose the sort order. State lives in the
 * parent {@link Sidebar}; this component only renders the trigger and menu.
 *
 * @param onFilterChange - selects which contact subset is shown.
 * @param onSortChange - selects the contact ordering.
 */
function ContactsFilterMenu({
  filter,
  sort,
  pinFavorites,
  onFilterChange,
  onSortChange,
  onPinFavoritesChange,
}: {
  filter: ContactFilter;
  sort: ContactSort;
  pinFavorites: boolean;
  onFilterChange: (f: ContactFilter) => void;
  onSortChange: (s: ContactSort) => void;
  onPinFavoritesChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Highlight the trigger whenever a non-default filter is narrowing the list.
  const filtering = filter !== 'all';

  return (
    <div ref={rootRef} className='relative flex items-center'>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t('sidebar.filterContacts')}
        aria-label={t('sidebar.filterContacts')}
        aria-expanded={open}
        className={`hover:text-(--accent) ${filtering ? 'text-(--accent)' : 'text-(--text2)'}`}
      >
        <FunnelIcon />
      </button>
      {open && (
        <div
          className='absolute top-full right-0 z-10 mt-1.5 w-44 rounded-[10px] border py-1.5 text-xs shadow-lg'
          style={{
            background: 'var(--surface2)',
            borderColor: 'var(--border)',
          }}
        >
          <MenuHeading label={t('sidebar.filterHeading')} />
          {FILTER_OPTIONS.map((opt) => (
            <MenuRow
              key={opt}
              label={filterLabel(t, opt)}
              selected={filter === opt}
              onClick={() => onFilterChange(opt)}
            />
          ))}
          <div
            className='my-1 border-t'
            style={{ borderColor: 'var(--border)' }}
          />
          <MenuHeading label={t('sidebar.orderHeading')} />
          <MenuToggle
            label={t('sidebar.pinFavorites')}
            checked={pinFavorites}
            onClick={() => onPinFavoritesChange(!pinFavorites)}
          />
          {SORT_OPTIONS.map((opt) => (
            <MenuRow
              key={opt}
              label={sortLabel(t, opt)}
              selected={sort === opt}
              onClick={() => onSortChange(opt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A labeled sliding toggle switch row inside the contacts filter menu. */
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
    <button
      role='switch'
      aria-checked={checked}
      onClick={onClick}
      className='flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-(--text) transition-colors hover:bg-(--surface)'
    >
      <span className='truncate'>{label}</span>
      <span
        className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
        style={{ background: checked ? 'var(--accent)' : 'var(--border)' }}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
            checked ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

/** Section label inside the contacts filter menu. */
function MenuHeading({ label }: { label: string }) {
  return (
    <div className='px-3 py-1 text-[10px] font-semibold tracking-widest text-(--text2) uppercase'>
      {label}
    </div>
  );
}

/**
 * One selectable option inside the contacts filter menu. The selected row is
 * accented and marked with a check.
 */
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
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-(--surface) ${
        selected ? 'text-(--accent)' : 'text-(--text)'
      }`}
    >
      <span className='truncate'>{label}</span>
      {selected && <span className='shrink-0'>✓</span>}
    </button>
  );
}

/**
 * One channel/contact row: icon, label, unread badge, and a hover-revealed
 * manage (`⋯`) button. Disabled rows (e.g. repeaters) aren't clickable to open.
 *
 * @param onManage - opens the manage panel for this item.
 * @param onClick - opens this conversation.
 */
function SidebarItem({
  icon,
  label,
  active,
  unread,
  disabled,
  title,
  onManage,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  unread: number;
  disabled?: boolean;
  title?: string;
  onManage: () => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`group flex w-full items-center gap-2 px-3.5 py-2 text-sm transition-colors ${
        disabled
          ? 'text-(--text2)'
          : active
            ? 'bg-[rgba(79,142,247,0.15)] text-(--accent)'
            : 'text-(--text) hover:bg-(--surface2)'
      }`}
    >
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={title}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${disabled ? 'cursor-default' : ''}`}
      >
        <span className='shrink-0 text-base'>{icon}</span>
        <span className='flex-1 truncate'>{label}</span>
      </button>
      {unread > 0 && (
        <span className='min-w-4.5 rounded-full bg-(--accent) px-1.5 py-0.5 text-center text-[10px] font-bold text-white'>
          {unread}
        </span>
      )}
      <button
        onClick={onManage}
        title={t('sidebar.manage')}
        aria-label={t('sidebar.manage')}
        className='shrink-0 text-(--text2) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--text)'
      >
        ⋯
      </button>
    </div>
  );
}
