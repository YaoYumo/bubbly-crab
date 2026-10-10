// 视觉与交互回归：截图 + 拾取/拖放/面板检查
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1640,980', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1640, height: 980, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.evaluateOnNewDocument(() => {
  window.__tcErr = [];
  const oe = console.error.bind(console);
  console.error = (...a) => {
    if (String(a[0]).includes('scene graph')) {
      const app = window.app;
      window.__tcErr.push({ obj: app?.stage?.tc?.object?.name || app?.stage?.tc?.object?.type || 'null', sel: app?.sel ? (app.sel.kind + ':' + (app.sel.so?.name || app.sel.shot?.name || '')) : 'null', st: (new Error().stack || '').split('\n').slice(1, 6).map((x) => x.trim()).join(' < ') });
    } else oe(...a);
  };
});
const R = { errors, checks: {} };
const ck = (n, v) => { R.checks[n] = v; };

await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.app && window.app.objects.length > 3, { timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

await new Promise((r) => setTimeout(r, 1200));

// --- UI 结构
R.checks.ui = await page.evaluate(() => ({
  cards: document.querySelectorAll('.card').length,
  secs: document.querySelectorAll('#right .sec').length,
  tabs: [...document.querySelectorAll('.itab')].map((b) => b.textContent),
  objs: document.querySelectorAll('.orow').length,
  ticks: document.querySelectorAll('.tk').length,
  hud: document.querySelector('.hud-l')?.textContent?.trim(),
  canvas: !!document.querySelector('#stage canvas'),
  timeline: !!document.querySelector('.track'),
}));

// --- 点击 3D 物体 → 选中
const picked = await page.evaluate(() => {
  const { app, THREE } = window.__t;
  const r = app.stage.canvas.getBoundingClientRect();
  const list = app.objects.map((so) => {
    const v = new THREE.Box3().setFromObject(so.root).getCenter(new THREE.Vector3()).project(app.stage.view);
    return { name: so.name, ndc: Math.max(Math.abs(v.x), Math.abs(v.y)), z: v.z, x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }).filter((o) => o.ndc < 0.55 && o.z < 1 && Number.isFinite(o.x) && Number.isFinite(o.y)).sort((a, b) => a.ndc - b.ndc);
  return list[0];
});
await page.mouse.click(picked.x, picked.y);
await new Promise((r) => setTimeout(r, 500));
R.checks.pick = await page.evaluate((n) => ({ want: n, got: window.app.selObj?.name || null, gizmo: !!window.app.stage.tc.object }), picked.name);
ck('pickOk', R.checks.pick.got === R.checks.pick.want && R.checks.pick.gizmo);

// --- 拖放卡片到视口
const drag = await page.evaluate(() => {
  const { app } = window.__t;
  const dt = new DataTransfer();
  dt.setData('text/asset', 'env:tree:行道树');
  const canvas = app.stage.canvas;
  const before = app.objects.length;
  const r = canvas.getBoundingClientRect();
  const ev = new DragEvent('drop', { dataTransfer: dt, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.62, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return { before, after: app.objects.length };
});
ck('dropAddsObject', drag.after === drag.before + 1);
R.checks.drop = drag;

// --- 键盘：W/E/R/空格/预览
await page.keyboard.press('KeyE');
R.checks.gizmoRotate = await page.evaluate(() => window.app.stage.tc.mode);
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 700));
R.checks.preview = await page.evaluate(() => ({ on: window.app.state.preview, mask: document.querySelector('.frame-mask').classList.contains('on') }));
ck('previewToggle', R.checks.preview.on === true);
await page.screenshot({ path: 'test/02-preview.png' });
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 400));

// --- 光影关闭
await page.keyboard.press('KeyL');
await new Promise((r) => setTimeout(r, 500));
R.checks.perf = await page.evaluate(() => ({ enabled: window.app.lighting.enabled, perf: window.app.state.perf, shadow: window.app.stage.renderer.shadowMap.enabled }));
ck('lightOff', R.checks.perf.enabled === false && R.checks.perf.shadow === false);
await page.screenshot({ path: 'test/03-perf.png' });
await page.keyboard.press('KeyL');

