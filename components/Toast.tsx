// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';

/**
 * Renders the current store toast (top-center), color-coded by variant; nothing
 * when none is set. Error toasts persist until dismissed via their button and
 * wrap; other variants are non-interactive and auto-clear.
 */
export function Toast() {
  const { t } = useTranslation();
  const toast = useMeshStore((s) => s.toast);
  const dismissToast = useMeshStore((s) => s.dismissToast);
  if (!toast) return null;

  const colors = {
    success: 'border-(--green) text-(--green)',
    error: 'border-(--red) text-(--red)',
    '': 'border-(--border) text-(--text)',
  };

  const isError = toast.variant === 'error';
  const interaction = isError
    ? 'pointer-events-auto flex max-w-[90vw] items-start gap-2'
    : 'pointer-events-none whitespace-nowrap';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`fixed top-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-(--surface2) px-4 py-2.5 text-sm shadow-lg ${interaction} ${colors[toast.variant]}`}
    >
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
  );
}
