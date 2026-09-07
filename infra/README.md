# infra

Container build + production deployment for **rust-stats-scraper**.

```
infra/
  Dockerfile        # multi-stage, non-root, Playwright runtime
  prod/compose.yml  # production stack (Homepage + proxy-control labels)
```

## Image

Multi-stage build:

1. **builder** (`node:22`) — `npm ci` + `tsc` → `dist/`.
2. **deps** (`node:22`) — production-only `node_modules` (browsers skipped).
3. **runtime** (`mcr.microsoft.com/playwright:v1.63.0-jammy`) — ships only
   `dist/`, prod deps and `public/`; runs as the non-root `pwuser`. The base image
   already contains Chromium + all system libraries, and its tag is pinned to the
   installed Playwright version so the browser matches.

Build from the repo root:

```bash
docker build -f infra/Dockerfile -t negrii/rust-stats-scraper:latest .
```

Hardening: non-root user, `NODE_ENV=production`, prod-only deps, `no-new-privileges`,
pinned base image, a browser-free `HEALTHCHECK`, and Chromium launched with
`--no-sandbox --disable-dev-shm-usage` for containers.

## Deploy

```bash
docker compose -f infra/prod/compose.yml up -d      # pull/run
docker compose -f infra/prod/compose.yml build      # or build locally
```

- **Private domain:** `rust-stats.negri.es` (via `proxy-control.*` labels,
  `visibility=private`, forwarding to `rust-stats:3200`).
- **Homepage:** `homepage.*` labels register the app + a customapi widget backed by
  `GET /api/widget` (`status`, `trackers`, `snapshots`, `running`).
- **Persistence:** the `rust-stats-data` volume holds `data/trackers/*.json`.
- **Timezone:** `TZ=Europe/Madrid` — the daily snapshot boundary is *local* midnight,
  so set this to wherever "midnight" should be.
- **Auto-update:** `com.centurylinklabs.watchtower.enable=true`.

## Raspberry Pi 5 / ARM64

The Pi 5 is `linux/arm64`. This is handled, with two things to know:

- **Bundled Chromium, not Chrome.** Google ships no Chrome channel for Linux ARM64,
  so the container sets `BROWSER_CHANNEL=chromium` and drives Playwright's bundled
  Chromium (built for arm64 inside the multi-arch Playwright image). No system Chrome
  is installed or needed.
- **Build architecture.** Building **on the Pi** is native arm64 — nothing special:
  ```bash
  docker compose -f infra/prod/compose.yml build
  ```
  Building **from an x86 machine** for the Pi needs buildx:
  ```bash
  docker buildx build --platform linux/arm64 -f infra/Dockerfile \
    -t negrii/rust-stats-scraper:latest --push .
  ```

The `mcr.microsoft.com/playwright:v1.63.0-jammy` base is multi-arch, so `pull`/`build`
resolve the arm64 variant automatically. 16 GB RAM is ample; a full 12-tab snapshot
runs one headless Chromium at a time (`--disable-dev-shm-usage`, `shm_size: 1gb`).

### Notes

- `rust-stats-net` is a local network; the proxy-control tooling wires the reverse
  proxy to it from the labels. Adjust/extend `networks:` if your setup shares an
  external proxy network instead.
- No database or external services are required — state is a JSON file volume.
