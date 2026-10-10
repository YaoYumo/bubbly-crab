// ---------------------------------------------------------------------------
// 建筑构件：墙 / 窗 / 门 / 屋顶 / 天花板 / 楼梯（每种 2-3 个变体）
// 全部程序化生成（纯 box / extrude，无外部资源），用于「搭一栋能进的画面」：
//   墙带门窗洞、门能开、屋顶能盖、天花板会被楼梯自动开孔（见 App.updateCeilingHoles）
// 约定：所有构件的原点都在「底面中心」，+Y 朝上；楼梯沿局部 +Z 上行。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { M, shade, box, cyl, sph, planeXZ, row, roofSurf } from './geo.js';
import { Q } from './detail.js';
import { clamp, makeRng } from './util.js';

const PI = (k, l, min, max, step, def, help) => ({ k, l, t: 'int', min, max, step, def, help });
const PR = (k, l, min, max, step, def, help) => ({ k, l, t: 'range', min, max, step, def, help });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'select', opts, def });
// 参数可能来自旧工程 / 别的构件行（没声明的键）——统一兜底，别让它变成 NaN
const n0 = (v, d, lo = -1e6, hi = 1e6) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : d));
const b0 = (v, d = false) => (typeof v === 'boolean' ? v : Number.isFinite(v) ? v > 0.02 : d);

// ============================ 墙 ==========================================
/**
 * 带洞口的直墙：把 [门洞 + 若干窗洞] 按 X 排布，剩下的是墙垛 / 窗下墙 / 过梁。
 * 输出 { group, len } —— 供「直墙 / 转角墙」复用。
 */
function wallRun(p, mat, opt = {}) {
  const L = Math.max(0.6, n0(p.length, 6, 0.6, 80)), H = Math.max(0.4, n0(p.height, 3, 0.4, 30)), T = Math.max(0.06, n0(p.thick, 0.24, 0.06, 2));
  const g = new THREE.Group();
  const hasDoor = b0(p.door);
  const glaze = b0(p.glass, true);
  const n = Math.round(n0(p.wins, 0, 0, 8));
  const winW = n0(p.winW, 1.2, 0.3, L * 0.6), winH = n0(p.winH, 1.2, 0.2, H);
  const sill = n0(p.sill, 0.9, 0, Math.max(0, H - winH - 0.06));
  const dw = n0(p.doorW, 1.1, 0.4, L * 0.7), dh = n0(p.doorH, 2.2, 0.6, H);
  const lt = n0(p.lintel, 0, 0, 1);
  // 把墙长均分成 (窗数 + 门占位) 格，门窗各自坐在格心：这样无论参数怎么调都不会互相吞掉
  const cells = n + (hasDoor ? 1 : 0) || 1;
  const seg = L / cells;
  const xs = [];
  for (let i = 0; i < cells; i++) xs.push(-L / 2 + seg * (i + 0.5));
  const open = [];
  let doorIdx = -1;
  if (hasDoor) {
    const want = -L / 2 + n0(p.doorPos, 0.5, 0, 1) * L;
    let best = 1e9;
    xs.forEach((x, i) => { const d = Math.abs(x - want); if (d < best) { best = d; doorIdx = i; } });
    open.push({ w: Math.min(dw, seg * 0.95), b: 0, t: Math.min(H, dh), x: xs[doorIdx], door: true });
  }
  const free = xs.filter((_, i) => i !== doorIdx);
  for (let i = 0; i < n && i < free.length; i++) open.push({ w: Math.min(winW, seg * 0.8), b: sill, t: Math.min(H, sill + winH), x: free[i] });
  open.sort((a, b) => a.x - b.x);
  // 墙垛：洞口之间与两端
  let cur = -L / 2;
  const pier = (from, to) => {
    const w = to - from;
    if (!(w > 0.04)) return;
    g.add(box(w, H, T, mat, (from + to) / 2, H / 2, 0));
  };
  for (const o of open) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2;
    pier(cur, x0);
    if (o.b > 0.02) g.add(box(o.w, o.b, T, mat, o.x, o.b / 2, 0));                        // 窗下墙
    const lintel = H - o.t;
    if (lintel > 0.02) g.add(box(o.w, lintel, T, mat, o.x, o.t + lintel / 2, 0));        // 过梁
    if (lt > 0.02) g.add(box(o.w + 0.16, lt, T + 0.06, mat, o.x, Math.min(H, o.t + lt / 2), 0));   // 突出腰线
    if (Q.level !== 'lite') {
      // 洞口不是「空气洞」：补上砌体内壁、窗台出挑与玻璃，斜看时洞口的厚度要读得出来
      const oh = Math.max(0.06, o.t - o.b), oy = o.b + oh / 2, rev = 0.03;
      g.add(box(o.w + rev, rev, T, mat, o.x, o.t - rev / 2, 0));                          // 洞口顶
      if (o.b > 0.02) g.add(box(o.w + rev, rev, T, mat, o.x, o.b + rev / 2, 0));           // 洞口底
      g.add(box(rev, oh, T, mat, x0 + rev / 2, oy, 0));
      g.add(box(rev, oh, T, mat, x1 - rev / 2, oy, 0));
      g.add(box(o.w + 0.16, 0.05, T + 0.13, mat, o.x, Math.max(0.01, o.b - 0.006), 0));     // 窗台板外挑（门洞处即门槛石）
      if (!o.door && glaze) {
        const gl = opt.glass || M.glassy(0x2f4a5c, 0.12, 0.5, 0.44);
        g.add(box(Math.max(0.06, o.w - 0.1), Math.max(0.06, oh - 0.1), 0.018, gl, o.x, oy, -T * 0.16));
      }
    }
    cur = Math.max(cur, x1);
  }
  pier(cur, L / 2);
  if (Q.level !== 'lite' && H > 0.6 && b0(p.plinth, true)) {
    g.add(box(L, 0.14, T + 0.06, M.stone(0x8d8880, 0.94), 0, 0.07, 0));                   // 墙基/勒脚
  }
  return { g, open, len: L, h: H, t: T };
}
function buildWall(p) {
  const g = new THREE.Group();
  const mat = M.paint(new THREE.Color(p.color).getHex(), p.rough ?? 0.85);
  const { g: run, len, h, t } = wallRun(p, mat);
  g.add(run);
  if (b0(p.top)) g.add(box(len + 0.12, 0.12, t + 0.12, M.paint(new THREE.Color(p.color).getHex(), 0.8), 0, h + 0.06, 0, 0.04));   // 压顶：带倒角
  g.userData.wall = { len, h, t };
  return shade(g);
}
function buildWallCorner(p) {
  const g = new THREE.Group();
  const mat = M.paint(new THREE.Color(p.color).getHex(), 0.85);
  const a = { ...p, length: n0(p.lenA, 6, 1, 60), wins: b0(p.door) ? 0 : Math.round(n0(p.wins, 1, 0, 6)), door: false };
  const b = { ...p, length: n0(p.lenB, 5, 1, 60), wins: 0, door: false, lintel: 0 };
  const ra = wallRun(a, mat).g;
  ra.position.set(n0(p.lenA, 6, 1, 60) / 2, 0, 0);
  const rb = wallRun(b, mat).g;
  rb.rotation.y = Math.PI / 2;
  rb.position.set(0, 0, -n0(p.lenB, 5, 1, 60) / 2);
  g.add(ra, rb);
  g.add(box(0.16, p.height, 0.16, mat, 0.02, p.height / 2, -0.02));                        // 转角柱
  g.position.set(-n0(p.lenA, 6, 1, 60) / 2, 0, n0(p.lenB, 5, 1, 60) / 2);                                               // 让原点回到内角
  return shade(g);
}
function buildWallCrenel(p) {
  const g = new THREE.Group();
  const mat = M.stone(new THREE.Color(p.color).getHex(), 0.92);
  const L = Math.max(1, p.length), H = Math.max(0.4, p.height), T = Math.max(0.12, p.thick);
  g.add(box(L, H, T, mat, 0, H / 2, 0));
  const n = Math.round(clamp(p.merlons, 1, 40));
  const w = Math.max(0.2, (L / (n * 2 - 1)));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + w / 2 + i * w * 2;
    g.add(box(w, clamp(p.merlonH, 0.1, 2), T, mat, x, H + clamp(p.merlonH, 0.1, 2) / 2, 0));
  }
  if (p.walk) g.add(box(L - T, 0.08, T * 2.4, M.stone(new THREE.Color(p.color).getHex(), 0.95), 0, H + 0.04, 0));  // 马道
  return shade(g);
}

