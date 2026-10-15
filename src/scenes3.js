// ---------------------------------------------------------------------------
// 第三组示例场景：《布局图鉴·中式古建与现代城市》12 布局（Atlas 01–12）v2
// 声明式格式同 scenes.js：objs = [库键, x, z, 旋转, 参数, 额外{y,s,m,follow}]
// v2：① 地形支持——terrain 启用 + basin 挖水系（护城河/放生池/半月池/曲江池/园池）
//     与负深度堆丘（假山/案山/背景山/绿带），水位统一 -0.5m；
//     ② 密度翻倍：配殿/配楼/民居环/植被行/交通管理件/市政件；
//     ③ 布局修正：桥跨水、门对路、丘上只放亭树（建筑不压丘防架空）。
// ---------------------------------------------------------------------------
import { LIB } from './assets.js';

const K = (g, t) => {
  const grp = LIB.find((x) => x.id === g);
  const it = grp && grp.items.find((i) => i.type === t);
  return it ? `${g}:${t}:${it.name}` : `${g}:${t}:?`;
};
const ring = (n, R, fn, phase = 0) => { const out = []; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + phase; out.push(fn(Math.sin(a) * R, Math.cos(a) * R, a, k)); } return out; };
// 地形：平地起景——basin 正深度挖水、负深度堆丘；水系场景水位 -0.5m
const T = (size, basin, water = false) => ({ enabled: true, size, basin, water, waterY: water ? -0.5 : null });
// 护城河环：矩形四边每隔 step 一个圆盆
const moat = (off, r, depth, step) => {
  const out = [];
  for (let s = -off; s <= off; s += step) {
    out.push([s, -off, r, depth], [s, off, r, depth], [-off, s, r, depth], [off, s, r, depth]);
  }
  return out;
};

export const SCENES3 = [];
const S = (o) => SCENES3.push(o);
const view = (x, y, z, tx = 0, ty = 0, tz = 0) => ({ pos: [x, y, z], target: [tx, ty, tz] });

/* 01 宫城：中轴对称 / 前朝后寝 / 护城河环绕 / 四角角楼 / 御景山 */
S({
  id: 'atlas-01-palace', cat: '布局图鉴·中式', name: '01 宫城 Palace Complex',
  desc: '南北中轴：护城河桥—城门—前三殿—后寝—御景山；城垣围合、四角角楼、东西掖门、两庑配殿对称。',
  terrain: T(240, [...moat(96, 10, 1.5, 16)], true),
  objs: [
    [K('cn', 'archbridge'), 0, 96, 0, { span: 16, rise: 2.6 }, { y: 0, follow: false }],
    [K('cn', 'citywall'), 0, -80, 0, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), 0, 80, Math.PI, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), -80, 0, Math.PI / 2, { length: 160, height: 8, tower: true }],
    [K('cn', 'citywall'), 80, 0, Math.PI / 2, { length: 160, height: 8, tower: true }],
    [K('cn', 'gate'), -80, 0, Math.PI / 2, { w: 14, wallH: 7 }], [K('cn', 'gate'), 80, 0, -Math.PI / 2, { w: 14, wallH: 7 }],
    [K('cn', 'pavilion'), -80, -80, 0, { r: 4, h: 5 }, { s: 1.2 }], [K('cn', 'pavilion'), 80, -80, 0, { r: 4, h: 5 }, { s: 1.2 }],
    [K('cn', 'pavilion'), -80, 80, 0, { r: 4, h: 5 }, { s: 1.2 }], [K('cn', 'pavilion'), 80, 80, 0, { r: 4, h: 5 }, { s: 1.2 }],
    [K('cn', 'spiritway'), 0, 66, 0, { length: 26 }],
    [K('cn', 'gate'), 0, 50, 0, { w: 26, wallH: 9 }],
    [K('cn', 'hall'), 0, 18, 0, { w: 30, d: 16, h: 6.5, eaves2: true, dougong: true }],
    [K('cn', 'ding'), -7, 34, 0, { r: 1 }], [K('cn', 'ding'), 7, 34, 0, { r: 1 }],
    [K('cn', 'hall2'), 0, -12, 0, { w: 20, d: 10 }],
    [K('cn', 'hall'), 0, -38, 0, { w: 16, d: 9, h: 5 }, { s: 0.9 }],
    [K('cn', 'hall2'), -38, 18, Math.PI / 2, { w: 16, d: 8 }], [K('cn', 'hall2'), 38, 18, -Math.PI / 2, { w: 16, d: 8 }],
    [K('cn', 'hall2'), -38, -14, Math.PI / 2, { w: 14, d: 7 }], [K('cn', 'hall2'), 38, -14, -Math.PI / 2, { w: 14, d: 7 }],
    [K('cn', 'corridor'), -22, 2, Math.PI / 2, { length: 36 }], [K('cn', 'corridor'), 22, 2, Math.PI / 2, { length: 36 }],
    [K('cn', 'corridor'), -22, -26, Math.PI / 2, { length: 24 }], [K('cn', 'corridor'), 22, -26, Math.PI / 2, { length: 24 }],
    [K('cn', 'moongate'), 0, -52, 0, { length: 8 }],
    [K('cn', 'moongate'), 0, -86, 0, { length: 8 }],
    [K('cn', 'pavilion'), -10, -108, 0, { r: 3 }], [K('cn', 'pavilion'), 10, -108, 0, { r: 3 }],
    [K('cn', 'lanternpole'), -10, 40, 0, {}], [K('cn', 'lanternpole'), 10, 40, 0, {}],
    [K('cn', 'lanternpole'), -10, 32, 0, {}], [K('cn', 'lanternpole'), 10, 32, 0, {}],
    ...[-60, -30, 0, 30, 60].flatMap((z) => [[K('vegetation', 'quaking_aspen'), -70, z, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 70, z, 0, {}, { s: 0.9 }]]),
  ],
  view: view(0, 130, 190, 0, 0, -12),
});

