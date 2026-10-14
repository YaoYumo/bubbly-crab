// ---------------------------------------------------------------------------
// 第三组示例场景：《布局图鉴·中式古建与现代城市》12 布局（Atlas 01–12）
// 声明式格式同 scenes.js：objs = [库键, x, z, 旋转, 参数, 额外{y,s,m,follow}]
// 键由 K() 从 LIB 现取完整三元组，避免名称字面量失配。
// ---------------------------------------------------------------------------
import { LIB } from './assets.js';

const K = (g, t) => {
  const grp = LIB.find((x) => x.id === g);
  const it = grp && grp.items.find((i) => i.type === t);
  return it ? `${g}:${t}:${it.name}` : `${g}:${t}:?`;
};
const ring = (n, R, fn, phase = 0) => { const out = []; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + phase; out.push(fn(Math.sin(a) * R, Math.cos(a) * R, a, k)); } return out; };

export const SCENES3 = [];
const S = (o) => SCENES3.push(o);
const view = (x, y, z, tx = 0, ty = 0, tz = 0) => ({ pos: [x, y, z], target: [tx, ty, tz] });

/* 01 宫城：中轴对称 / 前朝后寝 / 城垣四角角楼 */
S({
  id: 'atlas-01-palace', cat: '布局图鉴·中式', name: '01 宫城 Palace Complex',
  desc: '南北中轴贯穿：城门—前三殿—后寝—御花园；城垣围合、四角角楼、两庑对称。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'citywall'), 0, -80, 0, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), 0, 80, Math.PI, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), -80, 0, Math.PI / 2, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), 80, 0, Math.PI / 2, { length: 160, height: 8, tower: true }],
    [K('cn', 'pavilion'), -80, -80, 0, { r: 4, h: 5 }, { s: 1.2 }], [K('cn', 'pavilion'), 80, -80, 0, { r: 4, h: 5 }, { s: 1.2 }],
    [K('cn', 'pavilion'), -80, 80, 0, { r: 4, h: 5 }, { s: 1.2 }], [K('cn', 'pavilion'), 80, 80, 0, { r: 4, h: 5 }, { s: 1.2 }],
    [K('cn', 'spiritway'), 0, 66, 0, { length: 26 }],
    [K('cn', 'gate'), 0, 50, 0, { w: 26, wallH: 9 }],
    [K('cn', 'hall'), 0, 18, 0, { w: 30, d: 16, h: 6.5, eaves2: true, dougong: true }],
    [K('cn', 'hall2'), 0, -12, 0, { w: 20, d: 10 }],
    [K('cn', 'hall'), 0, -38, 0, { w: 16, d: 9, h: 5 }, { s: 0.9 }],
    [K('cn', 'hall2'), -38, 18, Math.PI / 2, { w: 16, d: 8 }], [K('cn', 'hall2'), 38, 18, -Math.PI / 2, { w: 16, d: 8 }],
    [K('cn', 'corridor'), -22, 2, Math.PI / 2, { length: 36 }], [K('cn', 'corridor'), 22, 2, Math.PI / 2, { length: 36 }],
    [K('cn', 'corridor'), -22, -26, Math.PI / 2, { length: 24 }], [K('cn', 'corridor'), 22, -26, Math.PI / 2, { length: 24 }],
    [K('cn', 'moongate'), 0, -52, 0, { length: 8 }],
    [K('cn', 'pavilion'), -14, -64, 0, { r: 3 }], [K('cn', 'pavilion'), 14, -64, 0, { r: 3 }],
    [K('cn', 'lanternpole'), -10, 40, 0, {}], [K('cn', 'lanternpole'), 10, 40, 0, {}],
    [K('cn', 'lanternpole'), -10, 32, 0, {}], [K('cn', 'lanternpole'), 10, 32, 0, {}],
  ],
  view: view(0, 120, 175, 0, 0, -10),
});

