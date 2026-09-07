import { listTrackers } from "./store.js";
import { isSnapshotRunning, takeSnapshot } from "./snapshotRunner.js";
import type { Tracker } from "./types.js";

const CHECK_MS = 10 * 60 * 1000; // re-evaluate every 10 minutes
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day (YYYY-MM-DD) — the day boundary is local midnight. */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function withinWindow(t: Tracker, now: number): boolean {
  const start = new Date(t.startDate).getTime();
  if (now < start) return false;
  if (!t.endDate) return true; // open-ended wipe (no end date set)
  // Include the whole end day.
  const end = new Date(t.endDate).getTime() + DAY_MS;
  return now <= end;
}

/**
 * One snapshot per calendar day: due when the last snapshot was on an earlier
 * local day (or there is none). So the first tick after midnight takes the new
 * day's snapshot — the day boundary is local midnight.
 */
function isDue(t: Tracker, now: number): boolean {
  if (!t.lastSnapshotAt) return true;
  return localDayKey(new Date(t.lastSnapshotAt).getTime()) !== localDayKey(now);
}

async function tick(): Promise<void> {
  if (isSnapshotRunning()) return; // don't queue up behind a running snapshot
  let trackers: Tracker[];
  try {
    trackers = await listTrackers();
  } catch {
    return;
  }
  const now = Date.now();
  for (const t of trackers) {
    if (withinWindow(t, now) && isDue(t, now)) {
      try {
        console.log(`[scheduler] snapshot due for "${t.name}" (${t.id})`);
        await takeSnapshot(t.id);
      } catch (err) {
        console.error(`[scheduler] snapshot failed for ${t.id}:`, err);
      }
      break; // one snapshot per tick keeps the browser load bounded
    }
  }
}

/** Start the background scheduler that snapshots due trackers automatically. */
export function startScheduler(): void {
  setInterval(() => void tick(), CHECK_MS);
  setTimeout(() => void tick(), 5_000); // first pass shortly after boot
  console.log("[scheduler] started (checks every 10 min)");
}
