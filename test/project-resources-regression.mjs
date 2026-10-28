import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const errors=[];
try {
 const p=await b.newPage();await p.setViewport({width:1440,height:1000});p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.__previzBooted);
 const result=await p.evaluate(async()=>{
   const a=window.app;a.clearAll();
   // Actual OBJ + MTL + companion PNG; no network lookup or original-file reuse.
   const cv=document.createElement('canvas');cv.width=cv.height=512;const ctx=cv.getContext('2d'),im=ctx.createImageData(512,512);let seed=991;for(let i=0;i<im.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;im.data[i]=seed&255;im.data[i+1]=(seed>>>8)&255;im.data[i+2]=(seed>>>16)&255;im.data[i+3]=255;}ctx.putImageData(im,0,0);
   const png=await new Promise(r=>cv.toBlob(r,'image/png'));
   const obj='mtllib sample.mtl\no triangle\nv 0 0 0\nv 2 0 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl textured\nf 1/1 2/2 3/3\n';
   const files=[new File([obj],'sample.obj'),new File(['newmtl textured\nKd 0.8 0.7 0.6\nmap_Kd red.png\n'],'sample.mtl'),new File([png],'red.png',{type:'image/png'})];
   const imported=await a.importFiles(files);if(imported.length!==1)throw new Error('fixture import failed');
   const so=imported[0];so.root.position.set(3,4,5);so.root.rotation.y=.7;so.root.scale.set(2,3,4);so.name='portable mesh';a.onGizmoChange(so.root);
   const id=so.id,asset=so.params.assetId;
   a.select({kind:'obj',so});const duplicate=a.duplicateSelected();
   const ids=[id,duplicate.id];
   const meshes=o=>{const m=[];o.root.traverse(x=>{if(x.isMesh)m.push(x);});return m;};
   a.setTex(false);a.appearance.setMode(a.byId(id),'on');
   const colors=ids.map(id=>meshes(a.byId(id))[0].material.color.getHex());
   const source=JSON.parse(a.projectAssets.records.get(asset));
   const data=await a.saveProject();
   // Fresh registry proves the archive is self-contained, not an in-memory cache.
   const counts={resources:a.projectAssets.records.size,images:source.images?.length,embedded:source.images.every(i=>String(i.url).startsWith('data:image/')),sourceColor:source.materials[0].color};
   a.clearAll();a.projectAssets.records.clear();
   await a.importFiles([new File([data],'roundtrip.previz')]);await a.projectAssets.ready();
   const restored=ids.map(id=>{const o=a.byId(id),m=meshes(o)[0];return{id:o.id,name:o.name,pos:o.root.position.toArray(),scale:o.root.scale.toArray(),rotation:o.root.rotation.y,mode:o.materialMode,color:m.material.color.getHex(),map:!!m.material.map,image:!!m.material.map?.image?.width,placeholder:!!o.root.userData.placeholder};});
   a.select({kind:'obj',so:a.byId(ids[1])});a.removeObject(a.byId(ids[1]));a.undo();await a.projectAssets.ready();
   const undo={restored:!!a.byId(ids[1]),snapshotHasAssets:!!a._redo.at(-1)?.j.assets,sourceAvailable:a.projectAssets.records.has(asset)};
   a.appearance.setMode(a.byId(ids[0]),'off');a.undo();await a.projectAssets.ready();const restoredMode=a.byId(ids[0]).materialMode;
   const saved=await a.saveLocal();
   // A bad package must not clear the current scene.
   let failed=false;const old=a.objects.length;
   try{a.loadJson({objects:[{type:'import',params:{assetId:'asset-'+'0'.repeat(64)}}]});}catch{failed=a.objects.length===old;}
   return{ids,colors,counts,restored,undo,restoredMode,saved,failed,bytes:data.length,serialized:a.serialize(),share:!!document.querySelector('.share-btn')};
 });
 assert.equal(result.counts.resources,1);assert.equal(result.counts.images,1);assert.ok(result.counts.embedded);assert.notEqual(result.colors[0],result.colors[1]);
 assert.equal(result.restored[0].name,'portable mesh');assert.deepEqual(result.restored[0].pos,[3,4,5]);assert.deepEqual(result.restored[0].scale,[2,3,4]);assert.equal(result.restored[0].rotation,.7);
 assert.equal(result.restored[0].mode,'on');assert.equal(result.restored[0].color,result.colors[0]);assert.ok(result.restored[0].map&&result.restored[0].image);assert.equal(result.restored[1].mode,'inherit');assert.equal(result.restored[1].color,result.colors[1]);
 assert.ok(result.undo.restored&&result.undo.sourceAvailable&&!result.undo.snapshotHasAssets);assert.equal(result.restoredMode,'on');assert.ok(result.saved&&result.failed);assert.equal(result.share,false);
 console.log('PASS companion OBJ/MTL/PNG; deduplicated embedded assets; fresh-registry archive roundtrip; actual texture image, transform and independent material policies; undo refs; invalid load preserves scene; Share absent',result.bytes);
 // New page/origin session, durable local storage; not the old JS asset registry.
 if(!process.env.TEST_FILE_URL){
   await p.goto('http://localhost:5174/',{waitUntil:'load'});await p.waitForFunction(()=>window.__previzBooted);await p.evaluate(()=>app.projectAssets.ready());
   const local=await p.evaluate(()=>({objects:app.objects.filter(o=>o.type==='import').length,assets:app.projectAssets.records.size,mode:app.objects.find(o=>o.name==='portable mesh')?.materialMode}));
   assert.equal(local.objects,2);assert.equal(local.assets,1);assert.equal(local.mode,'on');console.log('PASS IndexedDB reload restores model resources and appearance');
 }
 const more=await p.evaluate(async()=>{
   const a=app;
   const items=window.__t?.LIB?.flatMap(g=>g.items.map(i=>({key:g.id+':'+i.type+':'+i.name,item:i})))||[];
   const entry=items.find(i=>i.item.type==='street_lamp')||items.find(i=>i.item.type==='tree');
   if(!entry)return{skipped:true};
   a.clearAll();
   const o=a.addAsset(entry.key,{x:0,z:0});const id=o.id;
   a.setTex(false);a.appearance.setMode(o,'on');a.rebuildObject(o);
   const rebuilt=o.materialMode==='on'&&o.root.userData.so===o;
   a.stage.setPerfMode(true);let basic=true;o.root.traverse(m=>{if(m.isMesh&&m.material?.isMeshStandardMaterial)basic=false;});
   a.stage.setPerfMode(false);a.setTex(false);a.appearance.setMode(o,'on');
   const doc=a.serialize();a.loadJson(doc);const restored=a.byId(id).materialMode==='on'&&a.state.tex===false;
   a.setTex(true);const allOn=a.objects.every(o=>o.materialMode==='inherit');
   return{rebuilt,basic,restored,allOn};
 });
 if(!more.skipped)assert.deepEqual(more,{rebuilt:true,basic:true,restored:true,allOn:true});
 if(await p.evaluate(()=>app.objects.length>0)){
   await p.evaluate(()=>app.select({kind:'obj',so:app.objects[0]}));
   await p.click('#inspector-scene [data-materials="all-off"]');
   assert.equal(await p.evaluate(()=>app.state.tex),false);
   await p.select('#inspector-scene [data-materials="object-mode"]','on');
   assert.equal(await p.evaluate(()=>app.selObj.materialMode),'on');
   await p.click('#inspector-scene [data-materials="all-on"]');
   assert.equal(await p.evaluate(()=>app.selObj.materialMode),'inherit');
 }
 assert.deepEqual(errors,[]);console.log('PASS library rebuild/performance mode/global reset + actual UI; no page errors');
}finally{await b.close();}
