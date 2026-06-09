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

import { useRef, useState, useCallback } from 'react';
import {
  useMeshStore,
  openConvo,
  channelConvoId,
  directConvoId,
  unreadCount,
} from '@/store/meshStore';
import { ADV_ICON } from '@/lib/utils';

const FAVOURITE_FLAG = 0x01;
const MIN_SECTION_PX = 40;

export function Sidebar() {
  const { channels, contacts, msgHistory, activeConvo } = useMeshStore();
  const [channelsHeight, setChannelsHeight] = useState(160);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef(160);
  const sidebarRef = useRef<HTMLElement>(null);
  const channelsSectionRef = useRef<HTMLDivElement>(null);
  const channelsListRef = useRef<HTMLDivElement>(null);
  const channelsHeaderRef = useRef<HTMLDivElement>(null);

  const sortedChannels = Object.values(channels).sort((a, b) => a.idx - b.idx);
  const sortedContacts = Object.values(contacts).sort((a, b) => {
    const aFav = a.flags & FAVOURITE_FLAG ? 0 : 1;
    const bFav = b.flags & FAVOURITE_FLAG ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.name.localeCompare(b.name);
  });

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartY.current = e.clientY;
      dragStartH.current = channelsHeight;

      const onMove = (ev: MouseEvent) => {
        if (dragStartY.current === null || !sidebarRef.current) return;
        const delta = ev.clientY - dragStartY.current;
        const section = channelsSectionRef.current;
        const style = section ? getComputedStyle(section) : null;
        const sectionPadding = style
          ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
          : 0;
        const headerH = channelsHeaderRef.current?.offsetHeight ?? 0;
        const contentMax =
          Math.ceil(
            (channelsListRef.current?.scrollHeight ?? 9999) +
              headerH +
              sectionPadding,
          ) + 1;
        const next = Math.min(
          contentMax,
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
    [channelsHeight],
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
          className='shrink-0 px-3.5 pb-1 text-[11px] font-semibold tracking-widest text-(--text2) uppercase'
        >
          Channels
        </div>
        <div ref={channelsListRef} className='flex-1 overflow-y-auto'>
          {sortedChannels.map((ch) => {
            const id = channelConvoId(ch.idx);
            const unread = unreadCount(msgHistory, id);
            const active = activeConvo?.id === id;
            return (
              <SidebarItem
                key={id}
                icon={ch.idx === 0 ? '📢' : '🔒'}
                label={ch.name || `Channel ${ch.idx}`}
                active={active}
                unread={unread}
                onClick={() =>
                  openConvo({
                    kind: 'channel',
                    id,
                    rawId: ch.idx,
                    label: ch.name || `Channel ${ch.idx}`,
                  })
                }
              />
            );
          })}
        </div>
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className='group flex h-2 shrink-0 cursor-row-resize items-center justify-center'
        style={{
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
        title='Drag to resize'
      >
        <div className='h-0.5 w-8 rounded-full bg-(--border) transition-colors group-hover:bg-(--accent)' />
      </div>

      {/* Contacts */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden pt-2'>
        <div className='shrink-0 px-3.5 pb-1 text-[11px] font-semibold tracking-widest text-(--text2) uppercase'>
          Contacts
        </div>
        <div className='flex-1 overflow-y-auto'>
          {sortedContacts.map((c) => {
            const id = directConvoId(c.pubkeyPrefix);
            const unread = unreadCount(msgHistory, id);
            const active = activeConvo?.id === id;
            const isFav = (c.flags & FAVOURITE_FLAG) !== 0;
            return (
              <SidebarItem
                key={id}
                icon={isFav ? '⭐' : (ADV_ICON[c.advType] ?? '👤')}
                label={c.name || c.pubkeyPrefix.slice(0, 8)}
                active={active}
                unread={unread}
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

function SidebarItem({
  icon,
  label,
  active,
  unread,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
        active
          ? 'bg-[rgba(79,142,247,0.15)] text-(--accent)'
          : 'text-(--text) hover:bg-(--surface2)'
      }`}
    >
      <span className='shrink-0 text-base'>{icon}</span>
      <span className='flex-1 truncate'>{label}</span>
      {unread > 0 && (
        <span className='min-w-4.5 rounded-full bg-(--accent) px-1.5 py-0.5 text-center text-[10px] font-bold text-white'>
          {unread}
        </span>
      )}
    </button>
  );
}
