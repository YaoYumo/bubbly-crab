// ---------------------------------------------------------------------------
// 预设模型库：64 款美式风格程序化模型（8 章 × 8 类）
// 单位：米。朝向：+Z 为前方。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeRng } from './util.js';
import { seg as qseg, applyDetail, bevelGeo, Q as DQ } from './detail.js';
import { geoCacheBegin, geoCacheEnd } from './geo.js';
import { GROUPS as GROUPS_BLD } from './bld.js';
import { GROUPS as GROUPS_ARCH } from './arch.js';
import { GROUPS as GROUPS_NATURE } from './nature.js';
import { GROUPS as GROUPS_PROPS } from './props.js';
import { GROUPS_CITY } from './city.js';   // 城市建筑/环境/人物（纯追加组，不改既有 16 组；见 city.js 头注）

// 材质工厂与 shade：抽到叶子模块 mat.js（断 assets→city→character→assets 导入环，
// 否则不同入口顺序会触发 GROUPS_CITY TDZ），此处 re-export 保持既有 API。
import { mk, M, shade } from './mat.js';
export { M, shade };

// ---- 几何工具 ----
export const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)), mat);
  m.position.set(x, y, z); return m;
};
export const cyl = (rt, rb, h, mat, s = 24, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.001, rt), Math.max(0.001, rb), Math.max(0.01, h), qseg(s)), mat);
  m.position.set(x, y, z); return m;
};
export const planeXZ = (w, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.01, w), Math.max(0.01, d)), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m;
};
export const sph = (r, mat, s = 10, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.005, r), qseg(s), Math.max(4, qseg(s) - 2)), mat);
  m.position.set(x, y, z); return m;
};
// shade() 已抽至 mat.js（由上方 import 引入并 re-export）

// ---------------------------------------------------------------------------
// 高细节共用构件（规格：门窗内缩 5~10cm · 门廊柱 12~16 边形 · 屋檐瓦片立体挤出 ·
// 台面 8mm 45° 微倒角 · 树干 8~10 边形 · 树冠 30~50 张 Alpha 交叉面片 · 草簇 GPU 实例化）
// ---------------------------------------------------------------------------
/** 定段数圆柱：不随精度档缩放，规格里点名多边数的构件用它 */
const cylRaw = (rt, rb, h, mat, s, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.001, rt), Math.max(0.001, rb), Math.max(0.01, h), Math.max(3, Math.round(s))), mat);
  m.position.set(x, y, z); return m;
};

/** 台面 / 踏步 / 搁板：1 段 45° 微倒角（8mm），棱边抓高光线 */
function slabTop(w, t, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(bevelGeo(Math.max(0.02, w), Math.max(0.01, t), Math.max(0.02, d), 0.008, 1), mat);
  m.position.set(x, y, z); return m;
}

/** 内缩窗组件。原点 = 墙面洞口中心，+Z = 墙外法线。
 *  暗腔贴墙、玻璃比框面内退 5.5cm → 斜看有真实的 5~10cm 景深 */
function winUnit(w, h, o = {}) {
  const G = new THREE.Group();
  G.userData.role = 'window';
  const frameMat = o.frameMat || M.paint(0xf0ece4, 0.7);
  const glassMat = o.glassMat || M.glass(0x8fb4cc);
  const darkMat = o.darkMat || M.dark(0x151a20, 0.95);
  const dep = o.dep ?? 0.09, ins = 0.055, ft = o.ft ?? 0.08;
  G.add(box(w + 0.02, h + 0.02, 0.016, darkMat, 0, 0, 0.008));                    // 洞口暗腔
  G.add(box(w, h, 0.016, glassMat, 0, 0, dep - ins));                             // 玻璃
  if (o.muntins !== false) {
    const cols = o.cols ?? 2, rows = o.rows ?? 2;
    for (let i = 1; i < cols; i++) G.add(box(0.028, h, 0.022, frameMat, -w / 2 + (i * w) / cols, 0, dep - ins + 0.015));
    for (let j = 1; j < rows; j++) G.add(box(w, 0.028, 0.022, frameMat, 0, -h / 2 + (j * h) / rows, dep - ins + 0.015));
  }
  G.add(box(w + ft * 2, ft, dep, frameMat, 0, h / 2 + ft / 2, dep / 2));           // 四边框樘
  G.add(box(w + ft * 2, ft, dep, frameMat, 0, -h / 2 - ft / 2, dep / 2));
  G.add(box(ft, h + ft * 2, dep, frameMat, -w / 2 - ft / 2, 0, dep / 2));
  G.add(box(ft, h + ft * 2, dep, frameMat, w / 2 + ft / 2, 0, dep / 2));
  if (o.sill !== false) G.add(box(w + ft * 2 + 0.1, 0.06, dep + 0.09, frameMat, 0, -h / 2 - ft - 0.03, dep / 2 + 0.03));
  if (o.lintel) G.add(box(w + ft * 2 + 0.08, 0.12, dep + 0.05, o.lintelMat || frameMat, 0, h / 2 + ft + 0.06, dep / 2 + 0.01));
  if (o.arch) {                                                                    // 半圆拱心玻璃（教堂 / 殖民式）
    const geoA = new THREE.CylinderGeometry(w / 2, w / 2, 0.016, 10, 1, false, 0, Math.PI);
    geoA.rotateX(Math.PI / 2); geoA.rotateZ(Math.PI / 2);
    const arch = new THREE.Mesh(geoA, o.archGlass || glassMat);
    arch.position.set(0, h / 2 + ft, dep - ins); G.add(arch);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + ft / 2, ft / 2, 4, Math.max(6, Math.round(10 * DQ.k)), Math.PI), frameMat);
    ring.position.set(0, h / 2 + ft, dep / 2); G.add(ring);
  }
  if (o.shutters) {
    const sm = o.shutterMat || M.paint(0x2a3a4a, 0.75);
    for (const s of [-1, 1]) {
      const sx = s * (w / 2 + ft + 0.15);
      G.add(box(0.28, h + ft * 2, 0.028, sm, sx, 0, 0.018));
      for (let k = 0; k < 4; k++) G.add(box(0.24, 0.028, 0.018, sm, sx, -h / 2 + ((k + 0.5) * h) / 4, 0.042));
    }
  }
  if (o.flowerBox) {
    const bm = o.boxMat || M.paint(0x6b4e35, 0.85);
    G.add(box(w + ft * 2, 0.16, 0.2, bm, 0, -h / 2 - ft - 0.14, dep / 2 + 0.08));
    const fm = M.paint(o.flowerColor || 0xcc4466, 0.8);
    for (let i = 0; i < 4; i++) G.add(box(0.09, 0.1, 0.09, fm, -w / 2 + ((i + 0.5) * w) / 4, -h / 2 - ft - 0.02, dep / 2 + 0.08));
  }
  return G;
}

/** 门窗套：两侧樘 + 过梁 + 窗台，中间留空。
 *  旧版用一整块实心板做套，把门窗整扇（连气窗）盖死、还横跨两层压住上层窗。
 *  openW/openH = 洞口净尺寸（要能容下门窗组件含扇/气窗的全部高度），t = 套线宽 */
function surroundFrame(openW, openH, t, depth, mat, x, y, z, o = {}) {
  const G = new THREE.Group();
  G.userData.role = 'trim';
  G.add(box(t, openH + t, depth, mat, -(openW / 2 + t / 2), t / 2, 0));
  G.add(box(t, openH + t, depth, mat, openW / 2 + t / 2, t / 2, 0));
  G.add(box(openW + t * 2, t, depth, mat, 0, openH / 2 + t / 2, 0));
  if (o.sill !== false) G.add(box(openW + t * 2 + 0.12, 0.09, depth + 0.1, mat, 0, -openH / 2 - 0.045, 0.02));
  G.position.set(x, y, z);
  return G;
}
/** 内缩板门组件。原点 = 洞口中心，+Z = 墙外法线；门扇比框面内退 ~6cm */
function doorUnit(w, h, o = {}) {
  const G = new THREE.Group();
  const frameMat = o.frameMat || M.paint(0xf0ece4, 0.7);
  const doorMat = o.doorMat || M.paint(0x4a3520, 0.7);
  const panelMat = o.panelMat || M.paint(o.panelColor ?? 0x3d2c1a, 0.68);
  const darkMat = o.darkMat || M.dark(0x151a20, 0.95);
  const dep = o.dep ?? 0.1, ft = 0.09;
  G.userData.role = 'door';
  G.add(box(w + 0.02, h + 0.02, 0.016, darkMat, 0, 0, 0.008));
  const leaf = box(w, h, 0.05, doorMat, 0, 0, dep - 0.06);
  leaf.userData.role = 'doorleaf';
  G.add(leaf);
  const pz = dep - 0.022;
  const pcols = o.panelCols ?? 2, prows = o.panelRows ?? 3;
  const cw = (w - 0.16) / pcols, chh = (h - 0.22) / prows;
  for (let r = 0; r < prows; r++) for (let c = 0; c < pcols; c++) {
    const px = -w / 2 + 0.08 + (c + 0.5) * cw, py = -h / 2 + 0.11 + (r + 0.5) * chh;
    G.add(box(cw - 0.05, chh - 0.06, 0.014, panelMat, px, py, pz));                // 门芯板（凸出扇面 1.4cm）
    G.add(box(cw - 0.02, chh - 0.03, 0.008, doorMat, px, py, pz - 0.01));
  }
  G.add(box(w + ft * 2, ft, dep, frameMat, 0, h / 2 + ft / 2, dep / 2));
  G.add(box(ft, h, dep, frameMat, -w / 2 - ft / 2, 0, dep / 2));
  G.add(box(ft, h, dep, frameMat, w / 2 + ft / 2, 0, dep / 2));
  G.add(box(w + ft * 2 + 0.12, 0.1, dep + 0.12, frameMat, 0, -h / 2 - 0.03, dep / 2));  // 门槛
  const metal = M.metal(0xd4af37, 0.3, 0.85);
  const kn = cylRaw(0.022, 0.022, 0.05, metal, 8, w / 2 - 0.13, -0.08, dep - 0.02);
  kn.rotation.x = Math.PI / 2; G.add(kn);
  if (o.fanlight) {
    const rF = w / 2 + ft;
    const geoF = new THREE.CylinderGeometry(rF, rF, 0.018, 12, 1, false, 0, Math.PI);
    geoF.rotateX(Math.PI / 2); geoF.rotateZ(Math.PI / 2);
    const fan = new THREE.Mesh(geoF, M.glass(0xaaccdd));
    fan.position.set(0, h / 2 + ft + 0.01, dep - 0.05); G.add(fan);
    for (let i = 1; i < 4; i++) {                                                  // 拱心扇形棂条
      const a = (i / 4) * Math.PI;
      const bar = box(rF * 0.9, 0.025, 0.022, frameMat,
        Math.cos(a) * rF * 0.45, h / 2 + ft + 0.01 + Math.sin(a) * rF * 0.45, dep - 0.05);
      bar.rotation.z = a; G.add(bar);
    }
    G.add(box(w + ft * 2 + 0.1, 0.08, dep + 0.04, frameMat, 0, h / 2 + ft + rF + 0.05, dep / 2));
  }
  if (o.lintel) G.add(box(w + ft * 2 + 0.14, 0.14, dep + 0.06, o.lintelMat || frameMat, 0, h / 2 + ft + 0.07, dep / 2 + 0.01));

  if (o.sidelights) for (const s of [-1, 1]) {                                     // 门侧采光条（窄窗组件）
    const sl = winUnit(0.18, h * 0.7, { frameMat, glassMat: M.glass(0x99bbcc), muntins: false, ft: 0.05, dep });
    sl.position.set(s * (w / 2 + ft + 0.15), 0, 0);
    G.add(sl);
  }
  return G;
}

/** 把立面组件挂到墙上：axis 'z'|'x'，s = ±1 外法线方向 */
function onWall(unit, x, y, z, axis = 'z', s = 1) {
  unit.rotation.y = axis === 'z' ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
  unit.position.set(x, y, z);
  return unit;
}

/** 门廊圆柱：柱础 + 收分柱身（12~16 边形）+ 两层柱头线脚 */
function porchColumn(h, r, mat, sides = 14) {
  const G = new THREE.Group();
  G.add(box(r * 2.7, 0.16, r * 2.7, mat, 0, 0.08, 0));
  G.add(box(r * 2.35, 0.1, r * 2.35, mat, 0, 0.21, 0));
  G.add(cylRaw(r * 0.86, r, h - 0.62, mat, sides, 0, 0.26 + (h - 0.62) / 2, 0));
  G.add(box(r * 2.3, 0.1, r * 2.3, mat, 0, h - 0.31, 0));
  G.add(box(r * 2.7, 0.12, r * 2.7, mat, 0, h - 0.19, 0));
  G.add(box(r * 3.0, 0.12, r * 3.0, mat, 0, h - 0.06, 0));
  return G;
}

/** 栏杆：上下枋 + 车木 balusters（6 边形，中段鼓肚）+ 两端望柱，沿 X 布置，原点在段中心底部 */
function balustrade(len, h, mat, o = {}) {
  const G = new THREE.Group();
  const n = Math.max(3, Math.round(len / (o.spacing ?? 0.15)));
  const belly = o.belly === undefined ? n <= 40 : o.belly;   // 长栏省去中段鼓肚，控制面数
  G.add(box(len, 0.05, 0.07, mat, 0, 0.05, 0));
  G.add(box(len + 0.06, 0.08, 0.1, mat, 0, h + 0.04, 0));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / n;
    G.add(cylRaw(0.02, 0.024, h - 0.1, mat, 6, x, 0.08 + (h - 0.1) / 2, 0));
    if (belly) G.add(cylRaw(0.032, 0.032, (h - 0.1) * 0.34, mat, 6, x, 0.08 + (h - 0.1) * 0.42, 0));
  }
  if (o.posts !== false) for (const s of [-1, 1]) {
    G.add(box(0.11, h + 0.18, 0.11, mat, s * (len / 2 + 0.04), (h + 0.18) / 2, 0));
    G.add(box(0.15, 0.05, 0.15, mat, s * (len / 2 + 0.04), h + 0.2, 0));
  }
  return G;
}

/** 直跑楼梯：n 级踏步，从原点（底部外沿）沿 -Z 方向上升；踏面带 8mm 倒角 */
function stairRun(w, n, riseH, runD, mat) {
  const G = new THREE.Group();
  for (let i = 0; i < n; i++) G.add(slabTop(w, riseH, runD, mat, 0, riseH * (i + 0.5), -runD * i - runD / 2));
  return G;
}

/** 沥青瓦垄：贴到已就位的坡面板（box：宽 = 坡长、rotation.z = 坡角），n 道瓦带立体挤出 */
function shingleCourses(slope, n, mat) {
  const prm = slope.geometry.parameters;
  const L = prm.width, T = prm.height, D = prm.depth;
  const G = new THREE.Group();
  const cw = L / Math.max(2, n);
  for (let i = 0; i < n; i++) G.add(box(cw * 0.97, 0.035, D * 0.995, mat, -L / 2 + (i + 0.5) * cw, T / 2 + 0.014, 0));
  G.rotation.copy(slope.rotation);
  G.position.copy(slope.position);
  return G;
}

/** 西班牙筒瓦垄：一垄垄顺坡挂到坡面板上，垄向 = 排水方向 */
function barrelTiles(slope, nRows, mat) {
  const prm = slope.geometry.parameters;
  const L = prm.width, T = prm.height, D = prm.depth;
  const G = new THREE.Group();
  for (let i = 0; i < nRows; i++) {
    const z = -D / 2 + ((i + 0.5) * D) / nRows;
    const tile = cylRaw(0.05, 0.055, L * 0.99, mat, 5, 0, T / 2 + 0.035, z);
    tile.rotation.z = Math.PI / 2; G.add(tile);
  }
  G.rotation.copy(slope.rotation);
  G.position.copy(slope.position);
  return G;
}

/** 檐口齿饰：一排小方齿（殖民地 / 乔治亚式檐口） */
function dentils(len, mat, x, y, z, step = 0.22) {
  const G = new THREE.Group();
  const n = Math.max(4, Math.round(len / step));
  for (let i = 0; i < n; i++) G.add(box(0.08, 0.1, 0.1, mat, -len / 2 + ((i + 0.5) * len) / n, 0, 0));
  G.position.set(x, y, z);
  return G;
}

/** 招牌 / 匾额面板：2 段倒角挤出（规格：招牌 2 段倒角） */
function bevelSign(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(bevelGeo(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.02, d), 0.03, 2), mat);
  m.position.set(x, y, z); return m;
}

/** 连续橱窗带：暗腔 + 内退玻璃 + 竖框 + 上下外凸框 → 橱窗带真实深度。沿 X 布置 */
function storefrontBand(w, h, o = {}) {
  const G = new THREE.Group();
  G.userData.role = 'window';
  const frameMat = o.frameMat || M.paint(0x2c3138, 0.55);
  const glassMat = o.glassMat || M.glass(0x99ccdd);
  const darkMat = o.darkMat || M.dark(0x10141a, 0.95);
  const dep = o.dep ?? 0.12;
  const bulkH = o.bulk ?? 0.5;
  G.add(box(w, h, 0.02, darkMat, 0, 0, 0.005));                                   // 暗腔（店内阴影）
  G.add(box(w - 0.06, h - bulkH - 0.08, 0.02, glassMat, 0, (bulkH + 0.04) / 2, dep - 0.06));  // 玻璃内退 ~6cm
  G.add(box(w - 0.04, bulkH, 0.06, o.bulkMat || M.paint(0x3a4148, 0.7), 0, -h / 2 + bulkH / 2, dep - 0.03));       // 槛墙板
  const nMul = Math.max(1, Math.round(w / (o.mullionGap ?? 1.6)));
  for (let i = 0; i <= nMul; i++) G.add(box(0.07, h, dep, frameMat, -w / 2 + (i * w) / nMul, 0, dep / 2));
  G.add(box(w, 0.09, dep + 0.03, frameMat, 0, h / 2 - 0.045, dep / 2));
  G.add(box(w, 0.07, dep + 0.03, frameMat, 0, -h / 2 + 0.035, dep / 2));
  G.add(box(w + 0.14, 0.08, dep + 0.12, frameMat, 0, h / 2 + 0.04, dep / 2));      // 顶梁
  return G;
}

// ---- 植被 Alpha 贴图（程序化 canvas；材质不挂 userData.detail → applyDetail 不改其 UV）----
const _vegTex = {};
function vegTexture(kind) {
  if (_vegTex[kind] !== undefined) return _vegTex[kind];
  let tex = null;
  try {
    const c = document.createElement('canvas');
    const rng = makeRng(kind.length * 977 + 13);
    if (kind === 'leaf') {
      const n = (c.width = c.height = 128), x = c.getContext('2d');
      for (let i = 0; i < 170; i++) {
        const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.62) * n * 0.47;
        const px = n / 2 + Math.cos(a) * r, py = n / 2 + Math.sin(a) * r;
        const s = 5 + rng() * 10, v = 185 + Math.round(rng() * 70);
        x.fillStyle = `rgba(${v},${v},${Math.round(v * 0.9)},${(0.5 + rng() * 0.5).toFixed(2)})`;
        x.beginPath(); x.ellipse(px, py, s, s * (0.4 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2); x.fill();
      }
    } else if (kind === 'blade') {
      const n = (c.width = 64), m = (c.height = 128), x = c.getContext('2d');
      for (let i = 0; i < 9; i++) {
        const x0 = 8 + rng() * 48, bend = (rng() - 0.5) * 34, w0 = 2.4 + rng() * 3;
        const v = 190 + Math.round(rng() * 60);
        x.strokeStyle = `rgba(${v},${v},${Math.round(v * 0.85)},0.95)`;
        x.lineWidth = w0; x.lineCap = 'round';
        x.beginPath(); x.moveTo(x0, m);
        x.quadraticCurveTo(x0 + bend * 0.4, m * 0.55, x0 + bend, 4 + rng() * 26);
        x.stroke();
        x.lineWidth = Math.max(1, w0 * 0.4);
        x.beginPath(); x.moveTo(x0 + bend, 4 + rng() * 10); x.lineTo(x0 + bend * 1.15, 2); x.stroke();
      }
    } else if (kind === 'frond') {
      const n = (c.width = 64), m = (c.height = 256), x = c.getContext('2d');
      x.strokeStyle = 'rgba(210,210,200,1)'; x.lineWidth = 4; x.lineCap = 'round';
      x.beginPath(); x.moveTo(n / 2, m); x.quadraticCurveTo(n / 2, m * 0.4, n / 2 - 4, 4); x.stroke();
      for (let i = 0; i < 26; i++) {
        const t = i / 25, y = m - 6 - t * (m - 12);
        const wLen = (10 + Math.sin(t * Math.PI) * 20) * (0.7 + rng() * 0.5);
        const v = 185 + Math.round(rng() * 60);
        x.strokeStyle = `rgba(${v},${v},${Math.round(v * 0.88)},0.92)`; x.lineWidth = 2.6;
        for (const s of [-1, 1]) {
          x.beginPath(); x.moveTo(n / 2 - 4 * t, y);
          x.quadraticCurveTo(n / 2 + s * wLen * 0.6, y - 4, n / 2 + s * wLen, y + 8 + t * 10);
          x.stroke();
        }
      }
    }
    if (c.width) {
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
    }
  } catch (e) { tex = null; }
  _vegTex[kind] = tex;
  return tex;
}
/** Alpha 剪裁材质：无 userData.detail → applyDetail 跳过（UV 保持 0..1 整张贴图） */
function vegMat(color, kind, o = {}) {
  const tex = vegTexture(kind);
  const m = new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.88, metalness: 0, side: THREE.DoubleSide,
  }, tex ? { map: tex, alphaTest: 0.45 } : {}, o));
  return m;
}
const _cardGeo = {};
function cardGeo(sub = 1) {
  return _cardGeo[sub] || (_cardGeo[sub] = new THREE.PlaneGeometry(1, 1, sub, sub));
}
/** 树冠：n 张 Alpha 贴图交叉面片簇（规格 30~50），椭球体积内确定性散布 */
function canopyCards(g, o) {
  const { cx = 0, cy, cz = 0, rx, ry, rz, n = 40, mat, size, seed = 5, sub = 1 } = o;
  const rng = makeRng(seed);
  const geo = cardGeo(sub);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, v = Math.acos(2 * rng() - 1), r = 0.3 + 0.7 * Math.cbrt(rng());
    const s = size * (0.65 + rng() * 0.75);
    const card = new THREE.Mesh(geo, mat);
    card.scale.set(s, s, 1);
    card.position.set(cx + Math.sin(v) * Math.cos(a) * rx * r, cy + Math.cos(v) * ry * r, cz + Math.sin(v) * Math.sin(a) * rz * r);
    card.rotation.set((rng() - 0.5) * 0.9, rng() * Math.PI, (rng() - 0.5) * 0.9);
    g.add(card);
  }
}

/** 乔木骨架：根盘 + 主干（定段数 8~10 边形）+ 分枝与次级枝，返回枝端世界坐标 */
function trunkBranches(g, o) {
  const {
    h, r0, r1, bark, seg = 10, nBranch = 6, bLen, bR = 0.05,
    y0 = h * 0.42, y1 = h * 0.78, pitch = 0.85, seed = 9, flare = true,
  } = o;
  const rng = makeRng(seed);
  if (flare) g.add(cylRaw(r1 * 1.5, r0 * 1.7, h * 0.06, bark, seg, 0, h * 0.03, 0));
  g.add(cylRaw(r1, r0, h * 0.66, bark, seg, 0, h * 0.33, 0));
  for (let i = 0; i < 3; i++)                                                       // 树干疤节
    g.add(cylRaw(r1 * 0.34, r1 * 0.4, 0.05, bark, 6, Math.cos(i * 2.4) * r1 * 0.9, h * (0.16 + i * 0.14), Math.sin(i * 2.4) * r1 * 0.9));
  const tips = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nBranch; i++) {
    const a = (i / nBranch) * Math.PI * 2 + rng() * 0.8;
    const y = y0 + (y1 - y0) * (nBranch === 1 ? 0.5 : i / (nBranch - 1));
    const len0 = bLen * (0.68 + rng() * 0.64);
    const pt = pitch * (0.55 + rng() * 0.75);
    const len = o.tipMax ? Math.min(len0, (o.tipMax - y) / Math.max(0.3, Math.cos(pt))) : len0;
    const G = new THREE.Group(); G.position.set(0, y, 0); G.rotation.y = a; g.add(G);
    const H = new THREE.Group(); H.rotation.x = pt; G.add(H);
    H.add(cylRaw(bR * 0.6, bR, len, bark, 8, 0, len / 2, 0));
    const pt2 = Math.max(0.5, pt - 1.25);
    const S = new THREE.Group(); S.position.set(0, len * 0.7, 0); S.rotation.x = -(pt - pt2); S.rotation.y = 1.15; H.add(S);
    S.add(cylRaw(bR * 0.38, bR * 0.58, len * 0.35, bark, 6, 0, len * 0.175, 0));
    const dir = up.clone().applyEuler(new THREE.Euler(pt, 0, 0)).applyAxisAngle(up, a);
    tips.push(dir.multiplyScalar(len).add(new THREE.Vector3(0, y, 0)));
    const dir2 = up.clone().applyEuler(new THREE.Euler(pt2, 0, 0)).applyAxisAngle(up, a + 1.15);
    tips.push(dir2.multiplyScalar(len * 0.35).add(new THREE.Vector3(0, y + len * 0.7 * Math.cos(pt), 0)));
  }
  return tips;
}

/** GPU 实例化面片簇：草簇/花簇用，一份几何 + N 个实例矩阵 */
function instCards(mat, n, place, seed = 7) {
  const rng = makeRng(seed);
  const im = new THREE.InstancedMesh(cardGeo(1), mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    place(i, rng, v, e, s);
    q.setFromEuler(e); m4.compose(v, q, s); im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  return im;
}

// ---- 参数辅助 ----
const PI = (k, l, min, max, step, def) => ({ k, l, t: 'int', min, max, step, def });
const PR = (k, l, min, max, step, def) => ({ k, l, t: 'range', min, max, step, def });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'sel', opts, def });
export const ANIM_PARAM = () => PS('anim', '动作', [], 'idle');

// ===========================================================================
// Ch1 — American House Styles (6)
// ===========================================================================
function buildCapeCod(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 2.8;
  const wall = M.paint(p.wallColor, 0.85);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const foundH = 0.4;
  const roofMat = M.paint(p.roofColor, 0.8);
  g.add(box(w + 0.1, foundH, d + 0.1, M.concrete(0x888888), 0, foundH / 2, 0));
  g.add(box(w, wallH, d, wall, 0, foundH + wallH / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                            // 四角转角板
    g.add(box(0.12, wallH + 0.06, 0.12, trimMat, sx * (w / 2 - 0.06), foundH + wallH / 2, sz * (d / 2 - 0.06)));
  }
  g.add(box(w + 0.05, 0.12, 0.06, trimMat, 0, foundH + wallH + 0.06, d / 2 + 0.03));
  // 双坡屋顶 + 瓦垄立体挤出 + 山花填充
  // 双坡屋顶：正脊沿 X（与街面平行）、坡面朝 ±Z —— 鳕鱼角式的山面朝向街道两侧，
  // 老虎窗才能坐在前坡上。旧版把正脊摆成沿 Z，老虎窗整块被埋进屋面，外面看不见。
  const ohZ = 0.42, ohX = 0.34;                                                   // 檐口出挑 / 山墙出檐
  const run = d / 2 + ohZ;
  const rise = run * 0.92;                                                        // 陡坡（≈43°）—— 鳕鱼角的招牌坡度
  const slope = Math.hypot(run, rise), th = Math.atan2(rise, run);
  const roofW = w + ohX * 2, eaveY = foundH + wallH;
  // 屋面直线必须过「墙外皮 + 墙顶」：旧版让它过檐口外沿 (run, eaveY)，于是墙外皮处屋面底
  // 比墙顶高出 (ohZ/run)·rise（本例 0.386m），整条檐口下通长一道缝，屋顶看着浮在墙上。
  const drop = (run - d / 2) / run * rise;
  const roofTop = eaveY + rise - drop;
  const slopes = [];
  for (const s of [1, -1]) {
    const sl = box(roofW, 0.16, slope, roofMat, 0, eaveY + rise / 2 - drop, s * run / 2);
    sl.rotation.x = s * th; g.add(sl); slopes.push(sl);
    g.add(shingleCourses(sl, Math.max(8, Math.round(slope / 0.34)), roofMat));
    g.add(box(roofW + 0.2, 0.22, 0.07, trimMat, 0, eaveY + 0.02 - drop, s * (run + 0.02)));   // 封檐板
    const nRaft = Math.max(4, Math.round(roofW / 0.42));                               // 出挑椽尾
    for (let i = 0; i < nRaft; i++) {
      const x = -roofW / 2 + (i + 0.5) * (roofW / nRaft);
      g.add(box(0.09, 0.13, 0.32, roofMat, x, eaveY - drop - 0.01, s * (run - 0.16)));
    }
  }
  const nCourse = Math.max(8, Math.round(slope / 0.34));
  void nCourse;
  g.add(box(roofW + 0.1, 0.16, 0.16, roofMat, 0, roofTop - 0.03, 0));              // 正脊
  for (const sx of [1, -1]) for (const sz of [1, -1]) {                            // 山墙博风板
    const b = box(0.09, 0.16, slope, trimMat, sx * (w / 2 + ohX - 0.03), eaveY + rise / 2 - drop, sz * run / 2);
    b.rotation.x = sz * th; g.add(b);
  }
  {
    const gsh = new THREE.Shape();
    gsh.moveTo(-d / 2 - 0.05, 0); gsh.lineTo(d / 2 + 0.05, 0); gsh.lineTo(0, rise - drop - 0.04); gsh.closePath();
    const ggeo = new THREE.ExtrudeGeometry(gsh, { depth: 0.14, bevelEnabled: false });
    ggeo.rotateY(-Math.PI / 2);                                        // 挤出面正好落在墙面 x=±w/2 上，与外墙齐平
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(ggeo, wall);
      m.position.set(s * w / 2, eaveY, 0);
      if (s < 0) m.rotation.y = Math.PI;
      g.add(m);
    }
  }
  // 前立面：内缩板门 + 两侧内缩窗（百叶 + 花箱）
  const winMat = M.glass(0x99bbcc);
  const shutterMat = M.paint(0x2a3a4a, 0.75);
  const winY = foundH + wallH * 0.52;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 1.2);
    g.add(onWall(winUnit(0.72, 0.95, { frameMat: trimMat, glassMat: winMat, shutterMat, shutters: true, flowerBox: true, lintel: true }), x, winY, d / 2, 'z', 1));
  }
  g.add(onWall(doorUnit(0.9, 1.95, { frameMat: trimMat, lintel: true }), 0, foundH + 0.975, d / 2, 'z', 1));
  // 后立面 3 窗 + 两侧各 2 窗
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + (i + 0.5) * (w / 3);
    g.add(onWall(winUnit(0.72, 0.95, { frameMat: trimMat, glassMat: winMat, muntins: true }), x, winY, -d / 2, 'z', -1));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const z = -d / 4 + i * (d / 2);
    g.add(onWall(winUnit(0.72, 0.95, { frameMat: trimMat, glassMat: winMat, shutters: true, shutterMat }), sx * w / 2, winY, z, 'x', sx));
  }
  // 老虎窗：对称山墙 dormer，坐在前坡屋面上（自身正脊沿 Z，垂直于主脊）
  const nDorm = w >= 8 ? 2 : 1;
  const dw = Math.min(2.1, Math.max(1.15, w * 0.21)), dd = 1.5;
  const zf = d / 2 - 0.45;                                                        // 正立面比外墙退进一点
  const yRoof = roofTop - (zf / run) * rise;                                      // 该处屋面标高
  const dyTop = yRoof + 1.15, dyBot = yRoof - 0.85;                               // 上探出屋面 / 下埋进屋面（抬高 0.53，窗组件才装得进）
  const dRise = dw * 0.34, dSlope = Math.hypot(dw / 2, dRise), dth = Math.atan2(dRise, dw / 2);
  for (let i = 0; i < nDorm; i++) {
    const dx = nDorm === 1 ? 0 : (i * 2 - 1) * w * 0.25;
    const zc = zf - dd / 2;
    g.add(box(dw, dyTop - dyBot, dd, wall, dx, (dyTop + dyBot) / 2, zc));
    for (const s of [-1, 1]) g.add(box(0.09, dyTop - dyBot, 0.09, trimMat, dx + s * (dw / 2 - 0.045), (dyTop + dyBot) / 2, zf - 0.045));
    for (const s of [1, -1]) {                                                    // 小坡顶 + 瓦垄
      const sl = box(dSlope, 0.09, dd + 0.36, roofMat, dx + s * dw / 4, dyTop + dRise / 2, zc + 0.08);
      sl.rotation.z = -s * dth; g.add(sl);
      g.add(shingleCourses(sl, Math.max(4, Math.round(dSlope / 0.28)), roofMat));
    }
    g.add(box(0.1, 0.1, dd + 0.42, roofMat, dx, dyTop + dRise - 0.03, zc + 0.08));   // 小正脊
    g.add(box(dw + 0.2, 0.18, 0.07, trimMat, dx, dyTop - 0.07, zf + 0.03));          // 正面檐板
    g.add(box(dw + 0.26, 0.09, 0.05, trimMat, dx, dyBot + 0.9, zf + 0.05));          // 正面下檐
    g.add(onWall(winUnit(dw * 0.5, 0.56, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 1, sill: true, shutters: true, shutterMat }), dx, yRoof + 0.58, zf, 'z', 1));
  }
  // 烟囱：砖砌，穿过正脊出屋面
  const chimneyX = w * 0.34, chimneyTop = roofTop + 0.62;
  g.add(box(0.55, chimneyTop - foundH, 0.45, M.concrete(0x8a7060), chimneyX, foundH + (chimneyTop - foundH) / 2, 0));
  for (let i = 0; i < 3; i++) g.add(box(0.58, 0.045, 0.48, M.concrete(0x7d6a58), chimneyX, roofTop + 0.12 + i * 0.22, 0));
  g.add(box(0.65, 0.12, 0.55, M.concrete(0x7a6050), chimneyX, chimneyTop + 0.06, 0));
  g.add(box(0.45, 0.1, 0.35, M.concrete(0x6a5040), chimneyX, chimneyTop + 0.17, 0));
  // 入口门廊：门廊台 + 两根 14 边形圆柱 + 门廊顶 + 三级踏步
  const porchZ = d / 2 + 0.85, colH = 2.35;
  g.add(box(3.0, foundH, 0.9, M.concrete(0x9a9488), 0, foundH / 2, d / 2 + 0.45));   // 门廊台（柱子不再悬空）
  for (const s of [-1, 1]) {
    const c = porchColumn(colH, 0.11, trimMat, 14);
    c.position.set(s * 1.05, foundH, porchZ); g.add(c);
  }
  g.add(box(2.6, 0.12, 1.15, trimMat, 0, foundH + colH + 0.06, d / 2 + 0.6));
  g.add(box(2.7, 0.1, 0.14, trimMat, 0, foundH + colH + 0.17, d / 2 + 1.15));
  g.add(box(2.3, 0.5, 0.08, trimMat, 0, foundH + colH + 0.42, d / 2 + 1.12));      // 门廊小山花
  const st = stairRun(1.5, 3, foundH / 3, 0.3, M.concrete(0x9a9488));
  st.position.set(0, 0, d / 2 + 1.5); g.add(st);
  shade(g); return g;
}

