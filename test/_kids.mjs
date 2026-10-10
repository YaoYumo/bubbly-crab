import * as THREE from 'three';
import { LIB } from '../src/assets.js';
function defs(it){const o={};for(const p of it.params||[])o[p.k]=p.def;return o;}
const [cat,type]=process.argv.slice(2);
const grp=LIB.find(g=>g.id===cat); const it=grp.items.find(i=>i.type===type);
const root=it.build(defs(it)); root.updateMatrixWorld(true);
const r3=n=>Math.round(n*100)/100;
const f=v=>`(${r3(v.x)},${r3(v.y)},${r3(v.z)})`;
root.children.forEach((c,i)=>{
  const bb=new THREE.Box3().setFromObject(c);
  const s=bb.getSize(new THREE.Vector3());
  let n=0; c.traverse(o=>{if(o.isMesh)n++;});
  console.log(String(i).padStart(3), (c.userData.marker||c.type).padEnd(12), 'mesh='+String(n).padStart(3),
    'min'+f(bb.min), 'max'+f(bb.max), 'size'+f(s));
});
