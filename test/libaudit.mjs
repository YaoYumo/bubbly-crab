// 模型库几何体检：无需浏览器，直接在 node 里构建每个模型并检查结构问题。
// 用法：node test/libaudit.mjs [catId] [type]
import * as THREE from 'three';
import { LIB } from '../src/assets.js';
import { GROUPS as ARCH_GROUPS } from '../src/arch.js';
import { GROUPS as BLD_GROUPS } from '../src/bld.js';
import { GROUPS as NAT_GROUPS } from '../src/nature.js';
import { GROUPS as PROP_GROUPS } from '../src/props.js';

const ALL = [...LIB, ...ARCH_GROUPS, ...BLD_GROUPS, ...NAT_GROUPS, ...PROP_GROUPS];

const argCat = process.argv[2];
const argType = process.argv[3];

function defaults(item) {
  const o = {};
  for (const p of item.params || []) o[p.k] = p.def;
  return o;
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const fmt = (v) => `[${r3(v.x)}, ${r3(v.y)}, ${r3(v.z)}]`;

function analyze(item, grp) {
  const params = defaults(item);
  let root;
  const t0 = performance.now();
  try { root = item.build(params); } catch (e) { return { err: `build 抛错: ${e.message}` }; }
  const ms = performance.now() - t0;

  const meshes = [];
  let tris = 0, verts = 0;
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    meshes.push(o);
    const g = o.geometry;
    const n = g.index ? g.index.count : (g.attributes.position?.count || 0);
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
    verts += (g.attributes.position?.count || 0) * (o.isInstancedMesh ? o.count : 1);
  });

  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3());
  const issues = [];

  // 1) NaN / 无效包围盒
  if (!isFinite(bb.min.x) || !isFinite(bb.max.y)) issues.push('包围盒无效(NaN)');
  // 2) 贴地：底部应该在 y≈0（允许 ±0.35 的下沉/离地）
  if (bb.min.y < -0.35) issues.push(`沉入地面 ${r3(bb.min.y)}m`);
  if (bb.min.y > 0.35) issues.push(`整体悬空 ${r3(bb.min.y)}m`);
  // 3) 体积过小 / 过大
  if (size.x < 0.05 && size.z < 0.05) issues.push('尺寸过小');

  // 4) 连通性分析：两块网格包围盒（外扩 eps）相交即视为相连。
  //    主体之外、且不与主体连通的团块 = 飘离/断裂构件（屋顶漂移、招牌起飞、柱子断开…）
  const eps = 0.06;
  const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
  const idx = meshes.map((_, i) => i);
  const parent = idx.slice();
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < boxes.length; i++) {
    if (!isFinite(boxes[i].min.x)) { issues.push('存在 NaN 网格'); continue; }
    for (let j = i + 1; j < boxes.length; j++) {
      if (!isFinite(boxes[j].min.x)) continue;
      const a = boxes[i].clone().expandByScalar(eps);
      if (a.intersectsBox(boxes[j])) uni(i, j);
    }
  }
  const comps = new Map();
  for (let i = 0; i < meshes.length; i++) {
    if (!isFinite(boxes[i].min.x)) continue;
    const r = find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  }
  const sorted = [...comps.values()].sort((a, b) => b.length - a.length);
  const flying = [];
  for (const c of sorted.slice(1)) {
    const cb = new THREE.Box3();
    for (const i of c) cb.union(boxes[i]);
    const s = cb.getSize(new THREE.Vector3());
    const c0 = new THREE.Vector3(); cb.getCenter(c0);
    if (Math.max(s.x, s.y, s.z) < 0.12) continue;           // 忽略细小件
    // 与主体连通团块的间隙
    let gap = Infinity;
    const mainBoxes = sorted[0].map((i) => boxes[i]);
    if (mainBoxes.length) {
      const mb = new THREE.Box3();
      for (const b of mainBoxes) mb.union(b);
      gap = mb.distanceToPoint(c0);
    }
    // 落地独立件（旗杆 / 邮箱 / 树 / 停车计时器…）本来就该跟主体分开，不算缺陷
    if (cb.min.y > -0.05 && cb.min.y < 0.12) continue;
    flying.push({ n: c.length, pos: fmt(c0), box: `${fmt(cb.min)}~${fmt(cb.max)}`, size: fmt(s), gap: r3(gap) });
  }
  if (flying.length) {
    const worst = flying.filter((f) => f.gap > 0.08);
    if (worst.length) issues.push(`脱离团块 ${worst.length}/共${comps.size}团: ` + worst.slice(0, 4).map((f) => `${f.n}件@${f.pos} gap=${f.gap}`).join(' | '));
  }
  const nComp = comps.size;

  // 5) 零厚度/退化网格
  let degenerate = 0;
  for (const m of meshes) {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    if (s.x < 1e-4 && s.y < 1e-4 && s.z < 1e-4) degenerate++;
  }
  if (degenerate) issues.push(`退化网格 ${degenerate}`);

  return { nComp, ms, meshes: meshes.length, tris: Math.round(tris), verts, size: fmt(size), minY: r3(bb.min.y), maxY: r3(bb.max.y), issues, flying };
}

let n = 0, bad = 0;
for (const grp of ALL) {
  if (argCat && grp.id !== argCat) continue;
  const rows = [];
  for (const item of grp.items) {
    if (argType && item.type !== argType) continue;
    n++;
    const a = analyze(item, grp);
    const key = `${grp.id}:${item.type}`;
    if (a.err) { bad++; console.log(`✗ ${key.padEnd(26)} ${a.err}`); continue; }
    if (a.issues.length) {
      bad++;
      console.log(`✗ ${key.padEnd(26)} mesh=${String(a.meshes).padStart(4)} tri=${String(a.tris).padStart(6)} size=${a.size} y=${a.minY}..${a.maxY}`);
      for (const i of a.issues) console.log(`     · ${i}`);
      if (process.env.VERBOSE) for (const f of a.flying.slice(0, 12)) console.log(`       fly ${f.pos}  ${f.box}`);
    } else if (process.env.ALL) {
      console.log(`  ${key.padEnd(26)} mesh=${String(a.meshes).padStart(4)} tri=${String(a.tris).padStart(6)} 团=${String(a.nComp).padStart(3)} size=${a.size} y=${a.minY}..${a.maxY} ${r3(a.ms)}ms`);
    }
    rows.push({ key, ...a });
  }
}
console.log(`\n检查 ${n} 个模型，${bad} 个有问题。`);
