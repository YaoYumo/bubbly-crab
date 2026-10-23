import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// FFmpeg must be supplied explicitly; a nonempty Blob is NOT video acceptance.
const ffmpeg = process.env.FFMPEG;
assert.ok(ffmpeg, 'Set FFMPEG to a real native decoder executable');
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000 });
const errors = [];
const folder = process.env.EVIDENCE_DIR || '.shots/cold-export';
mkdirSync(folder, { recursive: true });
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'log') console.log('BROWSER', m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1100, height: 760 });
  if (process.env.TEST_FILE_URL?.startsWith('file:')) await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1&benchmark=1');
  await page.waitForFunction(() => window.__previzBooted && window.app?.renderEffects);
  const result = await page.evaluate(async ({ seconds, width, height, fps }) => {
    const a = window.app;
    const s = a.stage, ex = a.exporter, lod = a.renderEffects.lod, index = s.pickIndex;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    a.suspended = true; a._quietAdd = true; a._suspendUndo = true;
    a.clearAll(); a.terrain.setEnabled(false);
    const building = 'house:adobe:Adobe 土坯平顶房';
    check(a.itemByKey(building)?.type === 'adobe', 'fixture asset missing');
    for (let i = 0; i < 12; i++) a.addAsset(building, [(i % 4) * 20 - 30, 0, Math.floor(i / 4) * 20 - 20], { merge: true });
    a.select(null); a.bus.emit('objects');
    s.orbit.enableDamping = false;
    s.renderer.setPixelRatio(1); s.renderer.setSize(480, 300, false); s.w = 480; s.h = 300;
    s.view.aspect = 1.6; s.view.position.set(0, 90, 310); s.orbit.target.set(0, 2, 0); s.orbit.update();
    a.lighting.physical.configure({ sunElev: 48, shadows: false, fog: 0 });
    a.localLights.configure({ enabled: false });
    s.setGridVisible(false);
    const originals = [];
    for (const so of a.objects) so.root.traverse((n) => { if (n.isMesh) originals.push([n, n.geometry]); });
    const ids = a.objects.map((o) => o.id).join('|');
    const legacy = () => {
      s.raycaster.setFromCamera(s.pointer, s.view);
      return s.raycaster.intersectObjects([s.world, s.helperLayer], true);
    };
    function compare() {
      s.scene.updateMatrixWorld(true); s.view.updateMatrixWorld(true);
      for (let y = -0.7; y <= 0.7; y += 0.35) for (let x = -0.8; x <= 0.8; x += 0.2) {
        s.pointer.set(x, y); const expected = legacy(), actual = index.intersections(s.raycaster);
        // Ignore leaves that production's resolvePick also ignores.
        const relevant = (hits) => hits.filter((h) => !h.object.userData.pickIgnore && !h.object.userData.terrain);
        const e = relevant(expected), v = relevant(actual);
        check(e.length === v.length && e.every((h, i) => h.object === v[i].object && Math.abs(h.distance - v[i].distance) < 1e-8), 'cold/warm exact hits differ');
      }
    }
    index.invalidate('acceptance cold');
    compare(); const coldPick = { ...index.stats };
    check(index.work.jobs.size > 0 && coldPick.fallbackRoots >= 12, 'cold query performed synchronous bounds preparation');
    await index.prewarm(); compare(); const warmPick = { ...index.stats };
    check(warmPick.indexedRoots >= 12 && !warmPick.cold, 'idle index did not become ready');
    const cached = index.localCache.get(a.objects[0].root);
    a.objects[0].root.position.x += 3; a.bus.emit('gizmo-live'); compare();
    check(index.localCache.get(a.objects[0].root) === cached, 'root transform discarded local bounds');
    a.bus.emit('objects'); compare();
    check(index.work.jobs.size > 0 && index.stats.fallbackRoots >= 12, 'deep edit did not use fallback');
    await index.prewarm(); compare();
    // Revoked in-flight build cannot publish old bounds after a later edit.
    index.invalidate('first generation'); index.work.slice(); index.invalidate('second generation');
    await index.prewarm(); compare();
    lod.configure({ enabled: true });
    const start = performance.now(); s.render(); const coldLodMs = performance.now() - start;
    check(lod.cache.size === 0 && lod.work.jobs.size > 0 && lod.stats.builds === 0, 'render performed synchronous LOD build');
    await lod.work.drain(); s.render();
    check(lod.stats.simplifiedMeshes > 0, 'idle LOD not applied');
    const cacheSize = lod.cache.size, bytes = lod.bytes;
    for (const event of ['gizmo-live', 'terrain', 'light']) a.bus.emit(event);
    s.render();
    check(lod.cache.size === cacheSize && lod.bytes === bytes && !lod.work.jobs.size, 'transform/light/terrain discarded valid LOD');
    a.bus.emit('objects'); await lod.work.drain(); s.render();
    check(lod.cache.size === cacheSize && lod.bytes === bytes, 'unchanged object event discarded LOD');
    const cold = { pick: coldPick, warm: warmPick, lodRenderMs: coldLodMs, lodIdle: { ...lod.work.stats }, cachedGeometries: cacheSize, bytes };

    const shot = a.addShot({ name: 'Long moving acceptance', duration: seconds, iso: 800,
      keys: [ { t: 0, p: [-55, 36, 90], q: [0, 0, 0, 1] }, { t: 1, p: [55, 36, 90], q: [0, 0, 0, 1] } ] });
    shot.aim = 'target'; shot.targetId = a.objects[5].id;
    shot.dofEnabled = false;
    a.select(null); a.state.duration = seconds; a.state.time = 1.25;
    a.state.playing = true; a.state.preview = false; s.preview = false;
    a.state.aspect = '2.39'; a.updateAspectOverlay();
    // Preserve deliberately non-default state, including custom guide visibility.
    shot.helper.visible = false; s.frame.style.display = 'none';
    a.renderEffects.configure({ bloom: { enabled: true, quality: 'low', strength: .35 } });
    await lod.prewarm();
    a.step(0, true); s.render();
    const before = () => JSON.stringify({
      suspended: a.suspended, preview: a.state.preview, stagePreview: s.preview, playing: a.state.playing, time: a.state.time,
      helpers: a.state.showHelpers, w: s.w, h: s.h, size: s.renderer.getSize(s.pointer.clone()).toArray(),
      pr: s.renderer.getPixelRatio(), aspect: s.aspect, frame: s.frame.className + s.frame.style.cssText,
      camera: [s.view.position.toArray(), s.view.quaternion.toArray(), s.view.fov, s.view.aspect, s.view.near, s.view.far, s.view.zoom],
      exposure: s.renderer.toneMappingExposure, iso: a.lighting.isoMultiplier,
      guides: [a.terrain.guides, a.vegetationBrush.guides, a.roadPlanning.guides],
      visible: originals.map(([m]) => m.visible), shotHelper: shot.helper.visible,
      orbit: s.orbit.enabled, focus: s.previewControls.focus.toArray(), exportRect: s.exportRect ?? null,
    });
    const initial = before(), serialized = JSON.stringify(a.serialize({ assets: false }));
    const restored = (label) => {
      check(before() === initial, label + ': scene/camera/playing/size/guides restoration mismatch\n' + before() + '\n' + initial);
      check(!ex.running && !s.exporting && !lod.rendering && !a.modelInstancing.rendering, label + ': transaction leaked');
      check(originals.every(([m, g]) => m.geometry === g), label + ': source geometry replaced');
      check(a.objects.map((o) => o.id).join('|') === ids && JSON.stringify(a.serialize({ assets: false })) === serialized, label + ': project mutated');
      check(tracks.every((t) => t.readyState === 'ended'), label + ': capture track leaked');
      check(encoders.every((e) => e.state === 'closed') && videoFrames.every((f) => f.codedWidth === 0), label + ': encoder/frame leaked');
    };
    const tracks = [], downloads = [], urls = new Set(), encoders = [], videoFrames = [];
    const NativeEncoder = window.VideoEncoder, NativeFrame = window.VideoFrame;
    if (NativeEncoder) window.VideoEncoder = class extends NativeEncoder { constructor(options) { super(options); encoders.push(this); } };
    if (NativeFrame) window.VideoFrame = class extends NativeFrame { constructor(...args) { super(...args); videoFrames.push(this); } };
    const nativeCapture = s.canvas.captureStream.bind(s.canvas), nativeClick = HTMLAnchorElement.prototype.click;
    const nativeCreate = URL.createObjectURL.bind(URL), nativeRevoke = URL.revokeObjectURL.bind(URL);
    s.canvas.captureStream = (...args) => { const stream = nativeCapture(...args); tracks.push(...stream.getTracks()); return stream; };
    HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); else nativeClick.call(this); };
    URL.createObjectURL = (blob) => { const u = nativeCreate(blob); urls.add(u); return u; };
    URL.revokeObjectURL = (u) => { urls.delete(u); nativeRevoke(u); };
    console.log('cold checks done; failure injection');
    const failures = [];
    for (const kind of ['capture', 'construct', 'start', 'render', 'progress', 'recorder-error', 'stop-timeout']) {
      const nativeRecorder = window.MediaRecorder, render = s.renderFramed, capture = s.canvas.captureStream;
      if (kind === 'capture') s.canvas.captureStream = () => { throw Error('injected capture'); };
      if (kind === 'construct') window.MediaRecorder = class extends nativeRecorder { constructor() { throw Error('injected construct'); } };
      if (kind === 'start') window.MediaRecorder = class extends nativeRecorder { start() { throw Error('injected start'); } };
      if (kind === 'recorder-error') window.MediaRecorder = class extends nativeRecorder { start(...args) { super.start(...args); setTimeout(() => this.onerror?.({ error: Error('injected recorder-error') }), 10); } };
      if (kind === 'stop-timeout') window.MediaRecorder = class extends nativeRecorder { stop() { this.onstop = null; super.stop(); } };
      if (kind === 'render') s.renderFramed = () => { throw Error('injected render'); };
      const r = await ex.run({ encoder: 'mediarecorder', width: 320, height: 180, fps: 10, duration: .3 }, () => { if (kind === 'progress') throw Error('injected progress'); });
      window.MediaRecorder = nativeRecorder; s.renderFramed = render; s.canvas.captureStream = capture;
      check(r?.error && !r.size && !ex.last && downloads.length === 0, kind + ': failure published/downloaded');
      restored(kind); failures.push({ kind, error: r.error });
    }
    if (NativeEncoder) for (const kind of ['construct', 'configure', 'encode', 'flush', 'async-error']) {
      const Encoder = window.VideoEncoder;
      window.VideoEncoder = class extends Encoder {
        constructor(options) { if (kind === 'construct') throw Error('injected codec construct'); super(options);
          if (kind === 'async-error') setTimeout(() => options.error(Error('injected codec async-error')), 10);
        }
        configure(...args) { if (kind === 'configure') throw Error('injected codec configure'); return super.configure(...args); }
        encode(...args) { if (kind === 'encode') throw Error('injected codec encode'); return super.encode(...args); }
        flush() { if (kind === 'flush') return Promise.reject(Error('injected codec flush')); return super.flush(); }
      };
      const r = await ex.run({ width: 320, height: 180, fps: 10, duration: .3 });
      window.VideoEncoder = Encoder;
      check(r?.error && !r.size && !ex.last && !downloads.length, 'codec failure published');
      restored('codec ' + kind); failures.push({ kind: 'codec-' + kind, error: r.error });
    }
    const pngRender = s.renderFramed;
    s.renderFramed = () => { throw Error('injected PNG'); };
    check(await ex.still({ asDataUrl: true }) === null, 'PNG failure did not report');
    s.renderFramed = pngRender; restored('PNG failure');
    const cancelled = await ex.run({ width: 320, height: 180, fps: 10, duration: 4 }, (p) => { if (p.phase === 'render' && p.i === 3) ex.cancel(); });
    check(cancelled.cancelled && cancelled.frames === 3 && !cancelled.size && !ex.last && !downloads.length, 'cancel downloaded/retried/replaced last or miscounted');
    restored('cancel');
    const golden = [];
    for (const frame of [0, Math.floor(seconds * fps / 2), Math.round(seconds * fps) - 1]) {
      a.state.time = frame / fps;
      golden.push({ frame, data: await ex.still({ width, height, asDataUrl: true }) });
    }
    a.state.time = 1.25; restored('golden captures');
    console.log('failure/cancel checks done; long video');
    const longProgress = [], frameDiagnostics = [];
    const running = ex.run({ width, height, fps, duration: seconds, bitrate: 4 }, (p) => { if (p.phase === 'render') { longProgress.push(p.i); if ([1, Math.floor(seconds * fps / 2) + 1, Math.round(seconds * fps)].includes(p.i)) frameDiagnostics.push({ i: p.i, time: a.state.time, canvas: [s.canvas.width, s.canvas.height], size: s.renderer.getSize(s.pointer.clone()).toArray(), viewport: Array.from(s.renderer.getContext().getParameter(s.renderer.getContext().VIEWPORT)), rect: { ...s.exportRect }, camera: [s.view.position.toArray(), s.view.quaternion.toArray(), s.view.fov, s.view.aspect] }); } });
    check(await new ex.constructor(a).run({ duration: .3 }) === null && await ex.run({ duration: .3 }) === null && await ex.still({ asDataUrl: true }) === null, 'concurrent export admitted');
    const long = await running;
    check(long?.size > 0 && long.frames === Math.round(seconds * fps) && longProgress.length === long.frames, 'long export failed: ' + JSON.stringify(long));
    restored('long success');
    const files = [];
    const pack = async (r, label) => {
      const data = new Uint8Array(await r.blob.arrayBuffer());
      let str = ''; for (let i = 0; i < data.length; i += 8192) str += String.fromCharCode(...data.subarray(i, i + 8192));
      const { blob, url, ...meta } = r;
      files.push({ ...meta, label, base64: btoa(str) });
    };
    await pack(long, 'long');
    console.log('long video done; repeated exports');
    const resourceSamples = [];
    for (let i = 0; i < 4; i++) {
      const r = await ex.run({ width: 480, height: 270, fps: 15, duration: 1, bitrate: 2 });
      check(r?.size > 0, 'repeat failed'); restored('repeat ' + i);
      await pack(r, 'repeat-' + i);
      await sleep(2100); // temporary download URLs expire after 2 seconds
      resourceSamples.push({ ...s.renderer.info.memory, urls: urls.size, liveTracks: tracks.filter((t) => t.readyState !== 'ended').length, lodBytes: lod.bytes });
      check(urls.size === 1, 'URLs did not plateau at last successful result');
    }
    check(resourceSamples.every((v) => v.geometries === resourceSamples[0].geometries && v.textures === resourceSamples[0].textures && !v.liveTracks && v.lodBytes === resourceSamples[0].lodBytes), 'consecutive export resources grew');
    const last = ex.last;
    await ex.run({ width: 320, height: 180, duration: 1, fps: 10 }, (p) => { if (p.phase === 'render') ex.cancel(); });
    check(ex.last === last && downloads.length === 5, 'cancel replaced successful result'); restored('cancel after success');
    // PNG data/download parity and real image decode, with guides hidden in both paths.
    const png = await ex.still({ width: 480, height: 270, asDataUrl: true }); restored('PNG data');
    const pngBlob = await ex.still({ width: 480, height: 270 }); restored('PNG download');
    const image = await createImageBitmap(pngBlob);
    const pngSize = { width: image.width, height: image.height }; image.close();
    check(png.startsWith('data:image/png') && pngSize.width === 480 && pngSize.height === 270, 'PNG decode failed');
    check(await pngBlob.text() === await (await fetch(png)).text(), 'PNG entry pixels differ');
    window.VideoEncoder = NativeEncoder; window.VideoFrame = NativeFrame;
    // A normal live editor (not initially suspended) is restored too.
    a.suspended = false;
    const liveResult = await ex.run({ width: 320, height: 180, fps: 10, duration: .2 });
    check(liveResult?.size && !a.suspended, 'initially-live editor stayed suspended');
    a.suspended = true; restored('initially live');
    await pack(liveResult, 'live-editor');
    const savedLast = ex.last, savedDownloads = downloads.length;
    const prepareCancel = await ex.run({ duration: 1 }, (p) => { if (p.phase === 'prepare') ex.cancel(); });
    check(prepareCancel.cancelled && !prepareCancel.frames && ex.last === savedLast && downloads.length === savedDownloads, 'prepare cancel published/retried');
    restored('prepare cancel');
    // Native batch UI must stop after a cancellation/failure, not mark done or
    // silently start the next queued export. This does not fake the codec tests.
    const realRun = ex.run;
    const buttons = [...document.querySelectorAll('#export-content button')];
    const addQueue = buttons.find((b) => b.textContent.includes('添加当前设置到队列'));
    const startQueue = buttons.find((b) => b.textContent === '开始批量渲染');
    check(addQueue && startQueue, 'native batch UI missing');
    for (let i = 0; i < 3; i++) addQueue.click();
    let batchCalls = 0;
    ex.run = async () => { batchCalls++; return { cancelled: true, size: 0 }; };
    startQueue.click(); await sleep(0); await sleep(0);
    let statuses = [...document.querySelectorAll('.exp-queue .status')].map((n) => n.textContent);
    check(batchCalls === 1 && statuses.join('|') === '已取消|等待中|等待中', 'batch resumed after cancel');
    ex.run = async () => { batchCalls++; return { error: 'injected batch error', size: 0 }; };
    startQueue.click(); await sleep(0); await sleep(0);
    statuses = [...document.querySelectorAll('.exp-queue .status')].map((n) => n.textContent);
    check(batchCalls === 2 && statuses.join('|') === '已取消|失败|等待中', 'batch resumed after failure');
    ex.run = realRun;
    if (ex.last?.url) URL.revokeObjectURL(ex.last.url); ex.last = null;
    await sleep(2100); check(urls.size === 0, 'dispose URL leak');
    s.canvas.captureStream = nativeCapture; HTMLAnchorElement.prototype.click = nativeClick;
    URL.createObjectURL = nativeCreate; URL.revokeObjectURL = nativeRevoke;
    return { entry: location.protocol, browser: navigator.userAgent, renderer: s.renderer.getContext().getParameter(s.renderer.getContext().RENDERER),
      target: { seconds, width, height, fps }, cold, failures, cancelled, longProgress: { count: longProgress.length, first: longProgress[0], last: longProgress.at(-1) },
      resourceSamples, pngSize, files, golden, frameDiagnostics, bloom: a.renderEffects.snapshot().bloom, encodersClosed: encoders.length, framesClosed: videoFrames.length, checks: ['cold fallback/warm precise hit equality', 'transform reuse/deep invalidation/stale-job cancellation', 'no LOD geometry build in render', 'idle warm/cache retention', '7 recorder + 5 WebCodecs injected failure paths', 'PNG failure restoration', 'cancel/no retry/no partial download', 'same/cross-Exporter + PNG rejection', 'prepare cancel', 'initially-live restoration', 'native batch cancel/failure stops', 'full state and original source restoration', 'long moving shot', 'four consecutive exports/resource plateau', 'last-good preservation', 'PNG parity/real decode'] };
  }, { seconds: Number(process.env.VIDEO_SECONDS || 30), width: Number(process.env.VIDEO_WIDTH || 1280), height: Number(process.env.VIDEO_HEIGHT || 720), fps: Number(process.env.VIDEO_FPS || 30) });
  assert.deepEqual(errors, []);
  writeFileSync(`${folder}/raw-${result.entry === 'file:' ? 'file' : 'dev'}.json`, JSON.stringify(result, null, 2));
  const entry = result.entry === 'file:' ? 'file' : 'dev';
  for (const file of result.files) {
    const path = `${folder}/${entry}-${file.label}.${file.ext}`;
    const data = Buffer.from(file.base64, 'base64'); writeFileSync(path, data); delete file.base64;
    const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-map', '0:v:0', '-an', '-vsync', '0', '-enc_time_base', '-1', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(decoded.status, 0, `decode failed: ${decoded.stderr}`);
    assert.equal(decoded.stderr, '', 'decoder reported corrupt data');
    const lines = decoded.stdout.split('\n');
    const frames = lines.filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').map((s) => s.trim()));
    const timeBase = lines.find((l) => l.startsWith('#tb 0:')).split(':')[1].trim().split('/').map(Number);
    const [num, den] = timeBase;
    const pts = frames.map((f) => Number(f[2]) * num / den);
    const sizeLine = lines.find((l) => l.startsWith('#dimensions 0:'));
    assert.ok(sizeLine.includes(`${file.width}x${file.height}`), 'decoded dimensions differ');
    assert.ok(file.mode === 'webcodecs' ? frames.length === file.frames : frames.length >= Math.floor(file.frames * .8), 'more than 20% requested frames missing');
    assert.ok(pts.every((v, i) => !i || v > pts[i - 1]), 'non-monotonic frame timestamps');
    if (file.mode === 'webcodecs') assert.ok(pts.every((t, i) => Math.abs(t - i / file.fps) <= .0011), 'fixed frame PTS drift');
    const duration = pts.at(-1) + (Number(frames.at(-1)[3]) * num / den || 1 / file.fps);
    if (file.mode === 'webcodecs') assert.ok(Math.abs(duration - file.seconds) <= .0011, 'fixed output duration drift');
    assert.ok(duration >= file.seconds * .8 && duration <= file.seconds * 1.5 + .5, 'decoded duration out of acceptance bounds');
    const unique = new Set(frames.map((f) => f.at(-1))).size;
    assert.ok(unique > Math.min(10, frames.length / 2), 'video frozen/blank');
    file.decode = { frames: frames.length, distinctFrames: unique, firstPts: pts[0], lastPts: pts.at(-1), duration, dimensions: sizeLine, firstHash: frames[0].at(-1), lastHash: frames.at(-1).at(-1), monotonic: true, errors: decoded.stderr, sha256: createHash('sha256').update(data).digest('hex') };
    console.log('DECODE', file.label, JSON.stringify(file.decode));
  }
  const long = result.files[0];
  result.pixelChecks = [];
  for (const golden of result.golden) {
    const png = `${folder}/${entry}-expected-${golden.frame}.png`;
    writeFileSync(png, Buffer.from(golden.data.split(',')[1], 'base64'));
    const decodeRGB = (input, filter = []) => {
      const r = spawnSync(ffmpeg, ['-v', 'error', '-i', input, ...filter, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 32 * 1024 * 1024 });
      assert.equal(r.status, 0, String(r.stderr)); return r.stdout;
    };
    const expected = decodeRGB(png);
    const actual = decodeRGB(`${folder}/${entry}-long.${long.ext}`, ['-vf', `select=eq(n\\,${golden.frame})`, '-vsync', '0']);
    assert.equal(actual.length, expected.length);
    let sum = 0, barsMax = 0, centerSum = 0;
    for (let i = 0; i < actual.length; i++) {
      sum += Math.abs(actual[i] - expected[i]);
      const y = Math.floor(i / (long.width * 3));
      if (y < 8 || y >= long.height - 8) barsMax = Math.max(barsMax, actual[i]); else centerSum += actual[i];
    }
    const meanAbsolute = sum / actual.length;
    console.log('PIXELS', golden.frame, meanAbsolute, barsMax, centerSum);
    assert.ok(meanAbsolute < 6 && barsMax <= 8 && centerSum > 10000, 'decoded frame differs from PNG/framing/black bars');
    result.pixelChecks.push({ frame: golden.frame, meanAbsolute, barsMax, centerSum });
  }
  delete result.golden;
  result.decoder = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
  writeFileSync(`${folder}/${entry}.json`, JSON.stringify(result, null, 2));
  console.log('PASS cold construction + long export', JSON.stringify({ entry, target: result.target, cold: result.cold, failures: result.failures, resources: result.resourceSamples, checks: result.checks }, null, 2));
} finally { await browser.close(); }
