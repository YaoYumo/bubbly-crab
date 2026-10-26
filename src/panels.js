import { buildModelLibrary } from './library-ui.js';
import { DESKTOP_BUILD } from './desktop-runtime.js';
// ---------------------------------------------------------------------------
// 面板：素材库 / 场景列表 / 右侧检查器（物体 · 运镜 · 光影 · 导出）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { vegetationControls } from './vegetation-brush.js';
import { roadPlanningControls } from './road-planning-ui.js';
import { roadDiagnosticControls } from './road-diagnostics-ui.js';
import { renderEffectsControls } from './render-effects-ui.js';
import { selectiveBloomControls } from './selective-bloom-ui.js';
import { windowLightingControls } from './window-lights-ui.js';
import { LIB, LIB_INDEX } from './assets.js';
import { buildForm, section } from './ui.js';
import { MOVES, MOVE_BY_ID, LENS_OPTS, CAMERA_MODELS, SENSORS, MOVE_OPTS } from './camera.js';
import { isLuminaire } from './local-lights.js';
import { lightingModeControls, physicalLightingControls, localLightingControls, luminaireControls } from './lighting-ui.js';
import { ATMOS } from './lighting.js';
import { LEVELS } from './detail.js';
import { ANIMS, ANIM_LABEL } from './character.js';
import { RES_PRESETS, bestMime, Exporter } from './export.js';
import { EASE_OPTIONS, el, clear, fmt, clamp, downloadBlob, copy, deg, rad, uid } from './util.js';
import { behaviorControls } from './behavior-ui.js';
import { hasBehavior } from './behavior-workflow.js';
import { layoutMaintenanceControls } from './layout-maintenance-ui.js';
import { openAISceneDialog } from './ai-scene-ui.js';
import { referenceReview } from './reference-review-ui.js';
import { referenceTools } from './reference-ui.js';
import { buildPrompt, motionJson } from './prompts.js';
import { Mover } from './mover.js';
import { CURVE_PRESETS } from './curve.js';
import { terrainErosionControls, arrangeTerrainPanel } from './terrain-erosion-ui.js';
import { terrainWorkflowControls } from './terrain-workflow-ui.js';
import { terrainSurfaceControls } from './terrain-surface-ui.js';
import { BIOMES, TOOLS, TERRAIN_GEN } from './terrain.js';
import { TERRAIN_MATERIALS } from './terrain-materials.js';
import { WEATHER } from './weather.js';
import { seedance } from './seedance.js';
import { RoadBrush, ROAD_TYPES } from './road-brush.js';

export const ICON = {
  tower: '<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  cluster: '<rect x="2" y="9" width="6" height="12"/><rect x="9" y="4" width="6" height="17"/><rect x="16" y="11" width="6" height="10"/>',
  block: '<rect x="2" y="6" width="20" height="15" rx="1"/><path d="M2 11h20M2 16h20M8 6v15M16 6v15"/>',
  shop: '<path d="M3 9l2-5h14l2 5"/><rect x="4" y="9" width="16" height="12"/><path d="M8 13h8"/>',
  house: '<path d="M3 11l9-7 9 7"/><rect x="6" y="11" width="12" height="10"/>',
  bridge: '<path d="M2 8h20M4 8v10M20 8v10M2 13c5-4 15-4 20 0"/>',
  columns: '<path d="M4 21V7M9.3 21V7M14.6 21V7M20 21V7M2 7h20M2 4h20"/>',
  stairs: '<path d="M3 21h4v-4h4v-4h4V9h4V5"/>',
  wall: '<path d="M3 20h18V8H3z"/><path d="M3 12h18M8 8v4M13 12v4M16 8v4"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14M4 12h16"/>',
  door: '<path d="M5 21h11V4H5z"/><path d="M5 21h14"/><circle cx="13" cy="12" r="0.9" fill="currentColor"/>',
  roof: '<path d="M2 14l10-8 10 8"/><path d="M5 14v6h14v-6"/>',
  ceil: '<path d="M2 8h20"/><path d="M6 8v3M11 8v3M16 8v3"/><path d="M2 15h20"/>',
  fence: '<path d="M4 21V8m5 13V8m5 13V8m5 13V8M2 11h20M2 16h20"/>',
  screen: '<rect x="2" y="4" width="20" height="12" rx="1"/><path d="M12 16v5M8 21h8"/>',
  road: '<path d="M6 21L10 3M18 21L14 3M12 6v3M12 12v3M12 18v2"/>',
  cross: '<path d="M4 20h16M4 4h16M8 4v16M12 4v16M16 4v16"/>',
  walk: '<path d="M2 8h20M2 16h20M8 8v8M16 8v8"/>',
  tree: '<path d="M12 22v-6"/><path d="M12 3l5 7H7z"/><path d="M12 8l4.5 6.5h-9z"/>',
  palm: '<path d="M12 22V9"/><path d="M12 9c-4-3-7 0-8 2 3-1 5 0 8-2zM12 9c4-3 7 0 8 2-3-1-5 0-8-2zM12 9c-1-4 1-6 3-7-1 3 0 5-3 7zM12 9c1-4-1-6-3-7 1 3 0 5 3 7z"/>',
  lamp: '<path d="M6 22V6m0 0h6a4 4 0 0 1 0 8"/><circle cx="12" cy="15" r="1.6"/>',
  bench: '<path d="M2 12h20M4 12v7M20 12v7M2 9h20M6 9V5M18 9V5"/>',
  car: '<path d="M3 16v-3l2-4h12l3 4v3"/><path d="M3 16h18M6 16v2M18 16v2"/><circle cx="7" cy="16" r="1.6"/><circle cx="17" cy="16" r="1.6"/>',
  bus: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 12h18M7 17v3M17 17v3"/>',
  cone: '<path d="M12 4l5 15H7z"/><path d="M9 13h6"/>',
  barrier: '<rect x="2" y="9" width="20" height="7" rx="1"/><path d="M7 9v7M13 9v7M19 9v7"/>',
  crate: '<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16M20 4L4 20"/>',
  sign: '<path d="M12 22V6"/><rect x="4" y="3" width="16" height="8" rx="1"/>',
  fountain: '<circle cx="12" cy="17" r="5"/><path d="M12 12V4M9 6c1-2 5-2 6 0"/>',
  trash: '<path d="M5 7h14l-1 14H6z"/><path d="M9 7V4h6v3"/>',
  man: '<circle cx="12" cy="5" r="2.4"/><path d="M12 8v7M12 15l-3 7M12 15l3 7M7 11l5-2 5 2"/>',
  woman: '<circle cx="12" cy="5" r="2.4"/><path d="M12 8l-4 8h8z"/><path d="M10 16l-1 6M14 16l1 6"/>',
  kid: '<circle cx="12" cy="7" r="3"/><path d="M12 10v5M12 15l-2.5 5M12 15l2.5 5M8 12l4-1.5L16 12"/>',
  suit: '<circle cx="12" cy="4.5" r="2.2"/><path d="M9 21l1-11h4l1 11M12 8l-2 3 2 2 2-2-2-3"/>',
  worker: '<circle cx="12" cy="5" r="2.2"/><path d="M8 4h8M12 8v6M12 14l-3 7M12 14l3 7M7 10h10"/>',
  crowd: '<circle cx="7" cy="6" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="12" cy="4" r="2"/><path d="M3 21v-6h8v6M13 21v-6h8v6M7 15v6M17 15v6"/>',
  import: '<path d="M12 3v10m0 0l-4-4m4 4l4-4"/><rect x="3" y="15" width="18" height="6" rx="1"/>',
  cam: '<rect x="2" y="7" width="13" height="10" rx="2"/><path d="M15 11l7-4v10l-7-4z"/>',
  hall: '<path d="M2 9l10-5 10 5"/><path d="M4 9v11M20 9v11M4 20h16"/><path d="M8 20v-6h8v6"/>',
  paifang: '<path d="M3 8h18M6 8v13M18 8v13M12 8v13M3 5h18M4 12h16"/>',
  pagoda: '<path d="M8 6h8M6 10h12M5 14h14M4 18h16M12 2v4"/>',
  gatecn: '<path d="M3 10h18M5 10v11M19 10v11M9 21v-6h6v6M3 7l3-3h12l3 3"/>',
  wallcn: '<path d="M2 12h20v8H2zM6 12V9M12 12V9M18 12V9"/>',
  corridor: '<path d="M3 8h18M5 8v12M12 8v12M19 8v12M3 20h18"/>',
  bridgecn: '<path d="M2 16c5-8 15-8 20 0M4 16v4M20 16v4M9 13.5v5M15 13.5v5"/>',
  drum: '<rect x="5" y="12" width="14" height="8"/><path d="M3 12l9-6 9 6M9 20v-4h6v4"/>',
  yard: '<rect x="3" y="4" width="18" height="16"/><path d="M8 20v-6h8v6M3 10h5M16 10h5"/>',
  moongate: '<rect x="2" y="8" width="20" height="12"/><circle cx="12" cy="15" r="5"/>',
  lampcn: '<path d="M12 21V6M8 3h8M9 6h6v5H9z"/>',
  ding: '<path d="M7 9h10l-1 8H8zM12 9V6M5 6h14"/>',
  stone: '<path d="M9 21V8l3-5 3 5v13"/><rect x="6" y="18" width="12" height="3"/>',
  mount: '<path d="M2 20l6-11 4 6 3-4 7 9z"/><path d="M8 9l2 3"/>',
  cliff: '<path d="M4 20V6l6 3v11M14 20V9l6-3v14"/>',
  rock: '<path d="M4 19l3-8 6-3 5 5-2 6z"/><path d="M7 11l6 3"/>',
  float: '<path d="M6 8h12l-2 5H8z"/><path d="M9 20l3-4 3 4"/><path d="M4 4h4M16 4h4"/>',
  pine: '<path d="M12 3l4 6h-3l3 5h-3l3 5H7l3-5H7l3-5H7z"/><path d="M12 19v2"/>',
  bush: '<path d="M4 19c0-5 4-8 8-8s8 3 8 8z"/><path d="M12 19v2"/>',
  grass: '<path d="M5 20c0-6 1-8 1-8M9 20c0-8 2-11 2-11M13 20c0-7 2-9 2-9M18 20c0-5 1-6 1-6"/>',
  flower: '<circle cx="12" cy="7" r="3"/><path d="M12 10v10M8 15l4-2 4 2"/>',
  log: '<path d="M4 9h13a4 5 0 0 1 0 10H4z"/><ellipse cx="17" cy="14" rx="2" ry="5"/>',
  crop: '<path d="M3 20h18M6 20v-8M10 20v-9M14 20v-8M18 20v-9M4 12h16"/>',
  cactus: '<path d="M12 21V6M8 15V9a2 2 0 0 1 4 0M16 17v-5a2 2 0 0 0-4 0"/>',
  crystal: '<path d="M12 2l5 7-5 13-5-13z"/><path d="M7 9h10"/>',
  pond: '<path d="M3 14c3-3 6 3 9 0s6-3 9 0"/><path d="M5 18c3-2 5 2 8 0s4-2 6 0"/>',
  fall: '<path d="M6 4h12M8 4v10M12 4v12M16 4v10M4 18h16"/>',
  path: '<rect x="4" y="14" width="6" height="3"/><rect x="12" y="9" width="6" height="3"/><rect x="7" y="4" width="6" height="3"/>',
  trench: '<path d="M2 8h6v8h4V8h6v8h4"/>',
  bunker: '<rect x="4" y="10" width="16" height="9"/><path d="M8 10V7h8v3M10 14h4"/>',
  tank: '<path d="M3 16h18v3H3z"/><rect x="6" y="10" width="9" height="5"/><path d="M15 12h6"/>',
  artillery: '<path d="M4 15l10-6"/><circle cx="7" cy="18" r="2"/><path d="M14 9h6l-1 3"/>',
  tent: '<path d="M12 4L3 20h18z"/><path d="M12 4v16"/>',
  flag: '<path d="M7 21V3M7 4h12l-3 4 3 4H7"/>',
  crater: '<circle cx="12" cy="12" r="4"/><path d="M4 12a8 5 0 0 0 16 0"/>',
  ruin: '<path d="M4 20V8l4 2v10M10 20v-8h5v8M16 20v-4h4v4"/>',
  wreck: '<path d="M5 16l4-5h7l3 5z"/><path d="M12 8c1-2-1-3 0-5"/>',
  planet: '<circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="3"/>',
  stars: '<path d="M6 6l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM17 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM11 16l.7 1.6 1.6.7-1.6.7-.7 1.5-.7-1.5-1.6-.7 1.6-.7z"/>',
  nebula: '<path d="M6 14a5 5 0 1 1 8-4 4 4 0 1 1 4 6 5 5 0 0 1-12 -2z"/>',
  ship: '<path d="M2 12l6-3h8l6 3-6 3H8z"/><path d="M8 9V6M8 15v3"/>',
  fighter: '<path d="M3 12l7-2 8-5v14l-8-5z"/><path d="M18 5v14"/>',
  station: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  dome: '<path d="M3 18a9 9 0 0 1 18 0z"/><path d="M3 18h18M9 18v-6M15 18v-4"/>',
  hangar: '<path d="M3 20V9l9-5 9 5v11"/><path d="M8 20v-7h8v7"/>',
  turret: '<circle cx="12" cy="16" r="4"/><path d="M12 12V7h7"/>',
  pylon: '<path d="M9 21V9l3-5 3 5v12M12 4v17"/>',
  pad: '<circle cx="12" cy="14" r="6"/><path d="M12 8V2M9 5l3-3 3 3"/>',
  debris: '<path d="M4 8l4-2 2 4-4 2zM13 12l5-3 2 5-5 2zM6 17l3-1 1 3-3 1z"/>',
  portal: '<ellipse cx="12" cy="12" rx="5" ry="8"/><path d="M12 4v16"/>',
  glyph: '<circle cx="12" cy="12" r="8"/><path d="M12 4l7 13H5z"/>',
  lantern: '<path d="M12 3v2M8 8h8l-1 8H9z"/><path d="M12 16v3"/>',
  cloud: '<path d="M6 16a4 4 0 0 1 1-8 5 5 0 0 1 10 1 3.5 3.5 0 0 1-1 7z"/>',
  sword: '<path d="M12 3v13M9 16h6M12 16v5"/>',
  glow: '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  pavilion: '<path d="M4 10l8-6 8 6z"/><path d="M6 10v10M18 10v10M4 20h16"/><path d="M9 20v-6h6v6"/>',
  wtower: '<path d="M7 10h10l-1 6H8z"/><path d="M8 16l-2 5M16 16l2 5M8 12h8"/>',
  room: '<path d="M3 6h18v13H3z"/><path d="M3 6l4 3v10M21 6l-4 3v10"/>',
  sofa: '<path d="M3 12V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><rect x="3" y="12" width="18" height="6"/><path d="M5 18v2M19 18v2"/>',
  chair: '<path d="M8 4v9h8V4M6 13h12M8 20v-7M16 20v-7"/>',
  table: '<path d="M3 9h18M5 9v11M19 9v11"/>',
  bed: '<path d="M3 18v-6h18v6M3 12l3-4h5v4"/><circle cx="8" cy="14" r="1.4"/>',
  wardrobe: '<rect x="5" y="4" width="14" height="16"/><path d="M12 4v16M10 12h.5M14 12h-.5"/>',
  shelf: '<rect x="4" y="4" width="16" height="16"/><path d="M4 9h16M4 14h16M7 4v5M11 9v5M8 14v6"/>',
  kitchen: '<rect x="3" y="10" width="18" height="9"/><path d="M3 10h18M7 10V6h4v4M16 7h.01"/>',
  rug: '<rect x="3" y="6" width="18" height="12" rx="1"/><rect x="6" y="9" width="12" height="6"/>',
  curtain: '<path d="M4 4h16M6 4v16M10 4v16M14 4v16M18 4v16"/>',
  mansion: '<path d="M4 20V9l8-5 8 5v11"/><path d="M8 20v-8M12 20v-8M16 20v-8"/>',
  row: '<rect x="3" y="6" width="5" height="14"/><rect x="9" y="6" width="5" height="14"/><rect x="15" y="6" width="5" height="14"/>',
  church: '<path d="M8 20V9l4-4 4 4v11M12 2v3M10 5h4"/>',
  tower2: '<path d="M9 21l1-13h4l1 13z"/><rect x="10" y="4" width="4" height="4"/>',
  barn: '<path d="M3 20V10l9-6 9 6v10"/><path d="M9 20v-7h6v7"/>',
  clock: '<rect x="7" y="4" width="10" height="17"/><circle cx="12" cy="10" r="3"/><path d="M12 10V8"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ICON.crate}</svg>`;

// Shared catalog renderer: the Scene and optional Direct library use identical cards.
export function buildLibrary(app, host) {
  return buildModelLibrary(app, host);
}

export function buildShotList(app, host) {
  const wrap = el('div', { class: 'shotlist' });
  host.appendChild(wrap);
  const delShot = (s) => {
    const i = app.shots.indexOf(s);
    app.pushUndo(`删除机位 ${s.name}`);
    const snapshot = { s, i };
    app.removeShot(s);
    app._lastDelShot = snapshot;
    toast(`已删除机位 ${s.name} · 可 Ctrl+Z 撤销`);
  };
  const upd = () => {
    clear(wrap);
    wrap.appendChild(el('div', { class: 'olhead' }, [
      el('b', { text: `机位 ${app.shots.length}` }),
      el('span', { class: 'mini', text: '点选预览 · [ ] 切换' }),
    ]));
    if (!app.shots.length) wrap.appendChild(el('div', { class: 'empty', text: '还没有机位：点右上「+ 机位」或按 C 键' }));
    app.shots.forEach((s, i) => {
      const on = app.activeShot === s;
      const b = el('div', {
        class: 'shot' + (on ? ' on' : '') + (on && app.state.preview ? ' live' : ''),
        style: `border-left-color:${s.colorHex}`,
        draggable: 'true',
        title: `${s.name}｜${s.move ? MOVE_BY_ID[s.move]?.name : '手工路径'}｜${s.keys.length} 关键帧｜点击设为预览机位（也可用 [ / ] 切换）｜可拖到时间线 Camera 轨道`,
        onclick: () => { app.setActiveShot(s); if (app.state.preview) app.applyCameraSample(); app.select({ kind: 'shot', shot: s }); },
        ondragstart: (e) => { e.dataTransfer.setData('application/x-previz-shot', s.id); e.dataTransfer.setData('text/shot', String(app.shots.indexOf(s))); e.dataTransfer.effectAllowed = 'copy'; },
      }, [
        el('span', { class: 'dot', style: `background:${s.colorHex};box-shadow:0 0 6px ${s.colorHex}66` }),
        el('span', { class: 'snm', text: `${i + 1}. ${s.name}` }),
        el('span', { class: 'stag', text: s.move ? MOVE_BY_ID[s.move].name.split(' ')[0] : (s.keys.length ? '自定义' : '固定') }),
        on ? el('span', { class: 'eye', text: app.state.preview ? '▶ 预览中' : '● 当前机位' }) : null,
        (() => {
          const x = el('button', {
            class: 'ib del', type: 'button', title: '删除该机位（Ctrl+Z 可撤销）', text: '×',
            onclick: (e) => {
              e.stopPropagation();
              if (x.dataset.armed === '1') { delShot(s); return; }
              x.dataset.armed = '1'; x.classList.add('armed'); x.textContent = '确认';
              setTimeout(() => { x.dataset.armed = ''; x.classList.remove('armed'); x.textContent = '×'; }, 2600);
            },
          });
          return x;
        })(),
      ]);
      wrap.appendChild(b);
    });
  };
  upd();
  for (const ev of ['shots', 'select', 'shot-change', 'preview']) app.bus.on(ev, upd);
  return { update: upd };
}

export function buildObjectList(app, host) {
  const wrap = el('div', { class: 'objlist' });
  host.appendChild(wrap);
  const upd = () => {
    clear(wrap);
    wrap.appendChild(el('div', { class: 'olhead' }, [
      el('b', { text: `场景物体 ${app.objects.length}` }),
      el('span', { class: 'mini', text: '点选 · 双击重命名' }),
    ]));
    if (!app.objects.length) wrap.appendChild(el('div', { class: 'empty', text: '点上方「模型库」展开拖入，或用 ✦ 一句话生成造景' }));
    for (const so of app.objects) {
      const sel = app.selObj === so;
      const row = el('div', { class: 'orow' + (sel ? ' on' : '') });
      row.addEventListener('click', () => app.select({ kind: 'obj', so }));
      row.addEventListener('dblclick', () => {
        const n = prompt('重命名', so.name);
        if (n) { so.name = n; upd(); app.bus.emit('select'); }
      });
      const kids = [
        el('span', { class: 'odot', html: svg(so.item ? so.item.icon : 'import') }),
        el('span', { class: 'onm', text: so.name }),
        so.type === 'road_brush' ? el('span', { class: 'otag', text: '道路' }) : null,
        so.type === 'road_intersection' ? el('span', { class: 'otag', text: '路口' }) : null,
        so.motion?.active ? el('span', { class: 'otag', text: `路径 ${so.motion.keys.length}` }) : null,
        so.isChar ? el('span', { class: 'otag anim', text: ANIM_LABEL?.[so.root.userData.humans?.[0]?.anim] || so.root.userData.humans?.[0]?.anim || 'idle' }) : null,
        el('button', { class: 'ib', type: 'button', title: so.visible !== false ? '隐藏' : '显示', onclick: (e) => { e.stopPropagation(); so.visible = !(so.visible !== false); if (so.apply) so.apply(); else so.root.visible = so.visible; upd(); }, text: so.visible !== false ? '显' : '隐' }),
        el('button', { class: 'ib' + (so.locked ? ' on' : ''), type: 'button', title: '锁定', onclick: (e) => { e.stopPropagation(); so.locked = !so.locked; so.root.userData.locked = so.locked; upd(); }, text: so.locked ? '锁' : '解' }),
        el('button', { class: 'ib del', type: 'button', title: '删除', onclick: (e) => { e.stopPropagation(); app.removeObject(so); }, text: '×' }),
      ].filter(Boolean);
      row.append(...kids);
      wrap.appendChild(row);
    }
  };
  upd();
  app.bus.on('objects', upd);
  app.bus.on('select', upd);
  return { update: upd };
}

// ---------------------------------------------------------------------------
// 右侧检查器
// ---------------------------------------------------------------------------
export function buildInspector(app, host) {
  const tabsEl = el('div', { class: 'itabs' });
  const body = el('div', { class: 'ibody' });
  host.append(tabsEl, body);
  const TABS = [
    { id: 'obj', l: '物体' },
    { id: 'cam', l: '运镜' },
    { id: 'terr', l: '地形' },
    { id: 'light', l: '光影' },
    { id: 'exp', l: '导出' },
  ];
  const ctx = { cur: 'obj', sync: () => {} };
  TABS.forEach((t, i) => {
    const b = el('button', {
      class: 'itab' + (i === 0 ? ' on' : ''), type: 'button', text: t.l,
      onclick: () => { ctx.cur = t.id; [...tabsEl.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); render(); },
    });
    tabsEl.appendChild(b);
  });
  function render() {
    clear(body);
    ctx.sync = () => {};
    const t = ctx.cur;
    const r = t === 'obj' ? tabObject(app, render, ctx) : t === 'cam' ? tabCamera(app, render, ctx) : t === 'terr' ? tabTerrain(app, render, ctx) : t === 'light' ? tabLight(app, render, ctx) : tabExport(app, render, ctx);
    body.appendChild(r.root || r);
  }
  const upd = () => render();
  app.bus.on('select', upd);
  app.bus.on('objects', () => { if (ctx.cur === 'obj' || ctx.cur === 'cam') render(); });
  app.bus.on('shots', () => { if (ctx.cur === 'cam') render(); });
  app.bus.on('shot-change', () => { if (ctx.cur === 'cam') render(); });
  app.bus.on('perf-changed', upd);
  app.bus.on('terrain', () => { if (ctx.cur === 'terr') render(); });
  app.bus.on('terrain-workflow', () => { if (ctx.cur === 'terr') render(); });
  app.bus.on('tick', () => ctx.sync());
  render();
  return { render, get tab() { return ctx.cur; } };
}

/** Direct 页面简化检查器：只显示场景统计 */
export function buildDirectInspector(app, host) {
  const root = el('div', { class: 'tabwrap' });
  host.appendChild(root);
  function render() {
    clear(root);
    root.appendChild(el('div', { class: 'statbox' }, [
      statRow('场景物体', app.objects.length + ' 个'),
      statRow('机位', app.shots.length + ' 个'),
      statRow('三角面(近似)', triCount(app)),
      statRow('光影', app.lighting.enabled ? '开启' : '已关闭（内存优先）'),
    ]));
  }
  render();
  app.bus.on('objects', render);
  app.bus.on('shots', render);
  app.bus.on('perf-changed', render);
  return { render };
}

/** 参数表单：由 item.params 映射 */
function fieldsForItem(app, so) {
  const item = so.item;
  if (!item) return [];
  const out = [];
  for (const p of item.params) {
    if (p.t === 'primitive-model' || p.k === 'anim' || (p.k === 'glow' && isLuminaire(so))) continue;
    const f = { ...p, t: p.t === 'color' ? 'color' : p.t === 'bool' ? 'bool' : (p.t === 'sel' || p.t === 'select') ? 'sel' : p.t === 'int' ? 'int' : p.t === 'text' ? 'text' : 'range' };
    f.get = () => so.params[p.k];
    f.set = (v) => { app.beginOp('改参数 ' + (p.l || p.k), 'param:' + so.id + ':' + p.k); so.params[p.k] = v; scheduleRebuild(app, so); };
    out.push(f);
  }
  return out;
}
let rebuildTimer = null, rebuildSet = new Set();
function scheduleRebuild(app, so) {
  rebuildSet.add(so);
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    const list = [...rebuildSet];
    rebuildSet.clear();
    for (const o of list) {
      const was = app.selObj === o;
      app.rebuildObject(o);
      if (was) app.select({ kind: 'obj', so: app.byId(o.id) || o });
    }
  }, 130);
}

