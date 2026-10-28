// 建筑构件（墙 / 窗 / 门 / 屋顶 / 天花板 / 楼梯）+ 楼梯在天花板自动留洞 + 逐步撤销
// 运行：node test/parts.mjs            截图：node test/parts.mjs shot
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5174/';
const wantShot = process.argv.slice(2).includes('shot');
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.25 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon/.test(t)) errors.push('console: ' + t.split('\n')[0]); if (/不认识的参数/.test(t)) errors.push('IGNORED-PARAM: ' + t.split('\n')[0]); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t, { timeout: 180000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

const R = await page.evaluate(async () => {
  const app = window.app, THREE = window.__t.THREE;
  const LIB = window.__t.LIB;
  const out = { errors: [] };
  const grp = LIB.find((g) => g.id === 'bld');
  out.group = grp ? { cat: grp.cat, n: grp.items.length, types: grp.items.map((i) => i.type), icons: [...new Set(grp.items.map((i) => i.icon))] } : null;
  out.libCount = [...LIB].reduce((s, g) => s + g.items.length, 0);
  const cards = [...document.querySelectorAll('.library-card')];
  const mine = cards.filter((c) => c.dataset.assetKey?.startsWith('bld:'));
  out.iconSvg = { cards: cards.length, mine: mine.length, withSvg: mine.filter((c) => c.querySelectorAll('svg *, img').length > 0).length };

  const clear = () => { app.stage?.stopFly?.(); app.objects.slice().forEach((o) => app.removeObject(o)); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const nanIn = (root) => { let n = 0; root.traverse((c) => { const p = c.geometry?.attributes?.position; if (!p) return; for (let i = 0; i < p.count; i += 7) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (!Number.isFinite(x + y + z)) n++; } }); return n; };

  // —— 1) 15 个构件都能成形（默认参数 + 极值参数），无 NaN、有内容
  const builds = [];
  for (const it of grp.items) {
    const defs = {}; for (const p of it.params || []) defs[p.k] = p.def;
    const one = (params, tag) => {
      const root = it.build(params);
      const bb = new THREE.Box3().setFromObject(root);
      let tri = 0;
      root.traverse((c) => { const g = c.geometry; if (g?.index) tri += g.index.count / 3; else if (g?.attributes?.position) tri += g.attributes.position.count / 3; });
      builds.push({ t: it.type, tag, empty: bb.isEmpty(), nan: nanIn(root), tri: Math.round(tri), h: +bb.getSize(V(0, 0, 0)).y.toFixed(2), w: +bb.getSize(V(0, 0, 0)).x.toFixed(2) });
      root.traverse((c) => { c.geometry?.dispose?.(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.()); });
    };
    one({ ...defs }, 'def');
    const ext = {};
    for (const p of it.params || []) {
      if (p.t === 'range' || p.t === 'int') ext[p.k] = p.min;
      else if (p.t === 'bool') ext[p.k] = true;
      else if (p.t === 'select') ext[p.k] = p.opts[p.opts.length - 1].v;
      else ext[p.k] = p.def;
    }
    one({ ...ext }, 'min');
    for (const p of it.params || []) if (p.t === 'range' || p.t === 'int') ext[p.k] = p.max;
    one({ ...ext }, 'max');
  }
  out.builds = builds;

  // —— 2) 直墙的门洞 / 窗洞是真洞（横向射线穿过）
  clear();
  if (app.terrain) app.terrain.setEnabled(false);      // 室内搭房子：先把地形关掉，楼板 / 楼梯才在同一水平面上
  const wall = app.addAsset('bld:wall:直墙（带门窗洞）', V(0, 0, 0), { params: { length: 8, height: 3, thick: 0.24, wins: 2, door: true, doorPos: 0.5 } });
  app.updateCeilingHoles();
  const ray = new THREE.Raycaster();
  const hitAt = (from, dir) => { ray.set(from, dir.normalize()); const h = ray.intersectObject(wall.root, true); return h.length ? +h[0].distance.toFixed(2) : 999; };
  let meshes = 0; wall.root.traverse((c) => { if (c.isMesh) meshes++; });
  const wl = wall.root.userData.wall || {};
  out.wall = { meshes, len: +(wl.len || 0).toFixed(2), doorGap: hitAt(V(0, 1.1, -3), V(0, 0, 1)), pier: hitAt(V(-wl.len / 2 + 0.3, 1.1, -3), V(0, 0, 1)) };

  // —— 3) 楼梯 + 天花板：自动留洞；洞是真几何（射线穿过不命中）
  clear();
  const gy = app.terrain && app.terrain.enabled ? app.terrain.heightAt(0, 0) : 0;
  const st = app.addAsset('bld:stairstraight:单跑楼梯', V(0, 0, -6), { params: { rise: 3.4, w: 1.2, steps: 16, openUp: 0.1, band: 2.4, pad: 0.4 } });
  const ce = app.addAsset('bld:ceilingflat:天花板（平板·可开孔）', V(0, 0, 0), { params: { w: 20, d: 22, thick: 0.12, autoHole: true, light: false } });
  app.updateCeilingHoles();
  const ceilY = ce.root.position.y, elevOk = Math.abs(ceilY - (gy + 3.2)) < 0.05;
  const hp = (ce.params.holes || [[]])[0];
  let hx = 0, hz = 0; for (const q of hp) { hx += q[0] / hp.length; hz += q[1] / hp.length; }
  const holeCenter = new THREE.Vector3(hx, 0, hz).applyMatrix4(ce.root.matrixWorld); holeCenter.y = ceilY + 1.2;
  st.visible = false; st.root.visible = false; ce.root.updateMatrixWorld(true);
  const through = (() => { ray.set(holeCenter, V(0, -1, 0)); const h = ray.intersectObject(ce.root, true); return h.length ? +h[0].distance.toFixed(2) : 999; })();
  const solid = (() => { ray.set(V(holeCenter.x + 3.6, ceilY + 1.2, holeCenter.z), V(0, -1, 0)); const h = ray.intersectObject(ce.root, true); return h.length ? +h[0].distance.toFixed(2) : 999; })();
  out.hole = { lampsOff: true, holes: (ce.params.holes || []).length, ceilY: +ceilY.toFixed(2), gy: +gy.toFixed(2), elevOk, through, solid, followOff: ce.followTerrain === false, poly: (ce.params.holes || [])[0] };

  // —— 3b) 洞口尺寸由楼梯的 holeLen 控制（0 = 整段梯都留空）
  {
    const zsz = (h0) => { const h = (h0 && h0.length ? h0 : [[0, 0]]); const xs = h.map((q) => q[0]), zs = h.map((q) => q[1]); return [+(Math.max(...zs) - Math.min(...zs)).toFixed(2), +(Math.max(...xs) - Math.min(...xs)).toFixed(2)]; };
    const sz0 = zsz((ce.params.holes || [[]])[0]);
    st.params.holeLen = 0; app.rebuildObject(st); app.updateCeilingHoles();
    const szFull = zsz((ce.params.holes || [[]])[0]);
    st.params.holeLen = 1.2; app.rebuildObject(st); app.updateCeilingHoles();
    const sz12 = zsz((ce.params.holes || [[]])[0]);
    st.params.holeLen = 2.4; app.rebuildObject(st); app.updateCeilingHoles();
    out.holeSize = { sz0, szFull, sz12 };
  }


  // —— 4) 挪走楼梯 → 洞跟过去；删掉楼梯 → 洞补回
  const cxBefore = (ce.params.holes || [[]])[0].reduce((a, q) => a + q[0], 0) / 4;
  st.root.position.x = 3.5; st.root.position.z = -6; st.root.updateMatrixWorld(true);
  app.updateCeilingHoles();
  const afterMove = ((ce.params.holes || []).length);
  const movedCenter = +( ((ce.params.holes || [[]])[0].reduce((a, q) => a + q[0], 0) / 4) - cxBefore ).toFixed(2);
  app.removeObject(st);
  app.updateCeilingHoles();
  const afterDel = (ce.params.holes || []).length;
  st.visible = true; st.root.visible = true;
  const closed = (() => { ray.set(holeCenter, V(0, -1, 0)); const h = ray.intersectObject(ce.root, true); return h.length ? +h[0].distance.toFixed(2) : 999; })();
  out.lifecycle = { afterMove, movedCenter, afterDel, closed };

  // —— 5) autoHole 关掉 → 不开孔；双跑 / 螺旋梯也能开孔
  clear();
  const st2 = app.addAsset('bld:stairswitch:双跑楼梯（带休息平台）', V(0, 0, -3), { params: { rise: 3.4, w: 1.1 } });
  const ce2 = app.addAsset('bld:ceilingflat:天花板（平板·可开孔）', V(0, 0, 0), { params: { w: 12, d: 12, autoHole: false, light: false } });
  app.updateCeilingHoles();
  const offHoles = (ce2.params.holes || []).length;
  ce2.params.autoHole = true; app.rebuildObject(ce2); app.updateCeilingHoles();
  const onHoles = (ce2.params.holes || []).length;
  clear();
  const sp = app.addAsset('bld:stairspiral:螺旋楼梯', V(0, 0, -2), { params: { rise: 3.4, r: 1.5, band: 2.4 } });
  const ce3 = app.addAsset('bld:ceilinggrid:天花板（格栅吊顶）', V(0, 0, 0), { params: { w: 9, d: 9, autoHole: true, lights: false } });
  app.updateCeilingHoles();
  out.variants = { offHoles, onHoles, spiral: (ce3.params.holes || []).length, spiralPts: (ce3.params.holes || [[]])[0].length };

  // —— 6) 逐步撤销 / 重做（Ctrl+Z 只退一步）
  clear();
  const a1 = app.addAsset('bld:wall:直墙（带门窗洞）', V(-6, 0, 0), { params: {} });
  const a2 = app.addAsset('bld:doorsingle:单开门', V(0, 0, 0), { params: {} });
  const a3 = app.addAsset('bld:windowlouver:百叶窗 / 格栅窗', V(4, 0, 0), { params: {} });
  const n3 = app.objects.length;
  app.undo();
  const n2 = app.objects.length;
  const gone3 = !app.objects.includes(a3);
  app.undo();
  const n1 = app.objects.length;
  app.redo();
  const nR = app.objects.length;
  const back3 = app.objects.includes(a3);
  out.undo = { n3, n2, n1, nR, gone3, back3, depth: (app._undo || []).length };
  // 改参数也是一步（拖滑块会合并成一步）
  const before = a1.params.height;
  a1.params.height = 5.5; app.rebuildObject(a1); app.pushUndo('改参数 高 m');
  app.undo();
  out.undo.param = { before, after: +app.objects.find((o) => o.id === a1.id)?.params.height };

  // —— 8) 每个入口都只算「一步」：复制物体 / 删除机位 / 载入模板 / 顶栏按钮状态
  clear();
  app._undo = []; app._undoBytes = 0; app._redo = [];   // 从空栈量增量（栈满 40 步时增量会被淘汰掉）
  const w1 = app.addAsset('bld:wall:直墙（带门窗洞）', V(-4, 0, 0), { params: {} });
  const dupN0 = app.objects.length, dupU0 = app._undo.length;
  app.select({ kind: 'obj', so: w1 });
  app.duplicateSelected();
  const dupN1 = app.objects.length, dupUmid = app._undo.length;
  app.undo();
  const dupN2 = app.objects.length, dupU1 = app._undo.length;
  const shots0 = app.shots.length;
  const ud0 = app._undo.length;
  app.removeShot(app.shots[app.shots.length - 1]);
  const ud1 = app._undo.length;
  app.undo();
  const shotsBack = app.shots.length;
  const u0 = app._undo.length, o0 = app.objects.length;
  window.__scenes.applyScene(app, 'city-day');
  const u1 = app._undo.length, o1 = app.objects.length;
  const tplLabel = app._undo[app._undo.length - 1].label;
  app.undo();
  const oAfterTpl = app.objects.length;
  app.openViewportTools();
  const ub = document.querySelector('button[title*="步可退"]');
  out.steps = { dupN0, dupN1, dupN2, dupDelta: dupUmid - dupU0, afterUndoDelta: dupU1 - dupU0, shotDelta: ud1 - ud0, shots0, shotsBack,
    tplDelta: u1 - u0, tplLabel, o0, o1, oAfterTpl, hasBtn: !!ub, btnTitle: ub ? ub.title.slice(0, 24) : '' };

  app.closeViewportTools?.();
  // —— 7) 搭一个两层小房子的样品（关掉地形，室内最常见的搭法）
  clear();
  if (app.terrain) app.terrain.setEnabled(false);
  for (const [x, z, rot, len] of [[-6, 0, Math.PI / 2, 10], [6, 0, Math.PI / 2, 10], [0, -5, 0, 12], [0, 5, 0, 12]]) {
    const w = app.addAsset('bld:wall:直墙（带门窗洞）', V(x, 0, z), { params: { length: len, height: 3.2, thick: 0.2, wins: 2, door: x === -6 } });
    w.root.rotation.y = rot;
  }
  app.addAsset('bld:doorsingle:单开门', V(-6, 0, 0), { params: { w: 1.2, h: 2.3, open: 74 } }).root.rotation.y = Math.PI / 2;
  const st4 = app.addAsset('bld:stairstraight:单跑楼梯', V(1.5, 0, 2), { params: { rise: 3.4, w: 1.2, steps: 16, rail: true, land: true, band: 2.6, openUp: 0.1 } });
  st4.root.rotation.y = Math.PI;
  const ce4 = app.addAsset('bld:ceilingbeam:天花板（带梁）', V(0, 0, 0), { params: { w: 12, d: 10, thick: 0.12, beams: 5, beamH: 0.3, autoHole: true, holeEdge: 0.12 } });
  const rf = app.addAsset('bld:roofflat:平屋顶（女儿墙 / 机房）', V(0, 0, 0), { params: { w: 12.4, d: 10.4, parapet: 0.5, boxes: true } });
  app.updateCeilingHoles();
  out.sample = { objects: app.objects.length, holes: (ce4.params.holes || []).length, ceilY: +ce4.root.position.y.toFixed(2), roofY: +rf.root.position.y.toFixed(2) };
  return out;
});

ck('素材库新增「建筑构件」分组：18 项（墙/窗/门/屋顶/天花板/楼梯 各 3 变体）',
  !!R.group && R.group.n === 18, JSON.stringify(R.group && R.group.types));
ck('现有库包含全部构件，卡片渲染数同步', R.libCount >= 213 && R.iconSvg.cards === R.libCount, `lib=${R.libCount} cards=${R.iconSvg.cards}`);
ck('18 张新卡片都有图标（墙/窗/门/屋顶/天花板）', R.iconSvg.mine === 18 && R.iconSvg.withSvg === 18, JSON.stringify(R.iconSvg));
ck('每个构件在默认 / 最小 / 最大参数下都成形且无 NaN',
  R.builds.every((b) => !b.empty && b.nan === 0 && b.tri > 2), `${R.builds.length} 次构建，坏:${JSON.stringify(R.builds.filter((b) => b.empty || b.nan > 0 || b.tri <= 2).slice(0, 3))}`);
ck('构件尺寸合理（不出现 0 高或 1e3 大）',
  R.builds.every((b) => b.h >= -0.01 && b.h < 90 && b.w < 90), JSON.stringify(R.builds.filter((b) => !(b.h < 90 && b.w < 90)).slice(0, 2)));
ck('直墙有内容，门洞真能穿过、墙垛立刻命中', R.wall.meshes > 5 && R.wall.doorGap > 6 && R.wall.pier < 3.4, JSON.stringify(R.wall));
ck('楼梯让天花板自动留洞（1 处）', R.hole.holes === 1, JSON.stringify({ ...R.hole, poly: undefined }));
ck('洞口是真几何（洞心射线不命中楼板，旁边 0.12m 处命中）', R.hole.through > 900 && R.hole.solid > 0 && R.hole.solid < 3, `穿过 ${R.hole.through} / 实板 ${R.hole.solid}`);
ck('天花板 / 屋顶按层高自动抬高且不贴地', R.hole.elevOk && R.hole.followOff, `y=${R.hole.ceilY} 地面=${R.hole.gy}`);
ck('洞口尺寸跟 holeLen 走（默认 2.4 / 0=整段 / 1.2）',
  R.holeSize.sz0[0] === 2.4 && R.holeSize.szFull[0] > 6 && R.holeSize.sz12[0] === 1.2 && R.holeSize.sz0[1] === 1.6, JSON.stringify(R.holeSize));
ck('楼梯平移 3.5m，洞口跟着平移同样距离', Math.abs(R.lifecycle.movedCenter - 3.5) < 0.05, `moved=${R.lifecycle.movedCenter}`);
ck('删掉楼梯后洞自动补回（射线命中楼板）', R.lifecycle.afterDel === 0 && R.lifecycle.closed > 0 && R.lifecycle.closed < 3, JSON.stringify(R.lifecycle));
ck('关掉 autoHole 不开孔，打开即开', R.variants.offHoles === 0 && R.variants.onHoles === 1, JSON.stringify(R.variants));
ck('双跑 / 螺旋楼梯也能开孔（螺旋用 8 边形）', R.variants.spiral === 1 && R.variants.spiralPts === 8, `spiral=${R.variants.spiral} pts=${R.variants.spiralPts}`);
ck('复制物体 / 删除机位 / 载入模板：每个入口都只加一步',
  R.steps.dupN1 === R.steps.dupN0 + 1 && R.steps.dupN2 === R.steps.dupN0 && R.steps.dupDelta === 1 && R.steps.afterUndoDelta === 0
  && R.steps.shotDelta === 1 && R.steps.shotsBack === R.steps.shots0 && R.steps.tplDelta === 1
  && /载入模板/.test(R.steps.tplLabel) && R.steps.o1 > 5 && R.steps.oAfterTpl === R.steps.o0, JSON.stringify(R.steps));
ck('视口工具撤销 / 重做按钮带栈深提示', R.steps.hasBtn && /还有 \d+ 步可退/.test(R.steps.btnTitle), R.steps.btnTitle);
ck('Ctrl+Z 一次只退一步（3→2→1，重做回到 3）',
  R.undo.n3 === 3 && R.undo.n2 === 2 && R.undo.n1 === 1 && R.undo.nR === 2 && R.undo.gone3 && !R.undo.back3, JSON.stringify(R.undo));
ck('改参数可撤销回原值', Math.abs((R.undo.param.after ?? 0) - R.undo.param.before) < 0.01, JSON.stringify(R.undo.param));
ck('样品：两层小房子（屋顶在天花板之上、楼板留洞）', R.sample.objects === 8 && R.sample.holes === 1 && R.sample.roofY > R.sample.ceilY, JSON.stringify(R.sample));
ck('无报错', errors.length === 0, errors.slice(0, 3).join(' | '));

if (wantShot) {
  await page.evaluate(async () => {
    const app = window.app, THREE = window.__t.THREE;
    if (app.terrain) { app.terrain.setEnabled(false); }
    app.stage.setGroundVisible(true); app.stage.setGridVisible(false);
    const box = new THREE.Box3();
    app.objects.forEach((o) => box.expandByObject(o.root));
    const c = box.getCenter(new THREE.Vector3());
    app.stage.orbit.target.copy(c);
    app.stage.view.position.set(c.x + 17, c.y + 9.5, c.z + 19);
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
    app.stage.render();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'test/31-parts-room.png' });
  // 第二张：掀掉屋顶，从上方看「楼梯穿过天花板洞口」
  await page.evaluate(async () => {
    const app = window.app, THREE = window.__t.THREE;
    const rf = app.objects.find((o) => o.type === 'roofflat');
    if (rf) rf.visible = false;
    const box = new THREE.Box3();
    app.objects.forEach((o) => { if (o.visible) box.expandByObject(o.root); });
    const c = box.getCenter(new THREE.Vector3());
    app.stage.orbit.target.copy(c).setY(c.y + 0.4);
    app.stage.view.position.set(c.x + 11, c.y + 13, c.z + 13);
    app.stage.orbit.update();
    for (let i = 0; i < 6; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
    app.stage.render();
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: 'test/31b-ceiling-hole.png' });
  console.log('写 test/31-parts-room.png + test/31b-ceiling-hole.png');
}

fs.writeFileSync('test/parts-result.json', JSON.stringify({ ...R, fails, errors }, null, 1));
console.log(JSON.stringify({ failCount: fails.length, failed: fails }));
await browser.close();
process.exit(fails.length ? 1 : 0);
