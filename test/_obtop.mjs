// 调试：斜交口路面/面片为何不显示——顶视截图 + 世界坐标/高度转储
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.app && window.app.stage && window.app.stage.renderer, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 600));

const out = await page.evaluate(async () => {
  const app = window.app, rb = app.roadBrush;
  const THREE = window.__t.THREE;
  rb.restore([
    { points: [[-70, 0, 0], [70, 0, 0]], roadType: 'asphalt', width: 12, fillet: false, name: 'A' },
    { points: [[-40, 0, -33.6], [40, 0, 33.6]], roadType: 'asphalt', width: 12, fillet: false, name: 'B' },
  ]);
  const terrain = app.terrain;
  const info = { terrainEnabled: !!terrain?.enabled, h00: terrain?.enabled ? terrain.heightAt(0, 0) : null };
  const rows = [];
  for (const o of app.objects) {
    if (o.type === 'road_brush') {
      const mesh = o.root || (o.root === undefined && o.mesh) || null;
      const m = o.root;
      if (m) {
        const box = new THREE.Box3().setFromObject(m);
        rows.push({ kind: 'road', name: o.name, y: +m.position.y.toFixed(3), boxY: [+box.min.y.toFixed(2), +box.max.y.toFixed(2)], boxXZ: [[+box.min.x.toFixed(1), +box.max.x.toFixed(1)], [+box.min.z.toFixed(1), +box.max.z.toFixed(1)]] });
      }
    } else if (o.type === 'road_intersection') {
      const patch = o.root.children.find((c) => c.name === 'intersection_patch');
      const box = patch ? new THREE.Box3().setFromObject(patch) : null;
      rows.push({ kind: 'isect', name: o.name, patchY: box ? [+box.min.y.toFixed(2), +box.max.y.toFixed(2)] : null, kids: o.root.children.length });
    }
  }
  // 场景里的大平面：找 y≈0 的大 Mesh（水面/地面）
  const planes = [];
  app.stage.world.traverse((n) => {
    if (n.isMesh && n.geometry?.type === 'PlaneGeometry') {
      const s = n.scale?.x || 1;
      const wy = new THREE.Vector3();
      n.getWorldPosition(wy);
      planes.push({ name: n.name, y: +wy.y.toFixed(3), scale: s, visible: n.visible, color: n.material?.color?.getHexString?.() });
    }
  });
  info.rows = rows;
  info.planes = planes.slice(0, 8);
  // 顶视
  app.stage.view.position.set(0, 90, 0.01);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 50;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 6; i++) app.step();
  return info;
});
const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await page.screenshot({ path: 'test/out/chk-oblique-top.png', clip: rect });
console.log(JSON.stringify({ ...out, errs }, null, 1));
await browser.close();
