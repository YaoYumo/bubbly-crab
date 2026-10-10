// 运镜流畅度 + 关键帧曲线：验证「到关键帧不停顿」与曲线编辑（实时页面内）
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1600,940', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 940, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const R = { errors, checks: {} };
const ck = (n, v) => { R.checks[n] = v; };

await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.app.shots.length > 0, { timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 800));

// ---------- 1) 速度剖面：默认设置下关键帧处不应减速 ----------
R.checks.profile = await page.evaluate(() => {
  const app = window.app;
  const out = [];
  for (const s of app.shots) {
    const d = s.motionDiag(64);
    out.push({
      name: s.name, keys: s.mover.count, scope: s.motionScope, arc: s.arcSpeed,
      minR: +d.min.toFixed(3), maxR: +d.max.toFixed(3),
      keyR: +d.atKey.toFixed(3), dip: +d.keyDip.toFixed(3),
      nan: d.samples.some((v) => !Number.isFinite(v)),
    });
  }
  return out;
});
{
  const p = R.checks.profile;
  ck('shots>0', p.length > 0);
  ck('无 NaN', p.every((x) => !x.nan));

  ck('过关键帧无停顿 (keyDip≤0.25)', p.every((x) => x.keys < 3 || x.dip <= 0.25));
  ck('全程不出现真正停止 (min>0.05)', p.every((x) => x.minR > 0.05));
  ck('默认全局缓动', p.every((x) => x.scope === 'global'));
  ck('默认弧长匀速', p.every((x) => x.arc !== false));
}

// ---------- 2) 采样必须精确落在关键帧上 ----------
R.checks.keyHit = await page.evaluate(() => {
  const app = window.app;
  const THREE = window.__t.THREE;
  const res = [];
  for (const s of app.shots) {
    let posErr = 0, angErr = 0;
    const out = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
    for (const k of s.mover.keys) {
      s.mover.sample(k.t, out, s.easing, s.moverOpts());
      posErr = Math.max(posErr, out.p.distanceTo(new THREE.Vector3(...k.p)));
    }
    res.push({ name: s.name, posErr: +posErr.toFixed(5), keys: s.mover.count });
  }
  return res;
});
ck('关键帧位置误差 <1e-3', R.checks.keyHit.every((x) => x.posErr < 1e-3));

// ---------- 3) 逐段缓动 = 旧行为，应在关键帧处明显减速（证明开关有效） ----------
R.checks.perSeg = await page.evaluate(() => {
  const app = window.app;
  const s = app.shots[0];
  const beforeScope = s.motionScope, beforeEase = s.easing;
  s.easing = 'inOut'; s.setMotionOpt('ease', 'inOut');
  s.setMotionOpt('scope', 'segment');
  const dSeg = s.motionDiag(64);
  s.setMotionOpt('scope', 'global');
  const dGlob = s.motionDiag(64);
  s.setMotionOpt('scope', beforeScope); s.easing = beforeEase; s.setMotionOpt('ease', beforeEase);
  return {
    segKeyR: +dSeg.atKey.toFixed(3), globKeyR: +dGlob.atKey.toFixed(3),
    segDip: +dSeg.keyDip.toFixed(3), globDip: +dGlob.keyDip.toFixed(3),
  };
});
ck('逐段缓动确实停顿（掉速 >60%）', R.checks.perSeg.segDip > 0.6);
ck('全局缓动不停顿（掉速 ≤12%）', R.checks.perSeg.globDip <= 0.12);

// ---------- 3b) 按弧长重排时间 → 真正匀速 ----------
R.checks.retime = await page.evaluate(() => {
  const app = window.app;
  const out = [];
  for (const s of app.shots) {
    const d0 = s.motionDiag(64);
    const r = s.retimeKeysByArc();
    const d1 = s.motionDiag(64);
    out.push({ name: s.name, ok: !!r, before: [ +d0.min.toFixed(3), +d0.max.toFixed(3) ], after: [ +d1.min.toFixed(3), +d1.max.toFixed(3) ], keyR: +d1.atKey.toFixed(3), dipBefore: +d0.keyDip.toFixed(3), dip: +d1.keyDip.toFixed(3) });
  }
  return out;
});
ck('重排后匀速（0.88–1.12）', R.checks.retime.every((x) => x.after[0] > 0.88 && x.after[1] < 1.12));
ck('重排后关键帧仍对齐（体检≥0.9）', R.checks.retime.every((x) => x.keyR >= 0.9));

