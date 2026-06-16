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

import { useRef, useState, useCallback, useLayoutEffect } from 'react';
import {
  useMeshStore,
  openConvo,
  channelConvoId,
  directConvoId,
  unreadCount,
} from '@/store/meshStore';
import { useTranslation } from '@/hooks/useTranslation';
import { ADV_ICON } from '@/lib/utils';
import { ADV_TYPE_REPEATER, FAVORITE_FLAG } from '@/lib/meshcore/constants';

/**
 * Minimum height (px) either sidebar section can be collapsed to via the
 * divider.
 */
const MIN_SECTION_PX = 40;

/**
 * Left navigation: a Channels section over a Contacts section, split by a
 * draggable divider. Auto-sizes the channels section to fit (until the user
 * drags it), sorts contacts favorites-first, and exposes add/settings/manage
 * affordances. Selecting an item opens that conversation.
 */
export function Sidebar() {
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
  const { t } = useTranslation();
  const [channelsHeight, setChannelsHeight] = useState(160);
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
  const sortedContacts = Object.values(contacts).sort((a, b) => {
    const aFav = a.flags & FAVORITE_FLAG ? 0 : 1;
    const bFav = b.flags & FAVORITE_FLAG ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.name.localeCompare(b.name);
  });

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
            {t('sidebarChannels')}
          </span>
          <button
            onClick={() => setAddChannelOpen(true)}
            title={t('sidebarAddChannel')}
            aria-label={t('sidebarAddChannel')}
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
              const chLabel = ch.name || t('channelN', { n: ch.idx });
              return (
                <SidebarItem
                  key={id}
                  icon={ch.idx === 0 ? '📢' : '🔒'}
                  label={chLabel}
                  active={active}
                  unread={unread}
                  manageLabel={t('sidebarManage')}
                  onManage={() =>
                    setManagePanel({ kind: 'channel', id: String(ch.idx) })
                  }
                  onClick={() =>
                    openConvo({
                      kind: 'channel',
                      id,
                      rawId: ch.idx,
                      label: chLabel,
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
        title={t('sidebarDragToResize')}
      >
        <div className='h-0.5 w-8 rounded-full bg-(--border) transition-colors group-hover:bg-(--accent)' />
      </div>

      {/* Contacts */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden pt-2'>
        <div className='flex shrink-0 items-center justify-between px-3.5 pb-1'>
          <span className='text-[11px] font-semibold tracking-widest text-(--text2) uppercase'>
            {t('sidebarContacts')}
          </span>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setAutoAddOpen(true)}
              title={t('sidebarAutoAddSettings')}
              aria-label={t('sidebarAutoAddSettings')}
              className='text-(--text2) hover:text-(--accent)'
            >
              ⚙
            </button>
            <button
              onClick={() => setDiscoverOpen(true)}
              title={t('sidebarAddContact')}
              aria-label={t('sidebarAddContact')}
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
            const contactLabel = c.name || c.pubkeyPrefix.slice(0, 8);
            return (
              <SidebarItem
                key={id}
                icon={isFav ? '⭐' : (ADV_ICON[c.advType] ?? '👤')}
                label={contactLabel}
                active={active}
                unread={unread}
                disabled={isRepeater}
                title={isRepeater ? t('chatRepeaterBlock') : undefined}
                manageLabel={t('sidebarManage')}
                onManage={() =>
                  setManagePanel({ kind: 'contact', id: c.pubkeyPrefix })
                }
                onClick={() =>
                  openConvo({
                    kind: 'direct',
                    id,
                    rawId: c.pubkeyPrefix,
                    label: contactLabel,
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
 * One channel/contact row: icon, label, unread badge, and a hover-revealed
 * manage (`⋯`) button. Disabled rows (e.g. repeaters) aren't clickable to open.
 *
 * @param onManage - opens the manage panel for this item.
 * @param onClick - opens this conversation.
 * @param manageLabel - accessible label for the manage button (localized).
 */
function SidebarItem({
  icon,
  label,
  active,
  unread,
  disabled,
  title,
  manageLabel,
  onManage,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  unread: number;
  disabled?: boolean;
  title?: string;
  manageLabel: string;
  onManage: () => void;
  onClick: () => void;
}) {
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
        title={manageLabel}
        aria-label={manageLabel}
        className='shrink-0 text-(--text2) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--text)'
      >
        ⋯
      </button>
    </div>
  );
}
