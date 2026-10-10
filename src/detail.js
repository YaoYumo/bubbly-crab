// ---------------------------------------------------------------------------
// 模型精度 / 外观完整度的总开关
//   · 三档精度（lite / std / fine）统一控制圆柱·球·锥的段数、屋顶 loft 密度、贴面细分
//   · 程序化材质贴图：墙面抹灰、混凝土骨料、砖、石砌、木纹、瓦垄、金属拉丝、玻璃污渍、
//     沥青、布料…… 全部在 canvas 上现算（256~512²），同一材质种类共用一张 GPU 纹理，
//     平铺密度靠「把尺寸写进 UV」实现 —— 不复制纹理，因此显存只有几十 KB 级别
//   · applyDetail(root)：buildAsset 之后统一挂贴图 / 法线 / 粗糙度 / 环境反射强度
// 约定：任何 M.* 材质工厂都会打一个 userData.detail = 种类，这里据此选择贴图；
//       已经自带 map 的材质（如资产库里画好的立面贴图）不再覆盖。
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const LEVELS = {
  lite: { k: 0.62, tex: false, texPx: 0, chamfer: 0, segCap: 20, planeCap: 6, name: '省内存' },
  std: { k: 1.5, tex: true, texPx: 256, chamfer: 1, segCap: 48, planeCap: 16, name: '均衡' },
  fine: { k: 1.85, tex: true, texPx: 512, chamfer: 1.8, segCap: 72, planeCap: 24, name: '高细节' },
};
let level = 'std';
let L = LEVELS[level];
let texForce = null;                 // null=跟随档位；false=强制关闭（内存优先模式）
export const setTexForce = (v) => { texForce = v === null || v === undefined ? null : !!v; };
export const texOn = () => (texForce === null ? L.tex : texForce);

export const detailLevel = () => level;
/** 实时视图：只读当前档位的几个开关（geo/character 里直接判断用，避免到处传参） */
export const Q = {
  get level() { return level; },
  get k() { return L.k; },
  get tex() { return texOn(); },
  get chamfer() { return L.chamfer; },
  get segCap() { return L.segCap; },
  get planeCap() { return L.planeCap; },
};
export const detailCfg = () => L;
export function setDetailLevel(l) {
  const nl = LEVELS[l] ? l : 'std';
  const changed = nl !== level;
  level = nl; L = LEVELS[level];
  return changed;
}
/** 段数缩放：小于 8 段是「故意做的棱角」（四棱锥攒尖、方柱…）不动它，只加密真正想画圆的地方 */
export const seg = (n, min = 6, max = 96) => (n < 8 ? n : Math.max(min, Math.min(max || L.segCap, Math.round(n * L.k), L.segCap)));
export const mul = (v, a = 1, b = 1e9) => Math.max(a, Math.min(b, v * L.k));
export const chamfer = () => L.chamfer;
export const planeSegCap = () => L.planeCap;

/* ============================ 材质种类表 ================================= */
// tile = 一张贴图覆盖多少米；env = 环境反射强度；nrm = 法线强度；rough = 粗糙度贴图强度
const KIND = {
  plaster: { tile: 1.5, env: 0.22, nrm: 0.55, rough: 0.35, hi: 0.9 },
  paint: { tile: 2.2, env: 0.42, nrm: 0.22, rough: 0.25, hi: 0.62 },
  concrete: { tile: 1.7, env: 0.26, nrm: 0.75, rough: 0.5, hi: 0.94 },
  brick: { tile: 0.62, env: 0.2, nrm: 1.0, rough: 0.6, hi: 0.95 },
  stone: { tile: 0.85, env: 0.24, nrm: 1.05, rough: 0.55, hi: 0.96 },
  wood: { tile: 0.5, env: 0.34, nrm: 0.5, rough: 0.42, hi: 0.7 },
  tile: { tile: 0.42, env: 0.4, nrm: 1.1, rough: 0.45, hi: 0.7 },
  metal: { tile: 0.7, env: 1.05, nrm: 0.3, rough: 0.3, hi: 0.4 },
  glass: { tile: 1.2, env: 1.25, nrm: 0.12, rough: 0.12, hi: 0.16 },
  asphalt: { tile: 0.9, env: 0.3, nrm: 1.15, rough: 0.6, hi: 0.95 },
  fabric: { tile: 0.32, env: 0.16, nrm: 0.5, rough: 0.4, hi: 0.92 },
  leaf: { tile: 0.6, env: 0.3, nrm: 0.8, rough: 0.5, hi: 0.8 },
  dirt: { tile: 1.4, env: 0.14, nrm: 1.1, rough: 0.6, hi: 1 },
  skin: { tile: 0.06, env: 0.2, nrm: 0.2, rough: 0.3, hi: 0.55 },
  leather: { tile: 0.2, env: 0.28, nrm: 0.5, rough: 0.42, hi: 0.72 },
};