function tabObject(app, rerender, ctx) {
  let syncDiagnostic=()=>{},syncWindow=()=>{};
  const root = el('div', { class: 'tabwrap' });
  const so = app.selObj;
  const appearance = section('材质显示', { badge: app.state.tex === false ? '全局关闭' : '全局开启' });
  appearance.body.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn', type: 'button', dataset: { materials: 'all-off' }, text: '全部关闭', onclick: () => app.setTex(false) }),
    el('button', { class: 'fbtn', type: 'button', dataset: { materials: 'all-on' }, text: '全部开启', onclick: () => app.setTex(true) }),
  ]));
  if (so) {
    const mode = el('select', { class: 'sel', disabled: so.locked, dataset: { materials: 'object-mode' },
      onchange: e => app.appearance.setMode(so, e.target.value),
    }, [el('option', { value: 'inherit', text: '跟随全局' }), el('option', { value: 'on', text: '此物品单独开启' }), el('option', { value: 'off', text: '此物品单独关闭' })]);
    mode.value = so.materialMode || 'inherit';
    appearance.body.appendChild(el('div', { class: 'row' }, [el('label', { class: 'lab', text: '选中物品' }), el('div', { class: 'ctl' }, [mode])]));
  }
  appearance.body.appendChild(el('div', { class: 'fnote', text: '关闭为中性灰模，保留透明轮廓和自发光；可单独开启重点物品。设置随工程保存。全部开/关会重置单物品例外。' }));
  root.appendChild(appearance.wrap);
  if (so) root.appendChild(selectiveBloomControls(app, so));
  if(so){const window=windowLightingControls(app,rerender,so);if(window){root.appendChild(window.root);syncWindow=window.sync;}}
  if (!so) {
    root.appendChild(el('div', { class: 'hintbox' }, [
      el('b', { text: '未选择物体' }),
      el('p', { html: '· 从左侧素材库<b>拖拽</b>建筑 / 人物到视口，或单击卡片放置到视图中心。<br>· 点选物体后可改参数、加动作、连运动路径。<br>· <b>W</b> 移动 · <b>E</b> 旋转 · <b>R</b> 缩放 · <b>Del</b> 删除 · <b>Ctrl+D</b> 复制。<br>· 支持导入 <b>.glb / .gltf / .fbx / .obj</b> 模型。' }),
    ]));
    root.appendChild(el('div', { class: 'statbox' }, [
      statRow('场景物体', app.objects.length + ' 个'),
      statRow('机位', app.shots.length + ' 个'),
      statRow('三角面(近似)', triCount(app)),
      statRow('光影', app.lighting.enabled ? '开启' : '已关闭（内存优先）'),
    ]));
    return { root };
  }
  if(so.root.userData.primitiveModel) {
    const compound=section('AI组合粗模');
    compound.body.append(el('p',{class:'fnote',text:`${so.params.parts?.length||0} 个基础几何部件。可继续通过对话调整结构；不是纹理/任意拓扑生成。`}),
      el('button',{class:'fbtn wide',type:'button',dataset:{savePrimitiveLibrary:'1'},text:'保存到「我的模型」分组',onclick:async(e)=>{
        e.currentTarget.disabled=true;
        try{await app.modelLibrary.savePrimitive(so);app.notify('已保存为可复用模型，不会改动当前场景');}catch(error){app.notify(error.message,'warn');}
        finally{rerender();}
      }}));root.append(compound.wrap);
  }
  // ---- 变换
  const tf = {
    name: so.name,
    pos: so.root.position.toArray().map((v) => +v.toFixed(2)),
    rot: [deg(so.root.rotation.x), deg(so.root.rotation.y), deg(so.root.rotation.z)].map((v) => +v.toFixed(1)),
    scl: [+so.root.scale.x.toFixed(3), +so.root.scale.y.toFixed(3), +so.root.scale.z.toFixed(3)],
  };
  const behaviorLocked = hasBehavior(so);
  const tfFields = [
    { k: 'name', l: '名称', t: 'txt', set: (v) => { so.name = v; app.bus.emit('objects'); } },
    { k: 'pos', l: '位置 m', t: 'vec3', d: 2, set: (v) => { so.root.position.fromArray(v); if (so.motion?.active) syncMotionKeys(app, so); } },
    { k: 'rot', l: '旋转 °', t: 'vec3', d: 1, step: 1, set: (v) => so.root.rotation.set(rad(v[0]), rad(v[1]), rad(v[2])) },
    { k: 'scl', l: '缩放', t: 'vec3', d: 3, step: 0.05, set: (v) => so.root.scale.set(clamp(v[0], 0.01, 40), clamp(v[1], 0.01, 40), clamp(v[2], 0.01, 40)) },
    {
      k: '_u', l: '落回地面', t: 'btn', onClick: () => {
        const bb = new THREE.Box3().setFromObject(so.root);
        if (!bb.isEmpty()) { so.root.position.y -= bb.min.y; so.root.position.y = +so.root.position.y.toFixed(3); }
        rerender();
      }, btn2: { l: '贴地+居中', onClick: () => { const bb = new THREE.Box3().setFromObject(so.root); so.root.position.y -= bb.min.y; app.focusSelected(); rerender(); } },
    },
    {
      k: '_d', l: '复制对象', t: 'btn', onClick: () => app.duplicateSelected(),
      btn2: { l: '删除', onClick: () => { app.removeObject(so); rerender(); } },
    },
  ];
  if (behaviorLocked) { for (let i = tfFields.length - 1; i >= 0; i--) if (['pos', 'rot', 'scl', '_u'].includes(tfFields[i].k)) tfFields.splice(i, 1); }
  for(const f of tfFields)if(['pos','rot','scl'].includes(f.k)){const set=f.set;f.set=v=>{app.beginOp('变换 '+f.l,'transform:'+so.id+':'+f.k);set(v);};}
  const f1 = section('变换 / Transform');
  const form1 = buildForm(tfFields, tf, (key) => { if(['pos','rot','scl'].includes(key))app.layout?.afterHostEdit(so); app.bus.emit('objects'); });
  f1.body.appendChild(form1.root);
  root.appendChild(f1.wrap);

  const lampControls = luminaireControls(app, so);
  if (lampControls) root.appendChild(lampControls);
  // ---- 模型参数
  if (so.item) {
    const f2 = section(`${so.item.name} 参数`, { badge: so.item.type });
    const form2 = buildForm(fieldsForItem(app, so), so.params, () => { });
    if (behaviorLocked) { form2.root.querySelectorAll('input,select,button,textarea').forEach(n => n.disabled = true); f2.body.appendChild(el('p', { class: 'fnote', text: '人物参数由行为方案锁定；请先移除方案再编辑。' })); }
    f2.body.appendChild(form2.root);
    root.appendChild(f2.wrap);
  } else if (so.type === 'road_brush' || so.type === 'road_intersection') {
    const rd = so._roadData;
    const f2 = section(so.type === 'road_brush' ? '道路参数' : '交叉路口', { badge: so.type === 'road_brush' ? (rd?.roadType?.id || 'road') : 'intersection' });
    const html = so.type === 'road_brush'
      ? `类型：${rd?.roadType?.label || '-'}<br>宽度：${rd?.width ?? '-'} m<br>控制点：${rd?.ctrl?.length ?? 0} 个<br><i>选中后可用 W/E/R 整体移动 / 旋转 / 缩放；点「编辑此路」可重新改线（生成后的道路、基座、小径都能再编辑）；删除会同时清理其交叉路口。</i>`
      : `交叉点：${(so._isect?.point?.x ?? 0).toFixed(1)}, ${(so._isect?.point?.z ?? 0).toFixed(1)}<br><i>路口面片由两条道路自动生成；删除后两侧路面恢复连续。</i>`;
    f2.body.appendChild(el('div', { class: 'fnote', html }));
    if (so.type === 'road_brush') {
      const commit = (props) => {
        if (!app.roadBrush.updateRoadProperties(so, props)) {
          toast(so.locked ? '请先解锁道路' : '未能修改：请先完成当前绘制，并检查道路参数', 'warn');
          rerender();
        }
      };
      const typeSelect = el('select', { class: 'sel', disabled: so.locked, dataset: { roadProperty: 'type' },
        onchange: e => commit({ roadType: e.target.value }),
      }, ROAD_TYPES.map(t => el('option', { value: t.id, text: t.label })));
      typeSelect.value = rd?.roadType?.id || 'asphalt';
      const widthNum = el('input', { class: 'num', type: 'number', min: 1, max: 20, step: .5,
        value: rd?.width || 12, disabled: so.locked, dataset: { roadProperty: 'width' },
        onchange: e => commit({ width: e.target.valueAsNumber }),
      });
      const widthRange = el('input', { class: 'rng', type: 'range', min: 1, max: 20, step: .5,
        value: rd?.width || 12, disabled: so.locked, dataset: { roadProperty: 'width-range' },
        oninput: e => { widthNum.value = e.target.value; },
        onchange: e => commit({ width: Number(e.target.value) }),
      });
      f2.body.append(
        el('div', { class: 'row' }, [el('label', { class: 'lab', text: '道路类型' }), el('div', { class: 'ctl' }, [typeSelect])]),
        el('div', { class: 'row' }, [el('label', { class: 'lab', text: '宽度 m' }), el('div', { class: 'ctl' }, [el('div', { class: 'rg' }, [widthRange, widthNum])])]),
        el('div', { class: 'fnote', text: so.locked ? '道路已锁定，请先解锁再修改。' : '退出绘制后重新选中也能修改；类型选择后立即生效，宽度拖动结束或输入后离开输入框生效。支持 Ctrl+Z 撤销。' }),
      );
      const terrainControls=buildForm([
        {k:'mode',l:'地形关系',t:'sel',opts:[{v:'follow',l:'随地形（横断面保持平整）'},{v:'fixed',l:'固定标高（高架 / 桥梁）'}],set:v=>app.roadTerrain.setRoad(so,{terrainMode:v})},
        {k:'level',l:'起点标高 m',t:'range',commit:true,min:-20,max:100,step:.5,set:v=>app.roadTerrain.liftRoad(so,v)},
        {k:'bridges',l:'自动桥墩',t:'bool',on:'高于地面时生成',set:v=>app.roadTerrain.setRoad(so,{bridges:v})},
        {k:'spacing',l:'桥墩间距 m',t:'range',commit:true,min:6,max:30,step:1,set:v=>app.roadTerrain.setRoad(so,{pierSpacing:v})},
        {k:'threshold',l:'架空阈值 m',t:'range',commit:true,min:.8,max:6,step:.2,set:v=>app.roadTerrain.setRoad(so,{bridgeThreshold:v})},
      ],{mode:rd.terrainMode||'fixed',level:rd.ctrl[0][1],bridges:rd.bridges!==false,spacing:rd.pierSpacing||12,threshold:rd.bridgeThreshold||1.8},()=>{});
      terrainControls.root.dataset.roadTerrain='1';
      if(so.locked)terrainControls.root.querySelectorAll('input,select,button').forEach(e=>e.disabled=true);
      f2.body.appendChild(terrainControls.root);
      const diagnostic=roadDiagnosticControls(app,so);f2.body.appendChild(diagnostic.root);
      syncDiagnostic=diagnostic.sync;
      const bridge=so.root.userData.bridgeStatus;
      f2.body.appendChild(el('div',{class:'fnote',dataset:{bridgeStatus:'1'},text:`桥墩 ${bridge?.built||0} 处 · 受阻未放置 ${bridge?.blocked||0} 处。柱身及承托体积避让下层道路、建筑；相交植物会删除且可随操作撤销；受阻时尝试沿路移位，仍冲突则留空，不强行穿插。固定标高不会自动挖山；可压低地形或抬高道路。非结构工程校核。`}));
      f2.body.appendChild(el('button',{class:'fbtn wide',type:'button',disabled:so.locked,text:'抬高路基，填充此路下方空隙',dataset:{roadFill:'1'},onclick:()=>{const count=app.roadTerrain.fillRoad(so);toast(`已填充 ${count||0} 个地形顶点；避开下层道路和建筑，可撤销`);}}));
      f2.body.appendChild(el('button', { class: 'fbtn wide', type: 'button', disabled: so.locked, text: '编辑路径圆点（拖动调整）', onclick: () => {
        if (app.roadBrush.editRoad(so)) {
          toast('画笔已接管：拖动控制点改线，双击 / Enter 完成，Esc 放弃并恢复原路');
          rerender();
        } else toast('这条路暂时无法编辑', 'warn');
      } }));
    }
    root.appendChild(f2.wrap);
  } else if (so.type === 'vegetation_patch') {
    const f2 = section('植被笔刷区域', { badge: `${so.params.plants?.length || 0} 株` });
    f2.body.appendChild(el('div', { class: 'fnote', text: '实例化植被按区域保存，可整体选择、移动或锁定；地形页启用植被笔刷后按 Shift 擦除。锁定区域不会被擦除。' }));
    root.appendChild(f2.wrap);
  } else {
    const f2 = section('导入模型', { badge: 'import' });
    f2.body.appendChild(el('div', { class: 'fnote', html: `文件：${so.params?.file || '外部模型'}<br>包围盒：${(so.params?.size || []).map((v) => fmt(v, 2) + 'm').join(' × ')}<br><i>导入模型与贴图随 .previz 工程包保存；多文件模型请连同 .bin / .mtl / 图片一起导入。</i>` }));
    const tag=buildForm([{k:'vegetation',l:'作为植被清理',t:'bool',on:'道路 / 桥墩碰撞时可删除',set:v=>{app.beginOp('导入模型植被分类');so.params.isVegetation=v;app.bus.emit('objects');}}],{vegetation:!!so.params.isVegetation},()=>{});
    f2.body.appendChild(tag.root);
    root.appendChild(f2.wrap);
  }

  // ---- 人物动作
  if (so.isChar && !behaviorLocked) {
    const f3 = section('动作参考 / Action');
    const st = { anim: so.root.userData.humans?.[0]?.anim || 'idle', speed: so.motion.speed ?? 1, amp: 1, phase: 0 };
    const form3 = buildForm([
      { k: 'anim', l: '动作', t: 'sel', opts: [{ v: '', l: '—' }, ...ANIMS.map((a) => ({ v: a.v, l: a.l }))], set: (v) => { so.motion.anim = v; so.root.userData.humans?.forEach((h) => { h.anim = v; }); } },
      { k: 'speed', l: '播放速度', t: 'range', min: 0, max: 3, step: 0.05, set: (v) => { so.motion.speed = v; } },
      { k: 'phase', l: '相位偏移 °', t: 'range', min: 0, max: 360, step: 5, get: () => deg(so.root.userData.animPhase || 0) % 360, set: (v) => { so.root.userData.animPhase = rad(v); } },
      { k: '_t', l: '播放中冻结', t: 'btn', onClick: () => { app.state.playing = !app.state.playing; toast(app.state.playing ? '播放' : '暂停'); }, btn2: { l: '随机相位', onClick: () => { so.root.userData.animPhase = Math.random() * 6.28; rerender(); } } },
    ], st, () => { });
    f3.body.appendChild(form3.root);
    root.appendChild(f3.wrap);
  }

  // ---- 运动路径（道路 / 路口为整体网格，不参与走位）
  const isRoad = so.type === 'road_brush' || so.type === 'road_intersection';
  if (so.item?.type === 'human' && so.isChar && !so.root.userData.crowd) root.appendChild(behaviorControls(app, so));
  if (!isRoad && !behaviorLocked) {
  const f4 = section('运动路径 / 走位', { badge: so.motion?.keys?.length ? `${so.motion.keys.length} 点` : '静态' });
  const mt = {
    active: !!so.motion.active, loop: so.motion.loop !== false, autoFace: so.motion.autoFace !== false,
    easing: so.motion.easing || 'linear',
  };
  const form4 = buildForm([
    { k: 'active', l: '启用路径', t: 'bool', set: (v) => { so.motion.active = v; rebuildMotion(app, so); } },
    { k: 'autoFace', l: '朝向前进方向', t: 'bool', when: () => so.isChar, set: (v) => { so.motion.autoFace = v; } },
    { k: 'loop', l: '循环播放', t: 'bool', set: (v) => { so.motion.loop = v; } },
    { k: 'easing', l: '速度曲线', t: 'sel', opts: EASE_OPTIONS, set: (v) => { so.motion.easing = v; } },
    {
      k: '_a', l: '记录当前位置为关键帧', t: 'btn', onClick: () => {
        app.addObjectKey(so);
        rerender();
      },
      btn2: { l: '清空路径', onClick: () => { app.clearMotion(so); rerender(); } },
    },
    { k: '_n', l: '', t: 'note', help: 1 },
  ], mt, () => { });
  const note = form4.root.querySelector('.fnote');
  if (note) {
    note.innerHTML = so.motion.active && so.motion.keys.length
      ? so.motion.keys.map((k, i) => `<span class="kwrap"><button class="kchip${app.selKeyIdx === i && app.sel?.kind === 'objkey' ? ' on' : ''}" data-i="${i}">K${i + 1} · ${((k.t || 0) * 100).toFixed(0)}%</button><button class="kdel" data-i="${i}" title="删除该关键帧">×</button></span>`).join('') + '<span class="fnote-t">拖动视口里的绿色节点可修改走位</span>'
      : '先在时间轴上把指针移动到某个时刻，再点「记录当前位置为关键帧」；换时间、挪位置，重复即可生成走位路线。';
    note.querySelectorAll('.kchip').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      app.state.time = (so.motion.keys[i].t || 0) * app.state.duration;
      app.bus.emit('time');
      app.selectKey(so, i);
      const del = b.nextElementSibling;
    }));
    note.querySelectorAll('.kdel').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      app.selectKey(so, +b.dataset.i);
      app.removeObjectKey(so, +b.dataset.i);
      rerender();
    }));
  }
  f4.body.appendChild(form4.root);
  root.appendChild(f4.wrap);
  }

  // 视口里拖动时，让表单数值实时跟随
  ctx.sync = () => {
    tf.pos = so.root.position.toArray().map((v) => +v.toFixed(2));
    tf.rot = [deg(so.root.rotation.x), deg(so.root.rotation.y), deg(so.root.rotation.z)].map((v) => +v.toFixed(1));
    tf.scl = so.root.scale.toArray().map((v) => +v.toFixed(3));
    form1.update();syncDiagnostic();syncWindow();
  };
  return { root };
}