function buildBrownstone(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, floors = p.floors, floorH = 3.2, h = floors * floorH;
  const brick = M.paint(p.brickColor, 0.88);
  const stoneMat = M.concrete(0x9a9488);
  const trimMat = M.concrete(0x8a8478);
  g.add(box(w + 0.06, 0.5, d + 0.06, stoneMat, 0, 0.25, 0));
  g.add(box(w, h, d, brick, 0, 0.5 + h / 2, 0));
  const stoopH = 1.2, dCy = stoopH + 1.125;                                       // 门廊台高 / 门中心
  const fanTop = dCy + 2.25 / 2 + 0.09 + 0.01 + 0.59;                             // 气窗拱顶
  const entY0 = stoopH, entY1 = fanTop + 0.14, entHX = (1.18 + 0.28) / 2;         // 入口竖向范围 / 门套半宽
  for (let f = 0; f <= floors; f++) {                                              // 层间腰线
    const cy = 0.5 + f * floorH, by = cy + 0.075;
    if (by + 0.075 > entY0 && by - 0.075 < entY1) {                                // 与入口相碰 → 正面断开让开门套
      g.add(box(w + 0.12, 0.15, d + 0.06, trimMat, 0, by, -0.03));
      for (const sgm of [-1, 1]) {
        const a = sgm > 0 ? entHX : -(w / 2 + 0.06), b = sgm > 0 ? w / 2 + 0.06 : -entHX;
        g.add(box(b - a, 0.15, 0.12, trimMat, (a + b) / 2, by, d / 2 + 0.03));
      }
    } else g.add(box(w + 0.12, 0.15, d + 0.12, trimMat, 0, by, 0));
  }
  for (const sx of [-1, 1]) for (let f = 0; f < floors; f++) {                     // 墙角隅石
    const cy = 0.5 + f * floorH + floorH / 2;
    g.add(box(0.14, floorH - 0.15, 0.14, stoneMat, sx * (w / 2 - 0.07), cy, d / 2 + 0.07));
    g.add(box(0.14, floorH - 0.15, 0.14, stoneMat, sx * (w / 2 - 0.07), cy, -d / 2 - 0.07));
  }
  // 台阶门廊（stoop）+ 铁艺栏杆：整座是实心砌体，踏步不再一片片悬在空中
  const stoopW = w * 0.5, nStep = 4, stepD = 0.36, stepH = stoopH / nStep;
  g.add(box(stoopW, stoopH, 2.0, stoneMat, 0, stoopH / 2, d / 2 + 1.0));           // 平台（实心到地）
  g.add(box(stoopW + 0.06, 0.06, 2.06, trimMat, 0, stoopH + 0.03, d / 2 + 1.0));   // 平台压顶
  for (let i = 0; i < nStep; i++) {
    const hh = stoopH - i * stepH, zz = d / 2 + 2.0 + i * stepD;
    g.add(slabTop(stoopW, stepH, stepD, trimMat, 0, hh - stepH / 2, zz));
    if (hh - stepH > 0.03) g.add(box(stoopW - 0.08, hh - stepH, stepD, stoneMat, 0, (hh - stepH) / 2, zz));
  }
  g.add(box(0.2, stoopH, 2.0, trimMat, -stoopW / 2 - 0.1, stoopH / 2, d / 2 + 1.0));
  g.add(box(0.2, stoopH, 2.0, trimMat, stoopW / 2 + 0.1, stoopH / 2, d / 2 + 1.0));
  const railMat = M.metal(0x23262a, 0.5, 0.8);
  for (const sx of [-1, 1]) {
    const rail = balustrade(1.7, 0.85, railMat, { spacing: 0.17, posts: true });
    rail.rotation.y = Math.PI / 2;
    rail.position.set(sx * (stoopW / 2 - 0.02), stoopH, d / 2 + 1.05);
    g.add(rail);
  }
  // 内缩板门 + 石门套 + 扇形气窗（门套做成樘+过梁，洞口留空，不再整块压死门窗）
  const doorSurround = M.concrete(0x7a7468);
  // 门中心 dCy / 气窗拱顶 fanTop 已在上面算好
  g.add(surroundFrame(1.18, fanTop - stoopH, 0.14, 0.16, doorSurround, 0, stoopH + (fanTop - stoopH) / 2, d / 2 + 0.04, { sill: false }));
  g.add(onWall(doorUnit(1.0, 2.25, { frameMat: stoneMat, doorMat: M.paint(0x4a3520, 0.7), panelCols: 2, panelRows: 3, fanlight: true }), 0, dCy, d / 2, 'z', 1));
  g.add(box(0.55, 0.28, 0.14, doorSurround, 0, fanTop + 0.21, d / 2 + 0.05));      // 拱心石
  // 内缩窗：每层前 3 后 3，石材窗台 / 首层石过梁
  const winMat = M.glass(0x88aabb);
  for (let f = 0; f < floors; f++) {
    const baseY = 0.5 + f * floorH;
    const wy = baseY + floorH * 0.48;
    const ww = f === 0 ? 0.9 : 0.8, wh = f === 0 ? 1.5 : 1.2;
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + (i + 0.5) * (w / 3);
      if (!(f === 0 && i === 1))                                                   // 首层正中被门廊占据，不开窗
        g.add(onWall(winUnit(ww, wh, { frameMat: trimMat, glassMat: winMat, lintel: f > 0, lintelMat: stoneMat, sill: true }), x, wy, d / 2, 'z', 1));
      g.add(onWall(winUnit(ww, wh, { frameMat: trimMat, glassMat: winMat, muntins: true }), x, wy, -d / 2, 'z', -1));
    }
  }
  // 檐口：挑檐 + 齿饰
  g.add(box(w + 0.4, 0.35, d + 0.4, stoneMat, 0, 0.5 + h + 0.175, 0));
  g.add(dentils(w + 0.3, stoneMat, 0, 0.5 + h + 0.05, d / 2 + 0.22, 0.24));
  g.add(dentils(w + 0.3, stoneMat, 0, 0.5 + h + 0.05, -d / 2 - 0.22, 0.24));
  g.add(box(w + 0.3, 0.12, d + 0.3, trimMat, 0, 0.5 + h + 0.41, 0));
  shade(g); return g;
}

function buildCraftsman(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.0;
  const wood = M.paint(p.woodColor, 0.82);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const stoneMat = M.concrete(0x9a9488);
  const foundH = 0.45;
  g.add(box(w + 0.1, foundH, d + 0.1, stoneMat, 0, foundH / 2, 0));
  g.add(box(w, wallH, d, wood, 0, foundH + wallH / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                              // 转角壁板条
    g.add(box(0.1, wallH, 0.1, trimMat, sx * (w / 2 - 0.05), foundH + wallH / 2, sz * (d / 2 - 0.05)));
  for (const t of [0.045, wallH - 0.045])                                           // 墙裙 / 檐下线脚
    g.add(box(w + 0.06, 0.09, 0.07, trimMat, 0, foundH + t, d / 2 + 0.035));
  // 低坡双坡屋顶：坡面 + 沥青瓦垄立体挤出 + 山墙三角 + 出檐/封檐板/椽尾
  const roofMat = M.paint(p.roofColor, 0.78);
  const ohX = 0.62;                                                               // 山面出檐
  const run = w / 2 + ohX, rise = w * 0.22, slope = Math.hypot(run, rise);
  const th = Math.atan2(rise, run), eaveY = foundH + wallH;
  // 屋面直线必须过「墙外皮 + 墙顶」这一点：旧版让它过檐口外沿 (run, eaveY)，
  // 于是屋面在墙外皮处已经抬起 ohX/run·rise，底面比墙顶高出 13.5cm —— 整条檐口下通长一道缝，
  // 看着就是屋顶浮在墙上。把整组屋面向下落 drop 即可。
  const drop = (run - w / 2) / run * rise;
  for (const s of [1, -1]) {
    const sl = box(slope, 0.2, d + 1.4, roofMat, s * run / 2, eaveY + rise / 2 - drop, 0);
    sl.rotation.z = -s * th; g.add(sl);
    g.add(shingleCourses(sl, Math.max(7, Math.round(slope / 0.4)), roofMat));
    const rake = box(slope, 0.14, 0.09, trimMat, s * run / 2, eaveY + rise / 2 + 0.16 - drop, d / 2 + 0.7);
    rake.rotation.z = -s * th; g.add(rake);
    const rake2 = rake.clone(); rake2.position.z = -d / 2 - 0.7; g.add(rake2);
    g.add(box(0.07, 0.24, d + 1.42, trimMat, s * (run + 0.02), eaveY - drop + 0.03, 0));  // 封檐板
    const nRaft = Math.max(4, Math.round((d + 1.2) / 0.42));                        // 出挑椽尾（贴在檐口下）
    for (let i = 0; i < nRaft; i++) {
      const z = -(d + 1.2) / 2 + (i + 0.5) * ((d + 1.2) / nRaft);
      g.add(box(0.32, 0.13, 0.09, roofMat, s * (run - 0.16), eaveY - drop + (0.16 * rise) / run - 0.01, z));
    }
  }
  g.add(box(0.16, 0.16, d + 1.5, roofMat, 0, eaveY + rise - drop - 0.08, 0));       // 正脊
  for (const sz of [-1, 1]) {                                                       // 山墙面（高度跟着 drop 收）
    const shp = new THREE.Shape();
    shp.moveTo(-w / 2, 0); shp.lineTo(w / 2, 0); shp.lineTo(0, rise - drop); shp.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.12, bevelEnabled: false }), wood);
    tri.position.set(0, eaveY, sz * (d / 2));
    if (sz < 0) tri.rotation.y = Math.PI;
    g.add(tri);
  }
  g.add(box(0.5, 0.34, 0.08, trimMat, 0, eaveY + (rise - drop) * 0.5, d / 2 + 0.16)); // 山墙通风百叶
  for (let i = 0; i < 3; i++) g.add(box(0.44, 0.035, 0.03, M.dark(0x2a2620, 0.9), 0, eaveY + (rise - drop) * 0.5 - 0.11 + i * 0.11, d / 2 + 0.21));
  // 前廊：落地门廊台 + 石砌柱墩 + 收分方柱（4 边形棱台）+ 斜撑 + 车木栏杆
  const porchD = 2.4, colH = wallH * 0.72, pierH = 0.62;
  const deckTop = foundH - 0.06, colTopY = deckTop + colH;
  g.add(box(w + 0.66, deckTop, porchD + 0.3, stoneMat, 0, deckTop / 2, d / 2 + (porchD + 0.3) / 2));
  g.add(box(w + 0.7, 0.1, 0.1, stoneMat, 0, deckTop - 0.05, d / 2 + porchD + 0.2));  // 台沿压条
  for (const s of [-1, 1]) {
    const cx = s * (w / 2 - 0.45), cz = d / 2 + porchD - 0.3;
    g.add(box(0.52, pierH, 0.52, stoneMat, cx, deckTop + pierH / 2, cz));            // 石砌柱墩
    g.add(box(0.44, 0.08, 0.44, trimMat, cx, deckTop + pierH + 0.04, cz));           // 柱础线脚
    const shaftH = colH - pierH - 0.16;
    const shaft = cylRaw(0.115, 0.17, shaftH, trimMat, 4, cx, deckTop + pierH + 0.08 + shaftH / 2, cz);
    shaft.rotation.y = Math.PI / 4; g.add(shaft);                                    // 收分方柱
    g.add(box(0.34, 0.1, 0.34, trimMat, cx, colTopY - 0.13, cz));                    // 柱头线脚
    g.add(box(0.4, 0.12, 0.4, trimMat, cx, colTopY - 0.02, cz));
    // 斜撑：下端落柱身、上端顶廊檐横梁底（旧版只有上端搭住柱子，下端 0.6m 悬在空中）
    const bw = 0.58;
    const brace = box(0.09, Math.hypot(bw, bw), 0.09, trimMat, cx - s * bw / 2, colTopY - bw / 2 + 0.05, cz);
    brace.rotation.z = s * Math.PI / 4; g.add(brace);
  }
  g.add(box(w - 0.5, 0.2, 0.2, wood, 0, colTopY + 0.1, d / 2 + porchD - 0.3));       // 廊檐横梁
  g.add(box(w + 0.3, 0.1, porchD + 0.3, roofMat, 0, colTopY + 0.25, d / 2 + porchD / 2));
  g.add(box(w + 0.34, 0.14, 0.1, trimMat, 0, colTopY + 0.24, d / 2 + porchD + 0.1));  // 封边板
  const railH = 0.86, stairW = w * 0.42;
  for (const s of [-1, 1]) {                                                        // 前栏（中间留梯口）
    const seg = (w - 0.9 - stairW) / 2;
    const rail = balustrade(seg, railH, trimMat, { spacing: 0.16 });
    rail.position.set(s * (stairW / 2 + seg / 2), deckTop, d / 2 + porchD - 0.3);
    g.add(rail);
    const side = balustrade(porchD - 0.7, railH, trimMat, { spacing: 0.17 });       // 侧栏
    side.rotation.y = Math.PI / 2;
    side.position.set(s * (w / 2 - 0.45), deckTop, d / 2 + (porchD - 0.7) / 2 + 0.15);
    g.add(side);
  }
  const st = stairRun(stairW, 3, deckTop / 3, 0.32, stoneMat);
  st.position.set(0, 0, d / 2 + porchD + 0.24); g.add(st);
  // 内缩门 + 内缩窗（上亮分格）
  const doorMat = M.paint(0x5a4030, 0.7);
  g.add(onWall(doorUnit(0.98, 2.05, { frameMat: trimMat, doorMat, panelCols: 1, panelRows: 2, panelColor: 0x4a3020, lintel: true, lintelMat: trimMat }), 0, foundH + 1.025, d / 2, 'z', 1));
  const winMat = M.glass(0x99bbcc);
  for (const x of [-w / 3, w / 3]) {
    g.add(onWall(winUnit(1.05, 1.05, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 3, rows: 1, shutters: true, shutterMat: M.paint(0x2a3a4a, 0.75) }), x, foundH + wallH * 0.56, d / 2, 'z', 1));
  }
  for (const sx of [-1, 1]) {
    g.add(onWall(winUnit(1.05, 1.05, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 3, rows: 1 }), sx * (w / 2), foundH + wallH * 0.56, 0, 'x', sx));
  }
  for (const x of [-w / 3.2, w / 3.2]) {
    g.add(onWall(winUnit(0.9, 0.9, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 1 }), x, foundH + wallH * 0.56, -d / 2, 'z', -1));
  }
  // 石砌烟囱
  const chX = -w * 0.35;
  const chTop = eaveY + (rise - drop) * (1 - Math.abs(chX) / (w / 2)) + 0.5;
  g.add(box(0.56, chTop, 0.5, stoneMat, chX, chTop / 2, 0));
  for (let i = 0; i < 5; i++) g.add(box(0.58, 0.045, 0.52, M.concrete(0x86705e), chX, 0.4 + i * 0.5, 0));
  g.add(box(0.66, 0.1, 0.6, M.concrete(0x7a6050), chX, chTop + 0.05, 0));
  shade(g); return g;
}

function buildSouthernColonial(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, floors = p.floors, floorH = 3.2, h = floors * floorH;
  const wall = M.paint(p.wallColor, 0.85);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const stoneMat = M.concrete(0x9a9488);
  const foundH = 0.5, porchD = 2.5;
  g.add(box(w + 0.15, foundH, d + 0.15, stoneMat, 0, foundH / 2, 0));
  g.add(box(w, h, d, wall, 0, foundH + h / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                              // 转角壁板条
    g.add(box(0.12, h, 0.12, trimMat, sx * (w / 2 - 0.06), foundH + h / 2, sz * (d / 2 - 0.06)));
  for (let f = 0; f <= floors; f++) {                                              // 层间腰线
    const cy = foundH + f * floorH;
    g.add(box(w + 0.1, 0.11, d + 0.1, trimMat, 0, cy + 0.055, 0));
    g.add(box(w + 0.14, 0.05, d + 0.14, trimMat, 0, cy + 0.14, 0));
  }
  // 屋顶：坡面 + 瓦垄 + 山墙 + 齿饰檐口
  const roofMat = M.paint(p.roofColor, 0.8);
  const rise = w * 0.2, slope = Math.hypot(w / 2, rise);
  for (const s of [1, -1]) {
    const sl = box(slope, 0.18, d + 0.8, roofMat, s * w / 4, foundH + h + rise / 2, 0);
    sl.rotation.z = -s * Math.atan2(rise, w / 2); g.add(sl);
    g.add(shingleCourses(sl, Math.max(8, Math.round(slope / 0.46)), roofMat));
  }
  g.add(box(0.16, 0.16, d + 0.9, roofMat, 0, foundH + h + rise - 0.08, 0));
  for (const sz of [-1, 1]) {
    const shp = new THREE.Shape();
    shp.moveTo(-w / 2, 0); shp.lineTo(w / 2, 0); shp.lineTo(0, rise); shp.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.14, bevelEnabled: false }), wall);
    tri.position.set(0, foundH + h, sz * (d / 2));
    if (sz < 0) tri.rotation.y = Math.PI;
    g.add(tri);
  }
  g.add(box(w + 0.45, 0.3, d + 0.45, trimMat, 0, foundH + h + 0.15, 0));            // 檐口
  g.add(dentils(w + 0.36, trimMat, 0, foundH + h + 0.03, d / 2 + 0.24, 0.46));
  g.add(dentils(w + 0.36, trimMat, 0, foundH + h + 0.03, -d / 2 - 0.24, 0.46));
  g.add(box(w + 0.4, 0.08, d + 0.4, trimMat, 0, foundH + h + 0.34, 0));
  // 两层通高门廊：14 边形圆柱 + 二楼阳台车木栏杆
  const nCol = 4;
  for (let i = 0; i < nCol; i++) {
    const x = -w / 2 + 1.0 + i * ((w - 2.0) / (nCol - 1));
    const c = porchColumn(h, 0.19, trimMat, 14);
    c.position.set(x, foundH, d / 2 + porchD / 2); g.add(c);
  }
  g.add(box(w - 0.2, 0.26, 0.26, trimMat, 0, foundH + h + 0.13, d / 2 + porchD / 2));
  g.add(box(w + 0.3, 0.14, porchD + 0.2, trimMat, 0, foundH + h + 0.33, d / 2 + porchD / 2));
  g.add(box(w + 0.34, 0.2, 0.1, trimMat, 0, foundH + h + 0.36, d / 2 + porchD + 0.05));
  g.add(box(w + 0.2, 0.12, porchD, stoneMat, 0, foundH + 0.01 - 0.06, d / 2 + porchD / 2));  // 门廊地板（旧版是零厚度 plane，无厚度无边缘，侧看等于没有）
  g.add(box(w + 0.24, 0.16, 0.07, trimMat, 0, foundH - 0.02, d / 2 + porchD + 0.03));            // 门廊台沿
  const balconyD = porchD, balconyH = foundH + floorH;                                // 阳台板顶到墙外皮（旧版 1.5 深，离墙 1m 悬空）
  g.add(box(w - 0.3, 0.13, balconyD, stoneMat, 0, balconyH - 0.065, d / 2 + porchD - balconyD / 2));
  g.add(box(w - 0.34, 0.06, 0.08, trimMat, 0, balconyH - 0.16, d / 2 + porchD - 0.1));
  const balFront = balustrade(w - 0.6, 0.9, trimMat, { spacing: 0.32, belly: false });
  balFront.position.set(0, balconyH, d / 2 + porchD - 0.16); g.add(balFront);
  for (const s of [-1, 1]) {
    const side = balustrade(balconyD - 0.3, 0.9, trimMat, { spacing: 0.3, posts: false, belly: false });
    side.rotation.y = Math.PI / 2;
    side.position.set(s * (w / 2 - 0.45), balconyH, d / 2 + porchD - balconyD / 2);
    g.add(side);
  }
  // 一层栏杆 + 中央踏步
  const stairW = w * 0.3;
  for (const s of [-1, 1]) {
    const segL = (w - 0.6 - stairW) / 2;
    const rail = balustrade(segL, 0.92, trimMat, { spacing: 0.32, belly: false });
    rail.position.set(s * (stairW / 2 + segL / 2), foundH, d / 2 + porchD - 0.2);
    g.add(rail);
  }
  const stN = 4, stRise = (foundH + 0.01) / stN, stRun = 0.34;                       // 总升高 = 门廊地面标高，末级顶面与地面齐平
  const st = stairRun(stairW, stN, stRise, stRun, stoneMat);
  // 最高一级的顶面正好落在门廊前沿（旧版整段塞在门廊底下，只露出 0.42m）
  st.position.set(0, 0, d / 2 + porchD + stN * stRun); g.add(st);                    // 末级后沿正好贴住门廊前沿
  // 内缩窗（含百叶）+ 扇形气窗门 + 门侧采光条
  const winMat = M.glass(0x88aabb);
  const shutterMat = M.paint(0x2a4a3a, 0.75);
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + (i + 0.5) * (w / 3);
      if (f === 0 && i === 1) continue;                                             // 中央留门
      const wy = foundH + floorH * 0.52 + f * floorH;
      g.add(onWall(winUnit(1.0, 1.5, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 3, shutters: true, shutterMat }), x, wy, d / 2, 'z', 1));
      g.add(onWall(winUnit(1.0, 1.5, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 3 }), x, wy, -d / 2, 'z', -1));
    }
    for (const sx of [-1, 1]) {
      const wy = foundH + floorH * 0.52 + f * floorH;
      g.add(onWall(winUnit(0.85, 1.4, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 3 }), sx * (w / 2), wy, 0, 'x', sx));
    }
  }
  // 门套：樘 + 过梁留空（旧版一整块实心板把门扇和气窗一起盖死）
  const scOpenH = 2.35 / 2 + 0.09 + 0.64 + 0.05 + 0.04 + 1.175;                     // 门底到气窗顶盖
  g.add(surroundFrame(1.86, scOpenH, 0.14, 0.14, trimMat, 0, foundH + scOpenH / 2, d / 2 + 0.04, { sill: false }));
  g.add(onWall(doorUnit(1.1, 2.35, { frameMat: trimMat, doorMat: M.paint(0x4a3520, 0.7), panelCols: 2, panelRows: 3, fanlight: true, sidelights: true }), 0, foundH + 1.175, d / 2, 'z', 1));
  // 烟囱
  const chX = w * 0.36, chTop = foundH + h + rise * 0.42;
  g.add(box(0.55, chTop - foundH, 0.5, M.concrete(0x8a7060), chX, foundH + (chTop - foundH) / 2, -d * 0.2));
  g.add(box(0.68, 0.1, 0.62, M.concrete(0x7a6050), chX, chTop + 0.05, -d * 0.2));
  shade(g); return g;
}

function buildAdobe(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.2;
  const adobe = M.paint(p.wallColor, 0.92);
  const foundH = 0.35;
  const stoneMat = M.concrete(0xb09a80);
  g.add(box(w + 0.2, foundH, d + 0.2, stoneMat, 0, foundH / 2, 0));
  g.add(box(w, wallH, d, adobe, 0, foundH + wallH / 2, 0));
  g.add(box(w + 0.16, 0.14, d + 0.16, adobe, 0, foundH + wallH + 0.07, 0));          // 女儿墙压顶
  g.add(box(w + 0.08, 0.22, 0.08, adobe, 0, foundH + wallH - 0.11, d / 2 + 0.04));
  // 侧翼比主体浅（0.5d）——必须向前凸出，否则整只埋进主体里、翼上的窗完全看不见；
  // 同时贴右端布置、右缘不超过 w/2，才能不压住正立面门窗和右侧墙窗
  const wingW = w * 0.24, wingD = d * 0.5, wingH = wallH * 0.7;
  const wingX = w / 2 - wingW / 2, wingFront = d / 2 + 0.35, wingZ = wingFront - wingD / 2;
  g.add(box(wingW, wingH, wingD, adobe, wingX, foundH + wingH / 2, wingZ));
  g.add(box(wingW + 0.14, 0.12, wingD + 0.14, adobe, wingX, foundH + wingH + 0.06, wingZ));
  // 木梁（vigas）与排水槽（canales）：8 边形原木，两端出挑
  const vigas = M.paint(0x6b4e35, 0.85);
  const vigaSpacing = 0.8;
  const nVigas = Math.max(2, Math.floor((d - 0.6) / vigaSpacing));
  for (let i = 0; i <= nVigas; i++) {
    const z = -d / 2 + 0.3 + i * ((d - 0.6) / nVigas);
    for (const sx of [-1, 1]) {
      const v = cylRaw(0.072, 0.085, 0.42, vigas, 8, sx * (w / 2 + 0.12), foundH + wallH - 0.16, z);
      v.rotation.z = Math.PI / 2; g.add(v);
    }
  }
  const nV2 = Math.max(2, Math.floor((wingD - 0.4) / vigaSpacing));
  for (let i = 0; i <= nV2; i++) {
    const z = -wingD / 2 + 0.2 + i * ((wingD - 0.4) / nV2);
    const v = cylRaw(0.06, 0.07, 0.34, vigas, 8, wingX + wingW / 2 + 0.1, foundH + wingH - 0.14, wingZ + z);
    v.rotation.z = Math.PI / 2; g.add(v);
  }
  for (const sx of [-1, 1]) {                                                       // canales
    const c = cylRaw(0.045, 0.055, 0.5, vigas, 8, sx * (w / 2 + 0.1), foundH + wallH + 0.12, -d * 0.28);
    c.rotation.z = Math.PI / 2; c.rotation.y = 0.1 * sx; g.add(c);
  }
  // 门廊（portal）：原木柱 + 横梁 + 一排小椽 + 泥土地坪
  const portalD = 1.8, portalPosts = 3;
  for (let i = 0; i < portalPosts; i++) {
    const x = -w / 2 + 0.6 + i * ((w - 1.2) / (portalPosts - 1));
    const post = cylRaw(0.075, 0.1, wallH * 0.86, vigas, 8, x, foundH + wallH * 0.43, d / 2 + portalD / 2);
    post.rotation.y = i * 0.4; g.add(post);
    g.add(box(0.26, 0.09, 0.26, vigas, x, foundH + wallH * 0.865, d / 2 + portalD / 2));
  }
  g.add(box(w + 0.3, 0.14, 0.16, vigas, 0, foundH + wallH * 0.9, d / 2 + portalD / 2));
  g.add(box(w + 0.3, 0.12, portalD + 0.2, vigas, 0, foundH + wallH * 0.82, d / 2 + portalD / 2));
  const nLat = Math.max(6, Math.floor(w / 0.45));
  for (let i = 0; i <= nLat; i++) {
    const x = -w / 2 - 0.1 + ((i * (w + 0.2)) / nLat);
    const lat = cylRaw(0.035, 0.04, portalD + 0.16, vigas, 6, x, foundH + wallH * 0.75, d / 2 + portalD / 2);
    lat.rotation.x = Math.PI / 2; g.add(lat);
  }
  g.add(box(w + 0.2, foundH, portalD + 0.1, M.concrete(0xc4a882), 0, foundH / 2, d / 2 + portalD / 2));   // 门廊地坪（实心，不再是一张悬空的面）
  g.add(box(w + 0.24, 0.16, 0.12, stoneMat, 0, foundH + 0.08, d / 2 + portalD + 0.06));
  // 内缩木门（木过梁）+ 内缩木框窗
  const doorMat = M.paint(0x5a4030, 0.7);
  g.add(box(1.24, 0.16, 0.22, vigas, 0, foundH + 2.14, d / 2 + 0.06));               // 木过梁
  g.add(onWall(doorUnit(0.86, 1.94, { frameMat: vigas, doorMat, panelCols: 1, panelRows: 2, panelColor: 0x4a3525, dep: 0.14 }), 0, foundH + 0.97, d / 2, 'z', 1));
  const winMat = M.glass(0x99aabb);
  for (const sx of [-1, 1]) {
    const wx = sx * w * 0.20;
    g.add(box(1.02, 0.14, 0.2, vigas, wx, foundH + wallH * 0.55 + 0.5, d / 2 + 0.05));   // 窗过梁
    g.add(onWall(winUnit(0.78, 0.78, { frameMat: vigas, glassMat: winMat, muntins: true, cols: 2, rows: 2, ft: 0.09, dep: 0.13 }), wx, foundH + wallH * 0.55, d / 2, 'z', 1));
    g.add(box(0.94, 0.1, 0.24, stoneMat, wx, foundH + wallH * 0.55 - 0.52, d / 2 + 0.1)); // 石窗台
  }
  g.add(onWall(winUnit(0.66, 0.66, { frameMat: vigas, glassMat: winMat, muntins: true, cols: 2, rows: 1, ft: 0.09, dep: 0.13 }), wingX, foundH + wingH * 0.55, wingFront, 'z', 1));
  g.add(onWall(winUnit(0.62, 0.62, { frameMat: vigas, glassMat: winMat, muntins: false, ft: 0.08, dep: 0.13 }), -w / 2, foundH + wallH * 0.6, -d * 0.1, 'x', -1));
  for (let i = 0; i < 4; i++) {                                                     // 壁龛（nicho）
    const nx = w * 0.34 - i * 0.5;
    const nz = i < 2 ? d / 2 : -d / 2;
    g.add(box(0.34, 0.34, 0.05, M.dark(0x2a2118, 0.95), nx, foundH + wallH * 0.72, nz + (i < 2 ? 0.026 : -0.026)));
    g.add(box(0.42, 0.06, 0.1, adobe, nx, foundH + wallH * 0.72 + 0.2, nz + (i < 2 ? 0.05 : -0.05)));
  }
  // 侧墙与背墙窗
  g.add(onWall(winUnit(0.7, 0.7, { frameMat: vigas, glassMat: winMat, muntins: true, cols: 2, rows: 2, ft: 0.09, dep: 0.13 }), w / 2, foundH + wallH * 0.55, d * 0.22, 'x', 1));
  g.add(onWall(winUnit(0.7, 0.7, { frameMat: vigas, glassMat: winMat, muntins: true, cols: 2, rows: 2, ft: 0.09, dep: 0.13 }), -w / 2, foundH + wallH * 0.55, -d * 0.3, 'x', -1));
  g.add(onWall(winUnit(0.64, 0.64, { frameMat: vigas, glassMat: winMat, muntins: false, ft: 0.08, dep: 0.13 }), 0, foundH + wallH * 0.6, -d / 2, 'z', -1));
  // 门廊梁下托木（corbel）
  for (let i = 0; i < portalPosts; i++) {
    const x = -w / 2 + 0.6 + i * ((w - 1.2) / (portalPosts - 1));
    for (const sz of [-1, 1]) {
      const cb = box(0.1, 0.34, 0.12, vigas, x, foundH + wallH * 0.78, d / 2 + portalD / 2 + sz * 0.5);
      cb.rotation.x = sz * 0.18; g.add(cb);
    }
  }
  // 矮院墙 + 木门：整段落地，两侧加短墙接回主体（旧版悬在 foundH 高度、离主体 1.4m）
  const wallLen = w * 0.62, gy = d / 2 + portalD + 1.5, wallH2 = foundH + 0.95;
  for (const sx of [-1, 1]) {
    const gx = sx * (0.7 + wallLen / 2);
    g.add(box(wallLen, wallH2, 0.24, adobe, gx, wallH2 / 2, gy));
    g.add(box(wallLen + 0.08, 0.08, 0.32, adobe, gx, wallH2 + 0.04, gy));
    g.add(box(0.3, wallH2 + 0.17, 0.3, adobe, sx * 0.66, (wallH2 + 0.17) / 2, gy));  // 墙墩
    g.add(box(0.24, wallH2 * 0.82, gy - (d / 2 + portalD), adobe,                     // 侧墙接回主体
      sx * (w / 2 + 0.12), wallH2 * 0.41, (gy + d / 2 + portalD) / 2));
  }
  const gate = doorUnit(1.0, 1.2, { frameMat: vigas, doorMat, panelColor: 0x4a3525, panelCols: 2, panelRows: 2, dep: 0.1 });
  gate.position.set(0, 0.63, gy); g.add(gate);
  // 土坯长凳（banco）：贴着外墙坐在地面上
  const banco = new THREE.Group();
  banco.add(slabTop(1.5, 0.12, 0.4, adobe, 0, 0.46, 0));
  banco.add(box(0.22, 0.46, 0.36, adobe, -0.6, 0.23, 0));
  banco.add(box(0.22, 0.46, 0.36, adobe, 0.6, 0.23, 0));
  banco.position.set(-w / 2 + 0.2, 0, d / 2 + portalD * 0.5);
  banco.rotation.y = Math.PI / 2; g.add(banco);
  // 圆形壁炉烟囱
  const chX = -w * 0.35, chZ = -d * 0.15;
  const ch = cylRaw(0.34, 0.42, wallH * 0.72, adobe, 10, chX, foundH + wallH * 0.36, chZ);
  g.add(ch);
  g.add(cylRaw(0.36, 0.36, 0.1, adobe, 10, chX, foundH + wallH * 0.72 + 0.05, chZ));
  g.add(cylRaw(0.2, 0.24, 0.34, adobe, 10, chX, foundH + wallH * 0.72 + 0.27, chZ));
  shade(g); return g;
}

