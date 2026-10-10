// ---------------------------------------------------------------------------
// 电影摄像机预设 + 运镜预设 + 机位/关键帧编辑
// 约定：关键帧保存在「机位 rig 的局部空间」，因此拖动 rig 可整体平移整段运镜。
//       key.f 记录的是水平视角 hFov（度），便于表现变焦 / 希区柯克变焦。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Mover, DEFAULT_MOTION } from './mover.js';
import { normalizePts, clonePts, CURVE_BY_ID } from './curve.js';
import { clamp, deg, rad, smoothNoise, uid } from './util.js';

export const SENSORS = [
  { v: 'ff', l: '全画幅 36×24mm', sw: 36, sh: 24, squeeze: 1 },
  { v: 's35', l: 'Super 35 · 24.9×18.7mm', sw: 24.89, sh: 18.66, squeeze: 1 },
  { v: 's16', l: 'Super 16 · 12.5×7.6mm', sw: 12.52, sh: 7.58, squeeze: 1 },
  { v: 'vv', l: 'VistaVision · 48.2×24mm', sw: 48.2, sh: 24, squeeze: 1 },
  { v: 'lf65', l: '65mm 大画幅 · 54.1×25.6mm', sw: 54.12, sh: 25.58, squeeze: 1 },
  { v: 'imax', l: 'IMAX 70 · 70.4×52.6mm', sw: 70.41, sh: 52.63, squeeze: 1 },
  { v: 'anno', l: '变形宽幅 2× Anamorphic', sw: 36, sh: 24, squeeze: 2 },
];
export const CAMERA_MODELS = [
  { v: 'alexa35', l: 'ARRI ALEXA 35 · 数字电影机', sensor: 'ff', lenses: [18, 25, 32, 40, 50, 65, 85] },
  { v: 'arricam', l: 'ARRICAM ST · 35mm 胶片', sensor: 's35', lenses: [14, 18, 25, 35, 50, 75, 100] },
  { v: 'panavision', l: 'Panavision · 变形宽幅镜头', sensor: 'anno', lenses: [30, 40, 50, 75, 100, 150] },
  { v: 'venice', l: 'Sony VENICE 2 · 数字', sensor: 'ff', lenses: [20, 25, 35, 50, 75, 100] },
  { v: 'komodo', l: 'RED KOMODO · 紧凑云台/稳定器', sensor: 's35', lenses: [10, 17, 29, 40, 50] },
  { v: 'imax', l: 'IMAX MSM 9802 · 70mm', sensor: 'imax', lenses: [30, 45, 60, 80] },
  { v: 'dslr', l: '单反定焦 · 轻量手持', sensor: 'ff', lenses: [24, 35, 50, 85, 135] },
  { v: 'phone', l: '手机广角 · POV', sensor: 's16', lenses: [13, 16, 24] },
];
export const LENSES = [
  { f: 14, l: '14mm 超广角 · 空间夸张' },
  { f: 18, l: '18mm 广角 · 交代环境' },
  { f: 24, l: '24mm 广角 · 建筑/纪实' },
  { f: 28, l: '28mm 人文广角' },
  { f: 35, l: '35mm 经典叙事焦段' },
  { f: 40, l: '40mm 标准略广' },
  { f: 50, l: '50mm 标准 · 接近人眼' },
  { f: 65, l: '65mm 中焦 · 人物特写' },
  { f: 85, l: '85mm 人像 · 压缩背景' },
  { f: 100, l: '100mm 长焦 · 空间压缩' },
  { f: 135, l: '135mm 远摄 · 浅纵深' },
  { f: 200, l: '200mm 超长焦 · 平面化', },
];
export const LENS_OPTS = LENSES.map((x) => ({ v: x.f, l: x.l }));

const _up = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();
const _aimTmp = new THREE.Vector3();

export function quatLook(from, to, out = new THREE.Quaternion()) {
  _m4.lookAt(from, to, _up);
  return out.setFromRotationMatrix(_m4);
}

const K = (t, pos, look = null, o = {}) => ({ t, pos, look, ...o });

