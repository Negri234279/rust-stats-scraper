import { randomUUID } from "node:crypto";
import { getProvider } from "../providers/index.js";
import { appendSnapshot, getTracker } from "./store.js";
import { emitSnapshot } from "./events.js";
import type { Snapshot } from "./types.js";

// Snapshots are heavy (a whole browser session), so only one runs at a time
// across the scheduler and manual triggers.
let running = false;
export const isSnapshotRunning = () => running;

export class SnapshotBusyError extends Error {
  constructor() {
    super("A snapshot is already running.");
    this.name = "SnapshotBusyError";
  }
}

/**
 * Take one snapshot for a tracker and persist it, broadcasting start/progress/
 * done/error events so any connected web client can show live progress —
 * whichever way the snapshot was triggered (initial, manual, or scheduled).
 * Throws if one is already in flight.
 */
export async function takeSnapshot(trackerId: string): Promise<Snapshot> {
  if (running) throw new SnapshotBusyError();
  running = true;
  const tracker = await getTracker(trackerId);
  if (!tracker) {
    running = false;
    throw new Error("Tracker not found.");
  }
  const trackerName = tracker.name;
  const total = tracker.tabs.length * tracker.players.length;

  try {
    emitSnapshot({ type: "start", trackerId, trackerName, total });

    const players = await getProvider(tracker.provider).snapshot(
      tracker.players,
      { server: tracker.server, week: tracker.week, tabs: tracker.tabs },
      (done, tot, tab, name) =>
        emitSnapshot({ type: "progress", trackerId, trackerName, done, total: tot, tab, name })
    );

    const snapshot: Snapshot = {
      id: randomUUID(),
      takenAt: new Date().toISOString(),
      players,
    };
    await appendSnapshot(trackerId, snapshot);
    emitSnapshot({
      type: "done",
      trackerId,
      trackerName,
      found: players.filter((p) => p.found).length,
      takenAt: snapshot.takenAt,
    });
    return snapshot;
  } catch (err) {
    emitSnapshot({
      type: "error",
      trackerId,
      trackerName,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    running = false;
  }
}