/* 02 四合院：门开东南 / 垂花门 / 正房坐北 / 十字甬路 */
S({
  id: 'atlas-02-siheyuan', cat: '布局图鉴·中式', name: '02 四合院 Siheyuan',
  desc: '二进院：东南大门、影壁垂花门、正房坐北朝南、东西厢对称、十字甬路、外围民居环衬。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'courtyard'), 0, 0, 0, { w: 30, d: 34, wings: true, gate: true, screen: true, chui: true, corr: true }],
    [K('cn', 'folkhouse'), 0, -27, Math.PI, { w: 12 }], [K('cn', 'folkhouse'), 0, 27, 0, { w: 12 }],
    [K('cn', 'folkhouse'), -27, 0, Math.PI / 2, { w: 12 }], [K('cn', 'folkhouse'), 27, 0, -Math.PI / 2, { w: 12 }],
    [K('cn', 'gate'), 21, 25, -Math.PI / 2, { w: 12, wallH: 5 }],
    [K('road', 'garden_path'), 21, 35, Math.PI / 2, { length: 20, width: 1.5 }],
    [K('vegetation', 'sugar_maple'), -10, -10, 0, {}, { s: 0.8 }], [K('vegetation', 'sugar_maple'), 10, -10, 0, {}, { s: 0.8 }],
    [K('vegetation', 'sugar_maple'), -10, 10, 0, {}, { s: 0.7 }], [K('vegetation', 'sugar_maple'), 10, 10, 0, {}, { s: 0.7 }],
    [K('cn', 'lanternpole'), -6, 21, 0, {}], [K('cn', 'lanternpole'), 6, 21, 0, {}],
  ],
  view: view(58, 55, 78),
});

/* 03 佛寺：山门—钟鼓—殿阁递进 / 廊庑围合 */
S({
  id: 'atlas-03-temple', cat: '布局图鉴·中式', name: '03 佛寺 Buddhist Temple',
  desc: '汉传伽蓝七堂：牌楼山门、东钟西鼓、天王殿—香炉—大雄宝殿(高台)—塔阁，廊庑围合多进。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'paifang'), 0, 44, 0, {}],
    [K('cn', 'drumtower'), -16, 30, 0, {}, { s: 0.8 }], [K('cn', 'pavilion'), 16, 30, 0, { r: 3, h: 4 }],
    [K('cn', 'hall'), 0, 14, 0, { w: 14, d: 8, h: 4.5 }],
    [K('cn', 'ding'), 0, 0, 0, { r: 1.2, h: 1.2 }],
    [K('cn', 'earthterrace'), 0, -16, 0, { w: 22, d: 14, h: 2.4, rail: true, stairs: true }],
    [K('cn', 'hall2'), 0, -16, 0, { w: 24, d: 12, h: 5, dougong: true }, { y: 2.4 }],
    [K('cn', 'pagoda'), 0, -44, 0, { levels: 5, r: 4 }],
    [K('cn', 'corridor'), -18, -2, Math.PI / 2, { length: 40 }], [K('cn', 'corridor'), 18, -2, Math.PI / 2, { length: 40 }],
    [K('cn', 'corridor'), 0, -30, 0, { length: 36 }], [K('cn', 'corridor'), 0, 24, 0, { length: 36 }],
    [K('vegetation', 'quaking_aspen'), -24, 18, 0, {}], [K('vegetation', 'quaking_aspen'), 24, 18, 0, {}],
    [K('vegetation', 'quaking_aspen'), -24, -20, 0, {}], [K('vegetation', 'quaking_aspen'), 24, -20, 0, {}],
  ],
  view: view(70, 70, 95, 0, 0, -5),
});

/* 04 殿堂柱网：面阔进深 / 周围廊 / 台基三出陛 */
S({
  id: 'atlas-04-hallgrid', cat: '布局图鉴·中式', name: '04 殿堂柱网 Hall Column Grid',
  desc: '官式大殿：高台三出陛、殿身面阔十一间、外檐周围廊一周、宫灯鼎炉仪卫。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'earthterrace'), 0, 0, 0, { w: 24, d: 14, h: 3, rail: true, stairs: true, cols: true }],
    [K('cn', 'hall'), 0, 0, 0, { bay: 4.5, w: 26, d: 12, h: 6, dougong: true, eaves2: true, innerCols: true }, { y: 3 }],
    [K('cn', 'corridor'), 0, 10, 0, { length: 36 }], [K('cn', 'corridor'), 0, -10, 0, { length: 36 }],
    [K('cn', 'corridor'), -17, 0, Math.PI / 2, { length: 20 }], [K('cn', 'corridor'), 17, 0, Math.PI / 2, { length: 20 }],
    [K('cn', 'lanternpole'), -20, -6, 0, {}], [K('cn', 'lanternpole'), 20, -6, 0, {}],
    [K('cn', 'lanternpole'), -20, 6, 0, {}], [K('cn', 'lanternpole'), 20, 6, 0, {}],
    [K('cn', 'ding'), -8, 9, 0, { r: 0.9 }], [K('cn', 'ding'), 8, 9, 0, { r: 0.9 }],
    [K('cn', 'spiritway'), 0, 26, 0, { length: 24 }],
  ],
  view: view(46, 40, 62, 0, 2, 0),
});

