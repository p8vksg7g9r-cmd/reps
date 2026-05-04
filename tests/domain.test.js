// Pure-function tests for the domain layer. Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { epley, bestE1RM, scoreLift } from "../src/domain/scoring.js";
import { setVolume, totalVolume } from "../src/domain/volume.js";
import { restState } from "../src/domain/rest-rule.js";
import { weeklySummary, startOfIsoWeek, groupSessionsByDay } from "../src/domain/week.js";

/* --------------------- epley / bestE1RM --------------------- */

test("epley: 1 rep returns weight unchanged", () => {
  assert.equal(epley(100, 1), 100);
});

test("epley: classic example 100kg × 5 → ~116.67", () => {
  assert.ok(Math.abs(epley(100, 5) - 116.6667) < 0.01);
});

test("epley: zero weight or zero reps → 0", () => {
  assert.equal(epley(0, 5), 0);
  assert.equal(epley(100, 0), 0);
});

test("bestE1RM picks the highest across sets", () => {
  const sets = [
    { weight: 80, reps: 10 },  // 80 * (1 + 10/30) ≈ 106.67
    { weight: 100, reps: 3 },  // 100 * (1 + 3/30) = 110
    { weight: 60, reps: 15 }   // 60 * 1.5 = 90
  ];
  const e = bestE1RM(sets);
  assert.ok(Math.abs(e - 110) < 1e-9);
});

/* --------------------- scoreLift --------------------- */

test("scoreLift: returns unavailable when no standardKey", () => {
  const s = scoreLift({ standardKey: null, sex: "male", bodyweightKg: 80, e1rm: 100 });
  assert.equal(s.unavailable, true);
});

test("scoreLift: lat pulldown @80kg male, e1rm 50 lands in Beginner band", () => {
  const s = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 80, e1rm: 50 });
  assert.equal(s.unavailable, undefined);
  assert.equal(s.level, "Beginner");
  assert.equal(s.nextLevel, "Novice");
  assert.ok(s.kgToNext > 0);
});

test("scoreLift: lat pulldown @80kg male, very high e1rm → Elite, no nextLevel", () => {
  const s = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 80, e1rm: 250 });
  assert.equal(s.level, "Elite");
  assert.equal(s.nextLevel, null);
  assert.equal(s.kgToNext, 0);
});

test("scoreLift: bodyweight outside table clamps to nearest row", () => {
  const sLow = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 40, e1rm: 50 });
  const sHigh = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 200, e1rm: 50 });
  assert.equal(sLow.unavailable, undefined);
  assert.equal(sHigh.unavailable, undefined);
});

test("scoreLift: percentile increases with e1rm in same band", () => {
  const a = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 80, e1rm: 70 });
  const b = scoreLift({ standardKey: "lat_pulldown", sex: "male", bodyweightKg: 80, e1rm: 88 });
  assert.ok(b.percentile > a.percentile);
});

/* --------------------- volume --------------------- */

test("setVolume standard: weight × reps", () => {
  assert.equal(setVolume({ setType: "standard", weight: 60, reps: 10 }), 600);
});

test("setVolume bilateral: weight × reps × 2 (L+R)", () => {
  assert.equal(setVolume({ setType: "bilateral", weight: 20, reps: 10 }), 400);
});

test("setVolume continuous: weight × reps", () => {
  assert.equal(setVolume({ setType: "continuous", weight: 16, reps: 50 }), 800);
});

test("totalVolume sums correctly", () => {
  const sets = [
    { setType: "standard", weight: 60, reps: 10 },
    { setType: "bilateral", weight: 20, reps: 8 }
  ];
  assert.equal(totalVolume(sets), 600 + 320);
});

/* --------------------- rest rule --------------------- */

test("restState: never performed → not resting", () => {
  assert.deepEqual(restState(null), { resting: false, daysLeft: 0 });
});

test("restState: performed today → resting with 7 days left", () => {
  const now = Date.now();
  const r = restState(now, now);
  assert.equal(r.resting, true);
  assert.equal(r.daysLeft, 7);
});

test("restState: performed 8 days ago → not resting", () => {
  const now = Date.now();
  const r = restState(now - 8 * 86400000, now);
  assert.equal(r.resting, false);
});

test("restState: performed 6 days ago → 1 day left", () => {
  const now = Date.now();
  const r = restState(now - 6 * 86400000, now);
  assert.equal(r.resting, true);
  assert.equal(r.daysLeft, 1);
});

/* --------------------- week aggregates --------------------- */

test("startOfIsoWeek lands on Monday 00:00", () => {
  // 2026-05-04 is a Monday
  const monday = new Date(2026, 4, 4, 14, 30).getTime();
  const start = startOfIsoWeek(monday);
  const d = new Date(start);
  assert.equal(d.getDay(), 1);          // Monday
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test("weeklySummary: counts sessions and computes WoW delta", () => {
  const now = new Date(2026, 4, 6, 10, 0).getTime(); // Wed
  const thisWeekStart = startOfIsoWeek(now);
  const lastWeekStart = thisWeekStart - 7 * 86400000;

  // Sessions span multiple exercises now; the aggregate derives the unique
  // exercise count from set rows (sets always carry exerciseId).
  const sessions = [
    { id: 1, startedAt: thisWeekStart + 3600000 },
    { id: 2, startedAt: thisWeekStart + 2 * 86400000 },
    { id: 3, startedAt: lastWeekStart + 86400000 }
  ];
  const sets = [
    { sessionId: 1, exerciseId: 10, setType: "standard", weight: 50, reps: 10 },
    { sessionId: 1, exerciseId: 10, setType: "standard", weight: 50, reps: 8 },
    { sessionId: 2, exerciseId: 11, setType: "bilateral", weight: 20, reps: 10 },
    { sessionId: 3, exerciseId: 10, setType: "standard", weight: 40, reps: 10 }
  ];
  const sum = weeklySummary({ sessions, sets, now });
  assert.equal(sum.current.sessions, 2);
  assert.equal(sum.current.exercises, 2);
  assert.equal(sum.current.volume, 50 * 10 + 50 * 8 + 20 * 10 * 2);
  assert.equal(sum.previous.sessions, 1);
  assert.equal(sum.delta.sessions, 1);
});

test("groupSessionsByDay buckets correctly, sorted desc", () => {
  const a = new Date(2026, 4, 6, 8).getTime();
  const b = new Date(2026, 4, 6, 18).getTime();
  const c = new Date(2026, 4, 4, 9).getTime();
  const groups = groupSessionsByDay([
    { id: 1, startedAt: a }, { id: 2, startedAt: b }, { id: 3, startedAt: c }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].sessions.length, 2);
  assert.ok(groups[0].dayMs > groups[1].dayMs);
});
