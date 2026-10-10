// 所有新增简易模型：逐个构建，检查运行期错误 / 包围盒退化 / NaN
import * as THREE from 'three';

// 无 DOM 环境下的 canvas 替身：任何 2D 方法都返回 no-op（渐变对象也补齐）
const ctxStub = new Proxy({}, {
  get: (t, k) => (k === 'canvas' ? null : t[k] !== undefined ? t[k] : (...a) => (String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = {
  createElement: () => new Proxy({ width: 8, height: 8, style: {}, getContext: () => ctxStub }, {
    get: (t, k) => (k in t ? t[k] : () => {}), set: () => true,
  }),
};

const geo = await import('../src/geo.js');
const assets = await import('../src/assets.js');
const arch = await import('../src/arch.js');
const nature = await import('../src/nature.js');
const props = await import('../src/props.js');

const ALL = [...arch.GROUPS, ...nature.GROUPS, ...props.GROUPS];
const mods = { arch, nature, props };

let pass = 0; const fails = [];
function bad(m) { fails.push(m); }

function boxOf(g) {
  const b = new THREE.Box3();
  g.updateMatrixWorld(true);
  g.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) b.expandByObject(o); });
  return b;
}

// 结构检查：分组 / 条目字段完整、键名唯一
const keys = new Set();
const seen = new Set();
for (const grp of [await import('../src/arch.js'), await import('../src/nature.js'), await import('../src/props.js')]) {
  for (const g of grp.GROUPS || []) {
    if (!g.cat || !g.id || !Array.isArray(g.items)) { bad('分组缺 cat/id/items'); continue; }
    pass++;
    for (const it of g.items) {
      const k = `${g.id}:${it.type}:${it.name}`;
      if (keys.has(k)) bad(`键重复 ${k}`);
      keys.add(k);
      if (typeof it.build !== 'function') bad(`${k} build 不是函数`);
      if (!it.icon) bad(`${k} 没有 icon`);
      if (!Array.isArray(it.params) || !it.params.length) bad(`${k} 没有参数表`);
      else for (const q of it.params) {
        if (!q.k || !q.l) bad(`${k} 参数字段不全 (${q.k})`);
        if (q.min != null && q.max != null && Number(q.min) > Number(q.max)) bad(`${k}.${q.k} min>max`);
        if (q.def != null && q.min != null && (q.def < q.min - 1e-6 || q.def > q.max + 1e-6)) bad(`${k}.${q.k} 默认值越界`);
      }
    }
  }
}

// 图标：面板找不到键会回退 crate，这里确保新素材都有专属图标
try {
  const { ICON } = await import('../src/panels.js');
  const missing = new Set();
  for (const grp of assets.LIB) for (const it of grp.items) if (it.icon && !ICON[it.icon]) missing.add(it.icon);
  for (const m of missing) bad(`ICON 缺少图标：${m}`);
  pass++;
} catch (e) { bad(`panels 载入失败（图标未校验）：${e.message}`); }


// LIB 条目 → 全量构建（默认参数）
let libCount = 0;
for (const grp of assets.LIB) {
  for (const it of grp.items) {
    const key = `${grp.id}:${it.type}:${it.name}`;
    seen.add(key);
    libCount++;
    if (!it.build) { bad(`${key} 没有 build`); continue; }
    try {
      const p = { ...(it.defaults || {}) };
      if (it.params) for (const q of it.params) if (p[q.k] === undefined && q.def !== undefined) p[q.k] = q.def;
      const g = it.build(p);
      const b = boxOf(g);
      if (b.isEmpty()) bad(`${key} 模型为空`);
      else {
        const s = b.getSize(new THREE.Vector3());
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) bad(`${key} 包围盒 NaN`);
        else if (s.x > 6000 || s.y > 6000 || s.z > 6000) bad(`${key} 过大 ${Math.round(s.x)}×${Math.round(s.y)}×${Math.round(s.z)}`);
        let nan = 0, meshes = 0;
        g.traverse((o) => {
          const arr = o.geometry?.attributes?.position?.array;
          if (!arr) return;
          meshes++;
          for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { nan++; break; }
        });
        if (nan) bad(`${key} 有 ${nan}/${meshes} 个 NaN 几何体`);
        if (!meshes) bad(`${key} 没有实体网格`);
      }
      pass++;
    } catch (e) { bad(`${key} build 抛错 ${e.message}`); }
  }
}

