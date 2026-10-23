// T 路口近景：主路必须裁切，入口不能残留原路步道；背侧步道由路口接管。
// bash test/withchrome.sh node test/t-junction-regression.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
await mkdir('test/out', { recursive: true });
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 180000 });
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:5174/?fresh=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__t?.app?.roadBrush);
  const cases = [
    { yaw: 0, angle: 90 },
    { yaw: 0, angle: 90, miss: .01 },
    { yaw: 37, angle: 90, reverse: true, stemFirst: true },
    { yaw: 90, angle: 90, miss: .01, reverse: true },
    { yaw: 37, angle: 60, stemFirst: true },
    { yaw: 0, angle: 30 },
    { yaw: 0, angle: 90, draw: true },
    { yaw: 37, angle: 90, draw: true, stemFirst: true, reverse: true, miss: .01 },
  ];
  for (const spec of cases) {
    const result = await page.evaluate(spec => {
      const { app, THREE } = window.__t;
      app.clearAll();
      const yaw = spec.yaw*Math.PI/180, a=(spec.yaw+spec.angle)*Math.PI/180;
      const main = [Math.cos(yaw), Math.sin(yaw)], stem=[-Math.cos(a),-Math.sin(a)];
      const point = (d, t) => [d[0]*t, 0, d[1]*t];
      const stemPoints = [point(stem, 120), point(stem, spec.miss || 0)];
      if (spec.reverse) stemPoints.reverse();
      const roads = [
        { name: 'main', points: [point(main,-140),point(main,140)], width: 12, roadType: 'asphalt', fillet: false },
        { name: 'stem', points: stemPoints, width: 12, roadType: 'asphalt', fillet: false },
      ];
      if (spec.stemFirst) roads.reverse();
      const rb = app.roadBrush;
      if (spec.draw) for (const rd of roads) {
        rb.points = rd.points.map(p => new THREE.Vector3(...p));
        rb.roadWidth=12; rb.filletOn=false; rb.filletH=[];
        rb.finish();
      } else rb.restore(roads);
      const js=app.objects.filter(o=>o.type==='road_intersection');
      const j=js[0];
      if (!j) return { junctions: 0 };
      const plan = j._isect.plan;
      app.stage.world.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const hitAt = (x,z) => {
        ray.set(new THREE.Vector3(x, 3, z),new THREE.Vector3(0,-1,0));
        const hits = ray.intersectObjects(app.objects.filter(o=>o.type==='road_intersection'||o.type==='road_brush').map(o=>o.root),true);
        const hit = hits[0];
        if (!hit) return null;
        let root=hit.object;
        while (root && !root.userData.so) root=root.parent;
        return { mesh: hit.object.name, type: root?.userData.so?.type, height: hit.point.y };
      };
      const surface = [0,4,7].map(t=>hitAt(stem[0]*t,stem[1]*t));
      let back = [-main[1],main[0]];
      if (back[0]*stem[0]+back[1]*stem[1]>0) back=back.map(v=>-v);
      const backWalk=hitAt(back[0]*7,back[1]*7);
      return { junctions: js.length, gaps: rb._roads.map(r=>r.gaps.map(g=>[g.t0,g.t1])), walks:plan.walks.length, backCount:plan.walks.filter(w=>w.back).length, surface, backWalk };
    }, spec);
    const label=JSON.stringify(spec);
    assert.equal(result.junctions,1,label);
    assert.ok(result.gaps.every(g=>g.length===1),`main/stem must both be cut: ${label}: ${JSON.stringify(result.gaps)}`);
    assert.equal(result.walks,3,`2 corners + back sidewalk: ${label}`);
    assert.equal(result.backCount,1,label);
    for (const h of result.surface) {
      assert.ok(h,`surface missing: ${label}`);
      assert.equal(h.mesh,'junction_face',`old road/sidewalk crossing entrance: ${label}: ${JSON.stringify(h)}`);
      assert.ok(Math.abs(h.height-.1)<1e-5,label);
    }
    assert.ok(result.backWalk?.mesh.startsWith('junction_walk_'),`back sidewalk missing: ${label}`);
    assert.ok(Math.abs(result.backWalk.height-.26)<1e-5,label);
    console.log('PASS',label,JSON.stringify(result.gaps));
    if (spec.yaw===0 && spec.angle===90 && !spec.miss && !spec.draw) {
      for (const [tag,pos,target] of [
        ['near',[15,4,-15],[0,0,0]], ['low',[20,1,-4],[0,0,0]],
        ['back',[0,3,18],[0,0,0]], ['far',[0,320,19],[0,0,0]],
      ]) {
        await page.evaluate((pos,target)=>{const {app}=window.__t; app.stage.view.position.fromArray(pos);app.stage.orbit.target.fromArray(target);app.stage.view.fov=50;app.stage.view.updateProjectionMatrix();app.stage.orbit.update();for(let i=0;i<8;i++)app.step();app.stage.render();},pos,target);
        const clip=await page.evaluate(()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};});
        await page.screenshot({path:`test/out/t-junction-${tag}.png`,clip});
      }
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: T junction restore/draw, reversed endpoints/order, rotation, acute angles, near-miss endpoints; no page errors');
} finally { await browser.close(); }
