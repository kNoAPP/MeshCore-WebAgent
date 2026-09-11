// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

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
import { Plus, Settings2, MoreHorizontal, Filter } from 'lucide-react';
import {
  useMeshStore,
  openConvo,
  channelConvoId,
  directConvoId,
  repeaterConvoId,
  unreadCount,
  clampSidebarWidth,
  CONTACT_FILTERS,
  CONTACT_SORTS,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  type ContactFilter,
  type ContactSort,
} from '@/store/meshStore';
import {
  ADV_ICON,
  contactCategory,
  isPublicChannelSecret,
  type ContactCategory,
} from '@/lib/utils';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  FAVORITE_FLAG,
} from '@/lib/meshcore/constants';
import { useClickOutside } from '@/hooks/useClickOutside';
import { Switch } from './Switch';
import type { Contact, Message } from '@/types/meshcore';

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

const FILTER_LABEL_KEYS = {
  all: 'sidebar.filterAll',
  favorites: 'sidebar.filterFavorites',
  users: 'sidebar.filterUsers',
  repeaters: 'sidebar.filterRepeaters',
  rooms: 'sidebar.filterRooms',
  sensors: 'sidebar.filterSensors',
} as const satisfies Record<ContactFilter, string>;

const SORT_LABEL_KEYS = {
  az: 'sidebar.orderAz',
  heard: 'sidebar.orderHeard',
  latest: 'sidebar.orderLatest',
} as const satisfies Record<ContactSort, string>;

// Order and membership come from CONTACT_FILTERS/CONTACT_SORTS (also the
// persistence allowlist), so the menu can't drift from the stored values.
const FILTER_OPTIONS = CONTACT_FILTERS.map((value) => ({
  value,
  labelKey: FILTER_LABEL_KEYS[value],
}));
const SORT_OPTIONS = CONTACT_SORTS.map((value) => ({
  value,
  labelKey: SORT_LABEL_KEYS[value],
}));

const FILTER_CATEGORIES: Partial<Record<ContactFilter, ContactCategory>> = {
  users: 'user',
  repeaters: 'repeater',
  rooms: 'room',
  sensors: 'sensor',
};

function matchesFilter(c: Contact, filter: ContactFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'favorites') return (c.flags & FAVORITE_FLAG) !== 0;
  return contactCategory(c.advType) === FILTER_CATEGORIES[filter];
}

// Scans all messages rather than trusting append order, since a delayed or
// retransmitted message can arrive after one with a newer timestamp.
function lastMessageTime(
  msgHistory: Record<string, Message[]>,
  contact: Contact,
): number {
  const msgs = msgHistory[directConvoId(contact.pubkeyPrefix)];
  if (!msgs?.length) return 0;
  let latest = 0;
  for (const m of msgs) {
    if ((m.timestamp ?? 0) > latest) latest = m.timestamp ?? 0;
  }
  return latest;
}

// Shared, so orders that don't need per-contact times keep a stable reference.
const EMPTY_LATEST_TIMES: ReadonlyMap<string, number> = new Map();

