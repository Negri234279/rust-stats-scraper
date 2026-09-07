import type { Snapshot, Tracker } from "./types.js";

/** Parse the first number in a cell ("199,501" → 199501, "27,987 / 12%" → 27987). */
export function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** Local YYYY-MM-DD for grouping snapshots into days. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Available stats to chart, derived from the most recent snapshot. */
export function listStats(tracker: Tracker): { tab: string; columns: string[] }[] {
  const last = tracker.snapshots[tracker.snapshots.length - 1];
  if (!last) return [];
  const byTab = new Map<string, string[]>();
  for (const tab of tracker.tabs) byTab.set(tab, []);
  for (const p of last.players) {
    for (const [tab, cols] of Object.entries(p.stats)) {
      const list = byTab.get(tab) ?? [];
      for (const col of Object.keys(cols)) if (!list.includes(col)) list.push(col);
      byTab.set(tab, list);
    }
  }
  return [...byTab.entries()]
    .filter(([, cols]) => cols.length > 0)
    .map(([tab, columns]) => ({ tab, columns }));
}

export interface DayPoint {
  date: string;
  cum: number; // cumulative value that day
  delta: number; // production since the previous day
}

export interface SeriesResult {
  tab: string;
  column: string;
  days: string[];
  players: { alias: string; steamId: string; personaName: string }[];
  total: DayPoint[];
  byPlayer: Record<string, DayPoint[]>; // steamId → daily points
}

/**
 * Daily series for one stat: cumulative value per day and the day-over-day delta
 * (production). The first day's delta is its full cumulative value (baseline from
 * 0); a day with no change yields delta 0.
 */
export function computeSeries(tracker: Tracker, tab: string, column: string): SeriesResult {
  const sorted = [...tracker.snapshots].sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  // Keep the last snapshot of each day.
  const byDay = new Map<string, Snapshot>();
  for (const snap of sorted) byDay.set(dayKey(snap.takenAt), snap);
  const days = [...byDay.keys()].sort();

  const last = sorted[sorted.length - 1];
  const players = tracker.players.map((p) => ({
    alias: p.alias,
    steamId: p.steamId,
    personaName:
      last?.players.find((sp) => sp.steamId === p.steamId)?.personaName || "",
  }));

  const valueFor = (snap: Snapshot, steamId: string): number => {
    const sp = snap.players.find((x) => x.steamId === steamId);
    return parseNum(sp?.stats?.[tab]?.[column]);
  };

  const byPlayer: Record<string, DayPoint[]> = {};
  for (const p of players) {
    let prev = 0;
    byPlayer[p.steamId] = days.map((date) => {
      const cum = valueFor(byDay.get(date)!, p.steamId);
      const point = { date, cum, delta: cum - prev };
      prev = cum;
      return point;
    });
  }

  let prevTotal = 0;
  const total: DayPoint[] = days.map((date) => {
    const cum = players.reduce((sum, p) => sum + valueFor(byDay.get(date)!, p.steamId), 0);
    const point = { date, cum, delta: cum - prevTotal };
    prevTotal = cum;
    return point;
  });

  return { tab, column, days, players, total, byPlayer };
}

export interface TabSeriesResult {
  tab: string;
  columns: string[];
  days: string[];
  players: { alias: string; steamId: string; personaName: string }[];
  total: Record<string, DayPoint[]>; // column → daily points
  byPlayer: Record<string, Record<string, DayPoint[]>>; // steamId → column → points
}

/**
 * Like `computeSeries` but for a whole tab at once: every column, so the UI can
 * show the complete tab instead of one stat at a time.
 */
export function computeTabSeries(tracker: Tracker, tab: string): TabSeriesResult {
  const columns = listStats(tracker).find((s) => s.tab === tab)?.columns ?? [];
  const total: Record<string, DayPoint[]> = {};
  const byPlayer: Record<string, Record<string, DayPoint[]>> = {};
  let players: TabSeriesResult["players"] = [];
  let days: string[] = [];

  for (const column of columns) {
    const s = computeSeries(tracker, tab, column);
    players = s.players;
    days = s.days;
    total[column] = s.total;
    for (const sid of Object.keys(s.byPlayer)) {
      (byPlayer[sid] ??= {})[column] = s.byPlayer[sid];
    }
  }

  return { tab, columns, days, players, total, byPlayer };
}
