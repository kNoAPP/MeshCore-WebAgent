# Brand

Original artwork for MeshCore Desktop. Every file is hand-built SVG, so it can
be edited and re-exported. None of it uses or imitates the MeshCore project's
own logo: this is an independent client.

## The mark

**Route**: a grid of mesh nodes and the path one message takes across it, from
the sender (bottom left) to the lit destination (top right).

- The mark has no text, so renaming the app never means redrawing it. The name
  appears only in the two lockups and the two social masters.
- It is drawn on a 64-unit grid with strokes and nodes thick enough to read at
  16 px.
- Colors come from the app palette in `app/globals.css`. The dark theme sits on
  `#0f1117`, and the light theme on white:

  | Role             | Dark theme | Light theme |
  | ---------------- | ---------- | ----------- |
  | Route and nodes  | `#4f8ef7`  | `#1d4ed8`   |
  | Idle grid nodes  | same, 35%  | same, 35%   |
  | Destination node | `#e2e8f0`  | `#0f1117`   |

## Files

| File               | Size     | Use                                                                                                                                                                                                                                                                                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mark.svg`         | 64×64    | Full-color mark on a transparent background, for favicons and other places that follow the viewer's theme. An embedded `prefers-color-scheme` style picks the palette from the viewer's OS setting, not from the page behind the image, so use a lockup or the app icon where the background is fixed. |
| `mark-mono.svg`    | 64×64    | One-color mark in `currentColor` (black when used as an image). Idle nodes are told apart by size instead of tint, so it survives single-color contexts.                                                                                                                                               |
| `lockup-dark.svg`  | 360×64   | The mark beside the name, for dark backgrounds. The name is live text, with "Core" in the accent to match the in-app `Wordmark`.                                                                                                                                                                       |
| `lockup-light.svg` | 360×64   | The same lockup for light backgrounds.                                                                                                                                                                                                                                                                 |
| `app-icon.svg`     | 512×512  | Square, full-bleed icon master with its own dark background. Source for the app icon PNGs, the maskable icon and the favicon. The mark stays inside the maskable safe zone, a centered circle 80% of the icon's width.                                                                                 |
| `social-card.svg`  | 1200×630 | Link-preview (Open Graph) master: the mark, the name, a tagline and a mesh motif. The text stays in the center, clear of the motif at the edges. Exported to `app/opengraph-image.png`, which Next.js serves as the page's Open Graph and X image.                                                     |
| `repo-social.svg`  | 1280×640 | GitHub repository social preview master, which also shows the `kn0.app` address.                                                                                                                                                                                                                       |
| `repo-social.png`  |          | Export of `repo-social.svg`, to upload under the repository's Settings → General → Social preview.                                                                                                                                                                                                     |

## Exporting

The PNGs are exported with [sharp](https://sharp.pixelplumbing.com/), which the
repository already installs through Next.js. From the repository root:

```bash
node -e "const s = require('sharp'); s('public/brand/social-card.svg').png({ compressionLevel: 9 }).toFile('app/opengraph-image.png'); s('public/brand/repo-social.svg').png({ compressionLevel: 9 }).toFile('public/brand/repo-social.png')"
```

The text is live, so it renders in whichever face the exporting machine has
first in the stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, …). The
committed PNGs were exported on Windows with Segoe UI. Export on the same
platform to keep them consistent.

## Renaming the app

Edit the `<text>` in both lockups, `social-card.svg` and `repo-social.svg`, then
re-export the two PNGs. The mark and the app icon don't change.
