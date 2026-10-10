// 面板参数：文本型参数（牌楼「匾额题字」）必须能在检查器里改、可撤销、改完真的重建
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1560,900', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 60000 });

const R = await page.evaluate(async () => {
  const app = window.app;
  const out = { errors: [] };
  app.clearAll();
  const so = app.addAsset('cn:paifang:牌楼牌坊', [0, 0, 0], {});
  app.select({ kind: 'obj', so });
  await new Promise((r) => requestAnimationFrame(r));
  // 1) 检查器里应有一行「匾额题字」，而且是文本框（不是滑杆 / 开关）
  const inp = [...document.querySelectorAll('input.tx, input.txt')].find((i) => /匾额题字/.test((i.closest('.row') || i.parentElement || {}).textContent || ''));
  const row = inp ? inp.closest('.row') : null;
  out.rowFound = !!row;
  out.panelRows = document.querySelectorAll('.row').length;
  out.fields = [...document.querySelectorAll('.row .lab')].map((x) => x.textContent).slice(0, 40);
  out.inputFound = !!inp;
  out.inputType = inp ? (inp.getAttribute('type') || 'text') : null;
  out.value0 = inp ? inp.value : null;
  out.isRange = !!(row && row.querySelector('input[type=range]'));
  if (!inp) return out;
  // 2) 改字 → 写回 params 并重建（带题字贴图的匾额面数量 > 0）
  const setText = (t) => {
    inp.value = t;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setText('忠孝仁义');
  await new Promise((r) => setTimeout(r, 220));
  out.text1 = app.objects[0].params.text;
  let mapped = 0;
  app.objects[0].root.traverse((m) => { if (m.isMesh && m.material && m.material.map && m.material.map.image) mapped++; });
  out.mappedFaces = mapped;
  // 3) 一步一撤销：Ctrl+Z 后回到默认题字
  document.body.focus();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));
  out.textUndo = app.objects[0].params.text;
  return out;
});
await browser.close();

const fails = [];
const ck = (n, v, extra = '') => { fails.push({ n, ok: !!v, extra }); };
ck('检查器有「匾额题字」一行', R.rowFound);
ck('它是文本输入框（不是滑杆）', R.inputFound && !R.isRange, 'type=' + R.inputType);
ck('默认题字已填进输入框', typeof R.value0 === 'string' && R.value0.length >= 2, JSON.stringify(R.value0));
ck('改字写回 params', R.text1 === '忠孝仁义', JSON.stringify(R.text1));
ck('改完重建出带题字贴图的匾额面', R.mappedFaces > 0, 'mapped=' + R.mappedFaces);
ck('Ctrl+Z 撤销回默认题字', R.textUndo && R.textUndo !== '忠孝仁义', JSON.stringify(R.textUndo));
ck('无页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

const bad = fails.filter((f) => !f.ok);
for (const f of fails) console.log((f.ok ? '✔ ' : '✘ ') + f.n + (f.extra ? ' — ' + f.extra : ''));
console.log(JSON.stringify({ pass: bad.length ? 'FAIL' : 'ALL', failCount: bad.length, fails: bad.map((b) => b.n + ' ' + b.extra) }, null, 1));
process.exit(bad.length ? 1 : 0);
