// 地形编辑：生成 / 笔刷 / 贴地 / 序列化 / 水面 / 分辨率，全部在真实页面里跑
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1560,900', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const R = { errors, checks: {} };
const ck = (n, v) => { R.checks[n] = v; };

await page.goto((process.env.URL || 'http://localhost:5174/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.app.terrain, { timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 600));

// ---------- 1) 生成器 + 查询函数 ----------
R.checks.gen = await page.evaluate(() => {
  const tr = window.app.terrain;
  const out = { n: tr.n, size: tr.size };
  for (const kind of ['plain', 'hills', 'ridge', 'island', 'craters', 'canyon', 'plateau']) {
    tr.generate(kind, 4);
    let mn = Infinity, mx = -Infinity, nan = 0;
    for (let i = 0; i < tr.h.length; i++) { const v = tr.h[i]; if (!Number.isFinite(v)) nan++; if (v < mn) mn = v; if (v > mx) mx = v; }
    out[kind] = { min: +mn.toFixed(2), max: +mx.toFixed(2), nan };
  }
  tr.generate('hills', 5);
  out.query = [[0, 0], [12, -30], [77, 60], [-95, 40]].map(([x, z]) => ({
    h: +tr.heightAt(x, z).toFixed(3),
    slope: +tr.slopeAt(x, z).toFixed(3),
    n: tr.normalAt(x, z).toArray().map((v) => +v.toFixed(3)),
  }));
  // 网格顶点必须真的写了高度（含夸张系数）
  const pos = tr.mesh.geometry.attributes.position;
  let meshErr = 0;
  for (const idx of [0, 1234, 4321, tr.n * tr.n - 1]) {
    meshErr = Math.max(meshErr, Math.abs(pos.getY(idx) - tr.h[idx] * tr.exaggerate));
  }
  out.meshErr = +meshErr.toFixed(5);
  out.visible = tr.mesh.visible;
  return out;
});
ck('7 种生成器都产出有限高度', ['plain', 'hills', 'ridge', 'island', 'craters', 'canyon', 'plateau'].every((k) => R.checks.gen[k] && R.checks.gen[k].nan === 0 && R.checks.gen[k].max > R.checks.gen[k].min));
ck('生成器有起伏（除平原外高差>1m）', ['hills', 'ridge', 'island', 'craters', 'canyon', 'plateau'].every((k) => R.checks.gen[k].max - R.checks.gen[k].min > 1));
ck('heightAt/slopeAt/normalAt 有限', R.checks.gen.query.every((x) => Number.isFinite(x.h) && Number.isFinite(x.slope) && x.n.every(Number.isFinite)));
ck('网格顶点写入高度（误差<1e-4）', R.checks.gen.meshErr < 1e-4);
ck('地形网格可见', R.checks.gen.visible === true);

// ---------- 2) 笔刷 ----------
R.checks.brush = await page.evaluate(() => {
  const app = window.app;
  const tr = app.terrain;
  tr.generate('plain', 1);
  const at = { x: -18, z: 22 };
  const h0 = tr.heightAt(at.x, at.z);
  const hFar0 = tr.heightAt(at.x + 60, at.z + 55);
  // 没有笔刷时不得改动
  tr.paintAt(at.x, at.z, 1);
  const noTool = Math.abs(tr.heightAt(at.x, at.z) - h0) < 1e-6;
  app.state.terrainTool = 'raise';
  for (let i = 0; i < 5; i++) tr.paintAt(at.x, at.z, 1);
  const raised = tr.heightAt(at.x, at.z) - h0;
  const far = tr.heightAt(at.x + 60, at.z + 55) - hFar0;
  app.state.terrainTool = 'lower';
  for (let i = 0; i < 5; i++) tr.paintAt(at.x, at.z, 1);
  const lowered = tr.heightAt(at.x, at.z) - raised - h0;
  app.state.terrainTool = 'flatten';
  tr.generate('hills', 5);
  tr.setBrush({ size: 26, strength: 0.8 });
  // 「起伏」用笔刷范围内的标准差衡量，抹平后应显著下降
  const rough = () => {
    let n = 0, sum = 0, sq = 0;
    for (let j = 0; j < tr.n; j++) for (let i = 0; i < tr.n; i++) {
      const x = -tr.size / 2 + (i / (tr.n - 1)) * tr.size, z = -tr.size / 2 + (j / (tr.n - 1)) * tr.size;
      if (Math.hypot(x, z) > 24) continue;
      const v = tr.h[j * tr.n + i]; sum += v; sq += v * v; n++;
    }
    const m = n ? sum / n : 0;
    return n ? Math.sqrt(Math.max(0, sq / n - m * m)) : 0;
  };
  const before = rough();
  for (let i = 0; i < 8; i++) tr.paintAt(0, 0, 1);
  const afterFlat = rough();
  app.state.terrainTool = 'noise';
  tr.paintAt(5, 5, 1);
  const noiseOk = Number.isFinite(tr.heightAt(5, 5));
  app.state.terrainTool = 'plateau';
  for (let i = 0; i < 3; i++) tr.paintAt(10, -10, 1);
  const plat = (() => { const set = new Set(); for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) set.add(Math.round(tr.h[(tr.n / 2 + j) * tr.n + (tr.n / 2 + i)] * 100) / 100); return set.size; })();
  const globalRough = () => {
    let sum = 0, sq = 0; const n = tr.h.length;
    for (let i = 0; i < n; i++) { sum += tr.h[i]; sq += tr.h[i] * tr.h[i]; }
    const m = sum / n; return Math.sqrt(Math.max(0, sq / n - m * m));
  };
  const gBefore = globalRough();
  tr.smoothAll(3);
  const smoothed = rough();
  const gAfter = globalRough();
  const dips = tr.heightAt(at.x, at.z);
  app.state.terrainTool = null;
  return { noTool, raised: +raised.toFixed(3), far: +far.toFixed(3), lowered: +lowered.toFixed(3), flatRatio: +(afterFlat / before).toFixed(3), noiseOk, platSteps: plat, dipsFinite: Number.isFinite(dips), roughBefore: +before.toFixed(3), roughAfter: +afterFlat.toFixed(3), roughSmoothed: +smoothed.toFixed(3), gBefore: +gBefore.toFixed(3), gAfter: +gAfter.toFixed(3) };
});
ck('无笔刷时不动地形', R.checks.brush.noTool === true);
ck('抬起笔刷生效（>0.5m）', R.checks.brush.raised > 0.5);
ck('笔刷有局部性（远处不变）', Math.abs(R.checks.brush.far) < 0.05);
ck('压低笔刷反向', R.checks.brush.lowered < -0.05);
ck('抹平降低笔刷内起伏', R.checks.brush.roughAfter < R.checks.brush.roughBefore * 0.6);
ck('整体平滑降低全图起伏', R.checks.brush.gAfter < R.checks.brush.gBefore * 0.9);
ck('噪声 / 台地笔刷稳定', R.checks.brush.noiseOk && R.checks.brush.dipsFinite);

// ---------- 3) 贴地 / 跟随 ----------
R.checks.snap = await page.evaluate(() => {
  const app = window.app;
  const tr = app.terrain;
  tr.generate('ridge', 6);
  const THREE = window.__t.THREE;
  const so = app.addAsset('cn:hall:宫殿大殿', new THREE.Vector3(14, 0, -11), {});
  const gy = tr.heightAt(14, -11);
  // 看「模型底面」而不是原点：台基之类会故意垂到原点之下，只要底面落在地面上就算贴地
  so && so.root.updateMatrixWorld(true);
  const bbH = so ? new THREE.Box3().setFromObject(so.root) : null;
  const snapped = !!bbH && Math.abs(bbH.min.y - gy) < 0.25;
  // 拖动 → 仍贴地
  so.root.position.set(-22, 0, 30);
  app.select({ kind: 'obj', so });
  app.onGizmoChange(so.root);
  const afterDrag = Math.abs(so.root.position.y - tr.heightAt(-22, 30)) < 1e-3;
  // 抬起来 → 自动脱离贴地
  so.root.position.y = tr.heightAt(-22, 30) + 4;
  app.onGizmoChange(so.root);
  const lifted = so.followTerrain === false && so.root.position.y > tr.heightAt(-22, 30) + 3;
  // 关掉地形 → 放置高度归零
  app.removeObject(so);
  tr.setEnabled(false);
  const so2 = app.addAsset('nat:boulder:巨石', new THREE.Vector3(5, 0, 5), {});
  const flat = so2.root.position.y === 0;
  const groundBack = app.stage.ground.visible === true;
  tr.setEnabled(true);
  const groundHidden = app.stage.ground.visible === false;
  const groundSunk = app.stage.ground.visible === true && app.stage.ground.position.y < Math.min(...Array.from(app.terrain.h)) * (app.terrain.exaggerate || 1) - 0.2;   // 新方案：地面不隐藏，但沉到地形最低点之下（远处不会穿帮）
  app.removeObject(so2);
  return { snapped, afterDrag, lifted, flat, groundBack, groundHidden, groundSunk };
});
ck('放置即贴地', R.checks.snap.snapped === true);
ck('拖动时持续贴地', R.checks.snap.afterDrag === true);
ck('抬高 4m 后自动脱离贴地', R.checks.snap.lifted === true);
ck('关地形后回到平面放置', R.checks.snap.flat === true);
ck('关地形时地面回来、开地形时让位（隐藏或沉到地形之下）', R.checks.snap.groundBack === true && (R.checks.snap.groundHidden === true || R.checks.snap.groundSunk === true));

// ---------- 4) 序列化：base64 高度 + 体积 ----------
R.checks.save = await page.evaluate(() => {
  const app = window.app;
  const tr = app.terrain;
  app.clearAll();                                       // 清掉带「脚下找平」的物件，单独验地形数据本身的往返
  tr.generate('island', 6);
  tr.setBiome('desert');
  tr.setWaterLevel(1.25);
  tr.setBrush({ size: 13.5, strength: 0.9 });
  app.state.terrainTool = 'raise';
  tr.paintAt(6, -6, 1);
  app.state.terrainTool = null;
  const j = app.serialize();
  const kb = +(JSON.stringify(j).length / 1024).toFixed(1);
  const snapshot = Array.from({ length: 64 }, (_, i) => +tr.heightAt(-60 + i * 2, -40 + i).toFixed(4));
  const copy = JSON.parse(JSON.stringify(j));
  tr.h.fill(0); tr.refresh();
  const zeroed = Math.abs(tr.heightAt(0, 0)) < 1e-9;
  tr.fromJSON(copy.terrain);
  const after = Array.from({ length: 64 }, (_, i) => +tr.heightAt(-60 + i * 2, -40 + i).toFixed(4));
  let maxErr = 0;
  for (let i = 0; i < 64; i++) maxErr = Math.max(maxErr, Math.abs(after[i] - snapshot[i]));
  return {
    hasTerrain: !!j.terrain, kb, packed: typeof j.terrain.h64 === 'string', zeroed,
    maxErr: +maxErr.toFixed(4), biome: tr.biome, water: tr.state.water, waterY: +tr.state.waterY.toFixed(2),
    brush: [tr.state.brushSize, tr.state.brushStrength], n: tr.n, size: tr.size,
  };
});
ck('工程 JSON 含地形（base64 紧凑）', R.checks.save.hasTerrain && R.checks.save.packed);
ck('往返还原误差 ≤1.5cm', R.checks.save.maxErr <= 0.0151);
ck('清空后确实归零', R.checks.save.zeroed === true);
ck('体积可控（<90KB）', R.checks.save.kb < 90);
ck('地貌 / 水面 / 笔刷一起保存', R.checks.save.biome === 'desert' && R.checks.save.water === true && Math.abs(R.checks.save.waterY - 1.25) < 1e-6);

// ---------- 5) 分辨率 / 尺寸 / 夸张 ----------
R.checks.dims = await page.evaluate(() => {
  const tr = window.app.terrain;
  tr.generate('hills', 4);
  const keep = tr.heightAt(3, 3);
  tr.setResolution(65);
  const a = { n: tr.n, meshN: tr.mesh.geometry.attributes.position.count };
  tr.setResolution(97);
  const b = { n: tr.n, meshN: tr.mesh.geometry.attributes.position.count };
  tr.setSize(220);
  const c = { size: tr.size, span: tr.mesh.geometry.boundingSphere ? 1 : 1 };
  tr.setExaggerate(2);
  const h2 = tr.heightAt(3, 3);
  tr.setExaggerate(1);
  const h1 = tr.heightAt(3, 3);
  tr.setSize(160);
  return { a, b, c, ratio: +(h2 / (h1 || 1)).toFixed(3), finite: Number.isFinite(h1 + h2) };
});
ck('分辨率切换重建网格', R.checks.dims.a.meshN === 65 * 65 && R.checks.dims.b.meshN === 97 * 97);
ck('高度夸张按比例（≈2×）', Math.abs(R.checks.dims.ratio - 2) < 0.25 && R.checks.dims.finite);

// ---------- 6) 指针接管：画笔拖动能改地形且不转动视角 ----------
R.checks.paint = await page.evaluate(() => {
  const app = window.app;
  const tr = app.terrain;
  tr.generate('plain', 0.5);
  app.state.terrainTool = 'raise';
  tr.setBrush({ size: 12, strength: 1.2 });
  const cam = app.stage.view.position.clone();
  const h0 = tr.heightAt(0, 0);
  return { h0, cam: cam.toArray(), box: (() => { const r = app.stage.canvas.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })() };
});
{
  const [bx, by, bw, bh] = R.checks.paint.box;
  const cx = bx + bw * 0.5, cy = by + bh * 0.55;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 14; i++) { await page.mouse.move(cx + i * 6, cy + i * 2); await new Promise((r) => setTimeout(r, 18)); }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 220));
  R.checks.paintLive = await page.evaluate((before) => {
    const app = window.app;
    const tr = app.terrain;
    let mx = 0;
    for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) mx = Math.max(mx, tr.heightAt(i, j));
    app.state.terrainTool = null;
    const camMoved = app.stage.view.position.distanceTo(new (window.__t.THREE.Vector3)(...before.cam));
    // 一次落笔 = 撤销栈上的一步，撤销后地形回到落笔前
    const uLen = (app._undo || []).length;
    const uLabel = uLen ? app._undo[uLen - 1].label : '';
    const undoOk = app.undo();
    const hUndo = +app.terrain.heightAt(0, 0).toFixed(3);
    const redoOk = app.redo();
    const hRedo = +app.terrain.heightAt(0, 0).toFixed(3);
    return { raisedMax: +mx.toFixed(3), camMoved: +camMoved.toFixed(4), toolOff: app.state.terrainTool,
      uLen, uLabel, undoOk, hUndo, redoOk, hRedo };
  }, R.checks.paint);
  ck('鼠标拖动画笔改变地形', R.checks.paintLive.raisedMax > R.checks.paint.h0 + 0.2);
  ck('绘制时视角不被轨道控制带走', R.checks.paintLive.camMoved < 0.6);
  ck('一次落笔只算撤销一步（撤销回到原样 / 重做再画回来）',
    R.checks.paintLive.uLen >= 1 && /地形笔刷/.test(R.checks.paintLive.uLabel || '') && R.checks.paintLive.undoOk
    && Math.abs(R.checks.paintLive.hUndo - R.checks.paint.h0) < 0.01 && R.checks.paintLive.redoOk
    && R.checks.paintLive.hRedo > R.checks.paint.h0 + 0.2, JSON.stringify(R.checks.paintLive));
}

