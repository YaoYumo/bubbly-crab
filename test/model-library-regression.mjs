import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
fs.mkdirSync('.shots/library-fixture',{recursive:true});fs.mkdirSync('docs/model-library-evidence',{recursive:true});
const obj='mtllib sample.mtl\no LibraryCube\nv -1 0 -1\nv 1 0 -1\nv 1 2 -1\nv -1 2 -1\nv -1 0 1\nv 1 0 1\nv 1 2 1\nv -1 2 1\nusemtl Blue\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n';
fs.writeFileSync('.shots/library-fixture/LibraryCube.obj',obj);fs.writeFileSync('.shots/library-fixture/sample.mtl','newmtl Blue\nKd 0.2 0.4 0.9\nmap_Kd sample.png\n');
const buffer=Buffer.alloc(42);
[0,0,0,1,0,0,0,1,0].forEach((v,i)=>buffer.writeFloatLE(v,i*4));[0,1,2].forEach((v,i)=>buffer.writeUInt16LE(v,36+i*2));
const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.3,.7,.4,1]}}],buffers:[{byteLength:42}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}]};
const json=Buffer.from(JSON.stringify(gltf)),jsonPadded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(jsonPadded);const bin=Buffer.alloc(44);buffer.copy(bin);
const glb=Buffer.alloc(12+8+jsonPadded.length+8+bin.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(jsonPadded.length,12);glb.writeUInt32LE(0x4e4f534a,16);jsonPadded.copy(glb,20);let at=20+jsonPadded.length;glb.writeUInt32LE(bin.length,at);glb.writeUInt32LE(0x004e4942,at+4);bin.copy(glb,at+8);
fs.writeFileSync('.shots/library-fixture/Triangle.glb',glb);fs.writeFileSync('.shots/library-fixture/Triangle.bin',buffer);gltf.buffers[0].uri='Triangle.bin';fs.writeFileSync('.shots/library-fixture/Triangle.gltf',JSON.stringify(gltf));
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const p=await browser.newPage(),errors=[],violations=[];await p.setViewport({width:1600,height:1200});p.on('pageerror',e=>errors.push(e.message));
 await p.evaluateOnNewDocument(()=>{window.__libraryCSP=[];document.addEventListener('securitypolicyviolation',e=>__libraryCSP.push(e.effectiveDirective));});
 const url=process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/';
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted&&window.app?.modelLibrary,{timeout:90000});
 await p.evaluate(async()=>{app.suspended=true;app.state.playing=false;app.clearAll();app.terrain.setEnabled(false);await app.modelLibrary.ready;});
 const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=2;const g=c.getContext('2d');g.fillStyle='#7284ce';g.fillRect(0,0,2,2);return c.toDataURL().split(',')[1];});fs.writeFileSync('.shots/library-fixture/sample.png',Buffer.from(png,'base64'));
 const open=async()=>{if(await p.$eval('#library-scene',n=>n.style.display==='none'))await p.click('#lib-toggle');};await open();
 // Unified previews are actual neutral clay models, not unrelated static images.
 await p.waitForFunction(()=>document.querySelectorAll('.library-thumbnail[data-thumbnail="ready"]').length>=4,{timeout:90000});
 await p.screenshot({path:`docs/model-library-evidence/gallery-${process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web'}.png`});
 const before=await p.evaluate(()=>({scene:JSON.stringify(app.serialize({assets:false})),undo:(app._undo||[]).length,models:app.modelLibrary.meta.models.length}));
 await p.click('[data-library-new-group]');await p.type('input[aria-label="分组名称"]','测试道具');await p.click('.library-dialog footer .pri');await p.waitForSelector('.library-mask',{hidden:true});
 const groupId=await p.evaluate(()=>app.modelLibrary.meta.groups.find(g=>g.cat==='测试道具').id);
 await p.click('[data-library-import]');await p.waitForSelector('.library-dialog');
 assert.equal(await p.$eval('.library-import-group',n=>n.value),groupId);
 const files=await p.$('.library-file-input');await files.uploadFile('.shots/library-fixture/LibraryCube.obj','.shots/library-fixture/sample.mtl','.shots/library-fixture/sample.png');
 await p.click('[data-library-import-confirm]');await p.waitForSelector('.library-mask',{hidden:true,timeout:90000});
 assert.equal(await p.evaluate(()=>app.modelLibrary.meta.models.length),before.models+1);
 assert.equal(await p.evaluate(()=>JSON.stringify(app.serialize({assets:false}))),before.scene,'library import must not change the scene');assert.equal(await p.evaluate(()=>(app._undo||[]).length),before.undo,'library import must not pollute scene undo');
 const key=await p.evaluate(()=>app.modelLibrary.meta.models.at(-1).key);
 await p.waitForSelector(`[data-asset-key="${key}"] .library-thumbnail[data-thumbnail="ready"]`,{timeout:90000});
 await p.screenshot({path:`docs/model-library-evidence/imported-${process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web'}.png`});
 // Click placement, independent instances, original materials and embedded texture.
 await p.click(`[data-asset-key="${key}"] .library-place`);await p.waitForFunction(()=>app.objects.length===1);
 assert.equal(await p.evaluate(()=>app.objects[0].type),'import');assert.ok(await p.evaluate(()=>{let found=false;app.objects[0].root.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];if(ms.some(m=>m.map))found=true;}});return found;}));
 await p.evaluate(async key=>{const v=app.stage.orbit.target.clone();await app.addAsset(key,v);},key);assert.equal(await p.evaluate(()=>app.objects.length),2);
 await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.objects.length),1);await p.evaluate(()=>app.redo());assert.equal(await p.evaluate(()=>app.objects.length),2);
 // A genuine drag/drop routes through the same stored model path.
 await p.evaluate(key=>{const dt=new DataTransfer();dt.setData('text/asset',key);const c=app.stage.canvas,r=c.getBoundingClientRect();c.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));},key);await p.waitForFunction(()=>app.objects.length===3);
 const project=await p.evaluate(async()=>Array.from(await app.saveProject()));
 // Move to an existing built-in group, without changing the source key.
 await p.select(`[data-asset-key="${key}"] .library-move`,'cn');await p.waitForFunction(key=>app.modelLibrary.find(key)?.groupId==='cn',{},key);
 await p.evaluate(()=>app.saveLocal());
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted&&window.app?.modelLibrary,{timeout:90000});
 assert.equal(await p.evaluate(key=>app.modelLibrary.find(key)?.groupId,key),'cn');await p.evaluate(()=>app.suspended=true);
 await open();assert.equal(await p.evaluate(()=>app.objects.length),3);
 await p.evaluate(()=>{app.select({kind:'obj',so:app.objects[0]});app.duplicateSelected();});
 await p.type('#library-scene .search','LibraryCube');await p.waitForSelector(`[data-asset-key="${key}"]`);
 await p.click(`[data-asset-key="${key}"] .library-remove`);await p.keyboard.press('Escape');assert.ok(await p.evaluate(key=>!!app.modelLibrary.find(key),key));
 await p.click(`[data-asset-key="${key}"] .library-remove`);await p.click('[data-library-delete-confirm]');await p.waitForSelector('.library-mask',{hidden:true});assert.equal(await p.evaluate(key=>!!app.modelLibrary.find(key),key),false);
 assert.equal(await p.evaluate(()=>app.objects.length),4);await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.objects.length),3);
 // A portable project restores all resources even after deleting the source library entry.
 await p.evaluate(async bytes=>{app.clearAll();app.projectAssets.records.clear();await app.importFiles([new File([new Uint8Array(bytes)],'library-roundtrip.previz')]);},project);assert.equal(await p.evaluate(()=>app.objects.length),3);
 await p.evaluate(async()=>{app.removeObject(app.objects[0]);app.undo();await app.projectAssets.ready();});assert.equal(await p.evaluate(()=>app.objects.length),3);
 // Built-ins are hidden, not physically removed; placement/build keys remain valid.
 await p.$eval('#library-scene .search',n=>{n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));});
 const built=await p.$eval('.library-card:not([data-asset-key^="userlib:"])',n=>n.dataset.assetKey);
 await p.click(`[data-asset-key="${built}"] .library-remove`);await p.click('[data-library-delete-confirm]');await p.waitForSelector('.library-mask',{hidden:true});assert.equal(await p.evaluate(key=>app.modelLibrary.visible(key),built),false);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted&&window.app?.modelLibrary,{timeout:90000});await open();assert.equal(await p.evaluate(key=>app.modelLibrary.visible(key),built),false);
 await p.click('[data-library-restore]');await p.waitForFunction(key=>app.modelLibrary.visible(key),{},built);
 // Non-model/project files cannot replace the scene through the library pathway.
 const blocked=await p.evaluate(async id=>{const before=JSON.stringify(app.serialize({assets:false}));try{await app.modelLibrary.import([new File(['{}'],'wrong.json'),new File(['bad'],'x.glb')],id);return false;}catch{return before===JSON.stringify(app.serialize({assets:false}));}},groupId);assert.ok(blocked);
 // GLB and external-buffer GLTF enter the same library-only path. Duplicate
 // content shares one resource, and deleting one membership keeps the other usable.
 await p.click('[data-library-import]');await p.select('.library-import-group',groupId);
 const moreFiles=await p.$('.library-file-input');await moreFiles.uploadFile('.shots/library-fixture/Triangle.glb','.shots/library-fixture/Triangle.gltf','.shots/library-fixture/Triangle.bin');await p.click('[data-library-import-confirm]');await p.waitForSelector('.library-mask',{hidden:true,timeout:90000});
 const imported=await p.evaluate(()=>app.modelLibrary.meta.models.filter(m=>m.name==='Triangle').map(m=>({...m})));assert.equal(imported.length,2);assert.equal(new Set(imported.map(m=>m.assetId)).size,1);
 const oldCount=await p.evaluate(()=>app.objects.length);await p.evaluate(async models=>{await app.modelLibrary.remove(models[0].key);await app.addAsset(models[1].key,app.stage.orbit.target.clone());},imported);assert.equal(await p.evaluate(()=>app.objects.length),oldCount+1);
 const readOnly=await p.evaluate(async key=>{app.state.playing=true;const before=app.modelLibrary.meta.models.length;try{await app.modelLibrary.remove(key);return false;}catch{return before===app.modelLibrary.meta.models.length;}finally{app.state.playing=false;}},imported[1].key);assert.ok(readOnly);
 const conflict=await p.evaluate(async()=>{const count=app.modelLibrary.meta.groups.length;app.modelLibrary.meta.revision--;try{await app.modelLibrary.createGroup('冲突不应保存');return false;}catch(e){return e.message.includes('其他窗口')&&app.modelLibrary.meta.groups.length===count;}});assert.ok(conflict);
 assert.deepEqual(errors,[]);assert.deepEqual(await p.evaluate(()=>__libraryCSP),[]);
 const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';
 const report={platform:'Linux Chromium, not native Windows',unifiedActual3DThumbnails:true,customGroup:true,importOBJMTLTexture:true,importDoesNotChangeSceneOrUndo:true,clickAndDragPlacement:true,originalMaterialsRetained:true,moveBetweenGroups:true,reloadPersistence:true,deleteUserEntry:true,deleteDoesNotBreakSceneOrUndo:true,portableProjectAfterDeletion:true,hideAndRestoreBuiltins:true,projectImportBlocked:true,cancelDelete:true,concurrentWriteGuard:true,importGLBAndExternalGLTF:true,deduplicatedResourceDeletionSafe:true,readOnlyGuard:true,errors,csp:await p.evaluate(()=>__libraryCSP)};
 fs.writeFileSync(`docs/model-library-evidence/${mode}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
