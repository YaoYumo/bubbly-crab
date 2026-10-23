import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));await p.setViewport({width:1440,height:1000});
await p.goto('file://'+process.cwd()+'/previz-lab.html?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.__previzBooted);
await p.$$eval('#inspector-scene .itab',bs=>bs.find(b=>b.textContent==='地形').click());
const grass=await p.$eval('#vegetation-species',e=>[...e.options].find(o=>o.value.includes(':grass:')).value);await p.select('#vegetation-species',grass);await p.click('#vegetation-toggle');
const result=await p.evaluate(async()=>{app.clearAll();app.terrain.setWater(false);const b=app.vegetationBrush;Object.assign(b.settings,{radius:7,spacing:2,density:1});b.setActive(true);b.begin(app.stage.orbit.target.clone().set(-20,0,25));const n=b.end();b.stop();const bytes=await app.saveProject();app.clearAll();await app.importFiles([new File([bytes],'vegetation.previz')]);const o=app.objects.find(o=>o.type==='vegetation_patch');return{n,restored:o?.params.plants.length,instances:o?.root.children.every(m=>m.isInstancedMesh)};});
assert.ok(result.n>0);assert.equal(result.restored,result.n);assert.ok(result.instances);assert.deepEqual(errors,[]);console.log('PASS offline vegetation UI, instanced creation and project archive roundtrip',result);
}finally{await b.close();}
