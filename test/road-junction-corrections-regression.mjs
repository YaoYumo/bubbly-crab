import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'],protocolTimeout:240000});
const errors=[],csp=[],evidence={};
try{
 const p=await browser.newPage();await p.setViewport({width:1500,height:1050});p.on('pageerror',e=>errors.push(String(e)));
 await p.evaluateOnNewDocument(()=>document.addEventListener('securitypolicyviolation',e=>console.error('CSP_VIOLATION:'+e.violatedDirective)));
 p.on('console',m=>{if(m.text().includes('CSP_VIOLATION'))csp.push(m.text());});
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.app?.roadTerrain,{timeout:60000});await p.click('[data-page="scene"]');
 await p.evaluate(()=>{
  window.V=app.stage.view.position.constructor;window.R=app.stage.raycaster.constructor;
  app.stage.renderer.setPixelRatio(.5);app.suspended=true;app.clearAll();app.terrain.setResolution(65);app.terrain.h.fill(0);app.terrain.refresh();app.terrain.setWater(false);
  window.roadScene=(roads)=>{app.clearAll();app.roadBrush.restore(roads);app.stage.world.updateMatrixWorld(true);};
  window.ray=(roots,x,z)=>new R(new V(x,80,z),new V(0,-1,0)).intersectObjects(roots,true).map(h=>h.point.y);
 });
 // True no-modifier, single-point Y dragging, first in perspective then in top view.
 for(const mode of ['perspective','top','follow']){
  const before=await p.evaluate(mode=>{
   app.terrain.h.fill(mode==='follow'?4:0);app.terrain.refresh();
   roadScene([{id:'point',roadType:'asphalt',width:8,terrainMode:mode==='follow'?'follow':'fixed',points:[[-30,mode==='follow'?0:5,0],[0,mode==='follow'?0:7,12],[30,mode==='follow'?0:9,0]],streetLights:true,lampSide:'right'}]);
   app.select({kind:'obj',so:app.byId('point')});app.stage.view.position.set(...(mode==='top'?[0,100,.01]:[50,65,95]));app.stage.orbit.target.set(0,4,0);app.stage.orbit.update();app.stage.view.updateMatrixWorld(true);
   const points=app.roadBrush.controlPointsFor(app.byId('point')),v=new V(...points[0]).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();app.suspended=false;
   return{points,raw:app.byId('point').serialize(),undo:(app._undo?.length||0),q:{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2-30}};
  },mode);
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  if(mode==='perspective'){await mkdir('.shots',{recursive:true});await p.screenshot({path:'.shots/road-height-grips.png',clip:await p.$eval('canvas',e=>{const r=app.stage.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})});}
  await p.mouse.move(before.q.x,before.q.y);await p.mouse.down();
  const during=await p.evaluate(()=>({kind:app.roadBrush._drag?.kind,height:app.roadBrush._drag?.heightDrag,orbit:app.stage.orbit.enabled}));
  assert.deepEqual(during,{kind:'height',height:true,orbit:false},mode+' green handle hit');
  await p.mouse.move(before.q.x+12,before.q.y-30,{steps:6});await p.mouse.up();
  const after=await p.evaluate(()=>{app.suspended=true;return{data:app.byId('point').serialize(),undo:(app._undo?.length||0),orbit:app.stage.orbit.enabled};});
  assert.equal(after.data.terrainMode,'fixed');assert.equal(after.data.points[0][0],before.points[0][0]);assert.equal(after.data.points[0][2],before.points[0][2]);assert.ok(after.data.points[0][1]>before.points[0][1]+.5);
  assert.deepEqual(after.data.points.slice(1),before.points.slice(1),'untouched points must retain their actual heights, not raw terrain controls');assert.equal(after.undo,before.undo+1);assert.equal(after.orbit,true);assert.equal(after.data.streetLights,true);assert.equal(after.data.lampSide,'right');
  await p.evaluate(()=>app.undo());assert.deepEqual(await p.evaluate(()=>app.byId('point').serialize()),before.raw);await p.evaluate(()=>app.redo());
  const saved=await p.evaluate(()=>JSON.parse(JSON.stringify(app.serialize())));await p.evaluate(s=>app.loadJson(s),saved);assert.deepEqual(await p.evaluate(()=>app.byId('point').serialize()),after.data);
  evidence[mode]={before,after};console.log('PASS direct green Y grip, no Shift / only one Y changes / undo-redo-save-load / '+mode);
 }
 // Planar blue grip and active draft use the same point, but distinct gestures.
 const blueBefore=await p.evaluate(()=>{
  const so=app.byId('point');app.select({kind:'obj',so});const v=new V(...so._roadData.ctrl[2]).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();app.suspended=false;
  return{data:so.serialize(),x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};
 });
 await p.mouse.move(blueBefore.x,blueBefore.y);await p.mouse.down();assert.equal(await p.evaluate(()=>app.roadBrush._drag?.heightDrag),false);
 await p.mouse.move(blueBefore.x+20,blueBefore.y+7,{steps:5});await p.mouse.up();
 const blueAfter=await p.evaluate(()=>{app.suspended=true;return app.byId('point').serialize();});
 assert.equal(blueAfter.points[2][1],blueBefore.data.points[2][1]);assert.ok(Math.hypot(blueAfter.points[2][0]-blueBefore.data.points[2][0],blueAfter.points[2][2]-blueBefore.data.points[2][2])>.1);assert.deepEqual(blueAfter.points.slice(0,2),blueBefore.data.points.slice(0,2));
 await p.evaluate(()=>app.undo());
 const draftBefore=await p.evaluate(()=>({data:app.byId('point').serialize(),undo:app._undo.length}));
 await p.evaluate(()=>app.select({kind:'obj',so:app.byId('point')}));
 await p.$$eval('#inspector-scene button',bs=>bs.find(b=>b.textContent==='编辑路径圆点（拖动调整）').click());
 const draftQ=await p.evaluate(()=>{const v=app.roadBrush.points[1].clone().project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();app.suspended=false;return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2-30};});
 await p.mouse.move(draftQ.x,draftQ.y);await p.mouse.down();await p.mouse.move(draftQ.x,draftQ.y-25,{steps:5});await p.mouse.up();
 assert.ok(await p.evaluate(()=>app.roadBrush.active&&app.roadBrush.points[1].y>app.roadBrush._editBackup.points[1][1]+.3));
 await p.click('#inspector-scene [data-road-draft-cancel]');assert.deepEqual(await p.evaluate(()=>{app.suspended=true;return{data:app.byId('point').serialize(),undo:app._undo.length};}),draftBefore);
 await p.evaluate(()=>{app.byId('point').locked=true;app.select({kind:'obj',so:app.byId('point')});});assert.equal(await p.evaluate(()=>app.roadBrush.selectedGuides.children.length),0);
 console.log('PASS real blue XZ-only drag / active draft single Y grip / cancel restores original + undo stack / locked grips hidden');
 await p.evaluate(()=>{app.terrain.h.fill(0);app.terrain.refresh();});
 // Actual library road meshes, both road creation orders, both highway sides and a full crossing.
 evidence.freeways=await p.evaluate(()=>{
  const results=[];
  for(const reverse of [false,true])for(const side of [-1,1])for(const cross of [false,true]){
   const h={id:'highway',roadType:'freeway',width:20,terrainMode:'fixed',points:[[0,0,-70],[0,0,70]],bridges:false};
   roadScene([h]);const baseline={median:ray([app.byId('highway').root],0,0)[0],opposite:ray([app.byId('highway').root],-side*6,0)[0]};
   const b={id:'branch',roadType:'asphalt',width:8,terrainMode:'fixed',points:[[side*50,0,0],[cross?-side*50:0,0,0]],bridges:false};roadScene(reverse?[b,h]:[h,b]);
   const main=app.byId('highway').root,branch=app.byId('branch').root,junctions=app.objects.filter(o=>o.type==='road_intersection'),roots=[main,branch,...junctions.map(o=>o.root)];
   const median=Array.from({length:41},(_,i)=>ray([main],0,i-20)[0]);
   const opposite=Array.from({length:17},(_,i)=>ray([main],-side*6,i-8)[0]);
   const branchMedian=ray([branch],0,0),nearMain=ray([main],side*6,0);
   const coverage=Array.from({length:32},(_,i)=>({x:side*(2.2+i*.5),hits:ray(roots,side*(2.2+i*.5),0)}));
   results.push({reverse,side,cross,baseline,median,opposite,branchMedian,nearMain,coverage,ports:junctions.length,
    plans:junctions.map(o=>({side:o._isect.freeway.side,hull:o._isect.plan.hull,marks:[o.root.userData.crosswalkBars,o.root.userData.stopLines]}))});
  }return results;
 });
 for(const r of evidence.freeways){assert.equal(r.ports,r.cross?2:1,JSON.stringify(r));assert.ok(r.median.every(y=>Math.abs(y-r.baseline.median)<1e-5),'median lost '+JSON.stringify(r));if(!r.cross)assert.ok(r.opposite.every(y=>Math.abs(y-r.baseline.opposite)<1e-5),'opposing lane lost');assert.equal(r.branchMedian.length,0,'branch still crosses the median');assert.equal(r.nearMain.length,0,'near carriageway was not opened');for(const s of r.coverage)assert.ok(s.hits.length>0,'pavement hole '+JSON.stringify({r,s}));assert.ok(r.plans.every(p=>p.marks.every(x=>x===0)));}
 console.log('PASS 8 real freeway mesh scenes / either creation order and side / continuous median + opposing lane / branch removed from median / open near-side port / no pavement holes');
 // Curved mainline: compare actual median and opposing-carriageway rays to
 // an isolated baseline, not just the tangent half-plane used by a plan.
 evidence.curved=await p.evaluate(()=>{
  const results=[];
  for(const reverse of [false,true]){
   const h={id:'curve',roadType:'freeway',width:20,terrainMode:'fixed',fillet:true,filletH:[0,15,0],points:[[0,0,-60],[0,0,0],[30,0,60]],bridges:false};
   roadScene([h]);const curve=app.byId('curve')._roadData.curve,stations=Array.from({length:41},(_,i)=>{const t=.3+i*.01,p=curve.getPointAt(t),d=curve.getTangentAt(t).setY(0).normalize();return {x:p.x,z:p.z,opX:p.x+d.z*6,opZ:p.z-d.x*6};});
   const baseline=stations.map(s=>({median:ray([app.byId('curve').root],s.x,s.z)[0],opposite:ray([app.byId('curve').root],s.opX,s.opZ)[0]}));
   const q=curve.getPointAt(.5),d=curve.getTangentAt(.5).setY(0).normalize();
   const b={id:'curvedBranch',roadType:'asphalt',width:12,terrainMode:'fixed',points:[[q.x-d.z*50,0,q.z+d.x*50],[q.x,0,q.z]],bridges:false};roadScene(reverse?[b,h]:[h,b]);
   const root=app.byId('curve').root,branch=app.byId('curvedBranch').root;
   results.push({reverse,ports:app.objects.filter(o=>o.type==='road_intersection').length,stations:stations.map((s,i)=>({...s,...baseline[i],medianNow:ray([root],s.x,s.z)[0],oppositeNow:ray([root],s.opX,s.opZ)[0],branchAtMedian:ray([branch],s.x,s.z)}))});
  }return results;
 });
 for(const r of evidence.curved){assert.equal(r.ports,1);for(const s of r.stations){assert.ok(Math.abs(s.median-s.medianNow)<1e-5,'curved median removed');assert.ok(Math.abs(s.opposite-s.oppositeNow)<1e-5,'curved opposing lane removed');assert.equal(s.branchAtMedian.length,0,'curved branch median intrusion');}}
 console.log('PASS real curved freeway / both creation orders / unmodified median and opposite lane / branch does not reappear over curved median');
 evidence.freewayConflict=await p.evaluate(()=>{
  roadScene([{id:'existingFreeway',roadType:'freeway',width:20,terrainMode:'fixed',points:[[0,0,-50],[0,0,50]]}]);
  const rb=app.roadBrush;rb.start();
  rb.roadType=rb._roads[0].roadType;rb.roadWidth=20;rb.terrainMode='fixed';rb.points=[new V(-50,0,0),new V(50,0,0)];
  const before=app._undo?.length||0,result=rb.finish(),blocked={blocked:result===null,active:rb.active,points:rb.points.length,roads:app.objects.filter(o=>o.type==='road_brush').length,undo:app._undo?.length||0,before};rb.stop();return blocked;
 });
 assert.deepEqual(evidence.freewayConflict,{blocked:true,active:true,points:2,roads:1,undo:evidence.freewayConflict.before,before:evidence.freewayConflict.before});
 console.log('PASS same-level freeway crossing rejected without opening a median / draft and undo retained');
 // Finite, acute, unequal-width and graded roads: inspect actual plan and sample ray continuity.
 evidence.acute=await p.evaluate(()=>{
  const results=[];
  for(const angle of [15,30,60])for(const grade of [0,.15])for(const reverse of [false,true]){
   const rad=angle*Math.PI/180,d={x:Math.cos(rad),z:Math.sin(rad)};
   const main={id:'main',roadType:'asphalt',width:12,terrainMode:'fixed',points:[[-45,-45*grade,0],[45,45*grade,0]],bridges:false};
   const branch={id:'short',roadType:'asphalt',width:6,terrainMode:'fixed',points:[[0,0,0],[d.x*18,grade*d.x*18,d.z*18]],bridges:false};roadScene(reverse?[branch,main]:[main,branch]);
   const o=app.objects.find(o=>o.type==='road_intersection'),is=o?._isect,plan=is?.plan;
   const seam=[];
   if(plan)for(const arm of plan.arms){const roots=[app.byId('main').root,app.byId('short').root,o.root];
    for(const u of [arm.c-2,arm.c-1,arm.c,arm.c+1]){if(u<0||u>arm.available)continue;const x=plan.center.x+arm.dir.x*u,z=plan.center.z+arm.dir.z*u;seam.push({x,z,expected:grade*x+.17,actual:ray(roots,x,z)[0]});}
   }
   results.push({angle,grade,reverse,ports:app.objects.filter(o=>o.type==='road_intersection').length,hull:plan?.hull,arms:plan?.arms.map(a=>({dir:a.dir,c:a.c,available:a.available})),seam});
  }return results;
 });
 for(const r of evidence.acute){assert.equal(r.ports,1);assert.ok(r.arms.every(a=>a.c<=a.available+1e-5));assert.ok(r.seam.every(s=>Number.isFinite(s.actual)),'acute seam hole');assert.ok(r.seam.every(s=>Math.abs(s.actual-s.expected)<.12),'graded junction left flat / vertical mouth offset: '+JSON.stringify(r));}
 console.log('acute max height delta',Math.max(...evidence.acute.flatMap(r=>r.seam.map(s=>Math.abs(s.actual-s.expected)))));
 console.log('PASS 12 actual acute/short/graded mesh scenes / bounded endpoints / raycast seam coverage');
 assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);evidence.errors=errors;evidence.csp=csp;
 await mkdir('.shots',{recursive:true});const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';await writeFile(`.shots/road-junction-corrections-${mode}.json`,JSON.stringify(evidence,null,2));
}finally{await browser.close();}
