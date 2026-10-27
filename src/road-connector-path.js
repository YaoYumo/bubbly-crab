// Deterministic endpoint/tangent routing with an arc-length height transition.
// This is a scene-layout tool, not a surveyed civil-engineering alignment solver.
import * as THREE from 'three';
const flat = v => new THREE.Vector3(v.x, 0, v.z).normalize();
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function intersects(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < -1e-7 && cross(c, d, a) * cross(c, d, b) < -1e-7;
}
function outward(anchor, toward, merge) {
  const tangent = flat(anchor.tangent);
  if (anchor.end === 0) return tangent.negate();
  if (anchor.end === 1) return tangent;
  const normal = anchor.outwardNormal ? flat(anchor.outwardNormal) : new THREE.Vector3(tangent.z, 0, -tangent.x);
  if (!anchor.outwardNormal && normal.dot(toward) < 0) normal.negate();
  if (!merge) return normal;
  // Choose the along-road component toward the other anchor, not always +tangent.
  // The latter can point away from the destination and create a hook/U-shaped ramp.
  const along = tangent.dot(toward) < 0 ? -1 : 1;
  return normal.multiplyScalar(.6).addScaledVector(tangent, .8 * along).normalize();
}
export function automaticRoadPath(a, b, { halfWidth = 4, maxGrade = .18, accept = () => true, terrainHeight = null, halfExtent = Infinity } = {}) {
  const A = new THREE.Vector3(...a.position), B = new THREE.Vector3(...b.position);
  const delta = B.clone().sub(A).setY(0), distance = delta.length();
  if (distance < 3) throw new Error('两点平面距离过短或两路已经相接；请选择沿道路错开的连接点。');
  const forward = delta.clone().normalize(), normal = new THREE.Vector3(forward.z, 0, -forward.x);
  const merge = !!(a.freeway || b.freeway);
  const da = outward(a, forward, merge), db = outward(b, forward.clone().negate(), merge);
  if(da.dot(forward)<-.025||db.dot(forward)>.025)throw new Error('接点方向要求回头绕行。请选择顺向接点；不会强行生成 U 形大环线。');
  const handle = Math.max(4, Math.min(80, distance * .36));
  const base = new THREE.CubicBezierCurve3(A.clone().setY(0), A.clone().setY(0).addScaledVector(da, handle), B.clone().setY(0).addScaledVector(db, handle), B.clone().setY(0));
  let best = null;
  // Only small clearance bows are allowed. A short steep ramp must use a more
  // distant host-road station (road mode), or fail; never invent a giant loop.
  for (const amplitude of [0, .1, -.1, .2, -.2].map(x => x * distance)) {
    const count = Math.min(256, Math.max(48, Math.ceil((distance + Math.abs(amplitude) * 2) / 2)));
    const points = Array.from({ length: count + 1 }, (_, i) => base.getPoint(i / count).addScaledVector(normal, amplitude * Math.sin(Math.PI * i / count) ** 2));
    const stations = [0]; let valid = true, radius = Infinity, totalTurn = 0;
    for (let i = 1; i < points.length; i++) {
      const len = points[i].distanceTo(points[i - 1]);
      if (len < .025 || Math.max(Math.abs(points[i].x), Math.abs(points[i].z)) + halfWidth > halfExtent) { valid = false; break; }
      const advance=points[i].clone().sub(points[i-1]).dot(forward)/len;
      if(advance<-.025){valid=false;break;}
      stations.push(stations.at(-1) + len);
      if (i > 1) {
        const u = points[i].clone().sub(points[i - 1]), v = points[i - 1].clone().sub(points[i - 2]);
        const angle = u.angleTo(v); totalTurn += angle;
        if (angle > 1e-5) radius = Math.min(radius, (u.length() + v.length()) / (2 * angle));
      }
    }
    if (!valid || radius < Math.max(3, halfWidth * 1.2) || stations.at(-1)>distance*1.35 || totalTurn>(merge?Math.PI*.75:Math.PI)) continue;
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
    if (!best || score < best.score) best = { points: points.map(p => p.toArray()), length, maxGrade: steepest, minRadius: radius, detourRatio: length/distance, totalTurn, score };
    if (amplitude === 0 && best) break;
  }
  if (!best) throw new Error('当前接点之间没有找到满足转弯、坡度与净空限制的连接。请选择沿路更远的顺向接点；不强行绕大圈，原道路未修改。');
  return best;
}
