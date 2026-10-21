import { makeRng } from "./util.js";
import { cyberFrontage, riverFrontage } from "./scene-kits.js";
// Authored spatial layouts. All moving routes are data, editable and portable.
const O = (key, x, z, rotation = 0, params = {}, extra = {}) => [
  key,
  x,
  z,
  rotation,
  params,
  { follow: false, ...extra },
];
// Mover uses Catmull–Rom even with arc=false (arc only controls speed mapping).
// Densify straight stretches to bound corner overshoot inside the authored clearance.
const routePoints = (points) => {
  const out = [[...points[0]]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      n = Math.max(
        1,
        Math.ceil(Math.hypot(...b.map((v, j) => v - a[j])) / 3.6),
      );
    for (let k = 1; k <= n; k++)
      out.push(a.map((v, j) => v + ((b[j] - v) * k) / n));
  }
  return out;
};
const motion = (points, anim = "walk") => ({
  active: true,
  anim,
  autoFace: true,
  easing: "linear",
  arc: false,
  loop: true,
  keys: routePoints(points).map((p, i, all) => ({
    t: i / (all.length - 1),
    p,
  })),
});
const TOWER = "building:tower:玻璃幕墙写字楼",
  HUMAN = "char:human:男性";
export const riverX = (z) => 9 * Math.sin(z / 60);
export const riverSlope = (z) => 0.15 * Math.cos(z / 60);
export function buildShowcaseScenes(options = {}) {
  const vary = Number.isFinite(options.seed),
    rng = makeRng(options.seed ?? 82);
  const rows = options.rows ?? 7,
    spacing = options.spacing ?? 28;
  const extent = ((rows - 1) * spacing) / 2,
    streetHalf = options.streetHalf ?? 12;
  const towerWidth = options.towerWidth ?? 22,
    towerDepth = Math.min(20, spacing - 8);
  const towerX = streetHalf + towerWidth / 2,
    outerX = streetHalf + towerWidth + 20;
  const floors = options.floors ?? 34,
    carCount = options.cars ?? 9,
    people = options.people ?? 20;
  const L = options.lengthFactor ?? 1,
    halfRiver = (options.riverWidth ?? 20) / 2;
  const bend = options.bend ?? 9,
    bays = options.bays ?? 10;
  const riverX = (z) => bend * Math.sin(z / (60 * L));
  const riverSlope = (z) => (bend / (60 * L)) * Math.cos(z / (60 * L));
  const Z = (z) => z * L,
    bridgeHalf = halfRiver + 5;
  const urban = [];

  urban.push(
    O(
      "showcase:districtground:雨夜街区地面",
      0,
      0,
      0,
      {
        w: Math.max(170, 2 * (outerX + 24)),
        d: 2 * extent + 82,
        roadW: 2 * (streetHalf - 5),
        walkW: 4.4,
        crossZ: spacing / 2,
      },
      { name: "湿街 · 路面与霓虹倒影" },
    ),
  );
  for (const side of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const z = -extent + i * spacing;
      urban.push(
        O(
          TOWER,
          side * towerX,
          z,
          0,
          {
            width: towerWidth,
            depth: towerDepth,
            floors: vary
              ? Math.max(
                  12,
                  Math.min(40, Math.round(floors * (0.82 + rng() * 0.3))),
                )
              : 27 + ((i * 7 + (side === 1 ? 5 : 0)) % 14),
            podium: false,
            crown: i % 3 === 0,
            lit: 0.76,
            seed: 1 + i + (side === 1 ? 10 : 0),
          },
          { name: `${side < 0 ? "西" : "东"}街 · 高层${i + 1}` },
        ),
      );
      urban.push(
        O(
          "building:shophouse:沿街商铺",
          side * (streetHalf + 5),
          z,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          {
            width: towerDepth,
            depth: 10,
            floors: 2,
            signColor: i % 2 ? "#1cbed1" : "#e5399f",
            awning: "#263e55",
          },
          { name: "塔楼沿街商业裙房" },
        ),
      );
      urban.push(
        O(
          "showcase:neonsign:霓虹灯牌",
          side * (streetHalf - 0.2),
          z + 6,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          {
            w: 1.8,
            h: 7.5,
            text: ["夜航", "义体", "星港", "不眠", "零号", "未来", "旅馆"][
              (i + (vary ? options.seed % 7 : 0)) % 7
            ],
            color: i % 2 ? "#28cfdf" : "#f03b96",
          },
          { y: 4, name: "悬挂霓虹 · 街区导向" },
        ),
      );
    }
    for (const z of [-86, -55, 55, 86].map((z) => (z * extent) / 84))
      urban.push(
        O(
          TOWER,
          side * outerX,
          z,
          0,
          {
            width: 25,
            depth: 24,
            floors: vary ? Math.min(40, floors + 3) : 34,
            podium: false,
            crown: true,
            seed: 15,
            lit: 0.5,
          },
          { name: "雾中第二层城市天际线" },
        ),
      );
    for (const z of [-70, -30, 20, 62].map((z) => (z * extent) / 84))
      urban.push(
        O(
          "traffic:street_lamp:Street Lamp 路灯",
          side * (streetHalf - 1.5),
          z,
          side < 0 ? -Math.PI / 2 : Math.PI / 2,
          {
            poleHeight: 6,
            light: {
              mode: "on",
              lumens: 550,
              range: 18,
              temperature: 6500,
              emission: 0.6,
              shadow: false,
            },
          },
          { name: "雨巷照明" },
        ),
      );
  }
  urban.push(
    O(
      TOWER,
      0,
      -extent - 56,
      0,
      { width: 26, depth: 24, floors: 40, podium: false, lit: 0.8, seed: 22 },
      { name: "雾尽头 · 巨构" },
    ),
  );
  for (const [z, h] of [
    [-spacing * 1.5, 20],
    [spacing * 1.5, 35],
  ])
    urban.push(
      O(
        "showcase:skywalk:空中步廊与消防梯",
        0,
        z,
        0,
        { span: towerX * 2, h },
        { name: `${h}m空中步廊 · 双侧消防梯` },
      ),
    );
  for (let i = 0; i < carCount - Math.min(2, Math.floor(carCount / 3)); i++) {
    const y = [14, 24, 43, 24, 14, 43, 24][i % 7],
      phase =
        i / Math.max(1, carCount - Math.min(2, Math.floor(carCount / 3))) +
        0.055,
      pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = 2 * Math.PI * (k / 24 + phase);
      pts.push([
        (4.1 + (streetHalf - 12) * 0.6) * Math.cos(t),
        y,
        (extent + 25) * Math.sin(t),
      ]);
    }
    urban.push(
      O(
        "showcase:skycar:悬浮汽车",
        pts[0][0],
        pts[0][2],
        0,
        {
          color: ["#536a80", "#7d365c", "#c0b283"][i % 3],
          trim: i % 2 ? "#fd4dab" : "#40ddf0",
        },
        { y, name: `纵向航道 · 悬浮车${i + 1}`, m: motion(pts, "idle") },
      ),
    );
  }
  // Cross-block route occupies the 8m gaps between tower rows, not tower volumes.
  for (let i = 0; i < Math.min(2, Math.floor(carCount / 3)); i++) {
    const route = [
      [-outerX - 18, 31 + i * 5, spacing / 2],
      [outerX + 18, 31 + i * 5, spacing / 2],
      [outerX + 18, 31 + i * 5, -spacing / 2],
      [-outerX - 18, 31 + i * 5, -spacing / 2],
      [-outerX - 18, 31 + i * 5, spacing / 2],
    ];
    if (i) route.reverse();
    urban.push(
      O(
        "showcase:skycar:悬浮汽车",
        route[0][0],
        route[0][2],
        0,
        { color: "#b4a27f", trim: "#ffc866" },
        {
          y: route[0][1],
          name: "横向楼隙穿行 · 空中出租车",
          m: motion(route, "idle"),
        },
      ),
    );
  }
  for (let i = 0; i < people; i++) {
    const side = i % 2 ? 1 : -1,
      x = side * (streetHalf - 3.4 + (i % 3) * 0.5),
      z =
        -extent +
        4 +
        (Math.floor(i / 2) * (2 * extent - 24)) /
          Math.max(1, Math.ceil(people / 2) - 1),
      pts = [
        [x, 0.18, z],
        [x, 0.18, z - 15],
        [x + side * 0.5, 0.18, z - 15],
        [x + side * 0.5, 0.18, z],
        [x, 0.18, z],
      ];
    if (i % 3 === 0) pts.reverse();
    urban.push(
      O(
        i % 2 ? "char:human:女性" : HUMAN,
        x,
        z,
        0,
        {
          top: ["#8f486b", "#4e7889", "#bd9054", "#364d68"][i % 4],
          height: 1.6 + (i % 4) * 0.07,
          anim: "walk",
        },
        { y: 0.18, name: "雨夜行人 · 人行道往返", m: motion(pts) },
      ),
    );
  }
  const riverPoints = Array.from({ length: 25 }, (_, i) => {
    const z = Z(-144 + i * 12);
    return [riverX(z), -0.5, z];
  });

  // Per-object metadata keeps global window-lighting defaults untouched.
  for (const o of urban)
    if (o[0].startsWith("building:"))
      o[5].windows = {
        mode: "on",
        ratio: 0.52,
        temperature: 7500,
        intensity: 0.26,
        seed: 82,
      };

  const ancient = [
      O(
        "showcase:waterglints:灯河碎金倒影",
        0,
        0,
        0,
        { width: halfRiver * 2, bend, lengthFactor: L },
        { name: "灯火倒影 · 人工碎金纹理" },
      ),
    ],
    roads = [];
  for (const side of [-1, 1]) {
    roads.push({
      id: side < 0 ? "festival-west-bank" : "festival-east-bank",
      name: side < 0 ? "西岸沿河街" : "东岸沿河街",
      points: riverPoints.map(([x, , z]) => [
        x + side * (halfRiver + 6),
        0.04,
        z,
      ]),
      width: 5,
      roadType: "garden",
    });
    for (let i = 0; i < 20; i++) {
      const z = Z(-114 + i * 12),
        mid = z + Z(6),
        slope = riverSlope(mid),
        yaw = Math.atan(slope);
      ancient.push(
        O(
          "showcase:quay:滨河石岸栏杆",
          riverX(mid) + side * (halfRiver + 0.8),
          mid,
          yaw,
          { length: 12.15 * L * Math.hypot(1, slope) },
          { name: "连续石岸 · 临水栏杆" },
        ),
      );
    }
    for (let i = 0; i < bays; i++) {
      const z = Z(
          i < bays / 2
            ? -20 - (bays / 2 - 1 - i) * 16
            : 20 + (i - bays / 2) * 16,
        ),
        x = riverX(z) + side * (halfRiver + 17),
        w = vary ? 8.5 + rng() * 2 : 8.5 + (i % 3),
        yaw = Math.atan2(-side, side * riverSlope(z));
      // Mirrored river bends can otherwise push a storefront into a landmark.
      // Reserve both pagoda parcels before assembling host + warm-window parts.
      if ((side > 0 && Math.abs(z - Z(-68)) < 20 && Math.abs(x - (halfRiver + 33)) < 15)
        || (side < 0 && Math.abs(z - Z(-113)) < 20 && Math.abs(x - (-halfRiver - 30)) < 13)) continue;

      ancient.push(
        O(
          "cn:streetshop:街市铺面",
          x,
          z,
          yaw,
          {
            w,
            d: 7.5,
            h2: 2.85,
            roofH: 1.3,
            banner: true,
            roof: i % 2 ? "#283b49" : "#354455",
          },
          { name: `${side < 0 ? "西" : "东"}岸 · 临河商楼${i + 1}` },
        ),
      );
      // Facade follows the same orientation as its host; +Z is the shop front.
      ancient.push(
        O(
          "showcase:shoplights:古城暖窗格栅",
          x + Math.sin(yaw) * 3.82,
          z + Math.cos(yaw) * 3.82,
          yaw,
          { w: w - 0.5 },
          { name: "沿河商楼 · 暖窗" },
        ),
      );
    }
    for (const z of [-88, -56, -28, 28, 56, 88].map(Z)) {
      // Reserve an actual plaza around the pagoda, free of courtyard buildings.
      if (side > 0 && Math.abs(z + Z(68)) < 22) continue;
      const x = riverX(z) + side * (halfRiver + 33);
      ancient.push(
        O(
          "cn:folkhouse:民居硬山",
          x,
          z,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          { w: 11, d: 9, h: 4.6, roofH: 1.7, wall: "#d0c4ad", roof: "#334353" },
          { name: "第二进 · 街坊院落" },
        ),
      );
    }
    for (let i = 0; i < 11; i++) {
      const z = Z(-90 + i * 18),
        x = riverX(z) + side * (halfRiver + 2.3);
      ancient.push(
        O(
          "cn:lanternpole:宫灯杆",
          x,
          z,
          0,
          {
            height: 3.8,
            color: "#ffb45e",
            glow: 1.5,
            light: {
              mode: "on",
              lumens: 360,
              range: 12,
              temperature: 2400,
              shadow: false,
            },
          },
          { name: "沿河宫灯" },
        ),
      );
    }
  }
  roads.push(
    {
      id: "festival-west-axis",
      name: "西中轴 · 牌楼至桥头",
      points: [
        [-bridgeHalf - 71, 0.04, 0],
        [-bridgeHalf, 0.04, 0],
      ],
      width: 7,
      roadType: "garden",
    },
    {
      id: "festival-east-axis",
      name: "东中轴 · 桥头延街",
      points: [
        [bridgeHalf, 0.04, 0],
        [bridgeHalf + 71, 0.04, 0],
      ],
      width: 7,
      roadType: "garden",
    },
  );
  ancient.push(
    O(
      "cn:archbridge:石拱桥",
      0,
      0,
      0,
      {
        span: bridgeHalf * 2,
        rise: 4.8,
        w: 7,
        rail: true,
        trim: true,
        color: "#aaa99f",
      },
      { y: -0.55, name: "望河桥 · 中轴石拱桥" },
    ),
  );
  ancient.push(
    O(
      "cn:paifang:牌楼牌坊",
      -bridgeHalf - 24,
      0,
      Math.PI / 2,
      {
        span: 24,
        h: 8.2,
        roofH: 1.35,
        bays: 3,
        text: "萬家燈火",
        column: "#963f2c",
        roof: "#334555",
        dgN: 2,
      },
      { name: "中轴牌楼 · 萬家燈火" },
    ),
  );
  ancient.push(
    O(
      "cn:pagoda:楼阁式佛塔",
      halfRiver + 33,
      Z(-68),
      0,
      {
        levels: 9,
        r: 5.4,
        floorH: 3.6,
        spire: 5,
        roof: "#304152",
        column: "#a15b38",
        trim: true,
        brackets: true,
      },
      { name: "远景地标 · 九层望江佛塔" },
    ),
  );
  ancient.push(
    O(
      "cn:pagoda:楼阁式佛塔",
      -halfRiver - 30,
      Z(-113),
      0,
      {
        levels: 7,
        r: 3.8,
        floorH: 3.5,
        spire: 3.8,
        roof: "#334252",
        column: "#975737",
        trim: false,
        brackets: false,
      },
      { name: "远景地标 · 西城高阁" },
    ),
  );
  for (const [x, z, r, fh] of [
    [halfRiver + 33, Z(-68), 5.4, 3.6],
    [-halfRiver - 30, Z(-113), 3.8, 3.5],
  ])
    for (let level = 0; level < 7; level++)
      ancient.push(
        O(
          "showcase:shoplights:古城暖窗格栅",
          x,
          z + r * (1 - level * 0.055) * 0.99 + 0.11,
          0,
          { w: 3, rows: 1 },
          { y: 1.08 + level * (fh + 0.3 + fh * 0.62 * 0.34), name: "塔阁窗火" },
        ),
      );
  for (let j = 0; j < ((options.lanterns ?? 108) > 0 ? 3 : 0); j++) {
    const x = [-4, 8, -10][j],
      z = [-25, 0, -40][j],
      pts = [
        [x, 0, z],
        [x + 1.2, 2.3, z - 1],
        [x + 2, 3, z - 2],
        [x, 0, z],
      ];
    ancient.push(
      O(
        "fx:lanterns:天灯群",
        x,
        z,
        0,
        {
          count:
            Math.floor((options.lanterns ?? 108) / 3) +
            (j < (options.lanterns ?? 108) % 3 ? 1 : 0),
          minH: 22 + j * 4,
          maxH: 76 + j * 6,
          spread: 148 * L,
          color: "#ffc076",
          glow: 1.5,
          seed: vary ? ((options.seed + j * 9) % 99) + 1 : 17 + j * 9,
        },
        {
          name: "孔明灯 · 缓缓浮游",
          y: 0,
          m: { ...motion(pts, "idle"), autoFace: false },
        },
      ),
    );
  }
  for (let i = 0; i < (options.townPeople ?? 24); i++) {
    const side = i % 2 ? 1 : -1,
      z = Z(
        -80 +
          (Math.floor(i / 2) * 154) /
            Math.max(1, Math.ceil((options.townPeople ?? 24) / 2) - 1),
      ),
      x = riverX(z) + side * (halfRiver + 4.8),
      pts = [];
    for (const [dz, dx] of [
      [0, 0],
      [-14, 0],
      [-14, 0.55],
      [0, 0.55],
      [0, 0],
    ])
      pts.push([riverX(z + dz) + side * (halfRiver + 4.8 + dx), 0.1, z + dz]);
    ancient.push(
      O(
        i % 2 ? HUMAN : "char:human:女性",
        x,
        z,
        0,
        {
          top: ["#a45c42", "#576c7a", "#c69b62", "#6e7976"][i % 4],
          height: 1.6 + (i % 3) * 0.08,
          anim: "walk",
        },
        { name: "灯市游人 · 沿河行走", y: 0.1, m: motion(pts) },
      ),
    );
  }
  // Bridge walkers use the actual circular arch profile and do not terrain-snap through the deck.
  const bridgeY = (x) => {
    const R = (bridgeHalf * bridgeHalf + 4.8 * 4.8) / 9.6;
    return 4.8 - R + Math.sqrt(R * R - x * x) + 0.15;
  };
  for (let i = 0; i < (options.bridgePeople ?? 4); i++) {
    const zs = [-1.9, -0.8, 0.8, 1.9][i],
      pts = Array.from({ length: 33 }, (_, k) => {
        const x = -bridgeHalf + (k * bridgeHalf * 2) / 32;
        return [x, bridgeY(x), zs];
      });
    if (i % 2) pts.reverse();
    const back = pts
      .slice(0, -1)
      .reverse()
      .map(([x, y, z]) => [x, y, z + 0.22]);
    pts.push(...back, [...pts[0]]);
    ancient.push(
      O(
        HUMAN,
        pts[0][0],
        zs,
        0,
        { top: ["#bb6d43", "#567584", "#b89e72", "#746b83"][i], anim: "walk" },
        { y: pts[0][1], name: "过桥游人 · 拱面关键点", m: motion(pts) },
      ),
    );
  }
  // Shared assembly functions tag editable host/attachment parts, not opaque meshes.
  cyberFrontage(urban);
  riverFrontage(ancient);
  const scenes = [
    {
      id: "cyber-rain",
      name: "霓雨深城 · 悬浮航道",
      cat: "高质量示例",
      desc: "街区人眼起机 · 巨构夹巷 / 双层消防梯 / 九辆悬浮车 / 往来行人 / 雨与浓雾",
      authored: true,
      terrain: { enabled: false, water: false },
      atmos: "night",
      duration: 30,
      weather: { type: "rain", style: "streaks", seed: 82 },
      light: {
        sunInt: 0.35,
        ambInt: 0.4,
        hemiInt: 0.55,
        fill: 0.3,
        skyTop: "#08121f",
        skyMid: "#142537",
        skyBot: "#101b28",
        fogColor: "#16313e",
        fogDens: 0.017,
        glow: 1.45,
        exposure: 1.13,
        shadow: false,
      },
      bloom: {
        enabled: true,
        strength: 0.42,
        radius: 0.32,
        threshold: 1.15,
        quality: "medium",
        mode: "all",
      },
      objs: urban,
      view: { pos: [3, 1.75, 68], target: [-1, 12, -12], fov: 63 },
      shots: [
        {
          n: "01 · 雨巷人眼缓推",
          f: 24,
          from: [3, 1.75, 68],
          to: [-1, 12, -12],
          d: 30,
          mv: "push",
          p: { dist: 14, elev: 0, aim: false },
        },
        {
          n: "02 · 楼隙悬浮航道",
          f: 28,
          from: [6, 26, 56],
          to: [0, 28, -55],
          d: 30,
          mv: "push",
          p: { dist: 20, elev: 2, aim: false },
        },
        {
          n: "03 · 雨城纵深全景",
          f: 24,
          from: [7, 62, 108],
          to: [0, 35, -30],
          d: 30,
        },
      ],
    },
    {
      id: "lantern-river",
      name: "万家灯火 · 望河古城",
      cat: "高质量示例",
      desc: "S形河流两岸灯市 · 沿河街 / 中轴石拱桥 / 跨街牌楼 / 远景佛塔 / 百盏孔明灯",
      authored: true,
      terrain: {
        enabled: true,
        size: options.terrainSize ?? 320,
        biome: "rock",
        water: false,
      },
      river: {
        id: "festival-river",
        name: "望河 · 古城主河道",
        points: riverPoints,
        width: halfRiver * 2,
        depth: 3,
        bank: 3,
        water: true,
      },
      roads,
      atmos: "night",
      duration: 30,
      weather: null,
      light: {
        sunInt: 0.55,
        sunColor: "#a0bcf4",
        ambInt: 0.94,
        hemiInt: 1.15,
        fill: 0.34,
        skyTop: "#050d20",
        skyMid: "#122840",
        skyBot: "#152a3a",
        fogColor: "#1d3449",
        fogDens: 0.0024,
        glow: 1.2,
        exposure: 1.18,
        shadow: false,
      },
      bloom: {
        enabled: true,
        strength: 0.4,
        radius: 0.28,
        threshold: 1.2,
        quality: "medium",
        mode: "all",
      },
      objs: ancient,
      view: { pos: [-8, 13, 83], target: [-2, 7, -12], fov: 58 },
      shots: [
        {
          n: "01 · 河街望桥与佛塔",
          f: 27,
          from: [-8, 13, 83],
          to: [-2, 7, -12],
          d: 30,
          mv: "push",
          p: { dist: 10, elev: 1, aim: false },
        },
        {
          n: "02 · 中轴穿牌楼望石桥",
          f: 28,
          from: [-65, 2.1, 0],
          to: [10, 4, 0],
          d: 30,
          mv: "push",
          p: { dist: 12, elev: 0, aim: false },
        },
        {
          n: "03 · 灯河双岸全景",
          f: 26,
          from: [-62, 47, 95],
          to: [4, 6, -20],
          d: 30,
        },
        {
          n: "04 · 桥上灯市人眼",
          f: 28,
          from: [-6, 6.1, 1],
          to: [34, 3.5, -9],
          d: 30,
        },
      ],
    },
  ];

  for (const sc of scenes) {
    const isCity = sc.id === "cyber-rain";
    if (vary) {
      const mapPoint = (p) =>
        isCity ? [p[0], p[1], (p[2] * extent) / 84] : [p[0], p[1], p[2] * L];
      sc.view.pos = mapPoint(sc.view.pos);
      sc.view.target = mapPoint(sc.view.target);
      for (const shot of sc.shots) {
        shot.from = mapPoint(shot.from);
        shot.to = mapPoint(shot.to);
      }
      if (!isCity) {
        sc.view.pos[0] = riverX(sc.view.pos[2]) - halfRiver * 0.6;
        sc.shots[0].from = [...sc.view.pos];
      }
    }
  }
  return scenes;
}
export const SHOWCASE_SCENES = buildShowcaseScenes();
