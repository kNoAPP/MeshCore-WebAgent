// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import 'i18next';
import type en from '@/locales/en.json';

/**
 * Types `t()` keys against the authoritative English dictionary so missing or
 * misspelled keys fail type-check.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof en;
    };
  }
}
