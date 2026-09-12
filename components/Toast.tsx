// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMeshStore, openConvo } from '@/store/meshStore';

/**
 * Renders the current store toast (top-center), color-coded by variant. Error
 * toasts persist until dismissed via their button and wrap; a toast carrying a
 * conversation is a button that opens it and likewise waits to be dismissed.
 * Everything else is non-interactive and auto-clears.
 *
 * Both live regions stay mounted whether or not a toast is set — the card
 * moves in and out of them — because a region inserted together with its text
 * is not announced.
 */
export function Toast() {
  const { t } = useTranslation();
  const toast = useMeshStore((s) => s.toast);
  const dismissToast = useMeshStore((s) => s.dismissToast);
  const setView = useMeshStore((s) => s.setView);

  const colors = {
    success: 'border-(--green) text-(--green)',
    error: 'border-(--red) text-(--red)',
    '': 'border-(--border) text-(--text)',
  };

  const isError = toast?.variant === 'error';
  const convo = toast?.convo;
  const interaction =
    isError || convo
      ? 'pointer-events-auto flex max-w-[90vw] items-start gap-2 text-left'
      : 'pointer-events-none whitespace-nowrap';
  const shell = `rounded-lg border bg-(--surface2) px-4 py-2.5 text-sm shadow-lg ${interaction} ${toast ? colors[toast.variant] : ''}`;

  const openTarget = () => {
    if (!convo) return;
    // Open first: switching the view catches the *then*-open conversation up
    // on its unread backlog, and the one being left behind shouldn't be it.
    openConvo(convo);
    setView('chat');
    dismissToast();
  };

  // Keyed by the toast id: two toasts with identical text and variant would
  // otherwise reuse this card unchanged, and a live region only announces
  // content that actually changed.
  const card =
    toast &&
    (convo ? (
      <div key={toast.id} className={shell}>
        <button
          type='button'
          onClick={openTarget}
          className='min-w-0 text-left hover:underline focus-visible:outline-2 focus-visible:outline-(--accent)'
        >
          {toast.text}
        </button>
        <button
          type='button'
          onClick={dismissToast}
          aria-label={t('toast.dismiss')}
          className='-mr-1 shrink-0 rounded p-0.5 hover:bg-(--surface) focus-visible:outline-2 focus-visible:outline-(--accent)'
        >
          <X size={16} aria-hidden='true' />
        </button>
      </div>
    ) : (
      <div key={toast.id} className={shell}>
        <span>{toast.text}</span>
        {isError && (
          <button
            type='button'
            onClick={dismissToast}
            aria-label={t('toast.dismiss')}
            className='-mr-1 shrink-0 rounded p-0.5 hover:bg-(--surface) focus-visible:outline-2 focus-visible:outline-(--red)'
          >
            <X size={16} aria-hidden='true' />
          </button>
        )}
      </div>
    ));

  return (
    <div className='pointer-events-none fixed top-5 left-1/2 z-50 -translate-x-1/2'>
      <div role='status' aria-live='polite'>
        {!isError && card}
      </div>
      <div role='alert' aria-live='assertive'>
        {isError && card}
      </div>
    </div>
  );
}
