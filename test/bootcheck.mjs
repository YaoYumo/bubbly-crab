import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
// 1) dev server
const p1 = await b.newPage(); await p1.setViewport({width:1500,height:880});
const e1=[]; p1.on('pageerror',e=>e1.push(String(e.message).slice(0,160))); p1.on('console',m=>{if(m.type()==='error')e1.push(m.text().slice(0,160))});
await p1.goto('http://localhost:5173/', { waitUntil:'networkidle2', timeout:90000 });
let devOk=false; try{ await p1.waitForFunction(()=>window.app&&window.app.objects.length>3,{timeout:45000}); devOk=true; }catch(e){}
await new Promise(r=>setTimeout(r,1200));
const devInfo = await p1.evaluate(()=>({objs:window.app.objects.length, shots:window.app.shots.length, boot:!!document.getElementById('boot'), canvas:!!document.querySelector('#stage canvas')}));
await p1.screenshot({ path: 'test/10-dev-server.png' });
// 2) index.html 以 file:// 打开 → 应显示可读的提示而不是无限 loading
const p2 = await b.newPage(); await p2.setViewport({width:1100,height:620});
await p2.goto('file://' + process.cwd() + '/index.html', { waitUntil:'load' });
await new Promise(r=>setTimeout(r,5200));
const hint = await p2.evaluate(()=>document.getElementById('boot')?.innerText?.replace(/\s+/g,' ').slice(0,180) || '(已消失)');
await p2.screenshot({ path:'test/11-file-hint.png' });
console.log(JSON.stringify({ devOk, devInfo, devErrors: e1.slice(0,4), fileHint: hint }, null, 1));
await b.close();
process.exit(devOk && !e1.length ? 0 : 1);
