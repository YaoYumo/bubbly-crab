// ---------------------------------------------------------------------------
// 中式古建筑 / 美式经典建筑 / 室内空间：程序化简易模型
// 目标不是精模，而是「剪影 + 比例 + 材质关系」正确，能当 AI 参考
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { M, shade, box, cyl, sph, planeXZ, cone, row, ring, seg, curvedRoof, ridgeOrnament, dougong, roofSurf, eaveCornice, hipRidge, stoneRail, caihua, plaque, plaqueTex, batch, mergeSimilar, bakeMerge, gableSlabs } from './geo.js';
import { clamp, makeRng } from './util.js';
import { mul, Q } from './detail.js';

/** 中式构件收尾：贴程序化表面 + 把重复小件合成实例（draw call 省 5～10 倍） */
function cnShade(g) {
  shade(g);
  try {
    mergeSimilar(g, { min: 2 });      // 同规格重复件 → 一次实例化绘制（比烘顶点更省：几何只有一份）
    bakeMerge(g);                     // 剩下的零碎件按材质烘成一个几何 → 节点数 / draw call 再降一档
  } catch (err) {
    if (!cnShade._warned) { cnShade._warned = 1; console.warn('[previz] 构件合并跳过：', err && err.message); }
  }
  return g;
}

/** 参数兜底：未声明/非法的数值一律回落到默认，避免 NaN 几何 */
function num(v, d) { return Number.isFinite(v) ? v : d; }

const PI = (k, l, min, max, step, def, help) => ({ k, l, t: 'int', min, max, step, def, help });
const PR = (k, l, min, max, step, def, help) => ({ k, l, t: 'range', min, max, step, def, help });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'sel', opts, def });
const PT = (k, l, def, help) => ({ k, l, t: 'text', def, help });

// =========================================================== 中式古建筑 ===
function buildHall(p) {
  const g = new THREE.Group();
  const w = Math.max(3, num(p.w, 20)), d = Math.max(3, num(p.d, 13)), rh = Math.max(0.6, num(p.roofH, 3.4));
  const cH = Math.max(2, num(p.h, 5));
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.7);
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.72);
  const stone = M.stone(new THREE.Color(p.plinth).getHex(), 0.93);
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  // ── 台基（须弥座：下枋 + 束腰 + 上枋 + 阶条石 / 散水）────────────────
  const ph = clamp(num(p.plinthH, 0.6), 0, 2.4);
  const pw = w + p.bay * 0.7, pd = d + p.bay * 0.7;
  if (ph > 0.04) {
    g.add(box(pw, ph * 0.66, pd, stone, 0, ph * 0.33, 0));
    g.add(box(pw + 0.34, Math.max(0.08, ph * 0.16), pd + 0.34, stone, 0, ph * 0.74, 0, 0.03));
    g.add(box(pw + 0.5, Math.max(0.06, ph * 0.14), pd + 0.5, M.stone(0xa49e93, 0.94), 0, ph * 0.07, 0, 0.03));
    g.add(box(pw + 0.86, 0.06, pd + 0.86, M.stone(0x98928a, 0.95), 0, 0.03, 0));            // 散水
  }
  const y0 = ph;
  const railH = clamp(ph * 0.8, 0.4, 0.86);
  if (p.rail !== false && ph > 0.2) {                                                        // 台顶石栏杆
    const gapW = Math.min(pw * 0.3, num(p.bay, 4) * 1.9);
    const segLen = Math.max(1, (pw - gapW) / 2);
    for (const sx of [1, -1]) {
      const r1 = stoneRail({ len: segLen, h: railH, y: ph, mat: stone, step: Math.max(0.9, ph * 1.4) });
      r1.position.set(sx * (gapW / 2 + segLen / 2), 0, pd / 2 - 0.14);
      g.add(r1);
    }
    const rb = stoneRail({ len: pw - 0.3, h: railH, y: ph, mat: stone });
    rb.position.z = -pd / 2 + 0.14; g.add(rb);
    for (const sx of [1, -1]) {
      const rs = stoneRail({ len: pd - 0.3, h: railH, y: ph, mat: stone, axis: 'z' });
      rs.position.x = sx * (pw / 2 - 0.14); g.add(rs);
    }
  }
  if (p.steps && ph > 0.2) {                                          // 踏跺（两侧阶 + 中间御路斜石）
    const sw = Math.min(pw * 0.3, num(p.bay, 4) * 1.7);
    const n = clamp(Math.round(ph / 0.17), 2, 12), stH = ph / n, run = 0.42;
    for (const sx of [1, -1]) {
      for (let i = 0; i < n; i++) g.add(box(sw * 0.44, stH, run, stone, sx * (sw * 0.3), ph - stH * (i + 0.5), pd / 2 - 0.14 + (n - i) * run));
      g.add(box(sw * 0.1, ph * 0.9, n * run * 1.02, stone, sx * (sw * 0.56), ph * 0.45, pd / 2 - 0.14 + n * run * 0.5, 0.03));   // 垂带石
    }
    const L = Math.hypot(ph, n * run);
    const rp = box(sw * 0.44, 0.1, L, M.stone(0xaba59c, 0.9), 0, ph * 0.5, pd / 2 - 0.14 + n * run * 0.5);
    rp.rotation.x = -Math.atan2(ph, n * run);
    g.add(rp);
    const rp2 = box(sw * 0.2, 0.06, L * 0.92, M.stone(0xc6c0b4, 0.86), 0, ph * 0.5 + 0.09, pd / 2 - 0.14 + n * run * 0.5);     // 御路雕龙石
    rp2.rotation.x = rp.rotation.x;
    g.add(rp2);
  }
  // ── 檐柱一圈（柱础 + 额枋 + 斗拱）+ 金柱─────────────────────────
  const cols = Math.max(2, Math.round(num(p.bays, 5)) * 2 + 2);
  const colAt = (x, z, tall) => {
    const grp = new THREE.Group();
    grp.add(cyl(0.24, 0.28, cH, wood, seg(14), 0, cH / 2, 0));
    grp.add(cyl(0.4, 0.44, 0.12, stone, seg(12), 0, 0.06, 0));                 // 柱础
    grp.add(box(0.78, 0.12, 0.78, stone, 0, 0.15, 0, 0.04));                    // 磉石
    grp.add(box(0.86, 0.3, 0.3, wood, 0, cH + 0.15, 0));                        // 额枋（柱头联系）
    grp.add(box(0.86, 0.16, 0.24, wood, 0, cH + 0.38, 0));                      // 垫板
    grp.add(box(0.86, 0.34, 0.32, wood, 0, cH + 0.63, 0));                      // 上额枋
    if (tall) grp.add(queTi(wood, 0.5, 0.42, 0.12));
    if (p.dougong) grp.add(dougong(wood, 0.9, { gold: M.metal(0xb08a3e, 0.4, 0.7) }));
    return grp;
  };
  const front = row((i) => colAt(0, 0, true), cols, w);
  front.position.z = d / 2; front.position.y = y0; g.add(front);
  const back = front.clone(); back.position.z = -d / 2; g.add(back);
  const sideN = Math.max(2, Math.round(p.bays * 0.6) + 1);
  const side = row((i) => colAt(0, 0, true), sideN, d);
  side.rotation.y = Math.PI / 2; side.position.x = w / 2; side.position.y = y0; g.add(side);
  const side2 = side.clone(); side2.position.x = -w / 2; g.add(side2);
  if (p.innerCols !== false && p.bays >= 3) {                                    // 金柱（内槽一圈）
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      g.add(cyl(0.26, 0.3, cH * 1.06, wood, seg(14), sx * w * 0.32, y0 + cH * 0.53, sz * d * 0.3));
      g.add(cyl(0.42, 0.46, 0.12, stone, seg(12), sx * w * 0.32, y0 + 0.06, sz * d * 0.3));
    }
    g.add(box(w * 0.66, 0.3, 0.26, wood, 0, y0 + cH * 1.03, d * 0.3));
    g.add(box(w * 0.66, 0.3, 0.26, wood, 0, y0 + cH * 1.03, -d * 0.3));
  }
  g.add(planeXZ(w - 0.6, d - 0.6, M.stone(0x5d4a34, 0.62), 0, y0 + 0.03, 0));    // 室内金砖地面
  // ── 墙体 + 隔扇门窗 ─────────────────────────────────────────────
  g.add(box(w, cH * 0.98, 0.18, wall, 0, y0 + cH * 0.49, -d / 2 + 0.1));
  g.add(box(0.18, cH * 0.98, d, wall, -w / 2 + 0.1, y0 + cH * 0.49, 0));
  g.add(box(0.18, cH * 0.98, d, wall, w / 2 - 0.1, y0 + cH * 0.49, 0));
  const doorW = Math.min(w * 0.9, p.bays * 1.15);
  const doorH = cH * 0.7;
  const nLeaf = clamp(Math.round(doorW / 0.92) * 2, 2, 12);
  for (let i = 0; i < nLeaf; i++) {
    const x = (i / nLeaf - 0.5) * doorW + doorW / (2 * nLeaf);
    const leaf = M.paint(new THREE.Color(p.door).getHex(), 0.52);
    g.add(box(doorW / nLeaf * 0.9, doorH, 0.1, leaf, x, y0 + doorH / 2, d / 2 - 0.02));
    g.add(box(doorW / nLeaf * 0.74, doorH * 0.3, 0.06, M.paint(new THREE.Color(p.door).getHex(), 0.42), x, y0 + doorH * 0.19, d / 2 + 0.05));   // 裙板
    if (i === Math.floor(nLeaf / 2) - 1 || i === Math.floor(nLeaf / 2)) {          // 门钉 + 铺首
      const studs = [];
      for (let ry = 0; ry < 5; ry++) for (let cx2 = 0; cx2 < 3; cx2++) studs.push({ p: [x + (cx2 - 1) * doorW / nLeaf * 0.24, y0 + doorH * 0.62 + (ry - 2) * doorH * 0.075, d / 2 + 0.06], s: [0.05, 0.05, 0.05] });
      const st = batch(new THREE.SphereGeometry(1, seg(6), seg(5)), M.metal(0xc9a45c, 0.34, 0.86), studs);
      if (st) g.add(st);
      g.add(box(doorW / nLeaf * 0.3, doorH * 0.16, 0.07, M.metal(0xb8912f, 0.36, 0.86), x, y0 + doorH * 0.44, d / 2 + 0.06));                   // 铺首衔环
    }
  }
  g.add(box(doorW + 0.5, 0.14, 0.3, wood, 0, y0 + doorH + 0.08, d / 2 - 0.02));    // 檐枋 / 门槛
  g.add(box(doorW + 0.3, 0.1, 0.24, M.stone(0x9f9a90, 0.92), 0, y0 + 0.05, d / 2 - 0.02));
  if (p.lattice) {
    const latt = [];
    for (let i = 0; i < p.bays; i++) {
      const x = (i / (p.bays - 1 || 1) - 0.5) * (w * 0.82);
      if (Math.abs(x) < doorW * 0.42) continue;
      g.add(box(p.bay * 0.62, cH * 0.42, 0.1, M.glassy(0x101010, 0.9, 0, 0.28), x, y0 + cH * 0.56, d / 2 - 0.02));
      g.add(box(p.bay * 0.66, 0.06, 0.14, wood, x, y0 + cH * 0.78, d / 2 - 0.02));
      for (let k = 1; k < 5; k++) latt.push({ p: [x - p.bay * 0.31 + k * p.bay * 0.62 / 5, y0 + cH * 0.56, d / 2 + 0.02], s: [0.022, cH * 0.4, 0.03] });
      for (let k = 1; k < 4; k++) latt.push({ p: [x, y0 + cH * 0.56 - cH * 0.21 + k * cH * 0.42 / 4, d / 2 + 0.02], s: [p.bay * 0.6, 0.022, 0.03] });
    }
    const lb = batch(new THREE.BoxGeometry(1, 1, 1), wood, latt);                  // 窗棂（一步 draw call）
    if (lb) g.add(lb);
  }
  // ── 额枋一圈 + 彩画 + 屋顶（举折 + 脊兽 + 檐口椽瓦）────────────────
  g.add(box(w + 0.4, 0.34, 0.34, wood, 0, y0 + cH + 0.1, d / 2));
  g.add(box(w + 0.4, 0.34, 0.34, wood, 0, y0 + cH + 0.1, -d / 2));
  g.add(box(0.34, 0.34, d + 0.4, wood, w / 2, y0 + cH + 0.1, 0));
  g.add(box(0.34, 0.34, d + 0.4, wood, -w / 2, y0 + cH + 0.1, 0));
  if (p.caihua !== false) {
    const cm = { p: M.paint(0x2f5b8a, 0.6), q: M.paint(0x3c7a5e, 0.6), r: M.paint(0x8f3a2c, 0.6), g: M.metal(0xc9a45c, 0.4, 0.82) };
    for (const sz of [1, -1]) g.add(caihua(w + 0.3, cm, { h: 0.3, y: y0 + cH - 0.24, z: sz * (d / 2 + 0.2) }));
    for (const sx of [1, -1]) {
      const c3 = caihua(d + 0.3, cm, { h: 0.3, y: y0 + cH - 0.24, z: 0 });
      c3.rotation.y = Math.PI / 2; c3.position.x = sx * (w / 2 + 0.2);
      g.add(c3);
    }
  }
  const roofMat = roofSurf(new THREE.Color(p.roof).getHex(), 0.62);
  const ry0 = y0 + cH + 0.24;
  g.add(curvedRoof({ w, d, h: rh, kind: p.kind, ridge: p.ridge, brim: p.bay * 0.75, eaveUp: p.eaveUp, mat: roofMat, seg: 26, y0: ry0 }));
  roofTrim(g, { w, d, h: rh, brim: p.bay * 0.75, eaveUp: p.eaveUp, y0: ry0, kind: p.kind, ridge: p.ridge, tile: roofMat, woodMat: wood, ridgeMat: M.paint(new THREE.Color(p.ridgeColor).getHex(), 0.6), trim, beasts: Math.round(num(p.beasts, 5)), drip: p.drip !== false });
  g.userData.glow = [];
  g.userData.hall = { cols, sideN, plinth: ph > 0.04, rail: p.rail !== false && ph > 0.2, trim };
  return cnShade(g);
}
function buildPagoda(p) {
  const g = new THREE.Group();
  const levels = clamp(Math.round(num(p.levels, 7)), 1, 13);
  const R0 = Math.max(1.2, num(p.r, 4.4)), fh = Math.max(1.4, num(p.floorH, 3.4));
  const taper = clamp(num(p.taper, 0.055), 0, 0.12);
  const sides = Math.max(4, Math.round(num(p.sides, 8)));
  const stone = M.stone(0xb9b2a4, 0.9);
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.72);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.66);
  const brick = M.paint(0xd9cfbd, 0.8);
  const gold = M.metal(0xd8b25a, 0.3, 0.9);
  const trim = p.trim !== false, hasRail = p.rail !== false, hasDg = p.brackets !== false, hasPz = p.pingzuo !== false;
  // 塔基：台明 + 须弥座 + 石栏杆
  g.add(box(R0 * 3.1, 0.16, R0 * 3.1, M.stone(0xa7a199, 0.94), 0, 0.08, 0));
  g.add(cyl(R0 * 1.5, R0 * 1.56, 0.42, stone, seg(sides), 0, 0.37, 0));
  if (hasRail) {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      const rl = stoneRail({ len: R0 * 3.0 * Math.sin(Math.PI / sides) * 0.94, h: 0.5, y: 0.58, mat: stone, step: 0.6 });
      rl.rotation.y = -a + Math.PI / 2;
      rl.position.set(Math.cos(a) * R0 * 1.44, 0, Math.sin(a) * R0 * 1.44);
      g.add(rl);
    }
  }
  let y = 0.58, rr = R0;
  for (let i = 0; i < levels; i++) {
    rr = R0 * (1 - i * taper);
    const body = p.body === 'wood' ? wood : brick;
    g.add(cyl(rr * 0.98, rr, fh, body, seg(sides), 0, y + fh / 2, 0));
    for (let k = 0; k < sides; k++) {                                          // 角柱（檐柱）
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      g.add(box(rr * 0.14, fh, rr * 0.14, wood, Math.cos(a) * rr * 0.99, y + fh / 2, Math.sin(a) * rr * 0.99));
    }
    if (p.door) {                                                               // 每面券门 / 直棂窗（逐层正反面交替）
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const face = Math.abs(((a / Math.PI / 2) % 2)) < 0.25 || Math.abs(((a / Math.PI / 2) % 2) - 2) < 0.25;
        const isDoor = i === 0 ? k === 0 : face && (k + i) % 2 === 0;
        const fw = rr * (isDoor ? 0.4 : 0.26), hh2 = fh * (isDoor ? 0.62 : 0.34);
        const mat2 = isDoor ? M.paint(0x3a2a1e, 0.6) : M.glassy(0x121820, 0.82, 0.05, 0.34);
        const b = box(fw, hh2, 0.14, mat2, Math.cos(a) * rr * 0.99, y + fh * (isDoor ? 0.32 : 0.52), Math.sin(a) * rr * 0.99);
        b.rotation.y = -a + Math.PI / 2;
        g.add(b);
        const lint = box(fw * 1.34, 0.11, 0.2, wood, Math.cos(a) * rr * 0.99, y + fh * (isDoor ? 0.66 : 0.72), Math.sin(a) * rr * 0.99);
        lint.rotation.y = -a + Math.PI / 2;
        g.add(lint);
        if (isDoor) for (const sx of [1, -1]) {                                  // 门侧抱框
          const j = box(fw * 0.1, hh2 * 1.06, 0.16, wood, Math.cos(a) * rr * 1.0 + sx * fw * 0.55 * Math.cos(a + Math.PI / 2), y + fh * 0.32, Math.sin(a) * rr * 1.0 - sx * fw * 0.55 * Math.sin(a + Math.PI / 2));
          j.rotation.y = -a + Math.PI / 2;
          g.add(j);
        }
      }
    }
    const py = y + fh;
    g.add(cyl(rr * 1.26, rr * 1.2, 0.16, wood, seg(sides), 0, py + 0.02, 0));   // 平座板（挑台）
    if (hasPz) {
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
        const rl = stoneRail({ len: 2 * rr * 1.2 * Math.sin(Math.PI / sides) * 0.96, h: 0.44, y: py + 0.1, mat: stone, step: Math.max(0.5, rr * 0.34) });
        rl.rotation.y = -a + Math.PI / 2;
        rl.position.set(Math.cos(a) * rr * 1.16, 0, Math.sin(a) * rr * 1.16);
        g.add(rl);
      }
    }
    if (hasDg) for (let k = 0; k < sides; k++) {                                 // 檐下斗拱
      const a = (k / sides) * Math.PI * 2;
      const dg = dougong(wood, rr * 0.19, { gold });
      dg.position.set(Math.cos(a) * rr * 1.04, py + 0.12, Math.sin(a) * rr * 1.04);
      dg.rotation.y = -a + Math.PI / 2;
      g.add(dg);
    }
    // 塔檐按同边数的正多边形出（角点对齐角柱），出檐 0.38r；层高起点抬到本层檐顶，
    // 免得上一层塔身从下一层檐面的「方罩子」里硬穿出来（旧版 py+0.62 低于檐顶 y0+0.5）。
    const eaveR = (rr * 1.38) / Math.cos(Math.PI / sides);
    const apoth = eaveR * Math.cos(Math.PI / sides);
    const rh2 = fh * 0.62, y0 = py + 0.3;
    g.add(curvedRoof({ w: apoth * 2, d: apoth * 2, h: rh2, kind: 'jin', brim: 0, eaveUp: 0.34, mat: tile, seg: 14, y0, sides }));
    if (trim) {
      if (Q.level !== 'lite') g.add(eaveCornice({ w: apoth * 2, d: apoth * 2, brim: 0, eaveUp: 0.34, h: rh2, y: y0 + 0.02, mat: wood, tileMat: tile, sides }));
      for (let k = 0; Q.level !== 'lite' && k < sides; k++) {                                          // 每角一条垂脊到檐角
        const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
        const cx = Math.cos(a) * eaveR * 0.94, cz = Math.sin(a) * eaveR * 0.94;
        const rEave = rh2 * (0.24 + 0.73 * 0.34);                          // 檐角端：举 + 起翘
        const rr3 = hipRidge({ len: Math.hypot(cx, cz) * 0.93, rise: Math.max(0.04, rh2 * 0.76 - rEave), mat: tile, beastMat: gold, beasts: 0, s: 0.7, w: 0.15 });
        rr3.position.set(cx, y0 + rEave, cz);
        rr3.rotation.y = Math.PI - Math.atan2(cz, cx);   // +x 绕 y 转 φ 落到 (cosφ, -sinφ)：朝圆心是 π-φ，不是 φ+π
        g.add(rr3);
      }
    }
    y = y0 + rh2 * 0.72;
  }
  // 塔刹：仰莲 + 相轮九重 + 覆钵 + 宝珠 + 垂链
  const sH = clamp(num(p.spire, 3.4), 0.6, 10);
  g.add(cone(rr * 0.42, 0.34, gold, seg(8), 0, y + 0.17, 0));
  g.add(cyl(0.1, 0.16, sH, gold, seg(10), 0, y + sH / 2, 0));
  const nRing = clamp(Math.round(mul(9)), 5, 11);
  for (let i = 0; i < nRing; i++) g.add(cyl(rr * 0.36 - i * rr * 0.026, rr * 0.36 - i * rr * 0.026, 0.07, gold, seg(12), 0, y + 0.34 + i * (sH * 0.62 / nRing), 0));
  g.add(cyl(rr * 0.3, rr * 0.22, 0.3, gold, seg(12), 0, y + sH * 0.72, 0));
  g.add(sph(rr * 0.2, gold, seg(12), 0, y + sH * 0.9, 0));
  g.add(cone(rr * 0.09, 0.3, gold, seg(6), 0, y + sH + 0.1, 0));
  for (const sx of [1, -1]) {
    const ch = cyl(0.022, 0.022, sH * 0.5, gold, 4, sx * rr * 0.3, y + sH * 0.72, 0);
    ch.rotation.z = sx * 0.42;
    g.add(ch);
  }
  g.userData.pagoda = { levels, sides, rail: hasRail, pingzuo: hasPz, brackets: hasDg, trim };
  return cnShade(g);
}
// ═════════════════════════ 屋顶附件：檐口椽瓦 · 垂脊走兽 · 正脊吻兽 ═════════════════════════
/** 把一整套屋顶小木作挂到 curvedRoof 周围（殿宇 / 牌楼 / 门楼 / 廊 / 塔共用） */
function roofTrim(g, o = {}) {
  const w = o.w, d = o.d;
  if (!(w > 0) || !(d > 0)) return;
  const h = o.h ?? 1, brim = o.brim ?? 0.5, eaveUp = o.eaveUp ?? 0.16, y0 = o.y0 ?? 0;
  const kind = o.kind ?? 'wu', ridge = o.ridge ?? 0.42;
  const tile = o.tile, wood = o.woodMat || tile, rMat = o.ridgeMat || tile;
  const trim = o.trim !== false, drip = o.drip !== false;
  const W = w + brim * 2, D = d + brim * 2;
  const xr = Math.max(0.35, w * 0.5 * ridge);
  if (trim && drip) g.add(eaveCornice({ w, d, brim, eaveUp, h, y: y0 + 0.03, mat: wood, tileMat: tile }));
  // 正脊：两层脊身 + 两端正吻（鸱吻，尾尖内吞）
  const ry = y0 + h * 0.76;                      // curvedRoof 的脊高就是 0.76h：正脊落在屋面上，不再悬空
  const rl = kind === 'juan' ? W + 0.3 : kind === 'jin' ? 0.6 : xr * 2 + 0.5;
  if (kind !== 'jin') {
    g.add(box(rl, 0.2, 0.44, rMat, 0, ry + 0.1, 0));
    g.add(box(rl * 0.92, 0.14, 0.3, rMat, 0, ry + 0.27, 0));
    for (const sx of [1, -1]) {
      g.add(box(0.3, 0.66, 0.5, rMat, sx * (rl / 2 - 0.04), ry + 0.34, 0, 0.07));
      const t = box(0.16, 0.44, 0.16, rMat, sx * (rl / 2 - 0.3), ry + 0.64, 0);
      t.rotation.z = sx * 0.75;
      g.add(t);
      g.add(box(0.24, 0.2, 0.18, rMat, sx * (rl / 2 - 0.04), ry + 0.72, 0));
    }
  }
  if (!trim) return;
  if (kind === 'jin') { g.add(ridgeOrnament(w, 'jin', rMat, ry)); return; }
  const eaveY = y0 + eaveUp * h * 0.8;               // 檐角（起翘后）
  if (kind === 'juan') {                             // 悬山：博风板 + 悬鱼 + 惹草
    const L = Math.hypot(D / 2, h) * 1.04;
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const b = box(0.14, 0.34, L, wood, sx * (W / 2 - 0.02), y0 + h * 0.5, sz * D / 4, 0.04);
      b.rotation.x = sz * Math.atan2(h, D / 2);
      g.add(b);
    }
    for (const sx of [1, -1]) {
      g.add(box(0.1, 0.44, 0.34, rMat, sx * (W / 2 + 0.06), y0 + h * 0.72, 0, 0.03));   // 悬鱼
      g.add(box(0.08, 0.16, 0.5, rMat, sx * (W / 2 + 0.04), y0 + h * 0.3, 0));           // 惹草
    }
    return;
  }
  const nb = o.beasts ?? 3, bs = o.beastScale ?? 1;
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const cx = sx * W / 2, cz = sz * D / 2;
    const dx = sx * xr - cx, dz = -cz;
    const r = hipRidge({ len: Math.hypot(dx, dz) * 0.95, rise: Math.max(0.04, ry - eaveY), mat: rMat, beastMat: o.beastMat || rMat, beasts: nb, s: bs, w: 0.2 });
    r.position.set(cx, eaveY, cz);
    r.rotation.y = Math.atan2(-dz, dx);
    g.add(r);
  }
}

