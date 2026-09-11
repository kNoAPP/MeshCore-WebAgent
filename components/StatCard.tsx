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
 * `meter` renders a labelled bar above the rows for a value that is already a
 * percentage (battery, storage), where a bar reads at a glance and `"73%"` does
 * not.
 *
 * Shared by the device Stats page and the repeater admin status dashboard so
 * both surfaces present identical cards.
 */
export function StatCard({
  title,
  rows = [],
  note,
  meter,
  loading = false,
}: {
  title: string;
  rows?: [string, string, ReactNode?][];
  note?: string;
  /** A 0–100 percentage plus its label and already-formatted display text. */
  meter?: { label: string; percent: number; text: string };
  loading?: boolean;
}) {
  return (
    <div className='rounded-card bg-surface2 p-3.5'>
      <div className='mb-2.5 text-[11px] font-bold tracking-widest text-accent uppercase'>
        {title}
      </div>
      {meter && !loading && (
        <div className='mb-3'>
          <div className='mb-1 flex justify-between text-xs'>
            <span className='text-text2'>{meter.label}</span>
            <span className='font-semibold'>{meter.text}</span>
          </div>
          <div
            role='meter'
            aria-label={meter.label}
            aria-valuenow={Math.round(meter.percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={meter.text}
            className='h-1.5 w-full overflow-hidden rounded-full bg-border'
          >
            <div
              className='h-full rounded-full bg-accent'
              style={{ width: `${Math.min(100, Math.max(0, meter.percent))}%` }}
            />
          </div>
        </div>
      )}
      {note !== undefined ? (
        <div className='py-1.5 text-xs text-text2'>{note}</div>
      ) : (
        rows.map(([label, val, action]) => (
          <div
            key={label}
            className='flex justify-between border-b py-1.5 text-xs last:border-0 border-border'
          >
            <span className='text-text2'>{label}</span>
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
