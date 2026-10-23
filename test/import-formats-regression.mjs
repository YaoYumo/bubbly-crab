import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const b=await puppeteer.launch({headless:'shell',args:['--no-sandbox','--disable-dev-shm-usage'],protocolTimeout:180000}),errors=[];
try{
 const p=await b.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(process.env.TEST_FILE_URL||'http://localhost:5174/?fresh=1',{waitUntil:'load'});await p.waitForFunction(()=>window.__previzBooted);
 const result=await p.evaluate(async()=>{
 const a=app;a.clearAll();
 const bin=new ArrayBuffer(68),floats=new Float32Array(bin);floats.set([0,0,0,2,0,0,0,2,0,0,1,0,0,0,2,0,0]);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'triangle',mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.8,.2,.1,1],metallicFactor:0,roughnessFactor:1}}],buffers:[{byteLength:68}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:8},{buffer:0,byteOffset:44,byteLength:24}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[2,2,0]},{bufferView:1,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]},{bufferView:2,componentType:5126,count:2,type:'VEC3'}],animations:[{name:'move',samplers:[{input:1,output:2}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}]};
 let text=JSON.stringify(doc);while(text.length%4)text+=' ';const encoded=new TextEncoder().encode(text),glb=new ArrayBuffer(12+8+encoded.length+8+bin.byteLength),dv=new DataView(glb);
 dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,glb.byteLength,true);dv.setUint32(12,encoded.length,true);dv.setUint32(16,0x4e4f534a,true);new Uint8Array(glb,20,encoded.length).set(encoded);const offset=20+encoded.length;dv.setUint32(offset,bin.byteLength,true);dv.setUint32(offset+4,0x004e4942,true);new Uint8Array(glb,offset+8).set(new Uint8Array(bin));
 let out=await a.importFiles([new File([glb],'animated.glb')]);if(out.length!==1)throw new Error('GLB failed');
 const glbId=out[0].id;
 // External .gltf + .bin exercises same-directory dependency resolution.
 doc.buffers[0].uri='mesh.bin';out=await a.importFiles([new File([JSON.stringify(doc)],'triangle.gltf'),new File([bin],'mesh.bin')]);if(out.length!==1)throw new Error('GLTF dependency failed');
 const gltfId=out[0].id;
 const fbx=`; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
Objects:  {
\tGeometry: 1, "Geometry::Triangle", "Mesh" {
\t\tVertices: *9 {
\t\t\ta: 0,0,0,2,0,0,0,2,0
\t\t}
\t\tPolygonVertexIndex: *3 {
\t\t\ta: 0,1,-3
\t\t}
\t}
\tModel: 2, "Model::Triangle", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}
}
Connections:  {
\tC: "OO",1,2
}
`;
 out=await a.importFiles([new File([fbx],'triangle.fbx')]);if(out.length!==1)throw new Error('FBX fixture failed');const fbxId=out[0].id;
 const bytes=await a.saveProject();a.clearAll();a.projectAssets.records.clear();await a.importFiles([new File([bytes],'formats.previz')]);await a.projectAssets.ready();
 return[glbId,gltfId,fbxId].map(id=>{const o=a.byId(id);let vertices=0;o.root.traverse(m=>{if(m.isMesh)vertices+=m.geometry.attributes.position.count;});return{file:o.params.file,vertices,clips:o.root.animations.length,source:!!o.params.assetId};});
 });
 assert.deepEqual(result.map(r=>r.vertices),[3,3,3]);assert.deepEqual(result.map(r=>r.clips),[1,1,0]);assert.ok(result.every(r=>r.source));assert.deepEqual(errors,[]);console.log('PASS GLB animation clips, external GLTF/BIN and FBX geometry in self-contained archive:',result);
}finally{await b.close();}