function motionOpts(so) {
  return { ease: so.motion.easing || 'linear', scope: so.motion.scope || 'global', arc: so.motion.arc !== false, rot: 'slerp', tension: so.motion.tension ?? 0.5 };
}
function rebuildMotion(app, so) {
  so.motion.mover = so.motion.active && so.motion.keys?.length > 1 ? new Mover(so.motion.keys, false, motionOpts(so)) : null;
  so.rebuildMarkers();
  app.bus.emit('objects');
}
function syncMotionKeys(app, so) {
  so.motion.mover = so.motion.keys?.length > 1 ? new Mover(so.motion.keys, false, motionOpts(so)) : null;
  so.rebuildMarkers();
}
function statRow(k, v) { return el('div', { class: 'srow' }, [el('span', { text: k }), el('b', { text: String(v) })]); }
function triCount(app) {
  let n = 0;
  app.stage.world.traverse((o) => { const g = o.geometry; if (g?.index) n += g.index.count / 3; else if (g?.attributes?.position) n += g.attributes.position.count / 3; });
  return Math.round(n).toLocaleString();
}

// ---------------------------------------------------------------------------
function tabCamera(app, rerender, ctx) {
  const root = el('div', { class: 'tabwrap' });
  root.appendChild(shotChips(app, rerender));
  const s = app.selShot || app.activeShot;
  const bar = el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn wide', type: 'button', text: '+ 新建机位（空白）', onclick: () => { const p = app.stage.view.position.clone(); const st = app.stage; app.addShot({ pos: p.toArray(), quat: [st.view.quaternion.x, st.view.quaternion.y, st.view.quaternion.z, st.view.quaternion.w] }); rerender(); } }),
    el('button', { class: 'fbtn wide alt', type: 'button', text: '⎈ 以当前视角建机位', onclick: () => { app.shotFromView(); rerender(); } }),
  ]);
  root.appendChild(bar);
  if (!s) { root.appendChild(el('div', { class: 'hintbox' }, [el('p', { text: '还没有机位。新建后：先定机位，再选运镜预设生成路径，最后逐个拖动关键帧微调。' })])); return root; }

  const state = {
    name: s.name, model: s.model, sensor: s.sensor, focal: s.focal, hfov: +deg(s.hFov()).toFixed(1),
    duration: s.duration, easing: s.easing, aim: s.aim, targetId: s.targetId || '', handheld: s.handheld,
    nKeys: s.nKeys, move: s.move, showPath: s.showPath, follow: s.follow,
    ...s.moveParams,
  };
  const move = MOVE_BY_ID[s.move];

  const g1 = section('机位 / 镜头');
  const f1 = buildForm([
    { k: 'name', l: '机位名', t: 'txt', set: (v) => { s.name = v; app.bus.emit('shots'); } },
    { k: 'model', l: '摄影机', t: 'sel', opts: CAMERA_MODELS.map((m) => ({ v: m.v, l: m.l })), set: (v) => { s.model = v; const m = CAMERA_MODELS.find((x) => x.v === v); if (m) { s.sensor = m.sensor; f1.update(); } } },
    { k: 'sensor', l: '画幅', t: 'sel', opts: SENSORS.map((x) => ({ v: x.v, l: x.l })), set: (v) => { s.sensor = v; } },
    { k: 'focal', l: '焦距 mm', t: 'range', min: 8, max: 300, step: 1, set: (v) => { s.focal = v; state.hfov = +deg(s.hFov()).toFixed(1); } },
    { k: 'hfov', l: '水平视角 °', t: 'range', min: 5, max: 130, step: 0.5, set: (v) => { s.focal = clamp(s.focalFromHfov(v), 4, 900); state.hfov = v; } },
    { k: '_l', l: '', t: 'note' },
    { k: 'duration', l: '镜头时长 s', t: 'range', min: 0.5, max: 40, step: 0.5, set: (v) => { s.duration = v; if (!app.cameraEdit.clips.length) app.state.duration = v; app.bus.emit('time'); } },
    { k: 'easing', l: '整体缓动', t: 'sel', opts: EASE_OPTIONS, set: (v) => { s.easing = v; } },
    { k: 'handheld', l: '手持/呼吸', t: 'range', min: 0, max: 0.06, step: 0.002, help: '越大越晃；0.004–0.008 ≈ 肩扛，>0.02 已经失控', set: (v) => { s.handheld = v; } },
    { k: 'spinCapOn', l: '防甩断', t: 'bool', on: '开', help: '限制单帧最大角速度（约 240°/s）：路径或注视点突然翻面时，镜头不会被甩成一帧黑洞', get: () => s.spinCap !== 0, set: (v) => { s.spinCap = v ? null : 0; } },
    { k: 'groundClear', l: '自动避地', t: 'bool', on: '开', help: '路径钻进地形/地面时把机位托到地表之上（想贴着水面/地面拍就关掉）', get: () => s.groundClear !== false, set: (v) => { s.groundClear = v; } },
    { k: 'clearance', l: '最低离地 m', t: 'range', min: 0.2, max: 6, step: 0.1, get: () => (s.clearance == null ? 1.35 : s.clearance), set: (v) => { s.clearance = v; } },
    { k: 'nKeys', l: '路径关键帧数', t: 'int', min: 2, max: 48, step: 1, set: (v) => { s.nKeys = v; } },
  ], state, () => { app.bus.emit('shot-change'); });
  const lensRow = el('div', { class: 'lensrow' });
  const cm = CAMERA_MODELS.find((m) => m.v === s.model) || CAMERA_MODELS[0];
  for (const fl of cm.lenses) lensRow.appendChild(el('button', { class: 'chip small' + (Math.abs(s.focal - fl) < 0.5 ? ' on' : ''), type: 'button', text: fl + 'mm', onclick: () => { s.focal = fl; state.focal = fl; state.hfov = +deg(s.hFov()).toFixed(1); f1.update(); app.bus.emit('shot-change'); } }));
  g1.body.appendChild(f1.root);
  g1.body.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn alt', type: 'button', title: '复制一个相同位置/焦距的机位', text: '复制机位', onclick: () => { const rp = s.rig.position, rq = s.rig.quaternion;
        const c = app.addShot({ name: s.name + ' 副本', focal: s.focal, pos: rp.toArray(), quat: [rq.x, rq.y, rq.z, rq.w], duration: s.duration, keys: s.keys.map((k) => ({ ...k, p: [...k.p], q: k.q ? [...k.q] : null })) });
        if (c) { c.move = s.move || ''; c.moveParams = { ...(s.moveParams || {}) }; c.handheld = s.handheld; c.easing = s.easing; c.setMotionOpt && Object.entries(s.moverOpts() || {}).forEach(([k2, v2]) => c.setMotionOpt(k2, v2)); } app.bus.emit('shots'); if (c) { app.setActiveShot(c); toast(`已复制机位「${c.name}」（含 ${s.keys.length} 个关键帧）`); } } }),
    el('button', { class: 'fbtn', type: 'button', title: '删除当前机位（Ctrl+Z 可撤销）', text: '删除机位', onclick: () => { const nm = s.name; app.removeShot(s); rerender(); toast(`已删除机位 ${nm} · 可 Ctrl+Z 撤销`); } }),
  ]));
  g1.body.appendChild(el('div', { class: 'mini-lab', text: '常用镜头（自动匹配画幅 FOV）' }));
  g1.body.appendChild(lensRow);
  root.appendChild(g1.wrap);

  // ---- 运镜预设
  const g2 = section('运镜预设 / Camera Move');
  const mv = { move: s.move, desc: move?.desc || '选择预设后点「生成路径」。所有关键帧仍可手动拖动微调。' };
  const mf = buildForm([
    { k: 'move', l: '预设', t: 'sel', opts: MOVE_OPTS, set: (v) => { s.generateMove(v); mv.desc = MOVE_BY_ID[v]?.desc || '手工关键帧：自由拖动每个节点。'; app.bus.emit('shot-change'); rerender(); } },
    { k: 'desc', l: `<span class="mvdesc">${mv.desc}</span>`, t: 'note' },
    ...(move ? move.params.map((p) => ({
      ...p, t: p.t === 'bool' ? 'bool' : (p.t === 'sel' || p.t === 'select') ? 'sel' : p.t === 'range' ? 'range' : 'range',
      get: () => state[p.k], set: (v) => { state[p.k] = v; s.moveParams[p.k] = v; },
    })) : []),
    ...(move ? [{ k: '_g', l: '重新生成路径', t: 'btn', onClick: () => { s.moveParams = { ...s.moveParams, ...state }; s.generateMove(s.move); rerender(); toast('已按参数生成 ' + s.keys.length + ' 个关键帧'); }, btn2: { l: '清空为静态', onClick: () => { s.generateMove(''); rerender(); } } }] : []),
  ], mv, () => { });
  g2.body.appendChild(mf.root);
  root.appendChild(g2.wrap);

  // ---- 流畅度 / 关键帧曲线（解决「到关键帧就停顿」）
  const gQ = section('流畅度 / 曲线', { badge: '关键帧不顿感' });
  const q = {
    scope: s.motionScope || 'global', arc: s.arcSpeed !== false, tension: s.tension ?? 0.5,
    rot: s.rotMode || 'spline', easing: s.easing, hasCurve: !!s.curves?.prog,
  };
  const qf = buildForm([
    { k: 'scope', l: '缓动作用域', t: 'sel', help: '全局=整段镜头只缓动一次（关键帧处不停顿）；逐段=每个关键帧都减速（旧行为，逐帧强调用）', opts: [{ v: 'global', l: '全局（推荐）' }, { v: 'segment', l: '逐段' }], set: (v) => s.setMotionOpt('scope', v) },
    { k: 'easing', l: '缓动曲线', t: 'sel', opts: EASE_OPTIONS, set: (v) => { s.easing = v; s.setMotionOpt('ease', v); } },
    { k: 'arc', l: '匀速（弧长参数化）', t: 'bool', on: '开', help: '沿路径等速行进，避免直段快弯段慢', set: (v) => s.setMotionOpt('arc', v) },
    { k: 'tension', l: '路径张力', t: 'range', min: 0, max: 1, step: 0.02, help: '0=折线带圆角，1=最饱满的样条', set: (v) => s.setMotionOpt('tension', v) },
    { k: 'rot', l: '朝向插值', t: 'sel', opts: [{ v: 'spline', l: '向量样条（顺）' }, { v: 'slerp', l: '球面插值（准）' }], set: (v) => s.setMotionOpt('rot', v) },
    { k: 'hasCurve', l: '已有关键帧曲线', t: 'bool', on: '是', help: '在「进度」通道里拖点即可改快慢；关闭＝匀速', set: (v) => { if (!v) s.setCurve('prog', null); else s.applyCurvePreset('easeInOut'); qf.update(); } },
    {
      k: '_q', l: '平滑体检', t: 'btn', onClick: () => {
        const d = s.motionDiag ? s.motionDiag() : null;
        if (!d) return;
        const verdict = d.keyDip <= 0.12 ? '过关键帧不掉速 ✓' : d.keyDip <= 0.5 ? '过关键帧有轻微变速' : '过关键帧明显停顿 —— 把缓动作用域改回「全局」或按弧长重排时间';
        toast(`相对速度 ${d.min.toFixed(2)}×–${d.max.toFixed(2)}× ｜ 关键帧处掉速 ${(d.keyDip * 100).toFixed(0)}% · ${verdict}`);
      }, btn2: { l: '曲线同步到全部机位', onClick: () => { app.syncMotionToAll(s, false); toast('已把流畅度与曲线同步到全部机位'); } },
    },
    {
      k: '_r', l: '按弧长重排时间（真匀速）', t: 'btn', onClick: () => {
        const r = s.retimeKeysByArc ? s.retimeKeysByArc() : null;
        if (!r) { toast('关键帧少于 3 个或路径太短，无需重排'); return; }
        const d = s.motionDiag();
        app.bus.emit('shots'); app.bus.emit('shot-change'); rerender();
        toast(`已按弧长重排 ${s.mover.count} 个关键帧 · 速度 ${d.min.toFixed(2)}×–${d.max.toFixed(2)}× ｜ 关键帧处掉速 ${(d.keyDip * 100).toFixed(0)}%`);
      }, btn2: { l: '全部机位重排', onClick: () => {
        let hit = 0;
        for (const x of app.shots) if (x.retimeKeysByArc()) hit++;
        for (const so of app.objects) if (so.motion?.mover?.retimeByArc?.()) { so.rebuildMarkers(); hit++; }
        app.bus.emit('shots'); app.bus.emit('objects'); rerender();
        toast(`已重排 ${hit} 条路径的时间`);
      } },
    },
    {
      k: '_c', l: '', t: 'btns', items: [
        { l: '📈 打开曲线编辑', onClick: () => { app.curve?.toggle(); }, help: '拖点改快慢（快捷键 V）' },
        ...CURVE_PRESETS.map((c) => ({ l: c.name, onClick: () => { s.applyCurvePreset(c.id); app.bus.emit('shot-change'); rerender(); toast('已套用曲线：' + c.name); }, help: c.desc })),
      ],
    },
  ], q, () => { app.bus.emit('shot-change'); });
  gQ.body.appendChild(qf.root);
  gQ.body.appendChild(el('div', { class: 'fnote', html: '曲线抽屉：进度通道控制整段快慢（纵向＝时间百分比），视场通道可给变焦打点；右击删点、双击切模式。' }));
  root.appendChild(gQ.wrap);

  // ---- 目标 / 朝向
  const g3 = section('主体 / 朝向');
  const tg = { targetId: s.targetId || '', aim: s.aim };
  const objOpts = [{ v: '', l: '— 无 —' }, ...app.objects.map((o) => ({ v: o.id, l: `${o.name}（${o.type}）` }))];
  const f3 = buildForm([
    { k: 'targetId', l: '锁定主体', t: 'sel', opts: objOpts, num: false, set: (v) => { s.setTarget(v ? app.byId(v) : null); if (v && tg.aim === 'keys') { } } },
    { k: 'aim', l: '朝向来源', t: 'sel', opts: [{ v: 'keys', l: '关键帧朝向（可逐帧调）' }, { v: 'target', l: '始终对准主体' }, { v: 'none', l: '不对准（自由）' }], set: (v) => { s.aim = v; } },
    { k: 'follow', l: '跟随模式（相对主体偏移）', t: 'bool', set: (v) => { s.follow = v; if (v && !s.targetId) toast('请先指定锁定主体'); } },
    { k: '_f', l: '全部关键帧对准主体', t: 'btn', onClick: () => { aimAllKeys(s); rerender(); toast('已重算朝向'); }, btn2: { l: '对准选中物体', onClick: () => { if (app.selObj) { s.setTarget(app.selObj); aimAllKeys(s); rerender(); } else toast('先选中一个物体'); } } },
  ], tg, () => { app.bus.emit('shot-change'); });
  g3.body.appendChild(f3.root);
  root.appendChild(g3.wrap);

  // ---- 关键帧
  const g4 = section('关键帧 / Path Nodes', { badge: `${s.keys.length} 点` });
  const st4 = { t: s.keys[s.selKey]?.t ?? 0, editWhole: app.editWhole, y: s.keys[s.selKey]?.p[1] ?? 0 };
  const f4 = buildForm([
    { k: 'editWhole', l: '整段位移模式', t: 'bool', help: '开启后拖动手柄移动整条路径', set: (v) => { app.editWhole = v; app.select({ kind: 'shot', shot: s }); } },
    {
      k: '_r', l: '记录当前视角到当前时间', t: 'btn', onClick: () => {
        s.addKeyAt(app.timeline.u);
        rerender(); toast('已添加关键帧');
      }, btn2: { l: '删除当前帧', onClick: () => { if (s.selKey >= 0) s.removeKeyAt(s.selKey); rerender(); } },
    },
    { k: 't', l: '当前帧时间', t: 'range', min: 0, max: 1, step: 0.01, when: () => s.keys.length > 0, set: (v) => { const k = s.keys[s.selKey]; if (k) { k.t = v; s.mover.rebuild(); s.refreshGizmos(); app.state.time = v * app.state.duration; app.bus.emit('time'); } } },
    { k: 'y', l: '当前帧高度 m', t: 'range', min: -2, max: 260, step: 0.1, when: () => s.keys.length > 0, set: (v) => { const k = s.keys[s.selKey]; if (k) { k.p[1] = v; s.mover.rebuild(); s.refreshGizmos(); } } },
    { k: '_k', l: '', t: 'note' },
  ], st4, () => { });
  const kn = f4.root.querySelector('.fnote');
  if (kn) {
    kn.innerHTML = s.keys.length
      ? s.keys.map((k, i) => `<button class="kchip${i === s.selKey ? ' on' : ''}" data-i="${i}" title="高度 ${fmt(k.p[1], 1)}m${k.f != null ? ' · 视角 ' + k.f + '°' : ''}">K${i + 1}<em>${(k.t * 100).toFixed(0)}%</em></button>`).join('')
      : '<span class="fnote-t">无关键帧：拖动手柄移动机位本体；用上方预设生成路径后可逐帧编辑。</span>';
    kn.querySelectorAll('.kchip').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      app.selectKey(s, i);
      app.state.time = (s.keys[i].t || 0) * app.state.duration;
      app.bus.emit('time');
      rerender();
    }));
  }
  g4.body.appendChild(f4.root);
  root.appendChild(g4.wrap);
  return { root };
}

