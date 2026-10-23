// ---------------------------------------------------------------------------
// junction.js — 路口程序化生成器（全角度统一，唯一的路口几何来源）
//
// 取代旧的「模型库整件（four_way_stop/t_junction/roundabout）+ 面片 + 挖洞公式」
// 拼贴管线：整件固定 7.4m 进口与真实路宽（12m 车行）天然错位，锐角下挖洞
// 1/sinT 放大成十几米黑板——都是三套坐标系靠常数对齐的根源问题。
//
// 外观照抄模型件参数：R5 路缘回转（RRET=5）、步道角块（缘石 0.45+步道 1.8 侧带）、
// 大陆式斑马线（条宽 0.45、中距 1.05、长 2.4）、停止线；几何全部由两条路的
// 真实横断面解析推导，直角/锐角/钝角/T 形走同一段代码。
//
// 平面构造（俯视 XZ，C = 交叉点）：
//   臂 i（指向路外）：车行半宽 pav_i、件全半宽 half_i、
//   出口断面 c_i 至少 pav_i + 6.5，并按邻臂交角扩展到侧带分离处 + R5 切线余量。
//   断面四角 T_i± = C + c_i·d_i ± half_i·perp_i；外轮廓 = 全部角点的凸包——
//   直角时自然张成方角；锐角沿道路轴延长，避免两个尖角被裁掉、侧带互穿。
//   步道角块 = 轮廓 ∩ 两邻臂车行外半平面，车行边线交点 G 处做 R5 回转圆角。
//   路件挖洞 = 曲线与路口轮廓的区间求交，判定 = 横断面（±half）在 t±0.8m 沿弧长
//   前探共 9 点全在轮廓内（0.05 富余）→ 第一个露头采样点的刚性端面整条在轮廓里：无缝、无洞、无共面闪烁。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import ClipperLib from 'clipper-lib';

export const SIDE_BAND = 2.25;      // 路侧带（缘石 0.45 + 步道 1.8，照抄库常量）
export const RRET = 5;              // 路缘回转半径 R5（照抄库 RRET）
const MOUTH_EXTRA = 6.5;            // 出口断面外延 = R5 + 1.5m 直段
const GAP_LIP = 0.8;                // 路件侵入路口的搭接量（沿行进方向前探 0.8 ≥ 采样步长 0.75；仅供 insideLip 兼容）
const SIDED = { asphalt: 1, oneway: 1, concrete: 1 };

// 路口铺装是整个路口的属性，不取决于最后画入的是哪条路。
// 单向路和高速路也使用沥青面层；无沥青时采用稳定的后备顺序，保存/重建不变色。
const JUNCTION_SURFACES = {
  asphalt: { id: 'asphalt', color: 0x3a3d42, roughness: 0.95, asphalt: true },
  concrete: { id: 'concrete', color: 0x999999, roughness: 0.9, asphalt: false },
  gravel: { id: 'gravel', color: 0x8a8580, roughness: 0.95, asphalt: false },
  garden: { id: 'garden', color: 0xb07050, roughness: 0.85, asphalt: false },
};
export function junctionSurface(arms) {
  const types = new Set((arms || []).map(a => a.roadType?.id));
  const id = ['asphalt', 'oneway', 'freeway'].some(t => types.has(t)) ? 'asphalt'
    : ['concrete', 'gravel', 'garden'].find(t => types.has(t)) || 'concrete';
  return { ...JUNCTION_SURFACES[id] };
}

// 横断面：带侧带的类型件全宽 = width+4.5（车行=width、双侧各 2.25），其余全宽即车行
export function roadProfile(roadType, width) {
  const w = Math.max(1, width || 12);
  const sid = !!(roadType && SIDED[roadType.id]);
  return { pav: w / 2, half: sid ? (w + 4.5) / 2 : w / 2, sid };
}

