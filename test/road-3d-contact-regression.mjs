import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'],protocolTimeout:240000});
const errors=[],csp=[];
try{
 const p=await browser.newPage();await p.setViewport({width:1500,height:1050});p.on('pageerror',e=>errors.push(String(e)));
 await p.evaluateOnNewDocument(()=>document.addEventListener('securitypolicyviolation',e=>console.error('CSP_VIOLATION:'+e.violatedDirective)));
 p.on('console',m=>{if(m.text().includes('CSP_VIOLATION'))csp.push(m.text());});if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.app?.roadTerrain,{timeout:60000});await p.click('[data-page="scene"]');
 const result=await p.evaluate(()=>{
  app.suspended=true;app.stage.renderer.setPixelRatio(.5);app.clearAll();app.terrain.setResolution(65);app.terrain.h.fill(0);app.terrain.refresh();app.terrain.setWater(false);
  const V=app.stage.view.position.constructor,R=app.stage.raycaster.constructor,results=[];
  const ray=(roots,x,z)=>new R(new V(x,50,z),new V(0,-1,0)).intersectObjects(roots,true).map(h=>h.point.y);
  for(const angle of [20,45])for(const reverse of [false,true])for(const order of [[0,1,2],[2,1,0],[1,0,2]]){
   app.clearAll();const dx=60,dz=dx*Math.tan(angle*Math.PI/180),points=[[-30,8,0],[30,0,dz]];if(reverse)points.reverse();
   const roads=[{id:'upper',roadType:'freeway',width:20,terrainMode:'fixed',points:[[-120,8,0],[120,8,0]],bridges:false},
    {id:'lower',roadType:'asphalt',width:8,terrainMode:'fixed',points:[[30,0,-60],[30,0,100]],bridges:false},
    {id:'ramp',roadType:'asphalt',width:8,terrainMode:'fixed',points,bridges:true}];
   app.roadBrush.restore(order.map(i=>roads[i]));app.stage.world.updateMatrixWorld(true);
   const upper=app.byId('upper'),lower=app.byId('lower'),ramp=app.byId('ramp'),junctions=app.objects.filter(o=>o.type==='road_intersection'),ports=junctions.filter(o=>o._isect.freeway),roots=[upper.root,lower.root,ramp.root,...junctions.map(o=>o.root)];
   const r={angle,reverse,order,ports:ports.length,junctions:junctions.length,upperGaps:upper._roadData.gaps.length,lowerGaps:lower._roadData.gaps.length,rampGaps:ramp._roadData.gaps.length,arms:junctions.map(o=>o._isect.plan.arms.length),median:ray([upper.root],-25,0)[0],opposite:ray([upper.root],-25,-6)[0],seams:[]};
   const curve=ramp._roadData.curve;
   for(const gap of ramp._roadData.gaps){const edge=gap.isect.freeway?(reverse?gap.t0:gap.t1):(reverse?gap.t1:gap.t0);
    for(const d of [-2,-1,0,1,2]){const t=Math.max(0,Math.min(1,edge+d/curve.getLength())),q=curve.getPointAt(t);r.seams.push({freeway:!!gap.isect.freeway,t,expected:q.y+.17,actual:ray(roots,q.x,q.z)[0]});}
   }
   if(ports[0]){const q=ports[0]._isect.point;r.nearMain=ray([upper.root],q.x,q.z);r.joinHeight=ports[0]._isect.joinHeight;}
   results.push(r);
  }
  // A graded through-road passing below the highway still must not be joined.
  app.clearAll();app.roadBrush.restore([{id:'h',roadType:'freeway',width:20,terrainMode:'fixed',points:[[-100,8,0],[100,8,0]]},{id:'under',roadType:'asphalt',width:8,terrainMode:'fixed',points:[[-40,0,-60],[40,4,60]]}]);
  return{scenes:results,underpassJunctions:app.objects.filter(o=>o.type==='road_intersection').length};
 });
 for(const r of result.scenes){assert.equal(r.ports,1,JSON.stringify(r));assert.equal(r.junctions,2);assert.equal(r.upperGaps,1);assert.equal(r.lowerGaps,1);assert.equal(r.rampGaps,2);assert.ok(r.arms.every(n=>n===3));assert.ok(Math.abs(r.median-9.145)<.02);assert.ok(Math.abs(r.opposite-8.17)<.02);assert.equal(r.nearMain.length,0);assert.equal(r.joinHeight,8);for(const s of r.seams)assert.ok(Number.isFinite(s.actual)&&Math.abs(s.actual-s.expected)<.16,'ramp mouth not aligned: '+JSON.stringify({r,s}));}
 assert.equal(result.underpassJunctions,0);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 const incremental=await p.evaluate(()=>{
  app.clearAll();const V=app.stage.view.position.constructor,rb=app.roadBrush;
  rb.restore([{id:'up',roadType:'freeway',width:20,terrainMode:'fixed',points:[[-120,8,0],[120,8,0]]},{id:'slope',roadType:'asphalt',width:8,terrainMode:'fixed',points:[[-30,8,0],[30,0,22]]}]);
  const before=app._undo?.length||0;rb.start();rb.setType('asphalt');rb.roadWidth=8;rb.terrainMode='fixed';rb.points=[new V(30,0,-60),new V(30,0,100)];
  const mesh=rb.finish(),id=mesh.userData.so.id,ports=app.objects.filter(o=>o.type==='road_intersection').length,gaps=app.byId('slope')._roadData.gaps.length,oneUndo=app._undo.length===before+1,meshCurrent=app.byId(id).root===mesh;
  rb.stop();app.undo();const undone=!app.byId(id)&&app.objects.filter(o=>o.type==='road_intersection').length===1;app.redo();const redone=!!app.byId(id)&&app.objects.filter(o=>o.type==='road_intersection').length===2;
  return{ports,gaps,oneUndo,meshCurrent,undone,redone};
 });assert.deepEqual(incremental,{ports:2,gaps:2,oneUndo:true,meshCurrent:true,undone:true,redone:true});
 const saved=await p.evaluate(()=>{
  app.clearAll();const rb=app.roadBrush;rb.restore([{id:'h',roadType:'freeway',width:20,terrainMode:'fixed',points:[[-60,8,0],[60,8,0]]},{id:'r',roadType:'asphalt',width:8,terrainMode:'fixed',points:[[-30,8,0],[30,0,60]],streetLights:true}]);
  const before=app.objects.filter(o=>o.type==='road_intersection').length,s=JSON.parse(JSON.stringify(app.serialize()));app.loadJson(s);return{before,after:app.objects.filter(o=>o.type==='road_intersection').length,lights:app.byId('r').serialize().streetLights};
 });assert.deepEqual(saved,{before:1,after:1,lights:true});
 await mkdir('.shots',{recursive:true});const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';await writeFile(`.shots/road-3d-contact-${mode}.json`,JSON.stringify({platform:'Linux Chromium / software WebGL; not user Windows hardware',pixelRatio:.5,renderingPausedOutsideCapture:true,...result,incremental,saved,errors,csp},null,2));
 console.log('PASS '+mode+' 12 screenshot-like graded ramp networks / both road creation orders and endpoint directions / 2 T mouths / ramp seam rays / median and opposite lane retained / true underpass unjoined / save-load');
}finally{await browser.close();}