function buildSpanishColonial(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.4;
  const stucco = M.paint(p.wallColor, 0.88);
  const foundH = 0.4;
  g.add(box(w + 0.15, foundH, d + 0.15, M.concrete(0xb09a80), 0, foundH / 2, 0));
  g.add(box(w, wallH, d, stucco, 0, foundH + wallH / 2, 0));
  g.add(box(w + 0.12, 0.16, d + 0.12, stucco, 0, foundH + wallH + 0.08, 0));         // 檐口抹灰带
  // 筒瓦坡屋面：瓦垄顺坡挂到坡面上（不再是悬空小方块）
  const roofMat = M.tile(p.roofColor, 0.78);
  const rise = w * 0.18, slope = Math.hypot(w / 2, rise);
  const nRows = Math.max(10, Math.min(38, Math.round((d + 0.7) / 0.26)));
  for (const s of [1, -1]) {
    const sl = box(slope, 0.16, d + 0.7, roofMat, s * w / 4, foundH + wallH + rise / 2, 0);
    sl.rotation.z = -s * Math.atan2(rise, w / 2); g.add(sl);
    g.add(barrelTiles(sl, nRows, roofMat));
  }
  g.add(box(0.18, 0.18, d + 0.8, roofMat, 0, foundH + wallH + rise - 0.09, 0));      // 脊瓦
  for (const sz of [-1, 1]) {                                                        // 山墙
    const shp = new THREE.Shape();
    shp.moveTo(-w / 2, 0); shp.lineTo(w / 2, 0); shp.lineTo(0, rise); shp.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.14, bevelEnabled: false }), stucco);
    tri.position.set(0, foundH + wallH, sz * (d / 2));
    if (sz < 0) tri.rotation.y = Math.PI;
    g.add(tri);
  }
  // 前廊拱券（arcade）：券柱外凸 + 券内暗腔 → 真实进深
  const archW = 1.2, archH = 2.2, archDep = 0.34;
  const nArches = 3;
  const darkMat = M.dark(0x1a1610, 0.95);
  for (let i = 0; i < nArches; i++) {
    const x = -w / 3 + i * (w * 0.66 / (nArches - 1));
    g.add(box(archW + 0.06, archH + archW / 2, 0.03, darkMat, x, foundH + (archH + archW / 2) / 2, d / 2 + 0.02));
    for (const s of [-1, 1]) g.add(box(0.26, archH, archDep, stucco, x + s * (archW / 2 + 0.13), foundH + archH / 2, d / 2 + archDep / 2));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(archW / 2 + 0.16, archW / 2 + 0.16, archDep, 12, 1, false, 0, Math.PI), stucco);
    ring.rotation.z = Math.PI / 2; ring.rotation.y = Math.PI / 2;
    ring.position.set(x, foundH + archH, d / 2 + archDep / 2); g.add(ring);
    g.add(box(archW + 0.5, 0.14, archDep + 0.06, stucco, x, foundH + archH + archW / 2 + 0.07, d / 2 + archDep / 2));
    const post = cylRaw(0.07, 0.08, archH * 0.82, M.paint(0x6b4e35, 0.85), 8, x, foundH + archH * 0.41, d / 2 + archDep - 0.12);
    g.add(post);
  }
  g.add(planeXZ(w + 0.2, archDep + 0.1, M.concrete(0xc4a882), 0, foundH + 0.012, d / 2 + archDep / 2));
  // 铁艺阳台：托梁 + 石板 + 6 边形铁栏柱 + 卷草
  const balconyH = foundH + wallH * 0.68, balW = w * 0.72, balD = 1.2;
  g.add(box(balW, 0.13, balD, M.concrete(0x9a9488), 0, balconyH - 0.065, d / 2 + balD / 2));
  g.add(box(balW + 0.06, 0.07, balD + 0.06, M.concrete(0x8a8478), 0, balconyH - 0.16, d / 2 + balD / 2));
  const ironMat = M.metal(0x2a2a2a, 0.5, 0.8);
  const nBal = Math.max(8, Math.round(balW / 0.18));
  for (let i = 0; i <= nBal; i++) {
    const x = -balW / 2 + (i * balW) / nBal;
    g.add(cylRaw(0.016, 0.02, 0.82, ironMat, 6, x, balconyH + 0.41, d / 2 + balD - 0.08));
  }
  g.add(box(balW, 0.05, 0.05, ironMat, 0, balconyH + 0.84, d / 2 + balD - 0.08));
  g.add(box(balW, 0.05, 0.05, ironMat, 0, balconyH + 0.4, d / 2 + balD - 0.08));
  g.add(box(balW, 0.045, 0.045, ironMat, 0, balconyH + 0.06, d / 2 + balD - 0.08));
  for (let i = 0; i < Math.max(3, Math.round(balW / 0.6)); i++) {                    // 卷草
    const x = -balW / 2 + ((i + 0.5) * balW) / Math.max(3, Math.round(balW / 0.6));
    const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.013, 4, Math.max(8, Math.round(12 * DQ.k)), Math.PI), ironMat);
    scroll.position.set(x, balconyH + 0.18, d / 2 + balD - 0.08); g.add(scroll);
  }
  for (const s of [-1, 1]) {                                                         // 侧栏 + 斜撑
    g.add(box(0.05, 0.84, 0.05, ironMat, s * (balW / 2 - 0.03), balconyH + 0.42, d / 2 + balD - 0.08));
    g.add(box(0.05, 0.05, balD - 0.16, ironMat, s * (balW / 2 - 0.03), balconyH + 0.84, d / 2 + balD / 2));
    for (let i = 0; i < 3; i++) g.add(cylRaw(0.015, 0.018, 0.78, ironMat, 6, s * (balW / 2 - 0.03), balconyH + 0.4, d / 2 + 0.25 + i * 0.34));
    const br = box(0.07, 0.07, 0.9, ironMat, s * balW * 0.42, balconyH - 0.42, d / 2 + balD * 0.42);
    br.rotation.x = 0.36; g.add(br);
  }
  // 内缩窗 + 铁窗栅 + 拱心窗
  // 竖向排布（旧版三层互相打架：阳台托梁横穿一层窗、阳台拱窗整扇埋进正面山墙）：
  //   一层窗顶 → 阳台托梁底 → 阳台面 → 阳台拱窗 → 墙顶（山墙起点）
  const winMat = M.glass(0x88aabb);
  const wy1 = foundH + wallH * 0.38;
  for (const x of [-w * 0.31, w * 0.31]) {
    const wu = winUnit(0.9, 1.2, { frameMat: M.paint(0x6b4e35, 0.85), glassMat: winMat, muntins: true, cols: 2, rows: 2, dep: 0.13, ft: 0.1 });
    for (const ss of [-1, 1]) wu.add(box(0.035, 1.34, 0.035, ironMat, ss * 0.56, 0, 0.07));
    for (let k = 0; k < 4; k++) wu.add(box(1.16, 0.03, 0.03, ironMat, 0, -0.53 + k * 0.38, 0.07));
    g.add(onWall(wu, x, wy1, d / 2, 'z', 1));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    g.add(onWall(winUnit(0.8, 1.2, { frameMat: M.paint(0x6b4e35, 0.85), glassMat: winMat, muntins: true, cols: 2, rows: 2, dep: 0.13 }), sx * (w / 2), wy1, -d * 0.24 + i * d * 0.44, 'x', sx));
  }
  for (const x of [-w * 0.24, w * 0.24]) {
    g.add(onWall(winUnit(0.5, 0.4, { frameMat: M.paint(0x6b4e35, 0.85), glassMat: winMat, muntins: false, arch: true, dep: 0.13 }), x, foundH + wallH * 0.8, d / 2, 'z', 1));
  }
  // 拱门 + 铁饰门钉（门套改成樘+过梁，洞口留空；拱券落回门头上，旧版悬空 0.25m）
  const doorMat = M.paint(0x5a4030, 0.7);
  const archTop = foundH + 2.09 + 0.5;
  g.add(surroundFrame(1.12, archTop - foundH, 0.13, 0.2, stucco, 0, foundH + (archTop - foundH) / 2, d / 2 + 0.06, { sill: false }));
  const doorArch = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12, 1, false, 0, Math.PI), stucco);
  doorArch.rotation.z = Math.PI / 2; doorArch.rotation.y = Math.PI / 2;
  doorArch.position.set(0, foundH + 2.09, d / 2 + 0.08); g.add(doorArch);
  g.add(onWall(doorUnit(0.94, 2.0, { frameMat: M.paint(0x6b4e35, 0.85), doorMat, panelCols: 2, panelRows: 2, panelColor: 0x4a3525, dep: 0.16 }), 0, foundH + 1.0, d / 2, 'z', 1));
  g.add(box(0.5, 0.09, 0.05, ironMat, 0.3, foundH + 1.05, d / 2 + 0.17));
  g.add(cylRaw(0.028, 0.028, 0.1, ironMat, 8, 0.3, foundH + 1.05, d / 2 + 0.2));
  // 抹灰烟囱
  const chX = w * 0.38;
  g.add(box(0.52, wallH * 0.56, 0.46, stucco, chX, foundH + wallH + rise * 0.3, -d * 0.15));
  g.add(box(0.64, 0.09, 0.58, stucco, chX, foundH + wallH + rise * 0.3 + wallH * 0.28, -d * 0.15));
  shade(g); return g;
}

// ===========================================================================
// Ch2 — American Suburban Buildings (6)
// ===========================================================================
function buildColonialChurch(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 4.0;
  const wall = M.paint(p.wallColor, 0.85);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const foundH = 0.5;
  g.add(box(w + 0.2, foundH, d + 0.2, M.concrete(0x888888), 0, foundH / 2, 0));
  g.add(box(w, wallH, d, wall, 0, foundH + wallH / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                              // 隅石
    g.add(box(0.16, wallH, 0.16, trimMat, sx * (w / 2 - 0.08), foundH + wallH / 2, sz * (d / 2 - 0.08)));
  for (let i = 1; i <= 3; i++) g.add(box(w + 0.06, 0.09, d + 0.06, trimMat, 0, foundH + (i * wallH) / 3, 0));
  g.add(box(w + 0.3, 0.26, d + 0.3, trimMat, 0, foundH + wallH + 0.13, 0));          // 檐口 + 齿饰
  g.add(dentils(w + 0.2, trimMat, 0, foundH + wallH + 0.02, d / 2 + 0.16, 0.28));
  g.add(dentils(w + 0.2, trimMat, 0, foundH + wallH + 0.02, -d / 2 - 0.16, 0.28));
  g.add(box(w + 0.24, 0.08, d + 0.24, trimMat, 0, foundH + wallH + 0.3, 0));
  // 钟塔：塔身 + 拱形百叶钟窗 + 收分塔顶 + 尖塔 + 风向标十字
  const steepleW = 2.0, steepleH = 7.0, sy0 = foundH + wallH + 0.34;
  g.add(box(steepleW + 0.34, 0.34, steepleW + 0.34, trimMat, 0, foundH + wallH + 0.17, 0));
  g.add(box(steepleW, steepleH, steepleW, wall, 0, sy0 + steepleH / 2, 0));
  for (let i = 0; i < 4; i++) {                                                     // 塔角壁柱
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(box(0.18, steepleH, 0.18, trimMat, Math.cos(a) * steepleW * 0.5, sy0 + steepleH / 2, Math.sin(a) * steepleW * 0.5));
  }
  for (let i = 0; i < 4; i++) {                                                     // 百叶钟窗（暗腔 + 横叶）
    const a = (i / 4) * Math.PI * 2 + Math.PI / 2;
    const lx = Math.cos(a) * (steepleW / 2 + 0.02), lz = Math.sin(a) * (steepleW / 2 + 0.02);
    const grp = new THREE.Group();
    grp.add(box(0.72, 1.7, 0.05, M.dark(0x1a1e24, 0.95), 0, 0, 0));
    for (let k = 0; k < 7; k++) grp.add(box(0.68, 0.07, 0.06, trimMat, 0, -0.72 + k * 0.24, 0.03));
    grp.add(box(0.84, 0.1, 0.12, trimMat, 0, 0.9, 0.04));
    grp.add(box(0.84, 0.1, 0.12, trimMat, 0, -0.9, 0.04));
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 8, 1, false, 0, Math.PI), trimMat);
    arch.rotation.x = Math.PI / 2; arch.position.set(0, 0.85, 0.03); grp.add(arch);
    grp.rotation.y = -a + Math.PI / 2;
    grp.position.set(lx, sy0 + steepleH * 0.62, lz);
    g.add(grp);
  }
  g.add(box(steepleW + 0.24, 0.22, steepleW + 0.24, trimMat, 0, sy0 + steepleH + 0.11, 0));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(steepleW * 0.74, 3.0, 8), M.paint(p.roofColor, 0.8)).translateY(sy0 + steepleH + 1.72));
  const gold = M.metal(0xd4af37, 0.3, 0.8);
  g.add(cylRaw(0.055, 0.055, 1.5, gold, 8, 0, sy0 + steepleH + 3.5, 0));
  g.add(box(0.06, 0.66, 0.06, gold, 0, sy0 + steepleH + 4.55, 0));
  g.add(box(0.38, 0.06, 0.06, gold, 0, sy0 + steepleH + 4.66, 0));
  // 入口门廊：山花 + 两根 12 边形圆柱 + 双扇拱门 + 扇形气窗
  const portD = 1.1, portH = wallH * 0.82;
  for (const s of [-1, 1]) {
    const c = porchColumn(portH, 0.17, trimMat, 12);
    c.position.set(s * 1.05, foundH, d / 2 + portD - 0.2); g.add(c);
  }
  g.add(box(2.9, 0.24, portD + 0.2, trimMat, 0, foundH + portH + 0.12, d / 2 + portD / 2 - 0.1));
  const ped = new THREE.Shape();
  ped.moveTo(-1.55, 0); ped.lineTo(1.55, 0); ped.lineTo(0, 0.85); ped.closePath();
  const pedMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 0.22, bevelEnabled: false }), trimMat);
  pedMesh.position.set(0, foundH + portH + 0.24, d / 2 - 0.15); g.add(pedMesh);
  g.add(box(3.0, 0.1, portD + 0.26, trimMat, 0, foundH + portH + 0.29, d / 2 + portD / 2 - 0.1));
  const st = stairRun(2.6, 3, foundH / 3, 0.32, M.concrete(0x9a9488));
  st.position.set(0, 0, d / 2 + portD + 0.35); g.add(st);
  const winMat = M.glass(0x88aacc);
  const ccOpenH = 2.32 + 0.7;                                                       // 门底到拱券顶
  g.add(surroundFrame(1.44, ccOpenH, 0.14, 0.16, trimMat, 0, foundH + ccOpenH / 2, d / 2 + 0.04, { sill: false }));
  for (const s of [-1, 1])                                                          // 双扇门
    g.add(onWall(doorUnit(0.6, 2.3, { frameMat: trimMat, doorMat: M.paint(0x5a4030, 0.7), panelCols: 1, panelRows: 3, dep: 0.14 }), s * 0.33, foundH + 1.15, d / 2, 'z', 1));
  const doorArch = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 12, 1, false, 0, Math.PI), trimMat);
  doorArch.rotation.z = Math.PI / 2; doorArch.rotation.y = Math.PI / 2;
  doorArch.position.set(0, foundH + 2.32, d / 2 + 0.06); g.add(doorArch);
  g.add(box(1.6, 0.12, 0.2, trimMat, 0, foundH + 3.22, d / 2 + 0.1));
  // 拱心长窗（正立面）+ 侧立面拱窗
  for (const x of [-w * 0.31, w * 0.31])
    g.add(onWall(winUnit(0.7, 1.25, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 1, rows: 2, arch: true, ft: 0.09, dep: 0.12 }), x, foundH + wallH * 0.5, d / 2, 'z', 1));
  for (let s = 0; s < 3; s++) {
    const z = -d / 2 + (s + 0.5) * (d / 3);
    for (const sx of [-1, 1]) {
      const wu = winUnit(0.62, 1.7, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 1, rows: 3, arch: true, ft: 0.1, dep: 0.12 });
      g.add(onWall(wu, sx * (w / 2), foundH + wallH * 0.5, z, 'x', sx));
    }
  }
  shade(g); return g;
}

function buildGoogieDiner(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.2;
  const wall = M.paint(p.wallColor, 0.7); wall.metalness = 0.4;
  const foundH = 0.3;
  g.add(box(w + 0.1, foundH, d + 0.1, M.concrete(0x888888), 0, foundH / 2, 0));
  g.add(box(w, wallH, d, wall, 0, foundH + wallH / 2, 0));
  for (const sx of [-1, 1]) g.add(box(0.1, wallH, 0.1, M.metal(0xb9c0c8, 0.3, 0.8), sx * (w / 2 - 0.05), foundH + wallH / 2, d / 2 - 0.05));
  g.add(box(w + 0.06, 0.1, 0.08, M.metal(0xb9c0c8, 0.3, 0.8), 0, foundH + 0.05, d / 2 + 0.04));
  // 悬挑飞碟屋面 + 上翘封边
  const roofMat = M.metal(p.roofColor, 0.3, 0.7);
  const ovh = 1.8;
  g.add(box(w + ovh * 2, 0.26, d + ovh * 2, roofMat, 0, foundH + wallH + 0.13, 0));
  g.add(box(w + ovh * 2 + 0.16, 0.1, 0.12, roofMat, 0, foundH + wallH + 0.31, d / 2 + ovh));
  g.add(box(w + ovh * 2 + 0.16, 0.1, 0.12, roofMat, 0, foundH + wallH + 0.31, -d / 2 - ovh));
  g.add(box(0.12, 0.1, d + ovh * 2 + 0.16, roofMat, w / 2 + ovh, foundH + wallH + 0.31, 0));
  g.add(box(0.12, 0.1, d + ovh * 2 + 0.16, roofMat, -w / 2 - ovh, foundH + wallH + 0.31, 0));
  const neonMat = new THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.3, emissive: new THREE.Color(0xff3366), emissiveIntensity: 1.5 });
  g.add(box(w * 0.62, 0.13, 0.13, neonMat, 0, foundH + wallH + 0.45, d / 2 + 0.34));
  for (const s of [-1, 1]) {
    g.add(box(0.13, 0.13, d * 0.42, neonMat, s * w * 0.31, foundH + wallH + 0.45, 0));
    g.add(cylRaw(0.05, 0.05, 0.5, M.metal(0x888888, 0.4, 0.7), 8, s * w * 0.31, foundH + wallH + 0.24, 0));
  }
  // 2 段倒角招牌 + 双立柱
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, emissive: new THREE.Color(0xffcc00), emissiveIntensity: 1.2 });
  const signZ = d / 2 + ovh - 0.3;
  g.add(bevelSign(2.4, 0.95, 0.14, signMat, 0, foundH + wallH + 1.35, signZ));
  g.add(bevelSign(2.6, 1.1, 0.07, M.paint(0xd8dee4, 0.5), 0, foundH + wallH + 1.35, signZ - 0.1));
  for (const s of [-0.95, 0.95]) g.add(cylRaw(0.075, 0.09, 1.05, M.metal(0x888888, 0.4, 0.7), 8, s, foundH + wallH + 0.75, signZ - 0.2));
  for (let i = 0; i < 6; i++) {                                                     // 星芒灯泡
    const a = (i / 6) * Math.PI * 2;
    g.add(sph(0.07, neonMat, 6, Math.cos(a) * 1.05, foundH + wallH + 1.35 + Math.sin(a) * 0.4, signZ + 0.09));
  }
  // 连续橱窗带（暗腔 + 内退玻璃 + 竖框）+ 内缩玻璃门
  const winMat = M.glass(0x99ccdd);
  const bandL = storefrontBand(w * 0.34, 2.1, { glassMat: winMat, frameMat: M.metal(0xc6ccd2, 0.28, 0.75), dep: 0.14, bulk: 0.62, mullionGap: 1.3 });
  bandL.position.set(-w * 0.3, foundH + 1.15, d / 2); g.add(bandL);
  const bandR = storefrontBand(w * 0.34, 2.1, { glassMat: winMat, frameMat: M.metal(0xc6ccd2, 0.28, 0.75), dep: 0.14, bulk: 0.62, mullionGap: 1.3 });
  bandR.position.set(w * 0.3, foundH + 1.15, d / 2); g.add(bandR);
  const doorDep = 0.16, dCy = foundH + 1.15;
  const redMat = M.paint(0xcc3333, 0.6);
  g.add(box(1.4, 2.4, 0.03, M.dark(0x10141a, 0.95), 0, foundH + 1.2, d / 2 + 0.015));   // 洞口暗腔
  g.add(box(1.1, 2.1, 0.03, winMat, 0, dCy, d / 2 + 0.05));                              // 玻璃（只留一片）
  for (const sy of [1, -1]) g.add(box(1.34, 0.14, 0.05, redMat, 0, dCy + sy * 1.12, d / 2 + 0.075));
  for (const sx of [1, -1]) g.add(box(0.14, 2.38, 0.05, redMat, sx * 0.6, dCy, d / 2 + 0.075));
  g.add(box(1.5, 0.12, doorDep + 0.1, M.metal(0xc6ccd2, 0.28, 0.75), 0, foundH + 2.4, d / 2 + doorDep / 2));
  g.add(box(0.09, 0.34, 0.09, M.metal(0xd4af37, 0.3, 0.8), 0.44, foundH + 1.1, d / 2 + 0.14));
  for (const s of [-1, 1]) {                                                        // 侧立面带形窗
    g.add(box(0.16, 1.1, d * 0.6, M.dark(0x10141a, 0.95), s * (w / 2 - 0.02), foundH + wallH * 0.55, 0));
    g.add(box(0.05, 0.95, d * 0.58, winMat, s * (w / 2 + 0.09), foundH + wallH * 0.55, 0));
    g.add(box(0.2, 0.09, d * 0.62, M.metal(0xc6ccd2, 0.28, 0.75), s * (w / 2 + 0.03), foundH + wallH * 0.55 + 0.6, 0));
    g.add(box(0.2, 0.09, d * 0.62, M.metal(0xc6ccd2, 0.28, 0.75), s * (w / 2 + 0.03), foundH + wallH * 0.55 - 0.6, 0));
  }
  // 圆舷窗（后立面）+ 屋面镀铬肋条 + 天线星芒
  const chrome = M.metal(0xc6ccd2, 0.28, 0.75);
  const porthole = (x, y, z, rot) => {
    const P = new THREE.Group();
    const cav = cylRaw(0.34, 0.34, 0.05, M.dark(0x10141a, 0.95), 12); cav.rotation.x = Math.PI / 2; cav.position.z = -0.02; P.add(cav);
    const gl = cylRaw(0.31, 0.31, 0.03, winMat, 12); gl.rotation.x = Math.PI / 2; gl.position.z = 0.03; P.add(gl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.045, 6, 12), chrome); rim.position.z = 0.05; P.add(rim);
    for (let i = 0; i < 2; i++) { const bar = box(0.62, 0.045, 0.05, chrome, 0, 0, 0.07); bar.rotation.z = i * Math.PI / 2; P.add(bar); }
    P.position.set(x, y, z); P.rotation.y = rot; return P;
  };
  for (let i = 0; i < 5; i++) g.add(porthole(-w * 0.36 + i * w * 0.18, foundH + wallH * 0.56, -d / 2, Math.PI));
  for (let i = 0; i < 6; i++) g.add(box(0.1, 0.07, d + ovh * 2 - 0.2, chrome, -w / 2 - ovh + 0.4 + i * ((w + ovh * 2 - 0.8) / 5), foundH + wallH + 0.3, 0));
  const mast = cylRaw(0.03, 0.05, 1.3, chrome, 8, 0, foundH + wallH + 0.9, -d * 0.25);
  g.add(mast);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(sph(0.055, neonMat, 6, Math.cos(a) * 0.2, foundH + wallH + 1.52 + Math.sin(a) * 0.2, -d * 0.25));
  }
  g.add(box(1.0, 0.5, 0.7, chrome, -w * 0.28, foundH + wallH + 0.5, -d * 0.1));      // 后厨排风罩
  g.add(box(0.9, 1.9, 0.06, M.dark(0x10141a, 0.95), w * 0.34, foundH + 1.05, -d / 2 - 0.01));
  g.add(box(0.78, 1.78, 0.04, wall, w * 0.34, foundH + 1.05, -d / 2 - 0.05));        // 后门
  g.add(box(0.06, 0.3, 0.06, chrome, w * 0.34 + 0.3, foundH + 1.05, -d / 2 - 0.08));
  g.add(box(w * 0.8, 0.08, d * 0.7, M.concrete(0x9a9488), 0, 0.02, d / 2 + ovh * 0.5));   // 前场铺装
  for (let i = 0; i < 4; i++) g.add(cylRaw(0.06, 0.07, 0.75, M.metal(0xd4af37, 0.35, 0.7), 8, -w * 0.3 + i * w * 0.2, 0.375, d / 2 + ovh + 0.2));
  g.add(box(w * 0.66, 0.05, 0.05, M.metal(0xd4af37, 0.35, 0.7), 0, 0.72, d / 2 + ovh + 0.2));
  g.userData.glow = [neonMat, signMat];
  shade(g); return g;
}

function buildCraftsmanCafe(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.5;
  const wood = M.paint(p.woodColor, 0.82);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const stoneMat = M.concrete(0x9a9488);
  const foundH = 0.4;
  g.add(box(w + 0.1, foundH, d + 0.1, stoneMat, 0, foundH / 2, 0));
  g.add(box(w, wallH, d, wood, 0, foundH + wallH / 2, 0));
  for (const sx of [-1, 1]) g.add(box(0.12, wallH, 0.12, trimMat, sx * (w / 2 - 0.06), foundH + wallH / 2, d / 2 - 0.06));
  for (const t of [0.05, wallH * 0.5, wallH - 0.05]) g.add(box(w + 0.08, 0.1, 0.07, trimMat, 0, foundH + t, d / 2 + 0.035));
  // 低坡屋顶 + 瓦垄 + 出檐/封檐板/椽尾 + 山墙
  const roofMat = M.paint(p.roofColor, 0.78);
  const ohX = 0.52;                                                               // 山面出檐
  const run = w / 2 + ohX, rise = w * 0.25, slope = Math.hypot(run, rise);
  const th = Math.atan2(rise, run), eaveY = foundH + wallH;
  // 同 house:craftsman / house:cape_cod：屋面直线必须过「墙外皮 + 墙顶」，否则墙外皮处
  // 屋面底比墙顶高出 (ohX/run)·rise（本例 0.236m），整条檐口下通长一道缝。
  const drop = (run - w / 2) / run * rise;
  for (const s of [1, -1]) {
    const sl = box(slope, 0.2, d + 1.2, roofMat, s * run / 2, eaveY + rise / 2 - drop, 0);
    sl.rotation.z = -s * th; g.add(sl);
    g.add(shingleCourses(sl, Math.max(7, Math.round(slope / 0.42)), roofMat));
    g.add(box(0.07, 0.24, d + 1.22, trimMat, s * (run + 0.02), eaveY + 0.03 - drop, 0));   // 封檐板
    const raftN = Math.max(6, Math.floor((d + 1.0) / 0.36));
    for (let i = 0; i < raftN; i++)
      g.add(box(0.3, 0.12, 0.08, roofMat, s * (run - 0.15), eaveY - drop - 0.01, -(d + 1.0) / 2 + (i + 0.5) * ((d + 1.0) / raftN)));
  }
  g.add(box(0.16, 0.16, d + 1.3, roofMat, 0, eaveY + rise - drop - 0.08, 0));
  for (const sz of [-1, 1]) {
    const shp = new THREE.Shape();
    shp.moveTo(-w / 2, 0); shp.lineTo(w / 2, 0); shp.lineTo(0, rise - drop); shp.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.12, bevelEnabled: false }), wood);
    tri.position.set(0, foundH + wallH, sz * (d / 2));
    if (sz < 0) tri.rotation.y = Math.PI;
    g.add(tri);
  }
  // 主招牌：钉在正面山墙三角上（旧版整块浮在屋脊上方 0.62m，像「起飞」）
  const signMat = M.paint(p.signColor, 0.6);
  const signY = eaveY + (rise - drop) * 0.30, signH = Math.max(0.5, (rise - drop) * 0.34), signW = w * 0.46;
  g.add(bevelSign(signW, signH, 0.16, signMat, 0, signY, d / 2 + 0.12));
  g.add(bevelSign(signW * 0.88, signH * 0.72, 0.06, trimMat, 0, signY, d / 2 + 0.21));
  for (const s of [-1, 1]) g.add(box(0.09, 0.09, 0.34, M.metal(0x2a2a2a, 0.5, 0.8), s * signW * 0.33, signY - signH * 0.42, d / 2 + 0.02));
  const hangZ = d / 2 + 0.5;
  g.add(box(0.1, 0.1, 0.9, M.metal(0x2a2a2a, 0.5, 0.8), w * 0.36, foundH + wallH - 0.3, hangZ - 0.35));
  g.add(cylRaw(0.02, 0.02, 0.3, M.metal(0x2a2a2a, 0.5, 0.8), 6, w * 0.36 - 0.14, foundH + wallH - 0.45, hangZ));
  g.add(cylRaw(0.02, 0.02, 0.3, M.metal(0x2a2a2a, 0.5, 0.8), 6, w * 0.36 + 0.14, foundH + wallH - 0.45, hangZ));
  g.add(bevelSign(0.62, 0.5, 0.08, signMat, w * 0.36, foundH + wallH - 0.85, hangZ));
  // 门廊：落地门廊台 + 石墩方柱（柱身不再比柱头短一截）+ 连续橱窗带
  const porchD = 1.8, deckTop = foundH - 0.07, colTop = foundH + wallH * 0.62;
  g.add(box(w + 0.5, deckTop, porchD + 0.2, stoneMat, 0, deckTop / 2, d / 2 + porchD / 2 - 0.05));
  for (const s of [-1, 1]) {
    const cx = s * (w / 2 - 0.32), cz = d / 2 + porchD - 0.2;
    g.add(box(0.36, 0.5, 0.36, stoneMat, cx, deckTop + 0.25, cz));                 // 石墩
    g.add(box(0.32, 0.08, 0.32, trimMat, cx, deckTop + 0.54, cz));                 // 柱础
    const shaftH = colTop - 0.14 - (deckTop + 0.58);
    const shaft = cylRaw(0.1, 0.13, shaftH, trimMat, 4, cx, deckTop + 0.58 + shaftH / 2, cz);
    shaft.rotation.y = Math.PI / 4; g.add(shaft);                                   // 收分方柱
    g.add(box(0.32, 0.14, 0.32, trimMat, cx, colTop - 0.07, cz));                   // 柱头
    // 斜撑：下端落柱身、上端顶廊檐横梁底（旧版下端悬在柱身外 0.3m，旋转方向也是反的）
    const bw = 0.58;
    const br = box(0.08, Math.hypot(bw, bw), 0.08, trimMat, cx - s * bw / 2, colTop - bw / 2 + 0.05, cz);
    br.rotation.z = s * Math.PI / 4; g.add(br);
  }
  g.add(box(w - 0.2, 0.16, 0.18, wood, 0, colTop + 0.08, d / 2 + porchD - 0.2));
  g.add(box(w + 0.2, 0.09, porchD + 0.2, roofMat, 0, colTop + 0.21, d / 2 + porchD / 2 - 0.1));
  g.add(box(w + 0.24, 0.13, 0.09, trimMat, 0, colTop + 0.2, d / 2 + porchD + 0.02));
  // 店面：橱窗带与门都贴在墙外皮（旧版 z = d/2-0.42，整片玻璃被实心墙吞掉），
  // 门居左、橱窗带居右，两者横向不重叠（旧版门落在橱窗带里，门扇与玻璃互穿）
  const winMat = M.glass(0x99bbcc);
  const faceZ = d / 2 + 0.01;
  const doorX = -w * 0.33, doorHalf = 0.95 / 2 + 0.09 + 0.07;                     // 含门套与门楣
  const bandL = doorX + doorHalf + 0.18, bandR = w / 2 - 0.4;
  const band = storefrontBand(bandR - bandL, 1.95, { frameMat: wood, glassMat: winMat, dep: 0.14, bulk: 0.55, mullionGap: 1.15 });
  band.position.set((bandL + bandR) / 2, foundH + 1.02, faceZ); g.add(band);
  g.add(onWall(doorUnit(0.95, 2.05, { frameMat: wood, doorMat: M.paint(0x5a4030, 0.7), panelCols: 1, panelRows: 2, panelColor: 0x4a3525, lintel: true, lintelMat: trimMat, dep: 0.14 }), doorX, foundH + 1.025, faceZ, 'z', 1));
  for (const s of [-1, 1]) g.add(onWall(winUnit(0.8, 1.1, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 3, rows: 1 }), s * (w / 2), foundH + wallH * 0.58, 0, 'x', s));
  const entry = stairRun(w * 0.3, 2, deckTop / 2, 0.3, stoneMat);
  entry.position.set(-w * 0.33, 0, d / 2 + porchD + 0.55); g.add(entry);
  shade(g); return g;
}

