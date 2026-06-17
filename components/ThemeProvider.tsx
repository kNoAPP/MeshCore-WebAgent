// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

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
