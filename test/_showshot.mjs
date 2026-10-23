// showcase 页面截图探针：bash test/withchrome.sh node test/_showshot.mjs [out.png]
import puppeteer from 'puppeteer';
const out = process.argv[2] || '/tmp/show16.png';
const browser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('[...document.querySelectorAll("#list button")].some(b => b.textContent.includes("道路"))', { timeout: 120000 });
const n = await page.evaluate(() => document.querySelectorAll('#list button').length);
const heads = await page.evaluate(() => [...document.querySelectorAll('#list div')].map(d => d.textContent));
console.log('清单按钮', n, '分组', JSON.stringify(heads));
await new Promise(r => setTimeout(r, 6000));
await page.screenshot({ path: out });
console.log('shot →', out, 'errs:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
