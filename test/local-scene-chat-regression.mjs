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
   if(command==='local_ai_stop'){window.__rejectChat?.(Error('已停止'));window.__rejectChat=null;return;}
   if(command!=='local_ai_chat')throw Error('Unexpected IPC: '+command);
   const data=JSON.parse(args.messages[1].content);window.__lastChat=data;
   const key=data.catalog.find(a=>a.key.startsWith('cn:hall:')).key;
   if(__chatMode==='wait')return await new Promise((resolve,reject)=>{window.__resolveChat=resolve;window.__rejectChat=reject;});
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
 assert.equal(await p.evaluate(()=>__folderOpened),1);assert.ok((await p.evaluate(()=>__calls)).includes('local_ai_stop'));
 const snapshot=await p.evaluate(()=>({objects:app.objects.length,messages:app.localScene.messages.map(m=>({role:m.role,text:m.text})),ipc:__calls,csp:__chatCSP}));assert.deepEqual(snapshot.csp,[]);assert.deepEqual(errors,[]);
 fs.mkdirSync('.shots',{recursive:true});await p.screenshot({path:'.shots/local-scene-chat-mocked-ipc.png'});fs.writeFileSync('.shots/local-scene-chat-mocked-ipc.json',JSON.stringify({...snapshot,errors,realGGUF:false},null,2));
 console.log('PASS desktop conversation with mocked native IPC: auto load/submit, mixed add+edit, one undo, invalid/unsupported/locked atomic rejection, destructive confirmation accept+decline, cancellation, folder, no blueprint/preview, no CSP/browser errors. NOT real model inference.');
}finally{await b.close();}
