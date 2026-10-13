// 纯 node：生成器的数学部分回归（地形/路网/地块/泊松），不碰 three 与 DOM
// 用法：node test/townbuild.mjs
import {
  makeValueNoise2, fbm2, makeHeightField, layoutRoads, layoutParcels,
  scatterTrees, poissonDisc, polyInfo, distToPoly,
} from '../src/townbuild.js';
import { normalizeSchema } from '../src/towngen.js';
import { makeRng } from '../src/util.js';

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
};

// ---------- 噪声 / fBm ----------
const n1 = makeValueNoise2(1234), n2 = makeValueNoise2(1234), n3 = makeValueNoise2(99);
ok('noise 同种子一致', [n1(3.5, -2.25), n1(0, 0)] .join() === [n2(3.5, -2.25), n2(0, 0)].join());
ok('noise 不同种子不同', n1(7.25, 1.75) !== n3(7.25, 1.75));
ok('noise 值域 [-1,1]', (() => { let lo = 9, hi = -9; for (let i = 0; i < 4000; i++) { const v = n1(i * 0.37, i * 0.11); lo = Math.min(lo, v); hi = Math.max(hi, v); } return lo >= -1.0001 && hi <= 1.0001 && hi > 0.2; })());
ok('fbm 振幅被归一化', Math.abs(fbm2(n1, 1.3, 4.7, 5)) <= 1.0001);

// ---------- 高度场（#79）----------
const flat = normalizeSchema({ seed: 5, terrain: { amplitude: 0, roughness: 0.5 } });
const hfFlat = makeHeightField(flat);
ok('amplitude=0 → 全平', [hfFlat(0, 0), hfFlat(37, -12), hfFlat(-80, 80)].every((v) => v === 0));

const hill = normalizeSchema({ seed: 5, mapSize: 256, terrain: { amplitude: 6, roughness: 0.55 } });
const hf = makeHeightField(hill);
let mx = 0;
for (let i = 0; i < 3000; i++) { const x = (Math.random() * 2 - 1) * 128, z = (Math.random() * 2 - 1) * 128; mx = Math.max(mx, Math.abs(hf(x, z))); }
ok('起伏不超过 amplitude×1.3', mx <= 6 * 1.3, `max=${mx.toFixed(2)}`);
ok('边缘渐衰到 ~0', Math.abs(hf(128, 40)) < 0.35 && Math.abs(hf(-128, -60)) < 0.35, `edge=${hf(128, 40).toFixed(3)}`);
ok('中心确实有起伏', Math.abs(hf(20, -15)) > 0.05 || Math.abs(hf(-40, 30)) > 0.05);
ok('高度场确定性', hf(11, 22) === makeHeightField(normalizeSchema({ seed: 5, mapSize: 256, terrain: { amplitude: 6, roughness: 0.55 } }))(11, 22));

// ---------- 路网（#80）----------
for (const topo of ['spine_and_loop', 'grid', 'axis', 'radial']) {
  const s = normalizeSchema({ seed: 77, mapSize: 256, roadTopology: topo });
  const roads = layoutRoads(s);
  const inb = roads.every((r) => r.pts.every(([x, z]) => Math.abs(x) <= 128 && Math.abs(z) <= 128));
  ok(`${topo}: 路条数 ${roads.length} 合理`, roads.length >= 3 && roads.length <= 24, `${roads.length}`);
  ok(`${topo}: 全部在地图内`, inb);
  ok(`${topo}: 每条至少 2 点`, roads.every((r) => r.pts.length >= 2));
  ok(`${topo}: 主干道宽 9`, roads.some((r) => r.width === 9));
}

// 同种子同路网，换种子必换
const ra = layoutRoads(normalizeSchema({ seed: 77, mapSize: 256 }));
const rb = layoutRoads(normalizeSchema({ seed: 77, mapSize: 256 }));
const rc = layoutRoads(normalizeSchema({ seed: 78, mapSize: 256 }));
ok('路网可复现', JSON.stringify(ra) === JSON.stringify(rb));
ok('换种子换路网', JSON.stringify(ra) !== JSON.stringify(rc));

