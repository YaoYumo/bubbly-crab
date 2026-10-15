// 事实采集：路面顶高 / 斑马顶点 / 绕序法线 / gap 半长 / 光照
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
const page = await browser.newPage();
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
  const down = (x, z) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
    const hs = ray.intersectObjects(app.stage.world.children, true);
    return hs.slice(0, 3).map((h) => `${h.object.name || '?'}@${h.point.y.toFixed(3)}`);
  };
  const stations = { onA35: down(35, 0), onA24: down(24.5, 0), onA15: down(15, 0), onA5: down(5, 0), walkA: down(0, 9.5), onB24: down(18.8, 15.8), onB12: down(9.2, 7.7) };

  const ij = app.objects.find((o) => o.type === 'road_intersection');
  const isect = ij._isect;
  const gaps = { gNew: rb._gapFor(isect, true), gEx: rb._gapFor(isect, false) };

  // 斑马前两条顶点世界坐标
  const stripes = [];
  ij.root.traverse((n) => { if (n.name === 'crosswalk_stripe' && stripes.length < 2) {
    const pos = n.geometry.attributes.position;
    const v = [];
    for (let i = 0; i < Math.min(4, pos.count); i++) { const p = new THREE.Vector3().fromBufferAttribute(pos, i); n.localToWorld(p); v.push([+p.x.toFixed(2), +p.y.toFixed(3), +p.z.toFixed(2)]); }
    stripes.push(v);
  }});

  // 绕序法线（几何 index 首三角形的面法线 y）
  const faceY = (mesh) => {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
    const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
    const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
    return +b.sub(a).cross(c.sub(a)).normalize().y.toFixed(3);
  };
  const patch = ij.root.children.find((c) => c.name === 'intersection_patch');
  const pad = ij.root.children.find((c) => c.name === 'junction_pad');
  const stripesAll = [];
  ij.root.traverse((n) => { if (n.name === 'crosswalk_stripe') stripesAll.push(n); });
  const wind = { patchFaceY: faceY(patch), padFaceY: pad && faceY(pad), stripeFaceY: stripesAll[0] && faceY(stripesAll[0]) };

  // 主光
  const lights = [];
  app.stage.scene.traverse((n) => { if (n.isDirectionalLight) lights.push({ i: n.intensity, pos: n.position.toArray().map((v) => +v.toFixed(1)), target: n.target?.position?.toArray?.().map?.((v) => +v.toFixed(1)), shadow: n.castShadow }); });

  // ext（斑马起点）
  // 近景机位下按屏幕 NDC 打射线（y250/y300 屏点≈NDC +0.225/+0.068）
  app.stage.view.position.set(13, 11, 19);
  app.stage.orbit.target.set(0, 0, 0);
  app.stage.view.fov = 46;
  app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  app.stage.render();
  const probeNdc = (nx, ny) => {
    const r2 = new THREE.Raycaster();
    r2.setFromCamera(new THREE.Vector2(nx, ny), app.stage.view);
    return r2.intersectObjects(app.stage.world.children, true).slice(0, 4).map((h) => `${h.object.name || '?'}@${h.point.y.toFixed(3)}d${h.distance.toFixed(1)}`);
  };
  // offset 强度扫描：读 y250/y300 屏点（频带）+ 路面点(30,0,0)投影（防面片穿透路面）
  const gl = app.stage.renderer.getContext();
  const db = gl.drawingBufferWidth, dbh = gl.drawingBufferHeight;
  const rdPx = (nx, ny) => { const px = new Uint8Array(4); gl.readPixels(Math.round(db * (nx + 1) / 2), Math.round(dbh * (ny + 1) / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]]; };
  // 候选：路面压面片危险区 (20,0.15,0)（road 之上、patch 之下）+ 斑马 (22.5,0.18,0.5)
  const cands = { road: [20, 0.15, 0], zebra: [22.5, 0.18, 0.5], westRoad: [-20, 0.15, 0] };
  const ndcs = {};
  for (const k in cands) { const v = new THREE.Vector3(...cands[k]).project(app.stage.view); ndcs[k] = [+v.x.toFixed(2), +v.y.toFixed(2)]; }
  const onScreen = (a) => Math.abs(a[0]) < 0.9 && Math.abs(a[1]) < 0.9;
  const variants = {};
  for (const [f, u] of [[0, 0], [-2, -6], [-4, -10]]) {
    patch.material.polygonOffset = f !== 0;
    patch.material.polygonOffsetFactor = f;
    patch.material.polygonOffsetUnits = u;
    patch.material.needsUpdate = true;
    app.stage.render();
    const row = { band250: rdPx(0, 0.225), band300: rdPx(0, 0.068) };
    for (const k in ndcs) if (onScreen(ndcs[k])) row[k] = rdPx((ndcs[k][0] + 1) / 2, (ndcs[k][1] + 1) / 2);
    variants[`${f},${u}`] = row;
  }
  return { stations, gaps, stripes, wind, lights, hAwEtc: { wN: isect.newWidth, wE: isect.existingWidth }, variants, ndcs };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
