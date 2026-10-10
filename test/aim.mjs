// 视觉体检（可重复的观感回归）：主体居中 / 遮挡 / 穿地 / 高频颠动 / 物体浸水或埋地 / 画面闪烁
// 用法：node test/aim.mjs   →  test/aim-result.json
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,760', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  if (m.type() === 'warning' && /被忽略/.test(m.text())) errors.push('IGNORED-PARAM: ' + m.text());   // 模板写了运镜不认的参数 → 静默失效，必须当成缺陷
});

await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 180000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 400));

const TH = { resid: 0.16, yJit: 14, off: 0.34, offLoose: 1.05, sink: 0.2 };   // 阈值（度/帧、毫米、NDC、米）
// whip（甩镜）与 fpv（穿越机）的剧烈摆动是设计本身：只查单帧尖峰（>3°/帧），不查高频残差
const jitShot = (x) => ((x.move === 'whip' || x.move === 'fpv')
  ? x.rotJitMax > 3 || x.yJitter > TH.yJit * 2
  : x.resid > TH.resid || x.yJitter > TH.yJit);
let ids = await page.evaluate(() => window.__scenes.SCENES.map((s) => s.id));
if (process.env.ONLY) ids = ids.filter((i) => process.env.ONLY.split(',').includes(i));
const R = { errors, th: TH, scenes: [] };

