import * as THREE from 'three';
import { LIB, defaultsFor, buildAsset } from '../src/assets.js';
import { render, collect } from './shots.mjs';
// 用法: node test/_zoom.mjs <grp> <type> <x0,x1,y0,y1,z0,z1> [视图: 0前 1右 3轴测] [宽字符]
const [grp,type,rng,vi='0',cw='96'] = process.argv.slice(2);
const [x0,x1,y0,y1,z0,z1] = rng.split(',').map(Number);
const VIEWS=[[0,0,1],[1,0,0],[0,0,-1],[1,0.66,1]];
const it=LIB.find(g=>g.id===grp).items.find(i=>i.type===type);
const root=buildAsset(it,defaultsFor(it));
const T=collect(root);
const box=new THREE.Box3(new THREE.Vector3(x0,y0,z0), new THREE.Vector3(x1,y1,z1));
const W=+cw;
const horiz = (+vi===1) ? (z1-z0) : (x1-x0);      // 侧视的水平轴是 Z，正视是 X
const H=Math.max(6, Math.round(W*(y1-y0)/((horiz)||1)/2));
const R=render(T, box, VIEWS[+vi], W*2, H*4);
// 取样成字符（每个字符 = 2×4 像素块，取块内是否有内容 + 平均亮度）
const ramp=' .:-=+*#%@';
let out='';
for(let cy=0;cy<H;cy++){
  out+='|';
  for(let cx=0;cx<W;cx++){
    let sum=0,n=0,on=0;
    for(let dy=0;dy<4;dy++)for(let dx=0;dx<2;dx++){
      const px=(cy*4+dy)*(W*2)+(cx*2+dx);
      if(R.id[px]>=0){on++; sum+=(R.rgb[px*3]*0.3+R.rgb[px*3+1]*0.6+R.rgb[px*3+2]*0.1); n++;}
    }
    out += on===0 ? ' ' : ramp[Math.max(1,Math.min(9,Math.round((sum/n)/255*9)))];
  }
  out+='\n';
}
console.log(`${grp}:${type}  区域 x[${x0},${x1}] y[${y0},${y1}] z[${z0},${z1}]  视图${vi}`);
console.log(out);
