import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
assert.ok(process.env.FFMPEG, 'FFMPEG is required for real compatibility-video decoding');
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 120000 });
try {
  const p = await browser.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  if (process.env.TEST_FILE_URL?.startsWith('file:')) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1&benchmark=1');
  await p.waitForFunction(() => window.__previzBooted && window.app?.exporter);
  const result = await p.evaluate(async () => {
    const a = app, s = a.stage, ex = a.exporter, check = (v, m) => { if (!v) throw Error(m); };
    a.suspended = true; a._suspendUndo = true; a.clearAll(); a.terrain.setEnabled(false);
    s.renderer.setPixelRatio(1); s.renderer.setSize(320, 180, false); s.w = 320; s.h = 180;
    s.render();
    const tracks = [], nativeCapture = s.canvas.captureStream.bind(s.canvas), NativeRecorder = MediaRecorder;
    const click = HTMLAnchorElement.prototype.click; let downloads = 0;
    HTMLAnchorElement.prototype.click = function () { downloads++; };
    let missingRequest = false; const streamProbes = [];
    s.canvas.captureStream = (...args) => {
      const stream = nativeCapture(...args);
      tracks.push(...stream.getTracks());
      streamProbes.push({ fps: args[0], manual: typeof stream.getVideoTracks()[0]?.requestFrame === 'function' });
      if (missingRequest) for (const track of stream.getVideoTracks()) Object.defineProperty(track, 'requestFrame', { value: undefined });
      return stream;
    };
    const files = [];
    for (const auto of [false, true]) {
      missingRequest = auto;
      const phases = [], probeAt = streamProbes.length;
      const r = await ex.run({ encoder: 'mediarecorder', format: 'webm', width: 320, height: 180, fps: 5, duration: 1, bitrate: 1 }, (p) => phases.push(p.phase));
      check(r?.size && r.ext === 'webm' && r.mime.includes('webm'), 'actual MIME/extension mismatch');
      check(auto ? r.mode === 'auto' : r.mode === 'manual' || (r.mode === 'auto' && (phases.includes('retry') || !streamProbes[probeAt].manual)), 'requestFrame compatibility routing failed');
      check(!ex.running && a.suspended && !s.exporting && tracks.every((t) => t.readyState === 'ended'), 'compatibility transaction leaked');
      files.push({ mode: r.mode, requested: auto ? 'missing-requestFrame' : 'manual', phases, ext: r.ext, mime: r.mime, base64: btoa(String.fromCharCode(...new Uint8Array(await r.blob.arrayBuffer()))) });
    }
    missingRequest = false;
    const last = ex.last, priorDownloads = downloads; let retries = 0;
    window.MediaRecorder = class {
      static isTypeSupported(m) { return NativeRecorder.isTypeSupported(m); }
      constructor() { this.state = 'inactive'; this.mimeType = 'video/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
    };
    const empty = await ex.run({ encoder: 'mediarecorder', width: 320, height: 180, fps: 5, duration: .2 }, (p) => { if (p.phase === 'retry') retries++; });
    check(!empty.size && retries === 1 && ex.last === last && downloads === priorDownloads && tracks.every((t) => t.readyState === 'ended'), 'empty retry lost last-good/created download/leaked stream');
    window.MediaRecorder = NativeRecorder;
    s.canvas.captureStream = nativeCapture; HTMLAnchorElement.prototype.click = click;
    URL.revokeObjectURL(ex.last.url); ex.last = null;
    return { entry: location.protocol, streamProbes, files, tracksStopped: tracks.length, retries, checks: ['real manual MediaRecorder WebM', 'missing requestFrame recaptures automatic stream', 'actual MIME/extension', 'all tracks stopped', 'empty retry exactly once/no download/last-good preserved'] };
  });
  assert.deepEqual(errors, []);
  const entry = result.entry === 'file:' ? 'file' : 'dev', dir = '.shots/cold-export-compat'; mkdirSync(dir, { recursive: true });
  for (const f of result.files) {
    const path = `${dir}/${entry}-${f.requested}.${f.ext}`;
    writeFileSync(path, Buffer.from(f.base64, 'base64')); delete f.base64;
    const decoded = spawnSync(process.env.FFMPEG, ['-v', 'error', '-i', path, '-vsync', '0', '-f', 'framemd5', '-'], { encoding: 'utf8' });
    assert.equal(decoded.status, 0, decoded.stderr); assert.equal(decoded.stderr, '');
    const lines = decoded.stdout.split('\n');
    const frames = lines.filter((l) => l && !l.startsWith('#'));
    assert.ok(frames.length >= 2, 'compat video did not decode multiple frames');
    assert.ok(lines.some((l) => l.includes('#dimensions 0: 320x180')), 'compat dimensions');
    f.decodedFrames = frames.length;
  }
  writeFileSync(`${dir}/${entry}.json`, JSON.stringify(result, null, 2));
  console.log('PASS actual MediaRecorder compatibility + empty retry', JSON.stringify(result, null, 2));
} finally { await browser.close(); }
