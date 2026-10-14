// ---------------------------------------------------------------------------
// 一句话街区：程序化生成器（地形 → 路网 → 地块 → 植被）
// 全部确定性：同一 seed 必得同一座镇。纯数学部分（noise/layout/poisson）不碰
// three，可在 node 里回归；只有 generateTown 需要 app。
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { clamp } from './util.js';
import { LIB, defaultsFor, buildAsset } from './assets.js';
import { SceneObj } from './app.js';
import { normalizeSchema, TOWN_THEMES } from './towngen.js';

// ============================== 噪声（#79） ==============================

/** 种子化 2D 值噪声，返回 [-1,1]。整数格点哈希 + smoothstep 双线性 */
export function makeValueNoise2(seed = 1) {
  let s = (seed >>> 0) || 1;
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {           // Fisher-Yates，用 xorshift 驱动
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const grad = (h, x, y) => {               // 8 方向梯度
    switch (h & 7) {
      case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return clamp(x1 * (1 - v) + x2 * v, -1, 1);
  };
}

/** 分形布朗运动：octaves 层叠加，频率 ×lacunarity、振幅 ×gain */
export function fbm2(noise, x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, y * f) * a;
    norm += a; a *= gain; f *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * 高度场：fBm × 边缘渐衰掩膜。
 * 渐衰让地图外圈回到 0，路/房子不会在边界上被切成悬崖。
 * @returns {(x:number,z:number)=>number}
 */
export function makeHeightField(s) {
  const noise = makeValueNoise2(s.seed);
  const detail = makeValueNoise2((s.seed * 7919) >>> 0);
  const amp = s.terrain.amplitude;
  const rough = s.terrain.roughness;
  const half = s.mapSize / 2;
  const oct = amp < 1.5 ? 2 : amp < 10 ? 4 : 5;
  const base = 0.012 + (1 - rough) * 0.01;      // 主频率（世界单位倒数）
  return (x, z) => {
    if (amp <= 0) return 0;
    const n = fbm2(noise, x * base + 31.7, z * base - 12.3, oct, 2.03, 0.35 + rough * 0.3);
    const d = fbm2(detail, x * base * 5.3, z * base * 5.3, 2, 2, 0.5) * 0.18 * rough;
    // 渐衰：距边界 inner 之内保持 1，外圈 smoothstep 到 0
    const inner = 0.72;
    const r = Math.max(Math.abs(x), Math.abs(z)) / half;   // 方形掩膜（地图是方的）
    const fall = r <= inner ? 1 : 1 - clamp((r - inner) / (1 - inner), 0, 1);
    const m = fall * fall * (3 - 2 * fall);
    return (n * amp + d * amp) * m;
  };
}

// ============================== 折线工具 ==============================

export function polyInfo(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { pts, cum, len: cum[cum.length - 1] || 0 };
}

/** 沿折线走 d 米，返回位置与单位切向 */
export function pointAt(info, d) {
  const { pts, cum, len } = info;
  d = clamp(d, 0, len);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
  const t = (d - cum[i - 1]) / seg;
  const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: dx, tz: dz };
}

/** 点到折线的最短距离（用于道路排除带） */
export function distToPoly(info, x, z) {
  let best = Infinity;
  const { pts } = info;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const vx = bx - ax, vz = bz - az;
    const L2 = vx * vx + vz * vz || 1e-6;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) best = d;
  }
  return best;
}

// ============================== 路网骨架（#80） ==============================

const ring = (cx, cz, rx, rz, n, squash = 0.28) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    // superellipse：介于圆与矩形之间，更像真实的环城路
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = 1 / Math.pow(Math.pow(Math.abs(ca), 2 / (1 + squash)) + Math.pow(Math.abs(sa), 2 / (1 + squash)) || 1, (1 + squash) / 2);
    pts.push([cx + ca * rx * (isFinite(k) ? clamp(k, 0.6, 1.4) : 1), cz + sa * rz * (isFinite(k) ? clamp(k, 0.6, 1.4) : 1)]);
  }
  return pts;
};

