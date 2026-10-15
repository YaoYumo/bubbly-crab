// 「存当前场景到卡片」烘焙验收：bash test/withchrome.sh node test/scenebake.mjs（需 :5174 在跑）
// 路径：搭景 → 场景菜单→存当前场景到卡片… → 选卡保存 → 重载后卡片内置内容复现（含地形）→ 清除恢复空模板
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
const pick = async (sel, text) => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((n) => n.textContent);
    if (t.includes(text)) return h;
  }
  return null;
};
const boot = async () => {
  await page.goto('http://127.0.0.1:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('window.__previzBooted === true', { timeout: 300000 });
};

await boot();
await page.evaluate(() => localStorage.removeItem('atlas-scene-bakes'));

// 1) 搭一个 3 模型 + 水系地形的小场景
await page.evaluate(() => {
  const T = window.__t.THREE;
  const K = (g, t) => { const it = window.__t.LIB.find((x) => x.id === g).items.find((i) => i.type === t); return `${g}:${t}:${it.name}`; };
  app.addAsset(K('cn', 'hall'), new T.Vector3(0, 0, 0), { params: { w: 20, d: 12 } });
  app.addAsset(K('cn', 'paifang'), new T.Vector3(0, 0, 26), {});
  app.addAsset(K('cn', 'ding'), new T.Vector3(6, 0, 12), {});
  app.terrain.basin(0, 40, 9, 1.2);
  app.terrain.setWater(true);
  app.terrain.setWaterLevel(-0.5);
});
await new Promise((r) => setTimeout(r, 800));
ck('搭景 3 模型 + 水系', await page.evaluate(() => app.objects.length === 3 && app.terrain.state.water));

// 2) 场景菜单 → 存当前场景到卡片… → 对话框列出 12 卡
const sceneBtn = await pick('.tb-dropdown > .tb', '场景');
await sceneBtn.click();
await new Promise((r) => setTimeout(r, 300));
const bakeItem = await pick('.dd-item', '存当前场景到卡片');
ck('菜单项「存当前场景到卡片…」在列', !!bakeItem);
await bakeItem.click();
await page.waitForFunction(() => document.getElementById('bake-dlg'), { timeout: 15000 });
const rows = await page.evaluate(() => document.querySelectorAll('#bake-dlg .sc-tag').length);
ck('对话框列出 12 张卡片', rows === 12, `rows=${rows}`);

// 3) 存到「07 客家土楼」卡
const rowHandle = await (async () => {
  for (const h of await page.$$('#bake-dlg div[style*="border-radius:10px"]')) {
    const t = await h.evaluate((n) => n.textContent);
    if (t.includes('07 客家土楼')) return h;
  }
  return null;
})();
ck('找到土楼卡行', !!rowHandle);
const saveBtn = await rowHandle.$$('button').then((bs) => Promise.all(bs.map((b) => b.evaluate((n) => n.textContent))).then((ts) => bs[ts.findIndex((t) => t.includes('存到此卡'))]));
await saveBtn.click();
await new Promise((r) => setTimeout(r, 600));
ck('烘焙写入 localStorage', await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('atlas-scene-bakes') || '{}');
  return !!m['atlas-07-tulou'] && m['atlas-07-tulou'].objs.length === 3 && Array.isArray(m['atlas-07-tulou'].terrain.h);
}));

// 3b) 导出按钮：单卡 + 全部（捕获 Blob 校验 JSON 内容）
await page.evaluate(() => { window.__cap = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__cap = b; return orig(b); }; });
const sceneBtn1b = await pick('.tb-dropdown > .tb', '场景');
await sceneBtn1b.click();
await new Promise((r) => setTimeout(r, 300));
const bakeItem1b = await pick('.dd-item', '存当前场景到卡片');
await bakeItem1b.click();
await page.waitForFunction(() => document.getElementById('bake-dlg'), { timeout: 15000 });
ck('头部「导出全部烘焙」在列', await page.evaluate(() => [...document.querySelectorAll('#bake-dlg button')].some((b) => b.textContent.includes('导出全部烘焙'))));
const row1b = await (async () => {
  for (const h of await page.$$('#bake-dlg div[style*="border-radius:10px"]')) {
    const t = await h.evaluate((n) => n.textContent);
    if (t.includes('07 客家土楼')) return h;
  }
  return null;
})();
const expBtn = await row1b.$$('button').then((bs) => Promise.all(bs.map((b) => b.evaluate((n) => n.textContent))).then((ts) => bs[ts.findIndex((t) => t.trim() === '导出')]));
ck('已烘焙行有「导出」钮', !!expBtn);
await expBtn.click();
await new Promise((r) => setTimeout(r, 400));
const singleJson = await page.evaluate(() => window.__cap.text());
const single = JSON.parse(singleJson);
ck('单卡导出 JSON 正确', !!single['atlas-07-tulou'] && single['atlas-07-tulou'].objs.length === 3, Object.keys(single).join(','));
const allBtn = await page.evaluateHandle(() => [...document.querySelectorAll('#bake-dlg button')].find((b) => b.textContent.includes('导出全部烘焙')));
await allBtn.asElement().click();
await new Promise((r) => setTimeout(r, 400));
const allJson = await page.evaluate(() => window.__cap.text());
const allMap = JSON.parse(allJson);
ck('全部导出 = scene-bakes.json 格式', !!allMap['atlas-07-tulou'] && Array.isArray(allMap['atlas-07-tulou'].terrain.h));
await page.evaluate(() => document.querySelector('#bake-dlg .sp-x').click());

