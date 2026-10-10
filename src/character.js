// ---------------------------------------------------------------------------
// 人物模型：程序化骨架 + 动作库（用于 AI 视频的动作参考）
// 单位：米。朝向：+Z 为前方。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { M, shade } from './assets.js';
import { clamp, lerp, makeRng } from './util.js';
import { mul, Q } from './detail.js';

export const ANIMS = [
  { v: 'idle', l: '站立呼吸' },
  { v: 'walk', l: '行走 Walk' },
  { v: 'run', l: '奔跑 Run' },
  { v: 'sneak', l: '潜行 / 慢走' },
  { v: 'wave', l: '招手 Wave' },
  { v: 'point', l: '指向 Point' },
  { v: 'phone', l: '看手机' },
  { v: 'carry', l: '搬运行李' },
  { v: 'sit', l: '坐下' },
  { v: 'sitground', l: '席地而坐' },
  { v: 'jump', l: '跳跃' },
  { v: 'dance', l: '跳舞' },
  { v: 'cheer', l: '欢呼' },
  { v: 'look', l: '张望 / 遮阳远望' },
  { v: 'talk', l: '交谈手势' },
  { v: 'lie', l: '倒地' },
];
export const ANIM_LABEL = Object.fromEntries(ANIMS.map((a) => [a.v, a.l]));

const S = Math.sin, C = Math.cos, PI = Math.PI;

function mat(color, rough = 0.72, metal = 0.02, det = null) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
  if (det) m.userData.detail = det;        // 高精度档下挂上布料纹/皮革纹/皮肤毛孔
  return m;
}

function limb(r1, r2, len, material) {
  const rc = Math.max(6, Math.round(mul(10)));   // 四肢是画面里面积最大的部分，段数按精度档走
  const g = new THREE.CapsuleGeometry(Math.max(0.008, r1), Math.max(0.01, len), Math.max(2, Math.round(mul(4))), rc);
  const m = new THREE.Mesh(g, material);
  m.position.y = -len / 2 - r1 * 0.2;
  return m;
}

