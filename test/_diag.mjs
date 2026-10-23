// 诊断：近景青色区域到底是什么——中心射线命中 + 面片/水面状态 + 顶视
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
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
  // 近景机位
  app.stage.view.position.set(13, 11, 19);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 46;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 8; i++) app.step();

  // 中心射线
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), app.stage.view);
  const hits = ray.intersectObjects(app.stage.world.children, true).slice(0, 6).map((h) => ({
    name: h.object.name || h.object.type, y: +h.point.y.toFixed(3), dist: +h.distance.toFixed(1),
    vis: h.object.visible, mat: h.object.material?.color?.getHexString?.(),
  }));

  // 面片状态
  const ij = app.objects.find((o) => o.type === 'road_intersection');
  const patch = ij?.root?.children.find((c) => c.name === 'intersection_patch');
  const pinfo = patch ? {
    visible: patch.visible, parentVis: ij.root.visible, y: +patch.position.y.toFixed(3),
    color: patch.material?.color?.getHexString?.(), side: patch.material?.side,
    bboxY: (() => { const b = new THREE.Box3().setFromObject(patch); return [+b.min.y.toFixed(3), +b.max.y.toFixed(3), +b.min.x.toFixed(1), +b.max.x.toFixed(1)]; })(),
  } : null;

  // 水面状态
  const waters = [];
  app.stage.world.traverse((n) => {
    if (n.name && /water|terrain/.test(n.name) && n.isMesh) {
      const wy = new THREE.Vector3(); n.getWorldPosition(wy);
      waters.push({ name: n.name, y: +wy.y.toFixed(3), transparent: n.material?.transparent, opacity: n.material?.opacity, vis: n.visible, renderOrder: n.renderOrder, depthWrite: n.material?.depthWrite });
    }
  });

  // 斑马/转角块/光照状态（顶视机位下采样）
  app.stage.view.position.set(0, 90, 0.01);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 50;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  for (let i = 0; i < 6; i++) app.step();

  // 材质 flag + 斑马状态
  const st = { patch: { transparent: patch?.material?.transparent, opacity: patch?.material?.opacity, depthWrite: patch?.material?.depthWrite, receiveShadow: patch?.receiveShadow, castShadow: patch?.castShadow } };
  const stripes = [];
  ij.root.traverse((n) => { if (n.name === 'crosswalk_stripe' && stripes.length < 3) {
    const wp = new THREE.Vector3(); n.getWorldPosition(wp);
    stripes.push({ y: +wp.y.toFixed(3), vis: n.visible, parVis: n.parent?.visible, color: n.material?.color?.getHexString?.(), transparent: n.material?.transparent, opacity: n.material?.opacity });
  }});
  st.stripes = stripes;
  const pads = [];
  ij.root.traverse((n) => { if (n.name === 'junction_pad' && pads.length < 4) {
    const b = new THREE.Box3().setFromObject(n);
    pads.push({ y: [+b.min.y.toFixed(2), +b.max.y.toFixed(2)], xz: [[+b.min.x.toFixed(1), +b.max.x.toFixed(1)], [+b.min.z.toFixed(1), +b.max.z.toFixed(1)]] });
  }});
  st.pads = pads;
  const lights = [];
  app.stage.scene?.traverse?.((n) => { if (n.isDirectionalLight || n.isHemisphereLight) lights.push({ type: n.type, i: n.intensity, castShadow: n.castShadow }); });
  st.lights = lights;
  // 屏幕像素采样（canvas 2d 拷贝）
  const cvs = document.querySelector('#stage canvas');
  const off = document.createElement('canvas');
  off.width = cvs.width; off.height = cvs.height;
  const ctx = off.getContext('2d');
  ctx.drawImage(cvs, 0, 0);
  const px = (sx, sy) => { const d = ctx.getImageData(Math.round(off.width * sx), Math.round(off.height * sy), 1, 1).data; return [d[0], d[1], d[2]]; };
  st.pixels = { center: px(0.5, 0.5), q1: px(0.45, 0.45), q2: px(0.55, 0.55), roadL: px(0.15, 0.5), roadR: px(0.85, 0.5), up: px(0.5, 0.35), dn: px(0.5, 0.65) };
  return { hits, pinfo, waters, st };
});
const rect = await page.evaluate(() => { const c = document.querySelector('#stage canvas'); const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
await page.screenshot({ path: 'test/out/chk-diag-top.png', clip: rect });
console.log(JSON.stringify({ ...out, errs }, null, 1));
await browser.close();
