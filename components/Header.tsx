// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useSyncExternalStore, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Search, ShieldAlert } from 'lucide-react';
import { useMeshStore, isActiveStatus } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { Wordmark } from './Wordmark';
import { Select } from './Select';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '@/lib/i18n/config';
import { DEFAULT_THEME } from '@/lib/theme/config';

// "/" must not hijack a text field.
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Top bar: navigation and identity — connection status, the wordmark, the page
 * tabs, search, the connected radio's name, the automation kill switch and
 * Disconnect. Ambient state that is glanced at rather than operated lives in
 * the {@link ActionBar} instead.
 */
export function Header() {
  const { t } = useTranslation();
  const {
    status,
    deviceName,
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

  const openCommandPalette = useMeshStore((s) => s.openCommandPalette);
  const closeCommandPalette = useMeshStore((s) => s.closeCommandPalette);
  const setWindowFocused = useMeshStore((s) => s.setWindowFocused);

  // Global shortcut for the command palette: Ctrl/⌘ + K toggles it, and a bare
  // "/" opens it unless the user is typing in a field. Only armed while
  // connected, matching where the palette is mounted. This is the one
  // legitimate effect — a document-level key listener has no store equivalent.
  useEffect(() => {
    if (!connected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useMeshStore.getState().commandPaletteOpen) closeCommandPalette();
        else openCommandPalette();
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        openCommandPalette();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [connected, openCommandPalette, closeCommandPalette]);

  // Whether the tab is the one the user is looking at is a browser fact with no
  // store equivalent, so it needs a window listener — the second and last
  // legitimate effect here. `visibilitychange` covers a tab switch, focus/blur
  // covers moving to another window on the same tab.
  useEffect(() => {
    const sync = () =>
      setWindowFocused(!document.hidden && document.hasFocus());
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [setWindowFocused]);

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
    <header className='flex shrink-0 items-center gap-3 border-b px-4 py-2.5 bg-surface border-border'>
      {/* Status dot */}
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          connected
            ? 'bg-green shadow-[0_0_6px_var(--green)]'
            : reconnecting
              ? 'bg-amber shadow-[0_0_6px_var(--amber)]'
              : 'bg-red shadow-[0_0_6px_var(--red)]'
        }`}
      />

      <h1 className='shrink-0 text-base font-bold tracking-tight'>
        <Wordmark />
      </h1>

      <span
        role='status'
        aria-live='polite'
        className='shrink-0 text-xs whitespace-nowrap text-text2'
      >
        {/* Each ConnectionStatus maps 1:1 to a header.* key. */}
        {t(`header.${status}`)}
      </span>

      {active && (
        /* Chat/Nodes/Map/Stats/Settings page switch. All tabs are disabled
           while reconnecting — the link is down, so switching views would only
           show stale or half-synced state behind the reconnecting overlay. */
        <nav className='flex shrink-0 overflow-hidden rounded-md border border-border-control'>
          {(['chat', 'nodes', 'map', 'stats', 'settings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              disabled={reconnecting}
              aria-current={view === v ? 'page' : undefined}
              className={`focus-inset px-2.5 py-1 text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                view === v
                  ? 'bg-accent-solid text-white inset-ring-1 inset-ring-accent'
                  : 'text-text2 hover:text-accent'
              }`}
            >
              {t(`header.${v}`)}
            </button>
          ))}
        </nav>
      )}

      {active && (
        <button
          onClick={openCommandPalette}
          disabled={reconnecting}
          aria-label={t('command.open')}
          title={t('command.openHint')}
          className='flex shrink-0 items-center gap-1.5 rounded-md border border-border-control px-2.5 py-1 text-xs text-text2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-control disabled:hover:text-text2'
        >
          <Search size={13} />
          <span className='font-medium'>{t('command.search')}</span>
        </button>
      )}

      {active && (
        <>
          <DeviceName name={deviceName} />
          <KillSwitchButton />
          <button
            onClick={disconnect}
            className='shrink-0 rounded-md border border-border-control px-2.5 py-1 text-xs whitespace-nowrap text-text2 transition-colors hover:border-red hover:text-red'
          >
            {t('header.disconnect')}
          </button>
        </>
      )}

      {!active && (
        <Select
          value={locale}
          onChange={setLocale}
          ariaLabel={t('header.language')}
          className='ml-auto cursor-pointer transition-colors hover:border-accent hover:text-accent'
          options={SUPPORTED_LOCALES.map((locale) => ({
            value: locale,
            label: LOCALE_NAMES[locale],
          }))}
        />
      )}

      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t('theme.toggle')}
        title={t('theme.toggle')}
        className={`flex shrink-0 items-center justify-center rounded-md border border-border-control p-1.5 text-text2 transition-colors hover:border-accent hover:text-accent ${
          active ? '' : 'ml-2'
        }`}
      >
        {displayTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  );
}

// The truncated device name doubles as the keyboard- and touch-reachable
// disclosure for its full text. Mirrors MessageBubble's HintToken.
function DeviceName({ name }: { name: string }) {
  const tooltipId = useId();
  return (
    <span
      tabIndex={0}
      aria-describedby={tooltipId}
      className='group/dev relative ml-auto min-w-0 max-w-[16ch] cursor-help'
    >
      <span className='block truncate text-sm font-semibold text-accent'>
        {name}
      </span>
      <span
        id={tooltipId}
        role='tooltip'
        className='pointer-events-none absolute top-full right-0 z-20 mt-1 hidden w-max max-w-xs rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-normal text-text shadow-pop group-hover/dev:block group-focus/dev:block'
      >
        {name}
      </span>
    </span>
  );
}

function KillSwitchButton() {
  const { t } = useTranslation();
  const enabled = useMeshStore((s) => s.automationEnabled);
  const killSwitch = useMeshStore((s) => s.killSwitch);
  const showToast = useMeshStore((s) => s.showToast);
  if (!enabled) return null;
  return (
    <button
      onClick={() => {
        killSwitch();
        showToast(t('automation.killed'));
      }}
      aria-label={t('automation.kill')}
      title={t('automation.killHint')}
      className='flex shrink-0 items-center gap-1.5 rounded-md border border-red px-2.5 py-1 text-xs font-semibold text-red transition-colors hover:bg-red-solid hover:text-white'
    >
      <ShieldAlert size={13} />
      {t('automation.kill')}
    </button>
  );
}
