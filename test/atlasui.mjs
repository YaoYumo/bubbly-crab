// 场景→示例场景 入口验收：bash test/withchrome.sh node test/atlasui.mjs（需 :5174 在跑）
// 路径：Scene 页工具条「场景」菜单 → 「示例场景」→ 卡片弹层（含布局图鉴分类）→ 点卡片载入
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

await page.goto('http://127.0.0.1:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction('window.__previzBooted === true', { timeout: 300000 });

// 1) 打开 Scene 页工具条的「场景」下拉
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tb-dropdown > .tb')].find((x) => x.querySelector('.t')?.textContent === '场景');
  b?.click();
});
await new Promise((r) => setTimeout(r, 400));
const menuOpened = await page.evaluate(() => !!document.querySelector('.tb-dropdown.open .dd-menu'));
ck('「场景」菜单可开', menuOpened);

// 2) 点「示例场景」
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.dd-item')].find((x) => x.textContent.includes('示例场景'));
  it?.click();
});
await page.waitForFunction(() => document.querySelector('.menu.scenes.on'), { timeout: 30000 });
const cards = await page.evaluate(() => document.querySelectorAll('.menu.scenes .scard').length);
const chips = await page.evaluate(() => [...document.querySelectorAll('.menu.scenes .chip')].map((c) => c.textContent));
ck('弹层列出 12 套图鉴模板', cards === 12, `cards=${cards}`);
ck('分类签含布局图鉴·中式/现代', chips.includes('布局图鉴·中式') && chips.includes('布局图鉴·现代'), chips.join('/'));

// 3) 过滤到中式并点「07 客家土楼」卡片
await page.evaluate(() => {
  [...document.querySelectorAll('.menu.scenes .chip')].find((c) => c.textContent === '布局图鉴·中式')?.click();
});
await new Promise((r) => setTimeout(r, 300));
const cnCards = await page.evaluate(() => document.querySelectorAll('.menu.scenes .scard').length);
ck('中式分类 8 套', cnCards === 8, `cards=${cnCards}`);
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.menu.scenes .scard')].find((c) => c.textContent.includes('07 客家土楼'));
  card?.click();
});
await page.waitForFunction('window.app && app.sceneReport && app.sceneReport.id === "atlas-07-tulou"', { timeout: 300000 });
const rep = await page.evaluate(() => app.sceneReport);
ck('卡片载入 atlas-07-tulou', rep.models === 45 && rep.missing === 0, `models=${rep.models} missing=${rep.missing}`);

// 4) 截图留证（写一次机位以刷新无头画布）
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
