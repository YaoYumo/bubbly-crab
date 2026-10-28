import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(()=>{window.__triggerCSP=[];document.addEventListener('securitypolicyviolation',e=>__triggerCSP.push(e.effectiveDirective));});
  await page.setViewport({width:1440,height:1000});
  if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__previzBooted&&window.app?.radialMenu,{timeout:90000});
  await page.evaluate(()=>{
    app.suspended=true;app.state.playing=false;app.clearAll();app.terrain.setEnabled(false);
    window.__menuNotices=[];const notify=app.notify;app.notify=function(text,...args){__menuNotices.push(text);return notify.call(this,text,...args);};
  });
  const position=await page.evaluate(()=>{const r=app.stage.canvas.getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+r.height*.4};});
  const {x,y}=position;
  const opened=()=>page.evaluate(()=>app.radialMenu.isOpen);
  const context=buttons=>page.evaluate(({x,y,buttons})=>{
    const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,composed:true,button:2,buttons,clientX:x,clientY:y});
    app.stage.canvas.dispatchEvent(e);return e.defaultPrevented;
  },{x,y,buttons});
  // Actual stationary right hold: no arbitrary 900ms cutoff and no menu before release.
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(await opened(),false);
  await page.mouse.up({button:'right'});assert.equal(await opened(),true);
  // A late contextmenu does not replace menu nodes/focus after pointerup opened it.
  assert.equal(await page.evaluate(({x,y})=>{
    const first=document.querySelector('.radial-menu').firstElementChild;
    app.stage.canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y}));
    return document.querySelector('.radial-menu').firstElementChild===first;
  },position),true);
  await page.keyboard.press('Escape');
  // Contextmenu-only browser delivery (simulated event order, not a real OS trackpad).
  assert.equal(await context(0),true);assert.equal(await opened(),true);await page.keyboard.press('Escape');
  // Right-down native contextmenu must not steal the start of a pan.
  await page.mouse.down({button:'right'});await context(2);assert.equal(await opened(),false);
  const beforePan=await page.evaluate(()=>app.stage.orbit.target.toArray());
  await page.mouse.move(x+70,y+20,{steps:5});await page.mouse.move(x,y,{steps:5});await page.mouse.up({button:'right'});
  assert.equal(await opened(),false); // Even when a drag returns to its starting pixel.
  await context(0);assert.equal(await opened(),false); // Delayed post-pan contextmenu.
  // Verify ordinary panning really still moves, not just that the menu stayed hidden.
  await page.mouse.down({button:'right'});await page.mouse.move(x+70,y+20,{steps:5});await page.mouse.up({button:'right'});
  assert.notDeepEqual(await page.evaluate(()=>app.stage.orbit.target.toArray()),beforePan);
  assert.equal(await opened(),false);
  // Missing pointerup compatibility: a released-button contextmenu finalizes the gesture.
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});await context(0);
  assert.equal(await opened(),true);await page.mouse.up({button:'right'});await page.keyboard.press('Escape');
  // Editing guards must stay intact, but now explain themselves rather than silently vanishing.
  await page.evaluate(()=>app.roadBrush.start());
  const roadUndo=await page.evaluate(()=>app._undo?.length||0);
  await page.mouse.click(x,y,{button:'right'});assert.equal(await opened(),false);
  assert.match(await page.evaluate(()=>__menuNotices.at(-1)),/道路.*Enter.*Esc/);
  assert.equal(await page.evaluate(()=>app._undo?.length||0),roadUndo);
  await page.evaluate(()=>{app.roadBrush.stop();app.state.playing=true;});
  await page.mouse.click(x,y,{button:'right'});assert.equal(await opened(),false);
  assert.match(await page.evaluate(()=>__menuNotices.at(-1)),/暂停/);
  await page.evaluate(()=>{app.state.playing=false;app.exporter.running=true;});
  await page.click('.viewport-operations');assert.equal(await opened(),false);
  assert.match(await page.evaluate(()=>__menuNotices.at(-1)),/导出/);
  await page.evaluate(()=>app.exporter.running=false);
  // Entry button and physical right click remain usable after leaving the blocked state.
  await page.click('.viewport-operations');assert.equal(await opened(),true);await page.keyboard.press('Escape');
  await page.mouse.click(x,y,{button:'right'});assert.equal(await opened(),true);await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>__triggerCSP),[]);
  const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
  const report={platform:'Linux Chromium, not native Windows mouse/trackpad',longStationaryRightHold:true,contextOnlyFallback:true,contextOnlyAndMissingUpAreSimulated:true,missingPointerupFallback:true,noDuplicateReopen:true,rightDownDoesNotOpen:true,rightPanAndReturnToStartPreserved:true,delayedPostPanSuppressed:true,blockedReasonVisible:true,blockedRoadDoesNotAddUndo:true,launcherAndRightClickRecover:true,errors,csp:await page.evaluate(()=>__triggerCSP)};
  fs.mkdirSync('.shots',{recursive:true});fs.writeFileSync(`.shots/radial-trigger-${mode}.json`,JSON.stringify(report,null,2));
  console.log('PASS radial trigger',mode,report);
}finally{await browser.close();}
