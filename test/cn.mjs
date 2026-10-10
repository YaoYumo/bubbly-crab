// 中式古建「结构完整度」测试：每个构件都在（屋顶层数 / 柱础夹杆石 / 斗拱鎏金 / 雀替 /
// 匾额贴图 / 彩画 / 石栏杆 / 脊兽小件 / 门洞开敞），并核对三档精度的规模单调。
// 运行：node test/cn.mjs
import puppeteer from 'puppeteer';

const URL0 = process.env.URL || 'http://localhost:5173/';
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|DevTools/.test(t)) errors.push('console: ' + t.split('\n')[0]); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t.LIB_INDEX, { timeout: 180000 });

const res = await page.evaluate(async () => {
  const { THREE, LIB_INDEX, defaultsFor, setDetailLevel } = window.__t;
  const items = [...LIB_INDEX.values()].filter((i) => i.catId === 'cn');
  setDetailLevel('std');
  window.__cnMeta = 1;        // 让 bakeMerge 顺手记下「来源件档案」：合并成一个几何之后还能逐件数构件

  // ── 逐件剖析：把每个 mesh/实例记成一条「构件记录」，再按结构清单核对 ──
  function probe(g) {
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    const parts = [];
    let tri = 0, draw = 0, nan = 0;
    g.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      draw++;
      const geo = o.geometry;
      if (!geo || !geo.attributes.position) return;
      const per = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      const cnt = o.isInstancedMesh ? o.count : 1;
      tri += per * cnt;
      const p = o.position;
      if (!Number.isFinite(p.x + p.y + p.z) || !Number.isFinite(o.scale.x)) nan++;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const b = new THREE.Box3().setFromObject(o);
      let y0 = b.min.y - bb.min.y, y1 = b.max.y - bb.min.y;
      let dx = Math.max(0.001, b.max.x - b.min.x), dy = Math.max(0.001, b.max.y - b.min.y), dz = Math.max(0.001, b.max.z - b.min.z);
      let samp = null;
      if (o.isInstancedMesh && o.count > 1) {
        // 实例化的一批小件：世界盒是「全部实例的并集」，必须逐个实例看规格与高度
        if (!geo.boundingBox) geo.computeBoundingBox();
        const gb = geo.boundingBox;
        const gx = Math.max(0.001, gb.max.x - gb.min.x), gy = Math.max(0.001, gb.max.y - gb.min.y), gz = Math.max(0.001, gb.max.z - gb.min.z);
        const mm = new THREE.Matrix4();
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
        const ns = Math.min(o.count, 16);
        samp = [];
        for (let i2 = 0; i2 < ns; i2++) {
          o.getMatrixAt(Math.floor(i2 * o.count / ns), mm);
          mm.decompose(pos, q, scl);
          const sx = Math.max(0.001, gx * Math.abs(scl.x)), sy = Math.max(0.001, gy * Math.abs(scl.y)), sz = Math.max(0.001, gz * Math.abs(scl.z));
          const wy = pos.clone().applyMatrix4(o.matrixWorld).y;
          samp.push({ y0: wy - sy / 2 - bb.min.y, y1: wy + sy / 2 - bb.min.y, minD: Math.min(sx, sy, sz), maxD: Math.max(sx, sy, sz), vol: sx * sy * sz });
        }
        dx = samp[0].maxD; dy = samp[0].y1 - samp[0].y0; dz = samp[0].maxD;
        y0 = samp[0].y0; y1 = samp[0].y1;
      }
      parts.push({
        t: geo.type, cnt, samp,
        y0, y1,
        minD: Math.min(dx, dy, dz), maxD: Math.max(dx, dy, dz),
        vol: dx * dy * dz,
        kind: (m && m.userData && m.userData.detail) || '',
        map: !!(m && m.map),
        hex: m && m.color ? m.color.getHex() : -1,
      });
      if (Array.isArray(o.material)) o.material.forEach((mm) => { if (mm && mm.map) parts[parts.length - 1].map = true; });
      const bm = geo.userData && geo.userData.bakedMeta;      // 烘进一个几何的零碎件：按档案补回构件记录
      if (bm) for (const e of bm) parts.push({
        t: e.t, cnt: 1, samp: null,
        y0: e.y - e.sy / 2 - bb.min.y, y1: e.y + e.sy / 2 - bb.min.y,
        minD: Math.min(e.sx, e.sy, e.sz), maxD: Math.max(e.sx, e.sy, e.sz), vol: e.sx * e.sy * e.sz,
        kind: e.kind, map: e.map, hex: e.hex,
      });
    });
    const sum = (f) => parts.reduce((a, p) => {
      if (!p.samp) return a + (f(p) ? p.cnt : 0);
      let k = 0;
      for (const s2 of p.samp) if (f({ ...p, ...s2 })) k++;
      return a + Math.round((k * p.cnt) / p.samp.length);
    }, 0);
    const h = bb.max.y - bb.min.y;
    const PAINTC = [0x2f5b8a, 0x3c7a5e, 0x8f3a2c, 0x24405f, 0x1d3a63];
    const GOLD = [0xc9a45c, 0xb08a3e, 0xd8b25a, 0xe6c56d, 0xb99a4e];
    return {
      draw, tri: Math.round(tri), nan, h: +h.toFixed(2),
      w: +(bb.max.x - bb.min.x).toFixed(2), d: +(bb.max.z - bb.min.z).toFixed(2),
      roofs: sum((p) => p.kind === 'tile' && p.t === 'PlaneGeometry'),
      roofVol: sum((p) => p.kind === 'tile'),
      stone: sum((p) => p.kind === 'stone'),
      bases: sum((p) => p.kind === 'stone' && p.y1 < 1.3 && p.vol < 6),          // 柱础 / 夹杆石 / 磉墩
      thinStone: sum((p) => p.kind === 'stone' && p.minD < 0.13 && p.maxD > 0.5), // 栏板 / 寻杖 / 宇墙压顶
      gold: sum((p) => GOLD.indexOf(p.hex) >= 0),                                 // 鎏金：散斗、柱头、铺首、相轮
      paint: sum((p) => PAINTC.indexOf(p.hex) >= 0),                              // 彩画青绿 + 匾额蓝底
      queti: sum((p) => p.t === 'ExtrudeGeometry'),                               // 雀替（三角挤出体）
      plaque: sum((p) => p.map),                                                  // 带贴图（canvas 题字）的匾额面
      small: sum((p) => p.vol < 0.9 && p.y1 > h * 0.72),                          // 顶部小件：吻兽 / 走兽 / 脊
      tileParts: sum((p) => p.kind === 'tile'),
      parts: parts.length,
    };
  }

  const out = { items: {}, tiers: {}, holes: {}, paifangRays: null, err: null };
  try {
    for (const it of items) {
      const P = defaultsFor(it);
      const g = it.build(P);
      out.items[it.type] = probe(g);
      g.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    }
    // 三档单调：draw / 三角数必须 lite ≤ std ≤ fine
    for (const lv of ['lite', 'std', 'fine']) {
      setDetailLevel(lv);
      let draw = 0, tri = 0, nan = 0;
      for (const it of items) {
        const g = it.build(defaultsFor(it));
        const r = probe(g);
        draw += r.draw; tri += r.tri; nan += r.nan;
        g.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
      }
      out.tiers[lv] = { draw, tri, nan };
    }
    setDetailLevel('std');

    // 门洞必须真的通（券洞中心不被实体挡住）
    const rayPoint = (g, pt) => {
      g.updateMatrixWorld(true);
      const b = new THREE.Box3(), mb = new THREE.Matrix4(), vp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
      let blocked = null;
      const hit = (o) => {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const op = m && m.opacity !== undefined ? m.opacity : 1;
        if (op > 0.6) blocked = blocked || (m && m.userData && m.userData.detail) || 'mesh';
      };
      g.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const geo = o.geometry;
        const bm = geo && geo.userData && geo.userData.bakedMeta;
        if (bm) {                                   // 合并过的几何：整块包围盒会把洞口也算进去，必须逐来源件查
          for (const e of bm) {
            if (Math.abs(pt.x - e.x) <= e.sx / 2 && Math.abs(pt.y - e.y) <= e.sy / 2 && Math.abs(pt.z - e.z) <= e.sz / 2) { hit(o); return; }
          }
          return;
        }
        if (o.isInstancedMesh && o.count > 1 && geo) {   // 一排实例（千斤闸、门钉…）：逐实例查，并集盒会误判成一面墙
          if (!geo.boundingBox) geo.computeBoundingBox();
          const gb = geo.boundingBox;
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, mb); mb.decompose(vp, qq, ss);
            vp.applyMatrix4(o.matrixWorld);
            const hx = Math.max(0.001, (gb.max.x - gb.min.x) * Math.abs(ss.x)) / 2;
            const hy = Math.max(0.001, (gb.max.y - gb.min.y) * Math.abs(ss.y)) / 2;
            const hz = Math.max(0.001, (gb.max.z - gb.min.z) * Math.abs(ss.z)) / 2;
            if (Math.abs(pt.x - vp.x) <= hx && Math.abs(pt.y - vp.y) <= hy && Math.abs(pt.z - vp.z) <= hz) { hit(o); return; }
          }
          return;
        }
        b.setFromObject(o);
        if (!b.isEmpty() && b.containsPoint(pt)) hit(o);
      });
      return blocked;
    };
    const gate = LIB_INDEX.get('cn:gate:城门楼');
    const gg = gate.build(defaultsFor(gate));
    out.holes.gate = rayPoint(gg, new THREE.Vector3(0, 3.0, 0));
    const yard = LIB_INDEX.get('cn:courtyard:四合院单元');
    const yg = yard.build(defaultsFor(yard));
    const yb = new THREE.Box3().setFromObject(yg);
    out.holes.courtyard = rayPoint(yg, new THREE.Vector3(0, 1.2, yb.max.z * 0.98));
    // 牌楼：五个楼位（明间 + 两次间 + 两出头小楼）都要有屋面
    const pf = LIB_INDEX.get('cn:paifang:牌楼牌坊');
    const pg = pf.build(defaultsFor(pf));
    pg.updateMatrixWorld(true);
    const pb = new THREE.Box3().setFromObject(pg);
    const roofs = [];
    pg.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.material?.userData?.detail === 'tile') {
        const rb = new THREE.Box3().setFromObject(o);
        roofs.push({ x: +((rb.min.x + rb.max.x) / 2).toFixed(2), z: +((rb.min.z + rb.max.z) / 2).toFixed(2), y: +rb.max.y.toFixed(2), w: +(rb.max.x - rb.min.x).toFixed(2) });
      }
      const bm = o.geometry && o.geometry.userData && o.geometry.userData.bakedMeta;   // 屋面被烘进合并几何时走档案
      if (bm) for (const e of bm) if (e.kind === 'tile' && e.t === 'PlaneGeometry') {
        roofs.push({ x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +(e.y + e.sy / 2).toFixed(2), w: +e.sx.toFixed(2) });
      }
    });
    roofs.sort((a, b) => a.x - b.x);
    // 从每个楼位正上方垂直向下打一条射线：先命中「本间屋脊一带的实体」，且 2 m 内有瓦面
    const rc = new THREE.Raycaster();
    const per = [];
    for (const r of roofs) {
      rc.set(new THREE.Vector3(r.x, pb.max.y + 4, r.z || 0), new THREE.Vector3(0, -1, 0));
      const hits = rc.intersectObject(pg, true).filter((h) => h.object.visible !== false);
      const first = hits.length ? +hits[0].point.y.toFixed(2) : null;
      const tileHit = hits.find((h) => h.object.material && h.object.material.userData && h.object.material.userData.detail === 'tile');
      per.push({ x: r.x, roofY: r.y, hit: first, tile: !!tileHit && first !== null && tileHit.point.y > r.y - 2.2, firstIsTile: !!(hits[0] && hits[0].object.material && hits[0].object.material.userData && hits[0].object.material.userData.detail === 'tile') });
    }
    out.paifangRays = { count: roofs.length, span: +(pb.max.x - pb.min.x).toFixed(2), per };
    out.pfBbox = { w: +(pb.max.x - pb.min.x).toFixed(2), h: +(pb.max.y - pb.min.y).toFixed(2), d: +(pb.max.z - pb.min.z).toFixed(2) };
    pg.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    gg.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    yg.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
  } catch (e) {
    out.err = String(e && e.stack || e).split('\n').slice(0, 3).join(' | ');
  }
  return out;
});
await browser.close();

