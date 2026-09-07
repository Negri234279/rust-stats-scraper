// Validates the tracker pipeline end-to-end: create → snapshot → deltas.
// Run: npx tsx scripts/test-tracker.mts
import { createTracker, appendSnapshot, getTracker, deleteTracker } from "../src/trackers/store.js";
import { takeSnapshot } from "../src/trackers/snapshotRunner.js";
import { computeSeries, listStats } from "../src/trackers/analytics.js";

const tracker = await createTracker({
  name: "TEST wipe",
  company: "Test Co",
  provider: "moose",
  server: "US Monthly (Premium)",
  week: "09/03/2026 18:00:00",
  tabs: ["RESOURCES", "FARMING"],
  startDate: "2026-09-03",
  endDate: "2026-10-03",
  intervalHours: 24,
  players: [
    { alias: "--User", steamId: "76561198379460868" },
    { alias: "--Paulita", steamId: "76561198345800593" },
  ],
});
console.log("created tracker", tracker.id);

console.log("taking real snapshot (2 tabs x 2 players)…");
const snap1 = await takeSnapshot(tracker.id);
console.log("snapshot 1 players:", snap1.players.map((p) => `${p.personaName} wood=${p.stats.RESOURCES?.Wood}`));

// Inject a synthetic 2nd snapshot one day later with +2,000 wood each.
const t2 = await getTracker(tracker.id);
const bump = JSON.parse(JSON.stringify(snap1));
bump.id = "synthetic-day2";
bump.takenAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
for (const p of bump.players) {
  if (p.stats.RESOURCES?.Wood != null) {
    const n = parseInt(String(p.stats.RESOURCES.Wood).replace(/,/g, ""), 10) + 2000;
    p.stats.RESOURCES.Wood = n.toLocaleString("en-US");
  }
}
await appendSnapshot(tracker.id, bump);

console.log("\navailable stats:", JSON.stringify(listStats((await getTracker(tracker.id))!).map(s => s.tab + ": " + s.columns.join(","))));

const series = computeSeries((await getTracker(tracker.id))!, "RESOURCES", "Wood");
console.log("\n=== Wood series ===");
console.log("days:", series.days);
console.log("TOTAL:", series.total.map((d) => `${d.date} cum=${d.cum} Δ=${d.delta}`));
for (const p of series.players) {
  console.log(`${p.personaName}:`, series.byPlayer[p.steamId].map((d) => `${d.date} cum=${d.cum} Δ=${d.delta}`));
}

await deleteTracker(tracker.id);
console.log("\ncleaned up tracker.");