// --- 运镜面板：切到运镜 tab，选预设，看关键帧
R.checks.camTab = await page.evaluate(async () => {
  const { app } = window.__t;
  [...document.querySelectorAll('.itab')].find((b) => b.textContent.includes('运镜'))?.click();
  await new Promise((r) => setTimeout(r, 200));
  const sel = document.querySelector('#right select');
  const s = app.addShot({ name: '测试机位', pos: [-8, 3, 18], duration: 7 });
  s.generateMove('orbitPush');
  const keysBefore = s.keys.length;
  const btns = [...document.querySelectorAll('#right .fbtn')].map((b) => b.textContent);
  return { shots: app.shots.length, keysBefore, hasRegen: btns.some((t) => t.includes('重新生成')), sections: [...document.querySelectorAll('#right .sec-h b')].map((b) => b.textContent), chips: document.querySelectorAll('#right .kchip').length };
});
ck('camPanelKeys', R.checks.camTab.chips === 9);

// --- 记录关键帧 + 整段位移 + 删除
R.checks.keyOps = await page.evaluate(() => {
  const { app } = window.__t;
  const s = app.shots.find((x) => x.name === '测试机位');
  app.state.time = 3.5; app.bus.emit('time');
  const n0 = s.keys.length;
  s.addKeyAt(app.timeline.u, app.stage.view);
  const n1 = s.keys.length;
  app.selectKey(s, 2);
  const mk = s.markers.children[2];
  const t = s.keys[2].t;
  app.state.showHelpers = true;
  s.syncAnchor();
  const p0 = s.keys.map((k) => k.p[0]);
  s.anchor.position.x += 3;
  s.applyAnchorDelta();
  const p1 = s.keys.map((k) => k.p[0]);
  const shifted = p1.every((v, i) => Math.abs(v - (p0[i] + 3)) < 1e-3);
  s.removeKeyAt(n1 - 1);
  return { n0, n1, selT: t, shifted, afterDel: s.keys.length };
});
ck('addKey', R.checks.keyOps.n1 === R.checks.keyOps.n0 + 1);
ck('anchorRigidMove', R.checks.keyOps.shifted === true);
ck('delKey', R.checks.keyOps.afterDel === R.checks.keyOps.n0);

// --- 人物动作切换 + 路径添加
R.checks.char = await page.evaluate(() => {
  const { app } = window.__t;
  const man = app.objects.find((o) => o.motion?.active && o.isChar);
  const before = man.root.position.clone();
  app.state.time = app.state.duration * 0.5; app.step(1 / 30, false);
  const mid = man.root.position.clone();
  app.state.time = 0.02; app.step(1 / 30, false);
  app.state.time = app.state.duration * 0.5; app.step(1 / 30, false);
  const mid2 = man.root.position.clone();
  const back = man.root.position.clone();
  return { anim: man.root.userData.humans[0].anim, moved: +before.distanceTo(mid).toFixed(2), deterministic: +mid2.distanceTo(mid).toFixed(4), phase: +man.root.userData.animPhase.toFixed(2) };
});
ck('charPathPoses', R.checks.char.moved > 0.5 && R.checks.char.deterministic < 1e-6 && R.checks.char.phase > 0);


