// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import {
  IDENTITY_COLORS,
  IDENTITY_TEXT_CLASS,
  type IdentityAccent,
} from '@/lib/identity/accent';
import { SaveStatusChip } from './SaveStatus';

const ACCENTS: readonly IdentityAccent[] = ['none', ...IDENTITY_COLORS];

const ACCENT_KEY = {
  none: 'settings.identityAccent.none',
  teal: 'settings.identityAccent.teal',
  lime: 'settings.identityAccent.lime',
  amber: 'settings.identityAccent.amber',
  orange: 'settings.identityAccent.orange',
  pink: 'settings.identityAccent.pink',
  violet: 'settings.identityAccent.violet',
} as const satisfies Record<IdentityAccent, string>;

const SWATCH_CLASS =
  'flex h-4 w-4 items-center justify-center rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent';

/**
 * The Identity card's color choice: the accent the header and action bar
 * are framed in while this identity is live. Stored with the identity's
 * other preferences, so each persona keeps its own.
 */
export function IdentityAccentRow() {
  const { t } = useTranslation();
  const labelId = useId();
  const name = useId();
  const accent = useMeshStore((s) => s.identityAccent);
  const setAccent = useMeshStore((s) => s.setIdentityAccent);

  return (
    <div className='flex items-center justify-between gap-3 border-b border-border py-1.5 text-xs'>
      <span
        id={labelId}
        title={t('settings.identityAccent.hint')}
        className='shrink-0 text-text2'
      >
        {t('settings.identityAccent.label')}
      </span>
      <span className='flex items-center gap-2'>
        <span
          role='radiogroup'
          aria-labelledby={labelId}
          className='flex flex-wrap items-center gap-2'
        >
          {ACCENTS.map((a) => (
            <label key={a} title={t(ACCENT_KEY[a])} className='flex'>
              <input
                type='radio'
                name={name}
                value={a}
                checked={accent === a}
                onChange={() => setAccent(a)}
                aria-label={t(ACCENT_KEY[a])}
                className='peer sr-only'
              />
              {a === 'none' ? (
                <span
                  className={`${SWATCH_CLASS} border border-border-control text-text2`}
                >
                  <Ban size={10} aria-hidden='true' />
                </span>
              ) : (
                <span
                  className={`${SWATCH_CLASS} bg-current ${IDENTITY_TEXT_CLASS[a]}`}
                />
              )}
            </label>
          ))}
        </span>
        <SaveStatusChip />
      </span>
    </div>
  );
}
