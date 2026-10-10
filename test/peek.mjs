// 取证截图（一次性）：修复后的观感对照
import puppeteer from 'puppeteer';
const OUT = 'test';
const browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 900000,
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1180,700','--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 700, deviceScaleFactor: 1.25 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 180000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

const shots = [
  { file: `${OUT}/24-garden-bridge.png`, scene: 'cn-garden-farewell', shot: 0, u: 0.34, clean: true, note: '江南桥头送别 · A 过桥跟移：孩童沿桥面跑（不再穿塘），主体居中' },
  { file: `${OUT}/25-valley-conform.png`, scene: 'nature-valley', shot: 4, u: 0.5, clean: true, note: '山谷 · E 石门推入：贴花贴合地形起伏，斜看地面不再有随帧闪点' },
  { file: `${OUT}/26-lead-center.png`, scene: 'city-night', shot: 2, u: 0.5, clean: true, note: '雨夜街头 · C 迎面跟拍：主体锁在画面中央，肩扛幅度收敛' },
  { file: `${OUT}/27-panel-shake.png`, scene: 'cn-garden-farewell', shot: 0, u: 0.2, clean: false, tab: '运镜', note: '运镜面板：防甩断 / 自动避地 / 最低离地 三项新开关' },
];
for (const st of shots) {
  await page.evaluate(async (s) => {
    const app = window.app;
    document.getElementById('peekcss')?.remove();
    window.__scenes.applyScene(app, s.scene);
    app.state.playing = false;
    app.state.preview = !!s.clean;
    let css = document.getElementById('peekcss');
    if (s.clean) {
      if (!css) { css = document.createElement('style'); css.id = 'peekcss'; document.head.appendChild(css); }
      css.textContent = '#top,#left,#right,#bottom,#hud,#quickbar{display:none!important}#app{display:block!important}#viewport{position:fixed!important;inset:0!important}';
    } else if (css) css.textContent = '';
    await new Promise((r) => setTimeout(r, 120));
    if (app.stage?.resize) app.stage.resize();
    const sh = app.shots[s.shot];
    if (sh) {
      app.setActiveShot(sh);
      app.state.time = sh.duration * s.u;
      for (let i = 0; i < 20; i++) { app.state.time = Math.max(0, sh.duration * s.u - (20 - i) / 30); app.step(1 / 30); }
      app.state.time = sh.duration * s.u; app.step(1 / 30);
    }
    if (s.tab) {
      const tabs = [...document.querySelectorAll('#inspector .tab, .itab')];
      const t = tabs.find((x) => new RegExp(s.tab).test(x.textContent));
      if (t) t.click();
    }
    app.stage.render();
    await new Promise((r) => setTimeout(r, 250));
  }, st);
  await page.screenshot({ path: st.file, type: 'png' });
  console.log('写', st.file, '-', st.note);
}
await browser.close();
