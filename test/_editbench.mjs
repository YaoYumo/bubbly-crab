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

// 画布点选 + 聚焦：软件渲染帧慢，全部用「轮询相机到位/静止」代替固定 sleep
const camDist = () => page.evaluate(() => {
  const s = R4.state; if (s.sel < 0) return 99;
  const c = R4.cam(), b = R4.partBox(s.sel);
  return b ? +Math.hypot(c.target[0] - b.center[0], c.target[1] - b.center[1], c.target[2] - b.center[2]).toFixed(3) : 99;
});
const waitTargetNear = (t, tol, timeout = 30000) => page.waitForFunction(
  (tt, tl) => { const c = R4.cam().target; return Math.hypot(c[0] - tt[0], c[1] - tt[1], c[2] - tt[2]) < tl; },
  { timeout, polling: 250 }, t, tol).then(() => true).catch(() => false);
const waitFocus = async (timeout = 30000) => {
  try {
    await page.waitForFunction(
      () => { const s = R4.state; if (s.sel < 0) return false; const c = R4.cam(), b = R4.partBox(s.sel);
        return b && Math.hypot(c.target[0] - b.center[0], c.target[1] - b.center[1], c.target[2] - b.center[2]) < 0.08; },
      { timeout, polling: 250 });
    return true;
  } catch (err) { return false; }
};

await page.evaluate(() => R4.enter('hall'));
await page.waitForFunction('R4.state.parts > 0', { timeout: 60000 });
const pc = await page.evaluate(() => R4.plateCenter());
ck('进场飞行落位', await waitTargetNear(pc, 0.06), `plateCenter=${pc}`);   // 轮询到相机真正抵达图板中心
const box = await page.evaluate(() => { const c = document.getElementById('gl'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.62);
await new Promise((z) => setTimeout(z, 300));
st = await page.evaluate(() => R4.state);
ck('画布点选命中部件', st.sel >= 0, `sel=${st.sel}`);

// 选中自动聚焦（默认开）：target 飞到部件包围盒中心
const fok = await waitFocus();
let f = await page.evaluate(() => {
  const c = R4.cam();
  return { minDist: c.minDist, dist: +Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]).toFixed(2) };
});
f.d = await camDist();
ck('选中自动聚焦 → 相机对准部件', fok && f.d < 0.15, JSON.stringify(f));
ck('编辑态 minDistance 放宽 <1m', f.minDist < 1, `minDist=${f.minDist}`);

// 关掉自动聚焦：再选部件不飞；F 键手动聚焦仍可用
await new Promise((z) => setTimeout(z, 900));    // 等上一段聚焦飞行的最后一帧收尾（fly=null）
await page.evaluate(() => {
  const cb = document.getElementById('eautofocus');
  cb.checked = false; cb.dispatchEvent(new Event('change'));
  R4.select((R4.state.sel + 300) % R4.state.parts);
});
const held = await page.evaluate(() => R4.cam().target.slice());
await new Promise((z) => setTimeout(z, 900));
const held2 = await page.evaluate(() => R4.cam().target);
const drift = Math.hypot(held2[0] - held[0], held2[1] - held[1], held2[2] - held[2]);
ck('关自动聚焦后选中不再飞', drift < 0.05, `drift=${drift.toFixed(3)}`);
await page.keyboard.press('f');
const fok2 = await waitFocus();
const fd = await camDist();
ck('F 键手动聚焦生效', fok2 && fd < 0.15, `d=${fd}`);
await page.evaluate(() => R4.exit());

ck('无 pageerror', errs.length === 0, errs.slice(0, 4).join(' | '));
console.log(fail === 0 ? `ALL PASS ${pass}/${pass + fail}` : `FAIL ${fail}/${pass + fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
