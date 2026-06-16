// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMeshCore } from '@/hooks/useMeshCore';
import { NO_PATH } from '@/lib/meshcore/constants';
import { toHex } from '@/lib/utils';
import type { Contact } from '@/types/meshcore';

/** Short route label for the chip: `Flood`, `Direct`, or `N hops`. */
function routeLabel(t: TFunction, contact: Contact): string {
  if (contact.outPathLen === NO_PATH) return t('routeChip.flood');
  if (contact.outPathLen === 0) return t('routeChip.direct');
  return t('route.hops', { count: contact.outPathLen });
}

/**
 * A pill showing a contact's current route that expands into a popover with the
 * hop path and a "reset to flood" action.
 */
export function RouteChip({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { resetContactPath } = useMeshCore();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hasRoute = contact.outPathLen !== NO_PATH;
  const hops = toHex(contact.path, ' → ');

  const onReset = async () => {
    setBusy(true);
    await resetContactPath(contact);
    setBusy(false);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className='relative'>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t('routeChip.tooltip')}
        className='rounded-full border px-2 py-0.5 text-[11px] text-(--text2) transition-colors hover:text-(--text)'
        style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
      >
        {routeLabel(t, contact)}
      </button>
      {open && (
        <div
          className='absolute top-full left-0 z-10 mt-1.5 w-64 rounded-[10px] border p-3 text-xs shadow-lg'
          style={{
            background: 'var(--surface2)',
            borderColor: 'var(--border)',
          }}
        >
          <div className='mb-1 font-semibold'>
            {t('routeChip.routeTo', {
              name: contact.name || contact.pubkeyPrefix.slice(0, 8),
            })}
          </div>
          {!hasRoute && (
            <p className='text-(--text2)'>{t('routeChip.noRoute')}</p>
          )}
          {hasRoute && contact.outPathLen === 0 && (
            <p className='text-(--text2)'>{t('routeChip.directNeighbor')}</p>
          )}
          {hasRoute && contact.outPathLen > 0 && (
            <>
              <p className='text-(--text2)'>
                {t('routeChip.viaRepeaters', { count: contact.outPathLen })}
              </p>
              <div className='my-1.5 font-mono text-(--text)'>{hops}</div>
            </>
          )}
          {hasRoute && (
            <>
              <button
                onClick={onReset}
                disabled={busy}
                className='mt-2 w-full rounded-lg border px-2 py-1.5 font-semibold transition-colors
                  hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-45'
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
              >
                {busy ? t('routeChip.resetting') : t('routeChip.resetToFlood')}
              </button>
              <p className='mt-1.5 text-(--text2)'>
                {t('routeChip.resetExplain')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
