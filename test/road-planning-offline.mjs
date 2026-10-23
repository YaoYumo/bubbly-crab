// 离线 file:// 单文件也必须包含区域识别及建筑填充（先 npm run build:single）。
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage']});
try{const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
await p.goto('file://'+process.cwd()+'/previz-lab.html?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.app?.roadPlanning,{timeout:60000});
await p.click('#scene-grid-toggle');assert.equal(await p.evaluate(()=>app.state.grid),true);await p.click('#scene-grid-toggle');
await p.click('#scene-snap-toggle');assert.equal(await p.evaluate(()=>app.state.roadSnap),true);await p.click('#scene-snap-toggle');
const r=await p.evaluate(()=>{const a=app;a.clearAll();a.roadBrush.restore([{points:[[-40,0,-40],[40,0,-40],[40,0,40],[-40,0,40],[-40,0,-40]],width:6,roadType:'asphalt'}]);const n=a.roadPlanning.detect().length;return{grid:a.state.grid,snap:a.state.roadSnap,n,count:a.roadPlanning.fillSelected('residential',20)};});
assert.equal(r.grid,false);assert.equal(r.snap,false);assert.equal(r.n,1);assert.ok(r.count>0);assert.deepEqual(errors,[]);console.log('PASS offline single-file planning:',JSON.stringify(r));}finally{await b.close();}