function buildAdobeStripMall(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.8;
  const adobe = M.paint(p.wallColor, 0.9);
  const foundH = 0.35;
  const stoneMat = M.concrete(0xb09a80);
  g.add(box(w + 0.2, foundH, d + 0.2, stoneMat, 0, foundH / 2, 0));
  g.add(box(w, wallH, d, adobe, 0, foundH + wallH / 2, 0));
  // 女儿墙招牌带（2 段倒角）+ 檐口压顶
  g.add(box(w + 0.5, 0.4, d + 0.5, M.concrete(0x9a8a78), 0, foundH + wallH + 0.2, 0));
  g.add(box(w + 0.54, 0.08, d + 0.54, adobe, 0, foundH + wallH + 0.44, 0));
  g.add(box(w + 0.36, 0.7, 0.22, adobe, 0, foundH + wallH + 0.85, d / 2 + 0.14));
  g.add(bevelSign(w * 0.5, 0.5, 0.1, M.paint(0xb4552f, 0.6), 0, foundH + wallH + 0.86, d / 2 + 0.28));
  const vigas = M.paint(0x6b4e35, 0.85);
  const nV = Math.max(4, Math.round(d / 0.9));
  for (let i = 0; i <= nV; i++) {                                                   // 木梁出挑
    const z = -d / 2 + (i * d) / nV;
    for (const sx of [-1, 1]) {
      const v = cylRaw(0.07, 0.082, 0.4, vigas, 8, sx * (w / 2 + 0.11), foundH + wallH - 0.2, z);
      v.rotation.z = Math.PI / 2; g.add(v);
    }
  }
  // 每间铺面：分隔壁柱 + 内退橱窗带 + 内缩门 + 遮阳篷（含垂边）
  const nUnits = 4, unitW = w / nUnits;
  const winMat = M.glass(0x99aabb);
  for (let i = 0; i < nUnits; i++) {
    const x = -w / 2 + (i + 0.5) * unitW;
    const divColor = i % 2 === 0 ? 0xc4a882 : 0xb89a78;
    g.add(box(0.2, wallH, 0.2, M.paint(divColor, 0.85), x - unitW / 2, foundH + wallH / 2, d / 2 + 0.06));
    const band = storefrontBand(unitW * 0.74, 2.15, { frameMat: M.paint(divColor, 0.85), glassMat: winMat, dep: 0.18, bulk: 0.58, mullionGap: 1.05 });
    band.position.set(x - unitW * 0.08, foundH + 1.1, d / 2 - 0.02); g.add(band);
    g.add(box(unitW * 0.8, 0.16, 0.26, adobe, x - unitW * 0.08, foundH + 2.26, d / 2 + 0.06));   // 窗上抹灰过梁
    g.add(onWall(doorUnit(unitW * 0.3, 2.1, { frameMat: M.paint(divColor, 0.85), doorMat: M.paint(0x5a4030, 0.7), panelCols: 1, panelRows: 1, panelColor: 0x4a3525, dep: 0.18 }), x + unitW * 0.3, foundH + 1.05, d / 2 - 0.02, 'z', 1));
    const awnMat = M.paint(i % 2 ? 0x2f6f8f : 0xcc4444, 0.72);
    const awnW = unitW * 0.82, awnD = 0.95, ay = foundH + wallH * 0.78;
    const aw = box(awnW, 0.06, awnD * 1.06, awnMat, x, ay, d / 2 + awnD / 2 - 0.06);
    aw.rotation.x = -0.16; g.add(aw);
    g.add(box(awnW, 0.26, 0.05, awnMat, x, ay - 0.14, d / 2 + awnD - 0.1));           // 篷前垂边
    const nSc = Math.max(3, Math.round(awnW / 0.34));
    for (let k = 0; k < nSc; k++)                                                     // 扇形垂饰
      g.add(box(awnW / nSc * 0.9, 0.12, 0.04, awnMat, x - awnW / 2 + ((k + 0.5) * awnW) / nSc, ay - 0.32, d / 2 + awnD - 0.1));
    for (const s of [-1, 1]) g.add(cylRaw(0.028, 0.032, 0.5, M.metal(0x888888, 0.5, 0.7), 8, x + s * awnW * 0.44, ay - 0.42, d / 2 + awnD - 0.16));
    g.add(box(unitW * 0.5, 0.06, 0.06, M.paint(divColor, 0.85), x - unitW * 0.08, foundH + 3.05, d / 2 + 0.2));  // 铺号灯带
  }
  g.add(box(0.2, wallH, 0.2, adobe, w / 2, foundH + wallH / 2, d / 2 + 0.06));
  g.add(box(w + 0.4, 0.1, d * 0.3, stoneMat, 0, 0.03, d / 2 + 1.3));                 // 人行道
  shade(g); return g;
}

function buildSpanishLibrary(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 4.5;
  const stucco = M.paint(p.wallColor, 0.88);
  const trimMat = M.paint(0xf0ece4, 0.7);
  const foundH = 0.45;
  g.add(box(w + 0.2, foundH, d + 0.2, M.concrete(0xb09a80), 0, foundH / 2, 0));
  g.add(box(w, wallH, d, stucco, 0, foundH + wallH / 2, 0));
  g.add(box(w + 0.14, 0.18, d + 0.14, stucco, 0, foundH + wallH + 0.09, 0));
  // 筒瓦屋面 + 山墙 + 脊瓦
  const roofMat = M.tile(p.roofColor, 0.8);
  const rise = w * 0.15, slope = Math.hypot(w / 2, rise);
  const nRows = Math.max(10, Math.min(34, Math.round((d + 0.7) / 0.28)));
  for (const s of [1, -1]) {
    const sl = box(slope, 0.18, d + 0.7, roofMat, s * w / 4, foundH + wallH + rise / 2, 0);
    sl.rotation.z = -s * Math.atan2(rise, w / 2); g.add(sl);
    g.add(barrelTiles(sl, nRows, roofMat));
  }
  g.add(box(0.2, 0.2, d + 0.8, roofMat, 0, foundH + wallH + rise - 0.1, 0));
  for (const sz of [-1, 1]) {
    const shp = new THREE.Shape();
    shp.moveTo(-w / 2, 0); shp.lineTo(w / 2, 0); shp.lineTo(0, rise); shp.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.14, bevelEnabled: false }), stucco);
    tri.position.set(0, foundH + wallH, sz * (d / 2));
    if (sz < 0) tri.rotation.y = Math.PI;
    g.add(tri);
  }
  // 入口柱廊：两根 12 边形圆柱 + 横梁 + 2 段倒角匾额
  // 柱位从 0.3w 外移到 0.42w：旧版两根柱正好压在立面拱窗中央，把窗挡掉六成
  const colH = wallH * 0.8, colZ = d / 2 + 0.55, colX = w * 0.42;
  for (const s of [-1, 1]) {
    const c = porchColumn(colH, 0.22, trimMat, 12);
    c.position.set(s * colX, foundH, colZ); g.add(c);
  }
  g.add(box(colX * 2 + 0.66, 0.26, 0.34, trimMat, 0, foundH + colH + 0.13, colZ));
  g.add(box(colX * 2 + 0.86, 0.1, 0.42, trimMat, 0, foundH + colH + 0.31, colZ));
  g.add(box(colX * 2 + 0.7, 0.12, colZ - d / 2 + 0.2, stucco, 0, foundH + colH + 0.42, d / 2 + (colZ - d / 2) / 2));
  g.add(bevelSign(w * 0.34, 0.42, 0.09, M.paint(0xb4552f, 0.62), 0, foundH + colH - 0.5, d / 2 + 0.12));
  g.add(bevelSign(w * 0.28, 0.28, 0.05, trimMat, 0, foundH + colH - 0.5, d / 2 + 0.18));
  const st = stairRun(w * 0.4, 3, foundH / 3, 0.34, M.concrete(0x9a9488));
  st.position.set(0, 0, colZ + 0.5); g.add(st);
  // 内退拱门入口（暗腔 + 门 + 拱券）
  const archW = 1.6, archH = 2.5, archDep = 0.3;
  g.add(box(archW + 0.1, archH + archW / 2, 0.04, M.dark(0x1a1610, 0.95), 0, foundH + (archH + archW / 2) / 2, d / 2 + 0.02));
  for (const s of [-1, 1]) g.add(box(0.3, archH, archDep, stucco, s * (archW / 2 + 0.15), foundH + archH / 2, d / 2 + archDep / 2));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(archW / 2 + 0.18, archW / 2 + 0.18, archDep, 12, 1, false, 0, Math.PI), stucco);
  ring.rotation.z = Math.PI / 2; ring.rotation.y = Math.PI / 2;
  ring.position.set(0, foundH + archH, d / 2 + archDep / 2); g.add(ring);
  g.add(box(archW + 0.66, 0.14, archDep + 0.06, trimMat, 0, foundH + archH + archW / 2 + 0.07, d / 2 + archDep / 2));
  g.add(onWall(doorUnit(1.15, 2.4, { frameMat: trimMat, doorMat: M.paint(0x5a4030, 0.7), panelCols: 2, panelRows: 3, panelColor: 0x4a3525, dep: 0.2 }), 0, foundH + 1.2, d / 2, 'z', 1));
  for (const s of [-1, 1])                                                          // 门侧壁灯
    g.add(box(0.16, 0.24, 0.12, M.paint(0x2a2a2a, 0.6), s * (archW / 2 + 0.5), foundH + 2.0, d / 2 + 0.2));
  // 拱心窗（前立面 + 侧立面）+ 铁窗栅
  const winMat = M.glass(0x88aabb);
  const ironMat = M.metal(0x2a2a2a, 0.5, 0.8);
  for (const x of [-w * 0.31, w * 0.31]) {
    const wu = winUnit(0.95, 1.35, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 2, arch: true, ft: 0.11, dep: 0.14 });
    for (const ss of [-1, 1]) wu.add(box(0.035, 1.4, 0.035, ironMat, ss * 0.58, -0.05, 0.07));
    for (let k = 0; k < 4; k++) wu.add(box(1.2, 0.03, 0.03, ironMat, 0, -0.6 + k * 0.4, 0.07));
    g.add(onWall(wu, x, foundH + wallH * 0.52, d / 2, 'z', 1));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -d / 2 + (i + 0.5) * (d / 3);
    g.add(onWall(winUnit(0.7, 1.3, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 1, rows: 2, arch: true, ft: 0.1, dep: 0.14 }), sx * (w / 2), foundH + wallH * 0.52, z, 'x', sx));
  }
  g.add(onWall(winUnit(0.8, 1.0, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 2, dep: 0.14 }), -w * 0.3, foundH + wallH * 0.55, -d / 2, 'z', -1));
  shade(g); return g;
}

function buildColumnsBank(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 4.0;
  const stone = M.concrete(p.stoneColor, 0.75);
  const trimMat = M.concrete(0xd8d0c4);
  const foundH = 0.6;
  const baseY = foundH + 0.36;
  g.add(box(w + 0.3, foundH, d + 0.3, M.concrete(0x888888), 0, foundH / 2, 0));
  for (let i = 0; i < 3; i++)                                                      // 基座台阶
    g.add(box(w + 0.3 - i * 0.15, 0.12, d * 0.3 - i * 0.1, stone, 0, foundH + 0.06 + i * 0.12, d / 2 + d * 0.15 - i * 0.05));
  g.add(box(w, wallH, d, stone, 0, baseY + wallH / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])                              // 隅石
    g.add(box(0.22, wallH, 0.22, trimMat, sx * (w / 2 - 0.11), baseY + wallH / 2, sz * (d / 2 - 0.11)));
  g.add(box(w + 0.16, 0.14, d + 0.16, trimMat, 0, baseY + 0.07, 0));
  g.add(box(w + 0.16, 0.14, d + 0.16, trimMat, 0, baseY + wallH - 0.07, 0));
  // 山花 + 齿饰檐口。旧版用 ConeGeometry(…, 4)（四棱锥）当山花，底面 15×15m 且比屋顶高 1.87m，
  // 于是整块「屋顶」像漂在建筑上方、前后各探出 7m —— 改成真正的三角挤出山花 + 两道斜檐口。
  const pedimentH = 1.4, triH = 0.9;
  const pedY = baseY + wallH + 0.32, pedW = w + 0.6, pedD = 0.5, pedZ = d / 2 + 0.1;
  g.add(box(w + 0.8, 0.32, 0.72, stone, 0, baseY + wallH + 0.16, d / 2 + 0.16));
  g.add(dentils(w + 0.7, trimMat, 0, baseY + wallH + 0.02, d / 2 + 0.5, 0.3));
  g.add(box(pedW, pedimentH, pedD, stone, 0, pedY + pedimentH / 2, pedZ));            // 山花（额枋段）
  g.add(box(pedW + 0.28, 0.12, pedD + 0.2, trimMat, 0, pedY + 0.06, pedZ));           // 山花基座线脚
  {
    const shp = new THREE.Shape();
    shp.moveTo(-pedW / 2, 0); shp.lineTo(pedW / 2, 0); shp.lineTo(0, triH); shp.closePath();
    const geo = new THREE.ExtrudeGeometry(shp, { depth: pedD, bevelEnabled: false });
    geo.translate(0, 0, -pedD / 2);
    const tri = new THREE.Mesh(geo, stone);
    tri.position.set(0, pedY + pedimentH, pedZ);
    g.add(tri);
    const rakeLen = Math.hypot(pedW / 2, triH), rakeA = Math.atan2(triH, pedW / 2);
    for (const s of [1, -1]) {                                                        // 两道斜檐口
      const rk = box(rakeLen + 0.2, 0.14, pedD + 0.16, trimMat, s * pedW / 4, pedY + pedimentH + triH / 2, pedZ);
      rk.rotation.z = -s * rakeA; g.add(rk);
    }
  }
  g.add(bevelSign(w * 0.3, 0.44, 0.1, trimMat, 0, pedY + pedimentH * 0.4, pedZ + pedD / 2 + 0.04));   // 山花匾额
  g.add(box(w + 0.3, 0.3, d + 0.3, stone, 0, baseY + wallH + 0.15, 0));
  g.add(box(w + 0.4, 0.1, d + 0.4, trimMat, 0, baseY + wallH + 0.34, 0));
  // 6 根 12 边形凹槽圆柱（柱础 + 收分柱身 + 6 条凹槽 + 柱头线脚）
  const colR = 0.25, colH = wallH * 0.85, nCol = 6, colZ = d / 2 + 0.45;
  for (let i = 0; i < nCol; i++) {
    const x = -w / 2 + 1.0 + i * ((w - 2.0) / (nCol - 1));
    const c = porchColumn(colH, colR, stone, 12);
    c.position.set(x, baseY, colZ); g.add(c);
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2;
      const fl = box(0.035, colH - 0.72, 0.035, trimMat, x + Math.cos(a) * colR * 0.9, baseY + 0.3 + (colH - 0.72) / 2, colZ + Math.sin(a) * colR * 0.9);
      fl.rotation.y = -a; g.add(fl);
    }
  }
  g.add(box(w - 0.2, 0.26, 0.28, trimMat, 0, baseY + colH + 0.13, colZ));           // 柱顶额枋
  g.add(box(w - 0.1, 0.1, 0.18, trimMat, 0, baseY + colH + 0.31, colZ));
  g.add(box(w + 0.3, 0.14, 0.9, stone, 0, baseY + colH + 0.43, d / 2 + 0.2));
  g.add(planeXZ(w + 0.2, 0.9, M.concrete(0x9a9488), 0, baseY + 0.012, d / 2 + 0.25));
  // 内缩铜门 + 石过梁 + 内缩窗
  g.add(surroundFrame(1.43, 2.79, 0.14, 0.18, trimMat, 0, baseY + 1.395, d / 2 + 0.05, { sill: false }));
  g.add(box(1.72, 0.18, 0.24, trimMat, 0, baseY + 3.05, d / 2 + 0.12));
  g.add(onWall(doorUnit(1.25, 2.7, { frameMat: trimMat, doorMat: M.metal(0x8a6a3a, 0.35, 0.75), panelCols: 2, panelRows: 3, panelColor: 0x6d5327, dep: 0.16 }), 0, baseY + 1.35, d / 2, 'z', 1));
  const winMat = M.glass(0x88aacc);
  for (const x of [-w * 0.31, w * 0.31]) {
    g.add(surroundFrame(1.1, 1.99, 0.12, 0.14, trimMat, x, baseY + wallH * 0.5, d / 2 + 0.04, { sill: false }));
    g.add(onWall(winUnit(0.9, 1.75, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 3, ft: 0.1, dep: 0.14 }), x, baseY + wallH * 0.5, d / 2, 'z', 1));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -d / 2 + (i + 0.5) * (d / 3);
    g.add(onWall(winUnit(0.8, 1.6, { frameMat: trimMat, glassMat: winMat, muntins: true, cols: 2, rows: 3, ft: 0.1, dep: 0.14 }), sx * (w / 2), baseY + wallH * 0.5, z, 'x', sx));
  }
  const st = stairRun(w * 0.34, 3, foundH / 3, 0.36, stone);
  st.position.set(0, 0, d / 2 + d * 0.3 + 0.36); g.add(st);
  shade(g); return g;
}

// ===========================================================================
// Ch3 — Functional Buildings (6)
// ===========================================================================
function buildSchool(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, floors = p.floors, floorH = 3.4, h = floors * floorH;
  const brick = M.paint(p.brickColor, 0.88);
  const trim = M.concrete(0xd8d2c6);
  const roofMat = M.paint(p.roofColor, 0.82);
  const winMat = M.glass(0x88aacc);
  g.add(box(w, h, d, brick, 0, h / 2, 0));
  g.add(box(w + 0.14, 0.5, d + 0.14, roofMat, 0, h - 0.25, 0));
  g.add(box(w + 0.3, 0.24, d + 0.3, trim, 0, h + 0.12, 0));
  // 侧翼比主体浅（旧版 0.82d 几乎包住整片侧墙，把侧墙窗全挡死、屋面板还切穿二层窗）
  const wingH = h * 0.72, wingX = w / 2 + w * 0.13, wingD = d * 0.62;
  for (const sx of [-1, 1]) {
    g.add(box(w * 0.26, wingH, wingD, brick, sx * wingX, wingH / 2, 0));
    g.add(box(w * 0.26 + 0.12, 0.4, wingD + 0.12, roofMat, sx * wingX, wingH - 0.2, 0));
    g.add(box(w * 0.26 + 0.26, 0.2, wingD + 0.26, trim, sx * wingX, wingH + 0.1, 0));
    for (let f = 0; f < 2; f++) for (let i = 0; i < 3; i++)
      g.add(box(0.95, 1.15, 0.08, winMat, sx * wingX + (i - 1) * (w * 0.08), wingH * (0.28 + f * 0.42), wingD / 2 + 0.03));
  }
  const bayW = w * 0.24;                                                          // 入口凸出体，正面窗要避开它
  for (let f = 0; f < floors; f++) {
    const wy = floorH * 0.52 + f * floorH;
    for (let i = 0; i < 6; i++) {
      const x = -w * 0.4 + i * (w * 0.16);
      g.add(box(1.15, 1.35, 0.07, winMat, x, wy, -d / 2 - 0.035));                 // 背面：无凸出体，整排都留
      if (Math.abs(x) < bayW / 2 + 0.75) continue;                                 // 正面：让开中央入口
      g.add(box(1.15, 1.35, 0.07, winMat, x, wy, d / 2 + 0.035));
      g.add(box(1.3, 0.12, 0.14, trim, x, wy - 0.74, d / 2 + 0.06));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1])                           // 侧墙窗：贴侧翼前后，避让侧翼与侧翼屋面板
      g.add(box(0.07, 1.35, 1.15, winMat, sx * (w / 2 + 0.035), wy, sz * d * 0.415));
    g.add(box(w + 0.08, 0.14, d + 0.08, trim, 0, f * floorH + 0.07, 0));
  }
  // 中央入口山墙 + 台阶 + 双开门
  const bayH = h + 1.0;
  g.add(box(bayW, bayH, 0.5, brick, 0, bayH / 2, d / 2 + 0.25));
  g.add(box(bayW + 0.3, 0.24, 0.7, trim, 0, bayH + 0.12, d / 2 + 0.25));
  const ped = new THREE.Mesh(new THREE.ConeGeometry(bayW * 0.78, 1.0, 4), roofMat);
  ped.rotation.y = Math.PI / 4; ped.position.set(0, bayH + 0.74, d / 2 + 0.25); g.add(ped);
  g.add(box(1.9, 2.5, 0.1, trim, 0, 1.25, d / 2 + 0.51));
  g.add(box(1.5, 2.2, 0.1, M.paint(0x5a4030, 0.7), 0, 1.1, d / 2 + 0.54));
  g.add(box(0.06, 2.2, 0.06, trim, 0, 1.1, d / 2 + 0.6));
  for (let i = 0; i < 3; i++) g.add(box(2.6 + i * 0.4, 0.16, 0.4, trim, 0, 0.08 + (2 - i) * 0.16, d / 2 + 0.8 + i * 0.4));
  for (const sx of [-1, 1]) {
    const cp = cylRaw(0.14, 0.16, 2.5, trim, 8, sx * 1.0, 1.25, d / 2 + 0.62); g.add(cp);
    g.add(box(0.4, 0.14, 0.4, trim, sx * 1.0, 2.56, d / 2 + 0.62));
    g.add(box(0.4, 0.16, 0.4, trim, sx * 1.0, 0.08, d / 2 + 0.62));
  }
  g.add(cylRaw(0.04, 0.04, 3.4, M.metal(0x888888, 0.4, 0.7), 8, w * 0.36, h + 1.7, d * 0.2));
  g.add(box(1.0, 0.6, 0.05, M.paint(0xcc3333, 0.6), w * 0.36 + 0.52, h + 3.0, d * 0.2));
  for (let i = 0; i < 4; i++) g.add(box(1.1, 0.7, 0.9, M.metal(0x9aa0a6, 0.5, 0.6), -w * 0.32 + i * w * 0.2, h + 0.35, -d * 0.2));
  shade(g); return g;
}

function buildFireStation(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 4.0;
  const cream = M.paint(p.wallColor, 0.85);
  const trimMat = M.paint(p.trimColor, 0.7);
  const winMat = M.glass(0x88aacc);
  g.add(box(w, wallH, d, cream, 0, wallH / 2, 0));
  g.add(box(w + 0.1, 0.5, d + 0.1, trimMat, 0, wallH - 0.25, 0));
  g.add(box(w + 0.28, 0.26, d + 0.28, cream, 0, wallH + 0.13, 0));
  g.add(box(w + 0.16, 0.14, d + 0.16, trimMat, 0, wallH + 0.33, 0));
  const bayW = w * 0.3, bayH = 3.2;
  for (let i = 0; i < 2; i++) {
    const x = -w * 0.24 + i * w * 0.48;
    g.add(box(bayW + 0.3, bayH + 0.3, 0.14, trimMat, x, bayH / 2 + 0.15, d / 2 + 0.05));
    g.add(box(bayW, bayH, 0.12, M.metal(0xcc3333, 0.4, 0.5), x, bayH / 2, d / 2 + 0.1));
    for (let j = 0; j < 5; j++) g.add(box(bayW * 0.94, 0.07, 0.05, M.metal(0xb9c0c8, 0.5, 0.7), x, 0.45 + j * 0.62, d / 2 + 0.16));
    g.add(box(0.5, 0.4, 0.1, M.dark(0x22262b, 0.9), x, bayH + 0.55, d / 2 + 0.08));
  }
  for (const sx of [-1, 1]) {                                                      // 立面小窗：玻璃薄轴必须与墙面法线一致
    g.add(box(0.9, 0.9, 0.14, trimMat, sx * (w * 0.45), 2.6, d / 2 + 0.02));
    g.add(box(0.7, 0.7, 0.08, winMat, sx * (w * 0.45), 2.6, d / 2 + 0.12));
  }
  // 瞭望塔（ Hose tower）+ 挑檐 + 爬梯
  const towerW = 1.9, towerH = 4.2, tx = w * 0.32;
  g.add(box(towerW, towerH, towerW, cream, tx, wallH + towerH / 2, -d * 0.15));
  for (let i = 0; i < 3; i++) g.add(box(towerW + 0.1, 0.14, towerW + 0.1, trimMat, tx, wallH + 1.1 + i * 1.3, -d * 0.15));
  g.add(box(towerW + 0.36, 0.24, towerW + 0.36, trimMat, tx, wallH + towerH + 0.12, -d * 0.15));
  g.add(box(towerW * 0.62, 0.9, 0.1, winMat, tx, wallH + towerH - 0.7, -d * 0.15 + towerW / 2 + 0.05));
  g.add(box(towerW * 0.62, 0.9, 0.1, winMat, tx, wallH + towerH - 0.7, -d * 0.15 - towerW / 2 - 0.05));
  for (let i = 0; i < 12; i++) g.add(box(0.5, 0.05, 0.05, M.metal(0x888888, 0.5, 0.7), tx + towerW / 2 + 0.06, 0.5 + i * 0.62, -d * 0.15));
  g.add(box(0.05, towerH, 0.05, M.metal(0x888888, 0.5, 0.7), tx + towerW / 2 + 0.3, wallH + towerH / 2 - 1.2, -d * 0.15 - 0.2));
  g.add(box(0.05, towerH, 0.05, M.metal(0x888888, 0.5, 0.7), tx + towerW / 2 + 0.3, wallH + towerH / 2 - 1.2, -d * 0.15 + 0.2));
  // 人行门 + 侧窗 + 招牌
  g.add(box(1.1, 2.1, 0.12, trimMat, -w * 0.42, 1.05, d / 2 + 0.04));
  g.add(box(0.9, 1.9, 0.1, M.paint(0x5a4030, 0.7), -w * 0.42, 0.95, d / 2 + 0.08));
  g.add(box(0.5, 0.5, 0.05, winMat, -w * 0.42, 1.5, d / 2 + 0.14));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
    g.add(box(0.08, 1.1, 1.0, trimMat, sx * (w / 2 + 0.03), 2.4, -d * 0.25 + i * d * 0.28));
    g.add(box(0.06, 0.9, 0.82, winMat, sx * (w / 2 + 0.06), 2.4, -d * 0.25 + i * d * 0.28));
  }
  g.add(box(w * 0.4, 0.6, 0.14, trimMat, 0, wallH - 0.5, d / 2 + 0.1));
  g.add(box(w * 0.36, 0.4, 0.08, trimMat, 0, wallH - 0.5, d / 2 + 0.2));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.3, emissive: new THREE.Color(0xff2222), emissiveIntensity: 1.6 });
  g.add(box(0.28, 0.28, 0.28, lampMat, 0, wallH + 0.6, d / 2 + 0.1));
  g.userData.glow = [lampMat];
  shade(g); return g;
}

function buildGasStation(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.2;
  const wall = M.paint(p.wallColor, 0.8);
  const trim = M.concrete(0xc8c2b6);
  const canopyMat = M.paint(p.canopyColor, 0.55);
  const chrome = M.metal(0xb9c0c8, 0.35, 0.75);
  const winMat = M.glass(0x99ccdd);
  // 站房
  g.add(box(w * 0.4, wallH, d * 0.6, wall, -w * 0.3, wallH / 2, 0));
  g.add(box(w * 0.4 + 0.2, 0.22, d * 0.6 + 0.2, trim, -w * 0.3, wallH + 0.11, 0));
  g.add(box(w * 0.4 + 0.1, 0.5, d * 0.6 + 0.1, canopyMat, -w * 0.3, wallH - 0.25, 0));
  g.add(box(1.5, 2.2, 0.08, trim, -w * 0.3 - w * 0.08, 1.1, d * 0.3 + 0.04));
  g.add(box(1.2, 2.0, 0.06, winMat, -w * 0.3 - w * 0.08, 1.1, d * 0.3 + 0.08));
  g.add(box(1.3, 1.3, 0.08, trim, -w * 0.3 + w * 0.1, 1.5, d * 0.3 + 0.04));
  g.add(box(1.1, 1.1, 0.06, winMat, -w * 0.3 + w * 0.1, 1.5, d * 0.3 + 0.08));
  for (const sx of [-1, 1]) {
    g.add(box(0.08, 1.1, 1.3, trim, -w * 0.3 + sx * w * 0.2, 1.5, 0));
    g.add(box(0.06, 0.9, 1.1, winMat, -w * 0.3 + sx * w * 0.2 + sx * 0.03, 1.5, 0));
  }
  g.add(box(0.5, 0.6, 0.4, trim, -w * 0.3, wallH + 0.5, -d * 0.1));                  // 排风
  g.add(box(0.34, 0.44, 0.24, trim, -w * 0.3, wallH + 0.92, -d * 0.1));
  // 雨棚：主梁 + 封边 + 灯带 + 支柱
  const cW = w * 0.72, cD = d * 0.82, cY = wallH + 0.4;
  g.add(box(cW, 0.34, cD, canopyMat, w * 0.12, cY, 0));
  g.add(box(cW + 0.16, 0.16, 0.14, chrome, w * 0.12, cY - 0.24, cD / 2 + 0.07));
  g.add(box(cW + 0.16, 0.16, 0.14, chrome, w * 0.12, cY - 0.24, -cD / 2 - 0.07));
  g.add(box(0.14, 0.16, cD + 0.16, chrome, w * 0.12 + cW / 2 + 0.07, cY - 0.24, 0));
  g.add(box(0.14, 0.16, cD + 0.16, chrome, w * 0.12 - cW / 2 - 0.07, cY - 0.24, 0));
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, roughness: 0.4, emissive: new THREE.Color(0xffe9b0), emissiveIntensity: 1.4 });
  for (let i = 0; i < 4; i++) g.add(box(0.5, 0.06, 0.5, lightMat, w * 0.12 - cW * 0.3 + i * cW * 0.2, cY - 0.2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = w * 0.12 + sx * (cW / 2 - 0.5), pz = sz * (cD / 2 - 0.5);
    g.add(cylRaw(0.13, 0.15, cY, chrome, 8, px, cY / 2, pz));
    g.add(box(0.42, 0.14, 0.42, trim, px, 0.07, pz));
  }
  // 加油岛 + 加油机
  const pumpMat = M.metal(0xcc3333, 0.3, 0.6);
  for (let i = 0; i < 2; i++) {
    const x = w * 0.12 - 1.3 + i * 2.6;
    g.add(box(1.5, 0.2, 0.9, trim, x, 0.1, 0));
    g.add(box(0.62, 1.5, 0.42, pumpMat, x, 0.95, 0));
    g.add(box(0.5, 0.36, 0.08, M.dark(0x1a1e24, 0.9), x, 1.42, 0.24));
    g.add(box(0.66, 0.1, 0.46, chrome, x, 1.75, 0));
    for (const sz of [-1, 1]) {
      g.add(box(0.06, 0.5, 0.06, M.dark(0x22262b, 0.8), x + sz * 0.24, 1.3, 0.2));
      g.add(cylRaw(0.03, 0.03, 0.34, M.dark(0x22262b, 0.8), 6, x + sz * 0.34, 1.2, 0.2));
    }
    g.add(cylRaw(0.09, 0.1, 0.5, chrome, 8, x + 0.62, 0.45, 0));                     // 防撞柱
  }
  // 立牌（价格牌）
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.4, emissive: new THREE.Color(0xffcc00), emissiveIntensity: 1.2 });
  const sx0 = w * 0.4, sz0 = d * 0.34;
  g.add(box(0.5, 6.0, 0.5, trim, sx0, 3.0, sz0));
  g.add(box(1.0, 0.3, 1.0, trim, sx0, 0.15, sz0));
  g.add(box(2.6, 3.4, 0.24, canopyMat, sx0, 5.4, sz0));
  g.add(box(2.3, 3.0, 0.1, signMat, sx0, 5.4, sz0 + 0.16));
  g.add(box(2.3, 3.0, 0.1, signMat, sx0, 5.4, sz0 - 0.16));
  for (let i = 0; i < 3; i++) g.add(box(1.9, 0.34, 0.06, M.dark(0x14181e, 0.9), sx0, 6.2 - i * 0.62, sz0 + 0.23));
  g.add(box(w * 0.5, 0.06, d * 0.5, M.concrete(0x9a9488), w * 0.12, 0.02, d * 0.42));
  g.userData.glow = [signMat, lightMat];
  shade(g); return g;
}

function buildWaterTower(p) {
  const g = new THREE.Group();
  const tankR = p.tankRadius, tankH = p.tankHeight, legH = p.legHeight;
  const tankMat = M.metal(p.tankColor, 0.4, 0.6);
  const legMat = M.metal(0x667788, 0.5, 0.7);
  g.add(cylRaw(tankR, tankR, tankH, tankMat, 8, 0, legH + tankH / 2, 0));
  for (let i = 0; i < 3; i++) g.add(cylRaw(tankR + 0.05, tankR + 0.05, 0.1, legMat, 8, 0, legH + 0.5 + i * (tankH - 1) / 2, 0));
  g.add(cylRaw(tankR * 1.02, tankR * 0.86, 0.5, tankMat, 8, 0, legH - 0.2, 0));       // 下锥斗
  g.add(cylRaw(tankR + 0.14, tankR + 0.14, 0.2, legMat, 8, 0, legH + 0.1, 0));
  g.add(cylRaw(tankR * 0.78, tankR * 0.58, 0.7, tankMat, 8, 0, legH + tankH + 0.35, 0));
  g.add(cylRaw(tankR * 0.5, tankR * 0.5, 0.12, legMat, 8, 0, legH + tankH + 0.76, 0));
  const nLegs = 4;
  for (let i = 0; i < nLegs; i++) {
    const a = (i / nLegs) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * tankR * 0.72, z = Math.sin(a) * tankR * 0.72;
    g.add(cylRaw(0.12, 0.16, legH, legMat, 6, x, legH / 2, z));
    g.add(box(0.44, 0.14, 0.44, legMat, x, 0.07, z));
  }
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = legH * (0.28 + lvl * 0.3);
    for (let i = 0; i < nLegs; i++) {
      const a1 = (i / nLegs) * Math.PI * 2 + Math.PI / 4;
      const a2 = ((i + 1) / nLegs) * Math.PI * 2 + Math.PI / 4;
      const x1 = Math.cos(a1) * tankR * 0.72, z1 = Math.sin(a1) * tankR * 0.72;
      const x2 = Math.cos(a2) * tankR * 0.72, z2 = Math.sin(a2) * tankR * 0.72;
      const brace = box(0.07, 0.07, Math.hypot(x2 - x1, z2 - z1), legMat, (x1 + x2) / 2, y, (z1 + z2) / 2);
      brace.rotation.y = Math.atan2(x2 - x1, z2 - z1); g.add(brace);
      const dg = box(0.05, 0.05, Math.hypot(x2 - x1, z2 - z1) * 1.12, legMat, (x1 + x2) / 2, y, (z1 + z2) / 2);
      dg.rotation.y = Math.atan2(x2 - x1, z2 - z1); dg.rotation.x = 0.5; g.add(dg);
    }
  }
  g.add(cylRaw(tankR + 0.2, tankR + 0.2, 0.08, legMat, 8, 0, legH + 0.5, 0));          // 检修平台
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(box(0.05, 0.9, 0.05, legMat, Math.cos(a) * (tankR + 0.18), legH + 0.95, Math.sin(a) * (tankR + 0.18)));
  }
  g.add(cylRaw(tankR + 0.2, tankR + 0.2, 0.06, legMat, 8, 0, legH + 1.4, 0));
  g.add(cylRaw(0.1, 0.1, 0.28, legMat, 6, 0, legH + tankH + 1.0, 0));                  // 避雷针
  shade(g); return g;
}

