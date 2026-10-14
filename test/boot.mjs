import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+(e.message||e))); p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errs.push(m.type()+': '+m.text().slice(0,300))});
await p.goto((process.env.URL || 'http://localhost:5174/') + '?fresh=1',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,4000));
console.log(JSON.stringify({ ok: await p.evaluate(()=>!!(window.app&&window.app.objects.length>3)), errs: errs.slice(0,10) },null,1));
await b.close();
