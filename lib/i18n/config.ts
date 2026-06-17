// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Locales the UI ships translations for. `en` is the authoritative base and
 * fallback — every key must exist there.
 */
export const SUPPORTED_LOCALES = ['en', 'es', 'de', 'fr'] as const;

/** A locale code the app knows how to render. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** The base/fallback locale. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** The single i18next namespace all UI strings live under. */
export const I18N_NAMESPACE = 'common';

/** localStorage key for the persisted UI locale preference. */
export const LOCALE_STORAGE_KEY = 'meshcore.locale';

/** Native display names for the locale selector. */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
};

/** Narrows an arbitrary string to a {@link SupportedLocale}. */
export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves the locale to start in: a previously persisted choice, else the
 * closest match to the browser's language, else {@link DEFAULT_LOCALE}. Returns
 * the default during SSR/static build where `window` is absent.
 */
export function resolveInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) return stored;
  } catch {}

  const candidates = window.navigator.languages ?? [window.navigator.language];
  for (const tag of candidates) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && isSupportedLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
