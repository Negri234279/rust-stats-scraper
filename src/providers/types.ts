import type {
  PlayerInput,
  ScrapeQuery,
  SnapshotPlayer,
  SnapshotProgress,
  SnapshotQuery,
  StatRow,
} from "../types.js";

/** Filter options read live from a provider (server-independent). */
export interface ProviderFilters {
  servers: string[];
  tabs: string[];
}

/** Called after each player is scraped, for live progress reporting. */
export type RowProgress = (row: StatRow, done: number, total: number) => void;

/**
 * The contract every stat-site provider implements. The scraper/server code only
 * ever talks to this interface, so adding a new site is one new folder under
 * `src/providers/` plus a line in `index.ts` — nothing else changes.
 *
 * Providers receive the raw input players (alias + SteamID64) and locate each
 * however works best for that site. Moose supports searching by SteamID64
 * directly and exposes the Steam display name in the result row, so no separate
 * Steam-name resolution is needed. A future provider that can only search by name
 * may use `src/steam/resolver.ts` internally.
 */
export interface StatProvider {
  /** Stable identifier used in the API and registry, e.g. "moose". */
  readonly name: string;

  /** Human-friendly label for the UI. */
  readonly label: string;

  /** Read the provider's server list and available tabs from the live site. */
  listFilters(): Promise<ProviderFilters>;

  /** Read the available weeks (wipe periods) for a given server. */
  listWeeks(server: string): Promise<string[]>;

  /**
   * Drive the site for the requested server/week/tab and return one row per
   * player. Implementations should return `{ found: false }` rows for players
   * absent from the table rather than throwing. `onRow`, when given, is invoked
   * after each player is scraped so callers can report live progress.
   */
  scrape(
    players: PlayerInput[],
    query: ScrapeQuery,
    onRow?: RowProgress
  ): Promise<StatRow[]>;

  /**
   * Capture every requested tab for every player in one pass (used by the wipe
   * tracker). Returns one `SnapshotPlayer` per input player with stats keyed by
   * tab → column. `onProgress` reports `(done, total, tab, name)` across the
   * whole tab × player grid.
   */
  snapshot(
    players: PlayerInput[],
    query: SnapshotQuery,
    onProgress?: SnapshotProgress
  ): Promise<SnapshotPlayer[]>;
}
