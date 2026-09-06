# CLAUDE.md

Guidance for working in this repo.

## What this is

Cross-provider scraper for **Rust game-server stat sites**, with a small web UI to
view the results. You give it a list of SteamID64s; it resolves each to a Steam
persona name, drives the target stat site with a real browser, and pulls that
player's row from a given **server / week / tab**.

The first bundled provider is **Moose** (`moose.gg/stats`). The UI currently
focuses on the **resources** tab.

## Why a real browser (Playwright)

Most of these stat sites are Blazor Server / SPAs where filters and tabs are driven
over a WebSocket / hidden state, not URL parameters. A plain HTTP fetch returns an
empty shell — you need a real browser to trigger the state changes and read the
rendered table.

## End-to-end flow

1. **Input** — a JSON list of `{ alias, steamId }` objects (see `data/` for a sample).
2. **Alias filter** — keep only entries whose `alias` starts with `--`
   (e.g. `--Vaga`). Entries with other prefixes (e.g. `**Pelos`) are dropped.
   Lives in `src/steam/aliasFilter.ts`.
3. **Steam resolve** — each surviving SteamID64 → Steam persona name via the
   official **Steam Web API** (`ISteamUser/GetPlayerSummaries`). Needs
   `STEAM_API_KEY`. Lives in `src/steam/resolver.ts`.
4. **Provider scrape** — Playwright opens the provider (Moose), selects
   `server / week / tab`, and for each persona name filters the table and extracts
   that player's row. Lives in `src/providers/<name>/`.
5. **UI** — the Express server returns the aggregated rows; the frontend renders
   the resources table. Lives in `src/server.ts` + `public/`.

## Layout

```
src/
  config.ts              # env loading (STEAM_API_KEY, PORT, HEADLESS)
  types.ts               # shared types (PlayerInput, ResolvedPlayer, StatRow, ScrapeQuery)
  steam/
    aliasFilter.ts       # keep aliases starting with "--"
    resolver.ts          # SteamID64 -> persona name via Steam Web API
  providers/
    types.ts             # StatProvider interface — the contract every provider implements
    index.ts             # provider registry (name -> provider)
    moose/
      index.ts           # Moose provider (Playwright)
  server.ts              # Express: static UI + /api endpoints
public/                  # vanilla HTML/CSS/JS frontend
data/                    # sample alias JSON input
```

## The provider contract

Adding **RustyClash / Rustopia / etc.** means one new folder under `src/providers/`
that implements `StatProvider` (see `src/providers/types.ts`) and registering it in
`src/providers/index.ts`. **No changes to the CLI, server, or Steam-resolver code.**

A provider is responsible for: opening its site, listing available servers/weeks/tabs
(where practical), and given a set of persona names, returning one `StatRow` per
player for the requested tab.

## Conventions

- TypeScript, ESM (`"type": "module"`), run with `tsx` in dev.
- Keep Steam-resolution and provider-scraping decoupled — providers take **persona
  names**, never Steam IDs, so the resolver can be swapped independently.
- Never commit `.env`. `STEAM_API_KEY` is a secret.

## Moose facts (verified against the live site, 2026-09-06)

Moose is a **Radzen** Blazor app (`rz-*` classes). The provider drives these:

- **Server & time** are Radzen dropdowns (`.rz-dropdown` with a `.rz-dropdown-label`).
  The DOM has hidden responsive duplicates, so the provider only touches
  `visible=true` ones: index 0 = server, index 1 = time. The **time dropdown is
  disabled until a server is selected**, and its options are per-server.
- **Time options are timestamps** in `MM/DD/YYYY HH:mm:ss`, e.g.
  `09/03/2026 18:00:00` (each = one weekly wipe). Pass this exact string as `week`.
- **Tabs** are `button[role="tab"]` with text like `Resources`, `PvP`, `Farming`…
- **Table** is `table.rz-grid-table`; the **Resources** columns are:
  `Player, Wood, Stone, Metal Ore, Sulfur Ore, HQM Ore, Diesel Collected`.
- **Finding a player**: type into the grid's `input[placeholder="Search..."]`.
  Gotchas the provider handles: clear the box before each query (otherwise the grid
  lags one query behind); Moose **ignores queries shorter than 3 chars**; no match
  renders a single-cell placeholder row `No items to display.`. The provider requires
  an exact (case-insensitive) Player match and returns `found: false` rather than a
  wrong row.
- **Browser**: launches the system Chrome via `channel: "chrome"` (the bundled
  Chromium download was unavailable here), falling back to bundled Chromium.

`scripts/test-moose.mts` is a manual integration check that hits the live site
without needing a Steam key (`npx tsx scripts/test-moose.mts`).

## Commands

```
npm install
npx playwright install chromium   # one-time, downloads the browser
cp .env.example .env              # then fill in STEAM_API_KEY
npm run dev                       # start server on http://localhost:3000
```

## Status / TODO

- [x] Moose provider verified end-to-end against the live site (server → time →
      Resources tab → per-player search → row extraction).
- [ ] Wire the real Steam resolver end-to-end (needs `STEAM_API_KEY`).
- [ ] Populate server/week UI inputs from the live dropdowns instead of free text.
- [ ] Additional tabs beyond Resources (PvP, Farming, …) — same grid, just another tab.
- [ ] Additional providers (RustyClash / Rustopia / …).
