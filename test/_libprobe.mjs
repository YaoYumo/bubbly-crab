import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await new Promise(r => setTimeout(r, 600));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
// 展开模型库
const out = await page.evaluate(() => {
  const head = document.querySelector('#left-scene .libhead') || [...document.querySelectorAll('.libhead')][0];
  if (head) head.click();
  return null;
});
await new Promise(r => setTimeout(r, 500));
const info = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('.libgroup, .lib-sec, #left-scene h6, #left-scene .libtitle')];
  const cards = [...document.querySelectorAll('.card, .libcard, [data-key]')];
  // 通用兜底：把左栏结构抓出来
  const left = document.getElementById('left-scene') || document.getElementById('left');
  const headings = left ? [...left.querySelectorAll('b,u,h6,.gh,.gtitle')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 40) : [];
  return {
    cardCount: cards.length,
    sampleKeys: cards.slice(0, 8).map(c => c.getAttribute('data-key') || c.dataset?.key || ''),
    headings,
    leftHtmlHead: left ? left.innerHTML.slice(0, 400) : 'NO LEFT',
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