// ---------------------------------------------------------------------------
// 运镜预设
// ---------------------------------------------------------------------------
export const MOVES = [
  {
    id: 'static', name: '固定机位', en: 'Static Tripod', desc: '脚架固定，靠画面内动作产生变化。适合对话 / 产品。',
    params: [{ k: 'breath', l: '呼吸微动', t: 'range', min: 0, max: 1, step: 0.05, def: 0.15 }],
    gen: (c) => [K(0, c.origin.clone()), K(1, c.origin.clone())],
  },
  {
    id: 'push', name: '推镜 Dolly In', en: 'Dolly In', desc: '机身沿光轴匀速靠近，注意力收紧到主体。',
    params: [
      { k: 'dist', l: '推进距离 m', t: 'range', min: 0.4, max: 60, step: 0.2, def: 5 },
      { k: 'elev', l: '途中高度变化 m', t: 'range', min: -6, max: 6, step: 0.1, def: 0 },
      { k: 'aim', l: '始终对准焦点', t: 'bool', def: true },
    ],
    gen: (c) => {
      const lim = c.p.aim === false ? Infinity : c.hd * 0.7;      // 锁焦点时不许穿过焦点（穿过 = 一帧翻面）
      const travel = -Math.min(Math.max(0, c.p.dist), lim);
      const ow = c.originW, vh = c.viewH;
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const w = new THREE.Vector3(ow.x + vh.x * travel * t, ow.y + c.p.elev * t, ow.z + vh.z * travel * t);
        const pos = c.toLocal(w);
        return K(t, pos, c.p.aim ? c.focusPoint(pos) : null);
      });
    },
  },
  {
    id: 'pull', name: '拉镜 Dolly Out', en: 'Dolly Out', desc: '后退并揭示环境，结尾 / 反转常用。',
    params: [
      { k: 'dist', l: '拉远距离 m', t: 'range', min: 0.4, max: 80, step: 0.2, def: 8 },
      { k: 'elev', l: '途中爬升 m', t: 'range', min: -6, max: 14, step: 0.1, def: 1.2 },
      { k: 'aim', l: '始终对准焦点', t: 'bool', def: true },
    ],
    gen: (c) => {
      const travel = Math.max(0, c.p.dist);
      const ow = c.originW, vh = c.viewH;
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const w = new THREE.Vector3(ow.x - vh.x * travel * t, ow.y + c.p.elev * t, ow.z - vh.z * travel * t);
        const pos = c.toLocal(w);
        return K(t, pos, c.p.aim ? c.focusPoint(pos) : null);
      });
    },
  },
  {
    id: 'truck', name: '横移 Truck', en: 'Truck / Tracking', desc: '轨道平行横移，橱窗、立面、街道的展示手法。',
    params: [
      { k: 'dist', l: '横移距离 m', t: 'range', min: 0.5, max: 120, step: 0.5, def: 12 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: -1, l: '向左' }, { v: 1, l: '向右' }], def: 1 },
      { k: 'elev', l: '爬升 m', t: 'range', min: -8, max: 10, step: 0.1, def: 0 },
      { k: 'aim', l: '始终对准焦点', t: 'bool', def: true },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const pos = c.origin.clone().add(new THREE.Vector3((t - 0.5) * c.p.dist * c.p.dir, c.p.elev * t, 0));
      return K(t, pos, c.p.aim ? c.focusPoint(pos) : null);
    }),
  },
  {
    id: 'pedestal', name: '升降 Crane', en: 'Crane Up / Down', desc: '垂直起落，揭示体量或俯瞰全场。',
    params: [
      { k: 'dist', l: '升降距离 m', t: 'range', min: 0.4, max: 200, step: 0.5, def: 16 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: 1, l: '上升' }, { v: -1, l: '下降' }], def: 1 },
      { k: 'pitch', l: '同步俯仰 °', t: 'range', min: -70, max: 70, step: 1, def: -20 },
      { k: 'aim', l: '对准焦点(优先)', t: 'bool', def: true },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const pos = c.origin.clone().add(new THREE.Vector3(0, c.p.dist * c.p.dir * t, 0));
      if (c.p.aim) return K(t, pos, c.focusPoint(pos));
      return K(t, pos, null, { pitch: rad(c.p.pitch) * t });
    }),
  },
  {
    id: 'pan', name: '摇镜 Pan', en: 'Pan', desc: '机位不动水平旋转，扫视环境 / 跟随视线。',
    params: [
      { k: 'deg', l: '摇摄角度 °', t: 'range', min: 5, max: 320, step: 1, def: 70 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: -1, l: '先左后右' }, { v: 1, l: '先右后左' }], def: 1 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      return K(t, c.origin.clone(), null, { yaw: rad(-c.p.deg / 2 + c.p.deg * t) * c.p.dir });
    }),
  },
  {
    id: 'tilt', name: '俯仰 Tilt', en: 'Tilt', desc: '沿立面向上摇，强调建筑高度或人物气场。',
    params: [
      { k: 'deg', l: '俯仰角度 °', t: 'range', min: 5, max: 160, step: 1, def: 55 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: 1, l: '上摇' }, { v: -1, l: '下摇' }], def: 1 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      return K(t, c.origin.clone(), null, { pitch: rad(-c.p.deg / 2 + c.p.deg * t) * c.p.dir });
    }),
  },
  {
    id: 'orbit', name: '环绕 Orbit', en: 'Arc / Orbit', desc: '绕主体弧形环绕，360° 展示建筑或人物。',
    params: [
      { k: 'deg', l: '环绕角度 °', t: 'range', min: 10, max: 720, step: 5, def: 120 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: 1, l: '顺时针' }, { v: -1, l: '逆时针' }], def: 1 },
      { k: 'height', l: '高度变化 m', t: 'range', min: -30, max: 34, step: 0.5, def: 2.5 },
      { k: 'radius', l: '半径覆盖 m (0=自动)', t: 'range', min: 0, max: 200, step: 1, def: 0 },
    ],
    gen: (c) => {
      const fw = c.focusW, ow = c.originW;
      const r0 = c.p.radius > 0 ? c.p.radius : Math.max(1.2, Math.hypot(ow.x - fw.x, ow.z - fw.z));
      const a0 = Math.atan2(ow.x - fw.x, ow.z - fw.z);
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const a = a0 + rad(c.p.deg * t) * c.p.dir;
        const w = new THREE.Vector3(fw.x + Math.sin(a) * r0, ow.y + c.p.height * t, fw.z + Math.cos(a) * r0);
        return K(t, c.toLocal(w), c.focus.clone());
      });
    },
  },
  {
    id: 'orbitPush', name: '环绕推进 Arc+Push', en: 'Orbit Push-in', desc: '边绕边收，紧张感递进的经典组合。',
    params: [
      { k: 'deg', l: '环绕角度 °', t: 'range', min: 10, max: 360, step: 5, def: 70 },
      { k: 'dist', l: '同时推进 m', t: 'range', min: 0, max: 60, step: 0.5, def: 6 },
      { k: 'dir', l: '方向', t: 'sel', opts: [{ v: 1, l: '顺时针' }, { v: -1, l: '逆时针' }], def: 1 },
    ],
    gen: (c) => {
      const fw = c.focusW, ow = c.originW;
      const r0 = Math.max(1.5, Math.hypot(ow.x - fw.x, ow.z - fw.z));
      const a0 = Math.atan2(ow.x - fw.x, ow.z - fw.z);
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const a = a0 + rad(c.p.deg * t) * c.p.dir;
        const r = Math.max(0.6, r0 - c.p.dist * t);
        const w = new THREE.Vector3(fw.x + Math.sin(a) * r, ow.y + (r0 - r) * 0.12 + r * 0.02 * Math.sin(t * Math.PI), fw.z + Math.cos(a) * r);
        return K(t, c.toLocal(w), c.focus.clone());
      });
    },
  },
  {
    id: 'dollyZoom', name: '希区柯克变焦', en: 'Dolly Zoom / Vertigo', desc: '推镜 + 反向变焦，背景被压缩或拉开，心理冲击极强。',
    params: [
      { k: 'dist', l: '推进距离 m', t: 'range', min: 1, max: 40, step: 0.5, def: 6 },
      { k: 'dir', l: '组合', t: 'sel', opts: [{ v: 1, l: '推近 + 视角变广' }, { v: -1, l: '拉远 + 视角变窄' }], def: 1 },
      { k: 'fov0', l: '起始水平视角 °', t: 'range', min: 8, max: 120, step: 1, def: 40 },
      { k: 'fov1', l: '结束水平视角 °', t: 'range', min: 8, max: 120, step: 1, def: 72 },
    ],
    gen: (c) => {
      const ow = c.originW, fw = c.focusW;
      const dx = fw.x - ow.x, dz = fw.z - ow.z;
      const hd = Math.max(1.2, Math.hypot(dx, dz));
      const ux = dx / hd, uz = dz / hd;
      const travel = Math.min(Math.max(0.4, c.p.dist), hd * 0.7) * c.p.dir;   // 不许越过主体
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const w = new THREE.Vector3(ow.x + ux * travel * t, ow.y + travel * t * 0.06, ow.z + uz * travel * t);
        return K(t, c.toLocal(w), c.focus.clone(), { fov: c.p.fov0 + (c.p.fov1 - c.p.fov0) * t });
      });
    },
  },
  {
    id: 'follow', name: '背后跟拍 Follow', en: 'Tracking Follow', desc: '锁定主体等距跟随，配合人物运动路径使用。',
    follow: true,
    params: [
      { k: 'back', l: '身后距离 m', t: 'range', min: 0.8, max: 40, step: 0.5, def: 4.5 },
      { k: 'high', l: '机位高度 m', t: 'range', min: 0.3, max: 10, step: 0.1, def: 1.5 },
      { k: 'side', l: '侧向偏移 m', t: 'range', min: -10, max: 10, step: 0.1, def: 0.8 },
      { k: 'push', l: '逐渐靠近 m', t: 'range', min: 0, max: 12, step: 0.2, def: 0.6 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      return K(t, new THREE.Vector3(c.p.side, c.p.high, c.p.back - c.p.push * t), new THREE.Vector3(0, 1.2, 0));
    }),
  },
  {
    id: 'lead', name: '迎面跟拍 Lead', en: 'Frontal Tracking', desc: '倒退着面向主体拍摄，看清表情与全身动作。',
    follow: true,
    params: [
      { k: 'back', l: '身前距离 m', t: 'range', min: 0.8, max: 40, step: 0.5, def: 4.5 },
      { k: 'high', l: '机位高度 m', t: 'range', min: 0.3, max: 10, step: 0.1, def: 1.4 },
      { k: 'swing', l: '左右摆幅 m', t: 'range', min: 0, max: 6, step: 0.1, def: 0.6 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      return K(t, new THREE.Vector3(Math.sin(t * Math.PI * 2) * c.p.swing, c.p.high, -c.p.back), new THREE.Vector3(0, 1.2, 0));
    }),
  },
  {
    id: 'reveal', name: '升镜揭示 Reveal', en: 'Crane Reveal', desc: '从遮挡物后升起并下压，展开大场景。',
    params: [
      { k: 'dist', l: '升起高度 m', t: 'range', min: 2, max: 240, step: 1, def: 26 },
      { k: 'fwd', l: '同时前进 m', t: 'range', min: 0, max: 60, step: 1, def: 6 },
      { k: 'pitch', l: '收镜俯角 °', t: 'range', min: -75, max: 10, step: 1, def: -24 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const tt = 1 - Math.pow(1 - t, 2);
      const pos = c.origin.clone().add(new THREE.Vector3(0, c.p.dist * tt, -c.p.fwd * t));
      return K(t, pos, null, { pitch: rad(c.p.pitch) * tt });
    }),
  },
  {
    id: 'topdown', name: '俯拍下降 Bird', en: 'Top-down Descent', desc: '正俯瞰缓缓降落，图形化的空间交代。',
    params: [
      { k: 'height', l: '起始高度 m', t: 'range', min: 8, max: 400, step: 2, def: 70 },
      { k: 'end', l: '结束高度 m', t: 'range', min: 2, max: 200, step: 1, def: 16 },
      { k: 'spin', l: '同时旋转 °', t: 'range', min: -270, max: 270, step: 5, def: -25 },
    ],
    gen: (c) => {
      const f = new THREE.Vector3(c.focus.x, 0, c.focus.z);
      const d = Math.max(3, c.origin.distanceTo(f) * 0.3);
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const y = c.p.height + (c.p.end - c.p.height) * t;
        const a = rad(c.p.spin * t);
        const pos = new THREE.Vector3(f.x + Math.sin(a) * d, y, f.z + Math.cos(a) * d);
        return K(t, pos, new THREE.Vector3(f.x, y * 0.05, f.z));
      });
    },
  },
  {
    id: 'hero', name: '低角度英雄镜', en: 'Low-Angle Hero Push', desc: '仰拍 + 缓推，让人物或建筑显得压迫性高大。',
    params: [
      { k: 'dist', l: '推进 m', t: 'range', min: 0.5, max: 30, step: 0.5, def: 4 },
      { k: 'low', l: '机位高度 m', t: 'range', min: 0.12, max: 3, step: 0.04, def: 0.5 },
      { k: 'arc', l: '侧向弧线 m', t: 'range', min: -12, max: 12, step: 0.5, def: 1.5 },
    ],
    gen: (c) => {
      const f = c.focus.clone();
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const pos = c.origin.clone().lerp(f, t * 0.5);
        pos.y = c.origin.y + (c.p.low - c.origin.y) * Math.min(1, t * 2.2);
        pos.x += Math.sin(t * Math.PI) * c.p.arc;
        return K(t, pos, new THREE.Vector3(f.x, f.y + 0.8, f.z));
      });
    },
  },
  {
    id: 'dutch', name: '荷兰角 Dutch', en: 'Dutch Angle', desc: '滚转倾斜构图，制造不安与失衡感。',
    params: [
      { k: 'angle', l: '倾斜角度 °', t: 'range', min: -45, max: 45, step: 1, def: 14 },
      { k: 'dist', l: '同时推进 m', t: 'range', min: 0, max: 30, step: 0.5, def: 2.5 },
      { k: 'hold', l: '倾斜保持比例', t: 'range', min: 0.1, max: 1, step: 0.05, def: 0.7 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const h = clamp(t / c.p.hold, 0, 1);
      const pos = c.origin.clone().add(new THREE.Vector3(0, 0, -c.p.dist * t));
      return K(t, pos, c.focusPoint(pos), { roll: rad(c.p.angle) * h });
    }),
  },
  {
    id: 'whip', name: '甩镜 Whip Pan', en: 'Whip Pan', desc: '快速横甩做转场，中段速度最高、两端定格。',
    params: [
      { k: 'deg', l: '甩镜角度 °', t: 'range', min: 30, max: 240, step: 5, def: 120 },
      { k: 'mid', l: '甩动中心位置', t: 'range', min: 0.15, max: 0.85, step: 0.05, def: 0.45 },
      { k: 'pre', l: '起幅预摇 °', t: 'range', min: -40, max: 40, step: 1, def: -6 },
    ],
    gen: (c) => {
      const mid = c.p.mid, A = c.p.deg, pre = c.p.pre;
      const prof = (t) => (t < mid
        ? (1 - Math.pow(2, -10 * (t / Math.max(1e-6, mid)))) * mid
        : mid + (1 - Math.pow(2, -10 * ((t - mid) / Math.max(1e-6, 1 - mid)))) * (1 - mid));
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        return K(t, c.origin.clone(), null, { yaw: rad(pre + A * prof(t)) });
      });
    },
  },
  {
    id: 'handheld', name: '手持跟移 Handheld', en: 'Handheld', desc: '肩扛晃动 + 缓慢游移，纪实临场感。',
    params: [
      { k: 'dist', l: '缓慢推进 m', t: 'range', min: 0, max: 30, step: 0.5, def: 3 },
      { k: 'shake', l: '晃动强度', t: 'range', min: 0, max: 2.5, step: 0.05, def: 1 },
      { k: 'drift', l: '构图漂移 m', t: 'range', min: 0, max: 4, step: 0.05, def: 0.6 },
      { k: 'aim', l: '对准焦点', t: 'bool', def: true },
    ],
    handheld: (p) => p.shake * 0.0075,   // 肩扛幅度：0.016 在 30fps 下已经像「抖成一团」，这里按真实肩扛量级收一半
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const ow = c.originW, vh = c.viewH;
      const travel = -Math.min(Math.max(0, c.p.dist), c.p.aim === false ? Infinity : c.hd * 0.7) * t;
      const w = new THREE.Vector3(ow.x + vh.x * travel + vh.z * Math.sin(t * Math.PI * 1.7) * c.p.drift * 0.4,
        ow.y + Math.sin(t * Math.PI * 2.3) * c.p.drift * 0.2,
        ow.z + vh.z * travel - vh.x * Math.sin(t * Math.PI * 1.7) * c.p.drift * 0.4);
      const pos = c.toLocal(w);
      return K(t, pos, c.p.aim ? c.focusPoint(pos) : null);
    }),
  },
  {
    id: 'fpv', name: 'FPV 穿越机', en: 'FPV Drone', desc: 'S 形穿行 + 侧倾翻滚，俯冲穿过建筑间隙。',
    params: [
      { k: 'dist', l: '前进距离 m', t: 'range', min: 6, max: 300, step: 2, def: 60 },
      { k: 'swing', l: '摆动幅度 m', t: 'range', min: 0, max: 60, step: 1, def: 12 },
      { k: 'dip', l: '俯冲深度 m', t: 'range', min: -40, max: 40, step: 1, def: -8 },
      { k: 'roll', l: '侧倾翻滚 °', t: 'range', min: -180, max: 180, step: 10, def: 30 },
    ],
    handheld: () => 0.004,
    gen: (c) => {
      const dir = c.dir.clone().normalize();
      const right = new THREE.Vector3().crossVectors(dir, _up).normalize();
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const pos = c.origin.clone()
          .addScaledVector(dir, c.p.dist * t)
          .addScaledVector(right, Math.sin(t * Math.PI * 2) * c.p.swing)
          .add(new THREE.Vector3(0, c.p.dip * Math.sin(t * Math.PI) + t * 1.2, 0));
        const ahead = pos.clone().addScaledVector(dir, 8).addScaledVector(right, Math.sin(t * Math.PI * 2 + 1.1) * c.p.swing * 0.9);
        return K(t, pos, ahead, { roll: rad(c.p.roll) * Math.sin(t * Math.PI * 2) * 0.7 });
      });
    },
  },
  {
    id: 'bullet', name: '子弹时间 Bullet', en: 'Bullet Time', desc: '主体定格、镜头快速环绕的高光时刻。',
    params: [
      { k: 'deg', l: '环绕角度 °', t: 'range', min: 40, max: 720, step: 10, def: 200 },
      { k: 'radius', l: '半径 m', t: 'range', min: 0.8, max: 60, step: 0.5, def: 6 },
      { k: 'high', l: '机位高度 m', t: 'range', min: 0.3, max: 10, step: 0.1, def: 1.6 },
    ],
    gen: (c) => {
      const fw = c.focusW, ow = c.originW;
      const a0 = Math.atan2(ow.x - fw.x, ow.z - fw.z);
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const a = a0 + rad(c.p.deg) * t;
        const w = new THREE.Vector3(fw.x + Math.sin(a) * c.p.radius, c.p.high + Math.sin(t * Math.PI) * c.p.radius * 0.12, fw.z + Math.cos(a) * c.p.radius);
        return K(t, c.toLocal(w), c.focus.clone());
      });
    },
  },
  {
    id: 'pushPull', name: '呼吸往复 Loop', en: 'Breathing Loop', desc: '往复微推，让静态画面“活起来”，可无缝循环。',
    loopable: true,
    params: [{ k: 'dist', l: '往复距离 m', t: 'range', min: 0.2, max: 16, step: 0.1, def: 1.2 }],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const pos = c.origin.clone().add(new THREE.Vector3(0, 0, -c.p.dist * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))));
      return K(t, pos, c.focusPoint(pos));
    }),
  },
  {
    id: 'facade', name: '立面摇镜建筑', en: 'Facade Tilt Reveal', desc: '贴地起摇沿立面扫到楼顶，建筑表现常用。',
    params: [
      { k: 'dist', l: '同时后退 m', t: 'range', min: 0, max: 60, step: 1, def: 6 },
      { k: 'low', l: '起始高度 m', t: 'range', min: 0.2, max: 8, step: 0.1, def: 0.7 },
      { k: 'up', l: '结束高度 m', t: 'range', min: 2, max: 160, step: 1, def: 26 },
    ],
    gen: (c) => {
      const f = c.focus.clone();
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const pos = c.origin.clone().add(new THREE.Vector3(0, 0, c.p.dist * t));
        pos.y = c.p.low + (c.p.up - c.p.low) * t;
        return K(t, pos, new THREE.Vector3(f.x, c.p.low + (c.p.up + 6 - c.p.low) * t, f.z));
      });
    },
  },
  {
    id: 'craneOver', name: '越顶长镜头', en: 'Crane Over', desc: '升到楼顶高度掠过屋顶，纵深感拉满。',
    params: [
      { k: 'dist', l: '前进 m', t: 'range', min: 4, max: 300, step: 2, def: 40 },
      { k: 'height', l: '升起 m', t: 'range', min: 2, max: 240, step: 2, def: 34 },
    ],
    gen: (c) => {
      const dir = c.dir.clone().normalize();
      return Array.from({ length: c.n }, (_, i) => {
        const t = i / (c.n - 1);
        const e = t * t * (3 - 2 * t);
        const pos = c.origin.clone().addScaledVector(dir, c.p.dist * t);
        pos.y = c.origin.y + c.p.height * e;
        const look = pos.clone().addScaledVector(dir, 12).add(new THREE.Vector3(0, -c.p.height * 0.45 * e, 0));
        return K(t, pos, look);
      });
    },
  },
  {
    id: 'snorricam', name: '蜗牛镜 Snorricam', en: 'Snorricam', desc: '锁死在主体身上：人物不动、世界在转。',
    follow: true, lockRig: true,
    params: [
      { k: 'dist', l: '前距 m', t: 'range', min: 0.6, max: 6, step: 0.1, def: 1.9 },
      { k: 'high', l: '高度 m', t: 'range', min: 0.6, max: 3, step: 0.05, def: 1.35 },
      { k: 'orbit', l: '绕主体旋转 °', t: 'range', min: -180, max: 180, step: 5, def: 55 },
    ],
    gen: (c) => Array.from({ length: c.n }, (_, i) => {
      const t = i / (c.n - 1);
      const a = rad(c.p.orbit * t);
      return K(t, new THREE.Vector3(Math.sin(a) * c.p.dist, c.p.high, Math.cos(a) * c.p.dist), new THREE.Vector3(0, 1.35, 0));
    }),
  },
];

