// ---------------------------------------------------------------------------
// Scene DSL（方案 D）：手动导入 Scene 文件 + 接入外部 AI agent 的 API 生成
//
// 格式（v1，专为“其他 AI 对话手写/生成”设计——只有四段、全是基础类型）：
// {
//   "version": 1, "name": "街口追逐", "flat": true,
//   "objects": [ { "key": "building:tower:玻璃幕墙写字楼", "pos": [-34,0,-34],
//                  "rot": 0.1, "name": "主楼", "params": { "floors": 21 } } ],
//   "motions": [ { "object": 0, "keys": [[0,-72,0,3.4],[1,72,0,3.4]],
//                  "autoFace": true, "speed": 1, "loop": true, "anim": "idle" } ],
//   "shots":   [ { "name": "A", "pos": [30,18,30], "look": [0,2,0], "focal": 24,
//                  "duration": 7, "target": 0, "move": "pedestal", "moveParams": {} } ]
// }
// · objects[].key 必须是模型库键（缺失的键会被记录并跳过，不中断导入）
// · motions.object / shots.target = objects 数组下标（或 name 字符串）
// · shots 需要朝向：给 look（看向点）或 quat 四元数；move 可选（运镜词典 id）
// · flat:true（默认）= 关地形用平地，保证空间关系精确
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { lookQuat } from './autocam.js';
import { withScene, matchTemplate } from './templates.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const idxOf = (list, ref, field = 'object') => {
  if (ref == null) return null;
  if (typeof ref === 'number') return list[ref] || null;
  return list.find((o) => o.name === ref) || null;
};

/**
 * 应用 Scene DSL 文档（清空当前场景，一步撤销）。
 * @returns {{objects:number, shots:number, motions:number, missing:string[]}}
 */
export function applySceneDSL(app, doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Scene 文件必须是 JSON 对象');
  if (!Array.isArray(doc.objects) && !Array.isArray(doc.shots)) throw new Error('Scene 需要 objects 或 shots 数组');
  const missing = [];
  const out = { objects: 0, shots: 0, motions: 0, missing };
  withScene(app, `导入 Scene${doc.name ? '：' + doc.name : ''}`, () => {
    if (doc.flat !== false) app.terrain?.setEnabled?.(false);
    const objs = [];
    for (const o of doc.objects || []) {
      if (!o || !o.key) continue;
      const p = o.pos || [0, 0, 0];
      const so = app.addAsset(o.key, V(+p[0] || 0, +p[1] || 0, +p[2] || 0), { params: o.params || {} });
      if (!so) { missing.push(o.key); continue; }
      if (o.rot) so.root.rotation.y = +o.rot;
      if (o.name) so.name = String(o.name);
      objs.push(so);
    }
    out.objects = objs.length;
    for (const m of doc.motions || []) {
      const so = idxOf(objs, m.object);
      if (!so || !Array.isArray(m.keys) || m.keys.length < 2) continue;
      app.setMotion(so, {
        active: m.active !== false,
        autoFace: m.autoFace !== false,
        faceOffset: Number.isFinite(m.faceOffset) ? m.faceOffset : 0,
        easing: m.easing || 'linear',
        loop: m.loop !== false,
        speed: m.speed ?? 1,
        ...(m.anim ? { anim: m.anim } : {}),
        keys: m.keys.map(([t, x, y, z]) => ({ t: +t, p: [+x || 0, +y || 0, +z || 0] })),
      });
      out.motions++;
    }
    for (const s of doc.shots || []) {
      const pos = (s.pos || [0, 2, 10]).map((v) => +v || 0);
      const quat = Array.isArray(s.quat) ? s.quat : lookQuat(pos, (s.look || [0, 1, 0]).map((v) => +v || 0));
      const shot = app.addShot({
        name: s.name || undefined, pos, quat,
        focal: +s.focal || 35, duration: +s.duration || 6,
      });
      if (!shot) continue;
      const tgt = idxOf(objs, s.target);
      if (tgt) shot.setTarget(tgt);
      if (s.move) { shot.moveParams = s.moveParams || {}; shot.generateMove(s.move); }
      out.shots++;
    }
    if (out.shots && app.shots[0]) { try { app.setActiveShot(app.shots[0]); } catch (e) { /* 忽略 */ } }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 手动导入：文件选择 → 解析 → 应用
// ---------------------------------------------------------------------------
export function importSceneFile(app, file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.onload = () => {
      try {
        const doc = JSON.parse(String(fr.result));
        const r = applySceneDSL(app, doc);
        const msg = `已导入 Scene「${doc.name || file.name}」：${r.objects} 物体 · ${r.shots} 机位 · ${r.motions} 段运动` +
          (r.missing.length ? ` · ${r.missing.length} 个键未识别(${r.missing[0]}…)` : '');
        app.notify(msg, r.missing.length ? 'warn' : 'ok');
        resolve(r);
      } catch (e) {
        app.notify('Scene 文件解析失败：' + (e?.message || e), 'err');
        reject(e);
      }
    };
    fr.readAsText(file);
  });
}

/** 场景菜单用：弹文件选择 */
export function pickSceneFile(app) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = () => importSceneFile(app, inp.files?.[0]).catch(() => {});
  inp.click();
}

