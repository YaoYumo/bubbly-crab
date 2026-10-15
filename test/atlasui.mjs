// 场景→示例场景 入口验收（真实鼠标事件）：bash test/withchrome.sh node test/atlasui.mjs（需 :5174 在跑）
// 路径：Scene 页工具条「场景」下拉 → 「示例场景」→ 卡片弹层（含布局图鉴分类）→ 点卡片载入
// 注意：全程用 elementHandle.click()（可信事件），覆盖 pointerdown/click 的真实先后顺序
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));

let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${x ? ' · ' + x : ''}`); };
const pick = async (sel, text, mode = 'includes') => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((n) => n.textContent);
    if (mode === 'includes' ? t.includes(text) : t.trim() === text) return h;
  }
  return null;
};

await page.goto('http://127.0.0.1:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction('window.__previzBooted === true', { timeout: 300000 });

// 1) 真实点击「场景」下拉按钮
const sceneBtn = await pick('.tb-dropdown > .tb', '场景');
ck('找到「场景」下拉按钮', !!sceneBtn);
await sceneBtn.click();
await new Promise((r) => setTimeout(r, 300));
ck('「场景」菜单可开', await page.evaluate(() => !!document.querySelector('.tb-dropdown.open .dd-menu')));

// 2) 真实点击菜单项「示例场景」
const item = await pick('.dd-item', '示例场景');
ck('菜单项「示例场景」在列', !!item);
await item.click();
await page.waitForFunction(() => document.querySelector('.menu.scenes.on'), { timeout: 30000 });
const box = await page.evaluate(() => {
  const p = document.querySelector('.menu.scenes.on');
  const r = p.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), inView: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
});
const cards = await page.evaluate(() => document.querySelectorAll('.menu.scenes .scard').length);
const chips = await page.evaluate(() => [...document.querySelectorAll('.menu.scenes .chip')].map((c) => c.textContent));
ck('弹层可见且在视口内', box.w > 300 && box.inView, JSON.stringify(box));
ck('弹层列出 12 套图鉴模板', cards === 12, `cards=${cards}`);
ck('分类签含布局图鉴·中式/现代', chips.includes('布局图鉴·中式') && chips.includes('布局图鉴·现代'), chips.join('/'));

// 3) 真实点击分类签「布局图鉴·中式」→ 8 套
const chip = await pick('.menu.scenes .chip', '布局图鉴·中式', 'eq');
await chip.click();
await new Promise((r) => setTimeout(r, 300));
const cnCards = await page.evaluate(() => document.querySelectorAll('.menu.scenes .scard').length);
ck('中式分类 8 套', cnCards === 8, `cards=${cnCards}`);

// 4) 真实点击「07 客家土楼」卡片 → 载入
const card = await pick('.menu.scenes .scard', '07 客家土楼');
ck('卡片可点', !!card);
await card.click();
await page.waitForFunction('window.app && app.sceneReport && app.sceneReport.id === "atlas-07-tulou"', { timeout: 300000 });
const rep = await page.evaluate(() => app.sceneReport);
ck('卡片载入 atlas-07-tulou', rep.models === 66 && rep.missing === 0, `models=${rep.models} missing=${rep.missing}`);
ck('载入后弹层自动关闭', await page.evaluate(() => !document.querySelector('.menu.scenes.on')));

// 5) 截图留证（写一次机位以刷新无头画布）
await page.evaluate(() => {
  const s = app.stage;
  s.view.position.set(72, 62, 92); s.orbit.target.set(0, 0, 0); s.orbit.update();
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'shots/atlas-ui-picker.png' });

const pageErrs = errs.filter((e) => !/favicon/i.test(e));
ck('无页面错误', pageErrs.length === 0, pageErrs.slice(0, 2).join(' | '));
console.log(fail ? `ATLASUI FAIL ${fail}` : 'ATLASUI ALL PASS');
await browser.close();
process.exit(fail ? 1 : 0);
