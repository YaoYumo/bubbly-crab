// ---------------------------------------------------------------------------
// 示例场景模板：顶栏「场景模板」/ ?scene=id 一键载入
// ---------------------------------------------------------------------------
// 每个模板都是声明式数据（地形 + 模型 + 人物走位 + 机位与运镜 + 光影），
// 目的是给出「能直接当运镜参考」的完整布景，而不是空场景。
// 物体写法：[库键名, x, z, 旋转, 参数, 额外]；额外支持 y / s / m(走位) / follow。
// 机位写法：{ n 名字, f 焦距, from 机位, to 注视点, d 时长, mv 运镜预设, p 预设参数,
//             t 目标物体下标, hh 手持幅度, mo 流畅度设置, cur 曲线预设 }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { SCENES2 } from './scenes2.js';
import { SCENES3 } from './scenes3.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(V(...from), V(...to), new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export const SCENES = [];

// 第二组（8 个有故事的调度）追加到同一个列表里，顶栏「示例场景」统一显示
SCENES.push(...SCENES2);
// 第三组：《布局图鉴》12 布局示例场景（中式 8 + 现代 4），全部由素材库模型调用搭建
SCENES.push(...SCENES3);

export const SCENE_BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s]));

/** 载入模板：清空当前场景后按声明式数据重建 */
function _applyScene(app, id) {
  const sc = SCENE_BY_ID[id] || SCENES[0];
  if (!sc) return false;
  app.clearAll();
  app.projectName = sc.name;
  const prevFollow = app.state.followTerrain;

  // 地形 / 地面：模板未声明 terrain 时完全不碰地形（高度/水系保持载入前状态）
  const tr = app.terrain;
  const tt = sc.terrain;
  if (tr && tt) {
    tr.setEnabled(tt.enabled !== false);
    if (tt.enabled === false) { tr.h.fill(0); tr.refresh(); }
    if (tt.size) tr.setSize(tt.size);
    if (tt.biome) tr.setBiome(tt.biome);
    if (tt.enabled !== false && tt.gen) tr.generate(tt.gen, tt.amp ?? 3);
    if (Array.isArray(tt.basin)) for (const b of tt.basin) tr.basin(b[0], b[1], b[2], b[3] ?? 1.6);
    tr.setWater(!!tt.water);
    if (tt.waterY === 'auto') tr.autoWaterLevel(tt.waterFrac ?? 0.14);
    else if (tt.waterY != null) tr.setWaterLevel(tt.waterY);
    tr.app.state.terrainTool = null;
  }
  if (app.stage.setGroundVisible) app.stage.setGroundVisible(sc.ground !== false);

  // 物体
  const list = [];
  let missing = 0;
  for (const o of sc.objs || []) {
    const [key, x, z, r, params, extra] = o;
    const so = app.addAsset(key, V(x || 0, 0, z || 0), { params: params || {} });
    if (!so) { list.push(null); missing++; continue; }
    const e = extra || {};
    if (r) so.root.rotation.y = r;
    if (e.s) so.root.scale.setScalar(e.s);
    if (e.y != null) { so.followTerrain = false; so.root.position.y = e.y; }
    if ('follow' in e) so.followTerrain = !!e.follow;
    if (so.followTerrain) so.root.position.y = tr && tr.enabled ? tr.heightAt(so.root.position.x, so.root.position.z) : 0;
    if (e.m) app.setMotion(so, e.m);
    list.push(so);
  }

  // 目标解析：数字＝物体下标；字符串＝库名 / 物体名（可带序号，如 '轿车 2'）
  const byName = new Map();
  const push = (k, i) => { if (!k) return; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); };
  list.forEach((o, i) => {
    if (!o) return;
    const kn = String(o.key || '').split(':').pop();
    const bare = String(o.name || '').replace(/\s*\d+$/, '');
    for (const k of [kn, o.name, bare]) push(k, i);
  });
  const resolveTarget = (q) => {
    if (q == null) return null;
    if (typeof q === 'number') return list[q] || null;
    const m = /^(.*?)\s*#?(\d+)$/.exec(String(q).trim());
    const base = (m ? m[1] : String(q)).trim();
    const nth = m ? Math.max(1, parseInt(m[2], 10)) : 1;
    let hits = byName.get(base);
    if (!hits || !hits.length) {
      for (const [k, v] of byName) if (v.length && (k.startsWith(base) || k.includes(base))) { hits = v; break; }
    }
    return hits && hits.length ? (list[hits[Math.min(nth - 1, hits.length - 1)]] || null) : null;
  };

  // 机位
  const shots = [];
  let tgtMiss = 0;
  for (const s of sc.shots || []) {
    const shot = app.addShot({
      name: s.n, focal: s.f || 35, pos: s.from, quat: lookQuat(s.from, s.to), duration: s.d || 8,
    });
    if (!shot) continue;
    const tgt = resolveTarget(s.t);
    if (s.t != null && !tgt) tgtMiss++;
    if (tgt) { shot.setTarget(tgt); shot.aim = s.aim || 'target'; }
    if (s.p) Object.assign(shot.moveParams, s.p);
    if (s.mv) shot.generateMove(s.mv);
    if (s.hh != null) shot.handheld = s.hh;
    if (s.mo) for (const [k, v] of Object.entries(s.mo)) shot.setMotionOpt(k, v);
    if (s.cur) shot.applyCurvePreset(s.cur);
    shots.push(shot);
  }
  if (shots[0]) app.setActiveShot(shots[0]);
  app.select(null);
  app.state.duration = shots[0] ? shots[0].duration : (sc.duration || 8);
  app.state.time = 0;
  app.state.followTerrain = prevFollow !== false;

  // 光影 + 视角
  if (sc.atmos) app.lighting.applyPreset(sc.atmos);
  if (sc.view) {
    app.stage.view.position.fromArray(sc.view.pos);
    app.stage.orbit.target.fromArray(sc.view.target);
    app.stage.orbit.update();
  }
  for (const so of list) if (so) app.refitOne(so, { quiet: true });
  app.updateAspectOverlay();
  app.bus.emit('objects');
  app.bus.emit('shots');
  app.bus.emit('terrain');
  app.bus.emit('select');
  app.bus.emit('time');
  app.saveLocal();
  const n = list.filter(Boolean).length;
  app.sceneReport = { id: sc.id, models: n, shots: shots.length, missing, targetMiss: tgtMiss };
  if (app.notify) app.notify(`已载入「${sc.name}」：${n} 个模型 · ${shots.length} 个机位${missing ? ` · ${missing} 个未识别库项` : ''}${tgtMiss ? ` · ${tgtMiss} 个镜头主体没找到` : ''}`, missing || tgtMiss ? 'warn' : 'info');
  return true;
}

/** 对外入口：整份模板在撤销栈上只是「一步」（Ctrl+Z 一次就退回载模板之前的场景）*/
export function applyScene(app, id) {
  const sc = SCENE_BY_ID[id] || SCENES[0];
  if (!sc) return false;
  if (app && app.batchOp) return app.batchOp('载入模板 ' + sc.name, () => _applyScene(app, id));
  return _applyScene(app, id);
}
