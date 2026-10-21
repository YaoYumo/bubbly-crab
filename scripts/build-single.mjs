// 单文件构建：把全部 JS/CSS 内联进一个 HTML，双击即可离线打开（无需 npm/服务器）
// 用法：node scripts/build-single.mjs   →   ../previz-lab.html
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'build-single');

await build({
  root,
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    sourcemap: false,
    rollupOptions: {
      output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' },
    },
  },
});

const htmlPath = path.join(outDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const inlineJs = (m) => {
  const file = path.join(outDir, m[2].replace(/^.\//, ''));
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${code}</script>`;
};
const inlineCss = (m) => {
  const file = path.join(outDir, m[1].replace(/^.\//, ''));
  return `<style>${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
};

let jsInlined = 0, cssInlined = 0;
html = html.replace(/<script[^>]*\bsrc="(\/[^"]+|\.\/[^"]+)"[^>]*><\/script>/g, (full, src) => {
  const p = path.join(outDir, src.replace(/^\/+/, '').replace(/^.\//, ''));
  if (!fs.existsSync(p)) return full;
  const code = fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
  jsInlined++;
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (full, href) => {
  const p = path.join(outDir, href.replace(/^\/+/, '').replace(/^.\//, ''));
  if (!fs.existsSync(p)) return full;
  cssInlined++;
  return `<style>${fs.readFileSync(p, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
});

if (!jsInlined || !cssInlined) {
  console.error(`内联不完整：js=${jsInlined} css=${cssInlined}\n`, html.slice(0, 600));
  process.exit(1);
}
// 单文件模式下这些资源已经不该存在
html = html.replace(/<link[^>]*rel="(?:modulepreload|preload)"[^>]*>/g, '');

const dest = path.join(root, 'previz-lab.html');
// Third-party GLSL templates contain whitespace-only lines; keep generated diffs clean.
fs.writeFileSync(dest, html.replace(/^[ \t]+$/gm, ''));
const kb = (fs.statSync(dest).size / 1024).toFixed(0);
console.log(`✔ 已生成 ${path.relative(process.cwd(), dest)}（${kb} KB，含全部 three.js 与加载器，可离线双击打开）`);
fs.rmSync(outDir, { recursive: true, force: true });
