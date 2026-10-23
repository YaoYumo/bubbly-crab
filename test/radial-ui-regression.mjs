import assert from 'node:assert/strict';import fs from 'node:fs';import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const p=await b.newPage(),errors=[],csp=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:1000});
 await p.evaluateOnNewDocument(()=>{window.__radialCSP=[];document.addEventListener('securitypolicyviolation',e=>__radialCSP.push(e.violatedDirective));});
 if(process.env.TEST_FILE_URL)await p.setOfflineMode(true);
 await p.goto(process.env.TEST_FILE_URL||process.env.TEST_URL||'http://localhost:5174/',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted&&window.app?.radialMenu,{timeout:90000});
 await p.evaluate(()=>{app.suspended=true;app.state.playing=false;app.clearAll();app.terrain.setEnabled(false);app.state.showHelpers=false;app.step(0,true);app.stage.render();});
 const top=await p.$$eval('#top button',ns=>ns.map(n=>n.textContent.trim().replace(/^[✦⬇◴]\s*/,'')));
 assert.deepEqual(top,['Direct','Scene','Camera','Generate','Export','性能','桌面检查']);
 const rect=()=>p.$eval('#stage canvas',n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
 const right=async(x,y)=>{await p.mouse.click(x,y,{button:'right'});await p.waitForSelector('.radial-menu:not([hidden])',{timeout:5000}).catch(async e=>{console.error('RIGHT DEBUG',await p.evaluate(({x,y})=>({x,y,w:innerWidth,hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,200),playing:app.state.playing,dragging:app.stage.dragging,exporting:app.stage.exporting,owner:!!app.stage.exportOwner,busy:app.exporter.running}),{x,y}));throw e;});};
 const choose=async id=>{await p.click(`[data-radial-action="${id}"] .radial-label`);};
 let r=await rect();await right(r.x+25,r.y+75);assert.equal(await p.$$eval('.radial-item',ns=>ns.length),8);
 const fits=await p.$eval('.radial-menu',n=>{const a=n.getBoundingClientRect(),r=app.stage.canvas.getBoundingClientRect();return a.left>=r.left&&a.top>=r.top&&a.right<=r.right&&a.bottom<=r.bottom;});assert.ok(fits);
 const grid=await p.evaluate(()=>app.state.grid);await choose('grid');assert.equal(await p.evaluate(()=>app.state.grid),!grid);
 await right(r.x+30,r.y+80);await choose('more');await p.waitForSelector('.viewport-tools-panel');
 assert.ok(await p.$('.viewport-tools-panel .skin-wrap'));
 await p.click('.viewport-tools-panel button[title="场景"]');
 const templateItem=await p.$$('button.dd-item');for(const item of templateItem){if((await item.evaluate(n=>n.textContent)).includes('示例场景')){await item.click();break;}}
 assert.equal(await p.$('.viewport-tools-mask'),null);assert.ok(await p.$('.menu.scenes.on'));await p.keyboard.press('Escape');
 await p.evaluate(()=>app.openViewportTools());await p.keyboard.press('Escape');assert.equal(await p.$('.viewport-tools-mask'),null);
 // Right drag must keep panning and must not leave a menu, including a drag returning to its start.
 const view=await p.evaluate(()=>app.stage.orbit.target.toArray());await p.mouse.move(r.x+r.w/2,r.y+r.h/2);await p.mouse.down({button:'right'});await p.mouse.move(r.x+r.w/2+65,r.y+r.h/2+30,{steps:5});await p.mouse.up({button:'right'});
 assert.equal(await p.evaluate(()=>app.radialMenu.isOpen),false);assert.notDeepEqual(await p.evaluate(()=>app.stage.orbit.target.toArray()),view);
 await p.mouse.down({button:'right'});await p.mouse.move(r.x+r.w/2+100,r.y+r.h/2+50);await p.mouse.move(r.x+r.w/2+65,r.y+r.h/2+30);await p.mouse.up({button:'right'});assert.equal(await p.evaluate(()=>app.radialMenu.isOpen),false);
 // An actual object hit, not a programmatic menu action.
 const point=await p.evaluate(()=>{const so=app.addAsset('cn:earthterrace:夯土台基');app.select({kind:'obj',so});app.focusSelected();app.step(0,true);app.stage.render();const p=so.root.position.clone();p.y+=2;p.project(app.stage.view);const r=app.stage.canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};});
 await right(point.x,point.y);assert.ok(await p.$('[data-radial-action="copy"]'));
 fs.mkdirSync('docs/radial-ui-evidence',{recursive:true});await p.screenshot({path:`docs/radial-ui-evidence/object-menu-${process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web'}.png`});
 await choose('rotate');assert.equal(await p.evaluate(()=>app.stage.gizmoMode),'rotate');
 await right(point.x,point.y);await choose('copy');assert.equal(await p.evaluate(()=>app.objects.length),2);
 await p.evaluate(()=>{app.select({kind:'obj',so:app.objects[0]});app.focusSelected();app.step(0,true);app.stage.render();});
 await right(point.x,point.y);await choose('delete');assert.equal(await p.evaluate(()=>app.objects.length),1);await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.objects.length),2);
 // Escape cancels only the menu, without dropping the object selection or deleting anything.
 await right(point.x,point.y);const selected=await p.evaluate(()=>app.selObj?.id);await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>app.selObj?.id),selected);
 // Scene launcher opens a compact dialog centered in the actual 3D viewport.
 await p.click('.viewport-create');await p.waitForSelector('.tg-mask.on');await p.waitForFunction(()=>getComputedStyle(document.querySelector('.tg-mask')).opacity==='1');
 const dialog=await p.evaluate(()=>{const d=document.querySelector('.tg-modal').getBoundingClientRect(),v=app.stage.canvas.getBoundingClientRect();return{centerError:Math.abs(d.x+d.width/2-v.x-v.width/2),inside:d.top>=v.top&&d.bottom<=v.bottom,advanced:document.querySelector('.tg-advanced').open,visibleExamples:[...document.querySelectorAll('.tg-examples button')].filter(n=>n.getClientRects().length).length,disabled:document.querySelector('.tg-btn.pri').disabled};});
 assert.ok(dialog.centerError<2&&dialog.inside);assert.equal(dialog.advanced,false);assert.equal(dialog.visibleExamples,0);assert.ok(dialog.disabled);
 fs.mkdirSync('docs/radial-ui-evidence',{recursive:true});const mode=process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web';await p.screenshot({path:`docs/radial-ui-evidence/compact-dialog-${mode}.png`});
 await p.type('.tg-input','中式古城，沿河，石拱桥，种子42');assert.equal(await p.$eval('.tg-btn.pri',n=>n.disabled),false);
 await p.click('.tg-advanced > summary');assert.ok(await p.$eval('.tg-examples button',n=>n.getClientRects().length>0));await p.click('.tg-advanced > summary');
 const modeBefore=await p.evaluate(()=>app.stage.gizmoMode);await p.type('.tg-input',' gkrfw ');await p.keyboard.press('Delete');assert.equal(await p.evaluate(()=>app.stage.gizmoMode),modeBefore);
 const count=await p.evaluate(()=>app.objects.length);await p.keyboard.press('Escape');await p.waitForSelector('.tg-mask',{hidden:true});assert.equal(await p.evaluate(()=>app.objects.length),count);
 // A genuine camera-body hit changes the active camera, and recording is undoable.
 const cam=await p.evaluate(()=>{app.clearAll();app.terrain.setEnabled(false);app.state.showHelpers=true;const s=app.addShot({name:'Pie Camera',pos:[0,2,0]});app.addShot({name:'Other Camera',pos:[12,2,0]});app.select({kind:'shot',shot:s});app.focusSelected();app.step(0,true);app.stage.render();const v=s.body.getWorldPosition(s.rig.position.clone()).project(app.stage.view),r=app.stage.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2,id:s.id,keys:s.mover.count};});
 await right(cam.x,cam.y);assert.ok(await p.$('[data-radial-action="key"]'));assert.equal(await p.evaluate(()=>app.activeShot.name),'Pie Camera');await choose('key');assert.equal(await p.evaluate(()=>app.shots.find(s=>s.name==='Pie Camera').mover.count),cam.keys+1);await p.evaluate(()=>app.undo());assert.equal(await p.evaluate(()=>app.shots.find(s=>s.name==='Pie Camera').mover.count),cam.keys);
 await p.evaluate(()=>app.select({kind:'shot',shot:app.shots.find(s=>s.name==='Pie Camera')}));await p.click('.viewport-operations');assert.ok(await p.$('[data-radial-action="key"]'));await choose('preview');assert.equal(await p.evaluate(()=>app.state.preview),true);assert.equal(await p.evaluate(()=>app.activeShot.name),'Pie Camera');await p.evaluate(()=>app.setPreview(false));
 // The default, collapsed dialog really generates, not just its advanced pane.
 const old=await p.evaluate(()=>({undo:app._undo.length,objects:app.objects.length,shots:app.shots.length}));await p.click('.viewport-create');await p.waitForSelector('.tg-mask.on');await p.type('.tg-input','128米，稀疏的小镇，没有树，种子42');assert.equal(await p.$eval('.tg-advanced',n=>n.open),false);await p.click('.tg-foot .tg-btn.pri');await p.waitForSelector('.tg-mask',{hidden:true,timeout:90000});assert.ok(await p.evaluate(()=>app.objects.length>0&&!!window.__townStats));
 await p.evaluate(n=>{while(app._undo.length>n)app.undo();},old.undo);assert.equal(await p.evaluate(()=>app.objects.length),old.objects);assert.equal(await p.evaluate(()=>app.shots.length),old.shots);
 // Keyboard-only discovery, focus navigation, and busy sampling guard.
 await p.focus('#stage canvas');await p.keyboard.down('Shift');await p.keyboard.press('F10');await p.keyboard.up('Shift');assert.equal(await p.evaluate(()=>app.radialMenu.isOpen),true);await p.keyboard.press('ArrowRight');await p.keyboard.press('Escape');
 await p.evaluate(()=>app.exporter.running=true);await p.mouse.click(point.x,point.y,{button:'right'});assert.equal(await p.evaluate(()=>app.radialMenu.isOpen),false);await p.evaluate(()=>app.exporter.running=false);
 // Edge placement and narrow viewport fallback must remain on screen.
 for(const width of [1024,800]){await p.setViewport({width,height:800});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.waitForFunction(()=>app.stage.canvas.getBoundingClientRect().width>0);r=await rect();await right(r.x+r.w-5,r.y+r.h-5);assert.ok(await p.$eval('.radial-menu',n=>{const m=n.getBoundingClientRect();return m.left>=0&&m.right<=innerWidth&&m.top>=0&&m.bottom<=innerHeight;}));await p.keyboard.press('Escape');}
 assert.deepEqual(errors,[]);assert.deepEqual(await p.evaluate(()=>__radialCSP),[]);
 const report={platform:'Linux Chromium, not native Windows',top,objectPickAndActions:true,duplicateDeleteUndo:true,cancelPreservesSelection:true,rightDragPreserved:true,edgePlacement:true,narrowWindows:true,keyboard:true,exportGuard:true,compactViewportDialog:dialog,advancedOptIn:true,cancelDoesNotGenerate:true,cameraBodyPickAndActivation:true,recordKeyUndo:true,selectionAwareLauncher:true,compactGenerationAndUndo:true,settingsAndTemplatesReachable:true,inputDoesNotTriggerSceneHotkeys:true,errors,csp:await p.evaluate(()=>__radialCSP)};
 fs.writeFileSync(`docs/radial-ui-evidence/${mode}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await b.close();}
