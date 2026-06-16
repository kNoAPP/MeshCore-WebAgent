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
---

# Security Policy

## Supported Versions

Only the latest release on `main` receives security fixes.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report them privately via
[GitHub Security Advisories](https://github.com/kNoAPP/MeshCore-WebAgent/security/advisories/new)
or by emailing the maintainer directly (contact via GitHub profile).

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations

You can expect an acknowledgement within 72 hours and a resolution timeline
within 14 days for confirmed issues.

## Scope

This project is a **fully client-side** web application. There is no backend
server, no authentication system, and no stored credentials beyond what the
browser's IndexedDB holds locally. The primary security surface is:

- AES-GCM encryption of locally stored message history (`lib/storage.ts`)
- Web Serial / Web Bluetooth permission handling in the browser
- Content Security Policy of the deployed static site

Out-of-scope: vulnerabilities in the MeshCore firmware or radio hardware itself
— report those to the
[MeshCore project](https://github.com/meshcore-dev/MeshCore).
