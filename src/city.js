// ---------------------------------------------------------------------------
// 城市建筑 / 环境道具 / 人物 —— 补齐 demo.js 与场景模板引用的三组模型
// 说明：这三组在仓库引导合并时就已缺失（demo 的 building:*/env:*/char:* 键全部
// 落空 → addAsset 静默返回 null，城市建筑“一直出不来”）。本文件为【纯追加】：
// 不改动模型库既有 16 组 / 172 项的任何内容。构建器只用 three.js 原生几何
// （盒/柱/锥/球/圆环），纯色材质、无贴图。
// 键格式与 LIB_INDEX 一致：`${group.id}:${type}:${name}`
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRng } from './util.js';
import { ANIMS, buildHuman, buildCrowd } from './character.js';

// ---- 参数描述符（与 assets.js 内部 PR/PI/PC/PB/PS 形状一致，避免循环引用） ----
const PI = (k, l, min, max, step, def) => ({ k, l, t: 'int', min, max, step, def });
const PR = (k, l, min, max, step, def) => ({ k, l, t: 'range', min, max, step, def });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'sel', opts, def });
const ANIM_PS = (def = 'idle') => PS('anim', '动作', ANIMS.map((a) => ({ v: a.v, l: a.l })), def);

// ---- 本地几何小工具（不 import assets.js：它会 import 本文件，构成环） ----
const mm = (c, r = 0.8, m = 0.04, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)), mat);
  o.position.set(x, y, z); return o;
};
const cyl = (rt, rb, h, mat, s = 16, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.001, rt), Math.max(0.001, rb), Math.max(0.01, h), Math.max(3, Math.round(s))), mat);
  o.position.set(x, y, z); return o;
};
const sph = (r, mat, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.01, r), 14, 10), mat);
  o.position.set(x, y, z); return o;
};
const tor = (r, t, mat, x = 0, y = 0, z = 0, arc = Math.PI * 2) => {
  const o = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.01, r), Math.max(0.005, t), 6, 24, arc), mat);
  o.position.set(x, y, z); return o;
};
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

// ===========================================================================
// 组 1：building —— 城市建筑
// ===========================================================================
const FL = 3.1;                                          // 标准层高

/** 玻璃幕墙写字楼：裙楼 + 楼板节奏 + 玻璃体量 + 可选冠顶 */
function buildTower(p) {
  const g = new THREE.Group();
  const fl = Math.round(num(p.floors, 20));
  const W = num(p.width, 18), D = num(p.depth, 16);
  const H = fl * FL;
  const lit = num(p.lit, 0.3);
  const glass = mm(0x4e6b7c, 0.16, 0.35, { emissive: 0x9db6c4, emissiveIntensity: lit * 0.55 });
  const slab = mm(0xcfd3d8, 0.7);
  let y0 = 0;
  if (p.podium) {
    const PH = 4.2;
    g.add(box(W * 1.3, PH, D * 1.3, mm(0x9aa0a8, 0.85), 0, PH / 2, 0));
    g.add(box(W * 1.34, 0.3, D * 1.34, slab, 0, PH + 0.1, 0));
    y0 = PH;
  }
  g.add(box(W, H, D, glass, 0, y0 + H / 2, 0));
  const step = fl > 30 ? 2 : 1;                          // 超高层隔层做楼板，控件数
  for (let i = 1; i <= fl; i += step) g.add(box(W + 0.3, 0.18, D + 0.3, slab, 0, y0 + i * FL, 0));
  g.add(box(W + 0.5, 0.35, D + 0.5, slab, 0, y0 + H + 0.15, 0));
  if (p.crown) {
    g.add(box(W * 0.55, 2.4, D * 0.55, mm(0x6f7780, 0.5, 0.4), 0, y0 + H + 1.4, 0));
    g.add(cyl(0.12, 0.18, 5, mm(0x8d949c, 0.4, 0.7), 8, 0, y0 + H + 5, 0));
  }
  return g;
}

