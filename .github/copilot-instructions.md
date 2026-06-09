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

# GitHub Copilot Instructions — MeshCore-WebAgent

## What This Project Is

Fully client-side Next.js static web app for communicating with [MeshCore](https://github.com/meshcore-dev/MeshCore) LoRa companion radios. No backend, no auth, no server-side code. Deployed to GitHub Pages at kn0.app.

## Stack

- **Next.js 15** (App Router, `output: 'export'`) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS 4** for layout; CSS variables in `app/globals.css` for theming
- **Zustand** for global state (`store/meshStore.ts`)
- **Web Serial API**, **Web Bluetooth API**, **WebSocket** for hardware connectivity
- **IndexedDB** + AES-GCM for encrypted local message persistence (`lib/storage.ts`)

## Architecture

The core data flow: `MeshCoreClient` (`lib/meshcore/client.ts`) polls the radio every 5 seconds and fires callbacks → `useMeshCore` hook (`hooks/useMeshCore.ts`) bridges the client to the Zustand store → React components re-render from store subscriptions.

Transport is abstracted behind `ITransport` in `lib/meshcore/transports.ts`. Three implementations: USB Serial, BLE (Nordic UART), WebSocket.

## Code Style

- No comments unless the _why_ is non-obvious
- No `any`, no `// @ts-ignore` without explanation
- No abstractions beyond the immediate task — three similar lines is fine
- State changes go through Zustand store actions
- Tailwind for layout/spacing, CSS variables for colors/theming
- No `useEffect` for state that belongs in Zustand

## Protocol

Binary Companion Protocol over serial/BLE/WebSocket. Command/response codes in `lib/meshcore/constants.ts`. Full spec: https://docs.meshcore.io/companion_protocol/

## Do Not

- Add backend, server-side rendering, or API routes
- Import `node:` built-ins (browser only)
- Use `output: 'standalone'` — must stay `'export'` for GitHub Pages