export const MOVE_BY_ID = Object.fromEntries(MOVES.map((m) => [m.id, m]));
export const MOVE_OPTS = [{ v: '', l: '— 不使用预设（手工关键帧）—' }, ...MOVES.map((m) => ({ v: m.id, l: m.name }))];

// ---------------------------------------------------------------------------
// Shot：一个机位（可含多关键帧运镜路径）
// ---------------------------------------------------------------------------
function evalShake(pts, u) {
  // 抖动强度曲线：0..1 输入 → 倍数（中心 0.5 = 1×）
  let y = u;
  if (pts && pts.length > 1) {
    let i = 0;
    while (i < pts.length - 2 && u > pts[i + 1].x) i++;
    const a = pts[i], b = pts[i + 1];
    const t = clamp((u - a.x) / Math.max(1e-6, b.x - a.x), 0, 1);
    y = a.y + (b.y - a.y) * t;
  }
  return clamp(y * 2, 0, 3);
}

export const SHOT_COLORS = ['#7fd6ff', '#8ee6b0', '#c9a3ff', '#ffb0a3', '#a9d6ff', '#ffe08a', '#9be6d0', '#e0a3ff'];
export const ACTIVE_COLOR = '#ffb547';
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}
let shotSeq = 0;
function nextCameraName(app) {
  const used = new Set((app?.shots || []).map(s => {
    const m = (s.name || '').match(/^Camera\s+(\d+)$/);
    return m ? parseInt(m[1], 10) : -1;
  }).filter(n => n > 0));
  let n = 1;
  while (used.has(n)) n++;
  return `Camera ${String(n).padStart(2, '0')}`;
}
export class Shot {
  constructor(app, opts = {}) {
    this.app = app;
    this.id = opts.id || uid('shot');
    this.name = opts.name || nextCameraName(app);
    this.model = opts.model || 'alexa35';
    this.sensor = opts.sensor || 'ff';
    this.focal = opts.focal ?? 35;
    this.focusDist = opts.focusDist ?? 8;
    this.aperture = opts.aperture ?? 2.8;
    this.iso = opts.iso ?? 400;
    this.dofEnabled = opts.dofEnabled ?? false;
    this.nearClip = opts.nearClip ?? 0.04;
    this.farClip = opts.farClip ?? 5000;
    this.aim = opts.aim || 'keys';
    this.follow = !!opts.follow;
    this.lockRig = !!opts.lockRig;
    this.targetId = opts.targetId || null;
    this.handheld = opts.handheld ?? 0;
    this.spinCap = opts.spinCap === undefined ? null : opts.spinCap;   // 最大角速度 °/s；null=240，0=关闭
    this.groundClear = opts.groundClear !== false;        // 自动避地：路径钻到地形/地面以下时把机位托起来
    this.clearance = opts.clearance ?? null;               // 最低离地高度（m）；null = 1.35
    this.easing = opts.easing || 'linear';   // 线性 = 沿路径匀速且关键帧精确落在自己的时间上；要起手/收尾慢用曲线或 inOut
    // 运动质量：整段缓动 + 弧长匀速 + 朝向样条（解决到关键帧就停顿）
    const mo = { ...DEFAULT_MOTION, ease: this.easing, ...(opts.motion || {}) };
    this.motionScope = mo.scope; this.arcSpeed = mo.arc !== false;
    this.tension = mo.tension ?? 0.5; this.rotMode = mo.rot;
    this.duration = opts.duration ?? 6;
    this.move = opts.move || '';
    this.moveParams = opts.moveParams || {};
    this.nKeys = opts.nKeys || 9;
    this.closed = !!opts.closed;
    this.selKey = -1;
    this.showPath = true;
    this.showFrustum = !!opts.showFrustum; // 用户控制的视锥显示开关

    this.rig = new THREE.Group();
    this.rig.name = 'shotRig';
    this.cam = new THREE.PerspectiveCamera(50, 16 / 9, this.nearClip, this.farClip);
    this.rig.add(this.cam);
    if (opts.pos) { if (Array.isArray(opts.pos)) this.rig.position.fromArray(opts.pos); else this.rig.position.copy(opts.pos); }
    if (opts.quat) { if (Array.isArray(opts.quat)) this.rig.quaternion.fromArray(opts.quat); else this.rig.quaternion.copy(opts.quat); }

    this.anchor = new THREE.Object3D();
    this.rig.add(this.anchor);
    this.markers = new THREE.Group();
    this.rig.add(this.markers);
    this.body = this._makeBody();
    this.rig.add(this.body);
    this.helper = new THREE.CameraHelper(this.cam);
    this.helper.visible = false;
    this.helper.scale.setScalar(0.02);
    this.helper.traverse((o) => { o.userData.pickIgnore = true; });
    // 添加到场景而非 rig，避免 rig 变换影响视锥显示位置
    if (this.app?.stage?.scene) this.app.stage.scene.add(this.helper);
    this.transformAxes = new THREE.AxesHelper(2);
    this.transformAxes.visible = false;
    this.transformAxes.traverse((o) => { o.userData.pickIgnore = true; });
    this.rig.add(this.transformAxes);
    this.pathLine = null;
    this.mover = new Mover(opts.keys || [], this.closed, this.moverOpts());
    this.curves = { prog: normalizePts(opts.curves?.prog), shake: normalizePts(opts.curves?.shake) };
    this.rig.userData.shotRef = this;
    this.body.userData.shotRef = this;
    this.colorIdx = opts.colorIdx ?? 0;
    this.label = this._makeLabel();
    this.rig.add(this.label);
    this.syncAnchor();
    this.refreshGizmos();
    this.refreshColors();
  }

