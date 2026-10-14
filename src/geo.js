// ---------------------------------------------------------------------------
// 程序化建模小工具：材质、基础体、曲线屋顶（中式举折）、排布器
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, makeRng } from './util.js';
import { Q, seg as qseg, mul, planeSegCap, bevelGeo, applyDetail } from './detail.js';
/** 径向分段数随精度档缩放（本文件与 arch 系共用） */
export const seg = (n) => qseg(n);

// userData.detail 决定「标准/高细节」下套用哪一套程序化表面（法线 + 粗糙度，见 detail.js）；
// 未标注的材质（发光、水面）只吃环境反射，不加贴图。
const mk = (kind, o) => {
  const m = new THREE.MeshStandardMaterial(o);
  if (kind) m.userData.detail = kind;
  return m;
};
export const M = {
  concrete: (c = 0x9aa0a8, r = 0.92) => mk('concrete', { color: c, roughness: r, metalness: 0.02 }),
  metal: (c = 0x8d949c, r = 0.35, m = 0.9) => mk('metal', { color: c, roughness: r, metalness: m, envMapIntensity: 1.4 }),
  dark: (c = 0x2c3138, r = 0.8) => mk('paint', { color: c, roughness: r, metalness: 0.1 }),
  paint: (c = 0xcccccc, r = 0.6) => mk('paint', { color: c, roughness: r, metalness: 0.05 }),
  wood: (c = 0x8a6240, r = 0.75) => mk('wood', { color: c, roughness: r, metalness: 0.02 }),
  stone: (c = 0x9c978d, r = 0.95) => mk('stone', { color: c, roughness: r, metalness: 0.0 }),
  glassy: (c = 0x2f4a5c, r = 0.12, m = 0.5, op = 0.55) => mk('glass', { color: c, roughness: r, metalness: m, transparent: op < 1, opacity: op, envMapIntensity: 1.7 }),
  leaf: (c = 0x4c7a3f, r = 0.85) => mk(null, { color: c, roughness: r, metalness: 0, flatShading: true }),
  glow: (c = 0xffb066, i = 1.4) => mk(null, { color: 0x1a1410, roughness: 0.5, emissive: new THREE.Color(c), emissiveIntensity: i }),
  emissive: (c = 0x7fe0ff, i = 1.2) => mk(null, { color: 0x0e1418, roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(c), emissiveIntensity: i }),
  water: (c = 0x2b5f78) => mk(null, { color: c, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.82, emissive: new THREE.Color(0x0d2733), emissiveIntensity: 0, depthWrite: false, envMapIntensity: 1.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}),
};

/** 屋面材质：在 paint 的基础上把「一垄垄的瓦」浮雕挂上（kind=tile）；非瓦面传 tile=false */
export const roofSurf = (hex, rough = 0.64, tile = true) => {
  const m = M.paint(hex, rough);
  m.userData.detail = tile ? 'tile' : 'paint';
  return m;
};

export function shade(o, cast = true, recv = true) {
  o.traverse?.((m) => { if (m.isMesh || m.isInstancedMesh) { m.castShadow = cast; m.receiveShadow = recv; } });
  applyDetail(o);              // 顺手贴上「程序化微浮雕 + 米制平铺 UV」（同材质共享一张贴图）
  return o;
}
/* ---- 构件几何缓存：一次 build 内同规格小件共用一份几何 ---------------------
   中式古建一件构件要生成上千个方盒 / 圆柱，光 new 几何就占掉大半构建时间；
   共用之后 mergeSimilar 还能顺手把它们合成实例（同几何 + 同材质 → 一次绘制）。
   缓存在 buildAsset 里开合，跨物体不共用（避免一处 dispose 让另一处变空壳）。 */
let _gc = null;
export function geoCacheBegin() { _gc = new Map(); }
export function geoCacheEnd() { _gc = null; }
const gkey = (a, b, c, d, e) => a + '|' + Math.round(b * 1000) + '|' + Math.round(c * 1000) + '|' + Math.round(d * 1000) + '|' + e;
function cachedGeo(key, make) {
  if (!_gc) return make();
  let g = _gc.get(key);
  if (!g) { if (_gc.size > 4000) return make(); _gc.set(key, g = make()); }
  return g;
}

// box(..., bev)：bev>0 → 45° 倒角边（棱线不再是一条硬边，高光会“走”上去）；省内存档自动退回方盒
// 小于 16cm 的构件倒角看不出差别，直接方盒：省掉每次 ExtrudeGeometry 的代价
export const box = (w, h, d, mat, x = 0, y = 0, z = 0, bev = 0) => {
  const W = Math.max(0.01, w), H = Math.max(0.01, h), D = Math.max(0.01, d);
  const bevOk = bev > 0 && Q.chamfer > 0 && Math.min(W, H, D) > 0.16;
  const geo = cachedGeo(bevOk ? gkey('b', W, H, D, Math.round(bev * 1000) + '/' + Q.level) : gkey('B', W, H, D, Q.level),
    () => (bevOk ? bevelGeo(W, H, D, bev) : new THREE.BoxGeometry(W, H, D)));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
export const cyl = (rt, rb, h, mat, seg = 24, x = 0, y = 0, z = 0) => {
  const RT = Math.max(0.001, rt), RB = Math.max(0.001, rb), HH = Math.max(0.01, h), SG = qseg(seg);
  const geo = cachedGeo(gkey('c', RT, RB, HH, SG + '/' + Math.round(RT * 1000)), () => new THREE.CylinderGeometry(RT, RB, HH, SG));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
export const sph = (r, mat, seg = 20, x = 0, y = 0, z = 0) => {
  const R = Math.max(0.01, r), s = qseg(seg);
  const geo = cachedGeo(gkey('s', R, s, Math.max(5, s - 4), 0), () => new THREE.SphereGeometry(R, s, Math.max(5, s - 4)));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
// 水平贴花（路面 / 草地 / 石板…）默认抬高 1.4cm：与地面、地形严格共面会 z-fighting（表现为颜色闪烁）
export const planeXZ = (w, d, mat, x = 0, y = 0.014, z = 0) => {
  const div = Math.max(1.5, 3.2 / Q.k);            // 细分：大贴面要能贴合地形起伏，档位越高越密
  const sg = (v) => Math.max(1, Math.min(planeSegCap(), Math.round(v / div)));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.01, w), Math.max(0.01, d), sg(Math.max(0.01, w)), sg(Math.max(0.01, d))), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
};
export const cone = (r, h, mat, seg = 8, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(Math.max(0.01, r), Math.max(0.01, h), qseg(seg)), mat);
  m.position.set(x, y, z);
  return m;
};
/** 沿 X 轴方向排 N 个 */
export function row(fn, n, span, axis = 'x') {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const m = fn(i, t);
    if (!m) continue;
    if (axis === 'x') m.position.x = (t - 0.5) * span;
    else m.position.z = (t - 0.5) * span;
    g.add(m);
  }
  return g;
}
/** 沿椭圆/圆排布 */
export function ring(fn, n, rx, rz = rx, start = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    const m = fn(i, a);
    if (!m) continue;
    m.position.set(Math.cos(a) * rx, m.position.y || 0, Math.sin(a) * rz);
    m.rotation.y = -a + Math.PI / 2;
    g.add(m);
  }
  return g;
}
/** 随机散布（确定性 seed） */
export function scatter(fn, n, w, d, seed = 3, minR = 0) {
  const g = new THREE.Group();
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0, ok = false;
    for (let a = 0; a < 8 && !ok; a++) {
      x = (rng() - 0.5) * w; z = (rng() - 0.5) * d;
      ok = minR <= 0 || Math.hypot(x, z) > minR;
    }
    const m = fn(i, x, z, rng);
    if (!m) continue;
    m.position.set(x, m.position.y || 0, z);
    m.rotation.y = rng() * Math.PI * 2;
    g.add(m);
  }
  return g;
}

