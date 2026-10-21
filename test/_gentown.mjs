// 探针：程序化造镇（parsePromptLocally → generateTown）后的路口结构
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.app && window.app.stage && window.app.stage.renderer, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 600));

const out = await page.evaluate(async () => {
  const { parsePromptLocally } = await import('/src/towngen.js');
  const { generateTown } = await import('/src/townbuild.js');
  const text = '方格网布局的现代城市';          // 不命中模板 → 纯 generateTown 路径
  const parsed = parsePromptLocally(text);
  const schema = { ...parsed.schema, seed: 3 };
  const stats = generateTown(window.app, schema, {});
  const objs = window.app.objects;
  const nameOf = (o) => (o.name || o.userData?.name || '');
  const junc = objs.filter((o) => o.type === 'road_intersection' || nameOf(o) === '交叉路口');
  const walk = (root, acc = []) => {
    acc.push(root.name || '');
    for (const c of root.children || []) walk(c, acc);
    return acc;
  };
  const jinfo = junc.map((j) => {
    const names = walk(j.root, []);
    return {
      lib: names.includes('junction_lib'),
      patch: names.includes('intersection_patch'),
      stripes: names.filter((n) => n && n !== 'junction_lib' && n !== 'intersection_patch' && n !== 'road_intersection' && !/^(g|m|l)/.test(n)).length,
      total: names.filter(Boolean).length,
    };
  });
  const roads = objs.filter((o) => /道路|大街|支路|环路|road/i.test(nameOf(o)));
  const cnt = (pred) => objs.filter(pred).length;
  return {
    stats: { roads: stats.roads, objects: stats.objects, houses: stats.houses, warnings: stats.warnings },
    total: objs.length,
    roadsTop: roads.length,
    isects: junc.length,
    withLib: jinfo.filter((j) => j.lib).length,
    withPatch: jinfo.filter((j) => j.patch).length,
    sample: jinfo.slice(0, 6),
    roadTypeNames: [...new Set(objs.filter((o) => o.type === 'road').map(nameOf))].slice(0, 8),
    typeCnt: objs.reduce((m, o) => (m[o.type] = (m[o.type] || 0) + 1, m), {}),
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'test/out/chk-gentown-junction.png' });
console.log(JSON.stringify({ ...out, errs }, null, 1));
await browser.close();
