import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { filterAliases } from "./steam/aliasFilter.js";
import { getProvider, listProviders } from "./providers/index.js";
import type { PlayerInput, ScrapeQuery } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

/** List available providers for the UI dropdown. */
app.get("/api/providers", (_req, res) => {
  res.json(listProviders());
});

/** Live server + tab options for a provider (drives the UI dropdowns). */
app.get("/api/filters", async (req, res) => {
  try {
    const provider = String(req.query.provider ?? "");
    const filters = await getProvider(provider).listFilters();
    res.json(filters);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Live week options for a given provider + server (cascades from server). */
app.get("/api/weeks", async (req, res) => {
  try {
    const provider = String(req.query.provider ?? "");
    const server = String(req.query.server ?? "");
    if (!server) return res.status(400).json({ error: "Missing server." });
    const weeks = await getProvider(provider).listWeeks(server);
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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

app.listen(config.port, () => {
  console.log(`rust-stats-scraper listening on http://localhost:${config.port}`);
});
