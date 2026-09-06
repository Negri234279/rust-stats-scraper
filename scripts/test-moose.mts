// Manual integration check for the Moose provider (searches by SteamID64).
// Run: npx tsx scripts/test-moose.mts
import { mooseProvider } from "../src/providers/moose/index.js";
import type { PlayerInput } from "../src/types.js";

const players: PlayerInput[] = [
  { alias: "--Vaga", steamId: "76561198379460868" },
  { alias: "--Paulita", steamId: "76561198345800593" },
  { alias: "--Nobody", steamId: "10000000000000000" }, // not on this server/week
];

const rows = await mooseProvider.scrape(players, {
  provider: "moose",
  server: "US Monthly (Premium)",
  week: "09/03/2026 18:00:00",
  tab: "Resources",
});

console.log(JSON.stringify(rows, null, 2));
