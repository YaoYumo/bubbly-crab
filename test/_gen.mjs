// 重构版路口验收探针：90/80/60/45/30° 双沥青 12m 直路交叉 + T 形 + 编辑重建
// 检查：路口物体计数、生成器子件命名（无 junction_lib 模型整件）、挖洞区间、
// 顶视/斜视截图、中心与臂口像素采样、pageerror 归零。
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.app && window.app.stage && window.app.stage.renderer, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 600));

const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };

const CASES = [90, 80, 60, 45, 30];
const all = {};

for (const ang of CASES) {
  const rad = (ang * Math.PI) / 180;
  const dx = Math.cos(rad), dz = Math.sin(rad);
  const R = 45;
  const data = await page.evaluate(async (dx, dz, R) => {
    const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
    const app = window.app, rb = app.roadBrush;
    app.clearAll();
    rb.restore([
      { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'A' },
      { points: [[-R * dx, 0, -R * dz], [R * dx, 0, R * dz]], roadType: 'asphalt', width: 12, fillet: false, name: 'B' },
    ]);
    const ij = app.objects.filter((o) => o.type === 'road_intersection');
    const rbs = app.objects.filter((o) => o.type === 'road_brush');
    const info = ij.map((j) => {
      const w = walk(j.root, []);
      const cnt = (nm) => w.filter((x) => x === nm).length;
      return {
        lib: w.includes('junction_lib'),                    // 模型整件必须消失
        face: cnt('junction_face'),
        walks: cnt('junction_walk_0') + cnt('junction_walk_1') + cnt('junction_walk_2') + cnt('junction_walk_3'),
        curbs: w.filter((x) => x.startsWith('junction_curb')).length,
        steps: w.filter((x) => x.startsWith('junction_step')).length,
        marks: cnt('junction_markings'),
      };
    });
    const gaps = rb._roads.map((r) => (r.gaps || []).map((g) => [+g.t0.toFixed(3), +g.t1.toFixed(3)]));
    // 路口轮廓包围盒（越界/大黑板检测）
    let bbox = null;
    if (ij[0]) {
      const box = new (window.__t.THREE.Box3)().setFromObject(ij[0].root);
      bbox = [+box.min.x.toFixed(1), +box.min.z.toFixed(1), +box.max.x.toFixed(1), +box.max.z.toFixed(1)];
    }
    return { info, gaps, hasIj: ij.length, roads: rbs.length, bbox };
  }, dx, dz, R);

  // 顶视
  const frameScale = Math.max(1, Math.max(...data.bbox.map(Math.abs)) / 16);
  await page.evaluate((scale) => {
    const app = window.app;
    app.stage.view.position.set(0, 70 * scale, 0.01);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.view.fov = 50;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
    app.stage.render();
  }, frameScale);
  const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await page.screenshot({ path: `test/out/chk-gen${ang}-top.png`, clip: rect });

  // 顶视像素采样：中心（车行面）、两臂口、四角步道
  const px = await page.evaluate(() => {
    const app = window.app, THREE = window.__t.THREE;
    const gl = app.stage.renderer.getContext();
    const db = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
    const rd = (u, v) => { const p = new Uint8Array(4); gl.readPixels(Math.round(db * u), Math.round(dbh * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [p[0], p[1], p[2]]; };
    const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(app.stage.view); return [(v.x + 1) / 2, (v.y + 1) / 2]; };
    return {
      center: rd(...proj(0, 0.1, 0)),
      mouthX: rd(...proj(13.5, 0.1, 0)),
      corner: rd(...proj(7.5, 0.26, 7.5)),
      away: rd(...proj(28, 0.17, 0)),
    };
  });
  await page.screenshot({ path: `test/out/chk-gen${ang}-top.png`, clip: rect });

  // 斜视
  await page.evaluate((scale) => {
    const app = window.app;
    app.stage.view.position.set(26 * scale, 14 * scale, 30 * scale);
    app.stage.orbit.target.set(0, 1, 0);
    app.stage.view.fov = 46;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
    app.stage.render();
  }, frameScale);
  await page.screenshot({ path: `test/out/chk-gen${ang}-side.png`, clip: rect });

  all[ang] = { ...data, px };
}

// T 形：横路 + 竖路（端头落在横路中心）
all.T = await page.evaluate(async () => {
  const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
  const app = window.app, rb = app.roadBrush;
  app.clearAll();
  rb.restore([
    { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'H' },
    { points: [[0, 0, -70], [0, 0, -0.01]], roadType: 'asphalt', width: 12, fillet: false, name: 'S' },
  ]);
  const ij = app.objects.filter((o) => o.type === 'road_intersection');
  const w = ij[0] ? walk(ij[0].root, []) : [];
  let bbox = null;
  if (ij[0]) {
    const box = new (window.__t.THREE.Box3)().setFromObject(ij[0].root);
    bbox = [+box.min.x.toFixed(1), +box.min.z.toFixed(1), +box.max.x.toFixed(1), +box.max.z.toFixed(1)];
  }
  return { hasIj: ij.length, lib: w.includes('junction_lib'), face: w.filter((x) => x === 'junction_face').length, walks: w.filter((x) => x.startsWith('junction_walk')).length, bbox, roads: rb._roads.length };
});
await page.evaluate(() => {
  const app = window.app;
  app.stage.view.position.set(0, 70, 0.01);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 50;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();
  app.stage.render();
});
const rectT = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await page.screenshot({ path: 'test/out/chk-genT-top.png', clip: rectT });

// 编辑重建：接管第一条路、拖一个点、完成 → 路口应重新生成且仍恰好 1 个
all.edit = await page.evaluate(async () => {
  const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
  const app = window.app, rb = app.roadBrush;
  app.clearAll();
  rb.restore([
    { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'A' },
    { points: [[0, 0, -45], [0, 0, 45]], roadType: 'asphalt', width: 12, fillet: false, name: 'B' },
  ]);
  const before = app.objects.filter((o) => o.type === 'road_intersection').length;
  const roadA = app.objects.find((o) => o.type === 'road_brush' && o.name === 'A');
  const ok = rb.editRoad(roadA);
  if (ok) {
    rb.points[1] = rb.points[1].clone().set(70, 0.02, 14);   // 挪终点成斜线
    rb._updatePreview();
    rb.finish();
    app.bus.emit('objects');
    app.markDirty?.();
  }
  const after = app.objects.filter((o) => o.type === 'road_intersection').length;
  const roads = app.objects.filter((o) => o.type === 'road_brush').length;
  const lib = app.objects.some((o) => o.type === 'road_intersection' && walk(o.root, []).includes('junction_lib'));
  return { before, ok, after, roads, lib };
});
await page.evaluate(() => {
  const app = window.app;
  app.stage.view.position.set(0, 70, 0.01);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 50;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();
  app.stage.render();
});
await page.screenshot({ path: 'test/out/chk-genEdit-top.png', clip: rectT });

console.log(JSON.stringify({ ...all, errs }, null, 1));
await browser.close();