// --- 手柄拖拽（走真实 onGizmoChange 路径）
R.checks.gizmoDrag = await page.evaluate(async () => {
  const { app, THREE } = window.__t;
  const st = app.stage;
  const shot = app.activeShot;
  const out = {};
  // 1) 拖动关键帧节点
  app.editWhole = false;
  app.selectKey(shot, 1);
  const mk = shot.markers.children[1];
  const before = shot.keys[1].p.slice();
  mk.position.x += 4; mk.position.y += 1.5;
  st.tc.dispatchEvent({ type: 'objectChange' });
  await new Promise((r) => setTimeout(r, 30));
  out.keyMoved = shot.keys[1].p.map((v) => +v.toFixed(2));
  out.keyDelta = [+((shot.keys[1].p[0] - before[0]).toFixed(2)), +((shot.keys[1].p[1] - before[1]).toFixed(2))];
  // 2) 整段模式：移动 anchor → 整条路径平移
  app.editWhole = true;
  app.select({ kind: 'shot', shot });
  const p0 = shot.keys.map((k) => k.p[2]);
  shot.anchor.position.z -= 5;
  st.tc.dispatchEvent({ type: 'objectChange' });
  await new Promise((r) => setTimeout(r, 30));
  out.wholeShift = shot.keys.map((k) => +(k.p[2] - p0[i = shot.keys.indexOf(k)]).toFixed(2));
  out.rigMoved = +shot.rig.position.z.toFixed(2);
  // 3) 旋转关键帧节点 → 朝向写入 q
  app.editWhole = false;
  app.selectKey(shot, 0);
  const mk0 = shot.markers.children[0];
  const q0 = (shot.keys[0].q || [0, 0, 0, 1]).slice();
  mk0.rotateY(0.6);
  st.tc.dispatchEvent({ type: 'objectChange' });
  await new Promise((r) => setTimeout(r, 30));
  out.qChanged = shot.keys[0].q.some((v, i) => Math.abs(v - q0[i]) > 1e-3);
  // 4) 物体关键帧拖动
  const so = app.objects.find((o) => o.motion?.active && o.motion.keys.length > 1);
  if (so) {
    app.selectKey(so, 0);
    const om = so._mgroup.children[0];
    const b2 = so.motion.keys[0].p.slice();
    om.position.x += 3;
    st.tc.dispatchEvent({ type: 'objectChange' });
    await new Promise((r) => setTimeout(r, 30));
    out.objKeyDelta = +(so.motion.keys[0].p[0] - b2[0]).toFixed(2);
  }
  // 5) 拖动物体本体 → 走位关键帧整体跟随
  const so2 = app.objects.find((o) => o.motion?.active && o.motion.keys.length > 1);
  app.editWhole = false;
  app.select({ kind: 'obj', so: so2 });
  const y0 = so2.motion.keys.map((k) => k.p[1]);
  const yPre = +so2.root.position.y.toFixed(2);
  st.tc.dispatchEvent({ type: 'dragging-changed', value: true });
  so2.root.position.y += 2;
  st.tc.dispatchEvent({ type: 'objectChange' });
  so2.root.position.y += 1;
  st.tc.dispatchEvent({ type: 'objectChange' });
  st.tc.dispatchEvent({ type: 'dragging-changed', value: false });
  await new Promise((r) => setTimeout(r, 30));
  out.objMovedDelta = +(so2.root.position.y - yPre).toFixed(2);
  out.objFollow = so2.motion.keys.map((k) => +(k.p[1] - y0[so2.motion.keys.indexOf(k)]).toFixed(2)).slice(0, 3);
  // 6) 相机路径线是否随关键帧更新
  out.pathPts = shot.pathLine?.geometry.attributes.position.count || 0;
  out.pathFinite = (() => { const a = shot.pathLine?.geometry.attributes.position.array || []; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; })();
  return out;
});
ck('gizmoKeyDrag2', Math.abs((R.checks.gizmoDrag.keyDelta || [])[0] - 4) < 0.01 && Math.abs((R.checks.gizmoDrag.keyDelta || [])[1] - 1.5) < 0.01);
ck('gizmoWholeShift', R.checks.gizmoDrag.wholeShift.every((v) => Math.abs(v + 5) < 0.01));
ck('gizmoRotKey', R.checks.gizmoDrag.qChanged === true);
ck('gizmoObjKey', Math.abs((R.checks.gizmoDrag.objKeyDelta ?? 0) - 3) < 0.01);
ck('gizmoObjFollow', (R.checks.gizmoDrag.objFollow || []).every((v) => Math.abs(v - 3) < 0.01));
ck('pathLineFinite', R.checks.gizmoDrag.pathFinite === true && R.checks.gizmoDrag.pathPts > 100);

