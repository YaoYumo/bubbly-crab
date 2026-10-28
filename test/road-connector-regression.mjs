import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'], protocolTimeout: 240000 });
const errors = [], csp = [];
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1500, height: 1050 });
  p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.text().includes('CSP_VIOLATION')) csp.push(m.text()); });
  await p.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', e => console.error('CSP_VIOLATION:' + e.violatedDirective)));
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || process.env.TEST_URL || 'http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.app?.roadConnector, { timeout: 60000 }); await p.click('[data-page="scene"]');
  const result = await p.evaluate(() => {
    app.suspended = true; app.stage.renderer.setPixelRatio(.5);
    const rb = app.roadBrush, rc = app.roadConnector;
    const reset = roads => { app.clearAll(); app.terrain.setResolution(65); app.terrain.h.fill(0); app.terrain.refresh(); app.terrain.setWater(false); rb.restore(roads.map(r => ({ type: 'road_brush', roadType: 'asphalt', width: 12, terrainMode: 'fixed', bridges: false, ...r }))); };
    const pair = (height = 0) => [{ id: 'a', points: [[-90, 0, 0], [-40, 0, 0]] }, { id: 'b', points: [[40, height, 30], [90, height, 30]] }];
    const results = [];
    for (const roadMode of [false, true]) for (const height of [0, 8]) {
      reset(pair(height)); const aBefore = app.byId('a').serialize().points, bBefore = app.byId('b').serialize().points;
      rc.mark(0, app.byId('a'), 1, roadMode ? 'road' : 'point'); rc.mark(1, app.byId('b'), 0, roadMode ? 'road' : 'point');
      const before = (app._undo?.length||0), road = rc.generate(), id = road.id, data = road.serialize();
      const sameHosts = JSON.stringify(app.byId('a').serialize().points) === JSON.stringify(aBefore) && JSON.stringify(app.byId('b').serialize().points) === JSON.stringify(bBefore);
      const oneUndo = (app._undo?.length||0) === before + 1, generated = !!data.connection?.generated, count = app.objects.filter(o => o.type === 'road_brush').length;
      app.undo(); const undone = !app.byId(id) && app.objects.filter(o => o.type === 'road_brush').length === 2;
      app.redo(); const redone = !!app.byId(id), saved = JSON.parse(JSON.stringify(app.serialize())); app.loadJson(saved);
      const loaded = app.byId(id).serialize();
      results.push({ roadMode, height, count, sameHosts, oneUndo, generated, undone, redone, reloaded: JSON.stringify(loaded.section) === JSON.stringify(data.section) && JSON.stringify(loaded.points) === JSON.stringify(data.points) && JSON.stringify(loaded.connection) === JSON.stringify(data.connection), start: data.points[0], end: data.points.at(-1), points: data.points.length });
    }
    reset([{ id: 'a', points: [[-90, 0, 60], [-30, 0, 60]] }, { id: 'b', roadType: 'freeway', width: 20, points: [[-120, 8, 0], [120, 8, 0]] }]);
    rc.mark(0, app.byId('a'), 1); rc.mark(1, app.byId('b'), .55);
    const highwayRoad = rc.generate(), highway = highwayRoad.serialize(); app.stage.world.updateMatrixWorld(true);
    const V = app.stage.view.position.constructor, Ray = app.stage.raycaster.constructor;
    const ray = (x, z) => new Ray(new V(x, 40, z), new V(0, -1, 0)).intersectObject(app.byId('b').root, true).map(h => h.point.y)[0];
    const highwayResult = { ports: app.objects.filter(o => o.type === 'road_intersection' && o._isect.freeway).length, median: ray(12, 0), opposite: ray(12, -6), end: highway.points.at(-1), section: highway.section, type: highway.roadType };
    // Independent widths must affect meshes, profiles and persisted values, not scale lanes.
    let so = app.byId(highwayRoad.id); let section = { laneCount: 2, laneWidth: 3.5, shoulderWidth: .5, sidewalkWidth: 1.8 };
    rb.updateRoadProperties(so, { roadType: 'asphalt', section }); so = app.byId(highwayRoad.id);
    const old = so.serialize(); rb.updateRoadProperties(so, { section: { ...section, shoulderWidth: 2, sidewalkWidth: 3 } });
    so = app.byId(highwayRoad.id); const wider = so.serialize();
    app.undo(); const undoWidth = app.byId(highwayRoad.id).serialize(); app.redo(); const redoWidth = app.byId(highwayRoad.id).serialize();
    const independent = { laneWidth: wider.section.laneWidth, lanes: wider.section.laneCount, width: wider.width, oldWidth: old.width, undoWidth: undoWidth.width, redoWidth: redoWidth.width, sidewalk: wider.section.sidewalkWidth };
    // Rejections leave both network and undo state unchanged.
    reset(pair()); rc.mark(0, app.byId('a'), 1); rc.mark(1, app.byId('b'), 0); app.byId('b').locked = true;
    const before = JSON.stringify(app.serialize()), undo = (app._undo?.length||0); let lockedError = '';
    try { rc.generate(); } catch (e) { lockedError = e.message; }
    const rejected = { message: lockedError, unchanged: JSON.stringify(app.serialize()) === before, undoUnchanged: undo === (app._undo?.length||0) };
    // Acute core geometry stays bounded and centreline mouths remain closed.
    reset([{ id: 'a', width: 12, points: [[-140, 0, 0], [140, 0, 0]] }, { id: 'b', width: 8, points: [[0, 0, 0], [130, 0, 35]] }]); app.stage.world.updateMatrixWorld(true);
    const junction = app.objects.find(o => o.type === 'road_intersection'), plan = junction._isect.plan;
    const roots = app.objects.filter(o => ['road_brush', 'road_intersection'].includes(o.type)).map(o => o.root), seams = [];
    for (const r of rb._roads) for (const g of r.gaps) for (const edge of [g.t0, g.t1]) for (const offset of [-1, 0, 1]) {
      const q = r.curve.getPointAt(Math.max(0, Math.min(1, edge + offset / r.curve.getLength())));
      const hits = new Ray(new V(q.x, 30, q.z), new V(0, -1, 0)).intersectObjects(roots, true); seams.push({ x: q.x, z: q.z, y: hits[0]?.point.y });
    }
    const acute = { compact: plan.compact, maxMouth: Math.max(...plan.arms.map(a => a.c)), maxAnalytic: Math.max(...plan.arms.map(a => a.overlapReach)), seams };
    return { results, highwayResult, independent, rejected, acute };
  });
  for (const r of result.results) { assert.equal(r.count, 3); for (const key of ['sameHosts', 'oneUndo', 'generated', 'undone', 'redone', 'reloaded']) assert.equal(r[key], true, JSON.stringify(r)); assert.equal(r.start[1], 0); assert.equal(r.end[1], r.height); }
  const h = result.highwayResult; assert.equal(h.ports, 1, JSON.stringify(h)); assert.ok(Math.abs(h.median - 9.145) < .02); assert.ok(Math.abs(h.opposite - 8.17) < .02); assert.equal(h.end[1], 8); assert.equal(h.end[2], 6); assert.equal(h.section.laneWidth, 3.5); assert.equal(h.section.sidewalkWidth, 0); assert.equal(h.type, 'oneway');
  assert.deepEqual(result.independent, { laneWidth: 3.5, lanes: 2, width: 11, oldWidth: 8, undoWidth: 8, redoWidth: 11, sidewalk: 3 });
  assert.ok(result.rejected.message); assert.equal(result.rejected.unchanged, true); assert.equal(result.rejected.undoUnchanged, true);
  assert.equal(result.acute.compact, true); assert.ok(result.acute.maxMouth < 17); assert.ok(result.acute.maxAnalytic > 50); for (const seam of result.acute.seams) assert.ok(Number.isFinite(seam.y) && Math.abs(seam.y - .17) < .11, JSON.stringify(seam));
  // Real pointer marking and number-input events, not just controller API calls.
  const clicked = await p.evaluate(() => {
    app.suspended = false; app.clearAll(); app.roadBrush.restore([{ id: 'ui-a', roadType: 'asphalt', width: 8, terrainMode: 'fixed', points: [[-85, 0, -20], [-35, 0, -20]] }, { id: 'ui-b', roadType: 'asphalt', width: 8, terrainMode: 'fixed', points: [[35, 0, 20], [85, 0, 20]] }]);
    app.bus.emit('objects');
    app.stage.view.position.set(0, 180, 100); app.stage.orbit.target.set(0, 0, 0); app.stage.view.lookAt(0, 0, 0); app.stage.view.updateMatrixWorld(true); app.stage.world.updateMatrixWorld(true);
    const rect = app.stage.canvas.getBoundingClientRect(), V = app.stage.view.position.constructor;
    const pixel = xyz => { const q = new V(...xyz).project(app.stage.view); return { x: rect.left + (q.x + 1) * rect.width / 2, y: rect.top + (1 - q.y) * rect.height / 2 }; };
    return { a: pixel([-45, .17, -20]), b: pixel([45, .17, 20]) };
  });
  await p.click('#inspector-scene [data-road-connect-pick="0-point"]'); await p.mouse.click(clicked.a.x, clicked.a.y);
  await p.click('#inspector-scene [data-road-connect-pick="1-point"]'); await p.mouse.click(clicked.b.x, clicked.b.y);
  const marks = await p.evaluate(() => app.roadConnector.marks.map(m => m?.roadId)); assert.deepEqual(marks, ['ui-a', 'ui-b']);
  await p.click('#inspector-scene [data-road-connect-generate]');
  await p.waitForFunction(() => app.objects.some(o => o._roadData?.connection), { timeout: 60000 });
  assert.equal(await p.$('#inspector-scene [data-road-property="width-range"]'), null);
  await p.waitForSelector('#inspector-scene [data-road-property="laneWidth"]');
  const field = await p.$('#inspector-scene [data-road-property="laneWidth"]'); await field.click({ clickCount: 3 }); await field.type('3.6'); await field.press('Tab');
  await p.waitForFunction(() => app.selObj?._roadData?.roadType?.section?.laneWidth === 3.6);
  const mode = process.env.TEST_FILE_URL ? 'file' : process.env.TEST_URL ? 'desktop-csp' : 'web';
  await mkdir('.shots', { recursive: true }); await writeFile(`.shots/road-connector-${mode}.json`, JSON.stringify({ platform: 'Linux Chromium / software WebGL, not native user Windows hardware', ...result, pointerMarks: marks, errors, csp }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(csp, []);
  console.log(`PASS ${mode} road/point A-B automatic connectors / 3D height transitions / highway near-side port / saved section + provenance / one-step undo redo / independent widths / locked atomic rejection / bounded acute core seam rays / real pointer marking + actual section input`);
} finally { await browser.close(); }
