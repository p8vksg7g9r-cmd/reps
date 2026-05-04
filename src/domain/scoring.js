// Pure functions: 1RM estimation, percentile lookup, level classification.
import { STANDARDS, LEVELS, interpolateRow } from "../data/strength-standards.js";

/** Epley estimated 1RM. weight × (1 + reps/30). Clamps reps ≥ 1. */
export function epley(weight, reps) {
  if (!weight || !reps || reps < 1) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Best estimated 1RM across an array of {weight, reps}. */
export function bestE1RM(sets) {
  let best = 0;
  for (const s of sets) {
    const e = epley(s.weight, s.reps);
    if (e > best) best = e;
  }
  return best;
}

/**
 * Score a 1RM against the standards table.
 * Returns { level, percentile, nextLevel, kgToNext, row } or
 * { unavailable: true } when no benchmark exists.
 */
export function scoreLift({ standardKey, sex, bodyweightKg, e1rm }) {
  if (!standardKey || !STANDARDS[standardKey] || !sex || !bodyweightKg) {
    return { unavailable: true };
  }
  const rows = STANDARDS[standardKey][sex];
  if (!rows) return { unavailable: true };
  const row = interpolateRow(rows, bodyweightKg);
  if (!row) return { unavailable: true };

  const thresholds = [
    { name: "Untrained",    min: 0,        max: row.beg },
    { name: "Beginner",     min: row.beg,  max: row.nov },
    { name: "Novice",       min: row.nov,  max: row.int },
    { name: "Intermediate", min: row.int,  max: row.adv },
    { name: "Advanced",     min: row.adv,  max: row.eli },
    { name: "Elite",        min: row.eli,  max: Infinity }
  ];

  let level = "Untrained";
  let bandIdx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (e1rm >= thresholds[i].min) { level = thresholds[i].name; bandIdx = i; }
  }

  // Percentile: rough mapping of band → midpoint percentile.
  // Beginner~10, Novice~30, Intermediate~50, Advanced~75, Elite~95.
  const bandPct = [0, 10, 30, 50, 75, 95];
  const lo = bandPct[bandIdx];
  const hi = bandIdx < 5 ? bandPct[bandIdx + 1] : 100;
  const band = thresholds[bandIdx];
  const span = band.max === Infinity ? 1 : (band.max - band.min);
  const within = band.max === Infinity ? 1 : Math.min(1, Math.max(0, (e1rm - band.min) / span));
  const percentile = Math.round(lo + (hi - lo) * within);

  const nextLevel = bandIdx < 5 ? LEVELS[bandIdx + 1] : null;
  const kgToNext = nextLevel ? Math.max(0, band.max - e1rm) : 0;

  return { level, percentile, nextLevel, kgToNext, row };
}
