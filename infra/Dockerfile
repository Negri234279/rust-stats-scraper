# syntax=docker/dockerfile:1

# =============================================================================
# rust-stats-scraper — multi-stage, production image
#
#   builder : install all deps + compile TypeScript -> dist/
#   deps    : install production-only node_modules (no browsers)
#   runtime : Playwright base image (Chromium + system deps preinstalled),
#             runs as the non-root `pwuser`, only ships dist + prod deps.
#
# Build from the repo root:
#   docker build -f infra/Dockerfile -t negrii/rust-stats-scraper:latest .
# =============================================================================

# ---- builder: compile TS -> dist -------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- deps: production-only node_modules ------------------------------------
FROM node:22-bookworm-slim AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime: Playwright image (browser + deps already inside) -------------
# Pin the tag to the installed Playwright version so the bundled Chromium matches.
# Multi-arch: this pulls the linux/arm64 variant automatically on a Raspberry Pi.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy AS runtime

# Image metadata — the "unknown" defaults are overridden by CI/CD via --build-arg
# (e.g. --build-arg VERSION=$(git describe --tags) --build-arg VCS_REF=$(git rev-parse --short HEAD)
#  --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)).
ARG VERSION="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"
ARG DESCRIPTION="Cross-provider scraper for Rust game-server stat sites, with a web UI to view results"

LABEL org.opencontainers.image.title="rust-stats-scraper" \
      org.opencontainers.image.description="${DESCRIPTION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="" \
      org.opencontainers.image.licenses=""

ENV NODE_ENV=production \
    PORT=3200 \
    HEADLESS=true \
    BROWSER_CHANNEL=chromium
WORKDIR /app

# Only the runtime artefacts — no source, no dev deps, no build tools.
COPY --chown=pwuser:pwuser --from=deps    /app/node_modules ./node_modules
COPY --chown=pwuser:pwuser --from=builder /app/dist         ./dist
COPY --chown=pwuser:pwuser package.json ./
COPY --chown=pwuser:pwuser public ./public

# Persisted trackers live here (mount a volume at /app/data).
RUN mkdir -p /app/data/trackers && chown -R pwuser:pwuser /app/data

USER pwuser
EXPOSE 3200

# Cheap liveness probe that never launches a browser.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/api/providers').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
