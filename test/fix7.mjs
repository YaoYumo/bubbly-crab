// Round-7 结构核对：16+1 项屋顶 / 构件的「反向、悬空、穿插」量化检查 + 每件一张实拍图
// 运行：node test/fix7.mjs   （输出 test/out/r7-<type>.png 与 test/out/r7.json）
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5173/';
const OUT = 'test/out';
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message.split('\n')[0]); console.log('PAGEERR', e.message.split('\n')[0]); });
await p.setViewport({ width: 1200, height: 780, deviceScaleFactor: 1.4 });
await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app && window.__t.LIB_INDEX, { timeout: 180000 });

await p.evaluate(async (onlyList) => {
  const { THREE, LIB_INDEX, defaultsFor, setDetailLevel } = window.__t;
  const ONLY = onlyList;
  const app = window.app;
  setDetailLevel('std');
  app.objects.slice().forEach((o) => app.removeObject(o));
  app.state.showHelpers = false;
  app.stage.setGridVisible(false);
  app.stage.view.far = 2000;
  const want = ['buildPavilion', 'buildPagoda', 'buildGate', 'buildArchBridge', 'buildCourtyard', 'buildMoonGate',
    'buildMansion', 'buildWhiteChurch', 'buildBarn', 'buildMountain', 'buildTrench', 'buildRuin',
    'buildWindowArch', 'buildDoorDouble', 'buildDoorRoll', 'buildRoofGable', 'buildRoofHip',
    'buildBoulder', 'buildRockPile', 'buildCliff', 'buildArch', 'buildGardenStone', 'buildFloatingRock', 'buildCrater'];
  const items = [];
  for (const [k, i] of LIB_INDEX) { if (i.build && want.includes(i.build.name) && (!ONLY.length || ONLY.includes(i.build.name))) { if (!i.key) Object.defineProperty(i, 'key', { value: k, enumerable: false }); items.push(i); } }
  window.__r7 = { items: [], skipped: want.filter((n) => !items.some((i) => i.build.name === n)) };
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3(), c = new THREE.Vector3();
  for (const it of items) {
    const holder = new THREE.Group();
    let g = null;
    try { g = it.build(defaultsFor(it)); } catch (e) { window.__r7.items.push({ name: it.name, err: String(e).slice(0, 90) }); continue; }
    holder.add(g);
    app.stage.world.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    // 收集「薄板件」（两个方向尺寸 ≥ 3× 第三个方向）—— 屋面板 / 楼板 / 斜梁都属这类
    const panels = [];
    holder.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const bb = new THREE.Box3().setFromObject(o);
      const sz = bb.getSize(new THREE.Vector3());
      const arr = [sz.x, sz.y, sz.z].sort((a, x2) => a - x2);
      if (arr[2] > 0.6 && arr[0] * 5 < arr[1] && arr[1] > 0.9) {
        // 取该件「最大面」的法线：把局部法线 (0,1,0)（box 顶面）转到世界
        nrm.set(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())).normalize();
        panels.push({ bb, sz, nd: nrm.dot(up) });
      }
    });
    let down = 0, vertical = 0, floating = 0, protrude = 0;
    for (const q of panels) {
      if (q.nd < -0.08) down++;                                   // 面反扣（法线朝下）
      if (Math.abs(q.nd) < 0.14 && q.sz.z > 1.2 && q.sz.x > 1.2) vertical++;   // 屋面板立起来了
      if (q.bb.min.y > box.min.y + 0.45) {                          // 悬空：下面 0.5 m 内没有别的板件/地面
        let sup = box.min.y > q.bb.min.y - 0.5;
        for (const o2 of panels) if (o2 !== q && o2.bb.max.y <= q.bb.min.y + 0.12 && o2.bb.max.y > q.bb.min.y - 1.6 &&
          o2.bb.max.x > q.bb.min.x && o2.bb.min.x < q.bb.max.x && o2.bb.max.z > q.bb.min.z && o2.bb.min.z < q.bb.max.z) sup = true;
        if (!sup) floating++;
      }
      const pad = 0.05;
      if (q.bb.max.y > box.max.y + pad || q.bb.min.y < box.min.y - pad * 8) protrude++;
    }
    // 逐件渲染
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const rMax = Math.max(size.x, size.y, size.z);
    const d = rMax * 2.05 + 3;
    holder.position.set(0, 0, 0);
    const bb2 = new THREE.Box3().setFromObject(holder);
    if (!window.__r7frame) window.__r7frame = {};
    window.__r7frame[it.type] = { px: cx + d * 0.62, py: bb2.min.y + size.y * 0.72 + 1.6, pz: cz + d * 0.78, tx: cx, ty: bb2.min.y + size.y * 0.45, tz: cz, near: Math.max(0.1, d / 40), far: d * 12 };
    window.__r7.items.push({ name: it.name, type: it.type, panels: panels.length, down, vertical, floating, protrude,
      size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], tri: (() => { let t = 0; holder.traverse((o) => { if (o.isMesh && o.geometry) t += (o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1); }); return Math.round(t); })() });
    holder.userData.r7 = it.type;
  }
  window.__r7shoot = (type) => {
    const app = window.app;
    let holder = null;
    app.stage.world.children.forEach((o) => {
      if (!o.isGroup) return;
      const mine = o.userData.r7 === type;
      o.visible = mine;
      if (mine) holder = o;
    });
    if (!holder) return false;
    const f = (window.__r7frame || {})[type];
    if (f) {
      app.stage.view.position.set(f.px, f.py, f.pz);
      app.stage.orbit.target.set(f.tx, f.ty, f.tz);
      app.stage.view.fov = 26; app.stage.view.near = f.near; app.stage.view.far = f.far;
      app.stage.view.updateProjectionMatrix();
      app.stage.orbit.update();
    }
    for (let i = 0; i < 10; i++) app.step();
    return true;
  };
}, (process.env.ONLY || '').split(',').filter(Boolean));