const v2 = (x, z) => ({ x, z });
const sub = (a, b) => v2(a.x - b.x, a.z - b.z);
const add = (a, b) => v2(a.x + b.x, a.z + b.z);
const mul = (a, s) => v2(a.x * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.z * b.z;
const cross2 = (a, b) => a.x * b.z - a.z * b.x;
const len = (a) => Math.hypot(a.x, a.z);
const norm = (a) => { const l = len(a) || 1; return v2(a.x / l, a.z / l); };
const perp = (d) => v2(d.z, -d.x);                   // 绕 +Y 旋转 +90°：(x,z)→(z,−x)
const ang = (d) => Math.atan2(d.z, d.x);

/**
 * 由一条交叉记录生成臂列表：路中段交叉 → 两端各一臂；端头路（t≈0/1）只留
 * 指向路体外侧的那一臂（T 形的 stem 永远只贡献一个臂）。
 */
export function armsFromIsect(isect) {
  const arms = [];
  const push = (curve, t, width, roadType) => {
    const tc = Math.max(0.001, Math.min(0.999, t));
    const tan = curve.getTangentAt(tc).normalize();
    const d0 = v2(tan.x, tan.z);
    const prof = roadProfile(roadType, width);
    const at = curve.getPointAt(t);
    const axisPoint = v2(at.x, at.z);
    const mk = (sign) => {
      const dir = mul(d0, sign);
      return { dir, pav: prof.pav, half: prof.half, sid: prof.sid, width, roadType, axisPoint };
    };
    if (t < 0.02) arms.push(mk(1));                  // 路体在 +切向前方
    else if (t > 0.98) arms.push(mk(-1));            // 路体在 −切向后方
    else { arms.push(mk(1)); arms.push(mk(-1)); }
  };
  push(isect.newCurve, isect.tNew, isect.newWidth, isect.newRoadType);
  push(isect.existingCurve, isect.tExisting, isect.existingWidth, isect.existingRoadType);
  return arms;
}

// Andrew monotone chain（(x,z) 当作 (x,y)；返回逆时针，去重近点并保留标记）
function convexHull(pts) {
  const P = pts.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z));
  const uniq = [];
  for (const p of P) {
    const last = uniq[uniq.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.z - p.z) < 1e-6) continue;
    uniq.push(p);
  }
  if (uniq.length < 3) return uniq;
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross2(sub(h[h.length - 1], h[h.length - 2]), sub(p, h[h.length - 2])) <= 1e-9) h.pop();
      h.push(p);
    }
    return h;
  };
  const lower = half(uniq);
  const upper = half(uniq.slice().reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 凸多边形按半平面 {dot(P−O, n) ≥ d} 裁剪（保留满足侧）
function clipHalf(poly, O, n, d) {
  const out = [];
  const f = (p) => dot(sub(p, O), n) - d;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= -1e-9) out.push(a);
    if ((fa > 1e-9 && fb < -1e-9) || (fa < -1e-9 && fb > 1e-9)) {
      const t = fa / (fa - fb);
      out.push(add(a, mul(sub(b, a), t)));
    }
  }
  return out;
}

const EPS_G = 1e-4;

/**
 * 解析路口方案：轮廓、挖洞面、步道角块（含 R5 回转）、断面标记。
 * 任何交角同一套流程；近平行（sin<0.08）已被检测层拦掉。
 */