/** 射线 x=const（从 z0 朝 zEdge 方向）与折线的首个交点 z —— 支路在环路处 T 形断开用 */
const crossZ = (x, z0, zEdge, pts) => {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [px, pz] = pts[i], [qx, qz] = pts[i + 1];
    if (px === qx || (px - x) * (qx - x) > 0) continue;
    const z = pz + ((x - px) / (qx - px)) * (qz - pz);
    if ((z - z0) * (z - zEdge) > 0) continue;                  // 交点必须在行进方向上
    if (best === null || Math.abs(z - z0) < Math.abs(best - z0)) best = z;
  }
  return best;
};

/** 线段正交求交（返回夹角弧度与交点；端点相接不算穿越） */
const segAngle = (a1, a2, b1, b2) => {
  const r = [a2[0] - a1[0], a2[1] - a1[1]], sp = [b2[0] - b1[0], b2[1] - b1[1]];
  const den = r[0] * sp[1] - r[1] * sp[0];
  if (Math.abs(den) < 1e-9) return null;
  const q = [b1[0] - a1[0], b1[1] - a1[1]];
  const t = (q[0] * sp[1] - q[1] * sp[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
  if (t < 1e-6 || t > 1 - 1e-6 || u < 1e-6 || u > 1 - 1e-6) return null;
  let ang = Math.abs(Math.atan2(r[1], r[0]) - Math.atan2(sp[1], sp[0])) % Math.PI;
  if (ang > Math.PI / 2) ang = Math.PI - ang;
  return { ang, p: [a1[0] + t * r[0], a1[1] + t * r[1]] };
};

/**
 * 斜交整治：<50° 的穿越切成 T 形路口（断"开放"的那条；两条都闭合则跳过）。
 * 正交穿越（≥50°，方格网/放射口）保持四岔不动。
 */
function splitOblique(roads) {
  const TH = (50 * Math.PI) / 180;
  const closed = (r) => r.pts.length > 2
    && Math.hypot(r.pts[0][0] - r.pts.at(-1)[0], r.pts[0][1] - r.pts.at(-1)[1]) < 1;
  let changed = true, guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    scan: for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
      const A = roads[i], B = roads[j];
      for (let ai = 0; ai < A.pts.length - 1; ai++) for (let bi = 0; bi < B.pts.length - 1; bi++) {
        const hit = segAngle(A.pts[ai], A.pts[ai + 1], B.pts[bi], B.pts[bi + 1]);
        if (!hit || hit.ang >= TH) continue;
        if (closed(A) && closed(B)) continue;
        const cutIdx = closed(B) ? i : j;              // 闭合的那条不切（环路保持闭合）
        const R = roads[cutIdx];
        // 定位交点所在段，切成两段（端点都落在对方中心线上 → T 形）
        let seg = -1, best = 1e9;
        for (let k = 0; k < R.pts.length - 1; k++) {
          const d = ptSeg2(hit.p, R.pts[k], R.pts[k + 1]);
          if (d < best) { best = d; seg = k; }
        }
        if (seg < 0 || best > 1) continue;
        const p1 = R.pts.slice(0, seg + 1).concat([hit.p]);
        const p2 = [hit.p].concat(R.pts.slice(seg + 1));
        if (p1.length < 2 || p2.length < 2) continue;
        roads.splice(cutIdx, 1, { ...R, pts: p1 }, { ...R, name: R.name, pts: p2 });
        changed = true;
        break scan;
      }
    }
  }
}
const ptSeg2 = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
};

/**
 * 生成路网骨架（纯 [x,z] 折线，不含高度）。
 * @returns {Array<{name:string, pts:number[][], width:number, roadType:string, minor?:boolean}>}
 */
