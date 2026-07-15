// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import type { ReactNode } from 'react';

/**
 * A titled card rendering `[label, value]` rows for one stats group. A row may
 * carry an optional third element — an action node (e.g. a button) shown after
 * the value. When `note` is set, the card shows that muted line instead of rows
 * — used to render a section the device didn't report. When `loading` is set,
 * the labels render normally but each value is replaced by a shimmer block.
 *
 * Shared by the device Stats page and the repeater admin status dashboard so
 * both surfaces present identical cards.
 */
export function StatCard({
  title,
  rows = [],
  note,
  loading = false,
}: {
  title: string;
  rows?: [string, string, ReactNode?][];
  note?: string;
  loading?: boolean;
}) {
  return (
    <div className='rounded-lg p-3.5' style={{ background: 'var(--surface2)' }}>
      <div className='mb-2.5 text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
        {title}
      </div>
      {note !== undefined ? (
        <div className='py-1.5 text-xs text-(--text2)'>{note}</div>
      ) : (
        rows.map(([label, val, action]) => (
          <div
            key={label}
            className='flex justify-between border-b py-1.5 text-xs last:border-0'
            style={{ borderColor: 'var(--border)' }}
          >
            <span className='text-(--text2)'>{label}</span>
            {loading ? (
              <span className='skeleton h-3 w-16 self-center' />
            ) : action ? (
              <span className='flex items-center gap-1.5'>
                <span className='font-semibold'>{val}</span>
                {action}
              </span>
            ) : (
              <span className='font-semibold'>{val}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
