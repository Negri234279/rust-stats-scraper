import type { ResolvedPlayer, ScrapeQuery, StatRow } from "../types.js";

/**
 * The contract every stat-site provider implements. The scraper/server code only
 * ever talks to this interface, so adding a new site is one new folder under
 * `src/providers/` plus a line in `index.ts` — nothing else changes.
 *
 * Providers receive resolved **persona names** (via `ResolvedPlayer`), never do
 * their own Steam resolution.
 */
export interface StatProvider {
  /** Stable identifier used in the API and registry, e.g. "moose". */
  readonly name: string;

  /** Human-friendly label for the UI. */
  readonly label: string;

  /**
   * Drive the site for the requested server/week/tab and return one row per
   * player. Implementations should return `{ found: false }` rows for players
   * absent from the table rather than throwing.
   */
  scrape(players: ResolvedPlayer[], query: ScrapeQuery): Promise<StatRow[]>;
}