export function junctionPlan(center, arms) {
  if (!center || !arms || arms.length < 2) return null;
  let C = v2(center.x, center.z);
  // 检测器用两条曲线最近点的中点作为交点。端头稍差几毫米时，中点不在
  // T 主路轴线上；把铺装中心投影回贯通主路，保证背侧边界与原路严格共边。
  if (arms.length === 3) {
    for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
      if (dot(arms[i].dir, arms[j].dir) > -1 + 1e-6 || !arms[i].axisPoint) continue;
      const normal = perp(arms[i].dir);
      C = sub(C, mul(normal, dot(sub(C, arms[i].axisPoint), normal)));
    }
  }

  // 相邻臂的侧带必须在出口之前彻底分开，且给 R5 圆角留下切线长度。
  // 固定出口距离在锐角下会把步道尖角裁掉，让两条路的侧带穿入对方车道。
  const sorted = arms.map((a, i) => i).sort((i, j) => ang(arms[i].dir) - ang(arms[j].dir));
  arms.forEach(a => { a.c = a.pav + MOUTH_EXTRA; });
  for (let k = 0; k < sorted.length; k++) {
    const ai = arms[sorted[k]], aj = arms[sorted[(k + 1) % sorted.length]];
    let theta = ang(aj.dir) - ang(ai.dir);
    if (theta <= 0) theta += Math.PI * 2;
    if (theta >= Math.PI - 1e-4) continue;
    const sin = Math.sin(theta), cos = Math.cos(theta);
    const tangent = RRET / Math.tan(theta / 2);
    // 两侧车行边线及最外侧带边线的交点，分别投影到各臂轴。
    const reach = (a, b) => Math.max(
      (b.pav + a.pav * cos) / sin + tangent,
      (b.half + a.half * cos) / sin,
    ) + 1.5;
    ai.c = Math.max(ai.c, reach(ai, aj));
    aj.c = Math.max(aj.c, reach(aj, ai));
  }

  // —— 出口断面四角
  const cornerMeta = [];                      // { arm, sign, p }
  arms.forEach((a, i) => {
    const P = perp(a.dir);
    for (const s of [1, -1]) {
      cornerMeta.push({ arm: i, sign: s, p: add(add(C, mul(a.dir, a.c ?? (a.c = a.pav + MOUTH_EXTRA))), mul(P, s * a.half)) });
    }
  });
  // a.c 赋值放在上面（臂对象共享缓存，重复 plan 时一致）
  const hull = convexHull(cornerMeta.map(m => m.p));
  if (hull.length < 3) return null;
  // 标记每个凸包顶点属于哪个臂角
  const tag = hull.map(p => {
    let best = null, bd = 1e9;
    for (const m of cornerMeta) {
      const d = Math.hypot(m.p.x - p.x, m.p.z - p.z);
      if (d < bd) { bd = d; best = m; }
    }
    return bd < 1e-5 ? { arm: best.arm, sign: best.sign } : null;
  });

  // 有向边 + 内法线（凸包 CCW：内法线 = 边方向右转）
  const edges = [];
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area += a.x * b.z - b.x * a.z;
  }
  const ccw = area > 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const e = sub(b, a);
    const t = tag[i], t2 = tag[(i + 1) % hull.length];
    // 内法线：CCW（(x,z) 当作 (x,y)）时为边方向左转 (−e.z, e.x)，反之取反
    const nIn = ccw ? norm(v2(-e.z, e.x)) : norm(v2(e.z, -e.x));
    const mouth = !!(t && t2 && t.arm === t2.arm);
    edges.push({ a, b, n: nIn, mouth, tagA: t, tagB: t2 });
  }

  // —— 步道角块（相邻臂两两成象限）
  const order = arms.map((a, i) => i).sort((i, j) => ang(arms[i].dir) - ang(arms[j].dir));
  const walks = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k], j = order[(k + 1) % order.length];
    const ai = arms[i], aj = arms[j];
    const gapAng = Math.abs(ang(aj.dir) - ang(ai.dir));
    const wrapped = Math.min(gapAng, Math.PI * 2 - gapAng);
    if (wrapped > Math.PI * 0.94) {
      // T 型主路背侧：对向臂之间不是圆角象限，而是一条连续的背侧步道。
      // 主路被裁切后，这一带必须由路口本体接管，不能依赖未裁掉的原路遮盖。
      if (arms.length === 3 && dot(ai.dir, aj.dir) < -1 + 1e-6 && ai.sid && aj.sid) {
        const other = arms.find((_, index) => index !== i && index !== j);
        let back = perp(ai.dir);
        if (dot(back, other.dir) > 0) back = mul(back, -1);
        const poly = clipHalf(hull, C, back, Math.max(ai.pav, aj.pav));
        if (poly.length >= 3) walks.push({ poly, armI: i, armJ: j, back: true });
      }
      continue;
    }
    const Pi = perp(ai.dir), Pj = perp(aj.dir);
    // 找两车行边线交点 G：C + a·di + σi·pav_i·Pi = C + b·dj + σj·pav_j·Pj，取 a>0,b>0
    let G = null, si = 1, sj = 1;
    for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      // 解 [di, −s1·Pi]·[a,?] … 直接两线求交：dot(P−C−s1·pav_i·Pi, ni)=0 形式
      // 边线 i: dot(P − C, Pi) = s1·pav_i；边线 j: dot(P − C, Pj) = s2·pav_j
      const n1 = Pi, n2 = Pj, d1 = s1 * ai.pav, d2 = s2 * aj.pav;
      const det = cross2(n1, n2);
      if (Math.abs(det) < 1e-6) continue;
      // Cramer 解 dot(X,n1)=d1, dot(X,n2)=d2（X = P − C）
      const X = v2((d1 * n2.z - d2 * n1.z) / det, (d2 * n1.x - d1 * n2.x) / det);
      const c1 = dot(X, n1), c2 = dot(X, n2);
      if (Math.abs(c1 - d1) > 1e-6 || Math.abs(c2 - d2) > 1e-6) continue;
      const a = dot(X, ai.dir), b = dot(X, aj.dir);
      if (a > 1e-4 && b > 1e-4) { G = add(C, X); si = s1; sj = s2; break; }
    }
    if (!G) continue;

    // 象限半平面：车行外侧
    const nI = mul(Pi, si), nJ = mul(Pj, sj);
    let poly = hull.slice();
    poly = clipHalf(poly, G, nI, 0);        // dot(P−G, nI) ≥ 0（G 在线上）
    poly = clipHalf(poly, G, nJ, 0);
    if (poly.length < 3) continue;

    // G 是否为多边形顶点（车行转角露在轮廓内 → 做 R5 回转）
    let gi = -1;
    for (let q = 0; q < poly.length; q++) {
      if (Math.hypot(poly[q].x - G.x, poly[q].z - G.z) < EPS_G) { gi = q; break; }
    }
    if (gi >= 0) {
      const prev = poly[(gi - 1 + poly.length) % poly.length];
      const next = poly[(gi + 1) % poly.length];
      const tPrev = norm(sub(prev, G));
      const tNext = norm(sub(next, G));
      const lPrev = Math.hypot(prev.x - G.x, prev.z - G.z);
      const lNext = Math.hypot(next.x - G.x, next.z - G.z);
      const cosHalf = Math.max(-0.999, Math.min(0.999, dot(tPrev, tNext)));
      const phi = Math.acos(cosHalf);                     // G 处内角
      const half = phi / 2;
      const tTan = Math.tan(half);
      // R 尽量取模型的 R5；空间不足时按切线回退量（R/tan(φ/2)）等比缩小，绝不越界
      const R = Math.min(RRET, tTan * (lPrev - 0.3), tTan * (lNext - 0.3));
      if (R >= 0.6 && phi > 0.2 && phi < Math.PI - 0.05) {
        const tLen = R / tTan;
        if (tLen < lPrev && tLen < lNext) {
          const O = add(G, mul(norm(add(tPrev, tNext)), R / Math.sin(half)));
          const Tp = add(G, mul(tPrev, tLen));
          const Tn = add(G, mul(tNext, tLen));
          // 圆弧 Tp→Tn：取更靠近 G 的弧向
          const a1 = Math.atan2(Tp.z - O.z, Tp.x - O.x);
          let a2 = Math.atan2(Tn.z - O.z, Tn.x - O.x);
          let dAng = a2 - a1;
          while (dAng > Math.PI) dAng -= Math.PI * 2;
          while (dAng < -Math.PI) dAng += Math.PI * 2;
          const mid1 = v2(O.x + R * Math.cos(a1 + dAng / 2), O.z + R * Math.sin(a1 + dAng / 2));
          const midG = v2(O.x + R * Math.cos(a1 + dAng / 2 + Math.PI), O.z + R * Math.sin(a1 + dAng / 2 + Math.PI));
          if (Math.hypot(midG.x - G.x, midG.z - G.z) < Math.hypot(mid1.x - G.x, mid1.z - G.z)) dAng = dAng > 0 ? dAng - Math.PI * 2 : dAng + Math.PI * 2;
          const SEG = 8;
          const arc = [];
          for (let s = 1; s < SEG; s++) {
            const aa = a1 + dAng * (s / SEG);
            arc.push(v2(O.x + R * Math.cos(aa), O.z + R * Math.sin(aa)));
          }
          // 用 [Tp, arc…, Tn] 替换 G（保持绕序：prev→G→next）
          const rebuilt = [];
          for (let q = 0; q < poly.length; q++) {
            if (q === (gi - 1 + poly.length) % poly.length) { rebuilt.push(poly[q]); rebuilt.push(Tp); arc.forEach(p => rebuilt.push(p)); rebuilt.push(Tn); continue; }
            if (q === gi) continue;
            rebuilt.push(poly[q]);
          }
          // 上面把 prev 与 Tp 相连：但 Tp 在 prev→G 方向上，顺序为 …prev, Tp, arc, Tn, next…
          // 注意方向：若 prev 是 Tn 一侧会反——统一按「先 Tp（prev 侧）」重建绕序
          poly = rebuilt;
        }
      }
    }
    if (poly.length < 3) continue;
    walks.push({ poly, armI: i, armJ: j });
  }

  return {
    center: C, arms, hull, edges, walks,
    // 挖洞判定：所有边内法线方向至少内缩 GAP_LIP
    insideLip: (p) => edges.every(e => dot(sub(p, e.a), e.n) >= GAP_LIP - 1e-9),
    insideHull: (p) => edges.every(e => dot(sub(p, e.a), e.n) >= -1e-9),
  };
}

