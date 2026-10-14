// ---------------------------------------------------------------------------
// 一句话街区：纯本地语义解析（无网络、无积分）→ 场景 Schema → 程序化生成
// 定位是「智能场景模板」：关键词命中就调参数，没命中就用默认值，绝不猜测语义。
// ---------------------------------------------------------------------------

import { clamp, makeRng } from './util.js';

/** Schema 默认值：任何一句人话都能落到一份完整可执行的配置上 */
export const TOWN_DEFAULTS = () => ({
  mapSize: 256, // m，边长（128 / 192 / 256 / 384 / 512 / 768 / 1024）
  theme: 'suburb',
  roadTopology: 'grid', // grid | axis | spine_and_loop | radial —— 默认方格网（无环路；环形布局需显式点选或写关键词）
  density: 0.5, // 0..1 地块细分密度
  zoning: { commercialRatio: 0.15, residentialRatio: 0.85 },
  vegetationDensity: 0.4, // 0..1
  lighting: 'noon', // 对齐 lighting.js 预设 id
  weather: 'none', // 对齐 weather.js 预设 id（none = 关闭）
  terrain: { amplitude: 3, roughness: 0.5 }, // 起伏 m / 细节度
  seed: 0, // 0 = 每次随机
});

/** 主题 → 实际存在的 LIB 资产 type（不新增模型，只做配比） */
export const TOWN_THEMES = {
  suburb: {
    label: '郊区小镇', en: 'Suburb',
    houses: ['cape_cod', 'craftsman', 'southern_colonial', 'spanish_colonial'],
    commerce: ['craftsman_cafe', 'adobe_strip_mall', 'gas_station', 'post_office'],
    civic: ['school', 'colonial_church', 'fire_station'],
    trees: ['sugar_maple', 'live_oak', 'quaking_aspen'],
    ground: ['big_bluestem'],
  },
  california: {
    label: '加州', en: 'California',
    houses: ['spanish_colonial', 'adobe', 'craftsman', 'cape_cod'],
    commerce: ['googie_diner', 'adobe_strip_mall', 'gas_station', 'craftsman_cafe'],
    civic: ['spanish_library', 'columns_bank', 'school'],
    trees: ['sabal_palm', 'live_oak', 'coast_redwood'],
    ground: ['big_bluestem', 'bluebonnet'],
  },
  newengland: {
    label: '新英格兰', en: 'New England',
    houses: ['cape_cod', 'brownstone', 'craftsman', 'southern_colonial'],
    commerce: ['craftsman_cafe', 'columns_bank', 'post_office'],
    civic: ['colonial_church', 'school', 'fire_station'],
    trees: ['sugar_maple', 'quaking_aspen', 'douglas_fir'],
    ground: ['big_bluestem'],
  },
  southwest: {
    label: '西南荒漠', en: 'Southwest',
    houses: ['adobe', 'spanish_colonial', 'craftsman'],
    commerce: ['adobe_strip_mall', 'gas_station', 'googie_diner'],
    civic: ['spanish_library', 'fire_station', 'post_office'],
    trees: ['saguaro', 'joshua_tree'],
    ground: ['big_bluestem', 'bluebonnet'],
  },
  urban: {
    label: '老城区', en: 'Urban',
    houses: ['brownstone', 'southern_colonial', 'cape_cod'],
    commerce: ['adobe_strip_mall', 'columns_bank', 'googie_diner', 'craftsman_cafe'],
    civic: ['school', 'post_office', 'colonial_church'],
    trees: ['live_oak', 'sugar_maple'],
    ground: [],
  },
  // 中式古建：hall/courtyard 当宅，drumtower/paifang 当公共；宅前小径用青砖
  chinese: {
    label: '中式古城', en: 'Chinese Heritage',
    houses: ['courtyard', 'hall', 'hall2'],
    commerce: ['streetshop', 'hall', 'hall2', 'pavilion'],
    civic: ['drumtower', 'paifang', 'gate', 'pagoda'],
    trees: ['sugar_maple', 'live_oak', 'quaking_aspen'],
    ground: ['big_bluestem'],
    path: 'garden',
  },
  // 现代：功能主义低层（美式现代商业带 + 工字铺），宅前走混凝土车道
  modern: {
    label: '现代', en: 'Modern',
    houses: ['brownstone', 'craftsman', 'cape_cod'],
    commerce: ['adobe_strip_mall', 'googie_diner', 'gas_station', 'drive_in'],
    civic: ['school', 'post_office', 'fire_station'],
    trees: ['live_oak', 'sabal_palm'],
    ground: [],
    path: 'concrete',
  },
  // 古今混搭：中式院落与现代街屋交替出现
  fusion: {
    label: '古今混搭', en: 'Old meets New',
    houses: ['courtyard', 'craftsman', 'hall', 'brownstone', 'hall2', 'cape_cod'],
    commerce: ['adobe_strip_mall', 'hall', 'streetshop', 'googie_diner', 'hall2'],
    civic: ['drumtower', 'school', 'paifang', 'post_office'],
    trees: ['sugar_maple', 'live_oak', 'sabal_palm'],
    ground: [],
    path: 'concrete',
  },
};