// ============================ 窗 ==========================================
function winFrame(w, h, t, mat) {
  const g = new THREE.Group();
  const f = 0.07;
  g.add(box(w, f, t, mat, 0, h - f / 2, 0));
  g.add(box(w, f, t, mat, 0, f / 2, 0));
  g.add(box(f, h, t, mat, -w / 2 + f / 2, h / 2, 0));
  g.add(box(f, h, t, mat, w / 2 - f / 2, h / 2, 0));
  return g;
}
function buildWindowSliding(p) {
  const g = new THREE.Group();
  const w = Math.max(0.4, p.w), h = Math.max(0.4, p.h);
  const fr = M.paint(new THREE.Color(p.frame).getHex(), 0.55);
  const glass = M.glassy(new THREE.Color(p.glass).getHex(), 0.1, 0.4, 0.42);
  const t = Math.max(0.05, p.thick);
  g.add(winFrame(w, h, t, fr));
  g.add(box(0.05, h, t * 1.1, fr, 0, h / 2, 0));                                            // 中挺
  const paneW = w / 2 - 0.1;
  const s = clamp(p.slide, 0, 1) * paneW * 0.7;
  g.add(box(paneW, h - 0.16, 0.03, glass, -w / 4 - s * 0.15, h / 2, -s * 0.12));           // 固定扇
  const mv = box(paneW, h - 0.16, 0.03, glass, w / 4 + s * 0.4, h / 2, s * 0.12);          // 滑开的扇
  g.add(mv);
  g.add(box(w + 0.16, 0.06, t + 0.14, fr, 0, -0.03, 0));                                    // 窗台
  if (Q.level !== 'lite') {
    for (const px of [-w / 4 - s * 0.15, w / 4 + s * 0.4]) {                                   // 每扇的上下冒头
      g.add(box(paneW, 0.05, 0.055, fr, px, h - 0.1, 0.008));
      g.add(box(paneW, 0.05, 0.055, fr, px, 0.1, 0.008));
    }
    g.add(box(0.032, 0.17, 0.05, M.metal(0xb9c0c7, 0.35, 0.8), 0.03, h * 0.46, t * 0.45));    // 执手
  }
  if (p.bar > 0) for (let i = 0; i < 3; i++) g.add(box(0.03, h - 0.16, 0.03, M.metal(0x8b9299, 0.4, 0.7), -w / 3 + (i * w) / 3, h / 2, t * 0.6 * p.bar));
  return shade(g);
}
function buildWindowArch(p) {
  const g = new THREE.Group();
  const w = Math.max(0.4, p.w), h = Math.max(0.6, p.h);
  const fr = M.stone(new THREE.Color(p.frame).getHex(), 0.9);
  const glass = M.glassy(new THREE.Color(p.glass).getHex(), 0.12, 0.35, 0.5);
  const r = w / 2;
  g.add(winFrame(w, h - r, Math.max(0.06, p.thick), fr));
  const arc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(0.06, p.thick), 14, 1, true, 0, Math.PI), fr.clone());
  arc.material.side = THREE.DoubleSide;
  arc.rotation.x = -Math.PI / 2;
  arc.position.y = h - r;
  g.add(arc);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0, Math.PI), glass);
  disc.position.set(0, h - r, 0);                        // CircleGeometry 本就在 XY 面：正好立在墙里，不用旋转
  g.add(disc);
  const pane = box(w - 0.14, h - r - 0.14, 0.03, glass, 0, (h - r) / 2, 0);
  g.add(pane);
  const nt = Math.max(1, Math.round(p.mullions));
  for (let i = 1; i < nt; i++) {
    const x = -w / 2 + (i * w) / nt;
    // 竖挺顶端必须收在券弧以内：直接给到 h-0.2 会穿出圆券，看着像一根梁横在拱心
    const top = Math.min(h - 0.08, h - r + Math.sqrt(Math.max(0, r * r - x * x)) - 0.05);
    if (top < 0.22) continue;
    g.add(box(0.045, top - 0.05, Math.max(0.06, p.thick) * 0.55, fr, x, (top + 0.05) / 2, 0));   // 与玻璃同厚、居中在同一平面
  }
  for (const a0 of [Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4]) {                                // 券内放射状窗棂
    const bar = box(0.04, r * 0.92, Math.max(0.05, p.thick) * 0.45, fr, Math.cos(a0) * r * 0.5, h - r + Math.sin(a0) * r * 0.5, 0);
    bar.rotation.z = a0 - Math.PI / 2;
    g.add(bar);
  }
  g.add(box(w + 0.2, 0.07, Math.max(0.06, p.thick) + 0.14, fr, 0, -0.035, 0));
  return shade(g);
}
function buildWindowLouver(p) {
  const g = new THREE.Group();
  const w = Math.max(0.4, p.w), h = Math.max(0.4, p.h);
  const mat = M.paint(new THREE.Color(p.frame).getHex(), 0.6);
  g.add(winFrame(w, h, Math.max(0.05, p.thick), mat));
  const n = Math.round(clamp(p.slats, 3, 40));
  const ang = (clamp(p.angle, 0, 80) * Math.PI) / 180;
  const back = M.dark(0x1b2026, 0.9);
  g.add(box(w - 0.1, h - 0.1, 0.02, back, 0, h / 2, -Math.max(0.05, p.thick) * 0.45));
  const slats = row((i) => {
    const s = box(w - 0.14, (h / n) * 1.5, 0.02, mat, 0, 0, 0);
    s.rotation.x = ang;
    return s;
  }, n, h - 0.12, 'z');
  slats.children.forEach((c, i) => { c.position.set(0, 0.06 + (i * (h - 0.12)) / n, 0.02); c.rotation.set(ang, 0, 0); });
  g.add(slats);
  return shade(g);
}

