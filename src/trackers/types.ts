import type { SnapshotPlayer } from "../types.js";

/** A player belonging to a tracked company. */
export interface TrackerPlayer {
  alias: string;
  steamId: string;
}

/** One captured point in time for a tracker. */
export interface Snapshot {
  id: string;
  takenAt: string; // ISO timestamp
  players: SnapshotPlayer[];
}

/** A wipe tracker: a company + server + wipe window, with periodic snapshots. */
export interface Tracker {
  id: string;
  name: string;
  company: string;
  provider: string; // e.g. "moose"
  server: string;
  week: string; // provider wipe id (Moose timestamp string)
  tabs: string[]; // provider tab labels captured each snapshot
  startDate: string; // ISO date (wipe start)
  endDate: string; // ISO date (wipe end)
  intervalHours: number; // scheduler cadence between snapshots
  players: TrackerPlayer[];
  createdAt: string;
  lastSnapshotAt?: string;
  snapshots: Snapshot[];
}

/** Lightweight tracker summary for list views (no snapshot payloads). */
export interface TrackerSummary {
  id: string;
  name: string;
  company: string;
  server: string;
  week: string;
  startDate: string;
  endDate: string;
  intervalHours: number;
  playerCount: number;
  snapshotCount: number;
  lastSnapshotAt?: string;
}

export function toSummary(t: Tracker): TrackerSummary {
  return {
    id: t.id,
    name: t.name,
    company: t.company,
    server: t.server,
    week: t.week,
    startDate: t.startDate,
    endDate: t.endDate,
    intervalHours: t.intervalHours,
    playerCount: t.players.length,
    snapshotCount: t.snapshots.length,
    lastSnapshotAt: t.lastSnapshotAt,
  };
}
