// Render the supplied geometry itself (not an AI-generated replacement).
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try {
 const page=await browser.newPage();await page.setViewport({width:1280,height:900});
 await page.goto('http://localhost:5174/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__previzBooted && window.app,{timeout:90000});
 const png=await page.evaluate(async()=>{
  app.suspended=true;
  const T=await import('/node_modules/three/build/three.module.js');
  const {buildPagoda}=await import('/src/user-models.js');
  const scene=new T.Scene(),model=buildPagoda();scene.add(model);
  scene.add(new T.HemisphereLight(0xffffff,0x444b60,2.4));
  const sun=new T.DirectionalLight(0xfff4de,3.2);sun.position.set(20,35,25);scene.add(sun);
  const camera=new T.OrthographicCamera(-17,17,17,-17,.1,200);camera.position.set(38,29,40);camera.lookAt(0,11.5,0);
  const renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;renderer.setSize(320,320);renderer.setClearColor(0,0);renderer.render(scene,camera);
  const data=renderer.domElement.toDataURL('image/png');renderer.dispose();model.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});return data.split(',')[1];
 });
 fs.writeFileSync('src/user-models/pagoda/preview.png',Buffer.from(png,'base64'));console.log('Rendered actual Pagoda model thumbnail');
} finally {await browser.close();}
