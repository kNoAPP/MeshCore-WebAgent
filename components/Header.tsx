// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useSyncExternalStore,
  useState,
  useRef,
  useEffect,
  useId,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Moon,
  Sun,
  Radio,
  Search,
  ShieldAlert,
  Inbox,
  HardDrive,
} from 'lucide-react';
import { useMeshStore, isActiveStatus } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { useClickOutside } from '@/hooks/useClickOutside';
import { formatStorage, formatVoltage } from '@/lib/i18n/format';
import { Wordmark } from './Wordmark';
import { Select } from './Select';
import { ModalShell } from './ModalShell';
import { ApprovalInboxList } from './AutomationPanel';
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

  // Full name plus the battery/storage readout so the detail survives when the
  // inline readout collapses on a narrow header and the name truncates.
  const deviceTitle =
    connected && battery
      ? `${deviceName} · ${formatVoltage(battery.voltage)} · ${formatStorage(
          battery.usedKB,
          battery.totalKB,
        )}`
      : deviceName;

  return (
    <header className='@container flex shrink-0 items-center gap-3 border-b px-4 py-2.5 bg-surface border-border'>
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
        /* Chat/Stats/Settings page switch. All tabs are disabled while
           reconnecting — the link is down, so switching views would only show
           stale or half-synced state behind the reconnecting overlay. */
        <nav className='flex shrink-0 overflow-hidden rounded-md border border-border-control'>
          {(['chat', 'map', 'stats', 'settings'] as const).map((v) => (
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
          <DeviceName name={deviceName} detail={deviceTitle} />
          <AdvertMenu />
          <ProposalsButton />
          <KillSwitchButton />
          {connected && battery && (
            <span className='hidden shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text2 @6xl:inline-flex'>
              {formatVoltage(battery.voltage)}
              <HardDrive size={12} aria-hidden='true' />
              <span className='sr-only'>{t('header.storage')}</span>
              {formatStorage(battery.usedKB, battery.totalKB)}
            </span>
          )}
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
// disclosure for its full text plus the battery/storage detail, which the
// inline readout drops on a narrow header. Mirrors MessageBubble's HintToken.
function DeviceName({ name, detail }: { name: string; detail: string }) {
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
        {detail}
      </span>
    </span>
  );
}

// The popup's open state lives in ProposalsInbox, which is mounted only while
// the queue is non-empty. Draining the queue unmounts it and discards that
// state, so a newly arriving proposal always starts closed.
function ProposalsButton() {
  const count = useMeshStore((s) => s.stagedActions.length);
  // An approval executes immediately and the inbox drops the proposal either
  // way, so offering it over a dead link would silently discard the action.
  const reconnecting = useMeshStore((s) => s.status) === 'reconnecting';
  if (count === 0 || reconnecting) return null;
  return <ProposalsInbox count={count} />;
}

function ProposalsInbox({ count }: { count: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t('automation.inbox.title', { count })}
        title={t('automation.inbox.title', { count })}
        className='flex shrink-0 items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-solid hover:text-white'
      >
        <Inbox size={13} />
        {count}
      </button>
      {open && (
        <ModalShell
          title={t('automation.inbox.title', { count })}
          onClose={() => setOpen(false)}
        >
          <ApprovalInboxList />
        </ModalShell>
      )}
    </>
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

// Advertising needs a fully connected link, so the button is disabled while
// reconnecting — matching the Stats tab.
function AdvertMenu() {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const { advertise, sending } = useAdvertise();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss the open menu on an outside click (shared with the app's other
  // popovers) or Escape.
  useClickOutside(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onSelect = (flood: boolean) => {
    setOpen(false);
    void advertise(flood);
  };

  const itemClass =
    'focus-inset block w-full px-3 py-2 text-left text-xs text-text hover:bg-surface hover:text-accent';

  return (
    <div className='relative shrink-0' ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={status !== 'connected' || sending}
        aria-label={t('header.advertise')}
        title={t('header.advertise')}
        aria-haspopup='menu'
        aria-expanded={open}
        className='flex items-center justify-center rounded-md border border-border-control p-1.5 text-text2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-control disabled:hover:text-text2'
      >
        <Radio size={15} />
      </button>
      {open && (
        <div
          role='menu'
          className='absolute top-full right-0 z-20 mt-1 min-w-max overflow-hidden rounded-md border border-border shadow-pop bg-surface2'
        >
          <button
            role='menuitem'
            onClick={() => onSelect(false)}
            className={itemClass}
          >
            {t('settings.advertiseZeroHop')}
          </button>
          <button
            role='menuitem'
            onClick={() => onSelect(true)}
            className={itemClass}
          >
            {t('settings.advertiseFlood')}
          </button>
        </div>
      )}
    </div>
  );
}
