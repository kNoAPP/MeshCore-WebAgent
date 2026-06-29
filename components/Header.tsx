// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useSyncExternalStore, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Megaphone } from 'lucide-react';
import { useMeshStore, isActiveStatus } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { fmtVoltage } from '@/lib/utils';
import { Wordmark } from './Wordmark';
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
    view,
    setView,
    setLocale,
    setTheme,
  } = useMeshStore();
  const { disconnect } = useMeshCore();
  const connected = status === 'connected';
  const reconnecting = status === 'reconnecting';
  // Both states show the device row (name + Disconnect); reconnecting just dims
  // the link-dependent controls.
  const active = isActiveStatus(status);

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
            : reconnecting
              ? 'bg-(--amber) shadow-[0_0_6px_var(--amber)]'
              : 'bg-(--red) shadow-[0_0_6px_var(--red)]'
        }`}
      />

      <h1 className='text-base font-bold tracking-tight'>
        <Wordmark />
      </h1>

      <span className='text-xs text-(--text2)'>
        {/* Each ConnectionStatus maps 1:1 to a header.* key. */}
        {t(`header.${status}`)}
      </span>

      {active && (
        /* Chat/Stats/Settings page switch. Only Stats is disabled while
           reconnecting since it's the one that fetches over the link; Chat and
           Settings render from already-cached store state. */
        <nav className='flex overflow-hidden rounded-md border border-(--border-control)'>
          {(['chat', 'stats', 'settings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              disabled={reconnecting && v === 'stats'}
              aria-current={view === v ? 'page' : undefined}
              className={`px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                view === v
                  ? 'bg-(--accent) text-white'
                  : 'text-(--text2) hover:text-(--accent)'
              }`}
            >
              {t(`header.${v}`)}
            </button>
          ))}
        </nav>
      )}

      {active && (
        <>
          <span className='ml-auto text-sm font-semibold text-(--accent)'>
            {deviceName}
          </span>
          <AdvertMenu />
          {connected && battery && (
            <span className='text-xs text-(--text2)'>
              {fmtVoltage(battery.voltage)} 💾 {battery.usedKB}/
              {battery.totalKB}KB
            </span>
          )}
          <button
            onClick={disconnect}
            className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) transition-colors hover:border-(--red) hover:text-(--red)'
          >
            {t('header.disconnect')}
          </button>
        </>
      )}

      {!active && (
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
          aria-label={t('header.language')}
          className='ml-auto cursor-pointer rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent)'
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
        className={`flex items-center justify-center rounded-md border border-(--border-control) p-1.5 text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent) ${
          active ? '' : 'ml-2'
        }`}
      >
        {displayTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  );
}

/**
 * The advert icon button beside the device name: opens a small dropdown to
 * advertise this node to the mesh, choosing zero-hop (direct neighbors) or
 * flood (whole mesh). Advertising needs a fully connected link, so the button
 * is disabled while reconnecting — matching the Stats tab — and each action
 * routes through {@link useMeshCore.advertiseSelf}, which toasts the outcome.
 */
function AdvertMenu() {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const { advertiseSelf } = useMeshCore();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss the open menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const advertise = async (flood: boolean) => {
    setOpen(false);
    setSending(true);
    await advertiseSelf(flood);
    setSending(false);
  };

  const itemClass =
    'block w-full px-3 py-2 text-left text-xs text-(--text) hover:bg-(--surface) hover:text-(--accent)';

  return (
    <div className='relative' ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={status !== 'connected' || sending}
        aria-label={t('header.advertise')}
        title={t('header.advertise')}
        aria-haspopup='menu'
        aria-expanded={open}
        className='flex items-center justify-center rounded-md border border-(--border-control) p-1.5 text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-(--border-control) disabled:hover:text-(--text2)'
      >
        <Megaphone size={15} />
      </button>
      {open && (
        <div
          role='menu'
          className='absolute top-full right-0 z-20 mt-1 min-w-max overflow-hidden rounded-md border border-(--border) shadow-lg'
          style={{ background: 'var(--surface2)' }}
        >
          <button
            role='menuitem'
            onClick={() => void advertise(false)}
            className={itemClass}
          >
            {t('settings.advertiseZeroHop')}
          </button>
          <button
            role='menuitem'
            onClick={() => void advertise(true)}
            className={itemClass}
          >
            {t('settings.advertiseFlood')}
          </button>
        </div>
      )}
    </div>
  );
}
