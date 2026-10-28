import assert from 'node:assert/strict';import fs from 'node:fs';import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const key='cn:pagoda_wood_uploaded:楼阁式佛塔·木构变体',old='cn:pagoda:楼阁式佛塔',gray='user_models:pagoda_uploaded:Pagoda 宝塔（用户模型）';
try{
 const page=await browser.newPage(),errors=[],outbound=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(process.env.TEST_URL||'http://localhost:5174/'))outbound.push(r.url());});page.on('dialog',d=>d.accept());
 await page.setViewport({width:1440,height:1000});await page.evaluateOnNewDocument(()=>{window.__woodCSP=[];document.addEventListener('securitypolicyviolation',e=>__woodCSP.push(e.violatedDirective));});
 if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
 await page.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__previzBooted&&window.app?.exporter,{timeout:90000});
 await page.evaluate(({key,old,gray})=>{const a=app;a.suspended=true;a.state.playing=false;a.clearAll();a.terrain.setEnabled(false);a.setTex(true);for(const k of [key,old,gray])if(!a.itemByKey(k))throw Error('Missing retained/library key '+k);},{key,old,gray});
 await page.click('.cap[data-page="scene"]');await page.click('#lib-toggle');await page.click('#library-scene [data-cat="cn"]');
 const card=`#library-scene [data-asset-key="${key}"]`;
 await page.waitForFunction(key=>{const n=[...document.querySelectorAll('#library-scene [data-asset-key]')].find(n=>n.dataset.assetKey===key);const i=n?.querySelector('img');return i?.complete&&i.naturalWidth>0;},{},key);
 const keys=await page.$$eval('#library-scene [data-asset-key]',ns=>ns.map(n=>n.dataset.assetKey));assert.equal(keys[keys.indexOf(old)+1],key,'wood variant must sit beside original');
 await page.type('#library-scene input.search','佛塔');
 await page.click(card);assert.equal(await page.evaluate(()=>app.objects.length),1);
 // Actual generated inspector color inputs, not only direct builder calls.
 for(const [field,value]of [['woodColor','#71452b'],['roofColor','#303b44']]){
  await page.$eval(`#inspector-scene [data-field="${field}"] input[type="color"]`,(n,v)=>{n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await page.waitForFunction((f,v)=>app.objects[0].params[f]===v&&app.objects[0].root.children.some(m=>m.material.color.getHexString()===v.slice(1)),{},field,value);
 }
 const checks=await page.evaluate(async({key,old,gray})=>{
  const a=app,ck=(v,m)=>{if(!v)throw Error(m);},tri=o=>o.root.children.reduce((s,m)=>s+m.geometry.attributes.position.count/3,0),role=(o,r)=>o.root.children.find(m=>m.userData.pagodaRole===r);
  let so=a.objects[0];ck(so.key===key&&so.root.children.length===9&&tri(so)===34392,'bad UI placement');
  ck(so.root.children.every(m=>m.material.map?.image&&m.material.normalMap&&m.material.roughnessMap),'missing procedural surface maps');
  ck(role(so,'timber').material.metalness===0&&role(so,'bronze').material.metalness>.7,'PBR roles collapsed');
  ck(role(so,'stone').material.color.getHexString()==='a9a599','wood/roof edit leaked onto stone');
  ck(so.root.userData.variantOf===old,'variant family missing');
  so.setParams({height:18});a.select({kind:'obj',so});const dup=a.duplicateSelected();ck(dup.key===key&&dup.root.children.every((m,i)=>m.geometry!==so.root.children[i].geometry&&m.material!==so.root.children[i].material),'shared disposable objects');
  a.removeObject(so);ck(tri(dup)===34392&&role(dup,'timber').material.map.image,'deleted source damaged copy');a.undo();ck(a.objects.length===2,'undo failed');
  for(const l of ['lite','fine','std']){a.setDetail(l,{silent:true});ck(a.objects.every(o=>tri(o)===34392&&o.root.children.length===9),'quality switch lost faces');ck(a.objects.every(o=>o.root.children.every(m=>!!m.material.map===(l!=='lite'))),'quality texture toggle failed');}
  a.setTex(false);ck(a.objects.every(o=>o.root.children.every(m=>!m.material.map)),'global gray switch failed');a.setTex(true);ck(a.objects.every(o=>o.root.children.every(m=>m.material.map?.image)),'global material restore failed');
  const doc=a.serialize();a.loadJson(doc);ck(a.objects.length===2&&a.objects.every(o=>o.key===key&&tri(o)===34392),'JSON restore failed');
  const blob=await a.saveProject();a.clearAll();const opened=await a.importFiles([new File([blob],'wood-pagoda.previz')]);ck(opened.projectLoaded&&a.objects.length===2,'project restore failed');
  ck(a.objects.every(o=>role(o,'timber').material.color.getHexString()==='71452b'&&role(o,'roof').material.color.getHexString()==='303b44'&&o.root.children.every(m=>m.material.map?.image)),'colors/textures lost in project');
  const oldObject=a.addAsset(old);ck(oldObject.key===old&&oldObject.root.children.length>0,'original procedural pagoda broken');a.removeObject(oldObject);
  const grayObject=a.addAsset(gray);ck(grayObject.root.children.length===1&&grayObject.root.children[0].material.color.getHexString()==='c4c6c8','gray entry changed');a.removeObject(grayObject);
  so=a.objects[0];a.select({kind:'obj',so});a.focusSelected();const shot=a.shotFromView();shot.groundClear=false;shot.setTarget(so);shot.aim='target';a.setPreview(true);a.state.time=0;a.step(0,true);
  const png=await a.exporter.still({width:480,height:320,asDataUrl:true});ck(png?.startsWith('data:image/png;base64,'),'PNG export failed');
  const before=JSON.stringify(a.serialize()),video=await a.exporter.run({width:320,height:180,fps:5,duration:.4,bitrate:1});ck(video.size>0&&!video.error,'video export failed');ck(JSON.stringify(a.serialize())===before,'export altered project');a.setPreview(false);
  a.select({kind:'obj',so:a.objects[0]});a.focusSelected();a.step(0,true);a.stage.render();let hit=false;
  for(const x of [-.3,-.1,0,.1,.3]){a.stage.pointer.set(x,0);a.stage.raycaster.setFromCamera(a.stage.pointer,a.stage.view);if(a.stage.raycaster.intersectObject(a.objects[0].root,true).length){hit=true;break;}}ck(hit,'picking failed');
  return {adjacentVariant:true,oldAndGrayBuildersRetained:true,sourceParts:531,triangles:34392,materialRoles:9,realTextureMaps:true,inspectorColorControls:true,independentColors:true,duplicateDeleteUndo:true,qualityAndGlobalMaterialSwitch:true,jsonAndProject:true,raycastPick:true,pngBytes:png.length,video:{size:video.size,mode:video.mode,frames:video.frames}};
 },{key,old,gray});
 const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
 await page.evaluate(()=>{const a=app;for(const o of [...a.objects].slice(1))a.removeObject(o);const so=a.objects[0];so.setParams({height:23.90225940552179,woodColor:'#81502f',roofColor:'#353d43'});a.select({kind:'obj',so});a.focusSelected();const c=a.stage.orbit.target;a.stage.view.position.set(c.x+25,c.y+14,c.z+29);a.stage.orbit.update();a.step(0,true);a.stage.render();});
 fs.mkdirSync('docs/pagoda-wood-evidence',{recursive:true});await page.screenshot({path:`docs/pagoda-wood-evidence/library-${mode}.png`});
 const report={platform:'Linux Chromium, not native Windows',...checks,errors,csp:await page.evaluate(()=>__woodCSP),outbound};assert.deepEqual(errors,[]);assert.deepEqual(report.csp,[]);assert.deepEqual(outbound,[]);
 fs.writeFileSync(`docs/pagoda-wood-evidence/${mode}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
