// 探针：斜交口完全程序化转角块（four_way_stop 外观）——计数 + 近景水开/关连拍 + 帧缓冲中心像素
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

const out = await page.evaluate(async () => {
  const rb = window.app.roadBrush;
  rb.restore([
    { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: '东西向路' },
    { points: [[-40, 0, -33.6], [40, 0, 33.6]], roadType: 'asphalt', width: 12, fillet: false, name: '斜穿路' },
  ]);
  const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
  const info = window.app.objects.filter((o) => o.type === 'road_intersection').map((j) => {
    const w = walk(j.root, []);
    const cnt = (nm) => w.filter((x) => x === nm).length;
    return { lib: w.includes('junction_lib'), patch: w.includes('intersection_patch'), pads: cnt('junction_pad'), walls: cnt('junction_padwall'), stripes: cnt('crosswalk_stripe'), stop: cnt('stop_line') };
  });
  rb.restore([
    { points: [[-70, 0, 140], [70, 0, 140]], roadType: 'asphalt', width: 12, fillet: false, name: '东西向路2' },
    { points: [[0, 0, 80], [0, 0, 200]], roadType: 'asphalt', width: 12, fillet: false, name: '南北向路2' },
  ]);
  const info2 = window.app.objects.filter((o) => o.type === 'road_intersection').map((j) => {
    const w = walk(j.root, []);
    const cnt = (nm) => w.filter((x) => x === nm).length;
    return { lib: w.includes('junction_lib'), pads: cnt('junction_pad') };
  });
  // 近景机位（源码级 polygonOffset 后：中心像素应为面片色，水开也不盖）
  const app = window.app;
  app.stage.view.position.set(13, 11, 19);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 46;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();
  app.stage.render();
  const gl = app.stage.renderer.getContext();
  const db = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
  const rdC = () => { const px = new Uint8Array(4); gl.readPixels(Math.round(db * 0.5), Math.round(dbh * 0.5), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]]; };
  return { oblique: info, straight: info2, pixCenter: rdC() };
});
const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await page.screenshot({ path: 'test/out/chk-oblique-wateron.png', clip: rect });   // 水面开（应见路口）
await page.evaluate(() => { window.app.stage.world.traverse((n) => { if (n.name === 'terrain-water') n.visible = false; }); });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'test/out/chk-oblique-struct.png', clip: rect });    // 水面关（对照）
console.log(JSON.stringify({ ...out, errs }, null, 1));
await browser.close();
