// 「构件 · 两层小楼」模板：墙门窗对齐 + 两块楼板的楼梯洞口 + 截图
// 运行：node test/house.mjs        （默认就带截图，图很便宜）
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5174/';
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 850, deviceScaleFactor: 1.25 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|DevTools/.test(t)) errors.push('console: ' + t.split('\n')[0]); if (/不认识的参数|未识别库项/.test(t)) errors.push('WARN: ' + t.split('\n')[0].slice(0, 120)); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 180000 });

const R = await page.evaluate(async () => {
  const app = window.app, THREE = window.__t.THREE;
  const ok = window.__t.applyScene ? window.__t.applyScene(app, 'bld-townhouse') : (window.__scenes && window.__scenes.applyScene(app, 'bld-townhouse'));
  for (let i = 0; i < 6; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
  app.updateCeilingHoles();
  const out = { applied: !!ok, rep: { ...(app.sceneReport || {}) } };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ray = new THREE.Raycaster();
  const first = (root, from, dir) => { ray.set(from, dir.normalize()); const h = ray.intersectObject(root, true); return h.length ? +h[0].distance.toFixed(2) : 999; };

  const ceil = app.objects.filter((o) => o.root && o.root.userData.ceiling);
  const stairs = app.objects.filter((o) => o.root && o.root.userData.stairOpen);
  out.counts = { objs: app.objects.length, shots: app.shots.length, ceil: ceil.length, stairs: stairs.length };
  out.holes = ceil.map((c) => ({ n: c.name, y: +c.root.position.y.toFixed(2), k: (c.params.holes || []).length }));
  // 每块楼板的洞：从洞心向上打一条射线，楼板本身不该挡住（说明真的挖穿了）
  out.thru = ceil.map((c) => {
    const h = (c.params.holes || [])[0];
    if (!h || !h.length) return null;
    let x = 0, z = 0;
    for (const q of h) { x += q[0] / h.length; z += q[1] / h.length; }
    c.root.updateMatrixWorld(true);
    const p = new THREE.Vector3(x, 1.4, z).applyMatrix4(c.root.matrixWorld);
    // 从上往下打：洞心应一路穿过（>3m 才可能命中地面 / 下层），旁边 1.6m 处应立刻命中板面
    return { thru: first(c.root, p, V(0, -1, 0)), solid: first(c.root, V(p.x, p.y, p.z + 1.6), V(0, -1, 0)) };
  });
  // 楼梯顶 = 楼板面（3.4 / 6.8），说明「走得上去」
  out.tops = stairs.map((s) => {
    const o = s.root.userData.stairOpen;
    return { n: s.name, top: +((o.y || 0) * (s.root.scale.y || 1) + s.root.position.y).toFixed(2) };
  });
  // 门 / 窗与墙洞对齐：门口水平射线应一路穿过（>8m），实墙处应在 0.3m 内命中
  const frontWall = app.objects.find((o) => o.type === 'wall' && Math.abs(o.root.position.z - 5) < 0.01 && Math.abs(o.root.position.x) < 0.01);
  const backWall = app.objects.find((o) => o.type === 'wallcorner');
  out.doorAlign = frontWall ? { atDoor: first(frontWall.root, V(-4.67, 1.15, 12), V(0, 0, -1)), atPier: first(frontWall.root, V(-1.6, 1.15, 12), V(0, 0, -1)) } : null;
  out.winAlign = (() => {
    const w = app.objects.find((o) => o.type === 'windowslider' && Math.abs(o.root.position.x) < 0.01 && Math.abs(o.root.position.z - 5) < 0.01);
    return w ? { frames: (() => { let n = 0; w.root.traverse((c) => { if (c.isMesh) n++; }); return n; })(), near: first(w.root, V(0, 1.6, 6.2), V(0, 0, -1)) } : null;
  })();
  out.bbox = (() => { const b = new THREE.Box3(); app.objects.forEach((o) => b.expandByObject(o.root)); const s = b.getSize(V(0, 0, 0)); return s.toArray().map((v) => +v.toFixed(1)); })();
  out.groundBad = app.objects.filter((o) => o.root && !Number.isFinite(o.root.position.y + o.root.position.x)).length;
  return out;
});

ck('模板载入成功、没有未识别库项', R.applied && !R.rep.missing, JSON.stringify(R.rep));
ck('物体 / 机位数正确（36 物体 · 4 机位）', R.counts.objs === 36 && R.counts.shots === 4, JSON.stringify(R.counts));
ck('两层楼板各被开 1 个楼梯洞', R.holes.length === 2 && R.holes.every((h) => h.k === 1), JSON.stringify(R.holes));
ck('洞口是挖穿的（洞心一路穿到下层，旁边 1.6m 处立刻命中板面）', R.thru.every((t) => t && t.thru > 3 && t.solid > 1.1 && t.solid < 1.7), JSON.stringify(R.thru));
ck('楼梯顶正好接到楼板面（3.4 / 6.8）', R.tops.length === 2 && R.tops.every((t, i) => Math.abs(t.top - [3.4, 6.8][i]) < 0.02), JSON.stringify(R.tops));
ck('门与墙上的门洞对齐（门口一路穿进屋内，墙垛处 7m 外即命中）', R.doorAlign && R.doorAlign.atDoor > 8 && R.doorAlign.atPier > 6 && R.doorAlign.atPier < 7.9, JSON.stringify(R.doorAlign));
ck('窗框摆在窗洞里', R.winAlign && R.winAlign.frames >= 4 && R.winAlign.near > 0.4, JSON.stringify(R.winAlign));
ck('整栋楼尺寸合理（宽 14~15 · 高 ≤9.3 含屋面机房 · 深 ≤12.2 含外开门扇）', R.bbox[0] > 13.8 && R.bbox[0] < 15.2 && R.bbox[1] > 7.4 && R.bbox[1] < 9.3 && R.bbox[2] > 10 && R.bbox[2] < 12.2, JSON.stringify(R.bbox));
ck('没有 NaN / 报错', R.groundBad === 0 && errors.length === 0, errors.slice(0, 2).join(' | '));

// —— 截图：① 门口看进去（洞口 + 楼梯）② 从洞口俯瞰 ③ 外立面
for (const [file, pos, tgt, cut] of [
  ['40-house-door.png', [-8.2, 3.2, 24], [1.2, 2.8, -1.2], false],
  ['41-house-cutaway.png', [17, 21, 20], [0, 3.2, 0], true],
  ['42-house-facade.png', [19.5, 8.2, 22], [0, 3.6, 0], false],
]) {
  await page.evaluate(async (pos, tgt, file, cut) => {
    const app = window.app, THREE = window.__t.THREE;
    app.state.showHelpers = false;
    for (const o of app.objects) { const hide = cut && o.type === 'roofflat'; o.visible = !hide; o.root.visible = !hide; }   // 剖切：掀掉屋顶看两块楼板的洞口
    for (const o of app.objects) if (o.root) o.root.updateMatrixWorld(true);
    app.stage.setGridVisible(false);
    app.stage.orbit.target.fromArray(tgt);
    app.stage.view.position.fromArray(pos);
    app.stage.view.fov = 30;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    app.step(1 / 60);
    await new Promise((r) => requestAnimationFrame(r));
    app.stage.render();
  }, pos, tgt, file, cut);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `test/${file}` });
  console.log('写 test/' + file);
}

fs.writeFileSync('test/house-result.json', JSON.stringify({ ...R, fails, errors }, null, 1));
console.log(JSON.stringify({ failCount: fails.length, failed: fails }));
await browser.close();
process.exit(fails.length ? 1 : 0);
