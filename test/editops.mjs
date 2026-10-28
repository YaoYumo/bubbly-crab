// 三项编辑操作回归：空白场景 / 删除机位 / 一键清空（+ Ctrl+Z 撤销）+ 素材库全量分组
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1440,880', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 880, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const R = { errors, checks: {} };
const ck = (n, v) => { R.checks[n] = !!v; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto((process.env.URL || 'http://localhost:5174/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 180000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await wait(400);

const counts = () => page.evaluate(() => ({
  objs: window.app.objects.length,
  shots: window.app.shots.length,
  terrainOn: window.app.terrain.enabled,
  flat: Math.max(...Array.from(window.app.terrain.h).map(Math.abs)),
  ground: !window.app.stage.ground.visible ? false : true,
  duration: window.app.state.duration,
  undo: (window.app._undo || []).length,
  activeShot: window.app.activeShot ? window.app.activeShot.name : null,
}));
const applyScene = (id) => page.evaluate((sid) => window.__scenes.applyScene(window.app, sid), id);

/* ---------------- 1. 素材库：全量 + 分类 ---------------- */
const lib = await page.evaluate(() => {
  const lb = document.getElementById('library');
  const chips = [...lb.querySelectorAll('.chips .chip')];
  return {
    cards: lb.querySelectorAll('.card').length,
    heads: [...lb.querySelectorAll('.libhead b')].map((b) => b.textContent),
    chipTexts: chips.map((c) => c.textContent),
    chipOn: (chips.find((c) => c.classList.contains('on')) || {}).textContent,
    count: (lb.querySelector('.libcount') || {}).textContent,
  };
});
R.checks.lib = lib;
ck('素材库默认显示全部 139 个模型', lib.cards === 139);
ck('素材库带 11 个分类标题（新增建筑构件）', lib.heads.length === 11);
ck('分类标题里含中式古建/自然/战争/星际/玄幻', ['中式古建', '美式经典', '室内', '自然', '战争', '星际', '玄幻特效'].every((c) => lib.heads.includes(c)));
ck('chips 带数量', lib.chipTexts[0] === '全部 139' && /战争 13/.test(lib.chipTexts.join('|')) && /自然 20/.test(lib.chipTexts.join('|')));
ck('计数条显示 139 / 139', /139 \/ 139/.test(lib.count || ''));

const libFilter = await page.evaluate(() => {
  const lb = document.getElementById('library');
  [...lb.querySelectorAll('.chips .chip')].find((c) => /战争/.test(c.textContent)).click();
  return {
    cards: lb.querySelectorAll('.card').length,
    heads: lb.querySelectorAll('.libhead').length,
    names: [...lb.querySelectorAll('.card .nm')].map((x) => x.textContent),
  };
});
R.checks.libFilter = libFilter;
ck('点「战争」只看战争 13 个', libFilter.cards === 13 && libFilter.heads === 0 && libFilter.names.includes('主战坦克'));
const libBack = await page.evaluate(() => {
  const lb = document.getElementById('library');
  [...lb.querySelectorAll('.chips .chip')].find((c) => /全部/.test(c.textContent)).click();
  const s = lb.querySelector('.search');
  s.value = '宫殿'; s.dispatchEvent(new Event('input', { bubbles: true }));
  const hit = lb.querySelectorAll('.card').length;
  s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
  return { hit, back: lb.querySelectorAll('.card').length, heads: lb.querySelectorAll('.libhead').length };
});
ck('搜索「宫殿」跨分类命中后能回到全量', libBack.hit >= 1 && libBack.back === 139 && libBack.heads === 11);

/* ---------------- 2. 一键清空（两段式确认 + 撤销）---------------- */
await applyScene('city-day');
const before = await counts();
R.before = before;
ck('载入 city-day 后有模型与机位', before.objs >= 30 && before.shots >= 4);

const armed = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#top .tb')].find((x) => /清空/.test(x.textContent));
  if (!b) return { found: false };
  b.click();
  return { found: true, label: b.querySelector('.t').textContent, warn: b.classList.contains('warn') };
});
R.checks.armed = armed;
ck('顶栏「清空」第一次点击只进入确认态', armed.found && /确认/.test(armed.label) && armed.warn);
const mid = await counts();
ck('确认前场景不动', mid.objs === before.objs && mid.shots === before.shots);

const cleared = await page.evaluate(async () => {
  const b = [...document.querySelectorAll('#top .tb')].find((x) => /清空|确认/.test(x.textContent));
  b.click();
  await new Promise((r) => setTimeout(r, 320));
  const app = window.app;
  return {
    objs: app.objects.length, shots: app.shots.length,
    label: b.querySelector('.t').textContent, warn: b.classList.contains('warn'),
    terrainOn: app.terrain.enabled, flat: Math.max(...Array.from(app.terrain.h).map(Math.abs)),
    groundVisible: app.stage.ground.visible, duration: app.state.duration,
    sel: JSON.stringify(app.sel), undo: (app._undo || []).length,
    toast: ([...document.querySelectorAll('.toasts .toast')].pop() || {}).textContent,
  };
});
R.checks.cleared = cleared;
ck('二次点击后场景真的清空', cleared.objs === 0 && cleared.shots === 0);
ck('清空后回到可摆景状态（地形开启 / 压平 / 地面可见 / 时长 8s）',
  cleared.terrainOn && cleared.flat === 0 && cleared.groundVisible && cleared.duration === 8);
ck('清空后按钮复位', cleared.label === '清空' && !cleared.warn);
ck('清空写入撤销栈', cleared.undo >= 1 && /撤销/.test(cleared.toast || ''));

const restored = await page.evaluate(() => { window.app.undo(); return { objs: window.app.objects.length, shots: window.app.shots.length }; });
R.restored = restored;
ck('Ctrl+Z 能撤销清空', restored.objs === before.objs && restored.shots === before.shots);

/* ---------------- 3. 删除机位（列表 × / Del 键 / 右侧按钮）---------------- */
await applyScene('cn-palace');
const s0 = await counts();
const rowDel = await page.evaluate(async () => {
  const app = window.app;
  const row = document.querySelector('.shotlist .shot');
  const name = row.querySelector('.snm').textContent;
  const x = row.querySelector('.ib.del');
  if (!x) return { has: false };
  x.click();
  const armedTxt = x.textContent;
  x.click();
  await new Promise((r) => setTimeout(r, 260));
  return { has: true, name, armedTxt, shots: app.shots.length, names: app.shots.map((y) => y.name), undo: (app._undo || []).length };
});
R.checks.rowDel = rowDel;
ck('机位行有删除按钮', rowDel.has);
ck('删除按钮两段式确认', /确认/.test(rowDel.armedTxt || ''));
ck('确认后少一个机位', rowDel.shots === s0.shots - 1 && !rowDel.names.includes(rowDel.name));
ck('删除写入撤销栈', rowDel.undo >= 1);

const und = await page.evaluate(() => { window.app.undo(); return window.app.shots.length; });
ck('撤销恢复被删机位', und === s0.shots);

const byKey = await page.evaluate(async () => {
  const app = window.app;
  document.querySelectorAll('.shotlist .shot')[1].click();
  return { sel: app.sel && app.sel.kind, shot: app.selShot ? app.selShot.name : null, n: app.shots.length };
});
await page.keyboard.press('Delete');
await wait(220);
const afterKey = await page.evaluate(() => ({ n: window.app.shots.length, names: window.app.shots.map((s) => s.name) }));
ck('选中机位后按 Del 删除它', byKey.sel === 'shot' && afterKey.n === byKey.n - 1 && !afterKey.names.includes(byKey.shot));
await page.evaluate(() => window.app.undo());

const inspBtn = await page.evaluate(() => {
  const app = window.app;
  const tabs = [...document.querySelectorAll('#inspector .itab')];
  const cam = tabs.find((t) => /运镜|cam/.test(t.textContent + t.dataset.tab));
  if (cam) cam.click();
  app.setActiveShot(app.shots[0]);
  app.select({ kind: 'shot', shot: app.shots[0] });
  app.bus.emit('select');
  const btns = [...document.querySelectorAll('#inspector .fbtn')].map((b) => b.textContent.trim());
  const n0 = app.shots.length;
  const del = [...document.querySelectorAll('#inspector .fbtn')].find((b) => /删除机位/.test(b.textContent));
  if (del) del.click();
  return { has: !!del, btns: btns.slice(0, 12), n0, n1: app.shots.length };
});
R.checks.insp = inspBtn;
ck('右侧「机位 / 镜头」里有删除机位按钮', inspBtn.has && inspBtn.n1 === inspBtn.n0 - 1);
ck('右侧同时有复制机位按钮', inspBtn.btns.some((b) => /复制机位/.test(b)));
const dup = await page.evaluate(() => {
  const app = window.app;
  app.undo();
  const tabs = [...document.querySelectorAll('#inspector .itab')];
  const cam = tabs.find((t) => /运镜|cam/.test(t.textContent + t.dataset.tab));
  if (cam) cam.click();
  const n0 = app.shots.length;
  const s = app.activeShot || app.shots[0];
  app.select({ kind: 'shot', shot: s });
  const cp = [...document.querySelectorAll('#inspector .fbtn')].find((b) => /复制机位/.test(b.textContent));
  if (cp) cp.click();
  const c = app.shots[app.shots.length - 1];
  return { n0, n1: app.shots.length, keys: c ? c.keys.length : -1, focal: c ? c.focal : 0, name: c ? c.name : '' };
});
ck('复制机位带上关键帧与焦距', dup.n1 === dup.n0 + 1 && dup.keys >= 1 && dup.focal > 0 && /副本/.test(dup.name));

/* ---------------- 4. 空白场景（弹层入口）---------------- */
await applyScene('war-zero-hour');
const w0 = await counts();
const blank = await page.evaluate(async () => {
  const app = window.app;
  const btn = [...document.querySelectorAll('#top .tb')].find((b) => /示例场景/.test(b.textContent));
  btn.click();
  const pop = btn.querySelector('.menu.scenes');
  const open = pop.classList.contains('on');
  const cards = pop.querySelectorAll('.scard').length;
  [...pop.querySelectorAll('.sp-quick .qbtn')].find((b) => /空白场景/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 300));
  return {
    open, cards,
    objs: app.objects.length, shots: app.shots.length,
    terrainOn: app.terrain.enabled, flat: Math.max(...Array.from(app.terrain.h).map(Math.abs)),
    groundVisible: app.stage.ground.visible,
    popClosed: !pop.classList.contains('on'),
    toast: ([...document.querySelectorAll('.toasts .toast')].pop() || {}).textContent,
  };
});
R.checks.blank = blank;
ck('弹层里有全部 21 套模板卡片', blank.cards >= 21);
ck('点「空白场景」立刻清空并关闭弹层', blank.objs === 0 && blank.shots === 0 && blank.popClosed);
ck('空白场景地形开启且压平、地面可见', blank.terrainOn && blank.flat === 0 && blank.groundVisible);
ck('空白场景给出下一步提示', /素材库|C 键|建机位/.test(blank.toast || ''));
const blankUndo = await page.evaluate(() => { window.app.undo(); return { o: window.app.objects.length, s: window.app.shots.length }; });
ck('空白场景也能撤销回来', blankUndo.o === w0.objs && blankUndo.s === w0.shots);

