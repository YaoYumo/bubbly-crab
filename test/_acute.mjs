// 三角度复现：80°(近直角/LIB) 60° 30°(锐角/程序化) —— 计数 + 顶视/斜视截图 + 关键点像素采样
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.app && window.app.stage && window.app.stage.renderer, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 600));

const ANGLES = [80, 60, 30];
const all = {};

for (const ang of ANGLES) {
  const rad = (ang * Math.PI) / 180;
  const dx = Math.cos(rad), dz = Math.sin(rad);
  const R = 45;
  const data = await page.evaluate(async (dx, dz, R) => {
    const app = window.app, rb = app.roadBrush;
    const THREE = window.__t.THREE;
    app.clearAll();
    rb.restore([
      { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'A' },
      { points: [[-R * dx, 0, -R * dz], [R * dx, 0, R * dz]], roadType: 'asphalt', width: 12, fillet: false, name: 'B' },
    ]);
    const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
    const ij = app.objects.filter((o) => o.type === 'road_intersection');
    const info = ij.map((j) => {
      const w = walk(j.root, []);
      const cnt = (nm) => w.filter((x) => x === nm).length;
      return { lib: w.includes('junction_lib'), patch: w.includes('intersection_patch'), pads: cnt('junction_pad'), walls: cnt('junction_padwall'), stripes: cnt('crosswalk_stripe'), stop: cnt('stop_line') };
    });
    // 找斜交口的 patch/pads 的 bbox 与屏幕投影辅助
    const ij0 = ij[0];
    const patch = ij0?.root?.children.find((c) => c.name === 'intersection_patch');
    const pads = [];
    ij0?.root?.traverse((n) => { if (n.name === 'junction_pad') { const b = new THREE.Box3().setFromObject(n); pads.push({ cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, y: b.max.y }); } });
    return { info, pads, hasIj: ij.length };
  }, dx, dz, R);

  // 顶视
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
  const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await page.screenshot({ path: `test/out/chk-ang${ang}-top.png`, clip: rect });

  // 采样：patch 中心、各 pad 中心（顶视下投影）
  const px = await page.evaluate((pads) => {
    const app = window.app, THREE = window.__t.THREE;
    const gl = app.stage.renderer.getContext();
    const db = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
    const rd = (u, v) => { const p = new Uint8Array(4); gl.readPixels(Math.round(db * u), Math.round(dbh * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [p[0], p[1], p[2]]; };
    const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(app.stage.view); return [(v.x + 1) / 2, (v.y + 1) / 2]; };
    const out = { patch: rd(...proj(0, 0.1, 0)) };
    pads.forEach((p, i) => { out['pad' + i] = { at: [+p.cx.toFixed(1), +p.cz.toFixed(1)], px: rd(...proj(p.cx, p.y, p.cz)) }; });
    return out;
  }, data.pads);
  await page.screenshot({ path: `test/out/chk-ang${ang}-top.png`, clip: rect });

  // 斜视（低机位 3/4 视角）
  await page.evaluate(() => {
    const app = window.app;
    app.stage.view.position.set(26, 14, 30);
    app.stage.orbit.target.set(0, 1, 0);
    app.stage.view.fov = 46;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
    app.stage.render();
  });
  await page.screenshot({ path: `test/out/chk-ang${ang}-side.png`, clip: rect });

  all[ang] = { info: data.info, px };
}
console.log(JSON.stringify({ ...all, errs }, null, 1));
await browser.close();
