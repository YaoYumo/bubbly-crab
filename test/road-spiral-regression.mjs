import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'],protocolTimeout:240000});
try{
 const p=await browser.newPage(),errors=[],csp=[];await p.setViewport({width:1500,height:1000});p.on('pageerror',e=>errors.push(String(e)));
 await p.evaluateOnNewDocument(()=>document.addEventListener('securitypolicyviolation',e=>console.error('CSP_VIOLATION:'+e.violatedDirective)));
 p.on('console',m=>{if(m.text().includes('CSP_VIOLATION'))csp.push(m.text());});
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.app?.roadConnector);await p.click('[data-page="scene"]');
 const result=await p.evaluate(()=>{
  app.suspended=true;app.stage.renderer.setPixelRatio(.5);
  const rb=app.roadBrush,rc=app.roadConnector,V=app.stage.view.position.constructor,R=app.stage.raycaster.constructor;
  const reset=(width=20,reverse=false)=>{
   app.clearAll();app.terrain.setSize(320);app.terrain.setResolution(33);app.terrain.h.fill(0);app.terrain.refresh();app.terrain.setWater(false);rc.routeMode='auto';
   const roads=[{id:'highway',roadType:'freeway',width,terrainMode:'fixed',bridges:false,points:[[-120,8,0],[120,8,0]]},{id:'street',roadType:'asphalt',width:12,terrainMode:'fixed',bridges:false,points:[[0,0,-120],[0,0,120]]}];
   rb.restore(reverse?roads.reverse():roads);
  };
  const ray=(x,z,roots)=>new R(new V(x,40,z),new V(0,-1,0)).intersectObjects(roots,true).map(h=>h.point.y);
  const ports=so=>{
   app.stage.world.updateMatrixWorld(true);const nodes=app.objects.filter(o=>o.type==='road_intersection'),roots=app.objects.filter(o=>['road_brush','road_intersection'].includes(o.type)).map(o=>o.root);
   let maxSeam=0;
   for(const g of so._roadData.gaps)for(const edge of [g.t0,g.t1])for(const ds of [-1,0,1]){
    const q=so._roadData.curve.getPointAt(Math.max(0,Math.min(1,edge+ds/so._roadData.curve.getLength()))),hits=ray(q.x,q.z,roots);
    maxSeam=Math.max(maxSeam,hits.length?Math.min(...hits.map(y=>Math.abs(y-q.y-.17))):Infinity);
   }
   return{nodes:nodes.length,highway:nodes.filter(o=>o._isect.freeway).length,street:nodes.filter(o=>o._isect.streetMerge).length,maxSeam};
  };
  const decks=[];
  for(const width of [20,34])for(const side of [-1,1])for(const reverse of [false,true]){
   reset(width,reverse);rc.mark(0,app.byId('highway'),.16);rc.mark(1,app.byId('street'),(120+side*100)/240);
   const so=rc.generate({routeMode:'short'}),host=app.byId('highway'),f=app.objects.find(o=>o._isect?.freeway)._isect.freeway;
   
   // World normal of +X host points to -Z; freewaySide uses this local sign.
   const own=[];host.root.traverse(m=>{if(m.isMesh&&m.userData.roadRole==='pavement'&&m.userData.freewaySide!==0)own.push(m);});
   let holes=0,maxDelta=0;
   for(let x=f.origin.x-20;x<=f.origin.x+20;x+=1)for(let z=2.5;z<width/2-.3;z+=.7){const ys=ray(x,z*side,own);if(!ys.length)holes++;else maxDelta=Math.max(maxDelta,Math.min(...ys.map(y=>Math.abs(y-8.17))));}
   const patch=app.objects.find(o=>o._isect?.freeway).root;let patchAbove=0;patch.updateMatrixWorld(true);
   patch.traverse(m=>{if(!m.isMesh||m.name!=='junction_face')return;const a=m.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=new V().fromBufferAttribute(a,i).applyMatrix4(m.matrixWorld);if(Math.abs(v.z)<width/2-.1)patchAbove=Math.max(patchAbove,v.y-8.1);}});
   const samples=so._roadData.curve.getSpacedPoints(800),edge=side*(width/2-.55);let q=samples[0];for(const s of samples)if(Math.abs(s.z-edge)<Math.abs(q.z-edge))q=s;
   const roots=[host.root,so.root,patch],mouthTop=Math.max(...ray(q.x,edge,roots));
   let duplicateRampDeck=0;
   for(const s of samples)if(Math.abs(s.z)<width/2-.3&&Math.abs(s.z)>2.5&&Math.abs(s.y-8)<.05){if(ray(s.x,s.z,[so.root]).some(y=>Math.abs(y-8.17)<.2))duplicateRampDeck++;}
   decks.push({duplicateRampDeck,width,side,reverse,holes,maxDelta,patchAbove,mouthTop,...ports(so)});
  }
  reset(34);rb.updateRoadProperties(app.byId('highway'),{points:[[-120,6.4,0],[120,13.6,0]]});
  rc.mark(0,app.byId('highway'),.16);rc.mark(1,app.byId('street'),220/240);
  const graded=rc.generate({routeMode:'short'}),gd=graded.serialize(),cv=graded._roadData.curve;let maxDeckMismatch=0;
  for(let i=0;i<gd.points.length&&i*cv.getLength()/gd.points.length<gd.connection.routing.flatStart-.5;i++){
    const q=gd.points[i];maxDeckMismatch=Math.max(maxDeckMismatch,Math.abs(q[1]-(10+.03*q[0])));
  }
  const gradedHost={maxDeckMismatch,...ports(graded)};
  const spirals=[];
  for(const width of [20,34])for(const side of [-1,1])for(const reverse of [false,true]){
   reset(width,reverse);rc.mark(reverse?1:0,app.byId('highway'),.4);rc.mark(reverse?0:1,app.byId('street'),(120+side*24)/240);
   let so;try{so=rc.generate();}catch(e){throw new Error(JSON.stringify({width,side,reverse,message:e.message}));}const d=so.serialize(),points=so._roadData.curve.getSpacedPoints(1000);let actualGrade=0;
   for(let i=1;i<points.length;i++)actualGrade=Math.max(actualGrade,Math.abs(points[i].y-points[i-1].y)/Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
   spirals.push({width,side,reverse,actualGrade,routing:d.connection.routing,...ports(so)});
  }
  // Preserve a short-only escape hatch; no mutation when that policy fails.
  reset();rc.mark(0,app.byId('highway'),.4);rc.mark(1,app.byId('street'),.6);
  const before=JSON.stringify(app.serialize()),undo=app._undo.length;let rejected=false;try{rc.generate({routeMode:'short'});}catch{rejected=true;}
  const atomic=rejected&&JSON.stringify(app.serialize())===before&&app._undo.length===undo;
  // No room for a spiral: failure preserves the complete project and undo stack.
  app.terrain.setSize(64);const blockedBefore=JSON.stringify(app.serialize()),blockedUndo=app._undo.length;let blocked=false;
  try{rc.generate();}catch{blocked=true;}
  const blockedAtomic=blocked&&JSON.stringify(app.serialize())===blockedBefore&&app._undo.length===blockedUndo;
  reset();rc.mark(0,app.byId('highway'),.4);rc.mark(1,app.byId('street'),.6);
  // Keep a close spiral selected for real mode-control and regeneration gestures.
  const so=rc.generate();window.spiralCheck={id:so.id,points:JSON.stringify(so.serialize().points),beforeUndo:app._undo.length,ports};
  return{decks,gradedHost,spirals,atomic,blockedAtomic};
 });
 for(const s of result.decks){assert.equal(s.duplicateRampDeck,0,JSON.stringify(s));assert.equal(s.holes,0,JSON.stringify(s));assert.ok(s.maxDelta<.025,JSON.stringify(s));assert.ok(s.patchAbove<.005,JSON.stringify(s));assert.ok(s.mouthTop<8.35,JSON.stringify(s));assert.equal(s.nodes,2);assert.ok(s.maxSeam<.16,JSON.stringify(s));}
 for(const s of result.spirals){assert.equal(s.routing.shape,'spiral');assert.ok(s.actualGrade<=.182,JSON.stringify(s));assert.ok(s.routing.radius>=12&&s.routing.turns>=.75&&s.routing.turns<=2);assert.equal(s.nodes,2,JSON.stringify(s));assert.equal(s.highway,1);assert.equal(s.street,1);assert.ok(s.maxSeam<.16,JSON.stringify(s));}
 assert.ok(result.gradedHost.maxDeckMismatch<.025,JSON.stringify(result.gradedHost));assert.ok(result.gradedHost.maxSeam<.16);
 assert.equal(result.atomic,true);assert.equal(result.blockedAtomic,true);
 await p.evaluate(()=>{app.suspended=false;app.select({kind:'obj',so:app.byId(window.spiralCheck.id)});});
 await p.waitForSelector('#inspector-scene [data-road-connect-mode]',{visible:true});
 await p.select('#inspector-scene [data-road-connect-mode]','spiral');
 await p.click('#inspector-scene [data-road-connect-regenerate]');
 const lifecycle=await p.evaluate(()=>{
  app.suspended=true;const {id,points,beforeUndo,ports}=window.spiralCheck,so=app.byId(id),d=so.serialize(),oneUndo=app._undo.length===beforeUndo+1;
  app.undo();const undo=JSON.stringify(app.byId(id).serialize().points)===points;app.redo();const redo=JSON.stringify(app.byId(id).serialize().points)===JSON.stringify(d.points);
  const snapshot=JSON.parse(JSON.stringify(app.serialize()));snapshot.objects.sort((a,b)=>(a.id===id?-1:0)-(b.id===id?-1:0));app.loadJson(snapshot);
  return{oneUndo,undo,redo,sameId:!!app.byId(id),savedRouting:JSON.stringify(app.byId(id).serialize().connection.routing)===JSON.stringify(d.connection.routing),ports:ports(app.byId(id))};
 });
 for(const k of ['oneUndo','undo','redo','sameId','savedRouting'])assert.equal(lifecycle[k],true,k);assert.equal(lifecycle.ports.nodes,2);assert.ok(lifecycle.ports.maxSeam<.16);
 assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';await mkdir('.shots',{recursive:true});await writeFile(`.shots/road-spiral-${mode}.json`,JSON.stringify({platform:'Linux software WebGL, not native Windows GPU acceptance',...result,lifecycle,errors,csp},null,2));
 if(mode==='web'){
  await p.evaluate(()=>{app.select(null);app.stage.view.position.set(-85,100,130);app.stage.orbit.target.set(-30,3,30);app.stage.orbit.update();app.stage.world.updateMatrixWorld(true);app.stage.render();});
  const rect=await p.$eval('#stage canvas',c=>{const r=c.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};});await p.screenshot({path:'.shots/road-spiral.png',clip:rect});
 }
 console.log('PASS '+mode+' wide upper deck ownership / no sunken host patch or rail through mouth / 8 close spirals / 2 ports only / seam rays / real mode and regeneration / undo-redo-reload / atomic short rejection');
}finally{await browser.close();}