/* 02 四合院：门开东南 / 垂花门 / 正房坐北 / 十字甬路 / 街坊环衬 / 北面案山 */
S({
  id: 'atlas-02-siheyuan', cat: '布局图鉴·中式', name: '02 四合院 Siheyuan',
  desc: '二进院：东南大门接巷道甬路、影壁垂花门、正房坐北、东西厢对称、十字甬路；街坊民居环衬、北面案山植树。',
  terrain: T(170, []),
  objs: [
    [K('cn', 'courtyard'), 0, 0, 0, { w: 30, d: 34, wings: true, gate: true, screen: true, chui: true, corr: true }],
    [K('cn', 'folkhouse'), 0, -27, Math.PI, { w: 12 }], [K('cn', 'folkhouse'), 0, 27, 0, { w: 12 }],
    [K('cn', 'folkhouse'), -27, 0, Math.PI / 2, { w: 12 }], [K('cn', 'folkhouse'), 27, 0, -Math.PI / 2, { w: 12 }],
    [K('cn', 'folkhouse'), -27, -27, Math.PI / 4, { w: 9 }], [K('cn', 'folkhouse'), 27, -27, -Math.PI / 4, { w: 9 }],
    [K('cn', 'folkhouse'), -27, 27, 3 * Math.PI / 4, { w: 9 }], [K('cn', 'folkhouse'), 27, 27, -3 * Math.PI / 4, { w: 9 }],
    [K('cn', 'gate'), 21, 25, -Math.PI / 2, { w: 12, wallH: 5 }],
    [K('road', 'garden_path'), 21, 38, Math.PI / 2, { length: 22, width: 1.5 }],
    [K('road', 'garden_path'), 6, 46, Math.PI / 2, { length: 10, width: 1.5 }],
    [K('cn', 'streetshop'), -12, 42, Math.PI, { w: 7 }], [K('cn', 'streetshop'), -21, 42, Math.PI, { w: 7 }],
    [K('cn', 'streetshop'), -12, 48, 0, { w: 7 }], [K('cn', 'streetshop'), -21, 48, 0, { w: 7 }],
    [K('vegetation', 'sugar_maple'), -10, -10, 0, {}, { s: 0.8 }], [K('vegetation', 'sugar_maple'), 10, -10, 0, {}, { s: 0.8 }],
    [K('vegetation', 'sugar_maple'), -10, 10, 0, {}, { s: 0.7 }], [K('vegetation', 'sugar_maple'), 10, 10, 0, {}, { s: 0.7 }],
    [K('vegetation', 'quaking_aspen'), -6, -44, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 4, -46, 0, {}, { s: 0.8 }], [K('vegetation', 'quaking_aspen'), 12, -43, 0, {}, { s: 0.9 }],
    [K('cn', 'lanternpole'), -6, 21, 0, {}], [K('cn', 'lanternpole'), 6, 21, 0, {}],
    [K('cn', 'lanternpole'), 21, 30, 0, {}], [K('cn', 'ding'), -8, 6, 0, { r: 0.6 }],
  ],
  view: view(62, 58, 84),
});

