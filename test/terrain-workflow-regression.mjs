import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { spawnSync } from 'node:child_process';
import { fixturePNG } from './terrain-import-river.test.mjs';
mkdirSync('.shots', { recursive: true });
writeFileSync('.shots/terrain-workflow-height16.png', fixturePNG({ values: [10000, 10001, 65535, 0, 10001, 65535, 0, 0, 65535] }));
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 480000 });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL?.startsWith('file:')) await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1&benchmark=1');
  await page.waitForFunction(() => window.__previzBooted && window.app?.terrain?.workflow);
  await page.click('[data-page="scene"]');
  await page.$$eval('#inspector-scene .itab', (bs) => bs.find((b) => b.textContent === '地形').click());
  await page.evaluate(() => { app.suspended = true; app._quietAdd = true; app._suspendUndo = true; app.clearAll(); app.terrain.setWater(false); app._suspendUndo = false; });
  await page.click('#inspector-scene [data-terrain-tab="import"]');
  const input = await page.$('#inspector-scene [data-terrain-height-file]'); await input.uploadFile('.shots/terrain-workflow-height16.png');
  await page.waitForFunction(() => app.terrain.workflow.pendingHeight && !app.terrain.workflow.busy);
  const setting = async (key, value) => page.$eval(`#inspector-scene [data-terrain-setting="${key}"]`, (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
  await setting('height-size', 80); await setting('height-n', 65); await setting('height-base', 2); await setting('height-range', 1);
  await page.$eval('#inspector-scene [data-terrain-action="height-apply"]', (n) => n.click());
  await page.waitForFunction(() => !app.terrain.workflow.busy && app.terrain.workflow.heightSource?.depth === 16);
  const imported = await page.evaluate(() => {
    const a = app, t = a.terrain, check = (v, m) => { if (!v) throw Error(m); };
    check(t.n === 65 && t.size === 80 && t.exaggerate === 1, 'mapping form fields reset each other');
    const expected = Math.fround(2 + 10000 / 65535); check(t.h[0] === expected && t.h[64] === 3, 'height samples changed');
    check(t.h[32 * 65 + 32] > t.h[0] && t.h[32 * 65 + 32] - t.h[0] < .0001, '16-bit precision was quantized');
    const heights = [...t.h]; check(!!t.toJSON().h32 && !t.toJSON().h64, 'precise import not stored as float32');
    check(a.undo() && t.size === 160, 'height import is not one undo step'); check(a.redo() && t.h.every((v, i) => v === heights[i]), 'height redo lost precision');
    return { n: t.n, size: t.size, first: t.h[0], center: t.h[32 * 65 + 32], last: t.h.at(-1) };
  });
  // Use an actual PNG and JPEG color import, verify rendered pixels and ownership.
  const overlay = await page.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow, s = a.stage, check = (v, m) => { if (!v) throw Error(m); };
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff2020'; ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    window.terrainOverlayFixture = new File([blob], 'red-overlay.png', { type: 'image/png' });
    a.select(null); s.orbit.update = () => {}; s.renderer.setPixelRatio(1); s.renderer.setSize(480, 320, false); s.view.aspect = 1.5; s.view.position.set(.001, 100, .001); s.view.lookAt(0, 2, 0); s.view.updateProjectionMatrix(); s.helperLayer.visible = false;
    const pixel = () => { s.render(); const gl = s.renderer.getContext(), p = new Uint8Array(4); gl.readPixels(240, 160, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
    const before = pixel(); await w.importOverlay(window.terrainOverlayFixture); const after = pixel();
    check(after[0] > after[1] + 40 && Math.abs(before[1] - after[1]) > 20, 'color overlay did not render ' + JSON.stringify({ before, after }));
    check(w.overlay.url.startsWith('data:image/png') && w.texture.colorSpace === 'srgb', 'color overlay not embedded / sRGB');
    w.configureOverlay({ opacity: 0 }); const hidden = pixel(); check(hidden.every((v, i) => v === before[i]), 'zero opacity does not reveal existing material');
    check(a.undo(), 'overlay opacity undo unavailable'); await w.ready(); pixel(); check(w.overlay.opacity === 1, 'overlay undo lost record');
    a.setTex(false); const greyPaused = w.terrain.mesh.material._terrainOverlay.enabled.value; check(greyPaused === 0, 'global grey mode keeps overlay'); a.setTex(true); check(w.terrain.mesh.material._terrainOverlay.enabled.value === 1, 'overlay not restored');
    s.setPerfMode(true); check(w.terrain.mesh.material._terrainOverlay.enabled.value === 0, 'Basic mode keeps overlay'); s.setPerfMode(false);
    const jpeg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', .8)); await w.importOverlay(new File([jpeg], 'red.jpg', { type: 'image/jpeg' })); pixel(); check(w.overlay.name === 'red.jpg', 'JPEG import failed');
    await w.importOverlay(window.terrainOverlayFixture); pixel();
    const samples = [];
    for (let i = 0; i < 4; i++) { await w.importOverlay(window.terrainOverlayFixture); pixel(); samples.push(s.renderer.info.memory.textures); }
    check(samples.every((v) => v === samples[0]), 'overlay replacement textures grew');
    return { before, after, hidden, texturePlateau: samples };
  });
  // Actual viewport clicks are intercepted without selecting scene objects or painting.
  await page.click('#inspector-scene [data-terrain-tab="rivers"]');
  await page.$eval('#inspector-scene [data-terrain-action="river-new"]', (n) => n.click());
  const points = await page.evaluate(() => {
    app.suspended = false; const s = app.stage; s.helperLayer.visible = true; s.view.position.set(.001, 100, .001); s.view.lookAt(0, 2, 0); s.view.updateProjectionMatrix(); s.render();
    const rect = s.canvas.getBoundingClientRect();
    return [[-24, -12], [0, 2], [24, 12]].map(([x, z]) => { const v = s.view.position.clone().set(x, app.terrain.heightAt(x, z), z).project(s.view); return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 }; });
  });
  for (const p of points) await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Enter');
  await page.evaluate(() => { app.suspended = true; if (app.terrain.workflow.draft?.points.length !== 3) throw Error('viewport river drawing did not add exactly 3 points'); });
  await setting('river-width', 12); await setting('river-depth', 2.5); await setting('river-bank', 4);
  const river = await page.evaluate(async () => {
    const a = app, t = a.terrain, w = t.workflow, check = (v, m) => { if (!v) throw Error(m); };
    const before = [...t.h]; check(w.previewGroup.children.length > 0 && w.draft.width === 12 && w.draft.depth === 2.5, 'river preview / form failed');
    await w.commitDraft(false); check(w.rivers.length === 1 && t.h.every((v, i) => v === before[i]), 'save river changed heights');
    check(w.riverGroup.children.length === 1 && w.riverGroup.children[0].userData.pickIgnore, 'river water not rendered / pick-safe');
    check(a.undo() && w.rivers.length === 0, 'river save undo failed'); check(a.redo() && w.rivers.length === 1, 'river redo failed'); await w.ready();
    const id = w.rivers[0].id; w.beginDraft(id); const result = await w.commitDraft(true);
    check(result.changed > 0 && t.h.every((v, i) => v <= before[i] + 1e-6), 'carve is not lower-only');
    const carved = [...t.h], saved = JSON.stringify(w.rivers); check(a.undo() && t.h.every((v, i) => v === before[i]), 'carve undo did not restore exact heights');
    check(a.redo() && t.h.every((v, i) => v === carved[i]) && JSON.stringify(w.rivers) === saved, 'carve redo failed'); await w.ready();
    w.beginDraft(id); w.updateDraft({ width: 14 }); const unchanged = [...t.h], undoCount = a._undo.length;
    const task = w.commitDraft(true); w.cancelJob(); let cancelled = false; try { await task; } catch (e) { cancelled = /取消/.test(e.message); }
    check(cancelled && !w.busy && t.h.every((v, i) => v === unchanged[i]) && a._undo.length === undoCount, 'cancel mutated height or undo'); w.cancelDraft();
    w.beginDraft(id); w.updateDraft({ width: 15 }); const stale = w.commitDraft(true); t.h[0] += .123; let rejected = false; try { await stale; } catch (e) { rejected = /变化/.test(e.message); }
    check(rejected && t.h[0] === Math.fround(unchanged[0] + .123), 'concurrent brush was overwritten'); t.h.set(unchanged); w.cancelDraft(); t.refresh();
    // Draft geometry and guide visibility must never leak into exports / selection Bloom.
    w.beginDraft(id); a.exporter.setGuides(false); check(!w.previewGroup.visible, 'export left river preview visible'); a.exporter.setGuides(true); check(w.previewGroup.visible, 'guides not restored'); w.cancelDraft();
    // Size changes do not silently move saved control points outside the terrain.
    const stablePoints = JSON.stringify(w.rivers[0].points); t.setSize(40); check(w.invalidRivers === 1 && w.riverGroup.children.length === 0, 'out-of-bounds river still renders');
    t.setSize(80); check(w.riverGroup.children.length === 1 && JSON.stringify(w.rivers[0].points) === stablePoints, 'size restore lost river path');
    // Confirm water strip contributes actual pixels, not only a stored definition.
    const stage = a.stage, centerPoint = w.rivers[0].points[1], pos = stage.view.position.clone().fromArray(centerPoint).project(stage.view);
    const pixel = () => { stage.render(); const gl = stage.renderer.getContext(), out = new Uint8Array(4); gl.readPixels(Math.floor((pos.x + 1) * stage.canvas.width / 2), Math.floor((pos.y + 1) * stage.canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return [...out]; };
    const wet = pixel(); w.riverGroup.visible = false; const dry = pixel(); w.riverGroup.visible = true;
    check(wet.some((v, i) => i < 3 && Math.abs(v - dry[i]) > 20), 'saved water strip has no visible pixels ' + JSON.stringify({ wet, dry }));
    const doc = a.serialize(); a.loadJson(doc); await w.ready(); check(t.h.every((v, i) => v === carved[i]) && w.rivers.length === 1 && w.texture && w.overlay.url.startsWith('data:'), 'serialize/load lost height/river/texture');
    const archive = await a.saveProject(); await a.importFiles([new File([archive], 'terrain-workflow.previz')]); await w.ready(); check(t.h.every((v, i) => v === carved[i]) && JSON.stringify(w.rivers) === saved && w.texture, 'archive roundtrip lost workflow');
    a.renderEffects.configure({ bloom: { enabled: true, mode: 'selective' } }); a.stage.render(); check(a.renderEffects.pass.selectionTarget && a.renderEffects.pass.stats.selectedSlots === 0, 'terrain water was accidentally selected for Bloom');
    a.renderEffects.configure({ bloom: { enabled: false } });
    const snapshots = [];
    for (let i = 0; i < 4; i++) { w.beginDraft(id); a.stage.render(); w.cancelDraft(); a.stage.render(); snapshots.push({ ...a.stage.renderer.info.memory }); }
    check(snapshots.every((v) => v.geometries === snapshots[0].geometries && v.textures === snapshots[0].textures), 'river preview allocation grew');
    const texture = w.texture; let disposed = 0; texture.addEventListener('dispose', () => disposed++); a.clearAll(); check(!w.texture && w.rivers.length === 0 && !w.riverGroup.children.length && disposed === 1, 'clear did not release workflow resources');
    a.loadJson(doc); await w.ready();
    return { wet, dry, clickedPoints: 3, changed: result.changed, storedRivers: 1, preciseRoundtrip: true, previewPlateau: snapshots, archiveBytes: archive.byteLength };
  });
  const exports = await page.evaluate(async () => {
    const a = app, w = a.terrain.workflow; a.suspended = true;
    const png = await a.exporter.still({ width: 480, height: 320, asDataUrl: true });
    const img = await new Promise((r, reject) => { const i = new Image(); i.onload = () => r(i); i.onerror = reject; i.src = png; });
    if (img.width !== 480 || img.height !== 320) throw Error('PNG export dimensions failed');
    const c = document.createElement('canvas'); c.width = 480; c.height = 320; c.getContext('2d').drawImage(img, 0, 0); const p = c.getContext('2d').getImageData(0, 0, 480, 320).data;
    if (!p.some((v, i) => i % 4 !== 3 && v > 0)) throw Error('PNG export blank');
    const job = w.stageHeight(new File([new Uint8Array()], 'bad.png')); const refused = await a.exporter.still({ width: 480, height: 320, asDataUrl: true }); try { await job; } catch {}
    if (refused !== null) throw Error('export accepted while terrain computation was active');
    if (!a.shots.length) a.addShot();
    const video = await a.exporter.run({ width: 480, height: 320, duration: .4, fps: 5, bitrate: 1 }); a.suspended = true;
    if (!video?.size || video.frames !== 2) throw Error('terrain workflow video export failed');
    return { width: img.width, height: img.height, exportMutex: true, png, videoFrames: video.frames, videoBytes: video.size, video: btoa(String.fromCharCode(...new Uint8Array(await video.blob.arrayBuffer()))) };
  });
  assert.deepEqual(errors, []);
  const suffix = process.env.TEST_FILE_URL ? 'file' : 'dev';
  writeFileSync(`.shots/terrain-workflow-${suffix}.png`, Buffer.from(exports.png.split(',')[1], 'base64')); delete exports.png;
  writeFileSync(`.shots/terrain-workflow-${suffix}.webm`, Buffer.from(exports.video, 'base64')); delete exports.video;
  if (process.env.FFMPEG) {
    const decoded = spawnSync(process.env.FFMPEG, ['-v', 'error', '-i', `.shots/terrain-workflow-${suffix}.webm`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal(decoded.status, 0, String(decoded.stderr)); assert.equal(decoded.stdout.length, 480 * 320 * 3 * 2);
    exports.decodedFrames = 2; exports.meanRGB = [...[0, 1]].map((i) => { const data = decoded.stdout.subarray(i * 480 * 320 * 3, (i + 1) * 480 * 320 * 3); return data.reduce((a, b) => a + b, 0) / data.length; });
    assert.ok(exports.meanRGB.every((v) => v > 0));
  }
  const result = { entry: process.env.TEST_FILE_URL ? 'file:' : 'http:', imported, overlay, river, exports, checks: ['native file input 16-bit precision + independent mapping fields', 'height/overlay/river undo/redo + exact float32 archive roundtrip', 'PNG/JPEG overlay real pixels/opacity/global grey/Basic', 'viewport clicks + node form + preview/save/carve lower-only', 'cancel and stale-source refusal', 'export guides + mutex + selective Bloom isolation', 'four-cycle overlay texture / river preview resource plateau', 'PNG output + two-frame WebM + optional native true decode + clear/dispose'] };
  writeFileSync(`.shots/terrain-workflow-${suffix}.json`, JSON.stringify(result, null, 2)); console.log('PASS terrain import + manual river', JSON.stringify(result, null, 2));
} finally { await browser.close(); }