export function layoutRoads(s) {
  const S = s.mapSize, half = S / 2, M = Math.max(10, S * 0.05);
  const rng = s.rng;
  const roads = [];
  const minorType = s.density < 0.35 ? 'gravel' : 'concrete';

  if (s.roadTopology === 'grid') {
    const step = clamp(S / (s.density > 0.65 ? 7 : s.density < 0.35 ? 4 : 5), 34, 110);
    for (let x = -half + M; x <= half - M + 1e-6; x += step) {
      roads.push({ name: `南北向道路`, pts: [[x, -half + M], [x, half - M]], width: 7, roadType: minorType, minor: true });
    }
    for (let z = -half + M; z <= half - M + 1e-6; z += step) {
      roads.push({ name: `东西向道路`, pts: [[-half + M, z], [half - M, z]], width: 7, roadType: minorType, minor: true });
    }
    if (roads.length) { roads[0].roadType = 'asphalt'; roads[0].width = 9; roads[0].minor = false; }
    const mid = roads.find((r) => r.pts[0][1] === r.pts[1][1]);
    if (mid) { mid.roadType = 'asphalt'; mid.width = 9; mid.minor = false; }
  } else if (s.roadTopology === 'axis') {
    // 中轴对称（长安/北京式里坊格局）：南北中轴大道居中 + 东西大街横穿，
    // 街巷关于中轴与横轴镜像分布；间距/皇城环随种子变，对称性不受影响。
    const step = clamp(S / (s.density > 0.65 ? 7 : s.density < 0.35 ? 4 : 5), 34, 110) * (0.94 + rng() * 0.12);
    roads.push({ name: '中轴大道', pts: [[0, -half + M], [0, half - M]], width: 11, roadType: 'asphalt' });
    roads.push({ name: '东西大街', pts: [[-half + M, 0], [half - M, 0]], width: 9, roadType: 'asphalt' });
    const lanes = Math.floor((half - M - 4) / step);
    for (let k = 1; k <= lanes; k++) {
      const x = k * step;
      if (x > half - M - 4) continue;
      for (const sg of [-1, 1]) {
        roads.push({ name: '南北向道路', pts: [[sg * x, -half + M], [sg * x, half - M]], width: 7, roadType: minorType, minor: true });
        roads.push({ name: '东西向道路', pts: [[-half + M, sg * x], [half - M, sg * x]], width: 7, roadType: minorType, minor: true });
      }
    }
    if (rng() < 0.7) {                                   // 皇城环：围合感，随种子有无（尺寸收敛：不再占满半张图）
      const rk = 0.86 + rng() * 0.2;
      roads.push({ name: '皇城环', pts: ring(0, 0, S * 0.28 * rk, S * 0.24 * rk, 20), width: 7, roadType: 'asphalt' });
    }
  } else if (s.roadTopology === 'radial') {
    const spokes = s.density > 0.65 ? 8 : 6;
    const off = rng() * Math.PI * 2;                             // 整星随种子旋转，辐条之间保持等分
    for (let i = 0; i < spokes; i++) {
      const a = off + (i / spokes) * Math.PI * 2;
      roads.push({
        name: '放射干道', minor: i % 2 === 1, width: i % 2 === 0 ? 9 : 6,
        roadType: i % 2 === 0 ? 'asphalt' : minorType,
        pts: [[0, 0], [Math.cos(a) * (half - M), Math.sin(a) * (half - M)]],
      });
    }
    for (const f of [0.36, 0.6]) {
      const fj = f * (0.93 + rng() * 0.14);
      roads.push({ name: '环路', pts: ring(0, 0, S * fj * 0.5, S * fj * 0.5, 20), width: 7, roadType: 'asphalt' });
    }
  } else {
    // spine_and_loop（默认）：一条主干道横穿 + 一环 + 若干支路
    const segs = 16;
    // 主干道 = 整条一个平滑 S 弯：振幅/相位随种子变（路网有变化），曲线本身不逐点抖（无锯齿）
    const sAmp = S * (0.012 + rng() * 0.014), sPh = rng() * Math.PI * 2;
    const spineZ = (x) => Math.sin(((x + half - M) / (half * 2 - M * 2)) * Math.PI * 2 + sPh) * sAmp;
    const spine = [];
    for (let i = 0; i <= segs; i++) {
      const x = -half + M + ((half * 2 - M * 2) * i) / segs;
      spine.push([x, spineZ(x)]);
    }
    roads.push({ name: '主干道', pts: spine, width: 9, roadType: 'asphalt' });
    const rK = 0.92 + rng() * 0.16;
    // 环路尺寸收敛（0.25/0.19×S）：原 0.30/0.24×S 在 256m 图上占 60% 宽，观感「巨大环形」
    const ringRoad = { name: '环路', pts: ring(0, 0, S * 0.25 * rK, S * 0.19 * rK, 22), width: 7, roadType: 'asphalt' };
    roads.push(ringRoad);
    const branches = s.density > 0.65 ? 6 : s.density < 0.35 ? 3 : 4;
    for (let i = 0; i < branches; i++) {
      // 均匀分槽、无横向抖动；起点精确落在主干道中心线上（T 形衔接，不再悬空）
      const x = -half + M + ((half * 2 - M * 2) * ((i + 0.5) + (rng() - 0.5) * 0.5)) / branches;   // 槽内 ±25% 抖动
      const up = i % 2 === 0 ? 1 : -1;
      const z0 = spineZ(x);
      const zEdge = z0 + up * (half - M - Math.abs(z0));
      // 在与环路的交点处切成两段：内段（主干道→环路）+ 外段（环路→边界）——不再整条斜穿环路
      const hit = crossZ(x, z0, zEdge, ringRoad.pts);
      const segs2 = hit !== null && Math.abs(hit - z0) > 8 && Math.abs(zEdge - hit) > 8
        ? [[[x, z0], [x, hit]], [[x, hit], [x, zEdge]]]
        : [[[x, z0], [x, zEdge]]];
      for (const seg of segs2) roads.push({ name: '支路', minor: true, width: 6, roadType: minorType, pts: seg });
    }
  }
  splitOblique(roads);                                                     // 斜交一律改 T 形
  return roads.filter((r) => r.pts.length >= 2).slice(0, 24);
}

