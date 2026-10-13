// 「一句话生成」主入口契约回归（配 test/withchrome.sh 或任一 PUPPETEER_EXECUTABLE_PATH 环境）：
// 1) 真实用户首访（webdriver=false）：落地 Scene 页 + 模型库收起 + 自动弹对话框、刷新不复弹
// 2) 自动化（webdriver=true）：绝不自动弹窗（保护既有套件）
// 3) 模型库二级入口可点开/收起；切页舞台随行；全程零 pageerror
import puppeteer from 'puppeteer';
import fs from 'node:fs';
fs.mkdirSync('test/out', { recursive: true });

const URL0 = process.env.URL || 'http://localhost:5174/';
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});

/* ---- A：模拟真实用户（webdriver=false），首访应自动弹窗 ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 850 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + (e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|Vite/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  });
  await page.goto(URL0, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 700));

  const s = await page.evaluate(() => ({
    page: document.getElementById('app').dataset.page,
    onId: document.querySelector('.page.on')?.id,
    stageInScene: !!document.getElementById('viewport-scene')?.contains(document.getElementById('stage')),
    libVisible: !!document.getElementById('library-scene')?.offsetParent,
    dlgOpen: !!document.querySelector('.tg-mask'),
    toolRowVisible: !!document.querySelector('.tool-row')?.offsetParent,
    townBtn: [...document.querySelectorAll('.tool-row .tb')].some((b) => /一句话生成/.test(b.textContent)),
    capOn: document.querySelector('.cap.on')?.dataset.page,
    libState: document.getElementById('lib-toggle-state')?.textContent,
  }));
  ck('A1 落地 Scene 页', s.page === 'scene' && s.onId === 'page-scene' && s.capOn === 'scene', JSON.stringify(s));
  ck('A2 3D 舞台在 Scene 视口', s.stageInScene);
  ck('A3 模型库默认收起', !s.libVisible && s.libState === '展开 ▸');
  ck('A4 首访自动弹出一句话生成对话框', s.dlgOpen);
  await page.screenshot({ path: 'test/out/entry-landing.png' });
  ck('A5 Scene 工具条可见且有一句话生成按钮', s.toolRowVisible && s.townBtn);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  const closed = await page.evaluate(() => !document.querySelector('.tg-mask'));
  ck('A6 Esc 关闭对话框', closed);

  // 二级入口：点开模型库 → 卡片可见 → 再收起
  await page.click('#lib-toggle');
  await new Promise((r) => setTimeout(r, 150));
  const opened = await page.evaluate(() => ({
    vis: !!document.getElementById('library-scene')?.offsetParent,
    cards: document.querySelectorAll('#library-scene .card').length,
    state: document.getElementById('lib-toggle-state').textContent,
  }));
  ck('B1 点标题展开模型库', opened.vis && opened.cards > 100 && opened.state === '收起 ▾', JSON.stringify(opened));
  await page.click('#lib-toggle');
  await new Promise((r) => setTimeout(r, 150));
  const reclosed = await page.evaluate(() => !document.getElementById('library-scene')?.offsetParent && document.getElementById('lib-toggle-state').textContent === '展开 ▸');
  ck('B2 再点收起', reclosed);

  // 切到 Direct 再切回，舞台应跟着页走（既有 switchPage 路径）
  await page.evaluate(() => { [...document.querySelectorAll('.cap')].find((c) => c.dataset.page === 'direct').click(); });
  await new Promise((r) => setTimeout(r, 250));
  const toDirect = await page.evaluate(() => ({
    on: document.getElementById('app').dataset.page,
    stageInShared: !!document.getElementById('viewport-shared')?.contains(document.getElementById('stage')),
  }));
  ck('B3 切 Direct 舞台回共享视口', toDirect.on === 'direct' && toDirect.stageInShared, JSON.stringify(toDirect));
  await page.evaluate(() => { [...document.querySelectorAll('.cap')].find((c) => c.dataset.page === 'scene').click(); });
  await new Promise((r) => setTimeout(r, 250));
  const backScene = await page.evaluate(() => ({
    on: document.getElementById('app').dataset.page,
    stageInScene: !!document.getElementById('viewport-scene')?.contains(document.getElementById('stage')),
    toolRow: !!document.querySelector('.tool-row')?.offsetParent,
  }));
  ck('B4 切回 Scene 一切就位', backScene.on === 'scene' && backScene.stageInScene && backScene.toolRow, JSON.stringify(backScene));

  // 一键清空：Scene 顶栏可见、单击一次即清（不需要二次确认）
  const pre = await page.evaluate(() => {
    const k = [...window.__t.LIB_INDEX.keys()][0];
    window.app.addAsset(k, new window.__t.THREE.Vector3(0, 0, 0));
    return window.app.objects.length;
  });
  const cleared = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-row .tb')].find((x) => /\s*清空\s*$/.test(x.textContent.trim()) || x.textContent.trim() === '⌫清空');
    if (!b) return { clicked: false, n: window.app.objects.length };
    b.click();
    return { clicked: true, n: window.app.objects.length };
  });
  ck('B5 一键清空：Scene 工具条单击一次即清', pre > 0 && cleared.clicked && cleared.n === 0, `pre=${pre} post=${cleared.n}`);

  ck('A7 全程零 pageerror/console error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'test/out/entry-scene.png' });

  // 同一标签页刷新：不应再弹窗（sessionStorage 记忆）
  await page.reload({ waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 700));
  const afterReload = await page.evaluate(() => ({ dlg: !!document.querySelector('.tg-mask'), page: document.getElementById('app').dataset.page }));
  ck('A8 同标签刷新不再弹窗、仍落 Scene', !afterReload.dlg && afterReload.page === 'scene', JSON.stringify(afterReload));
  await page.close();
}

/* ---- C：模拟自动化（webdriver=true，套件路径），不得弹窗 ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 850 });
  await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 800));
  const s = await page.evaluate(() => ({ dlg: !!document.querySelector('.tg-mask'), page: document.getElementById('app').dataset.page }));
  ck('C1 自动化路径不弹窗', !s.dlg, JSON.stringify(s));
  ck('C2 自动化路径也落 Scene 页（DOM 可达）', s.page === 'scene');
  await page.close();
}

/* ---- D：窄预览窗（900×640）整页必须完整显示 ---- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 640 });
  await page.goto(URL0, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 500));
  const s = await page.evaluate(() => {
    const top = document.getElementById('top');
    const btns = [...document.querySelectorAll('#top .tb')];
    const offscreen = btns.filter((b) => {
      const r = b.getBoundingClientRect();
      return b.offsetParent === null || r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1;
    }).map((b) => b.textContent.trim().slice(0, 12));
    return {
      hOverflow: document.scrollingElement.scrollWidth - innerWidth,
      topClipped: top.scrollHeight - top.clientHeight,
      offscreen,
      btnCount: btns.length,
      sidebarsHidden: getComputedStyle(document.getElementById('left-scene')).display === 'none',
    };
  });
  ck('D1 窄窗无横向溢出', s.hOverflow <= 1, `overflow=${s.hOverflow}px`);
  ck('D2 顶栏内容不被裁切', s.topClipped <= 2, `clip=${s.topClipped}px`);
  ck('D3 顶栏全部按钮在可视区内', s.offscreen.length === 0, `${s.btnCount} 个按钮，出界: ${s.offscreen.join(',') || '无'}`);
  ck('D4 ≤1000px 侧栏收起让宽给视口', s.sidebarsHidden);
  await page.screenshot({ path: 'test/out/entry-narrow.png' }).catch(() => {});
  await page.close();
}

await browser.close();
console.log(fails.length ? `\nFAILED(${fails.length}):\n` + fails.join('\n') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