/** 构建单个角色骨架 */
export function makeRig(p = {}) {
  // 「人群」一次最多 40 人：手指/五官这些小件只在单体或高细节档加，否则 draw call 翻几倍
  const rich = Q.level !== 'lite' && (!p.crowd || Q.level === 'fine');   // 省内存档连单体也收掉小件
  const H = clamp(p.height || 1.75, 0.85, 2.25);
  const B = clamp(p.build ?? 1, 0.6, 1.6);
  const legLen = H * 0.47, torsoH = H * 0.31, neck = H * 0.035;
  const headR = H * 0.072;
  const armU = H * 0.17, armF = H * 0.155, thighR = H * 0.062 * B, armR = H * 0.042 * B;
  const hipW = H * 0.088 * B, shW = H * 0.115 * B;

  const skinM = mat(p.skin || '#d8a484', 0.68, 0.02, 'skin');
  const topM = mat(p.top || '#3d5a75', 0.78, 0.02, 'fabric');
  const botM = mat(p.bottom || '#2c3138', 0.82, 0.02, 'fabric');
  const hairM = mat(p.hair || '#2a2420', 0.55);
  const shoeM = mat(p.shoe || '#1b1e22', 0.5, 0.15, 'leather');
  const eyeM = mat('#151210', 0.25, 0.0);
  const lipM = mat(p.lip || '#a5615a', 0.55);

  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = legLen; root.add(hips);
  hips.add(new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.07 * B, H * 0.05, 3, Math.max(6, Math.round(mul(10)))), botM).translateY(0.01));

  const torso = new THREE.Group(); torso.position.y = H * 0.04; hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.105 * B, torsoH * 0.62, 4, Math.max(8, Math.round(mul(12)))), topM);
  chest.position.y = torsoH * 0.5; chest.scale.set(1.06, 1, 0.82);
  torso.add(chest);
  if (p.dress === 'skirt') {
    const sk = new THREE.Mesh(new THREE.ConeGeometry(H * 0.135 * B, H * 0.2, 18, 1, true), topM);
    sk.position.y = torsoH * 0.14; sk.rotation.x = PI; torso.add(sk);
  }

  const neckG = new THREE.Group(); neckG.position.y = torsoH * 1.03 + neck * 0.4; torso.add(neckG);
  const head = new THREE.Group(); neckG.add(head);
  const sd = Math.max(10, Math.round(mul(18)));
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, sd, Math.max(8, sd - 4)), skinM);
  skull.scale.set(0.92, 1.08, 0.98); skull.position.y = headR * 0.92;
  head.add(skull);
  if (rich) {
    // 五官：眼白+瞳孔、眉、鼻、耳、下颌 —— 特写时决定「像不像人」
    const eo = headR * 0.2, es = Math.max(6, Math.round(mul(10)));
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(eo, es, Math.max(5, es - 3)), mat('#f3efe8', 0.3));
      eye.position.set(s * headR * 0.36, headR * 1.0, headR * 0.78); head.add(eye);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(eo * 0.5, es, Math.max(5, es - 3)), eyeM);
      pup.position.set(s * headR * 0.36, headR * 1.0, headR * 0.93); head.add(pup);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(headR * 0.34, headR * 0.07, headR * 0.1), hairM);
      brow.position.set(s * headR * 0.38, headR * 1.24, headR * 0.82); brow.rotation.z = -s * 0.12; head.add(brow);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.19, 12, 8), skinM);
      ear.position.set(s * headR * 0.88, headR * 0.9, 0); ear.scale.set(0.5, 1.15, 0.8); head.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.14, headR * 0.36, 10), skinM);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, headR * 0.86, headR * 0.95); head.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(headR * 0.34, headR * 0.06, headR * 0.08), lipM);
    mouth.position.set(0, headR * 0.62, headR * 0.86); head.add(mouth);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.62, Math.max(8, sd - 6), 8), skinM);
    jaw.scale.set(1, 0.72, 0.9); jaw.position.set(0, headR * 0.52, headR * 0.16); head.add(jaw);
    const neckM = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.34, headR * 0.42, neck * 1.8, Math.max(8, Math.round(mul(12)))), skinM);
    neckM.position.y = -headR * 0.1; neckG.add(neckM);
  }
  const hs = p.hairStyle || 'short';
  if (hs === 'short') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.05, 20, 14, 0, PI * 2, 0, PI * 0.62), hairM);
    cap.position.y = headR * 0.98; head.add(cap);
  } else if (hs === 'long') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.06, 20, 14, 0, PI * 2, 0, PI * 0.7), hairM);
    cap.position.y = headR * 0.95; head.add(cap);
    const back = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.6, headR * 1.7, headR * 0.5), hairM);
    back.position.set(0, headR * 0.35, -headR * 0.78); head.add(back);
  } else if (hs === 'bun') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.04, 20, 14, 0, PI * 2, 0, PI * 0.55), hairM);
    cap.position.y = headR * 1.0; head.add(cap);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(headR * 0.45, 14, 10), hairM).translateY(headR * 1.9).translateZ(-headR * 0.2));
  } else if (hs === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.12, 20, 14, 0, PI * 2, 0, PI * 0.55), mat(p.hat || p.hair || '#f2e6c0', 0.5));
    cap.position.y = headR * 1.0; head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.5, 0.026, headR * 0.8), mat(p.hat || p.hair || '#f2e6c0', 0.5));
    brim.position.set(0, headR * 1.02, headR * 0.9); head.add(brim);
  }

  const mkArm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * shW, torsoH * 0.95, 0); torso.add(sh);
    sh.add(limb(armR, armR * 0.9, armU, topM));
    const el = new THREE.Group(); el.position.y = -armU; sh.add(el);
    el.add(limb(armR * 0.88, armR * 0.72, armF, p.sleeve === false ? skinM : topM));
    const wr = new THREE.Group(); wr.position.y = -armF; el.add(wr);
    const hs2 = Math.max(8, Math.round(mul(10)));
    wr.add(new THREE.Mesh(new THREE.SphereGeometry(armR * 0.85, hs2, Math.max(6, hs2 - 2)), skinM));
    if (rich) {
      // 手掌 + 四指 + 拇指：握话筒 / 拎包 / 扶墙时不再是一个圆球
      const palm = new THREE.Mesh(new THREE.BoxGeometry(armR * 1.5, armR * 1.9, armR * 0.72), skinM);
      palm.position.set(0, -armR * 1.05, 0); palm.rotation.x = 0.12; wr.add(palm);
      const fs = Math.max(6, Math.round(mul(8)));
      for (let f = 0; f < 4; f++) {
        const fx = (f - 1.5) * armR * 0.38;
        const fg = new THREE.Mesh(new THREE.CapsuleGeometry(armR * 0.15, armR * (f === 0 || f === 3 ? 0.5 : 0.72), 2, fs), skinM);
        fg.position.set(fx, -armR * 2.15, armR * 0.06); fg.rotation.x = 0.22 + f * 0.02; wr.add(fg);
      }
      const th = new THREE.Mesh(new THREE.CapsuleGeometry(armR * 0.17, armR * 0.46, 2, fs), skinM);
      th.position.set(s * armR * 0.62, -armR * 1.35, armR * 0.3); th.rotation.z = s * 0.9; wr.add(th);
    }
    if (p.sleeve !== false) {                       // 袖口：一个小圆环，剪影不再是「管状人」
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(armR * 0.82, armR * 0.16, Math.max(4, Math.round(mul(5))), Math.max(8, Math.round(mul(12)))), topM);
      cuff.rotation.x = Math.PI / 2; cuff.position.y = armF * 0.44; el.add(cuff);
    }
    return { sh, el, wr };
  };
  const mkLeg = (s) => {
    const hp = new THREE.Group(); hp.position.set(s * hipW, -H * 0.01, 0); hips.add(hp);
    hp.add(limb(thighR, thighR * 0.82, legLen * 0.5, botM));
    const kn = new THREE.Group(); kn.position.y = -legLen * 0.5; hp.add(kn);
    kn.add(limb(thighR * 0.8, thighR * 0.6, legLen * 0.44, botM));
    const an = new THREE.Group(); an.position.y = -legLen * 0.44; kn.add(an);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(thighR * 1.5, H * 0.036, thighR * 3.1), shoeM);
    foot.position.set(0, -H * 0.017 + 0.005, thighR * 0.72);
    an.add(foot);
    if (rich) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(thighR * 0.62, Math.max(8, Math.round(mul(12))), 8), shoeM);
      toe.scale.set(1.1, 0.5, 1.15); toe.position.set(0, -H * 0.015 + 0.004, thighR * 2.0); an.add(toe);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(thighR * 1.58, 0.014, thighR * 3.2), mat('#0d0f12', 0.9));
      sole.position.set(0, -H * 0.034 + 0.005, thighR * 0.72); an.add(sole);
    }
    return { hp, kn, an };
  };
  const A = mkArm(-1), B2 = mkArm(1), L = mkLeg(-1), R = mkLeg(1);
  const rig = { H, B, legLen, torsoH, headR, hips, torso, neckG, head, armL: A.sh, foreL: A.el, handL: A.wr, armR: B2.sh, foreR: B2.el, handR: B2.wr, legL: L.hp, kneeL: L.kn, footL: L.an, legR: R.hp, kneeR: R.kn, footR: R.an };

  if (rich) {                                   // 领口 + 腰带：躯干不再只是两根胶囊
    const col = new THREE.Mesh(new THREE.TorusGeometry(H * 0.072 * B, H * 0.012, Math.max(4, Math.round(mul(5))), Math.max(10, Math.round(mul(16)))), topM);
    col.rotation.x = Math.PI / 2; col.position.y = torsoH * 0.92; torso.add(col);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.074 * B, H * 0.074 * B, H * 0.022, Math.max(10, Math.round(mul(16)))), shoeM);
    belt.position.y = torsoH * 0.16; torso.add(belt);
  }
  let prop = null;
  if (p.prop === 'phone') {
    prop = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.25, emissive: new THREE.Color(0x9fd8ff), emissiveIntensity: 0.7 }));
    prop.position.set(0.02, -0.06, 0.05); rig.handL.add(prop);
  } else if (p.prop === 'bag') {
    prop = new THREE.Group();
    prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.13), mat('#4a3a2c', 0.8)));
    prop.children[0].position.y = -0.16;
    rig.handR.add(prop);
  } else if (p.prop === 'box') {
    prop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.32), mat('#a97c50', 0.85));
    prop.position.set(0, -0.1, 0.34);
    rig.foreR.add(prop);
  } else if (p.briefcase) {
    prop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.09), mat('#2a2018', 0.55, 0.2));
    prop.position.y = -0.2;
    rig.handR.add(prop);
  }
  rig.prop = prop;
  return { root, rig };
}