function buildPostOffice(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, wallH = 3.8;
  const brick = M.paint(p.brickColor, 0.88);
  const stone = M.concrete(0xe4dfd4);
  const roofMat = M.paint(0x4a4038, 0.82);
  const winMat = M.glass(0x88aacc);
  g.add(box(w, wallH, d, brick, 0, wallH / 2, 0));
  g.add(box(w + 0.1, 0.7, d + 0.1, stone, 0, 0.35, 0));
  g.add(box(w + 0.34, 0.3, d + 0.34, stone, 0, wallH + 0.15, 0));
  g.add(box(w + 0.2, 0.16, d + 0.2, roofMat, 0, wallH + 0.38, 0));
  g.add(box(w - 0.4, 0.5, d - 0.4, roofMat, 0, wallH + 0.6, 0));                       // 平屋顶女儿墙
  // 中央柱廊
  const colH = wallH * 0.78;
  g.add(box(w * 0.56, 0.3, 1.1, stone, 0, 0.85, d / 2 + 0.55));
  g.add(box(w * 0.6, 0.26, 1.2, stone, 0, colH + 0.98, d / 2 + 0.55));
  for (let i = 0; i < 4; i++) {
    const x = -w * 0.21 + i * (w * 0.14);
    g.add(cylRaw(0.16, 0.19, colH, stone, 8, x, 1.0 + colH / 2, d / 2 + 0.85));
    g.add(box(0.44, 0.16, 0.44, stone, x, 1.0, d / 2 + 0.85));
    g.add(box(0.42, 0.14, 0.42, stone, x, colH + 0.92, d / 2 + 0.85));
  }
  const nSt = 3, stH = 1.0 / nSt, stD = 0.4;                                       // 实心台阶：一直砌到地面
  for (let i = 0; i < nSt; i++) {
    const hh = 1.0 - i * stH, zz = d / 2 + 0.85 + i * stD;
    g.add(slabTop(w * 0.5, stH, stD, stone, 0, hh - stH / 2, zz));
    if (hh - stH > 0.03) g.add(box(w * 0.5 - 0.08, hh - stH, stD, stone, 0, (hh - stH) / 2, zz));
  }
  // 门窗
  g.add(box(1.5, 2.5, 0.12, stone, 0, 1.35, d / 2 + 0.05));
  g.add(box(1.2, 2.2, 0.1, M.paint(0x5a4030, 0.7), 0, 1.2, d / 2 + 0.09));
  g.add(box(0.06, 2.2, 0.06, stone, 0, 1.2, d / 2 + 0.15));
  g.add(box(1.3, 0.5, 0.06, winMat, 0, 2.55, d / 2 + 0.12));
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const x = sx * (w * 0.28 + i * w * 0.14);
    g.add(box(1.05, 1.75, 0.1, stone, x, wallH * 0.52, d / 2 + 0.04));
    g.add(box(0.88, 1.55, 0.07, winMat, x, wallH * 0.52, d / 2 + 0.08));
    g.add(box(0.05, 1.55, 0.06, stone, x, wallH * 0.52, d / 2 + 0.12));
    g.add(box(1.2, 0.14, 0.2, stone, x, wallH * 0.52 - 0.95, d / 2 + 0.09));
    g.add(box(1.1, 0.16, 0.14, stone, x, wallH * 0.52 + 0.98, d / 2 + 0.06));
    g.add(box(1.05, 1.75, 0.1, stone, x, wallH * 0.52, -d / 2 - 0.04));
    g.add(box(0.88, 1.55, 0.07, winMat, x, wallH * 0.52, -d / 2 - 0.08));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
    const z = -d * 0.2 + i * d * 0.4;
    g.add(box(0.1, 1.75, 1.05, stone, sx * (w / 2 + 0.04), wallH * 0.52, z));
    g.add(box(0.07, 1.55, 0.88, winMat, sx * (w / 2 + 0.08), wallH * 0.52, z));
  }
  // 旗杆 + 邮箱 + 标识牌
  g.add(box(0.56, 0.2, 0.56, stone, w * 0.42, 0.1, d / 2 + 1.4));                   // 旗杆基座
  g.add(cylRaw(0.05, 0.06, 4.0, M.metal(0x888888, 0.4, 0.7), 8, w * 0.42, 2.0, d / 2 + 1.4));
  g.add(box(1.1, 0.66, 0.05, M.paint(0x2a4a8a, 0.6), w * 0.42 + 0.58, 3.6, d / 2 + 1.4));
  for (let i = 0; i < 2; i++) {                                                    // 邮箱：立柱落地
    g.add(box(0.5, 1.1, 0.4, M.metal(0x2a4a8a, 0.4, 0.5), -w * 0.34 + i * 0.7, 0.55, d / 2 + 1.6));
    g.add(box(0.2, 0.9, 0.2, M.metal(0x4a4f56, 0.5, 0.6), -w * 0.34 + i * 0.7, 0.45, d / 2 + 1.6));
  }
  g.add(box(w * 0.34, 0.56, 0.14, stone, 0, wallH - 0.5, d / 2 + 0.12));
  shade(g); return g;
}

function buildDriveIn(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, screenH = p.screenHeight;
  const steel = M.metal(0x8a9098, 0.5, 0.6);
  const conc = M.concrete(0x9a9488);
  const boothMat = M.paint(p.boothColor, 0.75);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.3 });
  const sW = w * 0.7;
  g.add(box(sW, screenH, 0.24, screenMat, 0, screenH / 2 + 0.5, -d / 2 + 0.6));
  g.add(box(sW + 0.3, 0.3, 0.4, steel, 0, screenH + 0.65, -d / 2 + 0.6));
  g.add(box(0.24, screenH + 0.4, 0.4, steel, -sW / 2 - 0.12, screenH / 2 + 0.5, -d / 2 + 0.6));
  g.add(box(0.24, screenH + 0.4, 0.4, steel, sW / 2 + 0.12, screenH / 2 + 0.5, -d / 2 + 0.6));
  for (let i = 0; i < 5; i++) g.add(box(0.16, screenH, 0.16, steel, -sW * 0.36 + i * sW * 0.18, screenH / 2 + 0.5, -d / 2 + 0.34));
  for (let i = 0; i < 3; i++) {
    const a1 = -sW * 0.4 + i * sW * 0.26, a2 = a1 + sW * 0.36;
    const br = box(0.12, 0.12, Math.hypot(a2 - a1, screenH * 0.8), steel, (a1 + a2) / 2, screenH * 0.45 + 0.5, -d / 2 + 0.34);
    br.rotation.y = Math.PI / 2; br.rotation.x = Math.atan2(screenH * 0.8, a2 - a1); g.add(br);
  }
  g.add(box(sW + 0.8, 0.5, 0.7, conc, 0, 0.25, -d / 2 + 0.6));
  g.add(box(sW + 1.6, 0.16, 1.6, conc, 0, 0.08, -d / 2 + 1.2));
  // 售票亭
  const boothW = 3.4, boothH = 2.7, boothD = 2.8, bx = -w * 0.31, bz = d / 2 - 1.6;
  g.add(box(boothW, boothH, boothD, boothMat, bx, boothH / 2, bz));
  g.add(box(boothW + 0.7, 0.24, boothD + 0.7, conc, bx, boothH + 0.12, bz));
  g.add(box(boothW + 0.9, 0.14, boothD + 0.9, M.paint(0xf0ece4, 0.6), bx, boothH + 0.3, bz));
  for (const sz of [-1, 1]) {
    g.add(box(1.3, 1.1, 0.1, M.dark(0x1c2228, 0.9), bx, 1.6, bz + sz * (boothD / 2 + 0.04)));
    g.add(box(1.1, 0.9, 0.06, M.glass(0xaaccdd), bx, 1.6, bz + sz * (boothD / 2 + 0.08)));
    g.add(box(1.4, 0.1, 0.3, conc, bx, 1.0, bz + sz * (boothD / 2 + 0.12)));
  }
  g.add(box(0.9, 2.0, 0.1, M.paint(0x5a4030, 0.7), bx + boothW / 2 + 0.04, 1.0, bz));
  const neonMat = new THREE.MeshStandardMaterial({ color: 0xff3366, roughness: 0.3, emissive: new THREE.Color(0xff3366), emissiveIntensity: 1.8 });
  g.add(box(2.4, 0.6, 0.14, neonMat, bx, boothH + 0.85, bz + boothD / 2 + 0.1));
  for (let i = 0; i < 8; i++) g.add(box(0.12, 0.12, 0.12, neonMat, bx - 1.05 + i * 0.3, boothH + 0.85, bz + boothD / 2 + 0.2));
  // 入口闸杆 + 场灯 + 扬声器柱阵列
  g.add(cylRaw(0.09, 0.1, 3.6, steel, 6, w * 0.3, 1.8, d / 2 - 1.0));
  g.add(box(0.5, 0.5, 0.5, boothMat, w * 0.3, 3.7, d / 2 - 1.0));
  const arm = box(4.0, 0.12, 0.12, M.paint(0xf0ece4, 0.6), w * 0.3 - 2.1, 1.5, d / 2 - 1.0);
  arm.rotation.z = 0.16; g.add(arm);
  for (let i = 0; i < 4; i++) {
    const lx = -w * 0.36 + i * w * 0.24;
    g.add(cylRaw(0.08, 0.1, 5.0, steel, 6, lx, 2.5, -d * 0.18));
    g.add(box(0.7, 0.24, 0.4, M.paint(0xf0ece4, 0.6), lx, 5.1, -d * 0.18));
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    g.add(cylRaw(0.05, 0.06, 1.0, steel, 6, -w * 0.28 + c * w * 0.14, 0.5, -d * 0.3 + r * d * 0.16));
    g.add(box(0.3, 0.24, 0.2, M.paint(0x444a52, 0.7), -w * 0.28 + c * w * 0.14, 1.1, -d * 0.3 + r * d * 0.16));
  }
  g.add(box(w * 0.9, 0.06, d * 0.9, conc, 0, 0.01, 0));
  g.userData.glow = [neonMat, screenMat];
  shade(g); return g;
}

// ===========================================================================
// Ch4 — Garage & DIY Components (6)
// ===========================================================================
function buildWorkbench(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height;
  const wood = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x5a4030, 0.85);
  const steel = M.metal(0x6a7078, 0.4, 0.7);
  const black = M.dark(0x1a1e24, 0.9);
  // 台面：8mm 45° 微倒角 + 前挡条 + 后挡水板
  g.add(slabTop(w, 0.09, d, wood, 0, h - 0.045, 0));
  g.add(box(w, 0.13, 0.045, wood, 0, h - 0.155, d / 2 - 0.022));
  g.add(box(w - 0.1, 0.16, 0.035, darkWood, 0, h - 0.17, -d / 2 + 0.018));
  for (const sz of [-1, 1]) g.add(box(w - 0.14, 0.11, 0.04, wood, 0, h - 0.145, sz * (d / 2 - 0.11)));
  for (const sx of [-1, 1]) g.add(box(0.04, 0.11, d - 0.22, wood, sx * (w / 2 - 0.07), h - 0.145, 0));
  for (let i = 0; i < 5; i++)                                                        // 台面狗孔
    g.add(cylRaw(0.019, 0.019, 0.02, black, 6, -w * 0.3 + i * w * 0.15, h + 0.001, d * 0.24));
  // 腿 + 底脚 + 下层搁板
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(box(0.09, h - 0.09, 0.09, wood, sx * (w / 2 - 0.08), (h - 0.09) / 2, sz * (d / 2 - 0.08)));
    g.add(box(0.15, 0.035, 0.15, darkWood, sx * (w / 2 - 0.08), 0.018, sz * (d / 2 - 0.08)));
  }
  for (const sz of [-1, 1]) g.add(box(w - 0.2, 0.09, 0.06, wood, 0, h * 0.3, sz * (d / 2 - 0.1)));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.09, d - 0.2, wood, sx * (w / 2 - 0.1), h * 0.3, 0));
  g.add(slabTop(w - 0.2, 0.045, d - 0.2, darkWood, 0, h * 0.255, 0));
  // 抽屉柜（右）
  const cabW = w * 0.3, cabX = w / 2 - cabW / 2 - 0.08;
  g.add(box(cabW, h * 0.6, d - 0.24, darkWood, cabX, h * 0.5, 0));
  for (let i = 0; i < 3; i++) {
    const y = h * 0.28 + i * h * 0.17;
    g.add(box(cabW - 0.03, h * 0.14, 0.03, wood, cabX, y, d / 2 - 0.12));
    g.add(box(cabW * 0.5, 0.028, 0.028, steel, cabX, y, d / 2 - 0.09));
  }
  // 台钳（左前）
  const vx = -w / 2 + 0.22;
  g.add(slabTop(0.28, 0.05, 0.24, steel, vx, h + 0.025, d / 2 - 0.14));
  g.add(box(0.2, 0.19, 0.05, steel, vx, h + 0.14, d / 2 - 0.24));
  g.add(box(0.2, 0.19, 0.04, steel, vx, h + 0.14, d / 2 - 0.06));
  g.add(box(0.17, 0.15, 0.012, black, vx, h + 0.14, d / 2 - 0.038));
  const screw = cylRaw(0.024, 0.024, 0.24, steel, 8, vx, h + 0.12, d / 2 - 0.15);
  screw.rotation.x = Math.PI / 2; g.add(screw);
  const hnd = cylRaw(0.011, 0.011, 0.26, steel, 6, vx, h + 0.12, d / 2 - 0.04);   // 穿过丝杆前端，旧版悬在钳口外
  hnd.rotation.z = Math.PI / 2; g.add(hnd);
  for (const s of [-1, 1]) g.add(cylRaw(0.022, 0.022, 0.035, steel, 6, vx + s * 0.13, h + 0.12, d / 2 - 0.04));
  // 端钳（左端）
  g.add(box(0.06, 0.16, d - 0.2, steel, -w / 2 + 0.03, h + 0.08, 0));
  g.add(box(0.05, 0.13, d * 0.4, darkWood, -w / 2 - 0.02, h + 0.08, 0));
  // 夹式工作灯
  g.add(box(0.09, 0.06, 0.14, black, -w / 2 + 0.14, h - 0.1, -d / 2 + 0.1));
  // 灯臂逐级铰接：上臂底端 = 下臂顶端，灯头贴上臂顶（旧版三段互不接触）
  const a1 = 0.22, lx = -w / 2 + 0.14, lz = -d / 2 + 0.1;
  const arm1 = box(0.03, 0.36, 0.03, steel, lx, h + 0.09, lz);
  arm1.rotation.z = a1; g.add(arm1);
  const jx = lx + Math.sin(a1) * 0.18, jy = h + 0.09 + Math.cos(a1) * 0.18;
  // 上臂轴线穿过下臂顶（旧版肘部在 z 向错开 8cm，侧视/轴测灯头悬空）
  const arm2 = box(0.03, 0.34, 0.03, steel, jx, jy - 0.07, lz);
  arm2.rotation.x = 0.5; g.add(arm2);
  const shadeM = cylRaw(0.03, 0.075, 0.09, M.metal(0xd8dee4, 0.35, 0.7), 8, jx, jy + 0.09, lz + 0.05);
  shadeM.rotation.x = 0.5; g.add(shadeM);
  // 下层料箱
  for (let i = 0; i < 2; i++) {
    const bx = -w * 0.26 + i * w * 0.24;
    g.add(box(0.34, 0.2, 0.26, M.paint(0x2f6ab0, 0.7), bx, h * 0.255 + 0.12, 0));
    g.add(box(0.28, 0.15, 0.02, M.paint(0x2f6ab0, 0.7), bx, h * 0.255 + 0.13, 0.13));
  }
  shade(g); return g;
}

function buildPegboard(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const boardMat = M.paint(p.boardColor, 0.85);
  const wood = M.paint(0x8b6914, 0.82);
  const steel = M.metal(0x9aa0a6, 0.35, 0.75);
  const red = M.paint(0xcc3333, 0.6);
  g.add(box(w, h, 0.035, boardMat, 0, h / 2, 0));
  for (const sx of [-1, 1]) g.add(box(0.05, h + 0.06, 0.06, wood, sx * (w / 2 - 0.02), h / 2, 0.015));
  g.add(box(w, 0.05, 0.06, wood, 0, h + 0.02, 0.015));
  g.add(box(w, 0.05, 0.06, wood, 0, -0.02, 0.015));
  g.add(box(w - 0.1, h - 0.1, 0.01, M.paint(0xb09a78, 0.9), 0, h / 2, -0.022));
  const hook = (x, y, len) => {
    const hb = cylRaw(0.011, 0.011, len, steel, 6, x, y, 0.05);
    hb.rotation.x = Math.PI / 2; g.add(hb);
    const up = cylRaw(0.011, 0.011, 0.07, steel, 6, x, y - 0.03, 0.05 + len / 2);
    g.add(up);
  };
  const cols = Math.max(3, Math.min(7, Math.floor(w / 0.2)));
  const rows = Math.max(2, Math.min(4, Math.floor(h / 0.26)));
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (i + 0.5) * (w / cols);
    hook(x, h - 0.16, 0.11);
    if (i % 2 === 0) hook(x, h - 0.16 - rows * 0.24, 0.11);
  }
  // 挂置工具：扳手 / 锤 / 螺丝刀 / 手锯 / 钳
  const toolY = h - 0.34;
  g.add(box(0.05, 0.26, 0.02, steel, -w * 0.32, toolY - 0.16, 0.07));
  g.add(box(0.09, 0.07, 0.02, steel, -w * 0.32, toolY - 0.02, 0.07));
  g.add(box(0.09, 0.07, 0.02, steel, -w * 0.32, toolY - 0.3, 0.07));
  g.add(box(0.035, 0.3, 0.035, wood, -w * 0.16, toolY - 0.18, 0.07));
  g.add(box(0.11, 0.06, 0.05, steel, -w * 0.16, toolY - 0.02, 0.07));
  g.add(box(0.03, 0.16, 0.03, red, 0, toolY - 0.1, 0.07));
  g.add(cylRaw(0.008, 0.008, 0.18, steel, 6, 0, toolY - 0.32, 0.07));
  g.add(box(0.03, 0.16, 0.03, M.paint(0x2f6ab0, 0.6), w * 0.1, toolY - 0.1, 0.07));
  g.add(cylRaw(0.008, 0.008, 0.16, steel, 6, w * 0.1, toolY - 0.3, 0.07));
  g.add(box(0.05, 0.34, 0.014, steel, w * 0.24, toolY - 0.2, 0.07));
  g.add(box(0.035, 0.14, 0.03, wood, w * 0.24, toolY - 0.02, 0.07));
  g.add(box(0.04, 0.2, 0.016, red, w * 0.36, toolY - 0.12, 0.07));
  g.add(box(0.06, 0.09, 0.03, steel, w * 0.36, toolY - 0.01, 0.07));
  // 下部搁板 + 支架 + 料盒
  const sy = h * 0.28;
  g.add(slabTop(w - 0.16, 0.035, 0.2, wood, 0, sy, 0.1));
  for (const sx of [-1, 1]) {
    g.add(box(0.03, 0.16, 0.03, steel, sx * (w / 2 - 0.14), sy - 0.09, 0.03));
    const br = box(0.025, 0.19, 0.025, steel, sx * (w / 2 - 0.14), sy - 0.09, 0.1);
    br.rotation.x = 0.6; g.add(br);
  }
  for (let i = 0; i < 3; i++) {
    const bx = -w * 0.26 + i * w * 0.26;
    g.add(box(0.2, 0.14, 0.15, M.paint([0x2f6ab0, 0xcc3333, 0x3a7a4a][i], 0.7), bx, sy + 0.09, 0.1));
    g.add(box(0.16, 0.02, 0.02, M.dark(0x22262b, 0.85), bx, sy + 0.15, 0.18));
  }
  shade(g); return g;
}

function buildStepladder(p) {
  const g = new THREE.Group();
  const h = p.height, w = p.width, n = p.steps;
  const metalMat = M.metal(p.metalColor, 0.4, 0.7);
  const steel = M.metal(0x8a9098, 0.4, 0.75);
  const rubber = M.dark(0x22262b, 0.92);
  const stepH = h / n, lean = w * 0.5;
  const ang = Math.atan2(lean, h);
  // 前侧两根主梁（略微内收）+ 后支撑腿
  for (const s of [-1, 1]) {
    const fr = box(0.05, Math.hypot(h, 0.16), 0.035, metalMat, s * (w / 2 - 0.02), h / 2, 0.08);
    fr.rotation.x = 0.02; g.add(fr);
    const rr = box(0.045, Math.hypot(h * 0.94, lean), 0.032, metalMat, s * (w / 2 - 0.06), h * 0.47, -lean / 2 + 0.08);
    rr.rotation.x = ang; g.add(rr);
    g.add(box(0.06, 0.03, 0.09, rubber, s * (w / 2 - 0.02), 0.015, 0.14));
    g.add(box(0.06, 0.03, 0.09, rubber, s * (w / 2 - 0.06), 0.015, -lean + 0.1));
    g.add(box(0.04, 0.04, lean * 0.9, steel, s * (w / 2 - 0.06), h * 0.5, -lean / 2 + 0.08));
  }
  // 踏板（8mm 45° 微倒角）+ 防滑条
  for (let i = 1; i <= n; i++) {
    const y = i * stepH, tw = w * (1 - (i / n) * 0.22);
    g.add(slabTop(tw, 0.035, 0.2, metalMat, 0, y, 0.06));
    for (let k = 0; k < 3; k++) g.add(box(tw * 0.86, 0.008, 0.022, rubber, 0, y + 0.022, 0.06 - 0.06 + k * 0.06));
    g.add(box(0.035, 0.06, 0.2, steel, -tw / 2 - 0.01, y - 0.02, 0.06));
    g.add(box(0.035, 0.06, 0.2, steel, tw / 2 + 0.01, y - 0.02, 0.06));
  }
  // 顶盖平台 + 铰链 + 撑杆
  g.add(slabTop(w * 0.82, 0.04, 0.24, metalMat, 0, h + 0.02, 0.02));
  g.add(box(w * 0.7, 0.05, 0.05, steel, 0, h - 0.03, -0.08));
  for (const s of [-1, 1]) {
    g.add(cylRaw(0.019, 0.019, 0.06, steel, 6, s * (w / 2 - 0.04), h - 0.03, 0.02));
    const sp = box(0.03, 0.028, lean * 0.86, steel, s * (w / 2 - 0.05), h * 0.52, -lean * 0.4 + 0.06);
    sp.rotation.x = ang * 0.85; g.add(sp);
    g.add(cylRaw(0.017, 0.017, 0.05, steel, 6, s * (w / 2 - 0.05), h * 0.95, -lean * 0.06));
  }
  // 提手 + 油漆桶搁板
  g.add(box(0.04, 0.24, 0.04, steel, 0, h + 0.16, -0.1));
  g.add(box(0.3, 0.035, 0.035, steel, 0, h + 0.28, -0.1));
  g.add(slabTop(w * 0.5, 0.028, 0.18, steel, 0, h * 0.62, -lean * 0.42));
  shade(g); return g;
}

function buildToolChest(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height;
  const metalMat = M.metal(p.metalColor, 0.3, 0.6);
  const steel = M.metal(0xb9c0c8, 0.3, 0.8);
  const black = M.dark(0x1c2026, 0.9);
  const baseH = 0.12;
  g.add(box(w, h - baseH, d, metalMat, 0, baseH + (h - baseH) / 2, 0));
  g.add(box(w - 0.02, baseH, d - 0.02, black, 0, baseH / 2, 0));
  // 顶盖（微倒角）+ 内衬托盘
  g.add(slabTop(w + 0.04, 0.07, d + 0.04, metalMat, 0, h + 0.035, 0));
  g.add(box(w - 0.08, 0.02, d - 0.08, M.paint(0x2a2f36, 0.9), 0, h + 0.075, 0));
  for (const sx of [-1, 1]) g.add(box(0.05, 0.05, d - 0.1, steel, sx * (w / 2 - 0.04), h + 0.09, 0));
  for (const sx of [-1, 1]) g.add(cylRaw(0.014, 0.014, 0.06, steel, 6, sx * (w / 2 + 0.01), h + 0.06, 0));
  // 抽屉：面板 + 凹槽拉手 + 标签
  const nD = 6, area = h - baseH - 0.14, dh = area / nD;
  for (let i = 0; i < nD; i++) {
    const y = baseH + 0.07 + dh * (i + 0.5);
    g.add(box(w - 0.05, dh * 0.86, 0.03, metalMat, 0, y, d / 2 + 0.012));
    g.add(box(w - 0.09, dh * 0.16, 0.02, black, 0, y + dh * 0.34, d / 2 + 0.03));
    g.add(box(w * 0.62, 0.028, 0.035, steel, 0, y + dh * 0.34, d / 2 + 0.045));
    g.add(box(0.1, 0.045, 0.012, M.paint(0xe8e0d4, 0.7), -w * 0.3, y, d / 2 + 0.032));
  }
  // 侧拉手 + 锁 + 脚轮
  for (const sx of [-1, 1]) {
    g.add(box(0.04, 0.16, 0.04, steel, sx * (w / 2 + 0.01), h * 0.72, 0));
    const hd = cylRaw(0.016, 0.016, 0.14, steel, 6, sx * (w / 2 + 0.035), h * 0.72, 0);  // 贴着支座，旧版离缝 4mm
    g.add(hd);
  }
  g.add(box(0.09, 0.07, 0.03, steel, 0, h * 0.52, d / 2 + 0.03));
  g.add(cylRaw(0.014, 0.014, 0.02, black, 6, 0, h * 0.52, d / 2 + 0.05));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wx = sx * (w / 2 - 0.1), wz = sz * (d / 2 - 0.09);
    g.add(box(0.07, 0.05, 0.05, steel, wx, 0.075, wz));
    const wh = cylRaw(0.055, 0.055, 0.03, black, 8, wx, 0.055, wz);
    wh.rotation.y = Math.PI / 2; g.add(wh);
    g.add(cylRaw(0.014, 0.014, 0.045, steel, 6, wx, 0.055, wz));
  }
  // 侧面挂杆 + 顶部工具槽
  const bar = cylRaw(0.014, 0.014, d - 0.2, steel, 6, w / 2 + 0.012, h * 0.4, 0);   // 贴侧板，旧版悬空 2.6cm
  bar.rotation.x = Math.PI / 2; g.add(bar);
  for (let i = 0; i < 4; i++) g.add(box(0.02, 0.05, 0.16, black, -w * 0.3 + i * w * 0.2, h + 0.09, 0));
  shade(g); return g;
}

function buildStorageShelf(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height, ns = p.shelves;
  const metalMat = M.metal(p.metalColor, 0.5, 0.7);
  const dark = M.dark(0x2a2f36, 0.85);
  const wood = M.paint(0x8b6914, 0.82);
  // 4 根立柱（6 边形）+ 脚垫 + 斜撑
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cylRaw(0.028, 0.032, h, metalMat, 6, sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)));
    g.add(box(0.09, 0.02, 0.09, dark, sx * (w / 2 - 0.05), 0.01, sz * (d / 2 - 0.05)));
    g.add(box(0.05, 0.05, 0.05, metalMat, sx * (w / 2 - 0.05), h - 0.04, sz * (d / 2 - 0.05)));
  }
  for (const sx of [-1, 1]) {
    const br = box(0.025, 0.025, Math.hypot(d - 0.14, h * 0.7), metalMat, sx * (w / 2 - 0.05), h * 0.42, 0);
    br.rotation.x = Math.atan2(h * 0.7, d - 0.14); g.add(br);
  }
  for (const sz of [-1, 1]) {
    const br = box(0.025, 0.025, Math.hypot(w - 0.14, h * 0.7), metalMat, 0, h * 0.42, sz * (d / 2 - 0.05));
    br.rotation.y = Math.PI / 2; br.rotation.x = Math.atan2(h * 0.7, w - 0.14); g.add(br);
  }
  // 层板（8mm 45° 微倒角）+ 前沿加强筋 + 卡扣
  for (let i = 0; i <= ns; i++) {
    const y = 0.06 + i * ((h - 0.12) / ns);
    g.add(slabTop(w - 0.08, 0.035, d - 0.08, metalMat, 0, y, 0));
    g.add(box(w - 0.1, 0.045, 0.025, metalMat, 0, y - 0.03, d / 2 - 0.055));
    g.add(box(w - 0.1, 0.045, 0.025, metalMat, 0, y - 0.03, -d / 2 + 0.055));
    for (const sx of [-1, 1]) g.add(box(0.04, 0.05, d - 0.12, metalMat, sx * (w / 2 - 0.06), y - 0.03, 0));
  }
  // 层板上的收纳箱与木板
  const binCols = [0x2f6ab0, 0xcc3333, 0x3a7a4a, 0xd8a13a];
  for (let i = 0; i < ns; i++) {
    const y = 0.08 + i * ((h - 0.12) / ns);
    if (i % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        const bx = -w * 0.28 + k * w * 0.28;
        g.add(box(w * 0.22, 0.18, d - 0.16, M.paint(binCols[(i + k) % 4], 0.72), bx, y + 0.09, 0));
        g.add(box(w * 0.12, 0.05, 0.02, M.paint(binCols[(i + k) % 4], 0.72), bx, y + 0.13, d / 2 - 0.07));
      }
    } else {
      for (let k = 0; k < 3; k++) g.add(box(w - 0.16, 0.028, d - 0.14, wood, 0, y + 0.014 + k * 0.03, 0));
      g.add(box(0.3, 0.22, 0.24, M.paint(0x9a8a6a, 0.85), -w * 0.24, y + 0.2, 0));
      g.add(box(0.3, 0.02, 0.24, dark, -w * 0.24, y + 0.315, 0));
    }
  }
  shade(g); return g;
}