  // --- 身份标识（颜色 + 视口名牌）：一眼看出「现在预览的是哪台机器」 -----------
  get colorHex() {
    if (this.app?.activeShot === this) return ACTIVE_COLOR;
    let i = this.colorIdx;
    if (i == null || i < 0) { const k = this.app?.shots?.indexOf(this); if (k >= 0) i = k; }
    return SHOT_COLORS[(i || 0) % SHOT_COLORS.length] || '#7fd6ff';
  }
  refreshColors() {
    const hex = this.colorHex;
    const c = new THREE.Color(hex);
    if (this.pathLine) this.pathLine.material.color.copy(c);
    this.markers.children.forEach((m, i) => {
      const ball = m.children?.[0], arrow = m.children?.[1];
      const on = i === this.selKey;
      if (ball?.material?.color) ball.material.color.set(on ? 0xffb547 : c.getHex());
      if (arrow?.material?.color) arrow.material.color.set(on ? 0xffd79a : c.clone().offsetHSL(0, -0.1, 0.12).getHex());
    });
    const kids = this.body.children;
    if (kids[2]?.material) kids[2].material.color.copy(c);
    if (kids[3]?.material) kids[3].material.color.copy(c);
    if (this.label) this.label.material.opacity = this.app?.activeShot === this ? 1 : 0.8;
    this.drawLabel(true); // 身份色变化必须立刻上屏，不能交给拖拽用的节流
  }
  /** 按观察距离缩放，远处也读得清（近似恒定屏幕高度） */
  fitLabel(camPos) {
    const l = this.label;
    if (!l || !l.visible || !camPos) return;
    if (!this._lp) this._lp = new THREE.Vector3();
    l.getWorldPosition(this._lp);
    const k = clamp(camPos.distanceTo(this._lp) * 0.03, 0.85, 5);
    if (Math.abs(k - (this._labelK || 0)) > 0.02) {
      this._labelK = k;
      l.scale.set(2.5 * k, 0.63 * k, 1);
    }
  }
  _makeLabel() {
    const cv = document.createElement('canvas');
    cv.width = 384; cv.height = 96;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.position.set(0, 0.78, 0);
    sp.scale.set(2.5, 0.63, 1);
    sp.renderOrder = 715;
    sp.userData.pickIgnore = true;
    sp.userData.cv = cv;
    sp.userData.tex = tex;
    return sp;
  }
  drawLabel(force = false) {
    const sp = this.label;
    const cv = sp?.userData?.cv;
    if (!cv) return;
    const now = performance.now();
    if (!force && this._lblT && now - this._lblT < 90) return;
    this._lblT = now;
    const idx = this.app ? this.app.shots.indexOf(this) + 1 : 0;
    const hex = this.colorHex;
    const active = this.app?.activeShot === this;
    const move = this.move && MOVE_BY_ID[this.move] ? MOVE_BY_ID[this.move].name : (this.mover?.count ? `自定义 ${this.mover.count}K` : '固定');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = active ? 'rgba(30,22,8,0.86)' : 'rgba(10,13,18,0.76)';
    roundRect(g, 4, 4, cv.width - 8, cv.height - 8, 14); g.fill();
    g.strokeStyle = hex; g.lineWidth = active ? 4 : 2.5;
    roundRect(g, 4, 4, cv.width - 8, cv.height - 8, 14); g.stroke();
    g.fillStyle = hex; g.fillRect(20, cv.height / 2 - 8, 14, 14);
    g.textBaseline = 'middle';
    g.font = '600 30px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.fillStyle = '#eaf1f8';
    g.fillText(`${idx ? idx + ' · ' : ''}${this.name}`, 46, 34);
    g.font = '400 20px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    g.fillStyle = 'rgba(198,212,228,0.8)';
    g.fillText(`${move}｜${Math.round(this.focal)}mm`, 46, 68);
    if (active) {
      const live = !!this.app?.state?.preview;
      g.font = '600 20px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      g.fillStyle = live ? '#ffcf8a' : 'rgba(198,212,228,0.7)'; g.textAlign = 'right';
      g.fillText(live ? '● 预览中' : '○ 当前机位', cv.width - 22, 34);
      g.textAlign = 'left';
    }
    sp.userData.tex.needsUpdate = true;
  }
  dispose() {
    this.rig.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (!m) continue; m.map?.dispose?.(); m.dispose?.(); }
    });
    // 从场景移除 helper
    if (this.helper?.parent) this.helper.parent.remove(this.helper);
    this.helper?.geometry?.dispose?.();
  }

  _makeBody() {
    const g = new THREE.Group();
    const mk = (geo, color) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: true }));
    const shell = mk(new THREE.BoxGeometry(0.36, 0.28, 0.52), 0x35475a);
    shell.position.set(0, 0.05, 0.08);
    const lens = mk(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 24), 0x53718c);
    lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.05, -0.26);
    const mag = mk(new THREE.BoxGeometry(0.22, 0.07, 0.32), 0x44607a);
    mag.position.set(0, 0.24, 0.14);
    const handle = mk(new THREE.TorusGeometry(0.09, 0.018, 6, 14), 0x44607a);
    handle.position.set(0, 0.33, 0.14); handle.rotation.x = Math.PI / 2;
    g.add(shell, lens, mag, handle);
    g.userData.pickIgnore = false;
    return g;
  }

  get target() { return this.targetId ? this.app.byId(this.targetId) : null; }
  setTarget(so) { this.targetId = so ? so.id : null; }
  get keys() { return this.mover.keys; }

  sensorInfo() { return SENSORS.find((x) => x.v === this.sensor) || SENSORS[0]; }
  hFov() { const s = this.sensorInfo(); return 2 * Math.atan((s.sw * s.squeeze) / 2 / this.focal); }
  /** 输出画幅比例 → three 需要的垂直 FOV（锁定水平视角） */
  vFovFor(aspect, hfovOverride = null) {
    const h = hfovOverride != null ? rad(hfovOverride) : this.hFov();
    return deg(2 * Math.atan(Math.tan(h / 2) / Math.max(0.25, aspect)));
  }
  focalFromHfov(hfovDeg) { const s = this.sensorInfo(); return (s.sw * s.squeeze) / 2 / Math.tan(rad(hfovDeg) / 2); }

  // --- 运动质量 / 曲线 ------------------------------------------------------
  moverOpts(extra = {}) {
    return { ease: this.easing, scope: this.motionScope, arc: this.arcSpeed, tension: this.tension, rot: this.rotMode, progCurve: this.curves?.prog || null, ...extra };
  }
  setMotionOpt(k, v) {
    if (k === 'ease') this.easing = v;
    else if (k === 'scope') this.motionScope = v;
    else if (k === 'arc') this.arcSpeed = !!v;
    else if (k === 'tension') this.tension = clamp(v, 0, 1);
    else if (k === 'rot') this.rotMode = v;
    this.mover.opts = { ...this.mover.opts, ...this.moverOpts() };
    this.mover.rebuild();
    this.markDirty();
  }
  setCurve(channel, pts) {
    this.curves[channel] = pts ? normalizePts(clonePts(pts)) : null;
    if (channel === 'prog') { this.mover.opts = { ...this.mover.opts, ...this.moverOpts() }; }
    this.markDirty();
  }
  applyCurvePreset(id) {
    const c = CURVE_BY_ID[id];
    if (!c) return false;
    this.setCurve('prog', c.pts.map((p) => ({ ...p })));
    return true;
  }
  /**
   * 速度体检（有效速度，含缓动/曲线）。
   * min≈max≈1 且 keyJump≈0 = 流畅不顿；keyJump 大 = 过关键帧有明显加减速（停顿感）。
   */
  motionDiag(samples = 48, mode = 'effective') {
    const opts = { ...this.moverOpts() };
    if (mode === 'geometric') { opts.progCurve = null; opts.scope = 'segment'; opts.ease = 'linear'; }
    const prof = this.mover.velocityProfile(samples, opts, mode !== 'geometric');
    const vs = prof.map((x) => x.v);
    const avg = vs.reduce((a, b) => a + b, 0) / Math.max(1, vs.length);
    const atKey = [];
    const interior = this.mover.keys.slice(1, -1);
    for (const k of (interior.length ? interior : this.mover.keys)) {
      const i = clamp(Math.round(k.u ?? k.t * samples), 0, samples);
      atKey.push(vs[i]);
    }
    const a = avg > 1e-9 ? avg : 1;
    const ends = Math.min(vs[0], vs[vs.length - 1]) / a;
    // atKey：关键帧处的「最差」速度相对值，≈1 表示过节点不减速；<0.5 表示有明显停顿
    return {
      avg, min: Math.min(...vs) / a, max: Math.max(...vs) / a,
      atKey: atKey.length ? Math.min(...atKey) / a : 1,
      atKeySpeeds: atKey, atEnds: ends, samples: vs, profile: prof,
      // 过节点掉速：关键帧处速度相对其左右半格处速度的跌幅（0 = 不掉速；≈1 = 到点就停）
      keyDip: this._keyDip ? this._keyDip(vs, samples) : 0,
      geometric: mode === 'geometric' ? null : (() => { const d = this.motionDiag(samples, 'geometric'); return { min: +d.min.toFixed(3), max: +d.max.toFixed(3) }; })(),
    };
  }

  /** 每个内部关键帧：帧处速度相对左右半格基线的跌幅，取最差值 */
  _keyDip(vs, samples) {
    const idx = this.mover.keys.map((k) => clamp(Math.round(k.t * samples), 0, samples));
    let dip = 0;
    for (let i = 1; i < idx.length - 1; i++) {
      const k = idx[i];
      const m0 = vs[clamp(Math.round((idx[i - 1] + k) / 2), 0, samples)];
      const m1 = vs[clamp(Math.round((k + idx[i + 1]) / 2), 0, samples)];
      const base = Math.max(1e-6, (m0 + m1) * 0.5);   // 左右半格的中点速度做基线：匀加速时不该被判成停顿
      dip = Math.max(dip, 1 - clamp(vs[k] / base, 0, 1.2));
    }
    return dip;
  }

  /** 「真匀速」：按路径弧长重排关键帧时间（关键帧位置不变，时间轴刻度会移动） */
  retimeKeysByArc() {
    const r = this.mover.retimeByArc();
    if (!r) return null;
    this._rebuildPathLine?.();
    this.refreshGizmos?.();
    this.markDirty();
    return r;
  }

  // --- 关键帧 ---------------------------------------------------------------
  bakeKeys(raw) {
    const keys = raw.map((r) => {
      let q;
      if (r.quat) q = r.quat.isQuaternion ? r.quat.clone() : new THREE.Quaternion().fromArray(r.quat);
      else if (r.look) q = quatLook(r.pos, r.look, new THREE.Quaternion());
      else q = new THREE.Quaternion();
      const e = new THREE.Euler(r.pitch || 0, r.yaw || 0, r.roll || 0, 'YXZ');
      if (r.pitch || r.yaw || r.roll) q.multiply(new THREE.Quaternion().setFromEuler(e));
      if (!r.look && !r.quat && !r.pitch && !r.yaw && !r.roll) q = null;
      return { t: r.t, p: [r.pos.x, r.pos.y, r.pos.z], q: q ? [q.x, q.y, q.z, q.w] : null, f: r.fov ?? null };
    });
    this.mover = new Mover(keys, this.closed, this.moverOpts());
    this.syncAnchor();
    this.refreshGizmos();
  }

  generateMove(id) {
    const move = MOVE_BY_ID[id];
    this.move = id || '';
    if (!move) { this.mover.clear(); this.follow = false; this.refreshGizmos(); this.markDirty(); return; }
    const p = {};
    for (const f of move.params) p[f.k] = this.moveParams[f.k] ?? f.def;
    const known = new Set(move.params.map((f) => f.k));
    const junk = Object.keys(this.moveParams || {}).filter((k) => !known.has(k));
    if (junk.length) console.warn(`[previz] 运镜「${id}」不认识的参数被忽略：${junk.join(' / ')}（可用：${[...known].join(' / ')}）`);
    this.moveParams = p;
    this.rig.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rig.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const tgt = this.target;
    let focus;
    const invRig = this.rig.matrixWorld.clone().invert();
    let focusW;
    if (tgt) {
      const wp = tgt.root.getWorldPosition(new THREE.Vector3());
      const bb = new THREE.Box3().setFromObject(tgt.root);
      if (!bb.isEmpty()) wp.y = (bb.min.y + bb.max.y) / 2;
      focusW = wp.clone();
      focus = wp.applyMatrix4(invRig);
      if (move.follow) focus = new THREE.Vector3(0, 1.2, 0);
    } else {
      focusW = dir.clone().multiplyScalar(this.focusDist).add(this.rig.position);
      focus = focusW.clone().applyMatrix4(invRig);
    }
    if (focus.distanceTo(new THREE.Vector3()) < 0.3) focus.set(0, 1.2, -this.focusDist);
    const ctx = {
      p, n: Math.max(2, Math.round(this.nKeys)), origin: new THREE.Vector3(0, 0, 0), focus, dir,
      focusPoint: (pos) => (move.follow ? new THREE.Vector3(0, 1.2, 0) : focus.clone()),
      // 世界坐标助手：环绕/推拉这类「绕水平圈、沿水平线走」的运镜必须在世界里算，
      // 否则机位倾斜时整个圆会被俯仰角带歪（镜头钻进地里 / 一帧翻 180°）
      originW: this.rig.getWorldPosition(new THREE.Vector3()), focusW: (focusW || this.rig.getWorldPosition(new THREE.Vector3())).clone(),
      toLocal: (v) => v.applyMatrix4(invRig),
    };
    {
      // 水平前推用的方向与「到焦点的水平距离」：推/拉/手持都按世界水平面走，机位俯仰不会把镜头带进地里
      const vh = new THREE.Vector3(dir.x, 0, dir.z);
      if (vh.lengthSq() < 1e-6) vh.set(0, 0, -1);
      ctx.viewH = vh.normalize();
      ctx.hd = Math.max(0.6, Math.hypot(ctx.focusW.x - ctx.originW.x, ctx.focusW.z - ctx.originW.z));
    }
    this.bakeKeys(move.gen(ctx));
    this.follow = !!move.follow;
    this.lockRig = !!move.lockRig;
    this.handheld = move.handheld ? move.handheld(p) : 0;
    this.markDirty();
    return move;
  }

  /** 记录某时刻的关键帧（默认取当前视口视角） */
  addKeyAt(u, src) {
    this.rig.updateMatrixWorld(true);
    const cam = src || this.app.stage.view;
    const inv = this.rig.matrixWorld.clone().invert();
    const m = new THREE.Matrix4().multiplyMatrices(inv, cam.matrixWorld);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.mover.addKey({ t: clamp(u, 0, 1), p: [pos.x, pos.y, pos.z], q: [q.x, q.y, q.z, q.w], f: null });
    this.syncAnchor();
    this.refreshGizmos();
    this.markDirty();
  }
  setKeyPose(i, posArr, quatArr) {
    const k = this.mover.keys[i];
    if (!k) return;
    k.p = posArr;
    if (quatArr) k.q = quatArr;
    this.mover.rebuild();
  }
  removeKeyAt(i) { this.mover.removeKey(i); this.syncAnchor(); this.refreshGizmos(); this.markDirty(); }
  selectKey(i) { this.selKey = i; this.refreshGizmos(); }
  markDirty() { this.drawLabel(); this.app?.bus?.emit('shot-change', this); }

  refreshGizmos() {
    const g = this.markers;
    for (const c of [...g.children]) { c.traverse?.((o) => o.geometry?.dispose?.()); g.remove(c); }
    this.mover.keys.forEach((k, i) => {
      const m = this._makeMarker(i);
      m.position.fromArray(k.p);
      if (k.q) m.quaternion.fromArray(k.q);
      g.add(m);
    });
    this._rebuildPathLine();
    this.refreshColors();
  }
  _makeMarker(i) {
    const grp = new THREE.Group();
    const sel = i === this.selKey;
    const s = new THREE.Mesh(new THREE.SphereGeometry(sel ? 0.2 : 0.14, 20, 14),
      new THREE.MeshBasicMaterial({ color: sel ? 0xffb547 : 0x7fd6ff, depthTest: false, transparent: true, opacity: 0.95 }));
    s.renderOrder = 700;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.44, 16),
      new THREE.MeshBasicMaterial({ color: sel ? 0xffd79a : 0xa9e6ff, depthTest: false, transparent: true, opacity: 0.92 }));
    arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.34; arrow.renderOrder = 700;
    grp.add(s, arrow);
    const ref = { shot: this, i };
    grp.userData.keyRef = ref; s.userData.keyRef = ref; arrow.userData.keyRef = ref;
    return grp;
  }
  _rebuildPathLine() {
    if (this.pathLine) { this.rig.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine.material.dispose(); this.pathLine = null; }
    if (this.mover.count < 2) return;
    const pts = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= 180; i++) {
      const t = i / 180;
      if (this.mover.curve) this.mover.curve.getPoint(t, tmp);
      else tmp.fromArray(this.mover.keys[Math.min(this.mover.count - 1, Math.round(t * (this.mover.count - 1)))].p);
      pts.push(tmp.clone());
    }
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.85, depthTest: false })
    );
    this.pathLine.renderOrder = 690;
    this.pathLine.userData.pickIgnore = true;
    this.rig.add(this.pathLine);
  }
  setActivePath(on) {
    this.refreshColors();
  }

  /** 主体的「稳定锚点」：胸高位置；高度缓存 1.5s，而不是每帧重算包围盒（走路摆腿会让包围盒高度抖） */
  targetAnchor(out) {
    const t = this.target;
    const v = out || new THREE.Vector3();
    if (!t || !t.root) return v.set(0, 1.2, 0);
    t.root.getWorldPosition(v);
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (!this._aimHAt || now - this._aimHAt > 1500 || !Number.isFinite(this._aimH)) {
      const bb = new THREE.Box3().setFromObject(t.root);
      this._aimH = bb.isEmpty() ? 1.2 : Math.max(0.5, Math.min(2.4, (bb.max.y - bb.min.y) * 0.58));
      this._aimHAt = now;
    }
    if (!this.lockRig) v.y += this._aimH;
    return v;
  }
  /** 一阶低通：跟拍位移与注视点都过一遍，把贴地/手持的高频颠动压成呼吸感 */
  /** 只低通高度：x/z 保持跟随（快速主体不能拖尾），y 抹平（走路起伏 / 地形贴地带来的颠） */
  _damp(key, want, tau) {
    const dt = clamp(this._dt || 1 / 30, 1 / 240, 0.25);
    const cur = this[key] || (this[key] = want.clone());
    cur.x = want.x; cur.z = want.z;
    if (Math.abs(cur.y - want.y) < 2e-3) cur.y = want.y;              // 到位锁死，别留 0.1mm 尾巴（星空/高光会跟着跳）
    else cur.y += (want.y - cur.y) * (1 - Math.exp(-dt / Math.max(0.01, tau)));
    return cur;
  }

  /** 采样 u∈[0,1] 得到世界位姿 */
  samplePose(u) {
    this.rig.updateMatrixWorld(true);
    const scratch = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
    if (this.mover.count) this.mover.sample(clamp(u, 0, 1), scratch, this.easing, this.moverOpts());
    const rigQ = this.rig.getWorldQuaternion(new THREE.Quaternion());
    const rigM = this.rig.matrixWorld;
    let wp, wq;
    if (this.follow && this.target) {
      let tw = this.targetAnchor(_aimTmp);
      if (this._followTag !== this.targetId) { this._followTag = this.targetId; this._followPt = null; }
      if (!this.lockRig) tw = this._damp('_followPt', tw, 0.1);
      if (this.lockRig) {
        const m = new THREE.Matrix4().compose(tw, this.target.root.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
        wp = scratch.p.clone().applyMatrix4(m);
        wq = this.target.root.getWorldQuaternion(new THREE.Quaternion()).multiply(scratch.q);
      } else {
        wp = scratch.p.clone().applyQuaternion(rigQ).add(tw);
        wq = rigQ.clone().multiply(scratch.q);
      }
    } else {
      // 无关键帧时直接使用 rig 的世界变换
      if (this.mover.count) {
        wp = scratch.p.clone().applyMatrix4(rigM);
        wq = rigQ.clone().multiply(scratch.q);
      } else {
        wp = this.rig.getWorldPosition(new THREE.Vector3());
        wq = rigQ.clone();
      }
    }
    return { p: wp, q: wq, f: scratch.f };
  }

  /** 应用到真实相机（预览 / 导出共用） */
  applyTo(cam, u, timeSec, aspect, effAspect = 0) {
    // 帧间隔给阻尼用；时间不回退（暂停/拖动时不强行收敛）
    this._dt = (timeSec == null || this._lastT == null) ? 1 / 30 : clamp(Math.abs(timeSec - this._lastT), 1 / 240, 0.25);
    this._lastT = timeSec == null ? this._lastT : timeSec;
    const s = this.samplePose(u);
    cam.position.copy(s.p);
    // 自动避地：路径钻进地形/地面时把机位托起来（低通接入，不跳）
    const tr = this.app && this.app.terrain;
    const st = this.app && this.app.stage;
    const hasFloor = !!(tr && tr.enabled) || !!(st && st.ground && st.ground.visible);
    if (this.groundClear !== false && hasFloor) {
      const gy = (tr && tr.enabled) ? tr.heightAt(cam.position.x, cam.position.z) : 0;
      const need = gy + (this.clearance == null ? 1.6 : this.clearance);
      const dt = clamp(this._dt || 1 / 30, 1 / 240, 0.25);
      if (this._clrY == null) this._clrY = need;
      else if (Math.abs(need - this._clrY) < 2e-3) this._clrY = need;
      else this._clrY += (need - this._clrY) * (1 - Math.exp(-dt / 0.22));
      const kk = 0.55;                                                // soft-max：贴着地表飞也不会出现折角
      cam.position.y = Math.max(cam.position.y, this._clrY) + kk * Math.log1p(Math.exp(-Math.abs(cam.position.y - this._clrY) / kk));
    } else {
      this._clrY = null;
    }
    cam.quaternion.copy(s.q);
    // 跟拍 / 迎面跟拍：机位朝向的关键帧是刚体局部朝向，主体沿路径走远了就会跑出画面 → 一律锁到主体锚点
    const keepFramed = (this.aim === 'target' || ((this.move === 'follow' || this.move === 'lead') && this.target)) && !this.lockRig;
    if (keepFramed && this.target) {
      const tw = this._damp('_aimPt', this.targetAnchor(_aimTmp), 0.14);
      cam.up.set(0, 1, 0);
      cam.lookAt(tw);
    } else {
      this._aimPt = null;
    }
    // 自动更新焦点距离：当有对焦主体时，实时计算相机与主体的距离
    if (this.dofEnabled && this.targetId && this.app?.objects) {
      const targetObj = this.app.objects.find(o => o.uuid === this.targetId);
      if (targetObj) {
        this.focusDist = cam.position.distanceTo(targetObj.position);
      }
    }
    // effAspect：取景框在画布中的「有效比例」。预览时画布≠画幅，需要按黑边位置换算，
    // 保证框内画面与导出一致（宽画幅=横向铺满、纵向多看到一点；竖屏=纵向铺满、横向收进画幅）。
    const ea = effAspect > 0 ? effAspect : aspect;
    cam.fov = this.vFovFor(ea, s.f);
    cam.aspect = aspect;
    cam.near = this.nearClip;
    cam.far = this.farClip;
    const shakeMul = this.curves?.shake ? clamp(evalShake(this.curves.shake, u), 0, 3) : 1;
    // 防甩断：任何单帧角速度超限都按上限重算（一帧翻 180° 之类的操作事故一律抹平）
    if (this.spinCap !== 0) {
      const dt = clamp(this._dt || 1 / 30, 1 / 240, 0.25);
      const cap = rad(this.move === 'whip' ? 1500 : (this.spinCap || 240)) * dt;
      const q = cam.quaternion;
      if (this._qPrev && dt < 0.2) {
        const d = 2 * Math.acos(Math.min(1, Math.abs(q.dot(this._qPrev))));
        if (d > cap) q.slerpQuaternions(this._qPrev, q, cap / Math.max(1e-6, d));
      }
      this._qPrev = (this._qPrev || new THREE.Quaternion()).copy(q);
    } else {
      this._qPrev = null;
    }
    if (this.handheld > 0 && timeSec != null && shakeMul > 0.001) {
      // 手持感要慢：噪声频率原来是 ~5Hz，30fps 下看起来像「抖成一团」；这里约 1.2–2Hz 的身体晃动
      const k = this.handheld * shakeMul;
      const T = timeSec * 0.34;
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const u2 = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      cam.position.addScaledVector(r, smoothNoise(T * 5.1, 1) * k * 1.5).addScaledVector(u2, smoothNoise(T * 4.3, 2) * k * 1.2);
      const fScale = clamp((this.focal || 35) / 35, 0.6, 2.2);
      cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        smoothNoise(T * 6.7, 3) * k * 0.05 * fScale, smoothNoise(T * 3.1, 4) * k * 0.06 * fScale, smoothNoise(T * 2.2, 5) * k * 0.045 * fScale, 'YXZ')));
    }
    cam.updateProjectionMatrix();
    return cam;
  }

  syncAnchor() {
    this._followPt = null; this._aimPt = null; this._aimHAt = 0; this._clrY = null; this._qPrev = null;
    const keys = this.mover.keys;
    if (!keys.length) this.anchor.position.set(0, 0, 0);
    else {
      const c = new THREE.Vector3();
      for (const k of keys) c.add(new THREE.Vector3().fromArray(k.p));
      this.anchor.position.copy(c.multiplyScalar(1 / keys.length));
    }
    this._prevAnchor = this.anchor.position.clone();
    this._prevAnchorQ = this.anchor.quaternion.clone();
  }
  applyAnchorDelta() {
    const d = this.anchor.position.clone().sub(this._prevAnchor);
    const dq = this.anchor.quaternion.clone().multiply(this._prevAnchorQ.clone().invert());
    const rot = Math.abs(dq.w - 1) > 1e-7;
    if (d.lengthSq() > 1e-9 || rot) {
      for (const k of this.mover.keys) {
        const v = new THREE.Vector3().fromArray(k.p).add(d);
        if (rot) v.applyQuaternion(dq);
        k.p = [v.x, v.y, v.z];
        if (k.q) {
          const q = new THREE.Quaternion().fromArray(k.q).premultiply(dq);
          k.q = [q.x, q.y, q.z, q.w];
        }
      }
      this.mover.rebuild();
      this.refreshGizmos();
      this.markDirty();
    }
    this._prevAnchor = this.anchor.position.clone();
    this._prevAnchorQ = this.anchor.quaternion.clone();
  }

  setVisible(v) {
    this.helper.visible = v;
    this.transformAxes.visible = v;
    this.body.visible = v;
    this.markers.visible = v;
    if (this.pathLine) this.pathLine.visible = v && this.showPath;
    if (this.label) this.label.visible = v;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, model: this.model, sensor: this.sensor, focal: this.focal,
      focusDist: this.focusDist, aperture: this.aperture, iso: this.iso, dofEnabled: this.dofEnabled,
      nearClip: this.nearClip, farClip: this.farClip,
      aim: this.aim, follow: this.follow, lockRig: this.lockRig,
      targetId: this.targetId, handheld: this.handheld, spinCap: this.spinCap, groundClear: this.groundClear !== false,
      clearance: this.clearance, easing: this.easing, duration: this.duration,
      move: this.move, moveParams: this.moveParams, nKeys: this.nKeys, closed: this.closed, selKey: this.selKey,
      showFrustum: this.showFrustum,
      pos: this.rig.position.toArray(), quat: this.rig.quaternion.toArray(), mover: this.mover.toJSON(),
      motion: { scope: this.motionScope, arc: this.arcSpeed, tension: this.tension, rot: this.rotMode },
      curves: { prog: this.curves?.prog || null, shake: this.curves?.shake || null },
    };
  }
  static fromJSON(app, j) {
    const s = new Shot(app, j);
    s.mover = new Mover(j.mover?.keys || [], !!j.mover?.closed, s.moverOpts(j.mover?.opts || {}));
    s.syncAnchor();
    s.refreshGizmos();
    return s;
  }
}
