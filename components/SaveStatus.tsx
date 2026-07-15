// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** A field's save lifecycle, shown as a small {@link SaveStatusChip}. */
export type SaveStatus = 'saving' | 'saved' | 'error';

/**
 * A save-lifecycle indicator (spinner / ✓ / ⚠). Always occupies a fixed-width
 * slot so it fades in and out in place instead of widening its row and shoving
 * the control sideways when a save starts or clears. When idle it shows a faint
 * dot, so the slot reads as an intentional gutter rather than blank space.
 */
export function SaveStatusChip({
  status,
  errorText,
}: {
  status?: SaveStatus;
  errorText?: string;
}) {
  return (
    <span className='inline-flex w-4 shrink-0 items-center justify-center'>
      {!status && (
        <span aria-hidden className='h-1 w-1 rounded-full bg-(--border)' />
      )}
      {status === 'saving' && (
        <span
          aria-hidden
          className='h-3 w-3 animate-spin rounded-full border border-(--text2) border-t-transparent'
        />
      )}
      {status === 'saved' && (
        <span aria-hidden className='text-xs text-(--green)'>
          ✓
        </span>
      )}
      {status === 'error' && (
        <span
          className='cursor-help text-xs text-(--red)'
          title={errorText}
          aria-label={errorText}
        >
          ⚠
        </span>
      )}
    </span>
  );
}

/**
 * Tracks a field's save lifecycle for {@link SaveStatusChip}. `run` wraps an
 * async save that resolves to a success boolean: it flips to `saving`, then to
 * `saved` (auto-clearing back to idle after a moment) or `error`, and returns
 * the boolean so the caller can react (e.g. close an editor on success).
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(async (save: () => Promise<boolean>) => {
    clearTimeout(timer.current);
    setStatus('saving');
    const ok = await save();
    setStatus(ok ? 'saved' : 'error');
    if (ok) timer.current = setTimeout(() => setStatus(undefined), 2000);
    return ok;
  }, []);

  return { status, run };
}
