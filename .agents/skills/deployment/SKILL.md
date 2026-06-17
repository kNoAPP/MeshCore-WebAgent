---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)

name: deployment
description: >
  Build and deployment process for the live site at kn0.app. Use when working on
  next.config.ts, GitHub Actions workflows, or anything that affects the
  production build or deployment pipeline.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# Deployment

The live site is hosted at **[kn0.app](https://kn0.app)** via GitHub Pages.

## How It Works

1. Every push to `develop` runs `.github/workflows/release_please.yaml`, which
   maintains a release PR.
2. Merging that release PR creates a GitHub release, and the workflow then calls
   `.github/workflows/deploy.yaml` (reusable via `workflow_call`; also runnable
   manually with `workflow_dispatch`). Deploys must run in a `push`-to-`develop`
   context — the `github-pages` environment protection rules reject any other
   ref, including `refs/pull/N/merge`.
3. The workflow runs `npm run build`, which produces a static site in `out/`
   (configured via `output: 'export'` in `next.config.ts`).
4. The `out/` directory is uploaded as a GitHub Pages artifact and deployed, and
   a zip of the build is attached to the GitHub release.
5. `public/CNAME` contains `kn0.app` — GitHub Pages uses this for the custom
   domain.

## Critical Constraints

- `next.config.ts` must keep `output: 'export'` and `trailingSlash: true` —
  changing either will break the GitHub Pages deployment.
- Do not add any Next.js features that require a server (API routes, middleware,
  ISR, SSR) — the entire site is statically exported.
- Do not remove `public/CNAME` — it is required for the custom domain to work
  after every deploy.

## Local Build Verification

```bash
npm run build     # produces out/
npx serve out     # serve locally to verify before pushing
```

## GitHub Pages Setup (one-time)

In the repository settings → Pages:

- Source: **GitHub Actions**
- Custom domain: `kn0.app`
- Enforce HTTPS: enabled
