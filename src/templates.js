// ---------------------------------------------------------------------------
// 场景模板库（方案 A：模板槽位 → 调用模型库搭建 → 自动运镜）
// · 每个模板 = 固定的空间骨架 + 可复现的摆位 + 运动编排 + 自动机位（方案 C）
// · 全部物体来自模型库键（含补齐的 building/env/char 三组），不新增第四种来源
// · 一句话匹配：matchTemplate(prompt) → 模板；未命中走既有 generateTown
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { autoCamera } from './autocam.js';
import { makeRng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** 摆放模型库物体（缺失键返回 null，不抛错） */
function A(app, key, x, z, rot = 0, params) {
  const so = app.addAsset(key, V(x, 0, z), { params });
  if (so && rot) so.root.rotation.y = rot;
  return so;
}

/** 物体运动：keys = [[t, x, y, z], ...] */
function M(app, so, keys, extra = {}) {
  if (!so) return;
  app.setMotion(so, {
    active: true, autoFace: true, easing: 'linear', loop: true,
    keys: keys.map(([t, x, y, z]) => ({ t, p: [x, y, z] })),
    ...extra,
  });
}

/** 与 generateTown 相同的“一步撤销”装配模式 */
export function withScene(app, label, fn) {
  app._quietAdd = true;
  let out;
  try {
    app.batchOp(label, () => {
      app.clearAll();
      app.terrain?.setEnabled?.(false);        // 模板场景用平地：空间关系最干净
      out = fn();
    });
  } finally { app._quietAdd = false; }
  app.lighting?.applyGlow?.(app.lighting.p.glow);
  app.select(null);
  for (const ev of ['objects', 'select', 'terrain', 'shots', 'undoable']) app.bus.emit(ev);
  app.saveLocal?.();
  return out;
}

// ===========================================================================
// 模板 1 · 街区街口：十字路口 + 写字楼群，车流穿行、行人过街
// ===========================================================================
const street = {
  id: 'street',
  label: '街区街口',
  hint: '十字路口 · 沿街商铺与写字楼 · 车流 + 过街行人 · 四机位',
  re: /(路口|十字|街区|街口|街道|沿街|斑马线|闯过|穿行|crossroad)/i,
  build(app, { seed = 1, cameras = true } = {}) {
    return withScene(app, '模板 · 街区街口', () => {
      const rng = makeRng(seed * 7 + 13);
      // 路网走画笔道路：自动路口 + 斑马线，生成后可继续编辑
      app.roadBrush.restore([
        { points: [[0, 0, -95], [0, 0, 95]], roadType: 'asphalt', width: 15, fillet: false, name: '南北向街道', visible: true, locked: false },
        { points: [[-75, 0, 0], [75, 0, 0]], roadType: 'asphalt', width: 13, fillet: false, name: '东西向街道', visible: true, locked: false },
      ]);
      // 人行道在路口处断开（横路带 z±8、干道带 x±9），不再整条横穿另一条路
      for (const [x, zc] of [[-13.4, -51.5], [13.4, -51.5], [-13.4, 51.5], [13.4, 51.5]])
        A(app, 'env:walk:人行道', x, zc, 0, { width: 7, length: 87 });
      for (const [xc, z] of [[-42, -14.4], [42, -14.4], [-42, 14.4], [42, 14.4]])
        A(app, 'env:walk:人行道', xc, z, Math.PI / 2, { width: 6, length: 66 });

      // 城市建筑（塔楼层数随种子随机，天际线每次不同）
      const hero = A(app, 'building:tower:玻璃幕墙写字楼', -34, -34, 0.1, { floors: 14 + Math.floor(rng() * 16), width: 20, depth: 18, podium: true, seed: 21, lit: 0.42 });
      A(app, 'building:tower:玻璃幕墙写字楼', 34, -40, -0.2, { floors: 20 + Math.floor(rng() * 16), width: 17, depth: 17, seed: 8, lit: 0.35, crown: true });
      A(app, 'building:residential:住宅板楼', 40, 34, -0.42, { floors: 13, length: 40, depth: 13, wall: '#b8ae9e' });
      A(app, 'building:shophouse:沿街商铺', -40, 30, 0.24, { floors: 4, width: 24, depth: 11, signColor: '#ff3b6b' });
      A(app, 'building:shophouse:沿街商铺', -40, 47, 0.24, { floors: 3, width: 22, depth: 11, signColor: '#37d6ff', awning: '#2f6d55' });
      A(app, 'building:house:独栋住宅', 30, 4, 0, { width: 9, depth: 7.5 });
      A(app, 'building:billboard:户外广告屏', 21, 26, -0.5, { width: 11, height: 6, leg: 7, bright: 1.4, seed: 7 });
      A(app, 'building:colonnade:柱廊门厅', -19, -20.5, 0.32, { cols: 6, spacing: 3.8, height: 6.6 });
      A(app, 'building:stairs:大台阶', -19.5, -26.2, 0.32, { steps: 7, width: 11, rise: 0.19, run: 0.42, marble: true });

      // 环境道具
      for (const [x, z] of [[-10.5, -9], [-10.5, -2], [-10.5, 6], [-10.5, 22], [10.8, -16], [10.8, -6], [10.8, 8], [10.8, 20], [-22, 12], [24, -12]])
        A(app, 'env:tree:行道树', x, z, 0, { height: 6 + Math.abs(z % 3), kind: 'tall' });
      for (const [x, z] of [[-16.6, -12], [-16.6, 4], [-16.6, 18], [16.6, -18], [16.6, -2], [16.6, 14]])
        A(app, 'env:lamp:路灯', x, z, x < 0 ? 0 : Math.PI, { height: 6.5, glow: 0.25 });
      A(app, 'env:bench:长椅', -17, 10.5, Math.PI / 2);
      A(app, 'env:bench:长椅', -17, 13, Math.PI / 2);
      A(app, 'env:sign:路牌', 8.6, 9.4, -0.6, { kind: 'neon', width: 1.6, height: 3 });
      A(app, 'env:cone:交通锥', 12, 4); A(app, 'env:cone:交通锥', 12.8, 2.4);
      A(app, 'env:barrier:水马围挡', 14.5, -14, 0.4, { length: 6 });
      A(app, 'env:crate:木箱', -20, -16); A(app, 'env:crate:木箱', -21.2, -15.4);
      A(app, 'env:trash:垃圾桶', -17.4, 8.6);

      // 车流（东西向双车道 + 公交）
      const carE = A(app, 'env:car:轿车', -70, 3.4, Math.PI / 2, { color: '#dfe4e8', kind: 'sedan', lights: true });
      M(app, carE, [[0, -72, 0, 3.4], [0.5, 0, 0, 3.4], [1, 72, 0, 3.4]], { faceOffset: -Math.PI / 2 });
      const carW = A(app, 'env:car:轿车', 60, -3.4, -Math.PI / 2, { color: '#2f3a45', kind: 'suv', lights: true });
      M(app, carW, [[0, 72, 0, -3.4], [1, -72, 0, -3.4]], { faceOffset: -Math.PI / 2 });
      const bus = A(app, 'env:bus:公交车', -58, 6.2, Math.PI / 2, { color: '#c9a227' });
      M(app, bus, [[0, -72, 0, 6.2], [1, 72, 0, 6.2]], { speed: 0.8, faceOffset: -Math.PI / 2 });

      // 人物
      const man = A(app, 'char:human:男性', -14, 10, 0, { top: '#3d5a75', anim: 'walk' });
      M(app, man, [[0, -15.5, 0, 11.5], [0.28, -4, 0, 6.5], [0.52, 3.5, 0, 0.5], [0.78, 9, 0, -6], [1, 17, 0, -12]]);
      A(app, 'char:human:女性', -17.6, -18.6, 0.9, { top: '#b6543f', hairStyle: 'long', anim: 'wave' });
      const kid = A(app, 'char:human:儿童', 6, 9, 0, { top: '#e8b23a', anim: 'run' });
      M(app, kid, [[0, 14, 0, 12], [0.33, 16, 0, 2], [0.66, 8, 0, -3], [1, 14, 0, 12]]);
      A(app, 'char:human:施工人员', 13.2, 3.2, -2.2, { anim: 'point' });
      A(app, 'char:human:西装商务', -21.4, -23.5, 1.1, { anim: 'phone' });
      const crowd = A(app, 'char:crowd:人群', -6, 20, 0, { count: 14, radius: 7, anim: 'talk', seed: (seed % 40) + 1 });
      if (crowd) app.setMotion(crowd, { active: false, anim: 'talk', speed: 0.8 });

      // 自动运镜（C）：hero = 最高楼，跟拍东行轿车
      const shots = cameras ? autoCamera(app, { hero, moving: carE }) : [];
      return { objects: app.objects.length, shots: app.shots.length, auto: shots.length, motions: app.objects.filter((o) => o.motion?.active).length };
    });
  },
};

// ===========================================================================
// 模板 2 · 城市广场：喷泉为中心，柱廊为背景，人群聚集
// ===========================================================================
const plaza = {
  id: 'plaza',
  label: '城市广场',
  hint: '喷泉中心 · 柱廊大台阶背景 · 人群与行人 · 升降/环绕机位',
  re: /(广场|喷泉|集会|中心广场|plaza)/i,
  build(app, { seed = 1, cameras = true } = {}) {
    return withScene(app, '模板 · 城市广场', () => {
      const rng = makeRng(seed * 13 + 5);
      const fountain = A(app, 'env:fountain:圆形喷泉', 0, 0, 0, { radius: 3.4 });
      for (const [x, z, r] of [[-7, 5.5, Math.PI / 2], [7, 5.5, Math.PI / 2], [-7, -5.5, Math.PI / 2], [7, -5.5, Math.PI / 2]])
        A(app, 'env:bench:长椅', x, z, r);
      for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -15], [0, 15]])
        A(app, 'env:tree:行道树', x, z, 0, { height: 7, kind: 'round' });
      for (const [x, z] of [[-14, 0], [14, 0], [0, 14], [0, -14]])
        A(app, 'env:lamp:路灯', x, z, 0, { height: 6.5, glow: 0.3 });
      A(app, 'building:colonnade:柱廊门厅', 0, -24, 0, { cols: 8, spacing: 3.8, height: 7 });
      A(app, 'building:stairs:大台阶', 0, -15.5, 0, { steps: 8, width: 13, rise: 0.19, run: 0.42, marble: true });
      A(app, 'building:tower:玻璃幕墙写字楼', -30, -38, 0.14, { floors: 12 + Math.floor(rng() * 16), podium: true, lit: 0.4, seed: 5 });
      A(app, 'building:tower:玻璃幕墙写字楼', 30, -40, -0.16, { floors: 18 + Math.floor(rng() * 16), crown: true, lit: 0.35, seed: 12 });
      A(app, 'building:residential:住宅板楼', 36, 30, -0.4, { floors: 12, length: 36, wall: '#c9bfae' });
      A(app, 'building:shophouse:沿街商铺', -36, 26, 0.5, { floors: 3, width: 22, signColor: '#ffb830' });
      A(app, 'building:billboard:户外广告屏', 18, -18, -0.9, { width: 10, height: 5.5, leg: 6, bright: 1.2, seed: (seed % 30) + 1 });
      A(app, 'env:sign:路牌', 10, 10, 0.4, { kind: 'neon' });
      A(app, 'env:trash:垃圾桶', -9, 9);

      const crowd = A(app, 'char:crowd:人群', -4, 8, 0, { count: 12, radius: 5, anim: 'talk', seed: (seed % 40) + 2 });
      if (crowd) app.setMotion(crowd, { active: false, anim: 'talk', speed: 0.8 });
      A(app, 'char:human:西装商务', 5, 6, 2.2, { anim: 'phone' });
      A(app, 'char:human:女性', -6, -6, 1, { hairStyle: 'long' });
      A(app, 'char:human:施工人员', 10, -4, -1.5, { anim: 'point' });

      const shots = cameras ? autoCamera(app, { hero: fountain, moving: null }) : [];
      return { objects: app.objects.length, shots: app.shots.length, auto: shots.length, motions: app.objects.filter((o) => o.motion?.active).length };
    });
  },
};

