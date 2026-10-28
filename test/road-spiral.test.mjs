import assert from 'node:assert/strict';
import * as T from 'three';
import { automaticSpiralPath,connectorSelfClearance } from '../src/road-connector-spiral.js';
import { automaticRoadPath } from '../src/road-connector-path.js';
const a={position:[-24,8,6],tangent:new T.Vector3(1,0,0),freeway:true,outwardNormal:new T.Vector3(0,0,1),deckHalf:10,lateral:6};
const b={position:[-3,0,24],tangent:new T.Vector3(0,0,1),outwardNormal:new T.Vector3(-1,0,0),deckHalf:6,lateral:3};
for(const sx of [-1,1])for(const sz of [-1,1])for(const reverse of [false,true]){
 const reflect=q=>({...q,position:[q.position[0]*sx,q.position[1],q.position[2]*sz],tangent:q.tangent.clone().multiply(new T.Vector3(sx,1,sz)),outwardNormal:q.outwardNormal.clone().multiply(new T.Vector3(sx,1,sz))});
 const A=reflect(reverse?b:a),B=reflect(reverse?a:b),r=automaticSpiralPath(A,B);
 assert.equal(r.shape,'spiral');assert.deepEqual(r.points[0],A.position);assert.deepEqual(r.points.at(-1),B.position);
 assert.ok(r.minRadius>=12&&r.turns>=.75&&r.turns<=2&&r.length<=600&&r.maxGrade<=.182);
 assert.ok(r.flatStart>0&&r.flatEnd>0);
 const points=r.points.map(p=>new T.Vector3(...p)),stations=[0];
 for(let i=1;i<points.length;i++)stations.push(stations.at(-1)+points[i].clone().sub(points[i-1]).setY(0).length());
 assert.ok(connectorSelfClearance(points,stations,2.5));
 assert.ok(points.filter((p,i)=>stations[i]<r.flatStart-.01).every(p=>Math.abs(p.y-A.position[1])<1e-8));
 for(const [anchor,i,j,dir]of [[A,0,1,1],[B,points.length-1,points.length-2,-1]]){
  const tangent=points[j].clone().sub(points[i]).setY(0).normalize();
  assert.ok(tangent.dot(anchor.outwardNormal)>.59,'tangent lead clears the marked side');
 }
 assert.throws(()=>automaticRoadPath(A,B,{halfWidth:2.5,halfExtent:160}),/没有找到/,'short remains bounded; spiral is a separate strategy');
}
const slope=automaticSpiralPath({...a,tangent:new T.Vector3(1,.03,0)},b);assert.ok(slope.maxGrade<=.182);
assert.throws(()=>automaticSpiralPath(a,b,{halfExtent:20}),/没有满足/);
assert.throws(()=>automaticSpiralPath(a,b,{accept:()=>false}),/没有满足/);
assert.throws(()=>automaticSpiralPath(a,{...b,position:[-3,5,24]}),/层间高差/);
const points=[[0,8,0],[12,8,0],[12,0,12],[0,0,12],[0,0,0]].map(p=>new T.Vector3(...p));
assert.ok(connectorSelfClearance(points,[0,12,24,36,48],2.5));
points.at(-1).y=7;assert.equal(connectorSelfClearance(points,[0,12,24,36,48],2.5),false);
console.log('PASS bounded spiral candidates / 8 reflections and mark orders / exact tangent leads and deck plateaus / grade / self clearance / radius and turn budget / bounds and collision rejection / short policy unchanged');
