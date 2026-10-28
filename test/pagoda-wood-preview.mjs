import fs from 'node:fs';import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const page=await browser.newPage();await page.goto('http://localhost:5174/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__previzBooted&&window.app,{timeout:90000});
 const shots=await page.evaluate(async()=>{
  app.suspended=true;const T=await import('/node_modules/three/build/three.module.js');const {buildPagodaWood}=await import('/src/user-models/pagoda/wood.js');const {RoomEnvironment}=await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
  const scene=new T.Scene(),model=buildPagodaWood();scene.add(model);
  scene.add(new T.HemisphereLight(0xfffaf1,0x55534c,2));
  const sun=new T.DirectionalLight(0xffedcf,3.8);sun.position.set(18,32,25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-22,right:22,top:30,bottom:-22,near:1,far:100});sun.shadow.normalBias=.025;scene.add(sun);
  const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#e0d8c8',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
  const camera=new T.OrthographicCamera(-14,14,17,-17,.1,200);camera.position.set(38,29,40);camera.lookAt(0,11,0);
  const renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.55;room.dispose();pmrem.dispose();
  const render=(w,h,ground)=>{renderer.setSize(w,h);camera.left=-17*w/h;camera.right=17*w/h;camera.updateProjectionMatrix();floor.visible=ground;scene.background=ground?new T.Color('#f0e9dc'):null;renderer.setClearColor(0,0);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png').split(',')[1];};
  const full=render(900,1100,true),thumb=render(320,320,false);
  camera.position.set(16,9,19);camera.lookAt(0,4.1,0);camera.top=7;camera.bottom=-7;renderer.setSize(1000,800);camera.left=-8.75;camera.right=8.75;camera.updateProjectionMatrix();floor.visible=true;scene.background=new T.Color('#f0e9dc');renderer.render(scene,camera);const detail=renderer.domElement.toDataURL('image/png').split(',')[1];
  environment.dispose();renderer.dispose();model.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});floor.geometry.dispose();floor.material.dispose();return{full,thumb,detail};
 });
 fs.mkdirSync('docs/pagoda-wood-evidence',{recursive:true});
 for(const [key,path]of Object.entries({full:'docs/pagoda-wood-evidence/wood-render.png',thumb:'src/user-models/pagoda/wood-preview.png',detail:'docs/pagoda-wood-evidence/wood-detail.png'}))fs.writeFileSync(path,Buffer.from(shots[key],'base64'));
 console.log('Rendered actual nine-role wood model, thumbnail and close-up (no generated substitute imagery).');
}finally{await browser.close();}