// ============================ 门 ==========================================
function doorFrame(w, h, t, mat) {
  const g = new THREE.Group();
  g.add(box(w + 0.16, 0.09, t + 0.06, mat, 0, h + 0.045, 0));
  g.add(box(0.08, h, t, mat, -w / 2 - 0.04, h / 2, 0));
  g.add(box(0.08, h, t, mat, w / 2 + 0.04, h / 2, 0));
  return g;
}
function leaf(w, h, t, mat, color) {
  const g = new THREE.Group();
  g.add(box(w, h, t, mat, w / 2, h / 2, 0));
  g.add(box(w * 0.7, h * 0.34, t * 0.6, M.paint(new THREE.Color(color).getHex(), 0.5), w / 2, h * 0.66, t * 0.3));
  g.add(box(w * 0.7, h * 0.28, t * 0.6, M.paint(new THREE.Color(color).getHex(), 0.5), w / 2, h * 0.24, t * 0.3));
  return g;
}
function buildDoorSingle(p) {
  const g = new THREE.Group();
  const w = Math.max(0.5, p.w), h = Math.max(0.8, p.h), t = Math.max(0.05, p.thick);
  const fr = M.paint(new THREE.Color(p.frame).getHex(), 0.6);
  const dm = M.paint(new THREE.Color(p.color).getHex(), 0.55);
  g.add(doorFrame(w, h, t, fr));
  const open = new THREE.Group();
  open.position.set(-w / 2, 0, 0);
  open.rotation.y = -(clamp(p.open, 0, 110) * Math.PI) / 180;
  const lf = leaf(w, h - 0.06, t * 0.9, dm, p.color);
  lf.children.push(box(0.05, 0.24, 0.16, M.metal(0xc9b26a, 0.3, 0.8), w - 0.12, h * 0.46, t * 0.8));
  open.add(lf);
  g.add(open);
  if (p.transom) g.add(box(w, 0.06, t, fr, 0, h * 0.78, 0));
  return shade(g);
}
function buildDoorDouble(p) {
  const g = new THREE.Group();
  const w = Math.max(0.8, p.w), h = Math.max(0.8, p.h), t = Math.max(0.05, p.thick);
  const fr = M.paint(new THREE.Color(p.frame).getHex(), 0.6);
  const dm = M.paint(new THREE.Color(p.color).getHex(), 0.55);
  g.add(doorFrame(w, h, t, fr));
  const half = w / 2;
  for (const sgn of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sgn * half, 0, 0);
    pivot.rotation.y = sgn * (clamp(p.open, 0, 110) * Math.PI) / 180;
    const lf = leaf(half - 0.02, h - 0.06, t * 0.9, dm, p.color);
    // leaf() 的几何本来就从「门轴原点」向 +x 铺开；再位移一个门宽就会跨过中线压到另一扇上
    lf.position.x = 0;
    lf.rotation.y = sgn < 0 ? 0 : Math.PI;
    for (const sz of [1, -1]) pivot.add(box(0.05, 0.24, 0.13, M.metal(0xb9c0c7, 0.35, 0.85), -sgn * (half - 0.17), h * 0.46, sz * (t * 0.45 + 0.07)));
    g.add(pivot);
  }
  g.add(box(w + 0.3, 0.05, t + 0.3, fr, 0, 0.025, 0));                                      // 门槛
  return shade(g);
}
function buildDoorRoll(p) {
  const g = new THREE.Group();
  const w = Math.max(1, p.w), h = Math.max(1.2, p.h);
  const steel = M.metal(new THREE.Color(p.color).getHex(), 0.5, 0.6);
  g.add(box(w + 0.3, 0.18, 0.34, steel, 0, h + 0.22, 0));                                   // 帘箱
  g.add(box(0.14, h + 0.3, 0.26, steel, -w / 2 - 0.1, (h + 0.3) / 2, 0));
  g.add(box(0.14, h + 0.3, 0.26, steel, w / 2 + 0.1, (h + 0.3) / 2, 0));
  const open = clamp(p.open, 0, 1);
  // 帘子永远从顶部帘箱垂下来：卷起比例越大，下面让开的通行口越高（旧版是反的 —— 上半空着、下半堵死）
  const bottom = h * open;                       // 帘板下沿标高 = 净空高
  const show = h - bottom;
  const drum = cyl(0.15, 0.15, w * 0.98, steel, 10, 0, h + 0.06, 0);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  if (show > 0.06) {
    const n = Math.max(2, Math.round(show / 0.16));
    const slats = row((i) => box(w, 0.15, 0.05, i % 2 ? M.metal(0x9aa2ab, 0.45, 0.6) : steel, 0, 0, 0), n, 0.001, 'x');
    slats.children.forEach((c, i) => { c.position.set(0, h - 0.07 - (i * show) / n, 0.02); });
    g.add(slats);
    g.add(box(w + 0.06, 0.07, 0.1, M.metal(0x6e757d, 0.5, 0.6), 0, bottom + 0.03, 0.05));    // 帘板下沿拉手
    for (const sx of [-1, 1]) g.add(box(0.05, 0.5, 0.05, M.metal(0x6e757d, 0.5, 0.6), sx * (w / 2 - 0.2), bottom - 0.2, 0.05));   // 拉手指扣
  }
  if (p.mark) {
    // 地面标线：贴地薄条，按门洞全宽，不进墙里
    for (const sz of [0.34, 0.74]) g.add(box(w + 0.2, 0.012, 0.1, M.paint(0xd9c04a, 0.8), 0, 0.008, sz));
    for (const sx of [-1, 1]) g.add(box(0.1, 0.012, 0.5, M.paint(0xd9c04a, 0.8), sx * (w / 2 + 0.05), 0.008, 0.54));
  }
  return shade(g);
}

