// ---------------------------------------------------------------------------
// 入口：装配工作台、工具条、快捷键、渲染循环、示例场景
// ---------------------------------------------------------------------------
import './styles.css';
import * as THREE from 'three';
import { App } from './app.js';
import { ASPECTS } from './stage.js';
import { LEVELS, setDetailLevel, detailLevel, detailMaps, textureStats, pruneTextureCache, texOn } from './detail.js';
import { buildLibrary, buildObjectList, buildShotList, buildInspector, buildDirectInspector, buildSceneAssets, buildSceneInspector, buildKeyframesList, buildCameraInspector, buildGeneratePage, buildExportPage, toast } from './panels.js';
import { buildTimeline } from './timeline.js';
import { buildCurveEditor } from './curveeditor.js';
import { SCENES, applyScene } from './scenes.js';
import { buildDemo } from './demo.js';
import { LIB, LIB_INDEX, buildAsset, defaultsFor } from './assets.js';
import { MOVES, MOVE_BY_ID } from './camera.js';
import { ANIMS } from './character.js';
import { ATMOS } from './lighting.js';
import { WEATHER } from './weather.js';
import { Mover } from './mover.js';
import { openTownDialog } from './townui.js';
import { autoCamera } from './autocam.js';
import { pickSceneFile, openApiDialog } from './sceneio.js';
import { el, clear, clamp, fmt, copy, downloadBlob, snap } from './util.js';

const host = document.getElementById('stage');
const app = new App(host);
window.app = app;
app.projectName = '未命名场景';

/* ------------------------------- 顶栏 ------------------------------------ */
const top = document.getElementById('top');
const tbtn = (label, { icon, title, onClick, on, cls } = {}) => el('button', {
  class: 'tb ' + (cls || ''), type: 'button', title: title || label,
  onclick: (e) => onClick && onClick(e.currentTarget, e),
}, [icon ? el('span', { class: 'i', html: icon }) : null, label ? el('span', { class: 't', text: label }) : null]);

/* 品牌 / 皮肤切换：三个实心圆点 */
const skinWrap = el('div', { class: 'skin-wrap' });
const SKINS = [
  { id: 'light', color: '#F4EFE7', border: '#c8c0b4', label: '浅色模式' },
  { id: 'dark', color: '#282940', border: '#454668', label: '深色模式' },
  { id: 'custom', color: 'linear-gradient(135deg,#ff6b6b,#4ecdc4,#45b7d1)', border: 'transparent', label: '自定义色彩（开发中）' },
];
const skinDots = [];
function applySkin(id) {
  if (id === 'custom') { toast('自定义主题开发中'); return; }
  app.state.skin = id;
  document.documentElement.dataset.skin = id;
  skinDots.forEach(d => d.el.classList.toggle('on', d.id === id));
}
for (const s of SKINS) {
  const dot = el('button', {
    class: 'skin-dot' + (app.state.skin === s.id ? ' on' : ''),
    type: 'button',
    title: s.label,
    style: s.color.startsWith('linear') ? `background:${s.color}` : `background:${s.color};border-color:${s.border}`,
  });
  dot.onclick = () => applySkin(s.id);
  skinDots.push({ id: s.id, el: dot });
  skinWrap.appendChild(dot);
}
app.state.skin = 'light';
top.appendChild(skinWrap);

/* 胶囊页签 */
const capsules = el('div', { class: 'capsules' });
const pages = [
  { id: 'direct', label: 'Direct', icon: '' },
  { id: 'scene', label: 'Scene', icon: '' },
  { id: 'camera', label: 'Camera', icon: '' },
  { id: 'generate', label: 'Generate', icon: '✦' },
  { id: 'export', label: 'Export', icon: '⬇' },
];
let currentPage = 'direct';
function switchPage(id) {
  currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('on');
  document.querySelectorAll('.cap').forEach(c => c.classList.toggle('on', c.dataset.page === id));
  document.getElementById('app').dataset.page = id;

  // Move 3D stage to active page's viewport
  const stage = document.getElementById('stage');
  const viewportMap = {
    'direct': 'viewport-shared',
    'scene': 'viewport-scene',
    'camera': 'viewport-camera'
  };
  const viewportId = viewportMap[id];
  if (viewportId && stage) {
    const viewport = document.getElementById(viewportId);
    if (viewport && !viewport.contains(stage)) {
      // Remove any stage-mirror placeholders
      viewport.querySelectorAll('.stage-mirror').forEach(m => m.remove());
      viewport.insertBefore(stage, viewport.firstChild);
      // Trigger resize
      setTimeout(() => {
        app.stage.resize();
      }, 50);
    }
  }

  app.bus.emit('page-change', id);
}
for (const p of pages) {
  const cap = el('button', {
    class: 'cap' + (p.id === currentPage ? ' on' : ''),
    type: 'button',
    'data-page': p.id,
    onclick: () => switchPage(p.id),
  }, [el('span', { class: 'i', html: p.icon }), p.label]);
  capsules.appendChild(cap);
}
top.appendChild(capsules);

/* 右侧按钮 */
const shareBtn = el('button', {
  class: 'share-btn', type: 'button', title: '分享场景',
  onclick: () => toast('分享功能开发中'),
}, [el('span', { html: '↗' }), ' Share']);
top.appendChild(shareBtn);

/* 工具按钮组（精简：保留核心操作，其余收入下拉菜单） */
const toolRow = el('div', { class: 'tool-row' });

/* 一句话生成街区：本地关键词解析 → 程序化造镇（Scene 页专属，随工具条显隐） */
toolRow.appendChild(tbtn('一句话生成', {
  icon: '✦', cls: 'pri', title: '一句话生成街区（本地解析，不联网、不消耗积分）',
  onClick: () => openTownDialog(app),
}));

const gizmoBtns = [];
for (const [m, l, ico, key] of [['translate', '移动', '✥', 'W'], ['rotate', '旋转', '⟳', 'E'], ['scale', '缩放', '⤢', 'R']]) {
  const b = tbtn(l, {
    icon: ico, title: `${l} (${key})`,
    onClick: () => setGizmo(m),
  });
  gizmoBtns.push([m, b]);
  toolRow.appendChild(b);
}
function setGizmo(m) {
  app.stage.setGizmo(m);
  gizmoBtns.forEach(([k, b]) => b.classList.toggle('on', k === m));
}
setGizmo('translate');

