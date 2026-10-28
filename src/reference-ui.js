import { el, downloadBlob } from './util.js';
import { Exporter } from './export.js';
import { ReferenceWorkflow } from './reference-workflow.js';
const note = text => el('p', { class: 'fnote', text });
const btn = (text, action, key) => el('button', { class: 'exp-btn secondary', type: 'button', text, dataset: key ? { referenceAction: key } : {}, onclick: async () => { try { await action(); } catch (e) { window.app?.notify(e.message, 'warn'); } } });
export function referenceTools(app) {
  app.exporter ||= new Exporter(app); app.reference ||= new ReferenceWorkflow(app);
  const w = app.reference, root = el('div', { class: 'exp-card reference-tools', dataset: { referenceTools: '1' } });
  root.append(el('h3', { text: '① 镜头参考包 · 正常 / 灰模' }));
  const field = (label, key, value, min, max) => { const input = el('input', { class: 'num', type: 'number', value, min, max, step: key === 'duration' ? .1 : 1, dataset: { referenceSetting: key } }); root.append(el('label', { class: 'row' }, [el('span', { class: 'lab', text: label }), input])); return input; };
  const width = field('宽 px', 'width', 854, 64, 1920), height = field('高 px', 'height', 480, 64, 1920), fps = field('帧率', 'fps', 24, 1, 60), duration = field('时长 s', 'duration', app.activeShot?.duration || 5, .2, 30), seed = field('运动采样种子', 'seed', 12345, 1, 2147483647);
  const subject = el('select', { class: 'sel', dataset: { referenceSetting: 'subjectId' } });
  const refreshSubjects = () => { const old = subject.value; subject.replaceChildren(el('option', { value: '', text: '使用当前机位主体（可不选）' }), ...app.objects.map(o => el('option', { value: o.id, text: o.name }))); subject.value = [...subject.options].some(o => o.value === old) ? old : ''; }; refreshSubjects();
  app.bus.on('objects', refreshSubjects); root.append(el('label', { class: 'row' }, [el('span', { class: 'lab', text: '检查 / 遮罩主体' }), subject]));
  const channels = el('input', { type: 'checkbox', dataset: { referenceSetting: 'channels' } }); root.append(el('label', { class: 'row' }, [channels, el('span', { text: '包含关键帧深度16 / 对象ID / 主体遮罩' })]));
  const result = el('div', { dataset: { referenceResult: '1' } });
  const generate = btn('生成并下载参考 ZIP', async () => {
    const overlay = el('div', { class: 'reference-job-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '参考包生成任务' });
    const text = note('准备参考包…'), progress = el('progress', { max: 1, value: 0 }), cancel = btn('取消，不发布不完整参考包', () => w.cancel(), 'cancel'); overlay.append(text, progress, cancel); document.body.append(overlay); cancel.focus();
    const keydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); w.cancel(); } }; window.addEventListener('keydown', keydown, true);
    try {
      const r = await w.capture({ width: +width.value, height: +height.value, fps: +fps.value, duration: +duration.value, seed: +seed.value, subjectId: subject.value, channels: channels.checked }, p => { progress.value = p.i / p.total; text.textContent = p.phase === 'zip' ? '校验完成，正在打包…' : `同步采样正常 / 灰模 ${p.i}/${p.total} 帧`; });
      downloadBlob(r.archive, `reference-${r.manifest.id}.zip`); renderResult(r); app.notify('参考包已完成；可在 Generate 页查看版本、对照结果。');
    } finally { overlay.remove(); window.removeEventListener('keydown', keydown, true); }
  }, 'capture');
  function renderResult(r) {
    result.replaceChildren(note(`完成 ${r.manifest.settings.frames} 帧 × 2 视频；${r.manifest.frameFiles.length} 组同帧截图。检查警告 ${r.checks.issues.length} 条。${r.saved ? '已保存本地版本。' : '本地未保存，请保留 ZIP。'}`));
    result.append(btn('再次下载 ZIP', () => downloadBlob(r.archive, `reference-${r.manifest.id}.zip`), 'download'));
    const details = el('details', {}, [el('summary', { text: '② 镜头检查（点击时间跳转检查）' })]);
    const labels = { 'ground-clearance': '钻地 / 地面间隙过低', 'camera-in-projected-volume': '相机进入包围体', 'camera-near-volume': '相机贴近包围体', 'subject-out-of-frame': '主体出画', 'subject-occluded': '主体疑似遮挡', 'rotation-rate': '朝向突变', 'fov-jump': '视角突变' };
    for (const item of r.checks.issues.slice(0, 100)) details.append(btn(`${item.time.toFixed(2)}s · ${labels[item.type] || item.type}`, () => { if (app.activeShot?.id !== r.manifest.shot.id) throw Error('请先选择参考包对应的机位'); if (w.busy || app.exporter.running) return; app.state.time = item.time; app.bus.emit('time'); }, 'seek-issue'));
    details.append(note('保守包围盒 / 约6Hz五点射线检查，会有误报或漏报；不是精确碰撞或自动修复。完整报告和逐帧相机在 ZIP 内。')); result.append(details);
  }
  root.append(generate, note('需要活动机位及 WebCodecs。正常与灰模来自同一次模拟；固定原始几何，不用 LOD。含首／中／尾编码帧、逐帧相机、提示词、检查报告和可恢复工程。尾帧为最后编码帧，不是数学终点。深度 / 遮罩仅三组关键帧，不是逐帧视频。'), result);
  if (w.last) renderResult(w.last); return root;
}
