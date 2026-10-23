// 精度与外观完整度：三档精度 / 程序化贴图 / 环境反射 / 全库构建健康度
// 运行：node test/detail.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5174/';
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 900000,          // 三档 + 全库构建 + 截图在一个 evaluate 里，默认 180s 看门狗不够
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 850, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|DevTools/.test(t)) errors.push('console: ' + t.split('\n')[0]); if (/不认识的参数|未识别库项|env map 生成失败/.test(t)) errors.push('WARN: ' + t.split('\n')[0].slice(0, 160)); });
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t.buildAsset, { timeout: 180000 });

const R = await page.evaluate(async () => {
  const T = window.__t, app = T.app, THREE = T.THREE;
  const out = { levels: Object.keys(T.LEVELS), detail: T.detailLevel(), scene: null, tiers: {}, stats: {}, env: {}, bad: [] };
  const ids = T.SCENES.map((s) => s.id);
  const pick = ids.includes('cn-courtyard') ? 'cn-courtyard' : ids[0];
  out.scene = pick;
  T.applyScene(app, pick);
  for (let i = 0; i < 4; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }

  const sceneStats = () => {
    const s = app.detailStats();
    const w = app.stage.world;
    let tagged = 0, mapped = 0, meshes = 0, matCount = 0;
    const kinds = new Set(), texObjs = new Set();
    w.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !m.isMeshStandardMaterial) continue;
        matCount++;
        if (!m.userData?.detail) continue;
        tagged++;
        if (m.normalMap) { mapped++; kinds.add(m.userData.detail); texObjs.add(m.normalMap); }
      }
    });
    return { ...s, meshes, matCount, tagged, mapped, kinds: [...kinds].sort(), distinctTextures: texObjs.size };
  };

  // ① 三档：段数/倒角/贴图应当单调变多，且 lite 不挂贴图
  for (const lv of ['lite', 'std', 'fine']) {
    const ms = app.setDetail(lv, { silent: true });
    for (let i = 0; i < 3; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
    app.stage.render();
    const info = app.stage.renderer.info;
    out.tiers[lv] = { ...sceneStats(), rebuildMs: ms, drawCalls: info.render.calls, gpuTri: info.render.triangles, texMem: (info.memory?.textures || 0) };
    if (!(Number.isFinite(out.tiers[lv].tri) && out.tiers[lv].tri > 0)) out.bad.push('tri 异常 ' + lv);
  }

  // ② 环境反射：scene.environment + 强度可调
  out.env = {
    has: !!app.stage.scene.environment, rt: !!app.stage.envRT,
    i0: app.stage.scene.environmentIntensity,
  };
  app.setEnv(0); const zero = app.stage.scene.environmentIntensity;
  app.setEnv(0.8); const back = app.stage.scene.environmentIntensity;
  out.env.zero = zero; out.env.back = back;

  // ③ 贴图缓存要有界：来回切 4 次档位后，缓存里只留当前档位的种类
  for (const lv of ['lite', 'std', 'fine', 'std']) app.setDetail(lv, { silent: true });
  out.cache = T.textureStats();
  out.cacheKindsMax = 15;

  // ④ 全库 139 项在 fine 档下都能建、无 NaN、有倒角/贴图入口
  app.setDetail('fine', { silent: true });
  let built = 0, nan = 0, tri = 0, mappedAssets = 0;
  const ALL = [];
  for (const g of T.LIB) { if (g && g.items) for (const it of g.items) ALL.push(it); else ALL.push(g); }
  for (const item of ALL) {
    try {
      const root = T.buildAsset(item, T.defaultsFor(item));
      built++;
      let local = 0, hasMap = false;
      root.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const p = o.geometry?.attributes?.position;
        if (p) for (let i = 0; i < p.count; i++) { if (!Number.isFinite(p.getX(i)) || !Number.isFinite(p.getY(i)) || !Number.isFinite(p.getZ(i))) { nan++; break; } }
        local += o.geometry?.index ? o.geometry.index.count / 3 : (p ? p.count / 3 : 0);
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m?.normalMap) hasMap = true;
      });
      tri += local;
      if (hasMap) mappedAssets++;
      root.traverse?.((o) => o.geometry?.dispose?.());
    } catch (e) { out.bad.push(item.key + ': ' + e.message.split('\n')[0]); }
  }
  out.allAssets = { total: ALL.length, built, nan, tri: Math.round(tri), mappedAssets };

  // ⑤ 贴图覆盖：std 档下带 kind 的材质应当基本都吃到贴图
  app.setDetail('std', { silent: true });
  for (let i = 0; i < 2; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
  out.cover = sceneStats();

  // ⑥ 人物完整度：手指 / 五官 / 鞋 / 领口在单体上要有，人群按档位收
  const char = app.objects.find((o) => o.root?.userData?.char);
  if (char) {
    let m = 0; char.root.traverse((o) => { if (o.isMesh) m++; });
    out.charMeshes = m;
  }
  const crowd = app.objects.find((o) => o.root?.userData?.crowd || /人群|crowd/i.test(o.name || ''));
  out.crowd = crowd ? (() => { let m = 0; crowd.root.traverse((o) => { if (o.isMesh) m++; }); return { name: crowd.name, meshes: m }; })() : null;
  app.setDetail('lite', { silent: true });
  const charLite = (() => { let m = 0; if (char) char.root.traverse((o) => { if (o.isMesh) m++; }); return m; })();
  out.charLiteMeshes = charLite;
  app.setDetail('std', { silent: true });

  // ⑥b 构件完整度：同一堵墙，std 下应多出「洞口内壁 + 窗台 + 玻璃 + 勒脚」
  const wallItem = T.LIB.flatMap((g) => g.items || []).find((it) => /直墙（带门窗洞）/.test(it.name));
  out.wall = { key: wallItem?.key };
  if (wallItem) {
    const wp = { length: 8, height: 3, thick: 0.24, wins: 2, door: true, color: '#d8d2c6', top: true };
    for (const lv of ['lite', 'std']) {
      app.setDetail(lv, { silent: true });
      const root = T.buildAsset(wallItem, wp);
      let m = 0, glass = 0, tri = 0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        m++;
        const mm = o.material;
        if (mm && mm.transparent && mm.opacity < 0.9) glass++;
        tri += o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
      });
      root.traverse?.((o) => o.geometry?.dispose?.());
      out.wall[lv] = { mesh: m, glass, tri: Math.round(tri) };
    }
    app.setDetail('std', { silent: true });
  }

  // ⑥c 内存优先模式：贴图与环境反射都要撤掉，恢复后又要回来
  app.stage.setPerfMode(true);
  const perfOff = { env: !!app.stage.scene.environment, maps: (() => { let k = 0; app.stage.world.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.normalMap) k++; }); return k; })(), basic: (() => { let k = 0, n = 0; app.stage.world.traverse((o) => { if (o.isMesh && o.material) { n++; if (o.material.isMeshBasicMaterial) k++; } }); return k + '/' + n; })() };
  app.stage.setPerfMode(false);
  const perfOn = { env: !!app.stage.scene.environment, maps: (() => { let k = 0; app.stage.world.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.normalMap) k++; }); return k; })() };
  out.perf = { perfOff, perfOn, groundTex: !!app.stage.groundMat.map };

  // ⑦ 工程 JSON 要带精度档
  const j = app.serialize();
  out.serialized = { detail: j.state.detail, env: j.state.env, tex: j.state.tex };
  return out;
});