// 中轴对称（长安/北京式）：成对镜像 + 可复现 + 换种子仍变（间距抖动/皇城环）
const axA = layoutRoads(normalizeSchema({ seed: 77, mapSize: 256, roadTopology: 'axis' }));
const axB = layoutRoads(normalizeSchema({ seed: 77, mapSize: 256, roadTopology: 'axis' }));
const axC = layoutRoads(normalizeSchema({ seed: 78, mapSize: 256, roadTopology: 'axis' }));
ok('axis 可复现', JSON.stringify(axA) === JSON.stringify(axB));
ok('axis 换种子换路网', JSON.stringify(axA) !== JSON.stringify(axC));
ok('axis 有中轴大道与东西大街', axA.some((r) => r.name === '中轴大道') && axA.some((r) => r.name === '东西大街'));
const vLn = axA.filter((r) => r.name === '南北向道路');
ok('axis 南北街关于中轴镜像', vLn.length >= 2 && vLn.every((r) => vLn.some((q) => Math.abs(q.pts[0][0] + r.pts[0][0]) < 1e-6)), `n=${vLn.length}`);
const hLn = axA.filter((r) => r.name === '东西向道路');
ok('axis 东西街关于横轴镜像', hLn.length >= 2 && hLn.every((r) => hLn.some((q) => Math.abs(q.pts[0][1] + r.pts[0][1]) < 1e-6)), `n=${hLn.length}`);

// ---------- 地块（#80）----------
const S = 256;
const sA = normalizeSchema({ seed: 4242, mapSize: S, density: 0.5 });
const roadsA = layoutRoads(sA);
const hfA = makeHeightField(sA);
const parcels = layoutParcels(sA, roadsA, hfA);
ok('地块数量合理', parcels.length >= 15 && parcels.length <= 200, `n=${parcels.length}`);
ok('地块都在地图内', parcels.every((p) => Math.abs(p.x) <= S / 2 - 13 && Math.abs(p.z) <= S / 2 - 13));
// 宅前连接信息（基座/小径用）：front 必须落在某条道路中心线上，dir 背离道路、tan 沿路
ok('地块带宅前连接信息', parcels.every((p) => Array.isArray(p.front) && Array.isArray(p.dir) && Array.isArray(p.tan) && p.roadW > 0));
ok('front 点落在道路中心线上', parcels.every((p) => Math.min(...roadsA.map((r) => distToPoly(polyInfo(r.pts), p.front[0], p.front[1]))) < 0.01));
ok('dir/tan 是单位向量且正交', parcels.every((p) => Math.abs(Math.hypot(...p.dir) - 1) < 1e-6 && Math.abs(Math.hypot(...p.tan) - 1) < 1e-6 && Math.abs(p.dir[0] * p.tan[0] + p.dir[1] * p.tan[1]) < 1e-6));

let minPair = Infinity;
for (let i = 0; i < parcels.length; i++) {
  for (let j = i + 1; j < parcels.length; j++) minPair = Math.min(minPair, Math.hypot(parcels[i].x - parcels[j].x, parcels[i].z - parcels[j].z));
}
ok('地块互不重叠（间距 ≥10m）', minPair >= 10, `minPair=${minPair.toFixed(2)}`);

// 退让：地块中心到最近道路中心线 ≥ 半路宽 + 5m
let worstSetback = Infinity;
for (const p of parcels) {
  let d = Infinity;
  for (const r of roadsA) d = Math.min(d, distToPoly(polyInfo(r.pts), p.x, p.z) - r.width / 2);
  worstSetback = Math.min(worstSetback, d);
}
ok('退让 ≥5m（不压路面）', worstSetback >= 5, `worst=${worstSetback.toFixed(2)}`);

// 建筑四角也不能伸进任何路面（含横向交叉的路）
let worstCorner = Infinity;
for (const p of parcels) {
  const fx = Math.sin(p.rotY), fz = Math.cos(p.rotY);   // 正面方向（朝路）
  const nx = -fx, nz = -fz;                              // 进深轴 = 道路法向
  const lx = fz, lz = -fx;                               // 面宽轴 = 道路切向
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const qx = p.x + lx * su * p.w / 2 + nx * sv * p.d / 2;
    const qz = p.z + lz * su * p.w / 2 + nz * sv * p.d / 2;
    let c = Infinity;
    for (const r of roadsA) c = Math.min(c, distToPoly(polyInfo(r.pts), qx, qz) - r.width / 2);
    worstCorner = Math.min(worstCorner, c);
  }
}
ok('建筑四角不压路面', worstCorner >= 1.2, `worst=${worstCorner.toFixed(2)}`);

