// 自动等宽圆头：尺寸、横断面接缝、材质/标高、旋转/坡度、短路、保存恢复、路口排除。
// bash test/withchrome.sh node test/road-endcap-regression.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
await mkdir('test/out',{recursive:true});
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const errors=[];
try {
  const page=await browser.newPage(); await page.setViewport({width:1280,height:900});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__t?.app?.roadBrush);
  for(const type of ['asphalt','oneway','concrete']) for(const width of [3,6,12,20]) {
    const result=await page.evaluate(({type,width})=>{
      const {app,THREE}=window.__t; app.clearAll();
      const rb=app.roadBrush;
      rb.restore([{points:[[0,0,-30],[0,0,30]],roadType:type,width,fillet:false}]);
      const road=rb._roads[0].mesh;
      const caps=road.children.filter(g=>g.name==='road_endcap'); road.updateMatrixWorld(true);
      const samples=[];
      for(const cap of caps) {
        const r=width/2;
        const bb=new THREE.Box3().setFromObject(cap);
        // 坐标轴对齐案例直接测世界包围盒：不准出现旧的扩大圆盘/矩形基座。
        const pos=cap.children.flatMap(m=>Array.from(m.geometry.attributes.position.array));
        const ray=new THREE.Raycaster();
        const pairs=[];
        for(const x of [.4,r+.225,r+1.35]) {
          const top=x<r?.15:.30;
          const hits=[-.03,.03].map(z=>{
            const p=cap.localToWorld(new THREE.Vector3(x,top,z));
            ray.set(p.clone().add(new THREE.Vector3(0,3,0)),new THREE.Vector3(0,-1,0));
            const hit=ray.intersectObject(road,true)[0];
            return hit?{error:hit.point.y-p.y,color:hit.object.material.color.getHex(),mesh:hit.object.name}:null;
          });
          pairs.push(hits);
        }
        samples.push({bounds:bb.getSize(new THREE.Vector3()).toArray(),profile:cap.userData.profile,valid:pos.every(Number.isFinite),pairs});
      }
      return {caps:caps.length,samples};
    },{type,width});
    assert.equal(result.caps,2,`${type} ${width}: 2 free ends`);
    for(const cap of result.samples) {
      assert.ok(cap.valid);
      assert.ok(Math.abs(cap.bounds[0]-(width+4.5))<1e-4,`width mismatch ${type} ${width}`);
      assert.ok(Math.abs(cap.bounds[2]-(width/2+2.25))<1e-4,'semicircle radius');
      assert.equal(cap.profile.pavementWidth,width);
      for(const [a,b]of cap.pairs) {
        assert.ok(a&&b,'surface hole at seam');
        assert.ok(Math.abs(a.error)<1e-5&&Math.abs(b.error)<1e-5,`step at seam ${JSON.stringify([a,b])}`);
        assert.equal(a.color,b.color,`material mismatch ${type}`);
      }
    }
    console.log('PASS',type,width,'width + pavement/curb/sidewalk seam');
    if(type==='asphalt'&&[6,12,20].includes(width)) {
      await page.evaluate(width=>{const{app}=window.__t;app.stage.view.position.set(width*.6,width*2.3,30+width*2.2);app.stage.orbit.target.set(0,0,30);app.stage.view.fov=50;app.stage.view.updateProjectionMatrix();app.stage.orbit.update();for(let i=0;i<6;i++)app.step();app.stage.render();},width);
      const clip=await page.evaluate(()=>{const r=document.querySelector('#stage canvas').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};});
      await page.screenshot({path:`test/out/road-endcap-${width}m.png`,clip});
    }
  }
  const extra=await page.evaluate(()=>{
    const{app,THREE}=window.__t;const rb=app.roadBrush;
    const specs=[
      {name:'short',points:[[0,0,-4],[0,0,4]],width:12},
      {name:'slope',points:[[-20,-2,-20],[20,2,20]],width:12},
      {name:'curve',points:[[-30,0,-20],[0,0,-5],[20,0,30]],width:12},
    ];
    const out=[];
    for(const spec of specs){
      app.clearAll();rb.restore([{...spec,roadType:'asphalt',fillet:false}]);
      const road=rb._roads[0].mesh; road.updateMatrixWorld(true);
      const caps=road.children.filter(g=>g.name==='road_endcap');const errors=[];
      for(const cap of caps)for(const x of [.4,6.225,7.35])for(const z of [-.03,.03]){
        const p=cap.localToWorld(new THREE.Vector3(x,x<6?.15:.30,z));
        const ray=new THREE.Raycaster(p.clone().add(new THREE.Vector3(0,4,0)),new THREE.Vector3(0,-1,0));
        const hit=ray.intersectObject(road,true)[0]; errors.push(hit?hit.point.y-p.y:null);
      }
      const saved=app.objects.filter(o=>o.type==='road_brush').map(o=>o.serialize());app.clearAll();rb.restore(saved);
      out.push({name:spec.name,caps:caps.length,errors,restored:rb._roads[0].mesh.children.filter(g=>g.name==='road_endcap').length});
    }
    // 参数编辑必须重建圆头宽度，取消编辑必须恢复原尺寸。
    app.clearAll();rb.restore([{points:[[0,0,-30],[0,0,30]],width:6,roadType:'asphalt'}]);
    rb.editRoad(app.objects.find(o=>o.type==='road_brush'));rb.setWidth(20);rb.finish();
    out.push({name:'edit-width',widths:rb._roads[0].mesh.children.filter(g=>g.name==='road_endcap').map(g=>g.userData.profile.pavementWidth)});
    rb.editRoad(app.objects.find(o=>o.type==='road_brush'));rb.setWidth(8);rb.cancelEdit();
    out.push({name:'cancel-edit',widths:rb._roads[0].mesh.children.filter(g=>g.name==='road_endcap').map(g=>g.userData.profile.pavementWidth)});
    // 基座不自动收口；接入 T 口的端头也不生成圆头。
    app.clearAll();rb.restore([{points:[[0,0,-20],[0,0,20]],width:12,roadType:'asphalt',noJunct:true}]);
    out.push({name:'noJunct',caps:rb._roads[0].mesh.children.filter(g=>g.name==='road_endcap').length});
    app.clearAll();rb.restore([
      {points:[[-60,0,0],[60,0,0]],width:12,roadType:'asphalt'},
      {points:[[0,0,-60],[0,0,0]],width:12,roadType:'asphalt'},
    ]);
    out.push({name:'T',caps:rb._roads.reduce((n,r)=>n+r.mesh.children.filter(g=>g.name==='road_endcap').length,0)});
    return out;
  });
  for(const row of extra){
    if(row.widths)assert.deepEqual(row.widths,[20,20],row.name);
    else if(['noJunct','T'].includes(row.name))assert.equal(row.caps,row.name==='T'?3:0);
    else{assert.equal(row.caps,2,row.name);assert.equal(row.restored,2,row.name);row.errors.forEach(e=>assert.ok(e!==null&&Math.abs(e)<1e-4,`${row.name}: seam ${e}`));}
    console.log('PASS',row.name);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: endcaps match road width/material/height, no seam holes/steps; no page errors');
}finally{await browser.close();}