/* 03 佛寺：山门—放生池—钟鼓—殿阁递进 / 廊庑围合 / 背山松柏 */
S({
  id: 'atlas-03-temple', cat: '布局图鉴·中式', name: '03 佛寺 Buddhist Temple',
  desc: '汉传伽蓝七堂：牌楼—放生池桥—天王殿—香炉—大雄宝殿(高台)—塔阁；东钟西鼓、廊庑围合、配殿对称、背山松柏。',
  terrain: T(210, [[0, 36, 7, 1.2]], true),
  objs: [
    [K('cn', 'paifang'), 0, 50, 0, {}],
    [K('cn', 'archbridge'), 0, 36, Math.PI / 2, { span: 10, rise: 2.2 }, { y: 0, follow: false }],
    [K('cn', 'drumtower'), -16, 24, 0, {}, { s: 0.8 }], [K('cn', 'pavilion'), 16, 24, 0, { r: 3, h: 4 }],
    [K('cn', 'hall'), 0, 10, 0, { w: 14, d: 8, h: 4.5 }],
    [K('cn', 'ding'), 0, -2, 0, { r: 1.2, h: 1.2 }],
    [K('cn', 'earthterrace'), 0, -18, 0, { w: 22, d: 14, h: 2.4, rail: true, stairs: true }],
    [K('cn', 'hall2'), 0, -18, 0, { w: 24, d: 12, h: 5, dougong: true }, { y: 2.4 }],
    [K('cn', 'hall2'), -26, -18, Math.PI / 2, { w: 14, d: 8 }], [K('cn', 'hall2'), 26, -18, -Math.PI / 2, { w: 14, d: 8 }],
    [K('cn', 'pagoda'), 0, -46, 0, { levels: 5, r: 4 }],
    [K('cn', 'corridor'), -18, -6, Math.PI / 2, { length: 40 }], [K('cn', 'corridor'), 18, -6, Math.PI / 2, { length: 40 }],
    [K('cn', 'corridor'), 0, -32, 0, { length: 36 }], [K('cn', 'corridor'), 0, 18, 0, { length: 36 }],
    [K('cn', 'lanternpole'), -10, 4, 0, {}], [K('cn', 'lanternpole'), 10, 4, 0, {}],
    [K('cn', 'lanternpole'), -10, -8, 0, {}], [K('cn', 'lanternpole'), 10, -8, 0, {}],
    [K('vegetation', 'douglas_fir'), 0, -66, 0, {}, { s: 1.1 }], [K('vegetation', 'douglas_fir'), -12, -70, 0, {}], [K('vegetation', 'douglas_fir'), 12, -70, 0, {}],
    [K('vegetation', 'douglas_fir'), -22, -64, 0, {}, { s: 0.9 }], [K('vegetation', 'douglas_fir'), 22, -64, 0, {}, { s: 0.9 }],
    [K('vegetation', 'quaking_aspen'), -30, 40, 0, {}], [K('vegetation', 'quaking_aspen'), 30, 40, 0, {}],
    [K('vegetation', 'quaking_aspen'), -30, -34, 0, {}], [K('vegetation', 'quaking_aspen'), 30, -34, 0, {}],
  ],
  view: view(74, 74, 100, 0, 0, -8),
});

/* 04 殿堂柱网：面阔进深 / 周围廊 / 台基三出陛 / 院墙围合 */
S({
  id: 'atlas-04-hallgrid', cat: '布局图鉴·中式', name: '04 殿堂柱网 Hall Column Grid',
  desc: '官式大殿：高台三出陛、殿身面阔十一间、外檐周围廊一周、宫墙围合成院、宫灯鼎炉神道仪卫。',
  terrain: T(150, []),
  objs: [
    [K('cn', 'earthterrace'), 0, 0, 0, { w: 24, d: 14, h: 3, rail: true, stairs: true, cols: true }],
    [K('cn', 'hall'), 0, 0, 0, { bay: 4.5, w: 26, d: 12, h: 6, dougong: true, eaves2: true, innerCols: true }, { y: 3 }],
    [K('cn', 'corridor'), 0, 10, 0, { length: 36 }], [K('cn', 'corridor'), 0, -10, 0, { length: 36 }],
    [K('cn', 'corridor'), -17, 0, Math.PI / 2, { length: 20 }], [K('cn', 'corridor'), 17, 0, Math.PI / 2, { length: 20 }],
    [K('cn', 'citywall'), -17.5, 24, Math.PI, { length: 35, height: 3, thick: 3 }], [K('cn', 'citywall'), 17.5, 24, Math.PI, { length: 35, height: 3, thick: 3 }],
    [K('cn', 'moongate'), 0, 24, 0, { length: 10 }], [K('cn', 'citywall'), 0, -24, 0, { length: 56, height: 3, thick: 3 }],
    [K('cn', 'citywall'), -28, 0, Math.PI / 2, { length: 48, height: 3, thick: 3 }], [K('cn', 'citywall'), 28, 0, Math.PI / 2, { length: 48, height: 3, thick: 3 }],
    [K('cn', 'lanternpole'), -20, -6, 0, {}], [K('cn', 'lanternpole'), 20, -6, 0, {}],
    [K('cn', 'lanternpole'), -20, 6, 0, {}], [K('cn', 'lanternpole'), 20, 6, 0, {}],
    [K('cn', 'lanternpole'), -25, 20, 0, {}], [K('cn', 'lanternpole'), 25, 20, 0, {}],
    [K('cn', 'ding'), -8, 9, 0, { r: 0.9 }], [K('cn', 'ding'), 8, 9, 0, { r: 0.9 }],
    [K('cn', 'ding'), -8, -9, 0, { r: 0.9 }], [K('cn', 'ding'), 8, -9, 0, { r: 0.9 }],
    [K('cn', 'spiritway'), 0, 38, 0, { length: 20 }],
    [K('vegetation', 'quaking_aspen'), -34, 30, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 34, 30, 0, {}, { s: 0.9 }],
    [K('vegetation', 'quaking_aspen'), -34, -30, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 34, -30, 0, {}, { s: 0.9 }],
  ],
  view: view(50, 44, 68, 0, 2, 0),
});

