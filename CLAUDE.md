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
   (e.g. `--User`). Entries with other prefixes (e.g. `**Pelos`) are dropped.
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
      index.ts           # Moose provider (Playwright): scrape() + snapshot()
  trackers/
    types.ts             # Tracker, Snapshot, SnapshotPlayer
    store.ts             # JSON persistence (data/trackers/<id>.json)
    analytics.ts         # listStats() + computeSeries() (daily deltas)
    snapshotRunner.ts    # takeSnapshot() with a global one-at-a-time lock
    scheduler.ts         # background cron: snapshot due trackers
  server.ts              # Express: static UI + /api endpoints
public/                  # vanilla HTML/CSS/JS frontend (index + trackers pages)
data/                    # sample alias JSON input; trackers/ (runtime, gitignored)
```

## The provider contract

Adding **RustyClash / Rustopia / etc.** means one new folder under `src/providers/`
that implements `StatProvider` (see `src/providers/types.ts`) and registering it in
`src/providers/index.ts`. **No changes to the server code.**

A provider is responsible for: opening its site, listing available servers/weeks/tabs
(where practical), and given the input players (alias + SteamID64), returning one
`StatRow` per player for the requested tab — finding each however works best for
that site (Moose searches by SteamID64 and reads the name from the result row).

## Wipe trackers (time-series)

A tracker follows one **company** across a **wipe** (server + week window) and
records **all Moose tabs** in periodic snapshots, so you can see totals and
**daily production** (day-over-day deltas).

- **Model** (`src/trackers/types.ts`): a `Tracker` has name, company, server,
  week, `tabs[]`, start/end dates, `intervalHours`, players, and a list of
  `Snapshot`s. Each snapshot is `SnapshotPlayer[]` with `stats[tab][column]`.
- **Storage** (`src/trackers/store.ts`): one JSON file per tracker under
  `data/trackers/<id>.json` (gitignored — runtime data).
- **Capture** (`providers/moose` `snapshot()`): players are **sharded across
  several parallel browser contexts** (`forEachShard`, default 4 — see
  `SCRAPER_CONCURRENCY`). Each context selects server+week once, then loops
  tab → its slice of players, searching each by SteamID64. Only the per-player
  searches parallelize; the tab walk is replicated in every context, and the
  ~16s startup (page load + server/week select) is paid once per context in
  parallel. Net: a 49-player, 12-tab snapshot drops from ~25-30 min to ~6-7 min.
  Still background work, so slowness is fine. `scrape()` shards the same way.
- **Scheduler** (`src/trackers/scheduler.ts`): started in `server.ts` on listen.
  It checks every 10 min and takes **one snapshot per local calendar day** — a
  tracker is due when its last snapshot falls on an earlier local day (day
  boundary = local midnight), so the first tick after midnight captures the new
  day. Robust to downtime (a missed midnight just snapshots on the next tick). A
  global lock (`snapshotRunner.ts`) ensures only one snapshot runs at a time.
  Creating a tracker fires one initial snapshot in the background (that counts as
  the current day's). `intervalHours` is retained on the model for backward
  compat but no longer drives scheduling.
- **Analytics** (`src/trackers/analytics.ts`): `computeSeries(tracker, tab, col)`
  groups snapshots by local day (last snapshot per day) and returns, for the
  company total and each player, per-day `{ cum, delta }`. First day's delta is
  its full value (baseline from 0); an unchanged day yields delta 0.
  `computeTabSeries(tracker, tab)` returns the same for **every column of a tab**
  at once — the detail UI shows the whole tab (columns = stats) for a chosen day,
  not one stat at a time.
  `endDate` is optional (empty = open-ended wipe); set/clear it later from the
  detail view (`PATCH /api/trackers/:id`). The scheduler treats an empty
  `endDate` as no upper bound.
- **Live progress** (`src/trackers/events.ts`): every snapshot — initial, manual,
  or scheduled — broadcasts `start`/`progress`/`done`/`error` on an event bus.
  `GET /api/trackers/events` is an **SSE** stream of these; the trackers page keeps
  an `EventSource` open and shows a global progress banner for whichever snapshot
  is running (catches up mid-run via `currentSnapshot()`), and a corner toast on
  each `done`/`error` (even for background runs with no detail open). The manual
  snapshot endpoint is fire-and-forget (202); progress comes over SSE, not the
  response.
  NB: the SSE route must be registered **before** `/api/trackers/:id` or it's
  shadowed as `id="events"`.
- **API**: `GET/POST /api/trackers`, `GET/PATCH/DELETE /api/trackers/:id`,
  `GET /api/trackers/events` (SSE), `GET /api/trackers/:id/series?tab=&column=`,
  `GET /api/trackers/:id/tab-series?tab=`, and
  `POST /api/trackers/:id/snapshot` (fire-and-forget, 202). UI at
  `public/trackers.html` + `trackers.js`: pick Tab + Día, Δ-diario / Acumulado.

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
- **Waiting on the SPA**: the grid re-renders over the Blazor WebSocket, so
  `networkidle` doesn't help. Tab switches and searches wait via `waitSettled`,
  which polls a cheap grid *signature* (visible row count + first row text) and
  proceeds once it has **changed from the pre-action state and held steady** for
  two polls. This adapts to load (parallel contexts just wait a little longer)
  and is what makes trimming the old fixed `waitForTimeout`s safe — a plain
  row-count check is too weak because the previous tab/search also has rows.
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
- [x] Wipe trackers: scheduled all-tab snapshots + daily production deltas
      (total + per player), verified end-to-end.
- [x] Cache the filter/week reads (`src/cache.ts`, TTL `FILTERS_CACHE_TTL_HOURS`,
      default 24h, with in-flight dedupe). Bust via `POST /api/cache/clear`.
      Cold ~15s → cached ~20ms.
- [x] Speed up snapshots: shard players across parallel browser contexts
      (`SCRAPER_CONCURRENCY`, default 4) + adaptive `waitSettled` instead of fixed
      sleeps. ~25-30 min → ~6-7 min for a 49-player, 12-tab snapshot.
- [ ] Further snapshot speedup: per-player search is still O(tabs×players).
      Reading full tab pages once would be O(tabs) but Moose's grid exposes no
      SteamID column to map rows back to input players — blocked unless a hidden
      per-row id is found.
- [ ] Additional providers (RustyClash / Rustopia / …).
