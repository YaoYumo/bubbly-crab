// 路口中心淡色面归属：向下射线 + 包含原点的对象清单
import puppeteer from 'puppeteer';
const URL0 = process.env.URL || 'http://localhost:5174/';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto(URL0 + '?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.app, { timeout: 120000 });
const out = await p.evaluate(async () => {
  const app = window.app;
  const { generateTown } = await import('/src/townbuild.js');
  const THREE = window.__t.THREE;
  generateTown(app, { theme: 'chinese', roadTopology: 'axis', seed: 11, mapSize: 256, zoning: { commercialRatio: 0.5 } });
  const rc = new THREE.Raycaster();
  const hits = [];
  for (const [ox, oz] of [[0, 0], [3, 3], [-4, 2], [6, -3]]) {
    rc.set(new THREE.Vector3(ox, 80, oz), new THREE.Vector3(0, -1, 0));
    const rs = rc.intersectObjects(app.stage.world.children, true).slice(0, 6);
    hits.push({
      at: [ox, oz],
      list: rs.map((r) => {
        let o = r.object, chain = [];
        while (o) { if (o.name) chain.push(o.name); o = o.parent; }
        const col = r.object.material && r.object.material.color ? '#' + r.object.material.color.getHexString() : '?';
        return `${r.point.y.toFixed(2)}|${col}|${chain.slice(0, 5).join('<')}`;
      }),
    });
  }
  return hits;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
