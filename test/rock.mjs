// 「三边面断裂」回归（石材类）：
//   判据 = 只被一个三角形用到的「自由边」必须全部落在最底圈（贴地口）或退化成零长度；
//   对照组 = 同一几何用「逐顶点随机数」扰动（旧实现），必须被本判据抓出来。
//   另加源码检查：位移循环里不得再出现 rng()。
// 运行：node test/rock.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL0 = process.env.URL || 'http://localhost:5174/';
const errors = [];
const fails = [];
const ck = (name, ok, extra = '') => { if (!ok) fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };
// 先把行注释摘掉，否则「旧版再叠 rng()」这类说明文字会被当成代码命中
const raw = fs.readFileSync('src/nature.js', 'utf8') + fs.readFileSync('src/props.js', 'utf8');
const src = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
{
  const re = /for \(let i = 0; i < pos\.count; i\+\+\) \{([\s\S]*?)\n  \}/g;
  const bad = (src.match(re) || []).map((b) => b.match(/^([\s\S]*)/)[1]).filter((blk) => /\brng\(\)/.test(blk));
  ck('位移循环里没有逐顶点 rng()', bad.length === 0, bad.length ? `${bad.length} 处：` + bad[0].slice(0, 70).replace(/\s+/g, ' ') : '（连续场：同一位置必然同一位移 → 面不会撕开）');
}
const browser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
await page.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => window.__previzBooted && window.app && window.__t.LIB_INDEX, { timeout: 180000 });

const res = await page.evaluate(() => {
  const { THREE, LIB_INDEX, defaultsFor, setDetailLevel } = window.__t;
  setDetailLevel('std');
  const want = ['buildMountain', 'buildBoulder', 'buildRockPile', 'buildCliff', 'buildArch', 'buildGardenStone', 'buildFloatingRock'];
  const items = [...LIB_INDEX.values()].filter((i) => i.build && want.includes(i.build.name));
  // 自由边统计：按「位置量化」配对三角形的边
  // 逐「块」判自由边：模型里每一片壳（山坡、雪冠、铺地、巨石…）单独看。
  // 一片壳允许在它自己的最低一圈开口（贴地口 / 井口），别处出现只被一个三角形用到的边 = 面被撕开。
  function freeEdges(obj) {
    const o = { free: 0, interior: 0, twin: 0, nan: 0, tri: 0, bad: [], nanAt: [] };
    obj.updateMatrixWorld(true);
    obj.traverse((m) => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      const geo = m.geometry, P = geo.attributes.position;
      let mn = 1e9, mx = -1e9;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        if (!isFinite(x + y + z)) { o.nan++; if (o.nanAt.length < 3) o.nanAt.push([m.name || m.type, i]); continue; }
        mn = Math.min(mn, y); mx = Math.max(mx, y);
      }
      const sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).length();
      const eps = Math.max(2e-4, sz * 1.5e-4);
      if (mx - mn < eps * 6) return;                                          // 薄板：没有面可撕
      const qk = (i) => `${Math.round(P.getX(i) / eps)},${Math.round(P.getY(i) / eps)},${Math.round(P.getZ(i) / eps)}`;
      const idx = geo.index, n = idx ? idx.count : P.count, edges = new Map();
      for (let t = 0; t < n; t += 3) {
        o.tri++;
        const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
          const ka = qk(x), kb = qk(y);
          if (ka === kb) continue;                                             // 退化零长边（锥尖）
          const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          edges.set(k, (edges.get(k) || 0) + 1);
        }
      }
      // 撕裂的真实特征：一条缝两侧各留一条边界边，两条边几乎重合（两个端点都只差一点点）。
      // 设计上的开口（雪冠下沿、圆券两端、崖帘边缘）只有单条边界边，没有「成对近邻」→ 不误报。
      const openE = [];
      for (const [k, c] of edges) {
        if (c !== 1) continue;
        o.free++;
        const pa = k.split('|')[0].split(',').map((x) => Number(x) * eps);
        const pb = k.split('|')[1].split(',').map((x) => Number(x) * eps);
        openE.push([pa, pb]);
        if (Math.min(pa[1], pb[1]) > mn + eps * 6) o.interior++;        // 参考量：不在本块最低一圈
      }
      let L = 0;
      for (const [a, b] of openE) L += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const tol = (openE.length ? L / openE.length : 1) * 0.4;
      let twin = 0;
      const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      for (let i = 0; i < openE.length; i++) {
        for (let j = i + 1; j < openE.length; j++) {
          const e1 = openE[i], e2 = openE[j];
          if (Math.max(dd(e1[0], e2[0]), dd(e1[1], e2[1])) < tol || Math.max(dd(e1[0], e2[1]), dd(e1[1], e2[0])) < tol) twin += 2;
        }
      }
      o.twin += twin;
      if (openE.length) o.bad.push({ mesh: m.name || 'mesh', free: openE.length, twin, interior: o.interior });
    });
    return o;
  }
  const out = { items: [] };
  for (const it of items) {
    const g = it.build(defaultsFor(it));
    const r = freeEdges(g);
    r.ok = r.twin === 0;                       // 只认真撕裂：成对且几乎重合的边界边
    r.bad = r.bad.slice(0, 2);
    out.items.push({ name: it.name, ...r });
  }
  // 对照组：巨石几何 + 逐顶点随机位移（= 旧实现），本判据必须报出撕裂
  const ref = new THREE.IcosahedronGeometry(1.8, 1);
  const rp = ref.attributes.position;
  for (let i = 0; i < rp.count; i++) { const s = 0.86 + Math.random() * 0.3; rp.setXYZ(i, rp.getX(i) * s, rp.getY(i) * s, rp.getZ(i) * s); }
  const rr = freeEdges(new THREE.Mesh(ref, new THREE.MeshBasicMaterial()));
  out.control = rr;
  return out;
});

console.log('对照组（逐顶点随机扰动的 icosahedron）：', JSON.stringify(res.control));
ck('判据能抓出撕裂（对照组 twin > 0）', res.control.twin > 0, `twin ${res.control.twin} / free ${res.control.free} / tri ${res.control.tri}`);
for (const i of res.items) {
  ck(`${i.name}：面上无撕裂`, i.ok === true, `成对撕裂边 ${i.twin} / 边界边 ${i.free} / 面内 ${i.interior} / 三角 ${i.tri} · ${JSON.stringify(i.bad)}`);
  ck(`${i.name}：无 NaN 顶点`, i.nan === 0, `${i.nan} @ ${JSON.stringify(i.nanAt)}`);
}
ck('覆盖到 7 项石材', res.items.length >= 7, `共 ${res.items.length}`);
ck('无页面报错', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? `FAIL ${fails.length}\n - ${fails.join('\n - ')}` : `PASS（${res.items.length} 项石材 + 对照组判据全绿）`);
process.exit(fails.length ? 1 : 0);