function shotChips(app, rerender) {
  const wrap = el('div', { class: 'shotchips' });
  if (!app.shots.length) wrap.appendChild(el('div', { class: 'empty', text: '还没有机位 — 用下方按钮创建' }));
  app.shots.forEach((s) => {
    wrap.appendChild(el('button', {
      class: 'schip' + (app.activeShot === s ? ' on' : ''), type: 'button', style: `border-left:3px solid ${s.colorHex}`,
      title: `${s.name}｜${s.move ? MOVE_BY_ID[s.move].name : '手工路径'}｜${s.keys.length} 关键帧`,
      onclick: () => { app.setActiveShot(s); app.select({ kind: 'shot', shot: s }); rerender(); },
    }, [el('b', { text: s.name }), el('i', { text: s.keys.length ? `${s.keys.length}K` : '静态' })]));
  });
  return wrap;
}

function aimAllKeys(s) {
  const tgt = s.target;
  if (!tgt) return;
  const tw = tgt.root.getWorldPosition(new THREE.Vector3());
  const bb = new THREE.Box3().setFromObject(tgt.root);
  if (!bb.isEmpty()) tw.y = (bb.min.y + bb.max.y) / 2;
  s.rig.updateMatrixWorld(true);
  const inv = s.rig.matrixWorld.clone().invert();
  const localTarget = tw.clone().applyMatrix4(inv);
  for (const k of s.mover.keys) {
    const from = new THREE.Vector3().fromArray(k.p);
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4().lookAt(from, localTarget, new THREE.Vector3(0, 1, 0));
    q.setFromRotationMatrix(m);
    k.q = [q.x, q.y, q.z, q.w];
  }
  s.mover.rebuild();
  s.refreshGizmos();
  s.markDirty();
}

// ---------------------------------------------------------------------------
/** 地形编辑：笔刷 / 生成 / 水面 / 贴地 */
function tabTerrain(app, rerender, ctx) {
  const root = el('div', { class: 'tabwrap' });
  const tr = app.terrain;
  if (!tr) { root.appendChild(el('div', { class: 'hintbox' }, [el('p', { text: '地形模块未加载。' })])); return root; }
  app.panels = app.panels || {};
  app.panels.terrainHost = root;
  const st = app.state;

  const g0 = section('地形与网格', { badge: tr.enabled ? '开启' : '关闭' });
  const f0 = buildForm([
    { k: 'enabled', l: '启用地形', t: 'bool', on: '开', set: (v) => { tr.setEnabled(v); rerender(); } },
    { k: 'biome', l: '地貌配色', t: 'sel', opts: Object.entries(BIOMES).map(([k, b]) => ({ v: k, l: b.name })), set: (v) => tr.setBiome(v) },
    { k: 'gen', l: '一键生成', t: 'sel', opts: [{ v: '', l: '— 选择地形 —' }, ...Object.entries(TERRAIN_GEN).map(([k, g]) => ({ v: k, l: g.name }))], num: false },
    { k: 'amp', l: '起伏幅度 m', t: 'range', commit: true, min: 0.5, max: 80, step: 0.5 },
    { k: 'seed', l: '随机种子', t: 'int', commit: true, min: 1, max: 2147483647, step: 1 },
    { k: '_g', l: '生成地形 + 自动地貌', t: 'btn', noUndo: true, onClick: (s) => { if (!s.gen) { toast('先选一种地形'); return; } tr.generate(s.gen, s.amp, s.seed); toast('已生成' + TERRAIN_GEN[s.gen].name + '，保留手绘材质，可撤销'); }, btn2: { l: '全部抹平', onClick: () => { tr.h.fill(0); tr.refresh(); app.bus.emit('terrain'); app.saveLocal(); } } },
    { k: 'exag', l: '高度夸张', t: 'range', min: 0.2, max: 3, step: 0.05, set: (v) => tr.setExaggerate(v) },
    { k: 'res', l: '网格密度', t: 'sel', opts: [{ v: 33, l: '33（省）' }, { v: 65, l: '65' }, { v: 97, l: '97（默认）' }, { v: 129, l: '129（细）' }, { v: 257, l: '257（精细）' }, { v: 513, l: '513（超细 / 较慢）' }], num: true, set: (v) => tr.setResolution(v) },
    { k: 'size', l: '地形尺寸 m', t: 'range', min: 60, max: 400, step: 10, set: (v) => tr.setSize(v) },
    { k: 'follow', l: '物体自动贴地', t: 'bool', on: '跟随地形', help: '拖动模型时自动落到地形表面；抬高 1.6m 以上视为刻意悬空', set: (v) => { st.followTerrain = v; if (!v) for (const o of app.objects) o.followTerrain = false; else { for (const o of app.objects) if (!['fx','road_brush','road_intersection','vegetation_patch'].includes(o.type)) { o.followTerrain = true; o.apply?.(); } } app.bus.emit('objects'); } },
  ].map(f => { if(f.set){const set=f.set;f.set=(v)=>{app.beginOp('地形：'+f.l,'terrain-setting:'+f.k);set(v);};} if(f.onClick&&!f.noUndo){const click=f.onClick;f.onClick=(...args)=>{app.beginOp('地形：'+f.l);click(...args);};} if(f.btn2){const click=f.btn2.onClick;f.btn2.onClick=(...args)=>{app.beginOp(f.btn2.l);click(...args);};} return f; }), { enabled: tr.enabled, biome: tr.biome, gen: tr.generation.kind, amp: tr.generation.amp, seed: tr.generation.seed, exag: tr.exaggerate, res: tr.n, size: tr.size, follow: st.followTerrain !== false }, (k,v) => { if (['gen','amp','seed'].includes(k)) { if(k==='gen'){if(v)tr.generation.kind=v;}else tr.generation[k]=v;app.saveLocal();return; } if(k!=='biome')app.bus.emit('terrain');app.saveLocal(); });
  g0.body.appendChild(el('div',{class:'fnote',text:'生成会重建全图高度并启用自动底材；手绘覆盖保留在原位置。相同种子与参数可复现，支持一次撤销。海岛自动开启水面；其他类型保留当前水面设置。'}));
  f0.root.dataset.terrainGeneration='1';
  g0.body.appendChild(f0.root);
  root.appendChild(g0.wrap);
  root.appendChild(terrainWorkflowControls(app));
  root.appendChild(terrainErosionControls(app));
  root.appendChild(terrainSurfaceControls(app));

  const g1 = section('笔刷', { badge: st.terrainTool ? (TOOLS.find((t) => t.id === st.terrainTool) || {}).name || '' : '未激活' });
  const grid = el('div', { class: 'brushgrid' });
  for (const t of TOOLS) {
    grid.appendChild(el('button', {
      class: 'bchip' + (st.terrainTool === t.id ? ' on' : ''), type: 'button', dataset: { brush: t.id }, title: `${t.name}（按住左键拖动绘制，Shift 反向）`,
      html: `<i>${t.icon}</i><span>${t.name}</span>`,
      onclick: () => { tr.activateTool(t.id); grid.querySelectorAll('.bchip').forEach((b) => b.classList.toggle('on', b.dataset.brush === st.terrainTool)); const bd = g1.wrap.querySelector('.badge'); if (bd) bd.textContent = st.terrainTool ? t.name : '未激活'; tr.refreshUI(); toast(st.terrainTool ? `${t.name}：在场景里按住左键拖动笔刷，Shift 反向（关闭笔刷再旋转视角）` : '已退出地形绘制'); },
    }));
  }
  grid.appendChild(el('button', {
    class: 'bchip alt', type: 'button', title: '全图做一次平滑（削掉尖刺，不动大形态）',
    html: '<i>∫</i><span>整体平滑</span>', onclick: () => { app.beginOp('整体平滑地形'); const n = tr.smoothAll(3); app.bus.emit('terrain'); app.markDirty?.(); toast(`已整体平滑 3 轮（${n} 个顶点）`); },
  }));
  g1.body.appendChild(grid);
  const bs = el('div', { class: 'rg' });
  const bsR = el('input', { class: 'rng', type: 'range', min: 2, max: 40, step: 0.5, dataset:{terrainRadius:'1'}, value: tr.state.brushSize, oninput: (e) => { tr.setBrush({ size: parseFloat(e.target.value) }); bsV.textContent = tr.state.brushSize.toFixed(1) + ' m'; } });
  const bsV = el('span', { class: 'stat', text: tr.state.brushSize.toFixed(1) + ' m', 'data-tsize': '1' });
  bs.append(bsR, bsV);
  const bw = el('div', { class: 'rg' });
  const bwR = el('input', { class: 'rng', type: 'range', min: 0.05, max: 2, step: 0.05, value: tr.state.brushStrength, oninput: (e) => { tr.setBrush({ strength: parseFloat(e.target.value) }); bwV.textContent = tr.state.brushStrength.toFixed(2); } });
  const bwV = el('span', { class: 'stat', text: tr.state.brushStrength.toFixed(2), 'data-tstrength': '1' });
  bw.append(bwR, bwV);
  g1.body.append(
    el('div', { class: 'row' }, [el('label', { class: 'lab', text: '笔刷半径' }), el('div', { class: 'ctl' }, [bs])]),
    el('div', { class: 'row' }, [el('label', { class: 'lab', text: '力度' }), el('div', { class: 'ctl' }, [bw])]),
  );
  const advanced = buildForm([
    { k:'falloff', l:'边缘柔和', t:'range', min:.05,max:1,step:.05,set:v=>{tr.state.brushFalloff=v;} },
    { k:'target', l:'抹平高度 m', t:'range',min:-50,max:100,step:.1,set:v=>{tr.state.flattenHeight=v;} },
    { k:'slope', l:'缓坡目标 °', t:'range',min:5,max:60,step:1,set:v=>{tr.state.maxSlope=v;} },
    { k:'surface', l:'局部材质',t:'sel',opts:TERRAIN_MATERIALS.map(m=>({v:m.id,l:m.name})),set:v=>{tr.state.material=v;} },
  ],{falloff:tr.state.brushFalloff,target:tr.state.flattenHeight,slope:tr.state.maxSlope,surface:tr.state.material},()=>{});
  advanced.root.dataset.terrainBrushSettings='1';g1.body.appendChild(advanced.root);
  g1.body.appendChild(el('div',{class:'fnote',text:'左键拖动绘制，右键平移、滚轮缩放；Esc 退出后左键旋转；Alt 临时平滑，Alt+滚轮改变半径。Shift 反向抬降／擦除局部材质；Ctrl+点击采样抹平高度。坡度缓和将局部陡坡逐步收敛到目标角度。每笔可 Ctrl+Z 撤销。'}));
  g1.body.appendChild(el('div',{class:'fnote',text:`当前 ${tr.n} × ${tr.n} 顶点，格距 ${(tr.size/(tr.n-1)).toFixed(2)} m。细化保留高度与材质，超细网格建议局部编辑。路基填充只抬高地面，避开下层道路和建筑。`}));
  const exit=el('button',{class:'fbtn wide',text:'退出地形笔刷',type:'button',dataset:{terrainExit:'1'},onclick:()=>{tr._cancelStroke?.();st.terrainTool=null;tr.refreshUI();}});g1.body.appendChild(exit);
  root.insertBefore(g1.wrap, g0.wrap);

  const veg = section('植被笔刷', { badge: '实例化散布' });
  veg.body.appendChild(vegetationControls(app));
  root.appendChild(veg.wrap);

  // 道路画笔
  const rb = app.roadBrush;
  const g1b = section('道路画笔', { badge: rb?.active ? '绘制中' : '未激活' });
  const rbGrid = el('div', { class: 'brushgrid' });
  for (const rt of ROAD_TYPES) {
    rbGrid.appendChild(el('button', {
      class: 'bchip' + (rb?.roadType?.id === rt.id ? ' on' : ''), type: 'button', dataset: { rtype: rt.id },
      html: `<span>${rt.label}</span>`,
      onclick: () => { rb.setType(rt.id); rbGrid.querySelectorAll('.bchip').forEach((b) => b.classList.toggle('on', b.dataset.rtype === rt.id)); },
    }));
  }
  g1b.body.appendChild(rbGrid);
  let rbVal;
  const rbRow = el('div', { class: 'row' }, [
    el('label', { class: 'lab', text: '宽度 m' }),
    el('div', { class: 'ctl' }, [
      el('input', { class: 'rng', type: 'range', min: 1, max: 20, step: 0.5, value: rb?.roadWidth || 12,
        oninput: (e) => { rb.setWidth(parseFloat(e.target.value)); rbVal.textContent = rb.roadWidth.toFixed(1) + ' m'; } }),
      el('span', { class: 'stat', text: (rb?.roadWidth || 12).toFixed(1) + ' m' }),
    ]),
  ]);
  rbVal = rbRow.querySelector('.stat');
  g1b.body.appendChild(rbRow);
  const rbBtnRow = el('div', { class: 'btnrow' }, [
    (() => {
      const label = () => (rb.active ? (rb.points.length >= 2 ? '完成绘制' : '绘制中·点击视口放点') : '开始绘制');
      const b = el('button', { class: 'fbtn', type: 'button', text: label(), onclick: () => {
        if (!rb.active) {
          rb.start();
          toast('钢笔工具：点击放置控制点生成直线段，双击或点本按钮完成，Esc 退出');
        } else if (rb.points.length >= 2) {
          rb.finish();
          rb.points = [];
          rb.filletH = [];
          rb._updatePreview();
          rb._clearLiveRoad();
          toast('道路已完成，工具保持激活，继续点击视口绘制下一条');
        } else {
          toast('绘制中：点击视口放置控制点，双击或点本按钮完成，Esc 退出');
        }
        b.textContent = label();
        const bd = g1b.wrap.querySelector('.badge'); if (bd) bd.textContent = rb.active ? '绘制中' : '未激活';
      } });
      return b;
    })(),
    el('button', { class: 'fbtn alt', type: 'button', text: '更换道路类型', onclick: () => {
      const nt = rb.cycleRoadType();
      toast(`道路类型：${nt.label}`);
    } }),
    (() => {
      const b = el('button', { class: 'fbtn alt' + (rb.filletOn ? ' on' : ''), type: 'button', text: rb.filletOn ? '平滑倒角：开' : '平滑倒角：关', onclick: () => {
        const on = rb.toggleFillet();
        b.textContent = on ? '平滑倒角：开' : '平滑倒角：关';
        b.classList.toggle('on', on);
        toast(on ? '倒角开启：拖动转角内侧的橙色圆心点调整弯曲程度' : '倒角关闭：转角恢复尖角');
      } });
      return b;
    })(),
  ]);
  g1b.body.appendChild(rbBtnRow);
  g1b.body.appendChild(roadPlanningControls(app));
  g1b.body.appendChild(el('div', { class: 'fnote', html: '<b>钢笔工具模式：</b>点击放置控制点→直线段尖角转弯→点「平滑倒角」后每个转角内侧出现橙色圆心点，拖动它调整道路弯曲程度→双击或点「开始绘制」完成。Esc 取消。' }));
  root.appendChild(g1b.wrap);

  const g2 = section('水面');
  const f2 = buildForm([
    { k: 'water', l: '显示水面', t: 'bool', on: '开', off: '关', get: () => tr.state.water, set: (v) => { app.beginOp('切换水面');tr.setWater(v); } },
    { k: 'waterY', l: '水位 m', t: 'range', get: () => tr.state.waterY, commit: true, min: -6, max: 24, step: 0.05, set: (v) => { app.beginOp('调整水位与岸带');tr.setWaterLevel(v, { enable: false }); } },
  ], { water: tr.state.water, waterY: tr.state.waterY }, () => { app.saveLocal(); });
  g2.body.appendChild(f2.root);
  root.appendChild(g2.wrap);

  const g3 = section('自然素材提示');
  g3.body.appendChild(el('div', { class: 'fnote', html: '库里的「自然」分组（山形/岩壁/乱石/树/草/芦苇/ ponds…）都是低模简易模型，配合法阵/云海/星河可直接当外景。物体 y 会随地形走；要让物体悬空（如浮岛、飞舟）把它抬高 1.6m 以上即可自动脱离贴地。' }));
  g3.body.appendChild(el('div', { class: 'row' }, [
    el('label', { class: 'lab', text: '地面高度查询' }),
    el('div', { class: 'ctl' }, [el('button', { class: 'fbtn wide', type: 'button', text: '选中物体：贴地 / 离地 1.5m', onclick: () => {
      const so = app.selObj;
      if (!so) { toast('先在场景里选一个物体'); return; }
      const p = so.root.position;
      const gy = tr.enabled ? tr.heightAt(p.x, p.z) : 0;
      if (so.followTerrain === false && p.y > gy + 0.5) { so.followTerrain = true; so.root.position.y = gy; }
      else { so.followTerrain = false; so.root.position.y = gy + 1.5; }
      tr._lastH = `地面 ${gy.toFixed(2)} m → 物体 y ${so.root.position.y.toFixed(2)} m`;
      app.bus.emit('objects');
      toast(tr._lastH);
    } })]),
    el('div', { class: 'fnote', html: '当前高度查询：' + (tr._lastH || '未测') }),
  ]));
  root.appendChild(g3.wrap);
  arrangeTerrainPanel(root, app, ctx);
  tr.refreshUI();
  return root;
}