/** 住宅板楼：横向窗带 + 平屋面 */
function buildResidential(p) {
  const g = new THREE.Group();
  const fl = Math.round(num(p.floors, 12));
  const L = num(p.length, 36), D = num(p.depth, 12);
  const H = fl * FL;
  const wall = mm(p.wall || '#b8ae9e', 0.85);
  const win = mm(0x5f7686, 0.2, 0.25, { emissive: 0x9fb4c2, emissiveIntensity: num(p.lit, 0.25) * 0.5 });
  g.add(box(L, H, D, wall, 0, H / 2, 0));
  for (let i = 1; i <= fl; i++) {
    const y = i * FL - FL * 0.55;
    g.add(box(L + 0.06, 1.5, D * 0.5, win, 0, y, D * 0.26));
    g.add(box(L + 0.06, 1.5, D * 0.5, win, 0, y, -D * 0.26));
    g.add(box(L + 0.24, 0.16, D + 0.24, mm(0xc9c4b8, 0.75), 0, i * FL, 0));
  }
  g.add(box(L + 0.4, 0.4, D + 0.4, mm(0xa8a49a, 0.8), 0, H + 0.2, 0));
  g.add(box(L * 0.3, 1.6, D * 0.35, mm(0x8f8b82, 0.85), L * 0.2, H + 1, 0));   // 屋面机房
  return g;
}

/** 沿街商铺：底层店面玻璃 + 招牌 + 遮阳篷 + 上层住宅 */
function buildShophouse(p) {
  const g = new THREE.Group();
  const fl = Math.max(1, Math.round(num(p.floors, 3)));
  const W = num(p.width, 20), D = num(p.depth, 11);
  const H = fl * FL + 0.6;
  const wall = mm(0xd8d2c6, 0.85);
  g.add(box(W, H, D, wall, 0, H / 2, 0));
  // 店面
  const shop = mm(0x87b6cf, 0.12, 0.3, { transparent: true, opacity: 0.75 });
  g.add(box(W * 0.86, 2.6, 0.2, shop, 0, 1.6, D / 2 + 0.06));
  const sign = mm(p.signColor || '#ff3b6b', 0.5, 0.1, { emissive: new THREE.Color(p.signColor || '#ff3b6b'), emissiveIntensity: 0.65 });
  g.add(box(W * 0.8, 0.9, 0.3, sign, 0, 3.4, D / 2 + 0.1));
  if (p.awning) {
    const a = box(W * 0.7, 0.1, 2.2, mm(p.awning, 0.7), 0, 2.9, D / 2 + 1);
    a.rotation.x = 0.28; g.add(a);
  }
  // 上层窗带
  for (let i = 2; i <= fl; i++) {
    const y = (i - 1) * FL + 1.6;
    g.add(box(W * 0.8, 1.5, 0.15, mm(0x60788a, 0.2, 0.25), 0, y, D / 2 + 0.04));
    g.add(box(0.15, 1.5, D * 0.5, mm(0x60788a, 0.2, 0.25), W / 2 + 0.04, y, 0));
  }
  g.add(box(W + 0.3, 0.3, D + 0.3, mm(0xa8a49a, 0.8), 0, H + 0.12, 0));
  return g;
}

/** 独栋住宅（城市组内的通用小房子：盒身 + 双坡顶） */
function buildCityHouse(p) {
  const g = new THREE.Group();
  const W = num(p.width, 9), D = num(p.depth, 7.5), H = 3;
  g.add(box(W, H, D, mm(0xe3ddd2, 0.85), 0, H / 2, 0));
  const roofMat = mm(0x5a4a3a, 0.8);
  const a = box(W * 0.62, 0.2, D + 0.6, roofMat, -W * 0.22, H + 1.1, 0);
  a.rotation.z = 0.62; g.add(a);
  const b = box(W * 0.62, 0.2, D + 0.6, roofMat, W * 0.22, H + 1.1, 0);
  b.rotation.z = -0.62; g.add(b);
  g.add(box(1, 2.1, 0.15, mm(0x7b5a3f, 0.7), 0, 1.05, D / 2 + 0.05));
  g.add(box(1.4, 1.2, 0.12, mm(0x88aacc, 0.2, 0.3), -W * 0.28, 1.7, D / 2 + 0.05));
  return g;
}

