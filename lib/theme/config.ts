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
