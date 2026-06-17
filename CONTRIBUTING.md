# Contributing to MeshCore-WebAgent

Thanks for your interest in contributing. Here's everything you need to get
started.

> **Note for coding agents:** [`AGENTS.md`](AGENTS.md) is the canonical
> instruction set, with domain-specific detail in `.agents/skills/`. This guide
> is the human-facing summary and defers to those for conventions.

## Prerequisites

- Node.js 20+
- npm 10+
- Chrome or Edge — required for Web Serial (USB) and Web Bluetooth (BLE). The
  WiFi WebSocket transport works in any modern browser.
- A MeshCore companion radio (optional but helpful for end-to-end testing)

## Development Setup

```bash
git clone https://github.com/kNoAPP/MeshCore-WebAgent.git
cd MeshCore-WebAgent
npm install
npm run dev
```

Run all checks before pushing — CI enforces every one of them:

```bash
npm run spell-check   # cspell
npm run format:check  # Prettier (run `npm run format` to auto-fix)
npm run lint          # ESLint
npm run type-check    # TypeScript
npm run build         # static export → out/
```

## Branch Naming

Branches should follow this pattern:

```
<handle>/<issue#>-<type>-<short-description>
```

Examples: `kNoAPP/41-feat-wifi-reconnect`, `mario/none-chore-modify-eslint`,
`docs/readme-update`

If there's no linked issue, specify `none`. Types: `feat`, `fix`, `docs`,
`refactor`, `test`, `ci`, `chore`

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

Examples:

- `feat(transport): add WiFi auto-reconnect on disconnect`
- `fix(parser): handle malformed BLE frames gracefully`
- `docs: update browser requirements in README`

PR titles must also follow this format — CI will reject non-conforming titles.

## Pull Request Process

1. Fork the repo and create your branch from `develop` (the default branch)
2. Make your changes with all five checks passing (spell-check, format check,
   lint, type-check, build)
3. Fill out the PR template completely — replace each `None` placeholder if
   applicable and leave the guidance comments in place
4. Open the PR against `develop`; `@kNoAPP` is requested automatically via
   CODEOWNERS

First-time contributors are welcome to add themselves to the
[`AUTHORS`](AUTHORS) file in the same PR — anyone who has contributed to the
project (not just via code) is encouraged to do so.

PRs that change the binary protocol layer (`lib/meshcore/`) should include a
description of which Companion Protocol commands are affected and reference the
relevant [protocol docs](https://docs.meshcore.io/companion_protocol/).

## Code Style

The full policy lives in the `code-style` skill (`.agents/skills/code-style/`).
The essentials:

- TypeScript strict mode — no `any`, no `// @ts-ignore` without a comment
  explaining why
- All user-facing text is localized with `react-i18next` — add strings to
  `locales/en.json` and render with `t('...')`; never hardcode display text
- TSDoc on the public API surface; inline `//` comments only when the _why_ is
  non-obvious
- No new abstractions beyond what the immediate task requires
- Tailwind classes for layout/spacing; CSS variables (`app/globals.css`) for
  theming
- State changes go through Zustand actions in `store/meshStore.ts`, not local
  component state

## Adding Words to the Spell Checker

If you introduce a legitimate technical term that cspell flags, add it to the
`words` array in [`cspell.json`](cspell.json).

## Reporting Issues

- **Bugs** — use the [bug report](.github/ISSUE_TEMPLATE/bug_report.yaml)
  template
- **Feature requests** — use the
  [feature request](.github/ISSUE_TEMPLATE/feature_request.yaml) template
- **Security vulnerabilities** — see [SECURITY.md](SECURITY.md); do not open
  public issues
