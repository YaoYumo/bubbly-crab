import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage();
const warns = new Set();
p.on('console', (m) => { const t = m.text(); const k = t.replace(/^\[previz\] /, ''); if (/不认识的参数/.test(t)) warns.add(k); });
await p.goto('http://localhost:5173/?fresh=1', { waitUntil: 'networkidle2' });
await p.waitForFunction(() => window.__previzBooted && window.app && window.__scenes);
const n = await p.evaluate(async () => {
  const ids = window.__t.SCENES.map((s) => s.id);
  for (const id of ids) { window.__scenes.applyScene(window.app, id); await new Promise((r) => requestAnimationFrame(r)); }
  return ids.length;
});
console.log('scenes:', n);
console.log([...warns].sort().join('\n') || 'NO MISMATCH');
await b.close();
