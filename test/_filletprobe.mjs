// 平滑倒角接缝验证：L 形带倒角沥青路（宽 8m），近景拍转角外缘的 V 形缝是否被垫片盖住
import puppeteer from 'puppeteer';
import fs from 'node:fs';
fs.mkdirSync('test/out', { recursive: true });
const URL0 = process.env.URL || 'http://localhost:5174/';
const b = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
p.on('pageerror', (e) => console.log('PAGEERR', (e.message || e).split('\n')[0]));
await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
const info = await p.evaluate(async () => {
  const app = window.app;
  window.__shot = (px, py, pz, tx, ty, tz, fov) => {
    app.stage.view.position.set(px, py, pz);
    app.stage.orbit.target.set(tx, ty, tz);
    app.stage.view.fov = fov;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
  };
  const rb = app.roadBrush;
  rb.roadWidth = 8;
  rb.start();
  rb.addPoint(-50, 0, 30);
  rb.addPoint(40, 0, 30);
  rb.addPoint(40, 0, -35);
  rb.toggleFillet();                       // 平滑倒角开
  const mesh = rb.finish();
  window.__shot(64, 15, 60, 38, 0, 24, 46);
  return { done: !!mesh, children: mesh ? mesh.children.length : -1 };
});
console.log(JSON.stringify(info));
const rect = await p.evaluate(() => {
  const c = document.querySelector('#stage canvas');
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
await p.screenshot({ path: 'test/out/chk-fillet-joint.png', clip: rect });
await b.close();
console.log('DONE');
