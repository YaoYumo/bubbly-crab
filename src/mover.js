// ---------------------------------------------------------------------------
// 关键帧路径：摄像机与人物共用
// key = { t:0..1, p:[x,y,z], q:[x,y,z,w]|null, f:hfov|null }
//
// 平滑策略（默认，解决「到关键帧就一顿」）：
//   · 位置：Catmull-Rom 样条（C1 连续）+ 按**弧长**推进 → 每段速度一致、过节点不减速
//   · 朝向：把每个关键帧的前方/上方向量也做成样条 → 摇镜/俯仰连续，不会逐段 slerp 归零
//   · 视场：单调三次插值（不会过冲）
//   · 缓动：默认作用于**整条曲线**（也可退回逐段缓动）；或用「进度曲线」手动改
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, EASE } from './util.js';
import { evalCurve, normalizePts } from './curve.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const BACK = new THREE.Vector3(0, 0, 1);
const _out3 = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };

export const DEFAULT_MOTION = {
  ease: 'linear',       // 整条曲线的缓动类型（机位默认 inOut，物体走位默认匀速）
  scope: 'global',      // 'global' 整段缓动 | 'segment' 逐段缓动（会在每个关键帧停顿）
  arc: true,            // 按弧长匀速推进
  tension: 0.5,         // 样条张力：0=直线感，1=大幅度绕
  rot: 'spline',        // 'spline' 朝向连续 | 'slerp' 逐段插值
};

export class Mover {
  constructor(keys = [], closed = false, opts = {}) {
    const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
    this.keys = (keys || []).map((k) => ({
      t: fin(k.t, 0),
      p: [fin(k.p?.[0]), fin(k.p?.[1]), fin(k.p?.[2])],
      q: k.q && k.q.every((v) => Number.isFinite(v)) ? [...k.q] : null,
      f: k.f == null || !Number.isFinite(k.f) ? null : k.f,
    }));
    this.closed = closed;
    this.opts = { ...DEFAULT_MOTION, ...(opts || {}) };
    this.curve = null;
    this.rotCurve = null;
    this.upCurve = null;
    this.fovPts = null;
    this._cum = null;
    this._total = 0;
    this.rebuild();
  }
  get count() { return this.keys.length; }
  sort() {
    this.keys.sort((x, y) => x.t - y.t);
    // 时间重合会导致除零/段长为 0，最小间隔 1ms（归一化）
    for (let i = 1; i < this.keys.length; i++) {
      if (this.keys[i].t - this.keys[i - 1].t < 1e-3) this.keys[i].t = Math.min(1, this.keys[i - 1].t + 1e-3);
    }
  }
  setOpt(k, v) {
    this.opts[k] = v;
    if (k === 'tension' || k === 'arc' || k === 'rot') this.rebuild();
  }
  rebuild() {
    this.sort();
    const o = this.opts;
    this.curve = null; this.rotCurve = null; this.upCurve = null; this.fovPts = null;
    this._cum = null; this._total = 0;
    const n = this.keys.length;
    if (n < 2) return;

    const pts = this.keys.map((k) => new THREE.Vector3(k.p[0], k.p[1], k.p[2]));
    const uniq = new Set(this.keys.map((k) => k.p.map((v) => v.toFixed(2)).join(',')));
    if (uniq.size >= 2) {
      const c = new THREE.CatmullRomCurve3(pts, this.closed, 'catmullrom', clamp(o.tension ?? 0.5, 0, 1));
      let ok = true;
      const probe = new THREE.Vector3();
      for (let i = 0; i <= 6; i++) {
        c.getPoint(i / 6, probe);
        if (!Number.isFinite(probe.x) || !Number.isFinite(probe.y) || !Number.isFinite(probe.z)) { ok = false; break; }
      }
      if (ok) {
        this.curve = c;
        if (o.arc !== false) this._buildArc(c);
      }
    }

    // 朝向：把每个关键帧的 forward / up 变成两条向量样条
    const withQ = this.keys.filter((k) => k.q);
    if (o.rot === 'spline' && withQ.length >= 3 && withQ.length === n) {
      const fwds = [], ups = [];
      for (const k of this.keys) {
        const q = _q1.set(k.q[0], k.q[1], k.q[2], k.q[3]);
        const f = BACK.clone().applyQuaternion(q.clone()).negate(); // 相机看 -Z
        const u = UP.clone().applyQuaternion(q.clone());
        if (f.y < -0.999) f.y = -0.999; // 避免 lookAt 与 up 平行退化
        fwds.push(f.normalize()); ups.push(u.normalize());
      }
      // 方向翻转（>90°）时翻转符号，避免样条绕远路
      for (let i = 1; i < fwds.length; i++) {
        if (fwds[i].dot(fwds[i - 1]) < 0) { fwds[i].negate(); ups[i].negate(); }
      }
      const fc = new THREE.CatmullRomCurve3(fwds, this.closed, 'catmullrom', clamp(o.tension ?? 0.5, 0, 1));
      const uc = new THREE.CatmullRomCurve3(ups, this.closed, 'catmullrom', clamp(o.tension ?? 0.5, 0, 1));
      let ok = true;
      const pv = new THREE.Vector3();
      for (let i = 0; i <= 8; i++) {
        fc.getPoint(i / 8, pv);
        if (!Number.isFinite(pv.x) || !Number.isFinite(pv.y) || !Number.isFinite(pv.z) || pv.lengthSq() < 1e-6) { ok = false; break; }
      }
      if (ok) { this.rotCurve = fc; this.upCurve = uc; }
    }

    // 视场：单调三次
    if (this.keys.some((k) => k.f != null)) {
      const fp = normalizePts(this.keys.map((k, i) => ({ x: k.t, y: k.f == null ? this._nearestF(i) : k.f, mode: 'auto' })));
      this.fovPts = fp;
    }
  }
  _nearestF(i) {
    for (let d = 1; d < this.keys.length; d++) {
      if (this.keys[i - d]?.f != null) return this.keys[i - d].f;
      if (this.keys[i + d]?.f != null) return this.keys[i + d].f;
    }
    return 50;
  }
  /** 弧长表：每个关键帧处的累计长度，用于匀速推进 */
  _buildArc(c) {
    const n = this.keys.length;
    const div = Math.max(96, 64 * (n - 1));
    c.arcLengthDivisions = div;
    const lens = c.getLengths(div);
    this._total = lens[lens.length - 1] || 0;
    if (this._total <= 1e-6) { this._cum = null; return; }
    const div1 = this.closed ? n : n - 1;
    this._cum = [];
    for (let i = 0; i < n; i++) {
      const idx = clamp(Math.round((i / div1) * div), 0, div);
      this._cum.push(lens[idx]);
    }
    if (!this.closed) this._cum[n - 1] = this._total;
  }
  /** 参数 t（0..1，按关键帧段内比例） → 弧长均匀化的曲线参数 */
  _paraT(seg, local) {
    if (!this._cum || !this.curve) return clamp((seg + local) / (this.closed ? this.keys.length : this.keys.length - 1), 0, 1);
    const a = this._cum[seg] ?? 0;
    const b = this._cum[Math.min(seg + 1, this._cum.length - 1)] ?? this._total;
    const want = clamp(a + (b - a) * local, 0, this._total) / this._total;
    return clamp(this.curve.getUtoTmapping(want), 0, 1);
  }

