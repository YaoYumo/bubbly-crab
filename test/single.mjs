// 单文件版（file:// 直接打开）可用性检查
import puppeteer from 'puppeteer';
const url = 'file://' + process.cwd() + '/previz-lab.html';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({width:1500,height:880});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+(e.message||'').slice(0,200))); p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,200))});
await p.goto(url, { waitUntil:'load', timeout:90000 });
let ok = false;
try { await p.waitForFunction(()=>window.app&&window.app.objects.length>3,{timeout:60000}); ok=true; } catch(e){}
await new Promise(r=>setTimeout(r,1500));
const info = await p.evaluate(() => ({
  hasApp: !!window.app, objs: window.app?.objects.length||0, shots: window.app?.shots.length||0,
  exposed: typeof window.__t, boot: !!document.getElementById('boot'),
  canvas: (()=>{const c=document.querySelector('#stage canvas'); const g=c&&c.getContext&&(c.getContext('webgl2')||c.getContext('webgl')); return !!c && !!g;})(),
  cards: document.querySelectorAll('.card').length, ls: (()=>{try{localStorage.setItem('x','1');localStorage.removeItem('x');return true}catch(e){return false}})(),
  lib: !!document.querySelector('#library .grid'),
}));
// 交互抽查：进预览、切光影、开手柄
const act = await p.evaluate(async () => {
  const app = window.app;
  app.setPreview(true); await new Promise(r=>setTimeout(r,500));
  const fov = app.stage.view.fov, prev = app.state.preview;
  app.lighting.applyPreset('night'); await new Promise(r=>setTimeout(r,400));
  app.setPreview(false);
  const so = app.addAsset('env:tree:行道树', {x:4,y:0,z:4});
  app.addObjectKey(so, 0.3);
  return { prev, fov: +fov.toFixed(2), night: app.lighting.preset, added: !!so, key: so.motion.keys.length, objs: app.objects.length };
});
await p.screenshot({ path: 'test/09-single-file.png' });
console.log(JSON.stringify({ ok, info, act, errs: errs.slice(0,6), errCount: errs.length }, null, 1));
await b.close();
process.exit(ok && !errs.length ? 0 : 1);
