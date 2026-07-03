# MeshCore-WebAgent

A browser-based companion client for
[MeshCore](https://github.com/meshcore-dev/MeshCore) — a lightweight LoRa mesh
networking protocol for off-grid communication. Connect to your companion radio
over USB serial, Bluetooth LE, or WiFi, send messages across the mesh, map your
neighbors, and even run AI-powered mesh bots — all with no internet, cellular,
or backend infrastructure.

Live at **[kn0.app](https://kn0.app)**

<img width="1840" height="1103" alt="Screenshot 2026-07-03 at 10 39 11 AM" src="https://github.com/user-attachments/assets/e5fb2f4e-2e02-4057-916a-9562d08b062d" />

---

## Why MeshCore-WebAgent

- **Zero install, zero account** — Open a URL and you're talking to your radio.
  Nothing to download, no sign-up.
- **Truly private** — Everything runs in your browser. Message history,
  contacts, and API keys are encrypted at rest with AES-GCM and never leave your
  device.
- **Off-grid first** — Works entirely client-side, so once the page is loaded it
  keeps working without internet or cell service.
- **Batteries included** — Chat, contact and channel management, live maps,
  device stats, radio configuration, and an AI automation engine in one place.

## Features

### Messaging & contacts

- **Three transport modes** — USB Serial (Web Serial API), Bluetooth LE (Nordic
  UART), and WebSocket (WiFi)
- **Channels & direct messages** — Up to 8 named channels with 16-byte secrets
  and encrypted 1-to-1 DMs, with `@`-mention suggestions
- **Contact management** — Chat nodes, repeaters, and room servers with
  hop-distance tracking, favorites, and path reset
- **Add & discover contacts** — Import by `meshcore://` link, paste a public key
  manually, discover nodes from adverts, or import channels by link
- **Share your node** — Publish a self-contact QR code and shareable link so
  others can add you in one tap
- **Rich chat** — Date dividers, per-message copy, and persistent conversations

### Map & location

- **Live map view** — Leaflet with OpenStreetMap and Carto tiles plotting your
  contacts and adverts as colored shapes with a legend
- **Coordinates & distance** — See location and distance in contact and advert
  detail
- **Advertised location** — Set and share your own location with a map picker

### Radio control

- **Self-advertise** — Announce yourself to the mesh (flood or zero-hop)
- **Radio parameters** — View and edit region presets and radio settings
- **Device management** — Rename your node, reboot the device, and sync its
  clock on connect
- **Device stats** — Battery, RSSI/SNR, packet counters, uptime, and storage in
  a full-page dashboard

### AI automation & mesh bots (BYOK)

Turn your radio into a helpful, autonomous mesh bot — an auto-responder, a relay
assistant, a status announcer — driven by a large language model you control.

- **Bring your own key (BYOK)** — Connect your own Anthropic API key and run
  Claude models (Sonnet, Opus, Haiku). Your key is stored **per radio, encrypted
  at rest**, held only in memory for the tab's lifetime, and sent **directly
  from your browser to Anthropic** — never to any proxy or server.
- **Automation rules engine** — Build rules as `trigger → condition → action`.
  Fire on incoming direct or channel messages, adverts, ACKs, or connection
  events, optionally filtered by message content.
- **Fixed or prompt actions** — A `fixed` action runs a deterministic tool call
  with no LLM required; a `prompt` action runs an agentic LLM loop over a
  constrained, MCP-shaped tool set (read contacts, channels, messages, and
  stats; send DMs and channel messages; advertise; add, remove, and favorite
  contacts).
- **Strong guardrails** — Per-rule tool allowlists, LoRa airtime rate limiting,
  turn and token caps, a global kill switch, and an audit log keep automation
  safe on a shared, low-bandwidth mesh.
- **Human-in-the-loop** — Choose `approve` mode to stage every transmit/write
  for one-tap sign-off from a top-bar approvals inbox, or `auto` mode for
  hands-off operation (still rate-limited and stoppable).

### Everywhere else

- **Command palette** — A global "Find Anything" search across contacts,
  channels, messages, automation rules, and actions
- **Multi-language UI** — English, Spanish, German, and French, auto-detected
  from the browser and switchable on the connect screen
- **Persistent history** — Messages stored in IndexedDB with AES-GCM encryption,
  restored on reconnect
- **Fully client-side** — No server, no account, no cloud; everything runs in
  your browser

## Browser Requirements

Web Serial and Web Bluetooth are Chromium-only APIs. Use **Chrome** or **Edge**
(desktop). Firefox and Safari are not supported.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- A [MeshCore companion radio](https://github.com/meshcore-dev/MeshCore) flashed
  with companion firmware
- _(Optional)_ An [Anthropic API key](https://console.anthropic.com/) to enable
  the AI automation features

### Local Development

```bash
git clone https://github.com/kNoAPP/MeshCore-WebAgent.git
cd MeshCore-WebAgent
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build   # outputs static site to out/
```

The build produces a fully static site in `out/` that can be served from any
static host (GitHub Pages, S3, Cloudflare Pages, nginx, etc.).

## Deployment

The live site at [kn0.app](https://kn0.app) deploys automatically from `main`
via GitHub Pages. To deploy your own fork:

1. Enable GitHub Pages in your repo settings (source: GitHub Actions)
2. Point your DNS to GitHub Pages and configure your custom domain
3. Push to `main` — the `deploy` workflow handles the rest

## Project Structure

```
app/              Next.js App Router entry points
components/       React UI components
hooks/            useMeshCore, useAutomation, useAdvertise, and more
lib/
  meshcore/       Binary protocol implementation (client, transports, parsers)
  ai/             LLM provider abstraction, automation engine, tools, secrets
  map/            Leaflet map config, markers, and node plotting
  i18n/           react-i18next setup (config + instance)
  search/         Command palette search index
  storage.ts      IndexedDB persistence with AES-GCM encryption
locales/          Per-language UI dictionaries (en, es, de, fr)
store/            Zustand global state
types/            TypeScript interfaces
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch
conventions, and the PR process.

## Security

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal,
educational, and non-commercial use. Commercial use requires explicit permission
from the author.
