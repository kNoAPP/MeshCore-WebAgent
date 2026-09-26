// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp } from 'lucide-react';
import {
  FAVORITE_OUTLINE,
  FAVORITE_OUTLINE_WIDTH,
  LEGEND_CATEGORIES,
  MARKER_STYLES,
  shapeSvg,
} from '@/lib/map/markers';
import type { ContactCategory } from '@/lib/utils';

/** Makes the category rows a filter as well as a key. */
export interface LegendCategoryFilter {
  /** Categories currently plotted; the rest render dimmed. */
  active: ContactCategory[];
  onToggle: (category: ContactCategory) => void;
}

/**
 * A collapsible key, pinned to a map's bottom-right corner, pairing each node
 * category with the colored shape used to plot it. Shared by the Map page and
 * the Neighbors map so their swatches never drift. Collapsed state is transient
 * UI, so it lives in local component state rather than the store.
 *
 * @param categories - when supplied, each category row doubles as its own
 *   filter toggle. The swatch that documents a category is the obvious control
 *   for hiding it, and folding the two together keeps one list where there
 *   would otherwise be a key and a duplicate row of filter chips. Omit it for a
 *   map that only needs the key.
 * @param listed - categories to show a row for; defaults to all of them. Only
 *   meaningful without {@link categories}, since a filterable row that is not
 *   listed could never be switched back on.
 * @param showFavorite - whether to explain the gold favorite ring. Drop it on a
 *   map where nothing is favorited.
 * @param children - optional extra rows (e.g. the Map page's favorites-only
 *   switch) rendered below the categories, inside the collapsible body.
 */
export function MapLegend({
  categories,
  listed = LEGEND_CATEGORIES,
  showFavorite = true,
  children,
}: {
  categories?: LegendCategoryFilter;
  listed?: ContactCategory[];
  showFavorite?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div className='pointer-events-auto absolute right-3 bottom-8 z-1000 overflow-hidden rounded-md border border-border bg-surface/90 text-text backdrop-blur'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='focus-inset flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-semibold tracking-wide text-text2 uppercase hover:text-accent'
      >
        {t('map.legend.title')}
        <Chevron open={open} />
      </button>
      {open && (
        <>
          <ul
            className='flex flex-col gap-1.5 px-2.5 pt-0.5 pb-2'
            role={categories ? 'group' : undefined}
            aria-label={categories ? t('map.filters.types') : undefined}
          >
            {(categories ? LEGEND_CATEGORIES : listed).map((category) => {
              const style = MARKER_STYLES[category];
              const label = t(style.labelKey);
              const swatch = shapeSvg(style.shape, style.color, 14);
              if (!categories) {
                return (
                  <li
                    key={category}
                    className='flex items-center gap-2 text-xs whitespace-nowrap'
                  >
                    <Swatch html={swatch} />
                    {label}
                  </li>
                );
              }
              const on = categories.active.includes(category);
              return (
                <li key={category}>
                  <button
                    type='button'
                    aria-pressed={on}
                    onClick={() => categories.onToggle(category)}
                    title={t('map.filters.toggleType', { type: label })}
                    className={`focus-inset flex w-full items-center gap-2 text-xs whitespace-nowrap hover:text-accent ${
                      on ? '' : 'text-text2'
                    }`}
                  >
                    <Swatch html={swatch} dim={!on} />
                    {label}
                  </button>
                </li>
              );
            })}
            {showFavorite && (
              <li className='flex items-center gap-2 text-xs whitespace-nowrap'>
                {/* Drawn without a fill: the gold ring is an overlay on
                    whichever category shape the favorited node already has.
                    Informational only — the switch below filters on it. */}
                <Swatch
                  html={shapeSvg(
                    'circle',
                    'none',
                    14,
                    FAVORITE_OUTLINE,
                    FAVORITE_OUTLINE_WIDTH,
                  )}
                />
                {t('map.legend.favorite')}
              </li>
            )}
          </ul>
          {children}
        </>
      )}
    </div>
  );
}

function Swatch({ html, dim }: { html: string; dim?: boolean }) {
  return (
    <span
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center ${
        dim ? 'opacity-40' : ''
      }`}
      aria-hidden='true'
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronUp
      size={12}
      className={`transition-transform ${open ? '' : 'rotate-180'}`}
      aria-hidden='true'
    />
  );
}
