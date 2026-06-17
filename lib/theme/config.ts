// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Themes the UI ships token sets for. Each maps to a `:root[data-theme='…']`
 * block in `app/globals.css`. `dark` is the authoritative default.
 */
export const SUPPORTED_THEMES = ['dark', 'light'] as const;

/** A theme the app knows how to render. */
export type Theme = (typeof SUPPORTED_THEMES)[number];

/** The default theme, used before any choice is persisted. */
export const DEFAULT_THEME: Theme = 'dark';

/** localStorage key for the persisted UI theme preference. */
export const THEME_STORAGE_KEY = 'meshcore.theme';

/** Narrows an arbitrary string to a {@link Theme}. */
export function isSupportedTheme(value: string): value is Theme {
  return (SUPPORTED_THEMES as readonly string[]).includes(value);
}

/**
 * Resolves the theme to start in: a previously persisted choice, else the OS
 * `prefers-color-scheme` preference, else {@link DEFAULT_THEME}. Returns the
 * default during SSR/static build where `window` is absent.
 */
export function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isSupportedTheme(stored)) return stored;
  } catch {}

  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  } catch {
    return DEFAULT_THEME;
  }
}
