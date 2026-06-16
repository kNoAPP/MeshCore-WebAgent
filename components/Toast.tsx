// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

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
