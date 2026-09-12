// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';

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
  const label = busy
    ? t('common.loading')
    : t(download ? 'common.load' : 'common.refresh');
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-md border border-border-control p-1.5 text-text2 transition-colors hover:bg-surface2 hover:text-text disabled:opacity-50 ${className ?? ''}`}
    >
      {busy ? (
        <RefreshCw size={16} className='animate-spin' aria-hidden='true' />
      ) : download ? (
        <Download size={16} aria-hidden='true' />
      ) : (
        <RefreshCw size={16} aria-hidden='true' />
      )}
    </button>
  );
}
