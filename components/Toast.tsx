// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMeshStore } from '@/store/meshStore';

/**
 * Renders the current store toast (top-center), color-coded by variant; nothing
 * when none is set.
 */
export function Toast() {
  const toast = useMeshStore((s) => s.toast);
  if (!toast) return null;

  const colors = {
    success: 'border-(--green) text-(--green)',
    error: 'border-(--red) text-(--red)',
    '': 'border-(--border) text-(--text)',
  };

  return (
    <div
      className={`pointer-events-none fixed top-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-(--surface2) px-4 py-2.5 text-sm whitespace-nowrap shadow-lg ${colors[toast.variant]}`}
    >
      {toast.text}
    </div>
  );
}
