// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import de from '@/locales/de.json';
import fr from '@/locales/fr.json';
import { DEFAULT_LOCALE, I18N_NAMESPACE, resolveInitialLocale } from './config';

/**
 * The shared i18next instance. Translations are bundled at build time (no
 * network loader) so the app stays fully offline-capable. Locale is resolved
 * client-side since the static export has no server to negotiate it.
 */
const i18n = i18next.createInstance();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { [I18N_NAMESPACE]: en },
      es: { [I18N_NAMESPACE]: es },
      de: { [I18N_NAMESPACE]: de },
      fr: { [I18N_NAMESPACE]: fr },
    },
    lng: resolveInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: I18N_NAMESPACE,
    ns: [I18N_NAMESPACE],
    interpolation: {
      // React already escapes interpolated values.
      escapeValue: false,
    },
    returnNull: false,
  });
}

export default i18n;
