import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { decodeHeightPNG } from '../src/terrain-import.js';
import { depthFromCode } from '../src/reference-format.js';
import { spawnSync } from 'node:child_process';
mkdirSync('.shots', { recursive: true });
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 300000 });
try {
  const p = await browser.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.setViewport({ width: 1440, height: 1000 }); if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__previzBooted && window.app?.reference, { timeout: 90000 });
  const out = await p.evaluate(async () => {
    const a = app; a.suspended = true; a._quietAdd = true; a._suspendUndo = true; a.clearAll(); a.terrain.setEnabled(false); a.lighting.setMode('physical'); a.lighting.physical.configure({ shadows: false, fog: 0 });
    const o = a.addAsset('house:adobe:Adobe 土坯平顶房', [0, 0, 0]); a.shotFromView(); const s = a.activeShot; s.rig.position.set(20, 12, 24); s.setTarget(o); s.aim = 'target'; s.moveParams = { radius: 25 }; s.generateMove('orbit'); s.handheld = .1; a._suspendUndo = false;
    const crowd = a.addAsset('char:crowd:人群', [10, 0, 0], { params: { count: 3, radius: 3, anim: 'walk', wander: true } });
    const runtimeState = () => { const nodes = []; crowd.root.traverse(n => nodes.push([n.position.toArray(), n.rotation.toArray(), n.scale.toArray()])); return JSON.stringify({ nodes, phase: crowd.root.userData.animPhase, init: crowd.root.userData.crowdInit, humans: crowd.root.userData.humans.map(h => ({ ph: h.ph, anim: h.anim, w: h.w, dist: h.dist })) }); }; const poseBefore = runtimeState();
    const before = JSON.stringify(a.serialize({ assets: false })), input = { width: 320, height: 180, fps: 5, duration: .6, channels: true, subjectId: o.id };
    const r = await a.reference.capture(input).catch(e => { throw Error('initial: ' + e.message); }); if (runtimeState() !== poseBefore) throw Error('crowd runtime changed');
    const repeat = await a.reference.capture(input, e => { if (e.phase === 'render') window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); }).catch(e => { throw Error('repeat: ' + e.message); }); const firstBytes = new Uint8Array(await r.first.arrayBuffer()), repeatBytes = new Uint8Array(await repeat.first.arrayBuffer()); if (runtimeState() !== poseBefore || firstBytes.length !== repeatBytes.length || !firstBytes.every((b, i) => b === repeatBytes[i])) throw Error('seeded crowd repeat not identical');
    if (before !== JSON.stringify(a.serialize({ assets: false }))) throw Error('capture changed project');
    if (a.exporter.running || a.stage.exportOwner || document.getElementById('app').inert) throw Error('capture leaked lock');
    const stored = await a.reference.store.get(r.manifest.id); if (!stored.media.archive.size) throw Error('archive not persisted');
    let cancel = false; try { await a.reference.capture(input, e => { if (e.phase === 'render') { a.saveLocal().then(v => { if (v) throw Error('temporary export state autosaved'); }); a.reference.cancel(); } }); } catch (e) { cancel = /取消/.test(e.message); }
    if (!cancel || a.exporter.running || a.stage.exportOwner || a.reference.busy || JSON.stringify(a.serialize({ assets: false })) !== before) throw Error('cancel leaked state');
    const oldStep = a.step; let failure = false; a.step = () => { throw Error('injected reference failure'); }; try { await a.reference.capture(input); } catch (e) { failure = /injected/.test(e.message); } finally { a.step = oldStep; }
    if (!failure || a.reference.busy || a.exporter.running || a.stage.exportOwner) throw Error('failure cleanup');
    let stale = false; try { await a.reference.capture(input, e => { if (e.phase === 'render') o.params.externalRevision = 1; }); } catch (e) { stale = /工程已变化/.test(e.message); } delete o.params.externalRevision; if (!stale || a.stage.exportOwner) throw Error('stale source not refused');
    const SO = o.constructor; a.clearAll(); a.terrain.setEnabled(false); a.stage.ground.visible = false;
    const root = new a.stage.world.constructor(), mesh = new a.stage.ground.constructor(new a.stage.ground.geometry.constructor(8, 8), new a.stage.selRing.material.constructor({ color: 0x884422, side: 2 })); root.position.y = 3; root.add(mesh);
    const plane = new SO(a, { root, name: 'Metric plane', type: 'fixture', params: {}, followTerrain: false }); a.objects.push(plane); a.stage.world.add(root);
    const fixed = a.addShot({ name: 'metric depth', pos: [0, 3, 10], quat: [0, 0, 0, 1], focal: 35, duration: .2 }); a.setActiveShot(fixed); fixed.nearClip = .1; fixed.farClip = 100; fixed.aim = 'none'; fixed.handheld = 0;
    const metric = await a.reference.capture({ ...input, duration: .2, subjectId: plane.id });
    const encode = async blob => { const data = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000)); return btoa(binary); };
    window.referenceTestId = r.manifest.id;
    return { metricZip: await encode(metric.archive), manifest: r.manifest, checks: r.checks, bytes: r.archive.size, zip: await new Promise(async resolve => { const data = new Uint8Array(await r.archive.arrayBuffer()); let binary = ''; for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000)); resolve(btoa(binary)); }), cancel, failure, stale, seededCrowdRepeat: true };
  });
  const zipBytes = Buffer.from(out.zip, 'base64'), files = unzipSync(zipBytes); writeFileSync(`.shots/reference-${process.env.TEST_FILE_URL ? 'file' : 'dev'}.zip`, zipBytes); delete out.zip;
  const metric = unzipSync(Buffer.from(out.metricZip, 'base64')); delete out.metricZip;
  const depth = await decodeHeightPNG(metric['frames/00000-depth.png'].buffer), center = 90 * 320 + 160;
  const code = Math.round(depth.data[center] * 65535); out.depthMeters = depthFromCode(code, .1, 100); assert(Math.abs(out.depthMeters - 10) < .005, 'metric depth decode ' + out.depthMeters);
  const idPNG = metric['frames/00000-id.png'], id = await decodeHeightPNG(idPNG.buffer, { channel: 'blue' }); assert.equal(Math.round(id.data[center] * 255), 1);
  const maskPNG = metric['frames/00000-subject.png'], mask = await decodeHeightPNG(maskPNG.buffer); assert.equal(mask.data[center], 1);
  assert.equal(out.manifest.settings.frames, 3); assert.equal(out.manifest.frameFiles.length, 3);
  for (const entry of out.manifest.files) { assert.equal(files[entry.path].length, entry.bytes); assert.equal(createHash('sha256').update(files[entry.path]).digest('hex'), entry.sha256); }
  const frames = JSON.parse(strFromU8(files['camera/frames.json'])).frames; assert.equal(frames.length, 3); assert.equal(frames[2].time, .4);
  for (const f of frames) { assert(f.position.every(Number.isFinite)); assert(f.projectionMatrix.every(Number.isFinite)); assert(f.intrinsics.fx > 0); }
  assert(files['source/project.previz'].length > 0); assert(files['frames/00000-depth.png']); assert(files['frames/00002-subject.png']);
  const suffix = process.env.TEST_FILE_URL ? 'file' : 'dev';
  for (const mode of ['normal', 'gray']) {
    const path = `.shots/reference-${suffix}-${mode}.webm`; writeFileSync(path, files[`${mode}.webm`]);
    if (process.env.FFMPEG) { const d = spawnSync(process.env.FFMPEG, ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 * 1024 * 1024 }); assert.equal(d.status, 0, String(d.stderr)); assert.equal(d.stdout.length, 320 * 180 * 3 * 3); out.decoded ||= {}; const mean = [0, 1, 2].map(i => { const b = d.stdout.subarray(i * 320 * 180 * 3, (i + 1) * 320 * 180 * 3); return b.reduce((a, n) => a + n, 0) / b.length; }); assert(mean.every(n => n > 5), 'black reference frame'); out.decoded[mode] = { frames: 3, meanRGB: mean }; }
  }
  await p.click('[data-page="generate"]'); await p.waitForSelector('[data-reference-setting="version"] option');
  await p.select('[data-reference-setting="version"]', out.manifest.id);
  await p.waitForFunction(id => document.querySelector('[data-reference-video="source"]').getAttribute('src') && document.querySelector('[data-reference-setting="version"]').value === id, {}, out.manifest.id);
  const upload = await p.$('[data-reference-result-file]'); await upload.uploadFile(`.shots/reference-${suffix}-normal.webm`);
  await p.waitForFunction(async id => (await app.reference.store.get(id)).meta.resultName, {}, out.manifest.id);
  await p.select('[data-reference-setting="score-camera"]', '4'); await p.$eval('[data-reference-notes]', e => { e.value = 'human comparison fixture'; });
  await p.click('[data-reference-action="save-review"]');
  const review = await p.evaluate(async id => (await app.reference.store.get(id)).meta, out.manifest.id); assert.equal(review.scores.camera, 4); assert.equal(review.notes, 'human comparison fixture');
  await p.waitForFunction(() => Number.isFinite(document.querySelector('[data-reference-video="result"]').duration));
  await p.$eval('[data-reference-video="source"]', v => { v.currentTime = .2; v.dispatchEvent(new Event('seeking')); });
  assert(Math.abs(await p.$eval('[data-reference-video="result"]', v => v.currentTime) - .2) < .11);
  out.review = { persisted: true, localVideo: true, synchronized: true };
  if (!process.env.TEST_FILE_URL) { await p.$eval('.reference-gateway', e => { e.open = true; }); await p.click('[data-reference-action="gateway-discover"]'); await p.waitForFunction(() => document.querySelector('.reference-gateway').textContent.includes('未配置')); assert.match(await p.$eval('.reference-gateway', e => e.textContent), /未配置/); }
  if (!process.env.TEST_FILE_URL) {
    let posts = 0, queries = 0; const payloads = [];
    p.on('dialog', dialog => dialog.accept()); await p.setRequestInterception(true);
    p.on('request', request => {
      const url = new URL(request.url()); if (!url.pathname.startsWith('/api/reference-jobs')) return request.continue();
      let data;
      if (url.pathname.endsWith('/capabilities')) data = { version: 1, configured: true, provider: 'UI contract fixture (not vendor)', model: 'fixture', inputs: { text: true, 'first-last': true, video: false } };
      else if (request.method() === 'POST') { posts++; payloads.push(request.postData() || 'multipart-file-body'); data = { id: 'ui-fixture-job', status: 'queued' }; }
      else { queries++; data = { id: 'ui-fixture-job', status: 'failed', message: 'intentional fixture, no inference' }; }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await p.click('[data-reference-action="gateway-discover"]'); await p.waitForFunction(() => document.querySelector('.reference-gateway').textContent.includes('UI contract fixture'));
    await p.select('[data-reference-setting="gatewayMode"]', 'first-last');
    await p.$eval('[data-reference-action="gateway-submit"]', e => { e.click(); e.click(); });
    await p.waitForFunction(async id => (await app.reference.store.get(id)).meta.generation?.status === 'failed', {}, out.manifest.id);
    assert.equal(posts, 1); assert.equal(queries, 1);
    await p.click('[data-reference-action="version-clone"]'); await p.waitForFunction(id => document.querySelector('[data-reference-setting="version"]').value !== id, {}, out.manifest.id);
    const clone = await p.evaluate(async () => (await app.reference.store.get(document.querySelector('[data-reference-setting="version"]').value)).meta);
    assert.equal(clone.derivedFrom, out.manifest.id); assert.equal(clone.generation, null); assert.equal(clone.resultName, null);
    out.gateway = { contractOnly: true, posts, queries, duplicateRefused: true, clonePreservesOriginal: true };
  }
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__previzBooted && window.app?.reference, { timeout: 90000 });
  assert.equal(await p.evaluate(async id => (await app.reference.store.get(id)).meta.scores.camera, out.manifest.id), 4);
  await p.click('[data-page="export"]'); await p.screenshot({ path: `.shots/reference-tools-${suffix}.png` });
  assert.deepEqual(errors, []); writeFileSync(`.shots/reference-${suffix}.json`, JSON.stringify({ ...out, frames, errors }, null, 2)); console.log('PASS reference bundle', JSON.stringify({ ...out, frames: frames.length, errors }, null, 2));
} finally { await browser.close(); }