for (const id of ids) {
  const r = await page.evaluate(async (sid) => {
    const app = window.app;
    const THREE = window.__t.THREE;
    window.__scenes.applyScene(app, sid);
    app.state.playing = false;
    app.state.preview = true;
    await new Promise((res) => setTimeout(res, 150));

    const cam = app.stage.view;
    const shots = [];
    for (const s of app.shots) {
      app.setActiveShot(s);
      // 在镜头的 3 个位置各取 12 帧，严格按 1/30 s 步进（抖动只有按真实帧间隔才量得准）
      const runs = [];
      for (const u0 of [0.18, 0.48, 0.78]) {
        const tStart = s.duration * u0;
        for (let i = 0; i < 6; i++) { app.state.time = Math.max(0, tStart - (6 - i) / 30); app.step(1 / 30); }   // 阻尼先收敛
        const r = [];
        for (let i = 0; i < 12; i++) {
          app.state.time = tStart + i / 30;
          app.step(1 / 30);
          r.push({ p: cam.position.clone(), q: cam.quaternion.clone() });
        }
        runs.push(r);
      }
      const seq = runs[runs.length - 1];
      let jSum = 0, jMax = 0, raw = 0, n1 = 0, n2 = 0, residMax = 0, residAvg = 0, nR = 0, ySum = 0, nY = 0;
      for (const r of runs) {
        const ang = (i) => 2 * Math.acos(Math.min(1, Math.abs(r[i].q.dot(r[i - 1].q)))) * 180 / Math.PI;
        const vel = [];
        for (let i = 1; i < r.length; i++) { const v = ang(i); vel.push(v); raw += v; n1++; }
        for (let i = 2; i < r.length; i++) {
          const d = Math.abs(ang(i) - ang(i - 1));
          jSum += d; n2++; if (d > jMax) jMax = d;
          ySum += Math.abs(r[i].p.y - 2 * r[i - 1].p.y + r[i - 2].p.y); nY++;
        }
        for (let i = 1; i < vel.length - 1; i++) {
          const m = (vel[i - 1] + vel[i] + vel[i + 1]) / 3;      // 角速度的高频残差 = 「颠」的真实量
          const d = Math.abs(vel[i] - m);
          residAvg += d; nR++; if (d > residMax) residMax = d;
        }
      }
      const rotJit = jSum / Math.max(1, n2);
      const yJit = 1000 * ySum / Math.max(1, nY);
      const meanA = raw / Math.max(1, n1);
      residAvg /= Math.max(1, nR);
      const last = seq[seq.length - 1];
      // 主体 / 遮挡（用真实预览相机位姿）
      const tgt = s.targetId ? app.byId(s.targetId) : null;
      let aim = null;
      if (tgt) {
        cam.position.copy(last.p); cam.quaternion.copy(last.q); cam.updateMatrixWorld(true);
        const anchor = s.targetAnchor(new THREE.Vector3());
        const ndc = anchor.clone().project(cam);
        const dir = anchor.clone().sub(last.p);
        const dist = dir.length();
        const hitsAll = [];
        const ignorable = (o) => {
          let up = o;
          while (up) {
            const ud = up.userData || {};
            if (ud.pickIgnore || ud.ground || ud.keyRef || up.name === 'shotRig' || up.name === 'terrain-water') return true;
            up = up.parent;
          }
          return false;
        };
        const pool = app.objects.map((o) => o.root).filter((x) => x && x !== tgt.root && x.visible);
        if (app.terrain && app.terrain.enabled && app.terrain.mesh) pool.push(app.terrain.mesh);
        app.stage.raycaster.set(last.p.clone(), dir.clone().normalize());
        app.stage.raycaster.far = Math.max(0.5, dist - 1.2);
        app.stage.raycaster.near = 0.35;
        const raw = app.stage.raycaster.intersectObjects(pool, true);
        const hits = raw.filter((h) => {
          if (!h.object.visible || ignorable(h.object)) return false;
          let up = h.object;
          while (up) { if (up === tgt.root) return false; up = up.parent; }
          const yLine = last.p.y + (anchor.y - last.p.y) * (h.distance / Math.max(0.01, dist));
          return h.point.y > yLine + 0.45;          // 只有「探到视线上方的东西」才算挡镜头，贴地擦碰不算
        });
        aim = {
          dx: +Math.abs(ndc.x).toFixed(3), dy: +Math.abs(ndc.y).toFixed(3), behind: ndc.z > 1,
          occl: hits.length ? (hits[0].object.name || hits[0].object.parent?.name || 'mesh') : null,
          occlD: hits.length ? +hits[0].distance.toFixed(2) : null,
          occlH: hits.length ? +(hits[0].object.material?.name || '').slice(0, 0) : null,
          dist: +dist.toFixed(2),
        };
      }
      const gy = app.terrain && app.terrain.enabled ? app.terrain.heightAt(last.p.x, last.p.z) : 0;
      const wy = (app.terrain && app.terrain.enabled && app.terrain.state.water) ? app.terrain.state.waterY : null;
      shots.push({
        name: s.name, move: s.move, focal: s.focal, hh: +(+s.handheld).toFixed(3),
        hasTarget: !!tgt, target: tgt ? tgt.name : null, lockFramed: s.aim === 'target' || s.move === 'follow' || s.move === 'lead',
        deg: +meanA.toFixed(3), resid: +residMax.toFixed(4), residAvg: +residAvg.toFixed(4),
        rotJit: +(jSum / Math.max(1, seq.length - 2)).toFixed(4), rotJitMax: +jMax.toFixed(3),
        yJitter: +yJit.toFixed(2),
        pos: [last.p.x, last.p.y, last.p.z].map((x) => +x.toFixed(1)), gy: +gy.toFixed(1),
        belowGround: +(gy - last.p.y).toFixed(2), underWater: wy != null ? +(wy - last.p.y).toFixed(2) : -99, aim,
      });
    }
    // 物体：悬空 / 埋地 / 浸在积水里
    const tr = app.terrain;
    const waterY = tr ? tr.state.waterY : 0;
    const waterOn = tr && tr.enabled && tr.state.water;
    const bad = [];
    // 「贴地」看的是物件包围盒底面 vs 它脚下那一块地面的高差范围（坡地上不会把斜放的亭子误判成悬空）
    const SPAN = ['archbridge', 'corridor', 'citywall', 'road', 'walk', 'stonepath', 'wall', 'stairs', 'railing', 'fence', 'trench'];
    for (const o of app.objects) {
      const p = o.root.position;
      if (!Number.isFinite(p.x + p.y + p.z)) { bad.push({ n: o.name, why: 'NaN' }); continue; }
      const it = o.item || {};
      const gy = tr && tr.enabled ? tr.heightAt(p.x, p.z) : 0;      // 泡水判断用：原点处的地面高度
      const fly = o.followTerrain === false || it.cat === 'fx' || it.type === 'clouds' || it.type === 'stars';
      if (!fly && tr && tr.enabled) {
        o.root.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(o.root);
        const wide = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), tall = bb.max.y - bb.min.y;
        if (!bb.isEmpty() && wide <= 45 && !SPAN.includes(it.type)) {
          const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
          let lo = Infinity, hi = -Infinity;
          for (const sx of [bb.min.x, bb.max.x]) for (const sz of [bb.min.z, bb.max.z]) { const g = tr.heightAt(sx, sz); lo = Math.min(lo, g); hi = Math.max(hi, g); }
          const d = bb.min.y - tr.heightAt(cx, cz);                     // 底面 vs 自己脚下正下方的地面
          if (d > 1.6 || bb.min.y > hi + 2.4) bad.push({ n: o.name, why: `悬空 ${Math.max(d, bb.min.y - hi).toFixed(2)}m` });
          // 埋地：只在「脚下这一片比较平」时判，坡地上模型底部探进土里是正常的（树根 / 台基）；水塘 / 石板这类本就该嵌进地面
          else if (!o.decal && tall > 1.2 && hi - lo < 2 && d < -2.2) bad.push({ n: o.name, why: `埋地 ${(-d).toFixed(2)}m` });
        }
      }
      // 走位路径整条扫一遍：角色不许泡在积水里
      if (waterOn && o.isChar && o.motion?.active && o.motion.mover && o.motion.mover.count > 1) {
        let worst = null;
        for (let i = 0; i <= 16; i++) {
          const s = o.motion.mover.sample(i / 16, { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null }, 'linear',
            { ease: o.motion.easing || 'linear', scope: o.motion.scope || 'global', arc: o.motion.arc !== false, progCurve: o.motion.curvePts || null });
          if (!s || !Number.isFinite(s.p.x)) continue;
          const g2 = tr.heightAt(s.p.x, s.p.z);
          const sub = waterY - Math.max(g2, s.p.y);
          if (sub > 0.12 && (!worst || sub > worst.sub)) worst = { sub: +sub.toFixed(2), at: [ +s.p.x.toFixed(1), +s.p.z.toFixed(1) ] };
        }
        if (worst) bad.push({ n: o.name, why: `走位路线浸水 ${worst.sub}m @ ${JSON.stringify(worst.at)}` });
      } else if (waterOn && o.followTerrain !== false && gy < waterY - 0.35 && p.y < waterY - 0.15 && !/水塘|瀑布|喷泉|芦苇|石拱桥|码头|木栈道|太湖石|乱石/.test(o.name)) {
        bad.push({ n: o.name, why: `泡在水里（地 ${gy.toFixed(2)} / 水位 ${waterY.toFixed(2)}）` });
      }
    }
    // 闪烁：同一时间点渲染两帧（中间推一帧），看画面是否自己变
    // 钉住相机：这样「同状态两次渲染之间的差异」只剩共面/阴影重采样这类真的不该变的东西
    const pin = () => {
      const c = app.stage.view;
      const st = { p: c.position.clone(), q: c.quaternion.clone(), f: c.fov, u: c.up.clone() };
      return () => { c.position.copy(st.p); c.quaternion.copy(st.q); c.fov = st.f; c.up.copy(st.u); c.updateProjectionMatrix(); };
    };
    const snap = () => {
      const restore = pin();
      app.stage.render();
      app.step(1 / 30);
      restore();
      app.stage.render();
      const c = document.createElement('canvas');
      c.width = 400; c.height = 225;
      const g = c.getContext('2d');
      g.drawImage(app.stage.renderer.domElement, 0, 0, 400, 225);
      return g.getImageData(0, 0, 400, 225).data;
    };
    const lit = () => {
      const a = snap(), b = snap();
      let diff = 0, lum = 0, mx = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d > 6) diff++;
        mx = Math.max(mx, d);
        lum += a[i] + a[i + 1] + a[i + 2];
      }
      return { pct: +(100 * diff / (a.length / 4)).toFixed(2), maxCh: mx, lum: +(lum / (a.length / 4)).toFixed(1) };
    };
    const mid = app.shots[0] ? app.shots[0].duration * 0.4 : 1;
    app.setActiveShot(app.shots[0]);
    app.state.time = mid;
    const flick = lit();
    const wasShadow = app.lighting.sun.castShadow;
    app.lighting.sun.castShadow = false; app.lighting.update();
    const flickNoShadow = lit();
    app.lighting.sun.castShadow = wasShadow; app.lighting.update();
    const wasTerrain = tr ? tr.enabled : false;
    if (tr) tr.setEnabled(false);
    const flickNoTerrain = lit();
    if (tr) tr.setEnabled(wasTerrain);
    // 结构闪烁：把角色与点云特效都藏掉，只剩「模型 / 地面 / 地形 / 水面 / 阴影」这些不该自己变的东西
    const hidden = [];
    for (const o of app.objects) {
      const isFx = o.item && (o.item.cat === 'fx' || o.item.type === 'stars' || o.item.type === 'clouds');
      if ((o.isChar || isFx) && o.root.visible) { o.root.visible = false; hidden.push(o); }
    }
    const flickStruct = lit();
    for (const o of hidden) o.root.visible = true;
    app.state.preview = false;
    return { id: sid, objs: app.objects.length, shots, bad, flick, flickNoShadow, flickNoTerrain, flickStruct, atmos: app.lighting.preset };
  }, id);
  r.residMax = +Math.max(...r.shots.map((x) => x.resid || 0), 0).toFixed(4);
  r.aimBad = r.shots.filter((x) => x.hasTarget && (Math.max(x.aim.dx, x.aim.dy) > (x.lockFramed ? TH.off : TH.offLoose) || x.aim.behind)).length;
  r.occBad = r.shots.filter((x) => x.hasTarget && x.aim.occl).length;
  // whip（甩镜）与 fpv（穿越机）本来就是猛烈的：甩镜只看角度毛刺，fpv 不看高度二阶差

  r.shakeBad = r.shots.filter(jitShot).length;
  r.groundBad = r.shots.filter((x) => x.belowGround > TH.sink).length;
  r.waterBad = r.shots.filter((x) => x.underWater > 0 && x.move !== 'fpv').length;
  R.scenes.push(r);
  console.error(`${r.id}: 偏构图=${r.aimBad} 遮挡=${r.occBad} 颠=${r.shakeBad} 穿地=${r.groundBad} 物体=${r.bad.length} 结构闪=${r.flickStruct.pct}% 全量闪=${r.flick.pct}%（无阴影 ${r.flickNoShadow.pct}% / 无地形 ${r.flickNoTerrain.pct}%）`);
  for (const x of r.shots.filter((y) => y.hasTarget && (Math.max(y.aim.dx, y.aim.dy) > (y.lockFramed ? TH.off : TH.offLoose) || y.aim.behind || y.aim.occl))) console.error('   ↳ 镜头', x.name, JSON.stringify(x.aim));
  for (const x of r.shots.filter((y) => y.belowGround > TH.sink)) console.error('   ↳ 穿地', x.name, 'pos', JSON.stringify(x.pos), 'gy', x.gy);
  for (const x of r.shots.filter((y) => y.underWater > 0)) console.error('   ↳ 相机在水下', x.name, 'pos', JSON.stringify(x.pos), '水深', x.underWater);
  for (const x of r.shots.filter(jitShot)) console.error('   ↳ 颠', x.name, 'jit', x.rotJit, 'max', x.rotJitMax, 'yJit(mm)', x.yJitter, 'resid', x.resid, 'hh', x.hh);
    for (const b of r.bad.slice(0, 6)) console.error('   ↳ 物体', b.n, b.why);
}
fs.writeFileSync('test/aim-result.json', JSON.stringify(R, null, 1));
await browser.close();
const sum = (k) => R.scenes.reduce((a, s) => a + s[k], 0);
const sumN = (k) => R.scenes.reduce((a, s) => a + s[k].length, 0);
const out = {
  scenes: R.scenes.length, aimBad: sum('aimBad'), occBad: sum('occBad'), shakeBad: sum('shakeBad'),
  groundBad: sum('groundBad'), waterBad: sum('waterBad'), objBad: sumN('bad'),
  flickMax: Math.max(...R.scenes.map((s) => s.flick.pct)),
  flickStructMax: Math.max(...R.scenes.map((s) => s.flickStruct.pct)),
  flickStructWorst: R.scenes.map((s) => [s.id, s.flickStruct.pct]).sort((a, b) => b[1] - a[1]).slice(0, 4),
  flickMaxCh: Math.max(...R.scenes.map((s) => s.flick.maxCh)),
  flickLumMin: Math.min(...R.scenes.map((s) => s.flick.lum)),
  flickNoShadowMax: Math.max(...R.scenes.map((s) => s.flickNoShadow.pct)),
  flickNoTerrainMax: Math.max(...R.scenes.map((s) => s.flickNoTerrain.pct)),
  errors: errors.slice(0, 5),
};
console.log(JSON.stringify(out));
const fail = [];
if (out.flickLumMin < 2) fail.push('读回的画面是黑的（渲染/回读失效，测试结果不可信）');
else if (out.flickStructMax > 0.8) fail.push(`结构自闪烁 ${out.flickStructMax}% 像素 > 0.8%（共面/阴影偏移问题）: ${JSON.stringify(out.flickStructWorst)}`);
if (out.errors.length) fail.push('控制台报错');
if (out.aimBad) fail.push(`${out.aimBad} 个机位主体不在中央`);
if (out.occBad) fail.push(`${out.occBad} 个机位被遮挡`);
if (out.groundBad) fail.push(`${out.groundBad} 个机位穿进地面/地形`);
if (out.waterBad) fail.push(`${out.waterBad} 个机位在水下`);
if (out.objBad) fail.push(`${out.objBad} 个物体悬空/埋地/泡水`);
if (out.shakeBad) fail.push(`${out.shakeBad} 个镜头高频颠动超标`);
if (fail.length) { console.error('FAIL: ' + fail.join(' / ')); process.exit(1); }
process.exit(0);
