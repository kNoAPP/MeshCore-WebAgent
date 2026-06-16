---
# Copyright 2026 Knoban LLC. All rights reserved.
#
# This software is confidential and proprietary, intended for use only by
# Knoban LLC or its authorized users. Unauthorized use, copying, modification,
# distribution of this software, or any part of it, is strictly prohibited and
# may be subject to civil and criminal penalties.
#
# A License Agreement is required to view, use, and/or modify this software.
#
# Disclaimer: This software is provided 'as is' and without any express or
# implied warranties. Knoban LLC is not liable for any damages arising out of
# the use of this software.
#
# For inquiries, contact: alden@knoban.com

name: code-style
description: >
  TypeScript, React, and styling conventions for this project. Use when writing
  or reviewing any source file, adding components, or touching the state layer.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# Code Style

## TypeScript

- Strict mode is enabled — no `any`, no `// @ts-ignore` without an explanation
  comment.
- Prefer explicit return types on exported functions and hook return values.
- Use the types defined in `types/meshcore.ts` — do not inline equivalent ad-hoc
  types.
- No `node:` built-in imports — this runs entirely in the browser.

## React

- Components live in `components/`. Hooks live in `hooks/`. Keep them separate.
- Do not use `useState` or `useEffect` for state that belongs in the Zustand
  store.
- All global state changes go through Zustand actions defined in
  `store/meshStore.ts`.
- Keep components focused — if a component exceeds ~150 lines it is probably
  doing too much.

## Styling

- Use Tailwind CSS classes for layout, spacing, and typography.
- Use CSS variables (defined in `app/globals.css`) for colors and theming —
  never hardcode hex values in components.
- Do not mix inline `style` props with Tailwind classes for the same property.

## Localization

- Never hardcode user-facing text. Add the string to `locales/en.json` (the
  authoritative dictionary) and render it via `t('...')` from `react-i18next`'s
  `useTranslation`.
- Outside React (hooks, `lib/`), use the shared instance: `i18n.t('...')`.
- Use `{{var}}` interpolation and `_one`/`_other` plural keys — don't assemble
  sentences by concatenation.
- Keep keys type-safe: dynamic keys must resolve to a literal union (e.g. an
  `as const satisfies Record<...>` map), not a bare template literal.
- When adding an `en.json` key, mirror it into `es`/`de`/`fr` (drafts are fine,
  flagged for human review) so the structures stay in sync.

## Comments

Two kinds of comments, two different rules. Never narrate _what_ the code does —
only what a reader can't get from the names and types.

**TSDoc doc comments** (`/** … */`) — required on the public API surface:

- Every **exported** type, interface, class, function, hook, and `const`
  map/enum, plus **public class methods** and **React component props**.
- Describe the contract and anything the signature can't carry: units,
  encodings, sentinels, valid ranges, side effects, and what throws.
- Do not restate the type — no `@param x {number}`. Use `@param`/`@returns` only
  to add meaning; `@remarks` for depth; `@see` to link `docs.meshcore.io` or
  firmware. First line is a tight summary.
- For `lib/meshcore/`, cite the spec section or firmware struct/offset.

**Inline comments (`//`)** — only when the _why_ is non-obvious: a hidden
constraint, a subtle invariant, a workaround, or a non-obvious ordering/timing
dependency. Private helpers get no doc comment by default; add a `//`
why-comment only if subtle.

**Banned:** commented-out code, decorative banners, restating a name/signature,
`TODO` without a reference. Keep comment lines within 80 characters — Prettier
does not reflow prose in comments, so ESLint's `max-len` (`comments: 80`)
enforces it, and `tsdoc/syntax` lints doc-comment syntax. Both run under
`npm run lint` (CI uses `--max-warnings 0`, so either fails the build); coverage
is enforced by review.

## General

- No new abstractions beyond what the immediate task requires.
- No error handling for scenarios that cannot occur in the browser environment.
- No feature flags or backwards-compatibility shims — just change the code.
