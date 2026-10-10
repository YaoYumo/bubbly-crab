// 取景一致性：预览 fov 换算 + 导出黑边（画幅≠输出比例时）
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({width:1500,height:900});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,200))});
await p.goto('http://localhost:5173/?fresh=1',{waitUntil:'networkidle2'});
await p.waitForFunction(()=>window.app&&window.app.objects.length>3,{timeout:60000});
await new Promise(r=>setTimeout(r,900));
const rad = (d)=>d*Math.PI/180, deg=r=>r*180/Math.PI;
const res = await p.evaluate(async () => {
  const { app } = window.__t;
  const out = { cases: [] };
  const sample = (url) => new Promise((res2) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width=img.width; c.height=img.height; const x=c.getContext('2d'); x.drawImage(img,0,0); const px=(X,Y)=>{const d=x.getImageData(X,Y,1,1).data; return [d[0],d[1],d[2]];}; res2({ w:img.width, h:img.height, corner: px(3,3), center: px(Math.round(img.width/2), Math.round(img.height/2)), barTop: px(Math.round(img.width/2), 3), edge: px(3, Math.round(img.height/2)), inner: px(Math.round(img.width/2), Math.round(img.height*0.30)) }); }; img.src = url; });
  [...document.querySelectorAll('.itab')].find((x) => x.textContent.includes('导出'))?.click();
  await new Promise((r) => setTimeout(r, 250));
  const shot = app.shots[0];
  for (const [asp, W, H] of [['2.39', 1280, 720], ['1.85', 1280, 720], ['9:16', 720, 1280], ['1:1', 800, 800], ['fit', 1280, 720]]) {
    app.state.aspect = asp; app.updateAspectOverlay();
    app.setPreview(true);
    app.state.time = 2.0; app.step(1/30, false); app.stage.render();
    const c = app.stage.w / app.stage.h;
    const t = app.exportAspectValue();
    const k = !t || t >= c ? 1 : t / c, m = !t || t >= c ? (t ? c / t : 1) : 1;
    const hfov = shot.hFov();
    const wantFov = 2*Math.atan(Math.tan(hfov/2)/Math.max(0.25, c*k))*180/Math.PI;
    const box = document.querySelector('.frame-mask .box').getBoundingClientRect();
    const cv = app.stage.canvas.getBoundingClientRect();
    const gotFov = app.stage.view.fov, gotAsp = app.stage.view.aspect;
    const url = await app.exporter.still({ width: W, height: H, asDataUrl: true });
    const px = await sample(url);
    out.cases.push({ asp, W, H, t:+(t||0).toFixed(3), fovOK: Math.abs(gotFov - wantFov) < 1e-6, gotFov:+gotFov.toFixed(3), wantFov:+wantFov.toFixed(3),
      canvasAspect:+gotAsp.toFixed(3), boxRatio:+(box.width/box.height).toFixed(3), wantBoxRatio:+(t||(cv.width/cv.height)).toFixed(3),
      cornerBlack: px.corner.every(v=>v<8), centerBright: px.center.some(v=>v>24), edgeBlack: px.edge.every(v=>v<8),
      barInside: px.barTop.every(v=>v<8), size:[px.w,px.h] });
    app.setPreview(false);
  }
  out.state = { preview: app.state.preview, aspect: app.state.aspect, rect: app.stage.exportRect };
  return out;
});
console.log(JSON.stringify({ res, errs: errs.slice(0,5), errCount: errs.length }, null, 1));
await b.close();
