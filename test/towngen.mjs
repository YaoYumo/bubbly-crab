// 纯 node：一句话解析器回归（不依赖浏览器）
// 用法：node test/towngen.mjs
import { parsePromptLocally, normalizeSchema, describeSchema, TOWN_THEMES } from '../src/towngen.js';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}  got=${JSON.stringify(got)}${ok ? '' : ` want=${JSON.stringify(want)}`}`);
};

const CASES = [
  {
    p: '黄昏的加州林荫小镇，512米，商业30%，丘陵，种子948271',
    want: { mapSize: 512, theme: 'california', lighting: 'golden', vegetationDensity: 0.85, seed: 948271 },
    wantZoning: 0.3,
  },
  {
    p: 'a grid suburb at noon, flat, no trees, dense',
    want: { roadTopology: 'grid', lighting: 'noon', terrain: { amplitude: 0.6, roughness: 0.4 }, vegetationDensity: 0, density: 0.8 },
  },
  {
    p: '下雨的新英格兰老城区，晚上，纯住宅',
    want: { theme: 'newengland', weather: 'rain', lighting: 'night' },
    wantZoning: 0,
  },
  {
    p: '随便来个小镇',
    want: { theme: 'suburb', mapSize: 256 },
  },
  {
    p: '赛博朋克城市里有地铁和摩天大楼，还有行人',
    unsupported: ['科幻风格', '轨道交通', '高层建筑', '人物角色'],
  },
];

for (const c of CASES) {
  const r = parsePromptLocally(c.p);
  console.log(`\n--- "${c.p}"`);
  console.log('  matched:', r.matched.map((m) => `${m.label}=${m.value}`).join(' | '));
  console.log('  ignored:', r.ignored.join(','), ' coverage:', r.coverage.toFixed(2));
  console.log('  unsupported:', r.unsupported.map((u) => u.hint).join(','));
  if (c.want) for (const [k, v] of Object.entries(c.want)) eq(`  ${k}`, r.schema[k], v);
  if (c.wantZoning != null) eq('  commercialRatio', r.schema.zoning.commercialRatio, c.wantZoning);
  if (c.unsupported) eq('  unsupported hints', r.unsupported.map((u) => u.hint).sort(), c.unsupported.slice().sort());
}

// 空输入也必须产出完整可用的 schema
const empty = parsePromptLocally('');
eq('empty→defaults mapSize', empty.schema.mapSize, 256);
eq('empty→no matched', empty.matched.length, 0);

// normalize：脏数据不能崩
const dirty = normalizeSchema({ mapSize: 99999, theme: 'nope', zoning: { commercialRatio: 5 }, terrain: null, seed: 0 });
eq('normalize clamps mapSize', dirty.mapSize, 1024);
eq('normalize fixes theme', dirty.theme, 'suburb');
eq('normalize clamps zoning', dirty.zoning.commercialRatio, 0.8);
eq('normalize terrain default', dirty.terrain.amplitude, 3);
eq('normalize assigns seed', dirty.seed > 0, true);

// 字符串数字要能用，垃圾值要回落默认
const strNum = normalizeSchema({ seed: '1234', mapSize: '384', density: '', vegetationDensity: 'abc', terrain: { amplitude: '8' } });
eq('normalize numeric strings', [strNum.seed, strNum.mapSize, strNum.terrain.amplitude], [1234, 384, 8]);
eq('normalize junk→defaults', [strNum.density, strNum.vegetationDensity], [0.5, 0.4]);

// 同种子必须完全一致（可复现）
const a = normalizeSchema({ seed: 4242 });
const b = normalizeSchema({ seed: 4242 });
eq('seeded rng reproducible', [a.rng(), a.rng(), a.rng()], [b.rng(), b.rng(), b.rng()]);

// 所有主题引用的资产 type 必须真实存在于 LIB（防止解析出放不下的东西）
const { LIB } = await import('../src/assets.js');
const known = new Set();
for (const g of LIB) for (const it of g.items) known.add(`${g.id}:${it.type}`);
const groupOf = { houses: ['house'], commerce: ['suburban', 'functional'], civic: ['suburban', 'functional'], trees: ['vegetation'], ground: ['vegetation'] };
let bad = [];
for (const [tid, t] of Object.entries(TOWN_THEMES)) {
  for (const [slot, types] of Object.entries(t)) {
    if (!Array.isArray(types)) continue;
    for (const ty of types) {
      const hit = groupOf[slot]?.some((gid) => known.has(`${gid}:${ty}`));
      if (!hit) bad.push(`${tid}.${slot}:${ty}`);
    }
  }
}
eq('theme asset types all exist in LIB', bad, []);

// chips 必须 10 项且都有可读文案
eq('describeSchema length', describeSchema(normalizeSchema({ seed: 7 })).length, 10);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
