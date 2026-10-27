// Deterministic endpoint/tangent routing with an arc-length height transition.
// This is a scene-layout tool, not a surveyed civil-engineering alignment solver.
import * as THREE from 'three';
const flat = v => new THREE.Vector3(v.x, 0, v.z).normalize();
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function intersects(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < -1e-7 && cross(c, d, a) * cross(c, d, b) < -1e-7;
}
function outward(anchor, toward) {
  const tangent = flat(anchor.tangent);
  if (anchor.end === 0) return tangent.negate();
  if (anchor.end === 1) return tangent;
  const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
  if (normal.dot(toward) < 0) normal.negate();
  // A sizeable incidence angle keeps the merge compact, particularly at highways.
  return normal.multiplyScalar(anchor.freeway ? .6 : 1).addScaledVector(tangent, anchor.freeway ? .8 : 0).normalize();
}
export function automaticRoadPath(a, b, { halfWidth = 4, maxGrade = .18, accept = () => true, terrainHeight = null, halfExtent = Infinity } = {}) {
  const A = new THREE.Vector3(...a.position), B = new THREE.Vector3(...b.position);
  const delta = B.clone().sub(A).setY(0), distance = delta.length();
  if (distance < 3) throw new Error('两点平面距离过短或两路已经相接；请选择沿道路错开的连接点。');
  const forward = delta.clone().normalize(), normal = new THREE.Vector3(forward.z, 0, -forward.x);
  const da = outward(a, forward), db = outward(b, forward.clone().negate());
  const handle = Math.max(4, Math.min(80, distance * .36));
  const base = new THREE.CubicBezierCurve3(A.clone().setY(0), A.clone().setY(0).addScaledVector(da, handle), B.clone().setY(0).addScaledVector(db, handle), B.clone().setY(0));
  let best = null;
  // Lateral bows extend short ramps automatically rather than asking for more points.
  for (const amplitude of [0, .25, -.25, .5, -.5, 1, -1, 1.6, -1.6, 2.2, -2.2].map(x => x * Math.max(distance, 25))) {
    const count = Math.min(256, Math.max(48, Math.ceil((distance + Math.abs(amplitude) * 2) / 2)));
    const points = Array.from({ length: count + 1 }, (_, i) => base.getPoint(i / count).addScaledVector(normal, amplitude * Math.sin(Math.PI * i / count) ** 2));
    const stations = [0]; let valid = true, radius = Infinity;
    for (let i = 1; i < points.length; i++) {
      const len = points[i].distanceTo(points[i - 1]);
      if (len < .025 || Math.max(Math.abs(points[i].x), Math.abs(points[i].z)) + halfWidth > halfExtent) { valid = false; break; }
      stations.push(stations.at(-1) + len);
      if (i > 1) {
        const u = points[i].clone().sub(points[i - 1]), v = points[i - 1].clone().sub(points[i - 2]);
        const angle = u.angleTo(v);
        if (angle > 1e-5) radius = Math.min(radius, (u.length() + v.length()) / (2 * angle));
      }
    }
    if (!valid || radius < Math.max(3, halfWidth * 1.2)) continue;
    for (let i = 1; valid && i < points.length; i++) for (let j = i + 3; j < points.length; j++) {
      if (intersects(points[i - 1], points[i], points[j - 1], points[j])) { valid = false; break; }
    }
    if (!valid) continue;
    const length = stations.at(-1), dy = B.y - A.y;
    // Endpoint grade is retained on sloped host roads. Clamp only in the direction
    // of the net rise to avoid height overshoot in the interpolated ramp.
    const grade = (anchor, sign) => anchor.end === undefined ? 0 : anchor.tangent.y / (Math.hypot(anchor.tangent.x, anchor.tangent.z) || 1) * sign * (anchor.end === 0 ? -1 : 1);
    const limit = Math.abs(dy) < 1e-6 ? 0 : 3 * Math.abs(dy) / length;
    const bounded = g => Math.sign(g) === Math.sign(dy) ? Math.sign(g) * Math.min(Math.abs(g), limit) : 0;
    const ga = bounded(grade(a, 1)), gb = bounded(grade(b, -1));
    let steepest = 0;
    for (let i = 0; i < points.length; i++) {
      const t = stations[i] / length, t2 = t * t, t3 = t2 * t;
      points[i].y = (2 * t3 - 3 * t2 + 1) * A.y + (t3 - 2 * t2 + t) * length * ga + (-2 * t3 + 3 * t2) * B.y + (t3 - t2) * length * gb;
      if (terrainHeight && i && i < points.length - 1) {
        const p = points[i], required = terrainHeight(p.x, p.z) + .02;
        points[i].y = Math.max(points[i].y, required);
      }
      if (i) steepest = Math.max(steepest, Math.abs(points[i].y - points[i - 1].y) / (stations[i] - stations[i - 1]));
    }
    points[0].copy(A); points.at(-1).copy(B);
    if (steepest > maxGrade + .002 || !accept(points, stations, halfWidth)) continue;
    const score = length + Math.abs(amplitude) * .1;
    if (!best || score < best.score) best = { points: points.map(p => p.toArray()), length, maxGrade: steepest, minRadius: radius, score };
    if (amplitude === 0 && best) break;
  }
  if (!best) throw new Error('当前接点之间没有找到满足转弯、坡度与净空限制的连接。请换选更远或另一侧的接点；原道路未修改。');
  return best;
}
