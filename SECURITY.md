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
