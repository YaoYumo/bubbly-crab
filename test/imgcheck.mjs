/**
 * 图片侧结构体检（不依赖视觉，全程序化）
 *
 * 两个几何不好做、图片反而擅长的检查：
 *   1. 轮廓连通域 —— 一个模型的剪影若在某一视图里裂成好几块，那些没跟主体连上的
 *      孤立块就是「悬浮 / 脱开」的候选（浮空的招牌、断开的阳台、飘着的屋顶）。
 *      会进一步反查 id 缓冲，报出这块是由哪几个构件组成的，直接可动手。
 *   2. 左右轮廓对称 —— 建筑类绝大多数左右对称。正视图剪影镜像后若对不上，
 *      说明有一侧构件错位/缺失。只比「占据 vs 未占据」的轮廓，不比灰度，
 *      避免方向光造成的假阳性。
 *
 * 输出的是「可疑名单」不是结论，每一项都要回几何复核。
 *   用法： node test/imgcheck.mjs [组] [类型] [--top N] [--blobs|--sym] [--parts N]
 */
import * as THREE from 'three';
import { LIB, defaultsFor, buildAsset } from '../src/assets.js';
import { render, collect, VIEWS, TILE } from './shots.mjs';

const argv = process.argv.slice(2);
const flags = new Set(), only = [];
let TOP = 25, NPARTS = 4;
for (let i = 0; i < argv.length; i++) {          // --top N 与 --top=N 都认，且 N 不能被当成模型类型
  const a = argv[i];
  if (a === '--top') { TOP = +(argv[++i] || 0) || TOP; continue; }
  if (a === '--parts') { NPARTS = +(argv[++i] || 0) || NPARTS; continue; }
  if (a.startsWith('--top=')) { TOP = +a.slice(6) || TOP; continue; }
  if (a.startsWith('--parts=')) { NPARTS = +a.slice(8) || NPARTS; continue; }
  if (a.startsWith('--')) { flags.add(a); continue; }
  only.push(a);
}

const N = Math.min(TILE, 400);
const MINBLOB = 24;
const VIEWNAME = ['正视', '右侧', '背面', '轴测'];

/** 4-连通域标记：每块给出像素数、包围盒、以及它由哪些构件组成 */
function blobs(id, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const st = new Int32Array(W * H);
  const out = [];
  for (let s = 0; s < W * H; s++) {
    if (id[s] < 0 || lab[s] >= 0) continue;
    const b = out.length;
    out.push({ n: 0, x0: W, x1: 0, y0: H, y1: 0, ids: new Map() });
    let sp = 0; st[sp++] = s; lab[s] = b;
    while (sp) {
      const p = st[--sp], x = p % W, y = (p / W) | 0, o = out[b];
      o.n++;
      if (x < o.x0) o.x0 = x; if (x > o.x1) o.x1 = x;
      if (y < o.y0) o.y0 = y; if (y > o.y1) o.y1 = y;
      if (x > 0     && id[p - 1] >= 0 && lab[p - 1] < 0) { lab[p - 1] = b; st[sp++] = p - 1; }
      if (x < W - 1 && id[p + 1] >= 0 && lab[p + 1] < 0) { lab[p + 1] = b; st[sp++] = p + 1; }
      if (y > 0     && id[p - W] >= 0 && lab[p - W] < 0) { lab[p - W] = b; st[sp++] = p - W; }
      if (y < H - 1 && id[p + W] >= 0 && lab[p + W] < 0) { lab[p + W] = b; st[sp++] = p + W; }
    }
  }
  for (let p = 0; p < W * H; p++) {                // 回程统计每块的构件构成
    const b = lab[p]; if (b < 0) continue;
    const m = out[b].ids; m.set(id[p], (m.get(id[p]) || 0) + 1);
  }
  return out;
}

function symmetry(id, W, H) {
  let diff = 0, tot = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = id[y * W + x] >= 0, b = id[y * W + (W - 1 - x)] >= 0;
    if (a || b) tot++;
    if (a !== b) diff++;
  }
  return tot ? diff / tot : 0;
}

