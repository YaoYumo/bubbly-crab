// ---------------------------------------------------------------------------
// 曲线编辑器：手动改「时间 → 进度」缓动曲线、逐关键帧视场、抖动强度曲线
// 底部抽屉（V 键 / 时间轴「曲线」按钮），画在 canvas 上，纯手写无依赖
// ---------------------------------------------------------------------------
import { el, clamp, fmt } from './util.js';
import { CURVE_PRESETS, evalCurve, normalizePts, clonePts } from './curve.js';
import { EASE } from './util.js';

const CH = {
  prog: { l: '运动进度', sub: '时间 → 路径进度（斜率=速度）', y0: 0, y1: 1 },
  fov: { l: '视场 / 焦距', sub: '逐关键帧水平视角（度）', y0: 8, y1: 130 },
  shake: { l: '手持强度', sub: '0 = 三脚架，1 = 明显晃动', y0: 0, y1: 1 },
};
const PAD = { l: 44, r: 14, t: 16, b: 26 };

export function buildCurveEditor(app, host) {
  const root = el('div', { class: 'curve' });
  const state = { ch: 'prog', open: false, drag: null };
  const bar = el('div', { class: 'cv-bar' });
  const cvs = el('canvas', { class: 'cv-canvas' });
  const tip = el('div', { class: 'cv-tip', text: '拖动圆点改缓动 · 双击切换平滑/线性/阶梯 · Alt+拖动拉手柄 · 右键删除 · 空白处单击加控制点' });
  root.append(bar, cvs, tip);
  host.appendChild(root);
  const g = cvs.getContext('2d');

  // ---------------- 目标（机位优先；选中物体走位也可编） ---------------------
  function target() {
    if (app.sel?.kind === 'obj' && app.sel.so?.motion?.keys?.length > 1) return { kind: 'obj', so: app.sel.so };
    const s = app.selShot || app.activeShot;
    return s ? { kind: 'shot', shot: s } : null;
  }
  function pts() {
    const t = target();
    if (!t) return [];
    if (t.kind === 'obj') return t.so.motion.curve || [];
    const c = t.shot.curves?.[state.ch];
    if (state.ch !== 'fov') return c || [];
    return (t.shot.keys || []).map((k) => ({ x: k.t, y: k.f ?? defHfov(t.shot), mode: 'auto' }));
  }
  function defHfov(s) { return fmt(s.hFov() * 180 / Math.PI, 1) * 1 || 46; }
  function setPts(list, silent) {
    const t = target();
    if (!t) return;
    if (t.kind === 'obj') { t.so.motion.curve = list; t.so.motion.curvePts = list.length > 1 ? normalizePts(list) : null; app.bus.emit('objects'); }
    else if (state.ch === 'fov') {
      const keys = t.shot.keys;
      for (const p of list) {
        let bi = 0, bd = 1e9;
        keys.forEach((k, i) => { const d = Math.abs(k.t - p.x); if (d < bd) { bd = d; bi = i; } });
        if (bd < 0.06) keys[bi].f = clamp(p.y, 5, 170);
      }
      t.shot.mover.rebuild();
      t.shot.refreshGizmos();
      t.shot.markDirty();
    } else t.shot.setCurve(state.ch, list);
    if (!silent) draw();
  }

  // ---------------- 头部控件 ------------------------------------------------
  function buildBar() {
    bar.replaceChildren();
    const t = target();
    const name = t ? (t.kind === 'shot' ? `机位 ${t.shot.name}` : `走位 ${t.so.name}`) : '未选择';
    bar.appendChild(el('b', { class: 'cv-title', text: `曲线 · ${name}` }));
    const chips = el('div', { class: 'chips' });
    for (const [k, c] of Object.entries(CH)) {
      if (t?.kind === 'obj' && k !== 'prog') continue;
      chips.appendChild(el('button', {
        class: 'chip small' + (state.ch === k ? ' on' : ''), type: 'button', text: c.l, title: c.sub,
        onclick: () => { state.ch = k; buildBar(); draw(); },
      }));
    }
    bar.appendChild(chips);
    bar.appendChild(el('span', { class: 'tsep' }));
    const presets = el('div', { class: 'chips cv-pre' });
    for (const p of CURVE_PRESETS) {
      presets.appendChild(el('button', {
        class: 'chip small', type: 'button', text: p.name, title: p.d,
        onclick: () => {
          const list = p.pts.map((q) => ({ ...q }));
          setPts(list);
          app.notify?.(`已套用「${p.name}」缓动曲线`, 'ok');
          draw();
        },
      }));
    }
    bar.appendChild(presets);
    bar.appendChild(el('span', { class: 'tsep' }));
    bar.appendChild(el('button', {
      class: 'fbtn small', type: 'button', text: '回到匀速', title: '删除进度曲线（改回上方「整体缓动」）',
      onclick: () => { setPts([]); const t2 = target(); if (t2?.kind === 'shot') t2.shot.setMotionOpt('scope', 'global'); },
    }));
    bar.appendChild(el('button', {
      class: 'fbtn small', type: 'button', text: '曲线同步到全部机位',
      onclick: () => {
        const t2 = target();
        if (t2?.kind !== 'shot') return app.notify?.('先选中一个机位', 'warn');
        const list = clonePts(t2.shot.curves?.prog || []);
        for (const s of app.shots) { if (s !== t2.shot) s.setCurve('prog', list); }
        app.notify?.(`已把曲线同步到 ${app.shots.length - 1} 个机位`, 'ok');
      },
    }));
    bar.appendChild(el('button', {
      class: 'fbtn small', type: 'button', text: '平滑体检',
      title: '沿路径取样速度：曲线越平 = 越顺；节点处下凹 = 停顿',
      onclick: () => {
        const t2 = target();
        if (t2?.kind !== 'shot') return app.notify?.('先选中一个机位', 'warn');
        const d = t2.shot.motionDiag();
        const dip = d.min / Math.max(1e-6, d.max);
        app.notify?.(dip > 0.35 ? `速度比 ${dip.toFixed(2)}：过节点不明显停顿 ✓` : `速度比 ${dip.toFixed(2)}：仍有明显收速（可试「匀速」或整段缓动）`, dip > 0.35 ? 'ok' : 'warn');
      },
    }));
    bar.appendChild(el('span', { class: 'tsep' }));
    bar.appendChild(el('button', { class: 'fbtn small alt', type: 'button', text: '✕ 收起', onclick: () => close() }));
  }

  // ---------------- 绘制 ----------------------------------------------------
  function size() {
    const w = Math.max(240, root.clientWidth || 600);
    const h = 176;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cvs.width !== Math.round(w * dpr) || cvs.height !== Math.round(h * dpr)) {
      cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
      cvs.style.width = w + 'px'; cvs.style.height = h + 'px';
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }
  const X = (x, w) => PAD.l + x * (w - PAD.l - PAD.r);
  const Y = (y, h) => PAD.t + (1 - y) * (h - PAD.t - PAD.b);
  function toGraph(px, py, w, h) {
    const c = CH[state.ch];
    const x = clamp((px - PAD.l) / Math.max(1, w - PAD.l - PAD.r), 0, 1);
    const f = clamp((py - PAD.t) / Math.max(1, h - PAD.t - PAD.b), 0, 1);
    return { x, y: c.y0 + (1 - f) * (c.y1 - c.y0) };
  }

  function draw() {
    const { w, h } = size();
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0e1218'; g.fillRect(0, 0, w, h);
    // 网格
    g.strokeStyle = 'rgba(255,255,255,.055)'; g.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = PAD.l + (i / 10) * (w - PAD.l - PAD.r);
      g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, h - PAD.b); g.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const y = PAD.t + (i / 4) * (h - PAD.t - PAD.b);
      g.beginPath(); g.moveTo(PAD.l, y); g.lineTo(w - PAD.r, y); g.stroke();
    }
    const c = CH[state.ch];
    g.fillStyle = 'rgba(200,215,235,.5)'; g.font = '10px ui-monospace,monospace';
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = c.y1 - (i / 4) * (c.y1 - c.y0);
      g.fillText(state.ch === 'fov' ? v.toFixed(0) + '°' : v.toFixed(2), PAD.l - 6, PAD.t + (i / 4) * (h - PAD.t - PAD.b) + 3);
    }
    g.textAlign = 'left';
    for (let i = 0; i <= 4; i++) g.fillText((i * 25) + '%', PAD.l + (i / 4) * (w - PAD.l - PAD.r) - 8, h - 8);
    g.fillText(c.sub, 6, 11);

    const t = target();
    // 关键帧竖线
    if (t) {
      const keys = t.kind === 'shot' ? (t.shot.keys || []) : (t.so.motion.keys || []);
      g.strokeStyle = 'rgba(255,181,71,.22)';
      for (const k of keys) {
        const x = X(k.t, w);
        g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, h - PAD.b); g.stroke();
      }
    }
    // 参考：老式逐段 inOut（说明为什么要用曲线）
    g.strokeStyle = 'rgba(140,160,190,.28)'; g.setLineDash([3, 3]); g.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = i / 80;
      const seg = perSegEase(x, 'inOut');
      const px = X(x, w), py = Y(state.ch === 'prog' ? seg : seg, h);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.setLineDash([]); g.stroke();

    // 主曲线
    const P = pts();
    const use = P.length > 1 ? P : defaultPts();
    const nP = normalizePts(use) || defaultPts();
    g.strokeStyle = '#ffb547'; g.lineWidth = 2.2; g.beginPath();
    for (let i = 0; i <= 160; i++) {
      const x = i / 160;
      const y = state.ch === 'prog' && P.length <= 1 ? EASE[t?.kind === 'shot' ? (t.shot.easing || 'linear') : 'linear'](x) : evalCurve(nP, x, state.ch === 'prog' ? { clampY: [0, 1] } : {});
      const px = X(x, w), py = Y(clamp((y - c.y0) / (c.y1 - c.y0), -0.2, 1.2), h);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();

    // 速度条（进度通道才有意义）
    if (state.ch === 'prog') {
      const N = 26, base = h - PAD.b;
      let mx = 1e-4;
      const sp = [];
      for (let i = 0; i < N; i++) {
        const a = evalAt(P, i / N, t), b = evalAt(P, (i + 1) / N, t);
        sp.push(Math.max(0, (b - a) * N));
        mx = Math.max(mx, ...sp);
      }
      const bw = (w - PAD.l - PAD.r) / N;
      for (let i = 0; i < N; i++) {
        const v = sp[i] / mx;
        g.fillStyle = v < 0.18 ? 'rgba(255,90,90,.75)' : v > 1.9 ? 'rgba(255,181,71,.6)' : 'rgba(120,220,170,.5)';
        const bh = 16 * v;
        g.fillRect(PAD.l + i * bw + 1, base - bh, bw - 2, bh);
      }
      g.fillStyle = 'rgba(200,215,235,.45)';
      g.fillText('速度（条子塌陷处＝停顿）', PAD.l + 2, base - 18);
    }

    // 控制点 + 手柄
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const px = X(p.x, w), py = Y(clamp((p.y - c.y0) / (c.y1 - c.y0), 0, 1), h);
      if (p.mode === 'bezier' && p.h) {
        g.strokeStyle = 'rgba(255,181,71,.75)'; g.lineWidth = 1;
        for (const [a, b] of [[p.h[0], p.h[1]], [p.h[2], p.h[3]]]) {
          const hx = px + a * (w - PAD.l - PAD.r), hy = py - b * (h - PAD.t - PAD.b);
          g.beginPath(); g.moveTo(px, py); g.lineTo(hx, hy); g.stroke();
          g.fillStyle = '#ffd79a'; g.beginPath(); g.arc(hx, hy, 3.2, 0, 7); g.fill();
        }
      }
      g.fillStyle = state.drag?.i === i ? '#fff' : p.mode === 'auto' || p.mode == null ? '#ffb547' : p.mode === 'linear' ? '#7fd6ff' : p.mode === 'bezier' ? '#c9a3ff' : '#ff9a9a';
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.beginPath(); g.arc(px, py, state.drag?.i === i ? 5.6 : 4.4, 0, 7); g.fill(); g.stroke();
    }

    // 播放头
    const u = app.timeline?.u ?? 0;
    const hx = X(clamp(u, 0, 1), w);
    g.strokeStyle = 'rgba(140,220,255,.9)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(hx, PAD.t - 6); g.lineTo(hx, h - PAD.b); g.stroke();
    g.fillStyle = 'rgba(140,220,255,.9)';
    g.beginPath(); g.moveTo(hx - 4, PAD.t - 8); g.lineTo(hx + 4, PAD.t - 8); g.lineTo(hx, PAD.t - 2); g.closePath(); g.fill();
  }
  function defaultPts() { return [{ x: 0, y: 0, mode: 'linear' }, { x: 1, y: 1, mode: 'linear' }]; }
  function evalAt(P, x, t) {
    if (P.length > 1) return evalCurve(normalizePts(P) || P, x, { clampY: [0, 1] });
    return t?.kind === 'shot' ? (EASE[t.shot.easing] || EASE.linear)(x) : x;
  }
  function perSegEase(x, name) {
    // 老逻辑：每个关键帧段各自 in/out → 节点处速度归零
    const t = target();
    const keys = t ? (t.kind === 'shot' ? t.shot.keys || [] : t.so.motion.keys || []) : [];
    if (keys.length < 2) return (EASE[name] || EASE.linear)(x);
    let i = 0;
    for (; i < keys.length - 1; i++) if (x <= keys[i + 1].t || i === keys.length - 2) break;
    const a = keys[i].t, b = keys[Math.min(i + 1, keys.length - 1)].t;
    return a + (b - a) * (EASE[name] || EASE.linear)(clamp((x - a) / Math.max(1e-6, b - a), 0, 1));
  }

  // ---------------- 交互 ----------------------------------------------------
  function hitTest(px, py, w, h) {
    const c = CH[state.ch];
    const P = pts();
    let bi = -1, bd = 13;
    P.forEach((p, i) => {
      const dx = px - X(p.x, w), dy = py - Y(clamp((p.y - c.y0) / (c.y1 - c.y0), 0, 1), h);
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; bi = i; }
    });
    return bi;
  }
  function hitHandle(px, py, w, h) {
    const c = CH[state.ch];
    const P = pts();
    let bi = -1, bd = 11, which = 0;
    P.forEach((p, i) => {
      if (p.mode !== 'bezier' || !p.h) return;
      const px0 = X(p.x, w), py0 = Y(clamp((p.y - c.y0) / (c.y1 - c.y0), 0, 1), h);
      for (let k = 0; k < 2; k++) {
        const hx = px0 + p.h[k * 2] * (w - PAD.l - PAD.r), hy = py0 - p.h[k * 2 + 1] * (h - PAD.t - PAD.b);
        const d = Math.hypot(px - hx, py - hy);
        if (d < bd) { bd = d; bi = i; which = k; }
      }
    });
    return bi >= 0 ? { i: bi, k: which } : null;
  }
  const keySnap = (x) => {
    const t = target();
    const keys = t ? (t.kind === 'shot' ? t.shot.keys || [] : t.so.motion.keys || []) : [];
    for (const k of keys) if (Math.abs(k.t - x) < 0.012) return k.t;
    return x;
  };
  cvs.addEventListener('pointerdown', (e) => {
    const r = cvs.getBoundingClientRect();
    const { w, h } = size();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (py < PAD.t - 4) { scrub(px, w); return; }
    const P = pts().slice();
    const hh = hitHandle(px, py, w, h);
    if (hh) { state.drag = { kind: 'handle', ...hh }; cvs.setPointerCapture(e.pointerId); return; }
    let i = hitTest(px, py, w, h);
    if (i < 0) {
      if (state.ch === 'fov') return;
      const g0 = toGraph(px, py, w, h);
      const y = state.ch === 'prog' ? clamp(1 - (py - PAD.t) / Math.max(1, h - PAD.t - PAD.b), 0, 1) : g0.y;
      const np = { x: keySnap(g0.x), y, mode: 'auto' };
      P.push(np);
      P.sort((a, b) => a.x - b.x);
      state.drag = { kind: 'pt', i: P.indexOf(np) };
      setPts(P, true);
      draw();
      return;
    }
    state.drag = { kind: e.altKey ? 'handle' : 'pt', i };
    cvs.setPointerCapture(e.pointerId);
    draw();
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!state.drag) return;
    const r = cvs.getBoundingClientRect();
    const { w, h } = size();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const P = clonePts(pts());
    const d = state.drag;
    const c = CH[state.ch];
    if (d.kind === 'handle') {
      const p = P[d.i];
      if (!p) return;
      const nx = (px - X(p.x, w)) / Math.max(1, w - PAD.l - PAD.r);
      const ny = -(py - Y(clamp((p.y - c.y0) / (c.y1 - c.y0), 0, 1), h)) / Math.max(1, h - PAD.t - PAD.b);
      p.h = p.h || [0, 0, 0, 0];
      const k = (d.k ?? 0) * 2;
      p.h[k] = clamp(nx, -0.6, 0.6); p.h[k + 1] = clamp(ny, -2, 2);
      p.mode = 'bezier';
    } else {
      const p = P[d.i];
      if (!p) return;
      const gy = clamp(1 - (py - PAD.t) / Math.max(1, h - PAD.t - PAD.b), 0, 1);
      p.x = keySnap(clamp((px - PAD.l) / Math.max(1, w - PAD.l - PAD.r), 0, 1));
      p.y = state.ch === 'prog' ? clamp(gy, 0, 1) : c.y0 + gy * (c.y1 - c.y0);
      if (state.ch === 'fov') p.y = clamp(p.y, 5, 170);
    }
    // 不让点互相穿越：x 限制在左右邻点之间
    if (d.kind === 'pt' && state.ch !== 'fov') {
      const lo = d.i > 0 ? P[d.i - 1].x + 0.015 : 0;
      const hi = d.i < P.length - 1 ? P[d.i + 1].x - 0.015 : 1;
      P[d.i].x = clamp(P[d.i].x, lo, hi);
    }
    setPts(P);
  });
  const end = () => { state.drag = null; draw(); };
  cvs.addEventListener('pointerup', end);
  cvs.addEventListener('pointercancel', end);
  cvs.addEventListener('dblclick', (e) => {
    const r = cvs.getBoundingClientRect();
    const { w, h } = size();
    const i = hitTest(e.clientX - r.left, e.clientY - r.top, w, h);
    if (i < 0) return;
    const P = clonePts(pts());
    const order = ['auto', 'linear', 'step', 'bezier'];
    const p = P[i];
    p.mode = order[(order.indexOf(p.mode || 'auto') + 1) % order.length];
    if (p.mode === 'bezier' && !p.h) p.h = [0.1, 0, -0.1, 0];
    setPts(P);
    app.notify?.(`第 ${i + 1} 点：${p.mode}`, 'ok');
  });
  cvs.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = cvs.getBoundingClientRect();
    const { w, h } = size();
    const i = hitTest(e.clientX - r.left, e.clientY - r.top, w, h);
    const P = clonePts(pts());
    if (i <= 0 || i >= P.length - 1) return;
    P.splice(i, 1);
    setPts(P);
  });
  function scrub(px, w) {
    const u = clamp((px - PAD.l) / Math.max(1, w - PAD.l - PAD.r), 0, 1);
    app.state.time = u * app.state.duration;
    app.bus.emit('time');
  }

  // ---------------- 展开 / 收起 ---------------------------------------------
  function open() { state.open = true; root.classList.add('on'); buildBar(); draw(); }
  function close() { state.open = false; root.classList.remove('on'); }
  function toggle(force) { (force === undefined ? !state.open : force) ? open() : close(); }
  app.bus.on('select', () => { if (state.open) { buildBar(); draw(); } });
  app.bus.on('shot-change', () => { if (state.open) draw(); });
  app.bus.on('shots', () => { if (state.open) { buildBar(); draw(); } });
  app.bus.on('objects', () => { if (state.open) draw(); });
  app.bus.on('time', () => { if (state.open) draw(); });
  app.bus.on('tick', () => { if (state.open && app.state.playing) draw(); });
  window.addEventListener('resize', () => { if (state.open) draw(); });
  draw();
  return { root, open, close, toggle, draw, buildBar, get isOpen() { return state.open; } };
}