/** 简易占位栅格：地块/树互不重叠 */
function occupancy(S, cell = 6) {
  const n = Math.ceil(S / cell);
  const grid = new Uint8Array(n * n);
  const idx = (x, z) => {
    const i = Math.floor((x + S / 2) / cell), j = Math.floor((z + S / 2) / cell);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  return {
    cell, n,
    free(x, z, r) {
      for (let dz = -r; dz <= r; dz += cell * 0.5) {
        for (let dx = -r; dx <= r; dx += cell * 0.5) {
          if (dx * dx + dz * dz > r * r) continue;
          const k = idx(x + dx, z + dz);
          if (k >= 0 && grid[k]) return false;
        }
      }
      return true;
    },
    take(x, z, r) {
      for (let dz = -r; dz <= r; dz += cell * 0.5) {
        for (let dx = -r; dx <= r; dx += cell * 0.5) {
          if (dx * dx + dz * dz > r * r) continue;
          const k = idx(x + dx, z + dz);
          if (k >= 0) grid[k] = 1;
        }
      }
    },
  };
}

/**
 * 沿路切地块：25–35m 面宽、6–8m 退让，朝向 = 道路法向（房子正面朝路）。
 * @param {object} s 归一化 schema
 * @param {Array} roads layoutRoads 的输出
 * @param {(x:number,z:number)=>number} heightAt 采样地形高度
 * @returns {Array<{x:number,z:number,rotY:number,w:number,d:number,kind:string,slope:number}>}
 */
export function layoutParcels(s, roads, heightAt = () => 0) {
  const S = s.mapSize, half = S / 2;
  const rng = s.rng;
  const occ = occupancy(S, 6);
  const parcels = [];
  const step = 30 - s.density * 13;              // 17–30m（密度↑ → 街坊更满）
  const maxSlope = 0.2 + (1 - s.density) * 0.08; // 陡坡不放房子
  // 所有道路的走廊：地块不仅要退让自己那条路，也不能压在横穿的另一条路上
  const corridors = roads.map((r) => ({ info: polyInfo(r.pts), half: (r.width || 7) / 2 }));
  const clearance = (x, z) => {
    let c = Infinity;
    for (const { info, half: hw } of corridors) c = Math.min(c, distToPoly(info, x, z) - hw);
    return c;
  };

  for (const road of roads) {
    const info = polyInfo(road.pts);
    const w = road.width || 7;
    for (const side of [-1, 1]) {
      for (let d = step * 0.5; d < info.len - step * 0.3; d += step * (0.85 + rng() * 0.3)) {
        const p = pointAt(info, d);
        const nx = -p.tz * side, nz = p.tx * side;   // 道路法向
        const setback = 6 + rng() * 2 + w / 2;
        const depth = 8 + rng() * 6;
        const cx = p.x + nx * (setback + depth / 2);
        const cz = p.z + nz * (setback + depth / 2);
        if (Math.abs(cx) > half - 14 || Math.abs(cz) > half - 14) continue;
        const slope = Math.max(
          Math.abs(heightAt(cx + 5, cz) - heightAt(cx - 5, cz)) / 10,
          Math.abs(heightAt(cx, cz + 5) - heightAt(cx, cz - 5)) / 10,
        );
        if (slope > maxSlope) continue;
        const fw = step * (0.66 + rng() * 0.22);      // 面宽（填满街坊，减少空地）
        // 四个角都不能伸进任何路面（含路口处的横向道路）；阈值含模型外扩余量
        const lx = p.tx, lz = p.tz;                  // 沿路方向
        const hw2 = fw / 2, hd2 = depth / 2;
        let onRoad = clearance(cx, cz) < 6;
        for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (onRoad) break;
          const qx = cx + lx * su * hw2 + nx * sv * hd2;
          const qz = cz + lz * su * hw2 + nz * sv * hd2;
          if (clearance(qx, qz) < 2.8) onRoad = true;
        }
        if (onRoad) continue;
        if (!occ.free(cx, cz, Math.max(fw, depth) * 0.62)) continue;
        occ.take(cx, cz, Math.max(fw, depth) * 0.62);
        const distC = Math.hypot(cx, cz) / (half || 1);
        const cr = s.zoning.commercialRatio;
        let kind = 'residential';
        const bias = clamp(cr * (1.8 - distC * 1.2), 0, 0.9);   // 越靠中心越可能商业
        if (rng() < bias) kind = 'commercial';
        parcels.push({
          x: cx, z: cz, fw, depth, slope,
          w: fw, d: depth,
          rotY: Math.atan2(-nx, -nz),   // 正面朝向道路
          kind, nearCenter: distC,
          // 宅前连接用：所贴道路中心线上的点、道路法向（背离道路）、切向（沿路）
          front: [p.x, p.z], dir: [nx, nz], tan: [p.tx, p.tz], roadW: w,
        });
      }
    }
  }

  //  civic（学校 / 教堂 / 消防局）：挑靠中心的大地块，最多 3 个
  const civics = Math.min(3, Math.max(1, Math.round(s.mapSize / 220)));
  const sorted = parcels.filter((p) => p.kind === 'residential').sort((a, b) => a.nearCenter - b.nearCenter || b.w - a.w);
  for (let i = 0; i < civics && i < sorted.length; i++) sorted[i].kind = 'civic';
  return parcels;
}

