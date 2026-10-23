import puppeteer from 'puppeteer';
const URL = 'http://localhost:5174/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await new Promise(r => setTimeout(r, 600));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tool-row .tb')].find(x => /一句话生成/.test(x.title || x.textContent));
  b && b.click();
});
await page.waitForSelector('.tg-mask .tg-input', { timeout: 8000 });
// 仪器化 input 事件
await page.evaluate(() => {
  window.__inp = 0;
  const ta = document.querySelector('.tg-input');
  ta.addEventListener('input', () => { window.__inp++; });
  window.__setV = (v) => { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };
});
await page.evaluate(() => window.__setV('方格网布局的现代城市'));
await new Promise(r => setTimeout(r, 500));
const out = await page.evaluate(() => ({
  value: document.querySelector('.tg-input').value,
  inpEvents: window.__inp,
  chips: [...document.querySelectorAll('.tg-chips .tg-chip')].map(c => c.textContent),
}));
console.log(JSON.stringify(out, null, 1));
// 再试 page.type 中文（对照）
await page.evaluate(() => window.__setV(''));
await new Promise(r => setTimeout(r, 300));
await page.type('.tg-input', '中轴对称的古城', { delay: 10 });
await new Promise(r => setTimeout(r, 500));
const out2 = await page.evaluate(() => ({
  value: document.querySelector('.tg-input').value,
  inpEvents: window.__inp,
  chips: [...document.querySelectorAll('.tg-chips .tg-chip')].map(c => c.textContent),
}));
console.log(JSON.stringify(out2, null, 1));
await browser.close();
