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

name: pull-requests
description: >
  Pull request conventions and requirements. Use when creating a pull request,
  writing a PR description, preparing changes for review, or referencing the PR
  template.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# Pull Request Requirements

- Follow the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
- PR titles must follow Conventional Commits and use imperative mood.
- For the "Type of Change" section, select all applicable types based on the changes made. Do not delete the other options.
- Do not delete the comments in the PR template; replace the "None" placeholders with appropriate content.
- If the PR touches `lib/meshcore/`, fill out the "Protocol Changes" section with the affected commands and a link to the relevant [Companion Protocol docs](https://docs.meshcore.io/companion_protocol/).
- All four checks must pass before requesting review: `npm run lint`, `npm run type-check`, `npm run spell-check`, `npm run build`.
- Request review from `@kNoAPP`.