/**
 * 曲面屋顶：由「到脊线的距离」生成举折曲线（近脊陡、近檐缓 + 檐角起翘）
 * kind: 'wu'庑殿(四阿) | 'xie'歇山 | 'juan'悬山/硬山(双坡) | 'jin'攒尖(亭)
 * 返回一个 Mesh（已按 footprint 尺寸生成网格）
 */
/** 攒尖（多边形）屋面的正确搭法：网格直接沿正多边形铺，檐口 = 边中点在内切半径 a 上、角端在 a/cos(π/s)。
 *  用方网格再按 cos 归一化不行：方网的角到不了多边形角端，翘起反而长错方向，垂脊/脊兽会悬在屋面外面。 */
function jinRoofGeo(sn, a, h, eaveUp, y0, seg, hole = 0) {
  // 关键：仍然用 PlaneGeometry（屋面在别处一律按「变形过的面片」被识别：材质分类、bake 档案、构件统计），
  // 只是把网格重排成「同心多边形环 × 檐口周长」，这样角端正好落在 a/cos(π/s) 上。
  const per = Math.max(4, Math.round(seg / sn) + 1);
  const rings = Math.max(5, Math.round(seg / 2.2));
  const rc = a / Math.cos(Math.PI / sn);
  const corner = [];
  for (let i = 0; i < sn; i++) { const th = Math.PI / sn + i * Math.PI * 2 / sn; corner.push([Math.cos(th) * rc, Math.sin(th) * rc]); }
  const geo = new THREE.PlaneGeometry(rc * 2, rc * 2, sn * per, rings);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const cols = sn * per + 1;
  for (let r = 0; r <= rings; r++) {
    const k = hole + (1 - hole) * (r / rings), t = 1 - k;   // hole>0：环状檐（内圈收进，供塔身穿升）
    for (let c = 0; c < cols; c++) {
      const j = c % (sn * per);
      const side = Math.floor(j / per), f = (j % per) / per;
      const c0 = corner[side], c1 = corner[(side + 1) % sn];
      const x = (c0[0] + (c1[0] - c0[0]) * f) * k, z = (c0[1] + (c1[1] - c0[1]) * f) * k;
      const cwr = Math.pow(Math.abs(2 * f - 1), 0.55);                     // 角端 1、边中点 0 → 起翘只抬翼角（旧版反了，抬成边中）」
      // 举折基线：檐口(t=0)落 y0、脊(t=1)到 0.76h —— 檐口不再整体悬空 0.24h
      pos.setXYZ(r * cols + c, x, jinRoofY(t, { h, eaveUp, y0: 0 }) - 0 + (eaveUp * h * Math.pow(1 - t, 3.2) * 0.73) * (cwr - 1) + y0, z);   // = jinRoofY(t)*cwr 拆分：边中不翘、角端全翘
      uv.setXY(r * cols + c, c / (sn * per), k);                             // u 沿檐口一圈、v 由心到檐：瓦垄自然放射到宝顶
    }
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** 攒尖锥面沿角线（翼角线）的高度场：jinRoofGeo 顶点与垂脊采样共用 */
export function jinRoofY(tRing, o = {}) {
  const { h, eaveUp = 0, y0 = 0 } = o;
  const t = clamp(tRing, 0, 1);
  return y0 + h * (0.24 * (1 - t * t) + 0.76 * Math.pow(t, 1.9) - 0.24 * Math.pow(1 - t, 1.6))
    + eaveUp * h * Math.pow(1 - t, 3.2) * 0.73;
}

/** 曲面屋顶（庑殿 / 歇山 / 卷棚 / 攒尖）：把一张 PlaneGeometry 按举折 + 起翘抬高。
 *  `sides >= 3` 的攒尖走 jinRoofGeo（同心多边形环），檐口正多边形、角端对正檐柱。 */
export function curvedRoof({ w = 12, d = 9, h = 3.2, kind = 'wu', ridge = 0.42, seg = 26, mat, eaveUp = 0.16, brim = 0.5, y0 = 0, sides = 0, hole = 0, win = 0, din = 0 } = {}) {
  seg = Math.max(8, Math.round(mul(seg)));   // 举折曲线的密度随精度档走
  const W = Math.max(1, w + brim * 2), D = Math.max(1, d + brim * 2);
  const nx = Math.max(6, Math.round(seg * (W / Math.max(W, D)))), nz = Math.max(6, seg);
  const sn = Math.max(0, Math.round(sides));
  if (kind === 'jin' && sn >= 3) {
    const a = Math.min(W, D) / 2;
    const pm = new THREE.Mesh(jinRoofGeo(sn, a, h, eaveUp, y0, seg, hole), mat || M.paint(0x3a4048, 0.85));
    pm.material.side = THREE.DoubleSide;
    pm.castShadow = true; pm.receiveShadow = true;
    pm.userData.roofA = a; pm.userData.roofSides = sn;
    return pm;
  }
  const xr = (Math.max(0.6, w * 0.5 * ridge));
  const hy = (x, z) => cnRoofY(x, z, { W, D, h, kind, xr, eaveUp, y0 });
  const mkMesh = (geo, cx, cz) => {
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, hy(pos.getX(i) + cx, pos.getZ(i) + cz));
    geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, mat || M.paint(0x3a4048, 0.85));
    mm.material.side = THREE.DoubleSide;
    mm.castShadow = true; mm.receiveShadow = true;
    mm.position.set(cx, 0, cz);
    return mm;
  };
  // 环状屋面：中央按 win×din 开洞（供平座平台截断屋面，洞缘藏进平台出挑内）
  if (win > 0.5 && din > 0.5 && win < W - 1 && din < D - 1) {
    const grp = new THREE.Group();
    const dz = (D - din) / 2, dx = (W - win) / 2;
    const nzs = Math.max(2, Math.round(nz * dz / D)), nxs = Math.max(2, Math.round(nx * dx / W));
    grp.add(mkMesh(new THREE.PlaneGeometry(W, dz, nx, nzs), 0, din / 2 + dz / 2));
    grp.add(mkMesh(new THREE.PlaneGeometry(W, dz, nx, nzs), 0, -(din / 2 + dz / 2)));
    grp.add(mkMesh(new THREE.PlaneGeometry(dx, din, nxs, nz), -(win / 2 + dx / 2), 0));
    grp.add(mkMesh(new THREE.PlaneGeometry(dx, din, nxs, nz), win / 2 + dx / 2, 0));
    return grp;
  }
  const geo = new THREE.PlaneGeometry(W, D, nx, nz);
  const m = mkMesh(geo, 0, 0);
  // 瓦垄感：沿屋面加几条窄盒（廉价但轮廓清晰）
  return m;
}

/** 中式屋面高度场（举折 + 翼角起翘）：curvedRoof 顶点与垂脊/脊兽共用同一公式，
 *  保证垂脊贴在屋面上（旧版垂脊是直梁，屋面凹曲 → 脊身与走兽整条悬空成「碎阶」） */
