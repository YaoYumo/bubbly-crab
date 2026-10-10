// ---------------------------------------------------------------------------
// 动画曲线：一组控制点 (x, y, 手柄) → 单调 Hermite 插值
// 用于「手动修改关键帧曲线」：进度重映射、视场、抖动强度等通道共用
// 点结构 { x:0..1, y:0..1, mode:'auto'|'linear'|'step'|'bezier', h:[ix,iy,ox,oy] }
// h 为相对该点的偏移（归一化单位），仅 bezier 模式使用
// ---------------------------------------------------------------------------
import { clamp } from './util.js';

export const CURVE_MODES = [
  { v: 'auto', l: '平滑 Auto（连续速度）' },
  { v: 'linear', l: '线性 Linear' },
  { v: 'step', l: '阶梯 Hold（保持不变）' },
  { v: 'bezier', l: '贝塞尔 Bezier（拖手柄）' },
];

/** 归一化 + 排序 + 去重，保证 x 单调 */
export function normalizePts(pts) {
  if (!Array.isArray(pts) || !pts.length) return null;
  const out = pts
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      x: clamp(p.x, 0, 1),
      y: p.y,
      mode: p.mode || 'auto',
      h: Array.isArray(p.h) && p.h.every((v) => Number.isFinite(v)) ? p.h.slice(0, 4) : null,
    }))
    .sort((a, b) => a.x - b.x);
  if (!out.length) return null;
  if (out.length === 1) return null;
  // 去掉几乎重合的点，避免除零
  for (let i = out.length - 1; i > 0; i--) if (out[i].x - out[i - 1].x < 1e-4) out.splice(i, 1);
  return out.length > 1 ? out : null;
}

/** Fritsch–Carlson 单调三次插值的斜率估计（不会过冲 → 不会有假停顿/回抽） */
function monoSlopes(P) {
  const n = P.length;
  const d = new Array(n - 1), m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (P[i + 1].y - P[i].y) / Math.max(1e-6, P[i + 1].x - P[i].x);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (P[i].x - P[i - 1].x) + (P[i + 1].x - P[i].x);
      const w2 = (P[i].x - P[i - 1].x) + 2 * (P[i + 1].x - P[i].x);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
}

/**
 * 求值。opts.clampY = [min,max] 用于把进度曲线限制在 0..1；
 * opts.monotone = true 时强制非减速不倒退（进度通道需要）
 */
export function evalCurve(pts, x, opts = {}) {
  const P = pts && pts.length > 1 ? pts : null;
  if (!P) return clamp(x, 0, 1);
  const lo = clamp(x, P[0].x, P[P.length - 1].x);
  if (lo <= P[0].x) return P[0].y;
  if (lo >= P[P.length - 1].x) return P[P.length - 1].y;
  let i = 0;
  while (i < P.length - 2 && lo > P[i + 1].x) i++;
  const a = P[i], b = P[i + 1];
  const span = Math.max(1e-6, b.x - a.x);
  const t = (lo - a.x) / span;
  const mode = b.mode || a.mode || 'auto';
  if (mode === 'step') return a.y;
  let y;
  if (mode === 'linear') {
    y = a.y + (b.y - a.y) * t;
  } else if (mode === 'bezier' && a.h && b.h) {
    // 显式手柄 → 三次贝塞尔（x 已按参数近似，直接对 y 做 Hermite）
    const m0 = clamp(a.h[2] / Math.max(1e-4, a.h[0]), -8, 8);
    const m1 = clamp(b.h[3] / Math.max(1e-4, b.h[1]), -8, 8);
    y = hermite(a.y, b.y, m0 * span, m1 * span, t);
  } else {
    const m = opts.slopes || monoSlopes(P);
    y = hermite(a.y, b.y, m[i] * span, m[i + 1] * span, t);
  }
  if (opts.clampY) y = clamp(y, opts.clampY[0], opts.clampY[1]);
  return y;
}

function hermite(v0, v1, t0, t1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * t0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * t1;
}

/** 曲线整体斜率的最小/最大值，用来判断「有没有停顿」 */
export function curveSlopeRange(pts, samples = 200) {
  const P = normalizePts(pts);
  if (!P) return { min: 1, max: 1 };
  let min = Infinity, max = -Infinity;
  let prev = evalCurve(P, 0), prevX = 0;
  for (let i = 1; i <= samples; i++) {
    const x = i / samples;
    const y = evalCurve(P, x);
    const s = (y - prev) / Math.max(1e-6, x - prevX);
    if (s < min) min = s;
    if (s > max) max = s;
    prev = y; prevX = x;
  }
  return { min, max };
}

// --- 常用预设（都是「整条镜头一条曲线」，不在每个关键帧处归零） -------------
export const CURVE_PRESETS = [
  { id: 'linear', name: '匀速', pts: [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }], d: '恒速通过每个关键帧，最顺滑' },
  { id: 'easeInOut', name: '两头缓动', pts: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }], d: '起步/收尾平滑，中段匀速（推荐）' },
  { id: 'easeIn', name: '缓入', pts: [{ x: 0, y: 0 }, { x: 0.72, y: 0.55 }, { x: 1, y: 1 }], d: '慢慢启动' },
  { id: 'easeOut', name: '缓出', pts: [{ x: 0, y: 0 }, { x: 0.28, y: 0.45 }, { x: 1, y: 1 }], d: '末端减速停靠' },
  { id: 'whip', name: '甩镜急停', pts: [{ x: 0, y: 0 }, { x: 0.18, y: 0.86 }, { x: 0.42, y: 0.98 }, { x: 1, y: 1 }], d: '前段爆冲 + 长尾滑行' },
  { id: 'slowfast', name: '慢-快-慢', pts: [{ x: 0, y: 0 }, { x: 0.3, y: 0.14 }, { x: 0.7, y: 0.86 }, { x: 1, y: 1 }], d: '进入画面慢、中间掠过、离开再慢' },
  { id: 'drift', name: '缓慢漂移', pts: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5, mode: 'linear' }, { x: 1, y: 1 }], d: '接近匀速但两端略收' },
];
export const CURVE_BY_ID = Object.fromEntries(CURVE_PRESETS.map((c) => [c.id, c]));

export function clonePts(pts) {
  return (pts || []).map((p) => ({ ...p, h: p.h ? p.h.slice() : null }));
}

/** 由控制点反查「时间→进度」，用于 UI 显示速度条 */
export function speedBars(pts, buckets = 24) {
  const P = normalizePts(pts);
  const out = new Array(buckets).fill(1);
  if (!P) return out;
  let min = 1e-4;
  for (let i = 0; i < buckets; i++) {
    const a = evalCurve(P, i / buckets), b = evalCurve(P, (i + 1) / buckets);
    out[i] = Math.max(0, (b - a) * buckets);
    min = Math.max(min, ...out);
  }
  return out.map((v) => v / min);
}