/* 05 苏州园林：以水为心 / 曲径通幽 / 月洞门 */
S({
  id: 'atlas-05-garden', cat: '布局图鉴·中式', name: '05 苏州园林 Suzhou Garden',
  desc: '以水为心：曲岸池面、九曲石桥、亭榭错落、游廊随墙曲折、月洞门分隔小院。',
  terrain: { enabled: true, size: 160, basin: [[0, 0, 18, 1.3]], water: true, waterY: -0.6 },
  objs: [
    [K('cn', 'archbridge'), -4, 0, Math.PI / 4, { span: 9, rise: 2.2 }],
    [K('cn', 'archbridge'), 4, 2, -Math.PI / 4, { span: 9, rise: 2.2 }],
    [K('cn', 'archbridge'), 0, -6, 0, { span: 8, rise: 2 }],
    [K('cn', 'pavilion'), -22, -6, 0, { r: 2.6 }], [K('cn', 'pavilion'), 20, -12, 0, { r: 3 }], [K('cn', 'pavilion'), 16, 16, 0, { r: 2.4 }],
    ...ring(8, 30, (x, z, a) => [K('cn', 'corridor'), x, z, a + Math.PI / 2, { length: 16 }]),
    [K('cn', 'moongate'), 30, 0, Math.PI / 2, { length: 6 }],
    [K('cn', 'pavilion'), 38, 6, 0, { r: 2.2 }],
    [K('vegetation', 'quaking_aspen'), 38, -6, 0, {}, { s: 0.8 }], [K('vegetation', 'quaking_aspen'), 41, 2, 0, {}, { s: 0.7 }],
    [K('vegetation', 'sugar_maple'), -28, 18, 0, {}, { s: 0.9 }], [K('vegetation', 'sugar_maple'), -24, -20, 0, {}, { s: 0.8 }],
    [K('vegetation', 'sugar_maple'), 24, -22, 0, {}, { s: 0.9 }], [K('vegetation', 'sugar_maple'), -30, 0, 0, {}, { s: 0.7 }],
  ],
  view: view(55, 45, 72),
});

/* 06 唐长安城：里坊制 / 朱雀大街 / 东西两市 / 宫城居北 */
S({
  id: 'atlas-06-tangcity', cat: '布局图鉴·中式', name: '06 唐长安城 Tang City',
  desc: '棋盘里坊：外郭方正、朱雀大街贯南北中轴、宫城皇城居北、东西两市对称、坊墙封闭。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'citywall'), 0, -80, 0, { length: 160, height: 10, tower: true }],
    [K('cn', 'citywall'), 0, 80, Math.PI, { length: 160, height: 10, tower: true }],
    [K('cn', 'citywall'), -80, 0, Math.PI / 2, { length: 160, height: 10, tower: true }],
    [K('cn', 'citywall'), 80, 0, Math.PI / 2, { length: 160, height: 10, tower: true }],
    [K('cn', 'gate'), 0, 80, Math.PI, { w: 22 }], [K('cn', 'gate'), 0, -80, 0, { w: 22 }],
    [K('cn', 'gate'), -80, 0, Math.PI / 2, { w: 22 }], [K('cn', 'gate'), 80, 0, -Math.PI / 2, { w: 22 }],
    [K('road', 'two_way_road'), 0, 15, 0, { width: 14, length: 130 }],
    [K('road', 'two_way_road'), -48, 15, 0, { width: 8, length: 130 }], [K('road', 'two_way_road'), 48, 15, 0, { width: 8, length: 130 }],
    [K('road', 'two_way_road'), 0, 55, Math.PI / 2, { width: 8, length: 150 }],
    [K('road', 'two_way_road'), 0, -20, Math.PI / 2, { width: 8, length: 150 }],
    [K('road', 'two_way_road'), 0, -45, Math.PI / 2, { width: 8, length: 150 }],
    [K('cn', 'citywall'), 0, -52, 0, { length: 44, height: 6 }], [K('cn', 'citywall'), 0, -74, Math.PI, { length: 44, height: 6 }],
    [K('cn', 'citywall'), -22, -63, Math.PI / 2, { length: 22, height: 6 }], [K('cn', 'citywall'), 22, -63, Math.PI / 2, { length: 22, height: 6 }],
    [K('cn', 'gate'), 0, -52, 0, { w: 14, wallH: 6 }],
    [K('cn', 'hall'), 0, -62, 0, { w: 22, d: 12, h: 5.5 }], [K('cn', 'hall2'), 0, -70, 0, { w: 14, d: 8 }],
    [K('cn', 'streetshop'), -52, 30, 0, {}], [K('cn', 'streetshop'), -60, 30, Math.PI, {}], [K('cn', 'streetshop'), -52, 36, 0, {}], [K('cn', 'streetshop'), -60, 36, Math.PI, {}],
    [K('cn', 'streetshop'), 52, 30, 0, {}], [K('cn', 'streetshop'), 60, 30, Math.PI, {}], [K('cn', 'streetshop'), 52, 36, 0, {}], [K('cn', 'streetshop'), 60, 36, Math.PI, {}],
    [K('cn', 'pagoda'), -48, -38, 0, { levels: 5 }, { s: 0.9 }], [K('cn', 'pagoda'), 48, -38, 0, { levels: 5 }, { s: 0.9 }],
    ...[[-24, 25], [24, 25], [-24, 65], [24, 65], [-64, 65], [64, 65], [-64, -38], [64, -38]].flatMap(([x, z]) => [
      [K('cn', 'folkhouse'), x - 5, z, 0, { w: 8 }], [K('cn', 'folkhouse'), x + 5, z, Math.PI, { w: 8 }],
      [K('cn', 'folkhouse'), x, z - 5, Math.PI / 2, { w: 8 }], [K('cn', 'folkhouse'), x, z + 5, -Math.PI / 2, { w: 8 }]]),
    ...[-30, -10, 10, 30, 50].flatMap((z) => [[K('vegetation', 'quaking_aspen'), -6, z, 0, {}, { s: 0.8 }], [K('vegetation', 'quaking_aspen'), 6, z, 0, {}, { s: 0.8 }]]),
  ],
  view: view(0, 150, 195),
});

