import { section, buildForm } from './ui.js';
import { el } from './util.js';
import { bloomSelection, objectSurfaces } from './selective-bloom.js';

export function selectiveBloomControls(app, so) {
  const group = section('此物体 · 选择性 Bloom'), root = group.wrap;
  root.dataset.bloomObject = '1';
  const state = bloomSelection(so.params.bloomSelection);
  const note = el('div', { class: 'fnote' });
  const form = buildForm([
    { k: 'mode', l: '参与方式', t: 'sel', opts: [
      { v: 'auto', l: '跟随自动窗面' }, { v: 'custom', l: '仅下方指定表面' },
      { v: 'emissive', l: '此物体所有自发光面' }, { v: 'off', l: '排除此物体' },
    ] },
    { k: 'source', l: '指定表面光源', t: 'sel', opts: [
      { v: 'emission', l: '仅原材质自发光' }, { v: 'color', l: '底色 / 贴图（灯牌）' },
    ] },
    { k: 'gain', l: '指定表面光源倍率', t: 'range', min: 0, max: 16, step: .25, commit: true },
  ], state, (key, value) => {
    if (app.renderEffects.setObject(so, { [key]: value })) {
      Object.assign(state, bloomSelection(so.params.bloomSelection)); form.update(); renderList();
    }
  });
  ['mode', 'source', 'gain'].forEach((key, i) => form.root.children[i]?.querySelectorAll('input,select').forEach((n) => {
    n.dataset.bloomObjectSetting = key; n.disabled = so.locked;
  }));
  const filter = el('input', { class: 'inp', placeholder: '筛选网格 / 材质名', type: 'search', 'aria-label': '筛选泛光表面', dataset: { bloomFilter: '1' } });
  const list = el('div', { style: 'max-height:230px;overflow:auto', dataset: { bloomSurfaces: '1' } });
  let shown = 80;
  const more = el('button', { class: 'fbtn', type: 'button', text: '再显示 80 项', onclick: () => { shown += 80; renderList(); } });
  filter.oninput = () => { shown = 80; renderList(); };
  const controls = el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn', type: 'button', disabled: so.locked, text: '指定识别窗面（上限 256）', dataset: { bloomSelectWindows: '1' }, onclick: () => {
      const parts = objectSurfaces(app, so).filter((s) => s.window).map((s) => s.key).slice(0, 256);
      if (app.renderEffects.setObject(so, { mode: 'custom', parts })) { Object.assign(state, bloomSelection(so.params.bloomSelection)); form.update(); renderList(); }
    } }),
    el('button', { class: 'fbtn', type: 'button', disabled: so.locked, text: '清空指定', dataset: { bloomClear: '1' }, onclick: () => {
      if (app.renderEffects.setObject(so, { mode: 'custom', parts: [] })) { Object.assign(state, bloomSelection(so.params.bloomSelection)); form.update(); renderList(); }
    } }),
  ]);
  function renderList() {
    list.replaceChildren();
    const surfaces = objectSurfaces(app, so), keys = new Set(surfaces.map((s) => s.key));
    const unmatched = state.parts.filter((p) => !keys.has(p)).length;
    const matches = surfaces.filter((s) => (s.label + (s.window ? ' 窗面' : '')).toLowerCase().includes(filter.value.toLowerCase()));
    for (const surface of matches.slice(0, shown)) {
      const checkbox = el('input', { type: 'checkbox', checked: state.parts.includes(surface.key), disabled: so.locked, dataset: { bloomSurface: surface.key }, 'aria-label': surface.label });
      checkbox.onchange = () => {
        const next = new Set(state.parts);
        if (checkbox.checked) next.add(surface.key); else next.delete(surface.key);
        if (next.size > 256) { checkbox.checked = false; app.notify('最多指定 256 个材质表面，请使用自动窗面或物体自发光模式。', 'warn'); return; }
        if (app.renderEffects.setObject(so, { mode: 'custom', parts: [...next] })) { Object.assign(state, bloomSelection(so.params.bloomSelection)); form.update(); renderList(); }
      };
      list.append(el('label', { style: 'display:flex;gap:6px;font-size:11px;padding:3px 0' }, [checkbox, el('span', { text: surface.label + (surface.window ? ' · 窗面' : '') })]));
    }
    more.style.display = matches.length > shown ? '' : 'none';
    note.textContent = `需先在 Scene → 光影启用 Bloom 并选「选择性」。已指定 ${state.parts.length} / 256 个表面${unmatched ? `，${unmatched} 个引用已失配，请重新指定` : ''}；只显示 ${Math.min(shown, matches.length)} / ${matches.length} 项。自动窗面与所有自发光模式忽略下方列表 / 倍率；Basic 材质以底色为光源。指定底色可让灯牌贴图发光，但不改源材质、不新增实光。合并网格按材质槽选择，不能拆选其内部单个窗户；引用由路径 / 名称 / 材质类型 / 顶点及索引数 / 局部变换组成，不是几何全内容哈希；重建后请检查，失配时重新指定。`;
  }
  group.body.append(form.root, controls, filter, list, more, note);
  renderList();
  return root;
}
