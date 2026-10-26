import * as THREE from "three";
import { motionProgress } from "./motion-schedule.js";
export function actorFaceOffset(actor) {
  const value = actor.motion?.faceOffset;
  const xForward =
    actor.root?.userData.forwardAxis === "+x" ||
    /^env:(car|bus):/.test(actor.key || "");
  // Older AI scene imports wrote 0 even when no offset was authored. Treat
  // that legacy default as automatic for +X vehicles; retain explicit opt-out.
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (value !== 0 || !xForward || actor.motion?.faceOffsetMode === "manual")
  )
    return value;
  return xForward ? -Math.PI / 2 : 0;
}
// Sample the same time/easing/arc/schedule as position, not raw curve parameter u.
// Works with non-uniform key times, holds, eased motion and scheduled traffic.
export function actorTangent(motion, u, out = new THREE.Vector3()) {
  const progress = motionProgress(motion, u),
    options = {
      ease: motion.easing || "linear",
      scope: motion.scope || "global",
      arc: motion.arc !== false,
      tension: motion.tension ?? 0.5,
      progCurve: motion.curvePts || null,
    };
  const sample = (t) =>
    motion.mover.sample(
      t,
      { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null },
      "linear",
      options,
    )?.p;
  const before = sample(Math.max(0, progress - 0.0001)),
    after = sample(Math.min(1, progress + 0.0001));
  if (!before || !after) return out.set(0, 0, 0);
  out.subVectors(after, before);
  out.y = 0;
  return out.lengthSq() > 1e-12 ? out.normalize() : out.set(0, 0, 0);
}

const pathDistanceCache = new WeakMap();
export function actorMotionDistance(motion, u) {
  const mover = motion.mover,
    signature = JSON.stringify([
      motion.easing,
      motion.scope,
      motion.arc,
      motion.curvePts,
    ]);
  let cached = pathDistanceCache.get(mover);
  if (!cached || cached.signature !== signature) {
    const options = {
      ease: motion.easing || "linear",
      scope: motion.scope || "global",
      arc: motion.arc !== false,
      progCurve: motion.curvePts || null,
    };
    const distances = [0];
    let prev = null,
      total = 0;
    for (let i = 0; i <= 192; i++) {
      const point = mover.sample(i / 192, undefined, "linear", options).p;
      if (prev) total += point.distanceTo(prev);
      prev = point.clone();
      if (i) distances.push(total);
    }
    cached = { signature, distances };
    pathDistanceCache.set(mover, cached);
  }
  const x = Math.max(0, Math.min(1, motionProgress(motion, u))) * 192,
    i = Math.min(191, Math.floor(x));
  return (
    cached.distances[i] +
    (cached.distances[i + 1] - cached.distances[i]) * (x - i)
  );
}