// ---------- 4) 曲线：进度通道重映射时间 ----------
R.checks.curve = await page.evaluate(() => {
  const app = window.app;
  const s = app.shots[0];
  const THREE = window.__t.THREE;
  const o0 = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
  const o1 = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
  const opts0 = s.moverOpts();
  s.mover.sample(0.25, o0, s.easing, opts0);
  const linear = o0.p.clone();
  // 前半段加速的曲线：同样 0.25 时间点应该更靠前（位移更大）
  s.setCurve('prog', [
    { x: 0, y: 0 }, { x: 0.25, y: 0.45, mode: 'auto' }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 },
  ]);
  s.mover.sample(0.25, o1, s.easing, s.moverOpts());
  const advanced = linear.distanceTo(o1.p) > 0.01;
  const mono = (() => {
    let prev = -1, ok = true;
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const p = s._progU ? s._progU(u) : null;
      if (p != null) { if (p < prev - 1e-6) ok = false; prev = p; }
    }
    return ok;
  })();
  const json = s.toJSON();
  const pts = json.curves?.prog?.length || 0;
  // 抖动通道
  s.setCurve('shake', [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }]);
  const hasShake = !!s.curves.shake;
  const presetOk = (() => { s.applyCurvePreset('whip'); return s.curves.prog?.length >= 2; })();
  s.setCurve('prog', null);
  const cleared = s.curves.prog === null;
  return { advanced, mono, pts, hasShake, presetOk, cleared };
});
ck('曲线前推改变采样位置', R.checks.curve.advanced === true);
ck('进度映射单调', R.checks.curve.mono === true);
ck('曲线进 JSON', R.checks.curve.pts === 4);
ck('抖动通道曲线', R.checks.curve.hasShake === true);
ck('曲线预设', R.checks.curve.presetOk === true);
ck('可清空回匀速', R.checks.curve.cleared === true);

// ---------- 5) 曲线抽屉 UI ----------
R.checks.ui = await page.evaluate(async () => {
  const app = window.app;
  const cv = app.curve;
  const out = { exists: !!cv, open0: !!cv?.isOpen };
  if (!cv) return out;
  cv.open();
  out.open1 = cv.isOpen;
  out.canvas = !!document.querySelector('.curve .cv-canvas');
  out.h = cv.root.classList.contains('on');
  const bar = document.querySelector('.curve .cv-bar');
  out.chips = bar ? bar.querySelectorAll('.chip, .fbtn').length : 0;
  out.title = document.querySelector('.cv-title')?.textContent || '';
  const cvs = document.querySelector('.curve .cv-canvas');
  out.size = cvs ? [cvs.width, cvs.height] : null;
  // 时间轴按钮
  const btn = [...document.querySelectorAll('.tl-r button')].find((b) => /曲线/.test(b.textContent));
  out.tlBtn = !!btn;
  btn?.click();
  out.openAfterBtn = cv.isOpen;
  out.inBottom = document.getElementById('bottom')?.contains(cv.root);
  out.belowTimeline = (() => {
    const tl = document.querySelector('#bottom .tl');
    return !!tl && !!cv.root && tl.compareDocumentPosition(cv.root) === 0 ? true : !!cv.root;
  })();
  // 运镜 tab 的流畅度区块
  const tabs = [...document.querySelectorAll('.itab')];
  tabs[1]?.click();
  const secs = [...document.querySelectorAll('#right .sec b')].map((b) => b.textContent);
  out.qualitySection = secs.some((t) => /流畅度/.test(t));
  const btns = [...document.querySelectorAll('#right button')].map((b) => b.textContent);
  out.diagBtn = btns.some((t) => /平滑体检/.test(t));
  out.syncBtn = btns.some((t) => /同步到全部/.test(t));
  const diag = [...document.querySelectorAll('#right button')].find((b) => /平滑体检/.test(b.textContent));
  diag?.click();
  out.toast = document.querySelector('.toast, #toast')?.textContent?.slice(0, 80) || '';
  cv.close();
  out.open2 = cv.isOpen;
  return out;
});
ck('曲线抽屉存在', R.checks.ui.exists && R.checks.ui.canvas && R.checks.ui.size?.[0] > 100);
ck('V 键外的按钮可开合', R.checks.ui.tlBtn === true && R.checks.ui.openAfterBtn === false);
ck('抽屉在时间轴容器内', R.checks.ui.inBottom === true);
ck('流畅度区块 + 体检按钮', R.checks.ui.qualitySection === true && R.checks.ui.diagBtn === true);
ck('体检提示含速度区间', /速度|min/.test(R.checks.ui.toast || '') || (R.checks.ui.toast || '').length > 4);

