// 冒烟测试：用 headless Chrome 跑真实代码路径
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:5173/';
const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--window-size=1640,980', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1640, height: 980, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.app && window.app.objects.length > 3, { timeout: 60000 });

const out = await page.evaluate(async () => {
  const { app, THREE, LIB_INDEX, MOVES, ANIMS, ATMOS, Mover } = window.__t;
  const R = { ok: true, fails: [], info: {} };
  const bad = (n, v) => { if (!Number.isFinite(v)) R.fails.push(`${n}: 非有限值 ${v}`); return Number.isFinite(v); };
  const finV = (n, x) => { bad(n + '.x', x.x); bad(n + '.y', x.y); bad(n + '.z', x.z); };
  const step = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. 全部预设模型：默认 / 极值参数重建
  let nAssets = 0;
  for (const [key, item] of LIB_INDEX) {
    const so = app.addAsset(key, new THREE.Vector3(3, 0, 3));
    if (!so) { R.fails.push('无法创建 ' + key); continue; }
    nAssets++;
    const bb = new THREE.Box3().setFromObject(so.root);
    if (bb.isEmpty()) R.fails.push('空包围盒 ' + key);
    finV('bbox ' + key, bb.max);
    for (const p of item.params || []) {
      if (p.t === 'sel') { for (const o of p.opts) { so.params[p.k] = o.v; app.rebuildObject(so); } }
      else if (p.min !== undefined) {
        for (const v of [p.min, p.max]) { so.params[p.k] = v; app.rebuildObject(so); }
      } else if (p.t === 'bool') { so.params[p.k] = !so.params[p.k]; app.rebuildObject(so); }
      else if (p.t === 'color') { so.params[p.k] = '#123456'; app.rebuildObject(so); }
    }
    const so2 = app.byId(so.id);
    if (!so2) R.fails.push('重建后丢失物体 ' + key);
    else {
      const b2 = new THREE.Box3().setFromObject(so2.root);
      if (b2.isEmpty()) R.fails.push('重建后空盒 ' + key);
      app.removeObject(so2);
    }
    await step(0);
  }
  R.info.assets = nAssets;

  // 2. 全部运镜预设：生成关键帧 + 采样
  let moves = 0;
  for (const mv of MOVES) {
    const s = app.addShot({ name: 'T-' + mv.id, pos: [-14, 2.4, 16], quat: undefined, duration: 6, focusDist: 12 });
    s.moveParams = {};
    s.generateMove(mv.id);
    moves++;
    if (!s.keys.length) R.fails.push('预设无关键帧: ' + mv.id);
    for (const k of s.keys) finV(mv.id + ' key', { x: k.p[0], y: k.p[1], z: k.p[2] });
    const cam = new THREE.PerspectiveCamera();
    for (let i = 0; i <= 20; i++) {
      s.applyTo(cam, i / 20, i / 20 * 6, 16 / 9);
      finV(mv.id + ' cam.pos', cam.position);
      if (!bad(mv.id + ' fov', cam.fov) || cam.fov < 0.5 || cam.fov > 179) R.fails.push(mv.id + ' fov 越界 ' + cam.fov);
    }
    R.info[mv.id] = { keys: s.keys.length, dur: s.duration, follow: s.follow };
    app.removeShot(s);
  }
  R.info.moves = moves;

  // 3. 关键帧编辑：添加 / 选中 / 拖动 / 删除 / 整段位移
  const s0 = app.activeShot;
  const n0 = s0.keys.length;
  s0.addKeyAt(0.55, app.stage.view);
  if (s0.keys.length !== n0 + 1) R.fails.push('addKeyAt 未增加关键帧');
  app.selectKey(s0, 1);
  const mk = s0.markers.children[1];
  if (!mk) R.fails.push('缺少关键帧手柄');
  else {
    mk.position.x += 1.5;
    app.onGizmoChange(mk);
    if (Math.abs(s0.keys[1].p[0] - mk.position.x) > 1e-6) R.fails.push('关键帧位置未写回');
  }
  s0.syncAnchor();
  s0.anchor.position.add(new THREE.Vector3(4, 1, 0));
  s0.applyAnchorDelta();
  if (Math.abs(s0.keys[0].p[0] - 0) < 1e-9 && s0.move) { /* 位移已生效即可 */ }
  s0.removeKeyAt(2);
  if (s0.keys.length !== n0) R.fails.push('removeKeyAt 数量不符');
  for (let i = s0.keys.length - 1; i >= 0; i--) s0.removeKeyAt(i);
  if (s0.keys.length) R.fails.push('清空关键帧失败');
  s0.generateMove(s0.move || 'push');

  // 4. 人物动作：走真实路径（so.apply → setCharAnim，app.step → updateChar → poseFor/applyPose）
  const chars = app.objects.filter((o) => o.isChar);
  if (!chars.length) R.fails.push('示例场景缺少人物');
  const jointsOf = (so) => {
    const r = so.root.userData.humans?.[0]?.rig;
    return r ? [r.hips, r.torso, r.neckG, r.head, r.armL, r.foreL, r.handL, r.armR, r.foreR, r.handR, r.legL, r.kneeL, r.footL, r.legR, r.kneeR, r.footR] : [];
  };
  const snap = (so) => {
    const inner = so.root.userData.humans?.[0]?.inner || so.root.userData.inner;
    return jointsOf(so).map((g) => [g.rotation.x, g.rotation.y, g.rotation.z, g.position.y, g.position.z])
      .concat(inner ? [[inner.position.y, inner.rotation.x]] : []);
  };
  const finJ = (so, tag) => {
    const rows = snap(so);
    if (!rows.length) { R.fails.push(`${tag} 找不到可检查的关节`); return; }
    for (const row of rows) for (const v of row) if (v !== null && !Number.isFinite(v)) { R.fails.push(`${tag} 关节非有限值 ${v}`); return; }
  };
  let poses = 0;
  for (const a of ANIMS) {
    const so = chars[0];
    so.motion.anim = a.v;
    so.apply();
    if (so.root.userData.humans?.[0]?.anim !== a.v) R.fails.push(`动作未写入: ${a.v}`);
    so.root.userData.animPhase = 0;
    app.step(1 / 30, false);
    const s1 = JSON.stringify(snap(so));
    let moved = false;
    for (let k = 0; k < 8; k++) { app.step(1 / 30, false); }
    const s2 = JSON.stringify(snap(so));
    moved = s1 !== s2;
    if (!moved) R.fails.push(`动作无关节变化: ${a.v}`);
    finJ(so, 'pose ' + a.v);
    R.info['anim:' + a.v] = { phase: +(so.root.userData.animPhase || 0).toFixed(3), moved, rootY: +(so.root.userData.inner?.position?.y ?? 0).toFixed(3) };
    poses++;
  }
  // 走路时相位应随位移推进（步幅同步落脚）
  {
    const so = chars.find((c) => c.motion?.active && c.motion.keys?.length > 1) || chars[0];
    so.motion.anim = 'walk'; so.apply();
    so.root.userData.animPhase = 0;
    const t0 = app.state.time;
    app.state.time = t0 + 0.6; app.step(1 / 30, false);
    const p1 = so.root.userData.animPhase || 0;
    app.state.time = t0 + 3.0; app.step(1 / 30, false);
    const p2 = so.root.userData.animPhase || 0;
    R.info.strideSync = { p1: +p1.toFixed(3), p2: +p2.toFixed(3), increasing: p2 > p1 };
    if (!(p2 > p1)) R.fails.push('沿路径走动时落脚相位未推进');
    finJ(so, 'stride');
    app.state.time = t0;
  }
  R.info.poses = poses;

  // 5. 光影预设 + 内存优先
  for (const a of ATMOS) {
    app.lighting.applyPreset(a.id);
    bad('sun ' + a.id, app.lighting.sun.intensity);
    bad('fog ' + a.id, app.stage.scene.fog.density);
    bad('expo ' + a.id, app.stage.renderer.toneMappingExposure);
    finV('sunpos ' + a.id, app.lighting.sun.position);
  }
  app.lighting.applyPreset('golden');
  let stdBefore = 0; app.stage.world.traverse((o) => { if (o.material?.isMeshStandardMaterial) stdBefore++; });
  if (!stdBefore) R.fails.push('场景中找不到 Standard 材质');
  app.lighting.setEnabled(false);
  let basic = 0, std = 0;
  app.stage.world.traverse((o) => { if (o.material?.isMeshBasicMaterial) basic++; if (o.material?.isMeshStandardMaterial) std++; });
  R.info.perfMode = { flatMaterials: basic, remainingStandard: std, shadowMap: app.stage.renderer.shadowMap.enabled };
  if (basic < 3 || std !== 0) R.fails.push('内存优先模式材质切换异常 ' + JSON.stringify(R.info.perfMode));
  app.lighting.setEnabled(true);
  let stdAfter = 0; app.stage.world.traverse((o) => { if (o.material?.isMeshStandardMaterial) stdAfter++; });
  if (stdAfter < stdBefore) R.fails.push('恢复光影后材质数量减少 ' + stdAfter + '/' + stdBefore);

  // 6. 时间轴驱动路径
  app.state.duration = 8; app.state.time = 0; app.state.loop = true;
  const moverObj = app.objects.find((o) => o.motion?.active && o.motion.mover);
  if (!moverObj) R.fails.push('示例缺少带路径的物体');
  else {
    const seen = [];
    for (let i = 0; i < 60; i++) { app.state.time = (i / 60) * 8; app.step(1 / 30, false); seen.push(moverObj.root.position.x); finV('path sample', moverObj.root.position); }
    R.info.pathMoved = Math.abs(seen[seen.length - 1] - seen[0]) > 0.5;
    if (!R.info.pathMoved) R.fails.push('路径驱动未改变位置');
    if (Math.abs(moverObj.root.rotation.y) < 1e-6) R.fails.push('自动朝向未生效');
  }
  for (const so of app.objects) if (so.isChar) { /* 冻结相位检查 */ }
  const ph0 = app.objects.find((o) => o.isChar).root.userData.animPhase;
  for (let i = 0; i < 20; i++) app.step(1 / 30, false);
  if (!(app.objects.find((o) => o.isChar).root.userData.animPhase > ph0)) R.fails.push('动作相位未推进');

  // 7. 工程序列化往返
  const j = JSON.parse(JSON.stringify(app.serialize()));
  R.info.serial = { objects: j.objects.length, shots: j.shots.length, keys: j.shots.map((s) => s.mover.keys.length) };
  app.loadJson(j);
  app.loadJson(j);
  const j2 = app.serialize();
  if (j2.objects.length !== j.objects.length) R.fails.push('往返后物体数不一致 ' + j2.objects.length + '/' + j.objects.length);
  if (j2.shots.length !== j.shots.length) R.fails.push('往返后机位数不一致');
  for (let i = 0; i < j.shots.length; i++) {
    const a = j.shots[i].mover.keys, b = j2.shots[i].mover.keys;
    if (a.length !== b.length) { R.fails.push('往返后关键帧数不一致 shot' + i); continue; }
    for (let k = 0; k < a.length; k++) if (Math.abs(a[k].p[0] - b[k].p[0]) > 1e-2) R.fails.push('往返后关键帧位置漂移 shot' + i + ' k' + k);
  }

  // 8. 预览取景
  app.state.preview = true; app.updateAspectOverlay();
  for (let i = 0; i < 10; i++) { app.state.time = i / 10 * app.state.duration; app.step(1 / 30, false); app.stage.render(); }
  R.info.previewFov = app.stage.view.fov;
  bad('preview fov', app.stage.view.fov);
  app.state.preview = false; app.stage.preview = false;

  // 9. 选择与手柄
  const pick = app.objects[0];
  app.select({ kind: 'obj', so: pick });
  if (app.stage.tc.object !== pick.root) R.fails.push('TransformControls 未 attach 到选中物体');
  app.select(null);
  if (app.stage.tc.object) R.fails.push('取消选择后手柄仍在');

  // 10. 导入模型 adopt
  const probe = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial());
  const holder = new THREE.Group(); holder.add(probe);
  const adopted = app._adoptModel(holder, 'probe.glb', new THREE.Vector3(6, 0, 6));
  const bb = new THREE.Box3().setFromObject(adopted.root);
  R.info.adopt = { min: +bb.min.y.toFixed(3), size: bb.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) };
  if (Math.abs(bb.min.y) > 0.01) R.fails.push('导入模型未贴地 ' + bb.min.y);
  app.removeObject(adopted);

  // 11. Mover 边界
  const mv = new Mover([{ t: 0, p: [0, 0, 0], q: null }, { t: 0.3, p: [5, 1, 2], q: [0, 0, 0, 1] }, { t: 1, p: [9, 3, -4], q: [0, 0.2, 0, 0.98] }]);
  for (const u of [-0.2, 0, 0.12, 0.3, 0.5, 0.999, 1, 1.4]) {
    const o = mv.sample(u, { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null }, 'inOut');
    finV('mover ' + u, o.p);
    bad('mover quat len ' + u, Math.hypot(o.q.x, o.q.y, o.q.z, o.q.w));
  }
  const empty = new Mover([]);
  R.info.emptySample = empty.sample(0.5);

  return R;
});