// --- 夜间氛围 + 截图
await page.evaluate(() => {
  [...document.querySelectorAll('.itab')].find((b) => b.textContent.includes('光影'))?.click();
});
await new Promise((r) => setTimeout(r, 300));
R.checks.lightPanel = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.acard')];
  cards.find((c) => c.textContent.includes('夜景霓虹'))?.click();
  return { presets: cards.length, sun: window.app.lighting.p.sunInt, glow: window.app.lighting.p.glow };
});
ck('atmosCount', R.checks.lightPanel.presets >= 10);
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => { window.app.state.time = 2.2; window.app.bus.emit('time'); });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'test/04-night.png' });
await page.evaluate(() => { window.app.lighting.applyPreset('golden'); window.app.removeShot(window.app.shots.find((s) => s.name === '测试机位')); });
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => { window.app.state.time = 2.4; window.app.bus.emit('time'); window.app.state.preview = false; window.app.stage.preview = false; });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'test/01-editor.png' });
await page.evaluate(() => { window.app.state.playing = true; });

// 导出面板截图
await page.evaluate(() => { [...document.querySelectorAll('.itab')].find((b) => b.textContent.includes('导出'))?.click(); });
await new Promise((r) => setTimeout(r, 400));
R.checks.exportPanel = await page.evaluate(() => ({
  selects: document.querySelectorAll('#right select').length,
  prompt: (document.querySelector('textarea.prompt')?.value || '').length,
  buttons: [...document.querySelectorAll('#right .fbtn')].map((b) => b.textContent.trim()),
}));
ck('promptGenerated', R.checks.exportPanel.prompt > 200);
await page.screenshot({ path: 'test/05-export.png' });

// 帮助弹层
await page.evaluate(() => { document.querySelectorAll('#top .tb'); });
await page.keyboard.press('Slash');
await page.evaluate(() => { [...document.querySelectorAll('#top .tb')].find((b) => b.textContent.includes('帮助'))?.click(); });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'test/06-help.png' });
R.checks.help = await page.evaluate(() => document.querySelector('#modal').classList.contains('on'));
await page.evaluate(() => { document.querySelector('.mclose')?.click(); });