/**
 * 曲线落在路口里的参数区间（挖洞源）。
 * 无洞的充要条件：路件端面（刚性直线）整体落在轮廓内。路件按 0.75m 步长出头，
 * 因此「判定」取整条横断面（中心线 ± half）在 t 与 t±0.8m（沿弧长、朝路口方向
 * 各探一步）共 9 个采样点都缩进轮廓内（留 0.05 富余）——第一个露头的采样点
 * 必然连整条断面都还在轮廓里。0.8m 是沿行进方向的退让，对斜弦不放大
 * （垂直内缩会让锐角路口退避 3m、把斑马线埋进路件），任意交角无缝无洞。
 */
export function gapIntervals(curve, plan, half = 0) {
  if (!curve || !plan) return [];
  const L = curve.getLength();
  if (!(L > 0.01)) return [];
  const h = Math.max(0, half) + 0.1;
  const n = Math.max(32, Math.ceil(L / 0.3));
  const dT = 0.8 / L;                               // 沿弧长的前探步（覆盖 0.75 出头步长）
  const EPS_IN = 0.05;
  const pts = curve.getSpacedPoints(n);             // i/n 弧长参数
  const tans = pts.map((_, i) => curve.getTangentAt(i / n).normalize());
  const clearance = (p, tg) => {
    const px = tg.z, pz = -tg.x;
    let s = Infinity;
    for (const e of plan.edges) {
      const centerDist = dot(sub(p, e.a), e.n);
      // T 主路背侧与轮廓共边：真实横断面恰好贴边是合法铺装，不应要求
      // 它再向内缩 0.15m（否则整条主路都没有 gap，侧带横穿支路入口）。
      // 仅放行与道路平行、距离恰为真实半宽的非进口边；其它边仍保留原安全量。
      const sharedSide = !e.mouth && Math.abs(tg.x * e.n.x + tg.z * e.n.z) < 1e-6
        && Math.abs(centerDist - half) < 1e-4;
      const extent = Math.abs(px * e.n.x + pz * e.n.z) * (sharedSide ? half : h);
      s = Math.min(s, centerDist - extent - (sharedSide ? -1e-9 : EPS_IN));
    }
    return s;
  };
  const probe = (i) => clearance(pts[i], tans[i]);
  const inGap = pts.map((_, i) => {
    const ia = Math.max(0, i - Math.round(dT * n));
    const ib = Math.min(n, i + Math.round(dT * n));
    return probe(i) >= -1e-9 && probe(ia) >= -1e-9 && probe(ib) >= -1e-9;
  });
  if (!inGap.some(Boolean)) return [];
  const f = (t) => {
    const clampT = (tt) => Math.max(0, Math.min(1, tt));
    let s = Infinity;
    for (const tt of [t - dT, t, t + dT]) {
      const tc = clampT(tt);
      const p = curve.getPointAt(tc);
      const tg = curve.getTangentAt(tc).normalize();
      s = Math.min(s, clearance(p, tg));
    }
    return s;
  };
  const refine = (tOut, tIn) => {                 // tOut 外 / tIn 内 → 边界
    for (let k = 0; k < 24; k++) {
      const tm = (tOut + tIn) / 2;
      if (f(tm) >= 0) tIn = tm; else tOut = tm;
    }
    return tIn;
  };
  const runs = [];
  let i = 0;
  while (i <= n) {
    if (!inGap[i]) { i++; continue; }
    let j = i;
    while (j + 1 <= n && inGap[j + 1]) j++;
    let t0 = i === 0 ? 0 : refine((i - 1) / n, i / n);
    let t1 = j === n ? 1 : refine((j + 1) / n, j / n);
    const last = runs[runs.length - 1];
    if (last && t0 - last.t1 < 1e-3) last.t1 = t1;
    else runs.push({ t0, t1 });
    i = j + 1;
  }
  return runs.filter(r => r.t1 > r.t0);
}