const spaceBtns = [];
for (const [s, l, ico] of [['world', '世界', '⊕'], ['local', '局部', '⊙'], ['view', '视图', '◉']]) {
  const b = tbtn(l, {
    icon: ico, title: `${l}坐标系`,
    onClick: () => setSpace(s),
  });
  spaceBtns.push([s, b]);
  toolRow.appendChild(b);
}
function setSpace(s) {
  app.stage.tc.setSpace(s);
  spaceBtns.forEach(([k, b]) => b.classList.toggle('on', k === s));
}
setSpace('world');

const snapSel = el('select', { class: 'nsl', onchange: (e) => { app.state.snap = parseFloat(e.target.value); app.stage.setSnap(app.state.snap); } });
for (const [v, l] of [[0, '自由吸附'], [0.05, '0.05m'], [0.25, '0.25m'], [0.5, '0.5m'], [1, '1m'], [5, '5m']]) snapSel.appendChild(el('option', { value: v, selected: v === 0.25, text: l }));
app.stage.setSnap(0.25);

const aspectSel = el('select', {
  id: 'aspectSel', class: 'nsl', onchange: (e) => { app.state.aspect = e.target.value; app.updateAspectOverlay(); syncHud(); } });
for (const [k, v] of Object.entries(ASPECTS)) aspectSel.appendChild(el('option', { value: k, selected: k === '1.85', text: v.l }));

const detailSel = el('select', {
  id: 'detailSel', class: 'nsl', title: '模型精度：段数/倒角/表面贴图。省内存最轻，高细节最完整（会重建模型）',
  onchange: (e) => { const ms = app.setDetail(e.target.value, { silent: true }); toast(`模型精度 → ${e.target.selectedOptions[0].text}（重建 ${ms}ms）`); } });
for (const [k, v] of Object.entries(LEVELS)) detailSel.appendChild(el('option', { value: k, selected: k === app.state.detail, text: '精度·' + v.name }));

const fileIn = el('input', { type: 'file', multiple: true, accept: '.glb,.gltf,.fbx,.obj,.mtl,.json', style: 'display:none', onchange: (e) => onFiles(e.target.files) });
document.body.appendChild(fileIn);

/** 顶栏撤销/重做 + 「一键清空」：单击立即清空（一步 Ctrl+Z 可撤销） */
const undoBtn = tbtn('撤销', { icon: '↶', title: '撤销上一步（Ctrl+Z）', onClick: () => { if (!app.undo()) toast('没有可撤销的操作'); } });
const redoBtn = tbtn('重做', { icon: '↷', title: '重做（Ctrl+Shift+Z）', onClick: () => { if (!app.redo()) toast('没有可重做的操作'); } });
const syncUndoBtns = () => {
  const u = (app._undo || []).length, r = (app._redo || []).length;
  undoBtn.disabled = !u; redoBtn.disabled = !r;
  undoBtn.title = u ? `撤销上一步（还有 ${u} 步可退）· Ctrl+Z` : '暂时没有可撤销的操作';
  redoBtn.title = r ? `重做（还有 ${r} 步可回）· Ctrl+Shift+Z / Ctrl+Y` : '暂时没有可重做的操作';
};
app.bus.on('undoable', syncUndoBtns);
syncUndoBtns();
const clearBtn = el('button', {
  class: 'tb', type: 'button', title: '一键清空场景：模型/机位/地形全清（Ctrl+Shift+Backspace · Ctrl+Z 可撤销）',
  onclick: () => {
    const objs = app.objects.length, shots = app.shots.length;
    if (!objs && !shots) { toast('场景已经是空的'); return; }
    app.clearScene({ blank: true });
  },
}, [el('span', { class: 'i', html: '⌫' }), el('span', { class: 't', text: '清空' })]);

/* ---- 下拉菜单辅助 ---- */
function makeDropdown(label, icon, items) {
  const wrap = el('div', { class: 'tb-dropdown' });
  const btn = el('button', { class: 'tb', type: 'button', title: label }, [
    icon ? el('span', { class: 'i', html: icon }) : null,
    el('span', { class: 't', text: label }),
    el('span', { style: 'font-size:8px;margin-left:2px;opacity:.6', text: '▾' }),
  ]);
  const menu = el('div', { class: 'dd-menu' });
  btn.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = wrap.classList.contains('open');
    document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) wrap.classList.add('open');
  };
  items.forEach(item => {
    if (item === '---') { menu.appendChild(el('div', { class: 'dd-sep' })); return; }
    if (item.label) { menu.appendChild(el('div', { class: 'dd-label', text: item.label })); return; }
    const mi = el('button', { class: 'dd-item' + (item.on ? ' on' : ''), type: 'button' }, [
      item.icon ? el('span', { class: 'dd-ico', html: item.icon }) : null,
      el('span', { text: item.text }),
    ]);
    mi.onclick = (e) => { e.stopPropagation(); item.onClick?.(mi); if (!item.keepOpen) wrap.classList.remove('open'); };
    if (item.ref) item.ref.el = mi;
    menu.appendChild(mi);
  });
  wrap.append(btn, menu);
  return wrap;
}
document.addEventListener('pointerdown', (e) => {
  // 菜单内部（开合按钮 / 菜单项）的按下不关菜单：否则菜单在 click 抬起前消失，
  // 点击永远落不到条目上（菜单项集体失效 + 开合按钮关不上）
  if (e.target && e.target.closest && e.target.closest('.tb-dropdown')) return;
  document.querySelectorAll('.tb-dropdown.open').forEach(d => d.classList.remove('open'));
});

/* ---- 视图菜单 ---- */
const previewBtn = tbtn('预览', { icon: '▶', title: '进入机位取景 (C)', onClick: () => togglePreview() });
const thirdsBtn = tbtn('构图线', { icon: '⊞', title: '三分线/安全框', onClick: (b) => { app.state.thirds = !app.state.thirds; app.stage.thirds = app.state.thirds; app.stage.setOverlay(); b.classList.toggle('on', app.state.thirds); } });
thirdsBtn.classList.add('on');
const lightBtn = tbtn('光影', { icon: '☀', title: '开/关光影 (L)', on: true, onClick: (b) => {
  const on = !app.lighting.enabled;
  app.lighting.setEnabled(on);
  app.state.perf = !on;
  b.classList.toggle('on', on);
  toast(on ? '光影已开启' : '内存优先：已切换为无光照平涂模式');
} });
lightBtn.classList.add('on');
const gridBtn = tbtn('网格', { icon: '#', title: '网格 (G)', onClick: (b) => { app.state.grid = !app.state.grid; app.stage.setGridVisible(app.state.grid); b.classList.toggle('on', app.state.grid && !app.stage.gridBlocked?.()); } });
gridBtn.classList.add('on');
const guideBtn = tbtn('辅助', { icon: '◎', title: '机位/路径显示 (H)', onClick: (b) => { app.state.showHelpers = !app.state.showHelpers; b.classList.toggle('on', app.state.showHelpers); } });
guideBtn.classList.add('on');

