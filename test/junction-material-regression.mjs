import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
await mkdir('test/out',{recursive:true});
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
const errors=[];
try{
  const p=await b.newPage();await p.setViewport({width:1280,height:900});p.on('pageerror',e=>errors.push(String(e)));
  await p.goto('http://localhost:5174/?fresh=1',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.app?.roadBrush);
  const cases=[
    ['asphalt','concrete',90],['asphalt','concrete',30],['asphalt','gravel',90],['asphalt','garden',90],
    ['concrete','concrete',90],['concrete','gravel',90],['gravel','garden',90],['oneway','concrete',90],['freeway','concrete',90],
  ];
  for(const [a,c,angle]of cases)for(const reverse of [false,true]){
    const result=await p.evaluate(async({a,c,angle,reverse})=>{
      const {app,THREE}=window.__t;app.clearAll();
      const rad=angle*Math.PI/180,dx=Math.cos(rad),dz=Math.sin(rad);
      const len=c==='garden'?25:70;
      const roads=[{roadType:a,width:a==='freeway'?20:12,points:[[-70,0,0],[70,0,0]],fillet:false},
        {roadType:c,width:c==='garden'?3:12,points:[[-len*dx,0,-len*dz],[len*dx,0,len*dz]],fillet:false}];
      if(reverse)roads.reverse();
      // 主流程用真实 finish，覆盖画笔绘制顺序，不只测试 restore。
      const rb=app.roadBrush;
      for(const road of roads){rb.setType(road.roadType);rb.roadWidth=road.width;rb.points=road.points.map(p=>new THREE.Vector3(...p));rb.filletOn=false;rb.filletH=[];rb.finish();}
      const info=()=>app.objects.filter(o=>o.type==='road_intersection').map(o=>({surface:o.root.userData.surface,color:o.root.getObjectByName('junction_face').material.color.getHex(),crosswalks:o.root.userData.crosswalkBars,stops:o.root.userData.stopLines}));
      const drawn=info();const saved=JSON.parse(JSON.stringify(app.serialize()));saved.objects.reverse();app.loadJson(saved);
      return{drawn,restored:info()};
    },{a,c,angle,reverse});
    assert.equal(result.drawn.length,1,`${a}/${c}`);assert.deepEqual(result.drawn,result.restored,'save + reversed restore order');
    const asphalt=[a,c].some(t=>['asphalt','oneway','freeway'].includes(t)),j=result.drawn[0];
    assert.equal(j.surface,asphalt?'asphalt':[a,c].includes('concrete')?'concrete':'gravel');
    assert.equal(j.crosswalks>0,asphalt);if(asphalt)assert.equal(j.color,0x3a3d42);
    console.log('PASS',a,c,angle,reverse?'reverse':'forward',JSON.stringify(j));
    if(a==='asphalt'&&c==='concrete'&&angle===90&&!reverse||a==='concrete'&&c==='concrete'&&!reverse){
      await p.evaluate(()=>{const {app}=window.__t;app.stage.view.position.set(.01,65,.01);app.stage.orbit.target.set(0,0,0);app.stage.view.fov=50;app.stage.view.updateProjectionMatrix();app.stage.orbit.update();for(let i=0;i<6;i++)app.step();app.stage.render();});
      const clip=await p.evaluate(()=>{const r=app.stage.canvas.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};});
      await p.screenshot({path:`test/out/junction-material-${a}-${c}.png`,clip});
    }
  }
  const editing=await p.evaluate(()=>{
    const a=app,rb=a.roadBrush;
    a.clearAll();rb.restore([{name:'main',points:[[-70,0,0],[70,0,0]],roadType:'concrete',width:12},{name:'stem',points:[[0,0,-70],[0,0,0]],roadType:'asphalt',width:12}]);
    const info=()=>{const r=a.objects.find(o=>o.type==='road_intersection').root;return{surface:r.userData.surface,bars:r.userData.crosswalkBars};};
    const before=info();let so=a.objects.find(o=>o.type==='road_brush'&&o.name==='stem');
    rb.editRoad(so);rb.setType('concrete');rb.finish();const concrete=info();
    so=a.objects.find(o=>o.type==='road_brush'&&o._roadData.ctrl.every(p=>Math.abs(p[0])<1e-5));rb.editRoad(so);rb.setType('asphalt');rb.finish();
    return{before,concrete,after:info()};
  });
  assert.equal(editing.before.surface,'asphalt');assert.ok(editing.before.bars>0);assert.deepEqual(editing.concrete,{surface:'concrete',bars:0});assert.deepEqual(editing.after,editing.before);
  assert.deepEqual(errors,[]);console.log('PASS mixed T material editing + regeneration; no page errors');
}finally{await b.close();}