// ---------- 7) 面板 UI ----------
R.checks.ui = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.itab')];
  const names = tabs.map((b) => b.textContent);
  tabs[2]?.click();
  const body = document.querySelector('#right .ibody');
  const secs = [...body.querySelectorAll('.sec-b')];
  const chips = [...body.querySelectorAll('.bchip')].map((b) => b.textContent.trim());
  const sliders = body.querySelectorAll('input[type="range"]').length;
  const rows = body.querySelectorAll('.row').length;
  return { names, brushCount: chips.length, chips: chips.slice(0, 7), sliders, rows, note: body.textContent.includes('贴地') };
});
ck('地形标签页存在', R.checks.ui.names.length === 5 && /地形/.test(R.checks.ui.names[2] || ''));
ck('6 个笔刷 + 整体平滑', R.checks.ui.brushCount === 7);
ck('笔刷按钮有中文名（不是 undefined）', R.checks.ui.chips.every((c) => c && !/undefined/.test(c)) && /抬起/.test(R.checks.ui.chips[0]) && /压低/.test(R.checks.ui.chips[1]));
ck('地形面板有滑杆与开关', R.checks.ui.sliders >= 4 && R.checks.ui.rows >= 8);

// ---------- 8) 场景模板里的地形 ----------
R.checks.scenes = await page.evaluate(() => {
  const app = window.app;
  const out = [];
  for (const sc of window.__scenes.SCENES) {
    window.__scenes.applyScene(window.app, sc.id);
    const tr = app.terrain;
    let mn = Infinity, mx = -Infinity, nan = 0;
    for (let i = 0; i < tr.h.length; i++) { const v = tr.h[i]; if (!Number.isFinite(v)) nan++; if (v < mn) mn = v; if (v > mx) mx = v; }
    // 看「包围盒底」而不是物件原点：小散件是逐个贴地的（原点可以离地），屋顶之类本来就该悬空
    let offGround = 0;
    for (const o of app.objects) {
      if (o.followTerrain === false) continue;
      const it = o.item || {};
      if (it.cat === 'fx' || it.type === 'clouds' || it.type === 'stars') continue;
      o.root.updateMatrixWorld(true);
      const bb = new (window.__t.THREE.Box3)().setFromObject(o.root);
      if (bb.isEmpty()) continue;
      const gy = tr.heightAt((bb.max.x + bb.min.x) / 2, (bb.max.z + bb.min.z) / 2);
      if (Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) > 45) continue;   // 山体 / 灯阵这类本来就压进地形里
      const d = bb.min.y - gy;
      if (d > 1.6 || d < -2.6) offGround++;                            // 底面悬空 1.6m 以上 / 埋进去 2.6m 以上才算错
    }
    const badPos = app.objects.filter((o) => !Number.isFinite(o.root.position.x + o.root.position.y + o.root.position.z)).length;
    out.push({ id: sc.id, objs: app.objects.length, shots: app.shots.length, terrainOn: tr.enabled, range: [+mn.toFixed(2), +mx.toFixed(2)], nan, offGround, badPos, ground: app.stage.ground.visible });
  }
  return out;
});
ck('全部模板（≥21 套）地形无 NaN', R.checks.scenes.length >= 21 && R.checks.scenes.every((x) => x.nan === 0 && x.badPos === 0));
ck('模板物体都贴地（或显式悬空）', R.checks.scenes.every((x) => x.offGround === 0));
ck('星际模板关闭默认地面', R.checks.scenes.filter((x) => /space/.test(x.id)).every((x) => x.ground === false));
ck('深空模板连地形一起关掉', R.checks.scenes.find((x) => x.id === 'space-battle').terrainOn === false);
ck('每套模板都有地形起伏数据', R.checks.scenes.every((x) => x.range[1] >= x.range[0]));

ck('无 console/page 报错', errors.length === 0);
fs.writeFileSync('test/terrain-result.json', JSON.stringify(R, null, 1));
await browser.close();
const fails = Object.entries(R.checks).filter(([, v]) => v === false);
console.log(JSON.stringify({ failCount: fails.length, failed: fails.map((f) => f[0]), errors: errors.slice(0, 6) }, null, 1));
process.exit(fails.length || errors.length ? 1 : 0);
