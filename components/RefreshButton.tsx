// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';

/** Circular-arrows refresh glyph; spins via `animate-spin` while busy. */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className={`h-4 w-4 ${className ?? ''}`}
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
      <path d='M21 3v5h-5' />
      <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
      <path d='M3 21v-5h5' />
    </svg>
  );
}

/** Download (arrow-into-tray) glyph, shown before a section's first load. */
function DownloadIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='h-4 w-4'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
      <path d='M7 10l5 5 5-5' />
      <path d='M12 15V3' />
    </svg>
  );
}

/**
 * The app's single refresh control: a bordered icon button whose glyph spins
 * while a fetch is in flight. Disabled (and spinning) while {@link busy}.
 *
 * @param onClick - triggers the refresh.
 * @param busy - fetch in flight: disables the button and spins the icon.
 * @param download - show a download glyph (and "Load" label) instead of the
 *   refresh arrows; for a target whose values haven't been loaded yet.
 * @param className - extra classes for layout (e.g. sizing overrides).
 */
export function RefreshButton({
  onClick,
  busy,
  download,
  className,
}: {
  onClick: () => void;
  busy: boolean;
  download?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(download && !busy ? 'common.load' : 'common.refresh');
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-md border border-(--border-control) p-1.5 text-(--text2) transition-colors hover:bg-(--surface2) hover:text-(--text) disabled:opacity-50 ${className ?? ''}`}
    >
      {busy ? (
        <RefreshIcon className='animate-spin' />
      ) : download ? (
        <DownloadIcon />
      ) : (
        <RefreshIcon />
      )}
    </button>
  );
}