// 参数边界（UI 允许的 min / ≤240 的 max）：不能崩、不能 NaN
for (const grp of assets.LIB) {
  for (const it of grp.items) {
    if (!it.params?.length) continue;
    for (const mode of ['min', 'max']) {
      const p = {};
      let skip = false;
      for (const q of it.params) {
        if (q.t === 'color' || q.t === 'sel') { p[q.k] = q.def; continue; }
        const v = mode === 'min' ? q.min : q.max;
        if (mode === 'max' && Number(v) > 240) { skip = true; break; }
        p[q.k] = v;
      }
      if (skip) continue;
      try {
        const g = it.build(p);
        const b = boxOf(g);
        if (b.isEmpty()) { if (mode === 'max') bad(`${it.name} ${mode} 无几何`); continue; }
        const s2 = b.getSize(new THREE.Vector3());
        if (!Number.isFinite(s2.x) || !Number.isFinite(s2.y) || !Number.isFinite(s2.z)) bad(`${it.name} ${mode} 包围盒 NaN`);
        else if (['cn', 'cls', 'in', 'nat', 'war', 'sci', 'fx'].includes(grp.id) && (s2.x > 1400 || s2.y > 1000 || s2.z > 1400)) bad(`${it.name} ${mode} 尺寸越界 ${Math.round(s2.x)}×${Math.round(s2.y)}×${Math.round(s2.z)}`);
        pass++;
      } catch (e) { bad(`${it.name} ${mode} 抛错 ${e.message}`); }
    }
  }
}

// 关键库项必须存在（供场景模板引用，写错名字立刻发现）
const need = [
  'cn:hall:宫殿大殿', 'cn:hall2:歇山殿宇', 'cn:pagoda:楼阁式佛塔', 'cn:paifang:牌楼牌坊', 'cn:gate:城门楼',
  'cn:citywall:城墙敌台', 'cn:corridor:彩画回廊', 'cn:archbridge:石拱桥', 'cn:drumtower:鼓楼钟楼',
  'cn:courtyard:四合院单元', 'cn:moongate:月亮门院墙', 'cn:lanternpole:宫灯杆', 'cn:ding:鼎 / 香炉', 'cn:spiritway:石像生神道', 'cn:pavilion:攒尖亭',
  'cls:capitol:穹顶议会大楼', 'cls:mansion:南方庄园宅邸', 'cls:brownstone:联排褐石住宅', 'cls:church:白色尖顶教堂', 'cls:lighthouse:灯塔',
  'cls:watertower:小镇水塔', 'cls:barn:红谷仓', 'cls:gazebo:花园凉亭', 'cls:clocktower:校园钟楼',
  'in:room:房间盒', 'in:sofa:沙发', 'in:chair:单椅', 'in:table:桌几', 'in:bed:床', 'in:wardrobe:衣柜', 'in:shelf:书架',
  'in:kitchen:厨房台面', 'in:lamp:落地灯', 'in:rug:地毯', 'in:stairs:室内楼梯', 'in:plant:盆栽', 'in:tv:电视墙', 'in:curtain:窗帘', 'in:wall:隔断墙',
  'nat:mountain:山峰', 'nat:hill:丘陵', 'nat:cliff:断崖', 'nat:boulder:巨石', 'nat:rockpile:乱石堆', 'nat:stonearch:天生石门',
  'nat:floatingrock:浮空仙岛', 'nat:tree:针叶松', 'nat:bush:灌木丛', 'nat:grass:草地', 'nat:flowers:花田', 'nat:reeds:芦苇荡',
  'nat:log:倒木', 'nat:crops:农田', 'nat:cactus:仙人掌群', 'nat:crystal:灵晶簇', 'nat:pond:水塘', 'nat:waterfall:瀑布 + 水潭',
  'nat:stonepath:石板小径', 'nat:gardenstone:太湖石',
  'war:trench:战壕', 'war:sandbags:沙袋掩体', 'war:barbed:铁丝网', 'war:bunker:碉堡', 'war:tank:主战坦克', 'war:artillery:牵引火炮',
  'war:tent:野战帐篷', 'war:flagpole:军旗', 'war:crater:弹坑', 'war:ruin:被打烂的楼', 'war:watchtower:瞭望塔', 'war:hesco:石笼防爆墙', 'war:wreck:烧毁车辆',
  'sci:planet:行星', 'sci:stars:星空', 'sci:nebula:星云', 'sci:cruiser:巡洋舰', 'sci:fighter:星际战机', 'sci:station:轨道空间站',
  'sci:dome:穹顶基地', 'sci:hangar:机库', 'sci:turret:防御炮塔', 'sci:pylon:能量图腾塔', 'sci:launchpad:发射台', 'sci:debris:残骸碎片',
  'fx:portal:传送门', 'fx:glyph:地面法阵', 'fx:lanterns:天灯群', 'fx:clouds:云海', 'fx:swordrack:剑架', 'fx:glow:地面光斑',
];
for (const k of need) if (!seen.has(k)) bad(`LIB 缺少 ${k}`);
const byName = new Map();
for (const grp of assets.LIB) for (const it of grp.items) byName.set(`${grp.id}:${it.type}:${it.name}`, it);
for (const k of need) if (!byName.has(k)) bad(`LIB_INDEX 键不存在：${k}`);

const out = { pass, failCount: fails.length, libCount, fails: fails.slice(0, 40) };
console.log(JSON.stringify(out, null, 1));
await import('node:fs').then((fs) => fs.writeFileSync('test/assets-result.json', JSON.stringify(out, null, 1)));
process.exit(fails.length ? 1 : 0);