const viewMenu = makeDropdown('视图', '◉', [
  { label: '吸附' },
]);
// 吸附选择
const snapSelInline = el('select', { class: 'nsl', style: 'margin:2px 8px 4px;width:calc(100% - 16px)',
  onchange: (e) => { app.state.snap = parseFloat(e.target.value); app.stage.setSnap(app.state.snap); } });
for (const [v, l] of [[0, '自由吸附'], [0.05, '0.05m'], [0.25, '0.25m'], [0.5, '0.5m'], [1, '1m'], [5, '5m']]) snapSelInline.appendChild(el('option', { value: v, selected: v === 0.25, text: l }));
viewMenu.querySelector('.dd-menu').appendChild(snapSelInline);

// 画幅选择
viewMenu.querySelector('.dd-menu').appendChild(el('div', { class: 'dd-label', text: '画幅' }));
const aspectSelInline = el('select', { class: 'nsl', style: 'margin:2px 8px 4px;width:calc(100% - 16px)',
  onchange: (e) => { app.state.aspect = e.target.value; app.updateAspectOverlay(); syncHud(); } });
for (const [k, v] of Object.entries(ASPECTS)) aspectSelInline.appendChild(el('option', { value: k, selected: k === '1.85', text: v.l }));
viewMenu.querySelector('.dd-menu').appendChild(aspectSelInline);

// 天气选择
viewMenu.querySelector('.dd-menu').appendChild(el('div', { class: 'dd-label', text: '天气' }));
const weatherSel = el('select', { class: 'nsl', style: 'margin:2px 8px 4px;width:calc(100% - 16px)',
  onchange: (e) => {
    const v = e.target.value;
    if (v === 'fog') {
      app.weather.set(null);
      app.stage.scene.fog = new THREE.FogExp2(0xc8d4e0, 0.015);
    } else if (v === 'storm') {
      app.weather.set('storm');
      app.stage.scene.fog = new THREE.FogExp2(0x3a4555, 0.018);
    } else if (v) {
      app.weather.set(v);
      app.stage.scene.fog = null;
    } else {
      app.weather.set(null);
      app.stage.scene.fog = null;
    }
    toast(v ? `天气：${[...WEATHER, { id: 'fog', name: '雾 Fog' }].find(w => w.id === v)?.name || v}` : '天气已关闭');
  } });
weatherSel.appendChild(el('option', { value: '', text: '无' }));
for (const w of WEATHER) weatherSel.appendChild(el('option', { value: w.id, text: w.name }));
weatherSel.appendChild(el('option', { value: 'fog', text: '雾 Fog' }));
viewMenu.querySelector('.dd-menu').appendChild(weatherSel);

// 添加其余菜单项
[
  { text: '预览取景', icon: '▶', onClick: () => togglePreview(), ref: { el: null }, keepOpen: false },
  { text: '三分线/安全框', icon: '⊞', onClick: (mi) => { thirdsBtn.click(); mi.classList.toggle('on', app.state.thirds); }, on: true, keepOpen: true },
  '---',
  { text: '光影开关', icon: '☀', onClick: (mi) => { lightBtn.click(); mi.classList.toggle('on', app.lighting.enabled); }, on: true, keepOpen: true },
  { text: '网格', icon: '#', onClick: (mi) => { gridBtn.click(); mi.classList.toggle('on', app.state.grid); }, on: true, keepOpen: true },
  { text: '辅助显示', icon: '◎', onClick: (mi) => { guideBtn.click(); mi.classList.toggle('on', app.state.showHelpers); }, on: true, keepOpen: true },
  '---',
  { label: '模型精度' },
].forEach(item => {
  if (item === '---') { viewMenu.querySelector('.dd-menu').appendChild(el('div', { class: 'dd-sep' })); return; }
  if (item.label) { viewMenu.querySelector('.dd-menu').appendChild(el('div', { class: 'dd-label', text: item.label })); return; }
  const mi = el('button', { class: 'dd-item' + (item.on ? ' on' : ''), type: 'button' }, [
    item.icon ? el('span', { class: 'dd-ico', html: item.icon }) : null,
    el('span', { text: item.text }),
  ]);
  mi.onclick = (e) => { e.stopPropagation(); item.onClick?.(mi); if (!item.keepOpen) viewMenu.classList.remove('open'); };
  viewMenu.querySelector('.dd-menu').appendChild(mi);
});

// 精度选择追加到视图菜单底部
const detailSelInline = el('select', { class: 'nsl', style: 'margin:2px 8px 4px;width:calc(100% - 16px)',
  title: '模型精度',
  onchange: (e) => { const ms = app.setDetail(e.target.value, { silent: true }); toast(`模型精度 → ${e.target.selectedOptions[0].text}（重建 ${ms}ms）`); } });
for (const [k, v] of Object.entries(LEVELS)) detailSelInline.appendChild(el('option', { value: k, selected: k === app.state.detail, text: '精度·' + v.name }));
viewMenu.querySelector('.dd-menu').appendChild(detailSelInline);

/* ---- 场景菜单 ---- */
const scenePickerBtn = scenePicker();
const sceneMenu = makeDropdown('场景', '☰', [
  { text: '新建机位', icon: '⎈', onClick: () => { app.shotFromView(); toast('已创建机位，可在右侧选运镜预设'); } },
  { text: '导入模型', icon: '', onClick: () => fileIn.click() },
  '---',
  { text: '示例场景', icon: '◫', onClick: () => scenePickerBtn.click() },
  { text: '自动生成运镜', icon: '🎬', onClick: () => {
      if (!app.objects.length) { toast('场景是空的：先用 ✦ 一句话生成或模板搭建', 'warn'); return; }
      const before = app.shots.length;
      app.batchOp('自动运镜', () => { autoCamera(app, {}); app.select(null); });
      toast(`已生成 ${app.shots.length - before} 个机位：全景交代 → 环绕主体 → 跟拍/横移 → 推镜收尾（Ctrl+Z 一步撤销）`);
    } },
  { text: '导入 Scene 文件…', icon: '⇥', onClick: () => pickSceneFile(app) },
  { text: 'API 生成场景…', icon: '☁', onClick: () => openApiDialog(app) },
  '---',
  { text: '保存工程', icon: '⬇', onClick: () => { downloadBlob(new Blob([JSON.stringify(app.serialize(), null, 1)], { type: 'application/json' }), `${app.projectName}.json`); toast('已导出工程 JSON'); } },
  { text: '打开工程', icon: '⬆', onClick: () => fileIn.click() },
  '---',
  { text: '清空场景', icon: '⌫', onClick: () => clearBtn.click() },
]);

