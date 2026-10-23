import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
p.on('pageerror', (e) => console.log('PAGEERR', String(e.message || e).split('\n')[0]));
await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
const info = await p.evaluate(async () => {
  const app = window.app;
  const rb = app.roadBrush;
  rb.roadWidth = 8;
  rb.start();                       // 不开倒角：直角折线
  rb.addPoint(-55, 0, 40);
  rb.addPoint(25, 0, 40);
  rb.addPoint(25, 0, -35);
  const mesh = rb.finish();
  app.stage.view.position.set(52, 16, 62);
  app.stage.orbit.target.set(24, 0, 38);
  app.stage.view.fov = 46; app.stage.view.updateProjectionMatrix(); app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();
  return { children: mesh ? mesh.children.length : -1 };
});
console.log(JSON.stringify(info));
const rect = await p.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await p.screenshot({ path: 'test/out/chk-sharp-L.png', clip: rect });
await b.close(); console.log('DONE');