/** 雀替：柱枋交角处的三角撑（挤出三角形，12 面片） */
function queTi(mat, len = 0.7, h = 0.5, t = 0.12) {
  const L = Math.max(0.12, len), H = Math.max(0.08, h);
  const shp = new THREE.Shape();
  shp.moveTo(0, 0); shp.lineTo(L, 0); shp.lineTo(0, H); shp.lineTo(-L * 0.06, H * 0.62); shp.lineTo(0, H * 0.44); shp.closePath();
  const geo = new THREE.ExtrudeGeometry(shp, { depth: Math.max(0.03, t), bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -Math.max(0.03, t) / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.marker = '雀替';
  return m;
}

// 牌楼 / 牌坊：间数 · 柱式 · 额枋三件套 · 斗拱 · 雀替 · 匾额 · 每间起楼 · 脊兽
function buildPaifang(p) {
  const g = new THREE.Group();
  const bays = clamp(Math.round(num(p.bays, 3)), 1, 5);
  const span = Math.max(3, num(p.span, 14)), H = Math.max(2.4, num(p.h, 6.2));
  const eaveUp = clamp(num(p.eaveUp, 0.5), 0, 0.8);
  const roofH = clamp(num(p.roofH, 0.95), 0.3, 2.4);
  const floors = p.floors !== false;
  const choutian = p.style === 'chong';              // 冲天柱式：柱头穿出楼顶
  const shoulder = bays > 1 && p.shoulder !== false; // 出头柱 + 两侧小楼（三间四柱五楼）
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  const colHex = new THREE.Color(p.column).getHex();
  const red = M.paint(colHex, 0.62);
  const wood = M.paint(colHex, 0.7);
  const stone = M.stone(new THREE.Color(p.stone).getHex(), 0.93);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.64);
  const rMat = M.paint(new THREE.Color(p.ridgeColor).getHex(), 0.6);
  const gold = M.metal(0xc9a45c, 0.36, 0.82);
  const caihuaMats = { p: M.paint(0x2f5b8a, 0.62), q: M.paint(0x3c7a5e, 0.62), r: M.paint(0x8f3a2c, 0.62), g: gold };
  const mid = (bays - 1) / 2;
  const R = clamp(span * 0.016, 0.16, 0.42);
  const bayTop = (i) => H * Math.max(0.42, 1 - 0.2 * Math.abs(i - mid));   // 明间最高，逐间递减
  const xs = [];
  for (let i = 0; i <= bays; i++) xs.push((i / bays - 0.5) * span);
  const gap = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : span;
  const cols = [];                                          // {x, top, shoulder}
  for (let i = 0; i <= bays; i++) {
    const t = Math.max(bayTop(i - 1) || 0, bayTop(i) || 0, i === 0 || i === bays ? bayTop(Math.min(bays - 1, Math.max(0, i))) * 0.86 : 0);
    cols.push({ x: xs[i], top: t });
  }
  if (shoulder) {
    const st = bayTop(0) * 0.74;
    cols.push({ x: xs[0] - gap * 0.4, top: st, sh: true });
    cols.push({ x: xs[xs.length - 1] + gap * 0.4, top: st, sh: true });
  }
  let nDg = 0, nRoof = 0, nQue = 0;
  // ── 立柱 + 柱础 + 夹杆石 ─────────────────────────────────────────
  for (const c of cols) {
    const ch = c.top + (choutian && floors ? 0.62 : 0.02);
    g.add(cyl(R * 0.84, R, ch, red, seg(14), c.x, ch / 2, 0));
    const base = new THREE.Group();
    base.add(cyl(R * 1.5, R * 1.62, 0.14, stone, seg(12), 0, 0.07, 0));      // 磉墩
    base.add(cyl(R * 1.12, R * 1.34, 0.18, stone, seg(12), 0, 0.21, 0));     // 覆盆 + 柱梃
    base.position.set(c.x, 0, 0);
    base.userData.marker = '柱础';
    g.add(base);
    g.add(box(R * 6.2, 0.24, R * 4.4, M.stone(0xa49e93, 0.93), c.x, 0.12, 0, 0.04));      // 磉墩（柱下整石）
    for (const sx of [1, -1]) {                                                // 夹杆石：贴柱两侧，块体够大才压得住柱脚
      g.add(box(R * 1.9, 0.62, R * 3.1, stone, c.x + sx * R * 2.3, 0.31, 0, 0.06));
      g.add(box(R * 1.3, 0.14, R * 3.4, M.stone(new THREE.Color(p.stone).getHex(), 0.9), c.x + sx * R * 2.3, 0.69, 0, 0.03));
    }
    if (c.sh || Math.abs(c.x) > span * 0.5 - 0.01) {                           // 端柱抱鼓石：鼓座 + 立鼓（鼓面朝街）+ 鼓顶兽
      for (const sx of [1, -1]) {
        const bx = c.x + sx * R * 4.6;
        g.add(box(R * 1.5, 0.5, R * 3.3, M.stone(0x9c978d, 0.93), bx, 0.25, 0, 0.06));
        const drum = cyl(R * 1.34, R * 1.34, 0.22, stone, seg(16), bx, 0.86, 0);
        drum.rotation.z = Math.PI / 2;                                          // 圆柱横倒 → 鼓面正对街道
        g.add(drum);
        g.add(box(R * 1.05, 0.26, R * 1.7, stone, bx, 1.24, 0, 0.05));          // 鼓顶小兽
      }
    }
    if (choutian && floors) {                                                  // 柱头蹲兽
      g.add(box(R * 1.7, 0.14, R * 1.7, stone, c.x, ch + 0.07, 0));
      g.add(sph(R * 0.8, gold, seg(8), c.x, ch + 0.3, 0));
      g.add(cone(R * 0.4, 0.34, gold, seg(6), c.x, ch + 0.56, 0));
    }
  }
  // ── 每间：额枋三件套 + 匾额/花板 + 雀替 + 斗拱 + 一楼 ───────────────
  const baysAll = [];
  for (let i = 0; i < bays; i++) baysAll.push({ x0: xs[i], x1: xs[i + 1], top: bayTop(i), mid: Math.abs(i - mid) < 0.5 });
  if (shoulder) {
    const st = bayTop(0) * 0.74;
    baysAll.unshift({ x0: cols[cols.length - 2].x, x1: xs[0], top: st * 0.98, side: true });
    baysAll.push({ x0: xs[xs.length - 1], x1: cols[cols.length - 1].x, top: st * 0.98, side: true });
  }
  for (const b of baysAll) {
    const cx = (b.x0 + b.x1) / 2, wb = Math.abs(b.x1 - b.x0);
    const y = b.top;
    const bw = wb + R * 2.4;                                     // 枋压柱（略长于开间）
    const beamD = clamp(0.24 + R * 0.9, 0.32, 0.56);
    // ── 额枋（大额枋 + 垫板）+ 字板 + 小额枋 + 平板枋：层层相叠，不留空档 ──
    const yBig = y + 0.21, yPad = y + 0.53, yPane = y + 0.86, yTop = y + 1.19, yFlat = y + 1.41;
    g.add(box(bw, 0.42, beamD * 1.16, wood, cx, yBig, 0));        // 大额枋（最粗）
    g.add(box(bw, 0.18, beamD, wood, cx, yPad, 0));               // 垫板
    const paneH = 0.42;
    if (p.caihua !== false) {
      const cm = caihuaMats;
      for (const sz of [1, -1]) {
        g.add(caihua(bw * 0.95, cm, { h: 0.38, y: yBig - 0.19, z: sz * (beamD * 0.58 + 0.02), d: 0.05, x: cx }));
        g.add(caihua(bw * 0.95, cm, { h: 0.16, y: yTop - 0.08, z: sz * (beamD * 0.52 + 0.02), d: 0.045, x: cx }));
      }
    }
    // 雀替：大额枋与柱交角处的三角撑（两侧各一）
    for (const sx of [-1, 1]) {
      const qt = queTi(wood, wb * 0.24, Math.min(0.56, wb * 0.14), 0.13);
      qt.position.set(cx + sx * (wb / 2 - R * 0.18), y + 0.02, 0);
      qt.rotation.y = sx > 0 ? 0 : Math.PI;
      g.add(qt); nQue++;
      g.add(box(wb * 0.05, 0.14, beamD * 1.25, wood, cx + sx * (wb / 2 - R * 0.06), y + 0.06, 0));   // 雀替坐
    }
    // 字板（匾额 / 花板）
    const paneW = Math.max(0.9, wb * (b.mid ? 0.44 : 0.62));
    if (p.plaques !== false && b.mid) {
      const pl = plaque({ w: paneW, h: paneH * 0.96, text: p.text, boardMat: M.paint(0x24405f, 0.52), frameMat: gold });
      pl.position.set(cx, yPane, beamD * 0.5 + 0.03);
      g.add(pl);
      const back = plaque({ w: paneW, h: paneH * 0.96, text: p.textBack || p.text, boardMat: M.paint(0x24405f, 0.52), frameMat: gold });
      back.position.set(cx, yPane, -beamD * 0.5 - 0.03);
      back.rotation.y = Math.PI;
      g.add(back);
    } else if (p.plaques !== false) {
      g.add(box(paneW, paneH, 0.1, M.paint(0x2b4a44, 0.6), cx, yPane, 0));                    // 花板（镂空雕花板心）
      const lace = [];
      for (let k = 0; k < 5; k++) lace.push({ p: [cx - paneW * 0.4 + k * paneW * 0.2, yPane, beamD * 0.5 + 0.05], s: [paneW * 0.07, paneH * 0.62, 0.05] });
      const lb = batch(new THREE.BoxGeometry(1, 1, 1), gold, lace);
      if (lb) g.add(lb);
    } else {
      g.add(box(bw * 0.92, paneH, beamD * 0.6, wood, cx, yPane, 0));                            // 无匾：实垫板
    }
    g.add(box(bw, 0.2, beamD, wood, cx, yTop, 0));                 // 小额枋（上）
    g.add(box(bw, 0.18, beamD * 0.9, wood, cx, yFlat, 0));         // 平板枋（坐斗之底）
    const dgY = yFlat + 0.09;
    if (!floors) continue;
    // 斗拱：柱头科（两端）+ 平身科（dgN 攒），斗口承接檩、椽
    if (p.dougong !== false) {
      const nd = clamp(Math.round(num(p.dgN, 3)), 0, 7);
      for (const sx of [-1, 1]) {
        const dg = dougong(wood, R * 2.8, { gold });
        dg.position.set(cx + sx * (wb / 2 + R * 0.1), dgY, 0);
        g.add(dg); nDg++;
      }
      if (nd > 0) {
        const inner = row((i2) => {
          const dg = dougong(wood, R * 2.35, { gold });
          dg.position.y = dgY + 0.02;
          nDg++;
          return dg;
        }, nd, wb * 0.74);
        inner.position.x = cx;
        g.add(inner);
      }
    }
    for (const sz of [1, -1]) {                                     // 正心桁 + 檐桁（横放的圆檩）
      const pu = cyl(0.13, 0.13, bw * 0.98, wood, seg(8), cx, dgY + R * 1.15, sz * Math.min(1.15, wb * 0.3));
      pu.rotation.z = Math.PI / 2;
      g.add(pu);
    }
    // 一楼：明间体量最大、次间略小（屋顶 + 脊饰 + 檐口挂在本间的组上，才能落到本间正中）
    const roofW = bw * (b.mid ? 1.12 : 1.04);
    const roofD = (b.mid ? 2.2 : 1.7) * clamp(H * 0.2, 0.75, 1.5);
    const rh = roofH * (b.mid ? 1 : 0.82);
    const y0 = p.dougong !== false ? dgY + R * 1.15 + 0.1 : yFlat + 0.26;
    const kind = b.mid ? (p.roofKind || 'xie') : 'juan';
    const bayG = new THREE.Group();
    bayG.position.x = cx;
    bayG.userData.marker = '楼';
    bayG.add(curvedRoof({ w: roofW, d: roofD, h: rh, kind, ridge: 0.36, brim: 0.42, eaveUp, mat: tile, seg: 18, y0 }));
    roofTrim(bayG, { w: roofW, d: roofD, h: rh, brim: 0.42, eaveUp, y0, kind, ridge: 0.36, tile, woodMat: wood, ridgeMat: rMat, trim, beasts: 3, beastScale: 0.8 });
    g.add(bayG);
    nRoof++;
  }
  g.userData.cn = { bays, posts: cols.length, roofs: nRoof, dougong: nDg, queti: nQue };
  return cnShade(g);
}
function buildPavilion(p) {
  const g = new THREE.Group();
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.7);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.64);
  const stone = M.stone(0xb7b1a6, 0.92);
  const s = Math.max(4, Math.round(num(p.sides, 6))), R = Math.max(1.2, num(p.r, 3.2)), H = Math.max(1.6, num(p.h, 3.2));
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  // 台基（三层须弥 + 踏跺）
  g.add(cyl(R * 1.5, R * 1.56, 0.2, stone, seg(s), 0, 0.1, 0));
  g.add(cyl(R * 1.38, R * 1.44, 0.2, stone, seg(s), 0, 0.3, 0));
  g.add(cyl(R * 1.3, R * 1.36, 0.16, M.stone(0xa6a096, 0.93), seg(s), 0, 0.48, 0));
  const y0 = 0.56;
  const nStep = 3;
  for (let i = 0; i < nStep; i++) g.add(box(R * 0.8, 0.18, 0.34, stone, 0, 0.09 + i * 0.18, R * 1.52 + 0.34 * (nStep - i) - 0.17));
  if (trim) { const rl = stoneRail({ len: R * 1.7, h: 0.52, y: y0, mat: stone, step: R * 0.42 }); rl.position.z = R * 1.48; rl.position.x = 0; g.add(rl); }
  // 檐柱 + 柱础 + 额枋 + 坐凳美人靠
  const edge = R * 2 * Math.sin(Math.PI / s);
  const inR = R * Math.cos(Math.PI / s);
  for (let i = 0; i < s; i++) {
    const a = (i / s) * Math.PI * 2 + Math.PI / s;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    g.add(cyl(0.14, 0.17, H, wood, seg(12), x, y0 + H / 2, z));
    g.add(cyl(0.26, 0.29, 0.1, stone, seg(10), x, y0 + 0.05, z));
    const a2 = ((i + 0.5) / s) * Math.PI * 2 + Math.PI / s;
    const mx = Math.cos(a2) * inR, mz = Math.sin(a2) * inR;
    const beam = box(edge * 0.99, 0.22, 0.16, wood, mx, y0 + H + 0.02, mz);
    beam.rotation.y = -a2 + Math.PI / 2; g.add(beam);                       // 额枋
    const pan = box(edge * 0.96, 0.12, 0.1, wood, mx, y0 + H - 0.2, mz);
    pan.rotation.y = -a2 + Math.PI / 2; g.add(pan);                          // 垫板
    if (p.railing) {                                                          // 坐凳 + 美人靠
      const seat = box(edge * 0.94, 0.08, 0.42, wood, mx, y0 + 0.44, mz);
      seat.rotation.y = -a2 + Math.PI / 2; g.add(seat);
      const rail2 = box(edge * 0.94, 0.07, 0.07, wood, mx, y0 + 0.94, mz);
      rail2.rotation.y = -a2 + Math.PI / 2; rail2.position.add(new THREE.Vector3(Math.cos(a2) * -0.18, 0, Math.sin(a2) * -0.18));
      g.add(rail2);
      const posts = [];
      for (let k = 0; k < 4; k++) posts.push({ p: [mx, y0 + 0.68, mz], s: [0.05, 0.5, 0.05] });
      const pp = batch(new THREE.BoxGeometry(1, 1, 1), wood, posts);
      if (pp) { pp.rotation.y = -a2 + Math.PI / 2; pp.position.add(new THREE.Vector3(0, 0, 0)); g.add(pp); }
    }
    if (p.gehua !== false) {                                                  // 挂落（枋下镂空白花）
      const gh = [];
      for (let k = 0; k < 5; k++) gh.push({ p: [0, y0 + H - 0.34, (k / 4 - 0.5) * edge * 0.8], s: [0.05, 0.26, 0.05] });
      const gm = batch(new THREE.BoxGeometry(1, 1, 1), wood, gh);
      if (gm) { gm.rotation.y = -a2 + Math.PI / 2; gm.position.set(mx, 0, mz); g.add(gm); }
    }
  }
  // -top: 井口天花 + 宝顶
  g.add(cyl(R * 1.18, R * 1.18, 0.2, wood, seg(s), 0, y0 + H + 0.2, 0));
  if (p.dougong) for (let i = 0; i < s; i++) {
    const a = (i / s) * Math.PI * 2 + Math.PI / s;
    const dg = dougong(wood, 0.78, { gold: M.metal(0xb08a3e, 0.4, 0.7) });
    dg.position.set(Math.cos(a) * R, y0 + H + 0.14, Math.sin(a) * R);
    dg.rotation.y = -a + Math.PI / 2;
    g.add(dg);
  }
  const ry0 = y0 + H + 0.3;
  // 檐口走「正多边形」：内切半径 = 柱网半径 + 1.05 m 出檐，角点正好落在檐柱外上方。
  // 旧版是 2.5R 的方罩子还多转 π/s：檐角卡在两柱之间、平直段外挑 1.3R，看着就是「下段外挑过多 + 翘角起法不对」。
  const roofR = (R + 1.05) * Math.cos(Math.PI / s);
  const crnR = roofR / Math.cos(Math.PI / s);
  const roof = curvedRoof({ w: roofR * 2, d: roofR * 2, h: p.roofH, kind: 'jin', brim: 0, eaveUp: num(p.eaveUp, 0.42), mat: tile, seg: 24, y0: ry0, sides: s });
  g.add(roof);
  if (trim) {
    g.add(eaveCornice({ w: roofR * 2, d: roofR * 2, brim: 0, eaveUp: num(p.eaveUp, 0.42), h: p.roofH, y: ry0 + 0.02, mat: wood, tileMat: tile, sides: s }));
    for (let i = 0; i < s; i++) {                                             // 垂脊：檐角 → 宝顶
      const a = (i / s) * Math.PI * 2 + Math.PI / s;
      const cx = Math.cos(a) * crnR, cz = Math.sin(a) * crnR;
      const eU = clamp(num(p.eaveUp, 0.42), 0, 0.9);
      const yy = ry0 + p.roofH * (0.24 + 0.73 * eU);                       // 屋面在角端的实际标高
      const rr = hipRidge({ len: Math.hypot(cx, cz) * 0.93, rise: Math.max(0.05, p.roofH * (0.76 - 0.24 - 0.73 * eU)), mat: tile, beastMat: M.metal(0xb99a4e, 0.42, 0.8), beasts: Math.round(num(p.beasts, 3)), s: 0.8, w: 0.16 });
      rr.position.set(cx, yy, cz);
      rr.rotation.y = Math.PI - Math.atan2(cz, cx);   // +x 绕 y 转 φ 落到 (cosφ, -sinφ)：朝圆心是 π-φ，不是 φ+π
      g.add(rr);
    }
  }
  const by = ry0 + p.roofH;                                                    // 宝顶：须弥 + 仰莲 + 相轮 + 宝珠
  g.add(cyl(0.26, 0.3, 0.14, tile, seg(8), 0, by + 0.08, 0));
  g.add(cyl(0.2, 0.24, 0.16, M.metal(0xd8b25a, 0.3, 0.85), seg(8), 0, by + 0.22, 0));
  g.add(cone(0.24, 0.16, M.metal(0xd8b25a, 0.3, 0.85), seg(8), 0, by + 0.38, 0));
  g.add(cyl(0.07, 0.09, 0.5, M.metal(0xd8b25a, 0.3, 0.85), seg(8), 0, by + 0.68, 0));
  for (let i = 0; i < 3; i++) g.add(cyl(0.19 - i * 0.045, 0.2 - i * 0.045, 0.055, M.metal(0xd8b25a, 0.3, 0.85), seg(8), 0, by + 0.56 + i * 0.16, 0));
  g.add(sph(0.14, M.metal(0xe6c56d, 0.24, 0.9), seg(10), 0, by + 1.06, 0));
  g.add(cone(0.07, 0.2, M.metal(0xe6c56d, 0.24, 0.9), seg(6), 0, by + 1.28, 0));
  g.userData.pavilion = { sides: s, trim, railing: !!p.railing };
  return cnShade(g);
}
function buildGate(p) {
  const g = new THREE.Group();
  const stone = M.stone(new THREE.Color(p.wall).getHex(), 0.92);
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.7);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.64);
  const gold = M.metal(0xc9a45c, 0.36, 0.82);
  const W = Math.max(6, num(p.w, 22)), H = Math.max(3, num(p.wallH, 9)), D = Math.max(3, num(p.d, 8));
  const ow = clamp(num(p.openW, 5.5), 2, W * 0.6), oh = Math.min(H * 0.74, ow * 1.05);
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  // ── 城台（分成三块让出门洞）+ 券脸石 + 券砖 ───────────────────
  const side = (W - ow) / 2;
  g.add(box(side, H, D, stone, -(ow + side) / 2, H / 2, 0));
  g.add(box(side, H, D, stone, (ow + side) / 2, H / 2, 0));
  g.add(box(ow, H - oh, D, stone, 0, oh + (H - oh) / 2, 0));
  for (const sz of [1, -1]) {                                            // 券脸石（门洞口的边框 + 券）
    g.add(box(0.42, oh + 0.5, 0.28, M.stone(0xa9a39a, 0.9), -ow / 2 - 0.2, (oh + 0.5) / 2, sz * (D / 2 + 0.1)));
    g.add(box(0.42, oh + 0.5, 0.28, M.stone(0xa9a39a, 0.9), ow / 2 + 0.2, (oh + 0.5) / 2, sz * (D / 2 + 0.1)));
    g.add(box(ow + 0.9, 0.42, 0.28, M.stone(0xa9a39a, 0.9), 0, oh + 0.5, sz * (D / 2 + 0.1)));
    const nv = clamp(Math.round(mul(11)), 7, 17);
    const rV = ow / 2, ycV = Math.max(0, oh - rV);                 // 半圆券：圆心在起拱线，拱顶恰在 oh
    for (let i = 1; i < nv; i++) {
      const a = Math.PI * (i / nv);
      const b = box(ow * 0.12, 0.36, 0.26, M.stone(0xb4aea4, 0.9), Math.cos(a) * rV, ycV + Math.sin(a) * rV, sz * (D / 2 + 0.12));
      b.rotation.z = a - Math.PI / 2;                              // 楔形券石长边沿切线
      g.add(b);
    }
    for (const sx of [-1, 1]) g.add(box(0.5, 0.34, 0.32, M.stone(0xb4aea4, 0.9), sx * (rV + 0.12), ycV - 0.02, sz * (D / 2 + 0.12)));   // 拱脚起拱石
    g.add(box(ow + 1.2, 0.2, 0.4, M.stone(0x9f9a90, 0.92), 0, 0.1, sz * (D / 2 + 0.12)));  // 门枕石 / 海墁
  }
  g.add(box(ow + 0.6, 0.08, 0.44, M.stone(0x9f9a90, 0.9), 0, 0.04, D / 2 + 0.1));          // 门洞地栿（旧版是半空里一根 10 cm 小方木）
  const grate = [];
  for (let i = 1; i < 10; i++) grate.push({ p: [-ow / 2 + (i / 10) * ow, oh * 0.45, D / 2 - 0.1], s: [0.06, oh * 0.9, 0.06] });
  for (let i = 1; i < 5; i++) grate.push({ p: [0, oh * 0.9 * (i / 5) + 0.02, D / 2 - 0.1], s: [ow, 0.055, 0.055] });
  const gm = batch(new THREE.BoxGeometry(1, 1, 1), M.metal(0x5b5f66, 0.5, 0.7), grate);   // 闸门（千斤闸）
  if (gm) g.add(gm);
  // ── 城顶：海墁 + 宇墙 + 两侧垛口 + 排水石嘴 ────────────────────
  g.add(box(W + 0.6, 0.18, D + 0.6, M.stone(0x9c978d, 0.9), 0, H + 0.09, 0));
  for (const sz of [1, -1]) {
    if (sz > 0) g.add(box(W + 0.5, 0.5, 0.22, stone, 0, H + 0.43, sz * (D / 2 + 0.1)));   // 内侧宇墙
    const nn = Math.floor(W / 1.7);
    const merlons = [];
    for (let i = 0; i < nn; i++) {
      const x = -W / 2 + 0.85 + i * 1.7;
      if (sz > 0) continue;                                            // 垛口只列在外沿（临战面），内侧走宇墙
      merlons.push({ p: [x, H + 0.79, sz * (D / 2 + 0.22)], s: [0.62, 0.6, 0.34] });
    }
    const mm = batch(new THREE.BoxGeometry(1, 1, 1), stone, merlons);
    if (mm) g.add(mm);
    const spouts = [];
    for (let i = 0; i < Math.max(2, Math.floor(W / 6)); i++) {
      const x = (-0.5 + (i + 0.5) / Math.max(2, Math.floor(W / 6))) * W;
      spouts.push({ p: [x, H + 0.16, sz * (D / 2 + 0.42)], s: [0.3, 0.24, 0.62] });
    }
    const sp = batch(new THREE.BoxGeometry(1, 1, 1), M.stone(0xa8a29a, 0.9), spouts);  // 排水石嘴
    if (sp) g.add(sp);
  }
  if (p.ramp !== false) {                                                          // 登城马道
    const n = clamp(Math.round(H / 0.34), 3, 22), stH = H / n;
    for (let i = 0; i < n; i++) g.add(box(2.0, stH, 0.44, stone, W / 2 + 1.4, stH * (i + 0.5), D / 2 - 0.3 - (n - i) * 0.44));
    g.add(box(0.3, H * 0.94, n * 0.44 + 0.3, stone, W / 2 + 0.42, H * 0.47, D / 2 - n * 0.22 - 0.3));
    g.add(box(0.3, H * 0.94, n * 0.44 + 0.3, stone, W / 2 + 2.4, H * 0.47, D / 2 - n * 0.22 - 0.3));
  }
  // ── 城楼：台明 + 檐柱一周 + 墙体 + 匾额 + 屋顶（含脊兽檐口）────────
  const y0 = H + 0.18;
  g.add(box(W * 0.9, 0.3, D * 0.94, M.stone(0xa9a49a, 0.9), 0, y0 + 0.15, 0));
  const fh = clamp(num(p.floorH, 4), 2, 8);
  const nCol = clamp(Math.round(W / 3.4) * 2 + 2, 6, 22);
  const towerW = W * 0.78, towerD = D * 0.7;
  const f = row(() => {
    const grp = new THREE.Group();
    grp.add(cyl(0.2, 0.23, fh, wood, seg(12), 0, fh / 2, 0));
    grp.add(cyl(0.34, 0.36, 0.1, M.stone(0xa9a49a, 0.92), seg(10), 0, 0.05, 0));
    { const dgA = dougong(wood, 0.78, { gold }); dgA.position.y = fh + 0.02; grp.add(dgA); }   // 斗拱在柱头（旧版留在柱脚，檐下空着）
    return grp;
  }, nCol, towerW);
  f.position.set(0, y0 + 0.3, towerD / 2); g.add(f);
  const b1 = f.clone(); b1.position.z = -towerD / 2; g.add(b1);
  const nSide = Math.max(3, Math.round(towerD / 3.4));
  const sd = row(() => {
    const grp = new THREE.Group();
    grp.add(cyl(0.2, 0.23, fh, wood, seg(12), 0, fh / 2, 0));
    { const dgA = dougong(wood, 0.78, { gold }); dgA.position.y = fh + 0.02; grp.add(dgA); }   // 斗拱在柱头（旧版留在柱脚，檐下空着）
    return grp;
  }, nSide, towerD);
  sd.rotation.y = Math.PI / 2; sd.position.set(towerW / 2, y0 + 0.3, 0); g.add(sd);
  const sd2 = sd.clone(); sd2.position.x = -towerW / 2; g.add(sd2);
  g.add(box(towerW * 0.99, fh * 0.96, towerD * 0.99, M.paint(0xcfc4ae, 0.78), 0, y0 + 0.3 + fh * 0.48, 0));   // 墙身升到檐檩底，上面不再空一道
  const nDoor = clamp(Math.round(towerW / 1.5), 3, 11);
  for (let i = 0; i < nDoor; i++) {
    const x = (i / nDoor - 0.5) * towerW * 0.92 + towerW * 0.92 / (2 * nDoor);
    g.add(box(towerW * 0.9 / nDoor * 0.9, fh * 0.56, 0.1, M.paint(new THREE.Color(p.column).getHex(), 0.55), x, y0 + 0.3 + fh * 0.28, towerD / 2 + 0.02));
  }
  if (p.plaque !== false) {
    const pl = plaque({ w: Math.min(2.6, towerW * 0.2), h: 0.86, text: p.text || '永安门', boardMat: M.paint(0x22364f, 0.5), frameMat: gold });
    pl.position.set(0, y0 + 0.3 + fh * 0.72, towerD / 2 + 0.06);
    g.add(pl);
  }
  if (trim) g.add(caihua(towerW * 0.98, { p: M.paint(0x2f5b8a, 0.6), q: M.paint(0x3c7a5e, 0.6), r: M.paint(0x8f3a2c, 0.6), g: gold }, { h: 0.26, y: y0 + 0.3 + fh - 0.24, z: towerD / 2 + 0.06 }));
  const rH = clamp(num(p.roofH, 2.4), 0.8, 6);
  const ry0 = y0 + 0.3 + fh + 0.36;        // 檐口落在斗拱外皮上（旧版留 0.2 空当，屋面看着浮在城台上）
  g.add(curvedRoof({ w: towerW + 1.6, d: towerD + 1.6, h: rH, kind: 'xie', brim: 0.7, eaveUp: 0.3, mat: tile, seg: 22, y0: ry0 }));
  roofTrim(g, { w: towerW + 1.6, d: towerD + 1.6, h: rH, brim: 0.7, eaveUp: 0.3, y0: ry0, kind: 'xie', tile, woodMat: wood, ridgeMat: M.paint(0x31363d, 0.6), trim, beasts: 5 });
  if (p.towers) for (const sx of [-1, 1]) {                                      // 角亭（闸亭）
    g.add(box(3.2, 3.4, 3.2, stone, sx * (W / 2 - 1.6), y0 + 1.7, 0));          // 角亭建在城顶，不在城台肚子里
    for (const sz of [1, -1]) for (let i = 0; i < 2; i++) g.add(box(0.5, 0.55, 0.28, stone, sx * (W / 2 - 1.6) + (i - 0.5) * 1.2, y0 + 3.7, sz * 1.35));
    const ty = y0 + 3.4;
    g.add(curvedRoof({ w: 3.6, d: 3.6, h: 1.3, kind: 'jin', eaveUp: 0.5, mat: tile, seg: 12, y0: ty }));
    g.add(sph(0.22, gold, seg(8), sx * (W / 2 - 1.6), ty + 1.42, 0));
    for (const sz of [1, -1]) g.add(cyl(0.14, 0.14, 0.5, M.paint(0x2b2118, 0.6), 8, sx * (W / 2 - 1.6), 2.2, sz * 1.7));
  }
  g.userData.gate = { merlon: true, spout: true, ramp: p.ramp !== false, trim };
  return cnShade(g);
}
function buildCityWall(p) {
  const g = new THREE.Group();
  const stone = M.stone(new THREE.Color(p.color).getHex(), 0.92);
  const stone2 = M.stone(0x9c978d, 0.93);
  const L = Math.max(4, num(p.length, 42)), H = Math.max(2, num(p.height, 8)), T = Math.max(2, num(p.thick, 6));
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  const lean = clamp(T * 0.055, 0.1, 0.5);                       // 侧脚（墙面收分）
  g.add(box(L, H * 0.56, T, stone, 0, H * 0.28, 0));
  g.add(box(L, H * 0.3, T - lean * 2, stone, 0, H * 0.71, 0));
  g.add(box(L, H * 0.16, T - lean * 4, stone, 0, H * 0.94, 0));
  g.add(box(L + 0.5, 0.22, T + 0.6, M.stone(new THREE.Color(p.color).getHex(), 0.95), 0, 0.11, 0));   // 碱脚 / 散水
  // 顶面海墁 + 两边宇墙 + 垛口（含射孔）+ 排水石嘴
  g.add(box(L, 0.24, T + 0.5, stone2, 0, H + 0.12, 0));
  if (p.paving !== false) {
    const tiles = [];
    for (let i = 0; i < clamp(Math.round(mul(L / 1.6)), 4, 80); i++) {
      const x = (i / clamp(Math.round(mul(L / 1.6)), 4, 80) - 0.5) * L;
      tiles.push({ p: [x, H + 0.26, 0], s: [0.06, 0.03, T * 0.94] });
    }
    const tm = batch(new THREE.BoxGeometry(1, 1, 1), M.stone(0x8f8a80, 0.9), tiles);                    // 墁砖分缝
    if (tm) g.add(tm);
  }
  const n = Math.max(2, Math.floor(L / 1.7));
  for (const sz of [1, -1]) {
    g.add(box(L, 0.42, 0.22, stone, 0, H + 0.45, sz * (T / 2 + 0.02)));                                   // 宇墙
    const merlons = [], slots = [];
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.85 + i * 1.7;
      merlons.push({ p: [x, H + 0.78, sz * (T / 2 + 0.02)], s: [0.62, 0.62, 0.34] });
      slots.push({ p: [x, H + 0.82, sz * (T / 2 + 0.2)], s: [0.16, 0.26, 0.08] });                        // 射孔
    }
    const m1 = batch(new THREE.BoxGeometry(1, 1, 1), stone, merlons);
    if (m1) g.add(m1);
    const m2 = batch(new THREE.BoxGeometry(1, 1, 1), M.dark(0x2a2f36, 0.85), slots);
    if (m2) g.add(m2);
    const spouts = [];
    for (let i = 0; i < Math.max(2, Math.floor(L / 7)); i++) {
      const x = (-0.5 + (i + 0.5) / Math.max(2, Math.floor(L / 7))) * L;
      spouts.push({ p: [x, H + 0.2, sz * (T / 2 + 0.5)], s: [0.3, 0.22, 0.66] });
    }
    const sp = batch(new THREE.BoxGeometry(1, 1, 1), stone2, spouts);                                     // 石嘴（排水）
    if (sp) g.add(sp);
  }
  if (p.stairs !== false) {                                         // 登城步梯（一侧）+ 马道
    const nS = clamp(Math.round(H / 0.3), 4, 26), stH = H / nS;
    const steps = [];
    for (let i = 0; i < nS; i++) steps.push({ p: [L / 2 - 2.4, stH * (i + 0.5), T / 2 + 0.9 + (nS - i) * 0.001 - (nS - i) * 0.0 + i * 0 + (nS - i) * 0], s: [1.8, stH, 0.42] });
    for (let i = 0; i < nS; i++) { steps[i].p[2] = T / 2 + 0.9 + (nS - i) * 0.42 - nS * 0.21; }
    const st = batch(new THREE.BoxGeometry(1, 1, 1), stone2, steps);
    if (st) g.add(st);
    for (const sz of [1, -1]) {
      const wall2 = box(0.26, H * 0.9, nS * 0.42, stone, L / 2 - 2.4 + sz * 1.0, H * 0.45, T / 2 + 0.9);
      wall2.rotation.y = 0;
      g.add(wall2);
    }
    g.add(box(2.6, 0.14, nS * 0.42 + 1.2, stone, L / 2 - 2.4, H * 0.92, T / 2 + 0.9));                     // 梯顶平台
  }
  if (p.tower) {                                                      // 敌台（台体 + 券窗 + 一层楼 + 顶）
    const tw = clamp(num(p.towerW, 8), 3, 16), th = H + 3.2;
    g.add(box(tw, th, tw + 2, stone, 0, th / 2, 0));
    g.add(box(tw + 0.5, 0.2, tw + 2.5, stone2, 0, 0.1, 0));
    for (const sz of [1, -1]) for (let i = 0; i < 2; i++) {
      const wy = H * 0.34 + i * H * 0.42;
      g.add(box(0.9, 1.1, 0.24, M.dark(0x20242b, 0.8), 0, wy, sz * (tw / 2 + 1.02)));                      // 券窗
      for (const sx of [-1, 1]) g.add(box(0.24, 1.4, 0.3, stone2, sx * 0.66, wy, sz * (tw / 2 + 1.06)));    // 窗套
      g.add(box(1.5, 0.18, 0.3, stone2, 0, wy + 0.68, sz * (tw / 2 + 1.04)));                                // 窗楣
    }
    for (let i = 0; i < 2; i++) for (const sx of [-1, 1]) {
      g.add(box(0.9, 1.1, 0.24, M.dark(0x20242b, 0.8), sx * (tw / 2 + 1.02), H * 0.4 + i * H * 0.4, 0));
    }
    for (const sz of [1, -1]) {                                                                             // 敌台顶宇墙 + 垛口
      g.add(box(tw + 0.4, 0.4, 0.22, stone, 0, th + 0.2, sz * (tw / 2 + 0.9)));
      const mm = [];
      for (let i = 0; i < 4; i++) mm.push({ p: [-tw / 2 + 0.6 + i * (tw - 1.2) / 3, th + 0.6, sz * (tw / 2 + 0.9)], s: [0.56, 0.56, 0.3] });
      const mb = batch(new THREE.BoxGeometry(1, 1, 1), stone, mm);
      if (mb) g.add(mb);
    }
    const ry = th + 0.4;
    g.add(curvedRoof({ w: tw + 1.6, d: tw + 3.4, h: 1.9, kind: 'xie', eaveUp: 0.36, mat: roofSurf(new THREE.Color(p.roof).getHex(), 0.65), seg: 16, y0: ry }));
    roofTrim(g, { w: tw + 1.6, d: tw + 3.4, h: 1.9, brim: 0.6, eaveUp: 0.36, y0: ry, kind: 'xie', tile: roofSurf(new THREE.Color(p.roof).getHex(), 0.65), woodMat: M.paint(0x7d4a2c, 0.72), ridgeMat: M.paint(0x31363d, 0.6), trim, beasts: 3 });
    g.add(box(tw * 0.5, 0.16, 0.3, M.paint(0x7d4a2c, 0.7), 0, ry - 0.1, tw / 2 + 1.7));
  }
  g.userData.wall = { merlons: n, tower: !!p.tower, stairs: p.stairs !== false, paving: p.paving !== false };
  return cnShade(g);
}
function buildCorridor(p) {
  const g = new THREE.Group();
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.7);
  const dark = M.paint(new THREE.Color(p.column).getHex(), 0.58);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.64);
  const stone = M.stone(0xb0aa9f, 0.92);
  const gold = M.metal(0xc9a45c, 0.38, 0.8);
  const caihuaMats = { p: M.paint(0x2f5b8a, 0.6), q: M.paint(0x3c7a5e, 0.6), r: M.paint(0x8f3a2c, 0.6), g: gold };
  const len = Math.max(3, num(p.length, 24)), cw = Math.max(1.4, num(p.w, 3)), H = Math.max(2, num(p.h, 3.4));
  const sp = clamp(num(p.spacing, 3.4), 1.6, 8);
  const trim = p.trim !== false, gehua = p.gehua !== false;
  const n = Math.max(2, Math.round(len / sp) + 1);
  // 台明 + 阶条石 + 埋头
  g.add(box(len + 1, 0.2, cw + 0.9, stone, 0, 0.1, 0));
  g.add(box(len + 1.3, 0.08, cw + 1.2, M.stone(0x9f9a90, 0.94), 0, 0.04, 0));
  const y0 = 0.2;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * (len / (n - 1));
    for (const s of [-1, 1]) {
      g.add(cyl(0.13, 0.15, H, wood, seg(12), x, y0 + H / 2, s * cw / 2));
      g.add(cyl(0.24, 0.26, 0.1, stone, seg(10), x, y0 + 0.05, s * cw / 2));      // 柱础
      g.add(box(0.42, 0.14, 0.42, stone, x, y0 + 0.13, s * cw / 2, 0.03));         // 磉石
      if (i < n - 1) {
        const seg2 = len / (n - 1);
        g.add(box(seg2, 0.2, 0.2, wood, x + seg2 / 2, y0 + H + 0.1, s * cw / 2));  // 檐枋
        g.add(box(seg2, 0.12, 0.14, dark, x + seg2 / 2, y0 + H - 0.06, s * cw / 2)); // 小额枋
        g.add(box(seg2 * 0.9, 0.06, 0.3, wood, x + seg2 / 2, y0 + 0.5, 0));         // 穿枋（联系两根檐柱）
        if (trim) g.add(caihua(seg2 * 0.96, caihuaMats, { h: 0.18, y: y0 + H - 0.14, z: s * (cw / 2 + 0.11), x: x + seg2 / 2 }));
        if (p.railing) {                                                             // 坐凳 + 美人靠
          g.add(box(seg2 * 0.9, 0.07, 0.36, wood, x + seg2 / 2, y0 + 0.44, s * (cw / 2 - 0.2)));
          g.add(box(seg2 * 0.9, 0.06, 0.06, wood, x + seg2 / 2, y0 + 0.86, s * (cw / 2 - 0.34)));
          const sp2 = [];
          for (let k = 0; k < 4; k++) sp2.push({ p: [x + seg2 * (0.14 + k * 0.24), y0 + 0.65, s * (cw / 2 - 0.3)], s: [0.05, 0.42, 0.05] });
          const mm = batch(new THREE.BoxGeometry(1, 1, 1), wood, sp2);
          if (mm) g.add(mm);
        }
        if (gehua) {                                                                 // 挂落：枋下镂空白花
          const gh = [];
          for (let k = 0; k < 5; k++) gh.push({ p: [x + seg2 * (0.12 + k * 0.19), y0 + H - 0.28, s * (cw / 2 + 0.02)], s: [0.05, 0.3, 0.05] });
          gh.push({ p: [x + seg2 / 2, y0 + H - 0.44, s * (cw / 2 + 0.02)], s: [seg2 * 0.8, 0.05, 0.05] });
          const gm = batch(new THREE.BoxGeometry(1, 1, 1), dark, gh);
          if (gm) g.add(gm);
        }
      }
    }
    if (trim) {
      const dg = dougong(wood, 0.52, { gold });
      dg.position.set(x, y0 + H + 0.22, 0);
      g.add(dg);
      for (const s of [-1, 1]) { const d2 = dg.clone(); d2.position.z = s * cw / 2; d2.scale.setScalar(0.8); g.add(d2); }
    }
  }
  const rY = y0 + H + 0.3;
  g.add(curvedRoof({ w: len + 1.2, d: cw + 1.6, h: 0.9, kind: 'juan', brim: 0.5, eaveUp: 0.4, mat: tile, seg: 22, y0: rY }));
  roofTrim(g, { w: len + 1.2, d: cw + 1.6, h: 0.9, brim: 0.5, eaveUp: 0.4, y0: rY, kind: 'juan', tile, woodMat: wood, ridgeMat: M.paint(0x31363d, 0.6), trim, drip: p.drip !== false });
  if (p.hang !== false) {                                     // 挂檐板（檐口下的竖直木板）
    for (const s of [-1, 1]) g.add(box(len + 1.1, 0.18, 0.06, dark, 0, rY + 0.06, s * (cw / 2 + 0.78)));
  }
  g.userData.corridor = { bays: n - 1, trim, gehua, railing: !!p.railing };
  return cnShade(g);
}
function buildArchBridge(p) {
  const g = new THREE.Group();
  const stone = M.stone(new THREE.Color(p.color).getHex(), 0.9);
  const stone2 = M.stone(0xa29c92, 0.92);
  const span = Math.max(2, num(p.span, 12)), rise = Math.max(0.5, num(p.rise, 3.6)), bw = Math.max(1.4, num(p.w, 4.6));
  const rail = p.rail !== false, trim = p.trim !== false;
  const R = (span * span / 4 + rise * rise) / (2 * rise);
  const yBase = 0.55;                            // 起拱线离地：桥面端头落在桥头台顶上，而不是从地面直接插出来
  const cy = rise - R + yBase;
  const segs = clamp(Math.round(mul(22)), 10, 34);
  const deck = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const th0 = Math.PI / 2 + Math.asin(clamp((t0 - 0.5) * span / R, -1, 1));
    const th1 = Math.PI / 2 + Math.asin(clamp((t1 - 0.5) * span / R, -1, 1));
    const x0 = Math.cos(th0) * R, y0 = cy + Math.sin(th0) * R;
    const x1 = Math.cos(th1) * R, y1 = cy + Math.sin(th1) * R;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const ln = Math.hypot(x1 - x0, y1 - y0);
    const rot = Math.atan2(y1 - y0, x1 - x0);
    deck.push({ p: [mx, my - 0.2, 0], r: [0, 0, rot], s: [ln + 0.16, 0.4, bw] });         // 拱石（券）
    deck.push({ p: [mx, my + 0.06, 0], r: [0, 0, rot], s: [ln + 0.2, 0.14, bw + 0.2] });  // 桥面石板
  }
  const dm = batch(new THREE.BoxGeometry(1, 1, 1), stone, deck);
  if (dm) g.add(dm);
  const spand = [];                                                                       // 券背两侧边梁（地栿）：贴拱背走，旧版垂到拱洞里
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const th = Math.PI / 2 + Math.asin(clamp((t - 0.5) * span / R, -1, 1));
    const x = Math.cos(th) * R, y = cy + Math.sin(th) * R;
    const rotA = Math.atan2(Math.cos(th), -Math.sin(th));
    for (const sz of [1, -1]) spand.push({ p: [x, y + 0.1, sz * (bw / 2 + 0.06)], r: [0, 0, rotA], s: [span / segs * 1.14, 0.24, 0.3] });
  }
  const sm = batch(new THREE.BoxGeometry(1, 1, 1), stone2, spand);
  if (sm) g.add(sm);
  if (trim) {                                                                             // 券脸石：沿拱腹一圈楔形砖
    const nv = clamp(Math.round(mul(13)), 7, 21);
    const vs = [];
    for (let i = 0; i <= nv; i++) {
      const t = i / nv;
      const th = Math.PI / 2 + Math.asin(clamp((t - 0.5) * span / R, -1, 1));
      const x = Math.cos(th) * (R - 0.16), y = cy + Math.sin(th) * (R - 0.16);
      for (const sz of [1, -1]) vs.push({ p: [x, y, sz * (bw / 2 + 0.06)], r: [0, 0, th - Math.PI / 2], s: [span / nv * 0.86, 0.34, 0.14] });
    }
    const vm = batch(new THREE.BoxGeometry(1, 1, 1), M.stone(0xbdb7ab, 0.9), vs);
    if (vm) g.add(vm);
  }
  const nR = clamp(Math.round(span / 1.35), 2, 26);
  const posts = [], caps = [], panels = [], keys = [];
  for (let i = 0; i <= nR; i++) {
    const x = (i / nR - 0.5) * span;
    const th = Math.PI / 2 + Math.asin(clamp(x / R, -1, 1));
    const y = cy + Math.sin(th) * R;
    const rot = Math.atan2(Math.cos(th), -Math.sin(th) * 0.001);
    for (const sz of [-1, 1]) {
      posts.push({ p: [x, y + 0.56, sz * (bw / 2 - 0.08)], s: [0.18, 0.9, 0.18] });
      caps.push({ p: [x, y + 1.1, sz * (bw / 2 - 0.08)], s: [0.13, 0.16, 0.13] });
      if (i < nR) {
        const x2 = ((i + 1) / nR - 0.5) * span;
        const th2 = Math.PI / 2 + Math.asin(clamp(x2 / R, -1, 1));
        const y2 = cy + Math.sin(th2) * R;
        const mx = (x + x2) / 2, my = (y + y2) / 2, ang = Math.atan2(y2 - y, x2 - x);
        panels.push({ p: [mx, my + 0.86, sz * (bw / 2 - 0.08)], r: [0, 0, ang], s: [Math.hypot(x2 - x, y2 - y) * 0.9, 0.46, 0.09] });   // 栏板
        panels.push({ p: [mx, my + 1.14, sz * (bw / 2 - 0.08)], r: [0, 0, ang], s: [Math.hypot(x2 - x, y2 - y) * 0.94, 0.07, 0.14] });  // 寻杖
      }
    }
    if (i === Math.round(nR / 2)) for (const sz of [-1, 1]) keys.push({ p: [x, y + 0.3, sz * (bw / 2 + 0.22)], s: [0.34, 0.3, 0.5] });  // 中央抱鼓
  }
  const b1 = batch(new THREE.BoxGeometry(1, 1, 1), stone, posts);
  if (b1) g.add(b1);
  const b2 = batch(new THREE.BoxGeometry(1, 1, 1), stone2, caps);
  if (b2) g.add(b2);
  if (rail) {
    const b3 = batch(new THREE.BoxGeometry(1, 1, 1), stone, panels);
    if (b3) g.add(b3);
    const b4 = batch(new THREE.BoxGeometry(1, 1, 1), M.stone(0xc0b9ac, 0.88), keys);
    if (b4) g.add(b4);
  }
  if (trim) {                                                                            // 望柱柱头：石狮 / 莲
  const heads = [];
    for (let i = 0; i <= nR; i++) {
      const x = (i / nR - 0.5) * span;
      const th = Math.PI / 2 + Math.asin(clamp(x / R, -1, 1));
      const y = cy + Math.sin(th) * R;
      for (const sz of [-1, 1]) {
        heads.push({ p: [x, y + 1.3, sz * (bw / 2 - 0.08)], s: [0.2, 0.16, 0.24] });
        heads.push({ p: [x + 0.07, y + 1.44, sz * (bw / 2 - 0.08)], s: [0.13, 0.11, 0.13] });
      }
    }
    const hb = batch(new THREE.BoxGeometry(1, 1, 1), M.stone(0xc9c3b6, 0.86), heads);
    if (hb) g.add(hb);
  }
  const abTop = yBase - 0.2;                      // 桥头台顶面低于桥面端头，否则石台把桥面「打断」
  for (const s of [-1, 1]) {                      // 桥堿（两岸桥头台）+ 八字墙 + 落坡台阶
    g.add(box(span * 0.32, abTop + 0.9, bw * 1.02, stone2, s * (span * 0.5 + span * 0.15), (abTop - 0.9) / 2, 0));
    for (const sz of [1, -1]) {
      const wg = box(2.6, abTop + 1.05, 0.34, stone2, s * (span * 0.5 + span * 0.31), (abTop + 1.05) / 2 - 0.9, sz * (bw * 0.5 + 0.74));
      wg.rotation.y = -s * sz * 0.52;                                          // 八字墙向外撇
      g.add(wg);
    }
    for (let i = 0; i < 3; i++) g.add(box(bw * 0.62, 0.16, 0.42, stone, s * (span * 0.5 + span * 0.33 + i * 0.42), abTop - 0.14 - i * 0.16, 0));
  }
  if (trim) for (const sz of [1, -1]) {                                                  // 螭首（桥头排水兽头）
    for (const sx of [1, -1]) {
      g.add(box(0.36, 0.3, 0.7, M.stone(0xbdb7ab, 0.88), sx * span * 0.42, cy + R * 0.42, sz * (bw / 2 + 0.24), 0.08));
      g.add(box(0.24, 0.22, 0.3, M.stone(0xbdb7ab, 0.88), sx * (span * 0.42 + 0.34), cy + R * 0.42 + 0.06, sz * (bw / 2 + 0.24), 0.06));
    }
  }
  g.userData.bridge = { segs, voussoir: trim, rail, chi: trim };
  return cnShade(g);
}
function buildDrumTower(p) {
  const g = new THREE.Group();
  const W = Math.max(4, num(p.w, 12)), baseH = Math.max(2, num(p.baseH, 6.5));
  const levels = clamp(Math.round(num(p.levels, 2)), 1, 3), fh = Math.max(2, num(p.floorH, 3.6));
  const stone = M.stone(0xb0a89a, 0.92);
  const stone2 = M.stone(0x9f9a90, 0.94);
  const wood = M.paint(new THREE.Color(p.column).getHex(), 0.7);
  const tile = roofSurf(new THREE.Color(p.roof).getHex(), 0.64);
  const gold = M.metal(0xc9a45c, 0.36, 0.82);
  const caihuaMats = { p: M.paint(0x2f5b8a, 0.6), q: M.paint(0x3c7a5e, 0.6), r: M.paint(0x8f3a2c, 0.6), g: gold };
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  // ── 城台：十字券洞 + 券脸 + 宇墙栏杆 ────────────────────────────
  g.add(box(W, baseH, W, stone, 0, baseH / 2, 0));
  g.add(box(W + 0.5, 0.2, W + 0.5, stone2, 0, 0.1, 0));
  const oh = Math.min(baseH * 0.72, W * 0.34), ow = W * 0.3;
  for (const rot of [0, Math.PI / 2]) {
    for (const sz of [1, -1]) {
      const e = box(ow, oh, 0.3, M.dark(0x181c22, 0.85), 0, oh / 2, sz * (W / 2 + 0.02));
      if (rot) { e.position.z = 0; e.position.x = sz * (W / 2 + 0.02); e.rotation.y = Math.PI / 2; }
      g.add(e);
      const fr = box(ow + 0.9, 0.34, 0.4, stone2, 0, oh + 0.2, sz * (W / 2 + 0.12));
      if (rot) { fr.position.x = sz * (W / 2 + 0.12); fr.position.y = oh + 0.2; fr.position.z = 0; fr.rotation.y = Math.PI / 2; }
      g.add(fr);
    }
  }
  if (p.rail !== false) {
    for (const sz of [1, -1]) { const r1 = stoneRail({ len: W - 0.3, h: 0.55, y: baseH, mat: stone2 }); r1.position.z = sz * (W / 2 - 0.1); g.add(r1); }
    for (const sx of [1, -1]) { const r2 = stoneRail({ len: W - 0.3, h: 0.55, y: baseH, mat: stone2, axis: 'z' }); r2.position.x = sx * (W / 2 - 0.1); g.add(r2); }
  }
  if (p.plaque !== false) {
    const pl = plaque({ w: 1.7, h: 0.72, text: p.text || '鐘鼓樓', boardMat: M.paint(0x22364f, 0.5), frameMat: gold });
    pl.position.set(0, oh + 0.9, W / 2 + 0.16);
    g.add(pl);
  }
  // ── 楼身：每层 檐柱一周 + 墙 + 平座 + 斗拱 + 屋顶 ───────────────
  for (let lv = 0; lv < levels; lv++) {
    const s = 1 - lv * 0.14, y0 = baseH + lv * (fh + 1.0);
    const bw2 = W * 0.84 * s, bd2 = W * 0.84 * s;
    const nCol = clamp(Math.round(bw2 / 2.6) + 2, 4, 10);
    for (const sz of [1, -1]) {
      const rw = row(() => {
        const grp = new THREE.Group();
        grp.add(cyl(0.16, 0.18, fh, wood, seg(12), 0, fh / 2, 0));
        grp.add(cyl(0.3, 0.32, 0.1, stone2, seg(10), 0, 0.05, 0));
        if (p.dougong !== false) grp.add(dougong(wood, 0.66, { gold }));
        return grp;
      }, nCol, bw2);
      rw.position.set(0, y0, sz * bd2 / 2);
      g.add(rw);
    }
    g.add(box(bw2 * 1.02, 0.3, 0.3, wood, 0, y0 + fh + 0.15, bd2 / 2));
    g.add(box(bw2 * 1.02, 0.3, 0.3, wood, 0, y0 + fh + 0.15, -bd2 / 2));
    g.add(box(0.3, 0.3, bd2 * 1.02, wood, bw2 / 2, y0 + fh + 0.15, 0));
    g.add(box(0.3, 0.3, bd2 * 1.02, wood, -bw2 / 2, y0 + fh + 0.15, 0));
    if (trim) for (const sz of [1, -1]) g.add(caihua(bw2, caihuaMats, { h: 0.24, y: y0 + fh - 0.2, z: sz * (bd2 / 2 + 0.17) }));
    g.add(box(bw2 * 0.98, fh * 0.82, bd2 * 0.98, M.paint(0xd0c6b2, 0.78), 0, y0 + fh * 0.41, 0));
    const nOpen = clamp(Math.round(bw2 / 2.2), 2, 7);
    for (const sz of [1, -1]) for (let i = 0; i < nOpen; i++) {
      const x = (i / nOpen - 0.5) * bw2 * 0.86 + bw2 * 0.86 / (2 * nOpen);
      g.add(box(bw2 * 0.5 / nOpen, fh * 0.5, 0.12, lv === levels - 1 ? M.paint(0x2a2f36, 0.7) : M.glassy(0x121820, 0.8, 0.05, 0.4), x, y0 + fh * 0.44, sz * (bd2 / 2 + 0.02)));
      g.add(box(bw2 * 0.56 / nOpen, 0.09, 0.18, wood, x, y0 + fh * 0.7, sz * (bd2 / 2 + 0.02)));
    }
    if (lv > 0 && p.rail !== false) {                                     // 上层平座栏杆
      const py = y0 - 0.5;
      g.add(box(bw2 * 1.24, 0.14, bd2 * 1.24, wood, 0, py, 0));
      for (const sz of [1, -1]) { const rr2 = stoneRail({ len: bw2 * 1.2, h: 0.46, y: py + 0.08, mat: stone2 }); rr2.position.z = sz * bd2 * 0.6; g.add(rr2); }
    }
    if (p.drum !== false && lv === levels - 1) {                            // 鼓（顶层檐下的大鼓）
      const dr = cyl(W * 0.2, W * 0.2, W * 0.13, M.paint(0x8e2f26, 0.55), seg(18), 0, y0 + fh * 0.42, 0);
      dr.rotation.z = Math.PI / 2;
      g.add(dr);
      const studs = [];
      for (let i = 0; i < 12; i++) for (const sy of [-1, 1]) studs.push({ p: [-W * 0.1 + i * W * 0.018, y0 + fh * 0.42 + sy * W * 0.06, sy > 0 ? W * 0.2 : -W * 0.2], s: [0.05, 0.05, 0.05] });
      const sb = batch(new THREE.SphereGeometry(1, seg(6), seg(5)), gold, studs);
      if (sb) g.add(sb);
      g.add(box(0.24, 0.9, 0.24, M.wood(0x6b452a, 0.7), -W * 0.14, y0 + fh * 0.2, 0));
      g.add(box(0.24, 0.9, 0.24, M.wood(0x6b452a, 0.7), W * 0.14, y0 + fh * 0.2, 0));
    }
    const ry = y0 + fh + 0.34;
    g.add(curvedRoof({ w: bw2 + 1.9, d: bd2 + 1.9, h: 1.15, kind: 'xie', eaveUp: 0.34, mat: tile, seg: 18, y0: ry }));
    roofTrim(g, { w: bw2 + 1.9, d: bd2 + 1.9, h: 1.15, brim: 0.5, eaveUp: 0.34, y0: ry, kind: 'xie', tile, woodMat: wood, ridgeMat: M.paint(0x31363d, 0.6), trim, beasts: lv === levels - 1 ? 4 : 2 });
  }
  g.userData.drum = { levels, rail: p.rail !== false, drum: p.drum !== false, trim };
  return cnShade(g);
}
function buildCourtyard(p) {
  const g = new THREE.Group();
  const wallMat = M.paint(new THREE.Color(p.wall).getHex(), 0.8);
  const brick = M.stone(0x8f8a80, 0.92);
  const roofMat = roofSurf(new THREE.Color(p.roof).getHex(), 0.66);
  const W = Math.max(8, num(p.w, 26)), D = Math.max(8, num(p.d, 32)), H = Math.max(1.6, num(p.wallH, 3.4));
  const trim = p.trim !== false && Q.level !== 'lite';   // 轻档：省掉脊兽 / 椽瓦 / 栏杆等细件
  const gateW = Math.min(W * 0.28, 5.2);
  const walls = [[W, 1.2, 0, -D / 2, false], [W, 1.2, 0, D / 2, true], [1.2, D - 1.2, -W / 2, 0, false], [1.2, D - 1.2, W / 2, 0, false]];
  for (const [w2, d2, x, z, front] of walls) {
    if (front && p.gate !== false) {                              // 前墙留街门洞口
      const side = (w2 - gateW) / 2;
      for (const sx of [1, -1]) g.add(box(side, H, d2, wallMat, x + sx * (gateW / 2 + side / 2), H / 2, z));
      g.add(box(gateW, H * 0.24, d2, wallMat, x, H * 0.88, z));
      for (const sx of [1, -1]) g.add(box(0.5, H * 0.9, d2 + 0.2, brick, x + sx * (gateW / 2 + 0.2), H * 0.45, z, 0.04));   // 门框砖垛
      g.add(box(gateW + 1.2, 0.22, d2 + 0.4, brick, x, H * 0.78, z));                                                 // 过梁
      for (const sx of [1, -1]) g.add(box(1.0, 0.5, 0.34, M.wood(0x6b452a, 0.7), x + sx * (gateW / 2 + 0.6), 0.25, z + d2 / 2 + 0.3, 0.05));  // 门墩 / 抱鼓石
      g.add(box(gateW * 0.94, 0.1, 0.3, brick, x, 0.05, z));                                                            // 门槛
      const roofF = curvedRoof({ w: gateW + 2.2, d: d2 + 1.5, h: 0.7, kind: 'juan', brim: 0.3, eaveUp: 0.42, mat: roofMat, seg: 12, y0: H * 0.9 });
      roofF.position.set(x, 0, z + 0.2);
      g.add(roofF);
      g.add(box(gateW + 2.4, 0.16, d2 + 0.9, brick, x, H * 0.9 + 0.06, z + 0.2));
    } else {
      g.add(box(w2, H, d2, wallMat, x, H / 2, z));
      g.add(box(w2, H * 0.2, d2 + 0.12, brick, x, H * 0.1, z));                                                       // 下碱
    }
    // 墙帽：卷棚的脊只能顺着墙长。curvedRoof('juan') 的脊沿 x、坡面朝 ±z，所以沿 z 走向的两侧墙
    // 要把长宽对调再转 90°；旧版拿 1.8×31 的斜坡直接盖在侧墙上，坡面顺墙滑到墙头去，还穿过厢房屋面。
    const alongZ = w2 < 2.5;
    const capW = (alongZ ? d2 : w2) + 0.6, capD = (alongZ ? w2 : d2) + 0.6;
    if (!(front && p.gate !== false)) {
      const r2 = curvedRoof({ w: capW, d: capD, h: 0.55, kind: 'juan', brim: 0.2, eaveUp: 0.4, mat: roofMat, seg: 10, y0: H });
      r2.position.set(x, 0, z);
      if (alongZ) r2.rotation.y = Math.PI / 2;
      g.add(r2);
      const rb = cyl(0.075, 0.075, (alongZ ? d2 : w2) + 0.7, M.paint(0x3a4048, 0.6), 8, x, H + 0.615, z);   // 卷棚脊筒随墙走
      if (alongZ) rb.rotation.x = Math.PI / 2; else rb.rotation.z = Math.PI / 2;
      g.add(rb);
    }
  }
  const addHall = (x, z, w3, d3, rot) => {
    const h = buildHall({ w: w3, d: d3, h: 3.1, bays: 3, bay: 3, roofH: 2.0, kind: 'wu', ridge: 0.4, plinth: 0xb9b2a4, plinthH: 0.34, wall: 0xe6ddcd, column: 0x8e3a2c, door: 0x5c2c22, roof: p.roof, ridgeColor: 0x4a4f56, steps: true, lattice: false, dougong: true, trim, beasts: 3 });
    h.position.set(x, 0, z); h.rotation.y = rot;
    g.add(h);
  };
  addHall(0, -D / 2 + 5, clamp(W * 0.44, 6, 22), 8, 0);
  // 厢房：转 90° 后「开间」进 z 向、「进深」占 x 向；外缘收到院墙内 12 cm，屋面就不会插进院墙与正身山墙
  if (p.wings) { const wx = W / 2 - 5.2; addHall(-wx, 0, 11, 7, Math.PI / 2); addHall(wx, 0, 11, 7, -Math.PI / 2); }
  if (p.gate) {
    const pf = buildPaifang({ bays: 1, span: gateW + 2.4, h: H * 1.34, roof: p.roof, column: 0x8e3a2c, plaques: true, dgN: 2, text: p.gateText || '紫氣東來' });
    pf.position.set(0, 0, D / 2 + 1.2);
    g.add(pf);
  }
  if (p.screen !== false) {                                     // 影壁（进门一面墙 + 须弥座 + 屋顶）
    const sw = clamp(W * 0.3, 3, 7), sy = D / 2 - 4.4;
    g.add(box(sw + 0.5, 0.36, 1.0, brick, 0, 0.18, sy));
    g.add(box(sw, H * 0.68, 0.6, wallMat, 0, 0.36 + H * 0.34, sy));
    g.add(box(sw + 0.4, H * 0.68 + 0.3, 0.24, brick, 0, 0.36 + H * 0.34, sy + 0.36));         // 边框（硬心四角出砖）
    for (const sx of [1, -1]) g.add(box(0.2, H * 0.6, 0.7, brick, sx * (sw / 2 + 0.1), 0.36 + H * 0.3, sy));
    g.add(box(sw * 0.7, 0.9, 0.1, M.paint(0x6d6a63, 0.8), 0, 0.36 + H * 0.42, sy + 0.4));     // 砖雕盒子
    const rS = curvedRoof({ w: sw + 1.2, d: 1.8, h: 0.62, kind: 'pan', brim: 0.3, eaveUp: 0.36, mat: roofMat, seg: 12, y0: 0.36 + H * 0.68 });
    rS.position.z = sy;
    g.add(rS);
    g.add(box(sw + 1.0, 0.14, 1.4, brick, 0, 0.42 + H * 0.68, sy));
  }
  if (p.corr !== false && p.wings) {                              // 抄手游廊（连接正房与厢房）
    for (const sx of [1, -1]) {
      const c = buildCorridor({ length: Math.max(4, D / 2 - 5.6), w: 2.1, h: 2.7, spacing: 3, roof: p.roof, column: 0x8e3a2c, railing: true, trim: false, gehua: true });
      c.position.set(sx * (W / 2 - 1.9), 0, (D / 2 + 5.6) / 2);      // 贴院墙走、到厢房檐口为止（旧版横穿厢房屋面）
      c.rotation.y = Math.PI / 2;
      g.add(c);
    }
  }
  g.add(planeXZ(W - 2, D - 2, M.stone(0x9d968a, 0.95), 0, 0.02, 0));
  g.userData.yard = { gate: !!p.gate, screen: p.screen !== false, corr: p.corr !== false && !!p.wings, trim };
  return cnShade(g);
}
function buildMoonGate(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.82);
  const grey = M.stone(0x8f8a80, 0.9);
  const brick = M.stone(0x77726a, 0.92);
  const roof = roofSurf(new THREE.Color(p.roof).getHex(), 0.66);
  const L = Math.max(2, num(p.length, 10)), H = Math.max(1.6, num(p.height, 3.4)), T = Math.max(0.12, num(p.thick, 0.36));
  const R = Math.min(H * 0.46, L * 0.28);
  const segs = clamp(Math.round(mul(20)), 10, 26);
  // 砖券（内外两圈，构成券厚）+ 券脸
  for (const rr of [R, R - 0.16]) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, am = ((i + 0.5) / segs) * Math.PI * 2;
      if (Math.sin(am) * rr + R < 0.02) continue;                                       // 地面以下不砌券
      const b = box(Math.max(0.14, (2 * Math.PI * rr / segs) * 1.08), 0.26, (rr === R ? T + 0.1 : T * 0.7), rr === R ? grey : brick, Math.cos(am) * rr, R + Math.sin(am) * rr, 0);   // 圆心落地：月亮门是一整个圆
      b.rotation.z = a0 + Math.PI / segs;
      g.add(b);
    }
  }
  // 墙身：按「圆洞」切成竖条，每条自己算被圆切掉的空档 → 洞形与砖券严格一致。
  // 旧版只开了个通高矩形口（宽 1.44R），圆券上半截空着、洞顶留一方孔，券石看着像掉在洞底。
  const nS = clamp(Math.round(L / 0.42), 8, 72);
  const sw2 = L / nS;
  for (let i2 = 0; i2 < nS; i2++) {
    const xc = (-0.5 + (i2 + 0.5) / nS) * L;
    const hh = Math.abs(xc) < R ? Math.sqrt(Math.max(0, R * R - xc * xc)) : 0;
    const bw2 = sw2 + 0.02;
    if (hh <= 0.03) {
      g.add(box(bw2, H, T, wall, xc, H / 2, 0));
      g.add(box(bw2 + 0.06, H * 0.22, T + 0.12, brick, xc, H * 0.11, 0));                          // 下碱（青砖）
      continue;
    }
    const yLo = R - hh, yHi = R + hh;
    if (yLo > 0.04) {
      g.add(box(bw2, yLo, T, wall, xc, yLo / 2, 0));
      g.add(box(bw2 + 0.06, Math.min(H * 0.22, yLo), T + 0.12, brick, xc, Math.min(H * 0.22, yLo) / 2, 0));
    }
    if (H - yHi > 0.04) g.add(box(bw2, H - yHi, T, wall, xc, yHi + (H - yHi) / 2, 0));
  }
  g.add(box(L + 0.18, 0.14, T + 0.24, grey, 0, H - 0.07, 0));                                     // 上檐枋（通长）
  g.add(box(L + 0.4, 0.2, T + 0.3, brick, 0, H + 0.12, 0));                                            // 墙帽（披水）
  const rY = H + 0.06;                                                                                  // 卷棚压在墙帽上，别悬空
  g.add(curvedRoof({ w: L + 0.5, d: T + 1.1, h: 0.5, kind: 'juan', brim: 0.25, eaveUp: 0.16, mat: roof, seg: 16, y0: rY }));
  // 墙帽是卷棚、两端不出脊：旧版还排了 roofTrim 的脊件 / 起翘，墙头两头就顶出两块黑色「断件」
  // 门槛 + 门枕石 + 抱鼓
  g.add(box(R * 1.7, 0.12, T + 0.1, grey, 0, 0.06, 0));                                            // 门槛铺满洞口
  for (const sx of [1, -1]) {
    g.add(box(0.42, 0.4, T + 0.4, grey, sx * (R + 0.42), 0.2, 0, 0.05));                            // 门枕石立在券脚外，不砌进墙里
    const drum = cyl(0.24, 0.24, 0.14, grey, seg(12), sx * (R + 0.42), 0.44, 0);
    drum.rotation.x = Math.PI / 2;
    g.add(drum);
  }
  g.userData.moon = { R: +R.toFixed(2), trim: p.trim !== false };
  return cnShade(g);
}
function buildLanternPole(p) {
  const g = new THREE.Group();
  const pole = M.paint(new THREE.Color(p.pole).getHex(), 0.6);
  const gold = M.metal(0xc9a45c, 0.36, 0.82);
  g.add(box(0.72, 0.24, 0.72, M.stone(0x9c978d, 0.9), 0, 0.12, 0, 0.04));
  g.add(box(0.5, 0.14, 0.5, M.stone(0xa8a29a, 0.9), 0, 0.3, 0));
  g.add(cyl(0.09, 0.13, p.height, pole, seg(10), 0, p.height / 2 + 0.36, 0));
  g.add(cyl(0.16, 0.16, 0.1, gold, seg(8), 0, p.height * 0.5, 0));                    // 腰铁
  const glow = M.glow(p.color, num(p.glow, 1.6) * 2.2);
  for (const s of [-1, 1]) {
    g.add(box(1.6, 0.12, 0.12, pole, s * 0.78, p.height + 0.3, 0));
    g.add(box(0.34, 0.22, 0.2, pole, s * 1.36, p.height + 0.14, 0, 0.03));             // 雀替式托木
    const lamp = cyl(0.34, 0.34, 0.62, glow, seg(6), s * 1.4, p.height - 0.1, 0);      // 六角灯身
    g.add(lamp);
    g.add(cyl(0.4, 0.36, 0.1, M.paint(0x2c2f34, 0.7), seg(6), s * 1.4, p.height + 0.34, 0));
    g.add(cone(0.46, 0.26, M.paint(0x2c2f34, 0.7), seg(6), s * 1.4, p.height + 0.5, 0));
    g.add(cyl(0.38, 0.34, 0.12, M.paint(0x2c2f34, 0.7), seg(6), s * 1.4, p.height - 0.46, 0));
    g.add(box(0.16, 0.1, 0.16, gold, s * 1.4, p.height + 0.68, 0));                     // 顶宝
    for (let i = 0; i < 3; i++) {                                                        // 穗子
      const t = (i - 1) * 0.2;
      g.add(cyl(0.012, 0.012, 0.36, M.paint(0xb8443a, 0.7), 4, s * 1.4 + t, p.height - 0.66, t * 0.5));
      g.add(sph(0.035, M.paint(0xb8443a, 0.7), 6, s * 1.4 + t, p.height - 0.5, t * 0.5));
    }
    if (p.tassel !== false) g.add(box(0.5, 0.04, 0.04, gold, s * 1.4, p.height + 0.24, 0));
  }
  g.add(sph(0.11, gold, seg(8), 0, p.height + 0.44, 0));                               // 杆顶宝珠
  g.userData.glow = [glow];
  return cnShade(g);
}
function buildDing(p) {
  const g = new THREE.Group();
  const r = Math.max(0.2, num(p.r, 0.8));
  const h = Math.max(0.15, num(p.h, 0.7));
  const leg = Math.max(0.05, num(p.leg, h * 0.34));
  const m = M.metal(new THREE.Color(p.color).getHex(), 0.42, 0.85);
  const gold = M.metal(0xc9a45c, 0.34, 0.9);
  g.add(cyl(r * 0.9, r * 0.78, h, m, seg(22), 0, h / 2 + leg, 0));
  g.add(cyl(r * 1.06, r * 0.94, 0.14, m, seg(22), 0, h + leg, 0));                  // 口沿
  g.add(cyl(r * 0.86, r * 0.86, 0.1, m, seg(22), 0, leg + h * 0.62, 0));            // 腹饰带底
  const studs = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    studs.push({ p: [Math.cos(a) * r * 0.93, leg + h * 0.62, Math.sin(a) * r * 0.93], s: [0.035, 0.035, 0.035] });
    studs.push({ p: [Math.cos(a) * r * 0.82, leg + h * 0.3, Math.sin(a) * r * 0.82], s: [0.028, 0.028, 0.028] });
  }
  const st = batch(new THREE.SphereGeometry(1, seg(6), seg(5)), gold, studs);       // 乳纹 / 饕餮带钉
  if (st) g.add(st);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(cyl(0.09, 0.11, leg, m, seg(8), Math.cos(a) * r * 0.62, leg / 2, Math.sin(a) * r * 0.62));
    g.add(box(0.2, 0.08, 0.2, m, Math.cos(a) * r * 0.62, leg, Math.sin(a) * r * 0.62));   // 足跟
  }
  for (const s of [-1, 1]) {
    g.add(box(0.1, r * 0.5, 0.1, m, s * r * 0.72, h + leg + r * 0.2, 0));           // 立耳
    g.add(box(0.14, 0.08, 0.14, m, s * r * 0.72, h + leg + r * 0.44, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, 0.03, seg(5), seg(14)), gold);
    ring.position.set(0, h + leg + r * 0.2, 0);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);                                                                      // 穿耳环
  }
  g.add(cyl(r * 0.7, r * 0.7, 0.05, M.dark(0x14100e, 0.7), seg(20), 0, h + leg + 0.06, 0));   // 口内
  g.userData.ding = true;
  return cnShade(g);
}
function buildSpiritWay(p) {
  const g = new THREE.Group();
  const stone = M.stone(new THREE.Color(p.color).getHex(), 0.92);
  const stone2 = M.stone(0x98928a, 0.93);
  const pairs = clamp(Math.round(num(p.pairs, 5)), 1, 12), L = Math.max(6, num(p.length, 44)), gap = num(p.gap, 5);
  const kinds = ['狮', '獬豸', '麒麟', '象', '马', '骆驼'];
  for (let i = 0; i < pairs; i++) {
    const z = (i / Math.max(1, pairs - 1) - 0.5) * L;
    const human = i % 2 === 1;
    for (const s of [-1, 1]) {
      g.add(box(1.1, 0.4, 0.8, stone2, s * gap, 0.2, z, 0.04));                     // 底座（含圭角）
      g.add(box(0.94, 0.14, 0.66, stone, s * gap, 0.47, z));                        // 上枋
      if (human) {
        const arm = i % 4 === 1;
        g.add(box(0.5, 1.2, 0.42, arm ? stone2 : stone, s * gap, 1.14, z));          // 身（文/武）
        g.add(box(0.56, 0.36, 0.48, stone, s * gap, 1.9, z));                        // 头 / 盔
        g.add(box(0.46, 0.06, 0.5, stone2, s * gap, 2.1, z));                        // 冠 / 顶缨
        if (arm) { g.add(box(0.62, 0.1, 0.1, stone2, s * gap, 1.32, z + 0.28)); g.add(box(0.09, 0.36, 0.09, stone2, s * gap + 0.22, 1.2, z + 0.2)); }
        else g.add(box(0.26, 0.34, 0.06, stone2, s * gap, 1.34, z + 0.24));         // 笏板
      } else {
        const k = kinds[i % kinds.length];
        const big = k === '象' || k === '麒麟';
        const bodyLen = k === '马' || k === '骆驼' ? 1.15 : 0.86;
        g.add(box(bodyLen, big ? 0.78 : 0.62, 0.44, stone, s * gap, 0.9 + (big ? 0.16 : 0), z, 0.06));
        const neck = box(0.26, k === '骆驼' ? 0.7 : 0.5, 0.26, stone, s * gap + bodyLen * 0.42, 1.28, z);
        neck.rotation.z = -0.34;
        g.add(neck);
        g.add(box(0.3, 0.24, 0.26, stone, s * gap + bodyLen * 0.58, 1.5, z, 0.05));  // 头
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.12, 0.5, 0.12, stone2, s * gap + sx * bodyLen * 0.3, 0.7, z + sz * 0.14));
        if (k === '狮') g.add(sph(0.2, stone2, seg(8), s * gap + bodyLen * 0.5, 1.52, z));
        if (k === '象') { const tr = box(0.1, 0.5, 0.1, stone2, s * gap + bodyLen * 0.66, 1.2, z); tr.rotation.z = -0.5; g.add(tr); }
        if (k === '獬豸') g.add(cone(0.07, 0.26, stone2, seg(6), s * gap + bodyLen * 0.5, 1.72, z));
        g.add(box(0.12, 0.16, 0.5, stone2, s * gap, 1.28 + (big ? 0.1 : 0), z));     // 鞍 / 脊饰
      }
    }
  }
  if (p.pillars !== false) {                                       // 石望柱（神道入口）
    for (const s of [-1, 1]) {
      const z = -L / 2 - 2.6;
      g.add(box(0.9, 0.34, 0.9, stone2, s * gap * 0.62, 0.17, z, 0.04));
      g.add(cyl(0.24, 0.26, 2.4, stone, seg(8), s * gap * 0.62, 1.54, z));          // 八棱柱身
      g.add(box(0.5, 0.16, 0.5, stone2, s * gap * 0.62, 2.82, z));
      g.add(sph(0.2, stone2, seg(8), s * gap * 0.62, 3.02, z));
      g.add(cone(0.12, 0.3, stone2, seg(6), s * gap * 0.62, 3.28, z));
    }
  }
  if (p.stele !== false) {                                         // 神道碑：赑屃 + 碑身 + 螭首
    const z = L / 2 + 3.2;
    g.add(box(2.6, 0.7, 1.5, stone, 0, 0.35, z, 0.1));                             // 赑屃身
    g.add(sph(0.62, stone, seg(10), 1.2, 0.62, z));
    g.add(box(2.2, 0.24, 1.4, stone2, 0, 0.78, z, 0.04));                          // 碑座
    g.add(box(1.5, 3.2, 0.42, M.stone(0xa8a89e, 0.88), 0, 2.4, z, 0.05));          // 碑身
    g.add(box(1.9, 0.7, 0.72, stone, 0, 4.3, z, 0.12));                            // 碑额（螭首）
    for (const sx of [1, -1]) g.add(sph(0.22, stone2, seg(8), sx * 0.6, 4.5, z + 0.2));
    g.add(box(1.1, 2.2, 0.06, M.stone(0x8b8b83, 0.9), 0, 2.4, z + 0.25));          // 碑心（刻字面）
  }
  g.userData.way = { pairs, pillars: p.pillars !== false, stele: p.stele !== false };
  return cnShade(g);
}