function compareBySort(
  a: Contact,
  b: Contact,
  sort: ContactSort,
  latestTimes: ReadonlyMap<string, number>,
): number {
  switch (sort) {
    case 'heard': {
      const diff = (b.lastAdvert ?? 0) - (a.lastAdvert ?? 0);
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
 * draggable divider. Auto-sizes the channels section to fit (until the user
 * drags it), lets contacts be filtered and ordered, and exposes
 * add/settings/manage affordances. Selecting an item opens that conversation.
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
  const setAddContactOpen = useMeshStore((s) => s.setAddContactOpen);
  const {
    filter: contactFilter,
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
  const contactsSectionRef = useRef<HTMLDivElement>(null);
  const contactsHeaderRef = useRef<HTMLDivElement>(null);
  const contactsSearchRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLLIElement>(null);
  const filterInputId = useId();

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
      const contactsMinimum =
        contactsPadding +
        (contactsHeaderRef.current?.offsetHeight ?? 0) +
        (contactsSearchRef.current?.offsetHeight ?? 0) +
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
    return () => observer.disconnect();
  }, [sortedChannels.length, measureChannelsFitHeight]);

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
  const latestTimes = useMemo(() => {
    if (contactSort !== 'latest') return EMPTY_LATEST_TIMES;
    const times = new Map<string, number>();
    for (const c of Object.values(contacts)) {
      times.set(c.pubkeyPrefix, lastMessageTime(msgHistory, c));
    }
    return times;
  }, [contacts, contactSort, msgHistory]);
  const sortedContacts = useMemo(() => {
    const filtered = Object.values(contacts).filter(
      (c) => matchesFilter(c, contactFilter) && matchesQuery(c, query),
    );
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
  }, [contacts, contactFilter, contactSort, pinFavorites, latestTimes, query]);
  const hasContacts = Object.keys(contacts).length > 0;

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

  const clearFilters = () => {
    setQuery('');
    setContactView({
      ...useMeshStore.getState().contactView,
      filter: 'all',
    });
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
            <ContactsFilterMenu
              filter={contactFilter}
              sort={contactSort}
              pinFavorites={pinFavorites}
              onFilterChange={(filter) =>
                setContactView({
                  ...useMeshStore.getState().contactView,
                  filter,
                })
              }
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
            <button
              onClick={() => setAddContactOpen(true)}
              title={t('sidebar.addContact')}
              aria-label={t('sidebar.addContact')}
              className='text-text2 hover:text-accent'
            >
              <Plus size={16} aria-hidden='true' />
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
            {sortedContacts.map((c) => {
              // Repeaters and room servers are remote-admin targets, so
              // selecting one opens its admin view instead of a chat.
              const isAdminNode =
                c.advType === ADV_TYPE_REPEATER || c.advType === ADV_TYPE_ROOM;
              const id = isAdminNode
                ? repeaterConvoId(c.pubkeyPrefix)
                : directConvoId(c.pubkeyPrefix);
              const unread = unreadCount(msgHistory, id);
              const active = activeConvo?.id === id;
              const isFav = (c.flags & FAVORITE_FLAG) !== 0;
              const label = c.name || c.pubkeyPrefix.slice(0, 8);
              return (
                <SidebarItem
                  key={id}
                  innerRef={active ? activeItemRef : undefined}
                  icon={isFav ? '⭐' : (ADV_ICON[c.advType] ?? '👤')}
                  label={label}
                  active={active}
                  unread={unread}
                  onManage={() =>
                    setManagePanel({ kind: 'contact', id: c.pubkeyPrefix })
                  }
                  onClick={() =>
                    openConvo({
                      kind: isAdminNode ? 'repeater' : 'direct',
                      id,
                      rawId: c.pubkeyPrefix,
                      label,
                    })
                  }
                />
              );
            })}
          </ul>
          {sortedContacts.length === 0 &&
            (hasContacts ? (
              <EmptyState
                message={t('sidebar.noContactsMatch')}
                actionLabel={t('sidebar.clearFilters')}
                onAction={clearFilters}
              />
            ) : (
              <EmptyState
                message={t('sidebar.noContacts')}
                actionLabel={t('sidebar.addContact')}
                onAction={() => setAddContactOpen(true)}
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

function FunnelIcon() {
  return <Filter size={14} aria-hidden='true' />;
}

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

  useClickOutside(rootRef, open, () => setOpen(false));

  // Highlight the trigger whenever a non-default filter is narrowing the list.
  const filtering = filter !== 'all';

  return (
    <div ref={rootRef} className='relative flex items-center'>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t('sidebar.filterContacts')}
        aria-label={t('sidebar.filterContacts')}
        aria-expanded={open}
        className={`hover:text-accent ${filtering ? 'text-accent' : 'text-text2'}`}
      >
        <FunnelIcon />
      </button>
      {open && (
        <div className='absolute top-full right-0 z-10 mt-1.5 w-44 rounded-card border border-border bg-surface2 py-1.5 text-xs shadow-pop'>
          <MenuHeading label={t('sidebar.filterHeading')} />
          {FILTER_OPTIONS.map((opt) => (
            <MenuRow
              key={opt.value}
              label={t(opt.labelKey)}
              selected={filter === opt.value}
              onClick={() => onFilterChange(opt.value)}
            />
          ))}
          <div className='my-1 border-t border-border' />
          <MenuHeading label={t('sidebar.orderHeading')} />
          {/* Pinning does nothing when the list is already only favorites. */}
          {filter !== 'favorites' && (
            <MenuToggle
              label={t('sidebar.pinFavorites')}
              checked={pinFavorites}
              onClick={() => onPinFavoritesChange(!pinFavorites)}
            />
          )}
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
      {selected && <span className='shrink-0'>✓</span>}
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
  icon: string;
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
