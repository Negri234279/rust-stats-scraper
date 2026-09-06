import { assertSteamKey } from "../config.js";
import type { PlayerInput, ResolvedPlayer } from "../types.js";

const GET_PLAYER_SUMMARIES =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";

// GetPlayerSummaries accepts up to 100 SteamID64s per call.
const BATCH_SIZE = 100;

interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
}

/**
 * Resolve each SteamID64 to its current Steam persona name via the official
 * Steam Web API. Players Steam does not return (private/deleted) fall back to
 * their alias with the `--` prefix stripped, so downstream scraping still has a
 * name to search for.
 */
export async function resolvePlayers(
  players: PlayerInput[]
): Promise<ResolvedPlayer[]> {
  const key = assertSteamKey();
  const byId = new Map<string, string>(); // steamId -> personaName

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    const ids = batch.map((p) => p.steamId).join(",");
    const url = `${GET_PLAYER_SUMMARIES}?key=${key}&steamids=${ids}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Steam API error ${res.status} ${res.statusText} while resolving names`
      );
    }
    const json = (await res.json()) as {
      response: { players: SteamPlayerSummary[] };
    };
    for (const p of json.response.players) {
      byId.set(p.steamid, p.personaname);
    }
  }

  return players.map((p) => ({
    alias: p.alias,
    steamId: p.steamId,
    personaName: byId.get(p.steamId) ?? stripPrefix(p.alias),
  }));
}

function stripPrefix(alias: string): string {
  return alias.replace(/^[-*]+/, "").trim();
}
