// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, X } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

/**
 * Watches for a new deploy. Records the version at mount, then polls every
 * {@link CHECK_INTERVAL_MS}.
 *
 * @remarks Reloading throws away everything the session holds only in memory —
 * the Web Serial / BLE port handle, the AI API key, the composer draft, and any
 * message not yet flushed to IndexedDB. So a new version is only applied
 * automatically while the app is disconnected; once a connection exists it
 * renders a banner and lets the user pick the moment.
 */
export function VersionCheck() {
  const { t } = useTranslation();
  const initialVersion = useRef<string | null>(null);
  const updateAvailable = useMeshStore((s) => s.updateAvailable);
  const setUpdateAvailable = useMeshStore((s) => s.setUpdateAvailable);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      initialVersion.current = await fetchVersion();
    }

    async function check() {
      if (initialVersion.current === null) return;
      const current = await fetchVersion();
      if (cancelled || current === null || current === initialVersion.current) {
        return;
      }
      // Read the status at check time rather than subscribing to it, so the
      // poll isn't torn down and restarted on every connection change. Only a
      // fully disconnected app is safe to reload unasked — `connecting`
      // already holds the granted port handle while the initial sync runs.
      if (useMeshStore.getState().status === 'disconnected') {
        window.location.reload();
        return;
      }
      // Adopt the new version as the baseline so the next poll doesn't raise
      // the banner again for a deploy the user has already dismissed.
      initialVersion.current = current;
      setUpdateAvailable(true);
    }

    init();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setUpdateAvailable]);

  if (!updateAvailable) return null;

  return (
    <div
      role='status'
      aria-live='polite'
      className='fixed bottom-5 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-(--accent) bg-(--surface2) px-4 py-2.5 text-sm shadow-lg'
    >
      <div className='min-w-0'>
        <p className='font-semibold'>{t('update.available')}</p>
        <p className='text-xs text-(--text2)'>{t('update.hint')}</p>
      </div>
      <button
        type='button'
        onClick={() => window.location.reload()}
        className='flex shrink-0 items-center gap-1.5 rounded-md bg-(--accent-solid) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover)'
      >
        <RotateCw size={14} aria-hidden='true' />
        {t('update.reload')}
      </button>
      <button
        type='button'
        onClick={() => setUpdateAvailable(false)}
        aria-label={t('update.dismiss')}
        className='-mr-1 shrink-0 rounded p-0.5 text-(--text2) hover:bg-(--surface) hover:text-(--text)'
      >
        <X size={16} aria-hidden='true' />
      </button>
    </div>
  );
}