// ============================ 屋顶 ==========================================
function buildRoofGable(p) {
  const g = new THREE.Group();
  const w = Math.max(1, p.w), d = Math.max(1, p.d), rise = Math.max(0.2, p.rise);
  const ov = Math.max(0, p.overhang);
  const mat = roofSurf(new THREE.Color(p.color).getHex(), 0.72);
  const len = Math.hypot(d / 2 + ov, rise);
  const ang = Math.atan2(rise, d / 2 + ov);
  for (const sgn of [-1, 1]) {
    const s = box(w + ov * 2, 0.09, len, mat, 0, rise / 2, sgn * (d / 2 + ov) / 2);
    s.rotation.x = sgn * ang;          // +z 侧：绕 x 正角 → 面法线朝上朝外、外沿落到檐口（旧版取反，两块板在脊上互相穿）
    g.add(s);
  }
  g.add(box(w + ov * 2 + 0.1, 0.14, 0.22, roofSurf(new THREE.Color(p.color).getHex(), 0.7), 0, rise + 0.04, 0));   // 正脊
  if (p.gable) for (const sgn of [-1, 1]) {                                                   // 山墙
    const tri = new THREE.Shape();
    tri.moveTo(-d / 2 - ov, 0); tri.lineTo(d / 2 + ov, 0); tri.lineTo(0, rise); tri.closePath();
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, M.paint(new THREE.Color(p.wall).getHex(), 0.86));
    m.position.set(sgn * (w / 2 + (sgn > 0 ? 0 : 0)), 0, 0);
    m.position.x = sgn * (w / 2 + 0.04);
    g.add(m);
  }
  if (p.eave) for (const sgn of [-1, 1]) {                                                 // 封檐板：贴在坡面外沿的下口
    const e = box(w + ov * 2, 0.12, 0.06, mat, 0, -0.02, sgn * (d / 2 + ov + 0.02));
    e.rotation.x = sgn * 0.06;
    g.add(e);
  }
  return shade(g);
}
function buildRoofHip(p) {
  const g = new THREE.Group();
  const w = Math.max(1.5, p.w), d = Math.max(1.5, p.d), rise = Math.max(0.3, p.rise);
  const ov = Math.max(0, p.overhang);
  const ridge = Math.max(0.1, w * clamp(p.ridge, 0.02, 0.8) * 2);
  const mat = roofSurf(new THREE.Color(p.color).getHex(), 0.72);
  mat.side = THREE.DoubleSide;
  const quad = (a, b, c, e) => {
    const geo = new THREE.BufferGeometry();
    const v = [a, b, c, a, c, e].map((q) => q.slice());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };
  const W = w / 2 + ov, D = d / 2 + ov, T = rise;
  g.add(quad([-W, 0, D], [W, 0, D], [ridge / 2, T, 0], [-ridge / 2, T, 0]));                 // 前坡
  g.add(quad([W, 0, -D], [-W, 0, -D], [-ridge / 2, T, 0], [ridge / 2, T, 0]));              // 后坡
  const side = (sx) => g.add(quad([sx * W, 0, D], [sx * W, 0, -D], [sx > 0 ? ridge / 2 : -ridge / 2, T, 0], [sx > 0 ? -ridge / 2 : ridge / 2, T, 0]));
  side(-1); side(1);
  g.add(box(ridge + 0.2, 0.12, 0.18, mat, 0, T + 0.05, 0));
  if (p.aileron) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                        // 四个檐角起翘，落在角梁端头上
    const s = box(0.18, 0.14, 0.18, mat, sx * (W - 0.06), 0.07, sz * (D - 0.06));
    s.rotation.z = sx * 0.34; s.rotation.x = sz * 0.34;
    g.add(s);
  }
  g.add(box(w, 0.06, d, M.paint(0x2b2f34, 0.9), 0, 0.02, 0));                               // 屋面板底
  return shade(g, true, false);
}
function buildRoofFlat(p) {
  const g = new THREE.Group();
  const w = Math.max(1, p.w), d = Math.max(1, p.d);
  const mat = M.concrete(new THREE.Color(p.color).getHex(), 0.92);
  g.add(box(w, Math.max(0.08, p.thick), d, mat, 0, -Math.max(0.08, p.thick) / 2, 0));
  const ph = Math.max(0, p.parapet);
  if (ph > 0.02) {
    g.add(box(w + 0.16, ph, 0.14, mat, 0, ph / 2, d / 2 + 0.07));
    g.add(box(w + 0.16, ph, 0.14, mat, 0, ph / 2, -d / 2 - 0.07));
    g.add(box(0.14, ph, d + 0.16, mat, w / 2 + 0.07, ph / 2, 0));
    g.add(box(0.14, ph, d + 0.16, mat, -w / 2 - 0.07, ph / 2, 0));
    g.add(box(w + 0.3, 0.06, 0.3, M.concrete(0xbfc3c7, 0.85), 0, ph + 0.03, 0));             // 压顶（沿四边简化）
  }
  if (p.boxes) {                                                                              // 机房 / 水箱 / 通风
    const rng = makeRng(p.seed);
    for (let i = 0; i < 3; i++) {
      const bw = 1 + rng() * 1.4, bh = 0.5 + rng() * 0.9;
      g.add(box(bw, bh, bw * 0.8, M.metal(0x949ba3, 0.55, 0.4), (rng() - 0.5) * (w - bw - 1), bh / 2, (rng() - 0.5) * (d - bw - 1)));
    }
    g.add(cyl(0.22, 0.22, 1.4, M.metal(0xa7aeb5, 0.5, 0.5), 10, w / 4, 0.7, -d / 4));
  }
  if (p.drain) g.add(box(0.3, 0.04, 0.3, M.dark(0x4a5157, 0.8), w / 2 - 0.4, 0.01, d / 2 - 0.4));
  return shade(g);
}

