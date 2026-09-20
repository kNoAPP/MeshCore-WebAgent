// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMeshStore, openConvo } from '@/store/meshStore';

/**
 * Renders the current store toast (top-center), color-coded by variant. Every
 * toast auto-clears; an error or warning wraps and carries a dismiss button,
 * and a toast carrying a conversation is a button that opens it. Everything
 * else is non-interactive. A card that expires while holding focus hands it
 * to the main landmark rather than dropping it.
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
  const openModals = useMeshStore((s) => s.openModals);
  const reconnecting = useMeshStore((s) => s.status === 'reconnecting');
  const wrapRef = useRef<HTMLDivElement>(null);
  const heldFocus = useRef(false);

  // A dismissible card carries real buttons, and the timer now takes them
  // away mid-reach. Focus would fall to `body`, restarting the next Tab at
  // the top of the document, so hand it to the main landmark — where the
  // skip link goes — rather than nowhere.
  useLayoutEffect(() => {
    if (toast || !heldFocus.current) return;
    heldFocus.current = false;
    if (document.activeElement === document.body && document.hasFocus()) {
      document.getElementById('main')?.focus();
    }
  }, [toast]);

  const colors = {
    success: 'border-green text-green',
    error: 'border-red text-red',
    // Not red — these did not fail — but not the neutral border either: a
    // warning reports an operation that did not do what was asked, and it
    // gets the longer timer, so it is worth telling apart at a glance.
    warning: 'border-amber text-amber',
    '': 'border-border text-text',
  };

  const isError = toast?.variant === 'error';
  // The toast sits outside the subtree a dialog marks inert, so its action
  // would be a way out of the modal's focus boundary and into another
  // conversation. The reconnect overlay is modal in the same way and doesn't
  // count as an open modal, so it gets the same treatment: while the link is
  // down, Disconnect is the only way out. Announce the message either way, but
  // don't offer the jump.
  const blocked = openModals > 0 || reconnecting;
  const convo = blocked ? undefined : toast?.convo;
  // Every toast is on a timer, but the ones worth reading twice keep a
  // dismiss button so they can be cleared early — and so withholding the jump
  // does not leave a card with no control on it at all.
  const dismissible = isError || toast?.variant === 'warning' || !!toast?.convo;
  const interaction = dismissible
    ? 'pointer-events-auto flex max-w-[90vw] items-start gap-2 text-left'
    : 'pointer-events-none whitespace-nowrap';
  const shell = `rounded-lg border bg-surface2 px-4 py-2.5 text-sm shadow-pop ${interaction} ${toast ? colors[toast.variant] : ''}`;

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
          className='min-w-0 text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent'
        >
          {toast.text}
        </button>
        <button
          type='button'
          onClick={dismissToast}
          aria-label={t('toast.dismiss')}
          className='-mr-1 shrink-0 rounded p-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent'
        >
          <X size={16} aria-hidden='true' />
        </button>
      </div>
    ) : (
      <div key={toast.id} className={shell}>
        <span>{toast.text}</span>
        {dismissible && (
          <button
            type='button'
            onClick={dismissToast}
            aria-label={t('toast.dismiss')}
            className={`-mr-1 shrink-0 rounded p-0.5 hover:bg-surface focus-visible:outline-2 ${isError ? 'focus-visible:outline-red' : 'focus-visible:outline-accent'}`}
          >
            <X size={16} aria-hidden='true' />
          </button>
        )}
      </div>
    ));

  return (
    <div
      ref={wrapRef}
      onFocusCapture={() => {
        heldFocus.current = true;
      }}
      onBlurCapture={(e) => {
        // A blur naming somewhere else is the reader moving on; one naming
        // nothing is the timer pulling the card out from under them.
        const to = e.relatedTarget as Node | null;
        if (to && !wrapRef.current?.contains(to)) heldFocus.current = false;
      }}
      className='pointer-events-none fixed top-5 left-1/2 z-50 -translate-x-1/2'
    >
      <div role='status' aria-live='polite'>
        {!isError && card}
      </div>
      <div role='alert' aria-live='assertive'>
        {isError && card}
      </div>
    </div>
  );
}
