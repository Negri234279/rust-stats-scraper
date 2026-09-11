import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { config } from "../../config.js";
import type {
  PlayerInput,
  ScrapeQuery,
  SnapshotPlayer,
  SnapshotProgress,
  SnapshotQuery,
  StatRow,
} from "../../types.js";
import type { ProviderFilters, RowProgress, StatProvider } from "../types.js";

const MOOSE_STATS_URL = "https://moose.gg/stats";

// Moose is a Blazor Server app built with Radzen components (rz-* classes).
// Selectors below were verified against the live DOM on 2026-09-06.
const SEL = {
  // Visible Radzen dropdowns that carry a label. There are hidden responsive
  // duplicates in the DOM, so we always restrict to visible ones:
  //   index 0 = server, index 1 = time/week (disabled until a server is chosen).
  dropdown: ".rz-dropdown",
  dropdownLabel: ".rz-dropdown-label",
  option: ".rz-dropdown-item",
  grid: "table.rz-grid-table",
  search: 'input[placeholder="Search..."]',
};

class MooseProvider implements StatProvider {
  readonly name = "moose";
  readonly label = "Moose (moose.gg)";

  /** Read the server list and tab list in a single page load. */
  async listFilters(): Promise<ProviderFilters> {
    const browser = await this.launch();
    try {
      const page = await this.openStats(browser);

      await this.visibleDropdowns(page).nth(0).click();
      const servers = await this.readOpenOptions(page);
      await page.keyboard.press("Escape");

      const tabs = unique(
        (await page.getByRole("tab").allInnerTexts()).map((t) => t.trim())
      ).filter(Boolean);

      return { servers, tabs };
    } finally {
      await browser.close();
    }
  }

  /** Read the available weeks (wipe timestamps) for a given server. */
  async listWeeks(server: string): Promise<string[]> {
    const browser = await this.launch();
    try {
      const page = await this.openStats(browser);
      await this.selectServer(page, server);
      await this.visibleDropdowns(page).nth(1).click();
      const weeks = await this.readOpenOptions(page);
      await page.keyboard.press("Escape");
      return weeks;
    } finally {
      await browser.close();
    }
  }

  async scrape(
    players: PlayerInput[],
    query: ScrapeQuery,
    onRow?: RowProgress
  ): Promise<StatRow[]> {
    const browser = await this.launch();
    // Results are written by global index so the returned order matches the input
    // regardless of which parallel context handled each player.
    const rows: StatRow[] = new Array(players.length);
    let done = 0;
    try {
      await this.forEachShard(browser, players, async (page, chunk) => {
        await this.selectServer(page, query.server);
        await this.selectWeek(page, query.week);
        await this.selectTab(page, query.tab);

        await page.waitForSelector(`${SEL.grid} thead th`, { timeout: 15_000 });
        const headers = await page.locator(`${SEL.grid} thead th`).allInnerTexts();

        for (const { index, player } of chunk) {
          const row = await this.extractPlayerRow(page, headers, player);
          rows[index] = row;
          onRow?.(row, ++done, players.length);
        }
      });
      return rows;
    } finally {
      await browser.close();
    }
  }

  /**
   * Capture every requested tab for every player. Players are sharded across
   * several parallel browser contexts (see `forEachShard`); each context selects
   * server + week once, then loops tab → its players, searching each by SteamID64
   * and storing that tab's columns under `stats[tab]`.
   */
  async snapshot(
    players: PlayerInput[],
    query: SnapshotQuery,
    onProgress?: SnapshotProgress
  ): Promise<SnapshotPlayer[]> {
    const browser = await this.launch();
    const result = new Map<string, SnapshotPlayer>(
      players.map((p) => [
        p.steamId,
        { alias: p.alias, steamId: p.steamId, personaName: "", found: false, stats: {} },
      ])
    );

    const total = query.tabs.length * players.length;
    let done = 0;

    try {
      // Each shard is an independent context that selects server+week once, then
      // walks every tab for its slice of players. Shards handle disjoint players,
      // so they write into the shared result map without conflicting. `done` is a
      // shared counter; because shards advance through tabs in parallel the tab
      // label in each progress event is whichever shard reported last — the
      // done/total count stays exact.
      await this.forEachShard(browser, players, async (page, chunk) => {
        await this.selectServer(page, query.server);
        await this.selectWeek(page, query.week);

        for (const tab of query.tabs) {
          await this.selectTab(page, tab);
          await page.waitForSelector(`${SEL.grid} thead th`, { timeout: 15_000 });
          const headers = await page.locator(`${SEL.grid} thead th`).allInnerTexts();

          for (const { player } of chunk) {
            const row = await this.extractPlayerRow(page, headers, player);
            const sp = result.get(player.steamId)!;
            if (row.found) {
              sp.found = true;
              if (!sp.personaName) sp.personaName = row.personaName;
              const tabStats: Record<string, string> = {};
              for (const [k, v] of Object.entries(row.stats)) {
                if (!/^player$/i.test(k)) tabStats[k] = v;
              }
              sp.stats[tab] = tabStats;
            }
            onProgress?.(++done, total, tab, row.personaName || player.alias);
          }
        }
      });

      return [...result.values()];
    } finally {
      await browser.close();
    }
  }

