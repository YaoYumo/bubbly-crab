// 探针：完全模拟真实 UI 手绘——切「地形」tab → 点「开始绘制」→ 放点 → 双击完成（两条交叉路）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.app && window.app.stage && window.app.stage.renderer, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));

// 切到「地形」tab，再点「开始绘制」
const step1 = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '地形' && b.classList.contains('itab'));
  if (tab) tab.click();
  return !!tab;
});
await new Promise((r) => setTimeout(r, 400));
const step2 = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '开始绘制');
  if (btn) btn.click();
  return !!btn;
});
await new Promise((r) => setTimeout(r, 300));
const active0 = await page.evaluate(() => !!window.app.roadBrush?.active);

// 路 A：横穿；末点双击完成
await page.mouse.click(400, 520);
await new Promise((r) => setTimeout(r, 150));
await page.mouse.click(900, 520);
await new Promise((r) => setTimeout(r, 150));
await page.mouse.click(900, 520, { clickCount: 2 });
await new Promise((r) => setTimeout(r, 400));

const afterA = await page.evaluate(() => ({
  objs: window.app.objects.length,
  roads: window.app.objects.filter((o) => o.type === 'road_brush').length,
  isects: window.app.objects.filter((o) => o.type === 'road_intersection').length,
}));

// 路 B：纵穿与 A 交叉（画笔仍激活）；起点单击、终点双击完成
await page.mouse.click(650, 430);
await new Promise((r) => setTimeout(r, 150));
await page.mouse.click(650, 640, { clickCount: 2 });
await new Promise((r) => setTimeout(r, 500));

const out = await page.evaluate(() => {
  const walk = (n, acc = []) => { acc.push(n.name || ''); for (const c of n.children || []) walk(c, acc); return acc; };
  const junc = window.app.objects.filter((o) => o.type === 'road_intersection');
  const jinfo = junc.map((j) => { const w = walk(j.root, []); return { lib: w.includes('junction_lib'), patch: w.includes('intersection_patch'), kids: w.filter(Boolean).length }; });
  return {
    total: window.app.objects.length,
    roads: window.app.objects.filter((o) => o.type === 'road_brush').length,
    isects: junc.length, jinfo,
    width: window.app.roadBrush?.roadWidth,
    active: window.app.roadBrush?.active,
    pts: window.app.roadBrush?.points?.length,
  };
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'test/out/chk-uidraw-junction.png' });
console.log(JSON.stringify({ step1, step2, active0, afterA, ...out, errs }, null, 1));
await browser.close();
