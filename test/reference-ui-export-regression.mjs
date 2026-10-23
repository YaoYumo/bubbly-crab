import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
const suffix = process.env.TEST_FILE_URL ? 'file' : 'dev', downloads = resolve(`.shots/reference-ui-${suffix}`); mkdirSync(downloads, { recursive: true });
const b = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
try {
  const p = await b.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const session = await b.target().createCDPSession(), names = new Map();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  session.on('Browser.downloadWillBegin', e => names.set(e.guid, e.suggestedFilename));
  async function download(key) {
    let timer, listener; const finished = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('UI download timed out')), 90000); listener = e => { if (e.state === 'completed') resolve(names.get(e.guid)); else if (e.state === 'canceled') reject(Error('UI download cancelled')); }; session.on('Browser.downloadProgress', listener); });
    try { await p.click(`[data-reference-action="${key}"]`); return readFileSync(resolve(downloads, await finished)); } finally { clearTimeout(timer); session.off('Browser.downloadProgress', listener); }
  }
  await p.setViewport({ width: 1440, height: 1000 }); if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__previzBooted && window.app?.reference, { timeout: 90000 });
  await p.evaluate(() => { app.suspended = true; app._quietAdd = true; app.clearAll(); app.terrain.setEnabled(false); const o = app.addAsset('house:adobe:Adobe 土坯平顶房', [0, 0, 0]); app.shotFromView(); const s = app.activeShot; s.rig.position.set(20, 12, 24); s.moveParams = { radius: 25 }; s.setTarget(o); s.generateMove('orbit'); });
  await p.click('[data-page="export"]');
  for (const [key, value] of Object.entries({ width: 320, height: 180, fps: 5, duration: .4 })) await p.$eval(`[data-reference-setting="${key}"]`, (e, value) => { e.value = value; }, value);
  const reference = await download('capture'), files = unzipSync(reference), manifest = JSON.parse(strFromU8(files['manifest.json'])); assert.equal(manifest.settings.frames, 2); assert(files['gray.webm']);
  assert.equal(await p.evaluate(() => !!document.querySelector('.reference-job-overlay') || document.getElementById('app').inert || !!app.stage.exportOwner), false);
  await p.click('[data-page="generate"]'); await p.waitForFunction(id => document.querySelector('[data-reference-setting="version"]').value === id, {}, manifest.id);
  const localVideo = resolve(downloads, 'ui-result.webm'); writeFileSync(localVideo, files['normal.webm']); await (await p.$('[data-reference-result-file]')).uploadFile(localVideo);
  await p.waitForFunction(async id => (await app.reference.store.get(id)).meta.resultName, {}, manifest.id);
  await p.select('[data-reference-setting="score-camera"]', '5'); await p.click('[data-reference-action="save-review"]');
  await p.waitForFunction(async id => (await app.reference.store.get(id)).meta.scores.camera === 5, {}, manifest.id);
  const attempt = unzipSync(await download('attempt-download')); assert.deepEqual(attempt['reference.zip'], new Uint8Array(reference)); assert.deepEqual(attempt['result.webm'], files['normal.webm']); assert.equal(JSON.parse(strFromU8(attempt['review.json'])).scores.camera, 5);
  await p.screenshot({ path: `.shots/reference-review-${suffix}.png`, fullPage: true }); assert.deepEqual(errors, []);
  const result = { entry: suffix, frames: 2, captureButton: true, overlayRemoved: true, nativeZIPDownload: true, attemptContainsOriginalZIP: true, attemptContainsResult: true, attemptContainsReview: true, errors };
  writeFileSync(`.shots/reference-ui-${suffix}.json`, JSON.stringify(result, null, 2)); console.log('PASS reference UI export', result);
} finally { await b.close(); }