function tabLight(app, rerender, ctx) {
  const root = el('div', { class: 'tabwrap' });
  const L = app.lighting;
  root.appendChild(lightingModeControls(app, rerender));
  root.appendChild(renderEffectsControls(app));
  const window=windowLightingControls(app,rerender);root.appendChild(window.root);
  if (L.mode === 'physical') { root.appendChild(physicalLightingControls(app, rerender, ctx));const sync=ctx.sync;ctx.sync=()=>{sync();window.sync();}; return { root }; }
  const st = { ...L.params(), preset: L.preset, enabled: L.enabled, grid: app.state.grid, shadows: !!L.p.shadow, soft: L.p.soft, helpers: app.state.showHelpers, detail: app.state.detail, env: app.state.env, tex: app.state.tex };
  const meta = el('div', { class: 'atmeta' });
  const grid = el('div', { class: 'agrid' });
  const syncMeta = () => {
    const a = ATMOS.find((x) => x.id === st.preset);
    meta.innerHTML = a ? `<b>${a.name}</b> <span>${a.en}</span><p>${a.d}</p>` : '';
  };
  ATMOS.forEach((a) => {
    const b = el('button', { class: 'acard', type: 'button', onclick: () => { st.preset = a.id; L.applyPreset(a.id); Object.assign(st, L.params()); syncMeta(); form.update(); } }, [
      el('span', { class: 'sw', style: `background:linear-gradient(150deg,${a.v.skyTop},${a.v.skyMid} 46%,${a.v.sunColor})` }),
      el('span', { class: 'an', text: a.name }),
    ]);
    grid.appendChild(b);
  });
  const g0 = section('氛围预设 / Atmosphere');
  g0.body.append(grid, meta);
  root.appendChild(g0.wrap);

  const onChange = (k, v) => { L.set(k, v); };
  const form = buildForm([
    { k: 'enabled', l: '启用光影（关闭 = 内存优先）', t: 'bool', set: (v) => { st.enabled = v; app.state.perf = !v; L.setEnabled(v); app.bus.emit('perf-changed'); } },
    { k: '_r', l: '恢复预设默认值', t: 'btn', onClick: () => { L.applyPreset(st.preset); Object.assign(st, L.params()); form.update(); }, btn2: { l: '关闭光影', onClick: () => { st.enabled = false; L.setEnabled(false); app.state.perf = true; form.update(); app.bus.emit('perf-changed'); } } },
    { k: 'sunElev', l: '太阳高度 °', t: 'range', min: -12, max: 89, step: 0.5, set: (v) => { st.sunElev = v; onChange('sunElev', v); } },
    { k: 'sunAzim', l: '太阳方位 °', t: 'range', min: 0, max: 360, step: 1, set: (v) => { st.sunAzim = v; onChange('sunAzim', v); } },
    { k: 'sunInt', l: '主光强度', t: 'range', min: 0, max: 10, step: 0.05, set: (v) => { st.sunInt = v; onChange('sunInt', v); } },
    { k: 'sunColor', l: '主光色', t: 'color', set: (v) => { st.sunColor = v; onChange('sunColor', v); } },
    { k: 'ambInt', l: '环境光', t: 'range', min: 0, max: 3, step: 0.02, set: (v) => { st.ambInt = v; onChange('ambInt', v); } },
    { k: 'hemiInt', l: '天光/半球光', t: 'range', min: 0, max: 3, step: 0.02, set: (v) => { st.hemiInt = v; onChange('hemiInt', v); } },
    { k: 'fill', l: '补光', t: 'range', min: 0, max: 2, step: 0.02, set: (v) => { st.fill = v; onChange('fill', v); } },
    { k: 'rim', l: '轮廓光', t: 'range', min: 0, max: 4, step: 0.05, set: (v) => { st.rim = v; onChange('rim', v); } },
    { k: 'envInt', l: '反射 / IBL', t: 'range', min: 0, max: 2, step: 0.05, set: (v) => { st.envInt = v; onChange('envInt', v); } },
    { k: 'glow', l: '夜间窗光/灯', t: 'range', min: 0, max: 4, step: 0.05, set: (v) => { st.glow = v; onChange('glow', v); } },
    { k: 'exposure', l: '曝光', t: 'range', min: 0.3, max: 2.2, step: 0.01, set: (v) => { st.exposure = v; onChange('exposure', v); } },
    { k: 'fogDens', l: '雾浓度', t: 'range', min: 0, max: 0.03, step: 0.0005, set: (v) => { st.fogDens = v; onChange('fogDens', v); } },
    { k: 'fogColor', l: '雾色', t: 'color', set: (v) => { st.fogColor = v; onChange('fogColor', v); } },
    { k: 'skyMid', l: '地平线色', t: 'color', set: (v) => { st.skyMid = v; onChange('skyMid', v); } },
    { k: 'shadows', l: '投影', t: 'bool', set: (v) => { st.shadows = v; onChange('shadow', v); } },
    { k: 'soft', l: '阴影柔和度', t: 'range', min: 0.2, max: 5, step: 0.1, set: (v) => { st.soft = v; onChange('soft', v); } },
    { k: 'detail', l: '模型精度', t: 'sel', opts: Object.entries(LEVELS).map(([v, c]) => ({ v, l: `${c.name}（${c.tex ? (v === 'fine' ? '512²贴图' : '256²贴图') : '无贴图'}）` })), help: '段数 / 倒角 / 表面贴图总开关，改完会重建全部模型', set: (v) => { st.detail = v; app.setDetail(v, { silent: true }); form.update(); } },
    { k: 'tex', l: '全部物品材质显示', t: 'bool', help: '关闭为灰模；物体页可单独开启指定物品。保留原材质以便无损恢复，不等同于释放全部贴图显存。', set: (v) => { st.tex = v; app.setTex(v); } },
    { k: 'env', l: '环境反射强度', t: 'range', min: 0, max: 1.6, step: 0.05, help: '程序化天穹贴图，给金属/玻璃/水面用；换氛围预设会回到该预设的建议值', set: (v) => { st.env = v; app.lighting._envManual = true; app.setEnv(v); } },
    { k: 'grid', l: '显示网格', t: 'bool', help: '显示贴合地形的地面网格，默认关闭', set: (v) => { st.grid = v; app.state.grid = v; app.stage.setGridVisible(v); } },
    { k: 'helpers', l: '显示机位/路径', t: 'bool', set: (v) => { app.state.showHelpers = v; } },
  ], st, () => { });
  const g1 = section('手动调光 / Manual');
  g1.body.appendChild(form.root);
  root.appendChild(g1.wrap);
  root.appendChild(localLightingControls(app));
  syncMeta();
  ctx.sync = () => { form.update();window.sync(); };
  return { root };
}

// ---------------------------------------------------------------------------
function tabExport(app, rerender, ctx) {
  const root = el('div', { class: 'tabwrap' });
  const st = {
    res: '1280x720', fps: app.state.fps, duration: app.state.duration, bitrate: 8,
    loop: true, mode: typeof VideoEncoder !== 'undefined' ? 'WebM / 固定时间戳' : bestMime()?.l || '不支持', prompt: buildPrompt(app).text,
  };
  const g0 = section('导出参考视频 / Render');
  const bar = el('div', { class: 'prog' }, [el('i'), el('span', { text: '就绪' })]);
  const out = el('div', { class: 'out' });
  const btns = el('div', { class: 'btnrow' });
  const form = buildForm([
    { k: 'res', l: '分辨率', t: 'sel', opts: RES_PRESETS.map((r) => ({ v: r.v, l: r.l })) },
    { k: 'fps', l: '帧率', t: 'sel', opts: [24, 25, 30, 50, 60].map((f) => ({ v: f, l: f + ' fps' })), num: true },
    { k: 'duration', l: '导出时长 s（从0秒）', t: 'range', min: 0.5, max: 120, step: 0.5 },
    { k: 'bitrate', l: '码率 Mbps', t: 'range', min: 2, max: 40, step: 1 },
    { k: 'loop', l: '循环播放路径', t: 'bool' },
    { k: 'mode', l: '编码', t: 'stat' },
    { k: '_x', l: '', t: 'note' },
  ], st, () => { });
  form.root.querySelector('.fnote')?.remove();
  const runBtn = el('button', { class: 'fbtn wide primary', type: 'button', text: '▶ 开始导出' });
  app.exporter = app.exporter || new Exporter(app);
  const stillBtn = el('button', { class: 'fbtn wide', type: 'button', text: '导出当前帧 PNG', onclick: () => app.exporter.still({ width: 1920, height: 1080 }) });
  const cancelBtn = el('button', { class: 'fbtn wide alt', type: 'button', text: '停止', disabled: true });
  btns.append(runBtn, el('div', { class: 'btnrow' }, [stillBtn, cancelBtn]));
  const rline = el('div', { class: 'mini', text: '优先固定时间戳 WebM；耗时取决于场景。不支持时回退实时录制，可能丢帧或延长时长。' });
  g0.body.append(form.root, btns, bar, out, rline);
  root.appendChild(g0.wrap);

  const fill = bar.querySelector('i'), lab = bar.querySelector('span');
  runBtn.addEventListener('click', async () => {
    const [w, h] = st.res.split('x').map(Number);
    app.exporter = app.exporter || new Exporter(app);
    runBtn.disabled = true; cancelBtn.disabled = false;
    runBtn.textContent = '● 录制中…';
    let last = 0;
    const result = await app.exporter.run({ width: w, height: h, fps: st.fps, duration: st.duration, bitrate: st.bitrate, loop: st.loop }, (p) => {
      const pct = (p.i / Math.max(1, p.total)) * 100;
      if (pct - last > 0.8 || p.phase !== 'render') { last = pct; fill.style.width = clamp(pct, 0, 100).toFixed(1) + '%'; }
      lab.textContent = p.phase === 'retry' ? '手动采样无输出，改用自动采样模式重试…'
        : p.phase === 'done' ? `完成 ${(p.size / 1048576).toFixed(2)} MB，${p.diskSave === 'saved' ? '已写入磁盘' : p.diskSave === 'cancelled' ? '已取消保存，可重试' : p.diskSave === 'error' ? '磁盘保存失败，可重试' : '已下载'}`
          : p.phase === 'cancelled' ? '已取消，不生成文件'
          : p.phase === 'error' ? `导出失败：${p.error}`
          : p.phase === 'prepare' ? '准备导出缓存…'
          : p.phase === 'empty' ? '未取到画面数据'
            : `第 ${p.i + 1}/${p.total} 帧 · ${pct.toFixed(0)}%`;
    });
    runBtn.disabled = false; cancelBtn.disabled = true;
    runBtn.textContent = '▶ 开始导出';
    const res = result?.size ? result : null;
    clear(out);
    if (res) {
      out.appendChild(el('video', { src: res.url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }));
      const saveAgain = el('button', { class: 'fbtn', type: 'button', text: DESKTOP_BUILD ? '另存视频（重试／新位置）' : '再次下载视频', onclick: async () => { saveAgain.disabled = true; try { const r = await downloadBlob(res.blob, res.name); if (r) lab.textContent = r.status === 'saved' ? '视频已写入磁盘' : r.status === 'cancelled' ? '已取消保存，视频预览仍保留' : '磁盘保存失败，可再次重试'; } catch (e) { toast(e.message, 'warn'); } finally { saveAgain.disabled = false; } } });
      out.appendChild(saveAgain);
      out.appendChild(el('div', { class: 'mini', text: `${res.name} · ${(res.size / 1048576).toFixed(2)} MB · ${res.frames} 帧 · ${res.mode === 'webcodecs' ? '固定时间戳' : res.mode === 'manual' ? '手动采样' : '自动采样'}` }));
    } else {
      if (!result?.cancelled && !result?.error) lab.textContent = '导出未产生文件';
      out.appendChild(el('div', { class: 'fnote', html: '未能录制到画面。请确认使用 Chrome / Edge（或较新的 Firefox），并关闭浏览器的「减少 GPU 加速」限制；也可以先用 <b>导出当前帧 PNG</b> 逐帧取图。' }));
    }
  });
  cancelBtn.addEventListener('click', () => app.exporter?.cancel());

  // 工程与数据
  const g1 = section('工程 / 数据');
  g1.body.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn', type: 'button', title: '清掉所有模型与机位，回到空白场（Ctrl+Z 可撤销）', text: '⌫ 一键清空场景', onclick: () => app.clearScene({ blank: true }) }),
    el('button', { class: 'fbtn alt', type: 'button', title: '撤销上一次删除 / 清空', text: '↶ 撤销', onclick: () => { if (!app.undo()) toast('没有可撤销的操作'); } }),
    el('button', { class: 'fbtn alt', type: 'button', title: '重做（Ctrl+Shift+Z）', text: '↷ 重做', onclick: () => { if (!app.redo()) toast('没有可重做的操作'); } }),
  ]));
  g1.body.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn', type: 'button', text: '保存工程 JSON', onclick: () => { downloadBlob(new Blob([JSON.stringify(app.serialize(), null, 1)], { type: 'application/json' }), `${(app.projectName || 'previz')}.json`); } }),
    el('button', { class: 'fbtn alt', type: 'button', text: '本地自动保存', onclick: () => { app.saveLocal(); toast('已存到浏览器本地'); } }),
  ]));
  g1.body.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'fbtn', type: 'button', text: '导出运镜数据 JSON', onclick: () => { downloadBlob(new Blob([JSON.stringify(motionJson(app), null, 1)], { type: 'application/json' }), 'camera_path.json'); } }),
    el('button', { class: 'fbtn alt', type: 'button', text: '复制提示词', onclick: async () => { try { await navigator.clipboard.writeText(st.prompt); toast('已复制'); } catch (e) { toast('浏览器限制，请手动选择文本'); } } }),
  ]));
  root.appendChild(g1.wrap);

  const g2 = section('给 AI 视频的提示词 / Prompt');
  const ta = el('textarea', { class: 'area prompt', rows: 14, readonly: true });
  ta.value = st.prompt;
  const upd = () => { st.prompt = buildPrompt(app).text; ta.value = st.prompt; };
  upd();
  app.bus.on('shot-change', upd);
  app.bus.on('select', upd);
  g2.body.append(el('div', { class: 'btnrow' }, [el('button', { class: 'fbtn wide', type: 'button', text: '↻ 依据当前机位重新生成', onclick: upd })]), ta);
  root.appendChild(g2.wrap);
  return { root };
}