// ---------------------------------------------------------------------------
// 动作解算
// ---------------------------------------------------------------------------
const Z = () => ({
  hipY: 0, hipX: 0, hipY2: 0, hipZ: 0,
  torsoX: 0, torsoY: 0, torsoZ: 0,
  headX: 0, headY: 0, headZ: 0,
  aLx: 0, aLz: 0, fLx: 0, aRx: 0, aRz: 0, fRx: 0,
  lLx: 0, kLx: 0, lRx: 0, kRx: 0, fLz: 0, fRz: 0,
  rootY: 0, rootX: 0,
});

/** 计算某一动作在相位 ph 的关节角 */
export function poseFor(name, ph, amp = 1) {
  const s = Z();
  const a = amp;
  switch (name) {
    case 'walk': {
      const sw = 0.62 * a;
      s.lLx = -S(ph) * sw; s.lRx = -S(ph + PI) * sw;
      s.kLx = clamp(-S(ph - 0.9) * 0.9, 0, 1.5) * a; s.kRx = clamp(-S(ph + PI - 0.9) * 0.9, 0, 1.5) * a;
      s.aRx = -S(ph + PI) * 0.46 * a; s.aLx = -S(ph) * 0.46 * a;
      s.fLx = -0.22 * a - clamp(S(ph), 0, 1) * 0.3; s.fRx = -0.22 * a - clamp(S(ph + PI), 0, 1) * 0.3;
      s.hipY2 = S(ph) * 0.085 * a; s.torsoY = -S(ph) * 0.07 * a;
      s.hipY = Math.abs(S(ph * 2)) * 0.028 * a; s.rootY = Math.abs(S(ph * 2)) * 0.022 * a;
      s.torsoX = 0.05 * a; s.headY = -S(ph) * 0.03;
      break;
    }
    case 'run': {
      const sw = 1.05 * a;
      s.lLx = -S(ph) * sw; s.lRx = -S(ph + PI) * sw;
      s.kLx = clamp(-S(ph - 1.1) * 1.8, 0, 2.2) * a; s.kRx = clamp(-S(ph + PI - 1.1) * 1.8, 0, 2.2) * a;
      s.aRx = -S(ph + PI) * 0.95 * a; s.aLx = -S(ph) * 0.95 * a;
      s.fLx = -0.95 * a; s.fRx = -0.95 * a;
      s.hipY = Math.abs(S(ph * 2)) * 0.075 * a; s.rootY = Math.abs(S(ph * 2)) * 0.06 * a;
      s.torsoX = 0.22 * a; s.hipY2 = S(ph) * 0.1 * a;
      break;
    }
    case 'sneak': {
      s.lLx = -S(ph) * 0.4; s.lRx = -S(ph + PI) * 0.4;
      s.kLx = clamp(-S(ph - 0.8) * 0.7, 0, 1.2); s.kRx = clamp(-S(ph + PI - 0.8) * 0.7, 0, 1.2);
      s.aLx = -0.5; s.aRx = -0.35; s.fLx = -1.0; s.fRx = -0.85;
      s.torsoX = 0.24; s.rootY = -0.09; s.hipY = Math.abs(S(ph * 2)) * 0.015;
      s.headY = S(ph * 0.4) * 0.3;
      break;
    }
    case 'idle': {
      const b = S(ph * 0.55);
      s.hipY = b * 0.008; s.torsoX = 0.02 + b * 0.02;
      s.aLz = -0.1 - b * 0.02; s.aRz = 0.1 + b * 0.02;
      s.aLx = -0.03 - b * 0.04; s.aRx = -0.02 - b * 0.05;
      s.fLx = -0.12; s.fRx = -0.16;
      s.headY = S(ph * 0.21) * 0.18; s.headX = S(ph * 0.33) * 0.04;
      s.hipY2 = S(ph * 0.27) * 0.04;
      break;
    }
    case 'wave': {
      s.aRz = -2.15; s.aRx = -0.25; s.fRx = -0.7 + S(ph * 2.2) * 0.55;
      s.aLx = -0.05; s.aLz = 0.12; s.fLx = -0.15;
      s.torsoZ = -0.06; s.torsoY = -0.16; s.headZ = -0.05;
      s.hipY = Math.abs(S(ph * 1.1)) * 0.006;
      break;
    }
    case 'point': {
      const bob = S(ph * 1.4);
      s.aRx = -1.35 + bob * 0.05; s.aRz = 0.18; s.fRx = -0.06 + S(ph * 0.9) * 0.06;
      s.aLx = -0.04; s.fLx = -0.15; s.torsoY = 0.24 + bob * 0.03; s.headY = 0.2; s.headX = -0.05 + bob * 0.03;
      s.hipY = Math.abs(S(ph * 1.4)) * 0.008;
      break;
    }
    case 'phone': {
      const br = S(ph * 0.7);
      s.aLx = -1.15 + br * 0.03; s.fLx = -1.35; s.aRx = -0.1; s.fRx = -0.2;
      s.headX = 0.3 + br * 0.04; s.headZ = S(ph * 0.45) * 0.05; s.torsoX = 0.08 + br * 0.015; s.aLz = 0.1;
      s.hipY = S(ph * 0.5) * 0.006;
      break;
    }
    case 'carry': {
      s.aLx = -1.25; s.aRx = -1.25; s.fLx = -0.35; s.fRx = -0.35;
      s.aLz = 0.28; s.aRz = -0.28;
      s.torsoX = 0.1; s.rootY = -0.03;
      s.lLx = -S(ph) * 0.3; s.lRx = -S(ph + PI) * 0.3;
      s.kLx = clamp(-S(ph - 0.8) * 0.5, 0, 1); s.kRx = clamp(-S(ph + PI - 0.8) * 0.5, 0, 1);
      break;
    }
    case 'sit': {
      s.rootY = -0.33; s.hipY = -0.34;
      s.lLx = -1.42; s.lRx = -1.36; s.kLx = 1.48; s.kRx = 1.42;
      s.aLx = -0.2; s.aRx = -0.24; s.fLx = -0.5; s.fRx = -0.55;
      s.aLz = 0.22; s.aRz = -0.22;
      s.torsoX = 0.06 + S(ph * 0.4) * 0.02; s.headY = S(ph * 0.3) * 0.2;
      break;
    }
    case 'sitground': {
      const br = S(ph * 0.55);
      s.rootY = -0.62; s.hipY = -0.1;
      s.lLx = -1.55; s.lRx = -1.5; s.kLx = 1.62; s.kRx = 1.55;
      s.aLx = -0.7 + br * 0.05; s.aRx = -0.75; s.fLx = -0.2; s.fRx = -0.2 + br * 0.04;
      s.torsoX = 0.16 + br * 0.02; s.headX = -0.1 + br * 0.03; s.headY = S(ph * 0.3) * 0.12;
      break;
    }
    case 'jump': {
      const t = ((ph % (PI * 2)) + PI * 2) % (PI * 2) / (PI * 2);
      if (t < 0.25) { const k = t / 0.25; s.rootY = -0.28 * S(k * PI / 2); s.hipY = s.rootY; s.lLx = -0.9 * k; s.lRx = -0.88 * k; s.kLx = 1.5 * k; s.kRx = 1.45 * k; s.aLx = -1.6 * k; s.aRx = -1.6 * k; }
      else if (t < 0.62) { const k = (t - 0.25) / 0.37; s.rootY = 0.5 * S(k * PI); s.hipY = 0.02; s.lLx = 0.45 * (1 - k); s.lRx = 0.5 * (1 - k); s.kLx = 1.1 * (1 - k) + 0.3; s.kRx = 1.0 * (1 - k) + 0.4; s.aLx = -2.5; s.aRx = -2.5; s.torsoX = -0.1; }
      else if (t < 0.8) { const k = (t - 0.62) / 0.18; s.rootY = -0.16 * S(k * PI); s.lLx = -0.7 * S(k * PI); s.lRx = -0.7 * S(k * PI); s.kLx = 1.2 * S(k * PI); s.kRx = 1.2 * S(k * PI); s.aLx = -1.2; s.aRx = -1.2; }
      else { const k = (t - 0.8) / 0.2; s.hipY = 0; s.aLx = -0.05; s.aRx = -0.05; s.fLx = -0.15; s.fRx = -0.15; s.torsoX = 0.02 * k; }
      break;
    }
    case 'dance': {
      s.hipY = Math.abs(S(ph * 2)) * 0.05; s.rootY = Math.abs(S(ph * 2)) * 0.04;
      s.hipY2 = S(ph) * 0.3; s.torsoY = -S(ph) * 0.35; s.torsoZ = S(ph) * 0.12;
      s.aRz = -1.9 - S(ph) * 0.5; s.aLz = 1.9 - S(ph) * 0.5;
      s.aRx = -0.4 + S(ph) * 0.3; s.aLx = -0.4 - S(ph) * 0.3;
      s.fRx = -0.8 - S(ph * 2) * 0.4; s.fLx = -0.8 + S(ph * 2) * 0.4;
      s.lLx = S(ph) * 0.22; s.lRx = -S(ph) * 0.22; s.kLx = 0.3 + clamp(S(ph), 0, 1) * 0.4; s.kRx = 0.3 + clamp(-S(ph), 0, 1) * 0.4;
      s.headZ = S(ph) * 0.14;
      break;
    }
    case 'cheer': {
      s.aLz = 1.9 + S(ph * 2) * 0.25; s.aRz = -1.9 - S(ph * 2) * 0.25;
      s.aLx = -0.5; s.aRx = -0.5;
      s.rootY = Math.abs(S(ph * 2)) * 0.1; s.hipY = s.rootY;
      s.kLx = 0.25 + clamp(S(ph * 2 + 1), 0, 1) * 0.5; s.kRx = 0.25 + clamp(-S(ph * 2 + 1), 0, 1) * 0.5;
      s.headX = -0.18; s.torsoX = -0.06;
      break;
    }
    case 'look': {
      s.aLx = -1.5; s.fLx = -1.5; s.aLz = 0.25;
      s.headY = S(ph * 0.5) * 0.75; s.headX = -0.12; s.torsoY = S(ph * 0.5) * 0.2;
      s.lLx = -0.06; s.lRx = 0.06;
      break;
    }
    case 'talk': {
      s.aRx = -0.9 + S(ph * 1.6) * 0.35; s.fRx = -0.7 + S(ph * 1.9 + 1) * 0.5; s.aRz = -0.25;
      s.aLx = -0.75 + S(ph * 1.4 + 2) * 0.3; s.fLx = -0.5 + S(ph * 1.7) * 0.35; s.aLz = 0.2;
      s.headY = S(ph * 0.7) * 0.16; s.headX = S(ph * 1.1) * 0.07; s.torsoY = -0.12; s.torsoZ = S(ph * 0.9) * 0.04;
      break;
    }
    case 'lie': {
      const br = S(ph * 0.5);
      s.rootX = -PI / 2 + br * 0.006; s.rootY = 0.0; s.hipY = 0;
      s.lLx = 0.1; s.lRx = 0.22 + br * 0.02; s.kLx = 0.25; s.kRx = 0.6;
      s.aLx = 0.4; s.aRx = -0.7 + br * 0.03; s.fLx = 0.1; s.fRx = 0.4;
      s.headX = -0.2 + br * 0.02; s.torsoX = -0.08 + br * 0.01;
      break;
    }
    default: {
      const b = S(ph * 0.5); s.torsoX = b * 0.02; s.aLz = -0.1; s.aRz = 0.1; s.fLx = -0.15; s.fRx = -0.15;
    }
  }
  return s;
}