// =========================================================== 美式经典建筑 ===
function buildCapitol(p) {
  const g = new THREE.Group();
  const st = M.stone(new THREE.Color(p.stone).getHex(), 0.72);
  const W = p.w, H = p.h;
  g.add(box(W, H, W * 0.42, st, 0, H / 2, 0));
  for (const s of [-1, 1]) g.add(box(W * 0.34, H * 0.62, W * 0.3, st, s * W * 0.66, H * 0.31, 0));
  const n = Math.max(4, Math.round(p.columns));
  g.add(row((i) => {
    const c = cyl(0.42, 0.46, H * 0.78, st, 14);
    c.position.y = H * 0.39;
    return c;
  }, n, W * 0.6).translateZ(W * 0.22).translateY(H * 0.02));
  g.add(box(W * 0.72, 0.9, W * 0.1, st, 0, H * 0.84, W * 0.2));
  g.add(box(W * 0.66, H * 0.2, 0.9, st, 0, H * 1.05, W * 0.19));
  // 鼓座 + 穹顶
  const y0 = H;
  g.add(cyl(W * 0.17, W * 0.19, H * 0.3, st, 22, 0, y0 + H * 0.15, 0));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.add(cyl(0.2, 0.22, H * 0.24, st, 8, Math.cos(a) * W * 0.15, y0 + H * 0.15, Math.sin(a) * W * 0.15)); }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(W * 0.17, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), st);
  dome.position.y = y0 + H * 0.3; dome.scale.y = 1.35;
  g.add(dome);
  g.add(cyl(0.16, 0.2, H * 0.16, st, 10, 0, y0 + H * 0.3 + W * 0.22, 0));
  g.add(sph(0.3, M.metal(0xd8c07a, 0.3, 0.9), 10, 0, y0 + H * 0.3 + W * 0.24 + 0.3, 0));
  g.add(box(W * 0.9, 0.7, W * 0.5, st, 0, 0.35, 0));
  for (let i = 0; i < 6; i++) g.add(box(W * 0.3, 0.2, 0.9, st, 0, 0.1 + i * 0.2, W * 0.25 + 0.9 + i * 0.45));
  return cnShade(g);
}
function buildMansion(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.78);
  const trim = M.paint(0xf2efe8, 0.7);
  const roof = roofSurf(new THREE.Color(p.roof).getHex(), 0.7);
  const W = p.w, D = p.d, H = p.h * p.storeys;
  g.add(box(W, H, D, wall, 0, H / 2 + 0.5, 0));
  g.add(box(W + 0.6, 0.5, D + 0.6, trim, 0, 0.25, 0));
  g.add(box(W + 0.3, 0.34, D + 0.3, trim, 0, H + 0.6, 0));
  const pr = new THREE.Group();
  const n = Math.max(2, p.portico);
  pr.add(row((i) => { const c = cyl(0.3, 0.33, H * 0.92, trim, 12); c.position.y = H * 0.46 + 0.5; return c; }, n, W * 0.55));
  pr.add(box(W * 0.66, 0.5, 1.6, trim, 0, H * 0.95 + 0.5, 0));
  pr.add(box(W * 0.6, 1.3, 1.3, trim, 0, H * 0.98 + 1.4, 0));
  pr.position.z = D / 2 + 0.9;
  g.add(pr);
  // 坡屋面压在檐口圈梁（H+0.6）上，脊线沿面宽方向；两端山墙按坡面折线补齐。
  // 旧版是一块 0.4 厚的平板和一块悬空平面斜搭着交叉成 X，板底既不落地也不合脊。
  const manRoof = gableSlabs({ w: W + 0.5, d: D, y: H + 0.62, rise: D * 0.3, ov: 0.55, th: 0.22, mat: roof, fill: wall, cap: 0.26 });
  g.add(manRoof);
  const chimT = manRoof.userData.top + 1.0;                                   // 烟囱落在两端山墙上（种植园宅邸的典型做法）
  for (const sx of [-1, 1]) g.add(box(1.25, chimT - H * 0.4, 1.25, wall, sx * (W / 2 - 0.85), (chimT + H * 0.4) / 2, 0));
  for (let f = 0; f < p.storeys; f++) {
    const y = 0.5 + H * (f + 0.42) / p.storeys;
    for (let i = 0; i < p.bays; i++) {
      const x = (i / (p.bays - 1 || 1) - 0.5) * (W * 0.8);
      g.add(box(1.0, H / p.storeys * 0.5, 0.14, trim, x, y, D / 2 + 0.02));
      g.add(box(1.14, 0.16, 0.22, trim, x, y + H / p.storeys * 0.27, D / 2 + 0.04));
      if (f === p.storeys - 1) g.add(box(0.5, 1.9, 0.12, M.paint(0x2b2118, 0.6), W * 0.06 * (i - (p.bays - 1) / 2) * 4, y - H / p.storeys * 0.1, D / 2 + 0.03));
    }
  }
  g.add(box(1.5, H * 0.42, 0.16, M.paint(0x3a2a20, 0.6), 0, 0.5 + H * 0.21, D / 2 + 0.03));
  g.add(box(2.4, 0.24, 1.6, trim, 0, 0.4, D / 2 + 0.8));
  return cnShade(g);
}
function buildBrownstone(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.8);
  const trim = M.paint(0x2f3540, 0.7);
  const W = p.w, D = p.d, H = p.h * p.storeys;
  g.add(box(W, H, D, wall, 0, H / 2, 0));
  g.add(box(W + 0.4, 0.7, D + 0.4, trim, 0, 0.35, 0));
  g.add(box(W + 0.3, 0.5, D + 0.3, trim, 0, H - 0.25, 0));
  for (let f = 0; f < p.storeys; f++) {
    const y = 0.7 + (f + 0.5) * (H / p.storeys);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * (W * 0.3);
      g.add(box(W * 0.19, H / p.storeys * 0.62, 0.16, trim, x, y, D / 2 + 0.02));
      g.add(box(W * 0.23, 0.18, 0.3, M.stone(0xbdb6ab, 0.85), x, y + H / p.storeys * 0.34, D / 2 + 0.04));
      g.add(box(W * 0.23, 0.14, 0.3, M.stone(0xbdb6ab, 0.85), x, y - H / p.storeys * 0.34, D / 2 + 0.04));
    }
  }
  // 檐口托架 + 窗铁栏 + 门套 + 地下室采光井栏杆
  const brk = [];
  for (let i = 0; i < Math.max(4, Math.round(W / 0.9)); i++)
    brk.push({ p: [(i / Math.max(4, Math.round(W / 0.9)) - 0.5) * (W - 0.6), H - 0.62, D / 2 + 0.12], s: [0.16, 0.34, 0.16] });
  const bk = batch(new THREE.BoxGeometry(1, 1, 1), trim, brk);
  if (bk) g.add(bk);
  for (let f = 0; f < p.storeys; f++) {
    const y = 0.7 + (f + 0.5) * (H / p.storeys);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * (W * 0.3);
      if (f === 0) {                                                                     // 一层窗外铁艺护栏
        const bar = [];
        for (let k = 0; k < 5; k++) bar.push({ p: [x + (k / 4 - 0.5) * W * 0.2, y - H / p.storeys * 0.24, D / 2 + 0.22], s: [0.03, 0.5, 0.03] });
        const bb = batch(new THREE.BoxGeometry(1, 1, 1), M.metal(0x2b2f36, 0.6, 0.7), bar);
        if (bb) g.add(bb);
        g.add(box(W * 0.22, 0.04, 0.1, M.metal(0x2b2f36, 0.6, 0.7), x, y + H / p.storeys * 0.01, D / 2 + 0.22));
      }
      g.add(box(0.04, H / p.storeys * 0.62, 0.05, trim, x, y, D / 2 + 0.11));            // 中梃
    }
  }
  g.add(box(W * 0.34, H * 0.26, 0.16, trim, -W * 0.28, 1.55 + p.steps * 0.18, D / 2 + 0.03));   // 门套
  g.add(box(W * 0.24, H * 0.2, 0.2, M.paint(0x3a2a20, 0.6), -W * 0.28, 1.55 + p.steps * 0.18, D / 2 + 0.02));
  for (let i = 0; i < p.steps; i++) g.add(box(3.0, 0.18, 0.4, M.stone(0xbdb6ab, 0.9), -W * 0.28, 0.09 + i * 0.18, D / 2 + 0.6 - i * 0.4));
  g.add(box(3.2, 0.16, 0.5, M.stone(0xbdb6ab, 0.9), -W * 0.28, 0.18 + p.steps * 0.18, D / 2 + 0.55));
  return cnShade(g);
}
function buildWhiteChurch(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.78);
  const roof = roofSurf(new THREE.Color(p.roof).getHex(), 0.7);
  g.add(box(p.w, p.h, p.d, wall, 0, p.h / 2, -p.d * 0.1));
  // 双坡屋面：屋脊沿 z（ nave 长向），两面坡分居 ±x。用 gableSlabs 反推坡长/标高，
  // 檐口压在墙顶圈梁上、两端补山墙（旧版两片板沿 z 偏移，全落在屋脊同侧，交叉成 X 还盖不住墙）
  const nave = gableSlabs({ w: p.d * 1.04, d: p.w, y: p.h + 0.14, rise: p.roofH, ov: 0.5, th: 0.2, mat: roof, fill: wall });
  nave.rotation.y = Math.PI / 2;
  nave.position.z = -p.d * 0.1;
  g.add(nave);
  g.add(box(p.w * 1.06, 0.4, p.d * 1.06, wall, 0, p.h, -p.d * 0.1));
  g.add(box(p.w * 0.34, p.h * 1.35, p.w * 0.34, wall, 0, p.h * 0.68, p.d * 0.42));
  const steepleCone = cone(p.w * 0.3, p.steeple, roof, 4, 0, p.h * 1.35 + p.steeple / 2, p.d * 0.42);
  steepleCone.rotation.y = Math.PI / 4;                                     // 四棱锥的棱对齐方塔身，不然看着转了 45°
  g.add(steepleCone);
  g.add(cyl(0.06, 0.08, 1.2, M.metal(0xd8c07a, 0.3, 0.9), 6, 0, p.h * 1.35 + p.steeple + 0.6, p.d * 0.42));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(box(p.w * 0.13, p.h * 0.55, 0.14, M.glassy(0x18242e, 0.5, 0, 0.4), Math.cos(a) * p.w * 0.2, p.h * 0.62, -p.d * 0.1 + Math.sin(a) * p.d * 0.3));
  }
  g.add(box(p.w * 1.1, 0.6, p.d * 1.1, M.stone(0xbdb6ab, 0.92), 0, 0.3, -p.d * 0.1));    // 石基
  for (let i = 0; i < 3; i++) {                                                          // 两侧拱窗
    const z = -p.d * 0.42 + i * p.d * 0.34;
    for (const sx of [-1, 1]) {
      g.add(box(0.12, p.h * 0.5, p.w * 0.16, M.glassy(0x2b3a46, 0.2, 0.15, 0.55), sx * (p.w / 2 + 0.02), p.h * 0.55, z));
      g.add(box(0.09, p.h * 0.56, p.w * 0.19, M.paint(0xf2efe8, 0.7), sx * (p.w / 2 + 0.02), p.h * 0.55, z));
      g.add(box(0.2, 0.1, p.w * 0.22, M.paint(0xf2efe8, 0.7), sx * (p.w / 2 + 0.02), p.h * 0.83, z));
    }
  }
  // 塔身：檐口 + 钟室 + 十字架
  g.add(box(p.w * 0.44, 0.22, p.w * 0.44, M.paint(0xf2efe8, 0.7), 0, p.h * 1.35, p.d * 0.42));
  const belfry = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    belfry.add(box(0.1, p.w * 0.2, 0.1, M.paint(0xf2efe8, 0.7), Math.cos(a) * p.w * 0.17, 0, Math.sin(a) * p.w * 0.17));
  }
  belfry.add(box(p.w * 0.4, 0.1, p.w * 0.4, M.paint(0xf2efe8, 0.7), 0, p.w * 0.1, 0));
  belfry.position.set(0, p.h * 1.35 + p.w * 0.11, p.d * 0.42);
  g.add(belfry);
  g.add(box(0.07, 0.9, 0.07, M.metal(0xd8c07a, 0.3, 0.9), 0, p.h * 1.35 + p.steeple + 1.2, p.d * 0.42));   // 十字架竖杆
  g.add(box(0.42, 0.07, 0.07, M.metal(0xd8c07a, 0.3, 0.9), 0, p.h * 1.35 + p.steeple + 1.42, p.d * 0.42)); // 横杆
  // 入口门廊：4 根柱子 + 山花 + 门 + 踏跺
  const pz = p.d * 0.42 + p.w * 0.17;
  g.add(box(p.w * 0.62, 0.16, 1.9, M.paint(0xf2efe8, 0.7), 0, p.h * 0.62, pz + 0.85));   // 门廊顶板
  g.add(box(p.w * 0.66, 0.14, 2.0, M.paint(0xf2efe8, 0.7), 0, p.h * 0.62 + 0.15, pz + 0.85));
  for (let i = 0; i < 4; i++) {
    const x = (i / 3 - 0.5) * p.w * 0.52;
    g.add(cyl(0.13, 0.15, p.h * 0.56, M.paint(0xf2efe8, 0.7), 12, x, 0.6 + p.h * 0.28, pz + 1.65));
    g.add(box(0.34, 0.1, 0.34, M.paint(0xf2efe8, 0.7), x, 0.65, pz + 1.65));            // 柱础
    g.add(box(0.32, 0.12, 0.32, M.paint(0xf2efe8, 0.7), x, 0.6 + p.h * 0.56, pz + 1.65)); // 柱头
  }
  g.add(box(p.w * 0.62, 0.1, 1.8, M.stone(0xbdb6ab, 0.9), 0, 0.65, pz + 0.85));         // 门廊地坪
  g.add(box(p.w * 0.24, p.h * 0.62, 0.16, M.paint(0x2b2118, 0.6), 0, p.h * 0.31, pz + 0.02));
  g.add(box(p.w * 0.3, 0.12, 0.22, M.paint(0xf2efe8, 0.7), 0, p.h * 0.62, pz + 0.05));  // 门楣
  for (let i = 0; i < 4; i++) g.add(box(p.w * 0.34, 0.15, 0.36, M.stone(0xbdb6ab, 0.9), 0, 0.075 + i * 0.15, pz + 1.95 - i * 0.36));   // 门前踏跺
  return cnShade(g);
}
function buildLighthouse(p) {
  const g = new THREE.Group();
  const w = M.paint(new THREE.Color(p.wall).getHex(), 0.75);
  const red = M.paint(0xa8443a, 0.7);
  const metal = M.metal(0x8b9299, 0.4, 0.8);
  const H = p.h, R = p.r;
  const rr = (y) => R * (1 - 0.38 * (y / H));                                          // 收分：任意高度处的半径
  g.add(cyl(R * 1.5, R * 1.75, 0.5, M.stone(0x8b867c, 0.95), 14, 0, 0.25, 0));          // 岩基
  g.add(cyl(R * 1.12, R * 1.2, 0.8, w, 20, 0, 0.9, 0));                                // 基座
  g.add(cyl(R * 0.62, R, H, w, 20, 0, H / 2, 0));                                      // 塔身
  for (let i = 0; i < p.bands; i++) {
    const y = H * (0.2 + (i / p.bands) * 0.66);
    g.add(cyl(rr(y) * 1.01, rr(y) * 1.01, H * 0.06, red, 20, 0, y, 0));                // 红白环带
  }
  g.add(box(R * 0.5, 1.0, 0.1, M.paint(0x3a2a20, 0.6), 0, 1.6, R * 0.98));              // 门
  g.add(box(R * 0.7, 0.12, 0.2, M.stone(0xbdb6ab, 0.9), 0, 2.15, R));                   // 门楣
  for (let i = 0; i < 4; i++) {                                                        // 塔身小窗（注意：g.add() 返回的是 g 自己，不能链式设 rotation）
    const y = H * (0.26 + i * 0.18);
    const gl = cyl(0.16, 0.16, 0.08, M.glassy(0x2b3a46, 0.2, 0.2, 0.6), 10, 0, y, rr(y) + 0.02);
    gl.rotation.x = Math.PI / 2; g.add(gl);
    const fr = cyl(0.21, 0.21, 0.05, metal, 10, 0, y, rr(y) + 0.06);
    fr.rotation.x = Math.PI / 2; g.add(fr);
  }
  g.add(cyl(R * 0.9, R * 0.86, 0.18, w, 20, 0, H + 0.09, 0));                          // 检修平台
  g.add(cyl(R * 0.86, R * 0.86, 0.06, metal, 20, 0, H + 0.21, 0));                     // 平台面
  for (let i = 0; i < 12; i++) {                                                       // 平台栏杆
    const a = (i / 12) * Math.PI * 2;
    g.add(box(0.05, 0.9, 0.05, metal, Math.cos(a) * R * 0.82, H + 0.66, Math.sin(a) * R * 0.82));
  }
  g.add(cyl(R * 0.84, R * 0.84, 0.06, metal, 20, 0, H + 1.08, 0));                     // 扶手圈
  g.add(cyl(R * 0.8, R * 0.8, 0.24, M.dark(0x2b3037, 0.7), 16, 0, H + 0.5, 0));        // 灯室底
  const lamp = M.glow(p.lampColor, p.lamp);
  g.add(cyl(p.r * 0.5, p.r * 0.5, 1.1, lamp, 12, 0, H + 1.18, 0));                     // 灯
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(box(0.08, 1.2, 0.08, metal, Math.cos(a) * p.r * 0.55, H + 1.18, Math.sin(a) * p.r * 0.55)); }
  g.add(cyl(R * 0.58, R * 0.58, 0.1, metal, 16, 0, H + 1.8, 0));                       // 灯室顶圈
  g.add(cone(p.r * 0.72, 0.9, red, 14, 0, H + 2.3, 0));                                // 顶盖
  g.add(box(0.09, 0.7, 0.09, metal, 0, H + 2.9, 0));                                   // 避雷针
  g.add(sph(0.1, metal, 8, 0, H + 3.28, 0));
  g.userData.glow = [lamp];
  return cnShade(g);
}
function buildWaterTower(p) {
  const g = new THREE.Group();
  const tank = M.paint(new THREE.Color(p.tank).getHex(), 0.72);
  const wood = M.metal(0x6f6a63, 0.7, 0.2);
  g.add(cyl(p.r, p.r, p.h, tank, 18, 0, p.legs + p.h / 2, 0));
  g.add(cone(p.r * 1.04, p.r * 0.7, tank, 18, 0, p.legs + p.h + p.r * 0.35, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * p.r * 0.8, z = Math.sin(a) * p.r * 0.8;
    g.add(cyl(0.12, 0.16, p.legs, wood, 8, x, p.legs / 2, z));
    g.add(box(p.r * 1.6, 0.09, 0.09, wood, 0, p.legs * (0.35 + (i % 2) * 0.35), 0));
  }
  for (let lvl = 0; lvl < 3; lvl++) {                                                   // 支腿交叉支撑
    const y = p.legs * (0.25 + lvl * 0.28);
    for (let i = 0; i < 4; i++) {
      const a1 = (i / 4) * Math.PI * 2 + Math.PI / 4, a2 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      const x1 = Math.cos(a1) * p.r * 0.8, z1 = Math.sin(a1) * p.r * 0.8;
      const x2 = Math.cos(a2) * p.r * 0.8, z2 = Math.sin(a2) * p.r * 0.8;
      const br = box(0.06, 0.06, Math.hypot(x2 - x1, z2 - z1), wood, (x1 + x2) / 2, y, (z1 + z2) / 2);
      br.rotation.y = Math.atan2(x2 - x1, z2 - z1); g.add(br);
    }
  }
  for (const sz of [-1, 1]) g.add(box(0.3, 0.3, 0.3, M.concrete(0x9a9488, 0.95), sz * p.r * 0.57, 0.15, sz * p.r * 0.57));  // 混凝土墩
  // 爬梯（一侧）+ 检修走道 + 栏杆
  const lad = [];
  for (let i = 0; i < Math.max(4, Math.round(p.legs / 0.36)); i++)
    lad.push({ p: [0, 0.4 + i * 0.36, p.r * 0.86], s: [0.7, 0.035, 0.035] });
  const lb = batch(new THREE.BoxGeometry(1, 1, 1), wood, lad);
  if (lb) g.add(lb);
  for (const s of [-1, 1]) g.add(box(0.05, p.legs, 0.05, wood, s * 0.35, p.legs / 2, p.r * 0.86));
  g.add(cyl(p.r * 0.92, p.r * 0.92, 0.08, wood, 20, 0, p.legs + 0.04, 0));               // 检修走道
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.add(box(0.05, 0.8, 0.05, wood, Math.cos(a) * p.r * 0.9, p.legs + 0.44, Math.sin(a) * p.r * 0.9));
  }
  g.add(cyl(p.r * 0.92, p.r * 0.92, 0.05, wood, 20, 0, p.legs + 0.85, 0));
  for (let i = 0; i < 3; i++) g.add(cyl(p.r * 1.01, p.r * 1.01, 0.07, wood, 20, 0, p.legs + p.h * (0.25 + i * 0.25), 0));  // 箍板
  g.add(cyl(0.1, 0.1, p.legs + p.h, wood, 6, 0, (p.legs + p.h) / 2, p.r + 0.2));         // 落水管
  g.add(box(1.0, 0.1, 0.9, wood, 0, p.legs + p.h, p.r * 0.6));
  g.add(box(0.3, 0.3, 0.16, wood, 0, p.legs + p.h + 0.2, p.r * 0.86));                    // 检修口
  g.add(planeXZ(p.r * 2.4, p.r * 2.4, M.stone(0x8e8a82, 0.95), 0, 0.05, 0));
  return cnShade(g);
}
function buildBarn(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.wall).getHex(), 0.8);
  const trim = M.paint(0xe8e2d6, 0.7);
  const roofM = roofSurf(new THREE.Color(p.roof).getHex(), 0.75);
  const W = p.w, D = p.d, H = p.h;
  g.add(box(W, H, D, wall, 0, H / 2, 0));
  // 谷仓折线顶（gambrel）：下段陡、上段缓，肩点在 0.62 举高处；板长按坡面实长算，
  // 檐口落在墙顶、脊上对拼（旧版坡度反了、板长只有 0.34D，四块板在脊上互相穿、板底还陷进墙里）
  const barnRoof = gableSlabs({ w: W + 0.45, d: D, y: H, rise: D * 0.36, ov: 0.6, th: 0.2, mat: roofM, gambrel: 0.62, fill: wall, cap: 0.24 });
  g.add(barnRoof);
  g.add(box(W + 0.3, 0.5, D + 0.3, M.stone(0xbdb6ab, 0.92), 0, 0.25, 0));              // 石基
  // 大门：门框 + 两扇门板 + 白色 X 形斜撑（红谷仓的标志）
  g.add(box(W * 0.4, H * 0.66, 0.14, trim, 0, H * 0.33, D / 2 + 0.02));
  g.add(box(W * 0.34, H * 0.6, 0.1, M.paint(0x7a2f24, 0.8), 0, H * 0.33, D / 2 + 0.08));
  g.add(box(0.06, H * 0.62, 0.06, trim, 0, H * 0.33, D / 2 + 0.13));
  for (const s of [-1, 1]) {
    const x1 = box(W * 0.3, 0.09, 0.05, trim, s * W * 0.005, H * 0.33, D / 2 + 0.14);
    x1.rotation.z = s * Math.atan2(H * 0.6, W * 0.34); g.add(x1);
  }
  g.add(box(W * 0.44, 0.14, 0.22, trim, 0, H * 0.68, D / 2 + 0.06));                    // 门头横板
  // 阁楼门 + 吊臂 + 山尖通风窗
  g.add(box(W * 0.16, H * 0.26, 0.12, trim, 0, H * 0.86, D / 2 + 0.02));
  g.add(box(W * 0.18, 0.1, 0.5, trim, 0, H * 1.02, D / 2 + 0.28));
  g.add(box(0.07, 0.07, 0.4, M.metal(0x6f6a63, 0.6, 0.4), 0, H * 0.98, D / 2 + 0.3));
  g.add(box(W * 0.1, 0.12, 0.06, M.dark(0x2b3037, 0.8), 0, H * 1.06, D / 2 + 0.03));
  // 侧墙高窗 + 屋脊通风帽
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++)
      g.add(box(0.1, 0.5, 0.42, trim, s * (W / 2 + 0.02), H * 0.62, (i - 0.5) * D * 0.4));
    g.add(box(0.34, 0.34, D * 0.5, trim, s * W * 0.44, H - 0.3, 0));                    // 檐下挑梁（原先跑到屋面肚子里）
  }
  const cupY = barnRoof.userData.top || (H + D * 0.36);
  for (const s of [-1, 1]) g.add(box(0.5, 0.7, 0.5, wall, s * 0.55, cupY + 0.35, 0));   // 屋脊阁楼小塔（cupola）
  g.add(box(1.5, 0.9, 1.5, wall, 0, cupY + 0.85, 0));
  g.add(box(1.7, 0.12, 1.7, trim, 0, cupY + 1.36, 0));
  g.add(cone(1.15, 0.7, roofM, 4, 0, cupY + 1.77, 0));
  g.children[g.children.length - 1].rotation.y = Math.PI / 4;
  g.add(cyl(0.04, 0.05, 0.5, M.metal(0x8b9299, 0.4, 0.8), 6, 0, cupY + 2.35, 0));       // 风向标杆
  const vane = box(0.42, 0.22, 0.03, M.metal(0x8b9299, 0.4, 0.8), 0.16, cupY + 2.5, 0);
  g.add(vane);
  return cnShade(g);
}
function buildGazebo(p) {
  const g = new THREE.Group();
  const w = M.paint(0xf2efe8, 0.72);
  g.add(cyl(p.r * 1.25, p.r * 1.25, 0.3, M.stone(0xbdb6ab, 0.9), 8, 0, 0.15, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(cyl(0.11, 0.12, p.h, w, 8, Math.cos(a) * p.r, 0.3 + p.h / 2, Math.sin(a) * p.r));
    g.add(box(p.r * 0.72, 0.4, 0.07, w, Math.cos(a + Math.PI / 8) * p.r * 0.94, 0.5, Math.sin(a + Math.PI / 8) * p.r * 0.94));
    g.children[g.children.length - 1].rotation.y = -(a + Math.PI / 8) + Math.PI / 2;
  }
  // 地板 + 两级踏步 + 柱间坐凳栏板（上一段的 8 根柱子已经在循环里建好）
  g.add(cyl(p.r * 1.16, p.r * 1.16, 0.1, M.paint(0xc9bda9, 0.85), 8, 0, 0.35, 0));
  g.add(box(p.r * 0.8, 0.1, 0.4, M.paint(0xc9bda9, 0.85), 0, 0.34, p.r + 0.42));        // 平台
  g.add(box(p.r * 0.8, 0.12, 0.4, M.paint(0xc9bda9, 0.85), 0, 0.17, p.r + 0.82));       // 下一级
  for (let i = 0; i < 8; i++) {                                                          // 柱间斜撑（挂落）
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const br = box(p.r * 0.7, 0.09, 0.06, w, Math.cos(a) * p.r * 0.94, 0.3 + p.h - 0.28, Math.sin(a) * p.r * 0.94);
    br.rotation.y = -a + Math.PI / 2; g.add(br);
  }
  g.add(cyl(p.r * 1.3, p.r * 0.2, 0.9, roofSurf(new THREE.Color(p.roof).getHex(), 0.7), 8, 0, 0.3 + p.h + 0.45, 0));
  g.add(cyl(p.r * 0.3, p.r * 0.3, 0.08, w, 8, 0, 0.3 + p.h + 0.94, 0));                  // 顶棚中心盘
  g.add(cone(p.r * 0.24, 0.7, w, 8, 0, 0.3 + p.h + 1.2, 0));
  g.add(sph(0.13, w, 8, 0, 0.3 + p.h + 1.62, 0));                                        // 宝顶珠
  return cnShade(g);
}
function buildClockTower(p) {
  const g = new THREE.Group();
  const st = M.stone(new THREE.Color(p.wall).getHex(), 0.8);
  const trim = M.paint(0xe4dfd4, 0.75);
  const W = p.w, H = p.h;
  g.add(box(W * 1.24, 0.6, W * 1.24, trim, 0, 0.3, 0));                              // 基座
  g.add(box(W * 1.1, 0.3, W * 1.1, st, 0, 0.75, 0));
  g.add(box(W, H - 1.05, W, st, 0, 1.05 + (H - 1.05) / 2, 0));                       // 塔身
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                                 // 四角隅石
    g.add(box(0.28, H - 1.05, 0.28, trim, sx * (W / 2 - 0.14), 1.05 + (H - 1.05) / 2, sz * (W / 2 - 0.14)));
  for (const fy of [0.34, 0.68]) g.add(box(W * 1.09, 0.22, W * 1.09, trim, 0, H * fy, 0));   // 两道腰线
  g.add(box(W * 0.4, 1.9, 0.12, M.paint(0x4a3020, 0.6), 0, 1.9, W / 2 + 0.02));       // 门
  g.add(box(W * 0.52, 0.16, 0.22, trim, 0, 2.93, W / 2 + 0.05));                      // 门楣
  g.add(box(W * 0.62, 0.1, 0.34, M.stone(0xbdb6ab, 0.9), 0, 1.05, W / 2 + 0.15));     // 门前踏步
  for (let i = 0; i < 3; i++) g.add(box(W * 0.2, 0.66, 0.1, M.glassy(0x2b3a46, 0.3, 0.1, 0.5), 0, H * (0.15 + i * 0.22), W / 2 + 0.02));  // 竖窗
  g.add(box(W * 1.14, 0.4, W * 1.14, trim, 0, H - 1.4, 0));                           // 钟室挑檐
  g.add(box(W * 1.2, 0.26, W * 1.2, st, 0, H - 1.05, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const F = new THREE.Group();                                                       // 整面钟做成一个子组，整体转到对应墙面（局部 +Z = 朝外）
    F.position.set(Math.sin(a) * (W * 0.51 + 0.06), H - 2.6, Math.cos(a) * (W * 0.51 + 0.06));
    F.rotation.y = a;
    const ring = cyl(W * 0.34, W * 0.34, 0.1, trim, 20); ring.rotation.x = Math.PI / 2; F.add(ring);
    const face = cyl(W * 0.3, W * 0.3, 0.12, M.paint(0xf4efe4, 0.5), 20); face.rotation.x = Math.PI / 2; face.position.z = 0.03; F.add(face);
    for (let k = 0; k < 12; k++) {                                                     // 12 个时刻刻度
      const b = (k / 12) * Math.PI * 2, r = W * 0.25;
      F.add(box(k % 3 === 0 ? 0.05 : 0.03, k % 3 === 0 ? 0.1 : 0.06, 0.02, M.dark(0x1c2026, 0.6), Math.cos(b) * r, Math.sin(b) * r, 0.1));
    }
    const hh = box(0.09, W * 0.18, 0.03, M.dark(0x1c2026, 0.5), 0, W * 0.07, 0.12); hh.rotation.z = 0.5; F.add(hh);
    const mh = box(W * 0.14, 0.08, 0.03, M.dark(0x1c2026, 0.5), 0, -W * 0.05, 0.12); mh.rotation.z = -0.25; F.add(mh);
    F.add(cyl(0.045, 0.045, 0.05, M.dark(0x1c2026, 0.5), 8, 0, 0, 0.14));
    g.add(F);
  }
  const sp = cone(W * 0.9, p.spire, roofSurf(new THREE.Color(p.roof).getHex(), 0.66), 4, 0, p.h + p.spire / 2 - 1.2, 0);
  sp.rotation.y = Math.PI / 4; g.add(sp);
  g.add(cyl(0.05, 0.07, 0.9, M.metal(0x8b9299, 0.4, 0.8), 6, 0, p.h + p.spire - 1.0, 0));     // 避雷针
  g.add(sph(0.12, M.metal(0xd8c07a, 0.3, 0.9), 8, 0, p.h + p.spire - 0.5, 0));
  return cnShade(g);
}

// ================================================================= 室内 ===
function buildRoom(p) {
  const g = new THREE.Group();
  const floorM = M.paint(new THREE.Color(p.floor).getHex(), 0.55 + p.gloss * 0.3);
  const wallM = M.paint(new THREE.Color(p.wall).getHex(), 0.9);
  floorM.side = THREE.DoubleSide; wallM.side = THREE.DoubleSide;
  g.add(planeXZ(p.w, p.d, floorM, 0, 0, 0));
  if (p.ceiling) g.add(box(p.w, 0.12, p.d, M.paint(0xeceff3, 0.95), 0, p.h, 0));
  const sk = M.paint(0xffffff, 0.7);
  if (p.back) {
    g.add(box(p.w, p.h, 0.12, wallM, 0, p.h / 2, -p.d / 2));
    g.add(box(p.w, 0.12, 0.16, sk, 0, 0.06, -p.d / 2 + 0.1));
    if (p.window > 0) {
      const ww = clamp(p.window, 0.5, p.w * 0.7), wh = clamp(p.wH || 1.6, 0.4, p.h * 0.7);
      const glass = M.glassy(0x9fc4dd, 0.06, 0.2, 0.5);
      glass.emissive = new THREE.Color(0xbfd8e8); glass.emissiveIntensity = p.light * 1.4;
      g.add(box(ww, wh, 0.06, glass, 0, p.sill + wh / 2, -p.d / 2 + 0.06));
      g.add(box(ww + 0.24, 0.12, 0.2, sk, 0, p.sill + wh + 0.06, -p.d / 2 + 0.08));
      g.add(box(ww + 0.24, 0.12, 0.2, sk, 0, p.sill - 0.06, -p.d / 2 + 0.08));
      g.add(box(0.08, wh, 0.09, sk, 0, p.sill + wh / 2, -p.d / 2 + 0.07));
      if (p.glow) g.userData.glow = [glass];
    }
  }
  if (p.left) g.add(box(0.12, p.h, p.d, wallM, -p.w / 2, p.h / 2, 0));
  if (p.right) g.add(box(0.12, p.h, p.d, wallM, p.w / 2, p.h / 2, 0));
  if (p.front) {
    const open = clamp(p.doorW || 0, 0, p.w * 0.6);
    if (open > 0.05) {
      const sideW = (p.w - open) / 2;
      g.add(box(sideW, p.h, 0.12, wallM, -(open + sideW) / 2, p.h / 2, p.d / 2));
      g.add(box(sideW, p.h, 0.12, wallM, (open + sideW) / 2, p.h / 2, p.d / 2));
      g.add(box(open, p.h - 2.1, 0.12, wallM, 0, p.h - (p.h - 2.1) / 2, p.d / 2));
    } else g.add(box(p.w, p.h, 0.12, wallM, 0, p.h / 2, p.d / 2));
  }
  if (p.cornice && p.ceiling) {
    for (const sz of [-1, 1]) g.add(box(p.w, 0.16, 0.16, sk, 0, p.h - 0.1, sz * (p.d / 2 - 0.08)));
    for (const sx of [-1, 1]) g.add(box(0.16, 0.16, p.d, sk, sx * (p.w / 2 - 0.08), p.h - 0.1, 0));   // 顶角线四面交圈
  }
  // 踢脚线：四面交圈（旧版只有后墙一条）
  const bsm = M.paint(0xfafbfc, 0.55);
  if (p.back) g.add(box(p.w, 0.11, 0.04, bsm, 0, 0.055, -p.d / 2 + 0.08));
  if (p.front) g.add(box(p.w, 0.11, 0.04, bsm, 0, 0.055, p.d / 2 - 0.08));
  if (p.left) g.add(box(0.04, 0.11, p.d, bsm, -p.w / 2 + 0.08, 0.055, 0));
  if (p.right) g.add(box(0.04, 0.11, p.d, bsm, p.w / 2 - 0.08, 0.055, 0));
  if (p.back && p.window > 0) {                                                     // 窗套：两侧立挺 + 上樘
    const ww = clamp(p.window, 0.5, p.w * 0.7), wh = clamp(p.wH || 1.6, 0.4, p.h * 0.7);
    for (const sx of [-1, 1]) g.add(box(0.07, wh + 0.12, 0.12, sk, sx * (ww / 2 + 0.03), p.sill + wh / 2, -p.d / 2 + 0.09));
    g.add(box(ww + 0.2, 0.07, 0.12, sk, 0, p.sill + wh + 0.1, -p.d / 2 + 0.09));
    g.add(box(ww + 0.16, 0.04, 0.24, sk, 0, p.sill - 0.02, -p.d / 2 + 0.13));       // 窗台板
  }
  if (p.front && clamp(p.doorW || 0, 0, p.w * 0.6) > 0.05) {                        // 门套
    const op = clamp(p.doorW, 0, p.w * 0.6);
    for (const sx of [-1, 1]) g.add(box(0.06, 2.16, 0.14, sk, sx * (op / 2 + 0.03), 1.08, p.d / 2 - 0.09));
    g.add(box(op + 0.18, 0.07, 0.14, sk, 0, 2.19, p.d / 2 - 0.09));
  }
  if (p.left) {                                                                     // 开关 + 插座
    g.add(box(0.02, 0.12, 0.08, M.paint(0xf2f4f7, 0.4), -p.w / 2 + 0.14, 1.3, -p.d * 0.3));
    g.add(box(0.02, 0.08, 0.08, M.paint(0xf2f4f7, 0.4), -p.w / 2 + 0.14, 0.35, p.d * 0.25));
  }
  if (p.ceiling) {                                                                  // 吸顶灯
    g.add(cyl(0.24, 0.26, 0.06, M.paint(0xf6f7f9, 0.5), 18, 0, p.h - 0.15, 0));
    const lm = M.glow(0xfff2d8, 1.4);
    g.add(cyl(0.2, 0.22, 0.03, lm, 18, 0, p.h - 0.2, 0));
    g.userData.glow = [...(g.userData.glow || []), lm];
  }
  return shade(g, false, true);
}
function buildWallSeg(p) {
  const g = new THREE.Group();
  const wall = M.paint(new THREE.Color(p.color).getHex(), 0.9);
  wall.side = THREE.DoubleSide;
  const openW = clamp(p.openW, 0, p.length * 0.8);
  if (openW > 0.05) {
    const sW = (p.length - openW) / 2;
    g.add(box(sW, p.height, p.thick, wall, -(openW + sW) / 2, p.height / 2, 0));
    g.add(box(sW, p.height, p.thick, wall, (openW + sW) / 2, p.height / 2, 0));
    g.add(box(openW, Math.max(0, p.height - p.openH), p.thick, wall, 0, p.height - Math.max(0, p.height - p.openH) / 2, 0));
  } else g.add(box(p.length, p.height, p.thick, wall, 0, p.height / 2, 0));
  if (p.trim) {
    g.add(box(p.length, 0.1, p.thick + 0.06, M.paint(0xf2f4f7, 0.7), 0, 0.05, 0));                  // 踢脚线
    g.add(box(p.length, 0.02, p.thick + 0.07, M.paint(0xe2e5e9, 0.7), 0, 0.105, 0));                // 踢脚压条
  }
  g.add(box(p.length, 0.05, p.thick + 0.03, M.paint(0xe9ebee, 0.8), 0, p.height - 0.02, 0));        // 压顶
  for (const sx of [-1, 1]) g.add(box(0.03, p.height, p.thick + 0.02, M.paint(0xe9ebee, 0.8), sx * (p.length / 2 - 0.015), p.height / 2, 0));   // 两端阳角
  if (p.length > 1.6) {                                                                              // 一个插座 + 一条挂镜线
    g.add(box(0.09, 0.13, 0.02, M.paint(0xf2f4f7, 0.4), p.length * 0.3, 0.36, p.thick / 2 + 0.005));
    g.add(box(p.length - 0.12, 0.03, 0.015, M.paint(0xe2e5e9, 0.7), 0, p.height * 0.72, p.thick / 2 + 0.005));
  }
  if (openW > 0.05) {                                                                                // 门洞两侧立挺 + 过梁
    for (const sx of [-1, 1]) g.add(box(0.06, p.openH, 0.03, M.paint(0xf2f4f7, 0.6), sx * (openW / 2 + 0.03), p.openH / 2, p.thick / 2 + 0.01));
    g.add(box(openW + 0.18, 0.06, 0.03, M.paint(0xf2f4f7, 0.6), 0, p.openH + 0.03, p.thick / 2 + 0.01));
  }
  return shade(g, true, true);
}
function buildSofa(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.88);
  const w = p.w;
  g.add(box(w, 0.42, p.d, m, 0, 0.4, 0));
  g.add(box(w, 0.62, 0.26, m, 0, 0.72, -p.d / 2 + 0.13));
  for (const s of [-1, 1]) g.add(box(0.24, 0.6, p.d, m, s * (w / 2 - 0.12), 0.5, 0));
  const n = Math.max(2, Math.round(w / 1.1));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * (w - 0.7);
    g.add(box((w - 0.7) / n - 0.06, 0.16, p.d - 0.4, m, x, 0.68, 0.08));
    g.add(box((w - 0.7) / n - 0.06, 0.44, 0.16, m, x, 0.86, -p.d / 2 + 0.28));
  }
  for (const s of [-1, 1]) {
    g.add(cyl(0.05, 0.07, 0.2, M.dark(0x2b2f36, 0.6), 8, s * (w / 2 - 0.2), 0.1, p.d / 2 - 0.2));      // 木脚
    g.add(cyl(0.05, 0.07, 0.2, M.dark(0x2b2f36, 0.6), 8, s * (w / 2 - 0.2), 0.1, -p.d / 2 + 0.2));
    g.add(box(0.26, 0.5, 0.05, M.paint(0xbfb6a6, 0.9), s * (w / 2 - 0.12), 0.55, p.d / 2 - 0.01));     // 扶手前脸
    g.add(sph(0.09, m, 8, s * (w / 2 - 0.12), 0.79, p.d / 2 - 0.14));                                   // 扶手卷头
  }
  g.add(box(w - 0.1, 0.08, p.d - 0.06, M.paint(0xbfb6a6, 0.9), 0, 0.22, 0));                            // 底裙压条
  for (let i = 0; i < n; i++) {                                                                          // 绷扣
    const x = (i / (n - 1) - 0.5) * (w - 0.7);
    for (const by of [-0.12, 0.12]) g.add(sph(0.016, M.paint(0xbfb6a6, 0.9), 6, x, 0.86 + by, -p.d / 2 + 0.28 - 0.08));
  }
  for (const s of [-1, 1]) {                                                                            // 抱枕
    const pil = box(0.3, 0.09, 0.3, M.paint(s < 0 ? 0xd8c8a0 : 0x7a5a4a, 0.92), s * (w / 2 - 0.42), 0.8, -p.d / 2 + 0.42);
    pil.rotation.z = s * 0.3; pil.rotation.y = 0.35; g.add(pil);
  }
  return cnShade(g);
}
function buildChair(p) {
  const g = new THREE.Group();
  const m = M.wood(new THREE.Color(p.color).getHex(), 0.7);
  const pad = M.paint(0xd9cfbe, 0.92);
  const sY = 0.45, sW = 0.46, sD = 0.44;
  g.add(box(sW, 0.06, sD, m, 0, sY, 0));                                              // 座板
  g.add(box(sW - 0.07, 0.05, sD - 0.07, pad, 0, sY + 0.05, 0));                       // 软垫
  for (const [x, z] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) {
    g.add(box(0.05, sY - 0.06, 0.05, m, x, (sY - 0.06) / 2, z));                      // 4 腿
    g.add(box(0.06, 0.02, 0.06, M.dark(0x2b2f36, 0.85), x, 0.01, z));                 // 脚垫
  }
  for (const sz of [-1, 1]) g.add(box(sW - 0.08, 0.04, 0.035, m, 0, sY - 0.15, sz * 0.17));   // 横撑
  for (const sx of [-1, 1]) g.add(box(0.035, 0.04, sD - 0.08, m, sx * 0.19, sY - 0.15, 0));
  for (const sx of [-1, 1]) g.add(box(0.05, 0.52, 0.05, m, sx * 0.19, sY + 0.24, -0.17));     // 后立柱
  g.add(box(sW, 0.09, 0.05, m, 0, sY + 0.47, -0.17));                                  // 顶冠
  for (let i = 0; i < 2; i++) g.add(box(0.035, 0.34, 0.03, m, (i - 0.5) * 0.17, sY + 0.21, -0.17));   // 靠背竖棂
  return cnShade(g);
}
function buildTable(p) {
  const g = new THREE.Group();
  const top = M.paint(new THREE.Color(p.top).getHex(), p.gloss > 0.5 ? 0.25 : 0.7, p.gloss > 0.5 ? 0.1 : 0.02);
  const leg = M.paint(new THREE.Color(p.leg).getHex(), 0.5, 0.2);
  const ap = 0.09;                                                                  // 牙板高
  if (p.shape === 'round') {
    g.add(cyl(p.w / 2, p.w / 2, 0.07, top, 26, 0, p.h, 0));
    g.add(cyl(p.w / 2 - 0.05, p.w / 2 - 0.05, 0.03, top, 26, 0, p.h - 0.05, 0));    // 台面收边
    if (p.legs === 1) {
      g.add(cyl(0.14, 0.2, p.h - 0.05, leg, 12, 0, (p.h - 0.05) / 2, 0));
      g.add(cyl(p.w * 0.28, p.w * 0.3, 0.06, leg, 18, 0, 0.03, 0));
      g.add(cyl(0.17, 0.14, 0.05, leg, 12, 0, p.h - 0.13, 0));                      // 柱头
      g.add(cyl(0.22, 0.19, 0.04, leg, 12, 0, 0.34, 0));                            // 柱脚
    } else {
      const rr = p.w / 2 - 0.14;
      for (let i = 0; i < p.legs; i++) {
        const a = (i / p.legs) * Math.PI * 2 + Math.PI / 4;
        g.add(cyl(0.035, 0.05, p.h - 0.05, leg, 8, Math.cos(a) * rr, (p.h - 0.05) / 2, Math.sin(a) * rr));
      }
      g.add(cyl(p.w * 0.3, p.w * 0.3, 0.05, leg, 20, 0, 0.26, 0));                  // 下横圈
    }
  } else {
    g.add(box(p.w, 0.07, p.d, top, 0, p.h, 0));
    g.add(box(p.w - 0.08, 0.03, p.d - 0.08, top, 0, p.h - 0.05, 0));
    g.add(box(p.w - 0.12, ap, p.d - 0.12, leg, 0, p.h - 0.07 - ap / 2, 0));         // 牙板
    if (p.legs === 4) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx * (p.w / 2 - 0.14), z = sz * (p.d / 2 - 0.14);
        g.add(box(0.08, p.h, 0.08, leg, x, p.h / 2, z));
        g.add(box(0.1, 0.03, 0.1, M.dark(0x2b2f36, 0.85), x, 0.015, z));            // 脚垫
      }
      for (const sz of [-1, 1]) g.add(box(p.w - 0.28, 0.04, 0.04, leg, 0, p.h * 0.42, sz * (p.d / 2 - 0.14)));
      for (const sx of [-1, 1]) g.add(box(0.04, 0.04, p.d - 0.28, leg, sx * (p.w / 2 - 0.14), p.h * 0.42, 0));
    } else {
      g.add(box(p.w * 0.1, p.h, p.d * 0.7, leg, -p.w * 0.38, p.h / 2, 0));
      g.add(box(p.w * 0.1, p.h, p.d * 0.7, leg, p.w * 0.38, p.h / 2, 0));
      g.add(box(p.w * 0.86, 0.05, p.d * 0.6, leg, 0, p.h * 0.32, 0));               // 下隔板
    }
  }
  return cnShade(g);
}
function buildBed(p) {
  const g = new THREE.Group();
  const frame = M.paint(new THREE.Color(p.frame).getHex(), 0.7);
  const sheet = M.paint(0xf1f3f6, 0.9);
  const quilt = M.paint(new THREE.Color(p.quilt).getHex(), 0.86);
  g.add(box(p.w, 0.26, p.d, frame, 0, 0.13, 0));                                     // 床箱
  g.add(box(p.w + 0.06, 0.06, p.d + 0.06, frame, 0, 0.29, 0));                       // 箱沿
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                                // 4 只床脚
    g.add(box(0.1, 0.12, 0.1, M.dark(0x2b2f36, 0.8), sx * (p.w / 2 - 0.1), 0.06, sz * (p.d / 2 - 0.1)));
  g.add(box(p.w - 0.1, 0.2, p.d - 0.1, sheet, 0, 0.42, 0));                          // 床垫
  g.add(box(p.w - 0.06, 0.05, p.d - 0.06, sheet, 0, 0.52, 0));                       // 床单
  // 床头板：立柱 + 3 块镶板 + 顶冠
  g.add(box(p.w, 0.9, 0.12, frame, 0, 0.6, -p.d / 2));
  for (let i = 0; i < 3; i++)
    g.add(box(p.w / 3 - 0.12, 0.62, 0.04, M.paint(0xd9cebb, 0.85), -p.w / 3 + i * (p.w / 3), 0.6, -p.d / 2 + 0.09));
  g.add(box(p.w + 0.12, 0.1, 0.2, frame, 0, 1.1, -p.d / 2 + 0.02));                  // 床头顶冠
  g.add(box(p.w - 0.16, 0.42, 0.1, frame, 0, 0.4, p.d / 2 - 0.04));                  // 床尾板
  g.add(box(p.w - 0.3, 0.16, p.d * 0.6, quilt, 0, 0.56, p.d * 0.16));                // 被子
  g.add(box(p.w - 0.3, 0.1, 0.14, quilt, 0, 0.62, p.d * 0.16 - p.d * 0.3));          // 翻边
  g.add(box(p.w - 0.5, 0.04, 0.5, M.paint(0x8a6a4a, 0.9), 0, 0.63, p.d * 0.36));     // 床旗
  for (const s of [-1, 1]) g.add(box(p.w * 0.36, 0.16, 0.4, M.paint(0xffffff, 0.92), s * p.w * 0.22, 0.58, -p.d * 0.3));
  g.add(box(p.w * 0.44, 0.14, 0.2, M.paint(0xe8e2d6, 0.92), 0, 0.6, -p.d * 0.36));   // 长枕
  if (p.nightstand) for (const s of [-1, 1]) g.add(box(0.5, 0.5, 0.42, frame, s * (p.w / 2 + 0.35), 0.25, -p.d * 0.3));
  return cnShade(g);
}
function buildWardrobe(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.55, 0.06);
  const trim = M.paint(0xe3e7ec, 0.5, 0.05);
  const doors = Math.max(2, p.doors);
  g.add(box(p.w, 0.1, p.d + 0.04, M.dark(0x3a3f46, 0.85), 0, 0.05, 0));              // 踢脚座
  g.add(box(p.w, p.h - 0.2, p.d, m, 0, 0.1 + (p.h - 0.2) / 2, 0));                   // 柜体
  g.add(box(p.w + 0.1, 0.1, p.d + 0.06, trim, 0, p.h - 0.05, 0));                    // 顶冠
  g.add(box(p.w + 0.06, 0.06, p.d + 0.03, trim, 0, p.h - 0.13, 0));
  for (let i = 0; i < doors; i++) {
    const x = (i / (doors - 1) - 0.5) * (p.w - 0.1);
    const dw = p.w / doors - 0.06;
    g.add(box(dw, p.h - 0.34, 0.03, trim, x, 0.1 + (p.h - 0.34) / 2, p.d / 2 + 0.02));   // 门板
    g.add(box(dw - 0.16, p.h * 0.42, 0.02, m, x, 0.1 + (p.h - 0.34) * 0.62, p.d / 2 + 0.04)); // 门芯板
    g.add(box(dw - 0.16, p.h * 0.3, 0.02, m, x, 0.1 + (p.h - 0.34) * 0.22, p.d / 2 + 0.04));
    g.add(box(0.03, 0.26, 0.04, M.metal(0xb9c0c8, 0.3, 0.8), x + dw * 0.34, p.h * 0.5, p.d / 2 + 0.05));
  }
  g.add(box(p.w - 0.14, 0.02, 0.01, M.glassy(0x2f4a5c, 0.1, 0.4, 0.85), 0, p.h * 0.55, p.d / 2 + 0.06)); // 中间那扇的镜面
  return cnShade(g);
}
function buildShelf(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.7);
  g.add(box(p.w, p.h, 0.04, M.paint(0x2a2f36, 0.9), 0, p.h / 2, -p.d / 2 + 0.02));
  for (const s of [-1, 1]) g.add(box(0.05, p.h, p.d, m, s * p.w / 2, p.h / 2, 0));
  const n = Math.max(2, p.shelves);
  const rng = makeRng(p.seed);
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * (p.h - 0.06) + 0.03;
    g.add(box(p.w, 0.05, p.d, m, 0, y, 0));
    if (i === n) continue;
    let x = -p.w / 2 + 0.1;
    while (x < p.w / 2 - 0.1) {
      const bw = 0.04 + rng() * 0.16;
      const bh = 0.2 + rng() * 0.14;
      if (rng() > 0.22) g.add(box(bw, bh, p.d * (0.55 + rng() * 0.3), M.paint(new THREE.Color(p.bookColor).getHex(), 0.8), x + bw / 2, y + 0.03 + bh / 2, 0));
      x += bw + 0.012 + rng() * 0.05;
    }
  }
  return cnShade(g);
}
function buildKitchen(p) {
  const g = new THREE.Group();
  const cabC = new THREE.Color(p.cabinet).getHex();
  const cab = M.paint(cabC, 0.5, 0.05);
  const cabD = M.paint(new THREE.Color(cabC).multiplyScalar(0.84).getHex(), 0.55, 0.05);
  const topM = M.paint(new THREE.Color(p.top).getHex(), 0.24, 0.12);
  const steel = M.metal(0xc3c9d0, 0.28, 0.9);
  const dark = M.metal(0x3a4048, 0.42, 0.6);
  const L = Math.max(1.5, num(p.length, 5)), D = Math.max(0.4, num(p.d, 0.64)), top = 0.92;
  // 地柜：踢脚 → 柜体 → 门板 + 拉手（旧版只有两个光盒，连门都没有）
  g.add(box(L - 0.1, 0.09, D - 0.12, M.dark(0x2b2f36, 0.85), 0, 0.045, 0.03));
  g.add(box(L, 0.79, D, cab, 0, 0.485, 0));
  const nDr = clamp(Math.round(L / 0.55), 2, 12);
  for (let i = 0; i < nDr; i++) {
    const x = -L / 2 + (i + 0.5) * (L / nDr);
    g.add(box(L / nDr - 0.03, 0.68, 0.014, cabD, x, 0.53, D / 2 - 0.006));
    g.add(box(0.16, 0.022, 0.03, steel, x, 0.83, D / 2 + 0.008));
  }
  for (const sx of [-1, 1]) g.add(box(0.022, 0.88, D, cabD, sx * (L / 2 - 0.011), 0.53, 0));
  g.add(box(L + 0.06, 0.06, D + 0.06, topM, 0, top + 0.03, 0));
  // 水槽（下沉盆）+ 抽拉龙头
  g.add(box(L * 0.24, 0.03, D * 0.62, steel, -L * 0.18, top - 0.005, 0));
  g.add(box(L * 0.2, 0.17, D * 0.5, M.metal(0xa8b0b8, 0.22, 0.95), -L * 0.18, top - 0.1, 0));
  g.add(cyl(0.02, 0.024, 0.32, steel, 8, -L * 0.18, top + 0.16, -D * 0.2));
  g.add(cyl(0.014, 0.014, 0.2, steel, 8, -L * 0.18, top + 0.31, -D * 0.13));
  // 灶台 + 4 个灶眼 + 旋钮条
  g.add(box(L * 0.2, 0.02, D * 0.56, dark, L * 0.21, top + 0.01, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(cyl(0.07, 0.07, 0.014, M.dark(0x1e2228, 0.7), 12, L * 0.21 + sx * L * 0.042, top + 0.028, sz * D * 0.11));
  for (let i = 0; i < 4; i++) g.add(cyl(0.015, 0.015, 0.028, steel, 8, L * 0.21 - 0.1 + i * 0.07, top + 0.03, D * 0.23));
  // 后挡墙：把整排吊柜接回台面（旧版吊柜悬在半空）
  g.add(box(L, 1.3, 0.05, M.paint(0xdfe4ea, 0.62), 0, top + 0.67, -D / 2 + 0.005));
  const upL = L * 0.56, upX = -L * 0.22;
  g.add(box(upL, 0.7, D * 0.42, cab, upX, 1.9, -D / 2 + D * 0.21 + 0.03));
  const nUp = clamp(Math.round(upL / 0.6), 2, 10);
  for (let i = 0; i < nUp; i++) {
    const x = upX - upL / 2 + (i + 0.5) * (upL / nUp);
    g.add(box(upL / nUp - 0.03, 0.6, 0.014, cabD, x, 1.9, -D / 2 + D * 0.42 + 0.035));
    g.add(box(0.14, 0.022, 0.03, steel, x, 1.63, -D / 2 + D * 0.42 + 0.052));
  }
  // 抽油烟机（右侧，避开吊柜）
  g.add(box(L * 0.24, 0.32, D * 0.5, steel, L * 0.3, 1.72, -D / 2 + D * 0.25 + 0.03));
  g.add(box(L * 0.28, 0.05, D * 0.56, steel, L * 0.3, 1.55, -D / 2 + D * 0.28 + 0.03));
  g.add(cyl(0.085, 0.085, 0.62, steel, 10, L * 0.3, 2.19, -D / 2 + D * 0.25 + 0.03));
  g.add(box(L * 0.3, 0.08, D * 0.6, steel, L * 0.3, 2.52, -D / 2 + D * 0.25 + 0.03));
  if (p.island) {
    g.add(box(L * 0.6, 0.79, D * 0.8, cab, 0, 0.485, D * 1.9));
    g.add(box(L * 0.64, 0.07, D * 0.86, topM, 0, top + 0.035, D * 1.9));
    g.add(box(L * 0.56, 0.09, D * 0.72, M.dark(0x2b2f36, 0.85), 0, 0.045, D * 1.9));
    for (let i = 0; i < 3; i++) g.add(box(0.14, 0.022, 0.03, steel, (i - 1) * 0.3, 0.72, D * 1.9 + D * 0.41));
  }
  return cnShade(g);
}
function buildLampStand(p) {
  const g = new THREE.Group();
  const pole = M.metal(0x9aa2ab, 0.4, 0.8);
  g.add(cyl(0.24, 0.26, 0.04, M.dark(0x2b3037, 0.6), 16, 0, 0.02, 0));                // 底盘
  g.add(cyl(0.18, 0.24, 0.06, M.dark(0x33383f, 0.6), 16, 0, 0.07, 0));                // 配重块
  g.add(cyl(0.045, 0.055, 0.06, pole, 10, 0, 0.13, 0));                               // 柱础
  g.add(cyl(0.03, 0.03, p.h, pole, 10, 0, p.h / 2 + 0.13, 0));                        // 灯杆
  g.add(cyl(0.05, 0.038, 0.05, pole, 10, 0, p.h + 0.16, 0));                          // 灯头座
  const lampMat = M.glow(p.color, p.glow);
  g.add(cyl(0.18, 0.26, 0.34, lampMat, 18, 0, p.h + 0.36, 0));                        // 灯罩
  g.add(cyl(0.19, 0.19, 0.03, M.paint(0xe8e2d6, 0.8), 18, 0, p.h + 0.53, 0));         // 顶圈
  g.add(cyl(0.185, 0.185, 0.025, M.paint(0xe8e2d6, 0.8), 18, 0, p.h + 0.19, 0));      // 底圈
  g.userData.glow = [lampMat];
  return cnShade(g);
}
function buildRug(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.95);
  m.side = THREE.DoubleSide;
  g.add(planeXZ(p.w, p.d, m, 0, 0.012, 0));
  const b = M.paint(new THREE.Color(p.border).getHex(), 0.95);
  b.side = THREE.DoubleSide;
  g.add(planeXZ(p.w + 0.2, p.d + 0.2, b, 0, 0.008, 0));
  g.add(planeXZ(p.w - 0.16, p.d - 0.16, m, 0, 0.016, 0));                            // 主毯面（压在边框之上，做出一圈边）
  const fr = M.paint(new THREE.Color(p.border).getHex(), 0.95);                       // 两端流苏（合成一次绘制）
  const nf = clamp(Math.round(p.w / 0.09), 6, 60), fArr = [];
  for (const sz of [-1, 1]) for (let i = 0; i < nf; i++)
    fArr.push({ p: [(i / nf - 0.5) * p.w, 0.01, sz * (p.d / 2 + 0.06)], s: [0.02, 0.008, 0.11] });
  const fb = batch(new THREE.BoxGeometry(1, 1, 1), fr, fArr);
  if (fb) g.add(fb);
  return shade(g, false, true);
}
function buildStairsIn(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.6);
  const trim = M.paint(0xf2f4f7, 0.7);
  const n = Math.max(3, Math.round(p.height / p.rise));
  const rise = p.height / n, run = p.run, L = n * run;
  for (let i = 0; i < n; i++) {
    const y = rise * (i + 1), z = i * run + run / 2;
    g.add(box(p.width, rise * 0.34, run, m, 0, y - rise * 0.17, z));                  // 踏步板
    g.add(box(p.width, rise * 0.7, 0.03, trim, 0, y - rise * 0.5, z - run / 2 + 0.015));  // 踢面板
    g.add(box(p.width, 0.03, 0.05, trim, 0, y - 0.015, z + run / 2 - 0.02));          // 防滑条
  }
  // 梯梁：下端水平落地、上端竖直切（整块旋转斜板的两端会斜插到地板下面，把整挂楼梯顶起来）
  const bh = Math.max(0.14, p.height * 0.9), zA = Math.min(L * 0.92, (bh / p.height) * L);
  const sp = new THREE.Shape();
  sp.moveTo(0, 0); sp.lineTo(zA, 0); sp.lineTo(L, p.height - bh); sp.lineTo(L, p.height); sp.closePath();
  const sg = new THREE.ExtrudeGeometry(sp, { depth: 0.07, bevelEnabled: false });
  sg.translate(0, 0, -0.035);
  for (const s of [-1, 1]) {
    const mm = new THREE.Mesh(sg, m);
    mm.rotation.y = -Math.PI / 2;
    mm.position.set(s * (p.width / 2 + 0.04), 0, 0);
    g.add(mm);
  }
  const ang = Math.atan2(p.height, L);
  for (const s of [-1, 1]) {                                                          // 望柱 + 扶手 + 栏板
    g.add(box(0.11, 1.05, 0.11, m, s * (p.width / 2 + 0.04), 0.52, -0.05));
    g.add(box(0.13, 1.05, 0.13, m, s * (p.width / 2 + 0.04), p.height + 0.52, L + 0.05));
    const bal = [];
    for (let i = 0; i < n; i++) {
      const z = i * run + run * 0.5;
      bal.push({ p: [s * (p.width / 2 + 0.04), rise * (i + 1) + 0.42, z], s: [0.04, 0.84, 0.04] });
    }
    const bi = batch(new THREE.BoxGeometry(1, 1, 1), trim, bal);
    if (bi) g.add(bi);
    const rail = box(0.08, 0.09, Math.hypot(L, p.height) * 1.04, m, s * (p.width / 2 + 0.04), p.height / 2 + 0.98, L / 2);
    rail.rotation.x = -ang;
    g.add(rail);
  }
  return cnShade(g);
}
function buildPlantPot(p) {
  const g = new THREE.Group();
  const pot = M.paint(new THREE.Color(p.pot).getHex(), 0.75);
  g.add(cyl(p.r * 1.1, p.r * 0.8, p.h, pot, 14, 0, p.h / 2, 0));
  g.add(cyl(p.r * 1.16, p.r * 1.1, 0.06, pot, 14, 0, p.h, 0));
  g.add(cyl(p.r * 1.2, p.r * 1.2, 0.04, M.dark(0x3a3228, 0.9), 14, 0, 0.02, 0));      // 托盘
  g.add(cyl(p.r * 1.06, p.r * 1.06, 0.03, M.paint(0x4a3b2c, 0.95), 14, 0, p.h - 0.05, 0)); // 土面
  const stem = M.paint(0x4a6a34, 0.9);
  const rng = makeRng(p.seed);
  for (let i = 0; i < 4; i++) {                                                        // 枝干
    const a = rng() * Math.PI * 2, hh = p.h * (1.1 + rng() * 0.9);
    const st = cyl(0.012, 0.018, hh, stem, 5, Math.cos(a) * p.r * 0.3, p.h + hh / 2, Math.sin(a) * p.r * 0.3);
    st.rotation.z = (rng() - 0.5) * 0.3; g.add(st);
  }
  const leaf = M.leaf(new THREE.Color(p.leaf).getHex(), 0.85);
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = rng() * p.r * 0.5;
    const hh = 0.5 + rng() * p.h * 1.6;
    const s = new THREE.Mesh(new THREE.ConeGeometry(p.r * (0.5 + rng() * 0.5), hh, 5), leaf);
    s.position.set(Math.cos(a) * r, p.h + hh / 2, Math.sin(a) * r);
    s.rotation.set(rng() * 0.5, a, rng() * 0.4);
    g.add(s);
  }
  return cnShade(g);
}
function buildTvWall(p) {
  const g = new THREE.Group();
  const panel = M.paint(new THREE.Color(p.panel).getHex(), 0.6);
  const trim = M.paint(0x2a2f36, 0.7);
  g.add(box(p.w, p.h, 0.12, panel, 0, p.h / 2 + 0.2, 0));                              // 背景板
  g.add(box(p.w + 0.08, 0.06, 0.18, trim, 0, p.h + 0.23, 0.02));                       // 上收口
  for (const sx of [-1, 1]) g.add(box(0.06, p.h, 0.18, trim, sx * (p.w / 2 + 0.02), p.h / 2 + 0.2, 0.02));
  const sh = p.w * 0.62 * 0.56, sw = p.w * 0.62;
  g.add(box(sw + 0.06, sh + 0.06, 0.05, M.dark(0x14181d, 0.9), 0, p.h * 0.6 + 0.2, 0.1));  // 机身黑边
  const scr = M.glow(p.screen, p.bright);
  g.add(box(sw, sh, 0.06, scr, 0, p.h * 0.6 + 0.2, 0.13));                             // 屏幕
  g.add(box(0.16, 0.02, 0.05, M.dark(0x14181d, 0.9), 0, p.h * 0.6 + 0.2 - sh / 2 - 0.03, 0.14));  // 下logo条
  g.add(box(p.w * 0.8, 0.3, 0.44, panel, 0, 0.35, 0.3));                               // 电视柜
  g.add(box(p.w * 0.84, 0.05, 0.48, trim, 0, 0.52, 0.3));                              // 柜台面
  for (let i = 0; i < 2; i++) {                                                        // 抽屉 + 拉手
    g.add(box(p.w * 0.36, 0.24, 0.02, trim, (i - 0.5) * p.w * 0.4, 0.34, 0.52));
    g.add(box(p.w * 0.2, 0.02, 0.02, M.metal(0xb9c0c8, 0.3, 0.8), (i - 0.5) * p.w * 0.4, 0.34, 0.535));
  }
  g.add(box(p.w * 0.5, 0.06, 0.09, M.dark(0x1c2126, 0.85), 0, 0.58, 0.44));            // 回音壁
  g.add(box(0.22, 0.04, 0.14, M.dark(0x14181d, 0.9), p.w * 0.3, 0.55, 0.46));          // 机顶盒
  g.userData.glow = [scr];
  return cnShade(g);
}
function buildCurtain(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.94);
  m.side = THREE.DoubleSide;
  const n = Math.max(4, Math.round(p.w / 0.4));
  for (let i = 0; i <= n; i++) {
    const x = (i / n - 0.5) * p.w;
    const d = (i % 2 ? 0.14 : 0.02);
    g.add(box(p.w / n, p.h, d, m, x, p.h / 2 + 0.1, d));
  }
  // 帘杆：贴着帘顶装（旧版抬高 0.2，帘子跟杆之间空一条缝，看着像杆浮在墙上）+ 吊环 + 两端杆头
  const rod = cyl(0.03, 0.03, p.w + 0.3, M.metal(0x9aa2ab, 0.4, 0.8), 8, 0, p.h + 0.13, 0);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  for (let i = 0; i <= n; i += 2) {
    const x = (i / n - 0.5) * p.w;
    const ring = cyl(0.045, 0.045, 0.016, M.metal(0xb6bdc5, 0.3, 0.85), 8, x, p.h + 0.13, 0.12);
    ring.rotation.z = Math.PI / 2;
    g.add(ring);
  }
  for (const sx of [-1, 1]) g.add(sph(0.055, M.metal(0x9aa2ab, 0.35, 0.85), 10, sx * (p.w / 2 + 0.17), p.h + 0.13, 0));
  return cnShade(g);
}

