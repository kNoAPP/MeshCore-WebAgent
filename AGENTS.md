# MeshCore-WebAgent — Agent Instructions

This is the canonical instruction set for all coding agents (Claude Code, GitHub
Copilot, and others). `CLAUDE.md` and `.github/copilot-instructions.md` defer to
this file — make instruction changes here only.

## Project Overview

Browser-based, fully client-side companion client for
[MeshCore](https://github.com/meshcore-dev/MeshCore) LoRa mesh radios. No
backend. Connects over USB Serial, Bluetooth LE, or WiFi WebSocket. Live at
**[kn0.app](https://kn0.app)**.

For the stack, module layout, and core data flow, read the `architecture` skill.
On new sessions, also skim the MeshCore docs at https://docs.meshcore.io and
https://github.com/meshcore-dev/MeshCore.

## Dev Commands

```bash
npm run dev           # start Next.js dev server at localhost:3000
npm run build         # static export → out/
npm run format        # format all files with Prettier
npm run format:check  # verify formatting (run in CI)
npm run lint          # ESLint
npm run type-check    # tsc --noEmit
npm run spell-check   # cspell
```

Run all checks before pushing. CI enforces every one of them: spell-check,
format check, lint, type-check, build.

## Agent Skills

Domain-specific instructions live in `.agents/skills/`. Read the relevant skill
before working in that area:

| Skill                       | When to use                                           |
| --------------------------- | ----------------------------------------------------- |
| `architecture`              | Navigating the codebase, stack, or data flow          |
| `code-style`                | Writing or reviewing any source file (incl. comments) |
| `commits`                   | Writing commit messages or naming branches            |
| `protocol`                  | Touching anything in `lib/meshcore/`                  |
| `pull-requests`             | Preparing or describing a pull request                |
| `resolving-review-feedback` | Resolving or responding to PR review feedback         |

## Key Conventions

- **TypeScript strict mode** — no `any`, no `// @ts-ignore` without explanation.
- **State changes go through Zustand actions** in `store/meshStore.ts`, not
  local component state, and never `useEffect` for state that belongs in
  Zustand.
- **`localStorage` is off-limits for persistence** except for the two
  pre-connect preferences (`locale`, `theme`) that must be readable before a
  radio is connected. Every other setting or preference is **per-radio** and
  **encrypted in IndexedDB** — see _Persisting preferences_ below.
- **All UI strings are localized** with `react-i18next`. Add new strings to
  `locales/en.json` and render them via `t('...')` (or `i18n.t('...')` outside
  React) — never hardcode display text.
- **Tailwind for layout/spacing**, CSS variables for theming
  (`app/globals.css`).
- **Comments** — TSDoc on the public API surface, `//` inline only when the
  _why_ is non-obvious. Full policy lives in the `code-style` skill.
- **No new abstractions** beyond what the immediate task requires.
- **Prettier formats on save** — run `npm run format` if needed.
- **No AI self-attribution** in commits, PRs, issues, or discussions — do not
  add `Co-Authored-By` model trailers, "Generated with …" footers, or similar.

## Persisting Preferences

`localStorage` is **not** an acceptable persistence layer for preferences. The
only exceptions are settings that can be changed **before** connecting to a
radio (on the connect screen) — today that is just `locale` and `theme`, which
live in `localStorage` because they must be readable synchronously at first
paint (theme has a pre-paint script in `app/layout.tsx`).

Every other preference is **scoped to the connected radio** and stored
**encrypted** in IndexedDB, under the AES-256-GCM key derived from that radio's
own secrets. Two radios never share a key, and the data is unreadable without
the radio. All such preferences travel together in one per-radio **preferences
blob** (`${pubkey}:preferences` record in the `radios` store).

To add a new per-radio preference:

1. **Store field + action** — add the field to `MeshState` and a setter to
   `MeshActions` in `store/meshStore.ts`. Its `initialState` value is the
   in-memory default (never a `localStorage` read). The setter just calls
   `set(...)` — no persistence side effect.
2. **Add it to the blob** — extend the `RadioPreferences` interface,
   `selectPreferences()` (state → blob), and `restorePreferences()` (blob →
   state, normalizing every field so a corrupt/partial record falls back to
   defaults). Provide a `normalize*`/`DEFAULT_*` helper for the field's type,
   colocated with that type (e.g. `lib/units/config.ts`, `lib/ai/pref.ts`).
3. **Reset on disconnect** — because prefs are per-radio, `reset()` must let the
   field fall back to its `initialState` default (only `locale`/`theme`/`toast`
   are preserved there). Do not add it to the preserved list.
4. **Persistence is automatic** — the connect flow in `hooks/useMeshCore.ts`
   loads the blob (`loadPreferences`) into the store via `restorePreferences`
   before the radio hydrate, and a debounced store subscription writes it back
   (`savePreferences` via `flushPreferences`) whenever any pref field changes.
   `teardownSession(flush)` flushes it on a deliberate disconnect. If you add a
   field, extend the equality check in that `prefsSaveUnsub` subscription so a
   change to it triggers a save.

The encryption/IO primitives live in `lib/storage.ts`
(`savePreferences`/`loadPreferences`, mirroring `saveAdvertCache`/etc.); the
per-radio key is derived once per session in `useMeshCore` via
`deriveStorageKey`. Sensitive values (e.g. an LLM API key) never go in the blob
or the store — they use the separate encrypted `secrets` store
(`lib/ai/secret.ts`).

## What to Avoid

- Do not add a backend, authentication, or any server-side code — this is
  intentionally serverless.
- Do not change `output: 'export'` in `next.config.ts` — required for GitHub
  Pages.
- Do not import from `node:` built-ins — this runs in the browser.
- Do not add error handling for scenarios that can't happen in the browser
  environment.
- Do not add backwards-compatibility shims, data migrations, or legacy fallbacks
  for code you are changing — always prefer a clean codebase over preserving an
  older broken version.
