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
  version: '1.1.0'
---

# Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

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

```
<type>/<short-description>
```

Examples: `feat/wifi-reconnect`, `fix/ble-mtu-negotiation`, `docs/readme-update`
