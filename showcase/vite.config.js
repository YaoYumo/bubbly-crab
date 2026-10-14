import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// showcase 独立根的实例读不到仓库根 vite.config：这里补同款防缓存头，
// 否则预览代理/浏览器会把 index.html 与模块缓存成旧版（"预览不更新"）
export default defineConfig({
  server: {
    host: '0.0.0.0',
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0' },
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
  build: { target: 'es2022' },
});
