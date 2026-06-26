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

| Skill           | When to use                                           |
| --------------- | ----------------------------------------------------- |
| `architecture`  | Navigating the codebase, stack, or data flow          |
| `code-style`    | Writing or reviewing any source file (incl. comments) |
| `commits`       | Writing commit messages or naming branches            |
| `deployment`    | Touching `next.config.ts` or CI workflows             |
| `protocol`      | Touching anything in `lib/meshcore/`                  |
| `pull-requests` | Preparing or describing a pull request                |

## Key Conventions

- **TypeScript strict mode** — no `any`, no `// @ts-ignore` without explanation.
- **State changes go through Zustand actions** in `store/meshStore.ts`, not
  local component state, and never `useEffect` for state that belongs in
  Zustand.
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
