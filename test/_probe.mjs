import * as THREE from 'three';
import { LIB } from '../src/assets.js';
function defs(it){const o={};for(const p of it.params||[])o[p.k]=p.def;return o;}
const [cat,type]=process.argv.slice(2);
const grp=LIB.find(g=>g.id===cat); const it=grp.items.find(i=>i.type===type);
const root=it.build(defs(it)); root.updateMatrixWorld(true);
const bb=new THREE.Box3().setFromObject(root);
console.log('bbox', bb.min.toArray().map(v=>v.toFixed(2)).join(','), '→', bb.max.toArray().map(v=>v.toFixed(2)).join(','));
// 沿 +Z 方向切一刀：统计每个 z 切片上的最高点（用来看屋面前后轮廓）
const N=40, best=new Array(N).fill(-Infinity);
const v=new THREE.Vector3();
root.traverse(o=>{
  if(!o.isMesh&&!o.isInstancedMesh)return;
  const g=o.geometry, pos=g.attributes.position;
  const cnt=o.isInstancedMesh?o.count:1;
  const m=new THREE.Matrix4();
  for(let k=0;k<cnt;k++){
    if(o.isInstancedMesh){o.getMatrixAt(k,m); m.premultiply(o.matrixWorld);} else m.copy(o.matrixWorld);
    const stepN = Math.max(1, Math.floor(pos.count/400));
    for(let i=0;i<pos.count;i+=stepN){
      v.fromBufferAttribute(pos,i).applyMatrix4(m);
      const t=(v.z-bb.min.z)/(bb.max.z-bb.min.z);
      const b=Math.min(N-1,Math.max(0,Math.floor(t*N)));
      if(v.y>best[b])best[b]=v.y;
    }
  }
});
console.log('z 切片最高点轮廓（min.z→max.z）:');
console.log(best.map((v,i)=>`${(bb.min.z+(i+0.5)*(bb.max.z-bb.min.z)/N).toFixed(1)}:${v.toFixed(2)}`).join(' '));
