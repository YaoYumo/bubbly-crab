import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--disable-dev-shm-use'] });
const p = await b.newPage();
await p.goto('http://localhost:5174/?fresh=1', { waitUntil: 'networkidle2', timeout: 180000 });
await p.waitForFunction(() => window.__previzBooted && window.__t?.LIB_INDEX, { timeout: 180000 });
const out = await p.evaluate(() => {
  const { THREE, LIB_INDEX, defaultsFor, setDetailLevel } = window.__t;
  setDetailLevel('std');
  const it = [...LIB_INDEX.values()].find((i) => i.build?.name === 'buildPavilion');
  const g = it.build(defaultsFor(it));
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g);
  const c = bb.getCenter(new THREE.Vector3());
  const rows = [];
  g.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const rb = new THREE.Box3().setFromObject(o);
    if (rb.isEmpty()) return;
    const rc = rb.getCenter(new THREE.Vector3());
    const rs = rb.getSize(new THREE.Vector3());
    const r = Math.hypot(rc.x - c.x, rc.z - c.z);
    rows.push({ n: o.name || (o.isInstancedMesh ? 'inst' : o.geometry.type), r: +r.toFixed(2), y: +rc.y.toFixed(2), top: +rb.max.y.toFixed(2), s: [rs.x, rs.y, rs.z].map((v) => +v.toFixed(2)), cnt: o.count || 1 });
  });
  rows.sort((a, b2) => b2.r - a.r);
  return { box: bb.min.toArray().concat(bb.max.toArray()).map((v) => +v.toFixed(2)), rows: rows.slice(0, 14) };
});
console.log('box', JSON.stringify(out.box));
for (const r of out.rows) console.log(`${String(r.n).padEnd(12)} r=${String(r.r).padStart(5)} y=${String(r.y).padStart(5)} top=${String(r.top).padStart(5)} size=${JSON.stringify(r.s)} n=${r.cnt}`);
await b.close();