// 坡度过滤：陡地上不放房子
ok('坡度都被过滤', parcels.every((p) => p.slope <= 0.35), `maxSlope=${Math.max(...parcels.map((p) => p.slope)).toFixed(3)}`);

// 朝向：每栋房子都必须正对某条路（最近的那条不一定是它面朝的那条，路口处尤其如此）
let worstFace = 0;
for (const p of parcels) {
  const fx = Math.sin(p.rotY), fz = Math.cos(p.rotY);
  let best = Infinity;
  for (const r of roadsA) {
    const near = nearestOn(polyInfo(r.pts), p.x, p.z);
    const d = Math.hypot(near.x - p.x, near.z - p.z);
    if (d < 1e-6) { best = 0; continue; }
    const dot = ((near.x - p.x) * fx + (near.z - p.z) * fz) / d;   // 1 = 正面直对该路
    best = Math.min(best, Math.acos(Math.max(-1, Math.min(1, dot))));
  }
  worstFace = Math.max(worstFace, best);
}
ok('每栋房子都正对某条路（<60°）', worstFace < Math.PI / 3, `worst=${(worstFace * 180 / Math.PI).toFixed(1)}°`);

function nearestOn(info, x, z) {
  let best = Infinity, out = { x: 0, z: 0 };
  const { pts } = info;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) { best = d; out = { x: ax + vx * t, z: az + vz * t }; }
  }
  return out;
}

// zoning
const pure = layoutParcels(normalizeSchema({ seed: 4242, mapSize: S, zoning: { commercialRatio: 0 } }), roadsA, hfA);
ok('纯住宅 → 无商业地块', pure.every((p) => p.kind !== 'commercial'));
const biz = normalizeSchema({ seed: 4242, mapSize: S, zoning: { commercialRatio: 0.6 } });
const bizP = layoutParcels(biz, layoutRoads(biz), hfA);
ok('商业 60% → 出现商业地块', bizP.some((p) => p.kind === 'commercial'), `n=${bizP.filter((p) => p.kind === 'commercial').length}`);
ok('有 civic 地块', parcels.some((p) => p.kind === 'civic'));

// ---------- 泊松圆盘（#81）----------
const rng = makeRng(20261009);
const pts = poissonDisc(rng, 200, 12, 200);
ok('泊松填充率 ≥60% 上限', pts.length >= 120 && pts.length <= 200, `n=${pts.length}`);
let minD = Infinity;
for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
ok('泊松最小间距成立', minD >= 12 - 1e-6, `minD=${minD.toFixed(2)}`);
ok('泊松点都在范围内', pts.every(([x, z]) => Math.abs(x) <= 100 && Math.abs(z) <= 100));

// 树：排除道路走廊与地块
const trees = scatterTrees(sA, roadsA, parcels, hfA);
ok('树数量合理', trees.length > 0 && trees.length <= 90, `n=${trees.length}`);
ok('树不压路', trees.every(([x, z]) => roadsA.every((r) => distToPoly(polyInfo(r.pts), x, z) >= r.width / 2 + 3.4)));
ok('树不压地块', trees.every(([x, z]) => parcels.every((p) => Math.hypot(p.x - x, p.z - z) >= Math.max(p.w, p.d) * 0.8 + 2.9)));
const noVeg = normalizeSchema({ seed: 4242, mapSize: S, vegetationDensity: 0 });
ok('植被 0 → 不种树', scatterTrees(noVeg, roadsA, parcels, hfA).length === 0);
const lush = normalizeSchema({ seed: 4242, mapSize: S, vegetationDensity: 0.85 });
ok('植被茂密 → 树更多', scatterTrees(lush, roadsA, parcels, hfA).length >= trees.length, `${scatterTrees(lush, roadsA, parcels, hfA).length} vs ${trees.length}`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
