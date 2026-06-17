// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { useMeshStore } from '@/store/meshStore';

/**
 * Provides the shared i18next instance to the React tree and keeps the
 * document's `lang` attribute in sync with the active locale. Locale is
 * resolved client-side (the static export has no server to negotiate it).
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useMeshStore((s) => s.locale);

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