/* ---- 装配工具栏：只保留 5 个核心按钮 ---- */
toolRow.append(
  viewMenu,
  sceneMenu,
  clearBtn,               // 一键清空：挂在最顺手的位置，单击即清
);
top.appendChild(toolRow);
toolRow.style.display = currentPage === 'scene' ? '' : 'none';
app.bus.on('page-change', (id) => { toolRow.style.display = id === 'scene' ? '' : 'none'; });

/* ------------------------------ 面板装配 --------------------------------- */
const left = document.getElementById('left');
const shotListDirect = buildShotList(app, document.getElementById('shot-list-direct'));
const insp = buildInspector(app, document.getElementById('inspector'));

const bottomEl = document.getElementById('bottom');
const tl = buildTimeline(app, bottomEl);
// 关键帧曲线抽屉（放在时间轴上方，V 键或时间轴「曲线」按钮开合）
const cv = buildCurveEditor(app, bottomEl);
bottomEl.prepend(cv.root);
app.curve = cv;

/* 时间轴拖拽调整高度（放在最顶部，作为 #bottom 的第一个子元素） */
const resizeHandle = el('div', { class: 'tl-resize' });
bottomEl.insertBefore(resizeHandle, bottomEl.firstChild);
{
  let startY = 0, startH = 0, dragging = false;
  const MIN_H = 48, MAX_H = 320;
  resizeHandle.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startH = bottomEl.offsetHeight;
    resizeHandle.setPointerCapture(e.pointerId);
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  resizeHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const h = clamp(startH + dy, MIN_H, MAX_H);
    document.documentElement.style.setProperty('--tl-h', h + 'px');
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    app.stage.resize();
  };
  resizeHandle.addEventListener('pointerup', endDrag);
  resizeHandle.addEventListener('lostpointercapture', endDrag);
}

buildShotBar();

/* 时间线位置变化时更新相机预览（主控页面） */
app.bus.on('time', () => {
  if (currentPage === 'direct' && app.activeShot && !app.state.preview) {
    const fa = app.stage.framingAspect(app.stage.aspect || 0);
    app.activeShot.applyTo(app.stage.view, app.timeline.u, app.state.time, fa.canvasAspect, fa.eff);
  }
});

/* ---- S1 Direct: 模型库放在右侧检查器下方（可选） ---- */
// const lib = buildLibrary(app, document.getElementById('library-direct'));

/* ---- S2 Scene Builder 面板 ---- */
buildSceneAssets(app, document.getElementById('library-scene'));
buildObjectList(app, document.getElementById('objlist-scene'));
buildSceneInspector(app, document.getElementById('inspector-scene'));

/* 模型库收进二级入口：默认收起，点头部展开（主入口是顶栏 ✦ 一句话生成） */
{
  const libBtn = document.getElementById('lib-toggle');
  const libBox = document.getElementById('library-scene');
  const libState = document.getElementById('lib-toggle-state');
  if (libBtn && libBox) {
    const setLib = (open) => {
      libBox.style.display = open ? '' : 'none';
      if (libState) libState.textContent = open ? '收起 ▾' : '展开 ▸';
      libBtn.classList.toggle('on', open);
      libBtn.title = open ? '收起模型库' : `展开模型库（${libBox.querySelectorAll('.card').length} 个模型）`;
    };
    libBtn.addEventListener('click', () => setLib(libBox.style.display === 'none'));
    setLib(false);
  }
}

/* ---- S3 Camera Path 面板 ---- */
buildKeyframesList(app, document.getElementById('keyframes-list'));
buildCameraInspector(app, document.getElementById('inspector-camera'));

/* Camera page view mode buttons */
const camViewBtns = {
  persp: document.getElementById('cam-persp-btn'),
  top: document.getElementById('cam-top-btn'),
  path: document.getElementById('cam-path-btn'),
};
let camViewMode = 'persp';
function setCamView(mode) {
  if (app.state.preview && mode === 'persp') { togglePreview(); return; }
  camViewMode = mode;
  Object.entries(camViewBtns).forEach(([k, btn]) => btn?.classList.toggle('active', k === mode));
  app.state.camView = mode;
  app.bus.emit('cam-view', mode);
  if (mode === 'top') {
    app.stage.setOrthoTop();
  } else if (mode === 'path') {
    app.stage.setPathPreview();
  } else {
    app.stage.setPerspective();
  }
}
camViewBtns.persp?.addEventListener('click', () => setCamView('persp'));
camViewBtns.top?.addEventListener('click', () => setCamView('top'));
camViewBtns.path?.addEventListener('click', () => setCamView('path'));
setCamView('persp');

/* ---- Camera page: 摄像机列表 + 增删 + 切换下拉框 ---- */
{
  const camList = document.getElementById('camera-list');
  const addBtn = document.getElementById('cam-add-btn');
  const delBtn = document.getElementById('cam-del-btn');
  const camSwitch = document.getElementById('cam-switch-select');
  function renderCamList() {
    if (!camList) return;
    clear(camList);
    app.shots.forEach((s, i) => {
      const row = el('div', { class: 'orow' + (s === app.activeShot ? ' on' : ''), title: s.name }, [
        el('span', { class: 'odot', html: '📷' }),
        el('span', { class: 'onm', text: s.name || `Camera ${String(i + 1).padStart(2, '0')}` }),
      ]);
      row.onclick = () => { app.setActiveShot(s); app.select({ kind: 'shot', shot: s }); };
      camList.appendChild(row);
    });
    if (!app.shots.length) {
      camList.appendChild(el('div', { class: 'empty', text: '暂无摄像机，点击 ＋ 新建' }));
    }
    if (delBtn) delBtn.disabled = !app.activeShot;
    if (camSwitch) {
      const prev = camSwitch.value;
      camSwitch.innerHTML = '';
      if (!app.shots.length) {
        camSwitch.appendChild(el('option', { value: '', text: '无摄像机' }));
      } else {
        app.shots.forEach((s, i) => {
          camSwitch.appendChild(el('option', { value: s.id, text: s.name || `Camera ${String(i + 1).padStart(2, '0')}`, selected: s === app.activeShot }));
        });
      }
    }
  }
  if (camSwitch) {
    camSwitch.onchange = () => {
      const shot = app.shots.find(s => s.id === camSwitch.value);
      if (shot) { app.setActiveShot(shot); app.select({ kind: 'shot', shot }); }
    };
  }
  addBtn?.addEventListener('click', () => {
    app.shotFromView();
    toast('已新建摄像机');
  });
  delBtn?.addEventListener('click', () => {
    if (!app.activeShot) return;
    const name = app.activeShot.name;
    app.removeShot(app.activeShot);
    toast(`已删除 ${name || '摄像机'}`);
  });
  app.bus.on('shots', renderCamList);
  app.bus.on('select', renderCamList);
  renderCamList();
}