/** 城市楼群：种子决定的行列排布天际线（远景体量用，构件简化） */
function buildCluster(p) {
  const g = new THREE.Group();
  const rng = makeRng(num(p.seed, 11) + 7);
  const n = Math.round(num(p.count, 16));
  const gap = num(p.gap, 34);
  const lo = num(p.min, 8), hi = Math.max(num(p.max, 44), lo + 4);
  const cols = Math.max(2, Math.round(Math.sqrt(n)));
  const lit = num(p.lit, 0.3);
  const glass = mm(0x56707f, 0.2, 0.3, { emissive: 0x93aabc, emissiveIntensity: lit * 0.5 });
  const slab = mm(0xb9bdc2, 0.7);
  let placed = 0;
  for (let r = 0; placed < n; r++) {
    for (let c = 0; c < cols && placed < n; c++, placed++) {
      const x = (c - (cols - 1) / 2) * gap + (rng() - 0.5) * gap * 0.18;
      const z = (r - (Math.ceil(n / cols) - 1) / 2) * gap + (rng() - 0.5) * gap * 0.18;
      const H = lo + rng() * (hi - lo);
      const w = gap * (0.36 + rng() * 0.12), d = gap * (0.34 + rng() * 0.12);
      g.add(box(w, H, d, glass, x, H / 2, z));
      g.add(box(w + 0.4, 0.3, d + 0.4, slab, x, H + 0.1, z));
    }
  }
  return g;
}

/** 柱廊门厅：列柱 + 檐部 + 台基 */
function buildColonnade(p) {
  const g = new THREE.Group();
  const cols = Math.round(num(p.cols, 6));
  const sp = num(p.spacing, 3.8), H = num(p.height, 6.6);
  const width = (cols - 1) * sp + 2.4;
  const stone = mm(0xe8e0d4, 0.75);
  g.add(box(width + 2, 0.6, 5.4, stone, 0, 0.3, 0));
  for (let i = 0; i < cols; i++) {
    const x = -((cols - 1) / 2) * sp + i * sp;
    g.add(cyl(0.45, 0.5, H, stone, 14, x, 0.6 + H / 2, 1.8));
    g.add(box(1.2, 0.35, 1.2, stone, x, 0.6 + H + 0.15, 1.8));
  }
  g.add(box(width + 1.6, 0.9, 4.4, stone, 0, 0.6 + H + 0.7, 1.4));
  g.add(box(width + 1.2, 0.5, 4.8, mm(0xd8cfc0, 0.75), 0, 0.6 + H + 1.4, 1.4));
  g.add(box(width + 2.4, H + 2, 1.2, mm(0xd8d2c6, 0.85), 0, (H + 2) / 2 + 0.6, -1.6));   // 背墙
  return g;
}

/** 大台阶 */
function buildStairs(p) {
  const g = new THREE.Group();
  const n = Math.round(num(p.steps, 7));
  const W = num(p.width, 11), rise = num(p.rise, 0.19), run = num(p.run, 0.42);
  const mat = p.marble ? mm(0xf2efe8, 0.55) : mm(0xc9c4b8, 0.8);
  for (let i = 0; i < n; i++) {
    g.add(box(W, rise * (i + 1), run, mat, 0, (rise * (i + 1)) / 2, -i * run));
  }
  return g;
}

