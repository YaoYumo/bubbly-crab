// ---------------------------------------------------------------------------
// 第四轮图板重建模型 · 独立 3D 工作台（入口：showcase/index.html，独立端口服务）
//   · 八块图板单体（01 宫殿大殿 … 08 拱桥）一字排开陈列
//   · 左侧清单点选 → 相机飞抵近景；总览按钮拉回全景
//   · 精度档可切（lite/std/fine），切换即重建，与库内门禁同一套 builder
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GROUP_CN } from './arch.js';
import { buildAsset, defaultsFor } from './assets.js';
import { setDetailLevel } from './detail.js';

const PLATES = [
  ['01', 'hall', '宫殿大殿 · 重檐庑殿三重台基'],
  ['02', 'hall2', '歇山大殿 · 山花博风悬鱼'],
  ['03', 'pavilion', '攒尖亭 · 风铃檐椽葫芦顶'],
  ['04', 'pagoda', '佛塔 · 刹链风铃佛龛'],
  ['05', 'gate', '城门 · 券洞门钉铺首'],
  ['06', 'citywall', '城墙 · 夯土芯垛口石嘴'],
  ['07', 'corridor', '游廊 · 漏窗雀替美人靠'],
  ['08', 'archbridge', '拱桥 · 螭首抱鼓水面'],
];

setDetailLevel('fine');

// ---------- 渲染器 / 场景 / 灯光 ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ee);
scene.fog = new THREE.Fog(0xdfe6ee, 260, 620);

const view = new THREE.PerspectiveCamera(46, 1, 0.3, 1500);
view.position.set(60, 42, 96);