/* Esc 关弹层 */
const esc = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('#top .tb')].find((b) => /示例场景/.test(b.textContent));
  btn.click();
  const pop = btn.querySelector('.menu.scenes');
  const on0 = pop.classList.contains('on');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  return { on0, on1: pop.classList.contains('on') };
});
ck('Esc 关闭弹层', esc.on0 && !esc.on1);

/* ---------------- 5. 新增 8 个故事场景可用 ---------------- */
const stories = await page.evaluate(async () => {
  const app = window.app;
  const ids = ['cn-snow-edict', 'city-rooftop-noir', 'war-zero-hour', 'xianxia-swordtombs', 'cn-garden-farewell', 'cls-town-last-call', 'space-undock', 'int-empty-room'];
  const THREE = window.__t.THREE;
  const out = [];
  for (const id of ids) {
    window.__scenes.applyScene(app, id);
    app.step(1 / 30);
    const rep = app.sceneReport || {};
    const bad = app.objects.filter((o) => !Number.isFinite(o.root.position.x + o.root.position.y + o.root.position.z)).length;
    let badSample = 0;
    for (const s of app.shots) {
      const o = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
      for (let i = 0; i <= 16; i++) {
        s.mover.sample(i / 16, o, s.easing, s.moverOpts());
        if (!Number.isFinite(o.p.x + o.p.y + o.p.z + o.q.w) || (o.f != null && !Number.isFinite(o.f))) badSample++;
      }
    }
    out.push({ id, objs: app.objects.length, shots: app.shots.length, chars: app.objects.filter((x) => x.isChar).length, moving: app.objects.filter((x) => x.motion?.active).length, bad, badSample, miss: rep.missing || 0, tmiss: rep.targetMiss || 0, atmos: app.lighting.preset, dur: app.state.duration });
  }
  return out;
});
R.stories = stories;
ck('8 个故事场景都能载入（模型 ≥18 或星际/室内 ≥10）', stories.every((x) => x.objs >= (/^(space|int|city)-/.test(x.id) ? 10 : 18)));
ck('8 个故事场景 0 未识别库项、0 主体未命中', stories.every((x) => x.miss === 0 && x.tmiss === 0));
ck('8 个故事场景机位与采样全部有效', stories.every((x) => x.shots >= 3 && x.bad === 0 && x.badSample === 0));
ck('8 个故事场景都有人物或走位参考', stories.every((x) => x.chars >= 1 && x.moving >= 1));
ck('8 个故事场景光影预设各不相同', new Set(stories.map((x) => x.atmos)).size >= 7);

ck('无 console / page 报错', errors.length === 0);
fs.writeFileSync('test/editops-result.json', JSON.stringify(R, null, 1));
await browser.close();
const fails = Object.entries(R.checks).filter(([, v]) => v === false);
console.log(JSON.stringify({ failCount: fails.length, failed: fails.map((f) => f[0]), errors: errors.slice(0, 6), checks: R.checks, before, restored }, null, 1));
process.exit(fails.length || errors.length ? 1 : 0);
