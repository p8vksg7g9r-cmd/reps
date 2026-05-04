// Weekly aggregates with week-over-week delta. ISO weeks (Monday start).
import { setVolume } from "./volume.js";

const DAY = 24 * 60 * 60 * 1000;

/** Start of ISO week (Monday 00:00) for a given timestamp, in local TZ. */
export function startOfIsoWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function startOfMonth(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Aggregate sets within [start, end). Returns:
 *   { sessions, exercises, volume }
 */
export function aggregate({ sessions, sets, start, end }) {
  const inRange = sessions.filter((s) => s.startedAt >= start && s.startedAt < end);
  const sessionIds = new Set(inRange.map((s) => s.id));
  const setRows = sets.filter((s) => sessionIds.has(s.sessionId));
  // Sessions span multiple exercises now, so unique exercise count comes from
  // the set rows (which always carry exerciseId), not from a session-level field.
  const exerciseIds = new Set(setRows.map((s) => s.exerciseId));
  let vol = 0;
  for (const s of setRows) vol += setVolume(s);
  return {
    sessions: inRange.length,
    exercises: exerciseIds.size,
    volume: vol
  };
}

/** Current week + previous week aggregates and a delta object. */
export function weeklySummary({ sessions, sets, now = Date.now() }) {
  const thisStart = startOfIsoWeek(now);
  const nextStart = thisStart + 7 * DAY;
  const prevStart = thisStart - 7 * DAY;
  const cur = aggregate({ sessions, sets, start: thisStart, end: nextStart });
  const prev = aggregate({ sessions, sets, start: prevStart, end: thisStart });
  return {
    current: cur,
    previous: prev,
    delta: {
      sessions: cur.sessions - prev.sessions,
      exercises: cur.exercises - prev.exercises,
      volume: cur.volume - prev.volume
    },
    weekStart: thisStart
  };
}

/** Group sessions by local day. Returns [{ dayMs, sessions: [...] }, ...] desc. */
export function groupSessionsByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const d = startOfDay(s.startedAt);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(s);
  }
  const out = [];
  for (const [d, list] of map.entries()) out.push({ dayMs: d, sessions: list.sort((a, b) => b.startedAt - a.startedAt) });
  out.sort((a, b) => b.dayMs - a.dayMs);
  return out;
}