// ============================== 泊松圆盘（#81） ==============================

/**
 * 泊松圆盘采样：点与点之间至少 minDist，分布自然且不重叠。
 * @param {()=>number} rng 0..1
 * @param {number} minDist 最小间距
 * @param {number} maxPts 上限
 * @param {(x:number,z:number)=>boolean} accept 过滤（排除道路/地块/陡坡）
 */
export function poissonDisc(rng, extent, minDist, maxPts, accept = () => true) {
  const cell = minDist / Math.SQRT2;
  const half = extent / 2;
  const gw = Math.ceil(extent / cell);
  const grid = new Int32Array(gw * gw).fill(-1);
  const pts = [];
  const active = [];
  const gi = (x, z) => Math.floor((z + half) / cell) * gw + Math.floor((x + half) / cell);
  const push = (x, z) => {
    const i = pts.length;
    pts.push([x, z]); active.push(i); grid[gi(x, z)] = i;
  };
  for (let tries = 0; tries < 60 && pts.length < maxPts; tries++) {
    const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
    if (accept(x, z) && grid[gi(x, z)] === -1) { push(x, z); break; }
  }
  if (!pts.length) return pts;
  while (active.length && pts.length < maxPts) {
    const ai = Math.floor(rng() * active.length);
    const [px, pz] = pts[active[ai]];
    let added = false;
    for (let k = 0; k < 24; k++) {
      const a = rng() * Math.PI * 2;
      const r = minDist * (1 + rng());
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4) continue;
      const ci = Math.floor((x + half) / cell), cj = Math.floor((z + half) / cell);
      if (ci < 0 || cj < 0 || ci >= gw || cj >= gw) continue;
      let ok = true;
      for (let j = Math.max(0, cj - 2); j <= Math.min(gw - 1, cj + 2) && ok; j++) {
        for (let i = Math.max(0, ci - 2); i <= Math.min(gw - 1, ci + 2); i++) {
          const id = grid[j * gw + i];
          if (id >= 0 && Math.hypot(pts[id][0] - x, pts[id][1] - z) < minDist) { ok = false; break; }
        }
      }
      if (!ok || !accept(x, z)) continue;
      push(x, z); added = true;
      if (pts.length >= maxPts) break;
    }
    if (!added) active.splice(ai, 1);
  }
  return pts;
}