// ===========================================================================
// 模板 3 · 林荫大道：长街 + 行道树列 + 双向车流 + 沿街商铺
// ===========================================================================
const boulevard = {
  id: 'boulevard',
  label: '林荫大道',
  hint: '长街纵深 · 行道树列 · 双向车流与公交 · 跟拍机位',
  re: /(林荫|大道|长街|滨河|带状|boulevard|林荫道)/i,
  build(app, { seed = 1, cameras = true } = {}) {
    return withScene(app, '模板 · 林荫大道', () => {
      const rng = makeRng(seed * 17 + 3);
      A(app, 'env:road:沥青路面', 0, 0, 0, { width: 16, length: 260 });
      A(app, 'env:walk:人行道', -10.5, 0, 0, { width: 6, length: 260 });
      A(app, 'env:walk:人行道', 10.5, 0, 0, { width: 6, length: 260 });
      // 行道树 + 路灯双列
      for (let z = -108; z <= 108; z += 18) {
        A(app, 'env:tree:行道树', -11, z, 0, { height: 6.5 + Math.abs((z / 18) % 3), kind: 'tall' });
        A(app, 'env:tree:行道树', 11, z + 9, 0, { height: 6 + Math.abs((z / 18) % 2), kind: 'tall' });
      }
      for (let z = -96; z <= 96; z += 32) {
        A(app, 'env:lamp:路灯', -13.4, z, 0, { height: 6.5, glow: 0.25 });
        A(app, 'env:lamp:路灯', 13.4, z + 16, Math.PI, { height: 6.5, glow: 0.25 });
      }
      // 沿街商铺（面向马路）与对侧住宅
      const signs = ['#ff3b6b', '#37d6ff', '#ffb830', '#7bd64a', '#c56bff'];
      for (let i = 0; i < 5; i++) {
        A(app, 'building:shophouse:沿街商铺', 26, -72 + i * 26, -Math.PI / 2,
          { floors: 2 + (i % 3), width: 20 + (i % 2) * 4, depth: 11, signColor: signs[i], awning: i % 2 ? '#2f6d55' : '' });
      }
      for (let i = 0; i < 4; i++) {
        A(app, 'building:house:独栋住宅', -27, -54 + i * 30, Math.PI / 2, { width: 9, depth: 8 });
      }
      const hero = A(app, 'building:tower:玻璃幕墙写字楼', 34, -105, -0.1, { floors: 14 + Math.floor(rng() * 16), podium: true, lit: 0.4, seed: 9 });
      A(app, 'building:tower:玻璃幕墙写字楼', -34, 100, 0.12, { floors: 10 + Math.floor(rng() * 14), crown: true, lit: 0.3, seed: 15 });
      A(app, 'building:billboard:户外广告屏', 18, 60, -Math.PI / 2, { width: 11, height: 6, leg: 7, bright: 1.3, seed: (seed % 30) + 3 });
      A(app, 'env:sign:路牌', 9.6, 24, Math.PI / 2, { kind: 'plain' });

      // 双向车流 + 公交
      const sedan = A(app, 'env:car:轿车', -110, 4, Math.PI / 2, { color: '#dfe4e8', kind: 'sedan', lights: true });
      M(app, sedan, [[0, -118, 0, 4], [1, 118, 0, 4]], { faceOffset: -Math.PI / 2 });
      const suv = A(app, 'env:car:轿车', 100, -4, -Math.PI / 2, { color: '#2f3a45', kind: 'suv' });
      M(app, suv, [[0, 118, 0, -4], [1, -118, 0, -4]], { faceOffset: -Math.PI / 2 });
      const bus = A(app, 'env:bus:公交车', -90, 6.8, Math.PI / 2, { color: '#c9a227' });
      M(app, bus, [[0, -120, 0, 6.8], [1, 60, 0, 6.8]], { speed: 0.75, faceOffset: -Math.PI / 2 });

      // 行人沿人行道走 + 路口人群
      const walker = A(app, 'char:human:男性', 11, -40, 0, { anim: 'walk' });
      M(app, walker, [[0, 11, 0, -42], [1, 11, 0, 46]]);
      const crowd = A(app, 'char:crowd:人群', 17, 34, 0, { count: 8, radius: 4, anim: 'talk', seed: (seed % 40) + 3 });
      if (crowd) app.setMotion(crowd, { active: false, anim: 'talk', speed: 0.8 });

      const shots = cameras ? autoCamera(app, { hero, moving: sedan }) : [];
      return { objects: app.objects.length, shots: app.shots.length, auto: shots.length, motions: app.objects.filter((o) => o.motion?.active).length };
    });
  },
};

export const TEMPLATES = [street, plaza, boulevard];

/** 按一句话匹配模板（大小写不敏感；未命中返回 null） */
export function matchTemplate(text = '') {
  const s = String(text);
  return TEMPLATES.find((t) => t.re.test(s)) || null;
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}
