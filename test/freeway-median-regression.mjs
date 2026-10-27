// Actual WebGL angular sweep + draw-order perturbation. Coplanar overlapping
// surfaces change appearance with draw order; the fixed median must not do so.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const p = await b.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.app?.roadBrush && window.__t?.THREE);
  const result = await p.evaluate(async () => {
    const T = window.__t.THREE, { buildSectionRoad } = await import('/src/road-section.js');
    app.suspended = true;
    const renderer = app.stage.renderer, oldTarget = renderer.getRenderTarget();
    const target = new T.WebGLRenderTarget(192, 192);
    const camera = new T.PerspectiveCamera(45, 1, .1, 300);
    const scene = new T.Scene(); scene.background = new T.Color(0x18202a);
    const section = { laneCount: 4, laneWidth: 3.5, shoulderWidth: 1, sidewalkWidth: 0 };
    const root = buildSectionRoad('freeway', section, 35);
    root.traverse(m => { if (m.isMesh) { const original = m.material; m.material = new T.MeshBasicMaterial({ color: original.color }); original.dispose(); } });
    scene.add(root);
    const pixels = new Uint8Array(192 * 192 * 4);
    const image = reverse => {
      let i = 0; root.traverse(m => { if (m.isMesh) m.renderOrder = (reverse ? -1 : 1) * ++i; });
      renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels); return pixels.slice();
    };
    const compare = () => {
      const a = image(false), b = image(true); let median = 0, entireFrame = 0;
      const ray = new T.Raycaster(), q = new T.Vector3(), plane = new T.Plane(new T.Vector3(0, 1, 0), -.15);
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])<=4)continue;
        entireFrame++;
        const pixel=i/4;ray.setFromCamera(new T.Vector2(((pixel%192)+.5)/192*2-1,(Math.floor(pixel/192)+.5)/192*2-1),camera);
        // Exclude the wall and exact material/shared-span boundaries. Raster edge
        // ties can affect a single pixel; this test targets the interior median patch.
        if(ray.ray.intersectPlane(plane,q)&&Math.abs(q.x)>.65&&Math.abs(q.x)<1.85&&Math.abs(q.z)<16)median++;
      }return {median,entireFrame};
    };
    const angles = [];
    for (const height of [6, 18, 40]) for (const yaw of [0, .7, 1.8, 3.4]) {
      camera.position.set(45 * Math.cos(yaw), height, 45 * Math.sin(yaw)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      angles.push({ height, yaw, orderDependentPixels: compare() });
    }
    // Recreate the old full-width asphalt overlap as a negative control.
    const bad = new T.Mesh(new T.BoxGeometry(20, .15, 35), new T.MeshBasicMaterial({ color: 0x3a3d42 }));
    bad.position.y = .075; root.add(bad);
    camera.position.set(26, 20, 28); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const negativeControlPixels = compare().median; root.remove(bad); bad.geometry.dispose(); bad.material.dispose();
    renderer.setRenderTarget(oldTarget); target.dispose();
    root.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); });
    // Full road pipeline, including batching, cap transforms and legacy saves.
    const counts = [];
    for (const explicit of [false, true]) {
      app.clearAll(); app.terrain.setWater(false);
      app.roadBrush.restore([{ id: 'median', roadType: 'freeway', width: 20, ...(explicit ? { section } : {}), terrainMode: 'fixed', bridges: false, points: [[0, 0, -45], [0, 0, 45]] }]);
      const road = app.byId('median').root; road.updateMatrixWorld(true);
      for (const [x, z] of [[1.23, 3.41], [-1.37, -6.53], [1.23, 45.41], [-1.37, -45.53]]) {
        const hits = new T.Raycaster(new T.Vector3(x, 5, z), new T.Vector3(0, -1, 0)).intersectObject(road, true).filter(h => Math.abs(h.point.y - .17) < 1e-5);
        counts.push({ explicit, x, z, tops: hits.length });
      }
    }
    app.clearAll();app.roadBrush.restore([
      {id:'highway',roadType:'freeway',width:20,section,terrainMode:'fixed',bridges:false,points:[[-100,8,0],[100,8,0]]},
      {id:'ramp',roadType:'asphalt',width:8,terrainMode:'fixed',bridges:false,points:[[-30,8,0],[30,0,60]]}
    ]);app.stage.world.updateMatrixWorld(true);
    const ports=app.objects.filter(o=>o.type==='road_intersection'&&o._isect.freeway), highway=app.byId('highway').root;
    const at=(x,z)=>new T.Raycaster(new T.Vector3(x,30,z),new T.Vector3(0,-1,0)).intersectObject(highway,true).map(h=>h.point.y);
    const q=ports[0]?._isect.point;
    const port={count:ports.length,median:at(-25,0)[0],opposite:at(-25,-6)[0],nearMain:q?at(q.x,q.z):null};
    return { angles, negativeControlPixels, counts, port };
  });
  assert.ok(result.negativeControlPixels > 20, 'negative control must expose the old overlapping median');
  for (const a of result.angles) assert.equal(a.orderDependentPixels.median, 0, JSON.stringify(a));
  for (const c of result.counts) assert.equal(c.tops, 1, JSON.stringify(c));
  assert.equal(result.port.count,1);assert.ok(Math.abs(result.port.median-9.145)<.02);assert.ok(Math.abs(result.port.opposite-8.17)<.02);assert.deepEqual(result.port.nearMain,[]);
  assert.deepEqual(errors, []);
  await mkdir('.shots', { recursive: true });
  await writeFile('.shots/freeway-median-web.json', JSON.stringify({ platform: 'Linux Chromium software WebGL, not native Windows GPU acceptance', ...result, errors }, null, 2));
  console.log('PASS 12 real WebGL camera angles, zero median-interior draw-order-dependent pixels / old overlap negative control detected / unique median tops in new and legacy batched roads and both caps');
} finally { await b.close(); }
