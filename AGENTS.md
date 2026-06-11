# MeshCore-WebAgent — Agent Instructions

This is the canonical instruction set for all coding agents (Claude Code, GitHub Copilot,
and others). `CLAUDE.md` and `.github/copilot-instructions.md` defer to this file — make
instruction changes here only.

## New Sessions

Please explore this codebase and online documentation available for MeshCore:

- https://docs.meshcore.io
- https://github.com/meshcore-dev/MeshCore

Get prepared to work within the codebase and interact with MeshCore companion radios.

## Project Overview

Browser-based companion client for [MeshCore](https://github.com/meshcore-dev/MeshCore) LoRa
mesh radios. Fully client-side Next.js static site — no backend. Connects to companion radios
over USB Serial (Web Serial API), Bluetooth LE (Nordic UART service), or WiFi WebSocket.

Live at **[kn0.app](https://kn0.app)** · Deployed via GitHub Pages on each release.

## Stack

- **Next.js** (App Router, `output: 'export'`) + **React** + **TypeScript** (strict)
- **Tailwind CSS** for layout; CSS variables in `app/globals.css` for theming
- **Zustand** for global state (`store/meshStore.ts`)
- **Web Serial API**, **Web Bluetooth API**, **WebSocket** for hardware connectivity
- **IndexedDB** + AES-GCM for encrypted local message persistence (`lib/storage.ts`)

## Dev Commands

```bash
npm run dev           # start Next.js dev server at localhost:3000
npm run build         # static export → out/
npm run format        # format all files with Prettier
npm run format:check  # verify formatting (run in CI)
npm run lint          # ESLint
npm run type-check    # tsc --noEmit
npm run spell-check   # cspell
```

Run all checks before pushing. CI enforces all of them: spell-check, format check, lint,
type-check, build.

## Architecture

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

Core data flow: `MeshCoreClient` polls the radio every 5 seconds and fires callbacks →
`useMeshCore` bridges the client to the Zustand store → React components re-render from
store subscriptions.

## Agent Skills

Domain-specific instructions are in `.agents/skills/`. Read the relevant skill before
working in that area:

| Skill           | When to use                                |
| --------------- | ------------------------------------------ |
| `code-style`    | Writing or reviewing any source file       |
| `commits`       | Writing commit messages or naming branches |
| `deployment`    | Touching `next.config.ts` or CI workflows  |
| `protocol`      | Touching anything in `lib/meshcore/`       |
| `pull-requests` | Preparing or describing a pull request     |

## Key Conventions

- **No comments** unless the _why_ is non-obvious — well-named identifiers are enough
- **TypeScript strict mode** — no `any`, no `// @ts-ignore` without explanation
- **State changes go through Zustand actions** — not local component state
- **Tailwind for layout/spacing**, CSS variables for theming (`app/globals.css`)
- **No new abstractions** beyond what the immediate task requires — three similar lines is fine
- **Prettier formats on save** — config is in `.prettierrc`; run `npm run format` if needed

## Protocol Layer

The binary Companion Protocol is documented at
[docs.meshcore.io/companion_protocol](https://docs.meshcore.io/companion_protocol/). When
touching `lib/meshcore/`:

- Command and response bytes are in `constants.ts` (`CMD` / `RESP` const objects)
- USB/WiFi frame format: delimiter + 2-byte LE length + payload — `0x3C` inbound, `0x3E` outbound
- BLE has no frame delimiter: each GATT notification is one frame; outbound writes are
  chunked at 512 bytes
- Changes to the protocol layer need a PR description referencing the affected commands

## Deployment

GitHub Pages with custom domain `kn0.app`. The build uses `output: 'export'` in
`next.config.ts` and produces a static site in `out/`. Releases are managed by
release-please on `develop`: merging the release PR creates a GitHub release and triggers
the `deploy` workflow (callable manually via `workflow_dispatch`).

## What to Avoid

- Do not add a backend, authentication, or any server-side code — this is intentionally
  serverless
- Do not change `output: 'export'` (e.g. to `'standalone'`) — required for GitHub Pages
- Do not use `useEffect` for state that belongs in Zustand
- Do not import from `node:` built-ins — this runs in the browser
- Do not add error handling for scenarios that can't happen in the browser environment
