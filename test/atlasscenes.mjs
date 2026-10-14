// 布局图鉴 12 场景验收：bash test/withchrome.sh node test/atlasscenes.mjs（需 :5174 导演台在跑）
// 每个场景 ?scene=id 载入 → 断言 app.sceneReport（模型数>0、无未识别库项）→ 截图 shots/atlas-<id>.png
import puppeteer from 'puppeteer';
import { SCENES3 } from '../src/scenes3.js';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));

let pass = 0, fail = 0;
const ck = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`); };

const FILTER = process.argv[2] || '';
for (const sc of SCENES3.filter((x) => x.id.includes(FILTER))) {
  await page.goto(`http://127.0.0.1:5174/?fresh=1&scene=${sc.id}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(`window.app && app.sceneReport && app.sceneReport.id === ${JSON.stringify(sc.id)}`, { timeout: 300000 });
  await new Promise((r) => setTimeout(r, 2500)); // 等渲染与相机稳定
  // 无头合成器在无交互时不刷新 WebGL 画布：显式写入一次场景机位（等同用户拖拽）后再截
  await page.evaluate((v) => {
    const s = app.stage;
    if (app.activeShot) {
      app.activeShot.rig.position.set(v.pos[0], v.pos[1], v.pos[2]);
      app.activeShot.rig.lookAt(v.target[0], v.target[1], v.target[2]);
    }
    s.view.position.set(v.pos[0], v.pos[1], v.pos[2]);
    s.orbit.target.set(v.target[0], v.target[1], v.target[2]);
    s.orbit.update();
  }, sc.view);
  await new Promise((r) => setTimeout(r, 1200));
  const rep = await page.evaluate(() => app.sceneReport);
  ck(`${sc.id} 载入`, rep.missing === 0 && rep.targetMiss === 0 && rep.models === sc.objs.length, `models=${rep.models}/${sc.objs.length} missing=${rep.missing} tgtMiss=${rep.targetMiss}`);
  await page.screenshot({ path: `shots/atlas-${sc.id.replace('atlas-', '')}.png` });
}
const pageErrs = errs.filter((e) => !/favicon/i.test(e));
ck('无页面错误', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '));
console.log(pageErrs.length ? pageErrs.join('\n') : '');
console.log(fail ? `ATLASSCENES FAIL ${fail}` : 'ATLASSCENES ALL PASS');
await browser.close();
process.exit(fail ? 1 : 0);
