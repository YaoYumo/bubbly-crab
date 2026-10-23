import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try {
  const page = await browser.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.setViewport({width:1440,height:1000});
  await page.evaluateOnNewDocument(()=>{window.__usabilityCSP=[];document.addEventListener('securitypolicyviolation',e=>__usabilityCSP.push(e.violatedDirective));});
  if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || process.env.TEST_URL || 'http://localhost:5174/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__previzBooted && window.app?.cameraEdit,{timeout:90000});
  await page.evaluate(()=>{
    const a=app; a.suspended=true;a.state.playing=false;a.clearAll();a.terrain.setEnabled(false);a.state.duration=6;
    a._suspendUndo=true;
    const keys=n=>Array.from({length:n},(_,i)=>({t:i/(n-1),p:[i,0,0],q:[0,0,0,1]}));
    const first=a.addShot({name:'宽轨镜头 A',duration:3,keys:keys(2)});
    a.addShot({name:'宽轨镜头 B',duration:3,keys:keys(2)});
    for(let i=0;i<3;i++) {const o=a.addAsset('house:adobe:Adobe 土坯平顶房',[i*10,0,0]);a.setMotion(o,{active:true,keys:keys(i===0?5:40)});}
    a.setActiveShot(first);a.select({kind:'shot',shot:first});a.cameraEdit.assemble();a.setPreview(true);
    a._suspendUndo=false;
  });
  await page.waitForFunction(()=>document.querySelector('[data-cut-track]').clientHeight>=76);
  const metrics=()=>page.evaluate(()=>{
    const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
    return {panel:box(document.querySelector('#bottom')),track:box(document.querySelector('[data-cut-track]')),clip:box(document.querySelector('.tclip')),trim:box(document.querySelector('.tclip-trim')),ruler:box(document.querySelector('[data-cut-ruler]')),keyHidden:document.querySelector('.cut-key-row').hidden,videoKeyCount:document.querySelector('[data-cut-track]').querySelectorAll('.tk').length,keys:document.querySelectorAll('.cut-key-track .tk').length,documentWidth:document.documentElement.scrollWidth};
  });
  const initial=await metrics();assert.ok(initial.track.h>=76);assert.ok(initial.clip.h>=64);assert.ok(initial.trim.w>=12);
  assert.equal(initial.videoKeyCount,0);assert.equal(initial.keys,0);assert.equal(initial.keyHidden,true);
  assert.ok(Math.abs(initial.ruler.x-initial.track.x)<=2);
  assert.match(await page.$eval('.cut-clip-time',n=>n.textContent),/3(?:\.0+)?s/);
  // Default remains uncluttered even when single-shot mode has source-camera keys.
  await page.evaluate(()=>app.cameraEdit.setEnabled(false));
  assert.equal(await page.$$eval('.tk',ns=>ns.length),0);
  await page.click('[data-cut-action="keys"]');
  assert.equal(await page.$$eval('.cut-key-track .tk',ns=>ns.length),2);
  await page.evaluate(()=>app.select({kind:'obj',so:app.objects[0]}));
  assert.equal(await page.$$eval('.cut-key-track .tk',ns=>ns.length),5);
  assert.equal((await metrics()).videoKeyCount,0);
  await page.evaluate(()=>app.select({kind:'obj',so:app.objects[1]}));
  assert.equal(await page.$$eval('.cut-key-track .tk',ns=>ns.length),40); // Selected only, not all 85 object keys.
  assert.equal((await metrics()).videoKeyCount,0);
  await page.click('[data-cut-action="keys"]');
  assert.equal(await page.$$eval('.tk',ns=>ns.length),0);
  await page.evaluate(()=>app.cameraEdit.setEnabled(true));
  // A click or tiny hand jitter must never move/crop a clip or create an undo step.
  const before=await page.evaluate(()=>({edit:JSON.stringify(app.cameraEdit.toJSON()),undo:app._undo?.length || 0}));
  let r=await (await page.$('.tclip')).boundingBox();
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+2,r.y+r.height/2);await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>({edit:JSON.stringify(app.cameraEdit.toJSON()),undo:app._undo?.length || 0})),before);
  assert.ok(Math.abs(await page.evaluate(()=>app.state.time)-1.5)<.03);
  // Dedicated ruler scrubs a fully occupied track without starting a clip drag.
  r=await (await page.$('[data-cut-ruler]')).boundingBox();
  await page.mouse.move(r.x+r.width*.2,r.y+10);await page.mouse.down();await page.mouse.move(r.x+r.width*.25,r.y+10,{steps:4});await page.mouse.up();
  assert.ok(Math.abs(await page.evaluate(()=>app.state.time)-1.5)<.01);
  await page.click('[data-cut-action="split"]');assert.equal(await page.evaluate(()=>app.cameraEdit.clips.length),3);
  await page.evaluate(()=>app.undo());
  // Zoom/scroll ruler and clip coordinates must still map to the same world time.
  await page.click('[data-cut-action="zoom-in"]');await page.click('[data-cut-action="zoom-in"]');
  await page.waitForFunction(w=>document.querySelector('[data-cut-track]').getBoundingClientRect().width>w*3,{},initial.track.w);
  await page.evaluate(()=>document.querySelector('.cut-viewport').scrollLeft=900);
  const seek=await page.evaluate(()=>{const v=document.querySelector('.cut-viewport').getBoundingClientRect(),r=document.querySelector('[data-cut-ruler]').getBoundingClientRect(),t=document.querySelector('[data-cut-track]').getBoundingClientRect();const x=v.left+150;return {x,y:r.y+10,time:(x-t.left)/t.width*app.state.duration};});
  await page.mouse.click(seek.x,seek.y);assert.ok(Math.abs(await page.evaluate(()=>app.state.time)-seek.time)<.005);
  assert.ok((await metrics()).documentWidth<=1440);
  // Clicking a partly visible, oversized clip must not jump horizontal scroll.
  await page.evaluate(()=>document.querySelector('.cut-viewport').scrollLeft=1900);
  const second=await page.$$('.tclip'),secondBox=await second[1].boundingBox();
  const scrollBefore=await page.$eval('.cut-viewport',n=>n.scrollLeft);
  await page.mouse.click(secondBox.x+80,secondBox.y+secondBox.height/2);
  assert.equal(await page.$eval('.cut-viewport',n=>n.scrollLeft),scrollBefore,'clip focus jumped horizontal scroll');
  // Trimming after horizontal scroll uses the zoomed track width, not the window width.
  await page.evaluate(()=>{const v=document.querySelector('.cut-viewport');v.scrollLeft=v.scrollWidth;});
  const grips=await page.$$('.tclip-trim-r'),grip=await grips[1].boundingBox();
  const span=await page.$eval('[data-cut-track]',n=>n.getBoundingClientRect().width);
  const originalEnd=await page.evaluate(()=>app.cameraEdit.clips[1].end);
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2-100,grip.y+grip.height/2,{steps:4});await page.mouse.up();
  const expectedEnd=originalEnd+Math.round(-100/span*6*30)/30;
  assert.ok(Math.abs(await page.evaluate(()=>app.cameraEdit.clips[1].end)-expectedEnd)<1e-6,'zoomed trim uses wrong coordinates');
  await page.evaluate(()=>app.undo());
  await page.click('[data-cut-action="zoom-fit"]');
  assert.equal(await page.$eval('.cut-viewport',n=>n.scrollLeft),0);
  assert.ok(Math.abs((await metrics()).track.w-initial.track.w)<2);
  // Panel resize increases the actual clip row, not just empty footer padding.
  const handle=await (await page.$('.tl-resize')).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y-65,{steps:4});await page.mouse.up();
  const taller=await metrics();assert.ok(taller.track.h>initial.track.h+50);
  for(const width of [1280,1024]) {
    await page.setViewport({width,height:768});await page.evaluate(()=>document.documentElement.style.removeProperty('--tl-h'));
    await page.waitForFunction(()=>document.querySelector('[data-cut-track]').clientHeight>=76);
    const m=await metrics();assert.ok(m.documentWidth<=width);assert.ok(m.clip.h>=64);
    const tools=await page.$eval('.cut-tools',n=>{const r=n.getBoundingClientRect();return {bottom:r.bottom,height:r.height};});
    assert.ok(tools.bottom<=768 && tools.height>=28,'toolbar clipped at '+width);
  }
  await page.setViewport({width:1440,height:1000});
  const report={platform:'Linux Chromium, not native Windows',initial,taller,hiddenKeysByDefault:true,selectedKeysOnly:true,noKeysOnVideoTrack:true,clickWithoutEdit:true,rulerScrubAndSplit:true,zoomScrollCoordinates:true,zoomedTrim:true,noFocusScrollJump:true,resizableTrack:true,narrowWindows:true,csp:await page.evaluate(()=>__usabilityCSP),errors};
  assert.deepEqual(report.csp,[]);assert.deepEqual(errors,[]);
  mkdirSync('.shots',{recursive:true});
  const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
  await page.screenshot({path:'.shots/timeline-usability-'+mode+'.png'});
  writeFileSync('.shots/timeline-usability-'+mode+'.json',JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
