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

import { en } from '@/locales/en';
import { ja } from '@/locales/ja';
import type { Locale } from '@/types/meshcore';

/** All translation keys (derived from the English source-of-truth). */
export type TranslationKey = keyof typeof en;

/**
 * A bound translation function returned by {@link useTranslation}.
 *
 * @param key - one of the {@link TranslationKey} identifiers.
 * @param vars - optional map of `{{placeholder}}` substitutions.
 * @returns the locale string with placeholders replaced.
 */
export type TranslationFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

// Locale maps must cover every key but values are arbitrary strings.
const translations: Record<Locale, Record<TranslationKey, string>> = { en, ja };

/**
 * Replaces every `{{name}}` placeholder in `template` with the matching entry
 * from `vars`. Unknown placeholders are left as-is.
 */
function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    String(vars[key] ?? match),
  );
}

/**
 * Returns the translated string for `key` in `locale`, falling back to English
 * when the locale dict is missing the key. Substitutes `{{var}}` placeholders
 * from `vars`.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const dict = translations[locale] ?? en;
  const raw = (dict[key] ?? en[key]) as string;
  return vars ? interpolate(raw, vars) : raw;
}

/** localStorage key used to persist the chosen locale. */
export const LOCALE_STORAGE_KEY = 'meshcore.locale';

/**
 * Determines the initial locale by checking localStorage first, then
 * `navigator.language`, falling back to `'en'`. Returns `'en'` on the server
 * (no `window`).
 */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'ja') return stored;
  } catch {}
  const lang = navigator.language.split('-')[0];
  if (lang === 'ja') return 'ja';
  return 'en';
}
