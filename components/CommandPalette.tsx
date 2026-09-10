// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Hash,
  MessageSquare,
  Radio,
  Search,
  User,
  X,
} from 'lucide-react';
import { useMeshStore, openConvo } from '@/store/meshStore';
import { formatRelative } from '@/lib/i18n/format';
import type { CommandKind, CommandResult } from '@/lib/search/commandSearch';
import { useCommandSearch } from '@/hooks/useCommandSearch';
import { ModalShell } from './ModalShell';

const KIND_ICON: Record<CommandKind, typeof Search> = {
  message: MessageSquare,
  contact: User,
  advert: Radio,
  channel: Hash,
  page: ArrowRight,
};

const LISTBOX_ID = 'command-results';

// Must be stable across renders for `aria-activedescendant`.
const optionId = (i: number): string => `command-option-${i}`;

// Fuse match ranges are inclusive `[start, end]` character offsets.
function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges?: CommandResult['highlight'];
}): React.ReactNode {
  if (!ranges?.length) return text;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    const from = Math.max(cursor, start);
    if (from > end) continue;
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(
      <span key={from} className='font-semibold text-accent'>
        {text.slice(from, end + 1)}
      </span>,
    );
    cursor = end + 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function ResultRow({
  result,
  active,
  index,
  onActivate,
  onHover,
}: {
  result: CommandResult;
  active: boolean;
  index: number;
  onActivate: () => void;
  onHover: () => void;
}): React.ReactElement {
  const Icon = KIND_ICON[result.kind];
  return (
    <button
      type='button'
      id={optionId(index)}
      data-idx={index}
      role='option'
      aria-selected={active}
      // The input owns the tab stop and drives `aria-activedescendant`; a
      // focusable option would put ~30 extra stops between it and Close.
      tabIndex={-1}
      onClick={onActivate}
      onMouseMove={onHover}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
        active ? 'bg-surface2' : ''
      }`}
    >
      <Icon size={16} className='shrink-0 text-text2' />
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-sm text-text'>
          <Highlighted text={result.primary} ranges={result.highlight} />
        </span>
        {result.secondary && (
          <span className='truncate text-xs text-text2'>
            {result.secondary}
          </span>
        )}
      </span>
      {result.timestamp != null && (
        <span className='shrink-0 text-xs text-text2'>
          {formatRelative(result.timestamp)}
        </span>
      )}
    </button>
  );
}

/**
 * The global "Find Anything" command palette: a centered modal with a search
 * input over grouped, ranked results (messages, contacts, channels, and
 * navigation targets). Typing filters via Fuse.js; an empty query shows recent
 * conversations and page shortcuts. Arrow keys move the highlight across
 * groups, Enter activates, Escape (or a backdrop click) closes. Mounted only
 * while the palette is open.
 */
export function CommandPalette(): React.ReactElement {
  const { t } = useTranslation();
  const closeCommandPalette = useMeshStore((s) => s.closeCommandPalette);
  const setView = useMeshStore((s) => s.setView);
  const openSettingsSection = useMeshStore((s) => s.openSettingsSection);
  const setScrollToMsgId = useMeshStore((s) => s.setScrollToMsgId);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useCommandSearch(query);
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);
  // Clamp so a result set that shrank (e.g. from a live store update) can't
  // leave the highlight past the end.
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : 0;

  // Focus the input on open so typing works immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const activate = (result: CommandResult): void => {
    const { action } = result;
    if (action.type === 'page') {
      if (action.section) openSettingsSection(action.section);
      else setView(action.view);
    } else if (action.type === 'advert') {
      // Cached adverts open the same detail popup as the map marker, from which
      // the node can be viewed or added as a contact.
      setManagePanel({ kind: 'advert', id: action.prefix });
    } else {
      setView('chat');
      openConvo(action.convo);
      if (action.type === 'message') setScrollToMsgId(action.msgId);
    }
    closeCommandPalette();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Step from the clamped index, so a shrunk result set can't leave the
      // highlight stranded past the end and jump on the next keypress.
      setActive(flat.length ? (activeIndex + 1) % flat.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(
        flat.length ? (activeIndex - 1 + flat.length) % flat.length : 0,
      );
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(flat.length ? flat.length - 1 : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = flat[activeIndex];
      if (result) activate(result);
    }
  };

  // Running index across all groups, so keyboard navigation crosses headings.
  let cursor = -1;

  return (
    <ModalShell title={t('command.title')} onClose={closeCommandPalette}>
      <div onKeyDown={onKeyDown}>
        <div className='relative mb-3'>
          <Search
            size={16}
            className='absolute top-1/2 left-3 -translate-y-1/2 text-text2'
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t('command.placeholder')}
            aria-label={t('command.placeholder')}
            role='combobox'
            aria-autocomplete='list'
            aria-controls={LISTBOX_ID}
            aria-expanded={flat.length > 0}
            aria-activedescendant={
              flat.length ? optionId(activeIndex) : undefined
            }
            className='input-field px-9!'
          />
          {query && (
            <button
              type='button'
              onClick={() => {
                setQuery('');
                setActive(0);
                inputRef.current?.focus();
              }}
              aria-label={t('command.clear')}
              className='absolute top-1/2 right-3 -translate-y-1/2 text-text2 hover:text-text'
            >
              <X size={16} />
            </button>
          )}
        </div>

        <p className='sr-only' role='status'>
          {t('command.resultCount', { count: flat.length })}
        </p>

        <div
          ref={listRef}
          id={LISTBOX_ID}
          role='listbox'
          aria-label={t('command.title')}
          className='max-h-[50vh] overflow-y-auto'
        >
          {flat.length === 0 ? (
            <p className='py-8 text-center text-sm text-text2'>
              {t('command.empty')}
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.key}
                role='group'
                aria-label={t(group.headingKey)}
                className='mb-2'
              >
                <div
                  aria-hidden='true'
                  className='px-3 py-1 text-[11px] font-semibold tracking-widest text-text2 uppercase'
                >
                  {t(group.headingKey)}
                </div>
                {group.results.map((result) => {
                  cursor += 1;
                  const index = cursor;
                  return (
                    <ResultRow
                      key={result.id}
                      result={result}
                      index={index}
                      active={index === activeIndex}
                      onActivate={() => activate(result)}
                      onHover={() => setActive(index)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </ModalShell>
  );
}