// ---------------------------------------------------------------------------
// API 接入点（方案 D 的“其他 AI agent 生成”）
// 约定：POST {endpoint}，body = { prompt, system, messages, response_format }
//   兼容 OpenAI 风格（取 choices[0].message.content 里的 JSON），也接受：
//   {scene:{...}} 包一层，或直接就是 DSL 文档。离线默认不联网。
// ---------------------------------------------------------------------------
const SCENE_HINT = `你是 3D 场景编排器。把用户的描述编译为场景 JSON，只输出 JSON：
{"version":1,"name":"场景名","flat":true,
 "objects":[{"key":"模型库键","pos":[x,y,z],"rot":弧度,"name":"名字","params":{}}],
 "motions":[{"object":对象下标,"keys":[[t,x,y,z],...],"autoFace":true,"speed":1,"anim":"idle"}],
 "shots":[{"name":"A","pos":[x,y,z],"look":[x,y,z],"focal":35,"duration":7,"target":对象下标,"move":"pedestal","moveParams":{}}]}
可用模型键（可多用）：building:tower:玻璃幕墙写字楼 | building:residential:住宅板楼 | building:shophouse:沿街商铺 | building:house:独栋住宅 | building:cluster:城市楼群 | building:colonnade:柱廊门厅 | building:stairs:大台阶 | building:billboard:户外广告屏 | building:overpass:高架立交 | env:road:沥青路面 | env:walk:人行道 | env:tree:行道树 | env:lamp:路灯 | env:bench:长椅 | env:fountain:圆形喷泉 | env:sign:路牌 | env:car:轿车 | env:bus:公交车 | env:cone:交通锥 | env:barrier:水马围挡 | env:crate:木箱 | env:trash:垃圾桶 | char:human:男性 | char:human:女性 | char:human:儿童 | char:crowd:人群
注意：机位 move 可选 static/push/pull/truck/pedestal/pan/tilt/orbit/follow/reveal/topdown。宁可少而准，不要编造不存在的键。
物体朝向：人物/人群车头默认 +z（autoFace 即可）；轿车/SUV/公交车车头沿 +x，沿路径移动时 motions 里加 "faceOffset": -1.5708，否则会横着漂移。`;

function stripFences(text) {
  const t = String(text).trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1] : t;
}

function extractScene(data) {
  if (data?.scene && typeof data.scene === 'object') return data.scene;
  const content = data?.choices?.[0]?.message?.content;
  if (content) return JSON.parse(stripFences(content));
  if (data?.objects || data?.shots) return data;
  if (typeof data === 'string') return JSON.parse(stripFences(data));
  throw new Error('响应里找不到场景 JSON');
}

