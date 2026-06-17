// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { fmtVoltage } from '@/lib/utils';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '@/lib/i18n/config';
import type { SupportedLocale } from '@/lib/i18n/config';
import { DEFAULT_THEME } from '@/lib/theme/config';

/**
 * Top bar: connection status, device name, battery/storage, and
 * Stats/Disconnect actions when connected.
 */
export function Header() {
  const { t } = useTranslation();
  const {
    status,
    deviceName,
    battery,
    locale,
    theme,
    setStatsOpen,
    setLocale,
    setTheme,
  } = useMeshStore();
  const { disconnect } = useMeshCore();
  const connected = status === 'connected';

  // The real theme resolves from localStorage/OS only in the browser, so the
  // static export is built with DEFAULT_THEME. Render that same default until
  // hydrated to keep the first client paint identical to the server HTML (no
  // hydration mismatch on the toggle icon), then swap in the real theme. Page
  // colors are already correct pre-paint via the layout script.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const displayTheme = hydrated ? theme : DEFAULT_THEME;

  return (
    <header
      className='flex shrink-0 items-center gap-3 border-b px-4 py-2.5'
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Status dot */}
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          connected
            ? 'bg-(--green) shadow-[0_0_6px_var(--green)]'
            : 'bg-(--red) shadow-[0_0_6px_var(--red)]'
        }`}
      />

      <h1 className='text-base font-bold tracking-tight'>
        Mesh<span className='text-(--accent)'>Core</span> Companion
      </h1>

      <span className='text-xs text-(--text2)'>
        {status === 'connecting'
          ? t('header.connecting')
          : status === 'connected'
            ? t('header.connected')
            : t('header.disconnected')}
      </span>

      {connected && (
        <>
          <span className='ml-auto text-sm font-semibold text-(--accent)'>
            {deviceName}
          </span>
          {battery && (
            <span className='text-xs text-(--text2)'>
              {fmtVoltage(battery.voltage)} 💾 {battery.usedKB}/
              {battery.totalKB}KB
            </span>
          )}
          <button
            onClick={() => setStatsOpen(true)}
            className='rounded-md border border-(--border) px-2.5 py-1 text-xs text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent)'
          >
            {t('header.stats')}
          </button>
          <button
            onClick={disconnect}
            className='rounded-md border border-(--border) px-2.5 py-1 text-xs text-(--text2) transition-colors hover:border-(--red) hover:text-(--red)'
          >
            {t('header.disconnect')}
          </button>
        </>
      )}

      {!connected && (
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
          aria-label={t('header.language')}
          className='ml-auto cursor-pointer rounded-md border border-(--border) bg-(--surface) px-2 py-1 text-xs text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent)'
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t('theme.toggle')}
        title={t('theme.toggle')}
        className={`flex items-center justify-center rounded-md border border-(--border) p-1.5 text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent) ${
          connected ? '' : 'ml-2'
        }`}
      >
        {displayTheme === 'dark' ? (
          // Sun — switches to the light theme.
          <Sun size={15} />
        ) : (
          // Moon — switches to the dark theme.
          <Moon size={15} />
        )}
      </button>
    </header>
  );
}
