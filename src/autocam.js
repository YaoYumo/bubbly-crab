// ---------------------------------------------------------------------------
// 自动运镜（方案 C：离线程序化生成，不依赖任何网络/API）
// 输入 = 当前场景的物体与运动；输出 = 一套有叙事顺序的机位：
//   A 大远景交代 → B 环绕主体 → C 跟拍运动（无运动则横移展示）→ D 推镜收尾
// 构图规则（保证“运镜清晰准确”）：
//   · 主体始终 setTarget 到 Shot（orbit/follow/push 的焦点自动跟随）
//   · 机位距离按焦距+主体包围盒反推（留 1.35× 余量，主体全画幅）
//   · 机位高度 ≥1.5m，Shot 自带 groundClear 防钻地
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(V(...from), V(...to), V(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** 可取景物体：有独立几何的场景对象（道路/路口补丁/贴地片不参与主体评选） */
function pickables(app) {
  return (app.objects || []).filter((o) =>
    o.root && !o.decal && !o.pad && o.type !== 'road_intersection' && o.type !== 'road_brush');
}

function boxOf(so) {
  const bb = new THREE.Box3().setFromObject(so.root);
  return bb.isEmpty() ? null : bb;
}

/** 主体：包围盒对角线最大的物体（模板/调用方可显式指定） */
export function heroSubject(app) {
  let best = null, bestD = 0;
  for (const so of pickables(app)) {
    const bb = boxOf(so); if (!bb) continue;
    const d = bb.getSize(new THREE.Vector3()).length();
    if (d > bestD) { bestD = d; best = so; }
  }
  return best;
}

/** 运动主体：第一个带激活运动路径的物体 */
export function movingSubject(app) {
  return pickables(app).find((o) => o.motion?.active && (o.motion.keys?.length || 0) > 1) || null;
}

/** 焦距 → 装配距离（水平 36mm 画幅，16:9 输出） */
function fitDistance(size, focal, aspect = 16 / 9) {
  const hfov = 2 * Math.atan(18 / Math.max(8, focal));
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
  const dV = (size.y / 2) / Math.tan(vfov / 2);
  const dH = (Math.max(size.x, size.z) / 2) / Math.tan(hfov / 2);
  return Math.max(dV, dH) * 1.35 + 4;
}

/**
 * 为当前场景自动生成一套机位。
 * @param {object} app
 * @param {{hero?:object, moving?:object, prefix?:string}} [opts]
 * @returns {Array} 新建的 Shot 列表
 */
export function autoCamera(app, opts = {}) {
  const objs = pickables(app);
  if (!objs.length) return [];

  // 场景包围（水平半径 + 高度跨度）
  const sceneBB = new THREE.Box3();
  for (const so of objs) { const bb = boxOf(so); if (bb) sceneBB.union(bb); }
  const c = sceneBB.getCenter(new THREE.Vector3());
  const size = sceneBB.getSize(new THREE.Vector3());
  const r = Math.max(10, Math.hypot(size.x, size.z) / 2);

  const hero = opts.hero || heroSubject(app);
  const moving = opts.moving !== undefined ? opts.moving : movingSubject(app);
  const heroBB = hero ? boxOf(hero) : null;
  const heroC = heroBB ? heroBB.getCenter(new THREE.Vector3()) : c.clone();
  const pre = opts.prefix || '';

  const shots = [];
  const track = (o) => { shots.push(o); return o; };

  // ---- A · 大远景交代：斜高位全景 + 缓降 ----
  {
    const d = r * 1.55;
    const from = [c.x + d * 0.72, Math.max(9, r * 0.62), c.z + d * 0.72];
    const look = [c.x, Math.max(1.5, size.y * 0.25), c.z];
    const s = app.addShot({
      name: `${pre}A · 全景交代`, focal: 20, pos: from, quat: lookQuat(from, look),
      duration: 7, focusDist: Math.hypot(from[0] - look[0], from[2] - look[2]),
    });
    if (s) { s.moveParams = {}; s.generateMove('pedestal'); track(s); }
  }

  // ---- B · 环绕主体：绕 hero 120° ----
  if (hero && heroBB) {
    const d = fitDistance(heroBB.getSize(new THREE.Vector3()), 30);
    const from = [heroC.x + d * 0.82, Math.max(2, heroC.y + size.y * 0.12), heroC.z + d * 0.5];
    const s = app.addShot({
      name: `${pre}B · 环绕主体`, focal: 30, pos: from, quat: lookQuat(from, [heroC.x, heroC.y, heroC.z]),
      duration: 10, focusDist: d,
    });
    if (s) { s.setTarget(hero); s.moveParams = { deg: 120, dir: 1, height: 2.5 }; s.generateMove('orbit'); track(s); }
  }

  // ---- C · 跟拍运动（有运动主体）；否则沿场景横移 ----
  if (moving) {
    const mb = boxOf(moving);
    const mc = mb ? mb.getCenter(new THREE.Vector3()) : c.clone();
    const from = [mc.x - 9, Math.max(2.2, (mb ? mb.max.y : 2) + 0.6), mc.z + 5];
    const s = app.addShot({
      name: `${pre}C · 跟拍运动`, focal: 40, pos: from, quat: lookQuat(from, [mc.x, mc.y, mc.z]),
      duration: 8, focusDist: 10,
    });
    if (s) { s.setTarget(moving); s.moveParams = {}; s.generateMove('follow'); track(s); }
  } else {
    const from = [c.x - r * 0.55, Math.max(2.5, size.y * 0.4), c.z + r * 1.05];
    const s = app.addShot({
      name: `${pre}C · 街景横移`, focal: 32, pos: from, quat: lookQuat(from, [c.x, Math.max(1.6, size.y * 0.2), c.z]),
      duration: 8, focusDist: r * 1.2,
    });
    if (s) { s.moveParams = { dist: Math.min(60, r * 1.1), dir: 1, elev: 0 }; s.generateMove('truck'); track(s); }
  }

  // ---- D · 推镜收尾：对准主体推进 ----
  {
    const focus = heroBB ? heroC : c.clone().setY(Math.max(1.5, size.y * 0.3));
    const d = (heroBB ? fitDistance(heroBB.getSize(new THREE.Vector3()), 45) : r * 1.4);
    const from = [focus.x + d * 0.7, Math.max(2, focus.y + size.y * 0.1), focus.z + d * 0.72];
    const s = app.addShot({
      name: `${pre}D · 推镜收尾`, focal: 45, pos: from, quat: lookQuat(from, [focus.x, focus.y, focus.z]),
      duration: 7, focusDist: d,
    });
    if (s) {
      if (hero) s.setTarget(hero);
      s.moveParams = { dist: Math.min(25, Math.max(4, d * 0.35)), elev: 0, aim: true };
      s.generateMove('push');
      track(s);
    }
  }

  // 没有机位时自动激活 A，便于立刻预览
  if (shots.length && (!app.activeShot || opts.activate !== false)) {
    try { app.setActiveShot(shots[0]); } catch (e) { /* 非致命 */ }
  }
  return shots;
}
