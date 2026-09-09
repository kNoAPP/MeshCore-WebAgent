// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useMeshStore } from '@/store/meshStore';

/**
 * Centered modal dialog with a title bar and close button.
 *
 * Carries the whole dialog contract so every call site inherits it: `dialog`
 * semantics labelled by the title, Escape to dismiss, focus moved into the card
 * on open and restored to the opener on close, and a Tab guard that keeps focus
 * inside. It renders through a portal on `document.body` and registers itself
 * in the store, so the app behind it can go `inert` while it is open.
 *
 * @param onClose - dismissal, from the close button, the backdrop, or Escape.
 * @param onBack - if set, renders a back arrow before the title that calls this
 * (used for in-modal sub-pages).
 * @param widthClass - Tailwind width utility for the card; defaults to `w-120`.
 * @param confirmClose - guards a draft the user would lose: the accidental
 * dismissals (backdrop click, Escape) ask for confirmation first, while the
 * close button and the body's own controls still close outright.
 */
export function ModalShell({
  title,
  onClose,
  onBack,
  children,
  widthClass = 'w-120',
  confirmClose = false,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  widthClass?: string;
  confirmClose?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const confirmId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const pushModal = useMeshStore((s) => s.pushModal);
  const popModal = useMeshStore((s) => s.popModal);

  useFocusTrap(cardRef);

  useEffect(() => {
    pushModal();
    return popModal;
  }, [pushModal, popModal]);

  const requestClose = () => {
    if (confirmClose) setConfirming(true);
    else onClose();
  };

  return createPortal(
    <div
      className='fixed inset-0 z-50 flex items-center justify-center p-6'
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        // A portal still bubbles through the React tree, so without this a
        // dialog opened from inside another one would close both at once.
        e.stopPropagation();
        if (confirming) setConfirming(false);
        else requestClose();
      }}
    >
      <div
        ref={cardRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-full ${widthClass} max-w-full flex-col overflow-hidden rounded-[10px] border outline-none`}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className='min-h-0 overflow-y-auto p-7'>
          <div className='mb-5 flex items-center justify-between gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              {onBack && (
                <button
                  onClick={onBack}
                  aria-label={t('common.back')}
                  className='shrink-0 text-(--text2) hover:text-(--text)'
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <h2 id={titleId} className='truncate text-base font-bold'>
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className='shrink-0 text-lg leading-none text-(--text2) hover:text-(--text)'
            >
              ✕
            </button>
          </div>
          {children}
        </div>
        {confirming && (
          <div
            className='absolute inset-0 flex items-center justify-center p-6'
            style={{ background: 'rgba(0,0,0,0.6)' }}
          >
            <div
              role='alertdialog'
              aria-labelledby={confirmId}
              className='w-full max-w-80 rounded-[10px] border p-5'
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              <p id={confirmId} className='text-sm text-(--text2)'>
                {t('common.discardChanges')}
              </p>
              <div className='mt-4 flex justify-end gap-2'>
                <button
                  autoFocus
                  onClick={() => setConfirming(false)}
                  className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
                >
                  {t('common.keepEditing')}
                </button>
                <button
                  onClick={onClose}
                  className='rounded-md bg-(--red) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--red-hover)'
                >
                  {t('common.discard')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