const TOPOLOGIES = {
  grid: '方格网',
  axis: '中轴对称',
  spine_and_loop: '主干道 + 环路',
  radial: '放射状',
};

// 规则表：每条 = 一组关键词 → 一次 schema 变更。命中即记录，未命中的词进 ignored。
// order 仅用于展示稳定，逻辑上互相独立。
const RULES = [
  // ---- 地图尺寸 ----
  {
    field: 'mapSize', label: '地图尺寸',
    re: [/(\d{3,4})\s*(?:米|m(?:eter|etres)?\b)/gi, /(\d+(?:\.\d+)?)\s*(?:公里|千米|km\b)/gi],
    apply: (s, m, i) => {
      const raw = parseFloat(m[1]);
      const v = i === 1 ? raw * 1000 : raw;
      s.mapSize = clamp(Math.round(v / 64) * 64, 128, 1024);
      return `${s.mapSize}m`;
    },
  },
  // ---- 主题 ----
  {
    field: 'theme', label: '主题',
    re: [/(加州|加利福尼亚|california|西海岸)/gi, /(新英格兰|波士顿|new\s*england|东北小镇)/gi,
      /(沙漠|荒漠|西南|亚利桑那|德州|texas|arizona|southwest|desert)/gi,
      // 混搭优先：「现代与古建混搭」应落 fusion 而不是被「现代」抢走
      /(混搭|混合|古今交融|新旧交融|现代与古|现代加古|古建与现代|古风与现代|both\s*old\s*and\s*new|old\s*meets\s*new)/gi,
      // 中式词族（形制/地标/地域/朝代/匠作）：四合院·胡同·里坊 = 院落肌理；
      // 寺庙·王府·鼓楼·牌坊 = 礼制地标；徽派·马头墙·园林 = 地域风格；青砖·飞檐·斗拱 = 匠作特征
      /(中式|中国|古建|古镇|古城|古村|古风|仿古|江南|水乡|长安|西安|平遥|丽江|凤凰|阆中|乌镇|西塘|南浔|周庄|京城|皇城|皇宫|紫禁城|明清|唐朝|唐代|唐风|宋代|宋朝|清代|明朝|明代|徽派|徽州|马头墙|晋商|乔家|四合院|合院|院落|胡同|里坊|坊巷|宅院|府邸|王府|园林|寺庙|寺院|佛寺|道观|古刹|庙宇|牌坊|牌楼|鼓楼|钟楼|城楼|城墙|城门|宝塔|古塔|佛塔|青砖|黛瓦|飞檐|斗拱|榫卯|pagoda|chinese|ancient\s*town|heritage)/gi,
      /(现代|当代|新城区|都会|摩登|modern)/gi,
      /(老城|城区|市区|市中心|downtown|urban|city)/gi,
      /(小镇|郊区|市郊|住宅区|suburb|small\s*town|neighborhood)/gi],
    apply: (s, m, i) => {
      s.theme = ['california', 'newengland', 'southwest', 'fusion', 'chinese', 'modern', 'urban', 'suburb'][i];
      // 中式礼制词隐含中轴格局：寺庙/王府/皇宫/鼓楼/牌坊 单独出现也走 axis
      //（中轴大道 + 东西大街 + 镜像街巷）；若用户显式写「方格/放射」，
      // 后面的路网规则会按先到先得覆盖为显式选择。
      if (i === 4 && /(皇宫|紫禁城|寺庙|寺院|佛寺|道观|古刹|庙宇|王府|宫殿|殿宇|鼓楼|钟楼|午门|牌坊|牌楼)/.test(m[0])) s.roadTopology = 'axis';
      return TOWN_THEMES[s.theme].label;
    },
  },
  // ---- 路网 ----
  {
    field: 'roadTopology', label: '路网',
    // 轴线词族：礼制建筑（寺庙/王府/宫殿/午门）与城市地标（鼓楼/钟楼/牌坊）本身沿轴布列
    re: [/(中轴|中轴线|轴线对称|对称布局|对称|皇宫|紫禁城|宫殿|殿宇|王府|府衙|孔庙|文庙|寺庙|寺院|佛寺|道观|古刹|庙宇|鼓楼|钟楼|午门|牌坊|牌楼|imperial|长安大街)/gi,
      /(方格|网格|棋盘|grid|曼哈顿|整齐|整洁|横平竖直|规整|方方正正)/gi,
      /(放射|环形放射|radial|辐条)/gi,
      /(环路|环线|回路|loop)/gi, /(主干道|主街|大街|spine|main\s*street|high\s*street)/gi],
    apply: (s, m, i) => {
      s.roadTopology = ['axis', 'grid', 'radial', 'spine_and_loop', 'spine_and_loop'][i];
      if (i === 3 && s.roadTopology === 'spine_and_loop') s._loopBias = true;
      return TOPOLOGIES[s.roadTopology];
    },
  },
  // ---- 密度 ----（先到先得：显式「密集/稀疏」优先，城市词只做默认档）
  {
    field: 'density', label: '建筑密度',
    re: [/(密集|稠密|紧凑|high\s*density|dense|拥挤)/gi, /(稀疏|空旷|人烟稀少|low\s*density|sparse|零散)/gi,
      /(城市|都市|市中心|市区|都会|\bcity\b|downtown)/gi,
      // 坊巷肌理：窄巷深巷 = 低层高密度的里坊格局（词已被主题吃掉时走默认档）
      /(巷弄|窄巷|深巷|密巷|里弄)/gi],
    apply: (s, m, i) => {
      s.density = [0.8, 0.25, 0.72, 0.65][i];
      return ['密集', '稀疏', '城市密度', '坊巷肌理'][i];
    },
  },
  // ---- 商业配比 ----
  {
    field: 'zoning', label: '功能配比',
    re: [/商业\s*(\d{1,3})\s*%/gi, /(\d{1,3})\s*%\s*(?:的)?商业/gi,
      /(商业街|商业区|购物|店铺林立|街市|集市|商埠|闹市|繁华|商铺|commercial|shopping|retail)/gi,
      /(纯住宅|全是住宅|只有住宅|residential\s*only)/gi, /(住宅为主|以住宅为主)/gi],
    apply: (s, m, i) => {
      let c;
      if (i === 0 || i === 1) c = clamp(parseInt(m[1], 10) / 100, 0, 0.8);
      else if (i === 2) c = 0.4;
      else if (i === 3) c = 0;
      else c = 0.25;
      s.zoning = { commercialRatio: c, residentialRatio: +(1 - c).toFixed(2) };
      return `商业 ${Math.round(c * 100)}%`;
    },
  },
  // ---- 植被 ----
  {
    field: 'vegetationDensity', label: '植被',
    re: [/(林荫|林荫道|茂密|郁郁葱葱|森林|lush|tree-?lined|forested|绿树成荫)/gi,
      /(没有树|无树|光秃|no\s*trees|barren)/gi,
      /(少量树|稀疏树|几棵树|few\s*trees)/gi, /(树|植被|绿化|trees?|greenery|vegetation)/gi],
    apply: (s, m, i) => {
      s.vegetationDensity = [0.85, 0, 0.18, 0.45][i];
      return ['茂密', '无', '稀疏', '适中'][i];
    },
  },
  // ---- 地形 ----
  {
    field: 'terrain', label: '地形',
    re: [/(平坦|平原|flat|level)/gi, /(丘陵|起伏|山坡|hilly|rolling|undulating)/gi, /(山地|山区|陡峭|mountain|steep)/gi],
    apply: (s, m, i) => {
      s.terrain = [{ amplitude: 0.6, roughness: 0.4 }, { amplitude: 6, roughness: 0.55 }, { amplitude: 18, roughness: 0.65 }][i];
      return ['平坦', '丘陵', '山地'][i];
    },
  },
  // ---- 时间 / 光照 ----
  {
    field: 'lighting', label: '光照',
    re: [/(黄昏|日落|傍晚|夕阳|golden\s*hour|sunset|dusk|magic\s*hour)/gi,
      /(清晨|黎明|日出|早上|dawn|sunrise|morning|薄雾)/gi,
      /(夜|夜晚|深夜|夜里|晚上|晚间|入夜|夜景|night|midnight|霓虹)/gi,
      /(蓝调|blue\s*hour|twilight)/gi,
      /(阴天|多云|阴|overcast|cloudy|grey)/gi,
      /(雪天|下雪|雪|snow|winter)/gi,
      /(逆光|剪影|backlit|silhouette)/gi,
      /(正午|中午|白天|noon|midday|daylight)/gi],
    apply: (s, m, i) => {
      s.lighting = ['golden', 'dawn', 'night', 'blue', 'overcast', 'snowlight', 'backlit', 'noon'][i];
      return ['黄金时刻', '清晨薄雾', '夜景', '蓝调时刻', '阴天', '雪天', '逆光', '正午'][i];
    },
  },
  // ---- 天气 ----
  {
    field: 'weather', label: '天气',
    re: [/(暴雨|雷雨|暴风雨|storm|thunder)/gi, /(下雨|雨天|雨|rain|rainy|wet)/gi,
      /(下雪|飘雪|大雪|snow(?:fall|ing)?)/gi, /(沙尘|沙暴|扬沙|sand|dust)/gi,
      /(大雾|浓雾|雾|fog|foggy|mist)/gi, /(晴|晴朗|clear|sunny)/gi],
    apply: (s, m, i) => {
      s.weather = ['storm', 'rain', 'snow', 'sand', 'none', 'none'][i];
      if (i === 4 && s.lighting === 'noon') s.lighting = 'dawn'; // 雾用薄雾预设近似
      return ['暴风雨', '雨', '雪', '沙尘', '雾', '晴'][i];
    },
  },
  // ---- 种子 ----
  {
    field: 'seed', label: '种子',
    re: [/(?:种子|seed)\s*[:：#]?\s*(\d{1,9})/gi],
    apply: (s, m) => { s.seed = parseInt(m[1], 10) % 1000000; return String(s.seed); },
  },
];

// 常见但暂不支持的词：显式告知用户「已忽略」，避免默默吞掉期望
const UNSUPPORTED = [
  { re: /(高速|高架|freeway|highway|立交|interchange)/gi, hint: '高速公路/立交' },
  { re: /(地铁|轻轨|铁路|火车|subway|metro|railway|train)/gi, hint: '轨道交通' },
  { re: /(河流|湖|海|水|river|lake|ocean|water|coast|海岸)/gi, hint: '水体' },
  { re: /(人物|行人|角色|people|pedestrian|character|actor)/gi, hint: '人物角色' },
  { re: /(车流|车辆|汽车|cars?|traffic\s*flow|vehicle)/gi, hint: '行驶车辆' },
  { re: /(摩天|高层|大厦|skyscraper|high-?rise|tower)/gi, hint: '高层建筑' },
  { re: /(赛博|科幻|未来|cyberpunk|sci-?fi|futuristic)/gi, hint: '科幻风格' },
];

// 语气/填充词：不算「未识别」，否则会污染 coverage 与 ignored 提示
const STOPWORDS = /^(的|了|和|与|或|在|有|是|请|帮我|帮忙|给我|来|来个|一个|一些|要|想|做|造|生成|创建|建|弄|搞|随便|就|都|也|还|还有|以及|里面|里有|中间|周围|这个|那个|之|地|得|a|an|the|at|in|on|of|with|and|or|for|to|by|is|are|be|please|make|create|generate|some|any|it|this|that)$/i;
const SPLIT_RE = /[\s,，。.、;；:：!！?？\-—/|()（）\[\]【】"'"'`~@#$%^&*+=<>{}]+/;

/** 把命中结果压成 UI chips 用的可读列表 */
export function describeSchema(s) {
  const t = TOWN_THEMES[s.theme] || TOWN_THEMES.suburb;
  return [
    { k: 'mapSize', label: `地图 ${s.mapSize}m` },
    { k: 'theme', label: t.label },
    { k: 'roadTopology', label: TOPOLOGIES[s.roadTopology] },
    { k: 'density', label: `密度 ${s.density <= 0.3 ? '稀疏' : s.density >= 0.7 ? '密集' : '适中'}` },
    { k: 'zoning', label: `商业 ${Math.round(s.zoning.commercialRatio * 100)}%` },
    { k: 'vegetationDensity', label: `植被 ${Math.round(s.vegetationDensity * 100)}%` },
    { k: 'terrain', label: s.terrain.amplitude < 1.5 ? '平坦' : s.terrain.amplitude < 10 ? '丘陵' : '山地' },
    { k: 'lighting', label: `光照 ${s.lighting}` },
    { k: 'weather', label: s.weather === 'none' ? '无天气特效' : s.weather },
    { k: 'seed', label: s.seed ? `种子 ${s.seed}` : '随机种子' },
  ];
}

/**
 * 解析一句自然语言 → 完整 Schema。
 * @returns {{schema:object, matched:Array<{label:string,value:string}>, ignored:string[], unsupported:Array<{hint:string,text:string}>, coverage:number}}
 */
export function parsePromptLocally(prompt = '') {
  const schema = TOWN_DEFAULTS();
  const text = String(prompt);
  const matched = [];
  const unsupported = [];
  let rest = text;

  for (const rule of RULES) {
    for (let i = 0; i < rule.re.length; i++) {
      const re = new RegExp(rule.re[i].source, rule.re[i].flags);
      const m = re.exec(rest);
      if (!m) continue;
      // 规则内后面的分支若已被前面命中同字段，跳过（先到先得，避免「下雪」被「雪天光照」以外的分支覆盖）
      if (matched.some((x) => x.k === rule.field)) { re.lastIndex = 0; break; }
      const value = rule.apply(schema, m, i);
      matched.push({ k: rule.field, label: rule.label, value, text: m[0].trim() });
      rest = rest.replace(m[0], ' ');
      break;
    }
  }

  for (const u of UNSUPPORTED) {
    const re = new RegExp(u.re.source, u.re.flags);
    const m = re.exec(rest);
    if (m) { unsupported.push({ hint: u.hint, text: m[0].trim() }); rest = rest.replace(m[0], ' '); }
  }

  // 剩下的实词（长度 ≥2 且含中英文字符、非填充词）视为未识别
  const ignored = rest
    .split(SPLIT_RE)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && /[\u4e00-\u9fa5A-Za-z]/.test(w) && !STOPWORDS.test(w));

  const total = text.split(SPLIT_RE).filter((w) => w.length >= 2 && !STOPWORDS.test(w)).length || 1;
  return {
    schema,
    matched,
    ignored: [...new Set(ignored)].slice(0, 12),
    unsupported,
    coverage: clamp(1 - ignored.length / total, 0, 1),
  };
}

/** 生成一个可读的随机种子（避开 0） */
export function randomSeed() {
  return 10000 + Math.floor(Math.random() * 899999);
}

/** 数值兜底：NaN / null / 空串等脏数据一律回落到默认值（?? 抓不住 NaN） */
const num = (v, d) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? +v : NaN;
  return Number.isFinite(n) ? n : d;
};

/** 归一化 schema：填默认值 + 夹取范围，保证任何来源（含旧存档）都能安全执行 */
export function normalizeSchema(raw) {
  const d = TOWN_DEFAULTS();
  const s = { ...d, ...(raw || {}) };
  s.mapSize = clamp(Math.round(num(s.mapSize, d.mapSize) / 64) * 64, 128, 1024);
  s.density = clamp(num(s.density, d.density), 0, 1);
  s.vegetationDensity = clamp(num(s.vegetationDensity, d.vegetationDensity), 0, 1);
  s.terrain = {
    amplitude: clamp(num(s.terrain?.amplitude, d.terrain.amplitude), 0, 40),
    roughness: clamp(num(s.terrain?.roughness, d.terrain.roughness), 0.1, 0.9),
  };
  const c = clamp(num(s.zoning?.commercialRatio, d.zoning.commercialRatio), 0, 0.8);
  s.zoning = { commercialRatio: c, residentialRatio: +(1 - c).toFixed(2) };
  if (!TOWN_THEMES[s.theme]) s.theme = d.theme;
  if (!TOPOLOGIES[s.roadTopology]) s.roadTopology = d.roadTopology;
  s.seed = Math.abs(Math.trunc(num(s.seed, 0))) || randomSeed();
  s.rng = makeRng(s.seed);
  return s;
}
