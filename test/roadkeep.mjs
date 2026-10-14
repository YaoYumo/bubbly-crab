// 导演台道路组守卫：真实尺度替换件名单/参数/结构签名护栏（node test/roadkeep.mjs）
// 护栏含义：道路 10 件已于第20轮以真实工程尺度清空重写并提交导演台模型库；
// 任何回退旧版风格化 builder、改动真实尺度参数默认值、或增删件的行为都会在此红掉。
import { LIB } from '../src/assets.js';

const ROAD = LIB.find((g) => g.id === 'road');
const expect = ['two_way_road', 'one_way_road', 'concrete_road', 'garden_path', 'gravel_road', 'four_way_stop', 't_junction', 'roundabout', 'cul_de_sac', 'freeway'];
// 真实尺度默认值（宽 m / 长 m）：车道3.7 路侧带2.25 等体系下的工程取值
const DEF = {
  two_way_road: [12, 24], one_way_road: [14, 24], concrete_road: [12, 24], garden_path: [1.5, 8],
  gravel_road: [6.5, 24], four_way_stop: [22, 22], t_junction: [24, 22], roundabout: [22, 22],
  cul_de_sac: [26, 36], freeway: [26, 60],
};
// 结构签名：真实尺度重写版的特征代码（旧版风格化 builder 不含）
const SIG = {
  two_way_road: ['rdSideZ'], one_way_road: ['rdSideZ', 'rdArrow'], concrete_road: ['锯缝'],
  garden_path: ['立砖收边'], gravel_road: ['路肩料垄'], four_way_stop: ['rdCornerQuad', 'rdZebra'],
  t_junction: ['北封边人行带', 'rdCornerQuad'], roundabout: ['ExtrudeGeometry', '中心岛'],
  cul_de_sac: ['Rs2', '凹弧'], freeway: ['中央防撞墙', 'W 梁护栏'],
};

let fail = 0;
const ck = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}${x ? ' · ' + x : ''}`); };

ck('道路组存在且 10 件齐全', !!ROAD && ROAD.items.length === 10, ROAD ? ROAD.items.length + ' 件' : '组缺失');
const types = ROAD.items.map((i) => i.type);
ck('名单与顺序护栏', JSON.stringify(types) === JSON.stringify(expect), types.join(','));
for (const t of expect) {
  const it = ROAD.items.find((i) => i.type === t);
  if (!it) { ck(`${t} 在库`, false); continue; }
  ck(`${t} 名称保留`, typeof it.name === 'string' && it.name.length > 0, it.name);
  ck(`${t} builder 为函数`, typeof it.build === 'function', it.build.name);
  const src = it.build.toString();
  ck(`${t} 真实尺度结构签名`, SIG[t].every((s) => src.includes(s)), SIG[t].join('+'));
  const w = it.params.find((p) => p.k === 'width'), l = it.params.find((p) => p.k === 'length');
  ck(`${t} 真实尺度默认值`, w && l && w.def === DEF[t][0] && l.def === DEF[t][1], `宽${w && w.def}/长${l && l.def}`);
  ck(`${t} 无 frozen 误标`, it.frozen === undefined);
}
console.log(fail ? `ROADKEEP FAIL ${fail} 项` : 'ROADKEEP ALL PASS');
process.exit(fail ? 1 : 0);