/* 05 苏州园林：以水为心 / 假山三丘 / 曲径通幽 / 月洞门双出 / 茶榭 */
S({
  id: 'atlas-05-garden', cat: '布局图鉴·中式', name: '05 苏州园林 Suzhou Garden',
  desc: '以水为心：曲岸池面、九曲石桥、假山三丘植木、亭榭错落、游廊随墙曲折、东西月洞门分隔小院、茶榭临水。',
  terrain: T(190, [[0, 0, 18, 1.3], [-26, -14, 6, -1.8], [24, -20, 5, -1.4], [-18, 22, 5, -1.2]], true),
  objs: [
    [K('cn', 'archbridge'), -4, 0, Math.PI / 4, { span: 9, rise: 2.2 }, { y: 0, follow: false }],
    [K('cn', 'archbridge'), 4, 2, -Math.PI / 4, { span: 9, rise: 2.2 }, { y: 0, follow: false }],
    [K('cn', 'archbridge'), 0, -6, 0, { span: 8, rise: 2 }, { y: 0, follow: false }],
    [K('cn', 'pavilion'), -22, -6, 0, { r: 2.6 }], [K('cn', 'pavilion'), 20, -12, 0, { r: 3 }], [K('cn', 'pavilion'), 16, 16, 0, { r: 2.4 }],
    ...ring(8, 30, (x, z, a) => [K('cn', 'corridor'), x, z, a + Math.PI / 2, { length: 16 }]),
    [K('cn', 'moongate'), 30, 0, Math.PI / 2, { length: 6 }], [K('cn', 'moongate'), -30, 0, Math.PI / 2, { length: 6 }],
    [K('cn', 'pavilion'), 38, 6, 0, { r: 2.2 }],
    [K('cn', 'streetshop'), 40, -10, -Math.PI / 2, { w: 6 }],
    [K('vegetation', 'quaking_aspen'), -26, -14, 0, {}, { s: 0.9 }], [K('vegetation', 'sugar_maple'), 24, -20, 0, {}, { s: 0.85 }], [K('vegetation', 'quaking_aspen'), -18, 22, 0, {}, { s: 0.8 }],
    [K('vegetation', 'quaking_aspen'), 38, -6, 0, {}, { s: 0.8 }], [K('vegetation', 'quaking_aspen'), 41, 2, 0, {}, { s: 0.7 }],
    [K('vegetation', 'live_oak'), -20, 6, 0, {}, { s: 0.9 }], [K('vegetation', 'live_oak'), 19, 4, 0, {}, { s: 0.85 }],
    [K('vegetation', 'sugar_maple'), -28, 18, 0, {}, { s: 0.9 }], [K('vegetation', 'sugar_maple'), -24, -24, 0, {}, { s: 0.8 }],
    [K('vegetation', 'sugar_maple'), 26, 22, 0, {}, { s: 0.9 }], [K('vegetation', 'sugar_maple'), -32, -2, 0, {}, { s: 0.7 }],
    [K('vegetation', 'bluebonnet'), 34, 14, 0, {}, { s: 0.9 }], [K('vegetation', 'bluebonnet'), -34, 12, 0, {}, { s: 0.9 }],
  ],
  view: view(58, 48, 76),
});

/* 06 唐长安城：里坊坊墙 / 朱雀大街 / 东西两市 / 宫城居北 / 曲江池 */
S({
  id: 'atlas-06-tangcity', cat: '布局图鉴·中式', name: '06 唐长安城 Tang City',
  desc: '棋盘里坊：外郭方正四门、朱雀大街贯轴、宫城皇城居北、东西两市对称、坊墙封闭成坊、东南曲江池苑。',
  terrain: T(240, [[62, 62, 16, 1.6]], true),
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
    ...[[-24, 25], [24, 25]].flatMap(([x, z]) => [
      [K('cn', 'citywall'), x, z - 9, 0, { length: 30, height: 3, thick: 3 }], [K('cn', 'citywall'), x, z + 9, Math.PI, { length: 30, height: 3, thick: 3 }],
      [K('cn', 'citywall'), x - 15, z, Math.PI / 2, { length: 18, height: 3, thick: 3 }], [K('cn', 'citywall'), x + 15, z, Math.PI / 2, { length: 18, height: 3, thick: 3 }]]),
    [K('cn', 'streetshop'), -52, 30, 0, {}], [K('cn', 'streetshop'), -60, 30, Math.PI, {}], [K('cn', 'streetshop'), -52, 36, 0, {}], [K('cn', 'streetshop'), -60, 36, Math.PI, {}],
    [K('cn', 'streetshop'), 52, 30, 0, {}], [K('cn', 'streetshop'), 60, 30, Math.PI, {}], [K('cn', 'streetshop'), 52, 36, 0, {}], [K('cn', 'streetshop'), 60, 36, Math.PI, {}],
    [K('cn', 'streetshop'), -52, 42, 0, {}], [K('cn', 'streetshop'), 52, 42, 0, {}],
    [K('cn', 'pagoda'), -48, -38, 0, { levels: 5 }, { s: 0.9 }], [K('cn', 'pagoda'), 48, -38, 0, { levels: 5 }, { s: 0.9 }],
    ...[[-24, 65], [24, 65], [-64, 65], [64, 65], [-64, -38], [64, -38], [-64, 25], [64, 25]].flatMap(([x, z]) => [
      [K('cn', 'folkhouse'), x - 5, z, 0, { w: 8 }], [K('cn', 'folkhouse'), x + 5, z, Math.PI, { w: 8 }],
      [K('cn', 'folkhouse'), x, z - 5, Math.PI / 2, { w: 8 }], [K('cn', 'folkhouse'), x, z + 5, -Math.PI / 2, { w: 8 }]]),
    [K('cn', 'pavilion'), 62, 46, 0, { r: 2.6 }],
    [K('vegetation', 'live_oak'), 50, 62, 0, {}, { s: 0.9 }], [K('vegetation', 'live_oak'), 74, 62, 0, {}, { s: 0.9 }],
    [K('vegetation', 'live_oak'), 62, 74, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 74, 50, 0, {}, { s: 0.9 }],
    ...[-30, -10, 10, 30, 50].flatMap((z) => [[K('vegetation', 'quaking_aspen'), -6, z, 0, {}, { s: 0.8 }], [K('vegetation', 'quaking_aspen'), 6, z, 0, {}, { s: 0.8 }]]),
  ],
  view: view(0, 155, 200),
});

