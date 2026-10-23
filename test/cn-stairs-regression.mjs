import assert from 'node:assert/strict';import fs from 'node:fs';import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const page=await b.newPage(),errors=[],outbound=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(process.env.TEST_URL||'http://localhost:5174/'))outbound.push(r.url());});page.on('dialog',d=>d.accept());
 await page.setViewport({width:1440,height:1000});await page.evaluateOnNewDocument(()=>{window.__stairCSP=[];document.addEventListener('securitypolicyviolation',e=>__stairCSP.push(e.violatedDirective));});
 if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
 await page.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__previzBooted&&window.app?.exporter,{timeout:90000});
 const checks=await page.evaluate(async()=>{
  const a=app,ck=(v,m)=>{if(!v)throw Error(m);};a.suspended=true;a.state.playing=false;a.clearAll();a.terrain.setEnabled(false);
  const specs=[['hall','宫殿大殿','steps'],['hall2','歇山殿宇','steps'],['gate','城门楼','ramp'],['citywall','城墙敌台','stairs'],['earthterrace','夯土台基','stairs']];const results=[];
  const valid=o=>{ck(o.root.userData.stairCheeks?.length>=2,'missing sloping cheeks '+o.type);for(const p of o.root.userData.stairCheeks){ck(Object.values(p).filter(v=>typeof v==='number').every(Number.isFinite),'invalid profile');ck(p.yHigh>p.yLow&&p.yLow>p.baseY,'non-sloping side wall');ck(p.yLow-p.baseY<1.5,'toe still a tall wall');}o.root.traverse(n=>{if(n.isMesh)for(const v of n.geometry.attributes.position.array)ck(Number.isFinite(v),'NaN geometry');});};
  for(const [type,name,flag]of specs){
   const key=`cn:${type}:${name}`,o=a.addAsset(key);valid(o);results.push({key,profiles:o.root.userData.stairCheeks.length});
   o.setParams({[flag]:false});ck(!o.root.userData.stairCheeks?.length,'disabled stairs left orphan cheeks');o.setParams({[flag]:true});valid(o);
   if(type.startsWith('hall'))for(const tiers of [1,2,3])for(const h of [.36,1.2,2.2]){o.setParams({tiers,plinthH:h});valid(o);if(tiers>1)ck(o.root.userData.stairCheeks.some(p=>p.baseY>0),'tier flight wrongly extended to ground');}
   if(type==='earthterrace')for(const h of [1.2,9]){
    o.setParams({h,w:4});valid(o);o.root.updateMatrixWorld(true);
    const ray=a.stage.raycaster,pos=o.root.position;ray.ray.origin.set(pos.x,pos.y+h+.45,pos.z+o.params.d/2+.6);ray.ray.direction.set(0,0,-1);ray.near=0;ray.far=1;
    ck(ray.intersectObject(o.root,true).length===0,'front rail blocks stair exit');ray.far=Infinity;
   }
   if(type==='gate')for(const wallH of [4,14]){o.setParams({wallH});valid(o);ck(o.root.userData.stairCheeks.every(p=>p.zLow<p.zHigh),'gate slope reversed');}
   if(type==='citywall')for(const height of [4,14]){o.setParams({height});valid(o);}
   a.removeObject(o);
  }
  // All CN entries still construct, including composite courtyards which reuse the hall builder.
  const cnKeys=["hall:宫殿大殿", "hall2:歇山殿宇", "pavilion:攒尖亭", "paifang:牌楼牌坊", "pagoda:楼阁式佛塔", "pagoda_wood_uploaded:楼阁式佛塔·木构变体", "gate:城门楼", "citywall:城墙敌台", "corridor:彩画回廊", "archbridge:石拱桥", "drumtower:鼓楼钟楼", "courtyard:四合院单元", "moongate:月亮门院墙", "lanternpole:宫灯杆", "earthterrace:夯土台基", "folkhouse:民居硬山", "streetshop:街市铺面", "ding:鼎 / 香炉", "spiritway:石像生神道"];
  for(const suffix of cnKeys){const o=a.addAsset('cn:'+suffix);ck(o.root.isObject3D,'old CN entry broken');a.removeObject(o);}
  const key='cn:earthterrace:夯土台基',o=a.addAsset(key);a.select({kind:'obj',so:o});const copy=a.duplicateSelected();valid(copy);a.removeObject(o);valid(copy);a.undo();ck(a.objects.length===2,'undo failed');
  const doc=a.serialize();a.loadJson(doc);a.objects.forEach(valid);
  const pkg=await a.saveProject();a.clearAll();const opened=await a.importFiles([new File([pkg],'cn-sloping-stairs.previz')]);ck(opened.projectLoaded&&a.objects.length===2,'project restore failed');a.objects.forEach(valid);
  for(const l of ['lite','fine','std']){a.setDetail(l,{silent:true});a.objects.forEach(valid);}
  a.select({kind:'obj',so:a.objects[0]});a.focusSelected();const shot=a.shotFromView();shot.groundClear=false;shot.setTarget(a.objects[0]);shot.aim='target';a.setPreview(true);a.state.time=0;a.step(0,true);
  const png=await a.exporter.still({width:480,height:320,asDataUrl:true});ck(png?.startsWith('data:image/png;base64,'),'PNG export failed');
  const video=await a.exporter.run({width:320,height:180,fps:5,duration:.4,bitrate:1});ck(video.size>0&&!video.error,'video export failed');a.setPreview(false);
  return {buildings:results,parameterExtremes:true,disableStairs:true,tierLandings:true,gateReverseSlope:true,oldCNEntriesRetained:true,allCNEntriesConstructed:cnKeys.length,terraceExitOpen:true,duplicateDeleteUndo:true,jsonAndProject:true,qualityRebuild:true,pngBytes:png.length,video:{size:video.size,frames:video.frames}};
 });
 const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';const report={platform:'Linux Chromium, not native Windows',...checks,errors,outbound,csp:await page.evaluate(()=>__stairCSP)};assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);assert.deepEqual(report.csp,[]);fs.mkdirSync('docs/cn-stairs-evidence',{recursive:true});fs.writeFileSync(`docs/cn-stairs-evidence/${mode}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await b.close();}
