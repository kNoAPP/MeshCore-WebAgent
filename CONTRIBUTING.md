# Contributing to MeshCore-WebAgent

Thanks for your interest in contributing. Here's everything you need to get
started.

## Prerequisites

- Node.js 20+
- npm 10+
- Chrome or Edge (for testing Web Serial / Web Bluetooth)
- A MeshCore companion radio (optional but helpful for end-to-end testing)

## Development Setup

```bash
git clone https://github.com/kNoAPP/MeshCore-WebAgent.git
cd MeshCore-WebAgent
npm install
npm run dev
```

Run all checks before pushing:

```bash
npm run lint          # ESLint
npm run type-check    # TypeScript
npm run spell-check   # cspell
npm run build         # production build
```

## Branch Naming

Branches should follow this pattern:

```
<type>/<short-description>
```

Examples: `feat/wifi-reconnect`, `fix/ble-mtu-negotiation`, `docs/readme-update`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`

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

1. Fork the repo and create your branch from `main`
2. Make your changes with passing lint, type-check, spell-check, and build
3. Fill out the PR template completely
4. Request review from `@kNoAPP`

PRs that change the binary protocol layer (`lib/meshcore/`) should include a
description of which Companion Protocol commands are affected and reference the
relevant [protocol docs](https://docs.meshcore.io/companion_protocol/).

## Code Style

- TypeScript strict mode — no `any`, no `// @ts-ignore` without a comment
  explaining why
- No comments unless the _why_ is non-obvious
- No new abstractions beyond what the immediate task requires
- Tailwind classes for layout/spacing; CSS variables for theming
- State changes go through Zustand actions, not direct component state

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
