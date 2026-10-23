import { requireWebGateway } from './desktop-runtime.js';
const KEY = 'previz.ai-scene.task.v1';
export class AISceneGateway {
  constructor() {
    try {
      this.last = JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      this.last = null;
    }
  }
  remember(value) {
    this.last = value;
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch {
      /* UI still has task in memory */
    }
  }
  async request(path, options = {}, signal) {
    requireWebGateway();
    if (location.protocol === 'file:')
      throw Error('file离线版使用本地配方 / 手动工作包，不访问网关');
    const ctl = new AbortController(),
      abort = () => ctl.abort(signal.reason),
      timer = setTimeout(
        () => ctl.abort(new DOMException('AI网关请求超时', 'TimeoutError')),
        20000,
      );
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const r = await fetch('/api/ai-scenes' + path, {
        ...options,
        headers: {
          ...options.headers,
          ...(this.accessToken
            ? { Authorization: 'Bearer ' + this.accessToken }
            : {}),
        },
        signal: ctl.signal,
        credentials: 'same-origin',
      });
      const text = await r.text();
      if (text.length > 1024 * 1024) throw Error('AI网关响应过大');
      let d;
      try {
        d = JSON.parse(text);
      } catch {
        throw Error('AI网关未启动或非JSON响应');
      }
      if (!r.ok) throw Error(d.error || 'AI gateway HTTP' + r.status);
      return d;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  async discover() {
    const c = await this.request('/capabilities');
    if (c.version !== 1 || c.output !== 'previz-ai-scene/1')
      throw Error('AI搭景能力协议无效');
    this.caps = c;
    return c;
  }
  async submit(prompt, workpack) {
    if (!this.caps?.configured) throw Error('请先检查已配置的AI网关；没有提交');
    if (this.caps.requiresAuth && !this.accessToken)
      throw Error('请输入独立网关访问口令（不是模型Key）');
    if (this.last && !['succeeded', 'failed'].includes(this.last.status))
      throw Error('已有未确认 / 运行请求，请先恢复查询；不要重复计费');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000)
      throw Error('需求需1–8000字符');
    const requestId = crypto.randomUUID();
    const body = JSON.stringify({ requestId, prompt, workpack });
    if (
      new TextEncoder().encode(body).length >
      Math.min(4 * 1024 * 1024, this.caps.maxBytes || 4 * 1024 * 1024)
    )
      throw Error('工作包超过4MiB上限，未提交');
    this.remember({ requestId, status: 'submission-unknown' });
    try {
      const job = await this.request('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      this.remember({ requestId, id: job.id, status: job.status });
      return job;
    } catch (e) {
      throw Error(
        '提交状态未确认：' +
          e.message +
          '。可按请求ID恢复查询；不要自动重试，可能已计费。',
      );
    }
  }
  async recover(signal) {
    if (!this.last?.requestId) throw Error('没有保存的请求记录');
    const r = this.last,
      path = r.id
        ? '/jobs/' + encodeURIComponent(r.id)
        : '/requests/' + encodeURIComponent(r.requestId);
    const job = await this.request(path, {}, signal);
    this.remember({ ...r, id: job.id, status: job.status });
    return job;
  }
  async poll(onStatus, signal) {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      signal?.throwIfAborted();
      const job = await this.recover(signal);
      await onStatus(job);
      if (!['queued', 'running'].includes(job.status)) return job;
      await new Promise((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', stop);
          resolve();
        }, 1500);
        if (signal?.aborted) stop();
        else signal?.addEventListener('abort', stop, { once: true });
      });
    }
    throw Error('本地查询已达3分钟；可恢复查询，不重新提交');
  }
}
