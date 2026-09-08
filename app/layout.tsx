// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Metadata } from 'next';
import { I18nProvider } from '@/components/I18nProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { VersionCheck } from '@/components/VersionCheck';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SkipLink } from '@/components/SkipLink';
import './globals.css';

export const metadata: Metadata = {
  title: 'MeshCore Companion',
  description: 'Web interface for MeshCore companion radios',
  manifest: '/manifest.webmanifest',
};

// Sets `data-theme` on <html> before first paint to avoid a flash of the wrong
// theme. Mirrors `resolveInitialTheme`. Inlined (not a module) so it runs
// synchronously ahead of hydration; the static export has no server to resolve
// the theme on.
const themeInitScript = `
(function () {
  var t;
  try {
    t = localStorage.getItem('meshcore.theme');
  } catch (e) {}
  if (t !== 'dark' && t !== 'light') {
    try {
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      t = 'dark';
    }
  }
  document.documentElement.dataset.theme = t;
})();
`;

/**
 * Next.js root layout. Sets no-cache headers (the static export is redeployed
 * on each release) and mounts the {@link VersionCheck} update prompt above
 * the app.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme-init script sets `data-theme` on this
    // element before hydration, so its attributes intentionally differ from the
    // server-rendered HTML. Scoped to <html>; children still hydrate normally.
    <html lang='en' className='h-full' suppressHydrationWarning>
      <head>
        <meta
          httpEquiv='Cache-Control'
          content='no-cache, no-store, must-revalidate'
        />
        <meta httpEquiv='Pragma' content='no-cache' />
        <meta httpEquiv='Expires' content='0' />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className='flex h-full flex-col overflow-hidden'>
        <ThemeProvider>
          <I18nProvider>
            <SkipLink />
            <VersionCheck />
            <ServiceWorkerRegister />
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
