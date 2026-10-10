import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage(); await p.setViewport({ width: 900, height: 560, deviceScaleFactor: 1 });
p.on('pageerror', e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:5173/?fresh=1', { waitUntil: 'networkidle2', timeout: 120000 });
await p.waitForFunction(() => window.__previzBooted && window.__t?.buildAsset, { timeout: 180000 });
const out = await p.evaluate(async () => {
  const T = window.__t, app = T.app, THREE = T.THREE;
  T.applyScene(app, 'cn-palace');
  for (let i=0;i<4;i++){ app.step(1/60); await new Promise(r=>requestAnimationFrame(r)); }
  const pix = () => { const src=app.stage.renderer.domElement; const cv=document.createElement('canvas'); cv.width=240; cv.height=150; const cx=cv.getContext('2d'); cx.drawImage(src,0,0,240,150); const d=cx.getImageData(0,0,240,150).data; let s=0,mx=0; for(let i=0;i<d.length;i+=4){const v=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; s+=v; if(v>mx)mx=v;} return {lum:Math.round(s/(d.length/4)*10)/10, max:Math.round(mx)}; };
  const frame = async (n=3) => { for(let i=0;i<n;i++){ app.step(1/60); await new Promise(r=>requestAnimationFrame(r)); } app.stage.render(); };
  const r = {};
  for (const lv of ['lite','std','fine']) {
    app.setDetail(lv, {silent:true}); await frame();
    r[lv] = { env: pix() };
    const e = app.stage.envRT; app.stage.scene.environment = null; await frame(1);
    r[lv].noEnv = pix();
    app.stage.scene.environment = e ? e.texture : null; await frame(1);
    // 再测「有 env 但没贴图」
    const saved = []; app.stage.world.traverse(o=>{ const m=o.material; if(m && !Array.isArray(m) && m.map && m.userData?.detail){ saved.push([m,m.map,m.normalMap,m.roughnessMap]); m.map=m.normalMap=m.roughnessMap=null; m.needsUpdate=true; } });
    await frame(1); r[lv].noMaps = pix();
    for (const [m,a,n2,g] of saved) { m.map=a; m.normalMap=n2; m.roughnessMap=g; m.needsUpdate=true; }
    // 曝光/色调曲线对照：把 exposure 拉高看是否本来就该亮
    r[lv].exposure = +app.stage.renderer.toneMappingExposure.toFixed(2);
    r[lv].bgSky = !!app.stage.scene.background;
  }
  r.texPx = { std: 256, cache: T.textureStats() };
  return r;
});
console.log(JSON.stringify(out,null,1));
await b.close();
