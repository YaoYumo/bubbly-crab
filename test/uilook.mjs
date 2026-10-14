// 「精度 / 外观」相关 UI 接线检查：光影面板三行 + 顶栏精度下拉，都要真的作用到场景上
// 运行：node test/uilook.mjs
import puppeteer from 'puppeteer';

const URL0 = process.env.URL || 'http://localhost:5174/';
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 850, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools/.test(m.text())) errors.push('console: ' + m.text().split('\n')[0]); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t.applyScene, { timeout: 180000 });

const R = await page.evaluate(async () => {
  const app = window.app;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__t.applyScene(app, 'city-day');
  [...document.querySelectorAll('.itab')].find((t) => /光影/.test(t.textContent)).click();
  await wait(400);
  const rowText = (el) => (el.closest('.row')?.textContent || '');
  const rows = [...document.querySelectorAll('.row')];
  const out = {
    精度行: rows.some((r) => /模型精度/.test(r.textContent)),
    贴图行: rows.some((r) => /表面贴图/.test(r.textContent)),
    反射行: rows.some((r) => /环境反射/.test(r.textContent)),
  };
  const maps = () => { let k = 0; app.stage.world.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.normalMap) k++; }); return k; };
  const countMaps = () => maps();
  out.贴图数_初始 = countMaps();

  // 「表面贴图」开关：关掉 → 场景里法线贴图清零；开回来 → 数量复原
  const sw = [...document.querySelectorAll('button.sw')].find((b) => /表面贴图/.test(rowText(b)));
  if (sw) {
    sw.click(); await wait(500); out.贴图数_关 = countMaps();
    sw.click(); await wait(500); out.贴图数_开 = countMaps();
  }
  // 「环境反射强度」滑块：0 → scene.environmentIntensity 真的变 0
  const rng = [...document.querySelectorAll('input[type=range]')].find((x) => /环境反射/.test(rowText(x)));
  if (rng) {
    rng.value = '0'; rng.dispatchEvent(new Event('input', { bubbles: true })); await wait(160);
    out.反射_关 = app.stage.scene.environmentIntensity;
    rng.value = '0.8'; rng.dispatchEvent(new Event('input', { bubbles: true })); await wait(160);
    out.反射_开 = app.stage.scene.environmentIntensity;
  }
  // 顶栏精度下拉：三档都要重建场景，并且写回 state（工程 JSON 会带上）
  const sel = document.getElementById('detailSel');
  out.下拉项 = sel ? sel.options.length : 0;
  const tri = {};
  for (const lv of ['lite', 'std', 'fine']) {
    if (!sel) break;
    sel.value = lv; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(lv === 'fine' ? 2600 : 1200);
    tri[lv] = app.detailStats().tri;
    out['state_' + lv] = app.state.detail;
  }
  out.三角面 = tri;
  out.序列化 = app.serialize().state;
  // 环境反射贴图（PMREM）在，且地面也吃到沥青
  out.环境贴图 = !!app.stage.scene.environment;
  out.地面贴图 = !!app.stage.groundMat.map;
  if (sel) { sel.value = 'std'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1200); }
  return out;
});

ck('光影面板有「模型精度 / 表面贴图 / 环境反射强度」三行', R.精度行 && R.贴图行 && R.反射行, JSON.stringify({ a: R.精度行, b: R.贴图行, c: R.反射行 }));
ck('「表面贴图」开关真的挂 / 摘贴图', R.贴图数_初始 > 100 && R.贴图数_关 === 0 && R.贴图数_开 === R.贴图数_初始, `${R.贴图数_初始} → ${R.贴图数_关} → ${R.贴图数_开}`);
ck('「环境反射强度」滑块联动 scene.environmentIntensity', R.反射_关 === 0 && Math.abs(R.反射_开 - 0.8) < 1e-6, `${R.反射_关} / ${R.反射_开}`);
ck('顶栏精度下拉三档都重建（三角面单调）', R.下拉项 === 3 && R.三角面.lite < R.三角面.std && R.三角面.std < R.三角面.fine, JSON.stringify(R.三角面));
ck('切档写进 state 与工程 JSON', R.state_lite === 'lite' && R.state_fine === 'fine' && R.序列化.detail === 'fine', JSON.stringify(R.序列化));
ck('环境反射与地面沥青在位', R.环境贴图 && R.地面贴图, `${R.环境贴图}/${R.地面贴图}`);
ck('全程无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n' + JSON.stringify({ pass: fails.length === 0, failCount: fails.length, fails }, null, 1));
await browser.close();
process.exit(fails.length ? 1 : 0);
