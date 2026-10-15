// 验收复核：30°/45°/90° 嘴部出图 + 横向像素扫描（水色缝）+ 斑马带 vs 路件端面
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

for (const ang of [90, 45, 30]) {
  const rad = (ang * Math.PI) / 180;
  const dx = Math.cos(rad), dz = Math.sin(rad);
  const R = 100;
  const data = await page.evaluate(async (dx, dz, R) => {
    const app = window.app, rb = app.roadBrush;
    app.clearAll();
    rb.restore([
      { points: [[-140, 0, 0], [140, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'A' },
      { points: [[-R * dx, 0, -R * dz], [R * dx, 0, R * dz]], roadType: 'asphalt', width: 12, fillet: false, name: 'B' },
    ]);
    const gaps = rb._roads.map((r) => (r.gaps || []).map((g) => [+g.t0.toFixed(3), +g.t1.toFixed(3)]));
    return { gaps };
  }, dx, dz, R);

  // —— 横向全臂扫描（y=0.13 路面下方平面，避免共面假阴性）：水色命中
  const scan = await page.evaluate((ANG) => {
    const app = window.app, THREE = window.__t.THREE;
    const plan = app.objects.find(o => o.type === 'road_intersection')._isect.plan;
    app.stage.view.position.set(0, Math.max(70, Math.max(...plan.arms.map(a => a.c))*3.5), 0.01);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.view.fov = 50;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
    app.stage.render();
    const gl = app.stage.renderer.getContext();
    const db = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
    const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(app.stage.view); return [(v.x + 1) / 2, (v.y + 1) / 2]; };
    const rd = (u, v) => { const p = new Uint8Array(4); gl.readPixels(Math.round(db * u), Math.round(dbh * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [p[0], p[1], p[2]]; };
    const isWater = (r, g, b) => g > 120 && b > 110 && g > r + 40;
    const hits = [];
    // 四臂：沿实际出口断面 ±3m、横向 −7.5..7.5 步 0.5（臂向量按注入角度算，勿写死）
    const rad = (ANG * Math.PI) / 180;
    const arms = [[1, 0], [-1, 0], [Math.cos(rad), Math.sin(rad)], [-Math.cos(rad), -Math.sin(rad)]];
    for (const [ax, az] of arms) {
      const px = az, pz = -ax; // 横向
      const mouth = Math.max(...plan.arms.filter(a => Math.abs(a.dir.x*ax + a.dir.z*az) > .9999).map(a => a.c));
      for (let t = mouth - 3; t <= mouth + 3.5; t += 0.35) {
        for (let o = -7.5; o <= 7.5; o += 0.5) {
          const [u, v] = proj(ax * t + px * o, 0.13, az * t + pz * o);
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          const [r, g, b] = rd(u, v);
          if (isWater(r, g, b)) hits.push([+t.toFixed(2), +o.toFixed(1), r, g, b]);
        }
      }
    }
    return { hits: hits.slice(0, 12), n: hits.length };
  }, ang);

  // —— 低机位嘴部出图（正对 +x 嘴）
  await page.evaluate(() => {
    const app = window.app;
    const plan = app.objects.find(o => o.type === 'road_intersection')._isect.plan;
    const mouth = plan.arms.find(a => a.dir.x > .999).c;
    app.stage.view.position.set(mouth + 11.5, 2.2, 9);
    app.stage.orbit.target.set(mouth - 1, 0, 0);
    app.stage.view.fov = 46;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 6; i++) app.step();
    app.stage.render();
  });
  const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await page.screenshot({ path: `test/out/verify${ang}-mouth.png`, clip: rect });

  if (scan.n) throw new Error(`${ang}: water visible at junction mouth: ${JSON.stringify(scan)}`);
  console.log(ang, JSON.stringify(data.gaps), 'waterHits=', scan.n, JSON.stringify(scan.hits));
}
if (errs.length) throw new Error(JSON.stringify(errs));
console.log('errs=', JSON.stringify(errs));
await browser.close();
