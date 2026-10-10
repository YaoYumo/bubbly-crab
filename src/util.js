// ---------------------------------------------------------------------------
// 通用工具：DOM 构建、数学、缓动、下载、释放
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const norm = (v, a, b) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const snap = (v, s) => (s > 0 ? Math.round(v / s) * s : v);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

let _id = 0;
export const uid = (p = 'o') => `${p}${(++_id).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const EASE = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  smooth: (t) => t * t * (3 - 2 * t),
};
export const EASE_OPTIONS = [
  { v: 'linear', l: '匀速 Linear' },
  { v: 'in', l: '缓入 Ease In' },
  { v: 'out', l: '缓出 Ease Out' },
  { v: 'inOut', l: '缓入缓出' },
  { v: 'smooth', l: '平滑 Smooth' },
  { v: 'expo', l: '急停 Exponential' },
];

export function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  const n = Number(v);
  return n.toFixed(d).replace(/\.?0+$/, (m) => (m.length && d > 0 ? m : ''));
}

/** 轻量 DOM 构造 */
export function el(tag, props = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of [].concat(kids)) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return e;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

/** 递归释放几何体/材质/贴图 */
export function disposeDeep(root) {
  root.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose?.();
      m.dispose?.();
    }
  });
}

export function removeDeep(root) {
  root.parent?.remove(root);
  disposeDeep(root);
}

/** 确定性伪随机（同一 seed 每次结果一致，保证工程可复现） */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 平滑噪声，用于手持晃动 */
export function smoothNoise(i, seed = 0) {
  const h = (n) => {
    let x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const f = Math.floor(i);
  const t = i - f;
  const a = h(f), b = h(f + 1);
  const u = t * t * (3 - 2 * t);
  return (a - 0.5) * (1 - u) + (b - 0.5) * u;
}

export function copy(o, d = 1) {
  return JSON.parse(JSON.stringify(o));
}

export function busMake() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, data) {
      map.get(evt)?.forEach((f) => {
        try { f(data); } catch (e) { console.error('[bus]', evt, e); }
      });
    },
  };
}

export function timecode(s, fps = 24) {
  const total = Math.max(0, s);
  const ss = Math.floor(total % 60);
  const mm = Math.floor(total / 60) % 60;
  const ff = Math.floor((total % 1) * fps);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

export function prettyVec(v, d = 1) {
  return `${fmt(v.x, d)}, ${fmt(v.y, d)}, ${fmt(v.z, d)}`;
}
