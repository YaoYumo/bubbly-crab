// 刷新打包用的两张门面图：素材库（含新分类）+ 示例场景弹层
import puppeteer from 'puppeteer';
const URL0 = process.env.URL || 'http://localhost:5174/';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1420, height: 900, deviceScaleFactor: 1.3 });
await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 180000 });

// ① 素材库：切到「建筑构件」并滚到新卡片，同时摆一个小样
await p.evaluate(async () => {
  const app = window.app, THREE = window.__t.THREE;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  app.objects.slice().forEach((o) => app.removeObject(o));
  for (const [x, z, r, len, extra] of [[-5, 3.4, 0, 10, { wins: 2, door: true, doorPos: 0.3 }], [0.6, -3.4, Math.PI / 2, 10, { wins: 1 }]]) {
    const w = app.addAsset('bld:wall:直墙（带门窗洞）', V(x, 0, z), { params: { length: len, height: 3.2, thick: 0.24, ...extra } });
    w.root.rotation.y = r;
  }
  app.addAsset('bld:doorsingle:单开门', V(-6.7, 0, 3.4), { params: { open: 62 } });
  app.addAsset('bld:windowarch:拱窗', V(0.6, 0, -3.4), { params: { w: 1.4, h: 2.2 } }).root.rotation.y = Math.PI / 2;
  app.addAsset('bld:stairswitch:双跑楼梯（带休息平台）', V(3.6, 0, -1.6), { params: { rise: 3.4, w: 1.05, steps: 9, holeLen: 2.6, band: 2.4 } });
  app.addAsset('bld:ceilingbeam:天花板（带梁）', V(0, 0, 0), { params: { w: 11, d: 8, thick: 0.16, beams: 5, beamH: 0.3, autoHole: true, holeEdge: 0.12 } }).root.position.y = 3.4;
  app.updateCeilingHoles();
  app.state.showHelpers = false;                       // 门面图不要机位路径的圈
  app.stage.setGridVisible(false);
  app.stage.orbit.target.set(0, 1.9, 0);
  app.stage.view.position.set(9.5, 7.4, 11.5);
  app.stage.view.fov = 33; app.stage.view.updateProjectionMatrix();
  app.stage.orbit.update();
  const lb = document.getElementById('library');
  [...lb.querySelectorAll('.chips .chip')].find((c) => /建筑构件/.test(c.textContent)).click();
  for (let i = 0; i < 6; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
  app.stage.render();
});
await new Promise((r) => setTimeout(r, 1100));
await p.screenshot({ path: 'shot-now-1-library.png' });

// ② 示例场景弹层
await p.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((x) => /示例场景/.test(x.textContent || ''));
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 500));
});
await new Promise((r) => setTimeout(r, 700));
await p.screenshot({ path: 'shot-now-2-menu.png' });
console.log('刷新增两张门面图');
await b.close();
