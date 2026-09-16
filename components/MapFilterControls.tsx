// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { HEARD_WITHIN_DAY_CHOICES, type MapFilters } from '@/lib/map/filters';
import { Switch } from './Switch';

/**
 * The Map page's filter rows that have no swatch of their own, rendered inside
 * the legend below the category rows — those double as the type filter, so the
 * only controls left here are the two that cut across every category.
 */
export function MapFilterControls({
  filters,
  onChange,
}: {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
}) {
  const { t } = useTranslation();

  const heardIndex = Math.max(
    0,
    HEARD_WITHIN_DAY_CHOICES.indexOf(filters.heardWithinDays),
  );
  const heardLabel =
    filters.heardWithinDays === null
      ? t('map.filters.anyAge')
      : t('map.filters.days', { count: filters.heardWithinDays });

  return (
    <div className='flex w-44 flex-col gap-2 border-t border-border px-2.5 py-2'>
      <Switch
        checked={filters.favoritesOnly}
        onChange={(favoritesOnly) => onChange({ ...filters, favoritesOnly })}
        label={t('map.legend.favoritesOnly')}
        className='focus-inset hover:text-accent'
      />
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
