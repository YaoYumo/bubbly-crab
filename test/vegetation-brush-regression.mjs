import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000}),errors=[];
try{
 const p=await browser.newPage();await p.setViewport({width:1440,height:1000});p.on('pageerror',e=>errors.push(String(e)));
 await p.goto('http://localhost:5174/?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.__previzBooted);
 const result=await p.evaluate(async()=>{
  const {app:a,THREE}=window.__t;const {VEGETATION}=await import('/src/vegetation-brush.js');a.clearAll();a.terrain.setWater(false);
  a.roadBrush.restore([{roadType:'asphalt',width:6,points:[[-60,0,0],[60,0,0]]}]);
  const block=await a._adoptModel(new THREE.Mesh(new THREE.BoxGeometry(12,10,12).translate(0,5,0),new THREE.MeshStandardMaterial({color:0xff6655})),'block.glb',{x:0,y:0,z:25});
  const b=a.vegetationBrush;b.settings.species=VEGETATION.find(v=>v.type==='tree').key;Object.assign(b.settings,{radius:22,spacing:6,density:1,seed:111});b.setActive(true);
  const point=new THREE.Vector3(-8,0,18);b.begin(point);const preview=b.stroke.plants.length;b.dab(point.clone());const stationary=b.stroke.plants.length;b.end();
  const patches=()=>a.objects.filter(o=>o.type==='vegetation_patch'),o=patches()[0];
  if(!o)throw new Error('No planted patch');
  const plants=o.params.plants,allInstanced=o.root.children.every(m=>m.isInstancedMesh),draws=o.root.children.length;
  const distance=plants.every((p,i)=>plants.slice(i+1).every(q=>Math.hypot(p.p[0]-q.p[0],p.p[2]-q.p[2])>=6-1e-8));
  let actualOverlap=false;const box=new THREE.Box3(),m=new THREE.Matrix4();
  const roadBox=new THREE.Box3(new THREE.Vector3(-60,-10,-5.25),new THREE.Vector3(60,100,5.25)),buildingBox=new THREE.Box3().setFromObject(block.root);
  o.root.updateMatrixWorld(true);
  for(const mesh of o.root.children)for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);box.copy(mesh.geometry.boundingBox||new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position));box.applyMatrix4(m).applyMatrix4(mesh.matrixWorld);if(box.intersectsBox(roadBox)||box.intersectsBox(buildingBox))actualOverlap=true;}
  const id=o.id,count=plants.length;a.undo();const removed=patches().length===0;a.redo();const restored=patches()[0]?.params.plants.length===count;
  const saved=a.serialize();a.loadJson(saved);const saveRestored=patches()[0]?.params.plants.length===count&&patches()[0].root.children.every(m=>m.isInstancedMesh);
  b.setActive(true);patches()[0].locked=true;b.begin(point,true);const lockedRemoved=b.end();patches()[0].locked=false;
  const before=patches().reduce((n,o)=>n+o.params.plants.length,0);b.begin(point,true);const erased=b.end();a.undo();const eraseUndo=patches().reduce((n,o)=>n+o.params.plants.length,0)===before;
  // Modifying heights refits every persisted instance, not the patch's origin.
  a.terrain.h.fill(2);a.terrain.refresh();a.bus.emit('terrain');const refit=patches().every(o=>o.params.plants.every(p=>Math.abs(p.p[1]-2)<1e-5));
  b.setActive(true);b.settings.radius=4;a.terrain.state.waterY=4;a.terrain.setWater(true);b.begin(new THREE.Vector3(40,2,40));const water=b.end();a.terrain.setWater(false);
  for(let j=0;j<a.terrain.n;j++)for(let i=0;i<a.terrain.n;i++)a.terrain.h[j*a.terrain.n+i]=(-a.terrain.size/2+i*a.terrain.size/(a.terrain.n-1))*2;
  a.terrain.refresh();b.begin(new THREE.Vector3(40,80,40));const slope=b.end();
  b.stop();const beforeCancel=patches().length,undos=a._undo.length;b.setActive(true);b.begin(new THREE.Vector3(-60,-120,20));b.stop();const cancel=patches().length===beforeCancel&&a._undo.length===undos;
  return{preview,stationary,count,allInstanced,draws,distance,actualOverlap,removed,restored,saveRestored,lockedRemoved,erased,eraseUndo,refit,water,slope,cancel,manualRetained:!!a.byId(block.id)};
 });
 assert.ok(result.preview>0);assert.equal(result.preview,result.stationary);assert.ok(result.allInstanced);assert.ok(result.draws<result.count*3);assert.ok(result.distance);assert.equal(result.actualOverlap,false);
 assert.ok(result.removed&&result.restored&&result.saveRestored&&result.eraseUndo&&result.refit&&result.cancel&&result.manualRetained);assert.equal(result.lockedRemoved,0);assert.ok(result.erased>0);assert.equal(result.water,0);assert.equal(result.slope,0);
 console.log('PASS deterministic spacing / stationary no overpaint; actual instance bounds avoid roads + buildings; instancing, undo/redo, save/load, locked erase, water/slope rejection, per-instance terrain refit',JSON.stringify(result));
 await p.evaluate(async()=>{app.clearAll();app.terrain.setWater(false);const {VEGETATION}=await import('/src/vegetation-brush.js');Object.assign(app.vegetationBrush.settings,{species:VEGETATION.find(v=>v.type==='grass').key,radius:7,spacing:2,density:1});app.stage.view.position.set(.01,115,.01);app.stage.orbit.target.set(0,0,0);app.stage.orbit.update();app.stage.view.updateMatrixWorld(true);});
 await p.$$eval('#inspector-scene .itab',bs=>bs.find(b=>b.textContent==='地形').click());await p.click('#vegetation-toggle');
 const project=async(x,z)=>p.evaluate(({x,z})=>{const v=new window.__t.THREE.Vector3(x,0,z).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};},{x,z});
 let q=await project(-24,30);await p.mouse.move(q.x,q.y);await p.mouse.down();q=await project(-10,30);await p.mouse.move(q.x,q.y,{steps:6});await p.mouse.up();
 const real=await p.evaluate(()=>({count:app.objects.find(o=>o.type==='vegetation_patch')?.params.plants.length,active:app.vegetationBrush.active,terrain:app.state.terrainTool,roads:app.roadBrush.active}));assert.ok(real.count>0);assert.equal(real.active,true);assert.equal(real.terrain,null);assert.equal(real.roads,false);
 await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>app.vegetationBrush.active),false);
 await p.click('#vegetation-toggle');await p.keyboard.down('Shift');q=await project(-20,30);await p.mouse.move(q.x,q.y);await p.mouse.down();q=await project(-10,30);await p.mouse.move(q.x,q.y,{steps:4});await p.mouse.up();await p.keyboard.up('Shift');
 const countAfter=await p.evaluate(()=>app.objects.filter(o=>o.type==='vegetation_patch').reduce((n,o)=>n+o.params.plants.length,0));assert.ok(countAfter<real.count);
 await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.objects.filter(o=>o.type==='vegetation_patch').reduce((n,o)=>n+o.params.plants.length,0)),real.count);
 console.log('PASS actual UI + mouse plant / Shift erase / Esc / one-stroke undo, brush mutual exclusion');
 assert.deepEqual(errors,[]);console.log('PASS vegetation brush regression, no page errors');
}finally{await browser.close();}
