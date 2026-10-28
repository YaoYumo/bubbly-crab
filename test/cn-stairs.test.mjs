import assert from 'node:assert/strict';import * as T from 'three';import {addStairCheek} from '../src/cn-stairs.js';
for(const dir of [-1,1])for(const baseY of [0,3.7])for(const rise of [.2,1,8]){
 const g=new T.Group(),opts={x:1.44,zHigh:2,zLow:2+dir*5,yHigh:baseY+rise+.3,yLow:baseY+.15,baseY,width:.24,material:new T.MeshStandardMaterial()};
 const mesh=addStairCheek(g,opts);g.updateMatrixWorld(true);const pos=mesh.geometry.attributes.position;for(const v of pos.array)assert.ok(Number.isFinite(v));for(const v of mesh.geometry.attributes.uv.array)assert.ok(Number.isFinite(v));
 assert.equal(g.userData.stairCheeks.length,1);assert.equal(mesh.name,'斜边垂带石');
 // Probe the actual top faces, not only metadata. Profile must fall linearly in either direction.
 for(const t of [.02,.25,.5,.75,.98]){const ray=new T.Raycaster(new T.Vector3(opts.x,opts.yHigh+1,opts.zHigh+(opts.zLow-opts.zHigh)*t),new T.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);assert.ok(Math.abs(hit.point.y-(opts.yHigh+(opts.yLow-opts.yHigh)*t))<2e-5);}
 // Closed watertight solid, not a rotated floating plank. Every geometric edge has two incident triangles.
 const edges=new Map(),key=i=>[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
 for(let i=0;i<pos.count;i+=3)for(const [a,b]of [[i,i+1],[i+1,i+2],[i+2,i]]){const k=[key(a),key(b)].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}for(const n of edges.values())assert.equal(n,2);
 let vol=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();for(let i=0;i<pos.count;i+=3){a.fromBufferAttribute(pos,i);b.fromBufferAttribute(pos,i+1);c.fromBufferAttribute(pos,i+2);vol+=a.dot(b.cross(c))/6;}
 const expected=opts.width*Math.abs(opts.zLow-opts.zHigh)*((opts.yHigh+opts.yLow)/2-baseY);assert.ok(Math.abs(Math.abs(vol)-expected)<1e-4);
 mesh.geometry.dispose();mesh.material.dispose();
}
assert.throws(()=>addStairCheek(new T.Group(),{x:0,zHigh:0,zLow:0,yHigh:1,yLow:.1,width:.2}),/Invalid/);
console.log('PASS sloping stair cheeks: both directions, raised landings, small/large rises, exact raycast top profile, watertight solid, finite UVs/geometry and positive volume');
