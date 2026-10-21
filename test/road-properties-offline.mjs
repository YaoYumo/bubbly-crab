import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto('file://'+process.cwd()+'/previz-lab.html?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.app?.roadBrush);
  await p.click('[data-page="scene"]');
  const id=await p.evaluate(()=>{app.clearAll();app.roadBrush.restore([{name:'离线道路',points:[[-25,0,0],[25,0,0]],roadType:'asphalt',width:6}]);const so=app.objects.find(o=>o.type==='road_brush');app.select({kind:'obj',so});return so.id;});
  await p.select('#inspector-scene [data-road-property="type"]','concrete');
  await p.$eval('#inspector-scene [data-road-property="width"]',e=>{e.value='12';e.dispatchEvent(new Event('change',{bubbles:true}));});
  const result=await p.evaluate(id=>{const so=app.byId(id),data=so.serialize();return{type:data.roadType,width:data.width,name:data.name,selected:app.selObj?.id===id,active:app.roadBrush.active,caps:so.root.children.filter(c=>c.name==='road_endcap').map(c=>c.userData.profile.pavementWidth)};},id);
  assert.deepEqual(result,{type:'concrete',width:12,name:'离线道路',selected:true,active:false,caps:[12,12]});assert.deepEqual(errors,[]);
  console.log('PASS offline road property controls, stable identity + actual cap width, no page errors');
}finally{await b.close();}