function buildBenchVise(p) {
  const g = new THREE.Group();
  const metalMat = M.metal(p.metalColor, 0.35, 0.75);
  const steel = M.metal(0xb9c0c8, 0.3, 0.8);
  const black = M.dark(0x22262b, 0.9);
  // 底座（微倒角）+ 转盘 + 锁紧手柄
  g.add(slabTop(0.42, 0.05, 0.3, metalMat, 0, 0.025, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(cylRaw(0.016, 0.016, 0.06, black, 6, sx * 0.16, 0.05, sz * 0.1));
  g.add(cylRaw(0.11, 0.13, 0.06, metalMat, 10, 0, 0.08, 0));
  const lock = cylRaw(0.016, 0.016, 0.14, steel, 6, 0.14, 0.08, 0.05);
  lock.rotation.x = Math.PI / 2; g.add(lock);
  g.add(box(0.05, 0.05, 0.05, black, 0.14, 0.08, 0.13));
  // 固定钳身 + 砧面
  g.add(box(0.16, 0.2, 0.18, metalMat, -0.06, 0.21, 0));
  g.add(box(0.3, 0.05, 0.2, metalMat, -0.1, 0.33, 0));
  g.add(box(0.14, 0.014, 0.17, steel, -0.16, 0.362, 0));
  g.add(box(0.11, 0.24, 0.09, metalMat, -0.06, 0.23, 0));
  g.add(box(0.012, 0.2, 0.14, black, -0.005, 0.24, 0));
  // 活动钳口 + 导杆 + 丝杠 + 手柄
  g.add(box(0.1, 0.24, 0.16, metalMat, 0.13, 0.23, 0));
  g.add(box(0.012, 0.2, 0.14, black, 0.078, 0.24, 0));
  for (const sz of [-0.05, 0.05]) {
    const rod = cylRaw(0.022, 0.022, 0.26, steel, 8, 0.05, 0.18, sz);
    rod.rotation.z = Math.PI / 2; g.add(rod);
  }
  const screw = cylRaw(0.03, 0.03, 0.3, steel, 10, 0.12, 0.26, 0);
  screw.rotation.z = Math.PI / 2; g.add(screw);
  for (let i = 0; i < 6; i++) {
    const th = cylRaw(0.037, 0.037, 0.011, metalMat, 8, 0.02 + i * 0.035, 0.26, 0);
    th.rotation.z = Math.PI / 2; g.add(th);
  }
  const hnd = cylRaw(0.013, 0.013, 0.3, steel, 6, 0.29, 0.26, 0);
  hnd.rotation.x = Math.PI / 2; g.add(hnd);
  for (const sz of [-1, 1]) g.add(cylRaw(0.024, 0.024, 0.04, black, 8, 0.29, 0.26, sz * 0.15));
  g.add(box(0.06, 0.06, 0.14, metalMat, 0.29, 0.26, 0));
  shade(g); return g;
}

// ===========================================================================
// Ch5 — American Home Furniture (10)
// ===========================================================================
function buildClapboardWall(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const woodMat = M.paint(p.woodColor, 0.82);
  const trim = M.paint(0xf2ede4, 0.7);
  const sheath = M.paint(0x8a7a62, 0.92);
  g.add(box(w, h, 0.02, sheath, 0, h / 2, -0.03));
  const plankH = 0.13, n = Math.ceil(h / plankH);
  for (let i = 0; i < n; i++)
    g.add(box(w, plankH * 0.86, 0.028, woodMat, 0, i * plankH + plankH / 2, -0.005 + (i % 2) * 0.004));
  // 上下梁 + 转角板 + 竖向压条
  g.add(box(w + 0.06, 0.07, 0.07, trim, 0, h + 0.02, 0));
  g.add(box(w + 0.06, 0.09, 0.07, trim, 0, 0.045, 0));
  for (const sx of [-1, 1]) g.add(box(0.09, h, 0.06, trim, sx * (w / 2 - 0.03), h / 2, 0.015));
  for (const sx of [-1, 1]) g.add(box(0.05, h, 0.04, trim, sx * (w / 2 - 0.09), h / 2, 0.02));
  for (let i = 0; i < 3; i++) g.add(box(0.03, h, 0.035, trim, -w * 0.28 + i * w * 0.28, h / 2, -0.045));
  // 窗洞：窗台 + 窗框 + 玻璃 + 窗楣
  const ww = w * 0.3, wy = h * 0.52, wh = h * 0.3;
  g.add(box(ww + 0.2, wh + 0.16, 0.05, sheath, w * 0.22, wy, 0.01));
  g.add(box(ww + 0.16, 0.06, 0.09, trim, w * 0.22, wy - wh / 2 - 0.03, 0.04));
  g.add(box(ww + 0.2, 0.07, 0.07, trim, w * 0.22, wy + wh / 2 + 0.035, 0.035));
  for (const sx of [-1, 1]) g.add(box(0.06, wh + 0.1, 0.06, trim, w * 0.22 + sx * (ww / 2 + 0.05), wy, 0.035));
  g.add(box(ww, wh, 0.02, M.dark(0x1c2430, 0.95), w * 0.22, wy, 0.02));
  g.add(box(ww - 0.03, wh - 0.04, 0.012, M.glass(0x99bbcc), w * 0.22, wy, 0.045));
  g.add(box(0.035, wh - 0.04, 0.03, trim, w * 0.22, wy, 0.055));
  g.add(box(ww - 0.03, 0.035, 0.03, trim, w * 0.22, wy, 0.055));
  // 壁灯 + 门牌
  g.add(box(0.09, 0.14, 0.08, M.metal(0x2c3138, 0.4, 0.7), -w * 0.3, h * 0.72, 0.06));
  g.add(box(0.07, 0.1, 0.06, M.paint(0xfff0c8, 0.5), -w * 0.3, h * 0.72, 0.1));
  g.add(box(0.22, 0.12, 0.02, M.paint(0x2c3138, 0.6), w * 0.34, h * 0.78, 0.05));
  shade(g); return g;
}

function buildStaircase(p) {
  const g = new THREE.Group();
  const nSteps = p.steps, stepW = p.stepWidth, rise = p.rise, run = p.run;
  const woodMat = M.paint(p.woodColor, 0.82);
  const trim = M.paint(0xf2ede4, 0.72);
  const totalH = nSteps * rise, totalL = nSteps * run;
  // 斜梁（stringer）
  const sLen = Math.hypot(totalL, totalH), sAng = Math.atan2(totalH, totalL);
  for (const s of [-1, 1]) {
    const st = box(0.05, 0.26, sLen + 0.1, woodMat, s * (stepW / 2 - 0.02), totalH / 2 - 0.08, -totalL / 2 + run / 2);
    st.rotation.x = sAng; g.add(st);
  }
  // 踏步（8mm 微倒角）+ 踢面板
  for (let i = 0; i < nSteps; i++) {
    const y = i * rise + rise, z = -i * run;
    g.add(slabTop(stepW, 0.04, run + 0.035, woodMat, 0, y - 0.02, z - 0.015));
    g.add(box(stepW, rise - 0.02, 0.025, trim, 0, y - rise / 2 - 0.01, z + run / 2 - 0.01));
  }
  g.add(box(stepW + 0.06, 0.06, run + 0.1, woodMat, 0, 0.03, run / 2));
  // 一侧完整斜栏杆（随踏步倾斜），另一侧仅靠墙扶手
  const railLen = Math.hypot(totalL, totalH);
  const balG = new THREE.Group();
  balG.position.set(stepW / 2 + 0.03, totalH / 2 + 0.02, -totalL / 2 + run / 2);
  balG.rotation.x = sAng;
  const bal = balustrade(railLen - 0.24, 0.86, trim, { spacing: 0.22, posts: false, belly: false });
  bal.rotation.y = Math.PI / 2;
  balG.add(bal);
  g.add(balG);
  const half = (railLen - 0.24) / 2, cs = Math.cos(sAng), sn = Math.sin(sAng);
  const zc = -totalL / 2 + run / 2, yc = totalH / 2 + 0.02;
  for (const sgn of [-1, 1]) {
    const zz = zc - sgn * half * cs, yy = Math.max(0, yc + sgn * half * sn) - 0.02;
    g.add(box(0.13, 1.02, 0.13, woodMat, stepW / 2 + 0.03, yy + 0.51, zz));
    g.add(box(0.17, 0.05, 0.17, woodMat, stepW / 2 + 0.03, yy + 1.04, zz));
    g.add(box(0.08, 0.08, 0.08, trim, stepW / 2 + 0.03, yy + 1.1, zz));
  }
  // 另一侧：斜向实心栏板 + 扶手（封闭弦杆侧）
  const skirt = box(0.05, 0.8, railLen + 0.1, trim, -stepW / 2 - 0.02, totalH / 2 + 0.4, -totalL / 2 + run / 2);
  skirt.rotation.x = sAng; g.add(skirt);
  const wallRail = box(0.07, 0.08, railLen + 0.14, woodMat, -stepW / 2 - 0.02, totalH / 2 + 0.84, -totalL / 2 + run / 2);
  wallRail.rotation.x = sAng; g.add(wallRail);
  shade(g); return g;
}

function buildFrontDoor(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const trim = M.paint(0xf2ede4, 0.72);
  const doorMat = M.paint(p.doorColor, 0.72);
  const wallMat = M.paint(0xd8d0c2, 0.9);
  // 墙面片段（衬托门洞景深）+ 门槛 + 台阶
  g.add(box(w + 1.1, h + 0.75, 0.14, wallMat, 0, (h + 0.75) / 2, -0.1));
  g.add(box(w + 1.16, 0.07, 0.07, trim, 0, h + 0.76, -0.02));
  g.add(box(w + 0.5, 0.1, 0.42, M.concrete(0xb8b2a6, 0.9), 0, 0.05, 0.16));
  g.add(box(w + 0.66, 0.1, 0.5, M.concrete(0xb8b2a6, 0.9), 0, 0.0, 0.28));
  // 门套（casing）+ 门楣 + 内缩门组件（扇形亮子 + 侧窗）
  // 门楣/檐口要抬到扇形亮子之上（旧版横压在亮子中间，把气窗挡掉四成）
  g.add(box(w + 0.42, h + 0.9, 0.1, trim, 0, (h + 0.9) / 2 + 0.1, -0.01));
  g.add(box(w + 0.62, 0.14, 0.16, trim, 0, h + 0.89, 0.02));
  g.add(box(w + 0.74, 0.09, 0.2, trim, 0, h + 1.005, 0.03));
  const du = doorUnit(w, h, { frameMat: trim, doorMat, panelColor: 0x4a3020, panelCols: 2, panelRows: 3, fanlight: true, dep: 0.12 });
  du.position.set(0, h / 2 + 0.1, 0); g.add(du);
  for (const s of [-1, 1]) {
    const sl = winUnit(0.24, h * 0.78, { frameMat: trim, glassMat: M.glass(0x99bbcc), muntins: false, ft: 0.05, dep: 0.12 });
    sl.position.set(s * (w / 2 + 0.2), h * 0.5 + 0.1, 0); g.add(sl);
    g.add(box(0.3, 0.06, 0.16, trim, s * (w / 2 + 0.2), 0.12, 0.02));
  }
  // 门牌 + 双壁灯 + 地垫
  g.add(box(0.26, 0.13, 0.025, M.metal(0x8a6a3a, 0.35, 0.75), 0, h * 0.62, 0.10));   // 门牌钉在门扇上，不再浮在气窗前
  for (const s of [-1, 1]) {
    g.add(box(0.1, 0.16, 0.09, M.metal(0x2c3138, 0.4, 0.7), s * (w / 2 + 0.44), h * 0.74, 0.03));
    g.add(box(0.08, 0.12, 0.07, M.paint(0xfff0c8, 0.5), s * (w / 2 + 0.44), h * 0.74, 0.08));
  }
  g.add(box(w * 0.7, 0.015, 0.4, M.paint(0x6a5a48, 0.95), 0, 0.108, 0.3));
  shade(g); return g;
}

function buildSashWindow(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const frameMat = M.paint(p.frameColor, 0.72);
  const wallMat = M.paint(0xd8d0c2, 0.9);
  const trim = M.paint(0xf2ede4, 0.7);
  // 墙面片段 + 窗洞衬套
  g.add(box(w + 0.9, h + 0.8, 0.14, wallMat, 0, (h + 0.8) / 2, -0.12));
  g.add(box(w + 0.3, h + 0.3, 0.12, M.dark(0x1a2028, 0.95), 0, h / 2 + 0.02, -0.04));
  // 内缩推拉窗组件（含窗棂、窗台、窗楣、百叶扇、花箱）
  const wu = winUnit(w, h, {
    frameMat, glassMat: M.glass(0x99bbcc), muntins: true, cols: 2, rows: 3,
    ft: 0.085, dep: 0.13, sill: true, lintel: true, lintelMat: trim,
    shutters: true, shutterMat: M.paint(0x3a5a4a, 0.7), flowerBox: true,
    boxMat: M.paint(0x6b4e35, 0.8), flowerColor: 0xcc4466,
  });
  wu.position.set(0, h / 2 + 0.02, 0); g.add(wu);
  // 外框线脚 + 窗楣山花 + 上下雨披
  for (const sx of [-1, 1]) g.add(box(0.09, h + 0.34, 0.07, trim, sx * (w / 2 + 0.11), h / 2 + 0.02, 0.02));
  g.add(box(w + 0.42, 0.1, 0.14, trim, 0, h + 0.2, 0.03));
  g.add(box(w + 0.52, 0.07, 0.19, trim, 0, h + 0.28, 0.04));
  const pedH = 0.2, pedW = w + 0.3;                                  // 山花：三棱柱（原来是四棱锥，看着像块歪着的金字塔）
  const pedShape = new THREE.Shape();
  pedShape.moveTo(-pedW / 2, 0); pedShape.lineTo(pedW / 2, 0); pedShape.lineTo(0, pedH); pedShape.closePath();
  const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(pedShape, { depth: 0.16, bevelEnabled: false }), trim);
  ped.translateZ(-0.08); ped.position.set(0, h + 0.3, 0.02); g.add(ped);
  const rakeL = Math.hypot(pedW / 2, pedH), rakeA = Math.atan2(pedH, pedW / 2);
  for (const s of [-1, 1]) {
    const rk = box(rakeL, 0.06, 0.2, trim, s * pedW / 4, h + 0.3 + pedH / 2, 0.02);
    rk.rotation.z = -s * rakeA; g.add(rk);
  }
  g.add(box(w + 0.5, 0.06, 0.22, trim, 0, -0.03, 0.06));
  for (const sx of [-1, 1]) g.add(box(0.07, 0.12, 0.2, trim, sx * (w / 2 + 0.2), 0.03, 0.05));
  // 中梃 + 纱窗框
  g.add(box(0.05, h, 0.05, frameMat, 0, h / 2 + 0.02, 0.09));
  g.add(box(w + 0.06, 0.04, 0.04, frameMat, 0, h / 2 + 0.02, 0.09));
  shade(g); return g;
}

function buildDiningSet(p) {
  const g = new THREE.Group();
  const tableR = p.tableRadius, tableH = p.tableHeight;
  const woodMat = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x5a4030, 0.85);
  // 圆桌：桌面 + 边裙 + 中柱 + 三爪底座
  g.add(cylRaw(tableR, tableR, 0.045, woodMat, 18, 0, tableH - 0.022, 0));
  g.add(cylRaw(tableR - 0.02, tableR - 0.02, 0.07, darkWood, 18, 0, tableH - 0.08, 0));
  // 支撑链落地：爪足/底座贴 y=0，中柱从底座顶穿到边裙底（旧版整张桌悬空 1.5cm）
  g.add(cylRaw(0.075, 0.11, tableH - 0.14, woodMat, 12, 0, 0.05 + (tableH - 0.14) / 2, 0));
  g.add(cylRaw(0.13, 0.16, 0.09, woodMat, 12, 0, 0.045, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = box(0.1, 0.06, tableR * 0.62, woodMat, Math.cos(a) * tableR * 0.28, 0.03, Math.sin(a) * tableR * 0.28);
    foot.rotation.y = -a + Math.PI / 2; g.add(foot);
  }
  // 4 把椅子：软座（微倒角）+ 4 腿 + 靠背立柱 + 顶冠板 + 前撑
  const seatH = 0.45, chairH = 0.95;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a) * (tableR + 0.44), cz = Math.sin(a) * (tableR + 0.44);
    const C = new THREE.Group();
    C.add(slabTop(0.42, 0.05, 0.4, woodMat, 0, seatH, 0));
    C.add(box(0.36, 0.035, 0.34, M.paint(0xb8452f, 0.88), 0, seatH + 0.04, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      C.add(cylRaw(0.022, 0.028, seatH - 0.04, woodMat, 6, sx * 0.16, (seatH - 0.04) / 2, sz * 0.15));
    for (const sx of [-1, 1])
      C.add(cylRaw(0.024, 0.03, chairH - seatH, woodMat, 6, sx * 0.17, seatH + (chairH - seatH) / 2, -0.16));
    C.add(box(0.42, 0.09, 0.04, woodMat, 0, chairH - 0.05, -0.16));
    C.add(box(0.34, 0.05, 0.035, darkWood, 0, chairH - 0.14, -0.16));
    C.add(box(0.3, 0.035, 0.035, woodMat, 0, 0.16, 0.14));
    C.position.set(cx, 0, cz); C.rotation.y = -a - Math.PI / 2;
    g.add(C);
  }
  shade(g); return g;
}

function buildFourPosterBed(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.length, postH = p.postHeight;
  const woodMat = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x4a3020, 0.85);
  const mattressMat = M.paint(p.mattressColor, 0.92);
  const quilt = M.paint(0x8a3a3a, 0.9);
  // 床架侧板 + 床头/床尾板 + 床垫（微倒角）
  const railH = 0.24, railY = 0.28;
  for (const sx of [-1, 1]) g.add(box(0.06, railH, d - 0.16, woodMat, sx * (w / 2 - 0.06), railY + railH / 2, 0));
  for (let i = 0; i < 5; i++) g.add(box(w - 0.2, 0.03, 0.09, darkWood, 0, railY + railH - 0.02, -d / 2 + 0.24 + i * ((d - 0.48) / 4)));
  g.add(slabTop(w - 0.12, 0.24, d - 0.12, mattressMat, 0, railY + railH + 0.12, 0));
  g.add(slabTop(w - 0.18, 0.09, d * 0.62, quilt, 0, railY + railH + 0.28, d * 0.16));
  g.add(box(w - 0.18, 0.16, 0.05, quilt, 0, railY + railH + 0.24, d * 0.16 - d * 0.31));
  for (const sx of [-1, 1]) g.add(slabTop(w * 0.3, 0.11, 0.42, mattressMat, sx * w * 0.2, railY + railH + 0.3, -d / 2 + 0.34));
  // 床头板：立柱 + 3 块凸起镶板 + 顶冠
  g.add(box(w - 0.14, 0.9, 0.06, woodMat, 0, railY + 0.55, -d / 2 + 0.09));
  for (let i = 0; i < 3; i++) {
    g.add(box((w - 0.3) / 3 - 0.05, 0.66, 0.03, darkWood, -((w - 0.3) / 3) + i * ((w - 0.3) / 3), railY + 0.55, -d / 2 + 0.13));
    g.add(box((w - 0.3) / 3 - 0.11, 0.58, 0.02, woodMat, -((w - 0.3) / 3) + i * ((w - 0.3) / 3), railY + 0.55, -d / 2 + 0.15));
  }
  g.add(bevelSign(w - 0.1, 0.12, 0.1, woodMat, 0, railY + 1.06, -d / 2 + 0.1));
  g.add(box(w - 0.2, 0.5, 0.055, woodMat, 0, railY + 0.32, d / 2 - 0.09));
  g.add(bevelSign(w - 0.16, 0.09, 0.09, woodMat, 0, railY + 0.6, d / 2 - 0.09));
  // 4 根床柱（8 边形）+ 柱础 + 八角顶饰 + 顶部横杆
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (w / 2 - 0.06), pz = sz * (d / 2 - 0.06);
    g.add(box(0.17, 0.06, 0.17, darkWood, px, 0.03, pz));
    g.add(box(0.14, 0.1, 0.14, woodMat, px, 0.11, pz));
    g.add(cylRaw(0.055, 0.065, postH - 0.16, woodMat, 8, px, 0.16 + (postH - 0.16) / 2, pz));
    g.add(cylRaw(0.075, 0.055, 0.09, woodMat, 8, px, postH - 0.11, pz));
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), woodMat).translateX(px).translateY(postH + 0.03).translateZ(pz));
  }
  for (const sz of [-1, 1]) g.add(box(w - 0.12, 0.055, 0.055, woodMat, 0, postH - 0.22, sz * (d / 2 - 0.06)));
  for (const sx of [-1, 1]) g.add(box(0.055, 0.055, d - 0.12, woodMat, sx * (w / 2 - 0.06), postH - 0.22, 0));
  // 床裙 + 2 个抽屉
  g.add(box(w - 0.06, 0.14, d - 0.06, M.paint(0xe0d6c6, 0.95), 0, 0.1, 0));
  for (const sx of [-1, 1]) {
    g.add(box(w * 0.34, 0.16, 0.03, darkWood, sx * w * 0.24, 0.14, d / 2 - 0.02));
    g.add(cylRaw(0.016, 0.016, 0.03, M.metal(0x8a6a3a, 0.35, 0.75), 6, sx * w * 0.24, 0.14, d / 2 + 0.005));
  }
  shade(g); return g;
}

function buildSofa(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, seatH = p.seatHeight;
  const fabricMat = M.paint(p.fabricColor, 0.92);
  const darkFab = M.paint(0x2c3138, 0.9);
  const woodMat = M.paint(0x5a4030, 0.8);
  const baseY = 0.12;
  // 底座 + 裙边 + 木脚
  g.add(box(w, seatH - baseY, d, darkFab, 0, baseY + (seatH - baseY) / 2, 0));
  g.add(box(w + 0.02, 0.1, d + 0.02, fabricMat, 0, baseY - 0.02, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cylRaw(0.028, 0.04, baseY + 0.02, woodMat, 6, sx * (w / 2 - 0.12), (baseY + 0.02) / 2, sz * (d / 2 - 0.12)));
  }
  // 3 块座垫 + 3 块靠垫（均带 8mm 微倒角）+ 缝隙压条
  const cw = (w - 0.34) / 3;
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 0.17 + cw * (i + 0.5);
    g.add(slabTop(cw - 0.02, 0.15, d * 0.72, fabricMat, x, seatH + 0.06, d * 0.06));
    g.add(slabTop(cw - 0.03, 0.42, 0.17, fabricMat, x, seatH + 0.32, -d / 2 + 0.16));
    g.add(box(cw - 0.06, 0.02, d * 0.66, darkFab, x, seatH + 0.14, d * 0.06));
    g.add(box(0.02, 0.13, d * 0.7, darkFab, x - cw / 2 + 0.01, seatH + 0.07, d * 0.06));
    // 绷扣（拉扣沙发）
    for (const bx of [-0.11, 0.11]) for (const by of [-0.1, 0.1])
      g.add(sph(0.017, darkFab, 6, x + bx, seatH + 0.32 + by, -d / 2 + 0.16 - 0.085));
  }
  // 靠背 + 顶梁 + 两侧扶手（含卷垫）
  g.add(box(w - 0.28, 0.62, 0.18, fabricMat, 0, seatH + 0.34, -d / 2 + 0.1));
  g.add(box(w - 0.24, 0.1, 0.22, fabricMat, 0, seatH + 0.68, -d / 2 + 0.1));
  for (const sx of [-1, 1]) {
    g.add(box(0.17, 0.46, d - 0.04, fabricMat, sx * (w / 2 - 0.085), seatH + 0.18, 0));
    const roll = cylRaw(0.095, 0.095, d - 0.08, fabricMat, 8, sx * (w / 2 - 0.085), seatH + 0.42, 0);
    roll.rotation.x = Math.PI / 2; g.add(roll);
    g.add(box(0.19, 0.06, 0.06, darkFab, sx * (w / 2 - 0.085), seatH + 0.02, d / 2 - 0.08));
    g.add(box(0.03, 0.4, d - 0.1, darkFab, sx * (w / 2 - 0.17), seatH + 0.2, 0));
  }
  // 2 个抱枕
  for (const sx of [-1, 1]) {
    const pil = slabTop(0.34, 0.1, 0.34, M.paint(sx < 0 ? 0xd8c8a0 : 0x8a5a3a, 0.92), sx * (w / 2 - 0.34), seatH + 0.28, -d * 0.16);
    pil.rotation.z = sx * 0.28; pil.rotation.y = 0.4; g.add(pil);
  }
  shade(g); return g;
}

function buildRockingChair(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height;
  const woodMat = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x4a3020, 0.85);
  const seatY = 0.42;
  // 弧形摇杆（定段数圆环，避免精度档放大面数）
  const rockerR = d * 0.62;
  for (const s of [-1, 1]) {
    const rk = new THREE.Mesh(new THREE.TorusGeometry(rockerR, 0.028, 4, 18, Math.PI * 0.62), woodMat);
    rk.rotation.y = Math.PI / 2;
    rk.rotation.z = -Math.PI * 0.19;
    rk.position.set(s * (w / 2 - 0.04), rockerR * 0.79, 0);
    g.add(rk);
  }
  // 座面（微倒角）+ 座框 + 编织纹
  g.add(slabTop(w, 0.05, d * 0.62, woodMat, 0, seatY, d * 0.02));
  for (const sx of [-1, 1]) g.add(box(0.045, 0.07, d * 0.62, darkWood, sx * (w / 2 - 0.02), seatY - 0.05, d * 0.02));
  g.add(box(w - 0.04, 0.07, 0.045, darkWood, 0, seatY - 0.05, d * 0.32));
  g.add(box(w - 0.04, 0.07, 0.045, darkWood, 0, seatY - 0.05, -d * 0.28));
  for (let i = 0; i < 5; i++) g.add(box(w - 0.1, 0.012, 0.022, darkWood, 0, seatY + 0.031, -d * 0.18 + i * d * 0.1));
  // 4 条椅腿 + 横撑
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const legH = seatY - 0.1 - (sz > 0 ? 0.02 : 0);
    g.add(cylRaw(0.024, 0.03, legH, woodMat, 6, sx * (w / 2 - 0.06), legH / 2 + 0.08, sz * d * 0.24));
  }
  for (const sz of [-1, 1]) {
    const st = cylRaw(0.017, 0.017, w - 0.14, woodMat, 6, 0, 0.18, sz * d * 0.24);
    st.rotation.z = Math.PI / 2; g.add(st);
  }
  for (const sx of [-1, 1]) {
    const st = cylRaw(0.017, 0.017, d * 0.48, woodMat, 6, sx * (w / 2 - 0.06), 0.18, 0);
    st.rotation.x = Math.PI / 2; g.add(st);
  }
  // 靠背：2 立柱 + 5 纺锤 + 顶冠板 + 腰板
  const backZ = -d * 0.26;
  for (const sx of [-1, 1]) {
    g.add(cylRaw(0.026, 0.034, h - seatY, woodMat, 8, sx * (w / 2 - 0.05), seatY + (h - seatY) / 2, backZ));
    g.add(cylRaw(0.04, 0.026, 0.08, woodMat, 8, sx * (w / 2 - 0.05), h + 0.03, backZ));
  }
  for (let i = 0; i < 5; i++) {
    const x = -w * 0.3 + i * w * 0.15;
    g.add(cylRaw(0.013, 0.016, h - seatY - 0.24, woodMat, 6, x, seatY + (h - seatY - 0.24) / 2 + 0.1, backZ));
  }
  g.add(box(w + 0.02, 0.1, 0.04, woodMat, 0, h - 0.03, backZ));
  g.add(box(w - 0.12, 0.06, 0.035, darkWood, 0, h - 0.12, backZ));
  g.add(box(w - 0.08, 0.09, 0.035, woodMat, 0, seatY + 0.32, backZ));
  // 扶手 + 支撑柱
  for (const sx of [-1, 1]) {
    g.add(box(0.06, 0.035, d * 0.5, woodMat, sx * (w / 2 - 0.03), seatY + 0.26, d * 0.02));
    g.add(cylRaw(0.019, 0.024, 0.26, woodMat, 6, sx * (w / 2 - 0.03), seatY + 0.13, d * 0.24));
    g.add(cylRaw(0.019, 0.024, 0.22, woodMat, 6, sx * (w / 2 - 0.03), seatY + 0.15, -d * 0.14));
    g.add(box(0.09, 0.03, 0.09, darkWood, sx * (w / 2 - 0.03), seatY + 0.28, d * 0.24));
  }
  shade(g); return g;
}

function buildRollTopDesk(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height;
  const woodMat = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x3a2818, 0.85);
  const brass = M.metal(0x8a6a3a, 0.35, 0.75);
  const deskH = h * 0.62;
  // 桌面（微倒角）+ 皮垫 + 侧板 + 背板 + 踢脚
  g.add(slabTop(w + 0.06, 0.05, d + 0.04, woodMat, 0, deskH, 0));
  g.add(box(w - 0.14, 0.012, d - 0.36, M.paint(0x3a4a3a, 0.8), 0, deskH + 0.031, 0.12));            // 皮垫前移（原位置压在鸽笼格底下）
  for (const sx of [-1, 1]) g.add(box(0.05, deskH - 0.08, d - 0.06, woodMat, sx * (w / 2 - 0.025), (deskH + 0.08) / 2, 0));  // 侧板：顶插进桌面、底压住踢脚（原中心算错，顶离桌底 5.5cm 整段悬空）
  g.add(box(w - 0.1, deskH - 0.1, 0.03, darkWood, 0, (deskH - 0.1) / 2, -d / 2 + 0.04));
  for (const sx of [-1, 1]) g.add(box(0.1, 0.08, d - 0.1, darkWood, sx * (w / 2 - 0.06), 0.04, 0));
  // 卷帘顶：半圆筒 + 木条压线（圆筒轴沿桌宽方向；曾多转 90° 导致筒身横穿进深、前后各探出一截）
  const rollR = d * 0.42;
  const cubY = deskH + 0.025, cubH = rollR * 0.8;                       // 鸽笼格直接坐在桌面上（原来悬空 3.5cm）
  const rollY = cubY + cubH + 0.0125 - rollR * 0.42;                    // 卷帘弦面正好压在鸽笼格顶板上
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(rollR, rollR, w - 0.08, 12, 1, false, 0, Math.PI), woodMat);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, rollY + rollR * 0.42, -d / 2 + rollR);
  g.add(roll);
  for (let i = 0; i < 16; i++) {                                        // 密排帘片：厚度=片距（片贴片），底端收在桌面高度
    const a = (i / 15) * Math.PI * 0.79 + 0.06;
    g.add(box(w - 0.1, 0.05, 0.05, darkWood,
      0, rollY + rollR * 0.42 + Math.cos(a) * (rollR + 0.005), -d / 2 + rollR + Math.sin(a) * (rollR + 0.005)));
  }
  g.add(box(w - 0.06, 0.06, 0.05, woodMat, 0, rollY + rollR * 0.42 + rollR, -d / 2 + rollR));
  g.add(box(0.16, 0.03, 0.04, brass, 0, rollY + rollR * 0.42 + rollR - 0.05, -d / 2 + rollR + 0.03));
  // 内部鸽笼格 + 小抽屉 + 中央柜门
  g.add(box(w - 0.14, 0.025, d * 0.4, darkWood, 0, cubY + cubH / 2, -d / 2 + d * 0.22));
  g.add(box(w - 0.14, 0.025, d * 0.4, darkWood, 0, cubY + cubH, -d / 2 + d * 0.22));
  for (let i = 0; i < 6; i++) {
    g.add(box(0.02, cubH, d * 0.38, woodMat, -w * 0.36 + i * w * 0.144, cubY + cubH * 0.5, -d / 2 + d * 0.22));  // 隔板中心归位（原 0.75 使隔板下悬 6cm、上穿顶板 5cm）
  }
  for (const sx of [-1, 1]) {
    g.add(box(0.02, cubH * 0.5, d * 0.38, woodMat, sx * (w / 2 - 0.09), cubY + cubH * 0.25, -d / 2 + d * 0.22));
    for (let i = 0; i < 2; i++) {
      const y = cubY + 0.09 + i * 0.17;
      g.add(box(w * 0.13, 0.14, 0.025, woodMat, sx * (w / 2 - w * 0.085), y, -d / 2 + d * 0.4));
      g.add(cylRaw(0.013, 0.013, 0.022, brass, 6, sx * (w / 2 - w * 0.085), y, -d / 2 + d * 0.4 + 0.02));
    }
  }
  // 下部：3 抽屉 + 2 柜门 + 铜拉手
  g.add(box(w - 0.1, deskH - 0.1, 0.03, darkWood, 0, 0.08 + (deskH - 0.1) / 2, d / 2 - 0.04));   // 背板：上插桌底、下落踢脚、两侧贴侧板（原抽屉柜门上下都不着边）
  const dh = (deskH - 0.2) / 3;
  for (let i = 0; i < 3; i++) {
    const y = 0.12 + dh * (i + 0.5);
    g.add(box(w * 0.34, dh * 0.82, 0.028, woodMat, 0, y, d / 2 - 0.03));
    g.add(box(w * 0.2, 0.02, 0.02, darkWood, 0, y, d / 2 - 0.012));
    for (const sx of [-1, 1]) g.add(cylRaw(0.015, 0.015, 0.024, brass, 6, sx * w * 0.07, y, d / 2 - 0.012));
  }
  for (const sx of [-1, 1]) {
    g.add(box(w * 0.28, deskH - 0.16, 0.028, woodMat, sx * (w / 2 - w * 0.17), (deskH - 0.16) / 2 + 0.06, d / 2 - 0.03));
    g.add(box(w * 0.2, deskH - 0.3, 0.016, darkWood, sx * (w / 2 - w * 0.17), (deskH - 0.16) / 2 + 0.06, d / 2 - 0.012));
    g.add(cylRaw(0.016, 0.016, 0.026, brass, 6, sx * (w / 2 - w * 0.28), deskH * 0.55, d / 2 - 0.012));
  }
  shade(g); return g;
}

function buildBookcase(p) {
  const g = new THREE.Group();
  const w = p.width, d = p.depth, h = p.height;
  const woodMat = M.paint(p.woodColor, 0.82);
  const darkWood = M.paint(0x4a3020, 0.85);
  const bookCols = [0x8a2f2f, 0x2f4a8a, 0x3a6a3a, 0x8a6a2f, 0x5a3a6a, 0xb8642f, 0x2f6a6a, 0x6a2f4a];
  // 侧板 + 顶底板 + 背板 + 中央竖隔板
  for (const sx of [-1, 1]) g.add(box(0.045, h, d, woodMat, sx * (w / 2 - 0.022), h / 2, 0));
  g.add(box(w - 0.08, h - 0.06, 0.018, darkWood, 0, h / 2, -d / 2 + 0.03));
  g.add(slabTop(w, 0.05, d, woodMat, 0, 0.025, 0));
  g.add(slabTop(w - 0.06, 0.04, d - 0.04, woodMat, 0, h - 0.05, 0));
  g.add(box(0.03, h - 0.12, d - 0.06, woodMat, 0, (h - 0.12) / 2 + 0.05, 0));
  // 顶冠线脚（2 段倒角）+ 底座踢脚
  g.add(bevelSign(w + 0.1, 0.09, d + 0.08, woodMat, 0, h + 0.01, 0));
  g.add(box(w + 0.14, 0.05, d + 0.1, darkWood, 0, h + 0.08, 0));
  g.add(box(w + 0.06, 0.1, d + 0.03, woodMat, 0, 0.05, 0.01));
  for (const sx of [-1, 1]) g.add(box(0.08, 0.12, d + 0.02, woodMat, sx * (w / 2 - 0.02), 0.06, 0.01));
  // 4 层搁板（微倒角）+ 前沿收边
  const ns = 4;
  for (let i = 1; i <= ns; i++) {
    const y = 0.05 + i * ((h - 0.14) / (ns + 1));
    g.add(slabTop(w - 0.09, 0.032, d - 0.05, woodMat, 0, y, 0.01));
    g.add(box(w - 0.1, 0.045, 0.014, darkWood, 0, y - 0.03, d / 2 - 0.03));
    // 书本：竖排 + 少量斜靠
    const shelfH = (h - 0.14) / (ns + 1) - 0.06;
    for (const sx of [-1, 1]) {
      let x = sx * 0.04;
      for (let k = 0; k < 5; k++) {
        const bw = 0.026 + ((k * 7 + i * 3) % 4) * 0.006;
        const bh = shelfH * (0.72 + ((k + i) % 3) * 0.09);
        x += sx * bw / 2;
        const bk = box(bw, bh, d - 0.14, M.paint(bookCols[(k * 3 + i * 2 + (sx > 0 ? 1 : 0)) % bookCols.length], 0.85), x, y + 0.02 + bh / 2, 0.02);
        g.add(bk);
        x += sx * (bw / 2 + 0.006);
      }
      const lean = box(0.03, shelfH * 0.78, d - 0.15, M.paint(bookCols[(i + 3) % bookCols.length], 0.85), sx * (w / 2 - 0.14), y + 0.02 + shelfH * 0.32, 0.02);
      lean.rotation.z = sx * 0.28; g.add(lean);
    }
  }
  // 顶层装饰盒 + 相框
  g.add(box(0.24, 0.16, d - 0.1, M.paint(0x9a8a6a, 0.85), -w * 0.26, h - 0.16, 0.02));
  g.add(box(0.24, 0.02, d - 0.1, darkWood, -w * 0.26, h - 0.075, 0.02));
  g.add(box(0.16, 0.2, 0.02, woodMat, w * 0.28, h - 0.17, -d / 2 + 0.1));
  g.add(box(0.12, 0.16, 0.012, M.paint(0xd8d0c2, 0.8), w * 0.28, h - 0.17, -d / 2 + 0.115));
  shade(g); return g;
}