export function cnRoofY(x, z, o) {
  const { W, D, h, kind = 'wu', xr = 0.6, eaveUp = 0.16, y0 = 0 } = o;
  // 角权重：四角 1、檐边中点 0 → 起翘只抬翼角，檐口中线稳稳压在 y0 上
  const cwx = Math.pow(clamp((Math.abs(x) / (W / 2) - 0.5) / 0.5, 0, 1), 0.55);
  const cwz = Math.pow(clamp((Math.abs(z) / (D / 2) - 0.5) / 0.5, 0, 1), 0.55);
  let u;
  const cwr = cwx * cwz;
  if (kind === 'jin') {
    u = clamp(Math.max(Math.abs(x) / (W / 2), Math.abs(z) / (D / 2)), 0, 1);
  } else if (kind === 'juan') {
    u = clamp(Math.abs(z) / (D / 2), 0, 1);
  } else {
    const dz = Math.abs(z) / (D / 2);
    const dx = Math.max(0, Math.abs(x) - xr) / Math.max(0.5, W / 2 - xr);
    // 边界处 u 必须到 1（t=0），檐口才能落在 y0：旧版 0.92/0.86 系数让檐口悬了 ~0.08h
    u = kind === 'xie' ? clamp(Math.max(dz, dx * 0.92), 0, 1) : clamp(Math.hypot(dz, dx * 0.86), 0, 1);
  }
  const t = 1 - u;                                   // 1 = 脊, 0 = 檐
  let yy = h * (0.24 * (1 - t * t) + 0.76 * Math.pow(t, 1.9) - 0.24 * Math.pow(1 - t, 1.6));
  yy += eaveUp * h * Math.pow(1 - t, 3.2) * (kind === 'juan' ? 0.35 : 1) * (kind === 'juan' ? cwx : cwr);   // 起翘集中在翼角
  if (kind === 'xie' && dzOf(z, D) > 0.66) yy *= 0.92;
  return yy + y0;
}

function dzOf(z, D) { return Math.abs(z) / (D / 2); }

/** 正脊 + 两端吻兽，装在屋顶上方 */
export function ridgeOrnament(w, kind, mat, y = 0, len = null) {
  const g = new THREE.Group();
  const L = len ?? Math.max(2, w * 0.45);
  if (kind === 'jin') {
    g.add(sph(0.28, mat, 10, 0, y + 0.4, 0));
    g.add(cyl(0.06, 0.12, 0.5, mat, 8, 0, y + 0.7, 0));
    return g;
  }
  g.add(box(L, 0.26, 0.5, mat, 0, y + 0.06, 0));
  g.add(box(0.34, 0.62, 0.62, mat, -L / 2, y + 0.24, 0));
  g.add(box(0.34, 0.62, 0.62, mat, L / 2, y + 0.24, 0));
  return g;
}
/** 斗拱：栌斗 + 华拱/泥道拱 + 横拱出跳 + 散斗 + 下昂（斜出）——远看是「一朵花」，近看有出跳 */
export function dougong(mat, s = 1, o = {}) {
  const g = new THREE.Group();
  const gold = o.gold || mat;
  g.add(box(0.62 * s, 0.16 * s, 0.62 * s, mat, 0, 0.08 * s, 0));                       // 栌斗
  g.add(box(1.02 * s, 0.11 * s, 0.28 * s, mat, 0, 0.22 * s, 0));                        // 泥道拱
  g.add(box(0.28 * s, 0.11 * s, 1.02 * s, mat, 0, 0.22 * s, 0));                        // 华拱（出跳）
  g.add(box(1.36 * s, 0.1 * s, 0.24 * s, mat, 0, 0.36 * s, 0));                         // 横拱二跳
  g.add(box(0.24 * s, 0.1 * s, 1.36 * s, mat, 0, 0.36 * s, 0));
  g.add(box(1.66 * s, 0.09 * s, 0.22 * s, mat, 0, 0.49 * s, 0));                        // 横拱三跳
  const tips = [];
  for (const sx of [1, -1]) { tips.push({ p: [sx * 0.68 * s, 0.44 * s, 0], s: [0.14, 0.1, 0.16] }); tips.push({ p: [sx * 0.83 * s, 0.57 * s, 0], s: [0.14, 0.1, 0.15] }); }
  for (const sz of [1, -1]) { tips.push({ p: [0, 0.44 * s, sz * 0.68 * s], s: [0.16, 0.1, 0.14] }); tips.push({ p: [0, 0.57 * s, sz * 0.83 * s], s: [0.15, 0.1, 0.14] }); }
  const t = batch(new THREE.BoxGeometry(1, 1, 1), gold, tips);                          // 散斗
  if (t) g.add(t);
  for (const sz of [1, -1]) {                                                            // 下昂：斜向下挑出
    const a = box(0.2 * s, 0.09 * s, 1.0 * s, mat, 0, 0.3 * s, sz * 0.5 * s);
    a.rotation.x = sz * 0.42;
    g.add(a);
    g.add(box(0.18 * s, 0.16 * s, 0.12 * s, mat, 0, 0.34 * s, sz * 0.96 * s));
  }
  g.userData.marker = '斗拱';
  return g;
}

// ───────────────────────── 中式大木作 / 石作构件（牌楼·殿宇·塔·廊共用） ─────────────────────────
/** 一组同规格小件 → 单个 InstancedMesh（椽子 / 瓦当 / 走兽 / 栏板：一次 draw call） */
export function batch(geo, mat, items) {
  const n = items ? items.length : 0;
  if (!n) return null;
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const p = it.p || [0, 0, 0];
    const r = it.r || [0, 0, 0];
    const s = it.s || [1, 1, 1];
    v.set(p[0], p[1], p[2]);
    e.set(r[0] || 0, r[1] || 0, r[2] || 0);
    q.setFromEuler(e);
    sc.set(Math.abs(s[0]) || 1, Math.abs(s[1]) || 1, Math.abs(s[2]) || 1);
    m4.compose(v, q, sc);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true;
  try { im.computeBoundingSphere(); } catch (err) { /* 旧版 three：不影响显示 */ }
  return im;
}

/** 把「默认沿 +Y 的圆柱」摆正：轴指向 (dx,dy,dz)，且柱体局部 +X 朝下。
 *  这样滴水（三棱柱，第一个顶点在局部 +X）不管朝哪个方向，尖端一律朝下。
 *  旧版直接用欧拉角 [π/2, -ac, π/4] 硬凑：攒尖 / 塔的八个面里有一半以上瓦当是歪的（有的甚至翘起 45°）。 */
/** 小球段数：望柱头 / 走兽脑袋这类 10cm 以下的小件，按精度档给固定段数，
 *  绝不跟着 seg() 放大（seg(10)×seg(8) 在标准档是 15×12 = 330 面/个，一个球比一整扇门还贵）。 */
const ballSeg = () => (Q.level === 'lite' ? [6, 4] : (Q.level === 'fine' ? [12, 9] : [9, 6]));
const Y_UP = new THREE.Vector3(0, 1, 0), Y_DN = new THREE.Vector3(0, -1, 0);
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _ab = new THREE.Matrix4(), _ae = new THREE.Euler();
function aimCyl(dx, dy, dz) {
  _ay.set(dx, dy, dz).normalize();
  if (Math.abs(_ay.dot(Y_UP)) > 0.999) return [0, 0, 0];
  _ax.copy(Y_DN);
  _az.crossVectors(_ax, _ay).normalize();
  _ax.crossVectors(_ay, _az).normalize();
  _ab.makeBasis(_ax, _ay, _az);
  _ae.setFromRotationMatrix(_ab, 'XYZ');
  return [_ae.x, _ae.y, _ae.z];
}

