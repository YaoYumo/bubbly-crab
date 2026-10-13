// 工作台「部件编辑」冒烟探针：bash test/withchrome.sh node test/editbench.mjs（需 :5175 showcase 在跑）
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction('window.R4 && R4.state', { timeout: 120000 });

let pass = 0, fail = 0;
const ck = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`); };

ck('编辑开关存在', await page.$('#edit') !== null);

let ok = await page.evaluate(() => window.R4.enter('pagoda'));
ck('R4.enter(pagoda)', ok === true);
await page.waitForFunction('R4.state.parts > 0', { timeout: 60000 });
let st = await page.evaluate(() => R4.state);
ck('部件数 > 30', st.parts > 30, `parts=${st.parts}`);
ck('面板可见', await page.evaluate(() => !document.getElementById('epanel').hidden));
ck('清单已渲染', await page.evaluate(() => document.querySelectorAll('#elist .prow').length) > 30);

await page.evaluate(() => R4.select(3));
st = await page.evaluate(() => R4.state);
ck('选中 #3', st.sel === 3);
ck('gizmo 挂上 + 高亮材质', await page.evaluate(() => !!document.getElementById('eslabel').textContent.startsWith('#3')));

let r = await page.evaluate(() => { R4.nudge('y', 0.5); return R4.state; });
ck('移动 → 已改1/撤销栈1', r.modified === 1 && r.undo === 1, JSON.stringify(r));
r = await page.evaluate(() => { R4.undo(); return R4.state; });
ck('撤销 → 已改0', r.modified === 0, JSON.stringify(r));
r = await page.evaluate(() => { R4.redo(); return R4.state; });
ck('重做 → 已改1', r.modified === 1, JSON.stringify(r));
r = await page.evaluate(() => { R4.undo(); return R4.state; });

r = await page.evaluate(() => { R4.select(5); R4.delete(5); return R4.state; });
ck('删除 → 已改1', r.modified === 1);
r = await page.evaluate(() => { R4.undo(); return R4.state; });
ck('撤销删除 → 已改0', r.modified === 0);

r = await page.evaluate(() => { R4.select(6); R4.hide(6); return R4.state; });
ck('隐藏 → 已改1', r.modified === 1);
await page.evaluate(() => R4.undo());

const txt = await page.evaluate(() => { R4.select(2); R4.nudge('x', 0.3); return R4.text(); });
ck('修补单含 移动Δ/pagoda', txt.includes('移动 Δ(+0.3') && txt.includes('pagoda'), txt.split('\n')[0]);
const patch = await page.evaluate(() => R4.patch());
ck('JSON ops=1 adjust', patch.count === 1 && patch.ops[0].op === 'adjust' && patch.ops[0].idx === 2);

await page.evaluate(() => R4.resetAll());
st = await page.evaluate(() => R4.state);
ck('图板复原 → 已改0', st.modified === 0);

// 存档：改一处 → 退出 → 重进 → 应自动恢复
await page.evaluate(() => { R4.select(4); R4.nudge('y', -0.2); R4.exit(); });
await new Promise((z) => setTimeout(z, 500));
await page.evaluate(() => R4.enter('pagoda'));
await page.waitForFunction('R4.state.parts > 0', { timeout: 60000 });
st = await page.evaluate(() => R4.state);
ck('存档恢复 → 已改1', st.modified === 1, JSON.stringify(st));
await page.evaluate(() => { R4.resetAll(); R4.exit(); });

// 画布点选：进入 hall，朝画面中心（模型主体）点一下
await page.evaluate(() => R4.enter('hall'));
await page.waitForFunction('R4.state.parts > 0', { timeout: 60000 });
await new Promise((z) => setTimeout(z, 1600));   // 等相机飞行落位
const box = await page.evaluate(() => { const c = document.getElementById('gl'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.62);
await new Promise((z) => setTimeout(z, 300));
st = await page.evaluate(() => R4.state);
ck('画布点选命中部件', st.sel >= 0, `sel=${st.sel}`);
await page.evaluate(() => R4.exit());

ck('无 pageerror', errs.length === 0, errs.slice(0, 4).join(' | '));
console.log(fail === 0 ? `ALL PASS ${pass}/${pass + fail}` : `FAIL ${fail}/${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