/**
 * 乔木散布点：排除道路走廊、地块、陡坡与地图边界。
 * @returns {Array<[number,number]>}
 */
export function scatterTrees(s, roads, parcels, heightAt = () => 0) {
  if (s.vegetationDensity <= 0) return [];
  // 独立随机流：树点只由 seed + 几何决定，与布局消费 rng 的顺序解耦——
  // 同一 seed 下不同植被密度拿到同一组候选点，抽稀后严格单调（密度↑→树↑）
  let st = (((s.seed || 1) * 1664525) + 1013904223) >>> 0;
  const rr = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const infos = roads.map((r) => ({ info: polyInfo(r.pts), w: r.width || 7 }));
  // 以茂密档统一采样再按密度抽稀：泊松在不同 minDist 下行为发散，
  // 直接采样会出现「植被更密反而树更少」；抽稀用同一条 rng 序列，严格单调。
  const minDist = 9.6;
  const maxPts = 90;
  const pts = poissonDisc(rr, s.mapSize, minDist, maxPts, (x, z) => {
    for (const { info, w } of infos) if (distToPoly(info, x, z) < w / 2 + 3.5) return false;
    for (const p of parcels) if (Math.hypot(p.x - x, p.z - z) < Math.max(p.w, p.d) * 0.8 + 3) return false;
    const sl = Math.max(
      Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) / 6,
      Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3)) / 6,
    );
    return sl < 0.55;
  });
  const k = clamp(s.vegetationDensity / 0.85, 0, 1);
  return k >= 1 ? pts : pts.filter(() => rr() < k);
}

// ============================== 资产 key ==============================

/**
 * 折线按 ~12m 加密并逐点采样地形高度：长直线道路不再两端悬空，
 * 中段与双线性地形网格的偏差收敛到可忽略（修「路面与地形穿插」）。
 * @param {number[][]} pts [x,z] 折线
 * @param {(x:number,z:number)=>number} heightAt
 */
export function densifyHeight(pts, heightAt, step = 12) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      out.push([x, heightAt(x, z), z]);
    }
  }
  const e = pts[pts.length - 1];
  out.push([e[0], heightAt(e[0], e[1]), e[1]]);
  return out;
}

const KEY_BY_TYPE = new Map();
for (const g of LIB) for (const it of g.items) KEY_BY_TYPE.set(it.type, `${g.id}:${it.type}:${it.name}`);
const ITEM_BY_TYPE = new Map();
for (const g of LIB) for (const it of g.items) ITEM_BY_TYPE.set(it.type, it);

