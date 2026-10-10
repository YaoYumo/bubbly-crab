// ---------------------------------------------------------------------------
// 把当前镜头设置翻译成「AI 视频提示词」（中英文各一份）+ 运镜数据
// ---------------------------------------------------------------------------
import { MOVE_BY_ID, SENSORS } from './camera.js';
import { ATMOS_BY_ID } from './lighting.js';
import { BIOMES } from './terrain.js';
import { deg, fmt } from './util.js';

const MOVE_WORDS = {
  static: ['固定机位', 'locked-off tripod shot'],
  push: ['缓慢推近', 'slow dolly in'],
  pull: ['缓慢后拉并揭示环境', 'slow dolly out revealing the environment'],
  truck: ['横向平移跟移', 'lateral truck / tracking shot'],
  pedestal: ['垂直升降', 'vertical crane move'],
  pan: ['水平摇镜', 'horizontal pan'],
  tilt: ['垂直俯仰摇镜', 'vertical tilt'],
  orbit: ['围绕主体环绕', 'orbiting around the subject'],
  orbitPush: ['环绕同时推进', 'arc orbit with push-in'],
  dollyZoom: ['希区柯克变焦（推轨+反向变焦）', 'dolly zoom / vertigo effect'],
  follow: ['背后跟随主体', 'following behind the subject'],
  lead: ['迎面倒退跟拍', 'frontal lead tracking'],
  reveal: ['升起揭示全景', 'crane-up reveal'],
  topdown: ['正俯瞰缓缓下降', 'top-down descent'],
  hero: ['低角度仰拍推进', 'low-angle hero push-in'],
  dutch: ['荷兰角倾斜构图', 'dutch angle tilt'],
  whip: ['快速甩镜转场', 'whip pan transition'],
  handheld: ['手持晃动跟移', 'handheld follow'],
  fpv: ['FPV 穿越机俯冲穿行', 'FPV drone dive-through'],
  bullet: ['子弹时间环绕', 'bullet-time orbit'],
  pushPull: ['呼吸感往复推进', 'breathing push-pull loop'],
  facade: ['沿建筑立面上摇', 'tilt up along the facade'],
  craneOver: ['升起掠过屋顶', 'crane over the rooftops'],
  snorricam: ['锁定在主体上的蜗牛镜', 'snorricam rig locked to subject'],
};

export function shotSummary(app, shot) {
  const s = shot || app.activeShot;
  if (!s) return null;
  const sensor = SENSORS.find((x) => x.v === s.sensor) || SENSORS[0];
  const model = s.model;
  const move = MOVE_BY_ID[s.move];
  const keys = s.mover.keys;
  const dur = s.duration || app.state.duration;
  const p = s.moveParams || {};
  const dists = [];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1].p, b = keys[i].p;
    dists.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const travel = dists.reduce((a, b) => a + b, 0);
  const yaws = keys.filter((k) => k.q).map((k) => yawOf(k.q));
  let turn = 0;
  for (let i = 1; i < yaws.length; i++) turn += Math.abs(shortAngle(yaws[i], yaws[i - 1]));
  const fovs = keys.map((k) => k.f).filter((v) => v != null);
  const lift = keys.length > 1 ? keys[keys.length - 1].p[1] - keys[0].p[1] : 0;
  return {
    name: s.name, sensor, model, move, dur, keys: keys.length, travel, turn: Math.round(turn), focal: s.focal,
    fov0: fovs.length ? Math.round(fovs[0]) : Math.round(deg(s.hFov())),
    fov1: fovs.length ? Math.round(fovs[fovs.length - 1]) : null,
    lift: Math.round(lift * 10) / 10,
    start: keys.length ? keys[0].p : null,
    end: keys.length ? keys[keys.length - 1].p : null,
    height: keys.length ? fmt(Math.max(...keys.map((k) => k.p[1])), 1) : '-',
  };
}

