import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await new Promise(r => setTimeout(r, 600));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
// 打开对话框
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tool-row .tb')].find(x => /一句话生成/.test(x.title || x.textContent));
  b && b.click();
});
await page.waitForSelector('.tg-mask .tg-input', { timeout: 8000 });
const snap = async (tag) => {
  const o = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tg-chips .tg-chip')].map(c => c.textContent).join('|'),
    note: document.querySelector('.tg-note')?.innerText?.replace(/\n/g, ' / ').slice(0, 120),
    nInputs: document.querySelectorAll('.tg-input').length,
    nMasks: document.querySelectorAll('.tg-mask').length,
  }));
  console.log(tag, JSON.stringify(o));
};
await snap('open   ');
// 1) 点示例 chip（onclick 直连 parse+render）
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tg-examples .tg-chip')].find(x => /中轴对称/.test(x.textContent));
  b && b.click();
});
await new Promise(r => setTimeout(r, 200));
await snap('example');
// 2) 改文本触发 input debounce
await page.evaluate(() => {
  const ta = document.querySelector('.tg-input');
  ta.value = '方格网布局';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));
await snap('input  ');
// 3) 垃圾词测试 noteBox 是否响应
await page.evaluate(() => {
  const ta = document.querySelector('.tg-input');
  ta.value = '乱七八糟看不懂的词';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));
await snap('garbage');
// 4) 用 app 自己的模块现场解析，对比期望
const expect = await page.evaluate(async () => {
  const m = await import('/src/towngen.js');
  const r = m.parsePromptLocally('方格网布局');
  return { topo: r.schema.roadTopology, matched: r.matched.map(x => x.k + '=' + x.value), describe: m.describeSchema(r.schema).map(c => c.label) };
});
console.log('module ', JSON.stringify(expect));
await browser.close();
