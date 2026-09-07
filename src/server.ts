import express from "express";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { TtlCache } from "./cache.js";
import { filterAliases } from "./steam/aliasFilter.js";
import { getProvider, listProviders } from "./providers/index.js";
import type { PlayerInput, ScrapeQuery } from "./types.js";
import {
  createTracker,
  deleteTracker,
  getTracker,
  listTrackers,
  updateTracker,
} from "./trackers/store.js";
import { toSummary, type TrackerPlayer } from "./trackers/types.js";
import { computeSeries, computeTabSeries, listStats } from "./trackers/analytics.js";
import {
  isSnapshotRunning,
  takeSnapshot,
} from "./trackers/snapshotRunner.js";
import { currentSnapshot, onSnapshot } from "./trackers/events.js";
import { startScheduler } from "./trackers/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// App version, read once from package.json (copied next to dist/ in the image).
const appVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

/** List available providers for the UI dropdown. */
app.get("/api/providers", (_req, res) => {
  res.json(listProviders());
});

/** App version (from package.json) for the UI footer. */
app.get("/api/version", (_req, res) => {
  res.json({ version: appVersion });
});

/** Compact status for the Homepage dashboard customapi widget. */
app.get("/api/widget", async (_req, res) => {
  try {
    const trackers = await listTrackers();
    const snapshots = trackers.reduce((n, t) => n + t.snapshots.length, 0);
    res.json({
      status: isSnapshotRunning() ? "Snapshot…" : "OK",
      trackers: trackers.length,
      snapshots,
      running: isSnapshotRunning() ? "Sí" : "No",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Server/tab/week lists barely change, so cache them (with in-flight dedupe) to
// avoid relaunching a browser on every request.
const filtersCache = new TtlCache();
const CACHE_TTL_MS = config.filtersCacheTtlHours * 60 * 60 * 1000;

/** Server + tab options for a provider (cached). Drives the UI dropdowns. */
app.get("/api/filters", async (req, res) => {
  try {
    const provider = String(req.query.provider ?? "");
    const filters = await filtersCache.get(`filters:${provider}`, CACHE_TTL_MS, () =>
      getProvider(provider).listFilters()
    );
    res.json(filters);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Week options for a given provider + server (cached; cascades from server). */
app.get("/api/weeks", async (req, res) => {
  try {
    const provider = String(req.query.provider ?? "");
    const server = String(req.query.server ?? "");
    if (!server) return res.status(400).json({ error: "Missing server." });
    const weeks = await filtersCache.get(`weeks:${provider}:${server}`, CACHE_TTL_MS, () =>
      getProvider(provider).listWeeks(server)
    );
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Force-refresh the cached filter/week lists (they rarely change). */
app.post("/api/cache/clear", (_req, res) => {
  filtersCache.clear();
  res.json({ ok: true });
});

/**
 * Main endpoint. Body:
 *   {
 *     players: [{ alias, steamId }, ...],
 *     provider: "moose", server: "...", week: "...", tab: "resources"
 *   }
 * Filters aliases (`--` prefix), then streams NDJSON progress as it scrapes:
 *   {"type":"start","total":N,"query":{...}}
 *   {"type":"row","done":i,"total":N,"row":{...}}   (one per player)
 *   {"type":"done","count":N,"rows":[...]}
 *   {"type":"error","error":"..."}                  (on failure)
 * Validation errors before streaming begins return a normal JSON error.
 */
app.post("/api/scrape", async (req, res) => {
  const { players, provider, server, week, tab } = req.body as {
    players?: PlayerInput[];
  } & Partial<ScrapeQuery>;

  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: "Body must include a non-empty players[] array." });
  }
  if (!provider) {
    return res.status(400).json({ error: "Missing provider." });
  }
  const filtered = filterAliases(players);
  if (filtered.length === 0) {
    return res.status(400).json({ error: 'No players matched the "--" alias filter.' });
  }

  const query: ScrapeQuery = {
    provider,
    server: server ?? "",
    week: week ?? "",
    tab: tab ?? "resources",
  };

  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (obj: unknown) => res.write(JSON.stringify(obj) + "\n");
  send({ type: "start", total: filtered.length, query });

  try {
    // Moose is searched by SteamID64 directly — no Steam-name resolution needed.
    const rows = await getProvider(provider).scrape(filtered, query, (row, done, total) => {
      send({ type: "row", done, total, row });
    });
    send({ type: "done", count: rows.length, rows });
  } catch (err) {
    console.error(err);
    send({ type: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Wipe trackers
// ---------------------------------------------------------------------------

/** List all trackers (summaries). */
app.get("/api/trackers", async (_req, res) => {
  const trackers = await listTrackers();
  res.json(trackers.map(toSummary));
});

/** Create a tracker. Company players are filtered to the "--" alias convention. */
app.post("/api/trackers", async (req, res) => {
  try {
    const b = req.body as {
      name?: string;
      company?: string;
      provider?: string;
      server?: string;
      week?: string;
      tabs?: string[];
      startDate?: string;
      endDate?: string;
      intervalHours?: number;
      players?: PlayerInput[];
    };

    if (!b.name?.trim()) return res.status(400).json({ error: "Falta el nombre del tracker." });
    if (!b.provider || !b.server || !b.week) {
      return res.status(400).json({ error: "Faltan provider, server o week." });
    }
    if (!b.startDate) {
      return res.status(400).json({ error: "Falta la fecha de inicio." });
    }
    if (!Array.isArray(b.players) || b.players.length === 0) {
      return res.status(400).json({ error: "Falta la lista de jugadores." });
    }
    if (!Array.isArray(b.tabs) || b.tabs.length === 0) {
      return res.status(400).json({ error: "Falta la lista de tabs a capturar." });
    }

    const players: TrackerPlayer[] = filterAliases(b.players).map((p) => ({
      alias: p.alias,
      steamId: p.steamId,
    }));
    if (players.length === 0) {
      return res.status(400).json({ error: 'Ningún jugador cumple el filtro "--".' });
    }

    const tracker = await createTracker({
      name: b.name.trim(),
      company: b.company?.trim() || b.name.trim(),
      provider: b.provider,
      server: b.server,
      week: b.week,
      tabs: b.tabs,
      startDate: b.startDate,
      endDate: b.endDate ?? "", // optional — empty means open-ended
      intervalHours: b.intervalHours && b.intervalHours > 0 ? b.intervalHours : 24,
      players,
    });

    // Kick off an initial snapshot in the background so there's day-1 data.
    takeSnapshot(tracker.id).catch((err) =>
      console.error("[create] initial snapshot failed:", err)
    );

    res.json(toSummary(tracker));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Server-Sent Events stream of snapshot progress for all trackers.
 * MUST be declared before `/api/trackers/:id` so it isn't matched as id="events".
 */
app.get("/api/trackers/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
  res.write(": connected\n\n");

  // Catch up a client that connects mid-snapshot.
  const cur = currentSnapshot();
  if (cur) res.write(`data: ${JSON.stringify(cur)}\n\n`);

  const unsub = onSnapshot((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
  });
});

/** Tracker detail: metadata, snapshot index and the stats available to chart. */
app.get("/api/trackers/:id", async (req, res) => {
  const tracker = await getTracker(req.params.id);
  if (!tracker) return res.status(404).json({ error: "Tracker no encontrado." });
  res.json({
    ...toSummary(tracker),
    createdAt: tracker.createdAt,
    provider: tracker.provider,
    tabs: tracker.tabs,
    players: tracker.players,
    snapshots: tracker.snapshots.map((s) => ({
      id: s.id,
      takenAt: s.takenAt,
      found: s.players.filter((p) => p.found).length,
    })),
    stats: listStats(tracker),
    snapshotRunning: isSnapshotRunning(),
  });
});

/** Daily series (cumulative + delta) for one stat, company total + per player. */
app.get("/api/trackers/:id/series", async (req, res) => {
  const tracker = await getTracker(req.params.id);
  if (!tracker) return res.status(404).json({ error: "Tracker no encontrado." });
  const tab = String(req.query.tab ?? "");
  const column = String(req.query.column ?? "");
  if (!tab || !column) return res.status(400).json({ error: "Faltan tab/column." });
  res.json(computeSeries(tracker, tab, column));
});

/** Whole-tab daily series (all columns at once) for the tracker detail view. */
app.get("/api/trackers/:id/tab-series", async (req, res) => {
  const tracker = await getTracker(req.params.id);
  if (!tracker) return res.status(404).json({ error: "Tracker no encontrado." });
  const tab = String(req.query.tab ?? "");
  if (!tab) return res.status(400).json({ error: "Falta tab." });
  res.json(computeTabSeries(tracker, tab));
});

/**
 * Trigger a snapshot now (fire-and-forget). Progress is broadcast over SSE
 * (`/api/trackers/events`), like the initial and scheduled snapshots.
 */
app.post("/api/trackers/:id/snapshot", async (req, res) => {
  const tracker = await getTracker(req.params.id);
  if (!tracker) return res.status(404).json({ error: "Tracker no encontrado." });
  if (isSnapshotRunning()) {
    return res.status(409).json({ error: "Ya hay un snapshot en curso." });
  }
  takeSnapshot(tracker.id).catch((err) => console.error("[snapshot] failed:", err));
  res.status(202).json({ ok: true });
});

/** Update editable fields of a tracker (end date, start, interval, name). */
app.patch("/api/trackers/:id", async (req, res) => {
  const b = req.body as Partial<{
    name: string;
    startDate: string;
    endDate: string;
    intervalHours: number;
  }>;
  const patch: typeof b = {};
  if (typeof b.name === "string") patch.name = b.name.trim();
  if (typeof b.startDate === "string") patch.startDate = b.startDate;
  if (typeof b.endDate === "string") patch.endDate = b.endDate; // "" clears the end
  if (typeof b.intervalHours === "number" && b.intervalHours > 0) patch.intervalHours = b.intervalHours;

  const tracker = await updateTracker(req.params.id, patch);
  if (!tracker) return res.status(404).json({ error: "Tracker no encontrado." });
  res.json(toSummary(tracker));
});

/** Delete a tracker. */
app.delete("/api/trackers/:id", async (req, res) => {
  const ok = await deleteTracker(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.listen(config.port, () => {
  console.log(`rust-stats-scraper listening on http://localhost:${config.port}`);
  startScheduler();
});
