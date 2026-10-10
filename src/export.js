// ---------------------------------------------------------------------------
// 导出：录制预览画布为视频（帧精确模式 + 自动模式回退），另支持单帧 PNG / 数据导出
// ---------------------------------------------------------------------------
import { downloadBlob, clamp } from './util.js';

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

  async run(opts = {}, onProgress = () => {}) {
    if (this.running) return null;
    let r = await this._record(opts, onProgress, 'manual');
    if (!r || !r.size) {
      onProgress({ i: 0, total: 1, phase: 'retry' });
      r = await this._record(opts, onProgress, 'auto');
    }
    return r;
  }

  async _record(opts, onProgress, mode) {
    const app = this.app;
    const st = app.stage;
    const { width = 1280, height = 720, fps = 30, bitrate = 8, loop = true } = opts;
    const duration = clamp(opts.duration || app.state.duration, 0.2, 120);
    const mime = bestMime();
    if (!mime || typeof st.canvas.captureStream !== 'function') {
      this.running = false;
      app.notify('当前浏览器不支持画布录制（MediaRecorder / captureStream）。建议用 Chrome 或 Edge；也可先用「导出当前帧 PNG」。', 'warn');
      return null;
    }
    this.running = true;
    this.cancelled = false;
    const restore = {
      w: st.w, h: st.h, size: [st.renderer.domElement.width, st.renderer.domElement.height], pr: st.renderer.getPixelRatio(),
      preview: app.state.preview, time: app.state.time, playing: app.state.playing, aspect: st.aspect, fov: st.view.fov,
    };
    app.suspended = true;
    app.state.playing = false;
    app.state.preview = true;
    st.preview = true;
    st.renderer.setPixelRatio(1);
    st.renderer.setSize(width, height, false);
    // 画幅黑边：把画面渲染进输出画布中央的「取景框」矩形，其余填黑，与预览逐像素一致
    const t = app.exportAspectValue();
    const c = width / height;
    const k = !t || t >= c ? 1 : t / c;
    const m = !t || t >= c ? (t ? c / t : 1) : 1;
    const vw = Math.max(2, Math.round(width * k)), vh = Math.max(2, Math.round(height * m));
    st.exportRect = { W: width, H: height, k, m, vw, vh };
    st.w = vw; st.h = vh;
    st.frame.classList.remove('on');
    this.setGuides(false);

    const canvas = st.canvas;
    const stream = canvas.captureStream(mode === 'manual' ? 0 : fps);
    const track = stream.getVideoTracks()[0];
    const canManual = mode === 'manual' && track && typeof track.requestFrame === 'function';
    let rec;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: mime.m || undefined,
        videoBitsPerSecond: Math.round(bitrate * 1e6),
      });
    } catch (e) {
      rec = new MediaRecorder(stream);
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const finished = new Promise((res) => { rec.onstop = res; });
    rec.onerror = (e) => console.warn('recorder error', e);
    rec.start(300);

    const total = Math.max(1, Math.round(duration * fps));
    const frameMs = 1000 / fps;
    let t0 = performance.now();
    for (let i = 0; i < total; i++) {
      if (this.cancelled) break;
      app.state.time = loop ? (i / fps) % duration : Math.min((i / fps) % (duration + 1 / fps), duration);
      app.step(1 / fps, true);
      st.renderFramed(st.exportRect);
      if (canManual) track.requestFrame();
      onProgress({ i, total, phase: mode, size: 0 });
      const wait = t0 + (i + 1) * frameMs - performance.now();
      if (wait > 1) await new Promise((r) => setTimeout(r, wait));
      else await new Promise((r) => requestAnimationFrame(() => r()));
    }
    await new Promise((r) => setTimeout(r, 220));
    try { rec.stop(); } catch (e) { /* ignore */ }
    await finished;
    try { track.stop(); } catch (e) { /* ignore */ }

    const blob = new Blob(chunks, { type: mime.m || 'video/webm' });
    // 还原现场
    st.exportRect = null;
    st.renderer.setPixelRatio(restore.pr);
    st.renderer.setSize(restore.w, restore.h, false);
    st.w = restore.w; st.h = restore.h;
    st.preview = restore.preview;
    app.state.preview = restore.preview;
    app.state.time = restore.time;
    this.setGuides(true);
    st.frame.style.display = '';
    app.updateAspectOverlay();
    app.bus.emit('time');
    app.suspended = false;
    this.running = false;

    if (blob.size > 0) {
      const name = `${(app.projectName || 'previz').replace(/\s+/g, '_')}_${(app.activeShot?.name || 'shot').replace(/\s+/g, '')}_${width}x${height}@${fps}.${mime.ext}`;
      if (this.last?.url) URL.revokeObjectURL(this.last.url);
      this.last = { blob, size: blob.size, name, url: URL.createObjectURL(blob), ext: mime.ext, mode, frames: total, seconds: duration };
      downloadBlob(blob, name);
      onProgress({ i: total, total, phase: 'done', size: blob.size });
      return this.last;
    }
    onProgress({ i: total, total, phase: 'empty', size: 0 });
    return { size: 0, mode };
  }

  cancel() { this.cancelled = true; }

  /** 当前帧 PNG（按导出分辨率离屏渲染）；opts.asDataUrl=true 时返回 dataURL（不下载） */
  _stillDataUrl(opts) {
    return new Promise((resolve) => {
      const app = this.app, st = app.stage;
      const W = opts.width || 1280, H = opts.height || 720;
      const restore = { size: [st.w, st.h], pr: st.renderer.getPixelRatio(), preview: app.state.preview };
      const t = app.exportAspectValue();
      const c = W / H;
      const k = !t || t >= c ? 1 : t / c;
      const m = !t || t >= c ? (t ? c / t : 1) : 1;
      app.state.preview = !!app.activeShot;
      st.preview = app.state.preview;
      st.renderer.setPixelRatio(1);
      st.renderer.setSize(W, H, false);
      st.exportRect = { W, H, k, m, vw: Math.max(2, Math.round(W * k)), vh: Math.max(2, Math.round(H * m)) };
      st.w = st.exportRect.vw; st.h = st.exportRect.vh;
      app.step(0, true);
      st.renderFramed(st.exportRect);
      const url = st.canvas.toDataURL('image/png');
      st.exportRect = null;
      st.renderer.setPixelRatio(restore.pr);
      st.renderer.setSize(restore.size[0], restore.size[1], false);
      st.w = restore.size[0]; st.h = restore.size[1];
      app.state.preview = restore.preview;
      st.preview = restore.preview;
      this.setGuides(true);
      app.updateAspectOverlay();
      resolve(url);
    });
  }
  still(opts = {}) {
    if (opts.asDataUrl) return this._stillDataUrl(opts);
    const app = this.app, st = app.stage;
    const W = opts.width || 1920, H = opts.height || 1080;
    const restore = { size: [st.w, st.h], pr: st.renderer.getPixelRatio(), preview: app.state.preview, fov: st.view.fov };
    app.state.preview = !!app.activeShot;
    st.preview = app.state.preview;
    st.renderer.setPixelRatio(1);
    st.renderer.setSize(W, H, false);
    const t2 = app.exportAspectValue();
    const c2 = W / H;
    const k2 = !t2 || t2 >= c2 ? 1 : t2 / c2;
    const m2 = !t2 || t2 >= c2 ? (t2 ? c2 / t2 : 1) : 1;
    st.exportRect = { W, H, k: k2, m: m2, vw: Math.max(2, Math.round(W * k2)), vh: Math.max(2, Math.round(H * m2)) };
    st.w = st.exportRect.vw; st.h = st.exportRect.vh;
    const old = app.state.showHelpers;
    app.state.showHelpers = false;
    this.setGuides(false);
    st.frame.classList.remove('on');
    app.step(0, true);
    st.renderFramed(st.exportRect);
    st.canvas.toBlob((b) => {
      if (b) downloadBlob(b, `${(app.projectName || 'previz')}_frame_${Math.round(app.state.time * 100) / 100}s.png`);
      st.exportRect = null;
      st.renderer.setPixelRatio(restore.pr);
      st.renderer.setSize(restore.size[0], restore.size[1], false);
      st.w = restore.size[0]; st.h = restore.size[1];
      app.state.showHelpers = old;
      app.state.preview = restore.preview;
      st.preview = restore.preview;
      this.setGuides(true);
      st.frame.classList.toggle('on', !!restore.preview);
      app.updateAspectOverlay();
    }, 'image/png');
  }
}
