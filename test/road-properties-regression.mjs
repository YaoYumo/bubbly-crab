// 完成道路 → Esc → 真实视口再选中 → 检查器类型 / 宽度，以及路口 / 撤销 / 保存 / 编辑取消。
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
await mkdir('test/out',{recursive:true});
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const errors=[];
try{
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__t?.app?.roadBrush);
  await page.click('[data-page="scene"]');
  if(process.env.TEST_RENDER_RATIO)await page.evaluate(r=>app.stage.renderer.setPixelRatio(r),Number(process.env.TEST_RENDER_RATIO));
  await page.evaluate(()=>{app.clearAll();const rb=app.roadBrush;rb.setType('asphalt');rb.setWidth(6);rb.filletOn=false;rb.start();app.stage.view.position.set(.01,110,.01);app.stage.orbit.target.set(0,0,0);app.stage.orbit.update();app.stage.view.updateMatrixWorld(true);});
  const project=async(x,z)=>page.evaluate(({x,z})=>{const v=new window.__t.THREE.Vector3(x,0,z).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};},{x,z});
  for(const [x,z]of [[-30,-10],[30,-10]]){const q=await project(x,z);await page.mouse.click(q.x,q.y);}
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>app.objects.filter(o=>o.type==='road_brush').length),1);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>app.roadBrush.active),false);
  const id=await page.evaluate(()=>{const o=app.objects.find(o=>o.type==='road_brush');o.name='可重选道路';return o.id;});
  // 仍停留在地形页也应在真实点选道路后切到物体参数。
  await page.$$eval('#inspector-scene .itab',bs=>bs.find(b=>b.textContent==='地形').click());
  let q=await project(-18,-10);await page.mouse.click(q.x,q.y);
  await page.waitForFunction(id=>app.selObj?.id===id,{},id);
  const typeSelector='#inspector-scene [data-road-property="type"]',numSelector='#inspector-scene [data-road-property="laneCount"]';
  await page.waitForSelector(typeSelector,{visible:true});
  await page.select(typeSelector,'concrete');
  const read=()=>page.evaluate(id=>{const o=app.byId(id);o.root.updateMatrixWorld(true);return{id:o.id,name:o.name,type:o._roadData.roadType.id,width:o._roadData.width,active:app.roadBrush.active,selected:app.selObj?.id,caps:o.root.children.filter(c=>c.name==='road_endcap').map(c=>c.userData.profile.pavementWidth),bounds:new window.__t.THREE.Box3().setFromObject(o.root).getSize(new window.__t.THREE.Vector3()).toArray()};},id);
  let info=await read();assert.equal(info.type,'concrete');assert.equal(info.name,'可重选道路');assert.equal(info.selected,id);assert.equal(info.active,false);
  await page.click(numSelector,{clickCount:3});await page.keyboard.type('4');await page.keyboard.press('Tab');
  info=await read();assert.equal(info.width,12);assert.ok(info.caps.every(v=>Math.abs(v-12)<1e-6));assert.ok(Math.abs(info.bounds[2]-16.5)<.03);assert.equal(info.selected,id);
  await page.evaluate(()=>app.undo());assert.equal((await read()).width,6);assert.equal((await read()).type,'concrete');
  await page.evaluate(()=>app.redo());assert.equal((await read()).width,12);
  await page.evaluate(id=>app.select({kind:'obj',so:app.byId(id)}),id);
  const laneSelector='#inspector-scene [data-road-property="laneWidth"]';
  await page.click(laneSelector,{clickCount:3});await page.keyboard.type('3.5');await page.keyboard.press('Tab');
  info=await read();assert.equal(info.width,14);assert.ok(info.caps.every(v=>Math.abs(v-14)<1e-6));
  await page.evaluate(()=>app.undo());assert.equal((await read()).width,12);
  await page.evaluate(()=>app.redo());assert.equal((await read()).width,14);
  await page.evaluate(id=>app.select({kind:'obj',so:app.byId(id)}),id);
  const shoulder='#inspector-scene [data-road-property="shoulderWidth"]';
  await page.click(shoulder,{clickCount:3});await page.keyboard.type('1');await page.keyboard.press('Tab');
  info=await read();assert.equal(info.width,16);assert.ok(info.caps.every(v=>Math.abs(v-16)<1e-6));
  assert.equal(await page.evaluate(id=>app.byId(id).serialize().section.laneWidth,id),3.5);
  await page.evaluate(()=>app.undo());assert.equal((await read()).width,14);
  await page.evaluate(()=>app.redo());assert.equal((await read()).width,16);
  await page.keyboard.press('Escape');q=await project(-18,-10);await page.mouse.click(q.x,q.y);await page.waitForSelector(typeSelector,{visible:true});await page.select(typeSelector,'oneway');
  info=await read();assert.equal(info.type,'oneway');assert.equal(info.width,16);
  const saved=await page.evaluate(()=>JSON.parse(JSON.stringify(app.serialize())));await page.evaluate(saved=>app.loadJson(saved),saved);
  info=await read();assert.equal(info.type,'oneway');assert.equal(info.width,16);assert.equal(info.name,'可重选道路');
  console.log('PASS real draw / Enter / Esc / reselection / type + independent section fields / actual cap and mesh widths / fixed lane width under shoulder widening / one-step field undo-redo / save-load / stable identity');
  const edge=await page.evaluate(()=>{
    app.clearAll();const rb=app.roadBrush;
    rb.restore([{id:'mainRoad',name:'主路',roadType:'concrete',width:12,points:[[-55,0,0],[55,0,0]]},{id:'editStem',name:'支路',roadType:'asphalt',width:6,points:[[0,0,-50],[0,0,0]]}]);
    const info=()=>{const j=app.objects.filter(o=>o.type==='road_intersection');return{count:j.length,surface:j[0]?.root.userData.surface,bars:j[0]?.root.userData.crosswalkBars,caps:rb._roads.reduce((n,r)=>n+r.mesh.children.filter(c=>c.name==='road_endcap').length,0)};};
    const before=info();const shot=app.addShot();shot.targetId='editStem';
    rb.updateRoadProperties(app.byId('editStem'),{roadType:'concrete',width:10});const changed=info(),target=shot.targetId;
    rb.editRoad(app.byId('editStem'));rb.setType('garden');rb.setWidth(3);rb.cancelEdit();const cancelled=app.byId('editStem').serialize();
    rb.updateRoadProperties(app.byId('editStem'),{roadType:'asphalt',width:8});const after=info();
    const o=app.byId('editStem');o.locked=true;const locked=rb.updateRoadProperties(o,{width:18})===null&&o._roadData.width===8;o.locked=false;
    rb.start();rb.addPoint(30,0,30);const protectedDrawing=rb.updateRoadProperties(o,{width:18})===null&&rb.points.length===1;rb.stop();
    app._redo=[{label:'stale'}];rb.updateRoadProperties(o,{width:9});const redoCleared=app._redo.length===0;
    return{before,changed,target,cancelled,after,locked,protectedDrawing,redoCleared,id:app.byId('editStem').id,name:app.byId('editStem').name,active:rb.active};
  });
  assert.equal(edge.before.surface,'asphalt');assert.ok(edge.before.bars>0);assert.equal(edge.changed.surface,'concrete');assert.equal(edge.changed.bars,0);assert.equal(edge.changed.count,1);assert.equal(edge.changed.caps,3);
  assert.equal(edge.cancelled.roadType,'concrete');assert.equal(edge.cancelled.width,10);assert.equal(edge.cancelled.name,'支路');assert.equal(edge.target,'editStem');
  assert.equal(edge.after.surface,'asphalt');assert.ok(edge.after.bars>0);assert.ok(edge.locked&&edge.protectedDrawing&&edge.redoCleared);assert.equal(edge.id,'editStem');assert.equal(edge.name,'支路');assert.equal(edge.active,false);
  console.log('PASS T rebuild / material priority / crosswalk policy; cancel restores properties; camera target; locked + unfinished drawing protection; redo cleared');
  assert.deepEqual(errors,[]);console.log('PASS road property regression, no page errors');
}finally{await browser.close();}
