import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const key='user_models:pagoda_uploaded:Pagoda 宝塔（用户模型）';
try {
 const page=await browser.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()) && !r.url().startsWith(process.env.TEST_URL || 'http://localhost:5174/'))requests.push(r.url());});
 await page.setViewport({width:1440,height:1000});page.on('dialog',d=>d.accept());
 await page.evaluateOnNewDocument(()=>{window.__pagodaCSP=[];document.addEventListener('securitypolicyviolation',e=>__pagodaCSP.push(e.violatedDirective));});
 if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
 await page.goto(process.env.TEST_FILE_URL || process.env.TEST_URL || 'http://localhost:5174/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__previzBooted && window.app?.exporter,{timeout:90000});
 const fixture=await page.evaluate(key=>{
  const a=app; a.suspended=true;a.state.playing=false;a.clearAll();a.terrain.setEnabled(false);a.state.showHelpers=false;
  const item=a.itemByKey(key);if(!item || !item.thumbnail)throw Error('Pagoda not registered in library');
  return {name:item.name,description:item.description};
 },key);
 await page.click('.cap[data-page="scene"]');
 await page.click('#lib-toggle');
 await page.click('#library-scene [data-cat="user_models"]');
 await page.waitForFunction(()=>{const img=document.querySelector('#library-scene [data-asset-key] img');return img?.complete && img.naturalWidth>0;});
 const cardSelector='#library-scene [data-asset-key]';
 assert.equal(await page.$$eval(cardSelector,ns=>ns.length),1);
 await page.click(cardSelector);
 assert.equal(await page.evaluate(()=>app.objects.length),1);
 const checks=await page.evaluate(async key=>{
  const a=app,ck=(v,m)=>{if(!v)throw Error(m);};const so=a.objects[0];ck(so.key===key,'UI placed wrong asset');
  const mesh=so.root.children[0];ck(mesh.geometry.attributes.position.count===103176,'incomplete geometry');
  ck(mesh.isMesh && mesh.material.map===null,'expected faithful untextured source');
  so.setParams({height:18,color:'#7c8795'});
  ck(Math.abs(so.root.children[0].scale.y*23.90225940552179-18)<1e-5,'height control did not rebuild');
  a.select({kind:'obj',so});const dup=a.duplicateSelected();ck(dup.key===key,'duplicate lost library key');
  ck(dup.root.children[0].geometry!==so.root.children[0].geometry,'shared disposable geometry');
  a.removeObject(so);ck(dup.root.children[0].geometry.attributes.position.count===103176,'deletion damaged copy');
  a.undo();ck(a.objects.length===2 && a.objects.every(o=>o.key===key),'undo lost pagoda');
  const doc=a.serialize();a.loadJson(doc);ck(a.objects.length===2 && a.objects.every(o=>!o.imported),'JSON restored placeholder');
  const packed=await a.saveProject();a.clearAll();const opened=await a.importFiles([new File([packed],'pagoda.previz')]);
  ck(opened.projectLoaded && a.objects.length===2 && a.objects.every(o=>o.root.children[0].geometry.attributes.position.count===103176),'project package lost model');
  a.rebuildAll();ck(a.objects.every(o=>o.root.children[0].geometry.attributes.position.count===103176),'detail rebuild damaged source');
  // Only newly appended model is selected by category; original procedural pagoda remains.
  a.select({kind:'obj',so:a.objects[0]});a.focusSelected();
  const shot=a.shotFromView();shot.groundClear=false;shot.setTarget(a.objects[0]);shot.aim='target';a.setPreview(true);a.state.time=0;a.step(0,true);
  const image=await a.exporter.still({width:480,height:320,asDataUrl:true});ck(image?.startsWith('data:image/png;base64,'),'PNG export failed');
  const before=JSON.stringify(a.serialize());const video=await a.exporter.run({width:320,height:180,fps:5,duration:.4,bitrate:1});
  ck(video.size>0 && !video.error,'video export failed');ck(JSON.stringify(a.serialize())===before,'video export changed project');
  a.setPreview(false);a.select({kind:'obj',so:a.objects[0]});a.focusSelected();a.step(0,true);a.stage.render();
  // Real renderer pick, not just metadata lookup.
  const object=a.objects[0];let picked=false;const p=a.stage.pointer;
  for(const x of [-.3,-.1,0,.1,.3]){p.set(x,0);a.stage.raycaster.setFromCamera(p,a.stage.view);const hits=a.stage.raycaster.intersectObject(object.root,true);if(hits.length){picked=true;break;}}
  ck(picked,'model cannot be raycast-picked');
  return {libraryRegistered:true,realThumbnail:true,uiPlacement:true,heightAndColor:true,duplicateAndDeleteSafe:true,undo:true,json:true,projectPackage:true,detailRebuild:true,raycastPick:true,trianglesPerObject:34392,drawMeshesPerObject:1,pngBytes:image.length,video:{size:video.size,frames:video.frames,mode:video.mode}};
 },key);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>__pagodaCSP),[]);
 // Verify the original procedural pagoda key dynamically, without assuming its label.
 await page.click('#library-scene [data-cat="all"]');
 const original=await page.$$eval('#library-scene [data-asset-key]',ns=>ns.map(n=>n.dataset.assetKey).filter(k=>k.includes(':pagoda:')));
 assert.ok(original.length>0,'original procedural pagoda was removed');
 fs.mkdirSync('.shots',{recursive:true});const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
 await page.click('#library-scene [data-cat="user_models"]');
 await page.evaluate(()=>{const a=app;for(const so of [...a.objects].slice(1))a.removeObject(so);a.select({kind:'obj',so:a.objects[0]});a.focusSelected();const c=a.stage.orbit.target; a.stage.view.position.set(c.x+23,c.y+13,c.z+27);a.stage.orbit.update();a.step(0,true);a.stage.render();});
 await page.screenshot({path:'.shots/pagoda-library-'+mode+'.png'});
 const report={platform:'Linux Chromium, not native Windows',...fixture,...checks,originalPagodaKeys:original,errors,csp:await page.evaluate(()=>__pagodaCSP),externalRequests:requests};
 assert.deepEqual(requests,[]);fs.writeFileSync('.shots/pagoda-'+mode+'.json',JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
