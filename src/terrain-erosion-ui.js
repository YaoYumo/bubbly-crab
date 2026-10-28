import { el } from './util.js';
import { section } from './ui.js';
import { EROSION_PRESETS } from './terrain-erosion.js';
const run = (app, fn) => async (event) => { try { await fn(event); } catch (e) { app.notify(e.message, 'warn'); } };
const button = (app, text, key, fn, disabled = false) => el('button', { class: 'fbtn', type: 'button', text, disabled, dataset: { terrainAction: key }, onclick: run(app, fn) });
const note = (text) => el('p', { class: 'fnote', text });
const row = (label, node) => el('label', { class: 'row', title: label }, [el('span', { class: 'lab', text: label }), el('span', { class: 'ctl' }, [node])]);
export function terrainErosionControls(app) {
  const w = app.terrain.workflow, p = w.erosionSettings, g = section('侵蚀与沉积 · 非破坏预览');
  g.wrap.dataset.terrainPane = 'erosion'; g.wrap.dataset.terrainSection = 'erosion';
  const numeric = (label, key, min, max, step = .05) => row(label, el('input', { class: 'num', type: 'number', min, max, step, value: p[key], disabled: w.busy, dataset: { erosionSetting: key }, onchange: run(app, (e) => {
    const value = Number(e.target.value); if (!Number.isFinite(value) || value < min || value > max) { e.target.value = p[key]; throw Error(`${label}需在 ${min}–${max} 之间`); }
    w.configureErosion({ [key]: value });
  }) }));
  const select = (label, key, options) => {
    const s = el('select', { class: 'sel', disabled: w.busy, dataset: { erosionSetting: key }, onchange: run(app, (e) => w.configureErosion({ [key]: e.target.value })) }, options.map(([value, text]) => el('option', { value, text })));
    s.value = p[key]; return row(label, s);
  };
  const check = (label, key) => { const node = row(label, el('input', { type: 'checkbox', checked: p[key], disabled: w.busy, dataset: { erosionSetting: key }, onchange: run(app, (e) => w.configureErosion({ [key]: e.target.checked })) })); node.classList.add('terrain-check'); return node; };
  const presets = el('div', { class: 'terrain-presets' });
  for (const [key, preset] of Object.entries(EROSION_PRESETS)) presets.append(button(app, preset.label, 'erosion-preset-' + key, () => w.erosionPreset(key), w.busy));
  g.body.append(presets, select('处理流程', 'mode', [['combined', '热力 → 水力 → 沉积'], ['thermal', '仅热力坡面搬移'], ['hydraulic', '水力侵蚀 + 携沙沉积'], ['sediment', '仅松散表层沉积整理']]),
    numeric('整体强度', 'strength', 0, 1), numeric('最大升 / 降 m', 'maxChange', .01, 50, .1), numeric('固定种子', 'seed', 1, 2147483647, 1),
    select('作用范围', 'region', [['all', '全图'], ['box', '矩形局部'], ['river', '河道及岸带'], ['outside', '河道岸带以外']]));
  if (p.region === 'box') g.body.append(numeric('中心 X m', 'centerX', -2048, 2048, 1), numeric('中心 Z m', 'centerZ', -2048, 2048, 1), numeric('区域宽 m', 'width', 1, 4096, 1), numeric('区域深 m', 'depth', 1, 4096, 1));
  if (['river', 'outside'].includes(p.region)) g.body.append(select('关联已保存河道', 'riverId', [['all', '全部有效河道'], ...w.rivers.map((r) => [r.id, r.name])]), numeric('岸外影响宽 m', 'riverBand', 1, 80, 1));
  g.body.append(check('保护全部已保存河床', 'riverProtect'), check('保护模型 / 道路投影包围盒', 'protectObjects'));
  const advanced = el('details', { class: 'terrain-advanced', open: !!app.terrainUI?.advanced, ontoggle: (e) => { (app.terrainUI ||= {}).advanced = e.target.open; } }, [el('summary', { text: '高级参数 · 热力 / 水力 / 沉积' })]);
  advanced.append(select('抗蚀风格', 'style', [['natural', '均质土层'], ['rocky', '岩层交替抗蚀'], ['ridged', '脊线曲率抗蚀']]),
    numeric('松散层 / 热力轮次', 'iterations', 1, 40, 1), numeric('稳定坡角 °', 'angle', 1, 65, 1), numeric('热力搬移速率', 'thermal', 0, 1),
    numeric('雨滴数量', 'drops', 0, 60000, 1000), numeric('雨滴最长步数', 'lifetime', 4, 96, 1), numeric('流动惯性', 'inertia', 0, .95), numeric('水蚀速率', 'erosion', 0, 1),
    numeric('携沙沉积速率', 'deposition', 0, 1), numeric('蒸发率 / 步', 'evaporation', .001, .5, .005), numeric('携沙容量系数', 'capacity', .1, 10, .1), numeric('侵蚀半径 m', 'radius', .1, 8, .1),
    numeric('沉积整理速率', 'settling', 0, 1), numeric('松散表层厚 m', 'sedimentDepth', 0, 10, .1), numeric('岩层间距 m', 'layerScale', .2, 30, .1));
  g.body.append(advanced, button(app, w.erosionPreview ? '重新计算预览' : '计算侵蚀预览', 'erosion-preview', () => w.previewErosion(), w.busy || !app.terrain.enabled));
  if (w.erosionPreview) {
    const s = w.erosionPreview.result.stats;
    const views = el('div', { class: 'terrain-presets' });
    for (const [key, label] of [['result', '结果'], ['before', '原始'], ['delta', '升降'], ['erosion', '侵蚀'], ['sediment', '沉积'], ['flow', '径流'], ['mask', '范围']]) {
      const b = button(app, label, 'erosion-view-' + key, () => w.showErosionPreview(key)); b.setAttribute('aria-pressed', String(w.erosionView === key)); views.append(b);
    }
    g.body.append(views, note(`预览：${s.affected} 个顶点变化，最大升降 ${s.maxDelta.toFixed(3)}m。红=削低，黄=抬高；径流蓝色越亮表示雨滴经过越多；范围白=可作用，黑=保护。`),
      note(`累计搬出 ${s.erodedVolume.toFixed(2)}m³ / 落地 ${s.depositedVolume.toFixed(2)}m³；地形净变化 ${s.terrainVolumeDelta.toFixed(3)}m³，沿侵蚀轨迹回存 ${s.returnedSedimentVolume.toFixed(3)}m³，未落地 ${s.unplacedSedimentVolume.toFixed(3)}m³。搬运可重复计数，不等于最终高差。`));
  } else if (w.erosionLastStats) g.body.append(note(`上次应用：${w.erosionLastStats.affected} 个顶点，最大升降 ${w.erosionLastStats.maxDelta.toFixed(3)}m；支持一次撤销。`));
  const help = el('details', { class: 'terrain-advanced' }, [el('summary', { text: '尺度 / 保护范围 / 模拟限制' }), note(`格距 ${(app.terrain.size / (app.terrain.n - 1)).toFixed(2)}m；定位中尺度坡面与沟谷，不增加网格细节。岩质模拟交替抗蚀岩层，脊状预设增强凸脊抗蚀、保留陡坡并加强窄沟；不是专有滤镜复刻。`),
    note('河道范围来自保存路径的河宽、岸坡和岸外影响宽，保护选项固定河宽以内的网格。不会自动汇流、自动调水位或重刻河床。四周一圈顶点固定。模型保护采用保守 XZ 包围盒（含悬空模型，不含特效 / 植被实例），弯路可能保护较大范围。'),
    note('仅沉积模式搬移指定厚度的松散表层，不凭空填土。水蚀允许抬高沉积；受保护区或升高上限阻挡的携沙，沿本雨滴的侵蚀轨迹回存；体积单列，不模拟真正的河口出沙。径流图是雨滴访问量，不是流量 / 汇水分析。'),
    note('预览只替换地表显示，不移动道路 / 模型，不写入工程；应用才执行贴地与道路联动。结果预览沿用原材质着色，应用后重算自动底材。调整参数或离开场景页会放弃旧预览。计算使用主线程分片、可取消，并非 Worker 或实时流体。预览期间先应用 / 放弃，再播放或导出。')]);
  g.body.append(help); return g.wrap;
}

