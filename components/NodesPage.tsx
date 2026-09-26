// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  contactConvo,
  manageNode,
  openConvo,
  useMeshStore,
} from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useClockTick } from '@/hooks/useClockTick';
import { formatDistanceBearing } from '@/lib/i18n/format';
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
import { RepeaterView } from './RepeaterView';
import type { NodeRowContext } from './NodeTableRow';

/**
 * The Nodes directory: one table over every node the session knows about —
 * the radio's contact table merged with the browser's advert cache — so a node
 * that has never advertised a location, and therefore never appears on the
 * map, can still be found, sorted and acted on.
 *
 * Search, filters, ordering and the selection are view state: they describe
 * this visit to the page, not a preference of the radio, so none of them are
 * persisted and all of them reset when the page is left.
 *
 * While {@link useMeshStore} `managedNode` is set, a repeater's or room
 * server's management view ({@link RepeaterView}) replaces the directory.
 */
export function NodesPage() {
  const { t, i18n } = useTranslation();
  const contacts = useMeshStore((s) => s.contacts);
  const advertCache = useMeshStore((s) => s.advertCache);
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const showNodeOnMap = useMeshStore((s) => s.showNodeOnMap);
  const setView = useMeshStore((s) => s.setView);
  const setAddNodeOpen = useMeshStore((s) => s.setAddNodeOpen);
  const managedNode = useMeshStore((s) => s.managedNode);
  // Entering or leaving a node's management view unmounts whatever held focus
  // (a row's Manage button, or the view's back arrow), so land it on the main
  // landmark rather than let it fall to <body>.
  const shownNode = useRef(managedNode);
  useEffect(() => {
    if (shownNode.current === managedNode) return;
    shownNode.current = managedNode;
    document.getElementById('main')?.focus();
  }, [managedNode]);
  // Favoriting and saving both write to the radio, so those verbs need a live
  // link; the directory itself stays readable while one is being restored.
  const connected = useMeshStore((s) => s.status === 'connected');
  // Read once for the whole page, never per row: this hook subscribes to the
  // entire store, so a row calling it would rerun it for every rendered row on
  // every unrelated store update.
  const { toggleFavorite, addDiscoveredContact, removeContact } = useMeshCore();
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
  const snrByPrefix = useMemo(
    () => lastSnrByPrefix(msgHistory, nowSecs),
    [msgHistory, nowSecs],
  );
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

  // Only the listed rows are touched. The selection deliberately survives a
  // node being filtered out, so replacing the whole set here would silently
  // discard the rows a narrowed filter is hiding.
  const onToggleAll = useCallback(() => {
    setSelected((current) => {
      const allOn = rows.length > 0 && rows.every((n) => current.has(n.key));
      const next = new Set(current);
      for (const node of rows) {
        if (allOn) next.delete(node.key);
        else next.add(node.key);
      }
      return next;
    });
  }, [rows]);

  const clearSelection = useCallback(() => setSelected(new Set<string>()), []);

  // A batch unchecks only what the radio accepted, so a failure (a full
  // contact table, a dropped link) leaves the operator with the exact rows to
  // retry instead of a cleared selection they have to rebuild.
  const onBatchWritten = useCallback((keys: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);

  const rowContext = useMemo<NodeRowContext>(
    () => ({
      connected,
      distance: (node) =>
        formatDistanceBearing(
          selfInfo?.advLat,
          selfInfo?.advLon,
          node.advLat,
          node.advLon,
          unitSystem,
        ),
      onToggleSelect: onToggleRow,
      onOpenDetails: (node) =>
        setManagePanel({
          kind: node.contact ? 'contact' : 'advert',
          id: node.pubkeyPrefix,
        }),
      hasConvo: (node) =>
        node.contact !== null &&
        contactConvo(node.contact, msgHistory) !== null,
      onOpenConvo: (node) => {
        const convo = node.contact && contactConvo(node.contact, msgHistory);
        if (!convo) return;
        // Selected before the view switch, as every other entry point does it:
        // `setView` catches up whichever conversation is open at that moment,
        // so switching first would mark the *previous* one read.
        openConvo(convo);
        setView('chat');
      },
      onManage: (node) => {
        if (node.contact) manageNode(node.contact);
      },
      onToggleFavorite: (node) => {
        if (node.contact) void toggleFavorite(node.contact);
      },
      onSaveContact: (node) => {
        if (node.advert) void addDiscoveredContact(node.advert);
      },
      onShowOnMap: (node) => showNodeOnMap(node.pubkeyPrefix),
    }),
    [
      connected,
      selfInfo,
      unitSystem,
      msgHistory,
      onToggleRow,
      setManagePanel,
      setView,
      showNodeOnMap,
      toggleFavorite,
      addDiscoveredContact,
    ],
  );

  const filtering = nodeFiltersActive(filters) || query.trim() !== '';

  // Swapped in rather than routed to, so the search, filters and ordering
  // above survive a trip into a node and back while this page stays mounted.
  if (managedNode) return <RepeaterView />;

  return (
    <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
      <div className='flex items-center justify-between gap-3 px-4 pt-3'>
        <h2 className='text-sm font-semibold text-text'>{t('nodes.title')}</h2>
        <div className='flex items-center gap-3'>
          <p aria-live='polite' className='text-[11px] text-text2'>
            {rows.length === all.length
              ? t('nodes.count', { count: rows.length })
              : t('nodes.countFiltered', {
                  shown: rows.length,
                  total: all.length,
                })}
          </p>
          <button
            type='button'
            onClick={() => setAddNodeOpen(true)}
            disabled={!connected}
            className='flex items-center gap-1 rounded-md bg-accent-solid px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
          >
            <Plus size={14} aria-hidden='true' />
            {t('nodes.addNode')}
          </button>
        </div>
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
          onToggleAll={onToggleAll}
          ctx={rowContext}
        />
      )}
      {selectedRows.length > 0 && (
        <NodeBulkBar
          selected={selectedRows}
          connected={connected}
          onAddContact={addDiscoveredContact}
          onRemoveContact={removeContact}
          onClear={clearSelection}
          onWritten={onBatchWritten}
        />
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