/** 把解算结果写入骨架 */
export function applyPose(rig, s) {
  rig.hips.position.y = rig.legLen + s.hipY;
  rig.hips.rotation.set(0, 0, s.hipZ || 0);
  rig.torso.rotation.set(s.torsoX, s.torsoY, s.torsoZ);
  rig.neckG.rotation.set(s.headX, s.headY, s.headZ);
  rig.armL.rotation.set(s.aLx, 0, -s.aLz);
  rig.armR.rotation.set(s.aRx, 0, -s.aRz);
  rig.foreL.rotation.x = s.fLx;
  rig.foreR.rotation.x = s.fRx;
  rig.legL.rotation.x = s.lLx;
  rig.legR.rotation.x = s.lRx;
  rig.kneeL.rotation.x = s.kLx;
  rig.kneeR.rotation.x = s.kRx;
  rig.footL.rotation.x = clamp(-s.lLx * 0.4 - s.kLx * 0.5, -0.6, 0.6);
  rig.footR.rotation.x = clamp(-s.lRx * 0.4 - s.kRx * 0.5, -0.6, 0.6);
  // hipY2 = 骨盆左右摆动（绕自身 Z）
  rig.hips.rotation.z = (s.hipY2 || 0) * 0.5;
  rig.hips.rotation.y = (s.hipY2 || 0) * 0.8;
}

