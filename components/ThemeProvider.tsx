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

import { useEffect } from 'react';
import { useMeshStore } from '@/store/meshStore';

/**
 * Keeps the document's `data-theme` attribute in sync with the active theme.
 * The attribute is set pre-paint by the inline script in `app/layout.tsx` to
 * avoid a flash; this reasserts it on every store change. Renders nothing —
 * the visible swap is driven entirely by the CSS tokens keyed off `data-theme`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useMeshStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <>{children}</>;
}
