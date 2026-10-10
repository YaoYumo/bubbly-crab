// 全部示例场景模板（13 + 8 故事场景）：逐个载入，检查物体 / 机位 / 采样 / 提示词 / 序列化 / 光影
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1560,900', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const R = { errors, scenes: [], checks: {} };
const ck = (n, v) => { R.checks[n] = v; };

await page.goto((process.env.URL || 'http://localhost:5173/') + '?fresh=1', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__scenes, { timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
await new Promise((r) => setTimeout(r, 500));

// 顶栏入口
R.checks.menu = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#top .tb')].find((b) => /示例场景/.test(b.textContent));
  if (!btn) return { found: false };
  btn.click();
  const m = btn.querySelector('.menu.scenes');
  const cards = [...(m || btn).querySelectorAll('.scard')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  const quick = [...(m || btn).querySelectorAll('.sp-quick .qbtn')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  const r = m ? m.getBoundingClientRect() : null;
  return {
    found: true, open: !!(m && m.classList.contains('on')), cards, quick, count: cards.length,
    chips: [...(m || btn).querySelectorAll('.sp-chips .chip')].map((x) => x.textContent),
    inView: !!(r && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1),
    size: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
  };
});
ck('顶栏「示例场景」弹层打开且不出屏', R.checks.menu.found && R.checks.menu.open && R.checks.menu.inView && R.checks.menu.count >= 21);
ck('弹层含空白场景 / 示例短片 / 清空 三个快捷入口', R.checks.menu.quick.length === 3 && /空白场景/.test(R.checks.menu.quick[0]) && /示例短片/.test(R.checks.menu.quick[1]) && /清空/.test(R.checks.menu.quick[2]));
ck('弹层按题材分芯片', R.checks.menu.chips.length >= 5 && R.checks.menu.chips[0] === '全部');

const DELIBERATE = new Set(['whip', 'hero', 'dutch', 'bullet', 'dollyZoom', 'handheld', 'fpv', 'snorricam', 'pushPull']);
const ids = await page.evaluate(() => window.__scenes.SCENES.map((s) => s.id));
ck('模板数量 ≥21', ids.length >= 21);

// 先空跑一次：冷启动的材质 / 阴影编译不该记到列表第一套模板头上（否则测的是「首次加载」而不是「切模板」）
await page.evaluate(() => {
  const app = window.app;
  window.__scenes.applyScene(app, 'int-empty-room');
  app.step(1 / 30);
  app.stage.render();
});
await new Promise((r) => setTimeout(r, 400));

for (const id of ids) {
  const r = await page.evaluate((sid) => {
    const app = window.app;
    const THREE = window.__t.THREE;
    const t0 = performance.now();
    window.__scenes.applyScene(app, sid);
    app.step(1 / 30);
    const ms = Math.round(performance.now() - t0);
    const badObj = app.objects.filter((o) => {
      const p = o.root.position, s = o.root.scale, e = o.root.rotation;
      return ![p.x, p.y, p.z, s.x, s.y, s.z, e.x, e.y, e.z].every(Number.isFinite);
    }).length;
    const badKeys = app.objects.reduce((a, o) => a + (o.motion?.keys || []).filter((k) => !k.p.every(Number.isFinite)).length, 0);
    // 每个机位采样 5 个时间点（含播放路径），检查有限、且速度剖面不顿
    const shots = [];
    for (const s of app.shots) {
      const out = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
      let finite = true, prev = null, maxJump = 0, total = 0;
      for (let i = 0; i <= 24; i++) {
        s.mover.sample(i / 24, out, s.easing, s.moverOpts());
        if (!Number.isFinite(out.p.x + out.p.y + out.p.z + out.q.x + out.q.w)) finite = false;
        if (prev) { const dd = out.p.distanceTo(prev); maxJump = Math.max(maxJump, dd); total += dd; }
        prev = out.p.clone();
      }
      const d = s.motionDiag(48);
      let maxSeg = 0;
      const kk = s.mover.keys;
      for (let i = 1; i < kk.length; i++) {
        maxSeg = Math.max(maxSeg, Math.hypot(kk[i].p[0] - kk[i - 1].p[0], kk[i].p[1] - kk[i - 1].p[1], kk[i].p[2] - kk[i - 1].p[2]));
      }
      shots.push({ name: s.name, keys: s.mover.count, move: s.move, focal: s.focal, dur: s.duration, finite, maxJump: +maxJump.toFixed(3), maxSeg: +maxSeg.toFixed(2), travel: +total.toFixed(2), dip: +d.keyDip.toFixed(3), min: +d.min.toFixed(3), max: +d.max.toFixed(3), target: !!s.targetId });
    }
    const totalTravel = (() => {
      const s = app.activeShot; if (!s) return 0;
      const a = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
      const b = { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null };
      s.mover.sample(0, a, s.easing, s.moverOpts()); s.mover.sample(1, b, s.easing, s.moverOpts());
      return +a.p.distanceTo(b.p).toFixed(2);
    })();
    const proj = app.serialize();
    const projKB = +(JSON.stringify(proj).length / 1024).toFixed(1);
    // 提示词与运镜数据（面板同款函数）
    const before = app.shots.length;
    return {
      id: sid, ms, objs: app.objects.length, shots: app.shots.length, badObj, badKeys,
      chars: app.objects.filter((o) => o.isChar).length,
      withMotion: app.objects.filter((o) => o.motion?.active).length,
      terrain: app.terrain.enabled, biome: app.terrain.biome,
      atmos: app.lighting.preset, duration: app.state.duration, projKB,
      totalTravel, shotBad: shots.filter((x) => !x.finite).length,
      staticShots: shots.filter((x) => x.travel < 0.05).length,
      shotsWithTarget: shots.filter((x) => x.target).length,
      dipMax: Math.max(...shots.map((x) => x.dip)), shotList: shots, before,
      report: app.sceneReport || null,
      declared: ((window.__scenes.SCENES.find((x) => x.id === sid) || {}).shots || []).filter((x) => x.t != null).length,
    };
  }, id);
  // 提示词 + 运镜数据 JSON（直接调面板用的同一模块）
  r.prompt = await page.evaluate(async () => {
    const m = await import('/src/prompts.js');
    const app = window.app;
    const p = m.buildPrompt(app);
    const j = m.motionJson(app);
    return { zh: (p.text || '').length, data: !!p.data, keys: Object.keys(j).join(','), motion: !!j.motion, curves: 'curves' in j, terrain: !!j.terrain, kf: (j.keyframes || []).length };
  });
  r.roundtrip = await page.evaluate(async () => {
    const app = window.app;
    const j = JSON.parse(JSON.stringify(app.serialize()));
    const n0 = app.objects.length, s0 = app.shots.length;
    app.loadJson(j);
    const d = app.shots[0] ? app.shots[0].moverOpts() : null;
    const h = app.terrain ? app.terrain.heightAt(6, -6) : 0;
    const h0 = j.terrain && j.terrain.h64 ? (() => { app.terrain.unpack(j.terrain.h64); return app.terrain.heightAt(6, -6); })() : h;
    return { ok: app.objects.length === n0 && app.shots.length === s0, objs: app.objects.length, shots: app.shots.length, motionKept: !!(d && d.scope), terrainKept: Math.abs(h - h0) < 0.02 };
  });
  R.scenes.push({ ...r, shotList: undefined, shots: r.shots });
  R.detail = R.detail || [];
  R.detail.push({ id, shots: (r.shotList || []).map((x) => ({ n: x.name, mv: x.move, travel: x.travel, jump: x.maxJump, seg: x.maxSeg, dip: x.dip, min: x.min, max: x.max, ok: x.finite })) });
  const wild = (x) => DELIBERATE.has(x.move) || x.max / Math.max(1e-3, x.min) > 4;   // 刻意的大幅变速（甩镜 / 曲线）
  const bad = (r.shotList || []).filter((x) => !x.finite || (!wild(x) && x.maxJump > Math.max(1.2, x.maxSeg * 1.15)));
  console.error(`${id}: objs=${r.objs} shots=${r.shots} ms=${r.ms} jumpBad=${bad.length} tgt=${r.shotsWithTarget}/${r.declared} miss=${(r.report || {}).targetMiss} prompt=${r.prompt.zh}`);
}

const S = R.scenes;
ck('户外模板 ≥18 个模型 / 星际与室内 ≥10', S.every((x) => x.objs >= (/^(int|space)-/.test(x.id) ? 10 : 18)));
ck('每套模板都有 ≥3 个机位', S.every((x) => x.shots >= 3));
ck('每套都有人物或载具做动作参考', S.every((x) => x.chars >= 1 || /space/.test(x.id)));
ck('每套都有带走位/动画的主体', S.every((x) => x.chars + x.withMotion >= 2));
ck('物体位置/缩放全部有限', S.every((x) => x.badObj === 0 && x.badKeys === 0));
ck('机位采样无 NaN', S.every((x) => x.shotBad >= 0 && (R.detail || []).every((d) => d.shots.every((y) => y.ok))));
ck('匀速镜头单步位移不超过一个关键帧段长', (R.detail || []).every((d) => d.shots.every((x) => (DELIBERATE.has(x.mv) || x.max / Math.max(1e-3, x.min) > 4) || x.jump <= Math.max(1.2, x.seg * 1.15))));
ck('每个镜头都能被插值（无 NaN；运动镜头段长 >0）', (R.detail || []).every((d) => d.shots.every((x) => x.ok && (x.travel > 0.05 ? x.seg > 0 : true))));
ck('模板声明的主体全部命中（0 缺失）', S.every((x) => (x.report || {}).missing === 0 && (x.report || {}).targetMiss === 0));
ck('声明了多少锁定镜头就生效多少', S.every((x) => x.shotsWithTarget === x.declared));
ck('多数镜头关键帧不掉速（≥60% 达标）', S.every((x) => { const dl = (R.detail.find((d) => d.id === x.id) || {}).shots || []; const ok = dl.filter((y) => y.dip <= 0.3 || DELIBERATE.has(y.mv)).length; return dl.length && ok / dl.length >= 0.6; }));
ck('每套至少一个体检全绿的匀速镜头', S.every((x) => { const dl = (R.detail.find((d) => d.id === x.id) || {}).shots || []; return dl.some((y) => y.dip <= 0.12 && y.min > 0.5); }));

ck('提示词生成 ≥600 字符', S.every((x) => x.prompt.zh >= 600));
ck('运镜数据含 motion/curves/terrain', S.every((x) => x.prompt.motion && x.prompt.curves && x.prompt.terrain));
ck('工程 JSON 往返保持物体与机位数', S.every((x) => x.roundtrip.ok));
ck('往返后地形高度一致', S.every((x) => x.roundtrip.terrainKept));
ck('每套都有锁定主体的镜头', S.filter((x) => x.declared > 0).every((x) => x.shotsWithTarget >= 1));
ck('全局镜头至少 6 套锁定主体', S.filter((x) => x.declared > 0).length >= 6);
ck('光影预设都生效', S.every((x) => typeof x.atmos === 'string' && x.atmos.length > 1));
ck('构建耗时可接受（<3s/套）', S.every((x) => x.ms < 3000));
ck('无 console/page 报错', errors.length === 0);

fs.writeFileSync('test/scenes-result.json', JSON.stringify(R, null, 1));
await browser.close();
const fails = Object.entries(R.checks).filter(([, v]) => v === false);
console.log(JSON.stringify({ scenes: S.length, failCount: fails.length, failed: fails.map((f) => f[0]), errors: errors.slice(0, 6) }, null, 1));
process.exit(fails.length || errors.length ? 1 : 0);
