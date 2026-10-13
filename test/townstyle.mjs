// 一句话生成 2.0：风格扩展（中式/现代/混搭）+ 宅前基座小径 + 生成后道路可再编辑
// 运行：bash test/withchrome.sh node test/townstyle.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
fs.mkdirSync('test/out', { recursive: true });

const URL0 = process.env.URL || 'http://localhost:5173/';
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 850 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools|Vite/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });

const R = await page.evaluate(async () => {
  const app = window.app;
  const { generateTown } = await import('/src/townbuild.js');
  const out = {};
  const roadsOf = () => app.objects.filter((o) => o.type === 'road_brush');
  const patchesOf = () => app.objects.filter((o) => o.type === 'road_intersection');

  /* ---- 1. 古今混搭：中式院落 + 西式街屋同场，宅前基座/车道接路 ---- */
  const f = generateTown(app, { theme: 'fusion', seed: 7, mapSize: 256, roadTopology: 'grid' });
  const keys = app.objects.filter((o) => o.key).map((o) => o.key);
  const pads = roadsOf().filter((o) => o.name === '混凝土基座');
  const lanes = roadsOf().filter((o) => o.name === '宅前车道');
  const patches = patchesOf();
  const marked = patches.filter((o) => o.root.children.some((c) => c.name === 'crosswalk_stripe'));
  out.fusion = {
    houses: f.houses, driveways: f.driveways, ms: f.ms,
    hasCn: keys.some((k) => k.startsWith('cn:')),
    hasWest: keys.some((k) => k.startsWith('house:') || k.startsWith('suburban:')),
    pads: pads.length, lanes: lanes.length,
    padNoJunct: pads.length > 0 && pads.every((o) => o.serialize().noJunct === true),
    laneConnects: lanes.length > 0 && lanes.every((o) => o.serialize().noJunct !== true),
    patches: patches.length, markedPatches: marked.length,
    unmarkedPatches: patches.length - marked.length,
  };

  /* ---- 2. 中式古城 + 中轴对称：中轴大道在场，宅前是青砖小径 ---- */
  const c = generateTown(app, { theme: 'chinese', seed: 11, mapSize: 256, roadTopology: 'axis' });
  const names = roadsOf().map((o) => o.name);
  out.chinese = {
    houses: c.houses, driveways: c.driveways, ms: c.ms,
    hasAxis: names.includes('中轴大道') && names.includes('东西大街'),
    gardenPaths: names.filter((n) => n === '青砖小径').length,
    cnOnly: app.objects.filter((o) => o.key).every((o) => o.key.startsWith('cn:') || o.key.startsWith('vegetation:')),
  };

  /* ---- 3. 生成后道路可再编辑：画笔接管中轴大道，改线后完成 ---- */
  const target = roadsOf().find((o) => o.name === '中轴大道') || roadsOf()[0];
  const oldId = target.id;
  const oldPts = JSON.stringify(target.serialize().points);
  const okEdit = app.roadBrush.editRoad(target);
  const mid = {
    active: app.roadBrush.active,
    nPts: app.roadBrush.points.length,
    backup: !!app.roadBrush._editBackup,
    removed: !app.objects.some((o) => o.id === oldId),
  };
  app.roadBrush.points[0].x += 7;
  const mesh = app.roadBrush.finish();
  const roadObj = mesh && mesh.userData && mesh.userData.so;
  out.edit = {
    okEdit, ...mid,
    finished: !!roadObj,
    backupCleared: !app.roadBrush._editBackup,
    newExists: !!(roadObj && app.objects.some((o) => o.id === roadObj.id)),
    moved: !!(roadObj && JSON.stringify(roadObj.serialize().points) !== oldPts),
    notActive: !app.roadBrush.active,
  };

  /* ---- 4. 放弃编辑：原路按原 id、原控制点恢复 ---- */
  const t2 = roadsOf().find((o) => o.name === '宅前车道' || o.name === '青砖小径');
  const t2id = t2.id, t2pts = JSON.stringify(t2.serialize().points);
  app.roadBrush.editRoad(t2);
  const wasRemoved = !app.objects.some((o) => o.id === t2id);
  app.roadBrush.cancelEdit();
  const back = app.objects.find((o) => o.id === t2id);
  out.cancel = {
    wasRemoved,
    restored: !!back,
    ptsSame: !!back && JSON.stringify(back.serialize().points) === t2pts,
    notActive: !app.roadBrush.active,
    noBackup: !app.roadBrush._editBackup,
  };

  /* ---- 5. 编辑后的路可进可出（序列化往返不丢 noJunct）---- */
  const pad = roadsOf().find((o) => o.name === '混凝土基座');
  out.roundtrip = pad ? { noJunct: pad.serialize().noJunct } : null;
  return out;
});

/* ---- 断言 ---- */
ck('混搭场同时有中式与西式建筑', R.fusion.hasCn && R.fusion.hasWest, JSON.stringify(R.fusion));
ck('混搭场生成宅前基座与车道', R.fusion.pads > 0 && R.fusion.lanes > 0 && R.fusion.driveways === R.fusion.pads + R.fusion.lanes);
ck('基座不生成路口、车道正常接路', R.fusion.padNoJunct && R.fusion.laneConnects);
ck('路口分两类：车行道口有斑马线、宅前接入无', R.fusion.markedPatches > 0 && R.fusion.unmarkedPatches > 0, `marked=${R.fusion.markedPatches} unmarked=${R.fusion.unmarkedPatches}`);
ck('中式古城：中轴大道+东西大街在场', R.chinese.hasAxis, JSON.stringify(R.chinese));
ck('中式古城：宅前是青砖小径且全为中式', R.chinese.gardenPaths > 0 && R.chinese.cnOnly, `paths=${R.chinese.gardenPaths}`);
ck('道路可再编辑：画笔接管且原路移除', R.edit.okEdit && R.edit.active && R.edit.nPts >= 2 && R.edit.backup && R.edit.removed, JSON.stringify(R.edit));
ck('编辑完成：新路落回、改线生效、备份清除', R.edit.finished && R.edit.newExists && R.edit.moved && R.edit.backupCleared && R.edit.notActive, JSON.stringify(R.edit));
ck('放弃编辑：原路按原 id/控制点恢复', R.cancel.wasRemoved && R.cancel.restored && R.cancel.ptsSame && R.cancel.notActive && R.cancel.noBackup, JSON.stringify(R.cancel));
ck('基座序列化保留 noJunct', !!R.roundtrip && R.roundtrip.noJunct === true, JSON.stringify(R.roundtrip));
ck('全程零 pageerror', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'test/out/townstyle-chinese.png' }).catch(() => {});
await browser.close();
console.log(`\n生成耗时 fusion=${R.fusion.ms}ms chinese=${R.chinese.ms}ms · ${fails.length ? `FAILED(${fails.length})` : 'ALL PASS'}`);
process.exit(fails.length ? 1 : 0);