/** 户外广告屏 */
function buildBillboard(p) {
  const g = new THREE.Group();
  const W = num(p.width, 11), H = num(p.height, 6), leg = num(p.leg, 7);
  const bright = num(p.bright, 1.4);
  const rng = makeRng(num(p.seed, 7) + 3);
  const hue = Math.floor(rng() * 360);
  const screen = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 65%, 55%)`), roughness: 0.3, metalness: 0.1,
    emissive: new THREE.Color(`hsl(${hue}, 70%, 50%)`), emissiveIntensity: bright * 0.6,
  });
  g.add(cyl(0.22, 0.3, leg, mm(0x6f7780, 0.5, 0.5), 10, -W * 0.3, leg / 2, 0));
  g.add(cyl(0.22, 0.3, leg, mm(0x6f7780, 0.5, 0.5), 10, W * 0.3, leg / 2, 0));
  g.add(box(W, H, 0.5, mm(0x2c3138, 0.7), 0, leg + H / 2, 0));
  g.add(box(W - 0.6, H - 0.6, 0.2, screen, 0, leg + H / 2, 0.28));
  return g;
}

/** 高架立交：桥面 + 防撞栏 + 墩柱 */
function buildOverpass(p) {
  const g = new THREE.Group();
  const L = num(p.length, 150), W = num(p.width, 11), H = num(p.height, 8.5), span = num(p.span, 26);
  const deck = mm(0xb7bab8, 0.85);
  g.add(box(L, 1.1, W, deck, 0, H, 0));
  g.add(box(L, 0.8, 0.35, mm(0xc9a53f, 0.7), 0, H + 0.9, W / 2 - 0.2));
  g.add(box(L, 0.8, 0.35, mm(0xc9a53f, 0.7), 0, H + 0.9, -W / 2 + 0.2));
  g.add(box(L, 0.08, W - 1.6, mm(0x3a3e42, 0.9), 0, H + 0.58, 0));                 // 沥青面
  for (let x = -L / 2 + span / 2; x <= L / 2 - span / 2 + 1; x += span) {
    g.add(box(2.2, H - 0.55, 3.2, mm(0xa8aaa8, 0.85), x, (H - 0.55) / 2, 0));
  }
  return g;
}

// ===========================================================================
// 组 2：env —— 环境道具
// ===========================================================================
/** 沥青路面（独立模型条，含虚线） */
function buildEnvRoad(p) {
  const g = new THREE.Group();
  const W = num(p.width, 15), L = num(p.length, 190);
  g.add(box(W, 0.12, L, mm(0x3a3e42, 0.92), 0, 0.06, 0));
  const n = Math.min(40, Math.max(6, Math.round(L / 6)));
  const dashMat = mm(0xe8e4da, 0.6);
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + (L * (i + 0.5)) / n;
    g.add(box(0.28, 0.04, L / n * 0.45, dashMat, 0, 0.13, z));
  }
  g.add(box(0.2, 0.04, L, mm(0xe8e4da, 0.6), W / 2 - 0.8, 0.13, 0));
  g.add(box(0.2, 0.04, L, mm(0xe8e4da, 0.6), -W / 2 + 0.8, 0.13, 0));
  return g;
}

/** 人行道条 */
function buildWalk(p) {
  const g = new THREE.Group();
  const W = num(p.width, 7), L = num(p.length, 190);
  g.add(box(W, 0.18, L, mm(0xb9b6ae, 0.85), 0, 0.09, 0));
  const n = Math.min(30, Math.max(4, Math.round(L / 8)));
  const groove = mm(0xa9a69e, 0.85);
  for (let i = 0; i < n; i++) g.add(box(W, 0.02, 0.1, groove, 0, 0.19, -L / 2 + (L * (i + 1)) / n));
  return g;
}

/** 行道树 */
function buildEnvTree(p) {
  const g = new THREE.Group();
  const H = num(p.height, 6);
  const kind = p.kind || 'tall';
  const trunk = mm(0x6b5344, 0.9);
  const leaf = mm(0x4e7a45, 0.85);
  const leaf2 = mm(0x5f8f52, 0.85);
  g.add(cyl(0.14, 0.2, H * 0.55, trunk, 8, 0, H * 0.28, 0));
  if (kind === 'cone') {
    const c = cyl(0.02, H * 0.32, H * 0.8, leaf, 10, 0, H * 0.55 + H * 0.4, 0);
    g.add(c);
  } else if (kind === 'round') {
    g.add(sph(H * 0.32, leaf, 0, H * 0.66, 0));
  } else {
    const s1 = sph(H * 0.3, leaf, 0, H * 0.62, 0);
    s1.scale.set(1, 1.25, 1); g.add(s1);
    const s2 = sph(H * 0.22, leaf2, H * 0.1, H * 0.86, H * 0.05);
    s2.scale.set(1, 1.2, 1); g.add(s2);
  }
  return g;
}

/** 路灯 */
function buildLamp(p) {
  const g = new THREE.Group();
  const H = num(p.height, 6.5);
  const glow = num(p.glow, 0.25);
  g.add(cyl(0.3, 0.4, 0.5, mm(0x3a3e42, 0.6, 0.4), 10, 0, 0.25, 0));
  g.add(cyl(0.09, 0.13, H, mm(0x3a3e42, 0.55, 0.5), 10, 0, H / 2 + 0.4, 0));
  g.add(box(1.6, 0.1, 0.14, mm(0x3a3e42, 0.55, 0.5), 0.7, H + 0.36, 0));
  const head = box(0.8, 0.16, 0.34, mm(0xf5efd8, 0.4, 0.1, { emissive: 0xfff2c0, emissiveIntensity: glow * 2 }), 1.4, H + 0.3, 0);
  g.add(head);
  return g;
}

/** 长椅 */
function buildBench() {
  const g = new THREE.Group();
  const wood = mm(0x8a6a48, 0.8);
  const iron = mm(0x3a3e42, 0.5, 0.5);
  for (const z of [-0.2, 0, 0.2]) g.add(box(1.8, 0.06, 0.14, wood, 0, 0.45, z));
  for (const z of [-0.22, 0.22]) g.add(box(0.08, 0.45, 0.5, iron, -0.8, 0.22, z));
  for (const z of [-0.22, 0.22]) g.add(box(0.08, 0.45, 0.5, iron, 0.8, 0.22, z));
  for (const y of [0.62, 0.78]) g.add(box(1.8, 0.06, 0.1, wood, 0, y, -0.3));
  g.add(box(0.08, 0.4, 0.08, iron, -0.8, 0.6, -0.3));
  g.add(box(0.08, 0.4, 0.08, iron, 0.8, 0.6, -0.3));
  return g;
}

/** 圆形喷泉 */
function buildFountain(p) {
  const g = new THREE.Group();
  const R = num(p.radius, 3.2);
  const stone = mm(0xc9c4b8, 0.8);
  g.add(cyl(R, R + 0.2, 0.55, stone, 28, 0, 0.27, 0));
  g.add(tor(R - 0.1, 0.14, stone, 0, 0.56, 0));
  g.add(cyl(R - 0.25, R - 0.25, 0.4, mm(0x6fb3d9, 0.25, 0.1, { transparent: true, opacity: 0.85 }), 28, 0, 0.5, 0));
  g.add(cyl(0.35, 0.5, 1.4, stone, 12, 0, 1.2, 0));
  g.add(cyl(0.9, 0.15, 0.3, stone, 14, 0, 1.95, 0));
  g.add(sph(0.28, stone, 0, 2.2, 0));
  return g;
}

/** 路牌 */
function buildSign(p) {
  const g = new THREE.Group();
  const W = num(p.width, 1.6), H = num(p.height, 3);
  g.add(cyl(0.06, 0.08, H, mm(0x8d949c, 0.5, 0.6), 8, 0, H / 2, 0));
  const neon = p.kind === 'neon';
  const face = neon
    ? mm(0x18222c, 0.4, 0.2, { emissive: 0x37d6ff, emissiveIntensity: 0.9 })
    : mm(0x2f7a4a, 0.6);
  g.add(box(W, H * 0.42, 0.08, face, 0, H - H * 0.24, 0));
  if (!neon) g.add(box(W * 0.8, 0.06, 0.1, mm(0xe8e4da, 0.6), 0, H - H * 0.24, 0.02));
  return g;
}

/** 轿车 / SUV */
function buildCar(p) {
  const g = new THREE.Group();
  const color = p.color || '#dfe4e8';
  const suv = p.kind === 'suv';
  const body = mm(color, 0.4, 0.3);
  const dark = mm(0x22262b, 0.3, 0.4);
  const L = suv ? 4.7 : 4.4, W = 1.9;
  g.add(box(L, 0.55, W, body, 0, 0.62, 0));
  const cabH = suv ? 0.85 : 0.7;
  g.add(box(suv ? L * 0.7 : L * 0.55, cabH, W * 0.9, dark, suv ? -0.1 : -0.2, 0.62 + 0.28 + cabH / 2, 0));
  const wheel = mm(0x17191c, 0.7);
  for (const [x, z] of [[L * 0.32, W / 2], [L * 0.32, -W / 2], [-L * 0.32, W / 2], [-L * 0.32, -W / 2]]) {
    const w = cyl(0.34, 0.34, 0.24, wheel, 12, x, 0.34, z);
    w.rotation.x = Math.PI / 2; g.add(w);
  }
  if (p.lights) {
    g.add(box(0.12, 0.16, 0.4, mm(0xfff6d8, 0.3, 0.1, { emissive: 0xfff2c0, emissiveIntensity: 1.2 }), L / 2 - 0.02, 0.66, W * 0.3));
    g.add(box(0.12, 0.16, 0.4, mm(0xfff6d8, 0.3, 0.1, { emissive: 0xfff2c0, emissiveIntensity: 1.2 }), L / 2 - 0.02, 0.66, -W * 0.3));
    g.add(box(0.1, 0.14, 0.4, mm(0xd94a3d, 0.4, 0.1, { emissive: 0xd94a3d, emissiveIntensity: 0.9 }), -L / 2 + 0.02, 0.66, W * 0.3));
    g.add(box(0.1, 0.14, 0.4, mm(0xd94a3d, 0.4, 0.1, { emissive: 0xd94a3d, emissiveIntensity: 0.9 }), -L / 2 + 0.02, 0.66, -W * 0.3));
  }
  return g;
}

/** 公交车 */
function buildBus(p) {
  const g = new THREE.Group();
  const color = p.color || '#c9a227';
  const body = mm(color, 0.45, 0.25);
  g.add(box(10.5, 2.2, 2.4, body, 0, 1.6, 0));
  g.add(box(10.2, 0.9, 2.46, mm(0x9fc4d8, 0.15, 0.3, { transparent: true, opacity: 0.8 }), 0, 2.3, 0));
  g.add(box(10.6, 0.3, 2.5, mm(0x2c3138, 0.6), 0, 2.85, 0));
  const wheel = mm(0x17191c, 0.7);
  for (const x of [3.6, -3.6, -2.4]) for (const z of [1.2, -1.2]) {
    const w = cyl(0.45, 0.45, 0.3, wheel, 12, x, 0.45, z);
    w.rotation.x = Math.PI / 2; g.add(w);
  }
  g.add(box(0.1, 0.5, 1.8, mm(0xfff6d8, 0.3, 0.1, { emissive: 0xfff2c0, emissiveIntensity: 1 }), 5.28, 1, 0));
  return g;
}

/** 交通锥 */
function buildCone() {
  const g = new THREE.Group();
  g.add(box(0.5, 0.06, 0.5, mm(0x2c3138, 0.7), 0, 0.03, 0));
  g.add(cyl(0.02, 0.24, 0.7, mm(0xe8621f, 0.6), 10, 0, 0.4, 0));
  g.add(cyl(0.13, 0.17, 0.16, mm(0xf0ece2, 0.6), 10, 0, 0.42, 0));
  return g;
}

/** 水马围挡 */
function buildBarrier(p) {
  const g = new THREE.Group();
  const L = num(p.length, 6);
  const segs = Math.min(10, Math.max(2, Math.round(L / 1.2)));
  for (let i = 0; i < segs; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / segs;
    const c = i % 2 ? 0xe8e4da : 0xd94a3d;
    g.add(box(L / segs, 0.5, 0.45, mm(c, 0.6), x, 0.75, 0));
    g.add(box(L / segs, 0.4, 0.5, mm(i % 2 ? 0xd94a3d : 0xe8e4da, 0.6), x, 0.3, 0));
  }
  g.add(box(L, 0.1, 0.7, mm(0x2c3138, 0.7), 0, 0.05, 0));
  return g;
}

/** 木箱 */
function buildCrate() {
  const g = new THREE.Group();
  g.add(box(1.1, 1.1, 1.1, mm(0xa5814f, 0.85), 0, 0.55, 0));
  const plank = mm(0x8a6a42, 0.85);
  g.add(box(1.14, 0.12, 1.14, plank, 0, 0.95, 0));
  g.add(box(1.14, 0.12, 1.14, plank, 0, 0.18, 0));
  g.add(box(0.12, 1.14, 1.14, plank, 0.3, 0.55, 0));
  return g;
}

/** 垃圾桶 */
function buildTrash() {
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.36, 0.85, mm(0x4a5258, 0.6, 0.3), 14, 0, 0.43, 0));
  g.add(cyl(0.34, 0.34, 0.1, mm(0x3a3e42, 0.5, 0.4), 14, 0, 0.9, 0));
  g.add(tor(0.3, 0.03, mm(0x8d949c, 0.4, 0.6), 0, 0.86, 0));
  return g;
}

// ===========================================================================
// 组 3：char —— 人物（构建器来自 character.js，这里是模型库条目封装）
// ===========================================================================
function humanItem(name, defaults) {
  return {
    type: 'human', name, icon: 'char', anim: true,
    build: (p) => buildHuman({ ...defaults, ...p }),
    params: [
      PC('top', '上衣色', defaults.top || '#3d5a75'),
      PS('hairStyle', '发型', [{ v: 'short', l: '短发' }, { v: 'long', l: '长发' }], defaults.hairStyle || 'short'),
      PR('height', '身高 m', 1.0, 2.0, 0.05, defaults.height || 1.75),
      ANIM_PS(defaults.anim || 'idle'),
    ],
  };
}

// ===========================================================================
// 导出
// ===========================================================================
export const GROUP_BUILDING = {
  cat: '城市建筑', id: 'building',
  items: [
    { type: 'tower', name: '玻璃幕墙写字楼', icon: 'building', build: buildTower, params: [
      PI('floors', '层数', 6, 40, 1, 20), PR('width', '宽 m', 10, 34, 1, 18), PR('depth', '深 m', 10, 30, 1, 16),
      PB('podium', '裙楼', true), PB('crown', '顶部冠顶', false), PI('seed', '种子', 1, 40, 1, 21), PR('lit', '亮灯比例', 0, 1, 0.05, 0.3),
    ] },
    { type: 'residential', name: '住宅板楼', icon: 'building', build: buildResidential, params: [
      PI('floors', '层数', 5, 18, 1, 12), PR('length', '长 m', 16, 60, 1, 36), PR('depth', '进深 m', 9, 18, 0.5, 12),
      PC('wall', '墙色', '#b8ae9e'), PR('lit', '亮灯比例', 0, 1, 0.05, 0.25),
    ] },
    { type: 'shophouse', name: '沿街商铺', icon: 'building', build: buildShophouse, params: [
      PI('floors', '层数', 1, 5, 1, 3), PR('width', '宽 m', 10, 30, 1, 20), PR('depth', '深 m', 8, 16, 0.5, 11),
      PC('signColor', '招牌色', '#ff3b6b'), PC('awning', '遮阳篷色', '#2f6d55'),
    ] },
    { type: 'house', name: '独栋住宅', icon: 'building', build: buildCityHouse, params: [
      PR('width', '宽 m', 6, 14, 0.5, 9), PR('depth', '深 m', 5, 12, 0.5, 7.5),
    ] },
    { type: 'cluster', name: '城市楼群', icon: 'building', build: buildCluster, params: [
      PI('count', '楼数', 4, 30, 1, 16), PR('gap', '间距 m', 16, 50, 1, 34),
      PI('min', '最低 m', 4, 20, 1, 8), PI('max', '最高 m', 24, 60, 1, 44),
      PI('seed', '种子', 1, 40, 1, 11), PR('lit', '亮灯比例', 0, 1, 0.05, 0.3),
    ] },
    { type: 'colonnade', name: '柱廊门厅', icon: 'building', build: buildColonnade, params: [
      PI('cols', '柱数', 3, 10, 1, 6), PR('spacing', '柱距 m', 2, 6, 0.1, 3.8), PR('height', '柱高 m', 3, 10, 0.1, 6.6),
    ] },
    { type: 'stairs', name: '大台阶', icon: 'building', build: buildStairs, params: [
      PI('steps', '级数', 3, 12, 1, 7), PR('width', '宽 m', 6, 16, 0.5, 11),
      PR('rise', '级高 m', 0.1, 0.35, 0.01, 0.19), PR('run', '踏面 m', 0.25, 0.6, 0.01, 0.42), PB('marble', '大理石面', true),
    ] },
    { type: 'billboard', name: '户外广告屏', icon: 'building', build: buildBillboard, params: [
      PR('width', '屏宽 m', 6, 16, 0.5, 11), PR('height', '屏高 m', 3, 10, 0.5, 6),
      PR('leg', '立柱高 m', 3, 12, 0.5, 7), PR('bright', '亮度', 0.2, 2, 0.1, 1.4), PI('seed', '配色种子', 1, 40, 1, 7),
    ] },
    { type: 'overpass', name: '高架立交', icon: 'bridgecn', build: buildOverpass, params: [
      PR('length', '长度 m', 60, 240, 5, 150), PR('width', '宽 m', 8, 16, 0.5, 11),
      PR('height', '净高 m', 5, 14, 0.5, 8.5), PR('span', '墩距 m', 15, 40, 1, 26),
    ] },
  ],
};

export const GROUP_ENV = {
  cat: '环境道具', id: 'env',
  items: [
    { type: 'road', name: '沥青路面', icon: 'road', build: buildEnvRoad, params: [
      PR('width', '宽 m', 6, 24, 0.5, 15), PR('length', '长 m', 30, 300, 5, 190),
    ] },
    { type: 'walk', name: '人行道', icon: 'road', build: buildWalk, params: [
      PR('width', '宽 m', 3, 12, 0.5, 7), PR('length', '长 m', 30, 300, 5, 190),
    ] },
    { type: 'tree', name: '行道树', icon: 'bush', build: buildEnvTree, params: [
      PR('height', '高 m', 3, 12, 0.5, 6),
      PS('kind', '树形', [{ v: 'tall', l: '高伞' }, { v: 'round', l: '圆冠' }, { v: 'cone', l: '锥形' }], 'tall'),
    ] },
    { type: 'lamp', name: '路灯', icon: 'clock', build: buildLamp, params: [
      PR('height', '高 m', 4, 9, 0.5, 6.5), PR('glow', '灯光亮度', 0, 1, 0.05, 0.25),
    ] },
    { type: 'bench', name: '长椅', icon: 'chair', build: buildBench, params: [] },
    { type: 'fountain', name: '圆形喷泉', icon: 'fountain', build: buildFountain, params: [
      PR('radius', '半径 m', 1.5, 6, 0.1, 3.2),
    ] },
    { type: 'sign', name: '路牌', icon: 'clock', build: buildSign, params: [
      PS('kind', '样式', [{ v: 'plain', l: '路牌' }, { v: 'neon', l: '霓虹' }], 'neon'),
      PR('width', '宽 m', 1, 3, 0.1, 1.6), PR('height', '高 m', 2, 4, 0.1, 3),
    ] },
    { type: 'car', name: '轿车', icon: 'car', build: buildCar, params: [
      PC('color', '车身色', '#dfe4e8'),
      PS('kind', '车型', [{ v: 'sedan', l: '轿车' }, { v: 'suv', l: 'SUV' }], 'sedan'),
      PB('lights', '车灯亮', false),
    ] },
    { type: 'bus', name: '公交车', icon: 'bus', build: buildBus, params: [
      PC('color', '车身色', '#c9a227'),
    ] },
    { type: 'cone', name: '交通锥', icon: 'barrier', build: buildCone, params: [] },
    { type: 'barrier', name: '水马围挡', icon: 'barrier', build: buildBarrier, params: [
      PR('length', '长 m', 2, 12, 0.5, 6),
    ] },
    { type: 'crate', name: '木箱', icon: 'box', build: buildCrate, params: [] },
    { type: 'trash', name: '垃圾桶', icon: 'trash', build: buildTrash, params: [] },
  ],
};

export const GROUP_CHAR = {
  cat: '人物', id: 'char',
  items: [
    humanItem('男性', { top: '#3d5a75', anim: 'walk' }),
    humanItem('女性', { top: '#b6543f', hairStyle: 'long', anim: 'idle' }),
    humanItem('儿童', { top: '#e8b23a', height: 1.25, anim: 'run' }),
    humanItem('施工人员', { top: '#d8a12a', anim: 'point' }),
    humanItem('西装商务', { top: '#2c3138', anim: 'phone' }),
    {
      type: 'crowd', name: '人群', icon: 'char', anim: true,
      build: (p) => buildCrowd({ ...p }),
      params: [
        PI('count', '人数', 4, 30, 1, 14), PR('radius', '活动半径 m', 3, 15, 0.5, 7),
        PI('seed', '种子', 1, 40, 1, 6),
        ANIM_PS('talk'),
      ],
    },
  ],
};

export const GROUPS_CITY = [GROUP_BUILDING, GROUP_ENV, GROUP_CHAR];
