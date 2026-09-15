---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)

name: commits
description: >
  Commit message and branch naming conventions. Use when writing commit
  messages, naming branches, or squashing changes before a pull request.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.3.0'
---

# Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

## Never commit to `develop`

`develop` is the protected default branch and only ever advances by merging a
pull request. Before the first commit of any change, confirm you are not on it:

```bash
git rev-parse --abbrev-ref HEAD   # must not be "develop"
```

If you already committed to a local `develop`, move the work onto a branch
(`git switch -c <handle>/none-<type>-<desc>`) and reset `develop` back to
`origin/develop` before pushing anything. Never push or force-push to `develop`,
and never commit there "just this once" for a typo or formatting fix.

## Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

## Types

| Type       | When to use                         |
| ---------- | ----------------------------------- |
| `feat`     | New feature or capability           |
| `fix`      | Bug fix                             |
| `docs`     | Documentation only                  |
| `style`    | Formatting-only code changes        |
| `refactor` | Code change with no behavior change |
| `perf`     | Performance improvement             |
| `test`     | Adding or updating tests            |
| `build`    | Build system or external deps       |
| `ci`       | CI/CD workflow changes              |
| `chore`    | Dependency updates, tooling, config |
| `revert`   | Revert previous changes             |

Breaking changes append `!` to the type: `feat!: drop support for v1 frames`.

## Rules

- Subject line must use **imperative mood** and **start lowercase**:
  `add wifi reconnect`, not `Added WiFi Reconnect`.
- Keep the subject under 72 characters.
- Scope is optional but helpful for the protocol layer:
  `fix(parser): handle malformed BLE frames`.
- PR titles follow the same format — CI will reject non-conforming titles.

## Branch Naming

Per [`CONTRIBUTING.md`](../../../CONTRIBUTING.md), branches follow:

```
<handle>/<issue#>-<type>-<short-description>
```

`<handle>` is your GitHub handle. When there is no linked issue, use `none` for
`<issue#>`. Types match the commit types above (`feat`, `fix`, `docs`,
`refactor`, `test`, `ci`, `chore`).

Examples: `kNoAPP/41-feat-wifi-reconnect`, `mario/none-chore-modify-eslint`,
`docs/readme-update`