/** 檐口木作：檐椽 + 瓦当（圆）+ 滴水（尖）+ 檐檩，绕屋面底边一圈。
 *  外沿尺寸约定与 curvedRoof 一致：W = w + 2·brim，D = d + 2·brim；檐口随翼角起翘抬升。 */
export function eaveCornice(o = {}) {
  const w = Math.max(0.5, o.w ?? 8), d = Math.max(0.5, o.d ?? 6);
  const brim = o.brim ?? 0.5, eaveUp = o.eaveUp ?? 0.16, rh = o.h ?? 1, y = o.y ?? 0;
  const wood = o.mat || M.wood(0x7d4a2c, 0.78);
  const tile = o.tileMat || M.paint(0x3d434b, 0.72);
  const W = w + brim * 2, D = d + brim * 2;
  const step = 0.46 / clamp(mul(1), 0.55, 1.8);          // 排布密度随精度档
  const nX = clamp(Math.round(W / step), 3, 30), nZ = clamp(Math.round(D / step), 3, 24);
  const raft = [], caps = [], drops = [], bands = [];
  const lift = (u) => eaveUp * rh * Math.pow(clamp((u - 0.5) / 0.5, 0, 1), 0.55);   // 与屋面 cwx/cwz 同权重（旧版 u² 让檐口中段瓦当凸出檐口 Above）
  // 瓦作小件的段数：是檐口上一圈 8cm 的小件，段数按精度档给死了，不能跟着 seg() 放大
  // （旧版瓦当 15 段 = 180 面、滴水 12 段 = 144 面，一座七层塔 1182 件就是 12.8 万面）；
  // 屋面本体是单张曲面 + 程序化瓦垄贴图，瓦的「一垄垄」靠贴图，不靠堆几何。
  const capSeg = Q.level === 'lite' ? 5 : (Q.level === 'fine' ? 12 : 8);
  const capGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.07, capSeg);
  const dropGeo = new THREE.CylinderGeometry(0.075, 0.05, 0.06, 3, 1, false, Math.PI / 2);   // 3 段 = 三角板，尖端在局部 +X
  const dr = o.drop || {};                                                                  // 修补单：逐批沉量 {raft, caps, drops, bands}
  const sn = Math.max(0, Math.round(o.sides || 0));
  if (sn >= 3) {
    // 正多边形檐口：沿每条边排布，角部抬得最高（亭 / 塔用；方檐口的 max() 会把菱角卡到两柱之间）
    const Rb = Math.min(W, D) / 2;
    const sideLen = 2 * Rb * Math.tan(Math.PI / sn);
    const nE = clamp(Math.round(sideLen / step), 2, 20);
    for (let k = 0; k < sn; k++) {
      const ac = (k / sn) * Math.PI * 2;
      const ux = Math.cos(ac), uz = Math.sin(ac), px = -uz, pz = ux;
      for (let i = 0; i <= nE; i++) {
        const t = i / nE - 0.5;
        const off = sideLen * t;
        const x = ux * Rb + px * off, z = uz * Rb + pz * off;
        // 边中点抬升 0（檐口中线压 y0），角部起翘 —— 旧版整体抬 0.28·eaveUp·h 悬在屋面上
        const yy = y + eaveUp * rh * 0.73 * Math.pow(Math.min(1, Math.abs(t) * 2), 0.55);   // 与 jinRoofGeo 角线同权重
        raft.push({ p: [x, yy - 0.03, z], r: [0, -ac + Math.PI / 2, 0], s: [sideLen / nE * 0.95, 0.085, 0.5] });   // 椽身沿檐边切向（旧版 -ac 指向径向，亭/塔檐口炸成辐条）
        caps.push({ p: [x + ux * 0.02, yy + 0.02, z + uz * 0.02], r: aimCyl(ux, 0, uz) });
        drops.push({ p: [x + ux * 0.06, yy - 0.05, z + uz * 0.06], r: aimCyl(ux, 0, uz), s: [1, 1, 0.6] });
      }
    }
    for (let k = 0; k < sn; k++) {                                  // 檐檩分段环梁：沿多边形檐边、跟 0.73 角线同曲线（旧恒 y 方环吊在翼角下）
      const ac = (k / sn) * Math.PI * 2;
      const ux = Math.cos(ac), uz = Math.sin(ac), tx = -uz, tz = ux;
      const yaw = Math.atan2(-tz, tx);
      const nB = clamp(Math.round(sideLen / 1.0), 3, 16);
      const py = (t) => y + eaveUp * rh * 0.73 * Math.pow(Math.min(1, Math.abs(t) * 2), 0.55);
      for (let i = 0; i < nB; i++) {
        const t0 = i / nB - 0.5, t1 = (i + 1) / nB - 0.5, tm = (t0 + t1) / 2;
        const dy = py(t1) - py(t0), off = sideLen * tm;
        bands.push({ p: [ux * (Rb - 0.34) + tx * off, py(tm) - 0.06, uz * (Rb - 0.34) + tz * off], r: [0, yaw, Math.atan2(dy, sideLen / nB)], s: [sideLen / nB * 1.08, 0.16, 0.2] });
      }
    }
  } else {
  for (const sz of [1, -1]) {
    for (let i = 0; i <= nX; i++) {
      const x = (i / nX - 0.5) * W;
      const yy = y + lift(clamp(Math.abs(x) / (W / 2), 0, 1));
      raft.push({ p: [x, yy - 0.03, sz * (D / 2 - 0.16)], r: [sz * 0.14, 0, 0], s: [0.085, 0.085, 0.5] });
      caps.push({ p: [x, yy + 0.02, sz * (D / 2 + 0.02)], r: aimCyl(0, 0, sz) });
      drops.push({ p: [x, yy - 0.05, sz * (D / 2 + 0.06)], r: aimCyl(0, 0, sz), s: [1, 1, 0.6] });
    }
  }
  for (const sx of [1, -1]) {
    for (let i = 0; i <= nZ; i++) {
      const z = (i / nZ - 0.5) * D;
      const yy = y + lift(clamp(Math.abs(z) / (D / 2), 0, 1));
      raft.push({ p: [sx * (W / 2 - 0.16), yy - 0.03, z], r: [0, 0, sx * 0.14], s: [0.5, 0.085, 0.085] });
      caps.push({ p: [sx * (W / 2 + 0.02), yy + 0.02, z], r: aimCyl(sx, 0, 0) });
      drops.push({ p: [sx * (W / 2 + 0.06), yy - 0.05, z], r: aimCyl(sx, 0, 0), s: [1, 1, 0.6] });
    }
  }
  // 矩形檐口的檐檩分段环梁：跟 lift() 同曲线，翼角随檐口抬起（旧恒 y 直环吊在翼角下 = 悬浮矩形横梁）
  const nBx = clamp(Math.round(W / 1.0), 4, 20), nBz = clamp(Math.round(D / 1.0), 4, 20);
  for (const sz of [1, -1]) for (let i = 0; i < nBx; i++) {
    const t0 = i / nBx - 0.5, t1 = (i + 1) / nBx - 0.5, tm = (t0 + t1) / 2;
    const dy = lift(Math.abs(t1) * 2) - lift(Math.abs(t0) * 2);
    bands.push({ p: [tm * W, y + lift(Math.abs(tm) * 2) - 0.06, sz * (D / 2 - 0.34)], r: [0, 0, Math.atan2(dy, W / nBx)], s: [W / nBx * 1.08, 0.16, 0.2] });
  }
  for (const sx of [1, -1]) for (let i = 0; i < nBz; i++) {
    const t0 = i / nBz - 0.5, t1 = (i + 1) / nBz - 0.5, tm = (t0 + t1) / 2;
    const dy = lift(Math.abs(t1) * 2) - lift(Math.abs(t0) * 2);
    bands.push({ p: [sx * (W / 2 - 0.34), y + lift(Math.abs(tm) * 2) - 0.06, tm * D], r: [0, -Math.PI / 2, Math.atan2(dy, D / nBz)], s: [D / nBz * 1.08, 0.16, 0.2] });
  }
  }
  if (dr.raft) for (const e of raft) e.p[1] -= dr.raft;
  if (dr.caps) for (const e of caps) e.p[1] -= dr.caps;
  if (dr.drops) for (const e of drops) e.p[1] -= dr.drops;
  if (dr.bands) for (const e of bands) e.p[1] -= dr.bands;
  const g = new THREE.Group();
  const r1 = batch(new THREE.BoxGeometry(1, 1, 1), wood, raft);
  if (r1) g.add(r1);
  const r2 = batch(capGeo, tile, caps);                                                   // 瓦当
  if (r2) g.add(r2);
  const r3 = batch(dropGeo, tile, drops);                                                 // 滴水
  if (r3) g.add(r3);
  // 檐檩分段环梁（一步 batch）：与椽身同曲线的连续环梁，翼角随檐口起翘；band:false 整圈取消（宫殿大殿重檐修补单）
  if (o.band !== false) { const rb = batch(new THREE.BoxGeometry(1, 1, 1), wood, bands); if (rb) g.add(rb); }
  g.userData.marker = '檐口椽瓦';
  return g;
}

