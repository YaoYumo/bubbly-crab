// 中式古建「结构完整度」实拍核对：六件一排 + 牌楼正立面 / 斜侧、殿宇斜侧
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5173/';
const OUT = 'test/out';
fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message.split('\n')[0]));
await p.setViewport({ width: 1500, height: 880, deviceScaleFactor: 1.5 });
await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 180000 });

const info = await p.evaluate(async () => {
  const app = window.app, THREE = window.__t.THREE;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  app.objects.slice().forEach((o) => app.removeObject(o));
  if (window.__t.setDetailLevel) window.__t.setDetailLevel('std');
  const list = [
    ['cn:paifang:牌楼牌坊', { span: 18, h: 7.2, bays: 3 }],
    ['cn:hall:宫殿大殿', { w: 22, d: 14, bays: 5 }],
    ['cn:pavilion:攒尖亭', { r: 3.2, sides: 6 }],
    ['cn:pagoda:楼阁式佛塔', { levels: 5, r: 4 }],
    ['cn:gate:城门楼', { w: 24, wallH: 9 }],
    ['cn:drumtower:鼓楼钟楼', { w: 12, baseH: 6.5 }],
  ];
  let x = -84;
  for (const [key, params] of list) {
    const o = app.addAsset(key, V(x, 0, 0), { params });
    if (o) o.root.rotation.y = 0.34;
    if (o) o.root.userData.spot = key;
    x += 33;
  }
  app.state.showHelpers = false;
  app.stage.setGridVisible(false);
  app.stage.view.far = 900;
  window.__shot = (px, py, pz, tx, ty, tz, fov) => {
    app.stage.view.position.set(px, py, pz);
    app.stage.orbit.target.set(tx, ty, tz);
    app.stage.view.fov = fov;
    app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 8; i++) app.step();
  };
  window.__itemBox = (predKey) => {
    let hit = null;
    app.stage.world.traverse((o) => { if (o.userData && o.userData[predKey] && !hit) hit = o; });
    if (!hit) return null;
    hit.rotation.y = 0;                                    // 立面议：把构件转回正对相机
    return new THREE.Box3().setFromObject(hit);
  };
  window.__hideRest = (predKey) => {
    app.objects.forEach((o) => {
      let mine = false;
      o.root.traverse((c) => { if (c.userData && c.userData[predKey]) mine = true; });
      o.root.visible = mine;
    });
  };
  window.__shot(-6, 34, 118, -4, 7, 0, 30);
  let tri = 0, draw = 0;
  app.stage.world.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) { draw++; const c = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0); tri += (o.isInstancedMesh ? c * o.count : c); }
  });
  return { objs: app.objects.length, draw, tri: Math.round(tri) };
});
console.log('scene', JSON.stringify(info));

const rect = await p.evaluate(() => {
  const c = document.querySelector('#stage canvas');
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});

const only = process.argv[2];
const shots = [
  ['cn-sheet.png', null, null, null],
  ['cn-paifang-front.png', 'cn', 'front', null],
  ['cn-paifang.png', 'cn', 'three', null],
  ['cn-hall.png', 'hall', 'three', null],
  ['cn-pagoda.png', 'pagoda', 'three', null],
];
for (const [file, key, mode] of shots) {
  if (only && !file.includes(only)) continue;
  const meta = await p.evaluate((key, mode) => {
    if (!key) { return { wide: true }; }
    window.__hideRest(key);
    const box = window.__itemBox(key);
    if (!box) return { err: 'not found' };
    const c = box.getCenter(new window.__t.THREE.Vector3());
    const s = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y);
    const eye = mode === 'front'
      ? [c.x, box.min.y + (box.max.y - box.min.y) * 0.58, box.max.z + s * 2.3]
      : [c.x - s * 0.95, c.y + s * 0.28, box.max.z + s * 1.5];
    window.__shot(eye[0], eye[1], eye[2], c.x, box.min.y + (box.max.y - box.min.y) * (mode === 'front' ? 0.44 : 0.42), c.z, mode === 'front' ? 17 : 28);
    return { h: +(box.max.y - box.min.y).toFixed(2), w: +(box.max.x - box.min.x).toFixed(2) };
  }, key, mode);
  await new Promise((r) => setTimeout(r, key ? 900 : 1400));
  await p.screenshot({ path: `${OUT}/${file}`, clip: rect });
  console.log(file, JSON.stringify(meta));
}
await b.close();