/* 07 客家土楼：同心圆环 / 夯土厚墙 / 祖堂居中 / 单门防御 / 风水池 / 背山 / 村衬 */
S({
  id: 'atlas-07-tulou', cat: '布局图鉴·中式', name: '07 客家土楼 Hakka Tulou',
  desc: '同心圆环形聚居：外环夯土墙、房间沿圆周放射、内环附属、中心祖堂、全楼一门；门前风水池、背后靠山、外围村衬。',
  terrain: T(230, [[0, 56, 9, 1.3]], true),
  objs: [
    ...ring(12, 42, (x, z, a, k) => (k === 0 ? [K('cn', 'gate'), x, z, a, { w: 12, wallH: 7 }] : [K('cn', 'citywall'), x, z, a, { length: 22, height: 7, thick: 4, stairs: false }])),
    ...ring(16, 34, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6, d: 4.5 }]),
    ...ring(10, 18, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 5, d: 4 }]),
    [K('cn', 'hall'), 0, 0, 0, { w: 12, d: 8, h: 4.5 }],
    [K('cn', 'ding'), -8, 10, 0, { r: 0.8 }], [K('cn', 'ding'), 8, 10, 0, { r: 0.8 }],
    [K('cn', 'lanternpole'), -12, -12, 0, {}], [K('cn', 'lanternpole'), 12, -12, 0, {}],
    [K('cn', 'lanternpole'), -12, 12, 0, {}], [K('cn', 'lanternpole'), 12, 12, 0, {}],
    ...ring(8, 60, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 7 }], Math.PI / 8),
    ...ring(6, 68, (x, z) => [K('vegetation', 'quaking_aspen'), x, z, 0, {}, { s: 0.9 }], Math.PI / 6),
    [K('vegetation', 'douglas_fir'), -78, -40, 0, {}, { s: 1.1 }], [K('vegetation', 'douglas_fir'), 78, -40, 0, {}, { s: 1.1 }],
    [K('vegetation', 'douglas_fir'), -12, -84, 0, {}], [K('vegetation', 'douglas_fir'), 12, -84, 0, {}], [K('vegetation', 'douglas_fir'), 0, -90, 0, {}, { s: 1.2 }],
    [K('vegetation', 'sugar_maple'), -20, 52, 0, {}, { s: 0.8 }], [K('vegetation', 'sugar_maple'), 20, 52, 0, {}, { s: 0.8 }],
  ],
  view: view(76, 66, 96),
});