// ============================ 天花板（可被楼梯开孔）=========================
/** 用 Shape + holes 挤出厚度：holes 是「天花板局部坐标」的多边形列表 [[x,z],...] */
function slabWithHoles(w, d, t, holes, mat) {
  const sh = new THREE.Shape();
  const hw = w / 2, hd = d / 2;
  sh.moveTo(-hw, -hd); sh.lineTo(hw, -hd); sh.lineTo(hw, hd); sh.lineTo(-hw, hd); sh.closePath();
  const seen = [];
  for (const h of holes || []) {
    if (!Array.isArray(h) || h.length < 3) continue;
    let ok = true;
    for (const q of h) if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) ok = false;
    if (!ok) continue;
    const pts = h.map(([x, z]) => [clamp(x, -hw + 0.02, hw - 0.02), clamp(-z, -hd + 0.02, hd - 0.02)]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.06) { ok = false; break; }
    }
    if (!ok) continue;
    const pth = new THREE.Path();
    pth.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) pth.lineTo(pts[i][0], pts[i][1]);
    pth.closePath();
    sh.holes.push(pth);
    seen.push(pts);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return { mesh: new THREE.Mesh(geo, mat), holes: seen };
}
function ceilingBase(p, kind) {
  const g = new THREE.Group();
  const w = Math.max(1, p.w), d = Math.max(1, p.d), t = Math.max(0.04, p.thick);
  const mat = M.paint(new THREE.Color(p.color).getHex(), 0.9);
  const { mesh, holes } = slabWithHoles(w, d, t, p.holes, mat);
  mesh.position.y = -t;
  g.add(mesh);
  if (kind === 'beam') {
    const bm = M.wood(new THREE.Color(p.beamColor).getHex(), 0.8);
    const n = Math.round(clamp(p.beams, 1, 20));
    const bh = Math.max(0.06, p.beamH);
    const along = p.beamAxis === 'z';
    const run = row((i) => box(along ? 0.16 : w, bh, along ? d : 0.16, bm, 0, 0, 0), n, 0.001, 'x');
    run.children.forEach((c, i) => {
      const u = -0.5 + (i + 0.5) / n;
      if (along) c.position.x = u * w; else c.position.z = u * d;   // 排布方向 = 与梁长垂直的那个方向
      c.position.y = -t - bh / 2 + 0.01;
    });
    g.add(run);
  } else if (kind === 'grid') {
    const gm = M.paint(0xdadde0, 0.7);
    const cell = Math.max(0.3, p.cell);
    const nx = Math.max(1, Math.round(w / cell)), nz = Math.max(1, Math.round(d / cell));
    for (let i = 1; i < nx; i++) g.add(box(0.04, 0.06, d, gm, -w / 2 + (i * w) / nx, -t - 0.03, 0));
    for (let i = 1; i < nz; i++) g.add(box(w, 0.06, 0.04, gm, 0, -t - 0.03, -d / 2 + (i * d) / nz));
    if (p.lights) {
      const lm = M.emissive(0xfff2d8, 1.1);
      for (let i = 0; i < Math.min(6, nx * nz); i++) {
        const ix = (i + 1) % nx, iz = 1 + (i % Math.max(1, nz - 1));
        g.add(box(Math.max(0.2, w / nx - 0.3), 0.03, Math.max(0.2, d / nz - 0.3), lm, -w / 2 + (ix * w) / nx, -t - 0.02, -d / 2 + (iz * d) / nz));
      }
    }
  } else if (p.light) {
    const lm = M.emissive(0xfff6e2, 0.9);
    g.add(cyl(Math.max(0.2, w * 0.06), Math.max(0.2, w * 0.06), 0.04, lm, 14, 0, -t - 0.02, 0));
  }
  g.userData.ceiling = true;
  g.userData.ceilingHoles = holes.length;
  if (p.holeEdge > 0) for (const pts of holes) {                                             // 洞口砌边（一眼能看出是留洞不是破洞）
    const em = M.concrete(0xb9bec3, 0.9);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.06) continue;
      const seg = box(len, t + 0.04, p.holeEdge, em, (a[0] + b[0]) / 2, -t / 2, -(a[1] + b[1]) / 2);
      seg.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      g.add(seg);
    }
  }
  return shade(g);
}
function buildCeilingFlat(p) { return ceilingBase(p, 'flat'); }
function buildCeilingBeam(p) { return ceilingBase(p, 'beam'); }
function buildCeilingGrid(p) { return ceilingBase(p, 'grid'); }

