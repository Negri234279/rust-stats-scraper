/** One raw entry from the input alias list. */
export interface PlayerInput {
  alias: string;
  steamId: string; // SteamID64
}

/** A player after Steam resolution: SteamID64 + resolved persona name. */
export interface ResolvedPlayer {
  alias: string;
  steamId: string;
  personaName: string; // current Steam display name, used to find them on the provider
}

/** What tab/view of the provider we are scraping. */
export type StatTab = "resources" | string;

/** A scrape request: which provider view to read. */
export interface ScrapeQuery {
  provider: string; // e.g. "moose"
  server: string; // provider-specific server identifier/name
  week: string; // provider-specific week identifier/label
  tab: StatTab; // e.g. "resources"
}

/**
 * One player's row for the requested tab. `stats` keys are the provider's column
 * headers (e.g. "Stone", "Metal Ore", "Sulfur Ore"), values are the cell text.
 */
export interface StatRow {
  personaName: string;
  steamId?: string;
  found: boolean; // false if the player was not present in the provider table
  stats: Record<string, string>;
}
