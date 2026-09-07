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
  alias: string; // original input alias (e.g. "--User")
  steamId?: string;
  found: boolean; // false if the player was not present in the provider table
  stats: Record<string, string>;
}

/** A full multi-tab snapshot request for the tracker feature. */
export interface SnapshotQuery {
  server: string;
  week: string;
  tabs: string[]; // provider tab labels to capture, e.g. ["RESOURCES","PVP",...]
}

/**
 * One player captured across every requested tab.
 * `stats` is keyed tab → column → cell text, e.g.
 * `{ "RESOURCES": { "Wood": "3,524" }, "PVP": { "Kills": "59,323" } }`.
 */
export interface SnapshotPlayer {
  alias: string;
  steamId: string;
  personaName: string;
  found: boolean;
  stats: Record<string, Record<string, string>>;
}

/** Progress callback while a multi-tab snapshot runs. */
export type SnapshotProgress = (
  done: number,
  total: number,
  tab: string,
  personaName: string
) => void;