// ===========================================================================
// Ch6 — American Road Types & Intersections (10)
// ===========================================================================
// ---- 真实工程尺度常量（m，参考 AASHTO/城市道路惯例） ----
const PT = 0.15;                    // 路面顶标高（面层厚）
const CURB_H = 0.15, CURB_W = 0.45; // 缘石高 / 缘石带宽
const SW_W = 1.8;                   // 人行道净宽
const SIDE = CURB_W + SW_W;         // 路侧带 = 2.25
const LANE = 3.7;                   // 车道宽
const MY = PT + 0.012;              // 标线顶面
const RRET = 5.0;                   // 缘石回转半径
const mAsph = () => M.concrete(0x3a3d42, 0.95);
const mConc = () => M.concrete(0x9d9c97, 0.9);
const mWalk = () => M.concrete(0xc8c3b7, 0.9);
const mCurb = () => M.concrete(0xb0aca4, 0.9);
const mWhite = () => M.paint(0xf2f2ee, 0.75);
const mYellow = () => M.paint(0xe0b230, 0.8);
const mTan = () => M.concrete(0xc7ad83, 0.95);
const mGreen = () => M.paint(0x6a8a58, 0.9);
const mDark = () => M.concrete(0x6f6e6a, 0.9);
function rdFlat(pts, mat, y, rotY = 0) {
  const sh = new THREE.Shape(pts.map((q) => new THREE.Vector2(q[0], q[1])));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
  m.rotation.x = -Math.PI / 2; m.rotation.y = rotY; m.position.y = y;
  return m;
}
function rdArrow(L, mat, x, z, rotY = 0) {
  const a = 0.1, b = 0.3, hl = 0.6;
  const m = rdFlat([[-a, 0], [a, 0], [a, L - hl], [b, L - hl], [0, L], [-b, L - hl], [-a, L - hl]], mat, MY);
  m.position.set(x, MY, z); m.rotation.y = rotY;
  return m;
}
function rdTriXZ(p1, p2, p3, mat, y) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p1[0], y, p1[1], p2[0], y, p2[1], p3[0], y, p3[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function rdZebra(span, cx, cz, alongX, mat) {          // 大陆式斑马线：条宽0.45 中距1.05 长2.4
  const g = new THREE.Group();
  const n = Math.max(4, Math.round(span / 1.05));
  for (let i = 0; i < n; i++) {
    const o = -span / 2 + 0.45 + i * ((span - 0.9) / (n - 1));
    g.add(alongX ? box(2.4, 0.02, 0.45, mat, cx, MY, cz + o) : box(0.45, 0.02, 2.4, mat, cx + o, MY, cz));
  }
  return g;
}
function rdDashX(g, x, d, mat, wdt = 0.1) {            // 沿 z 的虚线（城市 3m 线 / 6m 间隔）
  const n = Math.max(2, Math.floor(d / 9));
  for (let i = 0; i < n; i++) g.add(box(wdt, 0.02, 3, mat, x, MY, -d / 2 + (i + 0.5) * (d / n)));
}
function rdSideZ(g, d, s, pav) {                       // 直路段路侧带：缘石+人行道+横缝
  g.add(box(CURB_W, 0.3, d, mCurb(), s * (pav / 2 + CURB_W / 2), PT, 0));
  g.add(box(SW_W, 0.3, d, mWalk(), s * (pav / 2 + CURB_W + SW_W / 2), PT, 0));
  const n = Math.max(2, Math.round(d / 1.8));
  for (let i = 1; i < n; i++) g.add(box(SW_W * 0.94, 0.02, 0.04, mDark(), s * (pav / 2 + CURB_W + SW_W / 2), PT + 0.16, -d / 2 + i * (d / n)));
}
function rdCornerQuad(g, w2, d2, pa, sx, sz) {         // 路口人行道象限：方块拼合+R5 弧形缘石回转
  const c = pa / 2, R = Math.min(RRET, w2 - c - 2.9, d2 - c - 2.9);
  const cx = c + R, cz = c + R;
  if (d2 - (c + R) > 0.05) g.add(box(w2 - c, 0.3, d2 - c - R, mWalk(), sx * (c + w2) / 2, PT, sz * (c + R + d2) / 2));
  if (w2 - (c + R) > 0.05) g.add(box(w2 - c - R, 0.3, R, mWalk(), sx * (c + R + w2) / 2, PT, sz * (c + cz) / 2));
  const arc = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.32, 14, 1, true, 0, Math.PI / 2), mCurb());
  arc.rotation.y = Math.atan2(-sx, -sz) - Math.PI / 4;
  arc.position.set(sx * cx, PT + 0.01, sz * cz);          // 外移3cm防共面, 顶高出1cm作缘石棱线
  g.add(arc);
  const csh = new THREE.Shape();                      // 回转封顶：1/4圆盘挤出角块(圆心=回转中心,顶=人行道顶)
  csh.moveTo(sx * R, 0);
  csh.absarc(sx * R, sz * R, R, -sz * Math.PI / 2, sx > 0 ? Math.PI : 0, sx * sz > 0);
  csh.lineTo(sx * R, sz * R);
  csh.closePath();
  const cgeo = new THREE.ExtrudeGeometry(csh, { depth: 0.3, bevelEnabled: false });
  const cm = new THREE.Mesh(cgeo, mWalk());
  cm.rotation.x = Math.PI / 2;
  cm.position.set(sx * c, PT + 0.15, sz * c);
  g.add(cm);
  for (const [lx, lz, lw, ld] of [[sx * (c + 0.225), sz * (c + R + d2) / 2, CURB_W, d2 - c - R], [sx * (c + R + w2) / 2, sz * (c + 0.225), w2 - c - R, CURB_W]]) {
    if (lw > 0.05 && ld > 0.05) g.add(box(lw, 0.3, ld, mCurb(), lx, PT, lz));
  }
  return R;
}

export function buildTwoWayRoad(p) {                   // 双向双车道：7.4m 车行+双侧路侧带
  const g = new THREE.Group();
  const w = p.width, d = p.length, pav = w - 2 * SIDE;
  g.add(box(pav, PT, d, mAsph(), 0, PT / 2, 0));
  rdSideZ(g, d, -1, pav); rdSideZ(g, d, 1, pav);
  for (const s of [-1, 1]) {
    g.add(box(0.15, 0.02, d, mWhite(), s * (pav / 2 - 0.6), MY, 0));
    g.add(box(0.1, 0.02, d, mYellow(), s * 0.15, MY, 0));
  }
  shade(g); return g;
}

export function buildOneWayRoad(p) {                   // 单向三车道：虚线分道+行车箭头
  const g = new THREE.Group();
  const w = p.width, d = p.length, pav = w - 2 * SIDE;
  g.add(box(pav, PT, d, mAsph(), 0, PT / 2, 0));
  rdSideZ(g, d, -1, pav); rdSideZ(g, d, 1, pav);
  for (const s of [-1, 1]) g.add(box(0.15, 0.02, d, mWhite(), s * (pav / 2 - 0.6), MY, 0));
  rdDashX(g, -pav / 6, d, mWhite()); rdDashX(g, pav / 6, d, mWhite());
  g.add(rdArrow(2.2, mWhite(), pav / 3, d / 2 - 3.2, Math.PI));
  shade(g); return g;
}

export function buildConcreteRoad(p) {                 // 混凝土路：4.8m 板块+锯缝+ gutter 缝
  const g = new THREE.Group();
  const w = p.width, d = p.length, pav = w - 2 * SIDE;
  g.add(box(pav, PT, d, mConc(), 0, PT / 2, 0));
  rdSideZ(g, d, -1, pav); rdSideZ(g, d, 1, pav);
  const nJ = Math.max(2, Math.round(d / 4.8));
  for (let i = 1; i < nJ; i++) g.add(box(pav, 0.02, 0.05, mDark(), 0, MY, -d / 2 + i * (d / nJ)));
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.02, d, mDark(), s * pav / 6, MY, 0));
    g.add(box(0.05, 0.02, d, mDark(), s * (pav / 2 - 0.45), MY, 0));
  }
  shade(g); return g;
}

export function buildGardenPath(p) {                   // 庭院小径：砂垫层+人字砖+立砖收边(直)
  const g = new THREE.Group();
  const w = p.width, d = p.length, pw = Math.min(1.5, w * 0.5);
  g.add(box(w, 0.1, d, mTan(), 0, 0.05, 0));
  g.add(box(pw + 0.24, 0.05, d, M.concrete(0xbfa87e, 0.95), 0, 0.11, 0));
  const brickMat = M.paint(p.brickColor, 0.85);
  const m = Math.max(2, Math.floor(pw / 2 / 0.14));
  const n = Math.floor((d - 0.2) / 0.16);
  for (let i = 0; i <= n; i++) {
    const z = -d / 2 + 0.1 + i * 0.16;
    for (let k = -m; k <= m; k++) {
      const br = box(0.2, 0.06, 0.1, brickMat, k * 0.13, 0.15, z);
      br.rotation.y = ((i + k) & 1) ? Math.PI / 4 : -Math.PI / 4;
      g.add(br);
    }
  }
  for (const s of [-1, 1]) {                            // 立砖收边
    const nb = Math.floor(d / 0.21);
    for (let i = 0; i < nb; i++) g.add(box(0.1, 0.08, 0.2, M.concrete(0x9a958c, 0.9), s * (pw / 2 + 0.07), 0.15, -d / 2 + 0.1 + i * 0.21));
  }
  shade(g); return g;
}

export function buildGravelRoad(p) {                   // 碎石路：路拱面+波浪车辙+路肩料垄
  const g = new THREE.Group();
  const w = p.width, d = p.length, gr = w - 1.2;
  g.add(box(w, 0.1, d, mTan(), 0, 0.05, 0));
  g.add(box(gr, 0.08, d, M.concrete(0x8a8580, 0.95), 0, 0.12, 0));
  g.add(box(gr * 0.5, 0.04, d, M.concrete(0x938e88, 0.95), 0, 0.17, 0));   // 路拱
  const nR = Math.max(4, Math.round(d / 0.6));
  for (const s of [-1, 1]) for (let i = 0; i < nR; i++) {
    const z = -d / 2 + (i + 0.5) * (d / nR);
    const seg = box(gr * 0.16, 0.02, d / nR + 0.08, M.concrete(0x6e6963, 0.95), s * gr * 0.22 + Math.sin(z * 0.7) * 0.08, 0.19, z);
    seg.rotation.y = -Math.cos(z * 0.7) * 0.05;
    g.add(seg);
  }
  for (const s of [-1, 1]) g.add(box(0.5, 0.1, d, M.concrete(0x7a7570, 0.95), s * (w / 2 - 0.3), 0.13, 0));
  const rng = makeRng(42), placed = [];
  for (let i = 0; i < 160 && placed.length < 90; i++) {
    const s = i & 1 ? 1 : -1;
    const x = s * (w / 2 - 0.3) + (rng() - 0.5) * 0.4, z = (rng() - 0.5) * d * 0.98, sz = 0.08 + rng() * 0.12;
    if (placed.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < (q[2] + sz) * (q[2] + sz) * 0.8)) continue;   // 防平面重叠遮盲
    placed.push([x, z, sz]);
    const st = box(sz, 0.08 + rng() * 0.05, sz * (0.8 + rng() * 0.5), M.concrete(0x767169, 0.9), x, 0.15 + rng() * 0.04, z);
    st.rotation.y = rng() * Math.PI;
    g.add(st);
  }
  shade(g); return g;
}

export function buildFourWayStop(p) {                         // 十字路口：7.4m 进口+R5 回转+大陆斑马线+停止线
  const g = new THREE.Group();
  const w = p.width, d = p.length, pa = 7.4;
  g.add(box(w, PT, d, mAsph(), 0, PT / 2, 0));
  const R = rdCornerQuad(g, w / 2, d / 2, pa, 1, 1);
  rdCornerQuad(g, w / 2, d / 2, pa, -1, 1);
  rdCornerQuad(g, w / 2, d / 2, pa, 1, -1);
  rdCornerQuad(g, w / 2, d / 2, pa, -1, -1);
  const zc = pa / 2 + R + 1.5;
  for (const s of [-1, 1]) {
    g.add(rdZebra(pa - 1.2, 0, s * zc, false, mWhite()));
    g.add(rdZebra(pa - 1.2, s * zc, 0, true, mWhite()));
    g.add(box(3.4, 0.02, 0.6, mWhite(), s * 1.8, MY, s * (zc - 1.8)));    // 右半停止线
    g.add(box(0.6, 0.02, 3.4, mWhite(), s * (zc - 1.8), MY, -s * 1.8));
  }
  shade(g); return g;
}

export function buildTJunction(p) {                           // T 形路口：三进口+封边人行带+R5 回转
  const g = new THREE.Group();
  const w = p.width, d = p.length, pa = 7.4, c = pa / 2;
  g.add(box(w, PT, d, mAsph(), 0, PT / 2, 0));
  g.add(box(w, 0.3, d / 2 - c, mWalk(), 0, PT, (c + d / 2) / 2));          // 北封边人行带
  g.add(box(w, 0.3, CURB_W, mCurb(), 0, PT, c + CURB_W / 2));
  const R = rdCornerQuad(g, w / 2, d / 2, pa, 1, -1);
  rdCornerQuad(g, w / 2, d / 2, pa, -1, -1);
  const e = c + R + 1.5;
  for (const s of [-1, 1]) g.add(rdZebra(pa - 1.2, s * e, 0, true, mWhite()));
  g.add(rdZebra(pa - 1.2, 0, -e, false, mWhite()));
  for (const s of [-1, 1]) {
    g.add(box(0.6, 0.02, 3.4, mWhite(), s * (e - 1.8), MY, s * 1.8));
    rdDashX(g, 0, d / 2 - e - 1.0, mWhite());
  }
  g.add(box(3.4, 0.02, 0.6, mWhite(), -1.8, MY, -(e - 1.8)));
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) g.add(box(3, 0.02, 0.1, mWhite(), s * (w / 2 - e - 2 - i * 4), MY, 0));
  shade(g); return g;
}

export function buildRoundabout(p) {                          // 单 lane 环岛：4.2m 环道+卡车 apron+导流岛
  const g = new THREE.Group();
  const w = p.width, d = p.length;
  const Ro = Math.min(w, d) / 2 - SIDE;
  const c = 3.7, rG = Ro - 5.5, rA = rG + 0.3, rAp = rG + 1.3;
  g.add(box(w, PT, d, mAsph(), 0, PT / 2, 0));
  const shp = new THREE.Shape();                        // 象限人行道=方-圆环块(挤出)
  const za = Math.sqrt(Math.max(0.01, Ro * Ro - c * c));
  shp.moveTo(c, za);
  shp.absarc(0, 0, Ro, Math.atan2(za, c), Math.atan2(c, za), true);
  shp.lineTo(w / 2, c); shp.lineTo(w / 2, d / 2); shp.lineTo(c, d / 2);
  shp.closePath();
  const geo = new THREE.ExtrudeGeometry(shp, { depth: 0.3, bevelEnabled: false });
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(geo, mWalk());
    m.rotation.x = Math.PI / 2; m.rotation.z = -k * Math.PI / 2;
    m.position.y = PT + 0.15;
    g.add(m);
  }
  const beta = Math.asin(Math.min(1, c / Ro));
  for (let k = 0; k < 4; k++) {
    const arc = new THREE.Mesh(new THREE.CylinderGeometry(Ro - 0.03, Ro - 0.03, 0.36, 18, 1, true, k * Math.PI / 2 + beta, Math.PI / 2 - 2 * beta), mCurb());
    arc.position.y = PT + 0.02;
    g.add(arc);
  }
  g.add(cyl(rAp, rAp, 0.33, M.concrete(0xc0bcb2, 0.9), 24, 0, PT + 0.015, 0));   // 中心岛：浅色铺装圆盘(图鉴式)
  const islCurb = new THREE.Mesh(new THREE.CylinderGeometry(rAp, rAp + 0.06, 0.33, 24, 1, true), mCurb());
  islCurb.position.y = PT + 0.015;
  g.add(islCurb);
  const rm = (rAp + Ro) / 2;
  for (let k = 0; k < 4; k++) {                           // 环行箭头
    const a0 = k * Math.PI / 2 + Math.PI / 4 - 0.45, a1 = a0 + 0.9;
    const ring = new THREE.Mesh(new THREE.RingGeometry(rm - 0.18, rm + 0.18, 14, 1, a0, 0.9), mWhite());
    ring.rotation.x = -Math.PI / 2; ring.position.y = MY;
    g.add(ring);
    const px = Math.cos(a1) * rm, pz = -Math.sin(a1) * rm;
    const tx = -Math.sin(a1), tz = -Math.cos(a1), nx = Math.cos(a1), nz = -Math.sin(a1);
    g.add(rdTriXZ([px - nx * 0.34, pz - nz * 0.34], [px + nx * 0.34, pz + nz * 0.34], [px + tx * 0.7, pz + tz * 0.7], mWhite(), MY));
  }
  for (let k = 0; k < 4; k++) {                           // 进口斑马线(导流岛后)
    const zb = rdZebra(6.2, 0, 0, false, mWhite());
    zb.position.set(0, 0, 0);
    const hh = new THREE.Group();
    hh.add(zb);
    hh.rotation.y = k * Math.PI / 2;
    zb.position.z = Ro + 0.9;
    g.add(hh);
  }
  shade(g); return g;
}

export function buildCulDeSac(p) {                            // 尽端路：R≈11 圆头+8.5m 颈+环形人行道
  const g = new THREE.Group();
  const w = p.width, d = p.length;
  const Rb = w / 2 - SIDE, zc = d / 2 - Rb - SIDE, nh = 4.25;
  g.add(box(w, 0.12, d, mTan(), 0, 0.06, 0));
  g.add(box(nh * 2, PT, zc + d / 2, mAsph(), 0, PT / 2, (zc - d / 2) / 2));
  g.add(cyl(Rb, Rb, PT, mAsph(), 32, 0, PT / 2, zc));
  const Rc = Rb + CURB_W / 2, gam = Math.asin(Math.min(1, nh / Rc));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(Rc, Rc, 0.3, 32, 1, true, -Math.PI / 2 + gam, 2 * Math.PI - 2 * gam), mCurb());
  ring.position.set(0, PT, zc);
  g.add(ring);
  const zt = zc - Math.sqrt(Math.max(0.01, Rc * Rc - (nh + CURB_W / 2) ** 2));
  const rf = 1.2, a0x = nh + CURB_W / 2;
  for (const s of [-1, 1]) {
    g.add(box(CURB_W, 0.3, zt + d / 2, mCurb(), s * a0x, PT, (-d / 2 + zt) / 2));
    const cx0 = a0x - rf, dz0 = Math.sqrt(Math.max(0.01, (Rc - rf) ** 2 - cx0 ** 2));
    const C = [s * cx0, zc - dz0];                        // 颈-环凹弧过渡圆心(内切)
    const th1 = s * Math.PI / 2, th2 = Math.atan2(C[0], C[1] - zc);
    const fil = new THREE.Mesh(new THREE.CylinderGeometry(rf, rf, 0.3, 10, 1, true, Math.min(th1, th2), Math.abs(th2 - th1)), mCurb());
    fil.position.set(C[0], PT, C[1]);
    g.add(fil);
  }
  const Rs1 = Rb + CURB_W, Rs2 = Rs1 + SW_W, g2 = Math.asin(Math.min(1, a0x / Rs1));
  const swSh = new THREE.Shape();
  swSh.absarc(0, 0, Rs2, -Math.PI / 2 + g2, Math.PI * 1.5 - g2, false);
  swSh.absarc(0, 0, Rs1, Math.PI * 1.5 - g2, -Math.PI / 2 + g2, true);
  swSh.closePath();
  const swGeo = new THREE.ExtrudeGeometry(swSh, { depth: 0.3, bevelEnabled: false });
  const swM = new THREE.Mesh(swGeo, mWalk());
  swM.rotation.x = Math.PI / 2; swM.position.set(0, PT + 0.15, zc);
  g.add(swM);
  for (const s of [-1, 1]) g.add(box(SW_W, 0.3, zt + d / 2 + 0.4, mWalk(), s * (a0x + SW_W / 2), PT, (-d / 2 + zt + 0.4) / 2 - 0.2));
  shade(g); return g;
}

export function buildFreeway(p) {                             // 高速：2×2 车道+4m 中央带+硬路肩+护栏
  const g = new THREE.Group();
  const w = p.width, d = p.length;
  const dirW = (w - 4) / 2;
  for (const s of [-1, 1]) g.add(box(dirW, PT, d, mAsph(), s * (2 + dirW / 2), PT / 2, 0));
  g.add(box(4, PT, d, M.concrete(0x8f8b82, 0.9), 0, PT / 2, 0));
  g.add(box(1.0, 0.25, d, mCurb(), 0, PT + 0.1, 0));
  g.add(box(0.6, 0.85, d, M.concrete(0xb5b1a8, 0.9), 0, PT + 0.55, 0));    // 中央防撞墙
  for (const s of [-1, 1]) {
    const xc = s * (2 + dirW / 2);
    g.add(box(0.1, 0.02, d, mYellow(), s * 2.5, MY, 0));
    g.add(box(0.15, 0.02, d, mWhite(), s * (w / 2 - 2.8), MY, 0));
    rdDashX(g, s * (2.5 + (w / 2 - 2.8)) / 2, d, mWhite());
    const nP = Math.floor(d / 2.5);
    for (let i = 0; i < nP; i++) g.add(box(0.15, 0.7, 0.15, M.metal(0x888888, 0.4, 0.7), s * (w / 2 - 0.5), 0.35, -d / 2 + (i + 0.5) * (d / nP)));
    g.add(box(0.1, 0.3, d, M.metal(0x999999, 0.35, 0.7), s * (w / 2 - 0.55), 0.6, 0));   // W 梁护栏
  }
  shade(g); return g;
}

// ===========================================================================
// Ch7 — American Traffic Components (10)
// ===========================================================================
function buildTrafficLight(p) {
  const g = new THREE.Group();
  const poleH = p.poleHeight;
  g.add(cyl(0.06, 0.08, poleH, M.metal(0x555555, 0.5, 0.7), 10, 0, poleH / 2, 0));
  const housingW = 0.3, housingH = 0.9;
  g.add(box(housingW, housingH, 0.2, M.dark(0x222222), 0, poleH + housingH / 2, 0));
  const lightR = 0.08;
  const colors = [0xff0000, 0xffcc00, 0x00ff00];
  for (let i = 0; i < 3; i++) {
    const y = poleH + housingH - 0.15 - i * 0.28;
    const mat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.3, emissive: new THREE.Color(colors[i]), emissiveIntensity: i === 2 ? 1.5 : 0.1 });
    g.add(cyl(lightR, lightR, 0.05, mat, 12, 0, y, 0.12));
  }
  g.userData.glow = [g.children[g.children.length - 1]];
  shade(g); return g;
}

function buildPedSignal(p) {
  const g = new THREE.Group();
  const poleH = p.poleHeight;
  g.add(cyl(0.05, 0.06, poleH, M.metal(0x555555, 0.5, 0.7), 10, 0, poleH / 2, 0));
  const boxW = 0.25, boxH = 0.35;
  g.add(box(boxW, boxH, 0.15, M.dark(0x222222), 0, poleH + boxH / 2, 0));
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.3, emissive: new THREE.Color(0x00ff00), emissiveIntensity: 1.2 });
  g.add(box(0.12, 0.18, 0.04, walkMat, 0, poleH + boxH / 2, 0.1));
  g.userData.glow = [walkMat];
  shade(g); return g;
}

function buildStreetLamp(p) {
  const g = new THREE.Group();
  const poleH = p.poleHeight;
  g.add(cyl(0.08, 0.1, poleH, M.metal(0x444444, 0.5, 0.7), 10, 0, poleH / 2, 0));
  g.add(box(0.8, 0.1, 0.1, M.metal(0x444444, 0.5, 0.7), 0.35, poleH - 0.05, 0));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffeecc, roughness: 0.3, emissive: new THREE.Color(0xffeecc), emissiveIntensity: 1.5 });
  g.add(box(0.3, 0.15, 0.15, lampMat, 0.7, poleH - 0.1, 0));
  g.userData.glow = [lampMat];
  shade(g); return g;
}

function buildWaterBarrier(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const plasticMat = M.paint(p.color, 0.7);
  g.add(box(w, h, 0.4, plasticMat, 0, h / 2, 0));
  g.add(box(w * 0.9, 0.08, 0.42, M.paint(0xffffff, 0.8), 0, h * 0.7, 0));
  g.add(box(w * 0.9, 0.08, 0.42, M.paint(0xffffff, 0.8), 0, h * 0.3, 0));
  g.add(box(w * 0.95, 0.15, 0.5, M.concrete(0x888888), 0, 0.075, 0));
  shade(g); return g;
}

function buildTrafficCone(p) {
  const g = new THREE.Group();
  const h = p.height;
  const coneMat = M.paint(p.color, 0.7);
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.15, h, qseg(24)), coneMat).translateY(h / 2));
  g.add(box(0.35, 0.04, 0.35, coneMat, 0, 0.02, 0));
  g.add(cyl(0.1, 0.12, 0.08, M.paint(0xffffff, 0.8), 14, 0, h * 0.6, 0));
  shade(g); return g;
}

function buildTrafficDrum(p) {
  const g = new THREE.Group();
  const r = p.radius, h = p.height;
  const drumMat = M.paint(p.color, 0.7);
  g.add(cyl(r, r, h, drumMat, 16, 0, h / 2, 0));
  g.add(cyl(r + 0.02, r + 0.02, 0.06, M.paint(0xffffff, 0.8), 16, 0, h * 0.7, 0));
  g.add(cyl(r + 0.02, r + 0.02, 0.06, M.paint(0xffffff, 0.8), 16, 0, h * 0.3, 0));
  shade(g); return g;
}

function buildJerseyBarrier(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  const concreteMat = M.concrete(0x999999, 0.9);
  g.add(box(w, h * 0.3, 0.15, concreteMat, 0, h * 0.15, 0));
  g.add(box(w, h * 0.5, 0.25, concreteMat, 0, h * 0.55, 0));
  g.add(box(w, h * 0.2, 0.15, concreteMat, 0, h * 0.9, 0));
  shade(g); return g;
}

function buildDelineator(p) {
  const g = new THREE.Group();
  const h = p.height;
  g.add(cyl(0.08, 0.1, 0.15, M.concrete(0x888888, 0.9), 12, 0, 0.075, 0));
  const postMat = M.paint(0xff6600, 0.7);
  g.add(cyl(0.03, 0.03, h - 0.15, postMat, 8, 0, 0.15 + (h - 0.15) / 2, 0));
  g.add(cyl(0.04, 0.04, 0.15, M.paint(0xffffff, 0.8), 8, 0, h * 0.7, 0));
  shade(g); return g;
}

function buildBollard(p) {
  const g = new THREE.Group();
  const h = p.height;
  const metalMat = M.metal(p.metalColor, 0.4, 0.7);
  g.add(cyl(0.08, 0.1, h, metalMat, 12, 0, h / 2, 0));
  g.add(cyl(0.12, 0.12, 0.08, metalMat, 12, 0, 0.04, 0));
  g.add(cyl(0.09, 0.09, 0.06, M.paint(0xffcc00, 0.7), 12, 0, h - 0.03, 0));
  shade(g); return g;
}

function buildPortableSign(p) {
  const g = new THREE.Group();
  const w = p.width, h = p.height;
  g.add(box(0.6, 0.04, 0.4, M.metal(0x888888, 0.5, 0.7), 0, 0.02, 0));
  g.add(cyl(0.03, 0.03, h * 0.6, M.metal(0x888888, 0.5, 0.7), 8, 0, h * 0.3, 0));
  const signMat = M.paint(p.signColor, 0.7);
  g.add(box(w, h * 0.4, 0.04, signMat, 0, h * 0.6 + h * 0.2, 0));
  g.add(box(w * 0.8, h * 0.25, 0.02, M.paint(0xffffff, 0.8), 0, h * 0.6 + h * 0.2, 0.03));
  shade(g); return g;
}

// ===========================================================================
// Ch8 — American Regional Vegetation (10)
// ===========================================================================
const darker = (hex, k = 0.5) => new THREE.Color(hex).multiplyScalar(k).getHex();

function buildSugarMaple(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x5a4636, 0.92);
  const leafMat = vegMat(p.leafColor, 'leaf');
  const coreMat = M.paint(darker(p.leafColor, 0.32), 0.92);
  trunkBranches(g, { h, r0: 0.2, r1: 0.12, bark, seg: 10, nBranch: 6, bLen: h * 0.22, bR: 0.055, y0: h * 0.44, y1: h * 0.7, pitch: 0.8, seed: 11, tipMax: h * 0.9 });
  const cy = h * 0.7, cr = h * 0.2;
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(cr * (i === 0 ? 0.58 : 0.4), 1), coreMat);
    c.position.set(Math.cos(i * 2.1) * cr * 0.3, cy + (i - 1) * cr * 0.3, Math.sin(i * 2.1) * cr * 0.3);
    c.scale.y = 0.82; g.add(c);
  }
  canopyCards(g, { cy, rx: h * 0.27, ry: h * 0.21, rz: h * 0.27, n: 48, mat: leafMat, size: h * 0.16, seed: 23, sub: 3 });
  shade(g); return g;
}

function buildLiveOak(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x4a3a2a, 0.94);
  const leafMat = vegMat(p.leafColor, 'leaf');
  const coreMat = M.paint(darker(p.leafColor, 0.3), 0.92);
  // 活橡：主干粗壮、分枝近水平外展，树冠扁宽
  trunkBranches(g, { h, r0: 0.34, r1: 0.2, bark, seg: 10, nBranch: 7, bLen: h * 0.32, bR: 0.09, y0: h * 0.3, y1: h * 0.58, pitch: 1.18, seed: 17, tipMax: h * 0.8 });
  const cy = h * 0.6, cr = h * 0.24;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(cr * (i === 0 ? 0.52 : 0.36), 1), coreMat);
    c.position.set(Math.cos(a) * cr * (i === 0 ? 0 : 0.5), cy + (i === 0 ? cr * 0.12 : -cr * 0.06), Math.sin(a) * cr * (i === 0 ? 0 : 0.5));
    c.scale.y = 0.6; g.add(c);
  }
  canopyCards(g, { cy, rx: h * 0.42, ry: h * 0.24, rz: h * 0.42, n: 50, mat: leafMat, size: h * 0.18, seed: 31, sub: 3 });
  // 西班牙苔藓：若干细长下垂面片
  const mossMat = vegMat(0x9aa89a, 'blade');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(cardGeo(1), mossMat);
    m.scale.set(h * 0.05, h * 0.16, 1);
    m.position.set(Math.cos(a) * h * 0.28, cy - h * 0.16, Math.sin(a) * h * 0.28);
    m.rotation.y = a; g.add(m);
  }
  shade(g); return g;
}

function buildSaguaro(p) {
  const g = new THREE.Group();
  const h = p.height;
  const cactusMat = M.paint(p.color, 0.85);
  const darkMat = M.paint(darker(p.color, 0.62), 0.88);
  const rockMat = M.concrete(0x9a8a76);
  // 主干（12 边形）+ 半球顶 + 竖向肋条
  const mainH = h * 0.92, mainR = h * 0.036 + 0.14;
  g.add(cylRaw(mainR * 1.25, mainR * 1.5, h * 0.08, darkMat, 12, 0, h * 0.04, 0));
  g.add(cylRaw(mainR, mainR * 1.08, mainH, cactusMat, 12, 0, mainH / 2, 0));
  const capG = new THREE.SphereGeometry(mainR, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.Mesh(capG, cactusMat); cap.position.y = mainH; g.add(cap);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.add(cylRaw(0.02, 0.026, mainH * 0.98, darkMat, 4, Math.cos(a) * mainR * 1.01, mainH / 2, Math.sin(a) * mainR * 1.01));
  }
  // 3 条手臂：横出 + 肘部 + 上举 + 半球顶 + 肋条
  const arms = [[0.5, h * 0.52, 0.95], [2.4, h * 0.42, 0.72], [4.2, h * 0.62, 0.6]];
  for (const [yaw, ay, upLen] of arms) {
    const A = new THREE.Group(); A.position.y = ay; A.rotation.y = yaw; g.add(A);
    const B = new THREE.Group(); B.rotation.x = Math.PI / 2 - 0.22; A.add(B);
    const aR = mainR * 0.5, outLen = mainR * 2.6;
    B.add(cylRaw(aR, aR * 1.1, outLen, cactusMat, 10, 0, outLen / 2, 0));
    B.add(new THREE.Mesh(new THREE.SphereGeometry(aR, 8, 4), cactusMat).translateY(outLen));
    const U = new THREE.Group(); U.position.y = outLen; U.rotation.x = -(Math.PI / 2 - 0.1); B.add(U);
    U.add(cylRaw(aR * 0.94, aR, upLen, cactusMat, 10, 0, upLen / 2, 0));
    const uc = new THREE.Mesh(new THREE.SphereGeometry(aR * 0.94, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), cactusMat);
    uc.position.y = upLen; U.add(uc);
    for (let i = 0; i < 6; i++) {
      const ra = (i / 6) * Math.PI * 2;
      U.add(cylRaw(0.016, 0.02, upLen * 0.94, darkMat, 4, Math.cos(ra) * aR * 0.96, upLen / 2, Math.sin(ra) * aR * 0.96));
    }
    // 臂端花冠
    for (let i = 0; i < 5; i++) {
      const ra = (i / 5) * Math.PI * 2;
      const fl = box(0.05, 0.05, 0.05, M.paint(0xf5f0e0, 0.8), Math.cos(ra) * aR * 0.6, upLen + aR * 0.9, Math.sin(ra) * aR * 0.6);
      U.add(fl);
    }
  }
  // 主干顶端花冠 + 基部碎石
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(box(0.06, 0.06, 0.06, M.paint(0xf8f2e2, 0.8), Math.cos(a) * mainR * 0.62, mainH + mainR * 0.86, Math.sin(a) * mainR * 0.62));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, r = mainR * 2.4;
    const rk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14 + (i % 3) * 0.05, 0), rockMat);
    rk.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r);
    rk.rotation.set(i * 0.7, i * 1.3, i * 0.4); rk.scale.y = 0.6; g.add(rk);
  }
  shade(g); return g;
}