// ============================ 楼梯 ==========================================
/** 一段直跑梯：返回 { group, top:{y,z} }，并把洞口写到 root.userData.stairOpen */
function flight(p, mat, rng) {
  const g = new THREE.Group();
  const antiSlip = Q.level !== 'lite';
  const H = Math.max(0.6, p.rise), W = Math.max(0.5, p.w);
  const n = Math.round(clamp(p.steps, 3, 40));
  const tread = Math.max(0.12, p.tread);
  const rail = !!p.rail;
  const rh = 0.9;
  for (let i = 0; i < n; i++) {
    const y = (H * (i + 1)) / n;
    const z = (i + 0.5) * (H / n) * clamp(p.slope, 1.2, 3.2);
    const th = Math.max(0.04, H / n);
    g.add(box(W, th, tread, mat, 0, y - th / 2, z));
    if (Q.level !== 'lite') {
      g.add(box(W + 0.03, 0.024, 0.036, mat, 0, y - th + 0.012, z + tread / 2 + 0.016));   // 踏步鼻线
      if (antiSlip) g.add(box(W * 0.92, 0.006, 0.03, M.dark(0x3a3f45, 0.9), 0, y + 0.001, z + tread / 2 - 0.045));
    }
    if (rail) for (const sx of [-1, 1]) {
      const post = box(0.05, rh, 0.05, M.metal(0x8f979f, 0.4, 0.7), sx * (W / 2 + 0.03), y + rh / 2 - 0.02, z);
      g.add(post);
    }
  }
  const depth = n * (H / n) * clamp(p.slope, 1.2, 3.2);
  if (rail) {
    for (const sx of [-1, 1]) {
      const bar = box(0.06, 0.06, Math.hypot(depth, H), M.metal(0x8f979f, 0.4, 0.7), sx * (W / 2 + 0.03), H / 2 + rh - 0.02, depth / 2, 0.026);   // 圆扶手：倒角
      bar.rotation.x = Math.atan2(H, depth);
      g.add(bar);
    }
  }
  // 梯梁（两侧斜板）：上端竖直切、下端水平落在地面上。
  // 旧版是一整块旋转矩形，两端斜角会戳到地板下 1m，整挂楼梯被「底面贴地」抬起来悬在空中。
  const bh = Math.max(0.14, H * 0.55);
  const zA = Math.min(depth * 0.92, (bh / H) * depth);
  const sp = new THREE.Shape();
  sp.moveTo(0, 0); sp.lineTo(zA, 0); sp.lineTo(depth, H - bh); sp.lineTo(depth, H); sp.closePath();
  const sg = new THREE.ExtrudeGeometry(sp, { depth: 0.1, bevelEnabled: false });
  sg.translate(0, 0, -0.05);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(sg, mat);
    m.rotation.y = -Math.PI / 2;
    m.position.set(sx * (W / 2 + 0.06), 0, 0);
    g.add(m);
  }
  return { g, depth, top: { y: H, z: depth } };
}
function buildStairStraight(p) {
  const g = new THREE.Group();
  const mat = M.paint(new THREE.Color(p.color).getHex(), 0.85);
  const { g: run, depth, top } = flight(p, mat);
  g.add(run);
  if (p.land) g.add(box(Math.max(0.6, p.w) + 0.4, 0.1, Math.max(0.6, p.w) + 0.4, mat, 0, top.y - 0.05, top.z + (Math.max(0.6, p.w) + 0.4) / 2));
  const landD = p.land ? Math.max(0.6, p.w) + 0.4 : 0;
  const full = depth + landD;
  const hl = n0(p.holeLen, 2.4, 0, 20);
  const d = hl > 0.05 ? Math.min(hl, full) : full;
  g.userData.stairOpen = {
    w: Math.max(0.6, p.w) + clamp(p.pad, 0, 1.2),
    d,
    cx: 0,
    cz: full - d / 2,                                                // 洞口贴着梯顶 / 平台，往梯下方向延伸
    y: Math.max(0.6, p.rise) + clamp(p.openUp, 0, 3),
    band: clamp(p.band, 0.6, 6),
  };
  return shade(g);
}
function buildStairSwitch(p) {
  const g = new THREE.Group();
  const mat = M.paint(new THREE.Color(p.color).getHex(), 0.85);
  const H = Math.max(1.2, p.rise), half = H / 2;
  const p1 = { ...p, rise: half, rail: false };
  const A = flight(p1, mat);
  const W = Math.max(0.5, p.w);
  const land = box(W + 0.3, 0.12, W + 0.3, mat, 0, half, A.depth + (W + 0.3) / 2);
  g.add(A.g, land);
  const B = flight(p1, mat);
  const bgrp = new THREE.Group();
  bgrp.add(B.g);
  bgrp.rotation.y = Math.PI;
  bgrp.position.set(W + 0.3, half + 0.06, A.depth + (W + 0.3));
  g.add(bgrp);
  if (p.rail) for (let i = 0; i < 4; i++) g.add(box(0.05, 0.9, 0.05, M.metal(0x8f979f, 0.4, 0.7), -W / 2 - 0.06 + i * 0.02, half * 0.5 + 0.45 + i * half * 0.12, i * 0.4));
  const depth = A.depth * 2 + (W + 0.3);
  const hl2 = n0(p.holeLen, 2.4, 0, 20);
  const end2 = W + 0.3;                                              // 上跑梯顶（走下来进二层的那条边）
  const d2 = hl2 > 0.05 ? Math.min(hl2, depth) : depth;
  g.userData.stairOpen = {
    w: (W + 0.3) * 2 + clamp(p.pad, 0, 1.2),
    d: d2,
    cx: (W + 0.3) / 2,
    cz: end2 - d2 / 2,
    y: H + clamp(p.openUp, 0, 3),
    band: clamp(p.band, 0.6, 6),
  };
  return shade(g);
}
function buildStairSpiral(p) {
  const g = new THREE.Group();
  const mat = M.paint(new THREE.Color(p.color).getHex(), 0.85);
  const H = Math.max(1, p.rise), R = Math.max(0.8, p.r), r0 = Math.max(0.12, p.post);
  const n = Math.round(clamp(p.steps, 6, 60));
  const turn = clamp(p.turn, 0.3, 2) * Math.PI * 2;
  g.add(cyl(r0, r0, H + 0.2, M.metal(0x8f979f, 0.45, 0.6), 12, 0, (H + 0.2) / 2, 0));
  for (let i = 0; i < n; i++) {
    const a = ((i + 1) / n) * turn;
    const y = ((i + 1) / n) * H;
    const step = box(R - r0, Math.max(0.04, H / n * 0.8), Math.max(0.16, (turn * R) / n * 0.55), mat, 0, 0, 0);
    const holder = new THREE.Group();
    holder.rotation.y = -a;
    step.position.set((R + r0) / 2, y - H / n * 0.4, 0);
    holder.add(step);
    g.add(holder);
    if (p.rail) {
      const bal = box(0.04, 0.85, 0.04, M.metal(0x9aa2ab, 0.4, 0.7), 0, 0, 0);
      const bh = new THREE.Group();
      bh.rotation.y = -a;
      bal.position.set(R + 0.02, y + 0.42, 0);
      bh.add(bal);
      g.add(bh);
    }
  }
  g.add(box(0.5, 0.05, 0.5, mat, 0, H + 0.03, 0));                                          // 顶部小平台
  const rr = R + 0.2 + clamp(p.pad, 0, 1.2);
  g.userData.stairOpen = { round: rr, y: H + clamp(p.openUp, 0, 3), band: clamp(p.band, 0.6, 6) };
  return shade(g);
}