/* 08 宗祠：中轴对称 / 戏台对享堂 / 前堂后寝 / 天井院落 / 半月池 / 跨宅 */
S({
  id: 'atlas-08-ancestral', cat: '布局图鉴·中式', name: '08 宗祠 Ancestral Hall',
  desc: '宗族祭祀中轴：照壁—半月池桥—门厅—戏台面北朝享堂—中天井—享堂—寝堂；东西厢廊与跨宅对称、背倚案山。',
  terrain: T(190, [[0, 52, 9, 1.3]], true),
  objs: [
    [K('cn', 'archbridge'), 0, 52, 0, { span: 12, rise: 2.2 }, { y: 0, follow: false }],
    [K('cn', 'moongate'), 0, 42, 0, { length: 8 }],
    [K('cn', 'pavilion'), 0, 20, Math.PI, { r: 3.4, h: 3.6 }],
    [K('cn', 'hall'), 0, -2, 0, { w: 18, d: 10, h: 5 }],
    [K('cn', 'hall2'), 0, -20, 0, { w: 14, d: 8 }],
    [K('cn', 'corridor'), -14, -6, Math.PI / 2, { length: 30 }], [K('cn', 'corridor'), 14, -6, Math.PI / 2, { length: 30 }],
    [K('road', 'garden_path'), 0, 10, 0, { length: 16, width: 1.5 }], [K('road', 'garden_path'), 0, 10, Math.PI / 2, { length: 20, width: 1.5 }],
    [K('cn', 'ding'), 4, 10, 0, { r: 0.9 }],
    [K('cn', 'folkhouse'), -30, 2, Math.PI / 2, { w: 10 }], [K('cn', 'folkhouse'), 30, 2, -Math.PI / 2, { w: 10 }],
    [K('cn', 'folkhouse'), -30, -16, Math.PI / 2, { w: 10 }], [K('cn', 'folkhouse'), 30, -16, -Math.PI / 2, { w: 10 }],
    [K('vegetation', 'sugar_maple'), -10, 14, 0, {}, { s: 0.8 }], [K('vegetation', 'sugar_maple'), 10, 14, 0, {}, { s: 0.8 }],
    [K('vegetation', 'quaking_aspen'), -6, -48, 0, {}, { s: 0.9 }], [K('vegetation', 'quaking_aspen'), 6, -50, 0, {}, { s: 0.8 }],
    [K('cn', 'citywall'), 0, -30, 0, { length: 46, height: 4 }], [K('cn', 'citywall'), 0, 36, Math.PI, { length: 46, height: 4 }],
    [K('cn', 'citywall'), -23, 4, Math.PI / 2, { length: 66, height: 4 }], [K('cn', 'citywall'), 23, 4, Math.PI / 2, { length: 66, height: 4 }],
    [K('cn', 'lanternpole'), -8, 32, 0, {}], [K('cn', 'lanternpole'), 8, 32, 0, {}],
  ],
  view: view(56, 50, 72),
});

/* 09 方格网城市：正交街网 / 高密度核心 / 中央公园(池+丘) / 地块标准化 / 市政件 */
S({
  id: 'atlas-09-gridcbd', cat: '布局图鉴·现代', name: '09 方格网城市 Grid CBD',
  desc: '正交方格街网：统一街廓、主干次街分级、高密度核心环绕中央公园（池+草丘+凉亭）、外围市政与居住地块标准化。',
  terrain: T(250, [[14, 14, 6, 1.3]], true),
  objs: [
    ...[-72, -24, 24, 72].map((x) => [K('road', 'two_way_road'), x, 0, 0, { width: 10, length: 180 }]),
    ...[-72, -24, 24, 72].map((z) => [K('road', 'two_way_road'), 0, z, Math.PI / 2, { width: 10, length: 180 }]),
    [K('cls', 'gazebo'), 0, 0, 0, {}],
    [K('road', 'garden_path'), 0, 0, 0, { length: 40, width: 2 }], [K('road', 'garden_path'), 0, 0, Math.PI / 2, { length: 40, width: 2 }],
    ...[[-9, -9], [9, -9], [-9, 9], [9, 9], [-15, 0], [15, 0], [0, -15], [0, 15]].map(([x, z]) => [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.9 }]),
    [K('vegetation', 'sugar_maple'), -14, -14, 0, {}, { s: 1 }], [K('vegetation', 'quaking_aspen'), -18, -10, 0, {}, { s: 0.8 }],
    [K('traffic', 'bollard'), -4, 4, 0, {}], [K('traffic', 'bollard'), 4, 4, 0, {}], [K('traffic', 'bollard'), -4, -4, 0, {}], [K('traffic', 'bollard'), 4, -4, 0, {}],
    [K('cls', 'clocktower'), 60, 60, 0, {}], [K('cls', 'capitol'), -60, 60, 0, {}],
    [K('cls', 'church'), 60, -60, 0, {}], [K('cls', 'mansion'), -60, -60, 0, {}],
    [K('cls', 'brownstone'), 60, 0, Math.PI / 2, {}], [K('cls', 'brownstone'), -60, 0, -Math.PI / 2, {}],
    [K('cls', 'brownstone'), 0, 60, 0, {}], [K('cls', 'brownstone'), 0, -60, Math.PI, {}],
    [K('house', 'brownstone'), 60, 24, Math.PI / 2, {}], [K('house', 'brownstone'), -60, 24, -Math.PI / 2, {}],
    [K('house', 'brownstone'), 60, -24, Math.PI / 2, {}], [K('house', 'brownstone'), -60, -24, -Math.PI / 2, {}],
    [K('house', 'brownstone'), 24, 60, 0, {}], [K('house', 'brownstone'), -24, 60, 0, {}],
    [K('house', 'brownstone'), 24, -60, Math.PI, {}], [K('house', 'brownstone'), -24, -60, Math.PI, {}],
    ...[[96, 0], [-96, 0], [0, 96], [0, -96], [96, 96], [-96, 96], [96, -96], [-96, -96]].map(([x, z], i) => [K('house', i % 2 ? 'spanish_colonial' : 'cape_cod'), x, z, 0, {}]),
    [K('functional', 'water_tower'), -96, -48, 0, {}], [K('functional', 'gas_station'), 96, -48, 0, {}],
    [K('functional', 'school'), -60, 96, 0, {}], [K('functional', 'post_office'), 60, 96, 0, {}],
    [K('functional', 'fire_station'), -96, 48, 0, {}], [K('suburban', 'googie_diner'), 96, 48, 0, {}],
    ...[-24, 24].flatMap((x) => [-24, 24].map((z) => [K('traffic', 'traffic_light'), x + 6, z + 6, 0, {}])),
    ...[-60, -20, 20, 60].flatMap((z) => [[K('traffic', 'street_lamp'), -30, z, 0, {}], [K('traffic', 'street_lamp'), 30, z, 0, {}]]),
  ],
  view: view(0, 165, 210),
});

