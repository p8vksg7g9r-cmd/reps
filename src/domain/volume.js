// Per-set-type volume math.
//
// A "set" record:
//   { setType, weight, reps, side?, round, ... }
//
// Volume rules:
//   standard   → weight × reps
//   bilateral  → weight × reps × 2  (one rep count per round, doubled for L+R)
//   continuous → weight × reps      (single block; if bodyweight, weight may be 0)

export function setVolume(set) {
  if (!set) return 0;
  const w = Number(set.weight) || 0;
  const r = Number(set.reps) || 0;
  if (set.setType === "bilateral") return w * r * 2;
  return w * r;
}

export function totalVolume(sets) {
  return sets.reduce((sum, s) => sum + setVolume(s), 0);
}