/** 一条垂脊 / 戗脊：脊身逐级降低 + 垂兽 + 仙人骑凤 + 走兽队列。原点在脊上端，沿 +X 延伸到檐角。 */
export function hipRidge(o = {}) {
  const len = Math.max(0.5, o.len ?? 2);
  const w = o.w ?? 0.22, s = o.s ?? 1;
  const mat = o.mat || M.paint(0x2f353c, 0.62);
  const bm = o.beastMat || mat;
  const n = clamp(Math.round(o.beasts ?? 3), 0, 9);
  const g = new THREE.Group();
  // 脊身沿屋面高度场走（o.curve(t) = 世界高度采样）；无 curve 时退化为直线 rise（攒尖塔檐等）
  const curve = typeof o.curve === 'function' ? o.curve : null;
  const rise = curve ? curve(1) - curve(0) : (o.rise ?? 0.3);
  const yAt = (t) => (curve ? curve(t) - curve(0) : rise * t) - 0.05 * s;   // 整体沉 5cm 咬住屋面
  const ns = clamp(Math.round(mul(4)), 3, 6);
  for (let i = 0; i < ns; i++) {
    const t0 = i / ns, t1 = (i + 1) / ns, tm = (t0 + t1) / 2;
    const hh = (0.24 - 0.07 * tm) * s;
    const mb = box(len / ns * 1.05, hh, w * (1 - tm * 0.18) * s, mat, tm * len, yAt(tm) + hh / 2, 0);
    mb.rotation.z = Math.atan2(yAt(t1) - yAt(t0), len / ns);   // 段身顺坡倾斜，拼成连续斜脊
    g.add(mb);
  }
  if (o.endCap !== false) {
    g.add(box(0.34 * s, 0.3 * s, 0.34 * s, bm, len + 0.12 * s, yAt(1) + 0.2 * s, 0, 0.06));     // 垂兽
    g.add(cone(0.16 * s, 0.32 * s, bm, seg(6), len + 0.34 * s, yAt(1) + 0.44 * s, 0));
  }
  if (n > 0) {
    const bodies = [], heads = [];
    for (let i = 0; i < n; i++) {
      const t = 0.82 - (i / Math.max(1, n)) * 0.6;                    // 从檐角往脊端排
      const x = len * t, yy = yAt(t) + 0.12 * s;
      bodies.push({ p: [x, yy, 0], s: [0.2 * s, 0.16 * s, 0.14 * s] });
      heads.push({ p: [x + 0.13 * s, yy + 0.11 * s, 0], s: [0.09 * s, 0.09 * s, 0.09 * s] });
    }
    const b1 = batch(new THREE.BoxGeometry(1, 1, 1), bm, bodies);
    if (b1) g.add(b1);
    const bs = ballSeg();
    const b2 = batch(new THREE.SphereGeometry(1, bs[0], bs[1]), bm, heads);
    if (b2) g.add(b2);
    g.add(box(0.26 * s, 0.1 * s, 0.15 * s, bm, len * 0.16 - 0.02 * s, yAt(0.16) + 0.06 * s, 0));   // 仙人骑凤
    g.add(cone(0.1 * s, 0.2 * s, bm, seg(5), len * 0.16 - 0.18 * s, yAt(0.16) + 0.06 * s, 0));
    g.add(sph(0.075 * s, bm, seg(6), len * 0.16 + 0.12 * s, yAt(0.16) + 0.18 * s, 0));
  }
  g.userData.marker = '垂脊走兽';
  return g;
}

/** 石栏杆：地栿 + 寻杖 + 栏板 + 望柱（柱头）+ 两端抱鼓石，沿 X 一条；axis='z' 整条转向 */
export function stoneRail(o = {}) {
  const len = Math.max(0.6, o.len ?? 8), h = o.h ?? 0.62, y = o.y ?? 0;
  const mat = o.mat || M.stone(0xb7b1a6, 0.92);
  const cap = o.capMat || mat;
  const g = new THREE.Group();
  const step = clamp(o.step ?? 1.15, 0.6, 2.4);
  const n = clamp(Math.round(len / step) + 1, 2, 44);
  const half = len / 2 / Math.max(1, n - 1) * Math.max(1, n - 1);
  const span = clamp(len, 0.5, 400);
  g.add(box(span + 0.1, 0.1, 0.26, mat, 0, y + 0.05, 0));              // 地栿
  g.add(box(span, 0.08, 0.15, mat, 0, y + h * 0.94, 0));               // 寻杖
  const pan = [];
  for (let i = 0; i < n - 1; i++) {
    const x = ((i + 0.5) / (n - 1) - 0.5) * span;
    pan.push({ p: [x, y + h * 0.56, 0], s: [span / (n - 1) * 0.84, h * 0.6, 0.07] });
  }
  const p1 = batch(new THREE.BoxGeometry(1, 1, 1), mat, pan);          // 栏板
  if (p1) g.add(p1);
  const posts = [], heads = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * span;
    posts.push({ p: [x, y + h * 0.52, 0], s: [0.14, h, 0.14] });
    heads.push({ p: [x, y + h + 0.12, 0], s: [0.1 * mul(1), 0.13 * mul(1), 0.1 * mul(1)] });
  }
  const p2 = batch(new THREE.BoxGeometry(1, 1, 1), mat, posts);        // 望柱
  if (p2) g.add(p2);
  // 望柱柱头是 10cm 的小球：旧版 SphereGeometry(1,18,12) = 396 面/个，一座塔 296 个就是 11.7 万面
  const bs = ballSeg();
  const p3 = batch(new THREE.SphereGeometry(1, bs[0], bs[1]), cap, heads);      // 望柱柱头
  if (p3) g.add(p3);
  for (const sx of [1, -1]) g.add(box(0.62, h * 0.86, 0.24, mat, sx * (span / 2 + 0.34), y + h * 0.43, 0, 0.08));  // 抱鼓石
  void half;
  g.userData.marker = '石栏杆';
  if (o.axis === 'z') g.rotation.y = Math.PI / 2;
  if (o.pos) g.position.set(o.pos[0], o.pos[1] || 0, o.pos[2]);
  return g;
}

