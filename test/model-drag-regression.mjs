import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:120000});
const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1568,height:900});
 await p.evaluateOnNewDocument(()=>{window.__dragCSP=[];document.addEventListener('securitypolicyviolation',e=>__dragCSP.push(e.effectiveDirective));});
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__previzBooted&&window.app?.modelLibrary,{timeout:90000});
 await p.evaluate(async()=>{app.suspended=true;app.state.playing=false;await app.modelLibrary.ready;app.clearAll();app.terrain.setWater(false);});
 if(await p.$eval('#library-scene',n=>n.style.display==='none'))await p.click('#lib-toggle');await p.select('.library-group-filter','cn');
 const cards=await p.$$eval('.library-card',ns=>ns.map(n=>({key:n.dataset.assetKey,attribute:n.getAttribute('draggable'),draggable:n.draggable})));
 assert.ok(cards.length>0&&cards.every(n=>n.draggable&&n.attribute==='true'),'Model cards must have effective draggable="true", not an empty enumerated attribute');
 await p.setDragInterception(true);
 const target=await p.$eval('#stage canvas',n=>{const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width*.57),y:Math.round(r.top+r.height*.68)};});
 async function drag(key,kind){
  const source=await p.$eval(`[data-asset-key="${key}"] .${kind}`,n=>{n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  const before=await p.evaluate(target=>{const a=app,r=a.stage.canvas.getBoundingClientRect(),ndc=a.stage.pointer.clone().set((target.x-r.left)/r.width*2-1,-(target.y-r.top)/r.height*2+1);return{count:a.objects.length,undo:(a._undo||[]).length,expected:a.dropPoint(ndc).toArray()};},target);
  const data=await p.mouse.drag(source,target);
  assert.ok(data.items.some(i=>i.mimeType==='text/asset'&&i.data===key),'Real dragstart must carry the source model key');
  await p.mouse.dragEnter(target,data);await p.mouse.dragOver(target,data);await p.mouse.drop(target,data);await p.mouse.up();
  await p.waitForFunction(count=>app.objects.length===count+1,{},before.count);
  const result=await p.evaluate(key=>{const so=app.objects.at(-1);return{sourceMatches:key.startsWith('userlib:')?so.params.assetId===app.modelLibrary.find(key).assetId:so.key===key,position:so.root.position.toArray(),undo:(app._undo||[]).length};},key);
  assert.ok(result.sourceMatches,'Placed instance must match the dragged source');
  assert.ok(Math.abs(result.position[0]-before.expected[0])<.001&&Math.abs(result.position[2]-before.expected[2])<.001,'Drop must use cursor ground/terrain position, not viewport focus: '+JSON.stringify({actual:result.position,expected:before.expected}));
  assert.equal(result.undo,before.undo+1,'A drag must place exactly once and add one undo operation');
  await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.objects.length),before.count);await p.evaluate(()=>app.redo());assert.equal(await p.evaluate(()=>app.objects.length),before.count+1);
  return {key,position:result.position,onePlacement:true,undoRedo:true};
 }
 const builtin=await drag(cards[0].key,'library-thumbnail');
 // Name text is draggable too, not only the image; this is a native pointer drag.
 const label=await drag(cards[1].key,'nm');
 // Store a real local OBJ through the library API, then drag its actual card.
 const customKey=await p.evaluate(async()=>{const text='o DragCube\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';await app.modelLibrary.import([new File([text],'DragCube.obj',{type:'text/plain'})],'my_models');return app.modelLibrary.meta.models.find(m=>m.name==='DragCube').key;});
 await p.select('.library-group-filter','my_models');
 const imported=await drag(customKey,'library-thumbnail');
 // Clicking still places once after returning from a drag, and control dragstart
 // cannot leak a model payload (delete/move remain buttons rather than sources).
 const count=await p.evaluate(()=>app.objects.length);await p.click(`[data-asset-key="${customKey}"] .library-place`);assert.equal(await p.evaluate(()=>app.objects.length),count+1);
 const outside=await p.$eval('#top',n=>{const r=n.getBoundingClientRect();return{x:Math.round(r.left+25),y:Math.round(r.top+15)};});
 const source=await p.$eval(`[data-asset-key="${customKey}"] .library-thumbnail`,n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
 const cancelCount=await p.evaluate(()=>app.objects.length);
 const outsideData=await p.mouse.drag(source,outside);await p.mouse.dragEnter(outside,outsideData);await p.mouse.dragOver(outside,outsideData);await p.mouse.drop(outside,outsideData);await p.mouse.up();assert.equal(await p.evaluate(()=>app.objects.length),cancelCount);
 await p.mouse.drag(source,target);await p.keyboard.press('Escape');await p.mouse.up();assert.equal(await p.evaluate(()=>app.objects.length),cancelCount);
 const guarded=await p.$eval(`[data-asset-key="${customKey}"] .library-remove`,n=>{const dt=new DataTransfer(),e=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt});n.dispatchEvent(e);return e.defaultPrevented&&!dt.types.includes('text/asset');});assert.ok(guarded);
 assert.deepEqual(errors,[]);assert.deepEqual(await p.evaluate(()=>__dragCSP),[]);
 const report={platform:'Linux Chromium, not native Windows',realPointerDrag:true,draggableEnumeratedAttribute:true,builtin,label,imported,clickStillPlacesOnce:true,dropOutsideDoesNotPlace:true,cancelDoesNotPlace:true,cardControlsGuarded:true,errors,csp:await p.evaluate(()=>__dragCSP)};
 fs.mkdirSync('docs/model-drag-evidence',{recursive:true});fs.writeFileSync(`docs/model-drag-evidence/${mode}.json`,JSON.stringify(report,null,2)+'\n');console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
