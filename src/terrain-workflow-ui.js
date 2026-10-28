import { el } from './util.js';
import { section } from './ui.js';
import { cleanHeightMapping, sampleGrid } from './terrain-import.js';
const button = (text, key, action, disabled = false) => el('button', { class: 'fbtn', type: 'button', text, disabled, dataset: { terrainAction: key }, onclick: action });
const row = (label, control) => el('div', { class: 'row' }, [el('label', { class: 'lab', text: label }), el('div', { class: 'ctl' }, [control])]);
export function terrainWorkflowControls(app) {
  const tr = app.terrain, w = tr.workflow, root = el('div', { dataset: { terrainWorkflow: '1' } });
  const run = (action) => async (event) => { try { await action(event); } catch (e) { app.notify(e.message, 'warn'); } };
  const numeric = (label, key, value, min, max, step, change, disabled = w.busy) => row(label, el('input', { class: 'num', type: 'number', value, min, max, step, disabled, dataset: { terrainSetting: key }, onchange: run(function (event) {
    const input = event.currentTarget, n = Number(input.value);
    if (!Number.isFinite(n) || n < min || n > max) { input.value = value; throw Error(`${label}需在 ${min}–${max} 之间`); } change(n);
  }) }));
  const check = (label, key, value, change) => row(label, el('input', { type: 'checkbox', checked: value, disabled: w.busy, dataset: { terrainSetting: key }, onchange: run(() => change(!value)) }));
  const height = section('导入高度 PNG · 8 / 16 位'); height.wrap.dataset.terrainPane = 'import';
  const channel = el('select', { class: 'sel', disabled: w.busy, dataset: { terrainHeightChannel: '1' }, onchange: (e) => { w.heightChannel = e.target.value; } }, ['red', 'green', 'blue', 'luma'].map((v, i) => el('option', { value: v, text: ['灰度 / 红通道', '绿通道', '蓝通道', 'RGB 加权灰度'][i] })));
  channel.value = w.heightChannel || 'red';
  const input = el('input', { type: 'file', accept: '.png,image/png', disabled: w.busy, dataset: { terrainHeightFile: '1' }, onchange: run(async () => { const file = input.files[0]; if (file) await w.stageHeight(file, w.heightChannel || 'red'); }) });
  height.body.append(row('采样通道（选文件前设置）', channel), input);
  const p = w.mapping;
  height.body.append(numeric('覆盖尺寸 m', 'height-size', p.size, 40, 4096, 1, (v) => { w.mapping = cleanHeightMapping({ ...w.mapping, size: v }); }),
    numeric('输出单边顶点', 'height-n', p.n, 33, 513, 2, (v) => { w.mapping = cleanHeightMapping({ ...w.mapping, n: v }); }),
    numeric('黑值高程 m', 'height-base', p.base, -5000, 5000, .1, (v) => { w.mapping = cleanHeightMapping({ ...w.mapping, base: v }); }),
    numeric('黑→白高差 m', 'height-range', p.range, 0, 5000, .1, (v) => { w.mapping = cleanHeightMapping({ ...w.mapping, range: v }); }));
  for (const [key, label] of [['flipX', '左右翻转'], ['flipY', '上下翻转'], ['invert', '黑白反向']]) height.body.append(check(label, 'height-' + key, p[key], (v) => { w.mapping = cleanHeightMapping({ ...w.mapping, [key]: v }); w.changed(); }));
  if (w.pendingHeight) {
    const d = w.pendingHeight, canvas = el('canvas', { width: 160, height: 160, style: 'width:100%;max-width:160px;image-rendering:pixelated', dataset: { terrainHeightPreview: '1' } });
    const context = canvas.getContext('2d'), image = context.createImageData(160, 160);
    for (let j = 0; j < 160; j++) for (let i = 0; i < 160; i++) {
      let v = sampleGrid(d.data, d.width, d.height, p.flipX ? 1 - i / 159 : i / 159, p.flipY ? 1 - j / 159 : j / 159); if (p.invert) v = 1 - v;
      const at = (j * 160 + i) * 4; image.data[at] = image.data[at + 1] = image.data[at + 2] = Math.round(v * 255); image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0); height.body.append(canvas, el('p', { class: 'fnote', text: `${w.heightName} · ${d.width}×${d.height} / ${d.depth} 位。仅缩略图显示为 8 位；原始 16 位采样不经画布。` }));
  } else if (w.heightSource) height.body.append(el('p', { class: 'fnote', text: `上次导入：${w.heightSource.name}（${w.heightSource.depth} 位）；高度已内嵌，原文件不必随工程携带。` }));
  height.body.append(button('查看地形全貌', 'terrain-frame', run(() => w.frameTerrain()), w.busy || !tr.enabled), button('应用高度（覆盖全图）', 'height-apply', run(() => w.applyHeight()), w.busy || !w.pendingHeight), el('p', { class: 'fnote', text: '白值=黑值高程+高差；上边对应 −Z，右边对应 +X。非方图拉伸至方形地形。仅非交错、非调色板 PNG，最多 16MB / 4194304 像素。应用会清除手绘材质覆盖、重设夸张为 1，并联动物体与道路；支持一次撤销。地基 / 道路重贴可能重整局部河床，跨河桥梁建议用固定标高。已保存河道坐标不随尺寸缩放。高度较大看不见时请点「查看地形全貌」（只改浏览视图，不改机位）。' }));
  root.append(height.wrap);
  const overlay = section('地表颜色贴图 · PNG / JPEG'); overlay.wrap.dataset.terrainPane = 'materials';
  const file = el('input', { type: 'file', accept: '.png,.jpg,.jpeg,image/png,image/jpeg', disabled: w.busy, dataset: { terrainOverlayFile: '1' }, onchange: run(async () => { if (file.files[0]) await w.importOverlay(file.files[0]); }) });
  overlay.body.append(file);
  if (w.overlay) {
    overlay.body.append(el('p', { class: 'fnote', text: `${w.overlay.name} · 内嵌 ${w.overlay.width}×${w.overlay.height}` }), numeric('覆盖混合 0–1', 'overlay-opacity', w.overlay.opacity, 0, 1, .05, (v) => w.configureOverlay({ opacity: v })),
      check('贴图左右翻转', 'overlay-flipX', w.overlay.flipX, (v) => w.configureOverlay({ flipX: v })), check('贴图上下翻转', 'overlay-flipY', w.overlay.flipY, (v) => w.configureOverlay({ flipY: v })), button('移除贴图', 'overlay-remove', run(() => w.removeOverlay()), w.busy));
  }
  overlay.body.append(el('p', { class: 'fnote', text: '作为地貌 / 手绘材质之上的颜色覆盖，不改变高程、法线或粗糙度。最长边缩至 1024，内嵌存档（约 2MB 上限），非方图拉伸；导入高度时的翻转与贴图翻转独立设置。低内存或全局灰模时暂停显示，不丢失原数据。' })); root.append(overlay.wrap);
  const river = section('手绘河道 · 先路径后刻蚀'); river.wrap.dataset.terrainPane = 'rivers';
  river.body.append(button('新建 · 视口点击布点', 'river-new', run(() => w.beginDraft()), w.busy || !tr.enabled));
  for (const item of w.rivers) river.body.append(el('div', { class: 'btnrow' }, [el('span', { text: `${item.name} · ${item.points.length} 点`, style: 'font-size:11px' }), button('编辑', 'river-edit-' + item.id, run(() => w.beginDraft(item.id)), w.busy), button('删除河面', 'river-delete-' + item.id, run(() => w.deleteRiver(item.id)), w.busy)]));
  if (w.draft) {
    const d = w.draft;
    river.body.append(row('河道名称', el('input', { class: 'txt', type: 'text', maxlength: 40, value: d.name, disabled: w.busy, dataset: { terrainRiverName: '1' }, onchange: run((event) => { const name = event.currentTarget.value; w.updateDraft({ name }); }) })),
      numeric('河面宽 m', 'river-width', d.width, 1, 60, .5, (v) => w.updateDraft({ width: v })), numeric('中心切深 m', 'river-depth', d.depth, .1, 30, .1, (v) => w.updateDraft({ depth: v })), numeric('岸坡过渡 m', 'river-bank', d.bank, .5, 60, .5, (v) => w.updateDraft({ bank: v })), check('显示河面', 'river-water', d.water, (v) => w.updateDraft({ water: v })));
    river.body.append(el('p', { class: 'fnote', text: w.drawing ? '左键点地形布点，拖动已有圆点调整；右键可旋转。Enter 停止布点，Backspace 删除末点，Esc 丢弃预览。点坐标为 X / 水面标高 Y / Z（米）。' : '拖动视口中的圆点即可调整路径（保持水面标高）；下表可改Y。保存才应用，Esc取消；移动旧河道不会自动填回旧河床。' }));
    const points = el('div', { style: 'max-height:260px;overflow:auto' });
    d.points.forEach((p, index) => {
      const fields = p.map((v, axis) => el('input', { class: 'num', type: 'number', step: .1, value: Number(v.toFixed(3)), disabled: w.busy, style: 'min-width:0;width:28%', 'aria-label': `河道点 ${index + 1} ${['X', 'Y', 'Z'][axis]}`, dataset: { riverPoint: `${index}:${axis}` }, onchange: run((event) => {
        const input = event.currentTarget, value = Number(input.value); if (!Number.isFinite(value)) throw Error('坐标必须为有限数');
        const next = d.points.map((p) => [...p]); next[index][axis] = value; w.updateDraft({ points: next });
      }) }));
      points.append(el('div', { style: 'display:flex;gap:3px;margin:4px 0' }, [el('span', { text: String(index + 1) }), ...fields, button('×', 'river-point-remove-' + index, run(() => w.updateDraft({ points: d.points.filter((_, i) => i !== index) })), w.busy)]));
    });
    river.body.append(points, button(w.drawing ? '停止布点' : '继续布点', 'river-draw', run(() => { w.drawing = !w.drawing; if (w.drawing) w.stopTools(); w.changed(); }), w.busy), button('增加坐标点', 'river-point-add', run(() => { const last = d.points.at(-1) || [0, 0, 0]; w.updateDraft({ points: [...d.points, [Math.min(tr.size / 2, last[0] + 5), last[1], last[2]]] }); }), w.busy || d.points.length >= 64),
      button('保存河面 / 路径', 'river-save', run(() => w.commitDraft(false)), w.busy), button('保存并刻蚀河床', 'river-carve', run(() => w.commitDraft(true)), w.busy), button('取消预览', 'river-cancel', run(() => { w.cancelJob(); w.cancelDraft(); })));
    if (w.draftError) river.body.append(el('p', { class: 'fnote', text: '请修正：' + w.draftError }));
  }
  river.body.append(el('p', { class: 'fnote', text: `最多 16 条、每条 64 点。只降低河床，不筑坝、不自动寻找汇流路径；标高由路径点决定，允许人为上坡，并非水文模拟。建议河宽至少 ${(2 * tr.size / (tr.n - 1)).toFixed(1)}m，或提高网格密度。删除 / 改路径不会回填旧河床：用撤销恢复，再重新刻蚀。局部河面与全局海面独立，必要时关闭海面。尺寸改变后越界河道暂停显示。` }));
  if (w.invalidRivers) river.body.append(el('p', { class: 'fnote', text: `${w.invalidRivers} 条河道超出范围 / 无法显示，请编辑。` })); root.append(river.wrap);
  if (w.busy) root.append(el('p', { class: 'fnote', text: '处理中：' + w.status }), button('取消当前地形任务', 'cancel-task', run(() => w.cancelJob())));
  return root;
}