const R = res;
if (R.err) fails.push('构建异常：' + R.err);
console.log(JSON.stringify(R.items, null, 1));
console.log('tiers', JSON.stringify(R.tiers));
console.log('holes', JSON.stringify(R.holes), 'paifang', JSON.stringify(R.paifangRays), R.pfBbox && JSON.stringify(R.pfBbox));

const NEED = {
  hall: { roofs: 1, gold: 8, thinStone: 8, paint: 6, bases: 8, small: 14 },
  hall2: { roofs: 1, gold: 8, thinStone: 8, paint: 6, bases: 8, small: 10 },
  pavilion: { roofs: 1, gold: 10, thinStone: 6, small: 8 },
  paifang: { roofs: 5, queti: 6, plaque: 2, gold: 20, paint: 6, bases: 12, small: 20 },
  pagoda: { roofs: 7, thinStone: 60, gold: 14, small: 20 },
  gate: { roofs: 1, plaque: 1, thinStone: 16, gold: 12, small: 12 },
  citywall: { roofs: 1, thinStone: 20, small: 8 },
  corridor: { roofs: 1, gold: 8, paint: 6, bases: 8 },
  archbridge: { thinStone: 8, stone: 20 },
  drumtower: { roofs: 2, plaque: 1, thinStone: 12, gold: 12, paint: 4 },
  courtyard: { roofs: 6, plaque: 2, bases: 8, thinStone: 8 },
  moongate: { roofs: 1, stone: 20, bases: 2 },
  lanternpole: { parts: 18, gold: 4 },
  ding: { gold: 16, torus: 0 },
  spiritway: { parts: 40, stone: 20 },
};
for (const [type, need] of Object.entries(NEED)) {
  const a = R.items[type];
  if (!a) { ck(type + ' 存在', false, '素材库缺该项'); continue; }
  const miss = Object.entries(need).filter(([k, v]) => (a[k] ?? 0) < v).map(([k, v]) => `${k} ${a[k] ?? 0}<${v}`);
  ck(`cn:${type} 构件齐备（屋顶 ${a.roofs}·鎏金 ${a.gold}·石作 ${a.thinStone}/${a.bases}·彩画 ${a.paint}·小件 ${a.small}）`, miss.length === 0, miss.join(', '));
  ck(`cn:${type} 健康（draw ${a.draw}·tri ${a.tri}·NaN ${a.nan}·尺寸 ${a.w}×${a.d}×${a.h}）`, a.nan === 0 && a.tri > 300 && a.tri < 140000 && a.draw < 2600);
}
ck('牌楼五楼：每个楼位正上方都能打到本间屋面（含两侧小楼）', R.paifangRays && R.paifangRays.per.length >= 5 && R.paifangRays.per.every((x) => x.tile),
  R.paifangRays ? R.paifangRays.per.map((x) => `${x.x}:${x.tile ? '瓦' : '空'}${x.hit === null ? '' : '@' + x.hit}`).join(' ') : 'no data');
