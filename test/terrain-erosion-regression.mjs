import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.shots', { recursive: true });
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 300000 });
const errors = [], file = process.env.TEST_FILE_URL?.startsWith('file:'), prefix = '#inspector-scene ';
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (file) await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__previzBooted && window.app?.terrain?.workflow, { timeout: 60000 });
  await page.click('[data-page="scene"]'); await page.$$eval(prefix + '.itab', (bs) => bs.find((b) => b.textContent === '地形').click());
  await page.evaluate(() => { app.suspended = true; app._quietAdd = true; app._suspendUndo = true; app.clearAll(); app.terrain.setWater(false); app.terrain.setResolution(65); app.terrain.generate('ridge', 18, 778); app._suspendUndo = false; app._undo = []; app._redo = []; app.bus.emit('terrain'); });
  const ui = await page.$eval(prefix + '.terrain-organized', (root) => ({ tabs: root.querySelectorAll('[role="tab"]').length, visiblePanes: [...root.querySelectorAll('.terrain-pane')].filter((p) => !p.hidden).length, height: root.getBoundingClientRect().height, labels: [...root.querySelectorAll('[role="tab"]')].map((e) => e.textContent), closed: root.querySelectorAll('.sec.closed').length }));
  assert.equal(ui.tabs, 6); assert.equal(ui.visiblePanes, 1); assert(ui.closed >= 4);
  await page.click(prefix + '[data-terrain-tab="erosion"]');
  await page.click(prefix + '[data-terrain-action="erosion-preset-rocky"]');
  const configure = async (key, value) => page.$eval(prefix + `[data-erosion-setting="${key}"]`, (e, value) => { if (e.type === 'checkbox') e.checked = value; else e.value = String(value); e.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await configure('drops', 1200); await configure('iterations', 6); await configure('protectObjects', false);
  await page.evaluate(() => { window.erosionBefore = [...app.terrain.h]; window.undoCount = app._undo.length; });
  await page.click(prefix + '[data-terrain-action="erosion-preview"]');
  await page.waitForFunction(() => !app.terrain.workflow.busy && app.terrain.workflow.erosionPreview, { timeout: 60000 });
  const preview = await page.evaluate(() => {
    const t = app.terrain, w = t.workflow, p = w.erosionPreview, check = (v, m) => { if (!v) throw Error(m); };
    check(t.h.every((v, i) => v === erosionBefore[i]), 'preview changed logical heights'); check(app._undo.length === undoCount, 'preview polluted undo stack');
    check(!t.mesh.visible && p.mesh.visible && p.mesh.parent === t.mesh.parent, 'result preview not mounted');
    check(p.result.stats.affected > 100 && p.result.stats.depositedVolume > 0, 'no erosion / deposition');
    const saved = app.serialize({ assets: false }); window.savedBeforeErosion = saved;
    check(!JSON.stringify(saved).includes('terrain-erosion-preview'), 'preview leaked into project');
    window.previewResult = [...p.result.h]; return p.result.stats;
  });
  // Actual render differences, map replacement ownership, compact navigation and cancel visibility.
  const renders = await page.evaluate(() => {
    const a = app, w = a.terrain.workflow, s = a.stage; a.select(null); s.orbit.update = () => {};
    s.renderer.setPixelRatio(1); s.renderer.setSize(480, 320, false); s.view.aspect = 1.5; s.view.position.set(50, 100, 70); s.view.lookAt(0, 7, 0); s.view.updateProjectionMatrix(); s.helperLayer.visible = false;
    const sample = () => { s.render(); const gl = s.renderer.getContext(), pixels = new Uint8Array(480 * 320 * 4); gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels); let hash = 2166136261; for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619); return hash >>> 0; };
    const hashes = {}; for (const mode of ['before', 'result', 'erosion', 'sediment', 'flow', 'mask', 'delta']) { w.showErosionPreview(mode); hashes[mode] = sample(); }
    a.renderEffects.configure({ bloom: { enabled: true, mode: 'selective' } }); w.showErosionPreview('result'); sample(); if (a.renderEffects.pass.stats.selectedSlots !== 0 || !w.erosionPreview.mesh.visible) throw Error('erosion preview Bloom policy'); a.renderEffects.configure({ bloom: { enabled: false } });
    const memory = []; for (let i = 0; i < 4; i++) { w.showErosionPreview('flow'); sample(); w.showErosionPreview('result'); sample(); memory.push({ ...s.renderer.info.memory }); }
    return { hashes, memory };
  });
  assert.notEqual(renders.hashes.before, renders.hashes.result); assert(new Set(Object.values(renders.hashes)).size >= 6); assert(renders.memory.every((v) => v.geometries === renders.memory[0].geometries && v.textures === renders.memory[0].textures));
  await page.click('button[title="播放/暂停 (空格)"]');
  assert.equal(await page.evaluate(() => app.state.playing), false);
  await page.keyboard.press('c'); assert.equal(await page.evaluate(() => app.state.preview), false);
  const exportBlocked = await page.evaluate(async () => ({ video: await app.exporter.run({}), image: await app.exporter.still({}) }));
  assert.deepEqual(exportBlocked, { video: null, image: null });
  await page.click(prefix + '[data-terrain-tab="base"]'); assert(await page.$eval(prefix + '[data-terrain-action="erosion-cancel"]', (e) => e.getBoundingClientRect().height > 0));
  assert(await page.$eval(prefix + '[data-terrain-generation] input', (e) => e.disabled));
  await page.click(prefix + '[data-terrain-tab="erosion"]');
  await page.click(prefix + '[data-terrain-action="erosion-apply"]');
  const applied = await page.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow, check = (v, m) => { if (!v) throw Error(m); };
    check(!w.erosionPreview && t.mesh.visible, 'apply left preview ownership'); check(t.h.every((v, i) => v === previewResult[i]), 'apply differs from preview');
    check(a._undo.length === undoCount + 1, 'apply is not one undo operation'); check(!!t.toJSON().h32, 'erosion not stored precisely');
    const json = a.serialize({ assets: false }), after = [...t.h], setting = w.erosionSettings;
    check(a.undo() && t.h.every((v, i) => v === erosionBefore[i]), 'undo did not restore exact heights');
    check(a.redo() && t.h.every((v, i) => v === after[i]), 'redo did not restore exact heights');
    a.loadJson(json); await w.ready(); check(t.h.every((v, i) => v === after[i]), 'JSON lost height precision'); check(w.erosionSettings.seed === setting.seed && w.erosionSettings.style === 'rocky', 'settings not restored');
    const blob = await a.saveProject(); await a.importFiles([new File([blob], 'erosion.previz')]); await w.ready(); check(t.h.every((v, i) => v === after[i]), '.previz lost height precision');
    return { undoSteps: 1, exactJSON: true, exactPreviz: true, settings: w.erosionSettings };
  });
  const exports = await page.evaluate(async () => {
    const a = app, w = a.terrain.workflow; w.frameTerrain(); if (!a.shots.length) a.shotFromView();
    const png = await a.exporter.still({ width: 480, height: 320, asDataUrl: true });
    const img = new Image(); img.src = png; await img.decode(); if (img.width !== 480 || img.height !== 320) throw Error('applied erosion PNG dimensions');
    const video = await a.exporter.run({ width: 480, height: 320, duration: .4, fps: 5, bitrate: 1 }); a.suspended = true;
    if (!video?.size || video.frames !== 2) throw Error('applied erosion video export');
    return { width: img.width, height: img.height, png, videoFrames: video.frames, videoBytes: video.size, video: btoa(String.fromCharCode(...new Uint8Array(await video.blob.arrayBuffer()))) };
  });
  const suffix = file ? 'file' : 'dev';
  writeFileSync(`.shots/terrain-erosion-export-${suffix}.png`, Buffer.from(exports.png.split(',')[1], 'base64')); delete exports.png;
  writeFileSync(`.shots/terrain-erosion-export-${suffix}.webm`, Buffer.from(exports.video, 'base64')); delete exports.video;
  if (process.env.FFMPEG) {
    const decoded = spawnSync(process.env.FFMPEG, ['-v', 'error', '-i', `.shots/terrain-erosion-export-${suffix}.webm`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal(decoded.status, 0, String(decoded.stderr)); assert.equal(decoded.stdout.length, 480 * 320 * 3 * 2);
    exports.decodedFrames = 2; exports.meanRGB = [0, 1].map(i => { const data = decoded.stdout.subarray(i * 480 * 320 * 3, (i + 1) * 480 * 320 * 3); return data.reduce((a, b) => a + b, 0) / data.length; }); assert(exports.meanRGB.every(v => v > 0));
  }
  const safety = await page.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow, check = (v, m) => { if (!v) throw Error(m); }, before = [...t.h];
    w.configureErosion({ drops: 10000, iterations: 8 }); const task = w.previewErosion().catch((e) => e.message); setTimeout(() => w.cancelJob(), 15); const cancelled = await task;
    check(/取消/.test(cancelled) && !w.erosionPreview && t.h.every((v, i) => v === before[i]), 'cancel changed source');
    const race = w.previewErosion().catch((e) => e.message); setTimeout(() => { t.h[100] += .01; t.refresh(); }, 15); const conflict = await race;
    check(/已变化/.test(conflict) && !w.erosionPreview, 'concurrent source change not rejected');
    const leaveTask = w.previewErosion().catch(e => e.message); setTimeout(() => a.bus.emit('page-change', 'camera'), 15); const left = await leaveTask; check(/取消/.test(left) && !w.erosionPreview, 'leaving scene allowed stale erosion task');
    w.configureErosion({ drops: 500, iterations: 3 }); await w.previewErosion(); w.showErosionPreview('flow'); w.cancelErosionPreview(); check(t.mesh.visible && !w.erosionPreview, 'cancel did not restore mesh');
    await w.previewErosion(); t.h[101] += .01; t.refresh(); a.bus.emit('terrain'); check(!w.erosionPreview && t.mesh.visible, 'external terrain change did not discard stale preview');
    await w.previewErosion(); const material = t.mesh.material; let disposed = 0; material.addEventListener('dispose', () => disposed++); w.cancelErosionPreview(); check(disposed === 0, 'cancel disposed shared terrain material');
    w.rivers = [{ id: 'linked', name: '联动河道', points: [[-50, 5, 0], [50, 5, 0]], width: 10, bank: 4, depth: 2, water: true }]; w.rebuildRivers();
    w.configureErosion({ region: 'river', riverId: 'linked', riverBand: 12, riverProtect: true }); const heights = t.h.slice(), linked = await w.previewErosion();
    check(linked.stats.affected > 0, 'river-linked region does not erode');
    for (let i = 0; i < heights.length; i++) if (!linked.mask[i]) check(linked.h[i] === heights[i], 'protected river / outer vertices changed');
    w.cancelErosionPreview(); w.configureErosion({ region: 'all' });
    const beforeReset = w.previewErosion().catch((e) => e.message); setTimeout(() => a.loadJson(savedBeforeErosion), 15); const reset = await beforeReset; check(/取消/.test(reset) && !w.erosionPreview, 'load failed to invalidate old task');
    return { cancelled, conflict, reset, river: linked.stats };
  });
  const linkage = await page.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow, check = (v, m) => { if (!v) throw Error(m); };
    const model = a.addAsset('house:adobe:Adobe 土坯平顶房', [20, 50, 20]); model.followTerrain = false;
    w.configureErosion({ drops: 500, iterations: 3, region: 'all', protectObjects: true });
    const protectedResult = await w.previewErosion(), protectedVertices = protectedResult.mask.filter(v => v === 0).length;
    check(protectedVertices > t.n * 4 - 4, 'object projection did not protect vertices'); w.cancelErosionPreview(); a.removeObject(model);
    a.roadBrush.restore([{ id: 'erosion-follow', roadType: 'asphalt', width: 6, terrainMode: 'follow', terrainOffset: .02, points: [[-45, 0, 0], [45, 0, 0]] }]);
    w.configureErosion({ protectObjects: false, drops: 700, maxChange: 2 });
    const oldRoad = a.roadTerrain.height(a.byId('erosion-follow')._roadData.curve, 0, 0);
    await w.previewErosion(); const previewRoad = a.roadTerrain.height(a.byId('erosion-follow')._roadData.curve, 0, 0); check(previewRoad === oldRoad, 'preview moved follow road');
    w.applyErosionPreview(); const appliedRoad = a.roadTerrain.height(a.byId('erosion-follow')._roadData.curve, 0, 0);
    check(Math.abs(appliedRoad - oldRoad) > .00001, 'apply did not refit follow road');
    a.undo(); const undoneRoad = a.roadTerrain.height(a.byId('erosion-follow')._roadData.curve, 0, 0); check(Math.abs(undoneRoad - oldRoad) < .0001, 'undo did not restore follow road');
    a.redo(); const redoneRoad = a.roadTerrain.height(a.byId('erosion-follow')._roadData.curve, 0, 0); check(Math.abs(redoneRoad - appliedRoad) < .0001, 'redo did not restore follow road');
    a.loadJson(savedBeforeErosion); return { protectedVertices, oldRoad, previewRoad, appliedRoad, undoneRoad, redoneRoad };
  });
  await page.$$eval(prefix + '.itab', bs => bs.find(b => b.textContent === '地形').click());
  // Native file/river field callbacks still work after moving sections into sub-panes.
  await page.click(prefix + '[data-terrain-tab="rivers"]'); await page.click(prefix + '[data-terrain-action="river-new"]');
  await page.$eval(prefix + '[data-terrain-river-name]', (e) => { e.value = '重排后河道'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => app.terrain.workflow.draft.name), '重排后河道');
  await page.$eval(prefix + '[data-terrain-action="river-point-add"]', (e) => e.click());
  await page.$eval(prefix + '[data-river-point="0:1"]', (e) => { e.value = '4.5'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => app.terrain.workflow.draft.points[0][1]), 4.5);
  await page.evaluate(() => app.terrain.workflow.cancelDraft());
  await page.click(prefix + '[data-terrain-tab="base"]'); const head = prefix + '[data-terrain-pane="base"] .sec-h'; await page.click(head); await page.evaluate(() => app.bus.emit('terrain-workflow'));
  assert(await page.$eval(head, (e) => e.getAttribute('aria-expanded') === 'false'));
  await page.click(head); await page.click(prefix + '[data-terrain-tab="erosion"]');
  await page.evaluate(() => { app.stage.renderer.setSize(900, 700, false); app.stage.view.aspect = 900 / 700; app.stage.view.updateProjectionMatrix(); app.terrain.workflow.frameTerrain(); app.suspended = false; });
  await page.screenshot({ path: `.shots/terrain-erosion-${file ? 'file' : 'dev'}.png` });
  assert.deepEqual(errors, []);
  const result = { pass: true, mode: file ? 'file-offline' : 'dev', ui, preview, renders, applied, exports, safety, linkage, errors };
  writeFileSync(`.shots/terrain-erosion-${file ? 'file' : 'dev'}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
