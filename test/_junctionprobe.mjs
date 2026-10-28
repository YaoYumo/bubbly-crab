// 路口生成诊断：90°四向 / 30°斜交 / T形 / 小路四向 / 尽端圆头
import puppeteer from 'puppeteer';
import fs from 'node:fs';
fs.mkdirSync('test/out', { recursive: true });
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
p.on('pageerror', (e) => console.log('PAGEERR', String(e.message || e).split('\n')[0]));
await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
const info = await p.evaluate(async () => {
  const app = window.app;
  const rb = app.roadBrush;
  const draw = (type, w, pts) => {
    rb.setType(type);
    rb.roadWidth = w; rb.start();
    for (const [x, z] of pts) rb.addPoint(x, 0, z);
    rb.finish();
  };
  draw('asphalt', 12, [[-40, -30], [-40, 10]]);           // D1 尽端（先画，避免被他路邻近豁免干扰）
  draw('asphalt', 12, [[-140, 60], [140, 60]]);          // R1 东西
  draw('asphalt', 12, [[0, -80], [0, 200]]);              // R2 南北 → X1@ (0,60) 90°
  draw('asphalt', 12, [[40, 94.6], [160, 25.4]]);         // R3 斜30° → X2@(100,60)
  draw('asphalt', 12, [[-100, 120], [-100, 60]]);         // R4 止于R1 → T1@(-100,60)
  draw('gravel', 6.5, [[-60, 0], [60, 0]]);               // G1 小路×R2 → (0,0)
  const juncs = [], cull = [];
  for (const o of app.objects) {
    if (o.type === 'road_intersection') {
      const root = o.root;
      const lib = root.children.find(c => c.name === 'junction_lib');
      const info2 = { pos: [+o._isect.point.x.toFixed(1), +o._isect.point.z.toFixed(1)], patchKids: root.children.length };
      if (lib) {
        const THREE = window.__t.THREE;
        const bb = new THREE.Box3().setFromObject(lib);
        info2.lib = { yaw: +(lib.rotation.y * 180 / Math.PI).toFixed(1), y: +lib.position.y.toFixed(2), size: [+(bb.max.x - bb.min.x).toFixed(1), +(bb.max.y - bb.min.y).toFixed(2), +(bb.max.z - bb.min.z).toFixed(1)] };
      } else info2.lib = null;
      juncs.push(info2);
    }
    if (o.type === 'road_brush') {
      const rd = o._roadData;
      for (const end of [rd.curve.getPointAt(0), rd.curve.getPointAt(1)]) {
        const cul = rd.mesh.children.find(c => c.name === 'cul_de_sac' || /cul/i.test(c.name || ''));
        if (cul) cull.push({ road: rd.name, end: [+end.x.toFixed(1), +end.z.toFixed(1)] });
      }
      // 直接列出 mesh 尾部非 span 组（圆头件）
      for (const c of rd.mesh.children) {
        if (c.type === 'Group' && c.children.length === 0) { /* skip */ }
      }
    }
  }
  const roads = app.objects.filter(o => o.type === 'road_brush').length;
  const culs = [];
  for (const o of app.objects) if (o.type === 'road_brush') for (const c of o.root.children) {
    if (c !== undefined && c.type === 'Group' && c.children.some?.(x => x.type === 'Mesh') && c.name && /cul/i.test(c.name)) culs.push(c.name);
    if (c && c.name && /cul|round|four|t_junct|junction/i.test(c.name)) culs.push(`${o.name}:${c.name}`);
  }
  return { roads, juncs, culs };
});
console.log(JSON.stringify(info, null, 1));
const shot = async (name, px, py, pz, tx, ty, tz, fov) => {
  await p.evaluate((a) => {
    const app = window.app;
    app.stage.view.position.set(...a.slice(0, 3));
    app.stage.orbit.target.set(...a.slice(3, 6));
    app.stage.view.fov = a[6]; app.stage.view.updateProjectionMatrix(); app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
  }, [px, py, pz, tx, ty, tz, fov]);
  const rect = await p.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
  await p.screenshot({ path: `test/out/chk-junc-${name}.png`, clip: rect });
  console.log('shot', name);
};
await shot('x90', 0, 34, 104, 0, 0, 60, 46);
await shot('x30', 100, 34, 104, 100, 0, 60, 46);
await shot('tee', -100, 34, 104, -100, 0, 60, 46);
await shot('small', 0, 34, 44, 0, 0, 0, 46);
await shot('cul', -40, 90, 70, -40, 0, -10, 50);
await b.close(); console.log('DONE');