// ---------------------------------------------------------------------------
// S2 Scene Builder panels
// ---------------------------------------------------------------------------
const SCENE_CATS = [
  { id: 'buildings', label: 'Buildings', libIds: ['house', 'suburban', 'functional', 'garage', 'building'] },
  { id: 'props', label: 'Props', libIds: ['furniture', 'traffic', 'env'] },
  { id: 'roads', label: 'Roads', libIds: ['road'] },
  { id: 'plants', label: 'Plants', libIds: ['vegetation'] },
  { id: 'people', label: 'People', libIds: ['char'] },
];
// 补全分组标签：以上策划类只盖到 92/203 项，bld/cn/cls/in/nat/war/sci/fx 等
// 分组此前没有任何筛选 chip（「有些分组没标签」）。逐组自动补一个，保证
// 每个 LIB 分组都有标签；标签数动态计算，与库增删自动同步。
{
  const covered = new Set(SCENE_CATS.flatMap((c) => c.libIds));
  for (const g of LIB) if (!covered.has(g.id)) SCENE_CATS.push({ id: g.id, label: g.cat || g.id, libIds: [g.id] });
}

export function buildSceneAssets(app, host) {
  return buildModelLibrary(app, host, {categories:SCENE_CATS});
}

/* ---- 天气系统 tab ---- */
function tabWeather(app) {
  const root = el('div', { class: 'tabwrap' });
  const card = el('div', { class: 'sec' });
  card.appendChild(el('div', { class: 'sec-h' }, [el('b', { text: '粒子天气' })]));
  const body = el('div', { class: 'sec-b' });

  const grid = el('div', { class: 'agrid', style: 'grid-template-columns:1fr 1fr' });
  const currentWeather = app.weather?.type || 'none';

  const noneCard = el('div', { class: 'acard' + (currentWeather === 'none' ? ' on' : '') });
  noneCard.style.cssText = 'border:1px solid var(--line);border-radius:9px;padding:10px 8px;cursor:pointer;text-align:center';
  if (currentWeather === 'none') { noneCard.style.borderColor = 'var(--acc)'; noneCard.style.background = 'var(--acc-light)'; }
  noneCard.appendChild(el('div', { text: '无', style: 'font-size:20px;margin-bottom:4px' }));
  noneCard.appendChild(el('div', { text: '关闭天气效果', style: 'font-size:10.5px;color:var(--fg3)' }));
  noneCard.onclick = () => { app.weather?.set('none'); app.bus.emit('weather'); toast('天气效果已关闭'); };
  grid.appendChild(noneCard);

  for (const w of WEATHER) {
    const wc = el('div', { class: 'acard' + (currentWeather === w.id ? ' on' : '') });
    wc.style.cssText = 'border:1px solid var(--line);border-radius:9px;padding:10px 8px;cursor:pointer;text-align:center';
    if (currentWeather === w.id) { wc.style.borderColor = 'var(--acc)'; wc.style.background = 'var(--acc-light)'; }
    const swatch = el('div', { style: `width:100%;height:24px;border-radius:5px;margin-bottom:6px;background:${w.color}` });
    wc.appendChild(swatch);
    wc.appendChild(el('div', { text: w.name, style: 'font-size:11px;font-weight:500;color:var(--fg)' }));
    wc.appendChild(el('div', { text: w.desc, style: 'font-size:9.5px;color:var(--fg3);margin-top:2px;line-height:1.3' }));
    wc.onclick = () => { app.weather?.set(w.id); app.bus.emit('weather'); toast(`已切换为 ${w.name}`); };
    grid.appendChild(wc);
  }
  body.appendChild(grid);
  card.appendChild(body);
  root.appendChild(card);
  return { root };
}

export function buildSceneInspector(app, host) {
  host.append(layoutMaintenanceControls(app));
  host.append(el('button', { class: 'exp-btn secondary', type: 'button', text: '✦ AI 场景搭建', dataset: { aiSceneOpen: '1' }, onclick: () => openAISceneDialog(app) }));
  const tabsEl = el('div', { class: 'itabs' });
  const body = el('div', { class: 'ibody' });
  host.append(tabsEl, body);
  const TABS = [
    { id: 'obj', l: '物体' },
    { id: 'terr', l: '地形' },
    { id: 'light', l: '光影' },
    { id: 'weather', l: '天气' },
  ];
  const ctx = { cur: 'obj', sync: () => {} };
  TABS.forEach((t, i) => {
    const b = el('button', {
      class: 'itab' + (i === 0 ? ' on' : ''), type: 'button', text: t.l,
      onclick: () => { ctx.cur = t.id; [...tabsEl.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); render(); },
    });
    tabsEl.appendChild(b);
  });
  function render() {
    clear(body);
    ctx.sync = () => {};
    const t = ctx.cur;
    const r = t === 'obj' ? tabObject(app, render, ctx) : t === 'terr' ? tabTerrain(app, render, ctx) : t === 'weather' ? tabWeather(app, render, ctx) : tabLight(app, render, ctx);
    body.appendChild(r.root || r);
  }
  const upd = () => render();
  app.bus.on('select', () => {
    if (app.selObj?.type === 'road_brush' && !app.roadBrush?.active) {
      ctx.cur = 'obj';
      [...tabsEl.children].forEach((b, i) => b.classList.toggle('on', i === 0));
    }
    render();
  });
  app.bus.on('objects', () => { if (ctx.cur === 'obj') render(); });
  app.bus.on('perf-changed', upd);
  app.bus.on('terrain', () => { if (ctx.cur === 'terr') render(); });
  app.bus.on('terrain-workflow', () => { if (ctx.cur === 'terr') render(); });
  app.bus.on('weather', () => { if (ctx.cur === 'weather') render(); });
  app.bus.on('tick', () => ctx.sync());
  render();
  return { render, get tab() { return ctx.cur; } };
}

/* ==========================================================================
   S3 Camera Path — Keyframes list + Camera inspector
   ========================================================================== */

export function buildKeyframesList(app, host) {
  if (!host) return {};
  host.innerHTML = '';

  const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  host.appendChild(list);

  function render() {
    list.innerHTML = '';
    const kfs = app.camKeyframes || [];
    kfs.forEach((kf, i) => {
      const card = el('div', { class: 'kf-card' + (app.selKfIndex === i ? ' sel' : '') });
      card.onclick = () => { app.selKfIndex = i; render(); app.bus.emit('selectKf', i); };

      const head = el('div', { class: 'kf-head' }, [
        el('span', { class: 'kf-label', text: 'K' + (i + 1) }),
        el('span', { class: 'kf-time', text: (kf.t ?? 0).toFixed(1) + 's' }),
      ]);
      card.appendChild(head);

      const meta = el('div', { class: 'kf-meta' }, [
        el('span', { text: 'FOV ' + (kf.fov ?? 50) + '°' }),
        el('span', { text: kf.ease || 'ease' }),
      ]);
      card.appendChild(meta);

      const actions = el('div', { class: 'kf-actions' }, [
        el('button', { text: '跳转', onclick: (e) => { e.stopPropagation(); app.bus.emit('gotoKf', i); } }),
        el('button', { text: '复制', onclick: (e) => { e.stopPropagation(); app.bus.emit('dupKf', i); } }),
        el('button', { text: '删除', onclick: (e) => { e.stopPropagation(); app.bus.emit('delKf', i); } }),
      ]);
      card.appendChild(actions);
      list.appendChild(card);
    });

    const addBtn = el('button', { class: 'kf-add-btn', text: '+ 添加关键帧', onclick: () => app.bus.emit('addKf') });
    list.appendChild(addBtn);
  }

  render();
  app.bus.on('kfChanged', render);
  return { render };
}