  /** 按弧长重排各关键帧的时间：让「匀速」真正成立（首尾时间不动） */
  retimeByArc() {
    const n = this.keys.length;
    if (n < 3) return null;
    const cum = [0];
    for (let i = 1; i < n; i++) {
      const a = this.keys[i - 1].p, b = this.keys[i].p;
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = cum[n - 1];
    if (!(total > 1e-6)) return null;
    const t0 = this.keys[0].t ?? 0, t1 = this.keys[n - 1].t ?? 1;
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * (cum[i] / total);
      this.keys[i].t = Math.min(1, Math.max(0, i === n - 1 ? t1 : t));
      if (this.keys[i].u != null) this.keys[i].u = this.keys[i].t;
    }
    this.rebuild();
    return { total, spread: this.keys.map((k) => +k.t.toFixed(4)) };
  }

  addKey(key) { this.keys.push(key); this.rebuild(); }
  removeKey(i) { this.keys.splice(i, 1); this.rebuild(); }
  clear() { this.keys = []; this.curve = null; this.rotCurve = null; this.upCurve = null; this.fovPts = null; this._cum = null; }

  /** u: 0..1 → { p, q, f }（out 可复用） */
  sample(u, out = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null }, ease = 'linear', opts = {}) {
    const n = this.keys.length;
    if (!n) return null;
    const o = { ...this.opts, ...(opts || {}) };
    if (n === 1) {
      const k = this.keys[0];
      out.p.set(k.p[0], k.p[1], k.p[2]);
      if (k.q) out.q.set(k.q[0], k.q[1], k.q[2], k.q[3]); else out.q.identity();
      out.f = k.f;
      return out;
    }
    // 1) 时间 → 进度（曲线优先；否则整段缓动）
    let x = clamp(u, 0, 1);
    if (o.progCurve) x = clamp(evalCurve(o.progCurve, x, { clampY: [0, 1] }), 0, 1);
    else if (o.scope !== 'segment') x = clamp((EASE[o.ease] || EASE.linear)(x), 0, 1);

    // 2) 找到所在段
    let i = 0;
    for (; i < n - 1; i++) if (x <= this.keys[i + 1].t || i === n - 2) break;
    const k0 = this.keys[i], k1 = this.keys[Math.min(i + 1, n - 1)];
    const span = Math.max(1e-6, k1.t - k0.t);
    const raw = clamp((x - k0.t) / span, 0, 1);
    const local = o.scope === 'segment' ? (EASE[o.ease] || EASE.linear)(raw) : raw;

    // 3) 位置
    if (this.curve) this.curve.getPoint(this._paraT(i, local), out.p);
    else {
      _a.set(k0.p[0], k0.p[1], k0.p[2]);
      _b.set(k1.p[0], k1.p[1], k1.p[2]);
      out.p.lerpVectors(_a, _b, local);
    }

    // 4) 朝向
    if (this.rotCurve && this.upCurve && o.rot !== 'slerp') {
      const t = this._paraT(i, local);
      this.rotCurve.getPoint(t, _b);
      this.upCurve.getPoint(t, _a);
      if (_b.lengthSq() > 1e-6) {
        _b.normalize();
        _z.copy(_b).negate();                       // 相机 -Z 朝前方
        _x.crossVectors(_a, _z);
        if (_x.lengthSq() < 1e-8) _x.crossVectors(UP, _z);
        _x.normalize();
        _y.crossVectors(_z, _x).normalize();
        _m.makeBasis(_x, _y, _z);
        out.q.setFromRotationMatrix(_m);
      } else if (k0.q && k1.q) {
        _q1.set(k0.q[0], k0.q[1], k0.q[2], k0.q[3]);
        _q2.set(k1.q[0], k1.q[1], k1.q[2], k1.q[3]);
        out.q.slerpQuaternions(_q1, _q2, local);
      }
    } else if (k0.q && k1.q) {
      _q1.set(k0.q[0], k0.q[1], k0.q[2], k0.q[3]);
      _q2.set(k1.q[0], k1.q[1], k1.q[2], k1.q[3]);
      out.q.slerpQuaternions(_q1, _q2, local);
    } else if (k0.q) out.q.set(k0.q[0], k0.q[1], k0.q[2], k0.q[3]);
    else if (k1.q) out.q.set(k1.q[0], k1.q[1], k1.q[2], k1.q[3]);
    else out.q.identity();

    // 5) 视场（水平角度，度）
    if (this.fovPts) out.f = evalCurve(this.fovPts, x);
    else {
      const f0 = k0.f, f1 = k1.f;
      out.f = f0 != null && f1 != null ? f0 + (f1 - f0) * local : f0 ?? f1 ?? null;
    }
    return out;
  }

  /** 路径切线（用于人物自动朝向） */
  tangent(u, out = new THREE.Vector3()) {
    const n = this.keys.length;
    if (n < 2) return out.set(0, 0, 1);
    if (this.curve) {
      this.curve.getTangent(clamp(u, 0, 0.9999), out);
      if (Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z) && out.lengthSq() > 1e-9) return out.normalize();
    }
    const i = clamp(Math.floor(u * (n - 1)), 0, n - 2);
    out.set(this.keys[i + 1].p[0] - this.keys[i].p[0], this.keys[i + 1].p[1] - this.keys[i].p[1], this.keys[i + 1].p[2] - this.keys[i].p[2]);
    return out.lengthSq() ? out.normalize() : out.set(0, 0, 1);
  }

  /** 归一化速度（0..1 相对平均速度的倍数）：给曲线编辑器画速度条 / 体检「有没有停顿」 */
  /**
   * 相对速度（1 = 全程平均）。
   * effective=true（默认）：包含缓动与进度曲线，即「观众实际看到的快慢」——
   *   旧版逐段缓动会在关键帧处掉到 ~0，这就是「停顿」。
   * effective=false：只看路径几何（匀速程度），用来判断是否需要「按弧长重排时间」。
   */
  speedAt(u, opts = {}, effective = true) {
    const n = this.keys.length;
    if (n < 2 || !this.curve) return 1;
    const h = 1 / 90;
    const so = effective ? { ...opts } : { progCurve: null, ...opts, scope: 'segment', ease: 'linear' };
    const at = (t) => this.sample(clamp(t, 0, 1), { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null }, 'linear', so);
    // 端点用单侧差分，否则两点被边界截断会「测出来慢一半」
    let a, b, span;
    if (u < h) { a = at(u); b = at(u + 2 * h); span = 2 * h; }
    else if (u > 1 - h) { a = at(u - 2 * h); b = at(u); span = 2 * h; }
    else { a = at(u - h); b = at(u + h); span = 2 * h; }
    const d = a.p.distanceTo(b.p) / span;
    const avg = this._total || this.curve.getLength();
    return avg > 1e-6 ? d / avg : 1;
  }

  /** 逐帧体检：返回每个关键帧处的速度相对值（≈1 表示过节点不减速） */
  velocityProfile(samples = 60, opts = {}, effective = true) {
    const out = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      out.push({ u, v: this.speedAt(u, opts, effective) });
    }
    return out;
  }

  toJSON() {
    return {
      closed: this.closed,
      opts: { ease: this.opts.ease, scope: this.opts.scope, arc: this.opts.arc, tension: this.opts.tension, rot: this.opts.rot },
      keys: this.keys.map((k) => ({
        t: +k.t.toFixed(4),
        p: k.p.map((v) => +v.toFixed(3)),
        q: k.q ? k.q.map((v) => +v.toFixed(5)) : null,
        f: k.f == null ? null : +k.f.toFixed(2),
      })),
    };
  }
}

export { _out3 };