/* 10 环形放射城市：中心放射 / 多层环路 / 绿带丘环 / 组团居住 / 中心公共建筑环 */
S({
  id: 'atlas-10-ringradial', cat: '布局图鉴·现代', name: '10 环形放射城市 Ring-Radial',
  desc: '田园城市理念：中心环岛广场、公共建筑环居内圈、多层环路与放射干道、环间居住组团、外围绿带草丘成环。',
  terrain: T(250, []),
  objs: [
    [K('road', 'roundabout'), 0, 0, 0, { width: 22, length: 22 }],
    [K('cn', 'ding'), 0, 0, 0, { r: 1.5, h: 1.2 }, { y: 0.33 }],
    ...ring(8, 52, (x, z, a) => [K('road', 'two_way_road'), x, z, a, { width: 8, length: 56 }]),
    ...ring(8, 30, (x, z, a) => [K('road', 'two_way_road'), x, z, a + Math.PI / 2, { width: 7, length: 22 }]),
    ...ring(12, 64, (x, z, a) => [K('road', 'two_way_road'), x, z, a + Math.PI / 2, { width: 7, length: 24 }]),
    ...ring(4, 76, (x, z, a) => [K('cls', ['capitol', 'church', 'mansion', 'clocktower'][Math.round(a / (Math.PI / 2)) % 4]), x, z, a + Math.PI, {}, { s: 0.55 }], Math.PI / 8),
    ...ring(8, 46, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6 }], 3 * Math.PI / 16),
    ...ring(8, 58, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6 }], Math.PI / 8),
    ...ring(8, 72, (x, z, a) => [K('house', 'cape_cod'), x, z, a + Math.PI, {}], 3 * Math.PI / 16),
    ...ring(24, 86, (x, z) => [K('vegetation', 'quaking_aspen'), x, z, 0, {}, { s: 0.95 }]),
    ...ring(16, 78, (x, z) => [K('vegetation', 'bluebonnet'), x, z, 0, {}, { s: 0.8 }]),
    ...ring(4, 22, (x, z, a) => [K('traffic', 'traffic_light'), x, z, a, {}], Math.PI / 4),
    ...ring(8, 30, (x, z, a) => [K('traffic', 'street_lamp'), x, z, a, {}], Math.PI / 8),
  ],
  view: view(0, 145, 190),
});

