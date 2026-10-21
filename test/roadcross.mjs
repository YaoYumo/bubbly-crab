// 路网交叉质量量化（长期回归项）：正交口 ≥50° / 斜交叉 <50° / 断头端点
// 用法：node test/roadcross.mjs
import { layoutRoads } from '../src/townbuild.js';
import { normalizeSchema } from '../src/towngen.js';

function segX(a1, a2, b1, b2) {
  const r = [a2[0] - a1[0], a2[1] - a1[1]], s = [b2[0] - b1[0], b2[1] - b1[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const q = [b1[0] - a1[0], b1[1] - a1[1]];
  const t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
  if (t < 1e-6 || t > 1 - 1e-6 || u < 1e-6 || u > 1 - 1e-6) return null;
  let ang = Math.abs(Math.atan2(r[1], r[0]) - Math.atan2(s[1], s[0])) % Math.PI;
  if (ang > Math.PI / 2) ang = Math.PI - ang;
  return ang * 180 / Math.PI;
}
const ptSeg = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
};
function survey(topo, seed) {
  const s = normalizeSchema({ seed, mapSize: 512, roadTopology: topo });
  const roads = layoutRoads(s);
  const half = s.mapSize / 2, M = Math.max(10, s.mapSize * 0.05), edge = half - M - 1;
  let ortho = 0, oblique = 0, dangling = 0;
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++)
    for (const A of roads[i].pts.slice(0, -1).map((p, k) => [p, roads[i].pts[k + 1]]))
      for (const B of roads[j].pts.slice(0, -1).map((p, k) => [p, roads[j].pts[k + 1]])) {
        const a = segX(A[0], A[1], B[0], B[1]);
        if (a === null) continue;
        if (a >= 50) ortho++; else oblique++;
      }
  for (let i = 0; i < roads.length; i++) for (const ep of [roads[i].pts[0], roads[i].pts.at(-1)]) {
    if (Math.abs(ep[0]) >= edge || Math.abs(ep[1]) >= edge) continue;      // 接到地图边界
    if (ptSeg(ep, roads[i].pts[0], roads[i].pts.at(-1)) < 1) continue;     // 闭合环自身端点重合，不算断头
    let d = 1e9;
    for (let j = 0; j < roads.length; j++) { if (j === i) continue;
      for (let k = 0; k < roads[j].pts.length - 1; k++) d = Math.min(d, ptSeg(ep, roads[j].pts[k], roads[j].pts[k + 1])); }
    if (d > 4) dangling++;                                                 // 既不靠边、也不挨着别的路 → 断头/悬空
  }
  return { n: roads.length, ortho, oblique, dangling };
}
let bad = 0;
console.log('拓扑'.padEnd(18), '路数  正交口  斜交叉  断头');
for (const topo of ['grid', 'axis', 'spine_and_loop', 'radial']) {
  const acc = { n: 0, ortho: 0, oblique: 0, dangling: 0 };
  for (const seed of [5, 11, 42]) { const r = survey(topo, seed); for (const k in acc) acc[k] += r[k]; }
  console.log(topo.padEnd(18), (acc.n / 3).toFixed(1).padStart(4), String(acc.ortho).padStart(6), String(acc.oblique).padStart(6), String(acc.dangling).padStart(6));
  if (acc.oblique > 0 || acc.dangling > 0) bad++;
}
console.log(bad ? '存在斜交叉或断头（见上）' : 'ALL CLEAN：无斜交叉、无断头');
process.exitCode = bad ? 1 : 0;