  /**
   * Shard `players` across up to `config.scraperConcurrency` independent browser
   * contexts and run `work` on each in parallel. Every context gets a freshly
   * opened stats page and its own slice of players (tagged with their original
   * index so callers can preserve input order). Contexts are always closed, even
   * if a shard throws.
   */
  private async forEachShard(
    browser: Browser,
    players: PlayerInput[],
    work: (
      page: Page,
      chunk: { index: number; player: PlayerInput }[]
    ) => Promise<void>
  ): Promise<void> {
    const tagged = players.map((player, index) => ({ index, player }));
    const workers = Math.min(config.scraperConcurrency, tagged.length) || 1;
    const chunks = shard(tagged, workers);
    const contexts: BrowserContext[] = [];
    try {
      await Promise.all(
        chunks.map(async (chunk) => {
          if (chunk.length === 0) return;
          const context = await browser.newContext();
          contexts.push(context);
          const page = await this.openStats(context);
          await work(page, chunk);
        })
      );
    } finally {
      await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    }
  }

  /**
   * Launch the browser. With `BROWSER_CHANNEL=chrome` (default) it tries the
   * system Google Chrome and falls back to bundled Chromium; with "chromium" (or
   * empty) it uses bundled Chromium directly — the only option on Linux ARM64
   * (Raspberry Pi), where there is no Chrome channel.
   */
  private async launch(): Promise<Browser> {
    // Flags needed to run Chromium inside containers (no user namespace / small /dev/shm).
    const args = ["--no-sandbox", "--disable-dev-shm-usage"];
    const channel = config.browserChannel;
    if (channel && channel !== "chromium") {
      try {
        return await chromium.launch({ channel, headless: config.headless, args });
      } catch {
        // Fall through to bundled Chromium.
      }
    }
    return await chromium.launch({ headless: config.headless, args });
  }