// ================================================================= 注册表 ===
export const GROUP_CN = {
  cat: '中式古建', id: 'cn', items: [
    { type: 'hall', name: '宫殿大殿', icon: 'hall', build: buildHall, params: [PI('bays', '开间', 1, 11, 2, 5), PR('bay', '开间宽 m', 2.4, 6.5, 0.1, 4), PR('w', '面宽 m', 6, 46, 0.5, 20), PR('d', '进深 m', 5, 34, 0.5, 13), PR('h', '柱高 m', 2.6, 9, 0.1, 5), PR('roofH', '屋顶高 m', 1.2, 8, 0.1, 3.4), PS('kind', '屋顶', [{ v: 'wu', l: '庑殿' }, { v: 'xie', l: '歇山' }, { v: 'juan', l: '悬山' }], 'wu'), PR('ridge', '正脊比例', 0.1, 0.9, 0.02, 0.4), PR('eaveUp', '翼角起翘', 0, 0.5, 0.01, 0.16), PR('plinthH', '台基高 m', 0, 2.2, 0.05, 0.6), PB('steps', '踏跺', true), PB('dougong', '斗拱', true), PB('lattice', '槛窗', true), PB('rail','台基石栏杆',true), PB('innerCols','金柱（内槽）',true), PB('caihua','檐下彩画',true), PB('trim','脊兽·檐口椽瓦',true), PB('drip','瓦当滴水',true), PI('beasts','走兽数',0,9,1,5), PC('wall', '墙体色', '#d8cdb8'), PC('column', '柱色', '#8e3a2c'), PC('door', '门色', '#5c2c22'), PC('roof', '瓦色', '#41474f'), PC('ridgeColor', '脊色', '#2f353c'), PC('plinth', '台基色', '#b9b2a4')] },
    { type: 'hall2', name: '歇山殿宇', icon: 'hall', build: buildHall, params: [PI('bays', '开间', 1, 9, 2, 3), PR('bay', '开间宽 m', 2.4, 6, 0.1, 3.6), PR('w', '面宽 m', 6, 34, 0.5, 13), PR('d', '进深 m', 5, 24, 0.5, 9), PR('h', '柱高 m', 2.6, 8, 0.1, 4.2), PR('roofH', '屋顶高 m', 1, 6, 0.1, 2.6), PS('kind', '屋顶', [{ v: 'wu', l: '庑殿' }, { v: 'xie', l: '歇山' }, { v: 'juan', l: '悬山' }], 'xie'), PR('ridge', '正脊比例', 0.1, 0.9, 0.02, 0.34), PR('eaveUp', '翼角起翘', 0, 0.5, 0.01, 0.24), PR('plinthH', '台基高 m', 0, 2, 0.05, 0.45), PB('steps', '踏跺', true), PB('dougong', '斗拱', true), PB('lattice', '槛窗', true), PB('rail','台基石栏杆',true), PB('innerCols','金柱（内槽）',true), PB('caihua','檐下彩画',true), PB('trim','脊兽·檐口椽瓦',true), PB('drip','瓦当滴水',true), PI('beasts','走兽数',0,9,1,3), PC('wall', '墙体色', '#e2d9c6'), PC('column', '柱色', '#7c3a2c'), PC('door', '门色', '#4d2a20'), PC('roof', '瓦色', '#3b4149'), PC('ridgeColor', '脊色', '#2f353c'), PC('plinth', '台基色', '#b3ada3')] },
    { type: 'pavilion', name: '攒尖亭', icon: 'pavilion', build: buildPavilion, params: [PR('r', '半径 m', 1.6, 8, 0.2, 3.2), PI('sides', '边数', 3, 10, 1, 6), PR('h', '柱高 m', 2, 7, 0.1, 3.2), PR('roofH', '屋顶高 m', 0.8, 4.5, 0.1, 1.9), PR('eaveUp', '翼角起翘', 0, 0.8, 0.02, 0.42), PB('railing', '坐凳栏杆', true), PB('dougong', '斗拱', false), PB('trim','垂脊·宝顶·檐口',true), PB('gehua','挂落',true), PI('beasts','垂脊走兽',0,5,1,3), PC('column', '柱色', '#8e3a2c'), PC('roof', '瓦色', '#41474f')] },
    { type: 'paifang', name: '牌楼牌坊', icon: 'paifang', build: buildPaifang, params: [PI('bays', '间数', 1, 5, 2, 3, '三间四柱：4 根主柱 + 2 根出头柱（开「出头柱小楼」即三间四柱五楼）'), PR('span', '总宽 m', 4, 26, 0.5, 14), PR('h', '柱高 m', 3, 11, 0.2, 6.2), PR('roofH', '楼顶高 m', 0.4, 2, 0.05, 0.95), PR('eaveUp', '翼角起翘', 0, 0.8, 0.02, 0.5), PS('roofKind', '明间楼顶', [{ v: 'xie', l: '歇山顶' }, { v: 'wu', l: '庑殿顶' }, { v: 'juan', l: '悬山顶' }], 'xie'), PS('style', '柱式', [{ v: 'lou', l: '楼式（柱不出头）' }, { v: 'chong', l: '冲天式（柱出头带蹲兽）' }], 'lou'), PB('floors', '每间起楼', true), PB('shoulder', '出头柱小楼', true), PB('dougong', '斗拱', true), PI('dgN', '平身科攒数', 0, 6, 1, 3), PB('caihua', '枋间彩画', true), PB('trim', '脊兽·檐口椽瓦', true), PB('plaques', '匾额花板', true), PT('text', '匾额题字', '德厚流光', '自右向左读，最多 6 字'), PC('column', '柱色', '#8e3a2c'), PC('stone', '夹杆石色', '#b7b1a6'), PC('roof', '瓦色', '#41474f'), PC('ridgeColor', '脊色', '#2f353c')] },
    { type: 'pagoda', name: '楼阁式佛塔', icon: 'pagoda', build: buildPagoda, params: [PI('levels', '层数', 3, 13, 2, 7), PR('r', '底层半径 m', 2, 9, 0.2, 4.4), PR('floorH', '层高 m', 2, 6, 0.1, 3.4), PR('taper', '收分', 0.01, 0.1, 0.005, 0.055), PI('sides', '平面边数', 4, 10, 1, 8), PR('spire', '塔刹高 m', 1, 8, 0.2, 3.4), PS('body', '塔身', [{ v: 'brick', l: '砖石' }, { v: 'wood', l: '木构' }], 'brick'), PB('door', '券门', true), PB('rail','塔基栏杆',true), PB('pingzuo','平座栏杆',true), PB('brackets','檐下斗拱',true), PB('trim','垂脊·瓦当',true), PC('column', '木色', '#7d4a2c'), PC('roof', '瓦色', '#3a4048')] },
    { type: 'gate', name: '城门楼', icon: 'gatecn', build: buildGate, params: [PR('w', '城墙宽 m', 10, 46, 1, 22), PR('wallH', '城墙高 m', 5, 16, 0.5, 9), PR('d', '城墙厚 m', 4, 16, 0.5, 8), PR('openW', '门洞宽 m', 2.5, 12, 0.25, 5.5), PR('floorH', '城楼层高 m', 2.6, 7, 0.2, 4), PR('roofH', '屋顶高 m', 1.2, 5, 0.1, 2.4), PB('towers', '角亭', true), PB('ramp','登城马道',true), PB('plaque','门额题字',true), PT('text','门额文字','永安门','自右向左读'), PB('trim','城楼脊兽·椽瓦',true), PC('wall', '砖色', '#9c978d'), PC('column', '柱色', '#8e3a2c'), PC('roof', '瓦色', '#3f454d')] },
    { type: 'citywall', name: '城墙敌台', icon: 'wallcn', build: buildCityWall, params: [PR('length', '长度 m', 8, 160, 2, 42), PR('height', '高度 m', 4, 14, 0.5, 8), PR('thick', '厚度 m', 3, 12, 0.5, 6), PB('tower', '敌台/城台', true), PR('towerW', '敌台宽 m', 4, 14, 0.5, 8), PB('paving','海墁墁砖',true), PB('stairs','登城步梯',true), PB('trim','敌台脊饰',true), PC('color', '砖色', '#a49d92'), PC('roof', '瓦色', '#3f454d')] },
    { type: 'corridor', name: '彩画回廊', icon: 'corridor', build: buildCorridor, params: [PR('length', '长度 m', 6, 90, 1, 24), PR('w', '廊宽 m', 1.8, 5, 0.1, 3), PR('h', '柱高 m', 2.2, 6, 0.1, 3.4), PR('spacing', '柱距 m', 2, 6, 0.1, 3.4), PB('railing', '美人靠', true), PB('gehua','挂落',true), PB('caihua','檐枋彩画',true), PB('hang','挂檐板',true), PB('trim','脊兽·檐口椽瓦',true), PB('drip','瓦当滴水',true), PC('column', '柱色', '#8e3a2c'), PC('roof', '瓦色', '#41474f')] },
    { type: 'archbridge', name: '石拱桥', icon: 'bridgecn', build: buildArchBridge, params: [PR('span', '跨径 m', 4, 30, 0.5, 12), PR('rise', '矢高 m', 1, 9, 0.2, 3.6), PR('w', '桥宽 m', 2, 12, 0.2, 4.6), PB('rail','栏板望柱',true), PB('trim','券脸石·螭首',true), PC('color', '石色', '#b0aa9f')] },
    { type: 'drumtower', name: '鼓楼钟楼', icon: 'drum', build: buildDrumTower, params: [PR('w', '面宽 m', 6, 22, 0.5, 12), PR('baseH', '城台高 m', 3, 12, 0.5, 6.5), PI('levels', '层数', 1, 3, 1, 2), PR('floorH', '层高 m', 2.6, 6, 0.1, 3.6), PB('rail','平座·台顶栏杆',true), PB('dougong','斗拱',true), PB('drum','更鼓',true), PB('plaque','匾额',true), PT('text','匾额题字','鐘鼓樓','自右向左读'), PB('trim','脊兽·彩画',true), PC('column', '柱色', '#8e3a2c'), PC('roof', '瓦色', '#41474f')] },
    { type: 'courtyard', name: '四合院单元', icon: 'yard', build: buildCourtyard, params: [PR('w', '院宽 m', 14, 60, 1, 26), PR('d', '院深 m', 14, 70, 1, 32), PR('wallH', '院墙高 m', 2, 6, 0.2, 3.4), PB('wings', '东西厢房', true), PB('gate', '街门牌楼', true), PB('screen','影壁',true), PB('corr','抄手游廊',true), PB('trim','墙脊瓦当',true), PT('gateText','街门题字','紫氣東來'), PC('wall', '墙色', '#e0d7c6'), PC('roof', '瓦色', '#454b53')] },
    { type: 'moongate', name: '月亮门院墙', icon: 'moongate', build: buildMoonGate, params: [PR('length', '墙长 m', 4, 30, 0.5, 10), PR('height', '墙高 m', 2, 6, 0.1, 3.4), PR('thick', '墙厚 m', 0.2, 1, 0.05, 0.36), PB('trim','墙帽脊饰',true), PC('wall', '墙色', '#eae3d6'), PC('roof', '瓦色', '#3f454d')] },
    { type: 'lanternpole', name: '宫灯杆', icon: 'lampcn', build: buildLanternPole, params: [PR('height', '杆高 m', 2.4, 8, 0.2, 4.2), PB('tassel','灯挂穗',true), PC('color', '灯色', '#ffb45e'), PR('glow', '亮度', 0, 4, 0.1, 1.6), PC('pole', '杆色', '#7c3a2c')] },
    { type: 'ding', name: '鼎 / 香炉', icon: 'ding', build: buildDing, params: [PR('r', '半径 m', 0.3, 2.2, 0.05, 0.8), PR('h', '高 m', 0.3, 1.8, 0.05, 0.7), PR('leg', '足高 m', 0.05, 1, 0.05, 0.24), PC('color', '铜色', '#6f5a34')] },
    { type: 'spiritway', name: '石像生神道', icon: 'stone', build: buildSpiritWay, params: [PI('pairs', '对数', 1, 12, 1, 5), PR('length', '总长 m', 10, 120, 2, 44), PR('gap', '左右间距 m', 2, 12, 0.5, 5), PB('pillars','石望柱',true), PB('stele','神道碑',true), PC('color', '石色', '#a9a49a')] },
  ],
};

