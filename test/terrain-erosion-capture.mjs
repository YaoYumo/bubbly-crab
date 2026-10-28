// Optional visual evidence capture (not part of the timed regression suite).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.shots', { recursive: true });
const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1100 });
  await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.app?.terrain?.workflow && window.__previzBooted, { timeout: 90000 });
  await p.click('[data-page="scene"]'); await p.$$eval('#inspector-scene .itab', bs => bs.find(b => b.textContent === '地形').click());
  await p.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow; a.suspended = true; a._quietAdd = true; a.clearAll(); t.setWater(false); t.setResolution(129); t.generate('ridge', 32, 12345);
    a.lighting.setMode('physical'); a.lighting.physical.configure({ source: 'manual', sunElev: 40, shadows: false, fog: 0, whiteBalance: 6500 });
    a.stage.renderer.setPixelRatio(.75); w.frameTerrain(); w.erosionPreset('rocky'); w.configureErosion({ drops: 8000, iterations: 12, protectObjects: false, maxChange: 3 });
    a.terrainUI.tab = 'erosion'; a.bus.emit('terrain-workflow'); await w.previewErosion();
  });
  for (const view of ['result', 'delta', 'mask']) {
    await p.evaluate(view => { app.terrain.workflow.showErosionPreview(view); app.stage.render(); }, view);
    await p.screenshot({ path: `.shots/terrain-erosion-preview-${view}.png` });
  }
  const stats = await p.evaluate(() => app.terrain.workflow.erosionPreview.result.stats); writeFileSync('.shots/terrain-erosion-capture.json', JSON.stringify(stats, null, 2));
  console.log(JSON.stringify({ pass: true, grid: 129, stats }, null, 2));
} finally { await b.close(); }
