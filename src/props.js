// ---------------------------------------------------------------------------
// 题材道具：战争 / 星际科幻 / 玄幻特效（传送阵、天灯、云海、星空）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { M, shade, box, cyl, sph, cone, planeXZ, scatter, ring } from './geo.js';
import { clamp, makeRng, smoothNoise } from './util.js';

const PI = (k, l, min, max, step, def) => ({ k, l, t: 'int', min, max, step, def });
const PR = (k, l, min, max, step, def) => ({ k, l, t: 'range', min, max, step, def });
const PC = (k, l, def) => ({ k, l, t: 'color', def });
const PB = (k, l, def) => ({ k, l, t: 'bool', def });
const PS = (k, l, opts, def) => ({ k, l, t: 'sel', opts, def });

// ==================================================================== 战争 ===
function buildTrench(p) {
  const g = new THREE.Group();
  const dirt = M.paint(new THREE.Color(p.soil).getHex(), 0.96);
  dirt.side = THREE.DoubleSide;
  const segs = Math.max(2, Math.round(p.length / 4));
  const rng = makeRng(p.seed);
  for (let i = 0; i < segs; i++) {
    const z0 = (i / segs - 0.5) * p.length, z1 = ((i + 1) / segs - 0.5) * p.length;
    const bend = (rng() - 0.5) * p.wobble;
    const mid = (z0 + z1) / 2;
    for (const s of [-1, 1]) {
      const wall = box(p.wallT, p.depth, Math.abs(z1 - z0) * 1.06, dirt, s * (p.w / 2 + p.wallT / 2), -p.depth / 2, mid);
      wall.rotation.y = s * 0.06; wall.position.x += s * bend * 0.4;
      g.add(wall);
    }
    g.add(box(p.w, 0.14, Math.abs(z1 - z0) * 1.06, dirt, bend * 0.4, -p.depth + 0.07, mid));
    if (p.boards) {
      // 踏板顺着沟底铺（旧版横着两块、还跟着 bend 偏移，斜插进两侧土壁里）
      const bm = M.paint(0x6b5540, 0.9);
      const sl = Math.abs(z1 - z0) * 1.0;
      g.add(box(p.w * 0.96, 0.06, sl, bm, 0, -p.depth + 0.17, mid));
      for (const kx of [-0.3, 0.3]) g.add(box(p.w * 0.28, 0.03, sl, M.paint(0x5a4634, 0.92), kx * p.w, -p.depth + 0.21, mid));
    }
  }
  if (p.sandbags) {
    const sm = M.paint(0x8a7c5c, 0.92);
    for (const s of [-1, 1]) for (let i = 0; i < Math.round(p.length / 1.1); i++) {
      const z = (i / Math.round(p.length / 1.1) - 0.5) * p.length;
      // 沙袋压在「墙顶」沿口上、长边沿沟向（旧版是横躺在沟沿内侧，一半悬在通道上方）
      for (let k = 0; k < 2; k++) {
        const b = box(0.44, 0.28, 1.05, sm, s * (p.w / 2 + 0.24 + k * 0.42), 0.14 + k * 0.27, z);
        b.rotation.y = (rng() - 0.5) * 0.1; b.rotation.x = s * 0.04;
        g.add(b);
      }
    }
  }
  if (p.wire) {
    // 蛇腹铁丝网架在壕外的斜面上（旧版直接落在原点：横贯战壕、立在走道上）
    const br = buildBarbed({ length: p.length * 0.92, posts: Math.max(3, Math.round(p.length / 9)), height: 1.0, color: '#4a4f55' });
    br.rotation.y = Math.PI / 2;
    br.position.set(-(p.w / 2 + p.wallT + 1.15), 0, 0);
    g.add(br);
  }
  return shade(g, false, true);
}
function buildSandbagWall(p) {
  const g = new THREE.Group();
  const sm = M.paint(new THREE.Color(p.color).getHex(), 0.94);
  const rng = makeRng(p.seed);
  const per = Math.max(2, Math.round(p.length / 1.05));
  for (let i = 0; i < per; i++) {
    const x = (i / per - 0.5) * p.length + (rng() - 0.5) * 0.08;
    for (let k = 0; k < p.rows; k++) {
      const b = box(1.0, 0.3, p.thick - k * 0.04, sm, x + (k % 2 ? 0.16 : 0), 0.15 + k * 0.29, 0);
      b.rotation.y = (rng() - 0.5) * 0.12;
      g.add(b);
    }
  }
  return shade(g);
}
function buildBarbed(p) {
  const g = new THREE.Group();
  const m = M.metal(new THREE.Color(p.color).getHex(), 0.45, 0.75);
  const per = Math.max(2, p.posts);
  for (let i = 0; i <= per; i++) {
    const x = (i / per - 0.5) * p.length;
    g.add(box(0.08, p.height, 0.08, m, x, p.height / 2, 0));
    if (i < per) {
      const mid = x + p.length / per / 2;
      for (let k = 0; k < 3; k++) {
        const y = p.height * (0.35 + k * 0.25);
        const w = cyl(0.012, 0.012, p.length / per, m, 4, mid, y, 0);
        w.rotation.z = Math.PI / 2;
        g.add(w);
        for (let b = 0; b < 5; b++) {
          const bx = x + (b + 0.5) * (p.length / per / 5);
          const s = box(0.12, 0.02, 0.02, m, bx, y, 0);
          s.rotation.z = 0.7;
          g.add(s);
          const s2 = s.clone(); s2.rotation.z = -0.7;
          g.add(s2);
        }
      }
    }
  }
  return shade(g, false, false);
}
function buildBunker(p) {
  const g = new THREE.Group();
  const c = M.concrete(new THREE.Color(p.color).getHex(), 0.95);
  g.add(box(p.w, p.h, p.d, c, 0, p.h / 2 - 0.2, 0));
  g.add(box(p.w * 1.1, 0.34, p.d * 1.1, c, 0, p.h - 0.05, 0));
  const em = M.paint(0x14181d, 0.9);
  for (const s of [-1, 1]) g.add(box(p.w * 0.26, 0.3, 0.2, em, s * p.w * 0.24, p.h * 0.6, p.d / 2));
  g.add(box(p.w * 0.2, p.h * 0.5, 0.22, em, 0, p.h * 0.25, p.d / 2));
  if (p.cupola) {
    const t = cyl(p.w * 0.16, p.w * 0.18, 0.9, c, 12, p.w * 0.2, p.h + 0.4, 0);
    g.add(t);
    g.add(box(0.9, 0.16, 0.16, M.metal(0x3a4048, 0.4, 0.6), p.w * 0.2, p.h + 0.75, 0));
  }
  if (p.rubble) {
    // 碎块沿墙脚一圈、咬进墙身 10cm —— 旧版随机散到 2m 外成悬浮独立块
    const rng = makeRng(p.seed);
    for (let i = 0; i < 8; i++) {
      const rx = 0.4 + rng() * 0.9, rz = 0.4 + rng() * 0.8;
      const along = (rng() - 0.5) * 0.8;
      const side = i % 4;
      const px = side < 2 ? (side === 0 ? 1 : -1) * (p.w / 2 + 0.1) : along * p.w * 0.5;
      const pz = side < 2 ? along * p.d * 0.5 : (side === 2 ? 1 : -1) * (p.d / 2 + 0.1);
      g.add(box(rx, 0.2 + rng() * 0.4, rz, c, px, 0.12, pz));
    }
  }
  return shade(g);
}
function buildTank(p) {
  const g = new THREE.Group();
  const body = M.paint(new THREE.Color(p.color).getHex(), 0.62, 0.28);
  const dark = M.dark(0x1d2126, 0.75);
  const L = p.length, W = p.width, H = p.hull;
  g.add(box(W, H, L, body, 0, H / 2 + 0.28, 0));
  g.add(box(W, 0.36, L * 1.02, dark, 0, 0.18, 0));
  for (const s of [-1, 1]) {
    const tr = box(0.34, 0.62, L * 0.98, dark, s * (W / 2 + 0.12), 0.34, 0);
    g.add(tr);
    for (let i = 0; i < 6; i++) {
      const w = cyl(0.3, 0.3, 0.16, M.metal(0x585f66, 0.5, 0.6), 12, s * (W / 2 + 0.12), 0.34, (i / 5 - 0.5) * L * 0.88);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  const tur = new THREE.Group();
  tur.add(box(W * 0.86, 0.44, L * 0.5, body, 0, 0.22, -L * 0.05));
  const barrel = cyl(0.09, 0.11, p.barrel, body, 12, 0, 0.22, -(L * 0.2 + p.barrel / 2));
  barrel.rotation.x = Math.PI / 2 - p.elev;
  tur.add(barrel);
  tur.add(cyl(0.14, 0.14, 0.4, body, 12, 0, 0.24, -(L * 0.2 + p.barrel)));
  tur.add(cyl(0.1, 0.1, 0.3, dark, 8, W * 0.2, 0.5, -L * 0.02));
  tur.position.y = H + 0.28;
  tur.rotation.y = p.turret;
  g.add(tur);
  if (p.smoke) {
    const sm = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.42, roughness: 1, emissive: new THREE.Color(0x1a1a1a), emissiveIntensity: 0.1 });
    const rng = makeRng(3);
    for (let i = 0; i < 6; i++) {
      const s = sph(0.6 + rng() * 1.4, sm, 8, (rng() - 0.5) * 2.4, H + 1 + i * 1.5, (rng() - 0.5) * 2);
      s.scale.set(1, 0.8, 1);
      g.add(s);
    }
  }
  return shade(g);
}
function buildArtillery(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.6, 0.3);
  const dark = M.dark(0x22262c, 0.7);
  g.add(box(2.4, 0.5, 3.2, m, 0, 0.7, 0));
  for (const s of [-1, 1]) for (const z of [-1, 1]) g.add(box(0.18, 1.4, 0.18, dark, s * 1.2, 0.7, z * 1.7));
  for (const s of [-1, 1]) {
    const w = cyl(0.55, 0.55, 0.3, dark, 14, s * 1.25, 0.55, 0);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  // 炮管绕炮架枢轴仰俯：几何平移到「尾端在枢轴」，再整体旋转 —— 旧版绕自身中心转，炮管飞出炮架
  const piv = new THREE.Group();
  piv.position.set(0, 1.05, 0.7);
  piv.rotation.x = -(Math.PI / 2 - p.elev);
  const bar = cyl(0.13, 0.16, p.barrel, m, 12);
  bar.geometry.translate(0, p.barrel / 2 - 0.3, 0);
  piv.add(bar);
  piv.add(cyl(0.2, 0.24, 0.5, dark, 10, 0, p.barrel - 0.15, 0));          // 炮口箍（同轴套在管口）
  g.add(piv);
  g.add(box(0.6, 0.5, 0.8, m, 0, 1.2, 1.2));
  return shade(g);
}
function buildTent(p) {
  const g = new THREE.Group();
  const cl = M.paint(new THREE.Color(p.color).getHex(), 0.9);
  cl.side = THREE.DoubleSide;
  const R = Math.max(0.4, p.w / 2);
  // 半圆拱帆布：圆柱轴转到 Z（帐篷长向），θ 从 -90° 到 +90° → 拱跨在整个宽度上、只朝上，底面正好落在 y=0
  const a = new THREE.Mesh(new THREE.CylinderGeometry(R, R, p.length, 8, 1, true, -Math.PI / 2, Math.PI), cl);
  a.rotation.x = -Math.PI / 2;
  a.scale.set(1, 1, p.height / R);                  // 把半圆压成设定的顶高
  a.position.y = 0;
  g.add(a);
  g.add(box(0.06, p.height, 0.06, M.paint(0x5a4636, 0.85), 0, p.height / 2, p.length / 2 - 0.1));
  g.add(box(0.06, p.height, 0.06, M.paint(0x5a4636, 0.85), 0, p.height / 2, -p.length / 2 + 0.1));
  g.add(planeXZ(p.w, p.length, M.paint(0x6d6a63, 0.95), 0, 0.015, 0));
  return shade(g, false, true);
}
function buildFlagpole(p) {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.09, p.height, M.metal(0x9aa2ab, 0.4, 0.7), 8, 0, p.height / 2, 0));
  g.add(sph(0.14, M.metal(0xd8c07a, 0.3, 0.9), 8, 0, p.height + 0.1, 0));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(p.flagW, p.flagH, 14, 6), M.paint(new THREE.Color(p.flag).getHex(), 0.86));
  cloth.material.side = THREE.DoubleSide;
  const pos = cloth.geometry.attributes.position;
  const rng = makeRng(p.seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 2.4 + p.seed + y * 0.7) * 0.16 * (x + p.flagW / 2) + y * 0.02);   // 连续场，布面不再破洞
  }
  cloth.geometry.computeVertexNormals();
  cloth.position.set(p.flagW / 2 + 0.06, p.height - p.flagH / 2 - 0.2, 0);
  g.add(cloth);
  return shade(g, true, false);
}
function buildCrater(p) {
  const g = new THREE.Group();
  const dirt = M.paint(new THREE.Color(p.soil).getHex(), 0.96);
  dirt.side = THREE.DoubleSide;
  const geo = new THREE.RingGeometry(p.r * 0.28, p.r, 26, 3);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const rng = makeRng(p.seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z) / p.r;
    const y = d < 0.62 ? -p.depth * (1 - d / 0.62) : p.rim * Math.exp(-Math.pow((d - 0.78) / 0.24, 2));
    // 起伏只随「方位角 + 半径」变化（周期偶函数）→ 环带接缝与每圈不会互相撕开
    const a = Math.atan2(z, x);
    const wn = smoothNoise(Math.cos(a) * 2.6 + p.seed, p.seed + 4) + smoothNoise(Math.cos(a * 2 + 1.2), p.seed + 9) * 0.5;
    const wd = smoothNoise(d * 5.5 - p.seed, p.seed + 6);
    pos.setY(i, y + wn * 0.1 + wd * 0.05 + (1 - d) * 0.02);
    pos.setX(i, x * (1 + wn * 0.05));
    pos.setZ(i, z * (1 + wn * 0.05));
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, dirt));
  if (p.scorch) {
    const sc = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 1, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
    const s2 = new THREE.Mesh(new THREE.CircleGeometry(p.r * 1.5, 22), sc);
    s2.rotation.x = -Math.PI / 2; s2.position.y = 0.005;
    g.add(s2);
  }
  return shade(g, false, true);
}
function buildRuin(p) {
  const g = new THREE.Group();
  const wallM = M.paint(new THREE.Color(p.wall).getHex(), 0.93);
  wallM.side = THREE.DoubleSide;
  const rng = makeRng(p.seed);
  const floors = Math.max(1, p.floors);
  const allTops = [];                                   // 每面残墙的顶标高：给楼板 / 歪梁当支座
  const sups = [];                                        // 已立起来的残墙段（轴线 / 沿墙区间 / 墙顶），给上一层找基座
  for (let f = 0; f < floors; f++) {
    const y = f * p.floorH;
    const intact = clamp(p.intact - f * 0.12, 0.08, 1);
    const tops = [];
    for (const side of [0, 1, 2, 3]) {
      if (rng() > intact + 0.25) continue;
      const len = side % 2 ? p.d : p.w;
      const t = rng() * 0.4 + 0.4;
      const w2 = len * t;
      const brokenTop = y + p.floorH * (0.4 + rng() * 0.6);      // 断口标高
      // 残墙不能凭空立着：往下找同一面墙（同轴线、沿墙方向有重叠）最近的墙顶当基座，找不到就落到地面
      const axis = side % 2 ? 'z' : 'x';
      const line = side === 0 ? -p.d / 2 : side === 2 ? p.d / 2 : side === 1 ? p.w / 2 : -p.w / 2;
      const off = (rng() - 0.5) * (len - w2);
      let base = 0;
      for (const sp of sups) {
        if (sp.axis !== axis || Math.abs(sp.line - line) > 0.02) continue;
        if (Math.abs(sp.off - off) > sp.hw + w2 / 2) continue;
        if (sp.top <= y + 1e-3 && sp.top > base) base = sp.top;
      }
      const hh = Math.max(0.2, brokenTop - base);
      const b = box(side % 2 ? 0.22 : w2, hh, side % 2 ? w2 : 0.22, wallM, 0, base + hh / 2, 0);
      if (side === 0 || side === 2) b.position.set(off, base + hh / 2, line);
      else b.position.set(line, base + hh / 2, off);
      g.add(b);
      sups.push({ axis, line, off, hw: w2 / 2, top: brokenTop });
      tops.push(brokenTop);
      allTops.push({ x: b.position.x, y: brokenTop, z: b.position.z, side });
      if (rng() > 0.5) {                                 // 洞口只在墙厚内（旧版 0.4 比墙 0.22 厚一倍，两块黑皮露在墙面外）
        const hole = box(side % 2 ? 0.26 : w2 * 0.4, hh * 0.4, side % 2 ? w2 * 0.4 : 0.26, M.dark(0x14181d, 0.95), b.position.x, base + hh * 0.45, b.position.z);
        g.add(hole);
      }
    }
    // 残破楼板：至少两面墙顶够到本层标高才铺，板就压在最低的支承上（旧版按整层高度悬空浮着）
    if (tops.length >= 2 && rng() > 1 - intact) {
      const ySup = Math.min(...tops);
      if (ySup - y > p.floorH * 0.4) {
        g.add(box(p.w * 0.9, 0.16, p.d * 0.9, wallM, 0, ySup - 0.08, 0));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {          // 板底碎支撑（断掉的梁头）
          if (rng() > 0.55) continue;
          g.add(box(0.24, Math.max(0.1, ySup - y - 0.16), 0.24, wallM, sx * p.w * 0.3, (ySup - 0.16 + y) / 2, sz * p.d * 0.3));
        }
      }
    }
  }
  const debris = M.paint(new THREE.Color(p.wall).getHex(), 0.95);
  for (let i = 0; i < p.rubble * 4; i++) {
    const b = box(0.3 + rng() * 1.3, 0.2 + rng() * 0.5, 0.3 + rng() * 1.1, debris, (rng() - 0.5) * p.w * 2.4, 0.12, (rng() - 0.5) * p.d * 2.4);
    b.rotation.set(rng() * 0.4, rng() * 3, rng() * 0.4);
    g.add(b);
  }
  if (p.beam) {
    // 歪梁：一端搭在残墙顶上、另一端杵到地面瓦砾（旧版是一根 1.6w 长的梁横在半空穿墙而过）
    const bm = M.metal(0x5a4a3a, 0.6, 0.5);
    const ex = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < 2; i++) {
      const sup = allTops.length ? allTops[Math.floor(rng() * allTops.length)] : { x: 0, y: 0.5, z: 0, side: 0 };
      const alongX = sup.side % 2 === 0;
      const sgn = -(Math.sign(alongX ? sup.x : sup.z) || 1);
      const run = (alongX ? p.w : p.d) * 1.04;
      const p0 = new THREE.Vector3(sup.x, sup.y - 0.05, sup.z);
      const off = (rng() - 0.5) * (alongX ? p.d : p.w) * 0.4;
      const p1 = new THREE.Vector3(alongX ? p0.x + sgn * run : off, 0.16 + rng() * 0.3, alongX ? off : p0.z + sgn * run);
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      const b = box(1, 0.28, 0.28, bm, 0, 0, 0);
      b.scale.x = Math.max(0.6, len);
      b.position.copy(p0).addScaledVector(dir, 0.5);
      b.quaternion.setFromUnitVectors(ex, dir.normalize());
      g.add(b);
      g.add(box(0.5, 0.14, 0.6, M.paint(0x8b8177, 0.95), p1.x, 0.07, p1.z));   // 落点碎块
    }
  }
  return shade(g);
}
function buildWatchtower(p) {
  const g = new THREE.Group();
  const m = M.metal(0x6f757c, 0.5, 0.7);
  const H = p.height, W = p.foot;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.16, H, 0.16, m, sx * W / 2, H / 2, sz * W / 2));
  for (let k = 0; k < Math.floor(H / 2.2); k++) {
    const y = 1.1 + k * 2.2;
    for (const s of [-1, 1]) {
      const b = box(W, 0.09, 0.09, m, 0, y, s * W / 2);
      g.add(b);
      const b2 = box(0.09, 0.09, W, m, s * W / 2, y, 0);
      g.add(b2);
      // 斜撑：从下一道横杆（第一道从地面起）斜拉到这一道，长度/角度按实际层高算
      // 旧版是定长 W×1.4 定角 0.5rad 的杆，最下一根会斜插到地面以下 1m
      const y0 = k === 0 ? 0 : 1.1 + (k - 1) * 2.2, hb = y - y0;
      const d = box(Math.hypot(W, hb), 0.07, 0.07, m, 0, (y0 + y) / 2, s * W / 2);
      d.rotation.z = s * Math.atan2(hb, W);
      g.add(d);
    }
  }
  // 平台 / 岗亭 / 屋顶一层压一层坐在柱顶上（旧版平台悬在柱顶上方 0.6m，岗亭又离平台 0.07m，整组浮空）
  const deckY = H + 0.08;
  g.add(box(W + 1.2, 0.16, W + 1.2, M.paint(0x3a4048, 0.7), 0, deckY, 0));
  g.add(box(W + 0.6, 1.1, W + 0.6, M.paint(0x2f353d, 0.75), 0, deckY + 0.63, 0));
  const roof = cone((W + 1.6) * 0.85, 0.9, M.paint(0x454c55, 0.7), 4, 0, deckY + 1.63, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  if (p.light) {
    const lm = M.glow(p.lightColor, 2.6);
    g.add(box(0.5, 0.4, 0.5, lm, 0, deckY + 0.63, W / 2 + 0.55));
    g.userData.glow = [lm];
  }
  return shade(g);
}
function buildHesco(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.95);
  const rng = makeRng(p.seed);
  const per = Math.max(1, Math.round(p.length / 3.1));
  for (let i = 0; i < per; i++) {
    const x = (i / per - 0.5) * p.length + 1.55;
    for (let k = 0; k < p.rows; k++) {
      const b = box(3.0, 0.62, p.thick, m, x, 0.31 + k * 0.62, (k % 2 ? 0.06 : -0.06));
      b.rotation.y = (rng() - 0.5) * 0.02;
      g.add(b);
    }
    if (p.wire) g.add(cyl(0.02, 0.02, 0.5, M.metal(0x8b9299, 0.4, 0.8), 4, x - 1.2, p.rows * 0.62 + 0.25, 0));
  }
  return shade(g);
}
function buildWreck(p) {
  const g = new THREE.Group();
  const burnt = M.paint(0x25282c, 0.94);
  const rng = makeRng(p.seed);
  g.add(box(2.1, 0.7, 4.4, burnt, 0, 0.45, 0));
  const cab = box(1.9, 0.8, 1.8, burnt, 0, 1.1, -0.4);
  cab.rotation.set(0.1, rng() * 0.3, 0.12);
  g.add(cab);
  for (const [x, z] of [[-1.05, -1.5], [1.05, 1.4]]) {
    const w = cyl(0.42, 0.42, 0.3, M.dark(0x14171b, 0.9), 12, x, 0.2, z);
    w.rotation.z = Math.PI / 2; w.rotation.y = rng();
    g.add(w);
  }
  if (p.smoke) {
    const sm = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.36, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const s = sph(0.5 + rng() * 1.2, sm, 7, (rng() - 0.5) * 1.4, 1.8 + i * 1.2, (rng() - 0.5) * 1.4);
      g.add(s);
    }
  }
  if (p.fire) {
    const fm = M.glow(0xff7a2a, 2.4);
    for (let i = 0; i < 3; i++) g.add(cone(0.3 + rng() * 0.2, 0.6 + rng() * 0.6, fm, 6, (rng() - 0.5) * 1.2, 0.9, (rng() - 0.5) * 2));
    g.userData.glow = [fm];
  }
  return shade(g);
}