export const GROUP_CLS = {
  cat: '美式经典', id: 'cls', items: [
    { type: 'capitol', name: '穹顶议会大楼', icon: 'dome', build: buildCapitol, params: [PR('w', '面宽 m', 20, 90, 1, 42), PR('h', '高度 m', 8, 28, 0.5, 15), PI('columns', '柱数', 4, 14, 1, 8), PC('stone', '石材色', '#e6e2d8')] },
    { type: 'mansion', name: '南方庄园宅邸', icon: 'mansion', build: buildMansion, params: [PR('w', '面宽 m', 10, 40, 0.5, 20), PR('d', '进深 m', 7, 26, 0.5, 13), PI('storeys', '层数', 1, 4, 1, 2), PR('h', '层高 m', 2.6, 4.6, 0.1, 3.6), PI('bays', '开间数', 3, 9, 2, 5), PI('portico', '门廊柱数', 2, 8, 1, 4), PC('wall', '墙色', '#efe7d6'), PC('roof', '屋顶色', '#4b5560')] },
    { type: 'brownstone', name: '联排褐石住宅', icon: 'row', build: buildBrownstone, params: [PR('w', '面宽 m', 5, 16, 0.5, 8), PR('d', '进深 m', 7, 20, 0.5, 12), PI('storeys', '层数', 2, 6, 1, 4), PR('h', '层高 m', 2.6, 4, 0.1, 3.2), PI('steps', '台阶数', 2, 14, 1, 8), PC('wall', '墙面色', '#8c5a48')] },
    { type: 'church', name: '白色尖顶教堂', icon: 'church', build: buildWhiteChurch, params: [PR('w', '面宽 m', 6, 20, 0.5, 11), PR('d', '进深 m', 10, 34, 0.5, 20), PR('h', '墙高 m', 4, 12, 0.2, 7), PR('roofH', '屋顶高 m', 2, 8, 0.2, 4), PR('steeple', '钟塔尖高 m', 3, 16, 0.5, 8), PC('wall', '墙色', '#f2f0e8'), PC('roof', '屋顶色', '#3f4a56')] },
    { type: 'lighthouse', name: '灯塔', icon: 'tower2', build: buildLighthouse, params: [PR('r', '底半径 m', 1.6, 5, 0.1, 2.8), PR('h', '塔高 m', 8, 46, 1, 22), PI('bands', '红白环数', 0, 8, 1, 4), PR('lamp', '灯头亮度', 0, 5, 0.1, 2.2), PC('wall', '塔身色', '#f0ece2'), PC('lampColor', '灯光色', '#ffe6a8')] },
    { type: 'watertower', name: '小镇水塔', icon: 'wtower', build: buildWaterTower, params: [PR('r', '水箱半径 m', 2, 8, 0.2, 4), PR('h', '水箱高 m', 2, 8, 0.2, 4), PR('legs', '支腿高 m', 4, 18, 0.5, 9), PC('tank', '箱体色', '#b8b2a6')] },
    { type: 'barn', name: '红谷仓', icon: 'barn', build: buildBarn, params: [PR('w', '宽 m', 6, 22, 0.5, 12), PR('d', '长 m', 8, 34, 0.5, 18), PR('h', '墙高 m', 3, 10, 0.2, 5.5), PC('wall', '墙色', '#9c3b2e'), PC('roof', '屋顶色', '#4a5158')] },
    { type: 'gazebo', name: '花园凉亭', icon: 'pavilion', build: buildGazebo, params: [PR('r', '半径 m', 1.8, 6, 0.2, 3.2), PR('h', '柱高 m', 2.2, 5, 0.1, 3), PC('roof', '顶色', '#3f4a56')] },
    { type: 'clocktower', name: '校园钟楼', icon: 'clock', build: buildClockTower, params: [PR('w', '边长 m', 3, 10, 0.2, 5.5), PR('h', '高度 m', 10, 42, 1, 20), PR('spire', '尖顶高 m', 2, 12, 0.5, 5), PC('wall', '砖石色', '#c9bda9'), PC('roof', '顶色', '#37505c')] },
  ],
};

