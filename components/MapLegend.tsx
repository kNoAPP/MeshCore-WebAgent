// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGEND_CATEGORIES, MARKER_STYLES, shapeSvg } from '@/lib/map/markers';

/**
 * A collapsible key, pinned to a map's bottom-right corner, pairing each node
 * category with the colored shape used to plot it. Shared by the Map page and
 * the Neighbors map so their swatches never drift. Collapsed state is transient
 * UI, so it lives in local component state rather than the store.
 *
 * @param children - optional extra rows (e.g. the Map page's favorites-only
 *   switch) rendered below the categories, inside the collapsible body.
 */
export function MapLegend({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div className='pointer-events-auto absolute right-3 bottom-8 z-1000 overflow-hidden rounded-md border border-(--border) bg-(--surface)/90 text-(--text) backdrop-blur'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-semibold tracking-wide text-(--text2) uppercase hover:text-(--accent)'
      >
        {t('map.legend.title')}
        <Chevron open={open} />
      </button>
      {open && (
        <>
          <ul className='flex flex-col gap-1.5 px-2.5 pt-0.5 pb-2'>
            {LEGEND_CATEGORIES.map((category) => {
              const style = MARKER_STYLES[category];
              return (
                <li
                  key={category}
                  className='flex items-center gap-2 text-xs whitespace-nowrap'
                >
                  <span
                    className='flex h-3.5 w-3.5 shrink-0 items-center justify-center'
                    aria-hidden='true'
                    dangerouslySetInnerHTML={{
                      __html: shapeSvg(style.shape, style.color, 14),
                    }}
                  />
                  {t(style.labelKey)}
                </li>
              );
            })}
          </ul>
          {children}
        </>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox='0 0 16 16'
      className={`h-3 w-3 transition-transform ${open ? '' : 'rotate-180'}`}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M4 10l4-4 4 4' />
    </svg>
  );
}