/* 07 客家土楼：同心圆环 / 夯土厚墙 / 祖堂居中 / 单门防御 */
S({
  id: 'atlas-07-tulou', cat: '布局图鉴·中式', name: '07 客家土楼 Hakka Tulou',
  desc: '同心圆环形聚居：外环夯土墙围合、房间沿圆周放射、内环附属用房、中心祖堂、全楼仅一座大门。',
  terrain: { enabled: false },
  objs: [
    ...ring(12, 42, (x, z, a, k) => (k === 0 ? [K('cn', 'gate'), x, z, a, { w: 12, wallH: 7 }] : [K('cn', 'citywall'), x, z, a, { length: 22, height: 7, thick: 4, stairs: false }])),
    ...ring(16, 34, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6, d: 4.5 }]),
    ...ring(10, 18, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 5, d: 4 }]),
    [K('cn', 'hall'), 0, 0, 0, { w: 12, d: 8, h: 4.5 }],
    [K('cn', 'ding'), -8, 10, 0, { r: 0.8 }], [K('cn', 'ding'), 8, 10, 0, { r: 0.8 }],
    [K('cn', 'lanternpole'), -12, -12, 0, {}], [K('cn', 'lanternpole'), 12, -12, 0, {}],
    [K('cn', 'lanternpole'), -12, 12, 0, {}], [K('cn', 'lanternpole'), 12, 12, 0, {}],
  ],
  view: view(72, 62, 92),
});