/** Compact global task bar remains reachable on every terrain sub-tab. */
export function terrainTaskBar(app) {
  const w = app.terrain.workflow, root = el('div', { class: 'terrain-taskbar' });
  if (w.busy) {
    const text = el('p', { class: 'fnote', dataset: { terrainProgressText: '1' }, text: w.status });
    const meter = el('progress', { max: 1, value: w.erosionProgress?.value || 0, 'aria-label': '地形任务进度' });
    root.append(text, meter, button(app, '取消当前任务', 'cancel-task', () => w.cancelJob()));
    const off = app.bus.on('terrain-erosion-progress', (p) => { if (!root.isConnected) { off(); return; } text.textContent = `${p.phase} · ${Math.round(p.value * 100)}%`; meter.value = p.value; }); root._cleanup = off;
  } else if (w.erosionPreview) root.append(note('侵蚀预览中 · 原工程尚未修改'), button(app, '应用结果', 'erosion-apply', () => w.applyErosionPreview()), button(app, '放弃预览', 'erosion-cancel', () => w.cancelErosionPreview()));
  return root;
}

export function arrangeTerrainPanel(root, app, ctx) {
  ctx.terrainCleanup?.();
  const state = app.terrainUI ||= { tab: 'base', sections: {} }; state.sections ||= {};
  const panes = [['base', '基础'], ['sculpt', '雕刻'], ['erosion', '侵蚀'], ['rivers', '河道'], ['materials', '材质'], ['import', '导入']];
  const nav = el('div', { class: 'terrain-nav', role: 'tablist', 'aria-label': '地形工具分组' });
  const sections = [...root.children].flatMap((node) => node.matches('[data-terrain-workflow]') ? [...node.children].filter((c) => c.classList.contains('sec')) : node.classList.contains('sec') ? [node] : []);
  const groups = new Map(panes.map(([key]) => [key, el('div', { class: 'terrain-pane', role: 'tabpanel', dataset: { terrainPane: key } })]));
  for (const sec of sections) {
    const title = sec.querySelector('.sec-h b')?.textContent || '', key = sec.dataset.terrainSection || title;
    const pane = sec.dataset.terrainPane || (/笔刷|画笔/.test(title) ? 'sculpt' : /底材/.test(title) ? 'materials' : 'base');
    const head = sec.querySelector('.sec-h'), defaultClosed = /水面|提示|植被笔刷|道路画笔/.test(title);
    sec.classList.toggle('closed', state.sections[key] ?? defaultClosed);
    const sync = () => { const open = !sec.classList.contains('closed'); head.setAttribute('aria-expanded', String(open)); head.querySelector('.caret').textContent = open ? '▾' : '▸'; };
    head.setAttribute('role', 'button'); head.tabIndex = 0; sync();
    head.addEventListener('click', () => { state.sections[key] = sec.classList.contains('closed'); sync(); });
    head.addEventListener('keydown', (e) => { if (e.target !== head || !['Enter', ' '].includes(e.key)) return; e.preventDefault(); head.click(); });
    groups.get(pane).append(sec);
  }
  const choose = (key) => {
    state.tab = key; for (const [id, group] of groups) group.hidden = key !== id;
    for (const b of nav.children) { const active = b.dataset.terrainTab === key; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; }
  };
  for (const [key, label] of panes) nav.append(el('button', { type: 'button', role: 'tab', text: label, dataset: { terrainTab: key }, onclick: () => { choose(key); app.bus.emit('terrain-ui-tab', key); } }));
  nav.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const bs = [...nav.children], i = bs.indexOf(document.activeElement), target = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length; bs[target].click(); bs[target].focus(); });
  const off = app.bus.on('terrain-ui-tab', (key) => { if (!root.isConnected) { off(); return; } choose(key); });
  const taskbar = terrainTaskBar(app); ctx.terrainCleanup = () => { off(); taskbar._cleanup?.(); };
  root.replaceChildren(nav, taskbar, ...groups.values()); choose(groups.has(state.tab) ? state.tab : 'base');
  root.classList.add('terrain-organized');
  // Old tools cannot quietly edit a hidden source or race a computation. Nav/task controls stay live.
  if (app.terrain.workflow.busy || app.terrain.workflow.erosionPreview) for (const [key, group] of groups) {
    if (key === 'erosion') continue;
    for (const input of group.querySelectorAll('input,select,button,textarea')) input.disabled = true;
  }
}
