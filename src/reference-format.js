import { zlibSync, strToU8 } from 'fflate';
import { crc32 } from './terrain-import.js';
export const REFERENCE_SCHEMA = 'previz-reference/1';
export function referenceSettings(v = {}) {
  const num = (k, d, lo, hi) => { const n = Number(v[k] ?? d); if (!Number.isFinite(n) || n < lo || n > hi) throw Error(`${k} 需在 ${lo}–${hi} 之间`); return n; };
  const width = Math.round(num('width', 854, 64, 1920)), height = Math.round(num('height', 480, 64, 1920));
  const fps = Math.round(num('fps', 24, 1, 60)), duration = num('duration', 5, .2, 30), frames = Math.round(fps * duration);
  if (width * height > 2100000 || frames > 900) throw Error('参考包上限为约 210 万像素 / 900 帧，请降低分辨率、帧率或时长');
  return { width, height, fps, duration, frames: Math.max(1, frames), seed: Math.round(num('seed', 12345, 1, 2147483647)), channels: v.channels === true, subjectId: String(v.subjectId || '').slice(0, 120) };
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? strToU8(bytes) : bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); }
export function sampleIndices(count) { return [...new Set([0, Math.floor((count - 1) / 2), count - 1])]; }
export function sampleTime(index, fps) { return index / fps; }
export function depthFromCode(code, near, far) { return code === 0 ? null : near + (code - 1) / 65534 * (far - near); }
function chunk(type, data) {
  const t = strToU8(type), out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(t, 4); out.set(data, 8); view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
/** Standard grayscale PNG16, network byte order. Zero is invalid/background. */
export function depthPNG(width, height, rgbaTopDown) {
  if (rgbaTopDown.length !== width * height * 4) throw Error('深度缓冲尺寸无效');
  const raw = new Uint8Array(height * (1 + width * 2));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = (y * width + x) * 4, to = y * (1 + width * 2) + 1 + x * 2; raw[to] = rgbaTopDown[at]; raw[to + 1] = rgbaTopDown[at + 1]; }
  const head = new Uint8Array(13), view = new DataView(head.buffer); view.setUint32(0, width); view.setUint32(4, height); head[8] = 16;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
export function summaryChecks(frames, fps) {
  const issues = [], add = (type, f, detail) => issues.push({ type, frame: f.index, time: f.time, ...detail });
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.groundClearance != null && f.groundClearance < .1) add('ground-clearance', f, { meters: f.groundClearance });
    if (f.collisionIds?.length) add('camera-in-projected-volume', f, { ids: f.collisionIds });
    if (f.proximityIds?.length) add('camera-near-volume', f, { ids: f.proximityIds, thresholdMeters: f.proximityThreshold });
    if (f.subject && !f.subject.inFrame) add('subject-out-of-frame', f, {});
    else if (f.subject && f.subject.visibleSamples === 0) add('subject-occluded', f, {});
    if (!i) continue; const p = frames[i - 1], dt = 1 / fps;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(f.quaternion.reduce((s, v, k) => s + v * p.quaternion[k], 0)))) * 180 / Math.PI;
    if (angle / dt > 240) add('rotation-rate', f, { degreesPerSecond: angle / dt });
    if (Math.abs(f.hfovDegrees - p.hfovDegrees) > 5) add('fov-jump', f, { degrees: f.hfovDegrees - p.hfovDegrees });
  }
  return { samples: frames.length, issues, method: 'Conservative mesh AABB collision and five-point subject ray tests; warnings, not automatic repair or a cinematic score.' };
}
