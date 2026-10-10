// ---------------------------------------------------------------------------
// 轻量 UI 组件：schema 驱动的表单（物体属性 / 运镜 / 光影 / 导出 共用）
// ---------------------------------------------------------------------------
import { el, clear, fmt, clamp } from './util.js';

export function section(title, opts = {}) {
  const wrap = el('div', { class: 'sec' });
  const head = el('div', { class: 'sec-h' }, [
    el('span', { class: 'caret', text: '▾' }),
    el('b', { text: title }),
    opts.badge ? el('i', { class: 'badge', text: opts.badge }) : null,
    opts.right || null,
  ]);
  const body = el('div', { class: 'sec-b' });
  head.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    const open = !wrap.classList.contains('closed');
    wrap.classList.toggle('closed', open);
    head.querySelector('.caret').textContent = open ? '▸' : '▾';
  });
  wrap.append(head, body);
  return { wrap, body };
}

function rowOf(label, node, help) {
  const r = el('div', { class: 'row' }, [
    el('label', { class: 'lab', text: label, title: help || label }),
    el('div', { class: 'ctl' }, [node]),
  ]);
  return r;
}

/**
 * fields: [{k,l,t,min,max,step,opts,help,fmt,onChange,when,items}]
 * get/set 通过 state 对象；返回 {root, update, setField}
 */
