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

import { useCallback } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { translate, type TranslationKey } from '@/lib/i18n';

/**
 * Returns a locale-bound `t()` translation function and the active locale
 * code. The function re-renders callers whenever the locale changes in the
 * store.
 */
export function useTranslation(): {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  locale: string;
} {
  const locale = useMeshStore((s) => s.locale);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string =>
      translate(locale, key, vars),
    [locale],
  );
  return { t, locale };
}
