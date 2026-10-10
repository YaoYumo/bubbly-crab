// 把 test/out/detail-{lite,std,fine}.png 拼成一页可离线打开的三档对比（图片以 data URI 内嵌）
import fs from 'fs';
import path from 'path';
const files = [['lite', '省内存 lite｜无贴图 · 段数×0.62 · 人物不收小件'], ['std', '均衡 std（默认）｜256² 贴图 · 倒角 1×'], ['fine', '高细节 fine｜512² 贴图 · 段数×1.85 · 人群也加小件']];
const cells = files.map(([k, cap]) => {
  const p = path.join('test/out', `detail-${k}.png`);
  if (!fs.existsSync(p)) { console.warn('缺少', p); return ''; }
  const b64 = fs.readFileSync(p).toString('base64');
  return `<figure><img src="data:image/png;base64,${b64}" alt="${k}"><figcaption>${cap}</figcaption></figure>`;
}).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>精度三档对比</title>
<style>
 body{margin:0;background:#0c0f14;color:#dfe6ef;font:14px/1.6 -apple-system,"PingFang SC",system-ui,sans-serif;padding:22px}
 h1{font-size:19px;margin:0 0 4px} p.sub{color:#8b97a8;margin:0 0 18px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}
 figure{margin:0;background:#131820;border:1px solid #222b38;border-radius:10px;overflow:hidden}
 img{display:block;width:100%;height:auto}
 figcaption{padding:9px 12px;font-size:13px;color:#b9c4d2;border-top:1px solid #222b38}
</style>
<h1>模型精度：省内存 / 均衡 / 高细节</h1>
<p class="sub">同一场景（cn-palace 34 件）、同一机位。三角面 96,384 → 164,516 → 466,714；表面贴图与程序化环境反射只在 std / fine 生效。</p>
<div class="grid">${cells}</div>
`;
fs.writeFileSync('detail-compare.html', html);
console.log('detail-compare.html', (html.length / 1024).toFixed(0), 'KB');
