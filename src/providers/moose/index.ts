import { chromium, type Browser, type Locator, type Page } from "playwright";
import { config } from "../../config.js";
import type { ResolvedPlayer, ScrapeQuery, StatRow } from "../../types.js";
import type { StatProvider } from "../types.js";

const MOOSE_STATS_URL = "https://moose.gg/stats";

// Moose is a Blazor Server app built with Radzen components (rz-* classes).
// Selectors below were verified against the live DOM on 2026-09-06.
const SEL = {
  // Visible Radzen dropdowns that carry a label. There are hidden responsive
  // duplicates in the DOM, so we always restrict to visible ones:
  //   index 0 = server, index 1 = time/week (disabled until a server is chosen).
  dropdown: ".rz-dropdown",
  dropdownLabel: ".rz-dropdown-label",
  grid: "table.rz-grid-table",
  search: 'input[placeholder="Search..."]',
};

class MooseProvider implements StatProvider {
  readonly name = "moose";
  readonly label = "Moose (moose.gg)";

  async scrape(
    players: ResolvedPlayer[],
    query: ScrapeQuery
  ): Promise<StatRow[]> {
    const browser = await this.launch();
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(MOOSE_STATS_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      // Blazor connects over a WebSocket and renders after load.
      await page.waitForTimeout(8_000);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      await this.selectServer(page, query.server);
      await this.selectWeek(page, query.week);
      await this.selectTab(page, query.tab);

      await page.waitForSelector(`${SEL.grid} thead th`, { timeout: 15_000 });
      const headers = await page.locator(`${SEL.grid} thead th`).allInnerTexts();

      const rows: StatRow[] = [];
      for (const player of players) {
        rows.push(await this.extractPlayerRow(page, headers, player));
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

  /** The visible Radzen dropdowns, in DOM order: [0]=server, [1]=time. */
  private visibleDropdowns(page: Page): Locator {
    return page
      .locator(SEL.dropdown)
      .filter({ has: page.locator(SEL.dropdownLabel) })
      .locator("visible=true");
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
   * Type the persona name into the grid's Search box (server-side filter) and
   * read the matching row.
   *
   * Behavior verified against the live grid:
   *  - The box must be cleared before each new query, otherwise the grid lags a
   *    query behind.
   *  - Moose ignores queries shorter than 3 characters (shows the full list).
   *  - No match renders a single placeholder row "No items to display.".
   *
   * We require an exact (case-insensitive) match on the Player column, and never
   * fall back to an arbitrary row — reporting "not found" is safer than returning
   * a different player's numbers.
   */
  private async extractPlayerRow(
    page: Page,
    headers: string[],
    player: ResolvedPlayer
  ): Promise<StatRow> {
    const search = page.locator(SEL.search).locator("visible=true").first();
    await search.fill("");
    await page.waitForTimeout(500);
    await search.fill(player.personaName);
    await page.waitForTimeout(2_500);

    const rowLocs = page.locator(`${SEL.grid} tbody tr`);
    const count = await rowLocs.count();
    const target = player.personaName.trim().toLowerCase();

    let chosen: Locator | null = null;
    for (let i = 0; i < count; i++) {
      const cells = rowLocs.nth(i).locator("td");
      // Placeholder ("No items to display.") is a single-cell row — skip it.
      if ((await cells.count()) < headers.length) continue;
      const name = (await cells.first().innerText()).trim().toLowerCase();
      if (name === target) {
        chosen = rowLocs.nth(i);
        break;
      }
    }

    if (!chosen) return this.notFound(player);

    const cells = await chosen.locator("td").allInnerTexts();
    const stats: Record<string, string> = {};
    headers.forEach((h, i) => {
      stats[h.trim() || `col_${i}`] = (cells[i] ?? "").trim();
    });
    return { personaName: player.personaName, steamId: player.steamId, found: true, stats };
  }

  private notFound(player: ResolvedPlayer): StatRow {
    return {
      personaName: player.personaName,
      steamId: player.steamId,
      found: false,
      stats: {},
    };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const mooseProvider = new MooseProvider();