/* ---- S4 Generate 页面 ---- */
buildGeneratePage(app, document.getElementById('generate-content'));

/* ---- S5 Export 页面 ---- */
buildExportPage(app, document.getElementById('export-content'));

/** 顶栏「示例场景」：卡片式模板选择（会替换当前场景，模型仍可在左侧素材库单独取用） */
function scenePicker() {
  const btn = el('button', { class: 'tb', type: 'button', title: '载入示例场景模板（会替换当前场景）' }, [
    el('span', { class: 'i', html: '◫' }), el('span', { class: 't', text: '示例场景' }),
  ]);
  const pop = el('div', { class: 'menu scenes' });
  const state = { cat: '全部' };
  const close = () => { pop.classList.remove('on'); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const cats = ['全部', ...new Set(SCENES.map((x) => x.cat))];
  const meta = (sc) => {
    const tr = sc.terrain || {};
    const ground = tr.enabled !== false ? `⛰ 地形 ${tr.size || 160}m` : '▦ 平地';
    const an = (ATMOS && ATMOS[sc.atmos] && (ATMOS[sc.atmos].name || ATMOS[sc.atmos].label)) || sc.atmos || '—';
    const mv = sc.shots ? sc.shots.filter((x) => x.mv).length : 0;
    return `${sc.objs.length} 模型 · ${sc.shots.length} 机位（${mv} 个带运镜）· ${ground} · 光影 ${an}`;
  };
  function render() {
    clear(pop);
    pop.appendChild(el('div', { class: 'sp-head' }, [
      el('b', { text: '示例场景模板' }),
      el('span', { class: 'sp-sub', text: `${SCENES.length} 套 · 载入会清空当前场景` }),
      el('button', { class: 'sp-x', type: 'button', text: '✕', onclick: close }),
    ]));
    const chips = el('div', { class: 'sp-chips' });
    for (const c of cats) {
      chips.appendChild(el('button', {
        class: 'chip' + (state.cat === c ? ' on' : ''), type: 'button', text: c,
        onclick: () => { state.cat = c; render(); },
      }));
    }
    pop.appendChild(chips);
    pop.appendChild(el('div', { class: 'sp-quick' }, [
      el('button', { class: 'qbtn', type: 'button', title: '不载入任何模板，从空白开始搭', onclick: () => { close(); app.clearScene({ blank: true }); } }, [
        el('b', { text: '＋ 空白场景' }), el('i', { text: '清干净，保留地面与光影，直接摆景' })]),
      el('button', { class: 'qbtn', type: 'button', title: '载入内置演示：6 个机位的完整示例片', onclick: () => { close(); app.batchOp('示例短片', () => buildDemo(app)); toast('已载入示例短片（Ctrl+Z 一步撤回）'); } }, [
        el('b', { text: '✦ 示例短片' }), el('i', { text: '6 机位 · 展示全部运镜能力' })]),
      el('button', { class: 'qbtn danger', type: 'button', title: '清空当前场景（Ctrl+Z 可撤销）', onclick: () => { close(); app.clearScene({ blank: true }); } }, [
        el('b', { text: '⌫ 清空当前场景' }), el('i', { text: `${app.objects.length} 模型 · ${app.shots.length} 机位` })]),
    ]));
    const grid = el('div', { class: 'scard-grid' });
    let n = 0;
    for (const sc of SCENES) {
      if (state.cat !== '全部' && sc.cat !== state.cat) continue;
      n++;
      grid.appendChild(el('button', {
        class: 'scard', type: 'button', title: `载入「${sc.name}」`,
        onclick: () => { close(); applyScene(app, sc.id); },
      }, [
        el('span', { class: 'sc-tag', text: sc.cat }),
        el('b', { class: 'sc-nm', text: sc.name }),
        el('span', { class: 'sc-desc', text: sc.desc }),
        el('span', { class: 'sc-meta', text: meta(sc) }),
        el('span', { class: 'sc-go', html: '载入 →' }),
      ]));
    }
    if (!n) grid.appendChild(el('div', { class: 'empty', text: '这个题材下暂无模板' }));
    pop.appendChild(grid);
    pop.appendChild(el('div', { class: 'mi-hint', text: '模板只是「一键搭好」的参考场景；所有模型都能在左侧素材库按分类单独拖放，不需要借助模板。' }));
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.contains(e.target)) return;      // 卡片与快捷按钮自己处理，避免冒泡后弹层被重开
    if (pop.classList.contains('on')) return close();
    document.querySelectorAll('#top .menu.on').forEach((m) => m.classList.remove('on'));
    render();
    pop.classList.add('on');
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  });
  btn.appendChild(pop);
  return btn;
}
function buildShotBar() {
  const bar = document.getElementById('quickbar');
  const mk = (txt, title, fn) => {
    const b = el('button', { class: 'qb', type: 'button', title, onclick: () => fn(b), text: txt });
    return b;
  };
  bar.append(
    mk('⏮', '上一关键帧 ( , )', () => stepKey(-1)),
    mk('⏭', '下一关键帧 ( . )', () => stepKey(1)),
    mk('＋', '在当前时间记录关键帧 (K)：选中物体=走位，否则=机位', () => {
      if (app.selObj) { app.addObjectKey(app.selObj); toast('已记录走位关键帧'); }
      else { const s = app.activeShot || app.shotFromView(); s.addKeyAt(app.timeline.u, app.stage.view); toast('已记录机位关键帧'); }
    }),
    mk('⌖', '对准选中物体', () => { if (!app.selObj) return toast('先选中一个物体'); const s = app.activeShot || app.shots[0]; if (!s) return toast('先建机位'); s.setTarget(app.selObj); s.aim = 'target'; app.bus.emit('shot-change'); toast('机位已锁定主体'); }),
    mk('👁', '强制显示辅助（预览时）', (b) => { app.state.showHelpers = !app.state.showHelpers; b.classList.toggle('on', app.state.showHelpers); }),
  );
}
function stepKey(d) {
  const s = app.activeShot;
  if (!s || !s.keys.length) return;
  const i = clamp((s.selKey < 0 ? (d > 0 ? -1 : 0) : s.selKey) + d, 0, s.keys.length - 1);
  app.selectKey(s, i);
  app.state.time = s.keys[i].t * app.state.duration;
  app.bus.emit('time');
}

