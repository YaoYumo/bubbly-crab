import { zip, strToU8 } from 'fflate';
import { el, downloadBlob } from './util.js';
import { Exporter } from './export.js';
import { ReferenceWorkflow } from './reference-workflow.js';
import { ReferenceGateway } from './reference-gateway.js';
const note = text => el('p', { class: 'fnote', text });
export function referenceReview(app) {
  app.exporter ||= new Exporter(app); app.reference ||= new ReferenceWorkflow(app);
  const w = app.reference, gateway = new ReferenceGateway(), root = el('div', { class: 'gen-card reference-review', dataset: { referenceReview: '1' } });
  const run = fn => async e => { try { await fn(e); } catch (error) { status.textContent = error.message; app.notify(error.message, 'warn'); } };
  const button = (label, key, fn) => el('button', { class: 'exp-btn secondary', type: 'button', text: label, dataset: { referenceAction: key }, onclick: run(fn) });
  const select = (key, options) => el('select', { class: 'sel', dataset: { referenceSetting: key } }, options.map(([value, text]) => el('option', { value, text })));
  root.append(el('h3', { text: '③ 参考交付 / ④ 结果对照与版本' }));
  const status = note('先在 Export 页生成镜头参考包，再选择版本。媒体保存在本浏览器 IndexedDB，不进入 localStorage。'), versions = select('version', []), info = note(''), actions = el('div', { class: 'reference-actions' });
  const comparison = el('div', { class: 'reference-compare' }), left = el('video', { controls: true, muted: true, playsinline: true, preload: 'metadata', dataset: { referenceVideo: 'source' } }), right = el('video', { controls: true, muted: true, playsinline: true, preload: 'metadata', dataset: { referenceVideo: 'result' } });
  comparison.append(el('div', {}, [note('参考（左侧为同步时间主轴）'), left]), el('div', {}, [note('生成结果（上传本地文件或使用云端结果链接）'), right]));
  const variant = select('variant', [['normal', '正常参考视频'], ['gray', '灰模参考视频']]), syncMode = select('syncMode', [['seconds', '按秒同步'], ['normalized', '按总时长比例同步']]);
  const offset = el('input', { class: 'num', type: 'number', min: -60, max: 60, step: .05, value: 0, dataset: { referenceSetting: 'offset' }, 'aria-label': '结果时间偏移（秒）' });
  let current = null, activeId = '', urls = [], epoch = 0, polling = null, caps = null, frameRequest = null, submitting = false;
  function revoke() { left.pause(); right.pause(); left.removeAttribute('src'); right.removeAttribute('src'); for (const url of urls) URL.revokeObjectURL(url); urls = []; }
  function mediaURL(blob) { const url = URL.createObjectURL(blob); urls.push(url); return url; }
  function sync() {
    if (!Number.isFinite(left.duration) || !Number.isFinite(right.duration)) return;
    const desired = (syncMode.value === 'normalized' ? left.currentTime / left.duration * right.duration : left.currentTime) + Number(offset.value || 0);
    const time = Math.max(0, Math.min(right.duration, desired)); if (Math.abs(time - right.currentTime) > .1) right.currentTime = time;
    right.playbackRate = Math.max(.25, Math.min(4, left.playbackRate * (syncMode.value === 'normalized' ? right.duration / left.duration : 1)));
  }
  function tick() { frameRequest = null; if (left.paused || !root.isConnected) return; sync(); frameRequest = requestAnimationFrame(tick); }
  left.addEventListener('play', () => { sync(); right.play().catch(() => {}); if (!frameRequest) frameRequest = requestAnimationFrame(tick); });
  left.addEventListener('pause', () => right.pause()); left.addEventListener('seeking', sync); left.addEventListener('ratechange', sync); left.addEventListener('ended', () => right.pause()); right.addEventListener('loadedmetadata', sync);
  right.addEventListener('error', () => { if (right.getAttribute('src')) status.textContent = '结果视频不可播放 / 链接失效，请下载后上传兼容的本地视频；云端结果链接不保证永久有效。'; });
  app.bus.on('page-change', page => { if (page !== 'generate') { left.pause(); right.pause(); } });
  window.addEventListener('pagehide', () => { revoke(); polling?.abort(); if (frameRequest) cancelAnimationFrame(frameRequest); });
  const notes = el('textarea', { class: 'txt', rows: 3, maxlength: 2000, placeholder: '记录构图、遮挡、空间漂移等观察；不会自动打分', dataset: { referenceNotes: '1' } }), scoreInputs = {};
  for (const [key, label] of [['camera', '运镜方向'], ['subject', '主体位置'], ['occlusion', '遮挡关系'], ['space', '空间稳定']]) {
    const s = scoreInputs[key] = select('score-' + key, [['', label + '：未评价'], ...[1, 2, 3, 4, 5].map(n => [String(n), label + '：' + n + '/5'])]); actions.append(s);
  }
  async function refresh() {
    const list = await w.store.list(), next = list.some(m => m.id === activeId) ? activeId : list[0]?.id;
    versions.replaceChildren(...list.map(m => el('option', { value: m.id, text: `${new Date(m.createdAt).toLocaleString()} · ${m.name} · ${m.id.slice(0, 8)}` })));
    if (!next) { current = null; activeId = ''; revoke(); info.textContent = '没有本地参考版本；ZIP 下载不受本地版本库容量影响。'; return; }
    versions.value = next; await load(next);
  }
  async function load(id) {
    const token = ++epoch; polling?.abort(); polling = null; const v = await w.store.get(id); if (token !== epoch) return;
    current = v; activeId = id; revoke(); left.src = mediaURL(v.media[variant.value] || v.media.normal);
    if (v.media.result instanceof Blob) right.src = mediaURL(v.media.result); else if (v.meta.resultURL) right.src = v.meta.resultURL;
    info.textContent = `${v.meta.name} · ${v.meta.manifest.settings.width}×${v.meta.manifest.settings.height} / ${v.meta.manifest.settings.fps}fps · ${v.meta.manifest.encodedDuration.toFixed(2)}s · 源指纹 ${v.meta.sourceFingerprint.slice(0, 16)} · ${v.meta.generation ? '任务 ' + v.meta.generation.status : '尚未提交云端'}`;
    notes.value = v.meta.notes || ''; for (const [key, input] of Object.entries(scoreInputs)) input.value = v.meta.scores?.[key] || '';
    syncMode.value = v.meta.sync?.mode || 'seconds'; offset.value = v.meta.sync?.offset || 0; prompt.value = v.meta.generation?.prompt || v.meta.prompt; status.textContent = '已加载版本；上传 / 提交均需明确操作，不自动调用付费服务。';
  }
  versions.onchange = run(() => load(versions.value)); variant.onchange = run(() => { if (activeId) return load(activeId); });
  const resultFile = el('input', { type: 'file', accept: 'video/*,.mp4,.webm', dataset: { referenceResultFile: '1' }, onchange: run(async () => {
    const file = resultFile.files[0]; if (!current || !file) throw Error('请先选择参考版本和结果视频'); if (file.size > 64 * 1024 * 1024) throw Error('结果视频最多 64MB');
    const id = activeId, probe = document.createElement('video'), url = URL.createObjectURL(file);
    try { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('结果视频元数据读取超时')), 10000); probe.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(probe.duration) && probe.duration > 0 ? resolve() : reject(Error('结果视频时长无效')); }; probe.onerror = () => { clearTimeout(timer); reject(Error('浏览器无法解码该视频，请使用兼容 MP4 / WebM')); }; probe.src = url; }); } finally { probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url); }
    await w.store.update(id, { resultName: file.name.slice(0, 160), resultURL: null }, { result: file }); if (id === activeId) await load(id);
  }) });
  const need = () => { if (!current) throw Error('请先选择本地参考版本'); return current; };
  actions.append(button('播放 / 暂停对照', 'compare-play', () => { need(); if (!right.getAttribute('src')) throw Error('请先上传或获取结果视频'); if (left.paused) return left.play(); left.pause(); }),
    button('保存评价与同步设置', 'save-review', async () => {
      need(); const value = Number(offset.value); if (!Number.isFinite(value) || Math.abs(value) > 60) throw Error('偏移需在 ±60 秒内');
      const scores = Object.fromEntries(Object.entries(scoreInputs).map(([k, e]) => [k, e.value ? Number(e.value) : null])); await w.store.update(activeId, { scores, notes: notes.value.slice(0, 2000), sync: { mode: syncMode.value, offset: value } }); current = await w.store.get(activeId); status.textContent = '人工评价已保存，不是自动准确率评分。';
    }), button('下载参考 ZIP', 'version-download', () => { const v = need(); downloadBlob(v.media.archive, `reference-${v.meta.id}.zip`); }),
    button('导出评价 / 生成参数 JSON', 'review-download', () => { const v = need(); downloadBlob(new Blob([JSON.stringify(v.meta, null, 2)], { type: 'application/json' }), `reference-review-${v.meta.id}.json`); }),
    button('导出完整尝试包（含本地结果）', 'attempt-download', async () => {
      const v = need(), files = { 'reference.zip': new Uint8Array(await v.media.archive.arrayBuffer()), 'review.json': strToU8(JSON.stringify(v.meta, null, 2)) };
      if (v.media.result instanceof Blob) files['result' + (/\.[a-z0-9]{1,8}$/i.exec(v.meta.resultName || '')?.[0] || (v.media.result.type.includes('mp4') ? '.mp4' : '.webm'))] = new Uint8Array(await v.media.result.arrayBuffer());
      else files['RESULT-NOT-EMBEDDED.txt'] = strToU8('No local result video embedded. Remote URLs can expire; download the result and upload it to this version before exporting.');
      const bytes = await new Promise((resolve, reject) => zip(files, { level: 0 }, (e, b) => e ? reject(e) : resolve(b))); downloadBlob(new Blob([bytes], { type: 'application/zip' }), `attempt-${v.meta.id}.zip`);
    }), button('复制为新尝试（保留原结果）', 'version-clone', async () => {
      const v = need(); if (['submitting', 'submission-unknown', 'queued', 'running'].includes(v.meta.generation?.status) && !confirm('原版本的任务可能仍在云端运行 / 计费。复制不会取消任务。请先检查服务商后台，确认需要另建一次尝试？')) return; const id = crypto.randomUUID(), meta = { ...v.meta, id, artifactId: v.meta.manifest.id, derivedFrom: v.meta.id, createdAt: new Date().toISOString(), name: v.meta.name + ' · 新尝试', generation: null, resultURL: null, resultName: null, scores: {}, notes: '' }, media = { ...v.media }; delete media.result;
      await w.store.save(meta, { ...media, id }); activeId = id; await refresh();
    }), button('删除本地版本', 'version-delete', async () => { need(); if (!confirm('删除本地参考和结果媒体？请先导出完整尝试包（远程链接结果须先下载并上传）。不会取消云端任务。')) return; polling?.abort(); await w.store.delete(activeId); activeId = ''; await refresh(); }));
  root.append(status, versions, info, variant, comparison, el('div', { class: 'reference-actions' }, [syncMode, el('label', {}, ['结果偏移 s ', offset]), resultFile]), notes, actions);
  const gatewayPanel = el('details', { class: 'reference-gateway' }, [el('summary', { text: '生成工具适配 · 手动交付 / 同源网关' })]);
  const mode = select('gatewayMode', [['text', '纯文本（不传参考素材）'], ['first-last', '首尾帧参考'], ['video', '视频参考']]), capabilityText = note('默认手动交付，不会自动联网。先检查网关能力，不能用的输入不会悄悄降级为文本。');
  const prompt = el('textarea', { class: 'txt', rows: 5, maxlength: 12000, dataset: { referencePrompt: '1' } });
  async function poll(id, versionId) {
    polling?.abort(); const ctl = polling = new AbortController();
    try { return await gateway.poll(id, async task => { await w.store.update(versionId, { generation: { ...(await w.store.get(versionId)).meta.generation, ...task } }); if (task.resultURL) await w.store.update(versionId, { resultURL: task.resultURL }); if (activeId === versionId) { current.meta.generation = { ...current.meta.generation, ...task }; if (task.resultURL) current.meta.resultURL = task.resultURL; status.textContent = `云端任务 ${task.id}：${task.status}`; if (task.resultURL) right.src = task.resultURL; } }, ctl.signal); }
    catch (e) { if (e.name === 'AbortError') { status.textContent = '已停止本地等待，不代表云端取消或停止计费；稍后可恢复查询。'; return; } throw e; }
    finally { if (polling === ctl) polling = null; }
  }
  gatewayPanel.append(capabilityText, button('检查网关能力', 'gateway-discover', async () => {
    if (location.protocol === 'file:') throw Error('离线 file 版使用手动交付；网关需部署为同源 HTTP(S) 服务'); caps = await gateway.discover();
    capabilityText.textContent = `${caps.provider} / ${caps.model || '无模型'}；${caps.configured ? '已配置' : '未配置'}；支持：${Object.entries(caps.inputs).filter(([, v]) => v).map(([k]) => k).join('、') || '无'}。能力由网关声明，未验证真实生成遵循度。ARK 文本适配仅请求 720p / 整数4–15秒，不接收参考图片或视频。`;
    for (const option of mode.options) option.disabled = !caps.configured || !caps.inputs[option.value];
  }), mode, prompt,
    button('确认并提交生成（可能计费）', 'gateway-submit', async () => {
      const v = need(); if (submitting) throw Error('提交正在进行，请勿重复点击'); if (polling) throw Error('请先停止当前本地查询'); if (!caps?.configured || !caps.inputs[mode.value]) throw Error('请先检查能力并选择受支持输入；未提交任务');
      if (v.meta.generation) throw Error('该版本已有提交记录；运行任务请恢复查询，新生成请先复制为新尝试，避免覆盖结果或重复计费');
      gateway.prepare(v, { mode: mode.value, prompt: prompt.value, variant: variant.value }); // Local preflight before any persisted submission intent.
      if (!confirm(`将向 ${caps.provider} 提交 ${mode.value}，可能计费。${mode.value === 'text' ? '不会上传参考素材。' : '只上传所选首尾帧或视频，不上传完整场景。'}继续？`)) return;
      const id = activeId, generationPrompt = prompt.value, input = mode.value;
      if (!generationPrompt.trim() || generationPrompt.length > 12000) throw Error('提示词不能为空，且最多12000字');
      const intent = { id: null, status: 'submitting', provider: caps.provider, model: caps.model, input, variant: variant.value, prompt: generationPrompt, submittedAt: new Date().toISOString(), parameters: { ...v.meta.manifest.settings, duration: v.meta.manifest.encodedDuration } };
      submitting = true;
      try {
      await w.store.update(id, { generation: intent }); if (activeId === id) current.meta.generation = intent;
      let task;
      try { task = await gateway.submit(v, { mode: input, prompt: generationPrompt, variant: variant.value }); }
      catch (e) { const failed = { ...intent, status: 'submission-unknown', message: e.message }; await w.store.update(id, { generation: failed }); if (activeId === id) current.meta.generation = failed; throw Error('提交状态未确认：' + e.message + '。请先检查服务商后台，不要盲目重复提交；这不代表云端未创建任务。'); }
      const generation = { ...intent, ...task }; await w.store.update(id, { generation }); if (activeId !== id) return; current.meta.generation = generation;
      if (task.resultURL) { await w.store.update(id, { resultURL: task.resultURL }); right.src = task.resultURL; }
      else await poll(task.id, id);
      } finally { submitting = false; }
    }), button('恢复查询已有任务（不重新提交）', 'gateway-resume', async () => { const v = need(); if (!v.meta.generation?.id) throw Error('该版本没有保存的任务 ID'); await poll(v.meta.generation.id, v.meta.id); }),
    button('停止本地等待（非云端取消）', 'gateway-stop', () => polling?.abort()), note('生产部署需要认证、配额与任务归属校验。服务商密钥只配置在后端；本页面不收集密钥。云端链接可能过期，建议下载并上传本地保存。'));
  root.append(gatewayPanel); app.bus.on('reference-versions', () => refresh().catch(e => { status.textContent = '版本读取失败：' + e.message; }));
  refresh().catch(e => { status.textContent = '本地版本库不可用：' + e.message; }); return root;
}