  /** Open the stats page and wait for Blazor to connect and render. */
  private async openStats(target: Browser | BrowserContext): Promise<Page> {
    const page = await target.newPage();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(MOOSE_STATS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(8_000);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    return page;
  }

  /** The visible Radzen dropdowns, in DOM order: [0]=server, [1]=time. */
  private visibleDropdowns(page: Page): Locator {
    return page
      .locator(SEL.dropdown)
      .filter({ has: page.locator(SEL.dropdownLabel) })
      .locator("visible=true");
  }

  /** Read the options of the currently-open dropdown, deduped and in order. */
  private async readOpenOptions(page: Page): Promise<string[]> {
    await page.waitForTimeout(700);
    await page.locator(SEL.option).first().waitFor({ timeout: 5_000 }).catch(() => {});
    const texts = await page.getByRole("option").allInnerTexts();
    return unique(texts.map((t) => t.trim())).filter(Boolean);
  }

  private async selectServer(page: Page, server: string): Promise<void> {
    if (!server) return;
    await this.visibleDropdowns(page).nth(0).click();
    await page.waitForTimeout(600);
    await page.getByRole("option", { name: server, exact: true }).first().click();
    // Selecting a server enables and repopulates the time dropdown.
    await page.waitForTimeout(2_500);
  }

  private async selectWeek(page: Page, week: string): Promise<void> {
    if (!week) return;
    await this.visibleDropdowns(page).nth(1).click();
    await page.waitForTimeout(700);
    await page.getByRole("option", { name: week, exact: true }).first().click();
    await page.waitForTimeout(2_500);
  }

  private async selectTab(page: Page, tab: string): Promise<void> {
    if (!tab) return;
    // Switching tabs swaps the grid's columns and rows over the Blazor socket.
    // Wait for the grid to actually change and settle rather than a blind 2.5s —
    // a fixed row-count check is too weak here (the previous tab also has rows).
    const baseline = await this.gridSignature(page);
    await page
      .getByRole("tab", { name: new RegExp(`^${escapeRe(tab)}$`, "i") })
      .click();
    await this.waitSettled(page, baseline, 300, 6_000);
  }

  /** Wait for the visible grid to hold more than one row (the full, unfiltered
   *  list is present) — cheap signal used after clearing the search box. */
  private async waitManyRows(page: Page, timeout: number): Promise<void> {
    await page
      .waitForFunction(
        (sel) =>
          Array.from(document.querySelectorAll(`${sel} tbody tr`)).filter(
            (r) => (r as HTMLElement).offsetParent !== null
          ).length > 1,
        SEL.grid,
        { timeout }
      )
      .catch(() => {});
  }

  /**
   * A cheap fingerprint of the visible grid: number of rows + the first row's
   * text. It changes whenever the grid re-renders (tab switch, search filter),
   * which is what `waitSettled` watches for.
   */
  private async gridSignature(page: Page): Promise<string> {
    return page.evaluate((sel) => {
      const rows = Array.from(
        document.querySelectorAll(`${sel} tbody tr`)
      ).filter((r) => (r as HTMLElement).offsetParent !== null);
      const first = rows[0]
        ? (rows[0] as HTMLElement).innerText.replace(/\s+/g, " ").trim()
        : "";
      return `${rows.length}|${first}`;
    }, SEL.grid);
  }

  /**
   * Wait until the grid has both **changed** from `baseline` and then **held
   * steady** for two consecutive polls — i.e. the SPA finished re-rendering the
   * result. This adapts to load automatically (a busy, parallel run just waits a
   * little longer) where a fixed sleep would either waste time or read too early.
   * `min` skips the initial debounce; falls through at `max`.
   */
  private async waitSettled(
    page: Page,
    baseline: string,
    min: number,
    max: number
  ): Promise<void> {
    const start = Date.now();
    await page.waitForTimeout(min);
    let prev = await this.gridSignature(page);
    while (Date.now() - start < max) {
      await page.waitForTimeout(250);
      const cur = await this.gridSignature(page);
      if (cur !== baseline && cur === prev) return;
      prev = cur;
    }
  }

  /**
   * Search the grid by the player's SteamID64 and read the matching row.
   *
   * Moose's Search box matches on SteamID64 directly and returns exactly one row,
   * so we don't need to resolve the Steam name beforehand — the display name is
   * read from that row's Player column. Behavior verified against the live grid:
   *  - The box must be cleared before each new query, otherwise the grid lags a
   *    query behind.
   *  - No match renders a single placeholder row "No items to display.".
   */
  private async extractPlayerRow(
    page: Page,
    headers: string[],
    player: PlayerInput
  ): Promise<StatRow> {
    const search = page.locator(SEL.search).locator("visible=true").first();
    // Clear, then wait for the grid to repopulate to the full list before typing
    // the next query — this is what stops the grid lagging a query behind.
    await search.fill("");
    await this.waitManyRows(page, 3_000);
    const full = await this.gridSignature(page);
    // Type the SteamID64 and wait for the grid to change from the full list and
    // settle on the single match (or the "No items" placeholder).
    await search.fill(player.steamId);
    await this.waitSettled(page, full, 300, 5_000);

    const rowLocs = page.locator(`${SEL.grid} tbody tr`);
    const count = await rowLocs.count();

    let chosen: Locator | null = null;
    for (let i = 0; i < count; i++) {
      // Placeholder ("No items to display.") is a single-cell row — skip it.
      if ((await rowLocs.nth(i).locator("td").count()) < headers.length) continue;
      chosen = rowLocs.nth(i);
      break;
    }

    if (!chosen) return this.notFound(player);

    const cells = await chosen.locator("td").allInnerTexts();
    const stats: Record<string, string> = {};
    headers.forEach((h, i) => {
      stats[h.trim() || `col_${i}`] = (cells[i] ?? "").trim();
    });
    const playerCol = headers.findIndex((h) => /player/i.test(h));
    return {
      // Steam display name comes straight from the Player column.
      personaName: (cells[playerCol >= 0 ? playerCol : 0] ?? "").trim(),
      alias: player.alias,
      steamId: player.steamId,
      found: true,
      stats,
    };
  }

  private notFound(player: PlayerInput): StatRow {
    return {
      personaName: "",
      alias: player.alias,
      steamId: player.steamId,
      found: false,
      stats: {},
    };
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/** Split `items` into `n` roughly equal buckets, round-robin. */
function shard<T>(items: T[], n: number): T[][] {
  const chunks: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => chunks[i % n].push(item));
  return chunks;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const mooseProvider = new MooseProvider();