/* 08 宗祠：中轴对称 / 戏台对享堂 / 前堂后寝 / 天井院落 */
S({
  id: 'atlas-08-ancestral', cat: '布局图鉴·中式', name: '08 宗祠 Ancestral Hall',
  desc: '宗族祭祀中轴：门厅后戏台面北朝享堂、中天井院落、享堂居中、寝堂在后、东西厢廊对称。',
  terrain: { enabled: false },
  objs: [
    [K('cn', 'moongate'), 0, 34, 0, { length: 8 }],
    [K('cn', 'pavilion'), 0, 20, Math.PI, { r: 3.4, h: 3.6 }],
    [K('cn', 'hall'), 0, -2, 0, { w: 18, d: 10, h: 5 }],
    [K('cn', 'hall2'), 0, -20, 0, { w: 14, d: 8 }],
    [K('cn', 'corridor'), -14, -6, Math.PI / 2, { length: 30 }], [K('cn', 'corridor'), 14, -6, Math.PI / 2, { length: 30 }],
    [K('road', 'garden_path'), 0, 10, 0, { length: 16, width: 1.5 }], [K('road', 'garden_path'), 0, 10, Math.PI / 2, { length: 20, width: 1.5 }],
    [K('cn', 'ding'), 4, 10, 0, { r: 0.9 }],
    [K('vegetation', 'sugar_maple'), -10, 14, 0, {}, { s: 0.8 }], [K('vegetation', 'sugar_maple'), 10, 14, 0, {}, { s: 0.8 }],
    [K('cn', 'citywall'), 0, -28, 0, { length: 46, height: 4 }], [K('cn', 'citywall'), 0, 40, Math.PI, { length: 46, height: 4 }],
    [K('cn', 'citywall'), -23, 6, Math.PI / 2, { length: 68, height: 4 }], [K('cn', 'citywall'), 23, 6, Math.PI / 2, { length: 68, height: 4 }],
  ],
  view: view(52, 46, 68),
});

/* 09 方格网城市：正交街网 / 高密度核心 / 中央公园 / 地块标准化 */
S({
  id: 'atlas-09-gridcbd', cat: '布局图鉴·现代', name: '09 方格网城市 Grid CBD',
  desc: '正交方格街网：统一街廓、主干次街分级、高密度核心环绕中央公园、地块标准化。',
  terrain: { enabled: false },
  objs: [
    ...[-72, -24, 24, 72].map((x) => [K('road', 'two_way_road'), x, 0, 0, { width: 10, length: 180 }]),
    ...[-72, -24, 24, 72].map((z) => [K('road', 'two_way_road'), 0, z, Math.PI / 2, { width: 10, length: 180 }]),
    [K('cls', 'gazebo'), 0, 0, 0, {}],
    [K('road', 'garden_path'), 0, 0, 0, { length: 40, width: 2 }], [K('road', 'garden_path'), 0, 0, Math.PI / 2, { length: 40, width: 2 }],
    ...[[-9, -9], [9, -9], [-9, 9], [9, 9], [-15, 0], [15, 0], [0, -15], [0, 15]].map(([x, z]) => [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.9 }]),
    [K('cls', 'clocktower'), 48, 48, 0, {}], [K('cls', 'capitol'), -48, 48, 0, {}],
    [K('cls', 'church'), 48, -48, 0, {}], [K('cls', 'mansion'), -48, -48, 0, {}],
    [K('cls', 'brownstone'), 48, 0, Math.PI / 2, {}], [K('cls', 'brownstone'), -48, 0, -Math.PI / 2, {}],
    [K('cls', 'brownstone'), 0, 48, 0, {}], [K('cls', 'brownstone'), 0, -48, Math.PI, {}],
    ...[[96, 0], [-96, 0], [0, 96], [0, -96], [96, 96], [-96, 96], [96, -96], [-96, -96]].map(([x, z], i) => [K('house', i % 2 ? 'spanish_colonial' : 'cape_cod'), x, z, 0, {}]),
    ...[-60, -20, 20, 60].flatMap((z) => [[K('traffic', 'street_lamp'), -24, z, 0, {}], [K('traffic', 'street_lamp'), 24, z, 0, {}]]),
  ],
  view: view(0, 160, 205),
});

/* 10 环形放射城市：中心放射 / 多层环路 / 绿带环绕 / 组团居住 */
S({
  id: 'atlas-10-ringradial', cat: '布局图鉴·现代', name: '10 环形放射城市 Ring-Radial',
  desc: '田园城市理念：中心广场与公共建筑居中、多层环路与放射干道组织交通、环间居住组团、外围绿带。',
  terrain: { enabled: false },
  objs: [
    [K('road', 'roundabout'), 0, 0, 0, { width: 22, length: 22 }],
    [K('cn', 'ding'), 0, 0, 0, { r: 1.5, h: 1.2 }, { y: 0.33 }],
    ...ring(8, 52, (x, z, a) => [K('road', 'two_way_road'), x, z, a, { width: 8, length: 56 }]),
    ...ring(8, 30, (x, z, a) => [K('road', 'two_way_road'), x, z, a + Math.PI / 2, { width: 7, length: 22 }]),
    ...ring(12, 64, (x, z, a) => [K('road', 'two_way_road'), x, z, a + Math.PI / 2, { width: 7, length: 24 }]),
    ...ring(16, 46, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6 }]),
    ...ring(18, 80, (x, z) => [K('vegetation', 'quaking_aspen'), x, z, 0, {}, { s: 0.9 }]),
  ],
  view: view(0, 140, 185),
});

