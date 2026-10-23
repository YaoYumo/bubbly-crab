// 道路回归：锐角出口需容纳完整侧带及圆角；近远景步道不得被底面盖住。
// bash test/withchrome.sh node test/junction-regression.mjs
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.app?.roadBrush && window.__previzBooted);
  for (const angle of [90, 60, 45, 30, 20, 15]) {
    const result = await page.evaluate(async angle => {
      const app=window.app,THREE={Vector3:app.stage.view.position.constructor};
      app.clearAll();
      const a = angle * Math.PI / 180, r = 180;
      app.roadBrush.restore([
        { points: [[-r, 0, 0], [r, 0, 0]], roadType: 'asphalt', width: 12, fillet: false },
        { points: [[-r*Math.cos(a), 0, -r*Math.sin(a)], [r*Math.cos(a), 0, r*Math.sin(a)]], roadType: 'asphalt', width: 12, fillet: false },
      ]);
      const j = app.objects.find(o => o.type === 'road_intersection');
      if (!j) return { missing: true };
      const plan = app.roadBrush._planForIsect(j._isect);
      const centers = plan.walks.map(w => w.poly.reduce((p, q) => p.add(new THREE.Vector3(q.x/w.poly.length, 0, q.z/w.poly.length)), new THREE.Vector3(0, .26, 0)));
      const c = Math.max(...plan.arms.map(a => a.c));
      const views = [];
      for (const height of [Math.max(70, c*3), Math.max(320, c*5), Math.max(600, c*7)]) for (const tilt of [.06, .8]) {
        app.stage.view.position.set(.01, height, height*tilt);
        app.stage.orbit.target.set(0, 0, 0);
        app.stage.view.fov = 50;
        app.stage.view.updateProjectionMatrix();
        app.stage.orbit.update();
        app.stage.render();
        const gl = app.stage.renderer.getContext();
        const width = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const pixels = centers.map(center => {
          const p = center.clone().project(app.stage.view);
          const x = Math.floor((p.x+1)*.5*width), y = Math.floor((p.y+1)*.5*h);
          if (x<1 || x>=width-1 || y<1 || y>=h-1) return null;
          const rgb = new Uint8Array(4);
          gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgb);
          return [...rgb].slice(0,3);
        });
        views.push({ height, tilt, pixels });
      }
      return { walks: centers.length, c, views, valid: j.root.children.every(m => !m.geometry || Array.from(m.geometry.attributes.position.array).every(Number.isFinite)) };
    }, angle);
    assert.equal(result.missing, undefined, `${angle}: missing junction`);
    assert.equal(result.walks, 4, `${angle}: missing sidewalk corners`);
    assert.equal(result.valid, true, `${angle}: invalid geometry`);
    for (const view of result.views) {
      view.pixels.forEach((rgb, i) => {
        assert.ok(rgb && rgb[0] > 140 && Math.max(...rgb)-Math.min(...rgb) < 65, `${angle}° height=${view.height} corner=${i}: ${rgb} (sidewalk covered)`);
      });
    }
    console.log(JSON.stringify({ angle, ...result }));
    if ([90,30,15].includes(angle)) {
      const rect = await page.evaluate(() => { const r = document.querySelector('#stage canvas').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.floor(r.width), height: Math.floor(r.height) }; });
      await page.screenshot({ path: `test/out/junction-distance-${angle}.png`, clip: rect });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 6 angles × 3 distances × 2 tilts × 4 sidewalk corners; no page errors');
} finally { await browser.close(); }
