// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGEND_CATEGORIES, MARKER_STYLES } from '@/lib/map/markers';
import { toggleNodeCategory, type NodeFilters } from '@/lib/nodes/directory';
import { HeardWithinFilter } from './HeardWithinFilter';
import { Select } from './Select';
import { Switch } from './Switch';

/** The `storage` choices, in menu order, with the key naming each. */
const STORAGE_OPTIONS = [
  { value: 'all', labelKey: 'nodes.storage.all' },
  { value: 'saved', labelKey: 'nodes.storage.saved' },
  { value: 'heard', labelKey: 'nodes.storage.heard' },
] as const satisfies ReadonlyArray<{
  value: NodeFilters['storage'];
  labelKey: string;
}>;

/**
 * The directory's toolbar: free-text search over name and public key, the type
 * toggles, the saved-vs-heard choice, favorites-only, and the "heard within"
 * window. Everything here narrows the table only — none of it touches the
 * radio or the advert cache.
 */
export function NodeFilterBar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filters: NodeFilters;
  onFiltersChange: (filters: NodeFilters) => void;
}) {
  const { t } = useTranslation();
  const searchId = useId();

  return (
    <div className='flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-border px-4 py-2'>
      <div className='min-w-56 flex-1'>
        <label
          className='mb-0.5 block text-[11px] text-text2'
          htmlFor={searchId}
        >
          {t('nodes.search')}
        </label>
        <input
          id={searchId}
          type='search'
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('nodes.searchPlaceholder')}
          className='w-full rounded-md border border-border-control bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent'
        />
      </div>

      <fieldset className='flex flex-col gap-0.5'>
        <legend className='text-[11px] text-text2'>
          {t('nodes.column.type')}
        </legend>
        <div className='flex gap-1'>
          {LEGEND_CATEGORIES.map((category) => {
            const on = filters.categories.includes(category);
            const label = t(MARKER_STYLES[category].labelKey);
            return (
              <button
                key={category}
                type='button'
                onClick={() =>
                  onFiltersChange(toggleNodeCategory(filters, category))
                }
                aria-pressed={on}
                title={t('map.filters.toggleType', { type: label })}
                className={`focus-inset rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  on
                    ? 'border-accent text-accent'
                    : 'border-border-control text-text2 hover:text-text'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className='w-36'>
        <Select
          value={filters.storage}
          onChange={(storage) => onFiltersChange({ ...filters, storage })}
          label={t('nodes.storage.label')}
          options={STORAGE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
      </div>

      <div className='w-40'>
        <Switch
          checked={filters.favoritesOnly}
          onChange={(favoritesOnly) =>
            onFiltersChange({ ...filters, favoritesOnly })
          }
          label={t('map.legend.favoritesOnly')}
          className='focus-inset hover:text-accent'
        />
      </div>

      <div className='w-40'>
        <HeardWithinFilter
          value={filters.heardWithinDays}
          onChange={(heardWithinDays) =>
            onFiltersChange({ ...filters, heardWithinDays })
          }
        />
      </div>
    </div>
  );
}
