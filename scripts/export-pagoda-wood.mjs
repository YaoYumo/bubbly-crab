// Browser-assisted export: bake existing procedural canvas maps into a self-contained GLB.
// Usage: bash test/withchrome.sh node scripts/export-pagoda-wood.mjs (Vite on 5174).
import fs from 'node:fs';import {createHash} from 'node:crypto';import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000});
try{
 const page=await browser.newPage();await page.goto('http://localhost:5174/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__previzBooted&&window.app,{timeout:90000});
 const result=await page.evaluate(async()=>{
  app.suspended=true;
  const {buildPagodaWood}=await import('/src/user-models/pagoda/wood.js');const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const model=buildPagodaWood(),bytes=await new GLTFExporter().parseAsync(model,{binary:true});
  const loaded=(await new GLTFLoader().parseAsync(bytes,'')).scene;let triangles=0,meshes=0,textured=0;
  loaded.traverse(n=>{if(!n.isMesh)return;meshes++;triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;if(n.material.map&&n.material.normalMap&&n.material.roughnessMap)textured++;});
  if(triangles!==34392||meshes!==9||textured!==9)throw Error('Export round trip lost geometry or maps');
  // Exercise the actual project-import path too, not merely GLTFLoader metadata.
  app.clearAll();const imported=await app.importFiles([new File([bytes],'Pagoda-wood.glb',{type:'model/gltf-binary'})]);
  if(!app.objects.length)throw Error('GLB cannot be imported by the app');
  let importedTriangles=0,importedTextured=0;app.objects[0].root.traverse(n=>{if(n.isMesh){importedTriangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;if(n.material.map&&n.material.normalMap&&n.material.roughnessMap)importedTextured++;}});if(importedTriangles!==34392||importedTextured!==9)throw Error('Project import lost faces');
  const u8=new Uint8Array(bytes);let s='';for(let i=0;i<u8.length;i+=32768)s+=String.fromCharCode(...u8.subarray(i,i+32768));
  return {base64:btoa(s),triangles,meshes,textured,appImport:true,appImportedTextured:importedTextured};
 });
 fs.mkdirSync('model-exports',{recursive:true});const bytes=Buffer.from(result.base64,'base64');fs.writeFileSync('model-exports/Pagoda-wood.glb',bytes);
 const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
 if(json.buffers.some(b=>b.uri)||json.images.some(i=>i.uri))throw Error('Export is not self contained');
 const report={file:'model-exports/Pagoda-wood.glb',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),triangles:result.triangles,meshes:result.meshes,textured:result.textured,appImport:result.appImport,appImportedTextured:result.appImportedTextured,externalResources:0,nativeWindowsTested:false};
 fs.writeFileSync('docs/pagoda-wood-evidence/glb-export.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
