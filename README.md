# MeshCore-WebAgent

A browser-based companion client for
[MeshCore](https://github.com/meshcore-dev/MeshCore) — a lightweight LoRa mesh
networking protocol for off-grid communication. Connect to your companion radio
over USB serial, Bluetooth LE, or WiFi and send messages across the mesh without
any internet or cellular infrastructure.

Live at **[kn0.app](https://kn0.app)**

<img width="1840" height="1103" alt="Screenshot 2026-07-03 at 10 28 51 AM" src="https://github.com/user-attachments/assets/72033a4d-c16b-41d3-abd2-ed4ee51b9f66" />

---

## Features

- **Three transport modes** — USB Serial (Web Serial API), Bluetooth LE (Nordic
  UART), WebSocket (WiFi)
- **Channels & direct messages** — Up to 8 named channels with 16-byte secrets;
  encrypted 1-to-1 DMs
- **Contact management** — Chat nodes, repeaters, and room servers with
  hop-distance tracking and favorites
- **Device stats** — Battery, RSSI/SNR, packet counters, uptime, and storage at
  a glance
- **Persistent history** — Messages stored in IndexedDB with AES-GCM encryption,
  restored on reconnect
- **Multi-language UI** — English, Spanish, German, and French, auto-detected
  from the browser and switchable on the connect screen
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
hooks/            useMeshCore — device communication hook
lib/
  meshcore/       Binary protocol implementation (client, transports, parsers)
  storage.ts      IndexedDB persistence with AES-GCM encryption
  i18n/           react-i18next setup (config + instance)
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