// 截图：同一机位、三档对比（人 + 屋）
const shot = async (lv, file) => {
  await page.evaluate(async (level) => {
    const app = window.app, THREE = window.__t.THREE;
    app.setDetail(level, { silent: true });
    app.state.showHelpers = false;
    app.stage.setGridVisible(false);
    const char = app.objects.find((o) => o.root?.userData?.char) || app.objects[0];
    const c = new THREE.Box3().setFromObject(char.root).getCenter(new THREE.Vector3());
    app.stage.orbit.target.copy(c);
    app.stage.view.position.set(c.x + 1.9, c.y + 0.55, c.z + 2.3);
    app.stage.view.fov = 30; app.stage.view.updateProjectionMatrix();
    app.stage.orbit.update();
    for (let i = 0; i < 4; i++) { app.step(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
    app.stage.render();
    window.__pix = (() => {
      const src = app.stage.renderer.domElement;
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 250;
      const cx = cv.getContext('2d'); cx.drawImage(src, 0, 0, 400, 250);
      const d = cx.getImageData(0, 0, 400, 250).data;
      let lum = 0, sig = 0; const L = new Float32Array(d.length / 4);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; L[j] = v; lum += v; }
      lum /= L.length;
      for (const v of L) sig += (v - lum) * (v - lum);
      let mad = -1;
      if (window.__refL && window.__refL.length === L.length) {
        let a = 0; for (let i = 0; i < L.length; i++) a += Math.abs(L[i] - window.__refL[i]);
        mad = a / L.length;
      }
      window.__refL = L;
      return { lum: Math.round(lum * 10) / 10, sig: Math.round(Math.sqrt(sig / L.length) * 10) / 10, mad: mad < 0 ? 0 : Math.round(mad * 100) / 100 };
    })();
  }, lv);
  await new Promise((r) => setTimeout(r, 260));
  const pix = await page.evaluate(() => window.__pix);
  await page.screenshot({ path: file });
  return pix;
};
await page.evaluate(() => { window.__refL = null; });
const pixLite = await shot('lite', 'test/out/detail-lite.png');
const pixStd = await shot('std', 'test/out/detail-std.png');
const pixFine = await shot('fine', 'test/out/detail-fine.png');

ck('无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));
ck('默认精度档 = std（不擅自加重内存）', R.detail === 'std', R.detail);
const t = R.tiers;
ck('段数单调：lite < std < fine', t.lite.tri < t.std.tri && t.std.tri < t.fine.tri, `${t.lite.tri} / ${t.std.tri} / ${t.fine.tri}`);
ck('省内存档不挂贴图', t.lite.texels === 0 && t.lite.tex === false, `texels=${t.lite.texels}`);
ck('std 挂贴图且种类去重（一材质一张）', t.std.texels > 0 && t.std.distinctTextures <= 3 * 15, `kinds=${t.std.kinds?.length} textures=${t.std.distinctTextures}`);
ck('fine 贴图更密（≥ std）', t.fine.texels > t.std.texels, `${t.std.texels} → ${t.fine.texels}`);
ck('带 kind 的材质基本都吃到贴图', R.cover.tagged === 0 || R.cover.mapped / R.cover.tagged > 0.6, `${R.cover.mapped}/${R.cover.tagged}`);
ck('环境反射已开启且可调（PMREM 在）', R.env.has && R.env.rt && R.env.zero === 0, JSON.stringify(R.env));
ck('来回切档后贴图缓存有界（≤15 种，不每档留一份）', R.cache.kinds <= 15 && R.cache.texels <= 15 * 3 * 512 * 512, JSON.stringify(R.cache));
ck('全库在 fine 档构建无异常（无 NaN）', R.allAssets.built === R.allAssets.total && R.allAssets.nan === 0, JSON.stringify(R.allAssets));
ck('库内报错列表为空', R.bad.length === 0, R.bad.slice(0, 3).join(' | '));
ck('fine 档资产普遍拿到表面贴图', R.allAssets.mappedAssets > R.allAssets.built * 0.5, `${R.allAssets.mappedAssets}/${R.allAssets.built}`);
ck('人物：单体有手指/五官（网格数明显多于人群）', R.charMeshes > 25, `单体 ${R.charMeshes} 件`);
ck('人物：lite 档自动收掉小件', R.charLiteMeshes < R.charMeshes, `${R.charMeshes} → ${R.charLiteMeshes}`);
ck('三档截图非黑（平均亮度合理）', [pixLite, pixStd, pixFine].every((p) => p.lum > 12 && p.lum < 235), JSON.stringify({ lite: pixLite.lum, std: pixStd.lum, fine: pixFine.lum }));
ck('贴图 + 反射确实改变了画面（逐像素 MAD std/lite、fine/lite）', pixStd.mad > 0.6 && pixFine.mad > 0.6, `mad std=${pixStd.mad} fine=${pixFine.mad}`);
ck('构件：直墙在 std 下补出洞口内壁/窗台/玻璃/勒脚', R.wall.std && R.wall.lite && R.wall.std.mesh > R.wall.lite.mesh + 4 && R.wall.std.glass >= 2, JSON.stringify(R.wall));
ck('内存优先模式：撤掉贴图/反射，关掉后自动回来', !R.perf.perfOff.env && R.perf.perfOn.env && R.perf.perfOn.maps > 0, JSON.stringify(R.perf));
ck('地面也吃到沥青骨料（无地形场景的地面不再是纯色）', R.perf.groundTex === true, String(R.perf.groundTex));
ck('工程 JSON 记录精度与反射', R.serialized.detail === 'std' && R.serialized.env !== undefined && R.serialized.tex !== undefined, JSON.stringify(R.serialized));
// 绝对值 + 相对值一起看：内容量涨了绝对耗时就跟着涨没有意义，真正要防的是「档位之间失控」
// round 7 起细档多了多角檐、垂脊、脊件、瓦当（本来就是「零件更多」那一档），比例上限由 3 放到 4；
// 绝对上限 3500ms 不动 —— 那才是用户真正会感觉「卡」的地方。
ck('重建耗时可接受（fine 全场景 < 3500ms，且 < lite 的 4 倍 + 0.6s）',
  t.fine.rebuildMs < 3500 && t.fine.rebuildMs < t.lite.rebuildMs * 4 + 600,
  `lite ${t.lite.rebuildMs}ms / std ${t.std.rebuildMs}ms / fine ${t.fine.rebuildMs}ms（${R.scene}）`);

const result = { pass: fails.length === 0, failCount: fails.length, fails, errors: errors.slice(0, 6), tiers: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { tri: v.tri, mesh: v.mesh, kinds: v.kinds, texels: v.texels, draw: v.drawCalls, rebuildMs: v.rebuildMs }])), allAssets: R.allAssets, cache: R.cache, crowd: R.crowd, charMeshes: R.charMeshes, pix: { lite: pixLite, std: pixStd, fine: pixFine } };
fs.mkdirSync('test/out', { recursive: true });
fs.writeFileSync('test/detail-result.json', JSON.stringify(result, null, 1));
console.log('\n' + JSON.stringify(result, null, 1));
await browser.close();
process.exit(fails.length ? 1 : 0);