const controls = new OrbitControls(view, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 4;
controls.maxDistance = 420;

const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a8577, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
sun.position.set(70, 110, 55);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -170; sc.right = 170; sc.top = 120; sc.bottom = -60; sc.near = 10; sc.far = 400;
sun.shadow.bias = -0.0006;
scene.add(sun);

// 地面 + 网格
const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 64), new THREE.MeshStandardMaterial({ color: 0x9aa389, roughness: 0.96 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(420, 84, 0x6f7668, 0x828a7c);
grid.position.y = 0.02;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// ---------- 陈列 ----------
const stage = new THREE.Group();
scene.add(stage);
const entries = [];          // { no, type, name, root, box, center, tri }
let cursorX = 0;

function makeLabel(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.fillStyle = 'rgba(24,28,34,0.82)';
  cx.roundRect ? cx.roundRect(0, 0, 512, 128, 26) : cx.rect(0, 0, 512, 128);
  cx.fill();
  cx.fillStyle = '#f4d9a0';
  cx.font = '600 52px system-ui, sans-serif';
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(9, 2.25, 1);
  return sp;
}

function buildAll() {
  // 清空
  for (const e of entries) {
    if (e.root.parent) e.root.parent.remove(e.root);
    if (e.label && e.label.parent) e.label.parent.remove(e.label);
  }
  entries.length = 0;
  cursorX = 0;
  const items = GROUP_CN.items;
  const widths = [];
  const roots = [];
  for (const [no, type, name] of PLATES) {
    const item = items.find(i => i.type === type);
    const root = buildAsset(item, defaultsFor(item));
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    roots.push({ no, type, name, root, box, size });
    widths.push(Math.max(size.x, size.z));
  }
  // 排成一排：间距按相邻半宽 + 留白
  let x = 0;
  const posX = [];
  for (let i = 0; i < roots.length; i++) {
    if (i === 0) x = widths[0] / 2;
    else x += widths[i - 1] / 2 + 10 + widths[i] / 2;
    posX.push(x);
  }
  const midX = posX[posX.length - 1] / 2 + widths[0] / 4;
  roots.forEach((r, i) => {
    const px = posX[i] - midX;
    r.baseX = px;
    r.root.position.set(px - (r.box.getCenter(new THREE.Vector3()).x), 0, 0);
    stage.add(r.root);
    const box2 = new THREE.Box3().setFromObject(r.root);
    const center = box2.getCenter(new THREE.Vector3());
    const size2 = box2.getSize(new THREE.Vector3());
    let tri = 0;
    r.root.traverse(o => { if (o.isMesh && o.geometry) tri += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const label = makeLabel(`${r.no} ${r.name.split(' · ')[0]}`);
    label.position.set(center.x, box2.max.y + 3.2, center.z);
    label.userData.isLabel = true;
    stage.add(label);
    entries.push({ ...r, box: box2, center, tri, label });
  });
  fillList();
}

// ---------- UI ----------
const listEl = document.getElementById('list');
const infoEl = document.getElementById('info');
function fillList() {
  listEl.innerHTML = '';
  const b0 = document.createElement('button');
  b0.textContent = '◎ 总览';
  b0.className = 'ov';
  b0.onclick = () => flyTo(null);
  listEl.appendChild(b0);
  for (const e of entries) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="no">${e.no}</span> ${e.name}`;
    b.onclick = () => { if (editOn) enterEdit(e); flyTo(e); };
    b.onmouseenter = () => { e.label.material.opacity = 1; };
    e.btn = b;
    listEl.appendChild(b);
  }
}
function showInfo(e) {
  if (!e) { infoEl.textContent = `陈列 ${entries.length} 件 · 拖拽旋转 / 滚轮缩放 / 右键平移`; return; }
  const s = e.box.getSize(new THREE.Vector3());
  infoEl.textContent = `${e.no} ${e.name} · 包围盒 ${s.x.toFixed(1)}×${s.y.toFixed(1)}×${s.z.toFixed(1)} m · 三角面 ${(e.tri / 1000).toFixed(1)}k`;
}
showInfo(null);

// 相机飞行
let fly = null;
let lastE = null;
function flyTo(e) {
  if (e) lastE = e;
  let target, dist;
  if (!e) {
    const all = new THREE.Box3();
    for (const en of entries) all.union(en.box);
    const c = all.getCenter(new THREE.Vector3());
    const sz = all.getSize(new THREE.Vector3());
    target = new THREE.Vector3(c.x, Math.min(14, sz.y * 0.4), c.z);
    dist = Math.max(sz.x, sz.z) * 0.62;
  } else {
    target = e.center.clone();
    dist = Math.max(e.box.getSize(new THREE.Vector3()).x, e.box.getSize(new THREE.Vector3()).y, e.box.getSize(new THREE.Vector3()).z) * 1.35 + 6;
  }
  const dir = new THREE.Vector3(0.62, 0.42, 0.86).normalize();
  fly = { t0: performance.now(), ms: 900, fromP: view.position.clone(), fromT: controls.target.clone(), toP: target.clone().add(dir.multiplyScalar(dist)), toT: target };
  showInfo(e);
}
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

document.getElementById('spin').onchange = (ev) => { controls.autoRotate = ev.target.checked; controls.autoRotateSpeed = 0.9; };
document.getElementById('lvl').onchange = (ev) => {
  if (editOn) { editOn = false; document.getElementById('edit').checked = false; exitEdit(); }   // 换精度档 = 全量重建，先退出部件编辑（本机改动记录按档位分别保存）
  setDetailLevel(ev.target.value);
  buildAll();
  flyTo(null);
};

// ---------- 循环 ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    view.aspect = w / h;
    view.updateProjectionMatrix();
  }
}
renderer.setAnimationLoop(() => {
  resize();
  if (fly) {
    const t = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    const k = ease(t);
    view.position.lerpVectors(fly.fromP, fly.toP, k);
    controls.target.lerpVectors(fly.fromT, fly.toT, k);
    if (t >= 1) fly = null;
  }
  controls.update();
  renderer.render(scene, view);
});

// ===========================================================================
// 部件编辑：勾选「✎ 部件编辑」→ 点左侧图板 → 该单体以「不烘顶点、不实例化」
// 方式重建，每个构件都是独立节点；画布点选 / 清单点选 → gizmo 或数值面板调整，
// 可隐藏、删除、撤销；「导出修补单」输出 JSON + 文字清单（可交回乙方改进源码）。
// 改动按「图板 × 精度档」存 localStorage，刷新后自动恢复；「清空存档」还原库状态。
// ===========================================================================
const epanel = document.getElementById('epanel');
const etitle = document.getElementById('etitle');
const elist = document.getElementById('elist');
const efilter = document.getElementById('efilter');
const esel = document.getElementById('esel');
const eslabel = document.getElementById('eslabel');
const esnap = document.getElementById('esnap');
const ebox = document.getElementById('ebox');
const etext = document.getElementById('etext');
const editChk = document.getElementById('edit');
const eundoB = document.getElementById('eundo');
const eredoB = document.getElementById('eredo');

const tc = new TransformControls(view, canvas);
scene.add(tc.getHelper());
tc.addEventListener('dragging-changed', (ev) => { controls.enabled = !ev.value; });

let editOn = false;
let editE = null;            // 正在编辑的图板 entry（root 已换成未烘焙版本）
let parts = [];              // [{i, mesh, label, orig:{p,r,s}, origW, row}]
let selIdx = -1;
let gizMode = 'translate';
let gizSpace = 'world';
const undoS = [], redoS = [];
let undoOpen = null;         // gizmo 按下瞬间的「改动前」快照

const _v1 = new THREE.Vector3();
const EPS = 1e-5;
const near = (a, b) => Math.abs(a - b) < EPS;
const sameV = (v, a) => near(v.x, a[0]) && near(v.y, a[1]) && near(v.z, a[2]);

function matOf(m) { return Array.isArray(m.material) ? m.material[0] : m.material; }
function matDesc(m) {
  const mat = matOf(m);
  const kind = (mat && mat.userData && mat.userData.detail) || '';
  const hex = mat && mat.color ? '#' + mat.color.getHexString() : '';
  return `${kind || 'std'} ${hex}`.trim();
}
function partDims(m) {
  const g = m.geometry;
  if (!g) return '—';
  if (!g.boundingBox) g.computeBoundingBox();
  const s = g.boundingBox.getSize(_v1);
  const f = (a, b) => (a * Math.abs(b)).toFixed(2);
  return `${f(s.x, m.scale.x)}×${f(s.y, m.scale.y)}×${f(s.z, m.scale.z)}m`;
}

function collectParts() {
  parts = [];
  editE.root.updateMatrixWorld(true);
  editE.root.traverse((o) => {
    if (!o.isMesh) return;                       // InstancedMesh 也算：整批件当一个部件动
    const i = parts.length;
    o.userData.partIdx = i;
    const inst = o.isInstancedMesh ? ` ×${o.count}批` : '';
    const label = `#${i} ${o.geometry ? o.geometry.type.replace(/Geometry$/, '') : '?'} ${matDesc(o)} ${partDims(o)}${inst}`;
    const origW = o.getWorldPosition(_v1).toArray().map((n) => +n.toFixed(2));
    parts.push({ i, mesh: o, label, origW, row: null,
      orig: { p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.toArray() } });
  });
}

function isModified(p) {
  const m = p.mesh;
  if (m.userData._del) return true;
  if (!m.visible) return true;
  return !sameV(m.position, p.orig.p) || !sameV(m.rotation, p.orig.r) || !sameV(m.scale, p.orig.s);
}
function nModified() { let n = 0; for (const p of parts) if (isModified(p)) n++; return n; }

// ---- 本机存档（按 图板×精度档） ----
function storeKey() { return `r4edit:${editE ? editE.type : '-'}:${document.getElementById('lvl').value}`; }
function collectOps() {
  const ops = [];
  for (const p of parts) {
    const m = p.mesh;
    if (m.userData._del) ops.push({ idx: p.i, op: 'delete' });
    else if (!m.visible) ops.push({ idx: p.i, op: 'hide' });
    else if (isModified(p)) ops.push({ idx: p.i, op: 'xf', p: m.position.toArray(), r: [m.rotation.x, m.rotation.y, m.rotation.z], s: m.scale.toArray() });
  }
  return ops;
}
function saveEdits() {
  if (!editE) return;
  try {
    const ops = collectOps();
    if (ops.length) localStorage.setItem(storeKey(), JSON.stringify(ops));
    else localStorage.removeItem(storeKey());
  } catch (err) { /* 隐私模式等：忽略 */ }
}
function applySaved() {
  let ops = null;
  try { ops = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (err) { return; }
  if (!Array.isArray(ops)) return;
  for (const o of ops) {
    const p = parts[o.idx];
    if (!p) continue;
    if (o.op === 'delete') _delete(p.i);
    else if (o.op === 'hide') p.mesh.visible = false;
    else if (o.op === 'xf') {
      if (Array.isArray(o.p)) p.mesh.position.fromArray(o.p);
      if (Array.isArray(o.r)) p.mesh.rotation.set(o.r[0], o.r[1], o.r[2]);
      if (Array.isArray(o.s)) p.mesh.scale.fromArray(o.s);
    }
  }
}

// ---- 撤销 / 重做 ----
function snap(i) {
  const p = parts[i]; if (!p) return null;
  const m = p.mesh;
  return { i, del: !!m.userData._del, vis: m.visible, p: m.position.toArray(), r: [m.rotation.x, m.rotation.y, m.rotation.z], s: m.scale.toArray() };
}
function snapsDiffer(a, b) {
  return a.del !== b.del || a.vis !== b.vis ||
    a.p.some((v, k) => !near(v, b.p[k])) || a.r.some((v, k) => !near(v, b.r[k])) || a.s.some((v, k) => !near(v, b.s[k]));
}
function _delete(i) {
  const m = parts[i].mesh;
  if (m.userData._del) return;
  m.userData._par = m.parent; m.userData._del = 1;
  if (m.parent) m.parent.remove(m);
  if (selIdx === i) tc.detach();
}
function _restore(i) {
  const m = parts[i].mesh;
  if (!m.userData._del) return;
  (m.userData._par || editE.root).add(m);
  delete m.userData._del;
}
function applySnap(s) {
  const p = parts[s.i]; if (!p) return;
  if (s.del) _delete(s.i); else _restore(s.i);
  p.mesh.visible = s.vis;
  p.mesh.position.fromArray(s.p);
  p.mesh.rotation.set(s.r[0], s.r[1], s.r[2]);
  p.mesh.scale.fromArray(s.s);
}
function pushUndo(before, after) {
  undoS.push({ b: Array.isArray(before) ? before : [before], a: Array.isArray(after) ? after : [after] });
  if (undoS.length > 300) undoS.shift();
  redoS.length = 0;
  refreshFoot();
}
function afterOp() {
  saveEdits(); refreshList();
  if (selIdx >= 0) { const p = parts[selIdx]; if (p && !p.mesh.userData._del) tc.attach(p.mesh); }
  refreshNums(); infoEdit(); refreshFoot();
}
function undo() {
  const u = undoS.pop(); if (!u) return;
  tc.detach();
  for (const s of u.b) applySnap(s);
  redoS.push(u);
  afterOp();
}
function redo() {
  const u = redoS.pop(); if (!u) return;
  tc.detach();
  for (const s of u.a) applySnap(s);
  undoS.push(u);
  afterOp();
}
tc.addEventListener('mouseDown', () => { if (selIdx >= 0) undoOpen = snap(selIdx); });
tc.addEventListener('mouseUp', () => {
  if (undoOpen && selIdx >= 0) {
    const after = snap(selIdx);
    if (snapsDiffer(undoOpen, after)) pushUndo(undoOpen, after);
    undoOpen = null;
  }
  saveEdits(); refreshNums(); infoEdit(); refreshList();
});

// ---- 部件操作 ----
function opDelete(i) { const b = snap(i); _delete(i); pushUndo(b, snap(i)); afterOp(); }
function opRestore(i) { const b = snap(i); _restore(i); pushUndo(b, snap(i)); afterOp(); }
function opHide(i) { const p = parts[i]; const b = snap(i); p.mesh.visible = !p.mesh.visible; pushUndo(b, snap(i)); afterOp(); }
function resetToOrig(p) {
  _restore(p.i);
  p.mesh.position.fromArray(p.orig.p);
  p.mesh.rotation.set(p.orig.r[0], p.orig.r[1], p.orig.r[2]);
  p.mesh.scale.fromArray(p.orig.s);
  p.mesh.visible = true;
}
function opResetOne(i) { const p = parts[i]; const b = snap(i); resetToOrig(p); const a = snap(i); if (snapsDiffer(b, a)) pushUndo(b, a); afterOp(); }
function opResetAll() {
  const b = parts.map((p) => snap(p.i));
  for (const p of parts) resetToOrig(p);
  const a = parts.map((p) => snap(p.i));
  if (b.some((s, k) => snapsDiffer(s, a[k]))) pushUndo(b, a);
  afterOp();
}

// ---- 选中 / 高亮 ----
function setSel(i) {
  if (i === selIdx) { refreshNums(); return; }
  const prev = selIdx >= 0 ? parts[selIdx] : null;
  if (prev && prev.mesh.userData._omat !== undefined) { prev.mesh.material = prev.mesh.userData._omat; delete prev.mesh.userData._omat; }
  selIdx = (i >= 0 && parts[i]) ? i : -1;
  if (selIdx < 0) { tc.detach(); esel.hidden = true; }
  else {
    const p = parts[selIdx], m = p.mesh;
    esel.hidden = false;
    if (!m.userData._del) {
      m.userData._omat = m.material;
      const glow = (mm) => { if (mm && mm.emissive) { mm.emissive.setHex(0x2f5fd0); mm.emissiveIntensity = 0.55; } };
      if (Array.isArray(m.material)) m.material = m.material.map((mm) => { const c = mm.clone(); glow(c); return c; });
      else { const c = m.material.clone(); glow(c); m.material = c; }
      tc.attach(m); tc.setMode(gizMode); tc.setSpace(gizSpace);
    } else tc.detach();
  }
  markListSel(); refreshNums(); infoEdit();
  if (selIdx >= 0 && parts[selIdx].row) parts[selIdx].row.scrollIntoView({ block: 'nearest' });
}

// ---- 数值面板 ----
const NUM = ['ex0', 'ex1', 'ex2', 'er0', 'er1', 'er2', 'es0', 'es1', 'es2'].map((id) => document.getElementById(id));
function refreshNums() {
  const p = selIdx >= 0 ? parts[selIdx] : null;
  if (!p) return;
  const m = p.mesh, del = !!m.userData._del;
  const w = del ? p.origW : m.getWorldPosition(_v1).toArray();
  eslabel.textContent = `${p.label} · 世界(${w.map((n) => (+n).toFixed(2)).join(', ')})${del ? ' · 已删除' : !m.visible ? ' · 已隐藏' : ''}`;
  const vals = del
    ? [...p.orig.p, ...p.orig.r.map((r) => THREE.MathUtils.radToDeg(r)), ...p.orig.s]
    : [m.position.x, m.position.y, m.position.z,
      THREE.MathUtils.radToDeg(m.rotation.x), THREE.MathUtils.radToDeg(m.rotation.y), THREE.MathUtils.radToDeg(m.rotation.z),
      m.scale.x, m.scale.y, m.scale.z];
  NUM.forEach((inp, k) => { inp.value = +vals[k].toFixed(k < 3 ? 3 : k < 6 ? 1 : 3); inp.disabled = del; });
  document.getElementById('ehide').disabled = del;
  document.getElementById('edel').disabled = del;
  for (const g of document.querySelectorAll('#egizrow button.g[data-giz]')) g.disabled = del;
}
NUM.forEach((inp) => {
  inp.addEventListener('change', () => {
    if (selIdx < 0) return;
    const p = parts[selIdx];
    if (!p || p.mesh.userData._del) return;
    const vals = NUM.map((x) => parseFloat(x.value));
    if (vals.some((v) => !Number.isFinite(v))) { refreshNums(); return; }
    const b = snap(selIdx);
    p.mesh.position.set(vals[0], vals[1], vals[2]);
    p.mesh.rotation.set(THREE.MathUtils.degToRad(vals[3]), THREE.MathUtils.degToRad(vals[4]), THREE.MathUtils.degToRad(vals[5]));
    p.mesh.scale.set(Math.max(0.001, vals[6]), Math.max(0.001, vals[7]), Math.max(0.001, vals[8]));
    const a = snap(selIdx);
    if (snapsDiffer(b, a)) pushUndo(b, a);
    afterOp();
  });
});

// ---- gizmo 模式 / 吸附 ----
const SNAP_OPTS = {
  translate: [[0, '关'], [0.05, '0.05 m'], [0.25, '0.25 m'], [1, '1 m']],
  rotate: [[0, '关'], [5, '5°'], [15, '15°'], [45, '45°']],
  scale: [[0, '关'], [0.05, '0.05'], [0.1, '0.1'], [0.5, '0.5']],
};
function applySnapSet() {
  const v = +esnap.value || 0;
  tc.setTranslationSnap(gizMode === 'translate' && v ? v : null);
  tc.setRotationSnap(gizMode === 'rotate' && v ? THREE.MathUtils.degToRad(v) : null);
  tc.setScaleSnap(gizMode === 'scale' && v ? v : null);
}
function fillSnap() {
  const cur = +esnap.value || 0;
  esnap.innerHTML = SNAP_OPTS[gizMode].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  esnap.value = String(SNAP_OPTS[gizMode].some(([v]) => v === cur) ? cur : 0);
  applySnapSet();
}
function setGiz(mode) {
  gizMode = mode;
  tc.setMode(mode);
  for (const g of document.querySelectorAll('#egizrow button.g[data-giz]')) g.classList.toggle('on', g.dataset.giz === mode);
  fillSnap();
}
document.querySelectorAll('#egizrow button.g[data-giz]').forEach((g) => { g.onclick = () => setGiz(g.dataset.giz); });
esnap.onchange = applySnapSet;
document.getElementById('espace').onclick = (ev) => {
  gizSpace = gizSpace === 'world' ? 'local' : 'world';
  tc.setSpace(gizSpace);
  ev.target.textContent = gizSpace === 'world' ? '世界' : '局部';
  ev.target.classList.toggle('on', gizSpace === 'local');
};

// ---- 部件清单 ----
function fillParts() {
  const kw = (efilter.value || '').trim().toLowerCase();
  elist.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of parts) {
    if (kw && !(p.label.toLowerCase().includes(kw) || ('#' + p.i) === kw)) continue;
    const row = document.createElement('div');
    row.className = 'prow';
    const b = document.createElement('button');
    b.className = 'pl';
    b.textContent = p.label;
    b.title = `${p.label} · 世界(${p.origW.join(', ')})`;
    b.onclick = () => setSel(p.i);
    const v = document.createElement('button');
    v.className = 'pv';
    v.onclick = (ev) => { ev.stopPropagation(); if (p.mesh.userData._del) opRestore(p.i); else opHide(p.i); };
    row.append(b, v);
    p.row = row;
    frag.appendChild(row);
  }
  elist.appendChild(frag);
  refreshList();
}
function refreshList() {
  for (const p of parts) {
    if (!p.row || !p.row.isConnected) { fillParts(); return; }   // 行丢失（筛选变化等）→ 重画
    const v = p.row.querySelector('.pv');
    v.textContent = p.mesh.userData._del ? '↩' : p.mesh.visible ? '👁' : '▫';
    v.title = p.mesh.userData._del ? '恢复该件' : p.mesh.visible ? '隐藏' : '显示';
  }
  markListSel();
}
function markListSel() {
  for (const p of parts) if (p.row) {
    p.row.classList.toggle('sel', p.i === selIdx);
    p.row.classList.toggle('del', !!p.mesh.userData._del);
    p.row.classList.toggle('hid', !p.mesh.visible && !p.mesh.userData._del);
  }
}
efilter.oninput = () => fillParts();

function infoEdit() {
  if (!editE) return;
  infoEl.textContent = `✎ ${editE.no} ${editE.name.split(' · ')[0]} · ${parts.length} 件 · 已改 ${nModified()} 处${selIdx >= 0 ? ` · 选中 #${selIdx}` : ''} · 单击选中 / W移动 E旋转 R缩放 / Del删除 H隐藏 / Ctrl+Z撤销`;
}
function refreshFoot() { eundoB.disabled = !undoS.length; eredoB.disabled = !redoS.length; }

// ---- 进入 / 退出 ----
function enterEdit(e) {
  if (editE === e) return;
  if (editE) exitEdit(true);
  globalThis.__noBake = 1; globalThis.__noInst = 1;
  const item = GROUP_CN.items.find((it) => it.type === e.type);
  let root;
  try { root = buildAsset(item, defaultsFor(item)); } finally { globalThis.__noBake = 0; globalThis.__noInst = 0; }
  const box0 = new THREE.Box3().setFromObject(root);
  root.position.set(e.baseX - box0.getCenter(_v1).x, 0, 0);
  stage.remove(e.root);
  e.bakedRoot = e.root; e.root = root;
  stage.add(root);
  const box = new THREE.Box3().setFromObject(root);
  e.box = box; e.center = box.getCenter(new THREE.Vector3());
  if (e.label) e.label.position.set(e.center.x, box.max.y + 3.2, e.center.z);
  editE = e;
  undoS.length = 0; redoS.length = 0;
  collectParts(); applySaved(); fillParts(); setSel(-1);
  etitle.textContent = `部件编辑 · ${e.no} ${e.name.split(' · ')[0]}`;
  epanel.hidden = false;
  for (const en of entries) if (en.btn) en.btn.classList.toggle('ed', en === e);
  setGiz(gizMode); infoEdit(); refreshFoot();
}
function exitEdit(keep) {
  if (!editE) return;
  const e = editE;
  setSel(-1);
  saveEdits();
  stage.remove(e.root);
  if (e.bakedRoot) { e.root = e.bakedRoot; delete e.bakedRoot; stage.add(e.root); }
  const box = new THREE.Box3().setFromObject(e.root);
  e.box = box; e.center = box.getCenter(new THREE.Vector3());
  if (e.label) e.label.position.set(e.center.x, box.max.y + 3.2, e.center.z);
  editE = null; parts = [];
  for (const en of entries) if (en.btn) en.btn.classList.remove('ed');
  if (!keep) { epanel.hidden = true; showInfo(null); }
}
editChk.onchange = () => {
  editOn = editChk.checked;
  if (editOn) {
    if (lastE) enterEdit(lastE);
    else infoEl.textContent = '部件编辑：请先点左侧清单选中要编辑的图板（当前没有聚焦对象）';
  } else exitEdit();
};
document.getElementById('eclose').onclick = () => { editOn = false; editChk.checked = false; exitEdit(); };
eundoB.onclick = undo;
eredoB.onclick = redo;
document.getElementById('ereset1').onclick = () => { if (selIdx >= 0) opResetOne(selIdx); };
document.getElementById('ehide').onclick = () => { if (selIdx >= 0) opHide(selIdx); };
document.getElementById('edel').onclick = () => { if (selIdx >= 0) opDelete(selIdx); };
document.getElementById('eresetall').onclick = () => { if (editE && confirm(`把「${editE.name.split(' · ')[0]}」全部还原为库内状态？（可 Ctrl+Z 撤销）`)) opResetAll(); };
document.getElementById('eclear').onclick = () => {
  if (!editE) return;
  if (confirm('清空该图板在本机的改动存档，并还原为库内状态？')) {
    try { localStorage.removeItem(storeKey()); } catch (err) { /* ignore */ }
    opResetAll();
  }
};

// ---- 修补单导出 ----
const fmtS = (v) => (v >= 0 ? '+' : '') + v;
function buildPatch() {
  const e = editE;
  e.root.updateMatrixWorld(true);
  const ops = [];
  for (const p of parts) {
    const m = p.mesh;
    const base = { idx: p.i, label: p.label, world0: p.origW };
    if (m.userData._del) { ops.push({ ...base, op: 'delete' }); continue; }
    if (!m.visible) { ops.push({ ...base, op: 'hide' }); continue; }
    const dp = [m.position.x - p.orig.p[0], m.position.y - p.orig.p[1], m.position.z - p.orig.p[2]];
    const drd = [m.rotation.x - p.orig.r[0], m.rotation.y - p.orig.r[1], m.rotation.z - p.orig.r[2]].map((r) => THREE.MathUtils.radToDeg(r));
    const ds = [m.scale.x / (p.orig.s[0] || 1), m.scale.y / (p.orig.s[1] || 1), m.scale.z / (p.orig.s[2] || 1)];
    const moved = dp.some((v) => Math.abs(v) > 1e-4), rot = drd.some((v) => Math.abs(v) > 0.01), sca = ds.some((v) => Math.abs(v - 1) > 1e-4);
    if (!moved && !rot && !sca) continue;
    ops.push({ ...base, op: 'adjust',
      move: moved ? dp.map((v) => +v.toFixed(3)) : null,
      rotateDeg: rot ? drd.map((v) => +v.toFixed(1)) : null,
      scaleBy: sca ? ds.map((v) => +v.toFixed(3)) : null,
      world1: m.getWorldPosition(_v1).toArray().map((v) => +v.toFixed(2)) });
  }
  return { plate: { no: e.no, type: e.type, name: e.name }, level: document.getElementById('lvl').value, exportedAt: new Date().toISOString(), count: ops.length, ops };
}
function patchText(patch) {
  const L = [];
  L.push(`【部件修补单】${patch.plate.no} ${patch.plate.type} · ${patch.plate.name}（${patch.level} 档）`);
  L.push(`导出 ${patch.exportedAt} · 3D 工作台「部件编辑」手动调整 · 单位：米（Y-up，世界坐标）/ 度`);
  L.push(`共 ${patch.count} 处改动：`);
  patch.ops.forEach((o, k) => {
    L.push(`[${k + 1}] ${o.label} · 世界(${o.world0.join(', ')})`);
    if (o.op === 'delete') L.push('    删除（判定为游离/错误构件，移除）');
    else if (o.op === 'hide') L.push('    隐藏（仅视图隐藏，部件仍在）');
    else {
      if (o.move) L.push(`    移动 Δ(${o.move.map(fmtS).join(', ')}) → 世界(${o.world1.join(', ')})`);
      if (o.rotateDeg) L.push(`    旋转 Δ(${o.rotateDeg.map((v) => fmtS(v) + '°').join(', ')})`);
      if (o.scaleBy) L.push(`    缩放 ×(${o.scaleBy.join(', ')})`);
    }
  });
  L.push('—— 请乙方按此修改 src/*.js 对应 builder，并重跑 shots / libblock / libaudit / imgcheck 验证。');
  return L.join('\n');
}
document.getElementById('eexport').onclick = () => {
  if (!editE) return;
  const patch = buildPatch();
  etext.value = patchText(patch) + '\n\n===== JSON =====\n' + JSON.stringify(patch, null, 1);
  ebox.hidden = false;
};
document.getElementById('ecopy').onclick = async () => {
  const btn = document.getElementById('ecopy');
  try { await navigator.clipboard.writeText(etext.value); btn.textContent = '已复制✓'; }
  catch (err) { etext.select(); try { document.execCommand('copy'); btn.textContent = '已复制✓'; } catch (e2) { /* ignore */ } }
  setTimeout(() => { btn.textContent = '复制文本'; }, 1200);
};
document.getElementById('edl').onclick = () => {
  const patch = buildPatch();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(patch, null, 1)], { type: 'application/json' }));
  a.download = `修补单-${patch.plate.type}-${patch.level}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
document.getElementById('eboxclose').onclick = () => { ebox.hidden = true; };

// ---- 画布点选 / 悬停 / 快捷键 ----
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downXY = null;
canvas.addEventListener('pointerdown', (ev) => { downXY = [ev.clientX, ev.clientY, performance.now()]; });
canvas.addEventListener('pointerup', (ev) => {
  if (!editOn || !editE || !downXY) return;
  const [x0, y0, t0] = downXY; downXY = null;
  if (tc.dragging || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6 || performance.now() - t0 > 500) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, view);
  const hits = ray.intersectObject(editE.root, true).filter((h) => h.object.isMesh && h.object.visible && !h.object.userData._del);
  const idx = hits.length ? hits[0].object.userData.partIdx : undefined;
  setSel(idx === undefined ? -1 : idx);
});
let hoverPend = 0;
canvas.addEventListener('pointermove', (ev) => {
  if (!editOn || !editE || hoverPend || tc.dragging) return;
  const mx = ev.clientX, my = ev.clientY;
  hoverPend = requestAnimationFrame(() => {
    hoverPend = 0;
    const r = canvas.getBoundingClientRect();
    ndc.set(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, view);
    const hit = ray.intersectObject(editE.root, true).some((h) => h.object.isMesh && h.object.visible && !h.object.userData._del);
    canvas.style.cursor = hit ? 'pointer' : '';
  });
});
addEventListener('keydown', (ev) => {
  const tag = ((ev.target && ev.target.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (!editOn) return;
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'y')) {
    ev.preventDefault();
    if (k === 'y' || ev.shiftKey) redo(); else undo();
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (k === 'w') setGiz('translate');
  else if (k === 'e') setGiz('rotate');
  else if (k === 'r') setGiz('scale');
  else if (k === 'escape') setSel(-1);
  else if ((k === 'delete' || k === 'backspace') && selIdx >= 0) { ev.preventDefault(); opDelete(selIdx); }
  else if (k === 'h' && selIdx >= 0) opHide(selIdx);
});

// ---- 控制台/测试钩子 ----
window.R4 = {
  get state() { return { editOn, plate: editE && editE.type, parts: parts.length, sel: selIdx, modified: editE ? nModified() : 0, undo: undoS.length, redo: redoS.length }; },
  enter(type) { const e = entries.find((x) => x.type === type); if (!e) return false; editOn = true; editChk.checked = true; enterEdit(e); flyTo(e); return true; },
  exit() { editOn = false; editChk.checked = false; exitEdit(); },
  select: setSel,
  nudge(axis, d) { if (selIdx < 0 || parts[selIdx].mesh.userData._del) return false; const p = parts[selIdx]; const b = snap(selIdx); p.mesh.position[axis] += d; const a = snap(selIdx); if (snapsDiffer(b, a)) pushUndo(b, a); afterOp(); return true; },
  delete: opDelete, hide: opHide, restore: opRestore, resetOne: opResetOne, resetAll: opResetAll,
  undo, redo,
  patch: () => (editE ? buildPatch() : null),
  text: () => (editE ? patchText(buildPatch()) : ''),
  list: () => parts.map((p) => ({ i: p.i, label: p.label, world: p.origW, mod: isModified(p) })),
};

setGiz('translate');
refreshFoot();

buildAll();
flyTo(null);
