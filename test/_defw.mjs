import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
const out = await p.evaluate(async () => {
  const app = window.app, rb = app.roadBrush;
  const W = rb.roadWidth;                       // 不动它：默认值
  const draw = (pts) => { rb.start(); for (const [x, z] of pts) rb.addPoint(x, 0, z); rb.finish(); };
  draw([[-80, 0], [80, 0]]);                    // 与默认宽度/类型
  draw([[0, -80], [0, 80]]);                    // 交叉
  const isects = app.objects.filter(o => o.type === 'road_intersection');
  const rep = { defaultWidth: W, type: rb.roadType?.id, junctions: isects.length, parts: [] };
  for (const ij of isects) {
    const lib = ij.root.children.find(c => c.name === 'junction_lib');
    rep.parts.push({ kids: ij.root.children.length, lib: !!lib, names: ij.root.children.map(c => c.name || c.type) });
  }
  app.stage.view.position.set(30, 24, 46);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 46; app.stage.view.updateProjectionMatrix(); app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();
  return rep;
});
console.log(JSON.stringify(out));
const rect = await p.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await p.screenshot({ path: 'test/out/chk-defw-4m.png', clip: rect });
await b.close(); console.log('DONE');
