import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { const t = m.text(); if (/DBG/.test(t)) console.log('PAGE:', t); });
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
await new Promise(r => setTimeout(r, 600));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.tool-row .tb')].find(x => /一句话生成/.test(x.title || x.textContent));
  b && b.click();
});
await page.waitForSelector('.tg-mask .tg-input', { timeout: 8000 });
const timeline = await page.evaluate(async () => {
  const ta = document.querySelector('.tg-input');
  const box = document.querySelector('.tg-chips');
  const log = [];
  const t0 = performance.now();
  const mo = new MutationObserver(() => log.push(['MUT', Math.round(performance.now() - t0), box.innerText.replace(/\n/g, '|').slice(0, 60)]));
  mo.observe(box, { childList: true, subtree: true, characterData: true });
  let inpFired = 0;
  ta.addEventListener('input', () => { inpFired++; log.push(['INP', Math.round(performance.now() - t0), 'count=' + inpFired]); });
  const origSet = window.setTimeout;
  window.setTimeout = function (fn, d, ...a) {
    if (d === 110) log.push(['SCH110', Math.round(performance.now() - t0), '']);
    return origSet.call(window, function (...b) {
      if (d === 110) log.push(['FIRE110', Math.round(performance.now() - t0), '']);
      return fn.apply(this, b);
    }, d, ...a);
  };
  ta.value = '方格网布局';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => origSet(r, 800));
  window.setTimeout = origSet;
  log.push(['FINAL', Math.round(performance.now() - t0), box.innerText.replace(/\n/g, '|').slice(0, 60)]);
  return log;
});
for (const l of timeline) console.log(JSON.stringify(l));
await browser.close();