/* ------------------------------- HUD ------------------------------------ */
const hud = document.getElementById('hud');
const shotTag = el('div', { class: 'shot-tag', id: 'shotTag' });
document.getElementById('stage').appendChild(shotTag);
const hudL = el('div', { class: 'hud-l' });
const hudR = el('div', { class: 'hud-r' });
hud.append(hudL, hudR);
function syncHud() {
  const s = app.activeShot;
  const st = app.state;
  const ar = ASPECTS[st.aspect];
  hudL.innerHTML = s
    ? `<b>${s.name}</b> ｜ ${s.move ? s.move : '手工关键帧'} ｜ ${fmt(s.focal, 0)}mm ｜ ${s.keys.length} 关键帧 ｜ ${ar ? ar.l.replace(/\s/g, '') : ''} ｜ 时长 ${fmt(s.duration, 1)}s @ ${st.fps}fps`
    : `未选择机位 ｜ 左键点选物体，拖动手柄摆放；预览按钮进入取景`;
  hudR.innerHTML = `物体 <u>${app.objects.length}</u> ｜ 机位 <u>${app.shots.length}</u> ｜ 光影 <u>${app.lighting.enabled ? '开' : '关(省内存)'}</u> ｜ FPS <u>${stats.fps}</u>`;
  if (shotTag) {
    shotTag.classList.toggle('on', !!st.preview && !!s);
    if (s) {
      const mv = s.move ? (MOVE_BY_ID[s.move]?.name || s.move) : '手工关键帧';
      const idx = app.shots.indexOf(s) + 1;
      shotTag.innerHTML = `<i style="background:${s.colorHex}"></i><b>${idx}/${app.shots.length} · ${s.name}</b><span>${mv} ｜ ${fmt(s.focal, 0)}mm ｜ ${s.keys.length} 关键帧 ｜ ${ar ? ar.l.replace(/\s/g, '') : ''}</span>`;
    }
  }
}
let stats = { fps: 60, acc: 0, n: 0, t: 0 };
function loop() {
  const dt = Math.min(0.06, app._clock.getDelta());
  stats.acc += dt; stats.n++;
  if (stats.acc > 0.5) { stats.fps = Math.round(stats.n / stats.acc); stats.acc = 0; stats.n = 0; }
  if (!app.suspended) { app.step(dt); app.weather?.update(dt, app.stage.view?.position); app.stage.render(); }
  requestAnimationFrame(loop);
}

/* --------------------------- 交互：选择 / 快捷键 -------------------------- */
app.bus.on('select', () => {
  syncHud();
  const k = app.sel?.kind;
  const st = app.stage;
  if (k === 'key') st.tc.setSpace('local');
  previewBtn.classList.toggle('on', app.state.preview);
});
app.bus.on('objects', syncHud);
app.bus.on('shots', syncHud);
app.bus.on('shot-change', () => { syncHud(); tl.drawTicks(); });
app.bus.on('time', () => { tl.redraw(); tl.drawTicks(); });
app.bus.on('tick', () => {
  if (!app.state.playing) return;
  syncHudThrottled();
});
let _hudT = 0;
function syncHudThrottled() {
  const now = performance.now();
  if (now - _hudT > 220) { _hudT = now; syncHud(); }
}

function togglePreview() {
  if (!app.activeShot && !app.shots.length) { app.shotFromView(); }
  const on = !app.state.preview;
  app.state.preview = on;
  app.stage.preview = on;
  if (on) {
    app._viewSave = { p: app.stage.view.position.toArray(), q: app.stage.view.quaternion.toArray(), f: app.stage.view.fov, t: app.stage.orbit.target.toArray() };
    if (!app.activeShot) app.setActiveShot(app.shots[0] || null);
    if (app.activeShot) app.activeShot.syncAnchor();
    app.stage.previewControls.activate();
    Object.entries(camViewBtns).forEach(([k, btn]) => btn?.classList.remove('active'));
  } else {
    app.stage.previewControls.deactivate();
    if (app.state.playing) { app.state.playing = false; app.bus.emit('playstate'); }
  }
  previewBtn.classList.toggle('on', on);
  previewBtn.querySelector('.t').textContent = on ? '退出预览' : '预览';
  app.stage.orbit.enabled = !on;
  if (!on) {
    setCamView('persp');
    if (app._viewSave) {
      const v = app.stage.view;
      v.position.fromArray(app._viewSave.p);
      v.quaternion.fromArray(app._viewSave.q);
      v.fov = app._viewSave.f;
      v.updateProjectionMatrix();
      app.stage.orbit.target.fromArray(app._viewSave.t);
      const od = app.stage.orbit.enableDamping;
      app.stage.orbit.enableDamping = false;
      app.stage.orbit.update();
      app.stage.orbit.enableDamping = od;
    }
  }
  app.updateAspectOverlay();
  app.bus.emit('preview');
  syncHud();
}
// 同步预览按钮状态（当预览被代码启用时）
app.bus.on('preview', () => {
  previewBtn.classList.toggle('on', app.state.preview);
  previewBtn.querySelector('.t').textContent = app.state.preview ? '退出预览' : '预览';
  if (app.state.preview) {
    Object.entries(camViewBtns).forEach(([k, btn]) => btn?.classList.remove('active'));
  } else {
    Object.entries(camViewBtns).forEach(([k, btn]) => btn?.classList.toggle('active', k === 'persp'));
  }
});

