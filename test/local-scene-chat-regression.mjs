// Actual desktop frontend + mocked native inference IPC, NOT a real GGUF quality test.
import assert from 'node:assert/strict';import fs from 'node:fs';import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1440,height:1000});
 await p.evaluateOnNewDocument(()=>{window.__chatCSP=[];document.addEventListener('securitypolicyviolation',e=>__chatCSP.push(e.effectiveDirective));});
 await p.goto('http://localhost:5181/',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__previzBooted&&window.app?.aiScene,{timeout:90000});
 await p.evaluate(()=>{app.suspended=true;app.state.playing=false;app.clearAll();app.terrain.setEnabled(false);window.__chatMode='add';window.__calls=[];window.__folderOpened=0;
  window.isTauri=true;window.__TAURI_INTERNALS__={invoke:async(command,args)=>{__calls.push(command);
   if(command==='local_ai_status')return{models:[{name:'fixture.gguf',bytes:5000000}],folder:'C:/PREVIZ LAB/models',enginePresent:true,loadedModel:'',loading:false,busy:false};
   if(command==='local_ai_open_folder'){__folderOpened++;return;}
   if(command==='local_ai_stop'){window.__rejectChat?.('已停止');window.__rejectChat=null;return;}
   if(command!=='local_ai_chat')throw Error('Unexpected IPC: '+command);
   const data=JSON.parse(args.messages[1].content);window.__lastChat=data;
   const key=data.catalog.find(a=>a.key.startsWith('cn:hall:'))?.key;
   if(__chatMode==='expanded')return JSON.stringify({reply:'已生成粗模、河流、车辆走位、跟拍和氛围',terrain:{rivers:[{action:'add',shape:'straight',center:[-50,-40],length:60,width:6,depth:2,water:true}]},operations:[{op:'primitive',name:'库外巡检机器人',pos:[-10,0,-10],parts:[{shape:'box',size:[.8,1.1,.6],pos:[0,.9,0],color:'#4f83b0'},{shape:'sphere',size:[.5,.5,.5],pos:[0,1.7,0]}]},{op:'add',key:data.catalog.find(a=>a.key.startsWith('env:car:')).key,name:'巡检车',pos:[0,0,0]},{op:'motion',objectId:'last',points:[[0,0,0,0],[data.scene.durationSeconds,20,0,10]]},{op:'camera',objectId:'last',preset:'follow'},{op:'environment',lighting:'golden',weather:'rain'}]});
   if(__chatMode.startsWith('river-screenshot-')){
    window.__riverScreenshotCalls??={};__riverScreenshotCalls[__chatMode]=(__riverScreenshotCalls[__chatMode]||0)+1;
    window.__riverPromptBytes=new TextEncoder().encode(args.messages[0].content+args.messages[1].content).length;
    window.__riverCatalogCount=data.catalog.length;
    if(__chatMode==='river-screenshot-unsupported')return JSON.stringify({unsupported:''});
    if(__chatMode==='river-screenshot-empty'&&args.messages.length===2)return JSON.stringify({reply:'已完成',operations:[],terrain:{}});
    window.__riverBeforeCommit={undo:app._undo.length,h:Array.from(app.terrain.h)};
    return JSON.stringify({reply:'生成河道',operations:[],unsupported:'',terrain:{rivers:[{action:'add',...(data.riverRequest?.shape?{shape:data.riverRequest.shape}:{}),water:true}]}});
   }
   if(__chatMode==='wait')return await new Promise((resolve,reject)=>{window.__resolveChat=resolve;window.__rejectChat=reject;});
   if(__chatMode==='terrain-mixed')return JSON.stringify({reply:'已生成丘陵、大殿与道路',terrain:{generate:{kind:'hills',amp:10,seed:42,size:160}},operations:[{op:'add',key,pos:[20,0,-30],placement:'ground'},{op:'road',points:[[-60,0,-55],[60,0,-55]],width:6,roadType:'concrete',name:'测试道路'}]});
   if(__chatMode==='terrain-local')return JSON.stringify({reply:'已局部抬高',terrain:{edits:[{tool:'raise',center:[30,30],radius:12,amount:4}]},operations:[]});
   if(__chatMode==='river')return JSON.stringify({reply:'已开挖河道',terrain:{rivers:[{action:'add',points:[[-50,0,35],[50,0,35]],width:8,depth:3,bank:5,water:true}]},operations:[]});
   if(__chatMode==='water')return JSON.stringify({reply:'开启水面',terrain:{water:{enabled:true,level:1}},operations:[]});
   if(__chatMode==='ground')return JSON.stringify({reply:'物体贴地',terrain:{groundObjects:true},operations:[]});
   if(__chatMode==='road-edit')return JSON.stringify({reply:'道路加宽',operations:[{op:'roadEdit',objectId:data.scene.objects.find(o=>o.type==='road_brush').id,width:9}]});
   if(__chatMode==='road-remove')return JSON.stringify({reply:'移除道路',operations:[{op:'removeRoad',objectId:data.scene.objects.find(o=>o.type==='road_brush').id}]});
   if(__chatMode==='terrain-reset')return JSON.stringify({reply:'地形已填平并关闭水面',terrain:{generate:{kind:'flat',height:0},water:{enabled:false},rivers:data.scene.terrain.rivers.map(r=>({action:'remove',id:r.id}))},operations:[]});
   if(__chatMode==='city'){
    window.__cityCalls=(window.__cityCalls||0)+1;
    if(args.messages.length===2)return JSON.stringify({reply:'错误模型输出',operations:[{op:'add',key:'env:river:河流',pos:[0,0,0]}]});
    window.__cityBefore=app.objects.length;
    const key=data.catalog.find(a=>a.key.startsWith('cn:folkhouse:')).key;
    return JSON.stringify({reply:'30座中式古城与中轴道路',operations:[{op:'grid',key,count:30,columns:6,center:[0,0,0],spacing:[24,28]},{op:'road',points:[[0,0,-75],[0,0,75]],width:4,roadType:'concrete',name:'中轴路'},{op:'road',points:[[-75,0,-42],[75,0,-42]],width:4,roadType:'concrete'},{op:'road',points:[[-75,0,42],[75,0,42]],width:4,roadType:'concrete'}]});
   }
   let operations=[];
   if(__chatMode==='add')operations=[{op:'add',key,pos:[-50,0,-50],placement:'ground'},{op:'add',key,pos:[0,0,0],placement:'ground'},{op:'add',key,pos:[50,0,50],placement:'ground'}];
   if(__chatMode==='mixed'){const o=data.scene.objects.find(o=>data.scene.recentIds.includes(o.id));operations=[{op:'transform',objectId:o.id,pos:[o.position[0]+5,o.position[1],o.position[2]]},{op:'add',key,pos:[50,0,-50],placement:'ground'}];}
   if(__chatMode==='bad')operations=[{op:'add',key:'made-up:model',pos:[0,0,0]}];
   if(__chatMode==='locked')operations=[{op:'transform',objectId:data.scene.objects.find(o=>o.locked).id,pos:[0,0,0]}];
   if(__chatMode==='delete')operations=data.scene.objects.filter(o=>!o.locked).map(o=>({op:'remove',objectId:o.id}));
   if(__chatMode==='unsupported')return JSON.stringify({unsupported:'目录中没有机械龙，不能假装生成。'});
   return JSON.stringify({reply:'按你的要求完成调整。',operations});
  }};
 });
 let confirmDelete=false;p.on('dialog',async d=>{if(confirmDelete)await d.accept();else await d.dismiss();});
 await p.click('.viewport-create');await p.waitForSelector('[data-local-chat-send]:not([disabled])');
 assert.equal(await p.$('.tg-mask'),null);assert.equal(await p.$('.ai-scene-mask'),null);
 assert.ok(!await p.$eval('.local-chat-panel',n=>/候选预览|导入蓝图|应用到场景/.test(n.textContent)));
 await p.click('[data-local-model-folder]'); // Actual attributes are camelCase dataset -> kebab-case.
 async function send(text,mode){await p.evaluate(mode=>{window.__chatMode=mode;},mode);await p.type('[data-local-chat-input]',text);await p.click('[data-local-chat-send]');await p.waitForFunction(()=>app.localScene&&!app.localScene.busy,{timeout:90000});await p.waitForSelector('[data-local-chat-send]:not([disabled])');}
 const undo=()=>p.evaluate(()=>app._undo?.length||0);
 const original=await undo();await send('建三座中式大殿，留出间距','add');assert.equal(await p.evaluate(()=>app.objects.length),3);assert.equal(await undo(),original+1);
 const first=await p.evaluate(()=>({id:app.localScene.recentIds[0],x:app.objects.find(o=>o.id===app.localScene.recentIds[0]).root.position.x}));
 await send('把刚才第一个大殿右移5米，再加一座','mixed');assert.equal(await p.evaluate(()=>app.objects.length),4);assert.equal(await p.evaluate(id=>app.objects.find(o=>o.id===id).root.position.x,first.id),first.x+5);assert.equal(await undo(),original+2);
 await p.click('[data-local-chat-undo]');assert.equal(await p.evaluate(()=>app.objects.length),3);assert.equal(await p.evaluate(id=>app.objects.find(o=>o.id===id).root.position.x,first.id),first.x);
 await send('帮我生成不存在的东西','bad');assert.equal(await p.evaluate(()=>app.objects.length),3);
 await send('生成一条机械龙','unsupported');assert.match(await p.$eval('.local-chat-status',n=>n.textContent),/没有机械龙/);assert.equal(await p.evaluate(()=>app.objects.length),3);
 await p.evaluate(()=>{app.objects[0].locked=true;});await send('锁定的模型也搬过去','locked');assert.equal(await p.evaluate(()=>app.objects[0].root.position.x),first.x);
 await p.evaluate(()=>{app.objects[0].locked=false;});await send('清空这些建筑','delete');assert.equal(await p.evaluate(()=>app.objects.length),3);
 confirmDelete=true;await send('确认清空这些建筑','delete');assert.equal(await p.evaluate(()=>app.objects.length),0);await p.click('[data-local-chat-undo]');assert.equal(await p.evaluate(()=>app.objects.length),3);
 await p.evaluate(()=>window.__chatMode='wait');await p.type('[data-local-chat-input]','再添加一个');await p.click('[data-local-chat-send]');await p.waitForFunction(()=>!!window.__rejectChat);await p.click('[data-local-chat-stop]');await p.waitForFunction(()=>!app.localScene.busy);assert.equal(await p.evaluate(()=>app.objects.length),3);
 // Closing during an outstanding native request must not leave the entire app inert.
 await p.evaluate(()=>window.__chatMode='wait');await p.type('[data-local-chat-input]','再试一次');await p.click('[data-local-chat-send]');await p.waitForFunction(()=>!!window.__rejectChat);await p.evaluate(()=>[...document.querySelectorAll('.local-chat-panel button')].find(n=>n.textContent==='关闭').click());await p.waitForSelector('.local-chat-overlay',{hidden:true});assert.equal(await p.$eval('#app',n=>n.inert),false);assert.equal(await p.evaluate(()=>app.objects.length),3);
 await p.click('.viewport-create');await p.waitForSelector('[data-local-chat-send]:not([disabled])');
 // Existing v1 edit mode has NOT acquired the private conversational add permission.
 const legacyRefused=await p.evaluate(async()=>{const w=app.aiScene,permissions={mode:'edit',editableIds:[app.objects[0].id],preserveTerrain:true},c=await w.context(permissions);try{await w.prepare({schema:'previz-ai-scene/1',id:'legacy',name:'legacy',baseFingerprint:c.baseFingerprint,mode:'edit',bounds:c.bounds,seed:12345,terrain:'preserve',durationSeconds:c.durationSeconds,operations:[{op:'add',id:'unauthorized-add',key:app.objects[0].key,pos:[-80,0,80],placement:'ground'}]},permissions);return false;}catch(e){return /不允许新增/.test(e.message);}});assert.equal(legacyRefused,true);

 // Private conversational terrain/road transactions use the actual frontend/workflow and mocked native JSON only.
 await p.evaluate(()=>{app.clearAll();app.terrain.setEnabled(true);app.terrain.h.fill(0);app.terrain.state.water=false;app.terrain.refresh();app.localScene.recentIds=[];});
 const terrainUndo=await undo();
 await send('生成丘陵，放置一座大殿，再修一条道路','terrain-mixed');
 assert.match(await p.$eval('.local-chat-status',n=>n.textContent),/已完成|场景已更新/);
 assert.equal(await undo(),terrainUndo+1);
 assert.ok(await p.evaluate(()=>{const o=app.objects.find(o=>o.key?.startsWith('cn:hall:'));return Math.abs(o.root.position.y-app.terrain.heightAt(20,-30))<1e-6&&!app.terrain.state.water&&app.objects.some(o=>o.type==='road_brush');}));
 const terrainState=await p.evaluate(()=>({center:app.terrain.heightAt(30,30),outside:app.terrain.heightAt(-70,-70),h:Array.from(app.terrain.h)}));
 await send('把东南角30,30附近半径12米的地形抬高4米','terrain-local');assert.equal(await undo(),terrainUndo+2);
 assert.ok(await p.evaluate(state=>Math.abs(app.terrain.heightAt(30,30)-state.center-4)<.1&&app.terrain.heightAt(-70,-70)===state.outside,terrainState));
 await p.click('[data-local-chat-undo]');assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),terrainState.h);
 await p.evaluate(()=>app.redo());await p.evaluate(()=>app.terrain.workflow.ready());assert.ok(await p.evaluate(state=>app.terrain.heightAt(30,30)>state.center+3.9,terrainState));
 await send('沿z=35米制造一条河流，不开全局水面','river');
 assert.ok(await p.evaluate(()=>app.terrain.workflow.rivers.length===1&&app.terrain.heightAt(0,35)<-.5&&!app.terrain.state.water));
 await send('开启湖水面到世界高度1米','water');assert.equal(await p.evaluate(()=>app.terrain.state.water),true);
 await p.evaluate(()=>{app.objects.find(o=>o.key?.startsWith('cn:hall:')).root.position.y=40;});
 await send('将原有建筑贴地','ground');assert.ok(await p.evaluate(()=>{const o=app.objects.find(o=>o.key?.startsWith('cn:hall:'));return Math.abs(o.root.position.y-app.terrain.heightAt(o.root.position.x,o.root.position.z))<1e-6;}));
 // Manual bridge/lamp configuration survives an ordinary conversational width edit.
 await p.evaluate(()=>{const o=app.objects.find(o=>o.type==='road_brush');Object.assign(o._roadData,{streetLights:true,lampSpacing:40,lampSide:'right',bridges:false,pierSpacing:18,bridgeThreshold:3});app.roadTerrain.sync();});
 await send('把道路加宽到9米','road-edit');assert.equal(await p.evaluate(()=>app.objects.find(o=>o.type==='road_brush').serialize().width),9);
 assert.ok(await p.evaluate(()=>{const d=app.objects.find(o=>o.type==='road_brush').serialize();return d.streetLights&&d.lampSpacing===40&&d.lampSide==='right'&&d.bridges===false&&d.pierSpacing===18&&d.bridgeThreshold===3;}),'conversational width edit stripped manual road settings');
 await send('移除这条道路','road-remove');assert.equal(await p.evaluate(()=>app.objects.filter(o=>o.type==='road_brush').length),0);
 await p.click('[data-local-chat-undo]');assert.equal(await p.evaluate(()=>app.objects.find(o=>o.type==='road_brush').serialize().width),9);
 const preserved=await p.evaluate(()=>({h:Array.from(app.terrain.h),rivers:JSON.stringify(app.terrain.workflow.rivers),water:app.terrain.state.water,undo:app._undo.length}));
 confirmDelete=false;await send('填平所有地形，移除河道，关闭水面','terrain-reset');
 assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),preserved.h);assert.equal(await undo(),preserved.undo);
 await p.evaluate(()=>{const o=app.objects.find(o=>o.key);o.locked=true;o.root.visible=false;});
 confirmDelete=true;await send('填平所有地形，移除河道，关闭水面','terrain-reset');assert.match(await p.$eval('.local-chat-status',n=>n.textContent),/锁定|保护/);assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),preserved.h);assert.equal(await undo(),preserved.undo);
 await p.evaluate(()=>{const o=app.objects.find(o=>o.key);o.locked=false;o.root.visible=true;});
 await send('填平所有地形，移除河道，关闭水面','terrain-reset');assert.ok(await p.evaluate(()=>app.terrain.h.every(v=>v===0)&&!app.terrain.state.water&&!app.terrain.workflow.rivers.length));
 await p.click('[data-local-chat-undo]');assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),preserved.h);assert.equal(await p.evaluate(()=>JSON.stringify(app.terrain.workflow.rivers)),preserved.rivers);assert.equal(await p.evaluate(()=>app.terrain.state.water),preserved.water);
 // A restored terrain notification is not another brush stroke: saved/locked small props stay put.
 const restoredLockedTransform=await p.evaluate(async()=>{
  const saved=JSON.parse(JSON.stringify(app.serialize({assets:false}))),heights=Array.from(app.terrain.h),c=await app.aiScene.context({mode:'add'}),item=c.catalog.find(a=>a.type==='street_lamp'),y=app.terrain.heightAt(-60,-60)+4;
  const scene=JSON.parse(JSON.stringify(saved));scene.objects.push({id:'locked-lamp-fixture',key:item.key,type:item.type,name:'locked lamp',params:item.defaultParameters,pos:[-60,y,-60],rot:[0,0,0],scale:[1,1,1],visible:true,locked:true,followTerrain:true});
  app.loadJson(scene);await app.terrain.workflow.ready();const same=app.byId('locked-lamp-fixture').root.position.y===y&&heights.every((v,i)=>v===app.terrain.h[i]);app.loadJson(saved);await app.terrain.workflow.ready();return same;
 });assert.equal(restoredLockedTransform,true);
 // Candidate tampering and stale snapshots do not commit even a terrain-only edit.
 const terrainSafety=await p.evaluate(async()=>{
  const w=app.aiScene,p={mode:'add',conversational:true,conversationTerrain:{edits:[{tool:'raise',center:[0,0],radius:10,amount:1}]},bounds:{center:[0,0],size:[600,600]},preserveTerrain:true},c=await w.context(p),plan={schema:'previz-ai-scene/1',id:'terrain-safety',name:'terrain-safety',baseFingerprint:c.baseFingerprint,mode:'add',bounds:c.bounds,seed:1,terrain:'preserve',durationSeconds:c.durationSeconds,operations:[]};
  const saved=Array.from(app.terrain.h),steps=app._undo.length;let tamper=false,stale=false,legacy=false,rollback=false,cancelled=false,roadPrivate=false;
  await w.prepare(plan,p);w.draft.document.terrain.water=!w.draft.document.terrain.water;try{await w.apply({acceptWarnings:true});}catch(e){tamper=/被修改/.test(e.message);}w.discard();
  await w.prepare(plan,p);app.terrain.h[0]+=.25;app.terrain.refresh();try{await w.apply({acceptWarnings:true});}catch(e){stale=/变化/.test(e.message);}w.discard();app.terrain.h.set(saved);app.terrain.refresh();
  try{await w.prepare(plan,{...p,conversational:false});}catch(e){legacy=/操作数/.test(e.message);}
  await w.prepare(plan,p);const load=app.loadJson;let failOnce=true;app.loadJson=function(doc){load.call(this,doc);if(failOnce){failOnce=false;throw Error('fixture commit failure');}};
  try{await w.apply({acceptWarnings:true});}catch(e){rollback=/fixture commit failure/.test(e.message)&&saved.every((v,i)=>v===app.terrain.h[i])&&steps===app._undo.length;}finally{app.loadJson=load;w.discard();}
  const preparing=w.prepare(plan,p);setTimeout(()=>w.cancel(),0);try{await preparing;}catch(e){cancelled=e.name==='AbortError';}w.discard();
  const road=app.objects.find(o=>o.type==='road_brush'),privateP={...p,mode:'edit',editableIds:[road.id],conversational:false};delete privateP.conversationTerrain;
  const roadContext=await w.context(privateP);try{await w.prepare({...plan,baseFingerprint:roadContext.baseFingerprint,mode:'edit',operations:[{op:'roadEdit',objectId:road.id,width:10}]},privateP);}catch(e){roadPrivate=/无权|不允许新增/.test(e.message);}w.discard();
  return{tamper,stale,legacy,rollback,cancelled,roadPrivate,atomic:steps===app._undo.length&&saved.every((v,i)=>v===app.terrain.h[i])};
 });assert.deepEqual(terrainSafety,{tamper:true,stale:true,legacy:true,rollback:true,cancelled:true,roadPrivate:true,atomic:true});
 await p.evaluate(()=>{app.clearAll();app.terrain.workflow.rivers=[];app.terrain.h.fill(0);app.terrain.state.water=false;app.terrain.workflow.rebuildRivers();app.terrain.refresh();});
 const cityUndo=await undo();await send('30座中式建筑组成古城，中轴对称路网，不要河流','city');
 const city=await p.evaluate(()=>({buildings:app.objects.filter(o=>o.key?.startsWith('cn:folkhouse:')).length,roads:app.objects.filter(o=>o.type==='road_brush').length,rivers:app.terrain.workflow.rivers.length,calls:__cityCalls,uncommittedAtRepair:__cityBefore===0,undo:app._undo.length,water:app.terrain.state.water}));
 assert.deepEqual(city,{buildings:30,roads:3,rivers:0,calls:2,uncommittedAtRepair:true,undo:cityUndo+1,water:false});
 await p.click('[data-local-chat-undo]');assert.equal(await p.evaluate(()=>app.objects.length),0);
 // Screenshot regressions with actual UI/controller/compiler, including a failed native reply.
 const riverBaseline=await p.evaluate(()=>({undo:app._undo.length,h:Array.from(app.terrain.h)}));
 await send('在中央生成一条约20米宽弯曲的河流，深度5米','river-screenshot-unsupported');
 assert.equal(await undo(),riverBaseline.undo);assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),riverBaseline.h);
 assert.ok(!await p.$eval('.local-chat-status',n=>n.textContent.includes('Cannot read')));assert.ok(await p.$('.local-chat-diagnostics'));assert.equal(await p.$eval('.local-chat-diagnostics',n=>n.open),false);
 assert.equal(await p.evaluate(()=>app.localScene.lastFailure.attempts.length),2);
 await send('在中央生成一条约20米宽弯曲的河流，深度5米','river-screenshot-empty');
 const riverScreenshot=await p.evaluate(()=>{const r=app.terrain.workflow.rivers[0];return{width:r?.width,depth:r?.depth,curved:r?.points.length===17&&r.points.some(p=>Math.abs(p[0])>5),bed:app.terrain.heightAt(0,0),globalWater:app.terrain.state.water,objects:app.objects.length,calls:__riverScreenshotCalls['river-screenshot-empty'],promptBytes:__riverPromptBytes,catalog:__riverCatalogCount,undo:app._undo.length};});
 assert.ok(riverScreenshot.promptBytes<5000);assert.deepEqual({...riverScreenshot,promptBytes:undefined},{width:20,depth:5,curved:true,bed:-5,globalWater:false,objects:0,calls:2,promptBytes:undefined,catalog:0,undo:riverBaseline.undo+1});
 assert.equal(await p.$('.local-chat-diagnostics'),null);await p.click('[data-local-chat-undo]');assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),riverBaseline.h);
 await p.evaluate(()=>app.redo());await p.evaluate(()=>app.terrain.workflow.ready());assert.equal(await p.evaluate(()=>app.terrain.workflow.rivers[0].width),20);assert.equal(await p.evaluate(()=>app.terrain.heightAt(0,0)),-5);await p.click('[data-local-chat-undo]');
 await send('生成一条河流','river-screenshot-simple');assert.deepEqual(await p.evaluate(()=>({width:app.terrain.workflow.rivers[0].width,depth:app.terrain.workflow.rivers[0].depth,points:app.terrain.workflow.rivers[0].points.length,calls:__riverScreenshotCalls['river-screenshot-simple']})),{width:6,depth:2,points:2,calls:1});await p.click('[data-local-chat-undo]');
 await p.evaluate(async()=>{const c=await app.aiScene.context({mode:'add'});const o=app.addAsset(c.catalog.find(a=>a.key.startsWith('cn:hall:')).key,[0,0,0],{authored:true});o.locked=true;});
 const lockedRiverUndo=await undo();await send('在中央生成一条约20米宽弯曲的河流，深度5米','river-screenshot-locked');assert.equal(await undo(),lockedRiverUndo);assert.match(await p.$eval('.local-chat-status',n=>n.textContent),/锁定|保护/);assert.equal(await p.evaluate(()=>__riverScreenshotCalls['river-screenshot-locked']),1);assert.deepEqual(await p.evaluate(()=>Array.from(app.terrain.h)),riverBaseline.h);
 await p.evaluate(()=>{app.clearAll();app.localScene.recentIds=[];});
 const expandedUndo=await undo();await send('生成河流和库外巡检机器人及轿车，车辆沿路径行驶，跟拍镜头，黄金光影雨天','expanded');
 const expanded=await p.evaluate(()=>({primitive:!!app.objects.find(o=>o.root.userData.primitiveModel),motion:!!app.objects.find(o=>o.type==='car')?.motion.active,camera:app.shots.some(s=>s.targetId===app.objects.find(o=>o.type==='car')?.id),weather:app.weather.type,lighting:app.lighting.preset,rivers:app.terrain.workflow.rivers.length,fullCatalog:__lastChat.catalog.length>0,undo:app._undo.length}));
 if(!expanded.primitive)console.log('EXPANDED FAILURE',await p.evaluate(()=>({status:document.querySelector('.local-chat-status').textContent,failure:app.localScene.lastFailure})));
 assert.deepEqual(expanded,{primitive:true,motion:true,camera:true,weather:'rain',lighting:'golden',rivers:1,fullCatalog:true,undo:expandedUndo+1});
 await p.click('[data-local-chat-undo]');assert.equal(await p.evaluate(()=>app.objects.length),0);assert.equal(await p.evaluate(()=>app.terrain.workflow.rivers.length),0);
 assert.equal(await p.evaluate(()=>__folderOpened),1);assert.ok((await p.evaluate(()=>__calls)).includes('local_ai_stop'));
 const snapshot=await p.evaluate(()=>({objects:app.objects.length,messages:app.localScene.messages.map(m=>({role:m.role,text:m.text})),ipc:__calls,csp:__chatCSP}));assert.deepEqual(snapshot.csp,[]);assert.deepEqual(errors,[]);
 fs.mkdirSync('.shots',{recursive:true});await p.screenshot({path:'.shots/local-scene-chat-mocked-ipc.png'});fs.writeFileSync('.shots/local-scene-chat-mocked-ipc.json',JSON.stringify({...snapshot,expanded,restoredLockedTransform,terrainSafety,city,riverScreenshot,errors,realGGUF:false},null,2));
 console.log('PASS desktop conversation + terrain + roads + grid30 with mocked native IPC: auto load/submit, mixed add+edit, one undo, invalid/unsupported/locked atomic rejection, destructive confirmation accept+decline, cancellation, folder, no blueprint/preview, no CSP/browser errors. NOT real model inference.');
}finally{await b.close();}
