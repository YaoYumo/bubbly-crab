import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'],protocolTimeout:240000});
try{
 const p=await browser.newPage(),errors=[],csp=[];await p.setViewport({width:1500,height:1000});p.on('pageerror',e=>errors.push(String(e)));
 await p.evaluateOnNewDocument(()=>document.addEventListener('securitypolicyviolation',e=>console.error('CSP_VIOLATION:'+e.violatedDirective)));
 p.on('console',m=>{if(m.text().includes('CSP_VIOLATION'))csp.push(m.text());});
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.app?.roadConnector);await p.click('[data-page="scene"]');
 const result=await p.evaluate(()=>{
  app.suspended=true;app.stage.renderer.setPixelRatio(.5);const rb=app.roadBrush,rc=app.roadConnector,V=app.stage.view.position.constructor,R=app.stage.raycaster.constructor;
  const reset=()=>{app.clearAll();app.terrain.setSize(320);app.terrain.setResolution(65);app.terrain.h.fill(0);app.terrain.refresh();app.terrain.setWater(false);rb.restore([
   {id:'highway',roadType:'freeway',width:20,terrainMode:'fixed',bridges:false,points:[[-120,8,0],[120,8,0]]},
   {id:'street',roadType:'asphalt',width:12,terrainMode:'fixed',bridges:false,points:[[0,0,-120],[0,0,120]]}
  ]);};
  const metrics=so=>{
   const d=so.serialize(),A=new V(...d.points[0]),B=new V(...d.points.at(-1)),f=B.clone().sub(A).setY(0).normalize();let length=0,minAdvance=Infinity,totalTurn=0,last;
   for(let i=1;i<d.points.length;i++){const v=new V(...d.points[i]).sub(new V(...d.points[i-1])).setY(0);length+=v.length();minAdvance=Math.min(minAdvance,v.dot(f));if(last)totalTurn+=last.angleTo(v);last=v;}
   const nodes=app.objects.filter(o=>o.type==='road_intersection');app.stage.world.updateMatrixWorld(true);
   const roots=app.objects.filter(o=>['road_brush','road_intersection'].includes(o.type)).map(o=>o.root),seams=[];
   for(const g of so._roadData.gaps)for(const edge of [g.t0,g.t1])for(const offset of [-1,0,1]){
    const t=Math.max(0,Math.min(1,edge+offset/so._roadData.curve.getLength())),q=so._roadData.curve.getPointAt(t);
    const hits=new R(new V(q.x,40,q.z),new V(0,-1,0)).intersectObjects(roots,true).map(h=>h.point.y);
    seams.push({t,expected:q.y+.17,delta:hits.length?Math.min(...hits.map(y=>Math.abs(y-q.y-.17))):null});
   }
   return {ratio:length/A.clone().sub(B).setY(0).length(),minAdvance,totalTurn,kind:d.connection?.kind,version:d.connection?.version,nodes:nodes.length,ground:nodes.filter(o=>!o._isect.freeway).map(o=>({merge:o._isect.plan.merge,compact:o._isect.plan.compact,maxMouth:Math.max(...o._isect.plan.arms.map(a=>a.c)),zebra:o.root.userData.crosswalkBars,stop:o.root.userData.stopLines,nearSide:!!o._isect.streetMerge,keepsOpposite:o._isect.plan.hull.every(p=>{const f=o._isect.streetMerge;return !f||(p.x-f.origin.x)*f.normal.x+(p.z-f.origin.z)*f.normal.z>=.3-1e-5;})})),seams};
  };
  const scenes=[];
  for(const sx of [-1,1])for(const sz of [-1,1])for(const reverse of [false,true]){
   reset();const a=app.byId('highway'),b=app.byId('street'),ta=(120+sx*72)/240,tb=(120+sz*84)/240;
   rc.mark(reverse?1:0,a,ta);rc.mark(reverse?0:1,b,tb);const so=rc.generate();scenes.push({sx,sz,reverse,...metrics(so)});
  }
  // Whole-road marking searches along host roads rather than elongating a bad pair.
  reset();rc.mark(0,app.byId('highway'),.25,'road');rc.mark(1,app.byId('street'),.75,'road');const automatic=metrics(rc.generate());
  // Very short fixed points cannot gain length by making a U loop; no undo/change.
  reset();rc.mark(0,app.byId('highway'),.4);rc.mark(1,app.byId('street'),.6);
  const before=JSON.stringify(app.serialize()),undo=app._undo?.length||0;let message='';try{rc.generate({routeMode:'short'});}catch(e){message=e.message;}
  const rejection={message,unchanged:JSON.stringify(app.serialize())===before,undoSame:(app._undo?.length||0)===undo};
  // Old saved large loop can be recomputed atomically, keeping ID and shot target.
  reset();const old={id:'old-loop',name:'旧连接',roadType:'oneway',width:5,section:{laneCount:1,laneWidth:3.5,shoulderWidth:.75,sidewalkWidth:0},terrainMode:'fixed',bridges:false,points:[[-72,8,0],[-125,8,20],[-130,4,70],[-80,0,95],[0,0,84]],connection:{version:1,generated:true,anchors:[{roadId:'highway',t:.2},{roadId:'street',t:.85}]}};
  rb.restore([old]);app.roadTerrain.sync();const saved=JSON.parse(JSON.stringify(app.serialize()));app.loadJson(saved);app.select({kind:'obj',so:app.byId('old-loop')});
  const shot=app.addShot();shot.targetId='old-loop';app.select({kind:'obj',so:app.byId('old-loop')});
  window.rampRegression={metrics,old,undoBefore:app._undo?.length||0};
  return {scenes,automatic,rejection};
 });
 for(const r of [...result.scenes,result.automatic]){
  assert.ok(r.ratio<=1.35&&r.minAdvance>=-.001&&r.totalTurn<=Math.PI*.75,JSON.stringify(r));assert.equal(r.kind,'ramp');assert.equal(r.version,2);assert.equal(r.nodes,2,JSON.stringify(r));assert.equal(r.ground.length,1);
  for(const g of r.ground){assert.equal(g.merge,true);assert.equal(g.compact,true);assert.ok(g.maxMouth<=8.71);assert.equal(g.zebra,0);assert.equal(g.stop,0);assert.equal(g.nearSide,true);assert.equal(g.keepsOpposite,true);}
  for(const s of r.seams)assert.ok(s.delta!==null&&s.delta<.16,'ramp seam: '+JSON.stringify({r,s}));
 }
 assert.ok(result.rejection.message);assert.equal(result.rejection.unchanged,true);assert.equal(result.rejection.undoSame,true);
 await p.click('[data-page="scene"]');
 await p.evaluate(()=>app.select({kind:'obj',so:app.byId('old-loop')}));
 await p.waitForSelector('#inspector-scene [data-road-connect-regenerate]',{visible:true});
 await p.click('#inspector-scene [data-road-connect-regenerate]');
 const regenerated=await p.evaluate(()=>{
  const {metrics,old,undoBefore}=window.rampRegression,so=app.byId('old-loop');const m=metrics(so),shotTarget=app.shots[0].targetId,oneUndo=app._undo.length===undoBefore+1,newPoints=JSON.stringify(so.serialize().points);
  app.undo();const undone=JSON.stringify(app.byId('old-loop').serialize().points)===JSON.stringify(old.points);app.redo();const redone=JSON.stringify(app.byId('old-loop').serialize().points)===newPoints;
  const snapshot=JSON.parse(JSON.stringify(app.serialize()));
  snapshot.objects.sort((a,b)=>(a.id==='old-loop'?-1:0)-(b.id==='old-loop'?-1:0));
  app.loadJson(snapshot);const reloaded=metrics(app.byId('old-loop'));
  const rc=app.roadConnector,rb=app.roadBrush;
  rb.updateRoadProperties(app.byId('old-loop'),{section:{...app.byId('old-loop').serialize().section,laneWidth:3.6}});
  const editKeptMerge=app.byId('old-loop')._roadData.roadType.junctionStyle==='merge';
  rb.start();const newBrushClean=!rb.roadType.junctionStyle;rb.stop();
  app.byId('highway').locked=true;const before=JSON.stringify(app.serialize()),undo=app._undo.length;let lockedRejected=false;
  try{rc.regenerate(app.byId('old-loop'));}catch(e){lockedRejected=true;}
  const lockedAtomic=JSON.stringify(app.serialize())===before&&app._undo.length===undo;app.byId('highway').locked=false;
  return {m,shotTarget,oneUndo,undone,redone,reloaded,editKeptMerge,newBrushClean,lockedRejected,lockedAtomic};
 });
 for(const k of ['editKeptMerge','newBrushClean','lockedRejected','lockedAtomic'])assert.equal(regenerated[k],true,k);
 assert.equal(regenerated.shotTarget,'old-loop');assert.equal(regenerated.oneUndo,true);assert.equal(regenerated.undone,true);assert.equal(regenerated.redone,true);assert.equal(regenerated.reloaded.ground[0].merge,true);assert.equal(regenerated.reloaded.ground[0].zebra,0);assert.ok(regenerated.m.ratio<=1.35);
 assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 await mkdir('.shots',{recursive:true});const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
 await writeFile(`.shots/road-ramp-routing-${mode}.json`,JSON.stringify({platform:'Linux Chromium software WebGL, not native user Windows GPU acceptance',...result,regenerated,errors,csp},null,2));
 if(mode==='web'){
  await p.evaluate(()=>{app.select(null);app.stage.view.position.set(90,145,165);app.stage.orbit.target.set(-35,2,35);app.stage.orbit.update();app.stage.world.updateMatrixWorld(true);app.stage.render();});
  const rect=await p.$eval('#stage canvas',c=>{const r=c.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};});await p.screenshot({path:'.shots/road-ramp-routing.png',clip:rect});
 }
 console.log('PASS '+mode+' 8 reflected/order-reversed screenshot-like ramp scenes / short monotone routes / no U loops / compact merge without zebra / seam rays / automatic station search / atomic impossible rejection / real regenerate button / stable ID + shot target / undo-redo-reload');
}finally{await browser.close();}
