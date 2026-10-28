// Local semantic routing only. No network, generated code or changes to AI plan v1.
const CYBER = /赛博|cyberpunk|悬浮(?:汽)?车|楼隙航道|霓虹(?:都市|街区|城市)/i;
const CHINESE = /中式|仿古|古城|古镇|水乡|江南|chinese|ancient/i;
const RIVER = /河|水乡|两岸|石拱桥|孔明灯|river|lantern/i;
export const RECIPE_LABELS = {
  "cyber-rain": "赛博街谷",
  "lantern-river": "滨河古城",
};
// Applied only after a supported recipe is selected. Unknown/unsupported requests remain visible.
export const RECIPE_WORDS =
  /行人速度|(?:飞车|悬浮车)速度|行人慢走|慢速行人|行人快走|快速行人|飞车加速|快速飞车|飞车慢行|慢速飞车|不要错峰|关闭错峰|错峰|错开出发|倍|中式|仿古|古城|古镇|江南|赛博(?:朋克)?|cyberpunk|霓虹(?:都市|街区|城市)?|悬浮(?:汽)?车|空中(?:交通|航道)|楼隙(?:穿行|航道)?|楼间|穿行|高楼|高层|摩天大楼|摩天楼|建筑压抑|压迫感|压迫|巨构|沿河|河流|河道|河宽|两岸|双岸|一条河|水乡|石拱桥|拱桥|跨河|跨路|跨街|连接|中轴线?|线道路|道路|牌楼|牌坊|佛塔|远景|远处|孔明灯|天灯|灯火通明|暖灯|灯市|繁华|行人|人流|游人|往来|往返|低视角|人眼|街面|街区内部|初始视角|开场|俯瞰|鸟瞰|全景|大雾|浓雾|无雾|不要雾|清晰|不下雨|无雨|无降水|晴天|没有行人|无人|不要行人|没有车|无车|不要车|不要孔明灯|无孔明灯|没有孔明灯|直河|笔直河道|弯曲|蜿蜒|S形|紫色|青色|蓝紫|粉紫|青紫|配色|river|lanterns?|pedestrians?/gi;
export function parseSceneIntent(text = "", force = null) {
  text = String(text);
  const kind = RECIPE_LABELS[force]
    ? force
    : CYBER.test(text)
      ? "cyber-rain"
      : CHINESE.test(text) && RIVER.test(text)
        ? "lantern-river"
        : null;
  if (!kind) return null;
  const values = {},
    take = (key, re) => {
      const m = re.exec(text);
      if (m) values[key] = Number(m[1]);
    };
  take(
    "size",
    /(?:场景|街区|范围|地图|规模)(?:大小|尺寸)?\s*[:：]?\s*(\d+)\s*(?:米|m\b)/i,
  );
  if (values.size == null) take("size", /(?:^|[,，\s])(\d{3,4})\s*(?:米|m\b)/i);
  take("floors", /(\d+)\s*层(?:楼|高楼|建筑)?/);
  take("cars", /(\d+)\s*(?:辆|台)\s*(?:悬浮(?:汽)?车|飞车|车)/);
  take("people", /(\d+)\s*(?:位|个|名)?\s*(?:行人|游人|人)/);
  take(
    "riverWidth",
    /(?:河宽|河道宽|河流宽|宽度为?)\s*(\d+(?:\.\d+)?)\s*(?:米|m\b)/i,
  );
  take("lanterns", /(\d+)\s*盏\s*(?:孔明灯|天灯)/);
  take("walkRate", /行人速度\s*(\d+(?:\.\d+)?)\s*倍/);
  take("trafficRate", /(?:飞车|悬浮车)速度\s*(\d+(?:\.\d+)?)\s*倍/);
  if (/行人慢走|慢速行人/.test(text) && values.walkRate == null)
    values.walkRate = 0.5;
  if (/行人快走|快速行人/.test(text) && values.walkRate == null)
    values.walkRate = 1.5;
  if (/飞车加速|快速飞车/.test(text) && values.trafficRate == null)
    values.trafficRate = 1.5;
  if (/飞车慢行|慢速飞车/.test(text) && values.trafficRate == null)
    values.trafficRate = 0.5;
  if (/不要错峰|关闭错峰/.test(text)) values.stagger = false;
  else if (/错峰|错开出发/.test(text)) values.stagger = true;
  take("seed", /(?:种子|seed)\s*[:：#]?\s*(\d{1,9})/i);
  take("density", /密度\s*(\d{1,3})\s*%/);
  if (values.density != null) values.density /= 100;
  if (/密集|紧凑|拥挤|繁华/.test(text) && values.density == null)
    values.density = 0.8;
  if (/稀疏|空旷|人烟稀少/.test(text)) values.density = 0.25;
  if (/没有行人|无人|不要行人/.test(text)) values.people = 0;
  if (/没有车|无车|不要车/.test(text)) values.cars = 0;
  if (/不要孔明灯|无孔明灯|没有孔明灯/.test(text)) values.lanterns = 0;
  const weather = /不下雨|无雨|无降水|晴天/.test(text)
    ? "none"
    : /暴雨|雷雨|暴风雨|storm/i.test(text)
      ? "storm"
      : /下雪|飘雪|snow/i.test(text)
        ? "snow"
        : /下雨|雨天|雨|rain/i.test(text)
          ? "rain"
          : null;
  if (weather) values.weather = weather;
  if (/无雾|不要雾|清晰/.test(text)) values.fog = 0;
  else if (/大雾|浓雾/.test(text)) values.fog = 0.017;
  else if (/薄雾/.test(text)) values.fog = 0.004;
  if (/直河|笔直河道/.test(text)) values.bend = 0;
  if (/俯瞰|鸟瞰/.test(text)) values.opening = "overview";
  else if (/低视角|人眼|街面|街区内部/.test(text)) values.opening = "street";
  if (/紫色|蓝紫|粉紫/.test(text)) values.palette = "violet";
  else if (/青色|青紫/.test(text)) values.palette = "cyan";
  const lighting = /白天|正午|noon|daylight/i.test(text)
    ? "noon"
    : /黄昏|日落|夕阳|sunset/i.test(text)
      ? "golden"
      : /蓝调|blue\s*hour/i.test(text)
        ? "blue"
        : /夜|霓虹|night/i.test(text)
          ? "night"
          : null;
  if (lighting) values.lighting = lighting;
  const layout = /(方格|棋盘|放射|环路)/.exec(text);
  if (layout) values.layoutRequest = layout[0];
  return { version: 1, kind, values };
}