export function buildHuman(p = {}) {
  const { root: inner, rig } = makeRig(p);
  const g = new THREE.Group();
  g.add(inner);
  g.userData.inner = inner;
  g.userData.rig = rig;
  g.userData.humans = [{ rig, inner, off: 0, anim: p.anim || 'idle', rate: 1 }];
  g.userData.char = true;
  g.userData.animPhase = 0;
  shade(g);
  return g;
}

export function buildCrowd(p = {}) {
  const g = new THREE.Group();
  const rng = makeRng(p.seed || 6);
  const n = Math.round(p.count);
  const humans = [];
  const palette = ['#3d5a75', '#7c4b3a', '#2f3d4a', '#8a8577', '#42515c', '#6b4f6a', '#b0a48f', '#37414a'];
  for (let i = 0; i < n; i++) {
    const anim = p.anim || 'walk';
    const hp = {
      height: 1.55 + rng() * 0.3,
      build: 0.85 + rng() * 0.4,
      skin: ['#e2b493', '#d8a484', '#c98a5e', '#8d5b3c'][Math.floor(rng() * 4)],
      top: p.uniform ? p.color || '#3d5a75' : palette[Math.floor(rng() * palette.length)],
      bottom: ['#2c3138', '#3a4048', '#4a3a2c', '#26303a'][Math.floor(rng() * 4)],
      hair: ['#2a2420', '#171412', '#40301f', '#8a8378'][Math.floor(rng() * 4)],
      hairStyle: rng() > 0.7 ? 'long' : 'short',
      crowd: true,
      anim,
    };
    if (rng() > 0.85) hp.dress = 'skirt';
    const h = buildHuman(hp);
    const rad0 = rng() * PI * 2, rr = Math.sqrt(rng()) * (p.radius || 8);
    h.position.set(C(rad0) * rr, 0, S(rad0) * rr);
    h.rotation.y = rng() * PI * 2;
    g.add(h);
    humans.push({
      rig: h.userData.rig, inner: h.userData.inner, obj: h, off: rng() * PI * 2, anim, rate: 0.75 + rng() * 0.55,
      ph: 0, dist: 0,                        // 漫游：自己的步幅相位 / 本帧位移
      w: { tx: C(rng() * PI * 2) * rr, tz: S(rng() * PI * 2) * rr, rest: rng() * 3, mode: rng() > 0.35 ? 1 : 0, sp: 0.7 + rng() * 0.7 },
    });
  }
  g.userData.humans = humans;
  g.userData.crowdRng = p.seed || 6;
  g.userData.char = true;
  g.userData.crowd = true;
  g.userData.animPhase = 0;
  return g;
}