/* 11 超级街区：外围通行 / 内部步行 / 街道变广场(丘+亭+花境) / 八角切角街廓 */
S({
  id: 'atlas-11-superblock', cat: '布局图鉴·现代', name: '11 超级街区 Superblock',
  desc: '3×3 街廓合并：过境车流绕行外围、内部街道步行化改广场——四隅草丘凉亭、星形步道、花境树阵；切角街廓围合、街角商业。',
  terrain: T(210, []),
  objs: [
    [K('road', 'two_way_road'), 0, 48, Math.PI / 2, { width: 12, length: 104 }], [K('road', 'two_way_road'), 0, -48, Math.PI / 2, { width: 12, length: 104 }],
    [K('road', 'two_way_road'), -48, 0, 0, { width: 12, length: 104 }], [K('road', 'two_way_road'), 48, 0, 0, { width: 12, length: 104 }],
    [K('road', 'garden_path'), 0, 0, 0, { length: 80, width: 2 }], [K('road', 'garden_path'), 0, 0, Math.PI / 2, { length: 80, width: 2 }],
    [K('road', 'garden_path'), 0, 0, Math.PI / 4, { length: 68, width: 2 }], [K('road', 'garden_path'), 0, 0, -Math.PI / 4, { length: 68, width: 2 }],
    [K('cls', 'gazebo'), 28, 28, 0, {}], [K('cls', 'gazebo'), -28, -28, 0, {}], [K('cls', 'gazebo'), 28, -28, 0, {}], [K('cls', 'gazebo'), -28, 28, 0, {}],
    ...[[12, 0], [-12, 0], [0, 12], [0, -12], [20, -20], [-20, 20], [20, 20], [-20, -20]].map(([x, z]) => [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.85 }]),
    ...[[32, 0], [-32, 0], [0, 32], [0, -32]].map(([x, z]) => [K('vegetation', 'quaking_aspen'), x, z, 0, {}, { s: 0.9 }]),
    [K('vegetation', 'bluebonnet'), 14, 14, 0, {}, { s: 0.9 }], [K('vegetation', 'bluebonnet'), -14, -14, 0, {}, { s: 0.9 }],
    [K('vegetation', 'bluebonnet'), 14, -14, 0, {}, { s: 0.9 }], [K('vegetation', 'bluebonnet'), -14, 14, 0, {}, { s: 0.9 }],
    [K('cn', 'streetshop'), -10, 20, 0, { w: 6 }], [K('cn', 'streetshop'), 10, 20, 0, { w: 6 }],
    [K('cn', 'streetshop'), -10, -20, Math.PI, { w: 6 }], [K('cn', 'streetshop'), 10, -20, Math.PI, { w: 6 }],
    ...[[30, 58], [-30, 58], [30, -58], [-30, -58]].map(([x, z]) => [K('cls', 'brownstone'), x, z, z > 0 ? Math.PI : 0, {}]),
    ...[[58, 30], [58, -30], [-58, 30], [-58, -30]].map(([x, z]) => [K('cls', 'brownstone'), x, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, {}]),
    ...[[58, 58], [-58, 58], [58, -58], [-58, -58]].map(([x, z]) => [K('cls', 'mansion'), x, z, Math.PI / 4, {}]),
    ...[[48, 48], [-48, 48], [48, -48], [-48, -48]].map(([x, z]) => [K('traffic', 'traffic_light'), x + 8, z + 8, 0, {}]),
    ...[[40, 0], [-40, 0], [0, 40], [0, -40]].flatMap(([x, z]) => [[K('traffic', 'bollard'), x + (z ? 1.5 : 0), z + (x ? 1.5 : 0), 0, {}], [K('traffic', 'bollard'), x - (z ? 1.5 : 0), z - (x ? 1.5 : 0), 0, {}]]),
    ...[[24, 56], [-24, 56], [24, -56], [-24, -56], [56, 24], [56, -24], [-56, 24], [-56, -24]].map(([x, z]) => [K('traffic', 'street_lamp'), x, z, 0, {}]),
  ],
  view: view(0, 125, 160),
});

/* 12 TOD 公交导向片区：站城一体 / 密度梯度 / 小街区密路网 / 慢行优先 / 绿楔水景 */
S({
  id: 'atlas-12-tod', cat: '布局图鉴·现代', name: '12 TOD 公交导向片区 TOD District',
  desc: '轨道站为核心：站前公交环岛、500 米步行圈高密度混合开发、密度由站点向外递减、慢行廊道与绿楔水景串联组团。',
  terrain: T(250, [[-42, 42, 10, 1.3]], true),
  objs: [
    [K('road', 'concrete_road'), 0, 14, Math.PI / 2, { width: 9, length: 220 }],
    [K('cls', 'capitol'), 0, 0, Math.PI, {}, { s: 1.1 }],
    [K('road', 'roundabout'), 0, 32, 0, { width: 20, length: 20 }],
    [K('cls', 'clocktower'), 20, 26, Math.PI, {}], [K('cls', 'clocktower'), -20, 26, Math.PI, {}],
    [K('cls', 'clocktower'), 20, -8, 0, {}], [K('cls', 'clocktower'), -20, -8, 0, {}],
    ...ring(6, 32, (x, z, a) => [K('cls', 'brownstone'), x, z, a + Math.PI, {}], 0.5),
    [K('suburban', 'googie_diner'), -34, 24, Math.PI / 2, {}], [K('suburban', 'craftsman_cafe'), 34, 24, -Math.PI / 2, {}],
    ...ring(10, 46, (x, z, a) => [K('house', 'spanish_colonial'), x, z, a + Math.PI, {}]),
    [K('functional', 'school'), 46, 30, -Math.PI / 2, {}], [K('functional', 'post_office'), -46, 30, Math.PI / 2, {}],
    ...ring(12, 68, (x, z, a) => [K('cn', 'folkhouse'), x, z, a + Math.PI, { w: 6 }]),
    ...ring(6, 40, (x, z, a) => [K('road', 'garden_path'), x, z, a, { length: 30, width: 1.5 }]),
    ...ring(10, 58, (x, z, a, k) => (k % 5 === 0 ? [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.9 }] : null)).filter(Boolean),
    ...[[-48, 36], [-36, 48], [-52, 52], [42, -48], [48, -36], [36, -52]].map(([x, z]) => [K('vegetation', 'sugar_maple'), x, z, 0, {}, { s: 0.9 }]),
    ...[-16, -8, 8, 16].map((x) => [K('traffic', 'street_lamp'), x, 20, 0, {}]),
    ...[[6, 42], [-6, 42], [0, 44]].map(([x, z]) => [K('traffic', 'bollard'), x, z, 0, {}]),
    [K('traffic', 'traffic_light'), 10, 20, 0, {}], [K('traffic', 'traffic_light'), -10, 20, 0, {}],
  ],
  view: view(0, 145, 190, 0, 0, 10),
});