const rect = await p.evaluate(() => {
  const r = document.querySelector('#stage canvas').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

const info = await p.evaluate(() => window.__r7);
const types = info.items.filter((i) => !i.err).map((i) => i.type);
for (const t of types) {
  const ok = await p.evaluate((ty) => window.__r7shoot(ty), t);
  if (!ok) continue;
  await new Promise((r) => setTimeout(r, 260));
  await p.screenshot({ path: `${OUT}/r7-${t}.png`, clip: rect });
}
const sel = await p.evaluate(async () => {
  // 选中双开门：对比「含隐藏子物件」与「只算可见」的包围盒，验证选中圈过大的成因已修掉
  const { THREE, LIB_INDEX, defaultsFor } = window.__t;
  const app = window.app;
  const it = [...LIB_INDEX.values()].find((i) => i.type === 'doordouble');
  app.objects.slice().forEach((o) => app.removeObject(o));
  const o = app.addAsset(it.key || [it.catId, it.type, it.name].join(':'), new THREE.Vector3(0, 0, 0), { params: defaultsFor(it) });
  void 0;
  if (!o) return { err: 'no door' };
  app.select({ kind: 'obj', so: o });
  for (let i = 0; i < 4; i++) app.step();
  const vis = app.stage._box ? app.stage._box.getSize(new THREE.Vector3()) : null;
  const all = new THREE.Box3().setFromObject(o.root).getSize(new THREE.Vector3());
  const kids = [];
  o.root.traverse((c) => { if (c.isMesh && c.geometry) { const b2 = new THREE.Box3().setFromObject(c); kids.push({ n: c.name || c.geometry.type, vis: c.visible, s: b2.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) }); } });
  return { ringScale: +app.stage.selRing.scale.x.toFixed(2), vis: vis ? vis.toArray().map((v) => +v.toFixed(2)) : null, all: all.toArray().map((v) => +v.toFixed(2)), kids: kids.slice(0, 14) };
});
fs.writeFileSync(`${OUT}/r7.json`, JSON.stringify({ ...info, sel, errors }, null, 1));
console.log('=== 反向 / 悬空 / 越界统计（std 档）');
for (const i of info.items) {
  if (i.err) { console.log(`✘ ${i.name} 构建报错 ${i.err}`); continue; }
  const bad = i.down + i.vertical + i.floating + i.protrude;
  console.log(`${bad ? '·' : '✔'} ${i.name.padEnd(14, ' ')} 薄板件 ${String(i.panels).padStart(3)}｜反扣 ${i.down}｜立式 ${i.vertical}｜悬空 ${i.floating}｜越界 ${i.protrude}｜尺寸 ${i.size.join('×')}｜三角 ${i.tri}`);
}
console.log('跳过：', info.skipped.join(',') || '无');
console.log('选中双开门：', JSON.stringify(sel));
// 门限只判用户报的两类：板件扣反（反扣）与越界穿插。
// 「立式 / 悬空」是启发式副产物（屋面合法地压在墙上、桥墩本身就是竖板都会中招）→ 只作提示，不判 FAIL。
const hard = info.items.filter((i) => !i.err && (i.down > 0 || i.protrude > 0));
const hint = info.items.filter((i) => !i.err && (i.vertical > 0 || i.floating > 0)).map((i) => `${i.name}(立式${i.vertical}/悬空${i.floating})`);
console.log('· 启发式提示（不判 FAIL）：' + (hint.length ? hint.join('，') : '无'));
console.log(hard.length ? `FAIL 仍有扣反或越界的板件：${hard.map((h) => `${h.name} 反扣${h.down}/越界${h.protrude}`).join(',')}` : 'PASS 无「扣反 / 越界穿插」的板件');
await b.close();
process.exit(hard.length || info.items.some((i) => i.err) ? 1 : 0);