ck('城门楼门洞开敞（券洞中心无实体）', R.holes && R.holes.gate === null, '挡住：' + (R.holes && R.holes.gate));
ck('四合院街门洞开敞', R.holes && R.holes.courtyard === null, '挡住：' + (R.holes && R.holes.courtyard));
if (R.tiers.std) {
  ck('精度三档单调（draw 与 tri：lite ≤ std ≤ fine）',
    R.tiers.lite.draw <= R.tiers.std.draw && R.tiers.std.draw <= R.tiers.fine.draw && R.tiers.lite.tri < R.tiers.std.tri && R.tiers.std.tri < R.tiers.fine.tri,
    JSON.stringify(R.tiers));
  ck('省内存档确实更省（lite 三角 < std×0.6 且 draw 更少）', R.tiers.lite.tri < R.tiers.std.tri * 0.6 && R.tiers.lite.draw < R.tiers.std.draw, JSON.stringify(R.tiers));
  ck('三档均无 NaN', R.tiers.lite.nan === 0 && R.tiers.std.nan === 0 && R.tiers.fine.nan === 0);
}
ck('无页面错误', errors.length === 0, errors.slice(0, 3).join(' / '));
console.log(JSON.stringify({ pass: fails.length === 0 ? 'ALL' : 'FAIL', failCount: fails.length, fails }, null, 1));
process.exit(fails.length ? 1 : 0);
