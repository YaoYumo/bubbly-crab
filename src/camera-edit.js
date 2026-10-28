// Single video track, absolute scene seconds, stable shot IDs, hard cuts only.
// Empty ranges hold the previous clip's OUT pose (before the first: its IN pose).
const copy = x => JSON.parse(JSON.stringify(x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const finite = x => typeof x === 'number' && Number.isFinite(x);
const id = () => 'cut_' + crypto.randomUUID();
export const CAMERA_HISTORY = ['_lastT', '_dt', '_qPrev', '_aimPt', '_followPt', '_followTag', '_clrY', '_aimH', '_aimHAt'];
export function resetCameraHistory(shot) { for (const key of CAMERA_HISTORY) delete shot[key]; }
export function readCameraEdit(raw, shots = [], duration = 120) {
  if (raw == null) return Object.freeze({ version: 1, enabled: false, clips: Object.freeze([]) });
  if (raw.version !== 1 || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.clips) || raw.clips.length > 128) throw Error('镜头剪辑格式无效（version 1，最多128段）');
  if (raw.clips.length && (!finite(duration) || duration < .5 || duration > 120)) throw Error('剪辑工程时长需0.5–120秒');
  const ids = new Set(), refs = new Set(shots.map(s => s.id));
  const clips = raw.clips.map(c => {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 160 || ids.has(c.id)) throw Error('片段ID无效或重复');
    ids.add(c.id);
    if (typeof c.shotId !== 'string' || !refs.has(c.shotId)) throw Error('剪辑引用了不存在的机位');
    if (![c.start, c.end, c.sourceIn].every(finite) || c.start < 0 || c.end - c.start < 1e-6 || c.end > Math.min(120, duration) + 1e-8 || c.sourceIn < 0 || c.sourceIn > 120) throw Error('片段时间无效：需在0–120秒及工程时长内，出点晚于入点');
    return Object.freeze({ id: c.id, shotId: c.shotId, start: c.start, end: c.end, sourceIn: c.sourceIn });
  }).sort((a,b) => a.start - b.start || a.id.localeCompare(b.id));
  for (let i=1;i<clips.length;i++) if (clips[i].start < clips[i-1].end - 1e-8) throw Error('镜头片段不能重叠，请移至空位或先裁剪');
  return Object.freeze({ version: 1, enabled: raw.enabled, clips: Object.freeze(clips) });
}
export function sampleCameraEdit(edit, shots, time) {
  if (!edit?.enabled || !edit.clips.length) return null;
  const t = Math.max(0, finite(time) ? time : 0), clips = edit.clips;
  let clip = clips[0];
  for (const c of clips) { if (c.start <= t) clip = c; else break; }
  const shot = shots.find(s => s.id === clip.shotId);
  if (!shot) return null;
  const sourceDuration = finite(shot.duration) && shot.duration > 0 ? shot.duration : 6;
  const sourceTime = clamp(clip.sourceIn + clamp(t - clip.start, 0, clip.end - clip.start), 0, sourceDuration);
  return { shot, clip, time: sourceTime, u: sourceTime / sourceDuration, holding: t < clip.start || t >= clip.end };
}
export class CameraEdit {
  constructor(app) { this.app = app; this.data = readCameraEdit(); }
  get clips() { return this.data.clips; }
  get enabled() { return this.data.enabled; }
  toJSON() { return copy(this.data); }
  load(raw) { this.data = readCameraEdit(raw, this.app.shots, this.app.state.duration); }
  reset() { this.data = readCameraEdit(); }
  checkIdle() {
    const a = this.app;
    if (a.state.playing || a.stage.exportOwner || a.stage.exporting || a.exporter?.running || a.reference?.busy || a.behaviors?.busy || a.aiScene?.busy || a.terrain?.workflow?.busy || a.terrain?.workflow?.erosionPreview) throw Error('请先暂停播放、导出或后台场景任务，再编辑剪辑');
  }
  commit(raw, label, duration = this.app.state.duration) {
    this.checkIdle();
    if (!finite(duration) || duration < .5 || duration > 120) throw Error('剪辑工程时长需0.5–120秒');
    const next = readCameraEdit(raw, this.app.shots, duration);
    if (JSON.stringify(next) === JSON.stringify(this.data) && duration === this.app.state.duration) return false;
    this.app.beginOp(label); this.data = next; this.app.state.duration = duration; this.app.state.time = clamp(this.app.state.time, 0, duration);
    this.app.stage.previewControls.interacted = false;
    this.app.bus.emit('camera-edit'); this.app.bus.emit('time');
    return true;
  }
  setEnabled(enabled) { return this.commit({ ...this.toJSON(), enabled: !!enabled }, enabled ? '启用镜头剪辑' : '单机位预览'); }
  append(shotId, start = Math.max(0, ...this.clips.map(c => c.end))) {
    const shot = this.app.shots.find(s => s.id === shotId); if (!shot) throw Error('请先创建并选择机位');
    const length = Math.max(1 / (this.app.state.fps || 30), Number(shot.duration) || 6);
    const c = { id: id(), shotId, start, end: start + length, sourceIn: 0 };
    this.commit({ version: 1, enabled: true, clips: [...this.clips, c] }, '加入镜头片段', Math.max(this.app.state.duration, c.end));
    return c.id;
  }
  assemble() {
    if (!this.app.shots.length) throw Error('请先创建机位');
    let at = 0;
    const clips = this.app.shots.map(s => { const length = Math.max(1 / (this.app.state.fps || 30), Number(s.duration) || 6); const c = { id: id(), shotId: s.id, start: at, end: at + length, sourceIn: 0 }; at += length; return c; });
    return this.commit({version:1, enabled:true, clips}, '按机位顺序拼接', Math.max(.5, at));
  }
  update(clipId, patch) {
    if (!this.clips.some(c=>c.id===clipId)) throw Error('片段不存在');
    const clips = this.clips.map(c=>c.id===clipId ? {...c,...patch,id:c.id} : c);
    return this.commit({...this.toJSON(),clips}, '移动／裁剪镜头', Math.max(this.app.state.duration,...clips.map(c=>c.end)));
  }
  remove(clipId) { return this.commit({...this.toJSON(),clips:this.clips.filter(c=>c.id!==clipId)}, '删除镜头片段'); }
  split(clipId, time) {
    const c = this.clips.find(c=>c.id===clipId), frame = 1 / (this.app.state.fps || 30);
    if (!c || !finite(time) || time < c.start + frame - 1e-8 || time > c.end - frame + 1e-8) throw Error('分割点需位于片段内部，左右至少一帧');
    const clips = this.clips.flatMap(x=>x!==c?[x]:[{...c,end:time},{...c,id:id(),start:time,sourceIn:Math.min(120, this.app.shots.find(s=>s.id===c.shotId)?.duration || 6, c.sourceIn+time-c.start)}]);
    return this.commit({...this.toJSON(),clips}, '分割镜头片段');
  }
  duration(value) { return this.commit(this.toJSON(), '更改剪辑总时长', value); }
  dropShot(shotId) { this.data = readCameraEdit({...this.toJSON(),clips:this.clips.filter(c=>c.shotId!==shotId)},this.app.shots,this.app.state.duration); this.app.bus.emit('camera-edit'); }
  sample(time = this.app.state.time) { return sampleCameraEdit(this.data, this.app.shots, time); }
}
