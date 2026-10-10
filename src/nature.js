// ---------------------------------------------------------------------------
// 自然物：山、岩、水、树、草、花 + 修真玄幻常用的浮空石/灵晶/瀑布
// 全部程序化生成，无外部资源；低面数 + 顶点色，适合当 AI 参考
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { M, shade, box, cyl, sph, planeXZ, cone } from './geo.js';
import { clamp, makeRng, smoothNoise } from './util.js';

const PI = (k, l, min, max, step, def, help) => ({ k, l, t: 'int', min, max, step, def, help });
const PR = (k, l, min, max, step, def, help) => ({ k, l, t: 'range', min, max, step, def, help });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'sel', opts, def });

/**
 * 顶点焊接：three 的 IcosahedronGeometry / BoxGeometry / 平面网格都是「每个面独立顶点」，
 * 直接逐顶点随机扰动，同一个角上的几份拷贝会跑到不同位置 —— 三角形互相撕开，就是「三边面断裂」。
 * 先把同位置的顶点合成一份（并让位移只由位置决定），面片必然仍严丝合缝。
 */
function weld(geo, eps = 1e-4) {
  const pos = geo.attributes.position;
  const uvA = geo.attributes.uv;
  const sc = 1 / eps;
  const map = new Map();
  const keep = [];
  const idx = [];
  const src = geo.index;
  const idOf = (i) => {
    const k = `${Math.round(pos.getX(i) * sc)}|${Math.round(pos.getY(i) * sc)}|${Math.round(pos.getZ(i) * sc)}`;
    let j = map.get(k);
    if (j === undefined) { j = keep.length; map.set(k, j); keep.push(i); }
    return j;
  };
  // 必须按「索引顺序」遍历：BoxGeometry 这类带 index 的几何，position 里第 i 个顶点不是第 i 个三角形用的顶点，
  // 直接按 pos.count 顺序拼 index 会把三角形跨面乱连（断崖因此炸成一堆长条尖刺）。
  const n = src ? src.count : pos.count;
  for (let t = 0; t < n; t++) idx.push(idOf(src ? src.getX(t) : t));
  if (src && keep.length === pos.count) return geo;
  const P = new Float32Array(keep.length * 3);
  const U = uvA ? new Float32Array(keep.length * 2) : null;
  for (let i = 0; i < keep.length; i++) {
    const q = keep[i];
    P[i * 3] = pos.getX(q); P[i * 3 + 1] = pos.getY(q); P[i * 3 + 2] = pos.getZ(q);
    if (U) { U[i * 2] = uvA.getX(q); U[i * 2 + 1] = uvA.getY(q); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(idx);
  geo.dispose();
  return out;
}

/** 沿单位方向的连续噪声场（同一个方向必然同一个值 → 重复顶点得到同一个位移） */
function dirNoise(v, f, seed) {
  return smoothNoise((v.x * 1.7 + v.y * 2.3 + v.z * 1.1) * f + 11, seed)
    + smoothNoise((v.x * 0.9 - v.z * 2.6 + v.y * 1.4) * f * 2.4 + 3, seed + 7) * 0.45
    + smoothNoise((v.z * 3.1 - v.x * 1.9) * f * 4.7 + 1.5, seed + 13) * 0.2;
}

/**
 * 山体的公共造型：一张封闭锥面，起伏只由方位角决定（周期偶函数 → 接缝严丝合缝）。
 * t0 / radK 让「雪冠」「侧脊」用同一张场略微外扩地套在山体上，绝不互相穿插；
 * 侧峰（lobes）直接长在同一个面上 —— 旧版是三个独立锥体，会戳穿山体留下三角形破口。
 */
function lump({ r = 8, h = 6, seg = 22, rings = 9, mat, noise = 0.22, seed = 4, squash = 1, flat = 0, t0 = 0, radK = 1, lobes = 0, lobeAmp = 0.5 }) {
  r = Math.max(0.2, r); h = Math.max(0.2, h);
  noise = clamp(noise, 0, 0.9);
  const rng = makeRng(seed);
  const ph = rng() * 10, pw = rng() * 10;
  const nx = Math.max(6, Math.round(seg));
  const nr = Math.max(3, Math.round(rings * (1 - t0))) + 1;
  const field = (a) => {
    const n = smoothNoise(Math.cos(a) * 2.2 + pw, seed) * 0.6 + smoothNoise(Math.cos(a * 2.3) * 3.1 + ph, seed + 3) * 0.4;
    let lb = 0;
    if (lobes > 0 && lobeAmp) {
      for (let i = 0; i < lobes; i++) lb += Math.pow(Math.max(0, Math.cos(a - (i / lobes) * Math.PI * 2 + ph)), 3);
      lb = lb / lobes * lobeAmp;
    }
    return { n, lb };
  };
  const P = new Float32Array(nx * nr * 3);
  const I = [];
  const tOf = (j) => t0 + (1 - t0) * (j / (nr - 1));
  for (let j = 0; j < nr; j++) {
    const t = tOf(j), y = t * h;
    for (let i = 0; i < nx; i++) {
      const a = (i / nx) * Math.PI * 2;
      const { n, lb } = field(a);
      const rr = (r * (1 - t) * (1 + noise * n * (1 - t * 0.4) + lb * (1 - t)) + (1 - t) * r * flat) * radK;
      const q = j * nx + i;
      P[q * 3] = Math.cos(a) * rr;
      P[q * 3 + 1] = y + n * h * noise * 0.5 * (1 - t);
      P[q * 3 + 2] = Math.sin(a) * rr * squash;
    }
  }
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nx; i++) {
      const a0 = j * nx + i, b0 = j * nx + (i + 1) % nx;
      const c0 = (j + 1) * nx + i, d0 = (j + 1) * nx + (i + 1) % nx;
      I.push(a0, c0, b0, b0, c0, d0);            // 外侧三角形：法线朝外
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setIndex(I);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.lumpField = { r, h, noise, seed, squash, flat, lobes, lobeAmp };
  return m;
}

/** 取同一张「山体场」在相对高度 t 处的半径，用来把附属物（雪冠/侧峰/登山道）贴到面上 */
function lumpRadius(m, t) {
  const o = m.userData.lumpField || { r: 1, h: 1, noise: 0 };
  return Math.max(0.02, o.r * (1 - t) * (1 + o.noise * 0.5 * (1 - t * 0.4)));
}

function buildMountain(p) {
  const g = new THREE.Group();
  const rock = M.paint(new THREE.Color(p.rock).getHex(), 0.95);
  rock.flatShading = true;
  const peak = lump({ r: p.r, h: p.h, seg: 26, rings: 11, mat: rock, noise: p.noise, seed: p.seed, squash: p.squash, lobes: p.ridges ? 3 : 0, lobeAmp: p.ridges ? 0.55 : 0 });
  g.add(peak);
  if (p.snow > 0) {
    const snow = M.paint(new THREE.Color(p.snowColor).getHex(), 0.8);
    snow.flatShading = true;
    // 雪冠 = 山体上半张面（同一噪声场、略微外扩）→ 与坡面完全贴合，不会露边、不会穿面
    const tSnow = clamp(1 - (0.16 + p.snow * 0.22) / 0.6, 0.35, 0.9);
    const cap = lump({ r: p.r, h: p.h, seg: 24, rings: 7, mat: snow, noise: p.noise, seed: p.seed, squash: p.squash, t0: tSnow, radK: 1.03, lobes: p.ridges ? 3 : 0, lobeAmp: p.ridges ? 0.55 : 0 });
    g.add(cap);
  }
  return shade(g);
}
function buildCliff(p) {
  const g = new THREE.Group();
  const rock = M.paint(new THREE.Color(p.rock).getHex(), 0.95);
  rock.flatShading = true;
  const geo = weld(new THREE.BoxGeometry(p.length, p.height, p.depth, Math.max(3, Math.round(p.length / 3)), Math.max(3, Math.round(p.height / 2)), 4));
  const pos = geo.attributes.position;
  const rng = makeRng(p.seed);
  const ph = rng() * 10;
  // 位移只由「位置」决定（连续场）→ 同一角上的多份顶点必然同进同退，崖面不会撕开
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = (y + p.height / 2) / Math.max(0.1, p.height);
    const ax = smoothNoise(z * 0.7 + ph, p.seed), az = smoothNoise(x * 0.7 - ph, p.seed + 5);
    const ay = smoothNoise((x * 0.55 + z * 0.4) + ph, p.seed + 9);
    pos.setX(i, x + ax * p.length * 0.06 * (1 - k));
    pos.setY(i, y + ay * 0.5 * (1 - k * 0.35));
    pos.setZ(i, z + az * p.depth * 0.14 + (1 - k) * p.depth * 0.18);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, rock);
  m.position.y = p.height / 2;
  g.add(m);
  // 崖腰石台：贴在崖面上（旧版往崖前伸 0.3·depth、又比崖短不了多少，右端就挂在空里）
  if (p.shelf) g.add(box(p.length * 0.44, 0.42, p.depth * 0.42, rock, -p.length * 0.08, p.height * 0.55, p.depth * 0.24));
  if (p.berm) {
    // 崖脚碎石：seg/rings 提高、加噪声、压扁，不然是六个「金字塔」
    for (let i = 0; i < 6; i++) {
      const b = lump({ r: 1.4 + rng() * 2, h: 0.9 + rng() * 1.5, seg: 13, rings: 4, mat: rock, noise: 0.62, squash: 0.72, seed: p.seed + i * 7 });
      b.position.set((rng() - 0.5) * p.length, 0, p.depth * 0.7 + rng() * 2);
      g.add(b);
    }
  }
  return shade(g);
}
function buildBoulder(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.94);
  m.flatShading = true;
  // IcosahedronGeometry 每个三角形都有自己的三份顶点：逐顶点 rng() 会让 20×4^n 块碎片彼此脱离
  const geo = weld(new THREE.IcosahedronGeometry(Math.max(0.3, p.r), p.detail));
  const pos = geo.attributes.position;
  const rng = makeRng(p.seed);
  const f = 1.15 + rng() * 0.5, ph = rng() * 9;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const R = v.length() || 1;
    v.multiplyScalar(1 / R);
    const n = dirNoise(v, f, Math.round(p.seed * 7 + ph));
    const k = Math.max(0.3, p.r) * (1 + p.rough * n * 0.9);
    pos.setXYZ(i, v.x * k, v.y * k * p.squash + (1 - v.y * 0.5) * 0, v.z * k);
  }
  geo.computeVertexNormals();
  const b = new THREE.Mesh(geo, m);
  b.position.y = p.r * Math.min(1, p.squash) * 0.42;   // 底部略入土，避免整块石头悬空
  b.rotation.y = rng() * 3;
  g.add(b);
  if (p.moss) {
    const mm = M.leaf(new THREE.Color(p.mossColor).getHex(), 0.9);
    for (let i = 0; i < 4; i++) {
      const s = sph(p.r * (0.16 + rng() * 0.2), mm, 8, (rng() - 0.5) * p.r, p.r * p.squash * (0.6 + rng() * 0.4), (rng() - 0.5) * p.r);
      g.add(s);
    }
  }
  return shade(g);
}
function buildRockPile(p) {
  const g = new THREE.Group();
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.count; i++) {
    const r = p.size * (0.35 + rng() * 0.8);
    const b = buildBoulder({ r, detail: 1, rough: 0.4, squash: 0.8, color: p.color, seed: p.seed + i * 13, moss: p.moss, mossColor: p.mossColor });
    b.position.set((rng() - 0.5) * p.spread * 2, 0, (rng() - 0.5) * p.spread * 1.4);
    b.rotation.y = rng() * 3;
    g.add(b);
  }
  return g;
}
function buildArch(p) {
  const g = new THREE.Group();
  const rock = M.paint(new THREE.Color(p.color).getHex(), 0.95);
  rock.flatShading = true;
  const L = p.span, H = p.height, T = p.thick;
  for (const s of [-1, 1]) {
    // 等径柱（上小下大一点点），顶面是平的 → 券脚才有东西可落；旧的 lump 锥体收到一点，拱脚就悬在半空
    const pier = cyl(T * 0.94, T * 1.24, H, rock, 12, s * L / 2, H / 2, 0);
    g.add(pier);
    if (p.moss !== false) g.add(box(T * 2.3, 0.24, T * 2.1, rock, s * L / 2, H + 0.12, 0));   // 券座
  }
  const top = new THREE.Mesh(new THREE.TorusGeometry(L / 2, T * 0.78, 8, 26, Math.PI), rock);
  top.position.y = H + 0.24; top.scale.y = 0.8;          // 半圆券：两端正好落在两墩券座上
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  // 顶石压在券背最高点上（旧版按 L 而不是 L/2 算券高，14m 跨的石门顶石会浮在券上方 12.7m）
  g.add(box(L + T * 2.6, 0.2, T * 1.9, rock, 0, H + 0.24 + 0.8 * (L / 2 + T * 0.78) + 0.1, 0));   // 顶石/额枋压住券背
  g.add(planeXZ(T * 2.4, T * 2.4, M.stone(0x8a857c, 0.95), L / 2, 0.03, 0));
  g.add(planeXZ(T * 2.4, T * 2.4, M.stone(0x8a857c, 0.95), -L / 2, 0.03, 0));
  return shade(g);
}
function buildFloatingRock(p) {
  const g = new THREE.Group();
  const rock = M.paint(new THREE.Color(p.color).getHex(), 0.94);
  rock.flatShading = true;
  const rng = makeRng(p.seed);
  const chunks = Math.max(1, p.chunks);
  for (let c = 0; c < chunks; c++) {
    const grp = new THREE.Group();
    const R = p.r * (0.7 + rng() * 0.7);
    // 上盘与下锥必须同一半径对接（旧版 0.72 / 0.74 各缩一点，中间露出一圈台阶，像断掉的面）
    const topGeo = new THREE.CylinderGeometry(R, R * 0.98, R * 0.55, 16, 1);
    const botGeo = new THREE.ConeGeometry(R * 0.98, R * (1.3 + rng() * 0.9), 9);
    const t = new THREE.Mesh(topGeo, rock); t.position.y = R * 0.28;
    const b = new THREE.Mesh(botGeo, rock); b.position.y = -R * (0.62 + rng() * 0.3); b.rotation.x = Math.PI;
    grp.add(t, b);
    if (p.grass) {
      const gm = M.leaf(new THREE.Color(p.grassColor).getHex(), 0.9);
      const cap = cyl(R * 0.92, R * 0.94, R * 0.16, gm, 10, 0, R * 0.58, 0);
      grp.add(cap);
      for (let i = 0; i < 4; i++) {
        const tr = buildTree({ height: R * (0.5 + rng() * 0.5), kind: 'pine', color: p.treeColor, seed: p.seed + i });
        tr.position.set((rng() - 0.5) * R * 1.2, R * 0.66, (rng() - 0.5) * R * 1.2);
        grp.add(tr);
      }
    }
    if (p.waterfall) {
      const wm = M.glassy(0xbfe6f2, 0.2, 0.05, 0.55);
      const f = box(R * 0.34, p.fallH || R * 3, R * 0.34, wm, R * 0.4, -R * 0.7 - (p.fallH || R * 3) / 2, 0);
      grp.add(f);
    }
    grp.position.set((rng() - 0.5) * p.spread, p.height + c * p.gap + (rng() - 0.5) * 1.2, (rng() - 0.5) * p.spread);
    grp.rotation.y = rng() * 3;
    if (p.spin) grp.userData.floatPhase = rng() * 6;
    g.add(grp);
  }
  return shade(g);
}
function buildTree(p) {
  const g = new THREE.Group();
  const h = Math.max(0.6, p.height);
  const bark = M.paint(new THREE.Color(p.bark).getHex(), 0.9);
  const leaf = M.leaf(new THREE.Color(p.color).getHex(), 0.86);
  const rng = makeRng(p.seed);
  if (p.kind === 'pine') {
    g.add(cyl(h * 0.035, h * 0.06, h * 0.42, bark, 8, 0, h * 0.21, 0));
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const c = cone(h * (0.3 - t * 0.16), h * (0.3 - t * 0.06), leaf, 9, 0, h * (0.34 + t * 0.44), 0);
      c.rotation.y = rng() * 0.6;
      g.add(c);
    }
  } else if (p.kind === 'willow') {
    g.add(cyl(h * 0.05, h * 0.08, h * 0.5, bark, 8, 0, h * 0.25, 0));
    const crown = sph(h * 0.3, leaf, 12, 0, h * 0.62, 0);
    crown.scale.set(1.25, 0.78, 1.25);
    g.add(crown);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = h * 0.3;
      const strand = cyl(0.012, 0.02, h * (0.34 + rng() * 0.24), leaf, 4, Math.cos(a) * r, h * (0.5 - rng() * 0.06), Math.sin(a) * r);
      strand.rotation.z = Math.cos(a) * 0.16; strand.rotation.x = -Math.sin(a) * 0.16;
      g.add(strand);
    }
  } else if (p.kind === 'dead') {
    g.add(cyl(h * 0.03, h * 0.075, h, bark, 7, 0, h / 2, 0));
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const len = h * (0.2 + rng() * 0.3);
      const b = cyl(0.012 * h, 0.03 * h, len, bark, 5, Math.cos(a) * len * 0.3, h * (0.5 + rng() * 0.45), Math.sin(a) * len * 0.3);
      b.rotation.set(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9);
      g.add(b);
    }
  } else if (p.kind === 'bamboo') {
    for (let i = 0; i < 12; i++) {
      const x = (rng() - 0.5) * h * 0.5, z = (rng() - 0.5) * h * 0.5;
      const hh = h * (0.8 + rng() * 0.35);
      g.add(cyl(0.04 * h, 0.05 * h, hh, M.paint(0x8fae5d, 0.7), 6, x, hh / 2, z));
      const crown = sph(h * 0.16, leaf, 8, x, hh * 0.94, z);
      crown.scale.y = 1.5;
      g.add(crown);
    }
  } else if (p.kind === 'snow') {
    g.add(cyl(h * 0.035, h * 0.06, h * 0.4, bark, 8, 0, h * 0.2, 0));
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const c = cone(h * (0.28 - t * 0.14), h * (0.28 - t * 0.05), leaf, 9, 0, h * (0.32 + t * 0.42), 0);
      g.add(c);
      const s = cone(h * (0.26 - t * 0.13), h * 0.08, M.paint(0xeef4f8, 0.75), 9, 0, h * (0.32 + t * 0.42) + h * 0.06, 0);
      g.add(s);
    }
  } else { // ball 阔叶
    g.add(cyl(h * 0.045, h * 0.07, h * 0.45, bark, 8, 0, h * 0.22, 0));
    for (let i = 0; i < 4; i++) {
      const s = sph(h * (0.2 + rng() * 0.12), leaf, 10, (rng() - 0.5) * h * 0.24, h * (0.55 + rng() * 0.18), (rng() - 0.5) * h * 0.24);
      g.add(s);
    }
  }
  return shade(g);
}
function buildBush(p) {
  const g = new THREE.Group();
  const m = M.leaf(new THREE.Color(p.color).getHex(), 0.88);
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.blobs; i++) {
    const r = p.size * (0.5 + rng() * 0.7);
    const s = sph(r, m, 9, (rng() - 0.5) * p.size * 1.6, r * 0.72, (rng() - 0.5) * p.size * 1.6);
    s.scale.y = 0.76;
    g.add(s);
  }
  return shade(g);
}
function buildGrass(p) {
  const g = new THREE.Group();
  const m = M.leaf(new THREE.Color(p.color).getHex(), 0.9);
  m.side = THREE.DoubleSide;
  const n = clamp(Math.round(p.density), 6, 900);
  const geo = new THREE.PlaneGeometry(0.12, p.height, 1, 2);
  geo.translate(0, p.height / 2, 0);
  const im = new THREE.InstancedMesh(geo, m, n);
  const rng = makeRng(p.seed);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set((rng() - 0.5) * p.w, 0, (rng() - 0.5) * p.d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
    const sc = 0.7 + rng() * 0.8;
    s.set(sc, sc * (0.6 + rng() * 0.9), sc);
    im.setMatrixAt(i, mtx.compose(v, q, s));
  }
  im.instanceMatrix.needsUpdate = true;
  g.add(im);
  return g;
}
function buildFlowers(p) {
  const g = new THREE.Group();
  const stemM = M.leaf(0x4e7a3a, 0.9);
  const cols = p.colors.split(',').map((c) => new THREE.Color(c.trim()));
  const rng = makeRng(p.seed);
  const n = clamp(Math.round(p.count), 10, 4000);
  const geo = new THREE.PlaneGeometry(0.18, 0.18);
  const im = new THREE.InstancedMesh(geo, M.paint(0xffffff, 0.8), n);
  const im2 = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, p.height), stemM, n);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    v.set((rng() - 0.5) * p.w, p.height, (rng() - 0.5) * p.d);
    e.set(-Math.PI / 2 + (rng() - 0.5) * 0.6, rng() * Math.PI, 0);
    q.setFromEuler(e);
    const sc = 0.7 + rng() * 0.8;
    s.set(sc, sc, sc);
    im.setMatrixAt(i, mtx.compose(v, q, s));
    col.copy(cols[Math.floor(rng() * cols.length)]);
    im.setColorAt(i, col);
    v.set(v.x, 0, v.z);
    im2.setMatrixAt(i, mtx.compose(v, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3), new THREE.Vector3(1, 1, 1)));
  }
  im.instanceMatrix.needsUpdate = true; im2.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  g.add(im2, im);
  return g;
}
function buildReeds(p) {
  const g = new THREE.Group();
  const m = M.leaf(new THREE.Color(p.color).getHex(), 0.92);
  m.side = THREE.DoubleSide;
  const rng = makeRng(p.seed);
  const n = clamp(Math.round(p.count), 8, 900);
  const geo = new THREE.PlaneGeometry(0.09, p.height, 1, 3);
  geo.translate(0, p.height / 2, 0);
  geo.attributes.position.setY(2, 0.95 * p.height);
  const im = new THREE.InstancedMesh(geo, m, n);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.set((rng() - 0.5) * p.w, 0, (rng() - 0.5) * p.d);
    q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.22, rng() * Math.PI, (rng() - 0.5) * 0.22));
    const sc = 0.7 + rng() * 0.7;
    s.set(sc, sc * (0.8 + rng() * 0.5), sc);
    im.setMatrixAt(i, mtx.compose(v, q, s));
  }
  im.instanceMatrix.needsUpdate = true;
  if (p.heads) {
    const hgeo = new THREE.CylinderGeometry(0.02, 0.05, 0.5, 10);
    const head = new THREE.InstancedMesh(hgeo, M.paint(0x8a6f4a, 0.9), n);
    const hv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, mtx);
      hv.setFromMatrixPosition(mtx);
      const hh = p.height * (0.8 + ((i * 37) % 10) / 40);
      hv.y = hh;
      head.setMatrixAt(i, mtx.makeTranslation(hv.x, hv.y, hv.z));
    }
    head.instanceMatrix.needsUpdate = true;
    g.add(head);
  }
  g.add(im);
  return g;
}
function buildLog(p) {
  const g = new THREE.Group();
  const bark = M.paint(new THREE.Color(p.color).getHex(), 0.92);
  const l = cyl(p.r, p.r * 0.9, p.length, bark, 12);
  l.rotation.z = Math.PI / 2;
  l.position.y = p.r;
  g.add(l);
  for (const s of [-1, 1]) {
    const cap = cyl(p.r * 0.92, p.r * 0.92, 0.06, M.paint(0xb99a6e, 0.85), 12, s * (p.length / 2 + 0.02), p.r, 0);
    cap.rotation.z = Math.PI / 2;
    g.add(cap);
  }
  if (p.stump) {
    const st = cyl(p.r * 1.1, p.r * 1.25, p.r * 3, bark, 12, -p.length * 0.4, p.r * 1.5, p.r * 2.4);
    g.add(st);
  }
  return shade(g);
}
function buildCrops(p) {
  const g = new THREE.Group();
  const m = M.leaf(new THREE.Color(p.color).getHex(), 0.9);
  m.side = THREE.DoubleSide;
  const rng = makeRng(p.seed);
  const nx = clamp(Math.round(p.w / p.gap), 2, 80), nz = clamp(Math.round(p.d / p.gap), 2, 80);
  const n = nx * nz;
  const geo = new THREE.BoxGeometry(0.06, p.height, 0.06);
  geo.translate(0, p.height / 2, 0);
  const im = new THREE.InstancedMesh(geo, m, n);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      v.set((i / (nx - 1) - 0.5) * p.w, 0, (j / (nz - 1) - 0.5) * p.d);
      q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.14, rng() * 0.6, (rng() - 0.5) * 0.14));
      im.setMatrixAt(k++, mtx.compose(v, q, s));
    }
  }
  im.instanceMatrix.needsUpdate = true;
  g.add(im);
  if (p.rows) {
    const soil = M.paint(new THREE.Color(p.soil).getHex(), 0.95);
    soil.side = THREE.DoubleSide;
    g.add(planeXZ(p.w, p.d, soil, 0, 0.02, 0));
  }
  return g;
}
function buildCactus(p) {
  const g = new THREE.Group();
  const m = M.leaf(new THREE.Color(p.color).getHex(), 0.8);
  const h = p.height;
  g.add(cyl(h * 0.11, h * 0.13, h, m, 10, 0, h / 2, 0));
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.arms; i++) {
    const a = rng() * Math.PI * 2, up = h * (0.35 + rng() * 0.35);
    const arm = cyl(h * 0.07, h * 0.08, up, m, 8, Math.cos(a) * h * 0.2, up / 2 + h * 0.16, Math.sin(a) * h * 0.2);
    g.add(arm);
    const link = cyl(h * 0.07, h * 0.07, h * 0.16, m, 8, Math.cos(a) * h * 0.11, h * 0.24, Math.sin(a) * h * 0.11);
    link.rotation.z = Math.PI / 2;
    g.add(link);
  }
  return shade(g);
}
function buildCrystal(p) {
  const g = new THREE.Group();
  const col = new THREE.Color(p.color);
  const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.86, emissive: col.clone().multiplyScalar(0.55), emissiveIntensity: p.glow, flatShading: true, side: THREE.DoubleSide });
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.shards; i++) {
    const hh = p.size * (0.4 + rng() * 1.2);
    const rr = hh * (0.14 + rng() * 0.12);
    const s = cyl(rr * 0.2, rr, hh, m, 5, (rng() - 0.5) * p.size * 1.1, hh / 2, (rng() - 0.5) * p.size * 1.1);
    s.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
    g.add(s);
    const tip = cone(rr * 1.02, hh * 0.3, m, 5, s.position.x, hh + hh * 0.12, s.position.z);
    tip.rotation.copy(s.rotation);
    g.add(tip);
  }
  g.userData.glow = [m];
  return shade(g, true, false);
}
function buildPond(p) {
  const g = new THREE.Group();
  const wm = M.water(new THREE.Color(p.color).getHex());
  const r = p.r;
  const water = new THREE.Mesh(new THREE.CircleGeometry(r, 32), wm);
  water.rotation.x = -Math.PI / 2; water.position.y = 0.05; water.receiveShadow = true;
  g.add(water);
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.98, r * 1.16, 32), M.stone(new THREE.Color(p.rim).getHex(), 0.94));
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.06;
  g.add(rim);
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.rocks; i++) {
    const a = rng() * Math.PI * 2, rr = r * (1.05 + rng() * 0.25);
    const b = buildBoulder({ r: 0.3 + rng() * 0.5, detail: 1, rough: 0.5, squash: 0.7, color: '#8f8a80', seed: i + p.seed, moss: true, mossColor: '#4d7043' });
    b.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    g.add(b);
  }
  if (p.lily) {
    const lm = M.leaf(0x3f7a4a, 0.8);
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2, rr = rng() * r * 0.8;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.22 + rng() * 0.2, 10, 0.4, Math.PI * 1.8), lm);
      d.rotation.x = -Math.PI / 2; d.position.set(Math.cos(a) * rr, 0.07, Math.sin(a) * rr);
      g.add(d);
    }
  }
  g.userData.glow = [];
  return g;
}
function buildWaterfall(p) {
  const g = new THREE.Group();
  const rng = makeRng(p.seed);                                               // 水雾团随机数（本版曾随逐顶点位移一起被摘掉 → rng 未定义，模型建不出来）
  const H = p.height, W = p.width;
  const wm = new THREE.MeshStandardMaterial({ color: 0xdff1f7, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.72, emissive: new THREE.Color(0x9ec6d8), emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 8, 16), wm);
  const pos = sheet.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const k = 1 - (y + H / 2) / H;         // 顶部不动、下部摆
    pos.setZ(i, (smoothNoise(x * 0.9 + p.seed, 3) + smoothNoise(y * 1.7 - p.seed, 8) * 0.6) * 0.22 * k);
  }
  sheet.geometry.computeVertexNormals();
  sheet.position.set(0, H / 2, 0);
  g.add(sheet);
  g.add(box(W * 1.3, 0.4, 1.4, M.stone(0xbdb6ab, 0.9), 0, H, 0));
  const pool = new THREE.Mesh(new THREE.CircleGeometry(W * 0.85, 26), M.water(0x2c5a70));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.06, W * 0.55);
  g.add(pool);
  const mist = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 * p.mist, roughness: 1, emissive: new THREE.Color(0xcfe6ef), emissiveIntensity: 0.2 });
  for (let i = 0; i < 5; i++) {
    const s = sph(W * (0.3 + rng() * 0.3), mist, 8, (rng() - 0.5) * W, 0.6 + rng() * 1.6, W * 0.5 + rng() * W * 0.4);
    s.scale.y = 0.6;
    g.add(s);
  }
  g.userData.glow = [wm];
  return shade(g, true, false);
}
function buildStonePath(p) {
  const g = new THREE.Group();
  const rng = makeRng(p.seed);
  const m = M.stone(new THREE.Color(p.color).getHex(), 0.93);
  for (let i = 0; i < p.count; i++) {
    const t = i / Math.max(1, p.count - 1);
    const along = (t - 0.5) * p.length;
    const off = Math.sin(t * Math.PI) * (p.curve || 0) + (rng() - 0.5) * 0.35;
    const s = box(0.7 + rng() * 0.5, 0.09, 0.5 + rng() * 0.3, m, 0, 0.045, 0);
    s.rotation.y = (rng() - 0.5) * 0.5;
    if (p.axis === 'z') { s.position.set(off, 0.045, along); s.rotation.y += Math.PI / 2; }
    else s.position.set(along, 0.045, off);
    g.add(s);
  }
  return shade(g, false, true);
}
function buildGardenStone(p) {
  const g = new THREE.Group();
  const m = M.stone(new THREE.Color(p.color).getHex(), 0.85);
  m.flatShading = true;
  const geo = weld(new THREE.IcosahedronGeometry(p.r, 2));
  const pos = geo.attributes.position;
  const rng = makeRng(p.seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = Math.sin(v.x * 3.1 + p.seed) * Math.cos(v.y * 2.7) * Math.sin(v.z * 3.4);
    v.multiplyScalar(1 + n * 0.28);          // 只保留这份连续场（旧版再叠逐顶点 rng() → 碎片互相脱离）
    v.y *= p.tall;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const o = new THREE.Mesh(geo, m);
  o.position.y = p.r * p.tall * 0.8;
  o.rotation.y = rng() * 3;
  g.add(o);
  g.add(cyl(p.r * 0.9, p.r, 0.2, M.stone(0x9c978d, 0.9), 12, 0, 0.1, 0));
  return shade(g);
}

export const GROUP_NATURE = {
  cat: '自然', id: 'nat', items: [
    { type: 'mountain', name: '山峰', icon: 'mount', build: buildMountain, params: [PR('r', '底半径 m', 8, 160, 2, 42), PR('h', '高度 m', 6, 140, 2, 38), PR('noise', '起伏', 0, 0.6, 0.02, 0.24), PR('squash', '纵横比', 0.5, 1.6, 0.05, 1), PB('ridges', '侧峰', true), PR('snow', '雪线', 0, 0.6, 0.02, 0.22), PC('rock', '岩色', '#6b6f77'), PC('snowColor', '雪色', '#eaf1f6'), PI('seed', '种子', 1, 999, 1, 7)] },
    { type: 'hill', name: '丘陵', icon: 'mount', build: buildMountain, params: [PR('r', '底半径 m', 10, 120, 2, 34), PR('h', '高度 m', 2, 26, 1, 8), PR('noise', '起伏', 0, 0.5, 0.02, 0.3), PR('squash', '纵横比', 0.6, 2, 0.05, 1.4), PB('ridges', '侧峰', false), PR('snow', '雪线', 0, 0.4, 0.02, 0), PC('rock', '草色', '#5c7442'), PC('snowColor', '雪色', '#eaf1f6'), PI('seed', '种子', 1, 999, 1, 13)] },
    { type: 'cliff', name: '断崖', icon: 'cliff', build: buildCliff, params: [PR('length', '长度 m', 8, 200, 4, 46), PR('height', '高度 m', 4, 90, 1, 18), PR('depth', '进深 m', 3, 40, 1, 12), PB('shelf', '平台', true), PB('berm', '崖脚碎石', true), PC('rock', '岩色', '#7c756b'), PI('seed', '种子', 1, 999, 1, 5)] },
    { type: 'boulder', name: '巨石', icon: 'rock', build: buildBoulder, params: [PR('r', '半径 m', 0.4, 9, 0.2, 1.8), PR('rough', '粗糙度', 0, 0.8, 0.02, 0.3), PR('squash', '压扁', 0.5, 1.2, 0.02, 0.8), PB('moss', '苔藓', true), PC('color', '石色', '#8f8a80'), PC('mossColor', '苔色', '#4d7043'), PI('seed', '种子', 1, 99, 1, 3)] },
    { type: 'rockpile', name: '乱石堆', icon: 'rock', build: buildRockPile, params: [PI('count', '块数', 3, 40, 1, 12), PR('size', '大小 m', 0.3, 4, 0.1, 1.1), PR('spread', '范围 m', 2, 40, 1, 8), PB('moss', '苔藓', true), PC('color', '石色', '#8f8a80'), PC('mossColor', '苔色', '#4d7043'), PI('seed', '种子', 1, 99, 1, 9)] },
    { type: 'stonearch', name: '天生石门', icon: 'cliff', build: buildArch, params: [PR('span', '跨距 m', 4, 40, 1, 14), PR('height', '高度 m', 4, 40, 1, 11), PR('thick', '厚 m', 0.6, 6, 0.2, 1.8), PC('color', '岩色', '#8a8377'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'floatingrock', name: '浮空仙岛', icon: 'float', build: buildFloatingRock, params: [PR('r', '半径 m', 1.5, 30, 0.5, 7), PR('height', '悬浮高 m', 0, 60, 1, 12), PI('chunks', '岛块数', 1, 7, 1, 3), PR('spread', '散布 m', 2, 80, 1, 24), PR('gap', '层间距 m', 1, 20, 0.5, 7), PB('grass', '顶面草被', true), PB('waterfall', '垂瀑', false), PR('fallH', '瀑布长 m', 2, 40, 1, 12), PB('spin', '悬浮呼吸动画', false), PC('color', '岩色', '#7b7268'), PC('grassColor', '草色', '#4f7a44'), PC('treeColor', '树色', '#3f6b3c'), PI('seed', '种子', 1, 99, 1, 6)] },
    { type: 'tree', name: '针叶松', icon: 'pine', build: buildTree, params: [PS('kind', '树形', [{ v: 'pine', l: '松' }, { v: 'ball', l: '阔叶' }, { v: 'willow', l: '垂柳' }, { v: 'dead', l: '枯木' }, { v: 'bamboo', l: '竹丛' }, { v: 'snow', l: '雪松' }], 'pine'), PR('height', '高度 m', 1.5, 24, 0.5, 8), PC('color', '叶色', '#3d6b3a'), PC('bark', '皮色', '#5a4636'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'bush', name: '灌木丛', icon: 'bush', build: buildBush, params: [PR('size', '大小 m', 0.3, 3, 0.1, 0.9), PI('blobs', '团数', 2, 12, 1, 5), PC('color', '叶色', '#4a7040'), PI('seed', '种子', 1, 99, 1, 2)] },
    { type: 'grass', name: '草地', icon: 'grass', build: buildGrass, params: [PR('w', '宽 m', 2, 80, 1, 16), PR('d', '深 m', 2, 80, 1, 16), PR('height', '草高 m', 0.15, 1.2, 0.05, 0.5), PI('density', '密度', 20, 900, 10, 260), PC('color', '草色', '#63833f'), PI('seed', '种子', 1, 99, 1, 8)] },
    { type: 'flowers', name: '花田', icon: 'flower', build: buildFlowers, params: [PR('w', '宽 m', 2, 60, 1, 14), PR('d', '深 m', 2, 60, 1, 10), PI('count', '朵数', 20, 2000, 20, 320), PR('height', '株高 m', 0.15, 1.1, 0.05, 0.42), PC('colors', '花色（逗号分隔）', '#e8556f,#f2c14e,#f5f1e8,#a66bd8'), PI('seed', '种子', 1, 99, 1, 5)] },
    { type: 'reeds', name: '芦苇荡', icon: 'grass', build: buildReeds, params: [PR('w', '宽 m', 2, 50, 1, 12), PR('d', '深 m', 2, 50, 1, 8), PI('count', '根数', 20, 700, 10, 220), PR('height', '高 m', 0.8, 3.5, 0.1, 2.1), PB('heads', '穗', true), PC('color', '色', '#8f9a5f'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'log', name: '倒木', icon: 'log', build: buildLog, params: [PR('length', '长 m', 1.5, 18, 0.5, 6), PR('r', '半径 m', 0.1, 1.1, 0.05, 0.34), PB('stump', '带树桩', true), PC('color', '皮色', '#5a4636')] },
    { type: 'crops', name: '农田', icon: 'crop', build: buildCrops, params: [PR('w', '宽 m', 4, 120, 2, 26), PR('d', '深 m', 4, 120, 2, 20), PR('height', '作物高 m', 0.3, 2.2, 0.05, 1), PR('gap', '行距 m', 0.4, 3, 0.1, 0.9), PB('rows', '起垄', true), PC('color', '作物色', '#c9a94a'), PC('soil', '土色', '#6b5340'), PI('seed', '种子', 1, 99, 1, 6)] },
    { type: 'cactus', name: '仙人掌群', icon: 'cactus', build: buildCactus, params: [PR('height', '高度 m', 0.8, 6, 0.1, 2.6), PI('arms', '分枝', 0, 5, 1, 2), PC('color', '绿色', '#4e7a4a'), PI('seed', '种子', 1, 99, 1, 5)] },
    { type: 'crystal', name: '灵晶簇', icon: 'crystal', build: buildCrystal, params: [PR('size', '尺度 m', 0.4, 12, 0.2, 2.4), PI('shards', '晶柱数', 3, 16, 1, 7), PR('glow', '自发光', 0, 4, 0.1, 1.4), PC('color', '晶色', '#7fe0ff'), PI('seed', '种子', 1, 99, 1, 9)] },
    { type: 'pond', name: '水塘', icon: 'pond', build: buildPond, params: [PR('r', '半径 m', 2, 60, 1, 9), PC('color', '水色', '#2b5f78'), PC('rim', '岸色', '#8f8a80'), PI('rocks', '岸边石', 0, 20, 1, 7), PB('lily', '荷叶', true), PI('seed', '种子', 1, 99, 1, 3)] },
    { type: 'waterfall', name: '瀑布 + 水潭', icon: 'fall', build: buildWaterfall, params: [PR('width', '宽度 m', 1.5, 30, 0.5, 6), PR('height', '落差 m', 2, 60, 1, 12), PR('mist', '水雾', 0, 2, 0.1, 1), PI('seed', '种子', 1, 99, 1, 5)] },
    { type: 'stonepath', name: '石板小径', icon: 'path', build: buildStonePath, params: [PR('length', '长度 m', 4, 120, 2, 26), PI('count', '石板数', 4, 90, 2, 20), PR('curve', '弯曲 m', -6, 6, 0.5, 2), PS('axis', '走向', [{ v: 'x', l: '沿 X' }, { v: 'z', l: '沿 Z' }], 'x'), PC('color', '石色', '#a9a49a'), PI('seed', '种子', 1, 99, 1, 7)] },
    { type: 'gardenstone', name: '太湖石', icon: 'rock', build: buildGardenStone, params: [PR('r', '半径 m', 0.4, 6, 0.1, 1.15), PR('tall', '纵向拉伸', 0.7, 2.4, 0.05, 1.3), PC('color', '石色', '#9ba4aa'), PI('seed', '种子', 1, 99, 1, 4)] },
  ],
};

export const GROUPS = [GROUP_NATURE];