/** 额枋彩画：青-绿-红-金 窄带 + 两端箍头，贴在看板面上（mats: {p 青, q 绿, r 红, g 金}） */
export function caihua(len, mats = {}, o = {}) {
  const h = o.h ?? 0.3, y = o.y ?? 0, z = o.z ?? 0, d = o.d ?? 0.05, x = o.x ?? 0;
  const g = new THREE.Group();
  const bands = [['p', 1.0, 0.66], ['q', 0.66, 0.36], ['r', 0.36, 0.14], ['g', 0.14, 0]];
  for (const [k, t0, t1] of bands) {
    const m = mats[k];
    if (!m) continue;
    const y0 = y + Math.min(t0, t1) * h, hh = Math.max(0.02, Math.abs(t0 - t1) * h);
    g.add(box(len, hh, d, m, 0, y0 + hh / 2, z));
  }
  const gm = mats.g || mats.p;
  if (gm) for (const sx of [1, -1]) g.add(box(h * 0.44, h * 1.06, d * 1.3, gm, sx * (len / 2 - h * 0.28), y + h * 0.5, z));
  if (x) g.position.x = x;                      // 多间并排时每间的彩画要跟着梁走，不能都堆在中间
  g.userData.marker = '彩画';
  return g;
}

/** 匾额贴图：蓝底金字（canvas，自右向左读）；无 DOM 环境返回 null，匾身退化为纯色 */
const _plaqueCache = new Map();
export function plaqueTex(text = '', bg = '#1d3a63', fg = '#d9b25c') {
  const key = `${text}|${bg}|${fg}`;
  if (_plaqueCache.has(key)) return _plaqueCache.get(key);
  let tex = null;
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 72;
      const x = cv.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, 256, 72);
      const gr = x.createLinearGradient(0, 0, 0, 72);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
      x.fillStyle = gr; x.fillRect(0, 0, 256, 72);
      x.strokeStyle = 'rgba(0,0,0,0.32)'; x.lineWidth = 3; x.strokeRect(5.5, 5.5, 245, 61);
      const chars = [...String(text || '')].slice(0, 6).reverse();
      if (chars.length) {
        x.font = `bold ${Math.round(200 / chars.length)}px "Songti SC","STSong","SimSun","Noto Serif CJK SC","Microsoft YaHei",serif`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const cw = 236 / chars.length;
        chars.forEach((c, i) => {
          const px = 10 + cw * (i + 0.5);
          x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.5)'; x.strokeText(c, px, 38);
          x.fillStyle = fg; x.fillText(c, px, 38);
        });
      }
      tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
    }
  } catch (err) { tex = null; }
  _plaqueCache.set(key, tex);
  return tex;
}

/** 一块带金边的匾额 / 花板：板身 + 贴字面 + 四边框 */
export function plaque(o = {}) {
  const w = Math.max(0.3, o.w ?? 2.2), h = Math.max(0.2, o.h ?? 0.8);
  const board = o.boardMat || M.paint(0x24384f, 0.5);
  const frame = o.frameMat || M.metal(0xc9a45c, 0.34, 0.85);
  const g = new THREE.Group();
  g.add(box(w, h, 0.14, board, 0, 0, 0));
  const t = o.text ?? '';
  const tex = t ? plaqueTex(t, o.bg, o.fg) : null;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, h * 0.82), tex
    ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.44, metalness: 0.1 })
    : M.paint(0x1d3a63, 0.5));
  face.position.z = 0.076;
  if (tex) face.userData.noDetail = true;
  g.add(face);
  for (const sy of [1, -1]) g.add(box(w + 0.16, 0.07, 0.2, frame, 0, sy * (h / 2 + 0.035), 0));
  for (const sx of [1, -1]) g.add(box(0.07, h + 0.16, 0.2, frame, sx * (w / 2 + 0.035), 0, 0));
  g.userData.marker = '匾额';
  return g;
}

/** 把「同规格同材质」的重复小件合成一个 InstancedMesh：draw call 骤减（中式建筑细木作极重复）
 *  只处理盒 / 圆柱 / 圆锥，贴图材质与已实例化的不动。返回合并出的实例组数。 */
export function mergeSimilar(root, o = {}) {
  const min = Math.max(2, o.min ?? 2);
  const keep = o.types || ['BoxGeometry', 'CylinderGeometry', 'ConeGeometry', 'SphereGeometry'];
  if (!root || !root.traverse) return 0;
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((m) => {
    if (!m.isMesh) return;
    if (m.userData.noMerge) return;
    const g = m.geometry;
    if (!g || keep.indexOf(g.type) < 0) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb || bb.isEmpty()) return;
    const mat = Array.isArray(m.material) ? null : m.material;
    if (!mat || mat.emissiveMap) return;                       // 自发光贴图的不合（发光面板各自独立）
    const cnt = m.isInstancedMesh ? m.count : 1;
    // 带程序化贴图的材质也要能合：只要共享同一张贴图（同一 uuid），实例化后 UV 仍各自正确
    const texKey = `${mat.map ? mat.map.uuid : 'n'}${mat.normalMap ? mat.normalMap.uuid : 'n'}${mat.roughnessMap ? mat.roughnessMap.uuid : 'n'}${mat.aoMap ? mat.aoMap.uuid : 'n'}`;
    const sig = [g.type, (bb.max.x - bb.min.x).toFixed(3), (bb.max.y - bb.min.y).toFixed(3), (bb.max.z - bb.min.z).toFixed(3),
      (g.index ? g.index.count : g.attributes.position.count), mat.uuid, mat.transparent ? 1 : 0, mat.side, texKey].join('|');
    let a = buckets.get(sig);
    if (!a) { buckets.set(sig, a = []); a.total = 0; a.geo = g; a.mat = mat; a.shadow = m.castShadow; a.recv = m.receiveShadow; }
    a.total += cnt;
    a.push(m);
  });
  let n = 0;
  const inv = new THREE.Matrix4();
  const mm = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < min) continue;      // 只有一个来源 → 本来就是一次 draw call，不必再合
    const geo = list[0].geometry;
    const im = new THREE.InstancedMesh(geo, list[0].material, Math.max(1, list.total));
    inv.copy(root.matrixWorld).invert();
    let k = 0;
    for (const src of list) {
      const base = new THREE.Matrix4().copy(inv).multiply(src.matrixWorld);
      const cnt = src.isInstancedMesh ? src.count : 1;
      for (let i = 0; i < cnt; i++) {
        if (src.isInstancedMesh) { src.getMatrixAt(i, tmp); mm.copy(base).multiply(tmp); } else mm.copy(base);
        im.setMatrixAt(k++, mm);
      }
      const par = src.parent;
      if (par) par.remove(src);
      // 不 dispose 来源几何：build 内同规格小件会共用同一份几何，动了就会把别人（甚至本件）的顶点清成零
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = list[0].castShadow; im.receiveShadow = list[0].receiveShadow;
    try { im.computeBoundingSphere(); } catch (err) { /* ignore */ }
    root.add(im);
    n++;
  }
  return n;
}

/** 材质「长相」指纹：同色同粗糙度同贴图 = 可以共用一次绘制。
 *  构建器每次 M.paint() 都会新建一个材质，按 uuid 分桶会把本该一次的绘制切成几十桶，所以按长相分。 */
