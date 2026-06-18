// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { Wordmark } from './Wordmark';

/** Where mobile/tablet visitors are sent for the official native app. */
const MESHCORE_APP_URL = 'https://meshcore.io';

/**
 * Full-screen gate shown to phone and tablet visitors. The companion client
 * relies on desktop-only browser capabilities (Web Serial / Web Bluetooth), so
 * this asks them to switch to a desktop and offers the official MeshCore app as
 * a fallback. See {@link useIsDesktop} for the device classification.
 */
export function DesktopOnly() {
  const { t } = useTranslation();

  return (
    <div className='flex h-full flex-col items-center justify-center px-6'>
      <div
        className='w-full max-w-md rounded-[10px] border p-8 text-center'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div
          className='mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl'
          style={{
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          }}
        >
          <Monitor size={32} className='text-(--accent)' />
        </div>

        <p className='mb-2 text-sm font-semibold tracking-tight'>
          <Wordmark />
        </p>

        <h1 className='mb-2 text-xl font-bold'>{t('desktopOnly.title')}</h1>
        <p className='text-sm text-(--text2)'>{t('desktopOnly.body')}</p>

        <div
          className='mt-6 border-t pt-6'
          style={{ borderColor: 'var(--border)' }}
        >
          <p className='mb-3 text-sm text-(--text2)'>
            {t('desktopOnly.appCta')}
          </p>
          <a
            href={MESHCORE_APP_URL}
            target='_blank'
            rel='noreferrer noopener'
            className='inline-flex w-full items-center justify-center rounded-lg
              bg-(--accent) py-2.5 text-sm font-semibold text-white
              transition-opacity hover:opacity-90'
          >
            {t('desktopOnly.appButton')}
          </a>
        </div>
      </div>
    </div>
  );
}
