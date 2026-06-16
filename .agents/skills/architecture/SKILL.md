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

name: architecture
description: >
  Project stack, module layout, and core data flow. Use when navigating the
  codebase, locating where functionality lives, or understanding how the client,
  Zustand store, and persistence layers connect.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# Architecture

Browser-based companion client for
[MeshCore](https://github.com/meshcore-dev/MeshCore) LoRa mesh radios. Fully
client-side Next.js static site — no backend. Connects to companion radios over
USB Serial (Web Serial API), Bluetooth LE (Nordic UART service), or WiFi
WebSocket.

## Stack

- **Next.js** (App Router, `output: 'export'`) + **React** + **TypeScript**
  (strict)
- **Tailwind CSS** for layout; CSS variables in `app/globals.css` for theming
- **Zustand** for global state (`store/meshStore.ts`)
- **Web Serial API**, **Web Bluetooth API**, **WebSocket** for hardware
  connectivity
- **IndexedDB** + AES-GCM for encrypted local message persistence
  (`lib/storage.ts`)

## Module Layout

```
app/              Next.js App Router entry (page.tsx → AppShell)
components/       React UI (AppShell, Header, Sidebar, ChatArea, ConnectPanel, ...)
hooks/
  useMeshCore.ts  Wires MeshCoreClient ↔ Zustand store ↔ IndexedDB persistence
lib/
  meshcore/
    client.ts     MeshCoreClient — command/response protocol, 5s polling loop
    transports.ts USB / BLE / WiFi transport implementations (ITransport interface)
    frames.ts     Binary command encoding
    frameParser.ts Inbound 0x3C-delimited frame parsing (USB + WiFi)
    parsers.ts    Binary response decoding → typed objects
    constants.ts  CMD/RESP codes, BLE UUIDs
  storage.ts      IndexedDB with AES-GCM encryption (key derived from channel secret + pubkey)
store/
  meshStore.ts    Zustand store — connection state, contacts, channels, messages, UI state
types/
  meshcore.ts     Shared TypeScript interfaces (Contact, Channel, Message, ...)
```

## Core Data Flow

`MeshCoreClient` polls the radio every 5 seconds and fires callbacks →
`useMeshCore` bridges the client to the Zustand store → React components
re-render from store subscriptions.

State changes go through Zustand actions in `store/meshStore.ts` — never local
component state for data that belongs in the store, and never `useEffect` for
state that belongs in Zustand.