// --- 机位身份：颜色 / 视口名牌 / 预览角标 / [ ] 切换
R.checks.identity = await page.evaluate(async () => {
  const { app } = window.__t;
  app.setActiveShot(app.shots[0]);
  app.state.preview = false; app.stage.preview = false;
  app.state.showHelpers = true;
  await new Promise((r) => setTimeout(r, 200));
  const shots = app.shots.map((s) => ({
    name: s.name, hex: s.colorHex, hasLabel: !!s.label, labelVisible: !!s.label?.visible,
    texW: s.label?.material?.map?.image?.width || 0, pathHex: s.pathLine ? '#' + s.pathLine.material.color.getHexString() : null,
    bodyHex: s.body ? '#' + s.body.children[2].material.color.getHexString() : null,
  }));
  const tag = document.getElementById('shotTag');
  app.step(1 / 30);
  return {
    n: app.shots.length, shots,
    distinct: new Set(shots.slice(1).map((s) => s.hex)).size >= Math.min(2, shots.length - 1),
    activeAmber: shots[0].hex === '#ffb547',
    tagOn: tag.classList.contains('on'), tagText: tag.textContent.slice(0, 60),
    listDots: [...document.querySelectorAll('.shotlist .dot')].map((d) => (d.getAttribute('style') || '').slice(0, 24)),
    listEye: [...document.querySelectorAll('.shotlist .eye')].map((x) => x.textContent).join('|'),
    listLiveRows: document.querySelectorAll('.shotlist .shot.live').length,
    labelScale: +app.shots[0].label.scale.x.toFixed(3),
    labelStrokes: app.shots.map((sh) => {
      const cv = sh.label.material.map.image, g = cv.getContext('2d');
      for (let x = 0; x < cv.width; x++) {
        const d = g.getImageData(x, 4, 1, 1).data;
        if (d[3] > 200 && d[0] + d[1] + d[2] > 150) {
          return [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        }
      }
      return null;
    }),
    expectStrokes: app.shots.map((sh) => sh.colorHex.slice(1)),
    rowTitles: [...document.querySelectorAll('.shotlist .shot')].map((b) => (b.getAttribute('title') || '').slice(0, 18)),
  };
});
ck('shotColorsDistinct', R.checks.identity.distinct && R.checks.identity.activeAmber);
ck('shotLabels', R.checks.identity.shots.every((s) => s.hasLabel && s.labelVisible && s.texW > 200));
ck('shotListColored', R.checks.identity.listDots.length >= 3 && R.checks.identity.listEye.includes('当前机位')
  && R.checks.identity.listLiveRows === 0);
ck('labelStrokeMatchesIdentityColor',
  R.checks.identity.labelStrokes.length >= 3
  && R.checks.identity.labelStrokes.every((hx, i) => {
    const a = hx, b = R.checks.identity.expectStrokes[i];
    if (!a || !b) return false;
    const d = [0, 2, 4].reduce((s, k) => s + Math.abs(parseInt(a.substr(k, 2), 16) - parseInt(b.substr(k, 2), 16)), 0);
    return d <= 12;
  }));
ck('labelScalesWithDistance', R.checks.identity.labelScale > 0.85 && R.checks.identity.labelScale < 13
  && R.checks.identity.rowTitles.every((t) => t.length > 4));
ck('identityInEdit', R.checks.identity.tagOn === false);

await page.keyboard.press('BracketRight');
await new Promise((r) => setTimeout(r, 400));
R.checks.cycle = await page.evaluate(() => ({
  active: window.app.activeShot?.name, idx: window.app.shots.indexOf(window.app.activeShot),
  pathFollows: window.app.activeShot.colorHex === '#ffb547',
  others: window.app.shots.filter((s) => s !== window.app.activeShot).map((s) => s.colorHex),
}));
ck('cycleShot', R.checks.cycle.idx === 1 && R.checks.cycle.pathFollows === true);

await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 700));
R.checks.previewTag = await page.evaluate(async () => {
  const { app } = window.__t;
  await new Promise((r) => setTimeout(r, 150));
  app.step(1 / 30); // 无头浏览器里 rAF 会被饿死，手动补一帧再断言可见性
  const tag = document.getElementById('shotTag');
  return {
    on: tag.classList.contains('on'), text: tag.textContent,
    view: app.stage.view.position.toArray().map((v) => +v.toFixed(2)),
    labelsHidden: app.shots.every((s) => !s.label.visible),
    listLive: document.querySelectorAll('.shotlist .shot.live').length,
    listEye: [...document.querySelectorAll('.shotlist .eye')].map((x) => x.textContent).join('|'),
    idx: app.shots.indexOf(app.activeShot),
  };
});
ck('previewTagShowsShot', R.checks.previewTag.on === true
  && R.checks.previewTag.text.includes(`${R.checks.previewTag.idx + 1}/`)
  && R.checks.previewTag.text.includes(R.checks.cycle.active));
ck('labelsHiddenInPreview', R.checks.previewTag.labelsHidden === true);
ck('listMarksLiveShot', R.checks.previewTag.listLive === 1 && R.checks.previewTag.listEye.includes('预览中'));
await page.screenshot({ path: 'test/12-preview-tag.png' });
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'test/13-identity.png' });

R.tcErrors = await page.evaluate(() => window.__tcErr || []);
ck('noOrphanGizmo', (await page.evaluate(() => (window.__tcErr || []).length)) === 0);
R.errors = errors;
fs.writeFileSync('test/shots-result.json', JSON.stringify(R, null, 1));
const fails = Object.entries(R.checks).filter(([k, v]) => k.endsWith('Ok') || k.startsWith('atmos') || k.startsWith('char') || k.startsWith('cam') || k.startsWith('add') || k.startsWith('del') || k.startsWith('anchor') || k.startsWith('preview') || k.startsWith('light') || k.startsWith('prompt') || k.startsWith('help'));
console.log(JSON.stringify({ errorCount: errors.length, errors: errors.slice(0, 6), checks: R.checks }, null, 1));
await browser.close();
const all = Object.values(R.checks);
const boolFails = Object.entries(R.checks).filter(([k, v]) => typeof v === 'boolean' && !v).map(([k]) => k);
process.exit(errors.length || boolFails.length ? 1 : 0);
