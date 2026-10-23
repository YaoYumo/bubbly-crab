import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    fs: { deny: ['.env', '.env.*', '**/*.{crt,pem}', '**/.git/**', '**/local-ai/config.local.json', '**/local-ai/models/**', '**/local-ai/runtimes/**', '**/local-ai/cache/**', '**/local-ai/logs/**'] },
    proxy: { '/api/ai-scenes': { target: 'http://127.0.0.1:5177', changeOrigin: false }, '/api/reference-jobs': { target: 'http://127.0.0.1:5176', changeOrigin: false } },
    port: 5174, // 与 test/*.mjs 默认 URL 一致（5173 已弃用）
    // 防中间代理/浏览器启发式缓存把 index.html 与模块缓存成旧版
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0' },
  },
  build: { target: 'es2022' },
  preview: { host: '0.0.0.0', port: 5174, proxy: { '/api/ai-scenes': { target: 'http://127.0.0.1:5177', changeOrigin: false }, '/api/reference-jobs': { target: 'http://127.0.0.1:5176', changeOrigin: false } } },
});
