// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';

/**
 * Keyboard-only bypass link to the app's primary content landmark.
 */
export function SkipLink() {
  const { t } = useTranslation();

  return (
    <a
      href='#main'
      className='sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:border-(--accent) focus-visible:bg-(--surface) focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-(--text) focus-visible:shadow-lg'
    >
      {t('common.skipToContent')}
    </a>
  );
}
