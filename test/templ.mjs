// 任务 9 门禁：模型库补齐 + 模板库(A) + 自动运镜(C) + Scene DSL/API(D)
// 运行：PUPPETEER_SKIP_DOWNLOAD=1 bash test/withchrome.sh node test/templ.mjs
import puppeteer from 'puppeteer';

const URL0 = process.env.URL || 'http://localhost:5174/';
let pass = 0, fail = 0;
const ck = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '  ✔' : '  ✘ FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrs.push(m.text()); });

// ---------- ① 模型库补齐 ----------
await page.goto(URL0 + '?fresh=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__previzBooted && window.app', { timeout: 90000 });
const L = await page.evaluate(async () => {
  const { LIB_INDEX, LIB } = await import('/src/assets.js');
  const demoKeys = [
    'building:tower:玻璃幕墙写字楼', 'building:residential:住宅板楼', 'building:shophouse:沿街商铺',
    'building:house:独栋住宅', 'building:cluster:城市楼群', 'building:colonnade:柱廊门厅',
    'building:stairs:大台阶', 'building:billboard:户外广告屏', 'building:overpass:高架立交',
    'env:road:沥青路面', 'env:walk:人行道', 'env:tree:行道树', 'env:lamp:路灯', 'env:bench:长椅',
    'env:fountain:圆形喷泉', 'env:sign:路牌', 'env:car:轿车', 'env:bus:公交车', 'env:cone:交通锥',
    'env:barrier:水马围挡', 'env:crate:木箱', 'env:trash:垃圾桶', 'char:human:男性', 'char:crowd:人群',
  ];
  return {
    total: LIB_INDEX.size, groups: new Set(LIB.map((g) => g.id)).size,
    missing: demoKeys.filter((k) => !LIB_INDEX.has(k)),
  };
});
ck('模型库 = 19 组 / 200 项', L.groups === 19 && L.total === 200, `${L.groups}组 ${L.total}项`);
ck('demo 全部城市键可解析', L.missing.length === 0, L.missing.join(','));
const cards = await page.evaluate(async () => {
  const t = document.getElementById('lib-toggle');
  if (t && document.getElementById('lib-toggle-state')?.textContent !== '收起 ▾') t.click();
  await new Promise((r) => setTimeout(r, 200));
  return document.querySelectorAll('#library-scene .card').length;
});
ck('左栏模型卡 >100（entry 同门禁）', cards > 100, `${cards} 卡`);

// ---------- ② 一句话 → 模板路径（方案 A 入口） ----------
const T1 = await page.evaluate(async () => {
  const openBtn = [...document.querySelectorAll('.tool-row .tb')].find((x) => /一句话生成/.test(x.title || x.textContent || ''));
  if (!openBtn) return { err: 'no open button' };
  openBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const ta = document.querySelector('.tg-input');
  if (!ta) return { err: 'no dialog' };
  ta.value = '黄昏的十字路口，车流穿行';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const rows = [...document.querySelectorAll('.tg-lrow')];
  const tplChipOn = rows[0]?.querySelector('.tg-chip.on')?.textContent || '';
  const genBtn = [...document.querySelectorAll('.tg-btn')].find((b) => /生成/.test(b.textContent));
  genBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    if (window.__townStats?.tpl) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const s = window.__townStats;
  if (!s?.tpl) return { tplChipOn, err: 'template run timeout', stats: s };
  const app = window.app;
  const keys = app.objects.map((o) => o.key || '');
  return {
    tplChipOn,
    objects: app.objects.length,
    buildings: keys.filter((k) => k.startsWith('building:')).length,
    envs: keys.filter((k) => k.startsWith('env:')).length,
    chars: keys.filter((k) => k.startsWith('char:')).length,
    moving: app.objects.filter((o) => o.motion?.active).length,
    shots: app.shots.length,
    shotKeys: app.shots.map((s) => (s.keys || []).length),
    moves: app.shots.map((s) => s.move || 'static'),
    auto: s.auto,
    dlgGone: !document.querySelector('.tg-mask'),
  };
});
ck('「十字路口」命中模板 chip 并走模板分支', T1.tplChipOn === '街区街口' && !T1.err, T1.err || T1.tplChipOn);
ck('模板搭建 ≥40 物体', (T1.objects || 0) >= 40, `obj=${T1.objects}`);
ck('building/env/char 三组都上场', T1.buildings >= 6 && T1.envs >= 15 && T1.chars >= 3, `b${T1.buildings}/e${T1.envs}/c${T1.chars}`);
ck('车流/人物在运动', (T1.moving || 0) >= 3, `moving=${T1.moving}`);
ck('模板自带自动机位 ≥4 且都带运镜关键帧', T1.shots >= 4 && T1.shotKeys?.every((n) => n > 2), `${T1.shots}镜 keys=${T1.shotKeys?.join('/')} moves=${T1.moves?.join('/')}`);
await sleep(400);   // 关闭动画 160ms + 余量
const dlgGone = await page.evaluate(() => !document.querySelector('.tg-mask'));
ck('对话框生成后正常关闭', dlgGone === true);