export async function generateSceneViaAPI(app, { endpoint, key, prompt }) {
  if (!endpoint) throw new Error('未配置 API 地址');
  if (!prompt || !prompt.trim()) throw new Error('请先输入一句话场景');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      prompt, system: SCENE_HINT,
      messages: [{ role: 'system', content: SCENE_HINT }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const doc = extractScene(await res.json());
  const r = applySceneDSL(app, doc);
  app.notify(`API 生成完成：${r.objects} 物体 · ${r.shots} 机位 · ${r.motions} 段运动` + (r.missing.length ? ` · ${r.missing.length} 个键未识别` : ''), r.missing.length ? 'warn' : 'ok');
  return r;
}

// ---- API 对话框（端点存 localStorage，Key 只存 sessionStorage） ----
const LS_EP = 'previz.sceneapi.endpoint';
const SS_KEY = 'previz.sceneapi.key';

export function openApiDialog(app) {
  if (document.querySelector('.tg-mask')) return;
  const ta = document.createElement('textarea');
  ta.className = 'tg-input'; ta.rows = 3;
  ta.placeholder = '一句话场景，例：黄昏的街口，一辆公交车驶过，行人过街，环绕镜头';
  const ep = document.createElement('input');
  ep.className = 'tg-input'; ep.style.marginTop = '8px';
  ep.placeholder = 'API 地址（OpenAI 兼容 /chat/completions 或自建网关）';
  try { ep.value = localStorage.getItem(LS_EP) || ''; } catch (e) { /* 忽略 */ }
  const kk = document.createElement('input');
  kk.className = 'tg-input'; kk.type = 'password'; kk.style.marginTop = '8px';
  kk.placeholder = 'API Key（可选；仅存本标签页会话）';
  try { kk.value = sessionStorage.getItem(SS_KEY) || ''; } catch (e) { /* 忽略 */ }
  const status = document.createElement('div');
  status.className = 'tg-status'; status.textContent = '离线可用：不配置 API 时，请用「导入 Scene 文件」或模板生成。';
  const gen = document.createElement('button');
  gen.className = 'tg-btn pri'; gen.type = 'button'; gen.textContent = '生成场景';
  const cancel = document.createElement('button');
  cancel.className = 'tg-btn'; cancel.type = 'button'; cancel.textContent = '取消';

  const close = () => { mask.classList.remove('on'); setTimeout(() => mask.remove(), 160); };
  cancel.onclick = close;
  gen.onclick = async () => {
    const endpoint = ep.value.trim();
    if (!endpoint) { status.textContent = '请填写 API 地址'; return; }
    try {
      localStorage.setItem(LS_EP, endpoint);
      sessionStorage.setItem(SS_KEY, kk.value.trim());
    } catch (e) { /* 存储不可用时跳过 */ }
    gen.disabled = cancel.disabled = true;
    status.textContent = '请求中…';
    try {
      await generateSceneViaAPI(app, { endpoint, key: kk.value.trim(), prompt: ta.value });
      close();
    } catch (e) {
      status.textContent = '生成失败：' + (e?.message || e);
    } finally {
      gen.disabled = cancel.disabled = false;
    }
  };
  const mask = document.createElement('div');
  mask.className = 'tg-mask';
  mask.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'tg-modal'; modal.setAttribute('role', 'dialog');
  const head = document.createElement('div'); head.className = 'tg-head';
  const hb = document.createElement('b'); hb.textContent = 'API 生成场景（外部 AI agent）';
  const hs = document.createElement('span'); hs.className = 'tg-sub'; hs.textContent = 'POST 场景 DSL JSON · 导入前清空当前场景';
  const x = document.createElement('button'); x.className = 'tg-x'; x.type = 'button'; x.textContent = '✕'; x.onclick = close;
  head.append(hb, hs, x);
  const body = document.createElement('div'); body.className = 'tg-body';
  body.append(ta, ep, kk, status);
  const foot = document.createElement('div'); foot.className = 'tg-foot';
  foot.append(cancel, gen);
  modal.append(head, body, foot);
  mask.append(modal);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('on'));
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); document.removeEventListener('keydown', onKey, true); }
  };
  document.addEventListener('keydown', onKey, true);
  ta.focus();
}

// 顺带导出给“一句话生成”做模板匹配兜底（townui 使用）
export { matchTemplate };
