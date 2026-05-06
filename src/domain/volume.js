// Per-set-type volume math.
//
// A "set" record:
//   { setType, weight, reps, side?, round, metrics?, ... }
//
// Volume rules:
//   standard / six_ten / ninety_bilateral → weight × reps
//   bilateral                             → weight × reps × 2 (L+R combined)
//   continuous                            → weight × reps     (single block)
//   cardio_swim / cardio_bike             → 0 (excluded from training load)

export function isCardioSetType(setType) {
  return setType === "cardio_swim" || setType === "cardio_bike";
}

export function setVolume(set) {
  if (!set) return 0;
  if (isCardioSetType(set.setType)) return 0;
  const w = Number(set.weight) || 0;
  const r = Number(set.reps) || 0;
  if (set.setType === "bilateral") return w * r * 2;
  return w * r;
}

export function totalVolume(sets) {
  return sets.reduce((sum, s) => sum + setVolume(s), 0);
}