const yawOf = (q) => {
  // 由四元数推相机前向量的水平偏航（避免额外引入 three）
  const [x, y, z, w] = q;
  const vx = 2 * (x * z - w * y);
  const vz = 1 - 2 * (x * x + y * y);
  return Math.atan2(vx, -vz);
};
const shortAngle = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export function buildPrompt(app) {
  const sum = shotSummary(app);
  if (!sum) return { text: '先创建一个机位（顶部「+ 新建机位」），再生成提示词。', data: null };
  const [zh, en] = MOVE_WORDS[sum.move?.id] || ['自定义关键帧路径', 'custom keyframed camera path'];
  const chars = app.objects.filter((o) => o.isChar).length;
  const props = app.objects.length;
  const atmos = ATMOS_BY_ID[app.lighting.preset];
  const aspect = app.state.aspect === 'fit' ? '16:9' : app.state.aspect;
  const speed = sum.travel > 0.5 ? (sum.travel / sum.dur > 4 ? '较快' : sum.travel / sum.dur > 1.2 ? '中速' : '缓慢') : '几乎静止';
  const speedEn = sum.travel / Math.max(0.1, sum.dur) > 4 ? 'brisk' : sum.travel / Math.max(0.1, sum.dur) > 1.2 ? 'measured' : 'very slow';
  const shot = app.selShot || app.activeShot;
  const rhythm = (() => {
    if (!shot) return '';
    const parts = [];
    parts.push(shot.motionScope === 'segment' ? '逐段缓动（每个关键帧处减速强调）' : '整段只缓动一次（关键帧处不停顿）');
    if (shot.arcSpeed !== false) parts.push('沿路径匀速（弧长参数化）');
    if (shot.curves?.prog) parts.push(`自定义进度曲线（${shot.curves.prog.length} 个点）`);
    let d = null;
    try { d = shot.motionDiag ? shot.motionDiag() : null; } catch (e) { d = null; }
    if (d) parts.push(`速度区间 ${d.min.toFixed(2)}×–${d.max.toFixed(2)}×，关键帧处掉速 ${(d.keyDip * 100).toFixed(0)}%（0% = 无停顿感）`);
    return parts.join('，');
  })();
  const terrainLine = app.terrain?.enabled ? (() => {
    const tr = app.terrain;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < tr.h.length; i++) { if (tr.h[i] < mn) mn = tr.h[i]; if (tr.h[i] > mx) mx = tr.h[i]; }
    return `地形：${(BIOMES[tr.biome] || {}).name || tr.biome}，${tr.n}×${tr.n} 高度场 · ${tr.size}m，高差 ${(mx - mn).toFixed(1)}m${tr.state.water ? ` · 水面 ${tr.state.waterY.toFixed(2)}m` : ''}。`;
  })() : '';
  const lines = [
    `【运镜参考 · ${sum.name}】`,
    `镜头：${sum.move ? sum.move.name : '手工关键帧'}｜${fmt(sum.focal, 0)}mm（水平视角 ${sum.fov0}°，${sum.sensor.l}）｜${sum.dur}s｜${speed}。`,
    `路径：${sum.keys} 个关键帧，位移 ≈${fmt(sum.travel, 1)}m，累计转向 ${sum.turn}°，高差 ${sum.lift}m。`,
    `画面：${props} 个场景元素，${chars} 个人物动作参考；光影：${atmos.name}（${atmos.en}）。`,
    ...(terrainLine ? [terrainLine] : []),
    ...(rhythm ? [`节奏：${rhythm}。`] : []),
    '',
    '▶ 可直接粘贴的中文提示词：',
    `${atmos.name}的${chars ? '城市街道，人物' : '建筑场景'}，${zh}，${aspect} 画幅，${sum.fov1 ? `焦段由 ${sum.fov0}° 变到 ${sum.fov1}°` : `${fmt(sum.focal, 0)}mm 固定焦段`}，真实电影摄影机质感，自然运动模糊，稳定流畅。`,
    '',
    '▶ English prompt (for Sora / Veo / Runway / Kling):',
    `cinematic ${aspect} shot, ${atmos.en.toLowerCase()} lighting, ${sum.move?.en || 'custom camera path'}, ${speedEn} ${speed === '几乎静止' ? 'camera' : 'camera move'} over ${sum.dur}s, `
    + `${sum.fov1 ? `dolly zoom from ${sum.fov0} to ${sum.fov1} degrees horizontal FOV` : `single ${sum.fov0}\u00b0 field of view`}, `
    + `${sum.keys} keyframed positions, ${sum.turn}° of pan/roll, ${Math.abs(sum.lift)}m vertical change, `
    + `${chars ? 'low-poly blocking characters performing a walk cycle as action reference, ' : ''}simple massing architecture as set dressing, `
    + `no text or logos, camera-ready reference footage, natural motion blur, 24fps filmic shutter.`,
    '',
    '▶ 建议：把导出的视频/首帧一起作为「运镜 + 动作」参考上传给模型，提示词中只保留场景内容与情绪描述。',
  ];
  return { text: lines.join('\n'), data: sum };
}

