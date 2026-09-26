// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/components/I18nProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { VersionCheck } from '@/components/VersionCheck';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SkipLink } from '@/components/SkipLink';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
} from '@/lib/i18n/config';
import './globals.css';

// The only copy of the app name in the page metadata; the manifest is JSON
// and keeps its own.
const APP_NAME = 'MeshCore Desktop';
const APP_DESCRIPTION =
  'Message, map and manage your MeshCore LoRa radio from the browser over ' +
  'USB, Bluetooth or WiFi. No account, no server.';

export const metadata: Metadata = {
  // Link-preview crawlers ignore relative image URLs; this makes them
  // absolute. Matches `public/CNAME`.
  metadataBase: new URL('https://kn0.app'),
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: '/',
    locale: 'en_US',
  },
  // X reads the title, description and image from the Open Graph tags.
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  // Discord colors the side bar of a link embed with the first theme-color.
  // Keep this plain brand-accent entry first if per-scheme entries are added.
  themeColor: '#4f8ef7',
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

// Sets `lang` on <html> before first paint, so assistive tech never announces
// the pre-hydration document as English while a non-English locale is active
// (WCAG 3.1.1). Mirrors `resolveInitialLocale`; the constants are interpolated
// from `lib/i18n/config` so the list cannot drift. Inlined for the same reason
// as the theme script above.
const localeInitScript = `
(function () {
  var supported = ${JSON.stringify(SUPPORTED_LOCALES)};
  var l;
  try {
    l = localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)});
  } catch (e) {}
  if (supported.indexOf(l) === -1) {
    l = ${JSON.stringify(DEFAULT_LOCALE)};
    var tags = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < tags.length; i++) {
      var base = String(tags[i]).split('-')[0].toLowerCase();
      if (supported.indexOf(base) !== -1) {
        l = base;
        break;
      }
    }
  }
  document.documentElement.lang = l;
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
    // suppressHydrationWarning: the init scripts set `data-theme` and `lang` on
    // this element before hydration, so its attributes intentionally differ
    // from the server-rendered HTML. Scoped to <html>; children still hydrate
    // normally. `lang='en'` stays as the no-JS fallback.
    <html lang='en' className='h-full' suppressHydrationWarning>
      <head>
        <meta
          httpEquiv='Cache-Control'
          content='no-cache, no-store, must-revalidate'
        />
        <meta httpEquiv='Pragma' content='no-cache' />
        <meta httpEquiv='Expires' content='0' />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
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
