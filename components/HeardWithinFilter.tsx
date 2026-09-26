// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useTranslation } from 'react-i18next';
import { HEARD_WITHIN_DAY_CHOICES } from '@/lib/map/filters';

/**
 * The "heard within" window picker, shared by every map legend that offers one
 * so the Map page and a repeater's Neighbors map can't drift on the windows
 * they allow or how they name them.
 */
export function HeardWithinFilter({
  value,
  onChange,
}: {
  /** Selected window in days, or `null` for any age. */
  value: number | null;
  onChange: (days: number | null) => void;
}) {
  const { t } = useTranslation();
  const index = Math.max(0, HEARD_WITHIN_DAY_CHOICES.indexOf(value));
  const label =
    value === null
      ? t('map.filters.anyAge')
      : t('map.filters.days', { count: value });

  return (
    <label className='block'>
      <div className='mb-0.5 flex items-center justify-between gap-2 text-[11px]'>
        <span className='text-text2'>{t('map.filters.heardWithin')}</span>
        <span>{label}</span>
      </div>
      <input
        type='range'
        min={0}
        max={HEARD_WITHIN_DAY_CHOICES.length - 1}
        step={1}
        value={index}
        // The slider steps through named windows rather than a raw day count,
        // so the value it reports is the position, not the age.
        aria-valuetext={label}
        onChange={(e) =>
          onChange(HEARD_WITHIN_DAY_CHOICES[Number(e.target.value)] ?? null)
        }
        className='w-full accent-accent'
      />
    </label>
  );
}