export function buildCameraInspector(app, host) {
  if (!host) return {};
  host.innerHTML = '';
  let _sync = () => {};

  function render() {
    host.innerHTML = '';
    _sync = () => {};
    const s = app.activeShot;
    if (!s) {
      host.appendChild(el('div', { class: 'empty', text: '请先选择或新建摄像机' }));
      return;
    }

    /* ---- Camera Settings card ---- */
    const camCard = el('div', { class: 'sec' });
    camCard.appendChild(el('div', { class: 'sec-h' }, [el('b', { text: '摄像机参数' })]));
    const camBody = el('div', { class: 'sec-b' });

    const modelRow = el('div', { class: 'row' });
    modelRow.append(el('label', { class: 'lab', text: '机型' }));
    const modelSel = el('select', { class: 'ctl' });
    CAMERA_MODELS.forEach(m => modelSel.appendChild(el('option', { value: m.v, text: m.l, selected: m.v === s.model })));
    modelSel.onchange = () => { s.model = modelSel.value; app.bus.emit('shots'); };
    modelRow.appendChild(modelSel);
    camBody.appendChild(modelRow);

    const sensorRow = el('div', { class: 'row' });
    sensorRow.append(el('label', { class: 'lab', text: '画幅' }));
    const sensorSel = el('select', { class: 'ctl' });
    SENSORS.forEach(m => sensorSel.appendChild(el('option', { value: m.v, text: m.l, selected: m.v === s.sensor })));
    sensorSel.onchange = () => { s.sensor = sensorSel.value; app.bus.emit('shots'); };
    sensorRow.appendChild(sensorSel);
    camBody.appendChild(sensorRow);

    const focalRow = el('div', { class: 'row' });
    focalRow.append(el('label', { class: 'lab', text: '焦距 mm' }));
    const focalNum = el('input', { type: 'number', class: 'ctl', min: 8, max: 400, step: 1, value: s.focal });
    focalNum.onchange = () => { s.focal = clamp(+focalNum.value, 8, 400); app.bus.emit('shots'); };
    focalRow.appendChild(focalNum);
    camBody.appendChild(focalRow);

    const apertureRow = el('div', { class: 'row' });
    apertureRow.append(el('label', { class: 'lab', text: '光圈 F' }));
    const apertureNum = el('input', { type: 'number', class: 'ctl', min: 0.5, max: 64, step: 0.1, value: s.aperture });
    apertureNum.onchange = () => { s.aperture = clamp(+apertureNum.value, 0.5, 64); app.bus.emit('shots'); };
    apertureRow.appendChild(apertureNum);
    camBody.appendChild(apertureRow);

    const isoRow = el('div', { class: 'row' });
    isoRow.append(el('label', { class: 'lab', text: 'ISO' }));
    const isoNum = el('input', { type: 'number', class: 'ctl', min: 50, max: 12800, step: 50, value: s.iso });
    isoNum.onchange = () => { s.iso = clamp(+isoNum.value, 50, 12800); app.lighting.setIso(s.iso); app.bus.emit('shots'); };
    isoRow.appendChild(isoNum);
    camBody.appendChild(isoRow);

    const dofRow = el('div', { class: 'row' });
    dofRow.append(el('label', { class: 'lab', text: '景深' }));
    const dofSw = el('div', { class: 'sw' + (s.dofEnabled ? ' on' : '') });
    const dofPickBtn = el('button', {
      class: 'vp-btn',
      text: '⊕ 拾取主体',
      title: '在视口中点击物体设置对焦主体',
      style: 'font-size:11px;padding:2px 8px;margin-left:auto'
    });
    dofPickBtn.onclick = () => {
      app.state.dofPickMode = true;
      app.state.dofPickShot = s;
      toast('请在视口中点击选择对焦主体');
    };
    const dofControls = el('div', { style: 'display:' + (s.dofEnabled ? 'flex' : 'none') + ';flex-direction:column;gap:8px' });
    dofSw.onclick = () => {
      s.dofEnabled = !s.dofEnabled;
      dofSw.classList.toggle('on', s.dofEnabled);
      dofControls.style.display = s.dofEnabled ? 'flex' : 'none';
      app.bus.emit('shots');
    };
    dofRow.appendChild(el('div', { class: 'sw-wrap' }, [dofSw]));
    dofRow.appendChild(dofPickBtn);
    camBody.appendChild(dofRow);

    const lookRow = el('div', { class: 'row' });
    lookRow.append(el('label', { class: 'lab', text: '注视目标' }));
    const lookSel = el('select', { class: 'ctl' });
    lookSel.appendChild(el('option', { value: 'keys', text: '关键帧朝向', selected: s.aim === 'keys' }));
    lookSel.appendChild(el('option', { value: 'target', text: '锁定主体', selected: s.aim === 'target' }));
    lookSel.onchange = () => { s.aim = lookSel.value; app.bus.emit('shots'); };
    lookRow.appendChild(lookSel);
    camBody.appendChild(lookRow);

    const nearRow = el('div', { class: 'row' });
    nearRow.append(el('label', { class: 'lab', text: '近裁剪' }));
    const nearNum = el('input', { type: 'number', class: 'ctl', min: 0.01, max: 100, step: 0.01, value: s.nearClip });
    nearNum.onchange = () => { s.nearClip = clamp(+nearNum.value, 0.01, 100); app.bus.emit('shots'); };
    nearRow.appendChild(nearNum);
    camBody.appendChild(nearRow);

    const farRow = el('div', { class: 'row' });
    farRow.append(el('label', { class: 'lab', text: '远裁剪' }));
    const farNum = el('input', { type: 'number', class: 'ctl', min: 100, max: 10000, step: 100, value: s.farClip });
    farNum.onchange = () => { s.farClip = clamp(+farNum.value, 100, 10000); app.bus.emit('shots'); };
    farRow.appendChild(farNum);
    camBody.appendChild(farRow);

    const frustumRow = el('div', { class: 'row' });
    frustumRow.append(el('label', { class: 'lab', text: '视锥显示' }));
    const frustumSw = el('div', { class: 'sw' + (s.showFrustum ? ' on' : '') });
    frustumSw.onclick = () => {
      s.showFrustum = !s.showFrustum;
      frustumSw.classList.toggle('on', s.showFrustum);
      app.bus.emit('shots');
    };
    frustumRow.appendChild(el('div', { class: 'sw-wrap' }, [frustumSw]));
    camBody.appendChild(frustumRow);

    camCard.appendChild(camBody);
    host.appendChild(camCard);

    /* ---- Transform Editor card (always visible when shot selected) ---- */
    if (s.rig) {
      const transformCard = el('div', { class: 'sec' });
      transformCard.appendChild(el('div', { class: 'sec-h' }, [el('b', { text: '变换属性' })]));
      const transformBody = el('div', { class: 'sec-b' });

      const pos = s.rig.position;
      const rot = s.rig.rotation;
      const scale = s.rig.scale;

      // Position inputs
      const posRow = el('div', { class: 'row' });
      posRow.append(el('label', { class: 'lab', text: '位置' }));
      const posInputs = el('div', { class: 'transform-inputs', style: 'display:flex;gap:4px;flex:1' });
      const posEls = [];
      ['x', 'y', 'z'].forEach((axis, i) => {
        const input = el('input', {
          type: 'number',
          class: 'ctl',
          step: 0.1,
          value: pos[axis].toFixed(2),
          style: 'width:60px;font-size:11px'
        });
        input.onchange = () => {
          pos[axis] = parseFloat(input.value) || 0;
          const t = app.state.time / (app.state.duration || 1);
          if (s.selKey >= 0 && s.mover.keys[s.selKey]) {
            s.mover.keys[s.selKey].p[i] = pos[axis];
          } else {
            s.addKeyAt(t);
            s.mover.keys[s.mover.count - 1].p[i] = pos[axis];
          }
          s.markDirty();
          s.refreshGizmos();
        };
        posInputs.appendChild(input);
        posEls.push(input);
      });
      posRow.appendChild(posInputs);
      transformBody.appendChild(posRow);

      // Rotation inputs
      const rotRow = el('div', { class: 'row' });
      rotRow.append(el('label', { class: 'lab', text: '旋转°' }));
      const rotInputs = el('div', { class: 'transform-inputs', style: 'display:flex;gap:4px;flex:1' });
      const rotEls = [];
      ['x', 'y', 'z'].forEach((axis, i) => {
        const input = el('input', {
          type: 'number',
          class: 'ctl',
          step: 1,
          value: (rot[axis] * 180 / Math.PI).toFixed(1),
          style: 'width:60px;font-size:11px'
        });
        input.onchange = () => {
          rot[axis] = (parseFloat(input.value) || 0) * Math.PI / 180;
          const t = app.state.time / (app.state.duration || 1);
          const q = new THREE.Quaternion().setFromEuler(rot);
          const qArr = [q.x, q.y, q.z, q.w];
          if (s.selKey >= 0 && s.mover.keys[s.selKey]) {
            s.mover.keys[s.selKey].q = qArr;
          } else {
            s.addKeyAt(t);
            s.mover.keys[s.mover.count - 1].q = qArr;
          }
          s.markDirty();
          s.refreshGizmos();
        };
        rotInputs.appendChild(input);
        rotEls.push(input);
      });
      rotRow.appendChild(rotInputs);
      transformBody.appendChild(rotRow);

      // Scale inputs
      const scaleRow = el('div', { class: 'row' });
      scaleRow.append(el('label', { class: 'lab', text: '缩放' }));
      const scaleInputs = el('div', { class: 'transform-inputs', style: 'display:flex;gap:4px;flex:1' });
      const scaleEls = [];
      ['x', 'y', 'z'].forEach((axis) => {
        const input = el('input', {
          type: 'number',
          class: 'ctl',
          step: 0.1,
          min: 0.1,
          value: scale[axis].toFixed(2),
          style: 'width:60px;font-size:11px'
        });
        input.onchange = () => {
          scale[axis] = parseFloat(input.value) || 1;
          s.markDirty();
        };
        scaleInputs.appendChild(input);
        scaleEls.push(input);
      });
      scaleRow.appendChild(scaleInputs);
      transformBody.appendChild(scaleRow);

      transformCard.appendChild(transformBody);
      host.appendChild(transformCard);

      _sync = () => {
        ['x', 'y', 'z'].forEach((axis, i) => {
          posEls[i].value = pos[axis].toFixed(2);
          rotEls[i].value = (rot[axis] * 180 / Math.PI).toFixed(1);
          scaleEls[i].value = scale[axis].toFixed(2);
        });
      };
    }

    /* ---- Movement Preset card ---- */
    const mvCard = el('div', { class: 'sec' });
    mvCard.appendChild(el('div', { class: 'sec-h' }, [el('b', { text: '运镜预设' })]));
    const mvBody = el('div', { class: 'sec-b' });

    const mvRow = el('div', { class: 'row' });
    mvRow.append(el('label', { class: 'lab', text: '预设' }));
    const mvSel = el('select', { class: 'ctl' });
    mvSel.appendChild(el('option', { value: '', text: '— 无 —' }));
    MOVES.forEach(m => mvSel.appendChild(el('option', { value: m.id, text: m.name, selected: m.id === s.move })));
    mvRow.appendChild(mvSel);
    mvBody.appendChild(mvRow);

    const mvParamsDiv = el('div', { class: 'form' });
    mvBody.appendChild(mvParamsDiv);

    const mvBtnRow = el('div', { class: 'btnrow' });
    const regenBtn = el('button', { class: 'fbtn primary', text: '生成路径' });
    const clearBtn = el('button', { class: 'fbtn', text: '清除路径' });
    regenBtn.onclick = () => {
      s.move = mvSel.value;
      s.moveParams = {};
      const move = MOVES.find(m => m.id === s.move);
      if (move) {
        move.params.forEach(p => { s.moveParams[p.k] = p.def; });
        s.generateMove(s.move);
        app.bus.emit('shots');
        toast('已生成运镜路径');
      }
    };
    clearBtn.onclick = () => {
      s.move = '';
      s.moveParams = {};
      s.generateMove('');
      app.bus.emit('shots');
      toast('已清除运镜路径');
    };
    mvBtnRow.append(regenBtn, clearBtn);
    mvBody.appendChild(mvBtnRow);

    mvCard.appendChild(mvBody);
    host.appendChild(mvCard);

    function renderMoveParams() {
      clear(mvParamsDiv);
      const move = MOVES.find(m => m.id === mvSel.value);
      if (!move) return;
      mvParamsDiv.appendChild(el('div', { class: 'mvdesc', text: move.desc, style: 'font-size:11px;color:var(--fg2);margin-bottom:6px' }));
      move.params.forEach(p => {
        const row = el('div', { class: 'row' });
        row.append(el('label', { class: 'lab', text: p.l }));
        if (p.t === 'bool') {
          const sw = el('div', { class: 'sw' + (s.moveParams[p.k] !== false ? ' on' : '') });
          sw.onclick = () => { s.moveParams[p.k] = !s.moveParams[p.k]; sw.classList.toggle('on', s.moveParams[p.k]); };
          row.appendChild(el('div', { class: 'sw-wrap' }, [sw]));
        } else if (p.t === 'sel') {
          const sel = el('select', { class: 'ctl' });
          p.opts.forEach(o => sel.appendChild(el('option', { value: o.v, text: o.l, selected: +o.v === +s.moveParams[p.k] })));
          sel.onchange = () => { s.moveParams[p.k] = +sel.value; };
          row.appendChild(sel);
        } else {
          const ctl = el('div', { class: 'ctl' });
          const slider = el('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: s.moveParams[p.k] ?? p.def });
          const num = el('input', { type: 'number', class: 'num', min: p.min, max: p.max, step: p.step, value: s.moveParams[p.k] ?? p.def });
          slider.oninput = () => { s.moveParams[p.k] = +slider.value; num.value = slider.value; };
          num.onchange = () => { s.moveParams[p.k] = +num.value; slider.value = num.value; };
          ctl.append(slider, num);
          row.appendChild(ctl);
        }
        mvParamsDiv.appendChild(row);
      });
    }

    mvSel.onchange = renderMoveParams;
    renderMoveParams();

    /* ---- Keyframe Editor card ---- */
    if (s.mover && s.mover.count > 0) {
      const kfCard = el('div', { class: 'sec' });
      kfCard.appendChild(el('div', { class: 'sec-h' }, [el('b', { text: `关键帧编辑 (${s.mover.count})` })]));
      const kfBody = el('div', { class: 'sec-b' });

      const addKfRow = el('div', { class: 'btnrow' });
      const addKfBtn = el('button', { class: 'fbtn primary', text: '记录当前视角' });
      addKfBtn.onclick = () => {
        s.addKeyAt(app.state.time / (app.state.duration || 1));
        app.bus.emit('shots');
        toast('已添加关键帧');
      };
      const delKfBtn = el('button', { class: 'fbtn', text: '删除选中帧' });
      delKfBtn.onclick = () => {
        if (s.selKey >= 0) {
          s.removeKeyAt(s.selKey);
          app.bus.emit('shots');
          toast('已删除关键帧');
        } else {
          toast('请先选中一个关键帧');
        }
      };
      addKfRow.append(addKfBtn, delKfBtn);
      kfBody.appendChild(addKfRow);

      const kfListDiv = el('div', { class: 'kf-list' });
      const renderKfList = () => {
        clear(kfListDiv);
        if (!s.mover.count) {
          kfListDiv.appendChild(el('div', { class: 'empty', text: '无关键帧', style: 'font-size:11px;color:var(--fg2)' }));
          return;
        }
        s.mover.keys.forEach((k, i) => {
          const isSelected = i === s.selKey;
          const kfItem = el('div', {
            class: 'kf-item' + (isSelected ? ' active' : ''),
            style: 'display:flex;align-items:center;gap:6px;padding:4px;margin:2px 0;background:' + (isSelected ? 'var(--bg3)' : 'var(--bg2)') + ';border-radius:4px;cursor:pointer'
          });
          kfItem.appendChild(el('span', { text: `K${i + 1}`, style: 'font-weight:600;font-size:11px;min-width:24px' }));
          kfItem.appendChild(el('span', { text: `t:${((k.t || 0) * 100).toFixed(0)}%`, style: 'font-size:10px;color:var(--fg2)' }));
          const yPos = (k.p && k.p[1]) || 0;
          kfItem.appendChild(el('span', { text: `y:${yPos.toFixed(1)}m`, style: 'font-size:10px;color:var(--fg2)' }));
          kfItem.onclick = () => {
            app.selectKey(s, i);
            app.state.time = (k.t || 0) * (app.state.duration || 1);
            app.bus.emit('time');
            app.bus.emit('shots');
          };
          kfListDiv.appendChild(kfItem);
        });
      };
      renderKfList();
      kfBody.appendChild(kfListDiv);

      const hintDiv = el('div', { class: 'hintbox', style: 'font-size:10px;margin-top:6px' });
      hintDiv.textContent = '提示：在视口中拖动关键帧节点可调整位置';
      kfBody.appendChild(hintDiv);

      kfCard.appendChild(kfBody);
      host.appendChild(kfCard);
    }
  }

  render();
  app.bus.on('select', render);
  app.bus.on('shots', render);
  app.bus.on('tick', () => _sync());

  return {};
}

/* ==========================================================================
   S4 Generate — Prompt + Style Presets + Settings + Versions
   ========================================================================== */

export function buildGeneratePage(app, host) {
  if (!host) return {};
  host.innerHTML = '';

  const left = el('div', { class: 'gen-left' });
  const right = el('div', { class: 'gen-right' });
  host.appendChild(referenceReview(app));
  if (DESKTOP_BUILD) { host.appendChild(el('p', { class: 'fnote', text: '轻量桌面版只提供本地参考与手动交付，不启用旧版直连服务／API Key入口。' })); return {}; }
  const legacy = el('details', { class: 'reference-legacy' }, [el('summary', { text: '旧版纯文本生成入口（不读取3D参考包）' })]);
  legacy.appendChild(el('div', { class: 'reference-legacy-grid' }, [left, right])); host.appendChild(legacy);

  const RES_KEYS = ['1280x720', '1920x1080', '1080x1920', '1920x804', '1080x1080'];
  const RES_LABELS = ['1280×720 (16:9)', '1920×1080 (16:9)', '1080×1920 (9:16 竖屏)', '1920×804 (21:9 宽幅)', '1080×1080 (1:1 方形)'];
  const DUR_OPTIONS = [4, 5, 8, 10, 15];

  let selStyle = 0, selRes = 0, selDur = 1;
  let genHistory = JSON.parse(localStorage.getItem('seedance_history') || '[]');
  let generating = false;

  /* ---- Left: Prompt ---- */
  const promptCard = el('div', { class: 'gen-card' });
  promptCard.appendChild(el('h3', { text: '描述你的场景' }));
  const prompt = el('textarea', { class: 'gen-prompt', placeholder: '例如：黄昏时分，一辆红色跑车驶过跨海大桥，镜头从低角度跟随…' });
  promptCard.appendChild(prompt);

  const promptActions = el('div', { style: 'display:flex;gap:8px;margin-top:8px' });
  const fromSceneBtn = el('button', { class: 'gen-submit secondary', type: 'button', text: '从当前场景生成提示词', style: 'flex:1;font-size:12px;padding:8px' });
  fromSceneBtn.onclick = () => {
    const p = buildPrompt(app);
    if (p.data) {
      const lines = p.text.split('\n');
      const zhLine = lines.find(l => l.startsWith('▶ 可直接粘贴的中文提示词'));
      const idx = lines.indexOf(zhLine);
      if (idx >= 0 && lines[idx + 1]) {
        prompt.value = lines[idx + 1].trim();
        toast('已从当前场景生成提示词', 'info');
      }
    } else {
      toast('请先创建一个机位', 'warn');
    }
  };
  promptActions.appendChild(fromSceneBtn);
  promptCard.appendChild(promptActions);
  left.appendChild(promptCard);

  /* ---- Left: Style Presets ---- */
  const styleCard = el('div', { class: 'gen-card' });
  styleCard.appendChild(el('h3', { text: '风格预设' }));
  const styles = el('div', { class: 'gen-styles' });
  const styleList = [
    { icon: '🎬', label: '电影感' },
    { icon: '🌆', label: '赛博朋克' },
    { icon: '🏙️', label: '现代都市' },
    { icon: '🌿', label: '自然纪实' },
    { icon: '🎨', label: '动画风格' },
    { icon: '📷', label: '写实摄影' },
  ];
  styleList.forEach((s, i) => {
    const btn = el('div', { class: 'gen-style' + (i === 0 ? ' sel' : '') });
    btn.appendChild(el('span', { class: 'icon', text: s.icon }));
    btn.appendChild(el('span', { text: s.label }));
    btn.onclick = () => {
      selStyle = i;
      styles.querySelectorAll('.gen-style').forEach((b, j) => b.classList.toggle('sel', j === i));
    };
    styles.appendChild(btn);
  });
  styleCard.appendChild(styles);
  left.appendChild(styleCard);

  /* ---- Left: Submit ---- */
  const submitBtn = el('button', { class: 'gen-submit', type: 'button' }, [
    el('span', { text: '✦' }),
    el('span', { text: '生成视频' }),
  ]);
  left.appendChild(submitBtn);

  /* ---- Left: Progress ---- */
  const progressCard = el('div', { class: 'gen-card', style: 'display:none' });
  const progressText = el('div', { style: 'font-size:13px;color:var(--fg2);text-align:center;padding:8px' });
  const progressBar = el('div', { class: 'prog', style: 'margin-top:8px' }, [el('i'), el('span', { text: '' })]);
  progressCard.append(progressText, progressBar);
  left.appendChild(progressCard);

  /* ---- Right: API Key ---- */
  const keyCard = el('div', { class: 'gen-card' });
  keyCard.appendChild(el('h3', { text: 'API 配置' }));
  const keyRow = el('div', { style: 'display:flex;gap:8px;align-items:center' });
  const keyInput = el('input', { type: 'password', placeholder: '输入 Volcengine ARK API Key', style: 'flex:1;padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px;background:var(--bg2);color:var(--fg)' });
  keyInput.value = seedance.apiKey;
  const keySaveBtn = el('button', { text: '保存', type: 'button', style: 'padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--fg2);font-size:12px;cursor:pointer' });
  keySaveBtn.onclick = () => {
    seedance.setKey(keyInput.value);
    toast(seedance.hasKey() ? 'API Key 已保存' : 'API Key 已清除', 'info');
  };
  keyRow.append(keyInput, keySaveBtn);
  keyCard.appendChild(keyRow);
  keyCard.appendChild(el('div', { style: 'font-size:11px;color:var(--fg3);margin-top:6px', html: 'API Key 保存在浏览器本地。获取方式：<a href="https://console.volcengine.com/ark" target="_blank" style="color:var(--acc)">火山引擎 Ark 控制台</a>' }));
  right.appendChild(keyCard);

  /* ---- Right: Settings ---- */
  const setCard = el('div', { class: 'gen-card' });
  setCard.appendChild(el('h3', { text: '生成设置' }));

  const resSetting = el('div', { class: 'gen-setting' });
  resSetting.appendChild(el('label', { text: '画幅比例' }));
  const resSel = el('select', { style: 'width:100%;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--fg);font-size:12px' });
  RES_LABELS.forEach((r, i) => {
    resSel.appendChild(el('option', { text: r, value: i }));
  });
  resSel.onchange = () => { selRes = +resSel.value; };
  resSetting.appendChild(resSel);
  setCard.appendChild(resSetting);

  const durSetting = el('div', { class: 'gen-setting' });
  durSetting.appendChild(el('label', { text: '时长' }));
  const durSel = el('select', { style: 'width:100%;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--fg);font-size:12px' });
  DUR_OPTIONS.forEach((d, i) => {
    const opt = el('option', { text: `${d} 秒`, value: i });
    if (i === 1) opt.selected = true;
    durSel.appendChild(opt);
  });
  durSel.onchange = () => { selDur = +durSel.value; };
  durSetting.appendChild(durSel);
  setCard.appendChild(durSetting);

  const audioRow = el('div', { class: 'gen-setting', style: 'display:flex;align-items:center;justify-content:space-between' });
  audioRow.appendChild(el('label', { text: '生成音频' }));
  const audioToggle = el('div', { class: 'toggle on' });
  audioToggle.onclick = () => audioToggle.classList.toggle('on');
  audioRow.appendChild(audioToggle);
  setCard.appendChild(audioRow);

  const draftRow = el('div', { class: 'gen-setting', style: 'display:flex;align-items:center;justify-content:space-between' });
  draftRow.appendChild(el('label', { text: '草稿模式（480p 快速预览）' }));
  const draftToggle = el('div', { class: 'toggle' });
  draftToggle.onclick = () => draftToggle.classList.toggle('on');
  draftRow.appendChild(draftToggle);
  setCard.appendChild(draftRow);

  right.appendChild(setCard);

  /* ---- Right: Versions / History ---- */
  const verCard = el('div', { class: 'gen-card' });
  verCard.appendChild(el('h3', { text: '生成历史' }));
  const versions = el('div', { class: 'gen-versions' });
  verCard.appendChild(versions);
  right.appendChild(verCard);

  function renderHistory() {
    versions.innerHTML = '';
    if (!genHistory.length) {
      versions.appendChild(el('div', { style: 'text-align:center;padding:24px;color:var(--fg3);font-size:12px' }, [
        el('div', { text: '暂无生成结果', style: 'margin-bottom:4px' }),
        el('div', { text: '输入描述并点击生成按钮', style: 'font-size:11px' }),
      ]));
      return;
    }
    genHistory.forEach((item, idx) => {
      const row = el('div', { style: 'border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--bg2)' });
      if (item.videoUrl) {
        row.appendChild(el('video', { src: item.videoUrl, controls: true, style: 'width:100%;border-radius:6px;margin-bottom:6px', autoplay: false, loop: false }));
      }
      row.appendChild(el('div', { style: 'font-size:11px;color:var(--fg3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: item.prompt || '(无描述)' }));
      const metaRow = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:4px' });
      metaRow.appendChild(el('span', { style: 'font-size:10px;color:var(--fg3)', text: `${item.ratio || '16:9'} · ${item.duration || 5}s · ${item.time || ''}` }));
      const delBtn = el('button', { text: '删除', type: 'button', style: 'border:0;background:none;color:var(--err);font-size:11px;cursor:pointer;padding:2px 4px' });
      delBtn.onclick = () => { genHistory.splice(idx, 1); localStorage.setItem('seedance_history', JSON.stringify(genHistory)); renderHistory(); };
      metaRow.appendChild(delBtn);
      row.appendChild(metaRow);
      versions.appendChild(row);
    });
  }
  renderHistory();

  /* ---- Generate action ---- */
  submitBtn.onclick = async () => {
    if (generating) return;
    const userPrompt = prompt.value.trim();
    if (!userPrompt) { toast('请输入场景描述', 'warn'); return; }
    if (!seedance.hasKey()) { toast('请先在右侧设置 API Key', 'warn'); return; }

    generating = true;
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    progressCard.style.display = '';
    progressText.textContent = '正在创建生成任务…';
    progressBar.querySelector('span').textContent = '提交中';
    progressBar.querySelector('i').style.width = '10%';

    const resKey = RES_KEYS[selRes];
    const ratio = seedance.ratioFromRes(resKey);
    const resolution = seedance.resFromResKey(resKey);
    const duration = DUR_OPTIONS[selDur];
    const draft = draftToggle.classList.contains('on');
    const audio = audioToggle.classList.contains('on');

    try {
      const result = await seedance.generate(
        { prompt: userPrompt, styleIdx: selStyle, ratio, duration, resolution, draft, audio },
        (prog) => {
          if (prog.phase === 'queued') {
            progressText.textContent = '任务已提交，等待处理…';
            progressBar.querySelector('i').style.width = '20%';
          } else if (prog.phase === 'running') {
            progressText.textContent = '正在生成视频…';
            progressBar.querySelector('i').style.width = '50%';
          } else if (prog.phase === 'succeeded') {
            progressBar.querySelector('i').style.width = '100%';
            progressBar.querySelector('span').textContent = '完成';
          }
        }
      );

      if (result.status === 'succeeded' && result.content?.video_url) {
        const videoUrl = result.content.video_url;
        const entry = {
          prompt: userPrompt,
          videoUrl,
          ratio,
          duration,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          taskId: result.id,
        };
        genHistory.unshift(entry);
        if (genHistory.length > 20) genHistory.pop();
        localStorage.setItem('seedance_history', JSON.stringify(genHistory));
        renderHistory();
        toast('视频生成完成！', 'success');
      } else if (result.status === 'failed') {
        const errMsg = result.error?.message || '未知错误';
        toast(`生成失败: ${errMsg}`, 'error');
        progressText.textContent = `失败: ${errMsg}`;
      } else {
        toast(`生成结束: ${result.status}`, 'warn');
        progressText.textContent = `状态: ${result.status}`;
      }
    } catch (e) {
      toast(`生成出错: ${e.message}`, 'error');
      progressText.textContent = `错误: ${e.message}`;
    }

    generating = false;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    setTimeout(() => { progressCard.style.display = 'none'; }, 3000);
  };

  return {};
}

/* ==========================================================================
   S5 Export — Format + Quality + Queue + Audio + Deliver
   ========================================================================== */

export function buildExportPage(app, host) {
  if (!host) return {};
  host.innerHTML = '';
  app.exporter = app.exporter || new Exporter(app);

  const left = el('div', {});
  const right = el('div', {});
  host.append(left, right);

  const BITRATE_MAP = [2, 8, 20, 40];
  const FPS_MAP = [24, 30, 60];
  const RES_MAP = [
    { w: 1280, h: 720 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 },
    { w: 1080, h: 1920 }, { w: 1920, h: 804 }, { w: 1080, h: 1080 },
  ];
  const RES_LABELS = ['1280×720 (720p)', '1920×1080 (1080p)', '2560×1440 (2K)', '1080×1920 (竖屏)', '1920×804 (2.39宽幅)', '1080×1080 (方形)'];
  const FORMAT_REAL = [
    { label: 'MP4（实时）', mime: bestMime()?.ext === 'mp4' ? 'mp4' : null },
    { label: 'MOV', mime: null },
    { label: 'GIF', mime: null },
    { label: 'PNG序列', mime: null },
    { label: 'WebM', mime: 'webm' },
    { label: 'ZIP打包', mime: null },
  ];

  let selFmt = 4, selQual = 1, selRes = 1, selFps = 1;
  let renderQueue = [];
  let queueRunning = false;

  left.appendChild(referenceTools(app));

  /* ---- Left: Format ---- */
  const fmtCard = el('div', { class: 'exp-card' });
  fmtCard.appendChild(el('h3', { text: '导出格式' }));

  const fmtGrid = el('div', { class: 'exp-format-grid' });
  FORMAT_REAL.forEach((f, i) => {
    const avail = f.mime !== null;
    const btn = el('div', { class: 'exp-format' + (i === selFmt ? ' sel' : '') + (!avail ? ' unavailable' : '') });
    btn.appendChild(el('span', { class: 'fmt-icon', text: f.icon || ['🎬','🎞️','🖼️','📸','🌐','📦'][i] }));
    btn.appendChild(el('span', { text: f.label }));
    if (!avail) btn.title = '即将上线';
    btn.onclick = () => {
      if (!avail) { toast(`${f.label} 格式即将上线，当前优先使用 WebM；MP4 仅浏览器支持时提供实时兼容录制`, 'info'); return; }
      selFmt = i;
      fmtGrid.querySelectorAll('.exp-format').forEach((b, j) => b.classList.toggle('sel', j === i));
    };
    fmtGrid.appendChild(btn);
  });
  fmtCard.appendChild(fmtGrid);

  /* Quality */
  fmtCard.appendChild(el('label', { text: '质量', style: 'font-size:11px;color:var(--fg3);font-weight:500;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px' }));
  const qualRow = el('div', { class: 'exp-quality' });
  ['低 (2 Mbps)', '中 (8 Mbps)', '高 (20 Mbps)', '极高 (40 Mbps)'].forEach((q, i) => {
    const btn = el('button', { text: q, type: 'button' });
    if (i === 1) btn.classList.add('sel');
    btn.onclick = () => {
      selQual = i;
      qualRow.querySelectorAll('button').forEach((b, j) => b.classList.toggle('sel', j === i));
    };
    qualRow.appendChild(btn);
  });
  fmtCard.appendChild(qualRow);

  /* Resolution + FPS + Duration */
  const resSetting = el('div', { class: 'exp-row' });
  resSetting.appendChild(el('label', { text: '分辨率' }));
  const resSel = el('select', { style: 'padding:4px 8px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--fg);font-size:12px' });
  RES_LABELS.forEach((r, i) => {
    const opt = el('option', { text: r, value: i });
    if (i === 1) opt.selected = true;
    resSel.appendChild(opt);
  });
  resSel.onchange = () => { selRes = +resSel.value; };
  resSetting.appendChild(resSel);
  fmtCard.appendChild(resSetting);

  const fpsSetting = el('div', { class: 'exp-row' });
  fpsSetting.appendChild(el('label', { text: '帧率' }));
  const fpsSel = el('select', { style: 'padding:4px 8px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--fg);font-size:12px' });
  ['24 fps (电影)', '30 fps (标准)', '60 fps (流畅)'].forEach((f, i) => {
    const opt = el('option', { text: f, value: i });
    if (i === 1) opt.selected = true;
    fpsSel.appendChild(opt);
  });
  fpsSel.onchange = () => { selFps = +fpsSel.value; };
  fpsSetting.appendChild(fpsSel);
  fmtCard.appendChild(fpsSetting);

  left.appendChild(fmtCard);

  /* ---- Left: Render action + progress ---- */
  const actionCard = el('div', { class: 'exp-card' });
  actionCard.appendChild(el('h3', { text: '渲染输出' }));

  const progBar = el('div', { class: 'prog', style: 'margin-bottom:8px' }, [el('i'), el('span', { text: '就绪' })]);
  const resultHost = el('div', { style: 'margin-top:8px' });

  const btnRow = el('div', { style: 'display:flex;gap:8px' });
  const renderBtn = el('button', { class: 'exp-btn', type: 'button', text: '▶ 开始渲染', style: 'margin-top:0;flex:1' });
  const stillBtn = el('button', { class: 'exp-btn secondary', type: 'button', text: '📸 导出当前帧 PNG', style: 'margin-top:0;flex:1' });
  const cancelBtn = el('button', { class: 'exp-btn secondary', type: 'button', text: '停止', style: 'margin-top:0;flex:0 0 60px;display:none' });
  btnRow.append(renderBtn, stillBtn, cancelBtn);

  stillBtn.onclick = () => {
    const res = RES_MAP[selRes];
    app.exporter.still({ width: res.w, height: res.h });
    toast('正在导出当前帧…', 'info');
  };

  actionCard.append(progBar, btnRow, resultHost);
  left.appendChild(actionCard);

  /* ---- Left: Render Queue ---- */
  const queueCard = el('div', { class: 'exp-card' });
  queueCard.appendChild(el('h3', { text: '渲染队列' }));
  const queueHost = el('div', { class: 'exp-queue' });

  const emptyQ = el('div', { style: 'text-align:center;padding:20px;color:var(--fg3);font-size:12px' }, [
    el('div', { text: '队列为空' }),
    el('div', { text: '添加当前设置到队列批量渲染', style: 'font-size:11px;margin-top:4px' }),
  ]);
  queueHost.appendChild(emptyQ);
  queueCard.appendChild(queueHost);

  const addQueueBtn = el('button', { class: 'exp-btn secondary', type: 'button', text: '+ 添加当前设置到队列' });
  addQueueBtn.onclick = () => {
    const res = RES_MAP[selRes];
    const item = {
      id: Date.now(),
      res: `${res.w}×${res.h}`,
      w: res.w, h: res.h,
      fps: FPS_MAP[selFps],
      bitrate: BITRATE_MAP[selQual],
      format: FORMAT_REAL[selFmt].label,
      formatId: FORMAT_REAL[selFmt].mime,
      duration: app.state.duration,
      status: 'waiting',
    };
    renderQueue.push(item);
    renderQueueUI();
    toast(`已添加到队列（${item.res} ${item.format}）`, 'info');
  };

  const startQueueBtn = el('button', { class: 'exp-btn', type: 'button', text: '开始批量渲染' });
  startQueueBtn.onclick = async () => {
    if (queueRunning || app.exporter.running) return;
    const pending = renderQueue.filter(q => q.status === 'waiting');
    if (!pending.length) { toast('队列为空', 'info'); return; }
    queueRunning = true; startQueueBtn.disabled = true;
    let stopped = false;
    try {
      for (const item of pending) {
        item.status = 'rendering'; renderQueueUI();
        const result = await runExport(item.w, item.h, item.fps, item.bitrate, item.duration, (p) => {
          item.progress = p; renderQueueUI();
        }, item.formatId);
        item.status = result?.cancelled || result?.diskSave === 'cancelled' ? 'cancelled' : result?.diskSave === 'error' ? 'error' : result?.size ? 'done' : 'error';
        renderQueueUI();
        if (item.status !== 'done') { stopped = true; break; }
      }
      toast(stopped ? '队列已停止，其余任务仍在等待' : '批量渲染完成', stopped ? 'info' : 'success');
    } finally { queueRunning = false; startQueueBtn.disabled = false; }
  };

  queueCard.append(addQueueBtn, startQueueBtn);
  left.appendChild(queueCard);

  function renderQueueUI() {
    queueHost.innerHTML = '';
    if (!renderQueue.length) {
      queueHost.appendChild(emptyQ);
      return;
    }
    renderQueue.forEach((item, idx) => {
      const row = el('div', { class: 'exp-queue-item' });
      row.appendChild(el('span', { text: `${idx + 1}. ${item.res} ${item.format}`, style: 'font-size:12px;flex:1' }));
      const bar = el('div', { class: 'progress' });
      const barInner = el('div', { class: 'bar', style: `width:${item.status === 'done' ? 100 : item.status === 'rendering' ? ((item.progress?.i || 0) / Math.max(1, item.progress?.total || 1) * 100).toFixed(1) : 0}%` });
      bar.appendChild(barInner);
      row.appendChild(bar);
      const statusText = item.status === 'waiting' ? '等待中' : item.status === 'rendering' ? `${((item.progress?.i || 0) / Math.max(1, item.progress?.total || 1) * 100).toFixed(0)}%` : item.status === 'cancelled' ? '已取消' : item.status === 'error' ? '失败' : '完成';
      row.appendChild(el('span', { class: 'status', text: statusText }));
      if (item.status === 'waiting') {
        const rm = el('button', { text: '✕', type: 'button', style: 'border:0;background:none;color:var(--fg3);cursor:pointer;font-size:14px;padding:0 4px' });
        rm.onclick = () => { renderQueue.splice(idx, 1); renderQueueUI(); };
        row.appendChild(rm);
      }
      queueHost.appendChild(row);
    });
  }

  /* ---- Render function ---- */
  async function runExport(w, h, fps, bitrate, duration, onProg, format = FORMAT_REAL[selFmt].mime) {
    renderBtn.disabled = true;
    renderBtn.textContent = '● 渲染中…';
    cancelBtn.style.display = '';
    clear(resultHost);
    const fill = progBar.querySelector('i');
    const lab = progBar.querySelector('span');
    let last = 0;
    const result = await app.exporter.run({ width: w, height: h, fps, duration, bitrate, loop: true, format, encoder: format === 'mp4' ? 'mediarecorder' : undefined }, (p) => {
      const pct = (p.i / Math.max(1, p.total)) * 100;
      if (pct - last > 0.8 || p.phase !== 'render') { last = pct; fill.style.width = clamp(pct, 0, 100).toFixed(1) + '%'; }
      lab.textContent = p.phase === 'retry' ? '重试中…'
        : p.phase === 'done' ? `完成 ${(p.size / 1048576).toFixed(2)} MB${p.diskSave === 'saved' ? ' · 已写入磁盘' : p.diskSave === 'cancelled' ? ' · 已取消保存，可另存' : p.diskSave === 'error' ? ' · 磁盘保存失败，可另存' : ''}`
          : p.phase === 'cancelled' ? '已取消，不生成文件'
          : p.phase === 'error' ? `导出失败：${p.error}`
          : p.phase === 'prepare' ? '准备导出缓存…'
          : p.phase === 'empty' ? '未取到画面'
            : `第 ${p.i + 1}/${p.total} 帧 · ${pct.toFixed(0)}%`;
      if (onProg) onProg(p);
    });
    renderBtn.disabled = false;
    renderBtn.textContent = '▶ 开始渲染';
    cancelBtn.style.display = 'none';
    clear(resultHost);
    if (result && result.size) {
      const vid = el('video', { src: result.url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true, style: 'width:100%;border-radius:8px;margin-top:4px' });
      resultHost.appendChild(vid);
      const saveAgain = el('button', { class: 'exp-btn secondary', type: 'button', dataset: { exportSaveAgain: '1' }, text: DESKTOP_BUILD ? '另存视频（重试／新位置）' : '再次下载视频', onclick: async () => { saveAgain.disabled = true; try { const r = await downloadBlob(result.blob, result.name); if (r) lab.textContent = r.status === 'saved' ? '视频已写入磁盘' : r.status === 'cancelled' ? '已取消保存，视频预览仍保留' : '磁盘保存失败，可再次重试'; } catch (e) { toast(e.message, 'warn'); } finally { saveAgain.disabled = false; } } });
      resultHost.appendChild(saveAgain);
      resultHost.appendChild(el('div', { style: 'font-size:11px;color:var(--fg3);margin-top:4px', text: `${result.name} · ${(result.size / 1048576).toFixed(2)} MB · ${result.frames} 帧` }));
    } else {
      resultHost.appendChild(el('div', { style: 'font-size:12px;color:var(--err);padding:8px', text: result?.cancelled ? '已取消，未下载不完整视频。' : result?.error ? `导出失败：${result.error}` : '导出未产生文件。请使用 Chrome / Edge 浏览器。' }));
    }
    return result;
  }

  renderBtn.onclick = () => {
    if (queueRunning) return;
    const res = RES_MAP[selRes];
    runExport(res.w, res.h, FPS_MAP[selFps], BITRATE_MAP[selQual], app.state.duration);
  };
  cancelBtn.onclick = () => app.exporter?.cancel();

  /* ---- Right: Audio ---- */
  const audioCard = el('div', { class: 'exp-card' });
  audioCard.appendChild(el('h3', { text: '音频设置' }));
  audioCard.appendChild(el('div', { style: 'font-size:12px;color:var(--fg3);padding:12px 0;text-align:center', text: '音频混合功能即将上线' }));
  right.appendChild(audioCard);

  /* ---- Right: Deliver ---- */
  const delCard = el('div', { class: 'exp-card' });
  delCard.appendChild(el('h3', { text: '交付选项' }));

  const delRows = [
    { label: DESKTOP_BUILD ? '渲染后选择磁盘保存位置' : '导出后自动下载', on: true },
    { label: '包含运镜数据 JSON', on: false },
    { label: '包含 AI 提示词', on: true },
  ];
  delRows.forEach(r => {
    const row = el('div', { class: 'exp-row' });
    row.appendChild(el('label', { text: r.label }));
    const toggle = el('div', { class: 'toggle' + (r.on ? ' on' : '') });
    toggle.onclick = () => toggle.classList.toggle('on');
    row.appendChild(toggle);
    delCard.appendChild(row);
  });

  const dataBtnRow = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:12px' });
  dataBtnRow.appendChild(el('button', { class: 'exp-btn secondary', type: 'button', text: '⬇ 保存工程 JSON', onclick: () => { downloadBlob(new Blob([JSON.stringify(app.serialize(), null, 1)], { type: 'application/json' }), `${(app.projectName || 'previz')}.json`); toast('已导出工程 JSON'); } }));
  dataBtnRow.appendChild(el('button', { class: 'exp-btn secondary', type: 'button', text: '⬇ 导出运镜数据', onclick: () => { downloadBlob(new Blob([JSON.stringify(motionJson(app), null, 1)], { type: 'application/json' }), 'camera_path.json'); toast('已导出运镜数据'); } }));
  dataBtnRow.appendChild(el('button', { class: 'exp-btn secondary', type: 'button', text: '📋 复制 AI 提示词', onclick: () => { const t = buildPrompt(app).text; navigator.clipboard.writeText(t).then(() => toast('已复制提示词')).catch(() => toast('复制失败')); } }));
  delCard.appendChild(dataBtnRow);
  right.appendChild(delCard);

  /* ---- Right: Export tips ---- */
  const tipsCard = el('div', { class: 'exp-card' });
  tipsCard.appendChild(el('h3', { text: '导出说明' }));
  tipsCard.appendChild(el('div', { style: 'font-size:11px;color:var(--fg3);line-height:1.6', html: '• 优先固定时间戳 WebM，逐帧编码，耗时取决于场景<br>• 不支持时回退实时录制，可能延长时长或丢帧<br>• 关闭光影（Direct 页面）可显著提速<br>• 固定时间戳路径输出 WebM；兼容录制格式由浏览器决定<br>• 导出当前帧 PNG 可用于高质量截图' }));
  right.appendChild(tipsCard);

  return {};
}

export function toast(msg, kind = 'info', ms = 0) {
  let host = document.querySelector('.toasts');
  if (!host) { host = el('div', { class: 'toasts' }); document.body.appendChild(host); }
  while (host.children.length > 3) host.removeChild(host.firstChild);
  const t = el('div', { class: 'toast ' + kind, text: String(msg) });
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('on'));
  const dur = ms || Math.min(6000, 1500 + String(msg).length * 40);
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 320); }, dur);
}
