import { EventEmitter } from "node:events";

/** Snapshot lifecycle events broadcast to any connected web client (via SSE). */
export type SnapshotEvent =
  | { type: "start"; trackerId: string; trackerName: string; total: number }
  | { type: "progress"; trackerId: string; trackerName: string; done: number; total: number; tab: string; name: string }
  | { type: "done"; trackerId: string; trackerName: string; found: number; takenAt: string }
  | { type: "error"; trackerId: string; trackerName: string; error: string };

const bus = new EventEmitter();
bus.setMaxListeners(100);

// The latest start/progress event while a snapshot is running, so a client that
// connects mid-snapshot (e.g. during the background initial or midnight run) can
// be caught up immediately.
let current: SnapshotEvent | null = null;

export function emitSnapshot(e: SnapshotEvent): void {
  current = e.type === "start" || e.type === "progress" ? e : null;
  bus.emit("snap", e);
}

export function onSnapshot(fn: (e: SnapshotEvent) => void): () => void {
  bus.on("snap", fn);
  return () => void bus.off("snap", fn);
}

export function currentSnapshot(): SnapshotEvent | null {
  return current;
}
