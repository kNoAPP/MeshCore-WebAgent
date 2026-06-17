// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tsdoc from 'eslint-plugin-tsdoc';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Validate the syntax of TSDoc (/** */) doc comments — see the commenting
  // policy in AGENTS.md and the code-style skill.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { tsdoc },
    rules: {
      'tsdoc/syntax': 'warn',
      // Enforce the 80-char comment limit that Prettier's printWidth ignores
      // (Prettier never reflows prose in comments). Code length stays under
      // Prettier's control, so only comment overflow is flagged here.
      'max-len': [
        'warn',
        {
          code: Number.MAX_SAFE_INTEGER,
          comments: 80,
          ignoreUrls: true,
          tabWidth: 2,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
