import { requireWebGateway } from './desktop-runtime.js';
// Capability-negotiated same-origin gateway, NOT a hard-coded claim about a vendor model.
export const REFERENCE_INPUTS = ['text', 'first-last', 'video'];
export function cleanCapabilities(raw) {
  if (!raw || raw.version !== 1 || !raw.inputs || typeof raw.inputs !== 'object') throw Error('生成网关能力协议无效（需要 version:1）');
  return { version: 1, configured: raw.configured === true, provider: String(raw.provider || 'unconfigured').slice(0, 100), model: String(raw.model || '').slice(0, 120), inputs: Object.fromEntries(REFERENCE_INPUTS.map(k => [k, raw.inputs[k] === true])), remoteCancel: false, maxBytes: Math.min(48 * 1024 * 1024, Math.max(1024, Number(raw.maxBytes) || 32 * 1024 * 1024)), verification: 'gateway-advertised; adherence requires real result evaluation' };
}
export function supportedInput(caps, input) { if (!caps?.configured || !caps.inputs?.[input]) throw Error('该网关未配置或不支持所选参考输入；没有提交任务'); return input; }
export class ReferenceGateway {
  constructor(base = '/api/reference-jobs') { if (!/^\/api\/[\w/-]+$/.test(base)) throw Error('请使用同源 /api/ 网关，不在浏览器保存服务商密钥'); this.base = base; }
  async request(path, options = {}, signal) {
    requireWebGateway();
    const own = new AbortController(), abort = () => own.abort(signal.reason); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => own.abort(new DOMException('生成网关请求超时', 'TimeoutError')), 20000);
    try {
      const res = await fetch(this.base + path, { ...options, signal: own.signal, credentials: 'same-origin' });
      const text = await res.text(); if (text.length > 128 * 1024) throw Error('网关响应过大'); let data; try { data = JSON.parse(text); } catch { throw Error('参考生成网关未启动或返回非 JSON；file 离线版请使用手动交付 ZIP'); }
      if (!res.ok) throw Error(data.error || `生成网关 HTTP ${res.status}`); return data;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async discover(signal) { this.caps = cleanCapabilities(await this.request('/capabilities', {}, signal)); return this.caps; }
  prepare(version, { mode, prompt, variant = 'normal' }) {
    supportedInput(this.caps, mode); if (!prompt?.trim() || prompt.length > 12000) throw Error('提示词不能为空，且最多 12000 字符');
    const data = new FormData(); data.set('input', mode); data.set('prompt', prompt); data.set('sourceFingerprint', version.meta.sourceFingerprint); data.set('versionId', version.meta.id); data.set('referenceVariant', variant);
    data.set('parameters', JSON.stringify({ duration: version.meta.manifest.encodedDuration, fps: version.meta.manifest.settings.fps, width: version.meta.manifest.settings.width, height: version.meta.manifest.settings.height, seed: version.meta.manifest.settings.seed }));
    let size = 0;
    if (mode === 'first-last') {
      if (variant !== 'normal') throw Error('首尾帧接口当前使用正常画面，灰模请选视频参考或手动交付');
      for (const [key, filename] of [['first', 'first.png'], ['last', 'last.png']]) { const blob = version.media[key]; if (!(blob instanceof Blob)) throw Error('该本地版本缺少参考图片'); size += blob.size; data.set(key, blob, filename); }
    }
    if (mode === 'video') { const blob = version.media[variant]; if (!(blob instanceof Blob)) throw Error('参考视频不存在'); size = blob.size; data.set('video', blob, `${variant}.webm`); }
    if (size > this.caps.maxBytes) throw Error('所选参考素材超过网关大小上限');
    return data;
  }
  async submit(version, options, signal) {
    const data = this.prepare(version, options); return this.task(await this.request('', { method: 'POST', body: data }, signal));
  }
  task(data) {
    if (!data || !/^[\w.-]{1,160}$/.test(data.id || '') || !['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled'].includes(data.status)) throw Error('生成任务响应无效');
    let resultURL = null; if (data.resultURL) { const u = new URL(data.resultURL, location.origin); if (u.protocol !== 'https:' && !(u.origin === location.origin && u.protocol === 'http:')) throw Error('生成结果 URL 必须为 HTTPS / 同源'); resultURL = u.href; }
    return { id: data.id, status: data.status, resultURL, message: String(data.message || '').slice(0, 500) };
  }
  async status(id, signal) { if (!/^[\w.-]{1,160}$/.test(id || '')) throw Error('任务 ID 无效'); return this.task(await this.request('/' + encodeURIComponent(id), {}, signal)); }
  async poll(id, onStatus, signal, maxMs = 10 * 60 * 1000) {
    const start = Date.now(); let delay = 1500;
    while (Date.now() - start < maxMs) {
      signal?.throwIfAborted(); const task = await this.status(id, signal); await onStatus(task);
      if (!['queued', 'running'].includes(task.status)) return task;
      await new Promise((resolve, reject) => { const stop = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, delay); if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true }); }); delay = Math.min(10000, delay * 1.5);
    }
    throw Error('本地查询已达 10 分钟；云端任务可能仍在运行，可稍后恢复查询，不要重复提交');
  }
}