/**
 * 播放角色动画。
 * dist 为该帧在地面移动的位移（用于步幅同步）；无位移时用 dt 驱动。
 */
const STRIDE = { run: 2.6, walk: 1.9, sneak: 1.4, carry: 1.7, dance: 0, jump: 0, cheer: 0 };

/** 人群随机漫游：每个角色在自己的小圈子里挑一个地面目标走过去，走到就歇会儿（近处有人就转身聊天），
 *  会避开积水、贴着地形起伏走。参数来自物件 params（wander / wspeed / wradius / wrest），所以随工程 JSON 一起存。 */
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** 这一点是不是踩在水里：margin 是「离水面多远才算干」的余量 */
function _wet(terrain, root, tx, tz, margin) {
  if (!terrain || !terrain.enabled) return false;
  const st = terrain.state;
  if (!st || !st.water) return false;
  _v.set(tx, 0, tz).applyMatrix4(root.matrixWorld);
  return terrain.heightAt(_v.x, _v.z) < st.waterY + margin;
}
function _pickTarget(h, root, rad, terrain) {
  const w = h.w, o = h.obj;
  for (let pass = 0; pass < 2; pass++) {                                 // 先挑明显干燥的点；整个圈子都积水就放宽，别把人卡死
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * PI * 2, r = Math.sqrt(Math.random()) * rad;
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r;                  // 群组局部坐标：拖动整个人群时漫游范围跟着走
      if (_wet(terrain, root, tx, tz, pass ? -0.35 : 0.05)) continue;
      w.tx = tx; w.tz = tz; return;
    }
  }
  w.tx = o.position.x + (Math.random() - 0.5) * 1.6;                     // 实在挑不到：原地挪一小步，至少不呆住
  w.tz = o.position.z + (Math.random() - 0.5) * 1.6;
}
export function stepCrowd(so, dt, terrain) {
  const root = so && so.root;
  const hs = root && root.userData.humans;
  if (!hs || !hs.length) return;
  const p = so.params || {};
  if (p.wander === false || !root.visible) { for (const h of hs) h.dist = 0; return; }   // 默认开：老工程 JSON 里没这个字段也算开
  const spd = Math.max(0.05, Math.min(4, p.wspeed ?? 0.9));
  const rad = Math.max(1, Math.min(60, p.wradius ?? 12));
  if (!root.userData.crowdInit) { root.userData.crowdInit = true; for (const h of hs) if (h.w) _pickTarget(h, root, rad, terrain); }
  const restChance = Math.max(0, Math.min(1, p.wrest ?? 0.45));
  const stillAnim = { sit: 1, sitground: 1, lie: 1 };
  root.updateMatrixWorld(true);
  const sy = root.getWorldScale(_v).y || 1;
  for (const h of hs) {
    const o = h.obj || root;
    if (stillAnim[h.anim] || stillAnim[p.anim]) { h.dist = 0; continue; }
    if (!h.w) h.w = { tx: o.position.x, tz: o.position.z, rest: 0, mode: 1, sp: 1 };
    const w = h.w;
    if (w.mode === 0) {                                     // 停着：时间到了再挑下一个点
      w.rest -= dt;
      h.dist = 0;
      if (w.rest <= 0) { w.mode = 1; h.anim = p.anim === 'idle' ? 'idle' : 'walk'; _pickTarget(h, root, rad, terrain); }
      continue;
    }
    const dx = w.tx - o.position.x, dz = w.tz - o.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {                                          // 走到了
      w.mode = 0;
      w.rest = 0.8 + Math.random() * 2.6;
      h.anim = restChance > 0 && Math.random() < restChance ? 'talk' : 'idle';
      let mate = null, md = 2.2;
      for (const k of hs) {
        if (k === h || !k.obj) continue;
        const dd = Math.hypot(k.obj.position.x - o.position.x, k.obj.position.z - o.position.z);
        if (dd < md) { md = dd; mate = k; }
      }
      if (mate && h.anim === 'talk') o.rotation.y = Math.atan2(mate.obj.position.x - o.position.x, mate.obj.position.z - o.position.z);
      continue;
    }
    const step = Math.min(d, spd * w.sp * (0.8 + h.rate * 0.3) * dt);
    o.position.x += (dx / d) * step;
    o.position.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    let cur = o.rotation.y, diff = ((want - cur + PI) % (PI * 2) + PI * 2) % (PI * 2) - PI;
    o.rotation.y = cur + diff * (1 - Math.exp(-7 * dt));
    h.dist = step;
    h.anim = p.anim === 'run' ? 'run' : (p.anim && p.anim !== 'idle' && p.anim !== 'walk' ? p.anim : 'walk');
    if (terrain && terrain.enabled) {                        // 贴地（坡地上不会半截陷进去）
      _v.set(o.position.x, o.position.y, o.position.z).applyMatrix4(root.matrixWorld);
      const gy = terrain.heightAt(_v.x, _v.z);
      o.position.y += (gy - _v.y) / sy;
    }
  }
}

