import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { filterAliases } from "./steam/aliasFilter.js";
import { resolvePlayers } from "./steam/resolver.js";
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

/**
 * Main endpoint. Body:
 *   {
 *     players: [{ alias, steamId }, ...],
 *     provider: "moose", server: "...", week: "...", tab: "resources"
 *   }
 * Filters aliases (`--` prefix), resolves Steam names, scrapes the provider.
 */
app.post("/api/scrape", async (req, res) => {
  try {
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

    const resolved = await resolvePlayers(filtered);

    const query: ScrapeQuery = {
      provider,
      server: server ?? "",
      week: week ?? "",
      tab: tab ?? "resources",
    };
    const rows = await getProvider(provider).scrape(resolved, query);

    res.json({
      query,
      count: rows.length,
      resolved,
      rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(config.port, () => {
  console.log(`rust-stats-scraper listening on http://localhost:${config.port}`);
});