function buildCoastRedwood(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x6b4226, 0.94);
  const needleMat = M.paint(p.foliageColor, 0.88);
  const darkNeedle = M.paint(darker(p.foliageColor, 0.6), 0.9);
  const tR = h * 0.022 + 0.14;
  g.add(cylRaw(tR * 1.9, tR * 2.4, h * 0.05, bark, 10, 0, h * 0.025, 0));
  g.add(cylRaw(tR * 0.55, tR, h, bark, 10, 0, h / 2, 0));
  for (let i = 0; i < 5; i++) g.add(cylRaw(tR * (1 - i * 0.08) + 0.02, tR * (1 - i * 0.08) + 0.02, 0.08, M.paint(0x54331c, 0.95), 10, 0, h * (0.12 + i * 0.16), 0));
  // 层叠圆锥叶层（10 边形）+ 平展枝片
  const nL = 26;
  for (let i = 0; i < nL; i++) {
    const t = i / (nL - 1);
    const y = h * (0.3 + t * 0.66);
    const r = h * 0.17 * Math.pow(1 - t, 0.72) + h * 0.014;
    const layer = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.055, 10), i % 3 === 0 ? darkNeedle : needleMat);
    layer.position.set(0, y, 0); layer.rotation.y = i * 0.42; g.add(layer);
    if (i % 3 === 0 && i < nL - 4) {
      for (let k = 0; k < 4; k++) {
        const a = i * 0.9 + (k / 4) * Math.PI * 2;
        const tw = box(r * 0.9, h * 0.008, r * 0.24, darkNeedle, Math.cos(a) * r * 0.55, y - h * 0.022, Math.sin(a) * r * 0.55);
        tw.rotation.y = -a; g.add(tw);
      }
    }
  }
  g.add(new THREE.Mesh(new THREE.ConeGeometry(tR * 0.7, h * 0.06, 8), needleMat).translateY(h * 0.985));
  shade(g); return g;
}

function buildDouglasFir(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x5a4030, 0.92);
  const needleMat = M.paint(p.needleColor, 0.88);
  const darkNeedle = M.paint(darker(p.needleColor, 0.58), 0.9);
  const tR = h * 0.016 + 0.1;
  g.add(cylRaw(tR * 1.8, tR * 2.2, h * 0.05, bark, 10, 0, h * 0.025, 0));
  g.add(cylRaw(tR * 0.5, tR, h * 0.96, bark, 10, 0, h * 0.48, 0));
  for (let i = 0; i < 4; i++) g.add(cylRaw(tR * (1 - i * 0.09) + 0.018, tR * (1 - i * 0.09) + 0.018, 0.07, M.paint(0x46301f, 0.95), 10, 0, h * (0.1 + i * 0.18), 0));
  const nL = 24;
  for (let i = 0; i < nL; i++) {
    const t = i / (nL - 1);
    const y = h * (0.16 + t * 0.78);
    const r = h * 0.19 * Math.pow(1 - t, 0.85) + h * 0.012;
    const layer = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.06, 10), i % 4 === 1 ? darkNeedle : needleMat);
    layer.position.set(0, y, 0); layer.rotation.y = i * 0.55; g.add(layer);
    // 下垂枝片：4 根斜向细板
    for (let k = 0; k < 4; k++) {
      const a = i * 1.1 + (k / 4) * Math.PI * 2;
      const tw = box(r * 1.05, h * 0.007, r * 0.2, i % 2 ? darkNeedle : needleMat, Math.cos(a) * r * 0.58, y - h * 0.026, Math.sin(a) * r * 0.58);
      tw.rotation.y = -a; tw.rotation.z = 0.22; g.add(tw);
    }
  }
  g.add(new THREE.Mesh(new THREE.ConeGeometry(tR * 0.6, h * 0.07, 8), needleMat).translateY(h * 0.975));
  shade(g); return g;
}

function buildBigBluestem(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bladeMat = vegMat(p.color, 'blade');
  const seedMat = vegMat(0x8b6914, 'blade');
  const R = 0.17;
  // GPU 实例化：12 张交叉叶片（2~3 组交叉四边形）
  g.add(instCards(bladeMat, 12, (i, rng, v, e, s) => {
    const a = (i / 12) * Math.PI * 2 + rng() * 0.5, r = rng() * R;
    const sc = h * (0.78 + rng() * 0.4);
    v.set(Math.cos(a) * r, sc / 2, Math.sin(a) * r);
    e.set((rng() - 0.5) * 0.3, a + Math.PI / 2 + (i % 3) * (Math.PI / 3), (rng() - 0.5) * 0.26);
    s.set(sc * 0.14, sc, 1);
  }, 101));
  // 穗状花序：4 张实例化面片
  g.add(instCards(seedMat, 4, (i, rng, v, e, s) => {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    v.set(Math.cos(a) * R * 0.5, h * 1.02, Math.sin(a) * R * 0.5);
    e.set((rng() - 0.5) * 0.2, a, (rng() - 0.5) * 0.2);
    s.set(h * 0.2, h * 0.26, 1);
  }, 202));
  shade(g); return g;
}

function buildBluebonnet(p) {
  const g = new THREE.Group();
  const h = p.height;
  const stemMat = vegMat(0x4a7a3a, 'blade');
  const flowerMat = vegMat(p.flowerColor, 'leaf');
  const R = 0.18;
  // GPU 实例化：8 张茎叶面片 + 10 张花穗面片
  g.add(instCards(stemMat, 8, (i, rng, v, e, s) => {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.6, r = rng() * R;
    const sc = h * (0.6 + rng() * 0.4);
    v.set(Math.cos(a) * r, sc / 2, Math.sin(a) * r);
    e.set((rng() - 0.5) * 0.34, a + Math.PI / 2 + (i % 2) * (Math.PI / 2), (rng() - 0.5) * 0.3);
    s.set(sc * 0.16, sc, 1);
  }, 303));
  g.add(instCards(flowerMat, 10, (i, rng, v, e, s) => {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4, r = rng() * R * 0.92;
    const sc = h * (0.2 + rng() * 0.14);
    v.set(Math.cos(a) * r, h * (0.62 + rng() * 0.3), Math.sin(a) * r);
    e.set((rng() - 0.5) * 0.3, a + Math.PI / 3, (rng() - 0.5) * 0.3);
    s.set(sc, sc * 1.5, 1);
  }, 404));
  shade(g); return g;
}

function buildSabalPalm(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x8a7a60, 0.92);
  const darkBark = M.paint(0x6a5c46, 0.94);
  const frondMat = vegMat(p.frondColor, 'frond');
  const tR = h * 0.026 + 0.09;
  // 树干（10 边形）+ 环形叶疤
  g.add(cylRaw(tR * 1.3, tR * 1.6, h * 0.05, darkBark, 10, 0, h * 0.025, 0));
  g.add(cylRaw(tR * 0.92, tR, h * 0.94, bark, 10, 0, h * 0.47, 0));
  for (let i = 0; i < 12; i++) {
    const y = h * (0.1 + i * 0.068), rr = tR * (1 - i * 0.006);
    g.add(cylRaw(rr * 1.06, rr * 1.1, 0.07, darkBark, 8, 0, y, 0));
  }
  const crownY = h * 0.94;
  g.add(cylRaw(tR * 1.15, tR * 0.95, h * 0.08, M.paint(0x7a8a5a, 0.9), 10, 0, crownY + h * 0.03, 0));
  // 枯叶裙
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const sk = box(tR * 1.5, 0.03, h * 0.16, darkBark, Math.cos(a) * tR * 1.1, crownY - h * 0.06, Math.sin(a) * tR * 1.1);
    sk.rotation.y = -a; sk.rotation.x = 0.85; g.add(sk);
  }
  // 14 片叶，每片 2 张交叉 Alpha 面片
  const nF = 14, fLen = h * 0.5;
  for (let i = 0; i < nF; i++) {
    const a = (i / nF) * Math.PI * 2;
    const droop = 0.55 + (i % 3) * 0.28;
    const F = new THREE.Group(); F.position.set(0, crownY + h * 0.05, 0); F.rotation.y = a; g.add(F);
    for (const cross of [0, Math.PI / 2]) {
      const card = new THREE.Mesh(cardGeo(3), frondMat);
      card.scale.set(fLen * 0.34, fLen, 1);
      card.position.set(0, -fLen * 0.18, fLen * 0.5);
      card.rotation.set(Math.PI / 2 - droop, 0, 0);
      const holder = new THREE.Group(); holder.rotation.y = cross; holder.add(card); F.add(holder);
    }
    // 叶柄
    const pet = cylRaw(0.035, 0.05, fLen * 0.5, darkBark, 6, 0, 0, fLen * 0.24);
    pet.rotation.x = Math.PI / 2 - droop * 0.5; F.add(pet);
  }
  // 中心嫩叶（近直立，填补冠顶空洞）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const F = new THREE.Group(); F.position.set(0, crownY + h * 0.06, 0); F.rotation.y = a; g.add(F);
    for (const cross of [0, Math.PI / 2]) {
      const card = new THREE.Mesh(cardGeo(3), frondMat);
      card.scale.set(fLen * 0.26, fLen * 0.72, 1);
      card.position.set(0, fLen * 0.3, fLen * 0.12);
      card.rotation.set(0.32, 0, 0);
      const holder = new THREE.Group(); holder.rotation.y = cross; holder.add(card); F.add(holder);
    }
  }
  // 花序
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const cl = cylRaw(0.03, 0.05, h * 0.12, M.paint(0xd8c898, 0.85), 6, Math.cos(a) * tR * 1.3, crownY - h * 0.05, Math.sin(a) * tR * 1.3);
    cl.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5); g.add(cl);
  }
  shade(g); return g;
}

function buildQuakingAspen(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0xe4dccb, 0.82);
  const darkBark = M.paint(0x4a4438, 0.9);
  const leafMat = vegMat(p.leafColor, 'leaf');
  const coreMat = M.paint(darker(p.leafColor, 0.35), 0.9);
  // 主干 + 2 根伴生细干（颤杨常成簇）
  trunkBranches(g, { h, r0: 0.13, r1: 0.075, bark, seg: 8, nBranch: 5, bLen: h * 0.22, bR: 0.04, y0: h * 0.46, y1: h * 0.74, pitch: 0.62, seed: 41, flare: false, tipMax: h * 0.95 });
  for (let i = 0; i < 4; i++) g.add(box(0.05, 0.02, 0.03, darkBark, Math.cos(i * 2.2) * 0.1, h * (0.2 + i * 0.14), Math.sin(i * 2.2) * 0.1));
  for (const [ox, oz, sc] of [[0.42, -0.3, 0.78], [-0.38, 0.26, 0.62]]) {
    const sh = h * sc;
    g.add(cylRaw(0.055 * sc + 0.02, 0.085 * sc + 0.03, sh * 0.9, bark, 8, ox, sh * 0.45, oz));
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + ox;
      const br = cylRaw(0.018, 0.03, sh * 0.24, bark, 6, ox + Math.cos(a) * sh * 0.08, sh * (0.6 + i * 0.1), oz + Math.sin(a) * sh * 0.08);
      br.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); g.add(br);
    }
    canopyCards(g, { cx: ox, cy: sh * 0.82, cz: oz, rx: sh * 0.2, ry: sh * 0.22, rz: sh * 0.2, n: 14, mat: leafMat, size: sh * 0.16, seed: 57, sub: 2 });
  }
  const cy = h * 0.74, cr = h * 0.17;
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(cr * (i === 0 ? 0.55 : 0.4), 1), coreMat);
    c.position.set(0, cy + i * cr * 0.4, 0); c.scale.y = 0.85; g.add(c);
  }
  canopyCards(g, { cy, rx: h * 0.24, ry: h * 0.24, rz: h * 0.24, n: 42, mat: leafMat, size: h * 0.15, seed: 63, sub: 3 });
  shade(g); return g;
}

function buildJoshuaTree(p) {
  const g = new THREE.Group();
  const h = p.height;
  const bark = M.paint(0x6b5a40, 0.94);
  const darkBark = M.paint(0x4a3d2a, 0.95);
  const leafMat = vegMat(0x5a7a3a, 'blade');
  const flowerMat = M.paint(0xf0ead6, 0.85);
  const tips = trunkBranches(g, {
    h, r0: 0.19, r1: 0.12, bark, seg: 10, nBranch: 6, bLen: h * 0.3, bR: 0.07,
    y0: h * 0.34, y1: h * 0.62, pitch: 0.42, seed: 71,
  });
  for (let i = 0; i < 6; i++) g.add(box(0.07, 0.03, 0.05, darkBark, Math.cos(i * 1.9) * 0.14, h * (0.1 + i * 0.07), Math.sin(i * 1.9) * 0.14));
  // 枝端丛生针叶：每端 4 张交叉 Alpha 面片 + 花序
  const rng = makeRng(83);
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    for (let k = 0; k < 4; k++) {
      const card = new THREE.Mesh(cardGeo(3), leafMat);
      const s = h * (0.15 + rng() * 0.07);
      card.scale.set(s * 0.5, s, 1);
      card.position.set(t.x + (rng() - 0.5) * s * 0.4, t.y + (rng() - 0.3) * s * 0.4, t.z + (rng() - 0.5) * s * 0.4);
      card.rotation.set((rng() - 0.5) * 0.8, rng() * Math.PI, (rng() - 0.5) * 0.8);
      g.add(card);
    }
    if (i % 3 === 0) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(h * 0.035, h * 0.09, 6), flowerMat);
      fl.position.set(t.x, t.y + h * 0.06, t.z); g.add(fl);
    }
  }
  shade(g); return g;
}

// ===========================================================================
// 注册表
// ===========================================================================
const LIB_AM = [
  {
    cat: '住宅风格', id: 'house', items: [
      { type: 'cape_cod', name: 'Cape Cod 鳕鱼角式', icon: 'house', build: buildCapeCod, params: [PR('width', '宽 m', 6, 14, 0.5, 9), PR('depth', '深 m', 5, 12, 0.5, 7), PC('wallColor', '墙色', '#e8e0d4'), PC('roofColor', '屋顶色', '#5a4a3a')] },
      { type: 'brownstone', name: 'Brownstone 褐石联排', icon: 'building', build: buildBrownstone, params: [PR('width', '宽 m', 5, 10, 0.5, 7), PR('depth', '深 m', 8, 16, 0.5, 12), PI('floors', '层数', 2, 5, 1, 4), PC('brickColor', '砖色', '#8b4513')] },
      { type: 'craftsman', name: 'Craftsman 工匠式平房', icon: 'house', build: buildCraftsman, params: [PR('width', '宽 m', 7, 14, 0.5, 10), PR('depth', '深 m', 6, 12, 0.5, 8), PC('woodColor', '木色', '#8b6914'), PC('roofColor', '屋顶色', '#5a4a3a')] },
      { type: 'southern_colonial', name: 'Southern Colonial 南方殖民式', icon: 'building', build: buildSouthernColonial, params: [PR('width', '宽 m', 10, 20, 0.5, 14), PR('depth', '深 m', 8, 16, 0.5, 10), PI('floors', '层数', 2, 3, 1, 2), PC('wallColor', '墙色', '#f0ece4'), PC('roofColor', '屋顶色', '#5a4a3a')] },
      { type: 'adobe', name: 'Adobe 土坯平顶房', icon: 'house', build: buildAdobe, params: [PR('width', '宽 m', 8, 16, 0.5, 11), PR('depth', '深 m', 7, 14, 0.5, 9), PC('wallColor', '墙色', '#d4a574')] },
      { type: 'spanish_colonial', name: 'Spanish Colonial 西班牙殖民式', icon: 'building', build: buildSpanishColonial, params: [PR('width', '宽 m', 9, 18, 0.5, 12), PR('depth', '深 m', 7, 14, 0.5, 9), PC('wallColor', '墙色', '#f5f0e8'), PC('roofColor', '屋顶色', '#c45a3a')] },
    ],
  },
  {
    cat: '郊区建筑', id: 'suburban', items: [
      { type: 'colonial_church', name: 'Colonial Church 殖民式教堂', icon: 'building', build: buildColonialChurch, params: [PR('width', '宽 m', 8, 16, 0.5, 11), PR('depth', '深 m', 10, 20, 0.5, 14), PC('wallColor', '墙色', '#f0ece4'), PC('roofColor', '屋顶色', '#5a4a3a')] },
      { type: 'googie_diner', name: 'Googie Diner 古奇风格餐馆', icon: 'building', build: buildGoogieDiner, params: [PR('width', '宽 m', 8, 16, 0.5, 11), PR('depth', '深 m', 6, 12, 0.5, 8), PC('wallColor', '墙色', '#e8e0d4'), PC('roofColor', '屋顶色', '#cc3333')] },
      { type: 'craftsman_cafe', name: 'Craftsman Cafe 工匠式咖啡馆', icon: 'building', build: buildCraftsmanCafe, params: [PR('width', '宽 m', 7, 14, 0.5, 10), PR('depth', '深 m', 6, 12, 0.5, 8), PC('woodColor', '木色', '#8b6914'), PC('roofColor', '屋顶色', '#5a4a3a'), PC('signColor', '招牌色', '#cc3333')] },
      { type: 'adobe_strip_mall', name: 'Adobe Strip Mall 土坯式商场', icon: 'building', build: buildAdobeStripMall, params: [PR('width', '宽 m', 12, 24, 0.5, 18), PR('depth', '深 m', 8, 16, 0.5, 10), PC('wallColor', '墙色', '#d4a574')] },
      { type: 'spanish_library', name: 'Spanish Library 西班牙式图书馆', icon: 'building', build: buildSpanishLibrary, params: [PR('width', '宽 m', 10, 20, 0.5, 14), PR('depth', '深 m', 8, 16, 0.5, 10), PC('wallColor', '墙色', '#f5f0e8'), PC('roofColor', '屋顶色', '#c45a3a')] },
      { type: 'columns_bank', name: 'Columns Bank 柱廊银行', icon: 'building', build: buildColumnsBank, params: [PR('width', '宽 m', 10, 20, 0.5, 14), PR('depth', '深 m', 8, 16, 0.5, 10), PC('stoneColor', '石材色', '#e8e0d4')] },
    ],
  },
  {
    cat: '功能建筑', id: 'functional', items: [
      { type: 'school', name: 'School 学校', icon: 'building', build: buildSchool, params: [PR('width', '宽 m', 12, 24, 0.5, 18), PR('depth', '深 m', 8, 16, 0.5, 10), PI('floors', '层数', 1, 3, 1, 2), PC('brickColor', '砖色', '#8b4513'), PC('roofColor', '屋顶色', '#5a4a3a')] },
      { type: 'fire_station', name: 'Fire Station 消防局', icon: 'building', build: buildFireStation, params: [PR('width', '宽 m', 10, 20, 0.5, 14), PR('depth', '深 m', 8, 16, 0.5, 10), PC('wallColor', '墙色', '#f5f0e8'), PC('trimColor', '装饰色', '#cc3333')] },
      { type: 'gas_station', name: 'Gas Station 加油站', icon: 'building', build: buildGasStation, params: [PR('width', '宽 m', 12, 24, 0.5, 18), PR('depth', '深 m', 10, 20, 0.5, 14), PC('wallColor', '墙色', '#e8e0d4'), PC('canopyColor', '雨棚色', '#cc3333')] },
      { type: 'water_tower', name: 'Water Tower 水塔', icon: 'building', build: buildWaterTower, params: [PR('tankRadius', '水箱半径 m', 1.5, 4, 0.25, 2.5), PR('tankHeight', '水箱高 m', 2, 5, 0.25, 3), PR('legHeight', '支架高 m', 4, 10, 0.5, 6), PC('tankColor', '水箱色', '#8899aa')] },
      { type: 'post_office', name: 'Post Office 邮局', icon: 'building', build: buildPostOffice, params: [PR('width', '宽 m', 10, 20, 0.5, 14), PR('depth', '深 m', 8, 16, 0.5, 10), PC('brickColor', '砖色', '#8b4513')] },
      { type: 'drive_in', name: 'Drive-In 汽车影院', icon: 'building', build: buildDriveIn, params: [PR('width', '宽 m', 15, 30, 1, 22), PR('depth', '深 m', 20, 40, 1, 30), PR('screenHeight', '屏幕高 m', 5, 12, 0.5, 8), PC('boothColor', '售票亭色', '#cc3333')] },
    ],
  },
  {
    cat: '车库工具', id: 'garage', items: [
      { type: 'workbench', name: 'Workbench 工作台', icon: 'props', build: buildWorkbench, params: [PR('width', '宽 m', 1.2, 2.4, 0.1, 1.8), PR('depth', '深 m', 0.6, 1.2, 0.1, 0.8), PR('height', '高 m', 0.8, 1.0, 0.05, 0.9), PC('woodColor', '木色', '#8b6914')] },
      { type: 'pegboard', name: 'Pegboard 洞洞板', icon: 'props', build: buildPegboard, params: [PR('width', '宽 m', 0.8, 2.0, 0.1, 1.2), PR('height', '高 m', 0.8, 1.6, 0.1, 1.2), PC('boardColor', '板色', '#c4a882')] },
      { type: 'stepladder', name: 'Stepladder 人字梯', icon: 'props', build: buildStepladder, params: [PR('height', '高 m', 1.2, 2.4, 0.1, 1.8), PR('width', '底宽 m', 0.5, 1.0, 0.05, 0.7), PI('steps', '步数', 3, 6, 1, 4), PC('metalColor', '金属色', '#ff6600')] },
      { type: 'tool_chest', name: 'Tool Chest 工具柜', icon: 'props', build: buildToolChest, params: [PR('width', '宽 m', 0.6, 1.2, 0.1, 0.9), PR('depth', '深 m', 0.4, 0.8, 0.1, 0.5), PR('height', '高 m', 0.8, 1.4, 0.1, 1.0), PC('metalColor', '金属色', '#cc3333')] },
      { type: 'storage_shelf', name: 'Storage Shelf 货架', icon: 'props', build: buildStorageShelf, params: [PR('width', '宽 m', 0.8, 2.0, 0.1, 1.2), PR('depth', '深 m', 0.4, 0.8, 0.1, 0.5), PR('height', '高 m', 1.2, 2.4, 0.1, 1.8), PI('shelves', '层数', 2, 5, 1, 3), PC('metalColor', '金属色', '#888888')] },
      { type: 'bench_vise', name: 'Bench Vise 台钳', icon: 'props', build: buildBenchVise, params: [PC('metalColor', '金属色', '#556677')] },
    ],
  },
  {
    cat: '家具', id: 'furniture', items: [
      { type: 'clapboard_wall', name: 'Clapboard Wall 木板墙段', icon: 'props', build: buildClapboardWall, params: [PR('width', '宽 m', 1.5, 4.0, 0.1, 2.5), PR('height', '高 m', 1.5, 3.5, 0.1, 2.5), PC('woodColor', '木色', '#e8e0d4')] },
      { type: 'staircase', name: 'Staircase 楼梯', icon: 'props', build: buildStaircase, params: [PI('steps', '级数', 6, 16, 1, 12), PR('stepWidth', '宽 m', 0.8, 1.4, 0.05, 1.0), PR('rise', '踏步高 m', 0.15, 0.22, 0.01, 0.18), PR('run', '踏步深 m', 0.25, 0.35, 0.01, 0.28), PC('woodColor', '木色', '#8b6914')] },
      { type: 'front_door', name: 'Front Door 前门', icon: 'props', build: buildFrontDoor, params: [PR('width', '宽 m', 0.8, 1.2, 0.05, 0.9), PR('height', '高 m', 1.8, 2.4, 0.05, 2.1), PC('doorColor', '门色', '#5a3a20')] },
      { type: 'sash_window', name: 'Sash Window 推拉窗', icon: 'props', build: buildSashWindow, params: [PR('width', '宽 m', 0.8, 1.6, 0.05, 1.0), PR('height', '高 m', 1.0, 1.8, 0.05, 1.3), PC('frameColor', '框色', '#e8e0d4')] },
      { type: 'dining_set', name: 'Dining Set 餐桌椅', icon: 'props', build: buildDiningSet, params: [PR('tableRadius', '桌半径 m', 0.5, 1.0, 0.05, 0.7), PR('tableHeight', '桌高 m', 0.7, 0.8, 0.02, 0.75), PC('woodColor', '木色', '#8b6914')] },
      { type: 'four_poster_bed', name: 'Four-Poster Bed 四柱床', icon: 'props', build: buildFourPosterBed, params: [PR('width', '宽 m', 1.4, 2.0, 0.1, 1.6), PR('length', '长 m', 1.8, 2.4, 0.1, 2.0), PR('postHeight', '柱高 m', 1.8, 2.6, 0.1, 2.2), PC('woodColor', '木色', '#5a3a20'), PC('mattressColor', '床垫色', '#f0ece4')] },
      { type: 'sofa', name: 'Sofa 沙发', icon: 'props', build: buildSofa, params: [PR('width', '宽 m', 1.6, 2.6, 0.1, 2.0), PR('depth', '深 m', 0.8, 1.2, 0.05, 0.9), PR('seatHeight', '座高 m', 0.35, 0.5, 0.02, 0.42), PC('fabricColor', '布色', '#4a6a5a')] },
      { type: 'rocking_chair', name: 'Rocking Chair 摇椅', icon: 'props', build: buildRockingChair, params: [PR('width', '宽 m', 0.6, 0.9, 0.05, 0.7), PR('depth', '深 m', 0.7, 1.1, 0.05, 0.9), PR('height', '高 m', 0.9, 1.3, 0.05, 1.1), PC('woodColor', '木色', '#5a3a20')] },
      { type: 'roll_top_desk', name: 'Roll-Top Desk 卷帘书桌', icon: 'props', build: buildRollTopDesk, params: [PR('width', '宽 m', 1.0, 1.6, 0.1, 1.2), PR('depth', '深 m', 0.6, 1.0, 0.05, 0.7), PR('height', '高 m', 1.0, 1.4, 0.05, 1.2), PC('woodColor', '木色', '#5a3a20')] },
      { type: 'bookcase', name: 'Bookcase 书柜', icon: 'props', build: buildBookcase, params: [PR('width', '宽 m', 0.8, 1.6, 0.1, 1.0), PR('depth', '深 m', 0.3, 0.5, 0.05, 0.35), PR('height', '高 m', 1.4, 2.2, 0.1, 1.8), PC('woodColor', '木色', '#8b6914')] },
    ],
  },
  {
    cat: '道路', id: 'road', items: [
      { type: 'two_way_road', name: 'Two-Way Road 双向道路', icon: 'road', build: buildTwoWayRoad, params: [PR('width', '宽 m', 9, 16, 0.5, 12), PR('length', '长 m', 10, 60, 1, 24)] },
      { type: 'one_way_road', name: 'One-Way Road 单向道路', icon: 'road', build: buildOneWayRoad, params: [PR('width', '宽 m', 10, 18, 0.5, 14), PR('length', '长 m', 10, 60, 1, 24)] },
      { type: 'concrete_road', name: 'Concrete Road 混凝土路', icon: 'road', build: buildConcreteRoad, params: [PR('width', '宽 m', 9, 16, 0.5, 12), PR('length', '长 m', 10, 60, 1, 24)] },
      { type: 'garden_path', name: 'Garden Path 庭院小径', icon: 'road', build: buildGardenPath, params: [PR('width', '宽 m', 1.0, 3.0, 0.1, 1.5), PR('length', '长 m', 3, 20, 0.5, 8), PC('brickColor', '砖色', '#c45a3a')] },
      { type: 'gravel_road', name: 'Gravel Road 碎石路', icon: 'road', build: buildGravelRoad, params: [PR('width', '宽 m', 4, 9, 0.5, 6.5), PR('length', '长 m', 10, 60, 1, 24)] },
      { type: 'four_way_stop', name: 'Four-Way Stop 十字路口', icon: 'road', build: buildFourWayStop, params: [PR('width', '宽 m', 20, 30, 0.5, 22), PR('length', '长 m', 20, 30, 0.5, 22)] },
      { type: 't_junction', name: 'T-Junction T 形路口', icon: 'road', build: buildTJunction, params: [PR('width', '宽 m', 20, 34, 0.5, 24), PR('length', '长 m', 18, 30, 0.5, 22)] },
      { type: 'roundabout', name: 'Roundabout 环形路口', icon: 'road', build: buildRoundabout, params: [PR('width', '宽 m', 18, 30, 0.5, 22), PR('length', '长 m', 18, 30, 0.5, 22)] },
      { type: 'cul_de_sac', name: 'Cul-de-Sac 尽端路', icon: 'road', build: buildCulDeSac, params: [PR('width', '宽 m', 18, 34, 0.5, 26), PR('length', '长 m', 24, 60, 1, 36)] },
      { type: 'freeway', name: 'Freeway 高速公路', icon: 'road', build: buildFreeway, params: [PR('width', '宽 m', 20, 34, 0.5, 26), PR('length', '长 m', 30, 120, 5, 60)] },
    ],
  },
  {
    cat: '交通设施', id: 'traffic', items: [
      { type: 'traffic_light', name: 'Traffic Light 行车信号灯', icon: 'props', build: buildTrafficLight, params: [PR('poleHeight', '杆高 m', 3, 6, 0.25, 4.5)] },
      { type: 'ped_signal', name: 'Ped Signal 行人信号灯', icon: 'props', build: buildPedSignal, params: [PR('poleHeight', '杆高 m', 2, 4, 0.25, 2.8)] },
      { type: 'street_lamp', name: 'Street Lamp 路灯', icon: 'props', build: buildStreetLamp, params: [PR('poleHeight', '杆高 m', 4, 8, 0.25, 6)] },
      { type: 'water_barrier', name: 'Water Barrier 水马', icon: 'props', build: buildWaterBarrier, params: [PR('width', '宽 m', 1.5, 3.5, 0.1, 2.0), PR('height', '高 m', 0.8, 1.2, 0.05, 0.95), PC('color', '颜色', '#ff6600')] },
      { type: 'traffic_cone', name: 'Traffic Cone 交通锥', icon: 'props', build: buildTrafficCone, params: [PR('height', '高 m', 0.5, 1.0, 0.05, 0.7), PC('color', '颜色', '#ff6600')] },
      { type: 'traffic_drum', name: 'Traffic Drum 施工桶', icon: 'props', build: buildTrafficDrum, params: [PR('radius', '半径 m', 0.25, 0.5, 0.05, 0.35), PR('height', '高 m', 0.8, 1.2, 0.05, 1.0), PC('color', '颜色', '#ff6600')] },
      { type: 'jersey_barrier', name: 'Jersey Barrier 泽西护栏', icon: 'props', build: buildJerseyBarrier, params: [PR('width', '宽 m', 2, 6, 0.5, 3.0), PR('height', '高 m', 0.7, 1.1, 0.05, 0.85)] },
      { type: 'delineator', name: 'Delineator 轮廓标', icon: 'props', build: buildDelineator, params: [PR('height', '高 m', 0.8, 1.4, 0.05, 1.0)] },
      { type: 'bollard', name: 'Bollard 防撞柱', icon: 'props', build: buildBollard, params: [PR('height', '高 m', 0.6, 1.2, 0.05, 0.9), PC('metalColor', '金属色', '#222222')] },
      { type: 'portable_sign', name: 'Portable Sign 临时标志', icon: 'props', build: buildPortableSign, params: [PR('width', '宽 m', 0.6, 1.2, 0.05, 0.8), PR('height', '高 m', 1.0, 1.8, 0.05, 1.3), PC('signColor', '标志色', '#ffcc00')] },
    ],
  },
  {
    cat: '植被', id: 'vegetation', items: [
      { type: 'sugar_maple', name: 'Sugar Maple 糖枫', icon: 'tree', build: buildSugarMaple, params: [PR('height', '高 m', 5, 12, 0.5, 8), PC('leafColor', '叶色', '#cc4422')] },
      { type: 'live_oak', name: 'Live Oak 活橡', icon: 'tree', build: buildLiveOak, params: [PR('height', '高 m', 6, 15, 0.5, 10), PC('leafColor', '叶色', '#4a7a3a')] },
      { type: 'saguaro', name: 'Saguaro 巨人柱', icon: 'tree', build: buildSaguaro, params: [PR('height', '高 m', 4, 10, 0.5, 7), PC('color', '颜色', '#5a7a4a')] },
      { type: 'coast_redwood', name: 'Coast Redwood 海岸红木', icon: 'tree', build: buildCoastRedwood, params: [PR('height', '高 m', 10, 25, 1, 16), PC('foliageColor', '叶色', '#3a6a2a')] },
      { type: 'douglas_fir', name: 'Douglas Fir 花旗松', icon: 'tree', build: buildDouglasFir, params: [PR('height', '高 m', 8, 20, 0.5, 13), PC('needleColor', '针叶色', '#3a6a3a')] },
      { type: 'big_bluestem', name: 'Big Bluestem 大须芒草', icon: 'tree', build: buildBigBluestem, params: [PR('height', '高 m', 0.8, 1.8, 0.1, 1.2), PC('color', '颜色', '#8b7a3a')] },
      { type: 'bluebonnet', name: 'Bluebonnet 德州羽扇豆', icon: 'tree', build: buildBluebonnet, params: [PR('height', '高 m', 0.3, 0.8, 0.05, 0.5), PC('flowerColor', '花色', '#4466cc')] },
      { type: 'sabal_palm', name: 'Sabal Palm 萨巴尔棕榈', icon: 'tree', build: buildSabalPalm, params: [PR('height', '高 m', 4, 10, 0.5, 7), PC('frondColor', '叶色', '#4a7a3a')] },
      { type: 'quaking_aspen', name: 'Quaking Aspen 颤杨', icon: 'tree', build: buildQuakingAspen, params: [PR('height', '高 m', 5, 12, 0.5, 8), PC('leafColor', '叶色', '#ccaa33')] },
      { type: 'joshua_tree', name: 'Joshua Tree 约书亚树', icon: 'tree', build: buildJoshuaTree, params: [PR('height', '高 m', 3, 8, 0.5, 5)] },
    ],
  },
];

// 素材库 = 美式 64 款 + 建筑构件 / 中式古建 / 美式经典 / 室内 / 自然 / 战争 / 星际 / 玄幻特效
export const LIB = [...LIB_AM, ...GROUPS_CITY, ...GROUPS_BLD, ...GROUPS_ARCH, ...GROUPS_NATURE, ...GROUPS_PROPS];

export const LIB_INDEX = new Map();
for (const grp of LIB) for (const it of grp.items) LIB_INDEX.set(`${grp.id}:${it.type}:${it.name}`, { ...it, cat: grp.cat, catId: grp.id });

export function defaultsFor(item) {
  const o = {};
  for (const p of item.params || []) o[p.k] = p.def;
  return o;
}

export function buildAsset(item, params) {
  geoCacheBegin();
  let root;
  try { root = item.build(params); } finally { geoCacheEnd(); }
  root.userData.assetType = item.type;
  applyDetail(root);
  return root;
}