/* ======================= 程序化贴图（canvas → 纹理）====================== */
const cache = new Map();
let aniso = 4;
export const setAnisotropy = (a) => { aniso = Math.max(1, Math.min(16, a | 0) || 1); };
export const getAnisotropy = () => aniso;
export const textureStats = () => {
  let px = 0, n = 0;
  for (const v of cache.values()) {
    if (v) for (const t of [v.map, v.normalMap, v.roughnessMap]) {
      if (!t) continue; n += 1;
      px += (t.image?.width || 0) * (t.image?.height || 0);
    }
  }
  return { kinds: cache.size, textures: n, texels: px, bytes: px * 4 };
};
export function clearTextureCache() { for (const t of cache.values()) t.dispose?.(); cache.clear(); }
/** 丢掉非当前档位的贴图（切档后释放旧显存），返回释放的 texel 数 */
export function pruneTextureCache() {
  let freed = 0;
  for (const [k, v] of [...cache]) {
    if (k.endsWith('@' + level)) continue;
    if (v) for (const t of [v.map, v.normalMap, v.roughnessMap]) { freed += (t?.image?.width || 0) * (t?.image?.height || 0); t?.dispose?.(); }
    cache.delete(k);
  }
  return freed;
}

const mkTex = (cv, srgb) => {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
/** 简单可复现噪声 */
function hash2(x, y, s) { let h = x * 374761393 + y * 668265263 + s * 1442695040888963407; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
function vnoise(g, n, s, oct = 3) {   // 写入灰度 0..255 的高度场
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let a = 0, amp = 1, f = 1, tot = 0;
      for (let o = 0; o < oct; o++) {
        const fx = (x / n) * f * 6, fy = (y / n) * f * 6;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const r00 = hash2(ix & 255, iy & 255, s + o * 31), r10 = hash2((ix + 1) & 255, iy & 255, s + o * 31);
        const r01 = hash2(ix & 255, (iy + 1) & 255, s + o * 31), r11 = hash2((ix + 1) & 255, (iy + 1) & 255, s + o * 31);
        a += amp * (r00 * (1 - sx) * (1 - sy) + r10 * sx * (1 - sy) + r01 * (1 - sx) * sy + r11 * sx * sy);
        tot += amp; amp *= 0.52; f *= 2.07;
      }
      g[x + y * n] = a / tot;
    }
  }
}
/** 由高度场生成切线空间法线贴图（Sobel） */
function normalCv(h, n, strength) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const cx = cv.getContext('2d'); const im = cx.createImageData(n, n);
  const at = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(-dx, -dy, 1) || 1;
    const i = (y * n + x) * 4;
    im.data[i] = ((-dx / l) * 0.5 + 0.5) * 255; im.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    im.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  return cv;
}
/**
 * 高度场：每种材质的「起伏」都用纯数学算出来（不依赖 canvas 绘制顺序，方便同时生成法线 / 粗糙度）
 * 返回 0..1，1 = 凸起，0 = 凹陷
 */