// 3c) 固化回路：导出内容写入 src/scene-bakes.json 后，模块加载即内置（node 侧验证）
const fs = await import('node:fs');
const ORIG = fs.readFileSync('src/scene-bakes.json', 'utf8');
try {
  fs.writeFileSync('src/scene-bakes.json', allJson);
  const M = await import(`../src/scenes.js?solid=${Date.now()}`);
  const sc = M.SCENES.find((x) => x.id === 'atlas-07-tulou');
  ck('scene-bakes.json 固化后模块内置 3 模型', sc.objs.length === 3 && !!(sc.terrain && sc.terrain.water), `objs=${sc.objs.length}`);
} finally {
  fs.writeFileSync('src/scene-bakes.json', ORIG);
}

// 4) 重载：卡片内置内容自动合并；载入复现 3 模型 + 水系
await boot();
const merged = await page.evaluate(() => {
  const sc = window.__scenes.SCENES.find((s) => s.id === 'atlas-07-tulou');
  return { objs: sc.objs.length, water: !!(sc.terrain && sc.terrain.water) };
});
ck('重载后卡片内置 3 模型 + 水系', merged.objs === 3 && merged.water, JSON.stringify(merged));
await page.evaluate(() => window.__scenes.applyScene(app, 'atlas-07-tulou'));
await page.waitForFunction('window.app && app.sceneReport && app.sceneReport.id === "atlas-07-tulou"', { timeout: 120000 });
const rep = await page.evaluate(() => ({ m: app.sceneReport.models, miss: app.sceneReport.missing, water: app.terrain.state.water, h: Math.min(...app.terrain.h) < -0.5 }));
ck('载入复现 3 模型/地形快照', rep.m === 3 && rep.miss === 0 && rep.water && rep.h, JSON.stringify(rep));

// 5) 清除：对话框行出现「清除」→ 恢复空模板
const sceneBtn2 = await pick('.tb-dropdown > .tb', '场景');
await sceneBtn2.click();
await new Promise((r) => setTimeout(r, 300));
const bakeItem2 = await pick('.dd-item', '存当前场景到卡片');
await bakeItem2.click();
await page.waitForFunction(() => document.getElementById('bake-dlg'), { timeout: 15000 });
const row2 = await (async () => {
  for (const h of await page.$$('#bake-dlg div[style*="border-radius:10px"]')) {
    const t = await h.evaluate((n) => n.textContent);
    if (t.includes('07 客家土楼')) return h;
  }
  return null;
})();
ck('已烘焙行显示模型数与清除钮', await row2.evaluate((n) => n.textContent.includes('已烘焙 3 模型') && n.textContent.includes('清除')));
const clearBtn = await row2.$$('button').then((bs) => Promise.all(bs.map((b) => b.evaluate((n) => n.textContent))).then((ts) => bs[ts.findIndex((t) => t.includes('清除'))]));
await clearBtn.click();
await new Promise((r) => setTimeout(r, 400));
await boot();
ck('清除后恢复空模板', await page.evaluate(() => window.__scenes.SCENES.find((s) => s.id === 'atlas-07-tulou').objs.length === 0));

const pageErrs = errs.filter((e) => !/favicon/i.test(e));
ck('无页面错误', pageErrs.length === 0, pageErrs.slice(0, 2).join(' | '));
console.log(fail ? `SCENEBAKE FAIL ${fail}` : 'SCENEBAKE ALL PASS');
await browser.close();
process.exit(fail ? 1 : 0);
