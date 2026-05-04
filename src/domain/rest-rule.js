// 7-day per-exercise rest rule. Soft warning, override allowed.
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function restState(lastPerformedAt, now = Date.now()) {
  if (!lastPerformedAt) return { resting: false, daysLeft: 0 };
  const elapsed = now - lastPerformedAt;
  if (elapsed >= SEVEN_DAYS) return { resting: false, daysLeft: 0 };
  const remainingMs = SEVEN_DAYS - elapsed;
  const daysLeft = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return { resting: true, daysLeft };
}