const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function heightField(kind, n) {
  const h = new Float32Array(n * n);
  vnoise(h, n, kind.length * 733 + 11, kind === 'asphalt' || kind === 'concrete' ? 5 : 4);
  if (kind === 'brick' || kind === 'stone') {
    const rows = kind === 'brick' ? 8 : 6, cols = kind === 'brick' ? 4 : 3;
    const rh = n / rows, cw = n / cols, mortar = kind === 'brick' ? 0.055 : 0.075;
    for (let y = 0; y < n; y++) {
      const r = Math.min(rows - 1, Math.floor(y / rh));
      const fy = Math.min((y - r * rh) / rh, 1 - (y - r * rh) / rh);
      const off = (r % 2) * cw * (kind === 'brick' ? 0.5 : 0.37);
      for (let x = 0; x < n; x++) {
        const xx = ((x + off) % n + n) % n;
        const c = Math.floor(xx / cw), fx0 = xx - c * cw;
        const fx = Math.min(fx0 / cw, 1 - fx0 / cw);
        const edge = Math.min(fx, fy) / mortar;
        const jitter = hash2(c, r, 7) * 0.42 - 0.12;
        const body = 0.62 + jitter + (h[x + y * n] - 0.5) * 0.34;
        h[x + y * n] = body * ss(0, 1, edge) + 0.06 * (1 - ss(0, 1, edge));
      }
    }
  } else if (kind === 'tile') {                       // 一垄垄的瓦 + 出檐的层间阴影
    const cols = 12, cw = n / cols;
    // 轴向约定：屋顶 UV 的 v（=y）沿坡向下 → 瓦垄沿 y 起伏；层间滴水的阴影沿 x（=u，平行屋脊）
    for (let y = 0; y < n; y++) {
      const u = (y % cw) / cw;
      const dome = Math.sin(u * Math.PI);
      for (let x = 0; x < n; x++) {
        const course = (x % cw) / cw;
        const drop = 1 - ss(0.86, 1, course);
        h[x + y * n] = 0.16 + 0.7 * dome * (0.55 + 0.45 * drop) + (h[x + y * n] - 0.5) * 0.18;
      }
    }
  } else if (kind === 'wood') {                        // 顺纹年轮 + 结疤
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const rings = Math.sin((x / n) * Math.PI * 11 + (h[x + y * n] - 0.5) * 4.2) * 0.5 + 0.5;
      let k = 0.3 + 0.6 * rings + (h[x + y * n] - 0.5) * 0.22;
      for (let s = 0; s < 3; s++) {
        const kx = hash2(s, 5, 13) * n, ky = hash2(s, 9, 17) * n;
        const d = Math.hypot((x - kx) / (n * 0.035), (y - ky) / (n * 0.055));
        if (d < 1.6) k = Math.min(k, 0.18 + d * 0.24);
      }
      h[x + y * n] = k;
    }
  } else if (kind === 'asphalt' || kind === 'dirt') { // 骨料颗粒 + 不规则裂
    const cracks = new Float32Array(n).fill(1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const sp = hash2(x, y, 3);
      let v = 0.42 + 0.5 * h[x + y * n] + (sp > 0.982 ? 0.3 : 0) - (sp < 0.02 ? 0.3 : 0);
      h[x + y * n] = Math.max(0, Math.min(1, v));
    }
    for (let c = 0; c < 6; c++) {                      // 裂纹：沿路径压低
      let x = hash2(c, 1, 23) * n, y = hash2(c, 2, 29) * n;
      for (let s = 0; s < n * 0.5; s++) {
        const xi = Math.round(x) % n, yi = Math.round(y) % n;
        if (xi >= 0 && yi >= 0) h[yi * n + xi] *= 0.3;
        x += (hash2(c, s, 31) - 0.48) * 2.4; y += (hash2(c, s, 37) - 0.4) * 1.7;
        if (x < 0) x += n; if (y < 0) y += n;
      }
    }
    void cracks;
  } else if (kind === 'metal') {                      // 拉丝（沿 u）+ 氧化斑
    for (let y = 0; y < n; y++) {
      const b = (hash2(0, y, 41) - 0.5) * 0.34;
      for (let x = 0; x < n; x++) {
        const fine = (hash2(x >> 1, y, 43) - 0.5) * 0.16;
        h[x + y * n] = Math.max(0, Math.min(1, 0.5 + b + fine + (h[x + y * n] - 0.5) * 0.3));
      }
    }
  } else if (kind === 'skin' || kind === 'leather') { // 毛孔/皮革纹：细密各向同性颗粒
    const amp = kind === 'skin' ? 1 : 0.7;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p1 = hash2(x * 3, y * 3, 61), p2 = hash2(x, y * 2 + 1, 67);
      let v = 0.5 + (p1 - 0.5) * 0.5 * amp + (p2 - 0.5) * 0.22 * amp + (h[x + y * n] - 0.5) * 0.5;
      if (kind === 'leather') v += Math.sin(x / n * 24 + p2 * 3) * 0.05;
      h[x + y * n] = Math.max(0, Math.min(1, v));
    }
  } else if (kind === 'glass') {                      // 竖向雨痕 + 边角指纹
    for (let x = 0; x < n; x++) {
      const w1 = hash2(x, 0, 51), amp = w1 > 0.72 ? (w1 - 0.72) * 2.2 : 0;
      for (let y = 0; y < n; y++) {
        const streak = amp * (0.5 + 0.5 * Math.sin(y / n * 14 + w1 * 20));
        h[x + y * n] = Math.max(0, Math.min(1, 0.12 + streak * 0.5 + (h[x + y * n] - 0.5) * 0.08));
      }
    }
  } else if (kind === 'fabric') {                      // 斜纹组织
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const tw = (((x + y) % 4) < 2 ? 1 : 0) * 0.55 + (((x - y + n * 2) % 8) < 4 ? 0.45 : 0);
      h[x + y * n] = 0.28 + 0.6 * tw + (h[x + y * n] - 0.5) * 0.18;
    }
  } else if (kind === 'leaf') {                       // 叶簇斑驳
    for (let i = 0; i < n * n; i++) h[i] = 0.25 + 0.75 * h[i];
  } else if (kind === 'concrete') {                   // 骨料麻点 + 蜂窝孔 + 水渍
    for (let i = 0; i < n * n; i++) {
      const sp = hash2(i % n, (i / n) | 0, 53);
      h[i] = 0.52 + (h[i] - 0.5) * 0.5 + (sp > 0.99 ? -0.42 : 0) + (sp < 0.012 ? 0.26 : 0);
    }
    for (let b = 0; b < 5; b++) {                     // 修补块 / 水渍
      const cx0 = hash2(b, 7, 61) * n, cy0 = hash2(b, 11, 67) * n, rr = n * (0.08 + hash2(b, 3, 71) * 0.14);
      for (let y = Math.max(0, cy0 - rr | 0); y < Math.min(n, cy0 + rr | 0); y++) for (let x = Math.max(0, cx0 - rr | 0); x < Math.min(n, cx0 + rr | 0); x++) {
        const d = Math.hypot(x - cx0, y - cy0) / rr;
        if (d < 1) h[y * n + x] += (1 - d) * (b % 2 ? 0.14 : -0.11);
      }
    }
    for (let i = 0; i < n * n; i++) h[i] = Math.max(0, Math.min(1, h[i]));
  } else {                                            // plaster / paint：抹刀痕 + 橙皮
    const coarse = kind === 'plaster' ? 1 : 0.62;
    for (let y = 0; y < n; y++) {
      const sweep = Math.sin(y / n * Math.PI * (kind === 'plaster' ? 3 : 5)) * 0.11;
      for (let x = 0; x < n; x++) {
        const trow = Math.sin((x / n) * Math.PI * 2 + y * 0.02) * sweep;
        h[x + y * n] = Math.max(0, Math.min(1, 0.5 + trow + (h[x + y * n] - 0.5) * coarse));
      }
    }
  }
  return h;
}
/** 由高度场直接算颜色贴图（整体接近白，让 material.color 决定实际色调） */
function colorCanvas(kind, h, n) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const cx = cv.getContext('2d'); const im = cx.createImageData(n, n);
  if (!im || !im.data) throw new Error('createImageData 不可用');
  const tint = { brick: [16, -6, -12], stone: [2, 0, -4], concrete: [0, 1, 4], tile: [-4, -2, 4], wood: [10, -4, -14], metal: [-2, 0, 4], glass: [-6, 0, 8], asphalt: [-4, -2, 2], dirt: [12, 2, -10], fabric: [0, 0, 0], leaf: [-8, 4, -10], plaster: [0, 0, -2], paint: [0, 0, 0] }[kind] || [0, 0, 0];
  const contrast = { brick: 0.3, stone: 0.26, concrete: 0.2, tile: 0.3, wood: 0.4, metal: 0.1, glass: 0.1, asphalt: 0.3, dirt: 0.34, fabric: 0.22, leaf: 0.4, plaster: 0.12, paint: 0.09 }[kind] ?? 0.16;
  const base = 238;
  for (let i = 0; i < n * n; i++) {
    const v = base * (1 - contrast + contrast * 2 * h[i]);
    const j = (i * 2654435761 >>> 0) % 7 - 3;
    im.data[i * 4] = Math.max(0, Math.min(255, v + tint[0] + j));
    im.data[i * 4 + 1] = Math.max(0, Math.min(255, v + tint[1] + j));
    im.data[i * 4 + 2] = Math.max(0, Math.min(255, v + tint[2] + j));
    im.data[i * 4 + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  return cv;
}
/** 取（并缓存）某种材质的 map / normalMap / roughnessMap
 *  在没有可用 2D canvas 的环境里（node 测试、隐私模式禁用 canvas…）静默退化为「不挂贴图」 */
let texWarned = false;
export function detailMaps(kind) {
  if (!texOn() || !KIND[kind]) return null;
  const key = kind + '@' + level;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try { out = buildMaps(kind); } catch (e) {
    out = null;
    if (!texWarned) { texWarned = true; console.warn('程序化贴图不可用，回退为纯色材质：' + (e && e.message ? e.message : e)); }
  }
  cache.set(key, out);
  return out;
}
function buildMaps(kind) {
  const n = L.texPx;
  if (!(n >= 16)) return null;
  const kd = KIND[kind];
  const h = heightField(kind, n);
  const map = mkTex(colorCanvas(kind, h, n), true);
  const normalMap = mkTex(normalCv(h, n, kd.nrm * 3.2), false);
  // 粗糙度：灰度 = 材质基准粗糙 ± 高度场扰动（数值写在 B 通道）
  const rcv = document.createElement('canvas'); rcv.width = rcv.height = n;
  const rx = rcv.getContext('2d'); const im = rx.createImageData(n, n);
  if (!im || !im.data) throw new Error('createImageData 不可用');
  for (let i = 0; i < n * n; i++) {
    const v = Math.max(0, Math.min(255, (kd.hi - kd.rough * (0.5 - h[i])) * 255));
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  rx.putImageData(im, 0, 0);
  const roughnessMap = mkTex(rcv, false);
  return { map, normalMap, roughnessMap, tile: kd.tile, env: kd.env, kind };
}

/* ====================== UV 平铺：把物理尺寸烘进 UV ====================== */
const _bb = new THREE.Box3(); const _sz = new THREE.Vector3();
/** 依顶点法线的主轴挑另外两轴的物体尺寸，把 uv 换算成「米」再除以 tile → 平铺密度与尺寸无关 */
function fitUV(geo, size, tile) {
  if (!geo?.attributes?.uv || !geo?.attributes?.normal) return;
  const uv = geo.attributes.uv, nr = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = size.x; v = size.z; }          // 朝上 / 朝下
    else if (ax >= ay && ax >= az) { u = size.z; v = size.y; }     // 朝左右
    else { u = size.x; v = size.y; }                               // 朝前后
    const su = Math.max(0.25, (u || 1) / tile), sv = Math.max(0.25, (v || 1) / tile);
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  geo.userData = geo.userData || {}; geo.userData.uvFitted = 1;
}

/* ============================ 收尾：挂细节 =============================== */
/**
 * buildAsset 之后调用：给每个 mesh 的贴图 / 法线 / 粗糙度 / 环境反射补上，
 * 并把 UV 换算成按米的平铺密度。perf（内存优先）模式下只调环境反射，不挂贴图。
 */
export function applyDetail(root, opt = {}) {
  if (!root?.isObject3D) return root;
  const useTex = texOn() && !opt.noTex;
  const nrm = opt.nrmScale == null ? 0.85 : Math.max(0, Math.min(1.5, +opt.nrmScale));
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const ud = o.userData || (o.userData = {});
    if (ud.detDone) return;                      // 子组也会被外层 shade() 再走一遍：同一节点只处理一次
    ud.detDone = 1;
    const geo = o.geometry;
    if (geo && !geo.userData) geo.userData = {};
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.userData) continue;
      const kind = m.userData.detail;
      if (!kind || !KIND[kind]) continue;
      const fit = () => {                          // UV：把「一张贴图覆盖多少米」烘进顶点
        if (!geo || geo.userData.detFit) return;
        geo.userData.detFit = 1;
        const tile = KIND[kind].tile;
        if (geo.type === 'ExtrudeGeometry' || geo.type === 'ShapeGeometry') {
          const uv = geo.attributes.uv;
          if (uv) { for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile); uv.needsUpdate = true; }
          return;
        }
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb || bb.isEmpty()) return;
        bb.getSize(_sz).multiply(o.scale);
        fitUV(geo, _sz, tile);
      };
      if (m.userData.detMat) { if (useTex && m.map) fit(); continue; }
      m.userData.detMat = 1;
      m.envMapIntensity = KIND[kind].env ?? 0.3;
      if (!useTex || m.map) continue;               // 已有贴图的材质（立面窗格…）不覆盖，只调反射强度
      const dm = detailMaps(kind);
      if (!dm) continue;
      m.map = dm.map; m.normalMap = dm.normalMap; m.roughnessMap = dm.roughnessMap;
      m.normalScale = new THREE.Vector2(nrm, nrm);
      m.needsUpdate = true;
      fit();
    }
  });
  return root;
}