/** 把一个构件描述成人能认的样子：几何类型 + 关键尺寸 + 世界包围盒 */
function describe(o) {
  const g = o.geometry, p = g?.parameters || {};
  const bb = new THREE.Box3().setFromObject(o);
  const s = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  const n = (v) => (typeof v === 'number' ? v.toFixed(2) : '?');
  let dim;
  if (typeof p.radiusTop === 'number' || typeof p.radius === 'number')
    dim = `r${n(p.radiusTop ?? p.radius)}~${n(p.radiusBottom ?? p.radius)} h${n(p.height ?? 0)}`;
  else if (typeof p.width === 'number' && typeof p.height === 'number' && typeof p.depth === 'number')
    dim = `${n(p.width)}×${n(p.height)}×${n(p.depth)}`;
  else dim = `尺寸 ${n(s.x)}×${n(s.y)}×${n(s.z)}`;
  const role = (o.userData && o.userData.role) ? `[${o.userData.role}]` : '';
  return `${g?.type || '?'}${role} ${dim} @(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`;
}

const pct = (x) => (x * 100).toFixed(2).padStart(5) + '%';
const rows = [];

for (const g of LIB) {
  if (only[0] && g.id !== only[0]) continue;
  for (const it of g.items) {
    if (only.length > 1 && !only.slice(1).includes(it.type)) continue;   // 支持多类型：imgcheck bld wall doorroll …
    let root;
    try { root = buildAsset(it, defaultsFor(it)); }
    catch (e) { if (!only.length) console.log(`  skip ${g.id}:${it.type} ${e.message}`); continue; }
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) continue;
    const T = collect(root);
    if (!T.n) continue;

    const r = { k: `${g.id}:${it.type}`, float: [], sym: 0, cover: 0, T };
    for (let v = 0; v < VIEWS.length; v++) {
      const R = render(T, box, VIEWS[v], N, N);
      if (v === 0) {
        r.sym = symmetry(R.id, N, N);
        let on = 0; for (let i = 0; i < R.id.length; i++) if (R.id[i] >= 0) on++;
        r.cover = on / (N * N);
      }
      const bs = blobs(R.id, N, N).filter((b) => b.n >= MINBLOB).sort((a, b) => b.n - a.n);
      if (bs.length <= 1) continue;
      const main = bs[0];
      for (let i = 1; i < bs.length; i++) {
        const b = bs[i];
        r.float.push({ v, n: b.n, pct: b.n / (N * N), x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, ids: b.ids, mainN: main.n });
      }
    }
    r.float.sort((a, b) => b.n - a.n);
    r.floatN = r.float.reduce((s, f) => s + f.n, 0);
    rows.push(r);
  }
}

const doBlobs = flags.has('--blobs') || !flags.has('--sym');
const doSym = flags.has('--sym') || !flags.has('--blobs');

if (doBlobs) {
  console.log('\n【A】孤立碎块（剪影裂成多块 → 悬浮/脱开候选）。列出最大一块的构成：');
  const bad = rows.filter((r) => r.float.length).sort((a, b) => b.floatN - a.floatN);
  if (!bad.length) console.log('  （无）');
  for (const r of bad.slice(0, TOP)) {
    const f = r.float[0];
    console.log(`\n  ${r.k}  ${String(f.n).padStart(6)}px (${pct(f.pct)}) @${VIEWNAME[f.v]} ` +
      `x[${f.x0},${f.x1}] y[${f.y0},${f.y1}]  共 ${r.float.length} 块`);
    const top = [...f.ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, NPARTS);
    for (const [mid, px] of top) {
      const o = r.T.objs[mid];
      console.log(`        ${String(px).padStart(5)}px  ${o ? describe(o) : '(构件 #' + mid + ')'}`);
    }
  }
}

if (doSym) {
  console.log('\n【B】正视图左右不对称度（建筑类多数应接近 0）');
  for (const r of rows.slice().sort((a, b) => b.sym - a.sym).slice(0, TOP))
    console.log(`  ${r.k.padEnd(26)} 不对称 ${pct(r.sym)}   剪影占比 ${pct(r.cover)}`);
}

console.log(`\n共分析 ${rows.length} 个模型（${N}²，忽略 <${MINBLOB}px 碎块）`);
console.log('注：可疑名单不是结论 —— 散点/有机体（草、花、碎石）本就多块且不对称，属正常；');
console.log('    建筑/家具类出现大块孤立或明显不对称才值得回几何复核。');
