// ---------------------------------------------------------------------------
// 光影氛围：预设 + 手动调光 + 关闭光影（内存优先）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, deg, rad } from './util.js';

export const ATMOS = [
  {
    id: 'noon', name: '晴天正午', en: 'Daylight · Noon',
    d: '顶光硬影，通透商务感。建筑立面亮度高、对比中等。',
    v: { sunElev: 68, sunAzim: 135, sunInt: 3.4, sunColor: '#fff6e6', ambInt: 0.55, hemiInt: 0.75, fogColor: '#c3d6e6', fogDens: 0.0016, exposure: 1.0, envInt: 0.85, glow: 0, shadow: true, soft: 1.6, skyTop: '#5c9fdc', skyMid: '#b8d4ea', skyBot: '#5d6672', fill: 0.28, rim: 0.3, tone: 1 },
  },
  {
    id: 'golden', name: '黄金时刻', en: 'Golden Hour',
    d: '低角度暖光 + 长阴影，最“电影”的自然光。',
    v: { sunElev: 7.5, sunAzim: 96, sunInt: 4.2, sunColor: '#ffb469', ambInt: 0.32, hemiInt: 0.55, fogColor: '#e0a778', fogDens: 0.0045, exposure: 1.02, envInt: 0.5, glow: 0.15, shadow: true, soft: 2.6, skyTop: '#4a6f9e', skyMid: '#eaa463', skyBot: '#4a3b34', fill: 0.18, rim: 0.9, tone: 1.05 },
  },
  {
    id: 'blue', name: '蓝调时刻', en: 'Blue Hour',
    d: '日落后 20 分钟的冷暖对比，窗口开始亮灯。',
    v: { sunElev: -3, sunAzim: 90, sunInt: 0.5, sunColor: '#7fa4d8', ambInt: 0.5, hemiInt: 0.8, fogColor: '#26405f', fogDens: 0.005, exposure: 1.12, envInt: 0.42, glow: 1.05, shadow: false, soft: 2, skyTop: '#141d2f', skyMid: '#20406b', skyBot: '#171d26', fill: 0.22, rim: 0.5, tone: 1 },
  },
  {
    id: 'overcast', name: '阴天柔光', en: 'Overcast',
    d: '大面积柔光、几乎无投影，适合产品展示与访谈。',
    v: { sunElev: 55, sunAzim: 180, sunInt: 1.1, sunColor: '#eaf0f6', ambInt: 1.05, hemiInt: 1.25, fogColor: '#c2c9d1', fogDens: 0.0035, exposure: 1.0, envInt: 1.0, glow: 0.1, shadow: true, soft: 4.2, skyTop: '#9fb0c0', skyMid: '#c8d2db', skyBot: '#7b838c', fill: 0.5, rim: 0.15, tone: 0.95 },
  },
  {
    id: 'night', name: '夜景霓虹', en: 'Night Neon',
    d: '月光冷调 + 窗光 + 广告屏发光，适合城市夜景与追逐戏。',
    v: { sunElev: 34, sunAzim: 250, sunInt: 0.42, sunColor: '#9dc0ff', ambInt: 0.2, hemiInt: 0.3, fogColor: '#121a28', fogDens: 0.0075, exposure: 1.25, envInt: 0.22, glow: 2.1, shadow: true, soft: 2.2, skyTop: '#060a14', skyMid: '#0d1626', skyBot: '#05070b', fill: 0.1, rim: 0.75, tone: 1.1 },
  },
  {
    id: 'studio', name: '棚拍均匀', en: 'Studio Softbox',
    d: '三点式柔光 + 高环境光，物体清晰、无氛围干扰。',
    v: { sunElev: 52, sunAzim: 130, sunInt: 2.4, sunColor: '#ffffff', ambInt: 1.15, hemiInt: 1.1, fogColor: '#b9bec6', fogDens: 0.0004, exposure: 1.0, envInt: 1.15, glow: 0, shadow: true, soft: 3.4, skyTop: '#dfe4ea', skyMid: '#eef1f5', skyBot: '#c8ccd2', fill: 0.65, rim: 0.45, tone: 0.95 },
  },
  {
    id: 'backlit', name: '逆光剪影', en: 'Backlit Silhouette',
    d: '主体压暗成剪影，边缘光勾勒轮廓，情绪化。',
    v: { sunElev: 12, sunAzim: 300, sunInt: 5.4, sunColor: '#ffd79a', ambInt: 0.24, hemiInt: 0.4, fogColor: '#d99a63', fogDens: 0.006, exposure: 0.95, envInt: 0.35, glow: 0.2, shadow: false, soft: 3, skyTop: '#7b5f8e', skyMid: '#f0a765', skyBot: '#3a2c2e', fill: 0.05, rim: 2.2, tone: 1.15 },
  },
  {
    id: 'noir', name: '黑色电影', en: 'Film Noir',
    d: '单侧硬光 + 浓雾，高反差，雨夜氛围。',
    v: { sunElev: 24, sunAzim: 20, sunInt: 3.6, sunColor: '#dfe9ff', ambInt: 0.14, hemiInt: 0.25, fogColor: '#161a20', fogDens: 0.0125, exposure: 1.18, envInt: 0.18, glow: 1.35, shadow: true, soft: 0.8, skyTop: '#0d1116', skyMid: '#1b2027', skyBot: '#0a0d11', fill: 0.06, rim: 1.1, tone: 1.2 },
  },
  {
    id: 'interior', name: '室内暖光', en: 'Interior Warm',
    d: '以窗光和环境光为主，低对比、暖色温。',
    v: { sunElev: 40, sunAzim: 70, sunInt: 1.3, sunColor: '#ffe7c4', ambInt: 0.95, hemiInt: 0.9, fogColor: '#c9bda9', fogDens: 0.0012, exposure: 1.0, envInt: 0.95, glow: 0.55, shadow: true, soft: 2.8, skyTop: '#93a3b4', skyMid: '#c9c3b6', skyBot: '#6a6559', fill: 0.45, rim: 0.3, tone: 0.98 },
  },
  {
    id: 'dawn', name: '清晨薄雾', en: 'Misty Dawn',
    d: '低对比冷雾 + 柔和初日，安静开场。',
    v: { sunElev: 4, sunAzim: 60, sunInt: 2.1, sunColor: '#ffe2c9', ambInt: 0.7, hemiInt: 0.95, fogColor: '#cdd8dd', fogDens: 0.0135, exposure: 1.05, envInt: 0.7, glow: 0.1, shadow: false, soft: 4, skyTop: '#8fa9c4', skyMid: '#dfe3df', skyBot: '#8d948f', fill: 0.4, rim: 0.35, tone: 0.95 },
  },
  {
    id: 'space', name: '深空（恒星光）', en: 'Deep Space',
    d: '无雾无天光，只留单侧硬光与自发光；星点与飞船灯光负责层次。',
    v: { sunElev: 22, sunAzim: 115, sunInt: 3.2, sunColor: '#fff4e2', ambInt: 0.08, hemiInt: 0.12, fogColor: '#02040a', fogDens: 0, exposure: 1.16, envInt: 0.16, glow: 2.6, shadow: true, soft: 0.6, skyTop: '#02030a', skyMid: '#05070f', skyBot: '#000104', fill: 0.05, rim: 1.25, tone: 1.12 },
  },
  {
    id: 'orbit', name: '轨道日照', en: 'Planetary Orbit',
    d: '低轨强光 + 行星反照的冷蓝补光，适合太空站、舱外行走。',
    v: { sunElev: 40, sunAzim: 210, sunInt: 4.4, sunColor: '#ffffff', ambInt: 0.22, hemiInt: 0.5, fogColor: '#0a1626', fogDens: 0, exposure: 1.06, envInt: 0.5, glow: 1.8, shadow: true, soft: 1, skyTop: '#050a14', skyMid: '#0f2438', skyBot: '#153448', fill: 0.35, rim: 0.9, tone: 1.05 },
  },
  {
    id: 'xianxia', name: '仙侠夜色', en: 'Xianxia Night',
    d: '冷蓝月晕 + 大量自发光（法阵、灵灯、飞剑），雾气偏厚，仙气靠辉光撑。',
    v: { sunElev: 28, sunAzim: 300, sunInt: 0.75, sunColor: '#b9d4ff', ambInt: 0.35, hemiInt: 0.55, fogColor: '#1b2a46', fogDens: 0.0105, exposure: 1.2, envInt: 0.4, glow: 3.2, shadow: false, soft: 3, skyTop: '#0b1230', skyMid: '#1d3055', skyBot: '#0a1020', fill: 0.2, rim: 1.4, tone: 1.15 },
  },
  {
    id: 'smoke', name: '战地硝烟', en: 'Battlefield Smoke',
    d: '扬尘与硝烟做雾，日光被压成昏黄，低对比、脏色调。',
    v: { sunElev: 16, sunAzim: 60, sunInt: 2.6, sunColor: '#e8c089', ambInt: 0.6, hemiInt: 0.7, fogColor: '#7a6b56', fogDens: 0.016, exposure: 1.02, envInt: 0.45, glow: 0.5, shadow: true, soft: 2.4, skyTop: '#6c6350', skyMid: '#9b8b6f', skyBot: '#4a443a', fill: 0.3, rim: 0.5, tone: 1.02 },
  },
  {
    id: 'snowlight', name: '雪天冷光', en: 'Snow Overcast',
    d: '雪地强反照 + 冷灰天光，阴影偏蓝，亮部接近过曝。',
    v: { sunElev: 46, sunAzim: 150, sunInt: 1.6, sunColor: '#eaf2ff', ambInt: 1.25, hemiInt: 1.35, fogColor: '#d6e0ea', fogDens: 0.008, exposure: 1.05, envInt: 1.2, glow: 0.15, shadow: true, soft: 4.6, skyTop: '#a9bacd', skyMid: '#dde6ef', skyBot: '#c3ccd6', fill: 0.6, rim: 0.25, tone: 0.92 },
  },
  {
    id: 'interior-night', name: '室内夜灯', en: 'Interior Night',
    d: '窗外冷蓝月光 + 室内暖灯，靠自发光灯具做重点照明。',
    v: { sunElev: 20, sunAzim: 250, sunInt: 0.55, sunColor: '#9dc0ff', ambInt: 0.3, hemiInt: 0.35, fogColor: '#141a26', fogDens: 0.002, exposure: 1.2, envInt: 0.28, glow: 2.4, shadow: true, soft: 2.6, skyTop: '#0a0f1a', skyMid: '#131c2c', skyBot: '#0b0d12', fill: 0.12, rim: 0.7, tone: 1.1 },
  },
];
export const ATMOS_BY_ID = Object.fromEntries(ATMOS.map((a) => [a.id, a]));

