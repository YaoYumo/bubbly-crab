import fs from 'node:fs';import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{const page=await b.newPage();page.on('pageerror',e=>console.error(e.stack));page.on('console',m=>{if(m.type()==='error')console.error(m.text().slice(0,300));});await page.goto('http://localhost:5174/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__previzBooted&&window.app,{timeout:20000});
const tag=process.env.STAIRS_TAG||'after';fs.mkdirSync('docs/cn-stairs-evidence',{recursive:true});
for(const [type,name]of [['earthterrace','夯土台基'],['hall2','歇山殿宇'],['hall','宫殿大殿']]){
 const png=await page.evaluate(async({type,name})=>{app.suspended=true;app.clearAll();const T=await import('/node_modules/three/build/three.module.js');const item=app.itemByKey(`cn:${type}:${name}`);const so=app.addAsset(`cn:${type}:${name}`);const root=so.root;
 const scene=new T.Scene();scene.background=new T.Color('#eee8dd');scene.add(root);scene.add(new T.HemisphereLight(0xffffff,0x77716a,2.7));const sun=new T.DirectionalLight(0xffedd3,3.2);sun.position.set(-15,25,18);scene.add(sun);
 const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:'#d9d2c6',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.04;scene.add(floor);
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1100,800);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
 const camera=new T.OrthographicCamera(-13.75,13.75,10,-10,.1,150);
 if(type==='earthterrace'){camera.position.set(16,11,24);camera.lookAt(0,1.5,4);}
 else {const d=so.params.d+so.params.bay*.7;camera.left=-7.56;camera.right=7.56;camera.top=5.5;camera.bottom=-5.5;camera.position.set(9,6,d/2+16);camera.lookAt(0,.9,d/2+1.4);}
 camera.updateProjectionMatrix();renderer.render(scene,camera);const png=renderer.domElement.toDataURL('image/png').split(',')[1];renderer.dispose();floor.geometry.dispose();floor.material.dispose();return png;
 },{type,name});fs.writeFileSync(`docs/cn-stairs-evidence/${type}-${tag}.png`,Buffer.from(png,'base64'));
}console.log('Rendered actual stair geometry:',tag);
}finally{await b.close();}
