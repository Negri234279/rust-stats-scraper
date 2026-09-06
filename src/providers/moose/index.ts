import { chromium, type Browser, type Locator, type Page } from "playwright";
import { config } from "../../config.js";
import type { PlayerInput, ScrapeQuery, StatRow } from "../../types.js";
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
    try {
      const page = await this.openStats(browser);

      await this.selectServer(page, query.server);
      await this.selectWeek(page, query.week);
      await this.selectTab(page, query.tab);

      await page.waitForSelector(`${SEL.grid} thead th`, { timeout: 15_000 });
      const headers = await page.locator(`${SEL.grid} thead th`).allInnerTexts();

      const rows: StatRow[] = [];
      for (const player of players) {
        const row = await this.extractPlayerRow(page, headers, player);
        rows.push(row);
        onRow?.(row, rows.length, players.length);
      }
      return rows;
    } finally {
      await browser.close();
    }
  }

  /** Prefer the system Chrome (bundled Chromium download may be unavailable). */
  private async launch(): Promise<Browser> {
    try {
      return await chromium.launch({ channel: "chrome", headless: config.headless });
    } catch {
      return await chromium.launch({ headless: config.headless });
    }
  }

  /** Open the stats page and wait for Blazor to connect and render. */
  private async openStats(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
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
    await page
      .getByRole("tab", { name: new RegExp(`^${escapeRe(tab)}$`, "i") })
      .click();
    await page.waitForTimeout(2_500);
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
    await search.fill("");
    await page.waitForTimeout(500);
    await search.fill(player.steamId);
    await page.waitForTimeout(2_500);

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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const mooseProvider = new MooseProvider();
