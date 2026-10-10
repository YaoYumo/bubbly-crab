// 人群随机漫游回归：会走动、贴地、不踩水；关掉开关就站住不动。
// 运行：node test/crowd.mjs   （需要 dev server：npm run dev）
import puppeteer from 'puppeteer';

const URL0 = process.env.URL || 'http://localhost:5173/';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 560, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errors.push('console: ' + m.text().split('\n')[0]); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t, { timeout: 180000 });

const R = await page.evaluate(async () => {
  const app = window.app, THREE = window.__t.THREE;
  const out = { steps: 0 };
  const empty = () => { app.stage?.stopFly?.(); app.objects.slice().forEach((o) => app.removeObject(o)); };
  const stepN = (n) => { for (let i = 0; i < n; i++) app.step(1 / 60); out.steps += n; };
  const stat = (so) => {
    const hs = so.root.userData.humans, tr = app.terrain, wy = tr && tr.enabled && tr.state.water ? tr.state.waterY : null;
    let moved = 0, offG = 0, wet = 0, nan = 0;
    for (const h of hs) {
      const p = h.obj.position;
      if (!Number.isFinite(p.x + p.y + p.z)) { nan++; continue; }
      const wx = p.x + so.root.position.x, wz = p.z + so.root.position.z;
      const gy = tr && tr.enabled ? tr.heightAt(wx, wz) : 0;
      if (h._x0 != null && Math.hypot(p.x - h._x0, p.z - h._z0) > 0.5) moved++;
      if (Math.abs(p.y + so.root.position.y - gy) > 0.5) offG++;
      if (wy != null && gy < wy - 0.12 && Math.abs(p.y + so.root.position.y - gy) < 0.5) wet++;
    }
    return { n: hs.length, moved, offGround: offG, wet, nan };
  };
  const mark = (so) => so.root.userData.humans.forEach((h) => { h._x0 = h.obj.position.x; h._z0 = h.obj.position.z; });

  // 1) 示例场景自带的人群：走起来 + 贴地
  empty();
  window.__scenes.applyScene(app, 'cn-palace');
  const c1 = app.objects.find((o) => o.root.userData.crowd);
  mark(c1);
  stepN(420);
  out.scene = { id: 'cn-palace', ...stat(c1) };

  // 2) 关掉随机漫游 → 应该站住不动（地形 / 水面照样不碰）
  empty();
  const off = app.addAsset('char:crowd:人群', new THREE.Vector3(0, 0, 14), { params: { count: 18, radius: 8, anim: 'walk', wander: false } });
  mark(off);
  stepN(420);
  out.switchOff = { ...stat(off), moved: off.root.userData.humans.filter((h) => Math.hypot(h.obj.position.x - h._x0, h.obj.position.z - h._z0) > 0.5).length };

  // 3) 在水塘边放人群：漫游要避开积水（只允许在实在没处走的少数点上踩水）
  empty();
  window.__scenes.applyScene(app, 'cn-garden-farewell');
  const c3 = app.addAsset('char:crowd:人群', new THREE.Vector3(0, 0, 15), { params: { count: 20, radius: 9, anim: 'walk', wradius: 16, wspeed: 1 } });
  mark(c3);
  stepN(900);
  out.byWater = { ...stat(c3), waterY: +(app.terrain.state.waterY || 0).toFixed(2) };

  // 4) 参数随工程 JSON 存下来（导出 / AI 交接要能看到漫游设置）
  const j = app.serialize();
  const row = (j.objects || []).find((o) => o.key === 'char:crowd:人群');
  out.serialized = !!(row && row.params && row.params.wander === true && typeof row.params.wradius === 'number');

  // 5) 拖动整个人群之后，漫游范围跟着走（不会留在原地绕圈）
  const before = c3.root.position.clone();
  c3.root.position.set(-18, c3.root.position.y, -6);
  app.bus.emit('objects');
  mark(c3);
  stepN(240);
  const cx = -18, cz = -6;
  let outside = 0;
  for (const h of c3.root.userData.humans) {
    const wx = h.obj.position.x + cx, wz = h.obj.position.z + cz;
    if (Math.hypot(wx - cx, wz - cz) > 16 + 3) outside++;
  }
  out.afterDrag = { ...stat(c3), outsideRange: outside, movedRoot: c3.root.position.distanceTo(before).toFixed(1) };
  return out;
});
await browser.close();

const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + ' ' + extra); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };
ck('场景人群会自己走动（≥60% 位移 >0.5m）', R.scene.moved >= Math.ceil(R.scene.n * 0.6), `${R.scene.moved}/${R.scene.n}`);
ck('走动不穿地（离地差 ≤0.5m）', R.scene.offGround === 0 && R.byWater.offGround === 0, `scene ${R.scene.offGround} / water ${R.byWater.offGround}`);
ck('关掉「随机漫游」就站住', R.switchOff.moved === 0, `moved=${R.switchOff.moved}`);
ck('塘边人群基本不踩水（≤15%）', R.byWater.wet <= Math.ceil(R.byWater.n * 0.15), `${R.byWater.wet}/${R.byWater.n} @waterY ${R.byWater.waterY}`);
ck('漫游设置随工程 JSON 保存', R.serialized);
ck('拖动人群后漫游范围跟着走', R.afterDrag.outsideRange === 0, `越界 ${R.afterDrag.outsideRange}`);
ck('无 NaN 位置', R.scene.nan + R.byWater.nan + R.switchOff.nan === 0);
ck('无报错', errors.length === 0, errors.slice(0, 3).join(' | '));

import('fs').then((fs) => fs.writeFileSync('test/crowd-result.json', JSON.stringify({ ...R, errors }, null, 1)));
console.log(JSON.stringify({ failCount: fails.length, failed: fails }));
process.exit(fails.length ? 1 : 0);
