// 导入回归：GLB / OBJ / MTL / 不支持格式 / 无选区文件
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({width:1400,height:860});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
await p.goto('http://localhost:5173/?fresh=1',{waitUntil:'networkidle2'});
await p.waitForFunction(()=>window.app&&window.app.objects.length>3,{timeout:60000});
await new Promise(r=>setTimeout(r,900));
const out = await p.evaluate(async () => {
  const { app, THREE } = window.__t;
  const res = {};
  const n0 = app.objects.length;
  // --- OBJ（含 MTL）
  const objTxt = `# cube
o Cube
v -0.5 -0.5 -0.5
v 0.5 -0.5 -0.5
v 0.5 0.5 -0.5
v -0.5 0.5 -0.5
v -0.5 -0.5 0.5
v 0.5 -0.5 0.5
v 0.5 0.5 0.5
v -0.5 0.5 0.5
vn 0 0 -1
vt 0 0
usemtl mat
f 1/1/1 2/1/1 3/1/1
f 1/1/1 3/1/1 4/1/1
f 5/1/1 7/1/1 6/1/1
f 5/1/1 8/1/1 7/1/1
f 1/1/1 5/1/1 6/1/1
f 1/1/1 6/1/1 2/1/1
f 2/1/1 6/1/1 7/1/1
f 2/1/1 7/1/1 3/1/1
f 3/1/1 7/1/1 8/1/1
f 3/1/1 8/1/1 4/1/1
f 4/1/1 8/1/1 5/1/1
f 4/1/1 5/1/1 1/1/1
`;
  const mtlTxt = `newmtl mat
Kd 0.8 0.2 0.2
Ka 0.2 0.2 0.2
Ks 0.1 0.1 0.1
Ns 40
d 1
illum 2
`;
  const fObj = new File([objTxt], 'cube.obj', { type: 'text/plain' });
  const fMtl = new File([mtlTxt], 'cube.mtl', { type: 'text/plain' });
  const got = await app.importFiles([fObj, fMtl], new THREE.Vector3(6, 0, 6));
  res.obj = { added: got.length, name: got[0]?.name, meshes: (()=>{let n=0;got[0]?.root.traverse(o=>{if(o.isMesh)n++});return n})(),
    matType: (()=>{let m=null;got[0]?.root.traverse(o=>{if(o.isMesh&&!m)m=o.material});return m?(m.type+':'+m.color.getHexString()):'none'})(),
    bbox: (()=>{const bb=new THREE.Box3().setFromObject(got[0].root);return {min:+bb.min.y.toFixed(3), size:bb.getSize(new THREE.Vector3()).toArray().map(v=>+v.toFixed(2))}})() };
  // --- GLB（手工构造：单个三角形 + 材质）
  const pos = new Float32Array([0,0,0, 2,0,0, 0,3,0]);
  const idx = new Uint16Array([0,1,2]);
  const bin = new Uint8Array(36+8);
  bin.set(new Uint8Array(pos.buffer),0); bin.set(new Uint8Array(idx.buffer),36);
  const gltf = { asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0,name:'Tri'}],
    meshes:[{primitives:[{attributes:{POSITION:0}, indices:1, material:0}]}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[2,3,0]},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962},{buffer:0,byteOffset:36,byteLength:6,target:34963}],
    buffers:[{byteLength:bin.byteLength}], materials:[{pbrMetallicRoughness:{baseColorFactor:[0.1,0.6,0.9,1],metallicFactor:0.2,roughnessFactor:0.4}}] };
  let jb = new TextEncoder().encode(JSON.stringify(gltf));
  const jp = (4-(jb.length%4))%4, jlen = jb.length+jp, bp = (4-(bin.length%4))%4, blen = bin.length+bp;
  const total = 12+8+jlen+8+blen, ab = new ArrayBuffer(total), dv = new DataView(ab), u8 = new Uint8Array(ab);
  dv.setUint32(0,0x46546C67,true); dv.setUint32(4,2,true); dv.setUint32(8,total,true);
  dv.setUint32(12,jlen,true); dv.setUint32(16,0x4E4F534A,true); u8.set(jb,20); for(let i=0;i<jp;i++) u8[20+jb.length+i]=0x20;
  const o2 = 20+jlen; dv.setUint32(o2,blen,true); dv.setUint32(o2+4,0x004E4942,true); u8.set(bin,o2+8);
  const fGlb = new File([u8], 'tri.glb', { type:'model/gltf-binary' });
  const g2 = await app.importFiles([fGlb], new THREE.Vector3(0,0,0));
  res.glb = { added: g2.length, name: g2[0]?.name, bbox: (()=>{const bb=new THREE.Box3().setFromObject(g2[0].root);return {min:+bb.min.y.toFixed(3),max:+bb.max.y.toFixed(3),size:bb.getSize(new THREE.Vector3()).toArray().map(v=>+v.toFixed(2))}})(),
    finite: (()=>{let ok=true;g2[0]?.root.traverse(o=>{if(o.isMesh){const a=o.geometry.attributes.position.array;for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))ok=false;}});return ok})() };
  // --- 不支持格式 + 坏文件
  const n1 = app.objects.length;
  await app.importFiles([new File(['hello'], 'notes.txt', {type:'text/plain'})], new THREE.Vector3(0,0,0));
  res.badType = { added: app.objects.length - n1 };
  const n2 = app.objects.length;
  await app.importFiles([new File([new Uint8Array([1,2,3,4,5])], 'broken.glb', {type:'model/gltf-binary'})], new THREE.Vector3(0,0,0));
  res.brokenGlb = { added: app.objects.length - n2 };
  res.toastText = [...document.querySelectorAll('.toast')].map(t=>t.textContent);
  // 导入后可保存/重建（确保序列化不炸）
  const j = app.serialize(); res.serial = { objects: j.objects.length, importKeys: j.objects.filter(o=>!o.key).length };
  app.clearAll(); app.loadJson(j);
  res.afterLoad = { objects: app.objects.length, importNames: app.objects.map(o=>o.name).filter(n=>/cube|tri/.test(n)) };
  res.total = app.objects.length;
  return res;
});
console.log(JSON.stringify({ out, errs: errs.slice(0,6), errCount: errs.length }, null, 1));
await b.close();
