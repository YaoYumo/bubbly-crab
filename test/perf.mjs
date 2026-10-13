// 量：切模板耗时 + 世界节点数（cn 结构补齐后是否变慢的回归口子）
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1560,900','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 900, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push(''+e.message));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 60000 });
const r = await page.evaluate(async () => {
  const app = window.app, out = [];
  const nodes = () => { let n = 0, m = 0; app.stage.world.traverse((o) => { n++; if (o.isMesh) m++; }); return [n, m]; };
  const ids = window.__scenes.SCENES.map(s => s.id);
  for (const id of ids) {
    const t0 = performance.now();
    window.__scenes.applyScene(app, id);
    app.step(1/30);
    const ms = Math.round(performance.now() - t0);
    const [n, m] = nodes();
    out.push({ id, ms, nodes: n, meshes: m });
  }
  return out;
});
console.log(r.map(x => `${x.id.padEnd(22)} ms=${String(x.ms).padStart(5)} nodes=${String(x.nodes).padStart(6)} meshes=${x.meshes}`).join('\n'));
console.log('worst ms', Math.max(...r.map(x=>x.ms)), 'total', r.reduce((a,b)=>a+b.ms,0), 'errors', JSON.stringify(errs.slice(0,3)));
await browser.close();