// --- 纯数学小工具（不引入 three，便于独立复用）--------------------------------
function matApply(e, p) {
  const [x, y, z] = p;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
}
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** three 相机看向 -Z：由四元数得世界前向量 R·(0,0,-1) */
function qForward(q) {
  const [x, y, z, w] = q;
  return [-2 * (x * z + y * w), 2 * (x * w - y * z), 2 * (x * x + y * y) - 1];
}
const r3 = (a) => a.map((v) => +v.toFixed(3));

export function motionJson(app) {
  const s = app.activeShot;
  if (!s) return {};
  return {
    camera: { name: s.name, model: s.model, sensor: s.sensor, focal_mm: s.focal, hfov_deg: +(deg(s.hFov())).toFixed(2) },
    move: s.move, duration_s: s.duration, fps: app.state.fps, easing: s.easing, handheld: s.handheld,
    motion: {
      easing: s.easing, scope: s.motionScope || 'global', arc_length_uniform: s.arcSpeed !== false,
      spline_tension: +(s.tension ?? 0.5).toFixed(3), rotation_interp: s.rotMode || 'spline',
      smoothness: (() => { try { const d = s.motionDiag ? s.motionDiag() : null; return d ? { speed_min: +d.min.toFixed(3), speed_max: +d.max.toFixed(3), at_keys: +d.atKey.toFixed(3), key_dip: +d.keyDip.toFixed(3) } : null; } catch (e) { return null; } })(),
    },
    curves: {
      progress: s.curves?.prog ? s.curves.prog.map((k) => ({ x: +k.x.toFixed(3), y: +k.y.toFixed(3), mode: k.mode || 'auto' })) : null,
      shake: s.curves?.shake ? s.curves.shake.map((k) => ({ x: +k.x.toFixed(3), y: +k.y.toFixed(3), mode: k.mode || 'auto' })) : null,
      note: 'progress 为空 = 匀速；x=归一化时间，y=归一化时间重映射（单调递增）。shake 通道把 y 乘到手持幅度上。',
    },
    world_origin: r3(matApply(s.rig.matrixWorld.elements, [0, 0, 0])),
    keyframes: s.mover.keys.map((k) => {
      const e = s.rig.matrixWorld.elements;
      const wq = k.q ? qMul(s.rig.quaternion.toArray(), k.q) : null;
      const f = wq ? qForward(wq) : null;
      return {
        t: +k.t.toFixed(4),
        pos: k.p.map((v) => +v.toFixed(3)),
        pos_world: r3(matApply(e, k.p)),
        quat: k.q ? k.q.map((v) => +v.toFixed(4)) : null,
        quat_world: wq ? wq.map((v) => +v.toFixed(4)) : null,
        forward_world: f ? r3(f) : null,
        yaw_deg: f ? +((Math.atan2(-f[0], -f[2]) * 180) / Math.PI).toFixed(2) : null,
        pitch_deg: f ? +((Math.asin(Math.max(-1, Math.min(1, f[1]))) * 180) / Math.PI).toFixed(2) : null,
        hfov: k.f == null ? null : +k.f.toFixed(2),
      };
    }),
    subjects: app.objects
      .filter((o) => o.motion?.active && (o.motion.keys?.length || 0) > 1)
      .map((o) => ({
        name: o.name, type: o.type, anim: o.motion.anim || null, auto_face: !!o.motion.autoFace, loop: o.motion.loop !== false,
        speed: o.motion.speed ?? 1, easing: o.motion.easing || 'linear', scope: o.motion.scope || 'global',
        follows_terrain: o.followTerrain !== false && !!app.terrain?.enabled,
        keys: o.motion.keys.map((k) => ({ t: +k.t.toFixed(4), pos_world: r3(k.p) })),
      })),
    terrain: app.terrain?.enabled ? (() => {
      const tr = app.terrain;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < tr.h.length; i++) { if (tr.h[i] < mn) mn = tr.h[i]; if (tr.h[i] > mx) mx = tr.h[i]; }
      return {
        enabled: true, grid: tr.n, size_m: tr.size, biome: tr.biome,
        height_range_m: [+(mn * tr.exaggerate).toFixed(2), +(mx * tr.exaggerate).toFixed(2)],
        water: !!tr.state.water, water_y_m: +tr.state.waterY.toFixed(2),
        note: '地形为高度场（y 由 terrain.heightAt 决定）；人物/道具贴地，摄像机高度为世界 y。',
      };
    })() : { enabled: false },
    scene: { up: 'Y', unit: 'meter', handedness: 'right', note: 'keyframes.pos 是机位 rig 的局部空间；pos_world 为世界坐标（AI 视频/引擎直接可用）。t 为 0-1 归一化时间。' },
  };
}