// ============================ 素材表 ========================================
const WALL_PARAMS = [PR('length', '长 m', 1, 40, 0.5, 6), PR('height', '高 m', 1, 12, 0.1, 3), PR('thick', '厚 m', 0.06, 1, 0.02, 0.24),
  PI('wins', '窗洞数', 0, 8, 1, 2), PR('winW', '窗宽 m', 0.3, 3, 0.05, 1.2), PR('winH', '窗高 m', 0.2, 3, 0.05, 1.2), PR('sill', '窗台高 m', 0, 2, 0.05, 0.9),
  PB('door', '留门洞', false), PR('doorW', '门洞宽 m', 0.4, 3, 0.05, 1.1), PR('doorH', '门洞高 m', 0.6, 4, 0.05, 2.2), PR('doorPos', '门洞位置', 0, 1, 0.05, 0.25),
  PR('lintel', '过梁腰线 m', 0, 0.5, 0.02, 0.1), PC('color', '墙面色', '#d8d2c6'), PB('top', '压顶', false),
  PB('plinth', '墙基 / 勒脚', true), PB('glass', '窗洞装玻璃', true)];

export const GROUPS = [
  {
    cat: '建筑构件', id: 'bld',
    items: [
      { type: 'wall', name: '直墙（带门窗洞）', icon: 'wall', build: buildWall, params: WALL_PARAMS },
      { type: 'wallcorner', name: '转角墙', icon: 'wall', build: buildWallCorner, params: [PR('lenA', 'A 边长 m', 1, 30, 0.5, 6), PR('lenB', 'B 边长 m', 1, 30, 0.5, 5), PR('height', '高 m', 1, 12, 0.1, 3), PR('thick', '厚 m', 0.06, 1, 0.02, 0.24), PI('wins', 'A 边窗洞数', 0, 6, 1, 1), PB('door', 'A 边留门洞', false), PC('color', '墙面色', '#d8d2c6')] },
      { type: 'wallcrenel', name: '垛口墙 / 女儿墙', icon: 'wall', build: buildWallCrenel, params: [PR('length', '长 m', 1, 40, 0.5, 8), PR('height', '墙高 m', 0.3, 6, 0.1, 1.1), PR('thick', '厚 m', 0.12, 1.2, 0.02, 0.4), PI('merlons', '垛口数', 1, 30, 1, 6), PR('merlonH', '垛高 m', 0.1, 1.4, 0.05, 0.45), PB('walk', '内侧马道', false), PC('color', '砖石色', '#b9b2a6')] },

      { type: 'windowslider', name: '推拉窗', icon: 'window', build: buildWindowSliding, params: [PR('w', '宽 m', 0.4, 4, 0.05, 1.6), PR('h', '高 m', 0.4, 3, 0.05, 1.3), PR('thick', '框厚 m', 0.05, 0.4, 0.01, 0.12), PR('slide', '推开比例', 0, 1, 0.05, 0.45), PI('bar', '护栏（0=无）', 0, 1, 1, 0), PC('frame', '框色', '#4c525a'), PC('glass', '玻璃色', '#7fa8bf')] },
      { type: 'windowarch', name: '拱窗', icon: 'window', build: buildWindowArch, params: [PR('w', '宽 m', 0.4, 4, 0.05, 1.2), PR('h', '高 m', 0.6, 4, 0.05, 2), PR('thick', '框厚 m', 0.05, 0.5, 0.02, 0.16), PI('mullions', '窗棂数', 1, 6, 1, 3), PC('frame', '窗框石色', '#cfc7b8'), PC('glass', '玻璃色', '#6f93ab')] },
      { type: 'windowlouver', name: '百叶窗 / 格栅窗', icon: 'window', build: buildWindowLouver, params: [PR('w', '宽 m', 0.4, 4, 0.05, 1.4), PR('h', '高 m', 0.4, 3, 0.05, 1.4), PR('thick', '框厚 m', 0.05, 0.4, 0.01, 0.1), PI('slats', '百页数', 3, 24, 1, 8), PR('angle', '叶片角度 °', 0, 80, 1, 38), PC('frame', '叶片色', '#8b7f6b')] },

      { type: 'doorsingle', name: '单开门', icon: 'door', build: buildDoorSingle, params: [PR('w', '门宽 m', 0.5, 3, 0.05, 1), PR('h', '门高 m', 0.8, 4, 0.05, 2.1), PR('thick', '墙厚 m', 0.05, 0.6, 0.01, 0.24), PR('open', '开启角 °', 0, 110, 1, 32), PB('transom', '上亮子', false), PC('color', '门板色', '#7b5a3f'), PC('frame', '框色', '#4a4f56')] },
      { type: 'doordouble', name: '双开门', icon: 'door', build: buildDoorDouble, params: [PR('w', '门宽 m', 0.8, 5, 0.05, 1.8), PR('h', '门高 m', 0.8, 4.5, 0.05, 2.3), PR('thick', '墙厚 m', 0.05, 0.6, 0.01, 0.24), PR('open', '开启角 °', 0, 110, 1, 48), PC('color', '门板色', '#6d4f3a'), PC('frame', '框色', '#4a4f56')] },
      { type: 'doorroll', name: '卷帘门（机库 / 店铺）', icon: 'door', build: buildDoorRoll, params: [PR('w', '宽 m', 1, 12, 0.1, 3.4), PR('h', '高 m', 1.2, 8, 0.1, 3.2), PR('open', '卷起比例', 0, 1, 0.02, 0.65), PB('mark', '地面黄线', true), PC('color', '帘板色', '#9aa2ab')] },

      { type: 'roofgable', name: '双坡屋顶（悬山）', icon: 'roof', elev: 3.2, build: buildRoofGable, params: [PR('w', '开间 m', 1, 30, 0.2, 8), PR('d', '进深 m', 1, 24, 0.2, 6), PR('rise', '举高 m', 0.2, 6, 0.1, 1.8), PR('overhang', '出檐 m', 0, 2, 0.05, 0.5), PB('gable', '封山墙', true), PB('eave', '檐口封板', true), PC('color', '瓦色', '#4a5058'), PC('wall', '山墙色', '#d8d2c6')] },
      { type: 'roofhip', name: '四坡屋顶（庑殿）', icon: 'roof', elev: 3.2, build: buildRoofHip, params: [PR('w', '开间 m', 1.5, 30, 0.2, 9), PR('d', '进深 m', 1.5, 24, 0.2, 7), PR('rise', '举高 m', 0.3, 6, 0.1, 2.1), PR('ridge', '正脊比例', 0.02, 0.8, 0.02, 0.28), PR('overhang', '出檐 m', 0, 2, 0.05, 0.6), PB('aileron', '垂脊起翘', true), PC('color', '瓦色', '#3f454d')] },
      { type: 'roofflat', name: '平屋顶（女儿墙 / 机房）', icon: 'roof', elev: 3.4, build: buildRoofFlat, params: [PR('w', '宽 m', 1, 40, 0.2, 9), PR('d', '深 m', 1, 40, 0.2, 7), PR('thick', '板厚 m', 0.08, 0.6, 0.02, 0.2), PR('parapet', '女儿墙高 m', 0, 1.6, 0.05, 0.6), PB('boxes', '屋面设备', true), PB('drain', '雨水口', true), PI('seed', '设备种子', 1, 40, 1, 5), PC('color', '混凝土色', '#c6c3bd')] },

      { type: 'ceilingflat', name: '天花板（平板·可开孔）', icon: 'ceil', elev: 3.2, build: buildCeilingFlat, params: [PR('w', '宽 m', 1, 40, 0.2, 8), PR('d', '深 m', 1, 40, 0.2, 6), PR('thick', '板厚 m', 0.04, 0.5, 0.01, 0.12), PB('light', '中央灯具', true), PR('holeEdge', '洞口砌边 m', 0, 0.4, 0.02, 0.1), PB('autoHole', '让楼梯在此留洞', true), PC('color', '顶面色', '#e8e6e1')] },
      { type: 'ceilingbeam', name: '天花板（带梁）', icon: 'ceil', elev: 3.2, build: buildCeilingBeam, params: [PR('w', '宽 m', 1, 40, 0.2, 8), PR('d', '深 m', 1, 40, 0.2, 6), PR('thick', '板厚 m', 0.04, 0.5, 0.01, 0.1), PI('beams', '梁数', 1, 20, 1, 5), PR('beamH', '梁高 m', 0.06, 0.9, 0.02, 0.34), PS('beamAxis', '梁向', [{ v: 'x', l: '沿 X' }, { v: 'z', l: '沿 Z' }], 'x'), PC('beamColor', '梁色', '#8a6240'), PR('holeEdge', '洞口砌边 m', 0, 0.4, 0.02, 0.1), PB('autoHole', '让楼梯在此留洞', true), PC('color', '顶面色', '#e6e2da')] },
      { type: 'ceilinggrid', name: '天花板（格栅吊顶）', icon: 'ceil', elev: 3.4, build: buildCeilingGrid, params: [PR('w', '宽 m', 1, 40, 0.2, 9), PR('d', '深 m', 1, 40, 0.2, 7), PR('thick', '板厚 m', 0.03, 0.4, 0.01, 0.08), PR('cell', '格芯 m', 0.3, 3, 0.05, 0.9), PB('lights', '灯带', true), PR('holeEdge', '洞口砌边 m', 0, 0.4, 0.02, 0.08), PB('autoHole', '让楼梯在此留洞', true), PC('color', '顶面色', '#eaeaea')] },

      { type: 'stairstraight', name: '单跑楼梯', icon: 'stairs', build: buildStairStraight, params: [PR('rise', '总高 m', 0.6, 8, 0.1, 3.6), PR('w', '净宽 m', 0.5, 3, 0.05, 1.2), PI('steps', '踏步数', 3, 30, 1, 16), PR('tread', '踏步深 m', 0.12, 0.4, 0.01, 0.28), PR('slope', '坡度系数', 1.2, 3.2, 0.05, 1.9), PB('rail', '扶手', true), PB('land', '顶部平台', true), PR('pad', '洞口富余 m', 0, 1.2, 0.05, 0.35), PR('holeLen', '洞口长度 m', 0, 12, 0.1, 2.4), PR('openUp', '洞口高出梯顶 m', 0, 3, 0.05, 0.2), PR('band', '认楼板的高度容差 m', 0.6, 6, 0.1, 2), PC('color', '梯体色', '#b9b7b2')] },
      { type: 'stairswitch', name: '双跑楼梯（带休息平台）', icon: 'stairs', build: buildStairSwitch, params: [PR('rise', '总高 m', 1.2, 10, 0.1, 3.6), PR('w', '单跑净宽 m', 0.5, 2.4, 0.05, 1.1), PI('steps', '每跑踏步数', 3, 24, 1, 10), PR('tread', '踏步深 m', 0.12, 0.4, 0.01, 0.28), PR('slope', '坡度系数', 1.2, 3.2, 0.05, 1.9), PB('rail', '栏杆', true), PR('pad', '洞口富余 m', 0, 1.2, 0.05, 0.35), PR('holeLen', '洞口长度 m', 0, 12, 0.1, 2.4), PR('openUp', '洞口高出梯顶 m', 0, 3, 0.05, 0.2), PR('band', '认楼板的高度容差 m', 0.6, 6, 0.1, 2), PC('color', '梯体色', '#b9b7b2')] },
      { type: 'stairspiral', name: '螺旋楼梯', icon: 'stairs', build: buildStairSpiral, params: [PR('rise', '总高 m', 1, 8, 0.1, 3.4), PR('r', '外半径 m', 0.8, 4, 0.05, 1.5), PR('post', '中柱半径 m', 0.12, 0.6, 0.02, 0.2), PI('steps', '踏步数', 6, 40, 1, 18), PR('turn', '盘旋圈数', 0.3, 2, 0.05, 1), PB('rail', '栏杆', true), PR('pad', '洞口富余 m', 0, 1.2, 0.05, 0.3), PR('holeLen', '洞口长度 m', 0, 12, 0.1, 2.4), PR('openUp', '洞口高出梯顶 m', 0, 3, 0.05, 0.2), PR('band', '认楼板的高度容差 m', 0.6, 6, 0.1, 2), PC('color', '梯体色', '#9fa4ab')] },
    ],
  },
];