export const GROUP_IN = {
  cat: '室内', id: 'in', items: [
    { type: 'room', name: '房间盒', icon: 'room', build: buildRoom, params: [PR('w', '宽 m', 3, 30, 0.5, 8), PR('d', '深 m', 3, 30, 0.5, 7), PR('h', '层高 m', 2.4, 8, 0.1, 3.1), PB('back', '后墙', true), PB('left', '左墙', true), PB('right', '右墙', true), PB('front', '前墙', false), PB('ceiling', '天花', true), PB('cornice', '石膏线', true), PR('window', '窗宽 m', 0, 12, 0.2, 3), PR('sill', '窗台高 m', 0.2, 2, 0.05, 0.9), PR('doorW', '门洞宽 m', 0, 4, 0.1, 1.1), PR('light', '窗光强度', 0, 4, 0.1, 1.6), PC('wall', '墙色', '#e8e6e0'), PC('floor', '地板色', '#8a6b4d'), PR('gloss', '地板光泽', 0, 1, 0.05, 0.35), PB('glow', '窗户发光', true)] },
    { type: 'wall', name: '隔断墙', icon: 'wallcn', build: buildWallSeg, params: [PR('length', '长度 m', 1, 24, 0.5, 5), PR('height', '高度 m', 1.2, 6, 0.1, 2.8), PR('thick', '厚度 m', 0.08, 0.5, 0.02, 0.16), PR('openW', '门洞宽 m', 0, 6, 0.1, 0), PR('openH', '门洞高 m', 1.2, 4, 0.05, 2.1), PB('trim', '踢脚线', true), PC('color', '墙色', '#e5e2dc')] },
    { type: 'sofa', name: '沙发', icon: 'sofa', build: buildSofa, params: [PR('w', '宽 m', 1.2, 4.2, 0.1, 2.2), PR('d', '深 m', 0.7, 1.4, 0.05, 0.9), PC('color', '布色', '#5b6b7c')] },
    { type: 'chair', name: '单椅', icon: 'chair', build: buildChair, params: [PC('color', '木色', '#8a6240')] },
    { type: 'table', name: '桌几', icon: 'table', build: buildTable, params: [PS('shape', '形状', [{ v: 'rect', l: '长方' }, { v: 'round', l: '圆' }], 'rect'), PR('w', '宽/直径 m', 0.5, 4, 0.1, 1.6), PR('d', '深 m', 0.4, 2.4, 0.1, 0.9), PR('h', '高 m', 0.3, 1.1, 0.02, 0.74), PI('legs', '腿数', 1, 4, 1, 4), PR('gloss', '台面光泽', 0, 1, 0.05, 0.4), PC('top', '台面色', '#c9b79a'), PC('leg', '腿色', '#4a4f56')] },
    { type: 'bed', name: '床', icon: 'bed', build: buildBed, params: [PR('w', '宽 m', 0.9, 2.2, 0.05, 1.5), PR('d', '长 m', 1.8, 2.4, 0.05, 2), PB('nightstand', '床头柜', true), PC('frame', '床架色', '#5c4632'), PC('quilt', '被子色', '#556b7d')] },
    { type: 'wardrobe', name: '衣柜', icon: 'wardrobe', build: buildWardrobe, params: [PR('w', '宽 m', 0.8, 4, 0.1, 2), PR('h', '高 m', 1.6, 3.2, 0.05, 2.2), PR('d', '深 m', 0.4, 0.9, 0.02, 0.6), PI('doors', '门数', 2, 5, 1, 3), PC('color', '柜色', '#8a6240')] },
    { type: 'shelf', name: '书架', icon: 'shelf', build: buildShelf, params: [PR('w', '宽 m', 0.6, 5, 0.1, 2), PR('h', '高 m', 0.9, 3, 0.1, 1.9), PR('d', '深 m', 0.18, 0.6, 0.02, 0.3), PI('shelves', '层数', 2, 9, 1, 5), PI('seed', '藏书种子', 1, 99, 1, 4), PC('color', '木色', '#7a5c3e'), PC('bookColor', '书色', '#7d5546')] },
    { type: 'kitchen', name: '厨房台面', icon: 'kitchen', build: buildKitchen, params: [PR('length', '长度 m', 2, 12, 0.5, 5), PR('d', '深 m', 0.5, 1.2, 0.05, 0.64), PB('island', '中岛', false), PC('cabinet', '柜体色', '#dcdfe4'), PC('top', '台面色', '#3b4249')] },
    { type: 'lamp', name: '落地灯', icon: 'lampcn', build: buildLampStand, params: [PR('h', '高 m', 1.2, 2.4, 0.05, 1.7), PC('color', '灯光色', '#ffd9a8'), PR('glow', '亮度', 0, 6, 0.1, 2.4)] },
    { type: 'rug', name: '地毯', icon: 'rug', build: buildRug, params: [PR('w', '宽 m', 1, 8, 0.2, 3), PR('d', '长 m', 1, 8, 0.2, 2), PC('color', '主色', '#7d5546'), PC('border', '边色', '#d9cbb6')] },
    { type: 'stairs', name: '室内楼梯', icon: 'stairs', build: buildStairsIn, params: [PR('height', '总高 m', 1, 7, 0.1, 3.1), PR('rise', '踏步高 m', 0.12, 0.24, 0.01, 0.17), PR('run', '踏步深 m', 0.2, 0.4, 0.01, 0.28), PR('width', '梯宽 m', 0.7, 2.4, 0.1, 1.2), PC('color', '木色', '#8a6240')] },
    { type: 'plant', name: '盆栽', icon: 'tree', build: buildPlantPot, params: [PR('r', '盆半径 m', 0.14, 0.7, 0.02, 0.3), PR('h', '盆高 m', 0.14, 0.8, 0.02, 0.34), PI('seed', '种子', 1, 99, 1, 5), PC('pot', '盆色', '#b8613f'), PC('leaf', '叶色', '#3f7a4a')] },
    { type: 'tv', name: '电视墙', icon: 'screen', build: buildTvWall, params: [PR('w', '板宽 m', 1.6, 7, 0.2, 3.6), PR('h', '板高 m', 1.2, 4, 0.1, 2.4), PR('bright', '屏幕亮度', 0, 4, 0.1, 1.3), PC('panel', '背景板色', '#3b4249'), PC('screen', '屏幕色', '#7fe0ff')] },
    { type: 'curtain', name: '窗帘', icon: 'curtain', build: buildCurtain, params: [PR('w', '宽 m', 1, 8, 0.2, 3), PR('h', '高 m', 1.2, 4.5, 0.1, 2.4), PC('color', '布色', '#c9bda9')] },
  ],
};

export const GROUPS = [GROUP_CN, GROUP_CLS, GROUP_IN];

