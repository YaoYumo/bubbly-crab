// Optional single-user development BFF. Production requires authentication,
// quotas and per-user ownership at a trusted reverse proxy. Never expose vendor keys to browsers.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const INPUTS = ['text', 'first-last', 'video'], MAX = 48 * 1024 * 1024;
export function createReferenceGateway({ gatewayURL = process.env.REFERENCE_GATEWAY_URL, token = process.env.REFERENCE_GATEWAY_TOKEN, arkKey = process.env.ARK_API_KEY, arkModel = process.env.ARK_MODEL, allowLocal = process.env.REFERENCE_GATEWAY_ALLOW_LOCAL === '1', fetcher = fetch } = {}) {
  if (gatewayURL) { const u = new URL(gatewayURL); if (u.protocol !== 'https:' && !(allowLocal && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) throw Error('Upstream gateway must be HTTPS (local HTTP requires explicit opt-in)'); if (u.username || u.password || u.search || u.hash) throw Error('Use token env, not URL credentials/query'); gatewayURL = gatewayURL.replace(/\/$/, ''); }
  const configuredArk = !!(arkKey && arkModel);
  const remote = async (url, options = {}) => {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const text = await response.text(); if (text.length > 128 * 1024) throw Error('Upstream response too large');
    let json; try { json = JSON.parse(text); } catch { throw Error('Upstream did not return JSON'); }
    if (!response.ok) throw Error(`Upstream HTTP ${response.status}`); return json;
  };
  const caps = async () => {
    if (gatewayURL) {
      const c = await remote(gatewayURL + '/capabilities', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (c.version !== 1 || !c.inputs || typeof c.inputs !== 'object') throw Error('Unsupported upstream capability protocol');
      return { version: 1, configured: c.configured === true, provider: String(c.provider || 'custom-gateway').slice(0, 100), model: String(c.model || '').slice(0, 120), inputs: Object.fromEntries(INPUTS.map(k => [k, c.inputs[k] === true])), maxBytes: Math.min(MAX, Number(c.maxBytes) || MAX), remoteCancel: false };
    }
    return { version: 1, configured: configuredArk, provider: configuredArk ? 'ARK (text only)' : 'manual / not configured', model: arkModel || '', inputs: { text: configuredArk, 'first-last': false, video: false }, remoteCancel: false, maxBytes: MAX };
  };
  return http.createServer(async (req, res) => {
    const reply = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://internal').pathname;
      if (!path.startsWith('/api/reference-jobs')) return reply(404, { error: 'Not found' });
      if (req.method === 'GET' && path === '/api/reference-jobs/capabilities') return reply(200, await caps());
      // Same-origin browser guard. Not a replacement for production authentication.
      if (req.headers.origin) { const origin = new URL(req.headers.origin); const allowed = req.headers['x-forwarded-host'] || req.headers.host; if (origin.host !== allowed) return reply(403, { error: 'Cross-origin requests are not allowed' }); }
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      if (req.method === 'POST' && path === '/api/reference-jobs') {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX) return reply(413, { error: 'Reference upload exceeds 48MB' }); chunks.push(chunk); }
        const type = req.headers['content-type'] || ''; if (!type.startsWith('multipart/form-data;')) return reply(415, { error: 'multipart/form-data required' });
        const data = await new Request('http://internal', { method: 'POST', headers: { 'Content-Type': type }, body: Buffer.concat(chunks) }).formData();
        const capability = await caps(), mode = data.get('input'), prompt = data.get('prompt');
        if (!capability.configured) return reply(503, { error: '生成网关未配置。请使用手动参考 ZIP，或由部署者设置服务端配置。' });
        if (!INPUTS.includes(mode) || !capability.inputs[mode]) return reply(422, { error: '所选参考输入不受支持；没有创建任务。' });
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) return reply(400, { error: 'Invalid prompt' });
        const file = k => { const v = data.get(k); return v && typeof v !== 'string' && v.size > 0 ? v : null; };
        if ((mode === 'first-last' && (!file('first') || !file('last'))) || (mode === 'video' && !file('video'))) return reply(400, { error: 'Missing reference files' });
        if (mode === 'text' && ['first', 'last', 'video'].some(file)) return reply(400, { error: 'Text mode must not silently ignore reference files' });
        if (bytes > capability.maxBytes + 128 * 1024) return reply(413, { error: 'Reference exceeds provider size limit' });
        if (gatewayURL) return reply(200, await remote(gatewayURL + '/jobs', { method: 'POST', headers, body: data }));
        const p = JSON.parse(data.get('parameters') || '{}'); const ratioValue = Number(p.width) / Number(p.height);
        const ratio = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['21:9', 21 / 9]].find(([, v]) => Math.abs(v - ratioValue) < .02)?.[0];
        if (!ratio || !Number.isInteger(p.duration) || p.duration < 4 || p.duration > 15) return reply(422, { error: 'ARK text adapter requires integer 4–15s and supported ratio; no silent clamping. Output is requested at 720p, not reference pixel resolution.' });
        const task = await remote('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', { method: 'POST', headers: { Authorization: `Bearer ${arkKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: arkModel, content: [{ type: 'text', text: prompt }], ratio, duration: p.duration, resolution: '720p', generate_audio: false, seed: p.seed ?? -1 }) });
        return reply(200, { id: task.id, status: task.status || 'queued' });
      }
      const match = path.match(/^\/api\/reference-jobs\/([\w.-]{1,160})$/);
      if (req.method === 'GET' && match) {
        if (gatewayURL) return reply(200, await remote(gatewayURL + '/jobs/' + encodeURIComponent(match[1]), { headers }));
        if (!configuredArk) return reply(503, { error: 'Gateway not configured' });
        const t = await remote('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/' + encodeURIComponent(match[1]), { headers: { Authorization: `Bearer ${arkKey}` } });
        return reply(200, { id: t.id, status: t.status, resultURL: t.content?.video_url, message: t.error?.message || '' });
      }
      return reply(405, { error: 'Unsupported method; remote cancellation is not advertised' });
    } catch (error) { return reply(502, { error: /timeout/i.test(error.name) ? 'Upstream timed out; a submitted task may still be running. Do not blindly resubmit.' : 'Gateway error: ' + (error.message || 'unknown') }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createReferenceGateway(); server.requestTimeout = 30000; server.headersTimeout = 15000; server.listen(Number(process.env.PORT) || 5176, '0.0.0.0', () => console.log('Reference gateway listening on 0.0.0.0:' + server.address().port + ' (no keys configured = manual delivery only)'));
}