/** 倒角盒：std/fine 档给明显的棱边一点倒角（剪影不再「纸片」），lite 档退回普通盒 */
export function bevelGeo(w, h, d, r = 0.02, curve = 2) {
  const rw = Math.max(0.01, w), rh = Math.max(0.01, h), rd = Math.max(0.004, d);
  const k = L.chamfer;
  const rad = Math.max(0, Math.min(r * k, Math.min(rw, rh) * 0.24, rd * 0.4));
  if (rad <= 0.002) return new THREE.BoxGeometry(rw, rh, rd);
  const seg2 = Math.max(1, Math.round(curve * (k > 1 ? 1.5 : 1)));
  // 在 YZ 截面画圆角矩形，沿 X 挤出 → 长条类构件（墙压顶、门框、踢脚…）棱边全圆
  const sh = new THREE.Shape();
  const z = rd / 2, y = rh / 2, a = Math.max(0.001, Math.min(rad, z * 0.9, y * 0.9));
  sh.moveTo(-z + a, -y);
  sh.lineTo(z - a, -y); sh.quadraticCurveTo(z, -y, z, -y + a);
  sh.lineTo(z, y - a); sh.quadraticCurveTo(z, y, z - a, y);
  sh.lineTo(-z + a, y); sh.quadraticCurveTo(-z, y, -z, y - a);
  sh.lineTo(-z, -y + a); sh.quadraticCurveTo(-z, -y, -z + a, -y);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: rw, bevelEnabled: false, curveSegments: seg2 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-rw / 2, 0, 0);          // 挤出方向居中，保持与 BoxGeometry 同一原点
  geo.computeVertexNormals();
  return geo;
}

/** 环境贴图：一张很小的程序化天光（渐变 + 太阳 + 地面反弹），PMREM 之后当 scene.environment 用 */
export function makeEnvTexture({ sun = '#fff3d8', sky = '#9dc0e8', ground = '#4a4640' } = {}) {
  const w = 128, h = 64;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const gr = cx.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, new THREE.Color(sky).lerp(new THREE.Color('#ffffff'), 0.35).getStyle());
  gr.addColorStop(0.42, new THREE.Color(sky).getStyle());
  gr.addColorStop(0.52, new THREE.Color('#cdd7e0').getStyle());
  gr.addColorStop(0.62, new THREE.Color(ground).lerp(new THREE.Color(sky), 0.18).getStyle());
  gr.addColorStop(1, new THREE.Color(ground).getStyle());
  cx.fillStyle = gr; cx.fillRect(0, 0, w, h);
  const sg = cx.createRadialGradient(w * 0.26, h * 0.2, 0, w * 0.26, h * 0.2, w * 0.16);
  sg.addColorStop(0, new THREE.Color(sun).getStyle()); sg.addColorStop(0.35, 'rgba(255,244,214,0.55)'); sg.addColorStop(1, 'rgba(255,244,214,0)');
  cx.fillStyle = sg; cx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