function lookKey(mat) {
  const t = (v) => (v && v.isColor ? '#' + v.getHexString() : String(v));
  const ns = mat.normalScale ? mat.normalScale.x.toFixed(3) + '/' + mat.normalScale.y.toFixed(3) : '-';
  return [mat.type, t(mat.color), +mat.roughness?.toFixed(3), +mat.metalness?.toFixed(3), t(mat.emissive), +(mat.emissiveIntensity ?? 1).toFixed(3),
    mat.side, mat.flatShading ? 1 : 0, mat.vertexColors ? 1 : 0, +mat.opacity.toFixed(3), ns,
    +mat.alphaTest.toFixed(3), mat.blending, mat.depthWrite ? 1 : 0, mat.depthTest ? 1 : 0, +(mat.aoMapIntensity ?? 1).toFixed(3),
    mat.map?.uuid || '-', mat.normalMap?.uuid || '-', mat.roughnessMap?.uuid || '-', mat.aoMap?.uuid || '-'].join('|');
}

/** 把「同材质」的零碎构件烘进一个几何：draw call 与场景节点数一起骤减。
 *  中式古建动辄上百个方盒 / 圆柱，逐件挂在图里，光是遍历（切模板、重算贴花、阴影列表）就很吃亏。
 *  顶点先变换到构件组坐标再拼接；UV 本来就是「米」，所以拼完贴图密度不变。 */
export function bakeMerge(root, o = {}) {
  if (!root || !root.traverse) return 0;
  const minParts = Math.max(2, o.minParts ?? 3);   // 3 件同长相就烘：mergeSimilar 已经吃掉「同规格」的，剩下的多半是尺寸各异的一次性件
  const maxTri = o.maxTri ?? 500000;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mm = new THREE.Matrix4(), nm = new THREE.Matrix3(), pv = new THREE.Vector3(), nv = new THREE.Vector3();
  const buckets = new Map();
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.userData.noMerge) return;   // detDone 只表示「细节已挂」，不影响合并
    const g = m.geometry, mat = m.material;
    if (!g || !g.attributes || !g.attributes.position || !mat || Array.isArray(mat)) return;
    if (mat.transparent || mat.opacity < 0.995 || g.type === 'DecalGeometry') return;
    if ((g.index ? g.index.count : g.attributes.position.count) < 3) return;
    const key = lookKey(mat);
    let b = buckets.get(key);
    if (!b) { b = { mat, parts: [], tri: 0, vc: 0 }; buckets.set(key, b); }
    b.parts.push(m);
    b.tri += (g.index ? g.index.count : g.attributes.position.count) / 3;
    b.vc += g.index ? g.index.count : g.attributes.position.count;   // 输出顶点数：有索引的要按索引展开计（不做索引复用）
  });
  const wantMeta = o.meta === undefined ? (typeof globalThis !== 'undefined' && globalThis.__cnMeta === 1) : !!o.meta;
  let baked = 0;
  for (const b of buckets.values()) {
    if (b.parts.length < minParts || b.tri > maxTri) continue;
    if (b.parts.every((m2) => m2.geometry === b.parts[0].geometry)) continue;   // 同一份几何：mergeSimilar 已实例化，别再复制一遍顶点
    // 预分配 + 顺序写入：几百件小构件烘一次，push 版本在 fine 档能把整场景重建拖到超时
    const vtotal = b.vc;
    const pos = new Float32Array(vtotal * 3), nor = new Float32Array(vtotal * 3), uv = new Float32Array(vtotal * 2);
    let w = 0, wuv = 0;
    let cast = false, rec = false;
    const marks = {}, meta = [];
    for (const m of b.parts) {
      const g = m.geometry, ap = g.attributes.position, an = g.attributes.normal, au = g.attributes.uv;
      mm.multiplyMatrices(inv, m.matrixWorld);
      nm.getNormalMatrix(mm);
      const n = g.index ? g.index.count : ap.count;
      for (let i = 0; i < n; i++) {
        const vi = g.index ? g.index.getX(i) : i;
        pv.fromBufferAttribute(ap, vi).applyMatrix4(mm);
        // 位置与法线是两条独立数组，但「同一个顶点」用同一个下标：绝不能各自 +3
        pos[w] = pv.x; pos[w + 1] = pv.y; pos[w + 2] = pv.z;
        if (an) {
          nv.fromBufferAttribute(an, vi).applyMatrix3(nm).normalize();
          nor[w] = nv.x; nor[w + 1] = nv.y; nor[w + 2] = nv.z;
        } else { nor[w] = 0; nor[w + 1] = 1; nor[w + 2] = 0; }
        w += 3;
        if (au) { uv[wuv] = au.getX(vi); uv[wuv + 1] = au.getY(vi); }
        wuv += 2;
      }
      cast = cast || !!m.castShadow;
      rec = rec || !!m.receiveShadow;
      for (const [k, v] of Object.entries(m.userData || {})) if (typeof v === 'string' && marks[k] === undefined) marks[k] = v;
      if (wantMeta) {                            // 来源件档案：构件检查脚本要靠它数「有几种构件」
        if (!g.boundingBox) g.computeBoundingBox();
        const lb = g.boundingBox, sc = m.scale;
        const sx = Math.max(0.001, (lb.max.x - lb.min.x) * Math.abs(sc.x));
        const sy = Math.max(0.001, (lb.max.y - lb.min.y) * Math.abs(sc.y));
        const sz = Math.max(0.001, (lb.max.z - lb.min.z) * Math.abs(sc.z));
        pv.set((lb.min.x + lb.max.x) / 2, (lb.min.y + lb.max.y) / 2, (lb.min.z + lb.max.z) / 2).applyMatrix4(mm);
        meta.push({ t: g.type, kind: (b.mat.userData && b.mat.userData.detail) || '', hex: b.mat.color ? b.mat.color.getHex() : -1,
          map: !!b.mat.map, x: +pv.x.toFixed(3), y: +pv.y.toFixed(3), z: +pv.z.toFixed(3),
          sx: +sx.toFixed(3), sy: +sy.toFixed(3), sz: +sz.toFixed(3), tri: Math.round(n / 3) });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData = Object.assign(geo.userData || {}, { detFit: 1, bakedParts: b.parts.length });
    if (wantMeta) geo.userData.bakedMeta = meta;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = rec;
    mesh.userData.detDone = 1;      // 顶点里的 UV 已是「米」：切换精度档时不必再拟合
    mesh.userData.noMerge = 1;
    Object.assign(mesh.userData, marks);
    // 原几何可能被别处共用（batch() 一份几何配多个实例），所以只摘节点、不 dispose
    for (const m of b.parts) { if (m.parent) m.parent.remove(m); }
    root.add(mesh);
    baked++;
  }
  return baked;
}

/**
 * 双坡（可折线形）屋面：先定「檐口落在墙顶 y、脊线在 y+rise」，再反推每块坡面板的
 * 坡长 / 板心 / 倾角，所以两面在脊上是对拼而不是互相穿过，板底也正好压在墙顶。
 *   w     屋脊方向长度（沿 x）      d     两侧合计跨度（沿 z）
 *   ov    出檐                     th    板厚
 *   gambrel  >0 时做折线形（谷仓式），数值 = 肩点高度占举高的比例
 *   fill     给出材质就补两面山墙（按坡面折线挤出，不留三角洞）
 * 返回的 Group 上 g.userData.top = 脊线标高。
 */
export function gableSlabs({ w = 8, d = 6, y = 3, rise = 2, th = 0.16, ov = 0.4, mat, gambrel = 0, fill = null, cap = 0.2, eaveBoard = true } = {}) {
  const g = new THREE.Group();
  const half = Math.max(0.3, d / 2 + ov);
  const pts = gambrel > 0
    ? [[0, rise], [half * 0.56, rise * clamp(gambrel, 0.15, 0.85)], [half, 0]]
    : [[0, rise], [half, 0]];
  for (const s of [-1, 1]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const z0 = s * pts[i][0], y0 = y + pts[i][1], z1 = s * pts[i + 1][0], y1 = y + pts[i + 1][1];
      const run = Math.abs(z1 - z0), dy = y0 - y1;
      const L = Math.hypot(run, dy);
      const p = box(w, th, L + th * 0.5, mat, 0, (y0 + y1) / 2, (z0 + z1) / 2);
      p.rotation.x = s * Math.atan2(dy, Math.max(0.02, run));
      g.add(p);
    }
  }
  g.add(box(w + 0.12, cap * 0.6, cap, mat, 0, y + rise + cap * 0.18, 0));                    // 正脊压顶，盖住两板对缝
  if (eaveBoard) for (const s of [-1, 1]) {
    const e = box(w, th * 0.85, th * 0.9, mat, 0, y - th * 0.5, s * (half + th * 0.35));
    g.add(e);                                                                                  // 封檐板
  }
  if (fill) {
    // 山墙填充多边形：底边 + 右坡上到脊 + 左坡下回檐口（旧版漏画右坡，山尖敞开露白）
    const sh = new THREE.Shape();
    sh.moveTo(-half, 0); sh.lineTo(half, 0);
    for (let i = pts.length - 2; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][1]);
    for (let i = 1; i < pts.length - 1; i++) sh.lineTo(-pts[i][0], pts[i][1]);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(geo, fill);
      m.position.set(s > 0 ? w / 2 - 0.1 : -w / 2, y, 0);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
  }
  g.userData.top = y + rise + cap * 0.5;
  return g;
}

