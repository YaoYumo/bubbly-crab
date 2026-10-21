// ---------------------------------------------------------------------------
// 导出：录制预览画布为视频（手动请求采样 + 自动采样回退），另支持单帧 PNG / 数据导出
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { setWebMDuration } from './webm-duration.js';
import { downloadBlob, clamp } from './util.js';
import { subjectRuntime, restoreSubjects } from './scene-runtime.js';

const MIMES = [
  { m: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', l: 'MP4 / H.264' },
  { m: 'video/mp4', ext: 'mp4', l: 'MP4' },
  { m: 'video/webm;codecs=vp9,opus', ext: 'webm', l: 'WebM / VP9' },
  { m: 'video/webm;codecs=vp9', ext: 'webm', l: 'WebM / VP9' },
  { m: 'video/webm;codecs=vp8', ext: 'webm', l: 'WebM / VP8' },
  { m: 'video/webm', ext: 'webm', l: 'WebM' },
];

export function bestMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of MIMES) {
    try { if (MediaRecorder.isTypeSupported(c.m)) return c; } catch (e) { /* ignore */ }
  }
  return { m: '', ext: 'webm', l: '浏览器默认' };
}

export const RES_PRESETS = [
  { v: '854x480', l: '854×480 · 草稿迭代', w: 854, h: 480 },
  { v: '1280x720', l: '1280×720 · 720p 常用', w: 1280, h: 720 },
  { v: '1920x1080', l: '1920×1080 · 1080p', w: 1920, h: 1080 },
  { v: '1080x1920', l: '1080×1920 · 竖屏短视频', w: 1080, h: 1920 },
  { v: '1920x804', l: '1920×804 · 2.39 宽幅', w: 1920, h: 804 },
  { v: '1080x1080', l: '1080×1080 · 方形', w: 1080, h: 1080 },
  { v: '2560x1440', l: '2560×1440 · 2K（慢）', w: 2560, h: 1440 },
];