window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); }
  else if (k === 'w') setGizmo('translate');
  else if (k === 'e') setGizmo('rotate');
  else if (k === 'r') setGizmo('scale');
  else if (k === 'f') app.focusSelected();
  else if (k === 'c') togglePreview();
  else if (k === 'p') setCamView('persp');
  else if (k === 't') setCamView('top');
  else if (k === 'x') { const order = ['world', 'local', 'view']; const cur = spaceBtns.find(([s, b]) => b.classList.contains('on'))?.[0] || 'world'; setSpace(order[(order.indexOf(cur) + 1) % order.length]); }
  else if (k === 'g') gridBtn.click();
  else if (k === 'l') lightBtn.click();
  else if (k === 'h') guideBtn.click();
  else if (k === 'k') { if (app.selObj) app.addObjectKey(app.selObj); else { const s = app.activeShot || app.shotFromView(); s.addKeyAt(app.timeline.u, app.stage.view); } toast('已记录关键帧'); }
  else if (k === '[' || k === ']') {
    const s2 = app.cycleShot(k === '[' ? -1 : 1);
    if (s2) toast(`预览机位：${app.shots.indexOf(s2) + 1}/${app.shots.length} · ${s2.name}${app.state.preview ? '' : '（按 P 进入取景）'}`);
    else if (!app.shots.length) toast('还没有机位，按 C 以当前视角建一个');
  }
  else if (k === '?') showHelp(true);
  else if (k === 'v') { cv.toggle(); if (cv.isOpen) cv.draw(); }
  else if (k === 'enter' && app.roadBrush?.active) {
    if (app.roadBrush.points.length < 2) { toast('至少需要 2 个控制点'); return; }
    app.roadBrush.finish(); app.bus.emit('objects'); app.markDirty?.(); toast('道路已生成');
  }
  else if (k === 't') { const t = app.state.terrainTool ? null : 'raise'; app.state.terrainTool = t; app.terrain?.refreshUI(); toast(t ? '地形笔刷：抬起（左键拖动绘制，Shift 压低，再按 T 退出）' : '已退出地形绘制'); }
  else if ((e.ctrlKey || e.metaKey) && k === 'z' && e.shiftKey) { e.preventDefault(); app.redo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); app.redo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    if (app.roadBrush?.active && app.roadBrush.points.length > 0) { app.roadBrush.undoPoint(); }
    else app.undo();
  }
  else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'backspace' || k === 'delete')) { e.preventDefault(); app.clearScene({ blank: true }); }
  else if (k === 'escape') {
    if (app.roadBrush?.active) {
      if (app.roadBrush._editBackup) { app.roadBrush.cancelEdit(); toast('已放弃编辑，原道路已恢复'); }
      else { app.roadBrush.stop(); toast('已取消道路绘制'); }
      return;
    }
    const open = document.querySelectorAll('.menu.on');
    if (open.length) { open.forEach((m) => m.classList.remove('on')); return; }
    if (app.state.dofPickMode) { app.state.dofPickMode = false; app.state.dofPickShot = null; toast('已取消对焦主体选择'); return; }
    if (app.state.preview) togglePreview(); else if (app.state.terrainTool) { app.state.terrainTool = null; app.terrain?.refreshUI(); toast('已退出地形绘制'); } else cv.close(); app.select(null); }
  else if (k === 'delete' || k === 'backspace') {
    if (app.sel?.kind === 'objkey') { app.removeObjectKey(app.sel.so, app.sel.i); toast('已删除走位关键帧'); }
    else if (app.selObj) { app.removeObject(app.selObj); toast('已删除'); }
    else if (app.sel?.kind === 'key' && app.selShot && app.sel.i >= 0) { app.sel.shot.removeKeyAt(app.sel.i); toast('已删除关键帧'); }
    else if (app.sel?.kind === 'shot' && app.selShot) {
      const sh = app.selShot;
      app.removeShot(sh);
      toast(`已删除机位「${sh.name}」· Ctrl+Z 可撤销`);
    }
  }
  else if (k === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.duplicateSelected(); }
  else if (k === ',') stepKey(-1);
  else if (k === '.') stepKey(1);
  else if (k.startsWith('arrow')) {
    const so = app.selObj;
    if (!so) return;
    e.preventDefault();
    const s = app.state.snap || 0.1;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(app.stage.view.quaternion); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const d = new THREE.Vector3();
    if (k === 'arrowleft') d.addScaledVector(right, -s);
    if (k === 'arrowright') d.addScaledVector(right, s);
    if (k === 'arrowup') d.addScaledVector(fwd, s);
    if (k === 'arrowdown') d.addScaledVector(fwd, -s);
    if (e.shiftKey) so.root.position.y += (k === 'arrowup' ? s : k === 'arrowdown' ? -s : 0);
    so.root.position.add(d);
    app.bus.emit('select');
  }
});

/* ------------------------- 文件拖放（导入模型） -------------------------- */
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); } });
window.addEventListener('drop', async (e) => {
  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;
  e.preventDefault();
  await onFiles(files);
});
async function onFiles(files) {
  const list = Array.from(files);
  const json = list.filter((f) => /\.json$/i.test(f.name));
  const models = list.filter((f) => !/\.json$/i.test(f.name));
  const at = app.stage.orbit.target.clone(); at.y = 0;
  if (json.length) {
    try {
      app.loadJson(JSON.parse(await json[0].text()));
      toast('工程已载入');
    } catch (err) { app.notify('工程文件解析失败：' + err.message, 'err'); }
  }
  if (models.length) {
    try {
      const r = await app.importFiles(models, at);
      toast(`已导入 ${r.length} 个模型`);
    } catch (err) { console.error(err); app.notify('模型导入失败：' + err.message, 'err'); }
  }
  insp.render();
}

