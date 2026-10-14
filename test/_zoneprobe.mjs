// 街坊功能分区视觉探针（Task 24）：先路网 → 划分街坊 → 按区域功能填充建筑
// 运行：bash test/withchrome.sh node test/_zoneprobe.mjs
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
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|Vite/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 160)); });

await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await p.evaluate(() => {
  const app = window.app;
  window.__shot = (px, py, pz, tx, ty, tz, fov) => {
    app.stage.view.position.set(px, py, pz);
    app.stage.orbit.target.set(tx, ty, tz);
    app.stage.view.fov = fov;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
  };
});

const CASES = [
  ['cn-axis', { theme: 'chinese', roadTopology: 'axis', seed: 11, mapSize: 256, zoning: { commercialRatio: 0.5 } }, [0, 205, 165, 0, 0, 0, 46]],
  ['pure-res', { theme: 'chinese', roadTopology: 'ring', seed: 5, mapSize: 256, zoning: { commercialRatio: 0 } }, [0, 205, 165, 0, 0, 0, 46]],
  ['fusion-grid', { theme: 'fusion', roadTopology: 'grid', seed: 7, mapSize: 256, zoning: { commercialRatio: 0.3 } }, [0, 205, 165, 0, 0, 0, 46]],
  ['junction-close', { theme: 'chinese', roadTopology: 'axis', seed: 11, mapSize: 256, zoning: { commercialRatio: 0.5 } }, [14, 11, 34, 0, 0.5, 2, 44]],
];

const ONLY = process.argv[2] || '';
for (const [name, schema, cam] of CASES.filter((c) => !ONLY || c[0].includes(ONLY))) {
  const stats = await p.evaluate(async (sch, c) => {
    const app = window.app;
    const { generateTown } = await import('/src/townbuild.js');
    const f = generateTown(app, sch);
    app.objects.forEach((o) => {                       // 关云便于看清路口（仅本探针）
      if (/cloud|云/i.test(`${o.key || ''} ${o.name || ''} ${o.type || ''}`)) { o.visible = false; o.root.visible = false; }
    });
    window.__shot(...c);
    const keys = app.objects.filter((o) => o.key).map((o) => o.key);
    const count = (pref) => keys.filter((k) => k.startsWith(pref)).length;
    return {
      houses: f.houses, driveways: f.driveways, ms: f.ms,
      cnHall: count('cn:hall'), cnCourtyard: count('cn:courtyard'),
      streetshop: count('cn:streetshop'), drumtower: count('cn:drumtower'),
      pagoda: count('cn:pagoda'), paifang: count('cn:paifang'),
      houseW: keys.filter((k) => k.startsWith('house:') || k.startsWith('suburban:')).length,
      total: keys.length,
    };
  }, schema, cam);
  console.log(name, JSON.stringify(stats));
  await new Promise((r) => setTimeout(r, 1500));
  const rect = await p.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await p.screenshot({ path: `test/out/chk-zone-${name}.png`, clip: rect });
  console.log('shot', name);
}

await b.close();
console.log('DONE');
