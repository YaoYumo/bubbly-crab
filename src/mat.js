// ---------------------------------------------------------------------------
// 材质工厂与公共着色工具（从 assets.js 抽出）
// 独立成叶子模块的原因：character.js 只需要 M/shade，不该 import assets.js——
// 否则与 assets→city→character 形成环，入口顺序不同会触发 GROUPS_CITY TDZ
// （合并 arena/569e88f3 后 showcase 入口即命中）。assets.js 仍 re-export M/shade。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { applyDetail } from './detail.js';

// ---- 材质工厂 ----
export const mk = (kind, o) => { const m = new THREE.MeshStandardMaterial(o); if (kind) m.userData.detail = kind; return m; };
export const M = {
  concrete: (c = 0x9aa0a8, r = 0.92) => mk('concrete', { color: c, roughness: r, metalness: 0.02 }),
  metal: (c = 0x8d949c, r = 0.35, m = 0.9) => mk('metal', { color: c, roughness: r, metalness: m, envMapIntensity: 1.4 }),
  dark: (c = 0x2c3138, r = 0.8) => mk('paint', { color: c, roughness: r, metalness: 0.1 }),
  paint: (c = 0xcccccc, r = 0.6) => mk('paint', { color: c, roughness: r, metalness: 0.05 }),
  glass: (c = 0x88bbdd) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }); m.userData.role = 'glass'; return m; },
  tile: (c = 0xb85c38, r = 0.7) => mk('tile', { color: c, roughness: r, metalness: 0.02 }),
};

export function shade(o, cast = true, recv = true) {
  o.traverse?.((m) => { if (m.isMesh || m.isInstancedMesh) { m.castShadow = cast; m.receiveShadow = recv; } });
  applyDetail(o); return o;
}
