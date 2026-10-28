import { DESKTOP_BUILD, requireWebGateway } from './desktop-runtime.js';
// ---------------------------------------------------------------------------
// Seedance 2.0 API 服务 — 直接调用 Volcengine Ark API
// ---------------------------------------------------------------------------

const API_DIRECT = 'https://ark.cn-beijing.volces.com/api/v3';
const MODEL = 'doubao-seedance-2-0-260128';

const STYLE_MODIFIERS = {
  0: { zh: '电影感，浅景深，胶片颗粒感，暖色调调色', en: 'cinematic, shallow depth of field, film grain, warm color grading' },
  1: { zh: '赛博朋克风格，霓虹灯光，雨夜反射，高对比度蓝紫色调', en: 'cyberpunk style, neon lights, rain reflections, high contrast blue-purple tones' },
  2: { zh: '现代都市，干净明亮的自然光，现代建筑，简约大气', en: 'modern urban, clean bright natural light, contemporary architecture, minimalist' },
  3: { zh: '自然纪实风格，柔和自然光，真实质感，纪录片镜头语言', en: 'natural documentary style, soft natural light, realistic texture, documentary cinematography' },
  4: { zh: '动画风格，色彩鲜艳，柔和光影，皮克斯风格渲染', en: 'animation style, vibrant colors, soft lighting, Pixar-style rendering' },
  5: { zh: '写实摄影，超高清细节，自然曝光，专业摄影机质感', en: 'photorealistic, ultra HD detail, natural exposure, professional camera quality' },
};

const RATIO_MAP = {
  '1280x720': '16:9', '1920x1080': '16:9', '2560x1440': '16:9',
  '1080x1920': '9:16', '1920x804': '21:9', '1080x1080': '1:1',
};

const RES_MAP = {
  '1280x720': '720p', '1920x1080': '720p', '2560x1440': '720p',
  '1080x1920': '720p', '1920x804': '720p', '1080x1080': '720p',
};

export class SeedanceService {
  constructor() {
    this.apiKey = DESKTOP_BUILD ? '' : (localStorage.getItem('seedance_api_key') || '');
    this.tasks = [];
  }

  setKey(key) {
    requireWebGateway();
    this.apiKey = key.trim();
    localStorage.setItem('seedance_api_key', this.apiKey);
  }

  hasKey() { return !!this.apiKey; }

  async _fetch(path, opts = {}) {
    requireWebGateway();
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    try {
      const res = await fetch(`${API_DIRECT}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text || res.statusText}`);
      }
      return res.json();
    } catch (e) {
      if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
        throw new Error('无法连接到 API（可能是 CORS 限制）。请确认：1) API Key 正确；2) 网络可访问 ark.cn-beijing.volces.com；3) 如需代理请配置 vite.config.js 中的 proxy。');
      }
      throw e;
    }
  }

  buildPrompt(userPrompt, styleIdx = 0) {
    const style = STYLE_MODIFIERS[styleIdx] || STYLE_MODIFIERS[0];
    return `${userPrompt}。${style.zh}。`;
  }

  async createTask({ prompt, styleIdx = 0, ratio = '16:9', duration = 5, resolution = '720p', draft = false, audio = true, seed = -1 }) {
    const fullPrompt = this.buildPrompt(prompt, styleIdx);
    const body = {
      model: MODEL,
      content: [{ type: 'text', text: fullPrompt }],
      ratio,
      duration: Math.max(4, Math.min(15, duration)),
      resolution,
      generate_audio: audio,
      seed,
    };
    if (draft) { body.draft = true; body.resolution = '480p'; }
    return this._fetch('/contents/generations/tasks', { method: 'POST', body: JSON.stringify(body) });
  }

  async pollTask(taskId, onStatus, intervalMs = 10000) {
    const poll = async () => {
      const data = await this._fetch(`/contents/generations/tasks/${taskId}`);
      if (onStatus) onStatus(data);
      if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'expired') return data;
      await new Promise(r => setTimeout(r, intervalMs));
      return poll();
    };
    return poll();
  }

  async generate(params, onProgress) {
    if (!this.hasKey()) throw new Error('请先设置 API Key');
    if (onProgress) onProgress({ phase: 'creating', message: '正在创建生成任务…' });
    const result = await this.createTask(params);
    const taskId = result.id;
    if (onProgress) onProgress({ phase: 'queued', message: '任务已提交，等待处理…', taskId });
    const final = await this.pollTask(taskId, (data) => {
      if (onProgress) onProgress({ phase: data.status, message: `状态: ${data.status}`, taskId, data });
    });
    return final;
  }

  ratioFromRes(resKey) { return RATIO_MAP[resKey] || '16:9'; }
  resFromResKey(resKey) { return RES_MAP[resKey] || '720p'; }
}

export const seedance = new SeedanceService();
