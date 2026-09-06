// Manual integration check for the Moose provider (bypasses Steam resolution).
// Run: npx tsx scripts/test-moose.mts
import { mooseProvider } from "../src/providers/moose/index.js";
import type { ResolvedPlayer } from "../src/types.js";

const players: ResolvedPlayer[] = [
  { alias: "--Alfred", steamId: "0", personaName: "Alfred" },
  { alias: "--Lo", steamId: "0", personaName: "Lo" },
  { alias: "--Nobody", steamId: "0", personaName: "zzz-not-a-real-player-zzz" },
];

const rows = await mooseProvider.scrape(players, {
  provider: "moose",
  server: "US Monthly (Premium)",
  week: "09/03/2026 18:00:00",
  tab: "Resources",
});

console.log(JSON.stringify(rows, null, 2));
