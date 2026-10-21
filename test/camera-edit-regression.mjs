import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:240000});
mkdirSync('.shots',{recursive:true});
try {
 const page=await browser.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.setViewport({width:1440,height:1000});
 if(process.env.TEST_FILE_URL)await page.setOfflineMode(true);
 await page.evaluateOnNewDocument(()=>{window.__cutCSP=[];document.addEventListener('securitypolicyviolation',e=>__cutCSP.push(e.violatedDirective));});
 await page.goto(process.env.TEST_FILE_URL || process.env.TEST_URL || 'http://localhost:5174/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__previzBooted && app.cameraEdit && app.exporter,{timeout:90000});
 const core=await page.evaluate(async()=>{
  const a=app, ck=(v,m)=>{if(!v)throw Error(m);};
  a.suspended=true;a.state.playing=false;a.clearAll();a.terrain.setEnabled(false);a.stage.ground.visible=true;
  a.state.duration=.6;a.state.fps=30;
  const o=a.addAsset('house:adobe:Adobe 土坯平顶房',[0,0,0]);
  const first=a.addShot({name:'Cut A',pos:[0,3,10],duration:.3});
  const second=a.addShot({name:'Cut B',pos:[14,3,10],duration:.3});
  for(const s of [first,second]){s.setTarget(o);s.aim='target';s.handheld=.15;s.groundClear=false;}
  a.setActiveShot(first);a.cameraEdit.assemble();a.setPreview(true);
  const sample=t=>{a.state.time=t;a.stage.previewControls.interacted=false;a.step(0,true);return {id:a.cameraSample().shot.id,p:a.stage.view.position.toArray(),q:a.stage.view.quaternion.toArray(),u:a.cameraSample().u,time:a.cameraSample().time};};
  const left=sample(.2),right=sample(.3),end=sample(.6);
  ck(left.id===first.id && right.id===second.id && end.id===second.id,'seek/boundary/end shot');
  ck(Math.abs(right.p[0]-left.p[0])>10,'actual view did not cut');
  sample(.05);ck(JSON.stringify(sample(.3))===JSON.stringify(right),'seek depends on history');
  ck(a.activeShot===first,'playback changed camera editing selection');
  a.state.time=.29;a.state.playing=true;a.step(.02);a.state.playing=false;
  ck(a.cameraSample().shot===second,'core playback did not cut without UI redraw');
  a.state.loop=true;a.state.time=.59;a.state.playing=true;a.step(.02);a.state.playing=false;
  ck(a.cameraSample().shot===first,'loop did not return to first clip');
  const saved=a.serialize();a.loadJson(saved);
  ck(JSON.stringify(a.cameraEdit.toJSON())===JSON.stringify(saved.cameraEdit),'project lost edit');
  const bad=structuredClone(saved);bad.cameraEdit.clips[0].shotId='missing';let invalid=false;
  const beforeBad=JSON.stringify(a.serialize());try{a.loadJson(bad);}catch{invalid=true;}
  ck(invalid && beforeBad===JSON.stringify(a.serialize()),'invalid edit load destroyed scene');
  const id=a.cameraEdit.clips[0].id;a.cameraEdit.split(id,.1);ck(a.cameraEdit.clips.length===3,'split');
  a.undo();ck(a.cameraEdit.clips.length===2,'undo split');a.redo();ck(a.cameraEdit.clips.length===3,'redo split');
  a.undo();const deleted=a.shots.find(s=>s.name==='Cut A');a.removeShot(deleted);ck(a.cameraEdit.clips.length===1 && a.cameraEdit.sample(0).shot.name==='Cut B','delete stable ref/gap');
  a.undo();ck(a.cameraEdit.clips.length===2 && a.cameraEdit.sample(0).shot.name==='Cut A','undo camera deletion');
  a.shots.reverse();ck(a.cameraEdit.sample(0).shot.name==='Cut A','reordering changed cut refs');a.shots.reverse();
  let refBlocked=false;try{await a.reference.capture({width:320,height:180,duration:.6,fps:10});}catch(e){refBlocked=/剪辑/.test(e.message);}ck(refBlocked,'single-camera reference silently captured edit');
  a.cameraEdit.setEnabled(false);a.setActiveShot(a.shots.find(s=>s.name==='Cut A'));ck(a.cameraSample(.4).shot===a.activeShot && !a.cameraSample(.4).clip,'single-shot compatibility');
  const legacy=structuredClone(a.serialize());delete legacy.cameraEdit;a.loadJson(legacy);ck(!a.cameraEdit.enabled && !a.cameraEdit.clips.length,'old projects changed mode');
  a.loadJson(saved);a.setPreview(true);a.suspended=true;
  a.state.time=.17;a.step(0,true);
  const original=JSON.stringify(a.serialize()),oldTime=a.state.time;
  const output=[];
  for(const encoder of ['auto','mediarecorder']){
   const calls=[],originalApply=a.applyCameraSample;
   a.applyCameraSample=function(s=this.cameraSample()){if(this.stage.exporting)calls.push({name:s.shot.name,t:this.state.time,source:s.time,u:s.u});return originalApply.call(this,s);};
   let locked=false;
   const result=await a.exporter.run({width:320,height:180,fps:10,duration:.6,bitrate:1,encoder,format:'webm'},p=>{
    if(p.phase==='render'){try{a.cameraEdit.remove(a.cameraEdit.clips[0].id);}catch{locked=true;}}
   });
   a.applyCameraSample=originalApply;
   ck(result.size>0 && !result.error,'export '+encoder+': '+JSON.stringify(result));
   ck(calls.slice(0,6).map(c=>c.name).join(',')==='Cut A,Cut A,Cut A,Cut B,Cut B,Cut B','export cut order '+JSON.stringify(calls));
   ck(Math.abs(calls[3].source)<1e-8 && Math.abs(calls[4].source-.1)<1e-8,'source time not local');
   ck(locked && !a.stage.exportOwner && !a.exporter.running,'edit/export lock leaked');
   ck(a.state.time===oldTime && JSON.stringify(a.serialize())===original,'export changed project/camera runtime');
   const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(result.blob);document.body.append(video);
   await new Promise((ok,no)=>{video.onloadedmetadata=ok;video.onerror=()=>no(Error('cannot decode export'));});
   const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');
   const pixels=async t=>{video.currentTime=t;await new Promise(ok=>video.onseeked=ok);ctx.drawImage(video,0,0,160,90);return ctx.getImageData(0,0,160,90).data;};
   const p0=await pixels(.15),p1=await pixels(.45);let difference=0;for(let i=0;i<p0.length;i++)difference+=Math.abs(p0[i]-p1[i]);
   ck(difference>10000,'encoded video frames did not change at cut');URL.revokeObjectURL(video.src);video.remove();
   output.push({mode:result.mode,frames:result.frames,size:result.size,cuts:calls.slice(0,6),decodedPixelDifference:difference});
  }
  // Cancellation/failure also restore the edited project.
  const cancel=await a.exporter.run({width:320,height:180,duration:.6,fps:10},p=>{if(p.phase==='render')a.exporter.cancel();});
  ck(cancel.cancelled && JSON.stringify(a.serialize())===original && !a.stage.exportOwner,'cancel leaked edit state');
  const apply=a.applyCameraSample;a.applyCameraSample=()=>{throw Error('injected cut failure');};
  const failure=await a.exporter.run({width:320,height:180,duration:.6,fps:10});a.applyCameraSample=apply;
  ck(failure.error && !a.stage.exportOwner && JSON.stringify(a.serialize())===original,'failure leaked edit state');
  return {seek:true,boundaries:true,loop:true,selectionStable:true,saveLoad:true,undoRedo:true,deleteUndo:true,reorder:true,legacy:true,referenceGuard:true,cancel:true,failure:true,exports:output};
 });
 // Exercise visible controls and pointer editing, not only the model API.
 await page.click('[data-cut-action="enable"]');await page.click('[data-cut-action="enable"]');
 const first=await page.$('.tclip');await first.click();
 await page.$eval('[data-cut-field="end"]',n=>{n.value='.2';n.dispatchEvent(new Event('change',{bubbles:true}));});

 assert.equal(await page.evaluate(()=>app.cameraEdit.clips[0].end),.2);
 const box=await (await page.$('.tclip')).boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2,{steps:4});await page.mouse.up();
 assert.ok(await page.evaluate(()=>app.cameraEdit.clips[0].start>0));
 await page.evaluate(()=>app.undo());
 const now=await page.$('.tclip'),bounds=await now.boundingBox();
 await page.mouse.move(bounds.x+bounds.width-2,bounds.y+10);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-100,bounds.y+10,{steps:4});await page.mouse.up();
 assert.ok(await page.evaluate(()=>app.cameraEdit.clips[0].end<.2));
 await page.click('.tclip');await page.keyboard.press('Delete');
 assert.equal(await page.evaluate(()=>app.cameraEdit.clips.length),1);
 assert.equal(await page.evaluate(()=>app.shots.length),2);
 await page.evaluate(()=>app.undo());
 const layout=await page.$eval('.tl',n=>({width:n.clientWidth,scroll:n.scrollWidth,height:n.clientHeight,scrollHeight:n.scrollHeight}));
 await page.screenshot({path:'.shots/camera-edit.png'});
 assert.deepEqual(errors,[]);
 const csp=await page.evaluate(()=>window.__cutCSP);assert.deepEqual(csp,[]);
 const report={platform:'Linux Chromium, not native Windows',core,visibleControls:true,pointerMoveTrim:true,focusedDelete:true,cspViolations:csp,layout};
 writeFileSync(`.shots/camera-edit-${process.env.TEST_FILE_URL?'file':process.env.TEST_URL?'desktop-csp':'web'}.json`,JSON.stringify(report,null,2));console.log('PASS',JSON.stringify(report));
}finally{await browser.close();}