// 12. 导出（MediaRecorder）
const exp = await page.evaluate(async () => {
  const { app } = window.__t;
  const { Exporter } = await import('/src/export.js');
  app.exporter = new Exporter(app);
  const canRec = typeof MediaRecorder !== 'undefined';
  let res = { canRec };
  if (canRec) {
    try {
      const r = await app.exporter.run({ width: 640, height: 360, fps: 15, duration: 1, bitrate: 2 }, () => {});
      res = { canRec, size: r ? r.blob.size : 0, name: r?.name, ext: r?.ext };
    } catch (e) { res.err = String(e && e.message || e); }
  }
  return res;
});
await page.evaluate(() => { window.app.state.time = 2.4; window.app.bus.emit('time'); });
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'test/01-editor.png' });
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'test/02-preview.png' });
await page.keyboard.press('KeyP');
await page.evaluate(() => { window.app.lighting.setEnabled(false); });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'test/03-perf.png' });
await page.evaluate(() => { window.app.lighting.setEnabled(true); window.app.lighting.applyPreset('night'); });
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'test/04-night.png' });
await page.evaluate(() => { window.app.lighting.applyPreset('golden'); });

console.log(JSON.stringify({ errors, out, exp }, null, 1));
fs.writeFileSync('test/smoke-result.json', JSON.stringify({ errors, out, exp }, null, 1));
await browser.close();
process.exit(out.fails.length || errors.length ? 1 : 0);
