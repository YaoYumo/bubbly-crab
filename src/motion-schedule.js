// Optional path timing. Existing motions (including speed = gait speed) are unchanged.
export function validMotionSchedule(s) {
  return (
    !!s &&
    typeof s.rate === "number" &&
    Number.isFinite(s.rate) &&
    s.rate >= 0.5 &&
    s.rate <= 2 &&
    typeof s.phase === "number" &&
    Number.isFinite(s.phase) &&
    s.phase >= 0 &&
    s.phase < 1 &&
    Object.keys(s).every((k) => ["rate", "phase"].includes(k))
  );
}
export function motionProgress(m, u) {
  if (!validMotionSchedule(m?.schedule)) return u;
  const t = u * m.schedule.rate + m.schedule.phase;
  return ((t % 1) + 1) % 1;
}
