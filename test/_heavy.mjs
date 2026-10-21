import * as THREE from 'three';
import { GROUPS as ARCH } from '../src/arch.js';
function defs(it){const o={};for(const p of it.params||[])o[p.k]=p.def;return o;}
const r3=(n)=>Math.round(n*100)/100;
for (const grp of ARCH) for (const it of grp.items) {
  if (process.argv[3] && it.type !== process.argv[3]) continue;
  let root; try{root=it.build(defs(it));}catch(e){continue;}
  root.updateMatrixWorld(true);
  const list=[];
  root.traverse(o=>{if(o.isMesh||o.isInstancedMesh){
    const g=o.geometry; const n=g.index?g.index.count:(g.attributes.position?.count||0);
    const t=(n/3)*(o.isInstancedMesh?o.count:1);
    g.computeBoundingBox(); const s=g.boundingBox.getSize(new THREE.Vector3());
    const bb=new THREE.Box3().setFromObject(o); const c=bb.getCenter(new THREE.Vector3()); const bs=bb.getSize(new THREE.Vector3());
    list.push({t:Math.round(t),n:o.isInstancedMesh?o.count:1,kind:o.isInstancedMesh?'INST':g.type,
      gsize:`${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`,
      wc:`(${r3(c.x)},${r3(c.y)},${r3(c.z)})`, ws:`${r3(bs.x)}x${r3(bs.y)}x${r3(bs.z)}`,
      ud:o.userData.marker||o.material?.userData?.detail||'', col:'#'+o.material?.color?.getHexString()});
  }});
  list.sort((a,b)=>b.t-a.t);
  const tot=list.reduce((a,b)=>a+b.t,0);
  console.log(`\n${grp.id}:${it.type}  meshes=${list.length} tris=${tot}`);
  for(const m of list.slice(0,8)) console.log(`   ${String(m.t).padStart(7)} x${String(m.n).padStart(4)} ${m.kind.padEnd(14)} geo=${m.gsize.padEnd(18)} 中心${m.wc.padEnd(22)} 尺寸${m.ws.padEnd(20)} ${m.col} ${m.ud}`);
}
