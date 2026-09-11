// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A field's save lifecycle, shown as a small {@link SaveStatusChip}. */
export type SaveStatus = 'saving' | 'saved' | 'error';

/**
 * A save-lifecycle indicator (spinner / ✓ / ⚠). Always occupies a fixed-width
 * slot so it fades in and out in place instead of widening its row and shoving
 * the control sideways when a save starts or clears. When idle it shows a faint
 * dot, so the slot reads as an intentional gutter rather than blank space.
 *
 * The glyphs are decorative (`aria-hidden`); because these controls auto-save
 * with no submit button, the lifecycle is also announced to screen readers via
 * a localized `aria-live` status region so a write's start/finish isn't silent.
 */
export function SaveStatusChip({
  status,
  errorText,
}: {
  status?: SaveStatus;
  errorText?: string;
}) {
  const { t } = useTranslation();
  const announcement =
    status === 'saving'
      ? t('common.saving')
      : status === 'saved'
        ? t('common.saved')
        : status === 'error'
          ? (errorText ?? t('common.saveFailed'))
          : '';
  return (
    <span className='inline-flex w-4 shrink-0 items-center justify-center'>
      {!status && (
        <span aria-hidden className='h-1 w-1 rounded-full bg-border' />
      )}
      {status === 'saving' && (
        <span
          aria-hidden
          className='h-3 w-3 animate-spin rounded-full border border-text2 border-t-transparent'
        />
      )}
      {status === 'saved' && (
        <span aria-hidden className='text-xs text-green'>
          ✓
        </span>
      )}
      {status === 'error' && (
        <span
          aria-hidden
          className='cursor-help text-xs text-red'
          title={errorText}
        >
          ⚠
        </span>
      )}
      <span role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </span>
    </span>
  );
}

/** What a save resolved to: success, or the localized reason it didn't. */
export interface SaveOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Tracks a field's save lifecycle for {@link SaveStatusChip}. `run` wraps an
 * async save that resolves to a success boolean or a {@link SaveOutcome}: it
 * flips to `saving`, then to `saved` (auto-clearing back to idle after a
 * moment) or `error`, and returns the normalized outcome so the caller can
 * react (e.g. close an editor on success).
 *
 * A failure keeps its reason in `errorText` and does not auto-clear: the field
 * is still wrong, so the explanation stays with it rather than going to a toast
 * that has already vanished.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus | undefined>();
  const [errorText, setErrorText] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A monotonic id per `run` call. Only the latest invocation may touch status,
  // so a slower earlier save can't overwrite a newer one's spinner with its own
  // `saved`/`error` (or clear the indicator via its timer) while the newer
  // write is still in flight — the controls stay editable during a save.
  const gen = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(
    async (save: () => Promise<boolean | SaveOutcome>) => {
      const mine = ++gen.current;
      clearTimeout(timer.current);
      setStatus('saving');
      setErrorText(undefined);
      const result = await save();
      const outcome: SaveOutcome =
        typeof result === 'boolean' ? { ok: result } : result;
      // A newer run started while this one was awaiting: it owns the status.
      if (gen.current !== mine) return outcome;
      setStatus(outcome.ok ? 'saved' : 'error');
      setErrorText(outcome.ok ? undefined : outcome.error);
      if (outcome.ok) {
        timer.current = setTimeout(() => {
          if (gen.current === mine) setStatus(undefined);
        }, 2000);
      }
      return outcome;
    },
    [],
  );

  return { status, errorText, run };
}
