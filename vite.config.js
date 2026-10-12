import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 防中间代理/浏览器启发式缓存把 index.html 与模块缓存成旧版
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0' },
  },
  build: { target: 'es2022' },
  preview: { host: '0.0.0.0', port: 5173 },
});