// ---------- ③ 模板 API：plaza / boulevard + 关键词 ----------
const T2 = await page.evaluate(async () => {
  const { matchTemplate, templateById } = await import('/src/templates.js');
  const app = window.app;
  const m = matchTemplate('城市中心的喷泉广场，人群聚集');
  const r = templateById('plaza').build(app, { seed: 3 });
  const shots = app.shots.map((s) => ({ keys: (s.keys || []).length, move: s.move || 'static', hasTarget: !!s.targetId }));
  const m2 = matchTemplate('一条林荫大道延伸到远方');
  const m3 = matchTemplate('方格网布局的现代城市');
  return { m: m?.id, m2: m2?.id, m3, r, shots, objs: app.objects.length };
});
ck('关键词匹配：广场/林荫命中，通用城市词不劫持', T2.m === 'plaza' && T2.m2 === 'boulevard' && T2.m3 === null, `plaza=${T2.m} blvd=${T2.m2} 城市=${T2.m3}`);
ck('plaza 模板装配成功', T2.r.objects > 20 && T2.r.shots >= 4, `${T2.r.objects}物 ${T2.r.shots}镜`);
ck('运镜语法：push→orbit→truck/pedestal→push 收尾且主目标锁定', T2.shots[1]?.move === 'orbit' && T2.shots[1]?.hasTarget && T2.shots[3]?.hasTarget && T2.shots.every((s) => s.keys > 2), JSON.stringify(T2.shots));
const fs = await import('fs');
fs.mkdirSync('test/out', { recursive: true });
await page.screenshot({ path: 'test/out/templ-plaza.png' });

const T3 = await page.evaluate(async () => {
  const { templateById } = await import('/src/templates.js');
  const app = window.app;
  const r = templateById('boulevard').build(app, { seed: 5 });
  const keys = app.objects.map((o) => o.key || '');
  return {
    r,
    trees: keys.filter((k) => k.includes('行道树')).length,
    moving: app.objects.filter((o) => o.motion?.active).length,
    shots: app.shots.length,
  };
});
ck('boulevard 模板装配成功（树列 ≥10、车流在动、机位 ≥4）', T3.r.objects > 40 && T3.trees >= 10 && T3.moving >= 3 && T3.shots >= 4, `${T3.r.objects}物 树${T3.trees} 动${T3.moving} 镜${T3.shots}`);

// ---------- ④ Scene DSL 手动导入（方案 D-a） ----------
const T4 = await page.evaluate(async () => {
  const { applySceneDSL } = await import('/src/sceneio.js');
  const app = window.app;
  const doc = {
    version: 1, name: 'DSL 测试', flat: true,
    objects: [
      { key: 'building:tower:玻璃幕墙写字楼', pos: [-20, 0, -20], params: { floors: 10 } },
      { key: 'env:car:轿车', pos: [10, 0, 4], rot: Math.PI / 2, name: '测试车' },
      { key: 'fake:bad:不存在的键', pos: [0, 0, 0] },
    ],
    motions: [{ object: 1, keys: [[0, -30, 0, 4], [1, 40, 0, 4]] }],
    shots: [
      { name: 'A', pos: [30, 12, 30], look: [0, 2, 0], focal: 28, duration: 6, move: 'push' },
      { name: 'B', pos: [6, 3, 8], look: [-20, 12, -20], focal: 35, duration: 8, target: 0, move: 'orbit', moveParams: { deg: 90 } },
    ],
  };
  const r = applySceneDSL(app, doc);
  const shots = app.shots.map((s) => ({ keys: (s.keys || []).length, move: s.move || 'static', hasTarget: !!s.targetId }));
  const car = app.objects.find((o) => o.name === '测试车');
  const carMoving = !!car?.motion?.active;
  let bad = 'NO_THROW';
  try { applySceneDSL(app, null); bad = 'NO_ERROR'; } catch (e) { bad = 'THROW_OK'; }
  return { r, objs: app.objects.length, shots, carMoving, bad, activeShot: !!app.activeShot };
});
ck('DSL 导入：物体就位 + 缺键报告不中断', T4.r.objects === 2 && T4.r.missing.length === 1 && T4.objs === 2, `obj=${T4.r.objects} missing=${T4.r.missing.join(',')}`);
ck('DSL 运动与机位（look/target/move）生效', T4.carMoving && T4.shots.length === 2 && T4.shots.every((s) => s.keys > 2) && T4.shots[1].move === 'orbit' && T4.shots[1].hasTarget, JSON.stringify(T4.shots));
ck('非法输入抛错而非静默', T4.bad === 'THROW_OK');

// ---------- ⑤ 无页面错误 ----------
const fatal = pageErrs.filter((e) => !/favicon|Failed to load resource|net::ERR|404/.test(e));
ck('零 pageerror', fatal.length === 0, fatal.slice(0, 3).join(' | '));

console.log(`\ntempl: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
