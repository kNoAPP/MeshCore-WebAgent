// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { MapPin, MessageSquare, Radio, Star, UserPlus } from 'lucide-react';
import { contactConvo, openConvo, useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  NO_VALUE,
  formatDateTime,
  formatDistanceBearing,
  formatRelative,
  formatRoute,
  formatSnr,
} from '@/lib/i18n/format';
import { ADV_ICON, ADV_LABEL_KEY } from '@/lib/utils';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import { isSaved, type DirectoryNode } from '@/lib/nodes/directory';

/**
 * Height every row is laid out at, in CSS pixels. The table renders only a
 * window of rows and spaces the rest out with this constant, so a cell that
 * could wrap would put the rendered rows out of step with the scroll offset —
 * every cell truncates instead.
 */
export const NODE_ROW_HEIGHT_PX = 30;

const CELL = 'truncate px-2 text-xs';
const ICON_BUTTON =
  'focus-inset rounded p-1 text-text2 transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-text2';

/** An icon button whose accessible name and tooltip are both {@link label}. */
function IconAction({
  label,
  disabled,
  onClick,
  className = '',
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`${ICON_BUTTON} ${className}`}
    >
      {children}
      <span className='sr-only'>{label}</span>
    </button>
  );
}

/**
 * One node of the directory: the columns the table's header declares, then the
 * per-row verbs. Message/Save and Show on map act immediately; the name opens
 * `ManagePanel`, which owns the rarer and destructive ones (reset route, share,
 * remove) so this row and that panel can't drift apart on what they do.
 *
 * @param rowIndex - 1-based position in the whole table (not just the rendered
 * window), counting the header row, for `aria-rowindex`.
 */
export function NodeTableRow({
  node,
  rowIndex,
  selected,
  onToggleSelect,
}: {
  node: DirectoryNode;
  rowIndex: number;
  selected: boolean;
  onToggleSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const showNodeOnMap = useMeshStore((s) => s.showNodeOnMap);
  const setView = useMeshStore((s) => s.setView);
  // Favoriting and saving both write to the radio, so those verbs need a live
  // link; the directory itself stays readable while one is being restored.
  const connected = useMeshStore((s) => s.status === 'connected');
  const { toggleFavorite, addDiscoveredContact } = useMeshCore();

  const contact = node.contact;
  const advert = node.advert;
  const located = Boolean(node.advLat && node.advLon);
  // A repeater's conversation is its admin console, not a transcript, so the
  // verb has to name what actually opens; a room server does have a post feed.
  const isRepeater = node.advType === ADV_TYPE_REPEATER;
  const openLabel = t(
    isRepeater
      ? 'nodes.row.console'
      : node.advType === ADV_TYPE_ROOM
        ? 'nodes.row.room'
        : 'nodes.row.message',
    { name: node.name },
  );
  const distance = formatDistanceBearing(
    selfInfo?.advLat,
    selfInfo?.advLon,
    node.advLat,
    node.advLon,
    unitSystem,
  );
  const favLabel = t(
    node.favorite ? 'nodes.row.unfavorite' : 'nodes.row.favorite',
    { name: node.name },
  );

  const openDetails = () =>
    setManagePanel({
      kind: contact ? 'contact' : 'advert',
      id: node.pubkeyPrefix,
    });

  const openChat = () => {
    if (!contact) return;
    // Selected before the view switch, as every other entry point does it:
    // `setView` catches up whichever conversation is open at that moment, so
    // switching first would mark the *previous* one read.
    openConvo(contactConvo(contact));
    setView('chat');
  };

  return (
    <tr
      aria-rowindex={rowIndex}
      style={{ height: NODE_ROW_HEIGHT_PX }}
      className={`border-b border-border ${
        selected ? 'bg-surface2' : 'hover:bg-surface2'
      }`}
    >
      <td className='px-2'>
        <input
          type='checkbox'
          checked={selected}
          onChange={() => onToggleSelect(node.key)}
          aria-label={t('nodes.row.select', { name: node.name })}
          className='accent-accent'
        />
      </td>
      <td className={CELL}>
        <button
          type='button'
          onClick={openDetails}
          title={t('nodes.row.details', { name: node.name })}
          className='focus-inset flex w-full items-center gap-1.5 truncate text-left hover:text-accent'
        >
          <span aria-hidden='true'>{ADV_ICON[node.advType] ?? '👤'}</span>
          <span className='truncate'>{node.name}</span>
        </button>
      </td>
      <td className={`${CELL} text-text2`}>
        {t(
          ADV_LABEL_KEY[node.advType as keyof typeof ADV_LABEL_KEY] ??
            'common.unknown',
        )}
      </td>
      <td className={`${CELL} text-text2`}>
        {t(isSaved(node) ? 'nodes.saved' : 'nodes.heard')}
      </td>
      <td
        className={`${CELL} text-text2`}
        title={node.lastHeard ? formatDateTime(node.lastHeard) : undefined}
      >
        {node.lastHeard === undefined
          ? NO_VALUE
          : formatRelative(node.lastHeard)}
      </td>
      <td className={`${CELL} text-text2`}>{distance ?? NO_VALUE}</td>
      <td className={`${CELL} text-text2`}>
        {node.outPathLen === undefined
          ? NO_VALUE
          : formatRoute(node.outPathLen)}
      </td>
      <td className={`${CELL} text-text2 tabular-nums`}>
        {node.snr === undefined ? NO_VALUE : formatSnr(node.snr)}
      </td>
      <td className='px-2'>
        {contact && (
          <IconAction
            label={favLabel}
            disabled={!connected}
            onClick={() => void toggleFavorite(contact)}
            className={node.favorite ? 'text-amber' : ''}
          >
            <Star
              size={13}
              className={node.favorite ? 'fill-current' : ''}
              aria-hidden='true'
            />
          </IconAction>
        )}
      </td>
      <td className='px-2'>
        <div className='flex items-center gap-0.5'>
          {contact ? (
            <IconAction label={openLabel} onClick={openChat}>
              {isRepeater ? (
                <Radio size={13} aria-hidden='true' />
              ) : (
                <MessageSquare size={13} aria-hidden='true' />
              )}
            </IconAction>
          ) : (
            <IconAction
              label={t('nodes.row.addContact', { name: node.name })}
              disabled={!connected || !advert}
              onClick={() => advert && void addDiscoveredContact(advert)}
            >
              <UserPlus size={13} aria-hidden='true' />
            </IconAction>
          )}
          <IconAction
            label={t('nodes.row.showOnMap', { name: node.name })}
            disabled={!located}
            onClick={() => showNodeOnMap(node.pubkeyPrefix)}
          >
            <MapPin size={13} aria-hidden='true' />
          </IconAction>
        </div>
      </td>
    </tr>
  );
}