export function updateChar(root, dt, dist = 0, speedMul = 1) {
  const hs = root.userData.humans;
  if (!hs?.length) return;
  const anim0 = hs[0].anim;
  const stride = STRIDE[anim0] ?? 0;
  let phase = root.userData.animPhase || 0;
  if (stride > 0 && dist > 0.0001) phase += (dist / stride) * PI * 2 * speedMul;
  else if (['idle', 'talk', 'phone', 'look', 'wave', 'point', 'sit', 'sitground', 'lie', 'dance', 'cheer', 'carry'].includes(anim0))
    phase += dt * (anim0 === 'dance' || anim0 === 'cheer' ? 4.2 : 2.0) * speedMul;
  else phase += dt * 2.0 * speedMul;
  root.userData.animPhase = phase;
  for (const h of hs) {
    if (h.ph != null) {                                      // 漫游中的角色用自己的位移推相位，腿才不滑步
      const st = STRIDE[h.anim] ?? 0;
      h.ph += (st > 0 ? (h.dist || 0) / st * PI * 2 : dt * 2.0) * speedMul;
      h.dist = 0;
    }
    const p = poseFor(h.anim, (h.ph != null ? h.ph : phase) * h.rate + h.off, 1);
    applyPose(h.rig, p);
    const inner = h.inner || h.rig.hips?.parent;
    if (inner) {
      inner.position.y = p.rootY || 0;
      inner.rotation.x = p.rootX || 0;
    }
  }
}

export function setCharAnim(root, anim) {
  if (!root.userData.humans) return;
  for (const h of root.userData.humans) h.anim = anim;
}
