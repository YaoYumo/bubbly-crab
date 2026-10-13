// ---------------------------------------------------------------------------
// 第四轮图板重建模型 · 独立 3D 工作台（入口：showcase/index.html，独立端口服务）
//   · 八块图板单体（01 宫殿大殿 … 08 拱桥）一字排开陈列
//   · 左侧清单点选 → 相机飞抵近景；总览按钮拉回全景
//   · 精度档可切（lite/std/fine），切换即重建，与库内门禁同一套 builder
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
    b.onclick = () => flyTo(e);
    b.onmouseenter = () => { e.label.material.opacity = 1; };
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
function flyTo(e) {
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

buildAll();
flyTo(null);