// ---------- 6) 物体走位曲线 ----------
R.checks.objCurve = await page.evaluate(() => {
  const app = window.app;
  const so = app.objects.find((o) => o.motion?.active && o.motion.keys?.length > 2);
  if (!so) return { skip: true };
  const o = { p: new (window.__t.THREE.Vector3)(), q: new (window.__t.THREE.Quaternion)(), f: null };
  const before = so.motion.mover ? so.motion.mover.curve ? true : false : false;
  so.motion.mover.sample(0.5, o, so.motion.easing, { ease: 'linear', scope: 'global', arc: true, rot: 'slerp' });
  const lin = o.p.clone();
  app.setMotion(so, { curve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.85 }, { x: 1, y: 1 }] });
  const o2 = { p: new (window.__t.THREE.Vector3)(), q: new (window.__t.THREE.Quaternion)(), f: null };
  so.motion.mover.sample(0.5, o2, so.motion.easing, { ease: 'linear', scope: 'global', arc: true, rot: 'slerp', progCurve: so.motion.curvePts });
  const moved = lin.distanceTo(o2.p) > 0.01;
  const d = { hasMover: !!so.motion.mover, spline: before, moved, pts: so.motion.curvePts.length, finite: Number.isFinite(o2.p.x + o2.p.y + o2.p.z) };
  app.setMotion(so, { curve: null });
  d.cleared = !so.motion.curvePts || so.motion.curvePts.length === 0;
  return d;
});
ck('物体走位曲线生效', R.checks.objCurve.skip || (R.checks.objCurve.moved && R.checks.objCurve.finite && R.checks.objCurve.cleared));

// ---------- 7) 同步到全部机位 ----------
R.checks.sync = await page.evaluate(() => {
  const app = window.app;
  const s = app.shots[0];
  s.setMotionOpt('tension', 0.87);
  s.setMotionOpt('rot', 'slerp');
  s.applyCurvePreset('easeOut');
  app.syncMotionToAll(s, false);
  const bad = app.shots.filter((x) => Math.abs(x.tension - 0.87) > 1e-6 || x.rotMode !== 'slerp' || !x.curves.prog);
  // 复原
  for (const x of app.shots) { x.setMotionOpt('tension', 0.5); x.setMotionOpt('rot', 'spline'); x.setCurve('prog', null); x.setMotionOpt('scope', 'global'); x.setMotionOpt('arc', true); x.easing = 'linear'; }
  return { shots: app.shots.length, bad: bad.length };
});
ck('同步到全部机位', R.checks.sync.bad === 0 && R.checks.sync.shots >= 2);

// ---------- 8) 播放中的连续位移（无跳变）----------
R.checks.play = await page.evaluate(() => {
  const app = window.app;
  const s = app.shots[1] || app.shots[0];
  app.setActiveShot(s);
  const THREE = window.__t.THREE;
  const v = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
  const opts = s.moverOpts();
  let maxJump = 0;
  let prev = null;
  const N = 120;
  for (let i = 0; i <= N; i++) {
    s.mover.sample(i / N, v, s.easing, opts);
    if (prev) maxJump = Math.max(maxJump, v.p.distanceTo(prev));
    prev = v.p.clone();
  }
  const d = s.motionDiag(N);
  return { maxJump: +maxJump.toFixed(4), minRatio: +d.min.toFixed(3), maxRatio: +d.max.toFixed(3), keyR: +d.atKey.toFixed(3) };
});
ck('相邻采样无跳变', R.checks.play.maxJump < 2 && R.checks.play.minRatio > 0.15);

ck('无报错', R.errors.length === 0);
fs.writeFileSync('test/motion-result.json', JSON.stringify(R, null, 1));
await browser.close();
const fails = Object.entries(R.checks).filter(([, v]) => v === false);
console.log(JSON.stringify({ checks: R.checks, errors: R.errors.slice(0, 6), failCount: fails.length }, null, 1));
process.exit(fails.length || R.errors.length ? 1 : 0);
