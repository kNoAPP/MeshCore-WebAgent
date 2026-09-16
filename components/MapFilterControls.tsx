// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { HEARD_WITHIN_DAY_CHOICES, type MapFilters } from '@/lib/map/filters';
import { LEGEND_CATEGORIES, MARKER_STYLES, shapeSvg } from '@/lib/map/markers';
import type { ContactCategory } from '@/lib/utils';
import { Switch } from './Switch';

/**
 * The Map page's filter block, rendered inside the legend so the swatch and the
 * control that hides it sit together. Everything here narrows what is plotted
 * *and* what the node list offers, so the two can never disagree about which
 * nodes the map is showing.
 */
export function MapFilterControls({
  filters,
  onChange,
}: {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
}) {
  const { t } = useTranslation();

  const toggleCategory = (category: ContactCategory) => {
    const on = filters.categories.includes(category);
    onChange({
      ...filters,
      categories: on
        ? filters.categories.filter((c) => c !== category)
        : // Kept in legend order rather than click order, so the category set
          // never depends on how the user arrived at it.
          LEGEND_CATEGORIES.filter(
            (c) => c === category || filters.categories.includes(c),
          ),
    });
  };

  const heardIndex = Math.max(
    0,
    HEARD_WITHIN_DAY_CHOICES.indexOf(filters.heardWithinDays),
  );
  const heardLabel =
    filters.heardWithinDays === null
      ? t('map.filters.anyAge')
      : t('map.filters.days', { count: filters.heardWithinDays });

  return (
    <div className='flex w-48 flex-col gap-2 border-t border-border px-2.5 py-2'>
      <Switch
        checked={filters.favoritesOnly}
        onChange={(favoritesOnly) => onChange({ ...filters, favoritesOnly })}
        label={t('map.legend.favoritesOnly')}
        className='focus-inset hover:text-accent'
      />
      <fieldset>
        <legend className='mb-1 text-[10px] font-semibold tracking-wide text-text2 uppercase'>
          {t('map.filters.types')}
        </legend>
        <div className='flex flex-wrap gap-1'>
          {LEGEND_CATEGORIES.map((category) => {
            const style = MARKER_STYLES[category];
            const on = filters.categories.includes(category);
            return (
              <button
                key={category}
                type='button'
                aria-pressed={on}
                onClick={() => toggleCategory(category)}
                className={`focus-inset flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${
                  on
                    ? 'border-accent-solid text-text'
                    : 'border-border text-text2'
                }`}
              >
                <span
                  className={`flex h-3 w-3 shrink-0 items-center justify-center ${
                    on ? '' : 'opacity-40'
                  }`}
                  aria-hidden='true'
                  dangerouslySetInnerHTML={{
                    __html: shapeSvg(style.shape, style.color, 12),
                  }}
                />
                {t(style.labelKey)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className='block'>
        <div className='mb-0.5 flex items-center justify-between gap-2 text-[11px]'>
          <span className='text-text2'>{t('map.filters.heardWithin')}</span>
          <span>{heardLabel}</span>
        </div>
        <input
          type='range'
          min={0}
          max={HEARD_WITHIN_DAY_CHOICES.length - 1}
          step={1}
          value={heardIndex}
          // The slider steps through named windows rather than a raw day
          // count, so the value it reports is the position, not the age.
          aria-valuetext={heardLabel}
          onChange={(e) =>
            onChange({
              ...filters,
              heardWithinDays:
                HEARD_WITHIN_DAY_CHOICES[Number(e.target.value)] ?? null,
            })
          }
          className='w-full accent-accent'
        />
      </label>
    </div>
  );
}
