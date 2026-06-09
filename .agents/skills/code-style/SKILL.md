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

- Strict mode is enabled — no `any`, no `// @ts-ignore` without an explanation comment.
- Prefer explicit return types on exported functions and hook return values.
- Use the types defined in `types/meshcore.ts` — do not inline equivalent ad-hoc types.
- No `node:` built-in imports — this runs entirely in the browser.

## React

- Components live in `components/`. Hooks live in `hooks/`. Keep them separate.
- Do not use `useState` or `useEffect` for state that belongs in the Zustand store.
- All global state changes go through Zustand actions defined in `store/meshStore.ts`.
- Keep components focused — if a component exceeds ~150 lines it is probably doing too much.

## Styling

- Use Tailwind CSS classes for layout, spacing, and typography.
- Use CSS variables (defined in `app/globals.css`) for colors and theming — never hardcode hex values in components.
- Do not mix inline `style` props with Tailwind classes for the same property.

## Comments

- Write no comments unless the _why_ is non-obvious: a hidden constraint, a subtle invariant, or a workaround for a specific bug.
- Do not comment what the code does — well-named identifiers already say that.

## General

- No new abstractions beyond what the immediate task requires.
- No error handling for scenarios that cannot occur in the browser environment.
- No feature flags or backwards-compatibility shims — just change the code.