// --------------------------------------------------------------- 网格构建 --

// 三角带辅助：非索引、按三角形直接铺（computeVertexNormals 得到面法线，棱线清晰）
function pushTri(pos, a, b, c) {
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function geomFrom(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * 生成路口组。外观照抄模型件：车行面（净沥青）、步道角块（顶 0.26、外缘落到
 * 0.04、内缘落差墙到车行面）、R5 回转、大陆斑马线 + 停止线；全组独立材质
 * （不碰共享库材质——polygonOffset 只设在自己的实例上）。
 *
 * 标高策略：路口面 0.10 / 步道 0.26，均低于路件同名面（0.17 / 0.32）——
 * 路件搭接段压在路口之上必赢深度（0.07 / 0.06 真实高差），共面处绝不闪烁。
 */
export function buildJunction(plan, opts = {}) {
  if (!plan) return null;
  const surface = junctionSurface(plan.arms);
  const faceColor = opts.faceColor ?? surface.color;
  const faceRough = opts.faceRough ?? surface.roughness;
  const g = new THREE.Group();
  g.name = 'junction_gen';
  g.userData.surface = surface.id;

  const Y_FACE = 0.10, Y_WALK = 0.26, Y_MARK = 0.12, Y_BOT = 0.04;
  const matFace = new THREE.MeshStandardMaterial({
    color: faceColor, roughness: faceRough, metalness: 0.02, side: THREE.DoubleSide,
    // 水面巨型三角掠射角反超深度（LEQUAL 平局水后画赢）：负偏移把路口面拉向相机破平局
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  const matWalk = new THREE.MeshStandardMaterial({ color: 0xc8c3b7, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    // 与底面使用相同的深度偏移，否则远景量化误差会让底面反盖高出的步道。
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const matCurb = new THREE.MeshStandardMaterial({ color: 0xb0aca4, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const matMark = new THREE.MeshStandardMaterial({
    color: 0xf5f4ef, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });

  const C = { x: plan.center.x, y: 0, z: plan.center.z };
  const P = (p, y) => new THREE.Vector3(p.x, y, p.z);

  // —— 1. 车行面：真实减去步道，而不是依赖 polygonOffset 在重叠面之间决胜。
  // 600m 斜视时，斜率偏移与深度量化会让较低底面反盖步道。保持高度 / 相机 /
  // 材质不变，用整数布尔运算消除这层重叠（含边界相连和内部孔洞）。
  {
    const scale = 100000;
    const path = poly => {
      const p = poly.map(v => ({ X: Math.round(v.x * scale), Y: Math.round(v.z * scale) }));
      if (!ClipperLib.Clipper.Orientation(p)) p.reverse();
      return p;
    };
    const clip = new ClipperLib.Clipper(), tree = new ClipperLib.PolyTree();
    clip.StrictlySimple = true;
    clip.AddPath(path(plan.hull), ClipperLib.PolyType.ptSubject, true);
    clip.AddPaths(plan.walks.map(w => path(w.poly)), ClipperLib.PolyType.ptClip, true);
    clip.Execute(ClipperLib.ClipType.ctDifference, tree,
      ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const pos = [];
    // Remove sub-20μm rounding spikes on shared hull/walk edges before earcut.
    const ring = node => ClipperLib.Clipper.CleanPolygon(node.Contour(), 2).map(p => new THREE.Vector2(p.X / scale, p.Y / scale));
    const emit = node => {
      if (!node.IsHole()) {
        const outer = ring(node), holes = node.Childs().map(ring);
        const triangles = THREE.ShapeUtils.triangulateShape(outer, holes);
        const vertices = outer.concat(...holes);
        for (const tri of triangles) {
          const pts = tri.map(i => P({ x: vertices[i].x, z: vertices[i].y }, Y_FACE));
          if (new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0])).y < 0) pts.reverse();
          pushTri(pos, ...pts);
        }
      }
      node.Childs().forEach(emit);
    };
    tree.Childs().forEach(emit);
    const m = new THREE.Mesh(geomFrom(pos), matFace);
    m.name = 'junction_face';
    g.add(m);
  }

  // 判定某条边是否压在轮廓边上（|法向距离|≈0 且投影在段内）
  const onHullEdge = (a, b) => {
    for (let k = 0; k < plan.edges.length; k++) {
      const e = plan.edges[k];
      if (Math.abs(dot(sub(a, e.a), e.n)) > 1e-4 || Math.abs(dot(sub(b, e.a), e.n)) > 1e-4) continue;
      const ab = sub(e.b, e.a);
      const la = len(ab);
      if (la < 1e-9) continue;
      const pa = dot(sub(a, e.a), ab) / la, pb = dot(sub(b, e.a), ab) / la;
      const lo = Math.min(pa, pb), hi = Math.max(pa, pb);
      if (hi > -0.05 && lo < la + 0.05) return e;
    }
    return null;
  };

  // —— 2. 步道角块：顶面 + 内缘落差墙（落到车行面）
  plan.walks.forEach((wk, wi) => {
    const poly = wk.poly;
    if (poly.length < 3) return;
    const pos = [];
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a.x * b.z - b.x * a.z;
    }
    const ccw = area > 0;
    // 顶面
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      if (ccw) pushTri(pos, P(a, Y_WALK), P(c, Y_WALK), P(b, Y_WALK));
      else pushTri(pos, P(a, Y_WALK), P(b, Y_WALK), P(c, Y_WALK));
    }
    const top = new THREE.Mesh(geomFrom(pos), matWalk);
    top.name = `junction_walk_${wi}`;
    top.renderOrder = 1; // 远景同深度量化时，步道在底面之后提交
    g.add(top);

    // 内缘落差墙（不在轮廓上的边 = 与车行面的交界）
    const wp = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (onHullEdge(a, b)) continue;
      pushTri(wp, P(a, Y_WALK), P(a, Y_FACE), P(b, Y_FACE));
      pushTri(wp, P(a, Y_WALK), P(b, Y_FACE), P(b, Y_WALK));
    }
    if (wp.length) {
      const m = new THREE.Mesh(geomFrom(wp), matCurb);
      m.name = `junction_step_${wi}`;
      g.add(m);
    }
  });

  // —— 2b. 外缘墙：沿轮廓整圈（含口部——口部段被路件搭接段盖住顶视，
  //         但能挡住低机位从路件端面下沿看进来的视线），上沿按覆盖取值：
  //         步道覆盖段 0.26→0.04，车行面段 0.10→0.04。
  {
    const inWalk = (p) => plan.walks.some((wk) => {
      const poly = wk.poly;
      if (poly.length < 3) return false;
      let pos = false, neg = false;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const cr = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
        if (cr > 1e-6) pos = true;
        if (cr < -1e-6) neg = true;
        if (pos && neg) return false;
      }
      return true;
    });
    const segs = [];   // { a, b, yTop }
    for (const e of plan.edges) {
      const el = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      if (el < 1e-6) continue;
      // 断点 = 落在本边上的步道顶点投影 + 两端
      const breaks = [0, 1];
      for (const wk of plan.walks) {
        for (const p of wk.poly) {
          const t = ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.z - e.a.z) * (e.b.z - e.a.z)) / (el * el);
          if (t <= 1e-4 || t >= 1 - 1e-4) continue;
          const px = e.a.x + (e.b.x - e.a.x) * t, pz = e.a.z + (e.b.z - e.a.z) * t;
          if (Math.hypot(px - p.x, pz - p.z) < 1e-4) breaks.push(t);
        }
      }
      breaks.sort((x, y) => x - y);
      for (let i = 0; i < breaks.length - 1; i++) {
        const t0 = breaks[i], t1 = breaks[i + 1];
        if (t1 - t0 < 1e-6) continue;
        const mid = { x: e.a.x + (e.b.x - e.a.x) * (t0 + t1) / 2, z: e.a.z + (e.b.z - e.a.z) * (t0 + t1) / 2 };
        const yTop = inWalk(mid) ? Y_WALK : Y_FACE;
        // 口部墙落到 0：路件端面架空 0.02，低机位会从端面下沿看进水面——
        // 口部墙贴地把这条视线堵死（其它外缘仍收在 0.04，避开水面共面）
        const yBot = e.mouth ? 0 : Y_BOT;
        segs.push({
          a: { x: e.a.x + (e.b.x - e.a.x) * t0, z: e.a.z + (e.b.z - e.a.z) * t0 },
          b: { x: e.a.x + (e.b.x - e.a.x) * t1, z: e.a.z + (e.b.z - e.a.z) * t1 },
          yTop, yBot,
        });
      }
    }
    const wp = [];
    for (const s of segs) {
      pushTri(wp, P(s.a, s.yTop), P(s.a, s.yBot), P(s.b, s.yBot));
      pushTri(wp, P(s.a, s.yTop), P(s.b, s.yBot), P(s.b, s.yTop));
    }
    if (wp.length) {
      const m = new THREE.Mesh(geomFrom(wp), matCurb);
      m.name = 'junction_outerwall';
      g.add(m);
    }
  }

  // —— 3. 标线：每臂大陆斑马线 + 停止线（只属于路口，路件标线到挖洞边为止，单一属主）
  //    浅角交叠：两臂斑马的条互穿会织成菱形网（两组白条间的黑底菱块，像坏图）——
  //    相交的两根条只留臂序靠前的一根，避免两组标线共面交织。
  // 斑马线只铺在最终采用沥青的路口面上。混合路口统一铺装后，各进口的
  // 斑马均在路口面内；非沥青路口不生成斑马，停止线仍走原有规则。
  const barsByArm = plan.arms.map((a) => {
    if (!surface.asphalt) return [];
    const c = a.c ?? (a.pav + MOUTH_EXTRA);
    const d = a.dir, Pd = perp(d);
    const align = Math.atan2(d.x, d.z);           // 局部 +Z 对齐臂方向
    const zebraSpan = 2 * Math.max(1, a.pav - 0.3);
    const zc = c - 2.8;                           // 斑马中心：外沿距断面 1.6，避让路件搭接
    const n = Math.max(4, Math.round(zebraSpan / 1.05));
    const bars = [];
    for (let i = 0; i < n; i++) {
      const o = -zebraSpan / 2 + 0.45 + i * ((zebraSpan - 0.9) / Math.max(1, n - 1));
      const ctr = add(add(C, mul(d, zc)), mul(Pd, o));
      bars.push({ w: 0.45, l: 2.4, ctr, align, y: Y_MARK });
    }
    return bars;
  });
  // 旋转矩形相交（分离轴：4 轴全重叠才算撞）；盒轴：局部 x=(ca,−sa)、z=(sa,ca)
  const barHit = (A, B) => {
    const Ax = [Math.cos(A.align), -Math.sin(A.align)], Az = [Math.sin(A.align), Math.cos(A.align)];
    const Bx = [Math.cos(B.align), -Math.sin(B.align)], Bz = [Math.sin(B.align), Math.cos(B.align)];
    const dc = [B.ctr.x - A.ctr.x, B.ctr.z - A.ctr.z];
    const axes = [Ax, Az, Bx, Bz];
    for (const u of axes) {
      const d0 = Math.abs(dc[0] * u[0] + dc[1] * u[1]);
      const ra = (A.w / 2) * Math.abs(Ax[0] * u[0] + Ax[1] * u[1]) + (A.l / 2) * Math.abs(Az[0] * u[0] + Az[1] * u[1]);
      const rb = (B.w / 2) * Math.abs(Bx[0] * u[0] + Bx[1] * u[1]) + (B.l / 2) * Math.abs(Bz[0] * u[0] + Bz[1] * u[1]);
      if (d0 > ra + rb + 1e-6) return false;
    }
    return true;
  };
  const marks = [];
  barsByArm.forEach((bars, ai) => {
    for (const bar of bars) {
      let drop = false;
      for (let bj = 0; bj < ai && !drop; bj++) {
        for (const other of barsByArm[bj]) if (barHit(bar, other)) { drop = true; break; }
      }
      if (!drop) marks.push(bar);
    }
  });
  g.userData.crosswalkBars = marks.length;
  plan.arms.forEach((a) => {
    const c = a.c ?? (a.pav + MOUTH_EXTRA);
    const d = a.dir;
    const align = Math.atan2(d.x, d.z);
    // 停止线：臂方向左侧半幅（照抄模型 side=(dz,−dx) 规则），位于斑马内沿再进 0.6
    if (a.pav - 0.5 > 0.4) {
      const side = v2(d.z, -d.x);
      const spanL = a.pav - 0.5;
      const ctr = add(add(C, mul(d, c - 4.6)), mul(side, (0.2 + a.pav - 0.3) / 2));
      marks.push({ w: spanL, l: 0.6, ctr, align, y: Y_MARK });
    }
  });
  g.userData.stopLines = marks.length - g.userData.crosswalkBars;
  if (marks.length) {
    const pos = [];
    for (const mk of marks) {
      // 盒四角（局部 x=宽、z=长）→ 世界（绕 Y 对齐臂方向）
      const ca = Math.cos(mk.align), sa = Math.sin(mk.align);
      const toW = (lx, lz) => new THREE.Vector3(
        mk.ctr.x + lx * ca + lz * sa,
        mk.y,
        mk.ctr.z - lx * sa + lz * ca,
      );
      const hw = mk.w / 2, hl = mk.l / 2;
      const p00 = toW(-hw, -hl), p10 = toW(hw, -hl), p11 = toW(hw, hl), p01 = toW(-hw, hl);
      const yT = mk.y + 0.01, yB = mk.y - 0.01;
      const top = [p00, p10, p11, p01].map(p => new THREE.Vector3(p.x, yT, p.z));
      pushTri(pos, top[0], top[1], top[2]);
      pushTri(pos, top[0], top[2], top[3]);
      const bot = [p00, p10, p11, p01].map(p => new THREE.Vector3(p.x, yB, p.z));
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        pushTri(pos, top[e], bot[e], bot[f]);
        pushTri(pos, top[e], bot[f], top[f]);
      }
    }
    const m = new THREE.Mesh(geomFrom(pos), matMark);
    m.name = 'junction_markings';
    g.add(m);
  }

  return g;
}
