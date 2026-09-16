// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useClockTick } from '@/hooks/useClockTick';
import { formatDistanceBearing, formatRelative } from '@/lib/i18n/format';
import { LEGEND_CATEGORIES, MARKER_STYLES, shapeSvg } from '@/lib/map/markers';
import type { MapNode } from '@/lib/map/nodes';
import {
  contactCategory,
  degToMicro,
  haversineKm,
  heardAgeSecs,
  type ContactCategory,
} from '@/lib/utils';
import { Select } from './Select';

/** How the list orders the nodes inside each group. */
type NodeSort = 'name' | 'heard' | 'distance';

/** A rendered section of the list: the favorites, then one per category. */
interface NodeGroup {
  key: string;
  label: string;
  nodes: MapNode[];
}

// Matches on the name the marker shows and on the public-key prefix, which is
// the only handle an unnamed node has.
function matchesQuery(node: MapNode, query: string): boolean {
  return (
    node.name.toLowerCase().includes(query) ||
    node.pubkeyPrefix.toLowerCase().startsWith(query)
  );
}

/**
 * The list of plotted nodes beside the Map: searchable, sortable, grouped by
 * category with favorites at the top, and the keyboard-navigable view of a map
 * whose content is otherwise a few hundred unlabeled markers. Picking a row
 * frames the map on that node and opens its popup — the only way to reach a
 * node by name rather than by panning and clicking dots.
 *
 * Takes the nodes the map is actually plotting (already filtered), so the list
 * and the markers can never disagree about which nodes exist.
 */
