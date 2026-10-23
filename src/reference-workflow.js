import * as THREE from 'three';
import { zip, strToU8 } from 'fflate';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { setWebMDuration } from './webm-duration.js';
import { packProject } from './project-assets.js';
import { buildPrompt, motionJson } from './prompts.js';
import { referenceSettings, REFERENCE_SCHEMA, canonical, sha256, sampleIndices, depthPNG, summaryChecks } from './reference-format.js';
import { ReferencePass } from './reference-pass.js';
import { ReferenceCamera } from './reference-camera.js';
import { ReferenceStore } from './reference-store.js';
const pause = () => new Promise(r => setTimeout(r, 0));
const png = async (pixels, width, height) => {
  const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const b = await new Promise((r, reject) => c.toBlob(b => b ? r(b) : reject(Error('PNG 编码失败')), 'image/png')); return new Uint8Array(await b.arrayBuffer());
};
function pixels(app, w, h) {
  const gl = app.stage.renderer.getContext(); if (gl.isContextLost()) throw Error('WebGL 上下文已丢失');
  const bottom = new Uint8Array(w * h * 4), out = new Uint8Array(bottom.length); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottom);
  for (let y = 0; y < h; y++) out.set(bottom.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4); return out;
}
function runtime(app) {
  const transforms = [], chars = [], properties = [];
  for (const o of app.objects) {
    properties.push([o, '_ty', o._ty]); o.root.traverse(n => transforms.push([n, n.position.clone(), n.rotation.clone(), n.scale.clone()]));
    if (o.root.userData.humans) chars.push({ root: o.root, phase: o.root.userData.animPhase, init: o.root.userData.crowdInit, humans: o.root.userData.humans.map(h => ({ h, ph: h.ph, anim: h.anim, dist: h.dist, w: h.w && { ...h.w } })) });
  }
  return { transforms, chars, properties };
}
function restoreRuntime(r) {
  for (const [n, p, q, s] of r.transforms) { n.position.copy(p); n.rotation.copy(q); n.scale.copy(s); n.updateMatrixWorld(true); }
  for (const [o, k, v] of r.properties) if (v === undefined) delete o[k]; else o[k] = v;
  for (const c of r.chars) {
    c.root.userData.animPhase = c.phase; c.root.userData.crowdInit = c.init;
    for (const v of c.humans) { v.h.ph = v.ph; v.h.anim = v.anim; v.h.dist = v.dist; if (v.w) v.h.w = { ...v.w }; else delete v.h.w; }
  }
}
class ExactVideo {
  constructor(config, codec, signal) {
    this.target = new ArrayBufferTarget(); this.muxer = new Muxer({ target: this.target, video: { codec, width: config.width, height: config.height, frameRate: config.framerate }, firstTimestampBehavior: 'strict' }); this.count = 0; this.error = null; this.signal = signal;
    this.encoder = new VideoEncoder({ output: (chunk, meta) => { try { this.muxer.addVideoChunk(chunk, meta); this.count++; } catch (e) { this.error = e; } }, error: e => { this.error = e; } }); this.encoder.configure(config); this.config = config;
  }
  async add(data, index) {
    const { width, height, framerate: fps } = this.config; this.signal.throwIfAborted(); if (this.error) throw this.error;
    const frame = new VideoFrame(data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round(index * 1e6 / fps), duration: Math.round((index + 1) * 1e6 / fps) - Math.round(index * 1e6 / fps) });
    try { this.encoder.encode(frame, { keyFrame: index % Math.round(fps * 2) === 0 }); } finally { frame.close(); }
    while (this.encoder.encodeQueueSize > 2) { await pause(); this.signal.throwIfAborted(); if (this.error) throw this.error; }
  }
  async finish(count) {
    let timer; try { await Promise.race([this.encoder.flush(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('参考视频编码超时')), 15000); })]); } finally { clearTimeout(timer); }
    this.signal.throwIfAborted(); if (this.error) throw this.error; if (this.count !== count) throw Error('参考视频编码帧数不一致'); this.muxer.finalize(); setWebMDuration(this.target.buffer, count / this.config.framerate * 1000); return new Uint8Array(this.target.buffer);
  }
  dispose() { if (this.encoder.state !== 'closed') this.encoder.close(); }
}
export class ReferenceWorkflow {
  constructor(app) { this.app = app; this.store = new ReferenceStore(); this.busy = false; this.last = null; }
  cancel() { this.controller?.abort(new DOMException('参考包任务已取消', 'AbortError')); }
  async capture(input = {}, onProgress = () => {}) {
    const a = this.app, ex = a.exporter, s = a.stage, settings = referenceSettings(input);
    if (!a.activeShot) throw Error('请先创建并选择一个机位');
    if (a.cameraEdit?.enabled && a.cameraEdit.clips.length) throw Error('参考包仍按单机位生成，请先关闭时间轴「剪辑预览」；整段镜头剪辑请使用视频导出');
    if (this.busy || a.behaviors?.busy || ex.running || s.exportOwner || s.exporting || a.aiScene?.busy || a.terrain.workflow.busy || a.terrain.workflow.erosionPreview || a.state.playing) throw Error('请先停止播放、导出或地形任务，并应用 / 放弃侵蚀预览');
    if (!globalThis.VideoEncoder || !globalThis.VideoFrame) throw Error('参考包需要支持 WebCodecs 的 Chrome / Edge 安全上下文；不会回退成不精确的实时录制');
    const controller = this.controller = new AbortController(), signal = controller.signal; this.busy = true; ex.running = true; s.exportOwner = this;
    const lockKeys = event => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
      else if (!event.target?.closest?.('.reference-job-overlay') || !['Tab', 'Enter', ' '].includes(event.key)) event.preventDefault();
    };
    window.addEventListener('keydown', lockKeys, true);
    const originalSuspended = a.suspended; a.suspended = true; const shot = a.activeShot;
    let saved, pose, pass, normal, gray, oldLOD, oldSelection, before, source, project; const oldSelected = s.selected;
    const appRoot = document.getElementById('app'), wasInert = appRoot?.inert; if (appRoot) appRoot.inert = true;
    try {
      await a.terrain.workflow.ready(); await a.projectAssets.ready(); signal.throwIfAborted();
      saved = ex.snapshot(); pose = runtime(a); source = JSON.parse(JSON.stringify(a.serialize())); before = await sha256(canonical(a.serialize({ assets: false })));
      project = await packProject(a); signal.throwIfAborted();
      let config, codec;
      for (const [c, mux] of [['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']]) {
        const candidate = { codec: c, width: settings.width, height: settings.height, framerate: settings.fps, bitrate: 4000000, latencyMode: 'quality' };
        if ((await VideoEncoder.isConfigSupported(candidate)).supported) { config = candidate; codec = mux; break; }
      }
      if (!config) throw Error('当前浏览器没有可用的逐帧 VP9 / VP8 编码器');
      oldLOD = a.renderEffects.lod.settings; a.renderEffects.lod.settings = { ...oldLOD, enabled: false }; oldSelection = a.renderEffects.selectionRendering;
      s.selected = null; ex.setup(settings.width, settings.height); a.state.duration = settings.duration;
      if (s.exportRect.vw % 1 || s.exportRect.vh % 1) throw Error('无效取景范围');
      pass = new ReferencePass(a, settings.width, settings.height); pass.subjectId = settings.subjectId || shot.target?.id || '';
      const camera = new ReferenceCamera(a, pass.subjectId), frames = [], keys = sampleIndices(settings.frames), files = {}, frameFiles = [];
      files['source/project.previz'] = project; files['source/scene.json'] = strToU8(JSON.stringify(source)); files['camera/keyframes.json'] = strToU8(JSON.stringify(motionJson(a), null, 2));
      if (a.aiScene?.lastApplied) files['source/ai-scene-application.json'] = strToU8(JSON.stringify({ ...a.aiScene.lastApplied, capturedFingerprint: before, sourceChangedSinceApply: a.aiScene.lastApplied.resultFingerprint !== before }));
      files['prompt.txt'] = strToU8(buildPrompt(a).text); normal = new ExactVideo(config, codec, signal); gray = new ExactVideo(config, codec, signal);
      let randomState = settings.seed >>> 0;
      const rand = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
      const initialRuntime = pose.chars.map(c => ({ id: a.objects.find(o => o.root === c.root)?.id, phase: c.phase ?? 0, crowdInit: !!c.init, humans: c.humans.map(v => ({ ph: v.ph, anim: v.anim, dist: v.dist, w: v.w })), nodes: pose.transforms.filter(([n]) => { for (let p = n; p; p = p.parent) if (p === c.root) return true; return false; }).map(([n, position, rotation, scale], index) => ({ index, name: n.name, position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray() })) }));
      files['source/character-runtime.json'] = strToU8(JSON.stringify(initialRuntime));
      for (let i = 0; i < settings.frames; i++) {
        signal.throwIfAborted(); if (a.activeShot !== shot) throw Error('活动机位已变化，参考包已停止');
        a.state.time = i / settings.fps;
        const oldRandom = Math.random; try { Math.random = rand; a.step(1 / settings.fps, true); } finally { Math.random = oldRandom; }
        ex.setGuides(false); s.helperLayer.visible = false; for (const sh of a.shots) sh.body.visible = false;
        // All channels use original geometry, no LOD/proxy substitution; one simulation step only.
        a.renderEffects.selectionRendering = true; try { s.renderFramed(s.exportRect); } finally { a.renderEffects.selectionRendering = oldSelection; }
        const rgba = pixels(a, settings.width, settings.height); await normal.add(rgba, i);
        const g = pass.render('gray'); await gray.add(g, i);
        frames.push(camera.sample(i, settings.fps, i % Math.max(1, Math.floor(settings.fps / 6)) === 0 || keys.includes(i)));
        if (keys.includes(i)) {
          const name = String(i).padStart(5, '0'), base = `frames/${name}`;
          files[base + '-normal.png'] = await png(rgba, settings.width, settings.height); files[base + '-gray.png'] = await png(g, settings.width, settings.height);
          const entry = { frame: i, time: i / settings.fps, normal: base + '-normal.png', gray: base + '-gray.png' };
          if (settings.channels) {
            entry.depth = base + '-depth.png'; entry.id = base + '-id.png'; files[entry.depth] = depthPNG(settings.width, settings.height, pass.render('depth')); files[entry.id] = await png(pass.render('id'), settings.width, settings.height);
            if (pass.subjectId) { entry.subject = base + '-subject.png'; files[entry.subject] = await png(pass.render('subject'), settings.width, settings.height); }
          }
          frameFiles.push(entry);
        }
        onProgress({ phase: 'render', i: i + 1, total: settings.frames }); await pause();
      }
      files['normal.webm'] = await normal.finish(settings.frames); files['gray.webm'] = await gray.finish(settings.frames); signal.throwIfAborted();
      files['camera/frames.json'] = strToU8(JSON.stringify({ convention: 'right-handed Y-up meters; camera forward -Z; matrices column-major; timestamps frame starts', fps: settings.fps, frames }));
      const checks = summaryChecks(frames, settings.fps); files['checks.json'] = strToU8(JSON.stringify(checks, null, 2)); files['objects.json'] = strToU8(JSON.stringify(pass.ids, null, 2));
      const manifest = { schema: REFERENCE_SCHEMA, id: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceFingerprint: before, shot: { id: shot.id, name: shot.name, subjectId: pass.subjectId }, settings, codec: config.codec,
        encodedDuration: settings.frames / settings.fps, lastFrameTime: (settings.frames - 1) / settings.fps, sampling: 'frame starts i/fps; last image is the final encoded frame, NOT mathematical t=duration',
        frameFiles, channels: { videos: ['normal', 'gray'], diagnostics: settings.channels ? ['depth16-keyframes', 'object-id-keyframes', ...(pass.subjectId ? ['subject-mask-keyframes'] : [])] : [], depth: { encoding: 'PNG grayscale16 big endian; 0=background, 1..65535=near..far', axis: 'positive camera-view Z distance, NOT radial range', decode: 'meters = near + (code-1)/65534*(far-near); per-frame clips in camera/frames.json' }, policy: 'Gray/depth/ID omit fx, water, rivers, sky and unsupported ShaderMaterial; alpha-tested cutouts retained, translucency threshold .5; one ID per object/vegetation patch, no per-instance or bone IDs. Diagnostic keyframes only, not full sequences. Gray has fixed neutral lighting, no DOF/Bloom.' },
        runtime: { seededCrowd: true, weather: 'frozen particles (no weather stepping)', lod: false }, files: [] };
      let bytes = 0; for (const [path, data] of Object.entries(files)) { bytes += data.byteLength; if (bytes > 160 * 1024 * 1024) throw Error('参考包超过 160MB 内存保护上限，请降低规格'); manifest.files.push({ path, bytes: data.byteLength, sha256: await sha256(data) }); signal.throwIfAborted(); }
      files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
      // Restore BEFORE fingerprinting: a programmatic edit during a yield must not produce a mixed-version artifact.
      a.renderEffects.lod.settings = oldLOD; ex.restore(saved); restoreRuntime(pose); saved = null;
      if (await sha256(canonical(a.serialize({ assets: false }))) !== before) throw Error('生成期间工程已变化，未发布混合版本参考包，请重试');
      onProgress({ phase: 'zip', i: settings.frames, total: settings.frames });
      const archive = await new Promise((resolve, reject) => { const stop = zip(files, { level: 0 }, (err, bytes) => { signal.removeEventListener('abort', abort); err ? reject(err) : resolve(bytes); }); const abort = () => { stop(); reject(signal.reason); }; if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }); signal.throwIfAborted();
      const result = { manifest, checks, archive: new Blob([archive], { type: 'application/zip' }), normal: new Blob([files['normal.webm']], { type: 'video/webm' }), gray: new Blob([files['gray.webm']], { type: 'video/webm' }), first: new Blob([files[frameFiles[0].normal]], { type: 'image/png' }), last: new Blob([files[frameFiles.at(-1).normal]], { type: 'image/png' }), prompt: buildPrompt(a).text };
      const meta = { id: manifest.id, createdAt: manifest.createdAt, name: shot.name, sourceFingerprint: before, manifest, prompt: new TextDecoder().decode(files['prompt.txt']), scores: {}, notes: '', generation: null };
      try { await this.store.save(meta, result); result.saved = true; } catch (e) { result.saved = false; result.storageWarning = e.message; a.notify('参考包已生成，但本地版本保存失败：' + e.message + '。请立即下载 ZIP。', 'warn'); }
      this.last = result; a.bus.emit('reference-versions'); return result;
    } finally {
      try { if (oldLOD) a.renderEffects.lod.settings = oldLOD; if (saved) ex.restore(saved); }
      finally { if (pose) restoreRuntime(pose); if (oldSelection !== undefined) a.renderEffects.selectionRendering = oldSelection; pass?.dispose(); normal?.dispose(); gray?.dispose(); a.suspended = originalSuspended; if (appRoot) appRoot.inert = wasInert; window.removeEventListener('keydown', lockKeys, true); this.busy = false; this.controller = null; ex.running = false; if (s.exportOwner === this) delete s.exportOwner; s.selected = oldSelected; }
    }
  }
}
