// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import type { MapFilters } from '@/lib/map/filters';
import { HeardWithinFilter } from './HeardWithinFilter';
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

  return (
    <div className='flex w-44 flex-col gap-2 border-t border-border px-2.5 py-2'>
      <Switch
        checked={filters.favoritesOnly}
        onChange={(favoritesOnly) => onChange({ ...filters, favoritesOnly })}
        label={t('map.legend.favoritesOnly')}
        className='focus-inset hover:text-accent'
      />
      <HeardWithinFilter
        value={filters.heardWithinDays}
        onChange={(heardWithinDays) =>
          onChange({ ...filters, heardWithinDays })
        }
      />
    </div>
  );
}
