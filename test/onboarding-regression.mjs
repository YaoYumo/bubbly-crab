import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
fs.mkdirSync('docs/onboarding-evidence',{recursive:true});
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try {
  const p=await browser.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.setViewport({width:1440,height:1000});
  await p.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});window.__tourCSP=[];document.addEventListener('securitypolicyviolation',e=>__tourCSP.push(e.effectiveDirective));});
  if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
  const url=process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/';
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__previzBooted&&app.onboarding.isOpen,{timeout:90000});
  assert.equal(await p.$('.tg-mask'),null,'first-run guide replaces the old auto-generation dialog');
  const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
  await p.screenshot({path:`docs/onboarding-evidence/welcome-${mode}.png`});
  await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>app.onboarding.isOpen),false);
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted,{timeout:90000});
  assert.equal(await p.evaluate(()=>app.onboarding.isOpen),false,'skip persists across reload');
  await p.evaluate(()=>{app.suspended=true;app.clearAll();app.terrain.setEnabled(false);const so=app.addAsset('cn:earthterrace:夯土台基');app.addShot({name:'Guide must not edit this camera'});app.select({kind:'obj',so});app.step(0,true);app.stage.render();});
  const baseline=await p.evaluate(()=>({scene:JSON.stringify(app.serialize({assets:false})),undo:(app._undo||[]).length,selection:app.selObj.id,page:document.querySelector('#app').dataset.page,library:document.querySelector('#library-scene').style.display,pos:app.stage.view.position.toArray(),quat:app.stage.view.quaternion.toArray(),target:app.stage.orbit.target.toArray()}));
  await p.evaluate(()=>app.openViewportTools());await p.click('[data-onboarding-open]');await p.waitForSelector('.tour-card');
  await p.keyboard.press('Tab');assert.match(await p.evaluate(()=>document.activeElement.textContent),/跳过/);await p.keyboard.down('Shift');await p.keyboard.press('Tab');await p.keyboard.up('Shift');assert.match(await p.evaluate(()=>document.activeElement.textContent),/开始导览/);
  await p.keyboard.press('c');await p.keyboard.press('Delete');
  await p.click('[data-tour-next]');
  const titles=[];
  for(let i=0;i<9;i++){
    await p.waitForFunction(()=>document.activeElement?.hasAttribute('data-tour-next'));
    const title=await p.$eval('#tour-title',n=>n.textContent);titles.push(title);
    if(i===2){await p.setViewport({width:800,height:600});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
    const fit=await p.$eval('.tour-card',n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});assert.ok(fit,`${title} must fit`);
    if(i===1)await p.screenshot({path:`docs/onboarding-evidence/library-step-${mode}.png`});
    if(i===2){await p.setViewport({width:1440,height:1000});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
    if(i===4){await p.click('.tour-card footer .fbtn:not(.pri)');await p.waitForFunction(()=>document.querySelector('#tour-title').textContent==='建立机位与运镜');await p.click('[data-tour-next]');}
    await p.click('[data-tour-next]');
  }
  assert.equal(await p.evaluate(()=>app.onboarding.isOpen),false);
  const after=await p.evaluate(()=>({scene:JSON.stringify(app.serialize({assets:false})),undo:(app._undo||[]).length,selection:app.selObj.id,page:document.querySelector('#app').dataset.page,library:document.querySelector('#library-scene').style.display,pos:app.stage.view.position.toArray(),quat:app.stage.view.quaternion.toArray(),target:app.stage.orbit.target.toArray()}));
  assert.equal(after.scene,baseline.scene);assert.equal(after.undo,baseline.undo);assert.equal(after.selection,baseline.selection);assert.equal(after.page,baseline.page);assert.equal(after.library,baseline.library);assert.deepEqual(after.pos,baseline.pos);assert.deepEqual(after.target,baseline.target);
  assert.ok(after.quat.every((v,i)=>Math.abs(v-baseline.quat[i])<1e-12));
  // Storage-disabled dismissal remains functional; no export/preview interruption.
  await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('storage unavailable');};try{app.onboarding.start();app.onboarding.close();}finally{Storage.prototype.setItem=set;}});
  await p.evaluate(()=>{app.exporter.running=true;app.onboarding.start();});assert.equal(await p.evaluate(()=>app.onboarding.isOpen),false);await p.evaluate(()=>app.exporter.running=false);
  await p.evaluate(()=>app.onboarding.start());await p.click('.tour-skip');assert.equal(await p.evaluate(()=>app.onboarding.isOpen),false);
  assert.equal(await p.$$eval('#top button',n=>n.length),7);
  assert.deepEqual(errors,[]);assert.deepEqual(await p.evaluate(()=>__tourCSP),[]);
  const report={platform:'Linux Chromium (not native Windows UI)',autoFirstVisit:true,skipPersists:true,reopenFromTools:true,steps:titles,backAndNext:true,keyboardTrap:true,escape:true,narrowWindow:true,noSceneChanges:true,noUndoOrSelectionChanges:true,restoresPageLibraryAndView:true,blockedStorageSafe:true,exportGuard:true,topStillSevenButtons:true,errors,csp:await p.evaluate(()=>__tourCSP)};
  fs.writeFileSync(`docs/onboarding-evidence/${mode}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
} finally {await browser.close();}
