// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useClockTick } from '@/hooks/useClockTick';
import { haversineKm, microToDeg } from '@/lib/utils';
import {
  DEFAULT_NODE_FILTERS,
  DEFAULT_NODE_SORT,
  INITIAL_SORT_DIRECTION,
  collectDirectoryNodes,
  filterDirectoryNodes,
  lastSnrByPrefix,
  matchesNodeQuery,
  nodeFiltersActive,
  sortDirectoryNodes,
  type NodeFilters,
  type NodeSortKey,
  type SortDirection,
} from '@/lib/nodes/directory';
import { NodeBulkBar } from './NodeBulkBar';
import { NodeFilterBar } from './NodeFilterBar';
import { NodeTable } from './NodeTable';

/**
 * The Nodes directory: one table over every node the session knows about —
 * the radio's contact table merged with the browser's advert cache — so a node
 * that has never advertised a location, and therefore never appears on the
 * map, can still be found, sorted and acted on.
 *
 * Search, filters, ordering and the selection are view state: they describe
 * this visit to the page, not a preference of the radio, so none of them are
 * persisted and all of them reset when the page is left.
 */
export function NodesPage() {
  const { t, i18n } = useTranslation();
  const contacts = useMeshStore((s) => s.contacts);
  const advertCache = useMeshStore((s) => s.advertCache);
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  // The rows carry last-advert ages and an age filter, both of which must keep
  // advancing while the operator reads the table rather than freezing at what
  // they said on mount.
  const nowSecs = useClockTick();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<NodeFilters>(DEFAULT_NODE_FILTERS);
  // One piece of state, not two: the column and its direction always change
  // together, and a second `set` inside the first one's updater would run twice
  // under StrictMode and toggle the arrow back.
  const [order, setOrder] = useState<{
    key: NodeSortKey;
    direction: SortDirection;
  }>({
    key: DEFAULT_NODE_SORT,
    direction: INITIAL_SORT_DIRECTION[DEFAULT_NODE_SORT],
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const selfPrefix = selfInfo?.pubkey.slice(0, 12);
  const snrByPrefix = useMemo(() => lastSnrByPrefix(msgHistory), [msgHistory]);
  const all = useMemo(
    () =>
      collectDirectoryNodes(
        contacts,
        advertCache,
        snrByPrefix,
        selfPrefix,
        nowSecs,
      ),
    [contacts, advertCache, snrByPrefix, selfPrefix, nowSecs],
  );

  // Distances for the ordering only — the cells format their own from the raw
  // micro-degrees. Measured once per node so the comparator stays O(n log n)
  // rather than re-running haversine on every comparison.
  const distanceKm = useMemo(() => {
    const km = new Map<string, number>();
    if (!selfInfo?.advLat || !selfInfo.advLon) return km;
    for (const node of all) {
      if (!node.advLat || !node.advLon) continue;
      km.set(
        node.key,
        haversineKm(
          selfInfo.advLat,
          selfInfo.advLon,
          microToDeg(node.advLat),
          microToDeg(node.advLon),
        ),
      );
    }
    return km;
  }, [all, selfInfo]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = filterDirectoryNodes(all, filters, nowSecs).filter(
      (node) => needle === '' || matchesNodeQuery(node, needle),
    );
    return sortDirectoryNodes(
      matched,
      order.key,
      order.direction,
      distanceKm,
      nowSecs,
      i18n.language,
    );
  }, [all, filters, query, order, distanceKm, nowSecs, i18n.language]);

  // Derived rather than pruned on every change: a key whose node the radio has
  // since removed, or the filters now hide, simply stops being counted. Nothing
  // can act on a row that is no longer listed.
  const selectedRows = useMemo(
    () => rows.filter((node) => selected.has(node.key)),
    [rows, selected],
  );

  const onSort = useCallback((key: NodeSortKey) => {
    setOrder((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: INITIAL_SORT_DIRECTION[key] },
    );
  }, []);

  const onToggleRow = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(() => {
    setSelected((current) => {
      const allOn = rows.length > 0 && rows.every((n) => current.has(n.key));
      if (allOn) return new Set<string>();
      return new Set(rows.map((n) => n.key));
    });
  }, [rows]);

  const clearSelection = useCallback(() => setSelected(new Set<string>()), []);

  const filtering = nodeFiltersActive(filters) || query.trim() !== '';

  return (
    <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
      <div className='flex items-baseline justify-between gap-3 px-4 pt-3'>
        <h2 className='text-sm font-semibold text-text'>{t('nodes.title')}</h2>
        <p aria-live='polite' className='text-[11px] text-text2'>
          {rows.length === all.length
            ? t('nodes.count', { count: rows.length })
            : t('nodes.countFiltered', {
                shown: rows.length,
                total: all.length,
              })}
        </p>
      </div>
      <NodeFilterBar
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={setFilters}
      />
      {rows.length === 0 ? (
        <EmptyNodes filtering={filtering} />
      ) : (
        <NodeTable
          nodes={rows}
          sort={order.key}
          direction={order.direction}
          onSort={onSort}
          selected={selected}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
        />
      )}
      {selectedRows.length > 0 && (
        <NodeBulkBar selected={selectedRows} onDone={clearSelection} />
      )}
    </div>
  );
}

// Two different causes, two different sentences: an empty directory is a mesh
// nothing has been heard from yet, while an empty table under a live filter is
// the operator's own narrowing and is theirs to undo.
function EmptyNodes({ filtering }: { filtering: boolean }) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-1 items-center justify-center p-8'>
      <p className='max-w-md text-center text-xs text-text2'>
        {t(filtering ? 'nodes.noMatches' : 'nodes.empty')}
      </p>
    </div>
  );
}
