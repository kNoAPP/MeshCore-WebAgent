# MeshCore-WebAgent — Agent Instructions

## Project Overview

Browser-based companion client for [MeshCore](https://github.com/meshcore-dev/MeshCore) LoRa
mesh radios. Fully client-side Next.js static site — no backend. Connects to companion radios
over USB Serial (Web Serial API), Bluetooth LE (Nordic UART service), or WiFi WebSocket.

Live at **[kn0.app](https://kn0.app)** · Deployed via GitHub Pages from `main`.

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

Run all checks before pushing — CI enforces all of them in this order: format, lint,
type-check, spell-check, build.

## Architecture

```
app/              Next.js App Router entry (page.tsx → AppShell)
components/       React UI (AppShell, Header, Sidebar, ChatArea, ConnectPanel, ...)
hooks/
  useMeshCore.ts  Wires MeshCoreClient ↔ Zustand store ↔ localStorage persistence
lib/
  meshcore/
    client.ts     MeshCoreClient — command/response protocol, 5s polling loop
    transports.ts USB / BLE / WiFi transport implementations (ITransport interface)
    frames.ts     Binary command encoding
    frameParser.ts 0x3C-delimited frame parsing (USB + WiFi)
    parsers.ts    Binary response decoding → typed objects
    constants.ts  CMD/RESP codes, BLE UUIDs
  storage.ts      localStorage with AES-GCM encryption (key derived from channel secret + pubkey)
store/
  meshStore.ts    Zustand store — connection state, contacts, channels, messages, UI state
types/
  meshcore.ts     Shared TypeScript interfaces (Contact, Channel, Message, ...)
```

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
- **No new abstractions** beyond what the immediate task requires
- **Prettier formats on save** — config is in `.prettierrc`; run `npm run format` if needed

## Protocol Layer

The binary Companion Protocol is documented at
[docs.meshcore.io/companion_protocol](https://docs.meshcore.io/companion_protocol/). When
touching `lib/meshcore/`:

- Command bytes are in `constants.ts` (`CMD_*` / `RESP_*`)
- Frame format: `0x3C` delimiter + 2-byte length + payload
- BLE MTU is 23 bytes by default; larger frames require negotiated MTU
- Changes to the protocol layer need a PR description referencing the affected commands

## Deployment

GitHub Pages with custom domain `kn0.app`. The build uses `output: 'export'` in
`next.config.ts` and produces a static site in `out/`. Push to `main` triggers the `deploy`
workflow automatically.

## What to Avoid

- Do not add a backend, authentication, or any server-side code — this is intentionally
  serverless
- Do not use `useEffect` for state that belongs in Zustand
- Do not import from `node:` built-ins — this runs in the browser
- Do not add error handling for scenarios that can't happen in the browser environment
