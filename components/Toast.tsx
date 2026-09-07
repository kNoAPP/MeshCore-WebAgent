// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';

/**
 * Renders the current store toast (top-center), color-coded by variant; nothing
 * when none is set. Error toasts persist until clicked to dismiss and wrap;
 * other variants are non-interactive and auto-clear.
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
    ? 'pointer-events-auto max-w-[90vw] cursor-pointer'
    : 'pointer-events-none whitespace-nowrap';

  return (
    <div
      role='status'
      aria-live={isError ? 'assertive' : 'polite'}
      onClick={isError ? dismissToast : undefined}
      onKeyDown={
        isError
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                dismissToast();
              }
            }
          : undefined
      }
      tabIndex={isError ? 0 : undefined}
      title={isError ? t('toast.dismiss') : undefined}
      className={`fixed top-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-(--surface2) px-4 py-2.5 text-sm shadow-lg ${interaction} ${colors[toast.variant]}`}
    >
      {toast.text}
    </div>
  );
}
