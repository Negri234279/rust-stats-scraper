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
3. **Provider scrape** — Playwright opens the provider (Moose), selects
   `server / week / tab`, and for each player searches the grid **by SteamID64**
   and extracts their row. Moose's search matches SteamID64 directly and the
   Steam display name is read straight from the result row, so **no separate
   Steam-name resolution (and no `STEAM_API_KEY`) is needed**. Lives in
   `src/providers/<name>/`.
4. **UI** — the Express server returns the aggregated rows; the frontend renders
   the resources table with `SteamName (alias)` and sortable columns. Lives in
   `src/server.ts` + `public/`.

`src/steam/resolver.ts` (SteamID64 → name via the Steam Web API) is kept for a
future provider that can only search by name; it is **not** used by the Moose flow.

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
`src/providers/index.ts`. **No changes to the server code.**

A provider is responsible for: opening its site, listing available servers/weeks/tabs
(where practical), and given the input players (alias + SteamID64), returning one
`StatRow` per player for the requested tab — finding each however works best for
that site (Moose searches by SteamID64 and reads the name from the result row).

## Conventions

- TypeScript, ESM (`"type": "module"`), run with `tsx` in dev.
- Providers take the raw input players (alias + SteamID64) and decide how to locate
  them. Prefer SteamID64 search where the site supports it (Moose does) — it needs
  no name resolution and is unambiguous.
- Never commit `.env`.

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
- **Finding a player**: type the **SteamID64** into the grid's
  `input[placeholder="Search..."]`. Moose matches SteamID64 directly and returns
  exactly one row; the Steam display name is that row's Player cell. Gotchas the
  provider handles: clear the box before each query (otherwise the grid lags one
  query behind); no match renders a single-cell placeholder row `No items to
  display.` → reported as `found: false`.
- **Browser**: launches the system Chrome via `channel: "chrome"` (the bundled
  Chromium download was unavailable here), falling back to bundled Chromium.

`scripts/test-moose.mts` is a manual integration check that hits the live site
without needing a Steam key (`npx tsx scripts/test-moose.mts`).

## Commands

```
npm install
# Uses the system Chrome via channel:"chrome". If you'd rather use Playwright's
# bundled browser, run: npx playwright install chromium
npm run dev                       # start server on http://localhost:3200
```

No `.env` is required to run — the defaults work. Copy `.env.example` to `.env`
only to override `PORT`/`HEADLESS` (or set a Steam key for a future name-search
provider).

## Status / TODO

- [x] Moose provider verified end-to-end against the live site (server → time →
      Resources tab → per-player search by SteamID64 → row extraction).
- [x] Server / week / tab are read live from the site (`listFilters` + `listWeeks`,
      exposed at `/api/filters` and `/api/weeks`) and drive cascading UI dropdowns.
- [x] Runs with no Steam API key — Moose is searched by SteamID64 directly.
- [ ] Cache the live filter reads (each currently opens its own browser, ~15s).
- [ ] Additional providers (RustyClash / Rustopia / …).
