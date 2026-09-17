// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Star } from 'lucide-react';
import type {
  DirectoryNode,
  NodeSortKey,
  SortDirection,
} from '@/lib/nodes/directory';
import {
  NODE_ROW_HEIGHT_PX,
  NodeTableRow,
  type NodeRowContext,
} from './NodeTableRow';

/** Extra rows rendered above and below the viewport, for fast scrolling. */
const OVERSCAN_ROWS = 8;

/**
 * The columns, in render order: the sort key each one carries, its fixed width
 * (`null` lets the name column absorb the remaining space), the
 * `nodes.column.*` key naming it, and whether the heading shows a star glyph
 * instead of that name (which no readable column width would fit).
 */
const COLUMNS = [
  { key: null, width: '2rem', labelKey: 'nodes.column.select' },
  { key: 'name', width: null, labelKey: 'nodes.column.name' },
  { key: 'type', width: '7rem', labelKey: 'nodes.column.type' },
  { key: 'storage', width: '5.5rem', labelKey: 'nodes.column.storage' },
  { key: 'heard', width: '7rem', labelKey: 'nodes.column.heard' },
  { key: 'distance', width: '8rem', labelKey: 'nodes.column.distance' },
  { key: 'route', width: '8rem', labelKey: 'nodes.column.route' },
  { key: 'snr', width: '6rem', labelKey: 'nodes.column.snr' },
  {
    key: 'favorite',
    width: '3rem',
    labelKey: 'nodes.column.favorite',
    glyph: true,
  },
  { key: null, width: '4.5rem', labelKey: 'nodes.column.actions' },
] as const satisfies ReadonlyArray<{
  key: NodeSortKey | null;
  width: string | null;
  labelKey: string;
  glyph?: boolean;
}>;

/**
 * The directory table: a sortable header over a windowed body.
 *
 * @remarks Only the rows near the viewport are in the DOM — the advert cache
 * holds up to 5,000 nodes, and rendering that many rows (each with its own
 * store subscriptions and buttons) stalls every interaction. The rows that are
 * not rendered are replaced by two spacer rows of exactly their height, so the
 * scrollbar still describes the whole set, and `aria-rowcount`/`aria-rowindex`
 * report the real positions rather than the rendered ones.
 *
 * @param nodes - the rows to show, already filtered, searched and sorted.
 * @param selected - keys of the checked rows, including any the current filters
 * hide.
 * @param ctx - the row verbs and formatting, built once by the page so no row
 * subscribes to the store on its own.
 */
export function NodeTable({
  nodes,
  sort,
  direction,
  onSort,
  selected,
  onToggleAll,
  ctx,
}: {
  nodes: DirectoryNode[];
  sort: NodeSortKey;
  direction: SortDirection;
  onSort: (key: NodeSortKey) => void;
  selected: ReadonlySet<string>;
  /** Checks every listed row, or clears them when all are already checked. */
  onToggleAll: () => void;
  ctx: NodeRowContext;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // Measured rather than assumed: the window size decides how many rows are in
  // the DOM, and the page's height depends on the toolbar and the bulk bar.
  const [viewportPx, setViewportPx] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportPx(el.clientHeight));
    observer.observe(el);
    setViewportPx(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Clamped against the current row count: shrinking the set (a narrower
  // filter, a removed contact) leaves the last reported scroll offset past the
  // end until the browser's own clamp fires a fresh scroll event.
  const maxFirst = Math.max(0, nodes.length - 1);
  const first = Math.min(
    maxFirst,
    Math.max(0, Math.floor(scrollTop / NODE_ROW_HEIGHT_PX) - OVERSCAN_ROWS),
  );
  const last = Math.min(
    nodes.length,
    first +
      Math.ceil(viewportPx / NODE_ROW_HEIGHT_PX) +
      OVERSCAN_ROWS * 2 +
      // Until the observer has measured, render one screen's worth of rows
      // so the first paint is not an empty table.
      (viewportPx === 0 ? OVERSCAN_ROWS * 2 : 0),
  );
  const windowed = nodes.slice(first, last);
  const padTopPx = first * NODE_ROW_HEIGHT_PX;
  const padBottomPx = (nodes.length - last) * NODE_ROW_HEIGHT_PX;

  const allSelected =
    nodes.length > 0 && nodes.every((n) => selected.has(n.key));
  const someSelected = !allSelected && nodes.some((n) => selected.has(n.key));

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className='min-h-0 flex-1 overflow-auto'
    >
      <table
        // The header row counts, so the body starts at 2.
        aria-rowcount={nodes.length + 1}
        aria-label={t('nodes.title')}
        className='w-full table-fixed border-collapse'
      >
        <colgroup>
          {COLUMNS.map((col, i) => (
            <col key={i} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            <th
              scope='col'
              className='sticky top-0 z-10 bg-surface px-2 py-1.5 text-left'
            >
              <input
                type='checkbox'
                checked={allSelected}
                // Not expressible in JSX: the tri-state flag is a DOM property
                // with no attribute, so it is written on the node itself.
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={onToggleAll}
                disabled={nodes.length === 0}
                aria-label={t('nodes.column.selectAll')}
                className='accent-accent'
              />
            </th>
            {COLUMNS.slice(1).map((col) => (
              <HeaderCell
                key={col.labelKey}
                label={t(col.labelKey)}
                glyph={'glyph' in col}
                sortKey={col.key}
                active={col.key === sort}
                direction={direction}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {padTopPx > 0 && (
            <tr aria-hidden='true' style={{ height: padTopPx }}>
              <td colSpan={COLUMNS.length} />
            </tr>
          )}
          {windowed.map((node, i) => (
            <NodeTableRow
              key={node.key}
              node={node}
              rowIndex={first + i + 2}
              selected={selected.has(node.key)}
              ctx={ctx}
            />
          ))}
          {padBottomPx > 0 && (
            <tr aria-hidden='true' style={{ height: padBottomPx }}>
              <td colSpan={COLUMNS.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// A column heading: a sort button when the column has a sort key, plain text
// otherwise. `aria-sort` goes on the cell, never on the button inside it.
function HeaderCell({
  label,
  glyph,
  sortKey,
  active,
  direction,
  onSort,
}: {
  label: string;
  /**
   * Show a star instead of {@link label}, which stays as the accessible name.
   */
  glyph: boolean;
  sortKey: NodeSortKey | null;
  active: boolean;
  direction: SortDirection;
  onSort: (key: NodeSortKey) => void;
}) {
  const { t } = useTranslation();
  const className =
    'sticky top-0 z-10 bg-surface px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-text2 uppercase';
  if (!sortKey) {
    return (
      <th scope='col' className={className}>
        <span className='sr-only'>{label}</span>
      </th>
    );
  }
  const Arrow = direction === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      scope='col'
      aria-sort={
        active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={className}
    >
      <button
        type='button'
        onClick={() => onSort(sortKey)}
        title={t('nodes.sortBy', { column: label })}
        className={`focus-inset flex w-full items-center gap-1 truncate uppercase hover:text-accent ${
          active ? 'text-accent' : ''
        }`}
      >
        {glyph ? (
          <>
            <Star size={12} aria-hidden='true' />
            <span className='sr-only'>{label}</span>
          </>
        ) : (
          <span className='truncate'>{label}</span>
        )}
        {active && <Arrow size={12} aria-hidden='true' />}
      </button>
    </th>
  );
}