/** 把建筑尺寸夹到地块里，同时尊重模型库自身的参数范围 */
function sizedParams(type, w, d, rng) {
  const item = ITEM_BY_TYPE.get(type);
  const p = item ? defaultsFor(item) : {};
  const jitter = (k, target, spread = 0.12) => {
    const desc = item?.params?.find((x) => x.k === k);
    if (!desc || desc.t !== 'range') return;
    const v = clamp(target * (1 + (rng() * 2 - 1) * spread), desc.min, desc.max);
    p[k] = Math.round(v / (desc.step || 0.5)) * (desc.step || 0.5);
  };
  jitter('width', w); jitter('depth', d);
  if (item?.params?.some((x) => x.k === 'floors')) {
    const fd = item.params.find((x) => x.k === 'floors');
    // 玻璃幕墙塔楼：5–24 层随机（天际线高低错落）；其余在模型层数下限内给 1–3 层变化
    p.floors = type === 'tower'
      ? clamp(5 + Math.round(rng() * 19), 5, fd.max)
      : clamp(Math.round(1 + rng() * 1.6), fd.min ?? 1, fd.max);
  }
  return p;
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ============================== 编排：generateTown ==============================

const BIOME_BY_THEME = {
  suburb: 'grass', california: 'grass', newengland: 'forest', southwest: 'desert', urban: 'grass',
  chinese: 'grass', modern: 'grass', fusion: 'grass',
};

/**
 * 一键造镇：清空当前场景 → 地形/路网/建筑/植被/光照一次成型。
 * 整个过程包在 app.batchOp 里，Ctrl+Z 一步回到生成之前。
 * @returns {{roads:number, parcels:number, houses:number, trees:number, ms:number, warnings:string[]}}
 */
export function generateTown(app, rawSchema, opts = {}) {
  const s = normalizeSchema(rawSchema);
  const label = `一句话造镇 ${s.mapSize}m`;
  let stats;
  app._quietAdd = true;
  try {
    app.batchOp(label, () => {
      app.clearAll();
      stats = buildTown(app, s, opts);
    });
  } finally {
    app._quietAdd = false;
  }
  app.lighting.applyGlow(app.lighting.p.glow);
  app.select(null);
  app.bus.emit('objects');
  app.bus.emit('select');
  app.bus.emit('terrain');
  app.bus.emit('shots');
  app.bus.emit('undoable');
  app.saveLocal?.();
  return stats;
}

function buildTown(app, s, { onProgress } = {}) {
  const t0 = performance.now();
  const theme = TOWN_THEMES[s.theme] || TOWN_THEMES.suburb;
  const warnings = [];

  // ---- 1. 地形（先于道路：路面网格在建的时候就把高度烘进去了） ----
  const tr = app.terrain;
  const heightAt = makeHeightField(s);
  tr.setEnabled(true);
  tr.setSize(s.mapSize);                                   // 内部 clamp 到 40–600
  if (tr.size < s.mapSize) warnings.push(`地图尺寸受地形上限限制，实际 ${Math.round(tr.size)}m`);
  tr.setResolution(clamp(Math.round(tr.size / 3.2) | 1, 33, 161));
  tr.setBiome(BIOME_BY_THEME[s.theme] || 'grass');
  tr.setWaterLevel(-999);
  const n = tr.n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -tr.size / 2 + (i * tr.size) / (n - 1);
      const z = -tr.size / 2 + (j * tr.size) / (n - 1);
      tr.h[j * n + i] = heightAt(x, z);
    }
  }
  tr.refresh();
  onProgress?.(0.2, '地形');

  // ---- 2. 路网骨架 + 地块（纯数学，用地形采样做坡度过滤） ----
  const roads = layoutRoads(s);
  const parcels = layoutParcels(s, roads, (x, z) => tr.heightAt(x, z));
  onProgress?.(0.35, '路网');

  // ---- 3. 地块整平（必须在建路之前：路面按当时的高度烘网格） ----
  for (const p of parcels) {
    const y = tr.heightAt(p.x, p.z);
    tr.padAt(p.x, p.z, Math.max(p.w, p.d) * 0.72, y, { silent: true });
  }
  tr.refresh();

  // ---- 4. 道路（roadBrush.restore 会逐条建 + 自动检测路口） ----
  app.roadBrush.restore(
    roads.map((r) => ({
      points: densifyHeight(r.pts, (x, z) => tr.heightAt(x, z), 12),
      roadType: r.roadType, width: r.width, fillet: false,
      name: r.name, visible: true, locked: false,
    })),
  );
  onProgress?.(0.6, '道路');

  // ---- 4.5 宅前基座 + 连路小径（基座=混凝土台面（不生成路口），小径/车道 T 形接入最近道路） ----
  // 路径类型随主题：西式/现代 = 混凝土车道，中式 = 青砖小径；公建只给小径不垫基座
  const pathType = theme.path || 'concrete';
  const pathName = pathType === 'garden' ? '青砖小径' : '宅前车道';
  const driveList = [];
  for (const p of parcels) {
    if (!p.front || !p.dir || !p.tan) continue;
    const [dx, dz] = p.dir, [tx, tz] = p.tan, [fx, fz] = p.front;
    const hy = (x, z) => tr.heightAt(x, z);
    if (p.kind !== 'civic') {
      // 基座：与道路平行的混凝土台面，罩住宅身（宽度沿法向 = 地块进深）
      const padL = Math.min(p.w * 0.8, 30);
      const padW = Math.min(p.depth * 0.94, 18);
      const ax = p.x - (tx * padL) / 2, az = p.z - (tz * padL) / 2;
      const bx = p.x + (tx * padL) / 2, bz = p.z + (tz * padL) / 2;
      driveList.push({
        points: densifyHeight([[ax, az], [bx, bz]], hy, 8),
        roadType: 'concrete', width: padW, fillet: false,
        name: '混凝土基座', visible: true, locked: false, noJunct: true,
      });
    }
    // 小径：宅前脸 → 道路中心线，端点落在中心线上即与道路 T 形接通（自动生成接缝面片）
    const doorX = p.x - dx * (p.depth * 0.47), doorZ = p.z - dz * (p.depth * 0.47);
    driveList.push({
      points: densifyHeight([[doorX, doorZ], [fx, fz]], hy, 6),
      roadType: pathType, width: 2.6, fillet: false,
      name: pathName, visible: true, locked: false,
    });
  }
  if (driveList.length) app.roadBrush.restore(driveList);
  onProgress?.(0.68, '宅前小径');

  // ---- 5. 建筑 ----
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  // 城市识别：现代/老城 + 高密度 → 中心区商业地块长出玻璃幕墙塔楼（高度 5–24 层随机）
  const cityLike = (s.theme === 'modern' || s.theme === 'urban') && s.density >= 0.6;
  let houses = 0, towers = 0;
  for (const p of parcels) {
    let type = p.kind === 'commercial' ? pick(s.rng, theme.commerce)
      : p.kind === 'civic' ? pick(s.rng, theme.civic)
        : pick(s.rng, theme.houses);
    if (cityLike && p.kind === 'commercial' && (p.nearCenter ?? 1) < 0.5 && s.rng() < 0.55) {
      type = 'tower';
      towers++;
    }
    const key = KEY_BY_TYPE.get(type);
    if (!key) continue;
    const want = p.kind === 'residential' ? p.w * 0.72 : p.w * 0.86;
    const params = sizedParams(type, want, want * (0.6 + s.rng() * 0.25), s.rng);
    const so = app.addAsset(key, V(p.x, p.z), { params, merge: true, name: p.kind === 'residential' ? '住宅' : p.kind === 'commercial' ? '商铺' : '公共设施' });
    if (!so) continue;
    so.root.rotation.y = p.rotY;
    so.followTerrain = true;
    so.root.position.y = tr.heightAt(p.x, p.z);
    houses++;
  }
  onProgress?.(0.82, '建筑');

  // ---- 6. 植被（泊松圆盘）----
  // 每个「树种 + 高度档」只 build 一次，其余克隆共享 geometry/material。
  // 高度必须量化：存档只存 params，重载时按 params 重建，档位一致才不会变样。
  // 树要避开主路网 + 宅前小径/基座：把 driveList 折成 [x,z] 折线一起传
  const excludeRoads = roads.concat(driveList.map((d) => ({ pts: d.points.map((q) => [q[0], q[2]]), width: d.width })));
  const treePts = scatterTrees(s, excludeRoads, parcels, (x, z) => tr.heightAt(x, z));
  let trees = 0;
  const tpl = new Map();
  const HEIGHTS = [5, 7, 9, 11];
  for (const [x, z] of treePts) {
    const type = theme.trees.length ? pick(s.rng, theme.trees) : 'sugar_maple';
    const key = KEY_BY_TYPE.get(type);
    const item = ITEM_BY_TYPE.get(type);
    if (!key || !item) continue;
    const height = HEIGHTS[Math.floor(s.rng() * HEIGHTS.length) % HEIGHTS.length];
    const tk = `${type}|${height}`;
    let root = tpl.get(tk);
    if (!root) {
      root = buildAsset(item, { ...defaultsFor(item), height });
      app.mergeRoot(root);                  // 模板先实例化/烘焙，克隆体共享合并结果
      root.userData = {};                 // clone() 会 JSON 复制 userData：循环引用/贴图会炸
      tpl.set(tk, root);
    }
    const clone = root.clone();
    clone.position.set(x, tr.heightAt(x, z), z);
    clone.rotation.y = s.rng() * Math.PI * 2;
    clone.scale.setScalar(+(0.78 + s.rng() * 0.5).toFixed(3));
    clone.userData = { itemKey: key };
    const so = new SceneObj(app, { name: '乔木', key, type, params: { ...defaultsFor(item), height }, root: clone, merged: true });
    so.followTerrain = true;
    app.objects.push(so);
    trees++;
  }
  onProgress?.(0.95, '植被');

  // ---- 7. 光照 / 天气 ----
  app.lighting.applyPreset(s.lighting);
  app.weather.set(s.weather);

  const ms = Math.round(performance.now() - t0);
  const { rng, ...schemaOut } = s;
  return { roads: roads.length, driveways: driveList.length, parcels: parcels.length, houses, towers, trees, ms, warnings, schema: schemaOut };
}
