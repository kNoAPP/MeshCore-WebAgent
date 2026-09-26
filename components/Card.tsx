// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import type { ReactNode } from 'react';

export interface CardProps {
  title: string;
  /** An optional control (e.g. an Edit or Refresh button) by the heading. */
  action?: ReactNode;
  className?: string;
  /** Element id, so a deep link can scroll to and flash this card. */
  anchorId?: string;
  children: ReactNode;
}

/**
 * A titled card grouping related controls, shared by the Settings page and the
 * repeater Config tab so the two can't drift apart.
 */
export function Card({
  title,
  action,
  className,
  anchorId,
  children,
}: CardProps) {
  return (
    <section
      id={anchorId}
      className={`rounded-card bg-surface2 p-3.5 ${className ?? ''}`}
    >
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <h3 className='text-[11px] font-bold tracking-widest text-accent uppercase'>
          {title}
        </h3>
        {/* The negative margin lets a button-sized action (up to ~2rem tall)
            overhang the padding rather than grow the row, so every card's
            heading sits at the same height. */}
        {action && <div className='-my-2'>{action}</div>}
      </div>
      {children}
    </section>
  );
}