// ═══════════════ 图板级构件（第三轮加细）：风铃 / 鸱吻 / 美人靠 / 券脸 / 抱鼓 ═══════════════
M.brick = (c = 0x9b958b, r = 0.9) => mk('brick', { color: c, roughness: r, metalness: 0 });
M.plaster = (c = 0xe8e2d4, r = 0.85) => mk('plaster', { color: c, roughness: r, metalness: 0 });
M.earth = (c = 0xa8865c, r = 0.95) => mk('dirt', { color: c, roughness: r, metalness: 0 });

/** 檐角风铃：挂钩 + 钟体 + 风叶（攒尖亭 / 塔檐角件） */
export function windBell(mat, s = 1, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.012 * s, 0.012 * s, 0.16 * s, mat, 6, 0, -0.08 * s, 0));
  g.add(cyl(0.05 * s, 0.075 * s, 0.12 * s, mat, 8, 0, -0.2 * s, 0));
  const leaf = box(0.05 * s, 0.14 * s, 0.012 * s, mat, 0, -0.34 * s, 0);
  leaf.rotation.x = 0.3; g.add(leaf);
  g.position.set(x, y, z);
  return g;
}

/** 鸱吻（正脊两端）：吻身 + 上卷尾 + 背鳍，比旧版单盒更有轮廓 */
export function chiwen(mat, s = 1, sx = 1) {
  const g = new THREE.Group();
  g.add(box(0.3 * s, 0.62 * s, 0.46 * s, mat, 0, 0.31 * s, 0));
  const t1 = box(0.26 * s, 0.5 * s, 0.2 * s, mat, -sx * 0.1 * s, 0.78 * s, 0);
  t1.rotation.z = sx * 0.5; g.add(t1);
  const t2 = box(0.22 * s, 0.34 * s, 0.16 * s, mat, -sx * 0.3 * s, 1.02 * s, 0);
  t2.rotation.z = sx * 1.15; g.add(t2);
  g.add(box(0.1 * s, 0.3 * s, 0.5 * s, mat, sx * 0.12 * s, 0.5 * s, 0, 0.02));   // 背鳍
  for (let i = 0; i < 3; i++) g.add(box(0.06 * s, 0.1 * s, 0.54 * s, mat, sx * (0.1 - i * 0.02) * s, (0.66 + i * 0.12) * s, 0));
  return g;
}

/** 美人靠坐凳栏杆：坐板 + 鹅颈靠背条（实例化）+ 腿 */
export function benchRail({ len = 3, h = 0.85, y = 0, mat, axis = 'x' } = {}) {
  const g = new THREE.Group();
  const L = Math.max(0.6, len);
  g.add(box(L, 0.07, 0.34, mat, 0, y + 0.42, 0));                       // 坐面
  g.add(box(L, 0.06, 0.06, mat, 0, y + 0.38, 0));                        // 底枋：贴坐面下皮（旧版 y+0.06 离坐面悬空 0.3m）
  const n = clamp(Math.round(L / 0.16), 4, 60);
  const slats = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * (L - 0.1);
    slats.push({ p: [x, y + 0.62, 0.1], r: [0.5, 0, 0], s: [0.05, 0.42, 0.05] });
  }
  const b = batch(new THREE.BoxGeometry(1, 1, 1), mat, slats);
  if (b) g.add(b);
  g.add(box(L, 0.06, 0.08, mat, 0, y + h, 0.2));                        // 寻杖（靠背顶）
  for (const sx of [-1, 1]) g.add(box(0.08, 0.44, 0.3, mat, sx * (L / 2 - 0.04), y + 0.22, 0));
  if (axis === 'z') g.rotation.y = Math.PI / 2;
  return g;
}

/** 砖券脸：半圆拱周径向实例化券石 + 拱心石 */
export function archFace({ w = 3, h = 3, th = 0.5, mat, keyMat, z = 0, y = 0 } = {}) {
  const g = new THREE.Group();
  const R = Math.max(0.4, w / 2);
  const n = clamp(Math.round(R * 6), 7, 25);
  const step = (R + 0.14) * Math.PI / n;
  const items = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (i / n);
    items.push({ p: [Math.cos(a) * (R + 0.14), y + h - R + Math.sin(a) * (R + 0.14), 0], r: [0, 0, a - Math.PI / 2], s: [step * 1.25, 0.3, th] });   // 块长=弧步×1.25：券脸石彼此搭接（旧版留缝成"点券"）
  }
  const b = batch(new THREE.BoxGeometry(1, 1, 1), mat, items);
  if (b) g.add(b);
  if (keyMat) g.add(box(0.4, 0.44, th + 0.06, keyMat, 0, y + h + 0.12, 0));
  g.position.z = z;
  return g;
}

/** 抱鼓石：鼓 + 云头 + 基座（台阶/踏跺端头） */
export function baoguShi(mat, s = 1, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group();
  g.add(box(0.5 * s, 0.3 * s, 0.9 * s, mat, 0, 0.15 * s, 0));
  const dr = cyl(0.26 * s, 0.26 * s, 0.14 * s, mat, 12, 0, 0.62 * s, 0.18 * s);
  dr.rotation.x = Math.PI / 2; g.add(dr);
  g.add(box(0.14 * s, 0.4 * s, 0.7 * s, mat, 0, 0.42 * s, -0.06 * s));
  const cl = sph(0.12 * s, mat, 10, 0, 0.9 * s, 0.18 * s); g.add(cl);
  g.position.set(x, y, z); g.rotation.y = ry;
  return g;
}
