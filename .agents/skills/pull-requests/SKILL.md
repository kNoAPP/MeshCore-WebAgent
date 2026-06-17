---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)

name: pull-requests
description: >
  Pull request conventions and requirements. Use when creating a pull request,
  writing a PR description, preparing changes for review, or referencing the PR
  template.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.1.0'
---

# Pull Request Requirements

- Follow the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
- PR titles must follow Conventional Commits and use imperative mood.
- For the "Type of Change" section, select all applicable types based on the
  changes made. Do not delete the other options.
- Do not delete the comments in the PR template; replace the "None" placeholders
  with appropriate content.
- If the PR touches `lib/meshcore/`, the Description must list the affected
  commands and link to the relevant
  [Companion Protocol docs](https://docs.meshcore.io/companion_protocol/).
- All five checks must pass before requesting review: `npm run spell-check`,
  `npm run format:check`, `npm run lint`, `npm run type-check`, `npm run build`.
- Request review from `@kNoAPP`.