/* ------------------------------ 帮助弹层 --------------------------------- */
function showHelp(on) {
  const m = document.getElementById('modal');
  if (!on) { m.classList.remove('on'); m.innerHTML = ''; return; }
  const step = (n, t, d) => el('div', { class: 'step' }, [el('b', { text: n }), el('span', { text: t }), el('div', { class: 'mini', text: d })]);
  const flow = el('div', { class: 'flow' }, [
    step('01', '搭场景', '从素材库拖建筑/人物，或导入 GLB'),
    el('span', { class: 'arrow', text: '→' }),
    step('02', '定机位', '摆好视角后按 C 建机位'),
    el('span', { class: 'arrow', text: '→' }),
    step('03', '选运镜', '挑预设生成路径，拖节点微调'),
    el('span', { class: 'arrow', text: '→' }),
    step('04', '排动作', '人物选动作 + 走位路径'),
    el('span', { class: 'arrow', text: '→' }),
    step('05', '调氛围', '光影预设 + 手动调光'),
    el('span', { class: 'arrow', text: '→' }),
    step('06', '导出', '录制 MP4/WebM + 提示词'),
  ]);
  const keys = [
    ['空格', '播放 / 暂停'], ['W E R', '移动 / 旋转 / 缩放'], ['F', '聚焦选中'], ['C', '以当前视角建机位'],
    ['K', '在当前时间记录关键帧'], ['P', '进入 / 退出机位取景'], ['G', '网格'], ['L', '光影开关（省内存）'],
    ['H', '辅助显示（含视口里的机位名牌）'], ['[ ]', '上一台 / 下一台机位'], [', .', '上/下一个关键帧'],
    ['Ctrl/⌘+D', '复制物体'], ['Del', '删除'], ['Esc', '取消选择'],
    ['方向键', '微移选中物体（Shift 改高度）'], ['1–9', '快速放置常用模型'],
  ];
  m.innerHTML = '';
  m.appendChild(el('div', { class: 'mbox' }, [
    el('button', { class: 'mclose', text: '关闭 ✕', onclick: () => showHelp(false) }),
    el('h2', { text: 'PREVIZ LAB — 给 AI 视频做运镜 & 动作参考' }),
    el('p', { text: '低模 + 强光影 + 真实镜头语言的Previz工作台。目标不是出成片，而是让 AI 明白「镜头怎么走、人物怎么动、光从哪来」。' }),
    el('h3', { text: '标准工作流' }), flow,
    el('h3', { text: '快捷键' }),
    el('div', { class: 'cols' }, keys.map(([a, b]) => el('p', {}, [a ? el('span', { class: 'kbd', text: a }) : el('span', {}), ' ' + (b || '')]))),
    el('h3', { text: '提示' }),
    el('p', { text: '· 拖放：按住左侧卡片拖到视口，落点自动吸附到地面/屋顶；右侧可继续改层数、配色等参数（实时重建）。' }),
    el('p', { text: '· 哪台机器在拍：每台机位有固定颜色 —— 机身、路径线、视口名牌、左栏圆点、预览左上角角标同色；预览时左上角会写明「2/3 · B · 环绕建筑」，按 [ ] 快速切换。' }),
    el('p', { text: '· 关键帧：视口里的蓝色球是路径节点，可移动（改机位）与旋转（改朝向）；「整段位移模式」下拖手柄移动整条路径。' }),
    el('p', { text: '· 导出：按实时录制，1 秒视频约等 1 秒；先切「关闭光影」可显著提速，适合快速迭代。' }),
    el('p', { text: '· 内存：无光照模式会把所有材质换成平涂材质、关阴影贴图与环境反射，只保留构图与运动信息。' }),
  ]));
  m.classList.add('on');
}
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') showHelp(false); });

/* 数字键快速放置 */
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const n = parseInt(e.key, 10);
  if (!n || e.metaKey || e.ctrlKey || e.altKey) return;
  const flat = [];
  for (const g of LIB) for (const it of g.items) flat.push(`${g.id}:${it.type}:${it.name}`);
  const key = flat[n - 1];
  if (key) { const p = app.stage.orbit.target.clone(); p.y = 0; app.addAsset(key, p); toast('已放置 ' + LIB_INDEX.get(key).name); }
});

/* ------------------------------ 启动 ------------------------------------ */
setInterval(() => { app.saveLocal(); }, 25000);
window.addEventListener('beforeunload', () => app.saveLocal());
app.bus.on('gizmo', () => { });
app.bus.on('toast', (d) => toast(typeof d === 'string' ? d : d?.msg, typeof d === 'object' && d?.kind ? d.kind : 'info'));
const FRESH = /[?&]fresh/.test(location.search);
const didRestore = !FRESH && app.maybeRestore();
/* 恢复提示：自动存档是【几何点位】原样回放——旧版大环路会跟着回魂，必须让用户知道
   这是上次的场景而不是新生成的（开新场：一键清空 或 ?fresh=1） */
const restored = didRestore && app.objects.length > 0;
if (FRESH) {
  const pick = new URLSearchParams(location.search).get('scene');
  if (pick && SCENES.some((s) => s.id === pick)) applyScene(app, pick);
}
app.updateAspectOverlay();
syncHud();
/* 落地即「一句话生成」：启动直接进 Scene 页（boot 遮罩尚未撤下，无闪跳） */
switchPage('scene');
/* 每个标签页首访自动弹出生成对话框；自动化（webdriver）与 ?fresh 调试路径不受影响 */
try {
  if (!navigator.webdriver && !FRESH && !sessionStorage.getItem('tg-first')) {
    sessionStorage.setItem('tg-first', '1');
    setTimeout(() => openTownDialog(app), 250);
  }
} catch (e) { /* 存储不可用时静默跳过 */ }
window.__previzBooted = true;
if (window.__bootWatch) clearTimeout(window.__bootWatch);
document.getElementById('boot')?.remove();
setInterval(syncHud, 1000);
loop();
setTimeout(() => {
  if (restored) toast('已恢复上次自动保存的场景（含旧版路网几何）· 开新场：点顶栏「一键清空」，或地址后加 ?fresh=1', 'info', 7000);
  else if (!app.objects.length) toast('场景空着？点顶栏 ✦ 一句话生成：「黄昏的加州林荫小镇，商业30%，丘陵」');
}, 900);

if (import.meta.env.DEV) {
  window.__t = {
    app, THREE, LIB, LIB_INDEX, MOVES, MOVE_BY_ID, ANIMS, ATMOS, Mover, SCENES, applyScene, CurveEditor: cv,
    buildAsset, defaultsFor, LEVELS, setDetailLevel, detailLevel, detailMaps, textureStats, pruneTextureCache, texOn,
  };
  window.__scenes = { SCENES, applyScene };
  // 外部浏览器 HMR websocket 可能不通：失焦回来时探测关键文件 ETag，版本不一致自动刷新
  window.__bootAt = Date.now();
  const PROBES = ['/', '/src/main.js', '/src/assets.js', '/src/panels.js', '/src/styles.css'];
  const etagOf = async (u) => {
    const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
    return r.headers.get('etag') || r.headers.get('last-modified') || '';
  };
  const fingerprint = async () => (await Promise.all(PROBES.map(etagOf))).join('|');
  let bootFp = '';
  window.__staleCheck = async () => {
    if (!bootFp) bootFp = await fingerprint();
    const now = await fingerprint();
    return { boot: bootFp, now, stale: now !== bootFp };
  };
  addEventListener('focus', () => {
    window.__staleCheck().then((s) => { if (s.stale) location.reload(); }).catch(() => {});
  });
  fingerprint().then((fp) => { bootFp = fp; }).catch(() => {});
  if (import.meta.hot) import.meta.hot.on('vite:serverRestart', () => location.reload());
}