// ================================================================== 星际 ===
function buildPlanet(p) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(p.r, 48, 32);
  // Node 无 document：回退纯色材质，保证出图/体检流水线能构建（浏览器仍走程序化云带贴图）
  let mat;
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    const cx = cv.getContext('2d');
    const a = new THREE.Color(p.color), b = new THREE.Color(p.color2);
    const rng = makeRng(p.seed);
    cx.fillStyle = `#${b.getHexString()}`; cx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {
      const t = rng();
      const c = a.clone().lerp(b, t);
      cx.fillStyle = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${0.25 + rng() * 0.5})`;
      cx.beginPath();
      cx.ellipse(rng() * 512, 30 + rng() * 196, 20 + rng() * 120, 8 + rng() * 26, rng() * 0.5, 0, Math.PI * 2);
      cx.fill();
    }
    for (let i = 0; i < 340; i++) {
      cx.fillStyle = `rgba(0,0,0,${rng() * 0.16})`;
      cx.fillRect(rng() * 512, rng() * 256, 2 + rng() * 16, 2 + rng() * 6);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, emissive: new THREE.Color(p.night), emissiveIntensity: p.nightI });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).lerp(new THREE.Color(p.color2), 0.45), roughness: 0.92, metalness: 0, emissive: new THREE.Color(p.night), emissiveIntensity: p.nightI });
  }
  const m = new THREE.Mesh(geo, mat);
  m.rotation.z = p.tilt;
  g.add(m);
  if (p.atmo) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.035, 40, 26), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.atmoColor), transparent: true, opacity: 0.16, side: THREE.BackSide }));
    g.add(shell);
  }
  if (p.rings) {
    const rg = new THREE.Mesh(new THREE.RingGeometry(p.r * 1.5, p.r * 2.4, 64, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.ringColor), transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    rg.rotation.x = -Math.PI / 2 + 0.32;
    rg.rotation.y = p.tilt;
    g.add(rg);
  }
  if (p.moons) for (let i = 0; i < p.moons; i++) {
    const a2 = rng() * Math.PI * 2, d = p.r * (2.8 + rng() * 2.2);
    g.add(sph(p.r * (0.1 + rng() * 0.1), M.concrete(0x9a958c, 0.96), 12, Math.cos(a2) * d, (rng() - 0.5) * p.r, Math.sin(a2) * d));
  }
  return shade(g, false, false);
}
function buildStars(p) {
  const g = new THREE.Group();
  const n = clamp(Math.round(p.count), 200, 40000);
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const rng = makeRng(p.seed);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const R = p.radius * (0.85 + rng() * 0.15);
    arr[i * 3] = Math.cos(th) * s * R; arr[i * 3 + 1] = u * R; arr[i * 3 + 2] = Math.sin(th) * s * R;
    c.setHSL(0.55 + rng() * 0.14, 0.4 * rng(), 0.6 + rng() * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: p.size, vertexColors: true, sizeAttenuation: false, transparent: true, opacity: p.bright, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.userData.pickIgnore = true;
  g.add(pts);
  if (p.milky) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 0.92, 24, 8), new THREE.MeshBasicMaterial({ color: 0x3a4a72, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false }));
    cloud.scale.set(1, 0.22, 1);
    cloud.rotation.z = 0.5;
    cloud.userData.pickIgnore = true;
    g.add(cloud);
  }
  return g;
}
function buildNebula(p) {
  const g = new THREE.Group();
  const rng = makeRng(p.seed);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, opacity: p.opacity, depthWrite: false, side: THREE.DoubleSide });
  const n = clamp(p.puffs, 3, 60);
  for (let i = 0; i < n; i++) {
    const s = sph(p.size * (0.4 + rng() * 1.1), mat, 10, (rng() - 0.5) * p.spread, (rng() - 0.5) * p.spread * 0.4, (rng() - 0.5) * p.spread);
    s.scale.set(1 + rng(), 0.5 + rng() * 0.4, 1 + rng());
    s.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    s.userData.pickIgnore = true;
    g.add(s);
  }
  return g;
}
function buildShip(p) {
  const g = new THREE.Group();
  const hull = M.paint(new THREE.Color(p.hull).getHex(), 0.52, 0.55);
  const dark = M.dark(0x272c33, 0.7, 0.4);
  const L = p.length, W = p.beam, H = p.hullH;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.5, L * 0.72, 6, 16), hull);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 1, H / Math.max(0.2, W));
  g.add(body);
  const nose = cone(W * 0.52, L * 0.3, hull, 16, L * 0.52, 0, 0);
  nose.rotation.z = -Math.PI / 2;
  g.add(nose);
  g.add(box(W * 0.7, H * 0.5, L * 0.34, dark, -L * 0.28, H * 0.42, 0));
  for (const s of [-1, 1]) {
    const wg = box(L * 0.34, 0.1, W * 0.7, hull, -L * 0.06, 0, s * W * 0.78);
    wg.rotation.y = s * 0.28;
    g.add(wg);
    g.add(box(L * 0.1, H * 0.5, W * 0.16, dark, -L * 0.12, -H * 0.3, s * W * 0.6));
  }
  const eng = M.glow(p.engine, p.engineGlow);
  for (const s of [-1, 1]) {
    // g.add() 返回的是 g 自己：链式写 .rotation 会把整架飞机转 90°，发动机只能先建后设
    const nac = cyl(W * 0.16, W * 0.19, L * 0.16, dark, 12, -L * 0.44, 0, s * W * 0.34);
    nac.rotation.z = Math.PI / 2; g.add(nac);
    const noz = cyl(W * 0.13, W * 0.13, 0.12, eng, 12, -L * 0.52, 0, s * W * 0.34);
    noz.rotation.z = Math.PI / 2; g.add(noz);
  }
  if (p.turrets) for (const s of [-1, 1]) {
    g.add(cyl(W * 0.14, W * 0.18, H * 0.24, dark, 10, s * L * 0.16, H * 0.5, 0));
    const c2 = cyl(0.03 * L, 0.04 * L, L * 0.1, dark, 8, s * L * 0.16 + L * 0.06, H * 0.6, 0);
    c2.rotation.z = Math.PI / 2;
    g.add(c2);
  }
  g.userData.glow = [eng];
  g.rotation.y = p.yaw || 0;
  return shade(g);
}
function buildFighter(p) {
  const g = new THREE.Group();
  const hull = M.paint(new THREE.Color(p.hull).getHex(), 0.5, 0.5);
  const dark = M.dark(0x22262c, 0.6, 0.4);
  const L = p.length;
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(L * 0.11, L * 0.56, 5, 12), hull);
  fus.rotation.z = Math.PI / 2;
  g.add(fus);
  const nose = cone(L * 0.12, L * 0.22, hull, 12, L * 0.46, 0, 0);
  nose.rotation.z = -Math.PI / 2;
  g.add(nose);
  const canopy = M.glassy(0x9fd8ff, 0.1, 0.3, 0.6);
  g.add(box(L * 0.2, L * 0.07, L * 0.1, canopy, L * 0.14, L * 0.1, 0));
  for (const s of [-1, 1]) {
    const w = box(L * 0.26, 0.02, L * 0.34, hull, -L * 0.02, 0, s * L * 0.24);
    w.rotation.y = s * 0.34;
    g.add(w);
    const tip = box(0.03, L * 0.12, L * 0.06, dark, -L * 0.1, L * 0.05, s * L * 0.4);
    tip.rotation.x = s * 0.3;
    g.add(tip);
    const fin = box(L * 0.14, L * 0.14, 0.02, hull, -L * 0.3, L * 0.07, s * L * 0.12);
    fin.rotation.y = s * 0.4;
    g.add(fin);
    const noz = cyl(L * 0.05, L * 0.06, L * 0.06, M.glow(p.engine, 2.4), 10, -L * 0.4, 0, s * L * 0.06);
    noz.rotation.z = Math.PI / 2;
    g.add(noz);
  }
  // 落地：旧版整机以原点为中心、机腹沉地 1.4m；现包围盒归零 + 两条着陆撬把机身支到 y=0
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g);
  const root = new THREE.Group();
  g.position.y -= bb.min.y;
  root.add(g);
  const lift = -bb.min.y;
  const skidH = lift - L * 0.11 + 0.03;                       // 撬顶咬入机腹 3cm
  for (const s of [-1, 1]) root.add(box(L * 0.55, skidH, 0.07, dark, -L * 0.06, skidH / 2, s * L * 0.07));
  return shade(root);
}
function buildStation(p) {
  const g = new THREE.Group();
  const hull = M.paint(new THREE.Color(p.hull).getHex(), 0.5, 0.6);
  const dark = M.dark(0x2a2f36, 0.7, 0.4);
  const spine = cyl(p.r * 0.22, p.r * 0.22, p.spine, hull, 18, 0, 0, 0);
  spine.rotation.x = Math.PI / 2;
  g.add(spine);
  const hub = cyl(p.r * 0.34, p.r * 0.34, p.r * 0.5, hull, 20, 0, 0, 0);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  const hab = cyl(p.r * 0.9, p.r * 0.9, p.r * 0.42, hull, 30, 0, 0, 0);
  hab.rotation.x = Math.PI / 2;
  g.add(hab);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = box(p.r * 0.14, p.r * 0.44, p.r * 0.14, dark, Math.cos(a) * p.r * 0.9, 0, Math.sin(a) * p.r * 0.9);
    c.rotation.y = -a;
    g.add(c);
    const win = box(p.r * 0.05, p.r * 0.1, p.r * 0.16, M.glow(0xffe0a8, 1.6), Math.cos(a) * p.r * 1.02, 0, Math.sin(a) * p.r * 1.02);
    win.rotation.y = -a;
    g.add(win);
  }
  for (const s of [-1, 1]) {
    const arm = box(p.r * 1.7, 0.1, p.r * 0.1, hull, s * p.r * 0.9, p.spine * 0.28, 0);
    g.add(arm);
    const panel = box(p.r * 1.3, 0.04, p.r * 0.7, new THREE.MeshStandardMaterial({ color: 0x1c2b47, roughness: 0.35, metalness: 0.5, emissive: new THREE.Color(0x0b1424), emissiveIntensity: 0.4 }), s * p.r * 1.5, p.spine * 0.28, 0);
    g.add(panel);
  }
  g.rotation.x = 0.2;
  return shade(g);
}
function buildDome(p) {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.glass), roughness: 0.12, metalness: 0.1, transparent: true, opacity: p.opacity, side: THREE.DoubleSide, emissive: new THREE.Color(0x1a3a48), emissiveIntensity: 0.2 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(p.r, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  g.add(dome);
  const frame = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.005, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb9c3cc, wireframe: true, transparent: true, opacity: 0.5 }));
  g.add(frame);
  g.add(cyl(p.r * 1.04, p.r * 1.1, 0.5, M.concrete(0x9aa0a8, 0.9), 26, 0, 0.25, 0));
  g.add(planeXZ(p.r * 2, p.r * 2, M.paint(new THREE.Color(p.floor).getHex(), 0.9), 0, 0.52, 0));
  if (p.tubes) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const tr = p.r * 0.08;
    // 管道收进穹顶 footprint、落在基座顶（旧版粗管半埋地下、外端伸出基座悬空）
    const t = cyl(tr, tr, p.r * 0.8, glass, 12, Math.cos(a) * p.r * 0.55, tr + 0.2, Math.sin(a) * p.r * 0.55);
    t.rotation.z = Math.PI / 2; t.rotation.y = -a;
    g.add(t);
  }
  if (p.glow) {
    const lm = M.glow(0xffe6b8, 1.2);
    g.add(cyl(p.r * 0.1, p.r * 0.12, 0.2, lm, 10, 0, p.r * 0.86, 0));
    g.userData.glow = [lm];
  }
  return shade(g);
}
function buildHangar(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.7, 0.35);
  const W = p.w, D = p.d, H = p.h;
  const wallH = Math.max(0.6, H - W / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(-W / 2, wallH);
  shape.absarc(0, wallH, W / 2, Math.PI, 0, true);
  shape.lineTo(W / 2, 0);
  shape.closePath();
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 20 }), m);
  shell.geometry.translate(0, 0, -D / 2);
  g.add(shell);
  for (const s of [-1, 1]) g.add(box(0.34, wallH, 0.4, m, s * (W / 2 + 0.02), wallH / 2, D / 2 + 0.18));
  g.add(box(W, 0.12, D, M.paint(0x5a6169, 0.9), 0, 0.06, 0));
  if (p.door) {
    const dm = M.paint(0x3a4249, 0.6, 0.5);
    for (let i = 0; i < 5; i++) g.add(box(W * 0.86, H * 0.16, 0.16, dm, 0, H * 0.1 + i * H * 0.15, D / 2 - 0.1));
  }
  if (p.lights) {
    const lm = M.glow(0xbfe4ff, 1.6);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.add(box(0.5, 0.08, 0.2, lm, s * W * 0.22, H * 0.6, (i / 2 - 0.5) * D * 0.7));
    g.userData.glow = [lm];
  }
  return shade(g);
}
function buildTurret(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.6, 0.5);
  const dark = M.dark(0x232830, 0.7, 0.4);
  g.add(cyl(p.base, p.base * 1.16, 0.4, m, 16, 0, 0.2, 0));
  g.add(cyl(p.base * 0.6, p.base * 0.7, 0.5, dark, 14, 0, 0.65, 0));
  const head = new THREE.Group();
  head.add(box(p.base * 1.1, p.base * 0.62, p.base * 1.2, m, 0, 0, 0));
  for (const s of [-1, 1]) {
    // 炮管水平指向前方（旧版漏转 90°，竖直插地）
    const b = cyl(p.base * 0.12, p.base * 0.14, p.barrel, dark, 10, s * p.base * 0.3, 0, p.barrel / 2 + p.base * 0.4);
    b.rotation.x = Math.PI / 2;
    head.add(b);
  }
  head.position.y = 1.0;
  head.rotation.y = p.yaw;
  head.rotation.x = -p.pitch;
  g.add(head);
  if (p.laser) {
    const lm = M.glow(0xff5a4a, 2.2);
    head.add(box(p.base * 0.2, p.base * 0.2, p.base * 0.24, lm, 0, p.base * 0.2, p.base * 0.5));
    g.userData.glow = [lm];
  }
  return shade(g);
}
function buildPylon(p) {
  const g = new THREE.Group();
  const stone = M.concrete(new THREE.Color(p.color).getHex(), 0.9);
  const n = Math.max(2, Math.round(p.height / 1.6));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    g.add(box(p.w * (1 - t * 0.42), 1.5, p.w * (1 - t * 0.42), stone, 0, 0.8 + i * 1.5, 0));
  }
  const em = M.glow(p.beam, p.glow);
  const topY = 0.05 + 1.5 * n;                                       // 最上一节的顶面
  g.add(box(p.w * 0.34, p.beamH, p.w * 0.34, em, 0, topY + p.beamH / 2, 0));   // 光柱落在塔顶（旧版悬空 0.75m）
  if (p.shield > 0.05) {                                             // 半径 0 时不必建一个退化球
    const shell = new THREE.Mesh(new THREE.SphereGeometry(p.shield, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.beam), transparent: true, opacity: p.shieldOp, wireframe: true }));
    shell.position.y = p.shield * 0.35;
    shell.scale.y = 0.72;
    g.add(shell);
  }
  g.userData.glow = [em];
  return shade(g);
}
function buildLaunchpad(p) {
  const g = new THREE.Group();
  const c = M.concrete(0x8f938f, 0.95);
  g.add(cyl(p.r, p.r * 1.06, 0.6, c, 30, 0, 0.3, 0));
  g.add(cyl(p.r * 0.55, p.r * 0.55, 0.1, M.paint(0x2b2f36, 0.8), 30, 0, 0.64, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(box(0.5, 3.4, 0.5, M.metal(0xa9aeb4, 0.5, 0.6), Math.cos(a) * p.r * 0.86, 1.7, Math.sin(a) * p.r * 0.86));
    g.add(box(0.24, 0.24, p.r * 0.5, M.metal(0xa9aeb4, 0.5, 0.6), Math.cos(a) * p.r * 0.6, 3.1, Math.sin(a) * p.r * 0.6));
  }
  const lm = M.glow(0xffb04a, 2.2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(box(0.3, 0.2, 0.3, lm, Math.cos(a) * p.r * 1.02, 0.3, Math.sin(a) * p.r * 1.02));
  }
  g.userData.glow = [lm];
  return shade(g);
}
function buildDebris(p) {
  const g = new THREE.Group();
  const m = M.paint(new THREE.Color(p.color).getHex(), 0.72, 0.4);
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.count; i++) {
    const s = 0.6 + rng() * p.size;
    const geo = new THREE.BoxGeometry(s, s * (0.2 + rng() * 0.6), s * (0.4 + rng() * 0.9));
    const b = new THREE.Mesh(geo, m);
    b.position.set((rng() - 0.5) * p.spread, (rng() - 0.5) * p.spread * 0.4, (rng() - 0.5) * p.spread);
    b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(b);
  }
  return shade(g);
}

// ============================================================ 玄幻 / 特效 ===
function buildPortal(p) {
  const g = new THREE.Group();
  const em = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.4, emissive: new THREE.Color(p.color), emissiveIntensity: p.glow, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  // 门环立在基座上、基座落地（旧版整门沉到地下 p.r 米）
  const cy = p.r + 0.24;
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(p.r, p.tube, 12, 44), em);
  ringM.rotation.x = 0;
  ringM.position.y = cy;
  g.add(ringM);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.94, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, opacity: p.fill, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.y = cy;
  g.add(disc);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;                    // 0° 起布：最低符文在 ±60°，不埋进基座
    const rune = box(0.24, 0.7, 0.12, em, Math.cos(a) * p.r * 1.12, cy + Math.sin(a) * p.r * 1.12, 0);
    rune.rotation.z = a;
    g.add(rune);
  }
  const stone = M.stone(0x8f8a80, 0.94);
  g.add(box(p.r * 2.4, 0.28, p.r * 1.2, stone, 0, 0.14, 0));
  g.userData.glow = [em];
  return shade(g, true, false);
}
function buildGlyph(p) {
  const g = new THREE.Group();
  const em = new THREE.MeshStandardMaterial({ color: 0x0a1014, roughness: 0.5, emissive: new THREE.Color(p.color), emissiveIntensity: p.glow, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
  const r = p.r;
  const base = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 60, 1), em);
  base.rotation.x = -Math.PI / 2; base.position.y = 0.02;
  g.add(base);
  const inner = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r * 0.66, 60, 1), em);
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.03;
  g.add(inner);
  const poly = new THREE.Mesh(new THREE.RingGeometry(0, r * 0.6, p.points, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  poly.rotation.x = -Math.PI / 2; poly.position.y = 0.035;
  g.add(poly);
  for (let i = 0; i < p.runes; i++) {
    const a = (i / p.runes) * Math.PI * 2;
    const t = box(r * 0.12, 0.02, r * 0.3, em, Math.cos(a) * r * 0.8, 0.04, Math.sin(a) * r * 0.8);
    t.rotation.y = -a;
    g.add(t);
  }
  if (p.pillars) g.add(ring((i, a) => {
    const hh = r * (0.5 + (i % 2) * 0.2);
    const q = box(r * 0.14, hh, r * 0.14, M.stone(0x8f8a80, 0.94), 0, hh / 2, 0);   // 柱底落地（旧版高柱沉地 0.6m）
    q.rotation.y = -a;
    return q;
  }, p.runes, r * 1.24));
  g.userData.glow = [em];
  return shade(g, false, true);
}
function buildSkyLantern(p) {
  const g = new THREE.Group();
  const em = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.7, emissive: new THREE.Color(p.color), emissiveIntensity: p.glow, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.count; i++) {
    const y = p.minH + rng() * (p.maxH - p.minH);
    const r = 0.34 + rng() * 0.3;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, r * 2, 20, 1, true), em);
    grp.add(body);
    grp.add(cyl(r * 0.5, r * 0.5, 0.06, M.glow(0xffd08a, p.glow * 1.6), 10, 0, -r * 0.9, 0));
    grp.position.set((rng() - 0.5) * p.spread, y, (rng() - 0.5) * p.spread);
    grp.rotation.set((rng() - 0.5) * 0.2, rng() * 3, (rng() - 0.5) * 0.2);
    g.add(grp);
  }
  g.userData.glow = [em];
  return g;
}
function buildClouds(p) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 1, metalness: 0, transparent: true, opacity: p.opacity, emissive: new THREE.Color(p.color), emissiveIntensity: 0.12, depthWrite: false });
  m.userData.cloud = true;
  const rng = makeRng(p.seed);
  for (let i = 0; i < p.count; i++) {
    const grp = new THREE.Group();
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      // 单个 puff 不要比房子还大：否则机位一钻进云团，整幅画面就是一层半透明壳（看起来像花屏 / 闪烁）
      const s = sph(p.size * (0.3 + rng() * 0.42), m, 8, (rng() - 0.5) * p.size * 2.2, (rng() - 0.5) * p.size * 0.24, (rng() - 0.5) * p.size * 1.4);
      s.scale.y = 0.32 + rng() * 0.2;
      grp.add(s);
    }
    grp.position.set((rng() - 0.5) * p.spread, p.height + (rng() - 0.5) * p.thickness, (rng() - 0.5) * p.spread);
    grp.userData.pickIgnore = true;
    g.add(grp);
  }
  return g;
}
function buildSwordRack(p) {
  const g = new THREE.Group();
  const wood = M.paint(0x5a4636, 0.7);
  g.add(box(p.count * 0.5 + 0.6, 0.16, 0.6, wood, 0, 0.08, 0));
  for (const s of [-1, 1]) g.add(box(0.16, 1.1, 0.5, wood, s * (p.count * 0.25 + 0.2), 0.6, 0));
  const steel = M.metal(0xcfd8e0, 0.24, 0.95);
  for (let i = 0; i < p.count; i++) {
    const x = (i / Math.max(1, p.count - 1) - 0.5) * (p.count * 0.42);
    const b = box(0.06, 1.0, 0.14, steel, x, 1.0, 0);
    b.rotation.z = 0.06 * (i % 2 ? 1 : -1);
    g.add(b);
    g.add(box(0.05, 0.22, 0.24, M.paint(0x2a2f36, 0.6), x, 0.5, 0));
  }
  return shade(g);
}
function buildGroundGlow(p) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), transparent: true, opacity: p.opacity, side: THREE.DoubleSide, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40), m);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  disc.userData.pickIgnore = true;
  g.add(disc);
  return g;
}

// ==================================================================== 注册 ===
export const GROUP_WAR = {
  cat: '战争', id: 'war', items: [
    { type: 'trench', name: '战壕', icon: 'trench', build: buildTrench, params: [PR('length', '长度 m', 8, 120, 2, 34), PR('w', '宽 m', 1, 4, 0.1, 1.8), PR('depth', '深 m', 0.8, 3.2, 0.1, 1.8), PR('wallT', '壁厚 m', 0.3, 2.5, 0.1, 1.1), PR('wobble', '弯道摆动 m', 0, 6, 0.2, 1.6), PB('sandbags', '沙袋护沿', true), PB('boards', '踏板', true), PB('wire', '铁丝网', true), PC('soil', '土色', '#5f4c3a'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'sandbags', name: '沙袋掩体', icon: 'barrier', build: buildSandbagWall, params: [PR('length', '长度 m', 1.5, 24, 0.5, 6), PI('rows', '层数', 1, 6, 1, 3), PR('thick', '厚 m', 0.4, 1.4, 0.05, 0.7), PC('color', '沙袋色', '#8a7c5c'), PI('seed', '种子', 1, 99, 1, 5)] },
    { type: 'barbed', name: '铁丝网', icon: 'fence', build: buildBarbed, params: [PR('length', '长度 m', 3, 60, 1, 14), PI('posts', '桩数', 2, 24, 1, 6), PR('height', '高 m', 0.8, 2.6, 0.1, 1.3), PC('color', '金属色', '#4a4f55')] },
    { type: 'bunker', name: '碉堡', icon: 'bunker', build: buildBunker, params: [PR('w', '宽 m', 3, 14, 0.5, 7), PR('d', '深 m', 3, 14, 0.5, 6), PR('h', '高 m', 1.6, 6, 0.2, 2.8), PB('cupola', '机枪塔', true), PB('rubble', '周围碎块', true), PC('color', '混凝土', '#8f8a82'), PI('seed', '种子', 1, 99, 1, 3)] },
    { type: 'tank', name: '主战坦克', icon: 'tank', build: buildTank, params: [PR('length', '车长 m', 5, 11, 0.2, 7.4), PR('width', '车宽 m', 2.6, 4.2, 0.1, 3.4), PR('hull', '车身高 m', 0.6, 1.6, 0.05, 0.9), PR('barrel', '炮管长 m', 2.5, 8, 0.2, 5), PR('turret', '炮塔转角 °', 0, 6.28, 0.02, 0.4), PR('elev', '炮口俯仰 °', -0.3, 0.4, 0.01, 0.02), PB('smoke', '冒烟', false), PC('color', '涂装', '#4b5a3e')] },
    { type: 'artillery', name: '牵引火炮', icon: 'artillery', build: buildArtillery, params: [PR('barrel', '炮管长 m', 3, 9, 0.2, 5.4), PR('elev', '仰角 °', 0, 1.2, 0.01, 0.28), PC('color', '涂装', '#4a5346')] },
    { type: 'tent', name: '野战帐篷', icon: 'tent', build: buildTent, params: [PR('length', '长 m', 3, 16, 0.5, 7), PR('w', '宽 m', 2, 8, 0.25, 4), PR('height', '高 m', 1.6, 4.5, 0.1, 2.6), PC('color', '帆布色', '#6c7361')] },
    { type: 'flagpole', name: '军旗', icon: 'flag', build: buildFlagpole, params: [PR('height', '杆高 m', 3, 16, 0.5, 7), PR('flagW', '旗宽 m', 0.8, 5, 0.1, 2.2), PR('flagH', '旗高 m', 0.5, 3, 0.1, 1.4), PC('flag', '旗色', '#a8322c'), PI('seed', '种子', 1, 99, 1, 3)] },
    { type: 'crater', name: '弹坑', icon: 'crater', build: buildCrater, params: [PR('r', '半径 m', 0.8, 14, 0.2, 3.4), PR('depth', '深 m', 0.2, 4, 0.1, 0.9), PR('rim', '唇高 m', 0, 1.4, 0.05, 0.3), PB('scorch', '焦痕', true), PC('soil', '土色', '#5a483a'), PI('seed', '种子', 1, 99, 1, 6)] },
    { type: 'ruin', name: '被打烂的楼', icon: 'ruin', build: buildRuin, params: [PR('w', '宽 m', 4, 26, 0.5, 11), PR('d', '深 m', 4, 26, 0.5, 9), PI('floors', '层数', 1, 9, 1, 4), PR('floorH', '层高 m', 2.4, 4.2, 0.1, 3.1), PR('intact', '完整度', 0.1, 1, 0.05, 0.55), PR('rubble', '瓦砾量', 0, 8, 1, 4), PB('beam', '歪斜横梁', true), PC('wall', '墙面色', '#b4aa9c'), PI('seed', '种子', 1, 99, 1, 8)] },
    { type: 'watchtower', name: '瞭望塔', icon: 'tower2', build: buildWatchtower, params: [PR('height', '高 m', 4, 22, 0.5, 9), PR('foot', '底边 m', 1.6, 6, 0.2, 3), PB('light', '探照灯', true), PC('lightColor', '灯色', '#ffe6b0')] },
    { type: 'hesco', name: '石笼防爆墙', icon: 'barrier', build: buildHesco, params: [PR('length', '长度 m', 3, 60, 1, 18), PI('rows', '层数', 1, 5, 1, 2), PR('thick', '厚 m', 0.9, 2.4, 0.1, 1.3), PB('wire', '顶部蛇腹', false), PC('color', '色', '#9a9284'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'wreck', name: '烧毁车辆', icon: 'wreck', build: buildWreck, params: [PB('smoke', '冒烟', true), PB('fire', '明火', false), PI('seed', '种子', 1, 99, 1, 5)] },
  ],
};
export const GROUP_SCI = {
  cat: '星际', id: 'sci', items: [
    { type: 'planet', name: '行星', icon: 'planet', build: buildPlanet, params: [PR('r', '半径 m', 8, 400, 4, 60), PC('color', '主色', '#4c6f8a'), PC('color2', '次色', '#1d2836'), PI('seed', '纹理种子', 1, 999, 1, 5), PR('tilt', '自转轴 rad', -0.8, 0.8, 0.02, 0.1), PB('atmo', '大气圈', true), PC('atmoColor', '大气色', '#7fc4ff'), PB('rings', '光环', false), PC('ringColor', '环色', '#d8c9a8'), PI('moons', '卫星数', 0, 4, 1, 0), PC('night', '夜面光色', '#0a1020'), PR('nightI', '夜面强度', 0, 2, 0.05, 0)] },
    { type: 'stars', name: '星空', icon: 'stars', build: buildStars, params: [PI('count', '星点数', 500, 20000, 500, 4000), PR('radius', '天球半径 m', 600, 2400, 50, 1500), PR('size', '星点大小 px', 0.6, 4, 0.1, 1.6), PR('bright', '亮度', 0.1, 1, 0.05, 0.9), PB('milky', '银河带', true), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'nebula', name: '星云', icon: 'nebula', build: buildNebula, params: [PI('puffs', '云团数', 4, 40, 1, 14), PR('size', '单体大小 m', 10, 200, 5, 60), PR('spread', '散布 m', 40, 900, 20, 260), PR('opacity', '浓度', 0.02, 0.4, 0.01, 0.12), PC('color', '色', '#7a4fb0'), PI('seed', '种子', 1, 99, 1, 6)] },
    { type: 'cruiser', name: '巡洋舰', icon: 'ship', build: buildShip, params: [PR('length', '舰长 m', 20, 240, 4, 70), PR('beam', '舰宽 m', 4, 60, 1, 18), PR('hullH', '舰高 m', 3, 30, 1, 9), PC('hull', '舰体色', '#8d949c'), PC('engine', '引擎色', '#7fe0ff'), PR('engineGlow', '引擎亮度', 0, 4, 0.1, 2), PB('turrets', '副炮塔', true), PR('yaw', '朝向 °', -1.6, 1.6, 0.02, 0)] },
    { type: 'fighter', name: '星际战机', icon: 'fighter', build: buildFighter, params: [PR('length', '机长 m', 6, 30, 1, 12), PC('hull', '机身色', '#c9ccd2'), PC('engine', '尾焰色', '#ff9a4a')] },
    { type: 'station', name: '轨道空间站', icon: 'station', build: buildStation, params: [PR('r', '居住环半径 m', 8, 90, 2, 26), PR('spine', '主桁架长 m', 20, 200, 5, 70), PC('hull', '壳体色', '#c3c8ce')] },
    { type: 'dome', name: '穹顶基地', icon: 'dome', build: buildDome, params: [PR('r', '半径 m', 4, 60, 1, 14), PC('glass', '玻璃色', '#a8d8e8'), PR('opacity', '通透度', 0.15, 0.8, 0.05, 0.42), PC('floor', '地面色', '#8f9c8a'), PB('tubes', '连接通道', true), PB('glow', '夜间照明', true)] },
    { type: 'hangar', name: '机库', icon: 'hangar', build: buildHangar, params: [PR('w', '跨 m', 8, 60, 1, 22), PR('d', '进深 m', 10, 80, 2, 30), PR('h', '净高 m', 5, 24, 1, 11), PB('door', '卷帘门', true), PB('lights', '灯带', true), PC('color', '外壳色', '#7f868e')] },
    { type: 'turret', name: '防御炮塔', icon: 'turret', build: buildTurret, params: [PR('base', '底座半径 m', 0.6, 6, 0.2, 1.8), PR('barrel', '炮管长 m', 1, 8, 0.2, 3.4), PR('yaw', '转角 °', -3.14, 3.14, 0.02, 0.6), PR('pitch', '仰角 °', -0.4, 1.2, 0.02, 0.12), PB('laser', '充能光', true), PC('color', '装甲色', '#8f959c')] },
    { type: 'pylon', name: '能量图腾塔', icon: 'pylon', build: buildPylon, params: [PR('height', '高度 m', 6, 60, 2, 18), PR('w', '截面 m', 0.8, 6, 0.2, 2.2), PR('beamH', '光柱高 m', 2, 40, 1, 10), PR('glow', '光强', 0, 5, 0.1, 2.2), PC('beam', '光色', '#7fe0ff'), PR('shield', '护盾半径 m', 0, 80, 2, 0), PR('shieldOp', '护盾浓度', 0.02, 0.4, 0.01, 0.1), PC('color', '塔体色', '#6f6a63')] },
    { type: 'launchpad', name: '发射台', icon: 'pad', build: buildLaunchpad, params: [PR('r', '半径 m', 5, 30, 1, 12)] },
    { type: 'debris', name: '残骸碎片', icon: 'debris', build: buildDebris, params: [PI('count', '块数', 4, 80, 2, 20), PR('size', '大小 m', 0.5, 14, 0.5, 3), PR('spread', '散布 m', 10, 400, 10, 90), PC('color', '色', '#8b9199'), PI('seed', '种子', 1, 99, 1, 4)] },
  ],
};
export const GROUP_FX = {
  cat: '玄幻特效', id: 'fx', items: [
    { type: 'portal', name: '传送门', icon: 'portal', build: buildPortal, params: [PR('r', '半径 m', 1, 24, 0.5, 3.4), PR('tube', '环粗 m', 0.06, 1.4, 0.02, 0.22), PC('color', '光色', '#8ef0ff'), PR('glow', '自发光', 0, 6, 0.1, 2.4), PR('fill', '门幕浓度', 0, 0.9, 0.02, 0.32)] },
    { type: 'glyph', name: '地面法阵', icon: 'glyph', build: buildGlyph, params: [PR('r', '半径 m', 1.5, 40, 0.5, 6), PC('color', '光色', '#ffd98a'), PR('glow', '自发光', 0, 6, 0.1, 2.2), PI('points', '星芒角数', 3, 12, 1, 6), PI('runes', '符文数', 4, 16, 1, 8), PB('pillars', '外围石柱', true)] },
    { type: 'lanterns', name: '天灯群', icon: 'lantern', build: buildSkyLantern, params: [PI('count', '数量', 4, 120, 2, 26), PR('minH', '最低高 m', 2, 60, 1, 8), PR('maxH', '最高高 m', 4, 160, 2, 46), PR('spread', '散布 m', 10, 200, 5, 60), PC('color', '灯色', '#ffb45e'), PR('glow', '亮度', 0, 5, 0.1, 2.2), PI('seed', '种子', 1, 99, 1, 6)] },
    { type: 'clouds', name: '云海', icon: 'cloud', build: buildClouds, params: [PI('count', '云团数', 6, 80, 2, 24), PR('size', '单体大小 m', 4, 60, 2, 18), PR('spread', '散布 m', 40, 800, 20, 260), PR('height', '高度 m', 2, 200, 5, 26), PR('thickness', '厚度 m', 1, 60, 2, 10), PR('opacity', '浓度', 0.04, 0.6, 0.02, 0.24), PC('color', '云色', '#dfe8f2'), PI('seed', '种子', 1, 99, 1, 4)] },
    { type: 'swordrack', name: '剑架', icon: 'sword', build: buildSwordRack, params: [PI('count', '剑数', 2, 12, 1, 6)] },
    { type: 'glow', name: '地面光斑', icon: 'glow', build: buildGroundGlow, params: [PR('r', '半径 m', 0.5, 40, 0.5, 5), PC('color', '色', '#8ef0ff'), PR('opacity', '浓度', 0.02, 0.6, 0.02, 0.18)] },
  ],
};

export const GROUPS = [GROUP_WAR, GROUP_SCI, GROUP_FX];