/* 11 超级街区：外围通行 / 内部步行 / 街道变广场 / 八角切角街廓 */
S({
  id: 'atlas-11-superblock', cat: '布局图鉴·现代', name: '11 超级街区 Superblock',
  desc: '3×3 街廓合并：过境车流绕行外围、内部街道步行化改广场绿地、切角街廓围合。',
  terrain: { enabled: false },
  objs: [
    [K('road', 'two_way_road'), 0, 48, Math.PI / 2, { width: 12, length: 104 }], [K('road', 'two_way_road'), 0, -48, Math.PI / 2, { width: 12, length: 104 }],
    [K('road', 'two_way_road'), -48, 0, 0, { width: 12, length: 104 }], [K('road', 'two_way_road'), 48, 0, 0, { width: 12, length: 104 }],
    [K('road', 'garden_path'), 0, 0, 0, { length: 80, width: 2 }], [K('road', 'garden_path'), 0, 0, Math.PI / 2, { length: 80, width: 2 }],
    [K('road', 'garden_path'), 0, 0, Math.PI / 4, { length: 68, width: 2 }], [K('road', 'garden_path'), 0, 0, -Math.PI / 4, { length: 68, width: 2 }],
    [K('cls', 'gazebo'), 24, 24, 0, {}], [K('cls', 'gazebo'), -24, -24, 0, {}], [K('cls', 'gazebo'), 24, -24, 0, {}], [K('cls', 'gazebo'), -24, 24, 0, {}],
    ...[[12, 0], [-12, 0], [0, 12], [0, -12], [20, -20], [-20, 20], [20, 20], [-20, -20]].map(([x, z]) => [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.85 }]),
    ...[[30, 58], [-30, 58], [30, -58], [-30, -58]].map(([x, z]) => [K('cls', 'brownstone'), x, z, z > 0 ? Math.PI : 0, {}]),
    ...[[58, 30], [58, -30], [-58, 30], [-58, -30]].map(([x, z]) => [K('cls', 'brownstone'), x, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, {}]),
    ...[[58, 58], [-58, 58], [58, -58], [-58, -58]].map(([x, z]) => [K('cls', 'mansion'), x, z, Math.PI / 4, {}]),
    ...[[40, 0], [-40, 0], [0, 40], [0, -40]].flatMap(([x, z]) => [[K('traffic', 'bollard'), x + (z ? 1.5 : 0), z + (x ? 1.5 : 0), 0, {}], [K('traffic', 'bollard'), x - (z ? 1.5 : 0), z - (x ? 1.5 : 0), 0, {}]]),
  ],
  view: view(0, 120, 155),
});

/* 12 TOD 公交导向片区：站城一体 / 密度梯度 / 小街区密路网 / 慢行优先 */
S({
  id: 'atlas-12-tod', cat: '布局图鉴·现代', name: '12 TOD 公交导向片区 TOD District',
  desc: '轨道站为核心：500 米步行圈高密度混合开发、密度由站点向外递减、慢行廊道与绿楔串联组团。',
  terrain: { enabled: false },
  objs: [
    [K('road', 'concrete_road'), 0, 14, Math.PI / 2, { width: 9, length: 220 }],
    [K('cls', 'capitol'), 0, 0, Math.PI, {}, { s: 1.1 }],
    [K('road', 'roundabout'), 0, 32, 0, { width: 20, length: 20 }],
    ...ring(4, 26, (x, z, a) => [K('cls', 'clocktower'), x, z, a + Math.PI, {}]),
    ...ring(6, 26, (x, z, a) => [K('cls', 'brownstone'), x, z, a + Math.PI, {}], 0.5),
    ...ring(10, 46, (x, z, a) => [K('house', 'spanish_colonial'), x, z, a + Math.PI, {}]),
    ...ring(12, 68, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6 }]),
    ...ring(6, 40, (x, z, a) => [K('road', 'garden_path'), x, z, a, { length: 30, width: 1.5 }]),
    ...ring(10, 58, (x, z, a, k) => (k % 5 === 0 ? [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.9 }] : null)).filter(Boolean),
    ...[-12, -4, 4, 12].map((x) => [K('traffic', 'street_lamp'), x, 24, 0, {}]),
  ],
  view: view(0, 140, 185, 0, 0, 10),
});
