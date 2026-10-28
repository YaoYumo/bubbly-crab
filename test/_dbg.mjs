import * as THREE from 'three';
import { GROUPS as ARCH } from '../src/arch.js';
function defs(it){const o={};for(const p of it.params||[])o[p.k]=p.def;return o;}
const it = ARCH[0].items.find(i=>i.type===(process.argv[2]||'hall'));
const root = it.build(defs(it));
root.updateMatrixWorld(true);
const list=[];
root.traverse(o=>{if(o.isMesh||o.isInstancedMesh){
  const g=o.geometry; const n=g.index?g.index.count:(g.attributes.position?.count||0);
  const t=(n/3)*(o.isInstancedMesh?o.count:1);
  list.push({t:Math.round(t),n:o.isInstancedMesh?o.count:1,o,g});
}});
list.sort((a,b)=>b.t-a.t);
for(const m of list.slice(0,6)){
  console.log(`tris=${m.t} count=${m.n} type=${m.g.type} params=${JSON.stringify(m.g.parameters)} verts=${m.g.attributes.position.count} index=${m.g.index?m.g.index.count:'no'} ud=${JSON.stringify(m.o.userData)}`);
}
