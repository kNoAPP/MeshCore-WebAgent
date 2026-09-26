// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useEffect } from 'react';
import { useMeshStore } from '@/store/meshStore';

/**
 * Keeps the document's `data-theme` attribute in sync with the active theme,
 * and the `theme-color` meta with the header's `--surface`, so an installed
 * app's title bar matches the theme. Both are set pre-paint by the inline
 * script in `app/layout.tsx` to avoid a flash; this reasserts them on every
 * store change. Renders nothing — the visible swap is driven entirely by the
 * CSS tokens keyed off `data-theme`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useMeshStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
    // All of them: hydration no longer recognizes the meta the pre-paint
    // script repainted, and adds a second, accent-colored one after it.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', surface);
    }
  }, [theme]);

  return <>{children}</>;
}
