// ---------------------------------------------------------------------------
// 示例场景：街区路口 + 人物走位 + 三个不同运镜机位（黄金时刻）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Mover } from './mover.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(V(...from), V(...to), new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function buildDemo(app) {
  app.clearAll();
  app.projectName = '示例 · 街区路口';
  const add = (cat, type, name, x, z, rot = 0, params = {}) => {
    const so = app.addAsset(`${cat}:${type}:${name}`, V(x, 0, z), { params });
    if (so && rot) so.root.rotation.y = rot;
    return so;
  };

  // 地面：两条路 + 斑马线 + 人行道
  add('env', 'road', '沥青路面', 0, 0, 0, { width: 15, length: 190 });
  add('env', 'road', '沥青路面', 0, 0, Math.PI / 2, { width: 13, length: 150 });
  add('env', 'road', '人行横道', 0, 13, 0, { width: 6, length: 13, kind: 'cross' });
  add('env', 'road', '人行横道', 0, -13, Math.PI / 2, { width: 6, length: 12, kind: 'cross' });
  for (const [x, z, r] of [[-13.4, 0, 0], [13.4, 0, 0]]) add('env', 'walk', '人行道', x, z, r, { width: 7, length: 190 });
  for (const [x, z, r] of [[0, -14.4, Math.PI / 2], [0, 14.4, Math.PI / 2]]) add('env', 'walk', '人行道', x, z, r, { width: 6, length: 150 });

  // 建筑
  const tA = add('building', 'tower', '玻璃幕墙写字楼', -34, -34, 0.1, { floors: 21, width: 20, depth: 18, podium: true, seed: 21, lit: 0.42 });
  add('building', 'tower', '玻璃幕墙写字楼', 34, -40, -0.2, { floors: 30, width: 17, depth: 17, seed: 8, lit: 0.35, crown: true });
  add('building', 'residential', '住宅板楼', 40, 34, -0.42, { floors: 13, length: 40, depth: 13, wall: '#b8ae9e' });
  add('building', 'shophouse', '沿街商铺', -40, 30, 0.24, { floors: 4, width: 24, depth: 11, signColor: '#ff3b6b' });
  add('building', 'shophouse', '沿街商铺', -40, 47, 0.24, { floors: 3, width: 22, depth: 11, signColor: '#37d6ff', awning: '#2f6d55' });
  add('building', 'house', '独栋住宅', 30, 4, 0.0, { width: 9, depth: 7.5 });
  add('building', 'cluster', '城市楼群', 0, -190, 0, { count: 16, gap: 34, min: 8, max: 44, seed: 11, lit: 0.3 });
  const entrance = add('building', 'colonnade', '柱廊门厅', -19, -20.5, 0.32, { cols: 6, spacing: 3.8, height: 6.6 });
  add('building', 'stairs', '大台阶', -19.5, -26.2, 0.32, { steps: 7, width: 11, rise: 0.19, run: 0.42, marble: true });
  add('building', 'billboard', '户外广告屏', 21, 26, -0.5, { width: 11, height: 6, leg: 7, bright: 1.4, seed: 7 });
  add('building', 'overpass', '高架立交', 96, 66, 0.55, { length: 150, width: 11, height: 8.5, span: 26 });

  // 环境细节
  for (const [x, z] of [[-10.5, -9], [-10.5, -2], [-10.5, 6], [-10.5, 22], [10.8, -16], [10.8, -6], [10.8, 8], [10.8, 20], [-22, 12], [24, -12]])
    add('env', 'tree', '行道树', x, z, 0, { height: 6 + (z % 3), kind: 'tall' });
  for (const [x, z] of [[-16.6, -12], [-16.6, 4], [-16.6, 18], [16.6, -18], [16.6, -2], [16.6, 14]])
    add('env', 'lamp', '路灯', x, z, x < 0 ? 0 : Math.PI, { height: 6.5, glow: 0.25 });
  add('env', 'bench', '长椅', -17, 10.5, Math.PI / 2);
  add('env', 'bench', '长椅', -17, 13, Math.PI / 2);
  add('env', 'fountain', '圆形喷泉', 0.5, 0.5, 0, { radius: 3.2 });
  add('env', 'sign', '路牌', 8.6, 9.4, -0.6, { kind: 'neon', width: 1.6, height: 3 });
  add('env', 'car', '轿车', -6, -13, 0.02, { color: '#dfe4e8', kind: 'sedan' });
  add('env', 'car', '轿车', 4.5, 13.2, Math.PI, { color: '#2f3a45', kind: 'suv', lights: true });
  const bus = add('env', 'bus', '公交车', -58, -6.2, 0, { color: '#c9a227' });
  add('env', 'cone', '交通锥', 12, 4); add('env', 'cone', '交通锥', 12.8, 2.4);
  add('env', 'barrier', '水马围挡', 14.5, -14, 0.4, { length: 6 });
  add('env', 'crate', '木箱', -20, -16); add('env', 'crate', '木箱', -21.2, -15.4);
  add('env', 'trash', '垃圾桶', -17.4, 8.6);

  // 人物：走位 + 动作
  const man = add('char', 'human', '男性', -14, 10, 0, { top: '#3d5a75', anim: 'walk' });
  app.setMotion(man, {
    active: true, anim: 'walk', autoFace: true, speed: 1, easing: 'linear', loop: true,
    keys: [{ t: 0, p: [-15.5, 0, 11.5] }, { t: 0.28, p: [-4, 0, 6.5] }, { t: 0.52, p: [3.5, 0, 0.5] }, { t: 0.78, p: [9, 0, -6] }, { t: 1, p: [17, 0, -12] }],
  });
  const woman = add('char', 'human', '女性', -17.6, -18.6, 0.9, { top: '#b6543f', hairStyle: 'long', anim: 'wave' });
  app.setMotion(woman, { active: false, anim: 'wave' });
  const kid = add('char', 'human', '儿童', 6, 9, 0, { top: '#e8b23a', anim: 'run' });
  app.setMotion(kid, {
    active: true, anim: 'run', speed: 1.15, easing: 'linear', loop: true,
    keys: [{ t: 0, p: [14, 0, 12] }, { t: 0.33, p: [16, 0, 2] }, { t: 0.66, p: [8, 0, -3] }, { t: 1, p: [14, 0, 12] }],
  });
  const worker = add('char', 'human', '施工人员', 13.2, 3.2, -2.2, { anim: 'point' });
  const suit = add('char', 'human', '西装商务', -21.4, -23.5, 1.1, { anim: 'phone' });
  const crowd = add('char', 'crowd', '人群', -6, 20, 0, { count: 14, radius: 7, anim: 'talk', speed: 1 });
  app.setMotion(crowd, { active: false, anim: 'talk', speed: 0.8 });
  const car2 = add('env', 'car', '轿车', -70, 6.2, 0, { color: '#8a2f2f' });
  app.setMotion(car2, {
    active: true, autoFace: true, faceOffset: -Math.PI / 2, easing: 'linear', loop: true,
    keys: [{ t: 0, p: [-72, 0, 6.2] }, { t: 0.5, p: [0, 0, 6.2] }, { t: 1, p: [72, 0, 6.2] }],
  });

  // 机位
  const s1 = app.addShot({ name: 'A · 推镜跟随', focal: 35, pos: [-16, 1.65, 20], quat: lookQuat([-16, 1.65, 20], [-2, 1.2, 4]), duration: 8 });
  s1.setTarget(man); s1.aim = 'target';
  s1.moveParams = { dist: 7, elev: 0.2, aim: true };
  s1.generateMove('push');
  s1.handheld = 0.004;

  const s2 = app.addShot({ name: 'B · 环绕建筑', focal: 24, pos: [-56, 9, -6], quat: lookQuat([-56, 9, -6], [-34, 34, -34]), duration: 10 });
  s2.setTarget(tA); s2.aim = 'target';
  s2.moveParams = { deg: 140, dir: 1, height: 16, radius: 46 };
  s2.generateMove('orbit');

  const s3 = app.addShot({ name: 'C · 升镜揭示', focal: 18, pos: [4, 0.9, 26], quat: lookQuat([4, 0.9, 26], [0, 14, -20]), duration: 9 });
  s3.moveParams = { dist: 46, fwd: 16, pitch: -20 };
  s3.generateMove('reveal');

  app.setActiveShot(s1);
  app.state.duration = 8;
  app.state.fps = 30;
  app.state.loop = true;
  app.lighting.applyPreset('golden');
  app.stage.view.position.set(-30, 20, 42);
  app.stage.orbit.target.set(0, 6, 0);
  app.stage.orbit.update();
  app.bus.emit('objects');
  app.bus.emit('shots');
  app.bus.emit('select');
  app.bus.emit('time');
  app.saveLocal();
}