export class Lighting {
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 460; sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
    sc.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xbcd4f0, 0.3);
    this.scene.add(this.fill, this.fill.target);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.4);
    this.scene.add(this.rim, this.rim.target);
    this.amb = new THREE.AmbientLight(0xdfe9f5, 0.5);
    this.hemi = new THREE.HemisphereLight(0xbcd8f5, 0x4b463c, 0.7);
    this.scene.add(this.amb, this.hemi);
    this.fog = new THREE.FogExp2(0xc3d6e6, 0.002);
    this.scene.fog = this.fog;

    this.pmrem = new THREE.PMREMGenerator(stage.renderer);
    this._envRT = null;
    this.preset = 'noon';
    this.override = {};
    this.enabled = true;      // 关闭光影 = 内存优先
    this.isoMultiplier = 1.0;
    this.p = {};
    this.applyPreset('noon');
  }

  buildEnv() {
    if (this._envRT) return;
    const rt = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this._envRT = rt;
    this.scene.environment = rt.texture;
  }

  params() {
    const base = ATMOS_BY_ID[this.preset].v;
    return { ...base, ...this.override };
  }

  applyPreset(id) {
    this.preset = id;
    this.override = {};
    this._envManual = false;          // 换预设 → 环境反射回到预设值
    this.update();
  }
  set(k, v) { this.override[k] = v; this.update(); }
  resetOverride() { this.override = {}; this._envManual = false; this.update(); }
  setIso(iso) { this.isoMultiplier = iso / 400; this.update(); }

  update() {
    const p = this.params();
    this.p = p;
    const st = this.stage;
    const on = this.enabled;
    const L = (v) => (on ? v : 0);

    // 太阳 / 主光
    const r = 140;
    const el = rad(p.sunElev), az = rad(p.sunAzim);
    this.sun.position.set(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = on ? (p.sunElev < 0 ? p.sunInt * 0.25 : p.sunInt) : 0;
    this.sun.castShadow = !!(on && p.shadow);
    const size = shadowSize(p.soft);
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.setScalar(size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }   // 尺寸没变就别重建，重建会让阴影每帧重采样 → 闪烁
    }
    const range = shadowRange(st);
    const sc = this.sun.shadow.camera;
    sc.left = -range; sc.right = range; sc.top = range; sc.bottom = -range;
    sc.near = 1; sc.far = 220 + range * 2.4;
    sc.updateProjectionMatrix();
    // bias 按 texel 尺寸缩放：范围越大（texel 越粗）越要给够偏移，否则出现随帧爬动的摩尔/闪点
    const tex = (range * 2) / size;
    this.sun.shadow.normalBias = Math.min(0.22, 0.03 + tex * 0.9);
    this.sun.shadow.bias = -Math.min(0.0012, 0.0002 + tex * 0.012);

    this.fill.position.set(-this.sun.position.x * 0.7, Math.max(18, this.sun.position.y * 0.5), -this.sun.position.z * 0.7);
    this.fill.intensity = L(p.fill);
    this.rim.position.set(-this.sun.position.x * 0.9, this.sun.position.y * 0.6 + 20, -this.sun.position.z * 0.9);
    this.rim.color.set(p.skyMid);
    this.rim.intensity = L(p.rim);
    this.amb.intensity = on ? p.ambInt * 0.85 : 1.35;
    this.amb.color.set(on ? p.skyMid : '#ffffff');
    this.hemi.intensity = L(p.hemiInt);
    this.hemi.color.set(p.skyTop);
    this.hemi.groundColor.set(p.skyBot);

    st.renderer.toneMappingExposure = p.exposure * (on ? 1 : 1.06) * this.isoMultiplier;
    st.renderer.shadowMap.enabled = !!this.sun.castShadow;
    st.renderer.shadowMap.type = p.soft > 2.5 ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;

    // 天空
    const u = st.skyUniforms;
    u.topColor.value.set(on ? p.skyTop : '#3a4048');
    u.midColor.value.set(on ? p.skyMid : '#4a5158');
    u.bottomColor.value.set(on ? p.skyBot : '#22262c');
    u.sunDir.value.copy(this.sun.position).normalize();
    u.sunColor.value.set(p.sunColor);
    u.sunPower.value = 120;
    u.glow.value = on ? clamp(0.15 + p.sunInt / 6, 0, 1) : 0;
    u.sunSize.value = p.sunElev > 0 ? 0.9994 : 0.9998;

    // 环境反射：贴图颜色跟天空走，强度取预设的 envInt（用户手动调过就不覆盖）
    st.setEnvColors({ sky: on ? p.skyTop : '#3a4048', sun: p.sunColor, ground: on ? p.skyBot : '#22262c' });
    if (!this._envManual) st.setEnvIntensity(on ? (p.envInt ?? 0.8) : 0.3);

    // 雾
    this.fog.color.set(p.fogColor);
    this.fog.density = on ? p.fogDens : p.fogDens * 0.4;
    st.scene.fog = this.fog;
    st.renderer.setClearColor(new THREE.Color(p.skyBot));
    st.groundMat.color.set(on ? '#2a2f36' : '#3a4048');

    // 环境光贴图（PBR 反射）
    if (on && p.envInt > 0.02) {
      this.buildEnv();
      st.scene.environmentIntensity = p.envInt * (on ? 1 : 0);
    } else {
      st.scene.environmentIntensity = 0;
    }

    // 夜间窗光 / 灯
    this.applyGlow(p.glow);
    st.sky.visible = true;
    this.emitChange();
  }

  applyGlow(g) {
    const glow = g ?? this.p.glow ?? 0;
    this.stage.world.traverse((o) => {
      const list = o.userData?.glow;
      if (!list) return;
      const nightOnly = o.userData?.nightOnly;
      list.forEach((m) => {
        if (!m || m.emissiveIntensity === undefined) return;
        if (nightOnly && glow < 0.05) { m.emissiveIntensity = 0; return; }
        m.emissiveIntensity = glow;
      });
    });
  }

  setEnabled(on) {
    this.enabled = on;
    this.stage.setPerfMode(!on);
    if (!on) { this.stage.scene.environmentIntensity = 0; }
    else if (this.p.envInt > 0.02) { this.stage.scene.environment = this._envRT?.texture || this.stage.scene.environment; }
    this.update();
  }

  emitChange() { this.stage.bus?.emit('light', this.p); }

  toJSON() { return { preset: this.preset, override: { ...this.override }, enabled: this.enabled }; }
  fromJSON(j) {
    if (!j) return;
    this.preset = ATMOS_BY_ID[j.preset] ? j.preset : 'noon';
    this.override = j.override || {};
    this.enabled = j.enabled !== false;
    this.stage.setPerfMode(!this.enabled);
    this.update();
  }
}

function shadowSize(soft) {
  return soft > 3 ? 1024 : soft > 2 ? 2048 : 2048;
}
function shadowRange(stage) {
  let m = 26;
  stage.world.children.forEach((c) => {
    if (!c.visible) return;
    const p = c.position;
    m = Math.max(m, Math.abs(p.x) + 12, Math.abs(p.z) + 12);
  });
  return Math.min(320, m);
}
