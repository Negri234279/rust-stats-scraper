import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Snapshot, Tracker } from "./types.js";

// Trackers are persisted as one JSON file each under data/trackers/.
const DIR = path.resolve(process.cwd(), "data", "trackers");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
}

function fileFor(id: string): string {
  return path.join(DIR, `${id}.json`);
}

export async function listTrackers(): Promise<Tracker[]> {
  await ensureDir();
  const entries = await fs.readdir(DIR);
  const trackers: Tracker[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      trackers.push(JSON.parse(await fs.readFile(path.join(DIR, name), "utf8")));
    } catch {
      // Skip corrupt files rather than crash the whole listing.
    }
  }
  return trackers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTracker(id: string): Promise<Tracker | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(id), "utf8"));
  } catch {
    return null;
  }
}

async function writeTracker(t: Tracker): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(t.id), JSON.stringify(t, null, 2), "utf8");
}

export type CreateTrackerInput = Omit<
  Tracker,
  "id" | "createdAt" | "snapshots" | "lastSnapshotAt"
>;

export async function createTracker(input: CreateTrackerInput): Promise<Tracker> {
  const tracker: Tracker = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    snapshots: [],
  };
  await writeTracker(tracker);
  return tracker;
}

/** Patch editable fields of a tracker (e.g. its end date). */
export async function updateTracker(
  id: string,
  patch: Partial<Pick<Tracker, "name" | "startDate" | "endDate" | "intervalHours">>
): Promise<Tracker | null> {
  const tracker = await getTracker(id);
  if (!tracker) return null;
  Object.assign(tracker, patch);
  await writeTracker(tracker);
  return tracker;
}

export async function appendSnapshot(id: string, snapshot: Snapshot): Promise<Tracker | null> {
  const tracker = await getTracker(id);
  if (!tracker) return null;
  tracker.snapshots.push(snapshot);
  tracker.lastSnapshotAt = snapshot.takenAt;
  await writeTracker(tracker);
  return tracker;
}

export async function deleteTracker(id: string): Promise<boolean> {
  try {
    await fs.unlink(fileFor(id));
    return true;
  } catch {
    return false;
  }
}
