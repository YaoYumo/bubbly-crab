import puppeteer from 'puppeteer';
const URL = process.env.URL || 'http://localhost:5174/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await new Promise(r => setTimeout(r, 800));
// 首访对话框存在就 Esc 掉
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));

async function gen(prompt) {
  // 顶栏 ✦ 一句话生成
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-row .tb')].find(x => /一句话生成/.test(x.title || x.textContent));
    b && b.click();
  });
  await page.waitForSelector('.tg-mask .tg-input', { timeout: 8000 });
  await page.evaluate(() => { document.querySelector('.tg-input').value = ''; });
  await page.type('.tg-input', prompt, { delay: 5 });
  await new Promise(r => setTimeout(r, 400)); // 等 debounce 解析
  const chips = await page.evaluate(() => [...document.querySelectorAll('.tg-chip')].map(c => c.textContent));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tg-btn')].find(x => /生成/.test(x.textContent));
    b && b.click();
  });
  await page.waitForFunction(() => window.__townStats && window.__townStats.promptDone !== 1, { timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1200));
  const out = await page.evaluate(() => {
    const st = window.__townStats;
    const roads = (window.app.roadBrush._roads || []).map(r => r.name || r.opts?.name || '?');
    const byName = {};
    for (const n of roads) byName[n] = (byName[n] || 0) + 1;
    return { stats: st ? { roads: st.roads, houses: st.houses, topo: st.schema?.roadTopology, ms: st.ms } : null, roadNames: byName, total: roads.length };
  });
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));
  console.log(JSON.stringify({ prompt, chips: chips.filter(c => !/种子/.test(c)), ...out }));
}
for (const p of ['方格网布局的现代城市', '中轴对称的古城', '放射状路网的城市', '黄昏的加州林荫小镇']) {
  await gen(p);
}
await browser.close();