export class Exporter {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.cancelled = false;
    this.last = null;
  }

  setGuides(on) {
    const st = this.app.stage;
    const S = this.app.state;
    st.tcHelper.visible = on && !!this.app.sel;
    st.selBox.visible = on && !!st.selected;
    st.selRing.visible = on && !!st.selected;
    this.app.terrain?.workflow?.setGuides(on);
    if (this.app.terrain) { this.app.terrain.guides=!!on; if (!on && this.app.terrain._ring) this.app.terrain._ring.visible=false; }
    if (this.app.vegetationBrush) { this.app.vegetationBrush.guides = !!on; this.app.vegetationBrush.tick(); }
    if (this.app.roadPlanning) { this.app.roadPlanning.guides = !!on; this.app.roadPlanning.tick(); }
    st.gridWanted = on && S.grid;
    if (st.syncGrid) st.syncGrid();
    st.frame.style.display = on ? '' : 'none';
    const tag = document.getElementById('shotTag');
    if (tag) tag.style.visibility = on ? '' : 'hidden';
    for (const s of this.app.shots) {
      s.helper.visible = on && s.showFrustum && s === this.app.activeShot && !S.preview;
      s.transformAxes.visible = on && s.showFrustum && s === this.app.activeShot && !S.preview;
      s.markers.visible = on && S.showHelpers;
      if (s.label) s.label.visible = on && S.showHelpers && !S.preview;
      if (s.pathLine) s.pathLine.visible = on && S.showHelpers && s.showPath;
    }
    for (const so of this.app.objects) so._mgroup.visible = on && S.showHelpers && !!so.motion?.active;
  }

  // Snapshot actual values, not inferred defaults. The same transaction serves
  // video and both PNG APIs; cleanup runs even after renderer/recorder failures.
  snapshot() {
    const a = this.app, s = a.stage;
    const visible = new Map();
    s.scene.traverse((n) => visible.set(n, n.visible));
    for (const n of [s.tcHelper, s.selBox, s.selRing]) if (n) visible.set(n, n.visible);
    const props = (o, keys) => keys.map((k) => [o, k, o[k]]);
    return {
      subjects: subjectRuntime(a),
      objectPoses: a.objects.map(o => [o, o.root.position.clone(), o.root.rotation.clone(), o.root.scale.clone(), Object.hasOwn(o, '_ty'), o._ty]),
      props: [...props(a, ['suspended']), ...props(a.state, ['preview', 'playing', 'time', 'duration', 'showHelpers']),
        ...props(s.previewControls, ['interacted']), ...props(s.orbit, ['enabled']), ...props(s, ['w', 'h', 'preview', 'aspect', 'exportRect', 'gridWanted', 'exporting', 'useComposer', 'dofParams']),
        ...[a.terrain, a.terrain?.workflow, a.vegetationBrush, a.roadPlanning].filter(Boolean).flatMap((o) => props(o, ['guides']))],
      size: s.renderer.getSize(new THREE.Vector2()), pr: s.renderer.getPixelRatio(),
      viewport: s.renderer.getViewport(new THREE.Vector4()), scissor: s.renderer.getScissor(new THREE.Vector4()),
      scissorTest: s.renderer.getScissorTest(), clearColor: s.renderer.getClearColor(new THREE.Color()), clearAlpha: s.renderer.getClearAlpha(),
      focus: s.previewControls.focus.clone(), postSize: s.postSize?.clone(), camera: s.view.clone(), visible,
      lodHistory: a.renderEffects && { levels: a.renderEffects.lod.levels, culled: a.renderEffects.lod.culled },
      shotRuntime: a.shots.map((shot) => [shot, ['_lastT', '_dt', '_qPrev', '_aimPt', '_followPt', '_followTag', '_clrY', '_aimH', '_aimHAt'].map((key) => [key, Object.hasOwn(shot, key), shot[key]?.clone?.() ?? shot[key]])]),
      iso: a.lighting.isoMultiplier, exposure: s.renderer.toneMappingExposure,
      frameClass: s.frame.className, frameStyle: s.frame.style.cssText,
      tag: document.getElementById('shotTag'), tagStyle: document.getElementById('shotTag')?.style.cssText,
    };
  }
  restore(r) {
    const a = this.app, s = a.stage;
    for (const [o, k, v] of r.props) o[k] = v;
    // Restore dynamic poses/helpers at the original time as well as camera lens.
    // A broken step() must not prevent the remaining cleanup.
    try { a.step(0, true); } catch (_) { /* original error is reported by run() */ }
    try { a.updateAspectOverlay(); } catch (_) { /* restore exact snapshot below */ }
    for (const [o, k, v] of r.props) o[k] = v;
    let failure;
    const attempt = (fn) => { try { fn(); } catch (error) { failure ??= error; } };
    attempt(() => s.renderer.setPixelRatio(r.pr));
    attempt(() => s.renderer.setSize(r.size.x, r.size.y, false));
    s.postSize = r.postSize ?? null;
    attempt(() => s.syncPostSize());
    attempt(() => { s.renderer.setViewport(r.viewport); s.renderer.setScissor(r.scissor); s.renderer.setScissorTest(r.scissorTest); });
    attempt(() => s.renderer.setClearColor(r.clearColor, r.clearAlpha));
    s.previewControls.focus.copy(r.focus);
    for (const [shot, values] of r.shotRuntime) for (const [key, exists, value] of values) {
      if (exists) shot[key] = value; else delete shot[key];
    }
    if (r.lodHistory) Object.assign(a.renderEffects.lod, r.lodHistory);
    attempt(() => {
      for (const [o, pos, rot, scale, hasTY, ty] of r.objectPoses || []) {
        if (!a.objects.includes(o)) continue;
        o.root.position.copy(pos); o.root.rotation.copy(rot); o.root.scale.copy(scale);
        if (hasTY) o._ty = ty; else delete o._ty;
      }
      restoreSubjects(a, r.subjects || []);
      for (const [o] of r.objectPoses || []) o.root.updateMatrixWorld(true);
    });
    s.view.copy(r.camera);
    s.view.updateMatrixWorld(true);
    if (r.iso !== undefined) a.lighting.isoMultiplier = r.iso;
    s.renderer.toneMappingExposure = r.exposure;
    for (const [n, v] of r.visible) n.visible = v;
    attempt(() => s.syncGrid?.());
    s.frame.className = r.frameClass;
    s.frame.style.cssText = r.frameStyle;
    if (r.tag) r.tag.style.cssText = r.tagStyle;
    try { a.bus.emit('time'); } catch (_) { /* observers do not own cleanup */ }
    if (failure) throw failure;
  }
  setup(width, height) {
    const a = this.app, s = a.stage;
    a.suspended = true;
    a.state.playing = false;
    a.state.preview = !!a.activeShot;
    a.state.showHelpers = false;
    s.preview = a.state.preview;
    s.exporting = true;
    if (a.renderEffects) { a.renderEffects.lod.levels = new WeakMap(); a.renderEffects.lod.culled = new WeakSet(); }
    s.previewControls.interacted = false;
    if (a.activeShot) for (const key of ['_lastT', '_qPrev', '_aimPt', '_followPt', '_clrY']) a.activeShot[key] = null;
    s.renderer.setPixelRatio(1);
    s.renderer.setSize(width, height, false);
    const aspect = a.exportAspectValue(), canvasAspect = width / height;
    const k = !aspect || aspect >= canvasAspect ? 1 : aspect / canvasAspect;
    const m = !aspect || aspect >= canvasAspect ? (aspect ? canvasAspect / aspect : 1) : 1;
    s.exportRect = { W: width, H: height, k, m, vw: Math.max(2, Math.round(width * k)), vh: Math.max(2, Math.round(height * m)) };
    s.w = s.exportRect.vw; s.h = s.exportRect.vh;
    s.frame.classList.remove('on');
    this.setGuides(false);
  }
  async run(opts = {}, onProgress = () => {}) {
    if (this.running || this.app.behaviors?.busy || this.app.aiScene?.busy || this.app.stage.exportOwner || this.app.stage.exporting || this.app.terrain?.workflow?.busy || this.app.terrain?.workflow?.erosionPreview) return null;
    this.running = true;
    this.app.stage.exportOwner = this;
    this.cancelled = false;
    this.controller = new AbortController();
    this.completedFrames = 0;
    const suspended = this.app.suspended;
    this.app.suspended = true;
    let r;
    try {
      await this.app.terrain?.workflow?.ready();
      r = await this.record(opts, onProgress);
      if (!r.size && !this.cancelled) {
        onProgress({ i: 0, total: 1, phase: 'retry' });
        r = await this._record(opts, onProgress, 'auto');
      }
    } catch (error) {
      r = this.cancelled ? { size: 0, cancelled: true, frames: this.completedFrames } : { size: 0, error: error.message || String(error) };
      if (!this.cancelled) this.app.notify(`导出失败：${r.error}`, 'warn');
    } finally {
      this.app.suspended = suspended;
      this.running = false;
      delete this.app.stage.exportOwner;
      this.controller = null;
    }
    if (this.cancelled) r = { size: 0, cancelled: true, frames: r?.frames ?? 0 };
    // Publish/download only after all temporary state and tracks are restored.
    if (r?.blob?.size && !r.cancelled && !r.error) {
      r.url = URL.createObjectURL(r.blob);
      try { const saved = await downloadBlob(r.blob, r.name); if (saved) { r.diskSave = saved.status; r.diskSaveError = saved.error; } }
      catch (error) { URL.revokeObjectURL(r.url); return { size: 0, error: error.message }; }
      if (this.last?.url) URL.revokeObjectURL(this.last.url);
      this.last = r;
    }
    try { onProgress({ i: r?.frames ?? 0, total: r?.requestedFrames ?? 1,
      phase: r?.cancelled ? 'cancelled' : r?.error ? 'error' : r?.size ? 'done' : 'empty', ...r, blob: undefined, url: undefined }); }
    catch (_) { /* final observers cannot corrupt a completed export */ }
    return r;
  }
  async record(opts, onProgress) {
    if (opts.encoder !== 'mediarecorder' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
      const width = Math.round(clamp(Number(opts.width) || 1280, 2, 4096));
      const height = Math.round(clamp(Number(opts.height) || 720, 2, 4096));
      const fps = clamp(Number(opts.fps) || 30, 1, 60), bitrate = clamp(Number(opts.bitrate) || 8, .1, 100);
      for (const [codec, muxCodec] of [['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']]) {
        const config = { codec, width, height, framerate: fps, bitrate: Math.round(bitrate * 1e6), latencyMode: 'quality' };
        let supported = false;
        try { supported = (await VideoEncoder.isConfigSupported(config)).supported; } catch (_) { /* next codec */ }
        this.controller.signal.throwIfAborted();
        if (supported) return this.encode(opts, onProgress, config, muxCodec);
      }
    }
    this.app.notify('使用实时兼容录制：繁重场景可能丢帧或延长时长；固定时间戳编码不可用。', 'warn');
    return this._record(opts, onProgress, 'manual');
  }
  async encode(opts, onProgress, config, muxCodec) {
    const a = this.app, s = a.stage, signal = this.controller.signal;
    const { width, height, framerate: fps } = config;
    const duration = clamp(Number(opts.duration) || a.state.duration || 5, .2, 120);
    const total = Math.max(1, Math.round(duration * fps)), restore = this.snapshot();
    let encoder, frames = 0, encodedFrames = 0, maxQueue = 0, flushTimer;
    const started = performance.now();
    try {
      this.setup(width, height);
      onProgress({ i: 0, total, phase: 'prepare' });
      await a.renderEffects?.lod.prewarm({ timeout: 1500, signal });
      signal.throwIfAborted();
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: muxCodec, width, height, frameRate: fps }, firstTimestampBehavior: 'strict' });
      encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          try { muxer.addVideoChunk(chunk, metadata); encodedFrames++; }
          catch (error) { this.controller?.abort(error); }
        },
        error: (error) => this.controller?.abort(error),
      });
      encoder.configure(config);
      // Read an owned, immutable pixel snapshot. Do not let a queued encoder
      // retain a live drawing-buffer surface that cleanup or the next frame resizes.
      const gl = s.renderer.getContext();
      const bottomUp = new Uint8Array(width * height * 4), topDown = new Uint8Array(bottomUp.length);
      for (let i = 0; i < total; i++) {
        signal.throwIfAborted();
        a.state.time = i / fps;
        a.step(1 / fps, true);
        this.setGuides(false);
        s.renderFramed(s.exportRect);
        if (gl.isContextLost()) throw Error('WebGL 上下文已丢失');
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
        for (let y = 0; y < height; y++) topDown.set(bottomUp.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
        const frame = new VideoFrame(topDown, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round(i * 1e6 / fps), duration: Math.round((i + 1) * 1e6 / fps) - Math.round(i * 1e6 / fps) });
        try { encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 }); }
        finally { frame.close(); }
        maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
        this.completedFrames = ++frames;
        onProgress({ i: frames, total, phase: 'render', mode: 'webcodecs', size: 0 });
        do { await this.wait(0, signal); } while (encoder.encodeQueueSize > 2);
      }
      await Promise.race([encoder.flush(), new Promise((_, reject) => { flushTimer = setTimeout(() => reject(Error('视频编码收尾超时')), 15000); })]);
      signal.throwIfAborted();
      if (encodedFrames !== frames) throw Error('编码帧数与渲染帧数不一致');
      muxer.finalize();
      setWebMDuration(target.buffer, total / fps * 1000);
      const blob = new Blob([target.buffer], { type: 'video/webm' });
      const name = `${(a.projectName || 'previz').replace(/\s+/g, '_')}_${(a.activeShot?.name || 'shot').replace(/\s+/g, '')}_${width}x${height}@${fps}.webm`;
      return { blob, size: blob.size, name, ext: 'webm', mode: 'webcodecs', codec: config.codec, frames, requestedFrames: total,
        seconds: total / fps, requestedSeconds: duration, wallSeconds: (performance.now() - started) / 1000, width, height, fps, maxQueue, mime: 'video/webm' };
    } finally {
      clearTimeout(flushTimer);
      if (encoder && encoder.state !== 'closed') encoder.close();
      this.restore(restore);
    }
  }
  async _record(opts, onProgress, requestedMode) {
    const a = this.app, s = a.stage, signal = this.controller.signal;
    const positive = (v, d, lo, hi) => clamp(Number.isFinite(+v) && +v > 0 ? +v : d, lo, hi);
    const width = Math.round(positive(opts.width, 1280, 2, 4096));
    const height = Math.round(positive(opts.height, 720, 2, 4096));
    const fps = positive(opts.fps, 30, 1, 60), bitrate = positive(opts.bitrate, 8, .1, 100);
    const duration = positive(opts.duration, a.state.duration || 5, .2, 120), loop = opts.loop !== false;
    const mime = opts.format === 'webm' && typeof MediaRecorder !== 'undefined'
      ? MIMES.find((c) => c.ext === 'webm' && MediaRecorder.isTypeSupported(c.m)) : bestMime();
    if (!mime || typeof s.canvas.captureStream !== 'function') throw Error('浏览器不支持画布录制，请使用 Chrome / Edge 或导出 PNG');
    const restore = this.snapshot();
    let stream, rec, finish, stopTimer, recorderError, frames = 0, mode = requestedMode;
    const total = Math.max(1, Math.round(duration * fps)), chunks = [];
    try {
      this.setup(width, height);
      onProgress({ i: 0, total, phase: 'prepare' });
      await a.renderEffects?.lod.prewarm({ timeout: 1500, signal });
      signal.throwIfAborted();
      stream = s.canvas.captureStream(mode === 'manual' ? 0 : fps);
      let track = stream.getVideoTracks()[0];
      if (!track) throw Error('未取得视频轨道');
      if (mode === 'manual' && typeof track.requestFrame !== 'function') {
        for (const t of stream.getTracks()) t.stop();
        stream = s.canvas.captureStream(fps);
        track = stream.getVideoTracks()[0];
        mode = 'auto';
      }
      try { rec = new MediaRecorder(stream, { mimeType: mime.m || undefined, videoBitsPerSecond: Math.round(bitrate * 1e6) }); }
      catch (_) { rec = new MediaRecorder(stream); }
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      finish = new Promise((resolve) => {
        rec.onstop = resolve;
        rec.onerror = (e) => {
          recorderError = e.error || Error('MediaRecorder 录制失败');
          this.controller?.abort(recorderError);
          resolve();
        };
      });
      rec.start(300);
      const start = performance.now();
      for (let i = 0; i < total; i++) {
        signal.throwIfAborted();
        a.state.time = loop ? (i / fps) % duration : Math.min(i / fps, duration);
        a.step(1 / fps, true);
        this.setGuides(false); // step updates shot helpers; hide them again before capture.
        s.renderFramed(s.exportRect);
        if (mode === 'manual') track.requestFrame();
        frames++;
        this.completedFrames = frames;
        onProgress({ i: frames, total, phase: 'render', mode, size: 0 });
        // MediaRecorder timestamps are wall-clock timestamps, NOT fixed frame PTS.
        // Never claim frame-exact output; yield even when the renderer falls behind.
        await this.wait(Math.max(0, start + (i + 1) * 1000 / fps - performance.now()), signal);
      }
      if (recorderError) throw recorderError;
      rec.stop();
      await Promise.race([finish, new Promise((_, reject) => { stopTimer = setTimeout(() => reject(Error('录制器停止超时')), 4000); })]);
      if (recorderError) throw recorderError;
      signal.throwIfAborted();
      const actualMime = rec.mimeType || mime.m || 'video/webm';
      const ext = actualMime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: actualMime });
      const name = `${(a.projectName || 'previz').replace(/\s+/g, '_')}_${(a.activeShot?.name || 'shot').replace(/\s+/g, '')}_${width}x${height}@${fps}.${ext}`;
      return { blob, size: blob.size, name, ext, mode, frames, requestedFrames: total, seconds: duration,
        wallSeconds: (performance.now() - start) / 1000, width, height, fps, mime: actualMime };
    } finally {
      clearTimeout(stopTimer);
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (_) { /* cleanup */ } }
      for (const track of stream?.getTracks() ?? []) { try { track.stop(); } catch (_) { /* all tracks */ } }
      if (rec) rec.ondataavailable = rec.onstop = rec.onerror = null;
      this.restore(restore);
    }
  }
  wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }
  cancel() { this.cancelled = true; this.controller?.abort(new DOMException('已取消导出', 'AbortError')); }

  /** PNG APIs both return a Promise; failure returns null after restoring the scene. */
  async still(opts = {}) {
    if (this.running || this.app.behaviors?.busy || this.app.aiScene?.busy || this.app.stage.exportOwner || this.app.stage.exporting || this.app.terrain?.workflow?.busy || this.app.terrain?.workflow?.erosionPreview) return null;
    this.running = true;
    this.app.stage.exportOwner = this;
    const a = this.app, s = a.stage;
    let restore;
    try {
      await a.terrain?.workflow?.ready();
      restore = this.snapshot();
      this.setup(opts.width || (opts.asDataUrl ? 1280 : 1920), opts.height || (opts.asDataUrl ? 720 : 1080));
      a.step(0, true);
      this.setGuides(false);
      s.renderFramed(s.exportRect);
      if (opts.asDataUrl) return s.canvas.toDataURL('image/png');
      const blob = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('PNG 编码超时')), 10000);
        try { s.canvas.toBlob((b) => { clearTimeout(timer); b ? resolve(b) : reject(Error('PNG 编码失败')); }, 'image/png'); }
        catch (e) { clearTimeout(timer); reject(e); }
      });
      downloadBlob(blob, `${a.projectName || 'previz'}_frame_${Math.round(a.state.time * 100) / 100}s.png`);
      return blob;
    } catch (error) {
      a.notify(`PNG 导出失败：${error.message}`, 'warn');
      return null;
    } finally {
      try { if (restore) this.restore(restore); }
      finally { this.running = false; delete this.app.stage.exportOwner; }
    }
  }
}