export function MapNodeList({
  nodes,
  self,
  selectedKey,
  onSelect,
  open,
  onOpenChange,
}: {
  /** Plotted nodes, excluding this radio's own marker. */
  nodes: MapNode[];
  /** This node, when it has a fix — the origin distances are measured from. */
  self: MapNode | null;
  /** Key of the node whose popup is open, highlighted in the list. */
  selectedKey: string | null;
  onSelect: (node: MapNode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  // The rows carry last-advert ages, which must keep ageing while the operator
  // reads the map rather than freezing at whatever they said on mount.
  const nowSecs = useClockTick();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NodeSort>('name');
  const searchId = useId();
  // The collapsed rail and the open panel each have their own toggle, so React
  // swaps one element for the other and the keyboard would be left on the body.
  // Focus moves to whichever one replaced it, but only when the toggle itself
  // made the change: the map also collapses this list to pick a location, and
  // stealing focus for that would drag the operator out of the pick controls.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const setOpen = (next: boolean) => {
    restoreFocus.current = true;
    onOpenChange(next);
  };
  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    toggleRef.current?.focus();
  }, [open]);

  const groups = useMemo<NodeGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    const matched =
      needle === '' ? nodes : nodes.filter((n) => matchesQuery(n, needle));
    const compare = (a: MapNode, b: MapNode): number => {
      if (sort === 'heard') {
        // A node neither store has a timestamp for sorts last rather than
        // claiming an age it doesn't have.
        const ageA =
          a.lastHeard === undefined
            ? Infinity
            : heardAgeSecs(a.lastHeard, nowSecs);
        const ageB =
          b.lastHeard === undefined
            ? Infinity
            : heardAgeSecs(b.lastHeard, nowSecs);
        if (ageA !== ageB) return ageA - ageB;
      } else if (sort === 'distance' && self) {
        const kmA = haversineKm(self.lat, self.lon, a.lat, a.lon);
        const kmB = haversineKm(self.lat, self.lon, b.lat, b.lon);
        if (kmA !== kmB) return kmA - kmB;
      }
      return a.name.localeCompare(b.name, i18n.language);
    };
    // Favorites lead as one group across every category, and are not repeated
    // below: a node the operator has starred is easier to find in one place
    // than in whichever category it happens to belong to.
    const favorites = matched.filter((n) => n.favorite).sort(compare);
    const byCategory = new Map<ContactCategory, MapNode[]>();
    for (const node of matched) {
      if (node.favorite) continue;
      const category = contactCategory(node.advType);
      const bucket = byCategory.get(category);
      if (bucket) bucket.push(node);
      else byCategory.set(category, [node]);
    }
    const result: NodeGroup[] = [];
    if (favorites.length > 0) {
      result.push({
        key: 'favorites',
        label: t('map.legend.favorite'),
        nodes: favorites,
      });
    }
    for (const category of LEGEND_CATEGORIES) {
      const bucket = byCategory.get(category);
      if (!bucket) continue;
      result.push({
        key: category,
        label: t(MARKER_STYLES[category].labelKey),
        nodes: bucket.sort(compare),
      });
    }
    return result;
  }, [nodes, query, sort, self, nowSecs, i18n.language, t]);

  const shown = groups.reduce((sum, group) => sum + group.nodes.length, 0);

  if (!open) {
    return (
      <div className='flex shrink-0 flex-col border-r border-border bg-surface p-1.5'>
        <button
          type='button'
          ref={toggleRef}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className='focus-inset rounded-md p-1.5 text-text2 hover:text-accent'
          title={t('map.nodeList.show')}
        >
          <PanelLeftOpen size={16} aria-hidden='true' />
          <span className='sr-only'>{t('map.nodeList.show')}</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label={t('map.nodeList.title')}
      className='flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-surface'
    >
      <div className='flex items-center justify-between gap-2 px-3 py-2'>
        <h2 className='text-xs font-semibold tracking-wide text-text2 uppercase'>
          {t('map.nodeList.title')}
        </h2>
        <button
          type='button'
          ref={toggleRef}
          onClick={() => setOpen(false)}
          aria-expanded={true}
          className='focus-inset rounded-md p-1 text-text2 hover:text-accent'
          title={t('map.nodeList.hide')}
        >
          <PanelLeftClose size={16} aria-hidden='true' />
          <span className='sr-only'>{t('map.nodeList.hide')}</span>
        </button>
      </div>
      <div className='flex flex-col gap-2 px-3 pb-2'>
        <label className='sr-only' htmlFor={searchId}>
          {t('map.nodeList.search')}
        </label>
        <input
          id={searchId}
          type='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('map.nodeList.search')}
          className='w-full rounded-md border border-border-control bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent'
        />
        <Select
          value={sort}
          onChange={setSort}
          ariaLabel={t('map.nodeList.sort')}
          options={[
            { value: 'name', label: t('map.nodeList.sortName') },
            { value: 'heard', label: t('map.nodeList.sortHeard') },
            {
              value: 'distance',
              label: t('map.nodeList.sortDistance'),
              // Nothing to measure from until this radio reports a fix.
              disabled: self === null,
            },
          ]}
          className='w-full'
        />
      </div>
      <p className='px-3 pb-2 text-[11px] text-text2'>
        {/* A count of list rows, not of markers: the search narrows the list
            and not the map, and this node's own marker is plotted without ever
            appearing here. The copy says "listed" for exactly that reason. */}
        {shown === nodes.length
          ? t('map.nodeList.count', { count: shown })
          : t('map.nodeList.countFiltered', {
              shown,
              total: nodes.length,
            })}
      </p>
      <div className='min-h-0 flex-1 overflow-y-auto pb-2'>
        {shown === 0 ? (
          <p className='px-3 py-2 text-xs text-text2'>
            {/* An empty `nodes` is the map's filters, not the search box, so
                blaming the query would contradict the map's own empty state.
                The copy is list-specific: this node's own marker is plotted
                without ever being listed here. */}
            {t(
              nodes.length === 0
                ? 'map.nodeList.empty'
                : 'map.nodeList.noMatches',
            )}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <h3 className='px-3 py-1 text-[10px] font-semibold tracking-wide text-text2 uppercase'>
                {group.label}
              </h3>
              <ul>
                {group.nodes.map((node) => (
                  <li key={node.key}>
                    <NodeRow
                      node={node}
                      selected={node.key === selectedKey}
                      onSelect={onSelect}
                      distance={formatDistanceBearing(
                        selfInfo?.advLat,
                        selfInfo?.advLon,
                        degToMicro(node.lat),
                        degToMicro(node.lon),
                        unitSystem,
                      )}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function NodeRow({
  node,
  selected,
  distance,
  onSelect,
}: {
  node: MapNode;
  selected: boolean;
  distance: string | null;
  onSelect: (node: MapNode) => void;
}) {
  const { t } = useTranslation();
  const style = MARKER_STYLES[contactCategory(node.advType)];
  const meta = [
    node.lastHeard === undefined
      ? t('common.unknown')
      : formatRelative(node.lastHeard),
    distance,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <button
      type='button'
      onClick={() => onSelect(node)}
      aria-current={selected ? 'true' : undefined}
      className={`focus-inset flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface2 ${
        selected ? 'bg-surface2' : ''
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center ${
          node.kind === 'advert' ? 'opacity-50' : ''
        }`}
        aria-hidden='true'
        dangerouslySetInnerHTML={{
          __html: node.favorite
            ? shapeSvg(style.shape, style.color, 14, 'var(--map-favorite)', 3)
            : shapeSvg(style.shape, style.color, 14),
        }}
      />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-xs text-text'>{node.name}</span>
        <span className='block truncate text-[11px] text-text2'>{meta}</span>
      </span>
    </button>
  );
}
