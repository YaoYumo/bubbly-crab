import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
await mkdir('test/out',{recursive:true});
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:240000});
const errors=[];
try {
  const page=await browser.newPage();await page.setViewport({width:1560,height:1000});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.app?.roadPlanning,{timeout:60000});
  assert.deepEqual(await page.evaluate(()=>[app.state.grid,app.state.roadSnap,app.roadPlanning.grid.visible]),[false,false,false]);
  await page.evaluate(()=>[...document.querySelectorAll('#inspector-scene .itab')].find(b=>b.textContent==='地形').click());
  await page.waitForSelector('#road-grid-toggle');
  await page.click('#scene-grid-toggle');assert.equal(await page.evaluate(()=>app.state.grid),true);
  await page.click('#scene-grid-toggle');assert.equal(await page.evaluate(()=>app.state.grid),false);
  await page.click('#scene-snap-toggle');assert.equal(await page.evaluate(()=>app.state.roadSnap),true);
  await page.click('#scene-snap-toggle');assert.equal(await page.evaluate(()=>app.state.roadSnap),false);
  console.log('PASS viewport Grid / Snap shortcuts synchronize with panel');

  await page.click('#road-grid-toggle');
  assert.deepEqual(await page.evaluate(()=>[app.state.grid,app.state.roadSnap,app.roadPlanning.grid.visible]),[true,false,true]);
  await page.click('#road-grid-toggle');await page.click('#road-snap-toggle');
  assert.deepEqual(await page.evaluate(()=>[app.state.grid,app.state.roadSnap,app.roadPlanning.grid.visible]),[false,true,false]);
  const snaps=await page.evaluate(()=>{
    const a=app,p=a.roadPlanning,rb=a.roadBrush;rb.start();rb.addPoint(2.2,0,7.7);rb.addPoint(12.6,0,3.1);
    const snapped=rb.points.map(p=>[p.x,p.z]);
    p.setSnap(false);rb.addPoint(2.2,0,7.7);const free=rb.points.at(-1).toArray();
    p.setSnap(true);const axis=p.snapPoint(new window.__t.THREE.Vector3(17,0,27),true,new window.__t.THREE.Vector3(15,0,5));
    rb.stop();return{snapped,free,axis:axis.toArray()};
  });
  assert.deepEqual(snaps.snapped,[[0,10],[15,5]]);assert.equal(snaps.free[0],2.2);assert.equal(snaps.free[2],7.7);assert.equal(snaps.axis[0],15);
  console.log('PASS default-off, independent UI toggles, grid/free placement, orthogonal snap');
  await page.evaluate(()=>{app.roadBrush.start();app.stage.view.position.set(.01,80,.01);app.stage.orbit.target.set(0,0,0);app.stage.orbit.update();app.stage.view.updateMatrixWorld(true);});
  const project=async(x,z)=>page.evaluate(({x,z})=>{const v=new window.__t.THREE.Vector3(x,0,z).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};},{x,z});
  const a=await project(12.2,17.4);await page.mouse.move(a.x,a.y);await page.mouse.click(a.x,a.y);
  assert.deepEqual(await page.evaluate(()=>app.roadBrush.points.map(p=>[p.x,p.z])),[[10,15]]);
  const b=await project(28.2,3.2);await page.keyboard.down('Shift');await page.mouse.move(b.x,b.y);
  assert.deepEqual(await page.evaluate(()=>{const p=app.roadBrush._ghost.position;return[p.x,p.z];}),[30,15]);
  await page.mouse.click(b.x,b.y);await page.keyboard.up('Shift');
  assert.deepEqual(await page.evaluate(()=>app.roadBrush.points.map(p=>[p.x,p.z])),[[10,15],[30,15]]);
  const from=await project(10,15),to=await project(23.1,-12.2);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>{const p=app.roadBrush.points[0];return[p.x,p.z];}),[25,-10]);
  const protectedDrawing=await page.evaluate(()=>{try{app.roadPlanning.detect();return false;}catch{return app.roadBrush.points.length===2;}finally{app.roadBrush.stop();}});
  assert.equal(protectedDrawing,true);console.log('PASS real mouse placement, Shift axis, ghost, point dragging, unfinished-drawing protection');

  const grid=await page.evaluate(()=>{
    app.state.grid=true;app.stage.setGridVisible(true);
    const tr=app.terrain;for(let i=0;i<tr.h.length;i++)tr.h[i]=Math.sin(i*.03)*2;
    tr.refresh();app.bus.emit('terrain');
    let maxError=0;app.roadPlanning.grid.traverse(m=>{if(!m.geometry)return;const a=m.geometry.attributes.position;for(let i=0;i<a.count;i+=29)maxError=Math.max(maxError,Math.abs(a.getY(i)-Math.max(tr.heightAt(a.getX(i),a.getZ(i)),tr.state.water?tr.state.waterY:-Infinity)-.045));});
    tr.h.fill(0);tr.refresh();app.bus.emit('terrain');
    return{maxError,oldHelpers:app.stage.gridFine.visible||app.stage.gridCoarse.visible};
  });
  assert.ok(grid.maxError<1e-5);assert.equal(grid.oldHelpers,false);console.log('PASS terrain-conforming grid');
  const regions=await page.evaluate(()=>{
    app.roadBrush.stop();app.clearAll();
    app.roadBrush.restore([
      {points:[[-60,0,-60],[60,0,-60]],roadType:'asphalt',width:8},
      {points:[[-60,0,60],[60,0,60]],roadType:'asphalt',width:8},
      {points:[[-60,0,-60],[-60,0,60]],roadType:'asphalt',width:8},
      {points:[[60,0,-60],[60,0,60]],roadType:'asphalt',width:8},
      {points:[[0,0,-70],[0,0,70]],roadType:'asphalt',width:8},
    ]);
    const parcels=app.roadPlanning.detect();return parcels.map(p=>({id:p.id,area:p.area,b:p.bounds}));
  });
  assert.equal(regions.length,2);assert.ok(regions.every(r=>r.area>100));
  await page.select('#road-parcel-select',regions[1].id);
  assert.equal(await page.evaluate(()=>app.roadPlanning.selectedId),regions[1].id);
  // 真正从视口点击地块，即使 Stage 没有拾取到模型也能选中。
  const pixel=await page.evaluate(id=>{
    const a=app,p=a.roadPlanning.parcels.find(p=>p.id===id),{THREE}=window.__t;
    a.stage.view.position.set(.01,180,.01);a.stage.orbit.target.set(0,0,0);a.stage.orbit.update();a.stage.view.updateMatrixWorld(true);
    const v=new THREE.Vector3((p.bounds.minX+p.bounds.maxX)/2,0,(p.bounds.minZ+p.bounds.maxZ)/2).project(a.stage.view);
    const r=a.stage.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};
  },regions[0].id);
  await page.mouse.click(pixel.x,pixel.y);
  assert.equal(await page.evaluate(()=>app.roadPlanning.selectedId),regions[0].id);console.log('PASS 2 enclosed parcels, dropdown + real viewport selection');
  await page.select('#road-parcel-zone','residential');await page.click('#road-parcel-fill');
  assert.ok(await page.evaluate(()=>app.objects.some(o=>o.params?._roadParcel)));console.log('PASS fill button UI');
  const manualId=await page.evaluate(()=>{
    const p=app.roadPlanning.selected,b=p.bounds;
    // 使用实际存在的住宅库 key；手动物体不得在再次填充时被删除。
    return import('/src/assets.js').then(({LIB_INDEX})=>{
      const key=[...LIB_INDEX.entries()].find(([,i])=>i.type==='cape_cod')[0];
      return app.addAsset(key,[(b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2]).id;
    });
  });
  for(const zone of ['residential','commercial','civic','park']) {
    const result=await page.evaluate(async zone=>{
      const {footprintFits,boxesOverlap}=await import('/src/road-parcels.js');
      const {THREE}=window.__t,p=app.roadPlanning.selected;
      const count=app.roadPlanning.fillSelected(zone,20);
      const objects=app.objects.filter(o=>o.params?._roadParcel?.id===p.id);
      const boxes=objects.map(o=>{const b=new THREE.Box3().setFromObject(o.root);return{minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z};});
      const fits=boxes.every(b=>footprintFits(b,p.polygon));
      const overlap=boxes.some((b,i)=>boxes.some((c,j)=>j>i&&boxesOverlap(b,c)));
      return{count,stored:objects.length,zone:app.state.parcelZones[p.id],fits,overlap,ids:objects.map(o=>o.id)};
    },zone);
    assert.ok(result.count>0);assert.equal(result.count,result.stored);assert.equal(result.zone,zone);assert.equal(result.fits,true);assert.equal(result.overlap,false);
    assert.equal(await page.evaluate(id=>app.objects.some(o=>o.id===id),manualId),true);
    console.log('PASS',zone,'fill + replacement + whole-footprint containment + no overlaps:',result.count);
  }
  const history=await page.evaluate(()=>{
    const before=app.objects.filter(o=>o.params?._roadParcel).map(o=>o.type);
    const undo=app.undo(),afterUndo=app.objects.filter(o=>o.params?._roadParcel).map(o=>o.type);
    const redo=app.redo(),afterRedo=app.objects.filter(o=>o.params?._roadParcel).map(o=>o.type);
    return{before,undo,afterUndo,redo,afterRedo};
  });
  assert.ok(history.undo&&history.redo);assert.notDeepEqual(history.before,history.afterUndo);assert.deepEqual(history.before,history.afterRedo);console.log('PASS one-step undo / redo');
  const persistence=await page.evaluate(()=>{
    const j=JSON.parse(JSON.stringify(app.serialize()));app.loadJson(j);const parcels=app.roadPlanning.detect();
    return{grid:app.state.grid,snap:app.state.roadSnap,count:app.objects.filter(o=>o.params?._roadParcel).length,zones:Object.keys(app.state.parcelZones),parcels:parcels.map(p=>p.id)};
  });
  assert.equal(persistence.grid,true);assert.equal(persistence.snap,true);assert.ok(persistence.count>0);assert.ok(persistence.zones.every(id=>persistence.parcels.includes(id)));console.log('PASS save/reload tools, functional zones and generated objects');
  const locked=await page.evaluate(()=>{
    const p=app.roadPlanning.parcels.find(p=>app.state.parcelZones[p.id]);app.roadPlanning.select(p.id);
    const so=app.objects.find(o=>o.params?._roadParcel?.id===p.id);so.locked=true;const id=so.id;
    app.roadPlanning.fillSelected('residential',20);
    return{id,present:app.objects.some(o=>o.id===id),locked:app.byId(id)?.locked};
  });
  assert.ok(locked.present&&locked.locked);console.log('PASS locked generated object preserved during replacement');
  // 另一地块填不同功能，并记录真实 UI 截图。
  await page.evaluate(()=>{
    const p=app.roadPlanning.parcels.find(p=>!app.state.parcelZones[p.id]);app.roadPlanning.select(p.id);app.roadPlanning.fillSelected('commercial',20);
    app.stage.view.position.set(145,160,145);app.stage.orbit.target.set(0,0,0);app.stage.orbit.update();app.stage.render();
  });
  await page.evaluate(()=>document.querySelector('#road-grid-toggle')?.scrollIntoView({block:'start'}));
  await page.screenshot({path:'test/out/road-planning-filled.png'});
  const guides=await page.evaluate(async()=>{
    const {Exporter}=await import('/src/export.js'),e=new Exporter(app);
    e.setGuides(false);app.roadPlanning.tick();const hidden=!app.roadPlanning.grid.visible&&!app.roadPlanning.overlay.visible;
    e.setGuides(true);app.roadPlanning.tick();return hidden&&app.roadPlanning.grid.visible&&app.roadPlanning.overlay.visible;
  });
  assert.equal(guides,true);console.log('PASS helpers hidden for export');
  const clearBefore=await page.evaluate(()=>{const id=app.roadPlanning.selectedId;return{id,n:app.objects.filter(o=>o.params?._roadParcel?.id===id&&!o.locked).length,other:app.objects.filter(o=>o.params?._roadParcel&&o.params._roadParcel.id!==id).length};});
  await page.click('#road-parcel-clear');
  const clearAfter=await page.evaluate(id=>({n:app.objects.filter(o=>o.params?._roadParcel?.id===id&&!o.locked).length,other:app.objects.filter(o=>o.params?._roadParcel&&o.params._roadParcel.id!==id).length}),clearBefore.id);
  assert.ok(clearBefore.n>0);assert.equal(clearAfter.n,0);assert.equal(clearBefore.other,clearAfter.other);assert.equal(await page.evaluate(id=>!!app.byId(id),manualId),true);console.log('PASS clear button removes only selected parcel-generated contents');
  const invalidation=await page.evaluate(()=>{
    const before=app.objects.filter(o=>o.params?._roadParcel).length;
    const road=app.objects.find(o=>o.type==='road_brush');app.roadBrush.editRoad(road);app.roadBrush.setWidth(10);app.roadBrush.finish();app.roadPlanning.tick();
    return{parcels:app.roadPlanning.parcels.length,selected:app.roadPlanning.selectedId,before,after:app.objects.filter(o=>o.params?._roadParcel).length};
  });
  assert.equal(invalidation.parcels,0);assert.equal(invalidation.selected,null);assert.equal(invalidation.before,invalidation.after);console.log('PASS changed roads invalidate selection, preserve existing buildings');
  assert.deepEqual(errors,[]);console.log('PASS road planning browser regression; no page errors');
}finally{await browser.close();}