export function buildForm(fields, state, onInput, ctx = {}) {
  const root = el('div', { class: 'form' });
  const refs = new Map();
  const visible = new Map();
  for (const f of fields) {
    if (!f) continue;
    if (f.t === 'head') { root.appendChild(el('div', { class: 'fhead', text: f.l })); continue; }
    if (f.t === 'note') { root.appendChild(el('div', { class: 'fnote', html: f.l })); continue; }
    if (f.t === 'hr') { root.appendChild(el('div', { class: 'fhr' })); continue; }
    const getv = () => (f.get ? f.get(state) : state[f.k]);
    const setv = (v) => { if (f.set) f.set(v, state); else state[f.k] = v; onInput(f.k, v, f); };
    let input;
    let sync = () => {};
    if (f.t === 'range' || f.t === 'int') {
      const val = Number(getv() ?? 0);
      const num = el('input', {
        class: 'num', type: 'number', min: f.min, max: f.max, step: f.step ?? (f.t === 'int' ? 1 : 0.01), value: f.t === 'int' ? Math.round(val) : val,
        oninput: (e) => { let v = parseFloat(e.target.value); if (Number.isNaN(v)) return; v = f.t === 'int' ? Math.round(v) : v; setv(clamp(v, f.min, f.max)); sync(); },
      });
      const rng = el('input', {
        class: 'rng', type: 'range', min: f.min, max: f.max, step: f.step ?? 0.01, value: f.t === 'int' ? Math.round(val) : val,
        oninput: (e) => { const v = parseFloat(e.target.value); setv(f.t === 'int' ? Math.round(v) : v); sync(); },
      });
      const grp = el('div', { class: 'rg' }, [rng, num]);
      input = grp;
      sync = () => {
        const v = Number(getv());
        if (document.activeElement !== rng) rng.value = v;
        if (document.activeElement !== num) num.value = f.t === 'int' ? Math.round(v) : +Number(v).toFixed(3);
      };
      refs.set(f.k, () => sync());
    } else if (f.t === 'bool') {
      const b = el('button', { class: 'sw', type: 'button', onclick: () => { setv(!getv()); sync(); } });
      sync = () => b.classList.toggle('on', !!getv());
      input = el('div', { class: 'sw-wrap' }, [b, el('span', { class: 'sw-l', text: f.on || '开' })]);
      refs.set(f.k, sync);
    } else if (f.t === 'sel') {
      const s = el('select', {
        class: 'sel',
        onchange: (e) => { const v = e.target.value; setv(f.num ? Number(v) : v); },
      });
      const cur = getv();
      for (const o of f.opts || []) {
        s.appendChild(el('option', { value: o.v, selected: String(o.v) === String(cur), text: o.l }));
      }
      input = s;
      refs.set(f.k, () => { s.value = String(getv()); });
    } else if (f.t === 'text') {
      const i0 = el('input', { class: 'tx', type: 'text', maxlength: '12', placeholder: f.ph || '', value: String(getv() ?? ''), oninput: (e) => setv(e.target.value) });
      input = i0;
      refs.set(f.k, () => { if (document.activeElement !== i0) i0.value = String(getv() ?? ''); });
    } else if (f.t === 'color') {
      const c = el('input', { class: 'col', type: 'color', value: toHex(getv() ?? '#ffffff'), oninput: (e) => setv(e.target.value) });
      input = el('div', { class: 'col-wrap' }, [c, el('span', { class: 'col-h', text: toHex(getv() ?? '#ffffff') })]);
      const lab = input.querySelector('.col-h');
      c.addEventListener('input', () => { lab.textContent = c.value; });
      refs.set(f.k, () => { c.value = toHex(getv() ?? '#ffffff'); lab.textContent = c.value; });
    } else if (f.t === 'vec3') {
      const cur = getv() || [0, 0, 0];
      const ins = [0, 1, 2].map((i) => el('input', {
        class: 'num v3', type: 'number', step: f.step ?? 0.05, value: +Number(cur[i] ?? 0).toFixed(f.d ?? 2),
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isNaN(v)) return;
          const arr = [...(getv() || [0, 0, 0])];
          arr[i] = v;
          setv(arr);
        },
      }));
      input = el('div', { class: 'v3g' }, [el('span', { text: 'X' }), ins[0], el('span', { text: 'Y' }), ins[1], el('span', { text: 'Z' }), ins[2]]);
      refs.set(f.k, () => {
        const a = getv() || [0, 0, 0];
        ins.forEach((n, i) => { if (document.activeElement !== n) n.value = +Number(a[i] ?? 0).toFixed(f.d ?? 2); });
      });
    } else if (f.t === 'btn') {
      input = el('button', { class: 'fbtn', type: 'button', text: f.l, onclick: () => f.onClick && f.onClick(state, ctx) });
      root.appendChild(el('div', { class: 'row row-btn' }, [input, f.btn2 ? el('button', { class: 'fbtn alt', type: 'button', text: f.btn2.l, onclick: () => f.btn2.onClick(state, ctx) }) : null]));
      continue;
    } else if (f.t === 'btns') {
      const grp = el('div', { class: 'btns' });
      for (const b of f.items || []) grp.appendChild(el('button', { class: 'chip', type: 'button', text: b.l, title: b.help || '', onclick: () => b.onClick(state, ctx) }));
      root.appendChild(el('div', { class: 'row row-btns' }, [grp]));
      continue;
    } else if (f.t === 'txt') {
      const i = el('input', { class: 'txt', type: 'text', value: getv() ?? '', oninput: (e) => setv(e.target.value) });
      input = i;
      refs.set(f.k, () => { if (document.activeElement !== i) i.value = getv() ?? ''; });
    } else if (f.t === 'area') {
      const a = el('textarea', { class: 'area', rows: f.rows || 4, oninput: (e) => setv(e.target.value) });
      a.value = getv() ?? '';
      input = a;
      refs.set(f.k, () => { if (document.activeElement !== a) a.value = getv() ?? ''; });
    } else if (f.t === 'stat') {
      input = el('span', { class: 'stat', text: '' });
      refs.set(f.k, () => { input.textContent = (f.text ? f.text(state) : String(getv() ?? '')).slice(0, 120); });
    } else {
      continue;
    }
    const row = rowOf(f.l, input, f.help);
    if (f.class) row.classList.add(f.class);
    visible.set(row, f);
    root.appendChild(row);
  }
  const update = () => {
    for (const [row, f] of visible) {
      const show = f.when ? !!f.when(state, ctx) : true;
      row.style.display = show ? '' : 'none';
    }
    for (const fn of refs.values()) { try { fn(); } catch (e) { /* noop */ } }
  };
  update();
  return { root, update, refs };
}

export function toHex(c) {
  if (!c) return '#ffffff';
  if (typeof c === 'string') return c.startsWith('#') ? c : '#ffffff';
  if (c.isColor) return '#' + c.getHexString();
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
  return '#ffffff';
}

/** 顶部/浮动工具条按钮 */
export function tbtn({ id, label, title, onClick, active, icon }) {
  const b = el('button', {
    class: 'tb' + (active ? ' on' : ''), id, type: 'button', title: title || label,
    onclick: () => onClick && onClick(b),
  }, [icon ? el('span', { class: 'i', html: icon }) : null, el('span', { class: 't', text: label || '' })]);
  b.set = (on) => b.classList.toggle('on', !!on);
  return b;
}

export function tabs(host, defs, onPick) {
  clear(host);
  const btns = [];
  defs.forEach((d, i) => {
    const b = el('button', { class: 'tab' + (i === 0 ? ' on' : ''), type: 'button', text: d.l, onclick: () => { btns.forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(d.id, i); } });
    btns.push(b);
    host.appendChild(b);
  });
  return { select: (i) => btns[i]?.click() };
}
