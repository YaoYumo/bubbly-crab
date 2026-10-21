// Additive, editable set dressing for the two authored showcase scenes.
// No external textures, generated scripts, real-time SSR or unbounded lights.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRng } from "./util.js";
const range = (k, l, min, max, def) => ({
  k,
  l,
  t: "range",
  min,
  max,
  step: 0.1,
  def,
});
const color = (k, l, def) => ({ k, l, t: "color", def });
const paint = (c, r = 0.65, m = 0.1) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const glow = (c, n = 3) =>
  new THREE.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: n,
    roughness: 0.4,
  });
const box = (g, mat, w, h, d, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  g.add(o);
  return o;
};
// Merge only our own static boxes, grouped by material. Keep texture ownership separate.
function finish(g) {
  g.updateMatrixWorld(true);
  const groups = new Map();
  for (const n of [...g.children]) {
    if (!n.isMesh) continue;
    const geo = n.geometry.clone().applyMatrix4(n.matrix);
    if (!groups.has(n.material)) groups.set(n.material, []);
    groups.get(n.material).push(geo);
    n.geometry.dispose();
    g.remove(n);
  }
  for (const [mat, geos] of groups) {
    const geo = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    const n = new THREE.Mesh(geo, mat);
    n.castShadow = true;
    n.receiveShadow = true;
    g.add(n);
  }
  return g;
}
function skycar(p) {
  const g = new THREE.Group(),
    hull = paint(p.color, 0.26, 0.7),
    black = paint("#071820", 0.14, 0.65),
    cyan = glow(p.trim, 4),
    tail = glow("#ff3657", 3),
    white = glow("#b6eaff", 3);
  box(g, hull, 2.1, 0.48, 4.7, 0, 0.48);
  box(g, hull, 1.7, 0.25, 5.1, 0, 0.27);
  const cab = box(g, black, 1.7, 0.65, 2.3, 0, 1.01, -0.05);
  cab.rotation.x = -0.12;
  box(g, cyan, 2.16, 0.075, 3.9, 0, 0.54);
  box(g, hull, 1.9, 0.1, 1.2, 0, 0.85, 1.55);
  for (const s of [-1, 1]) {
    box(g, hull, 0.55, 0.3, 1.4, s * 1.25, 0.3, -0.8);
    box(g, cyan, 0.35, 0.13, 1.1, s * 1.25, 0.11, -0.8);
    box(g, white, 0.65, 0.12, 0.1, s * 0.62, 0.57, 2.38);
    box(g, tail, 0.65, 0.09, 0.1, s * 0.62, 0.55, -2.38);
  }
  box(g, cyan, 1.4, 0.06, 0.14, 0, 0.07, 1.2);
  finish(g);
  g.scale.set((p.width ?? 2.7) / 2.7, 1, (p.length ?? 5.1) / 5.1);
  return g;
}
const signTextures = new Map();
function signage(p) {
  const g = new THREE.Group(),
    rim = glow(p.color, 3),
    back = paint("#090e1c", 0.28, 0.4);
  box(g, back, p.w, p.h, 0.22, 0, p.h / 2);
  for (const s of [-1, 1])
    box(g, rim, 0.055, p.h + 0.1, 0.28, (s * p.w) / 2, p.h / 2);
  box(g, rim, p.w, 0.055, 0.28, 0, 0.05);
  box(g, rim, p.w, 0.055, 0.28, 0, p.h - 0.05);
  finish(g);
  const cacheKey = p.text + "|" + p.color + "|" + (p.h > p.w * 2);
  let tex = signTextures.get(cacheKey);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = p.h > p.w * 2 ? 1024 : 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#050c19";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = p.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    if (c.height > 256) {
      const chars = [...p.text].slice(0, 5);
      ctx.font = "bold 150px sans-serif";
      chars.forEach((s, i) =>
        ctx.fillText(s, 128, 100 + (i + 0.5) * (824 / chars.length)),
      );
    } else {
      ctx.font = "bold 66px sans-serif";
      ctx.fillText(p.text, 128, 118, 236);
      ctx.font = "20px monospace";
      ctx.fillText("NIGHT DISTRICT · 08", 128, 206, 235);
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    signTextures.set(cacheKey, tex);
  }
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(p.w * 0.9, p.h * 0.95),
    new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: "#ffffff",
      emissiveIntensity: 2,
      roughness: 0.5,
    }),
  );
  face.position.set(0, p.h / 2, 0.121);
  g.add(face);
  return g;
}
function district(p) {
  const g = new THREE.Group(),
    concrete = paint("#28323c", 0.7),
    wet = paint("#111c29", 0.16, 0.55),
    lane = paint("#8eacb7", 0.5),
    cyan = glow("#1185a7", 1.4);
  box(g, concrete, p.w, 0.18, p.d, 0, -0.12);
  box(g, wet, p.roadW ?? 14, 0.04, p.d, 0, -0.006);
  for (const s of [-1, 1]) {
    box(
      g,
      concrete,
      p.walkW ?? 4.4,
      0.22,
      p.d,
      s * ((p.roadW ?? 14) / 2 + (p.walkW ?? 4.4) / 2 + 0.1),
      0.04,
    );
    box(g, cyan, 0.055, 0.025, p.d, s * ((p.roadW ?? 14) / 2 + 0.18), 0.165);
  }
  for (let z = -p.d / 2 + 3; z < p.d / 2; z += 7)
    box(g, lane, 0.13, 0.008, 3.3, 0, 0.02, z);
  for (const zz of [-(p.crossZ ?? 14), p.crossZ ?? 14]) {
    box(g, wet, p.w, 0.035, 7, 0, 0.015, zz);
    for (let x = -7; x <= 7; x += 1.3)
      box(g, lane, 0.55, 0.008, 3.2, x, 0.043, zz + 5.3);
  }
  finish(g);
  const rng = makeRng(82),
    reflections = [
      new THREE.MeshBasicMaterial({
        color: "#00b8db",
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: "#e12b8d",
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    ];
  // Authored graphic reflections, not screen-space reflections.
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12 + rng() * 0.5, 1 + rng() * 5),
      reflections[i % 2],
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set((rng() - 0.5) * 12, 0.044, (rng() - 0.5) * p.d);
    g.add(m);
  }
  return g;
}
function skywalk(p) {
  const g = new THREE.Group(),
    steel = paint("#263747", 0.4, 0.65),
    light = glow("#1fc6cf", 2),
    deck = paint("#455769", 0.55, 0.5),
    span = p.span;
  box(g, deck, span, 0.45, 3.2, 0, p.h);
  for (const z of [-1.6, 1.6]) {
    box(g, steel, span, 0.14, 0.12, 0, p.h + 1.25, z);
    box(g, light, span, 0.06, 0.1, 0, p.h + 0.12, z);
    for (let x = -span / 2; x <= span / 2; x += 2)
      box(g, steel, 0.09, 1.3, 0.09, x, p.h + 0.65, z);
  }
  for (const side of [-1, 1]) {
    const x = side * (span / 2 - 1.5);
    for (const z of [-6, 6]) box(g, steel, 0.22, p.h, 0.22, x, p.h / 2, z);
    for (let f = 0; f < 4; f++) {
      for (let j = 0; j < 11; j++) {
        const z = (f % 2 ? -1 : 1) * (-5 + j),
          h = ((f * 11 + j + 1) * p.h) / 44;
        box(g, deck, 2.6, 0.1, 1.04, x, h, z);
      }
      box(g, deck, 3, 0.16, 2.2, x, ((f + 1) * p.h) / 4, f % 2 ? -5.4 : 5.4);
    }
    box(g, light, 0.07, p.h, 0.07, x + side * 1.4, p.h / 2, -6);
  }
  return finish(g);
}
function quay(p) {
  const g = new THREE.Group(),
    stone = paint("#626d79", 0.87),
    cap = paint("#9fa5a8", 0.8),
    warm = glow("#ffae50", 1.7);
  box(g, stone, 0.75, 2.8, p.length, 0, -1.3);
  box(g, cap, 1, 0.2, p.length, 0, 0.12);
  for (let z = -p.length / 2 + 0.6; z < p.length / 2; z += 2.4) {
    box(g, stone, 0.22, 0.85, 0.22, 0, 0.6, z);
    box(g, cap, 0.3, 0.12, 0.3, 0, 1.05, z);
    box(g, warm, 0.17, 0.04, 0.17, 0, 1.13, z);
  }
  box(g, cap, 0.13, 0.12, p.length, 0, 0.96);
  return finish(g);
}
function shopLights(p) {
  const g = new THREE.Group(),
    wood = paint("#522d23", 0.8),
    light = glow("#ffba62", 2.4),
    dark = paint("#211b20");
  for (const y of p.rows === 1 ? [1.4] : [1.4, 4.1])
    for (let x = -p.w / 2 + 1; x < p.w / 2; x += 1.35) {
      box(g, wood, 1.18, 1.55, 0.12, x, y);
      box(g, light, 0.96, 1.3, 0.13, x, y, 0.03);
      for (const dx of [-0.3, 0, 0.3])
        box(g, dark, 0.04, 1.3, 0.05, x + dx, y, 0.115);
      box(g, dark, 1, 0.045, 0.05, x, y, 0.115);
    }
  return finish(g);
}
function waterglints(p = {}) {
  const g = new THREE.Group(),
    mat = new THREE.MeshBasicMaterial({
      color: "#ffae50",
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
  const rng = makeRng(73);
  for (let j = 0; j < 36; j++) {
    const z = (-108 + j * 6) * (p.lengthFactor ?? 1);
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const zz = z + (rng() - 0.5) * 3,
          m = new THREE.Mesh(
            new THREE.PlaneGeometry(0.3 + rng() * 1.4, 0.04 + rng() * 0.14),
            mat,
          );
        m.rotation.x = -Math.PI / 2;
        m.position.set(
          (p.bend ?? 9) * Math.sin(zz / (60 * (p.lengthFactor ?? 1))) +
            side * ((p.width ?? 20) / 2 - 3.6 + rng() * 2),
          -0.48,
          zz,
        );
        g.add(m);
      }
  }
  return finish(g);
}
export const SHOWCASE_GROUPS = [
  {
    id: "showcase",
    cat: "示例布景（新增）",
    items: [
      {
        type: "waterglints",
        name: "灯河碎金倒影",
        icon: "props",
        build: waterglints,
        params: [
          range("width", "河宽 m", 12, 20, 20),
          range("bend", "河弯幅度 m", -11, 11, 9),
          range("lengthFactor", "河段长度系数", 0.8, 1.2, 1),
        ],
      },
      {
        type: "skycar",
        name: "悬浮汽车",
        icon: "car",
        build: skycar,
        params: [
          range("length", "车长 m", 4, 6, 5.1),
          range("width", "车宽 m", 2, 3, 2.7),
          color("color", "车身", "#354c68"),
          color("trim", "推进灯", "#31d6eb"),
        ],
      },
      {
        type: "neonsign",
        name: "霓虹灯牌",
        icon: "props",
        build: signage,
        params: [
          range("w", "宽 m", 0.5, 10, 2),
          range("h", "高 m", 1, 16, 7),
          { k: "text", l: "文字", t: "text", def: "夜航" },
          color("color", "灯色", "#2bd8e7"),
        ],
      },
      {
        type: "districtground",
        name: "雨夜街区地面",
        icon: "road",
        build: district,
        params: [
          range("w", "宽 m", 60, 300, 160),
          range("d", "长 m", 80, 400, 240),
          range("roadW", "车道总宽 m", 12, 20, 14),
          range("walkW", "单侧步道宽 m", 3, 6, 4.4),
          range("crossZ", "横街位置 m", 12, 18, 14),
        ],
      },
      {
        type: "skywalk",
        name: "空中步廊与消防梯",
        icon: "props",
        build: skywalk,
        params: [
          range("span", "跨度 m", 20, 60, 44),
          range("h", "步廊高 m", 10, 60, 20),
        ],
      },
      {
        type: "quay",
        name: "滨河石岸栏杆",
        icon: "props",
        build: quay,
        params: [range("length", "长度 m", 2, 30, 12)],
      },
      {
        type: "shoplights",
        name: "古城暖窗格栅",
        icon: "props",
        build: shopLights,
        params: [
          range("w", "面宽 m", 2, 14, 8),
          { k: "rows", l: "窗排", t: "int", min: 1, max: 2, step: 1, def: 2 },
        ],
      },
    ],
  },
];
