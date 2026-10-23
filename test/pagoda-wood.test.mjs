import assert from 'node:assert/strict';
import * as T from 'three';
import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {buildPagoda,createPagodaGeometry,PAGODA_INFO} from '../src/user-models/pagoda/build.js';
import {buildPagodaWood,PAGODA_WOOD_PALETTE} from '../src/user-models/pagoda/wood.js';
import {PAGODA_PARTS} from '../src/user-models/pagoda/parts.js';
import {pagodaRole} from '../scripts/pagoda-material-rules.mjs';
const source=JSON.parse(gunzipSync(fs.readFileSync('src/user-models/pagoda/source.gltf.gz'))),original=createPagodaGeometry();
let cursor=0;const nodes=new Set();
for(const p of PAGODA_PARTS){assert.equal(p.start,cursor);assert.ok(p.count>0 && p.count%3===0);assert.equal(source.nodes[p.node].name,p.name);assert.equal(pagodaRole(p.name,p.node).role,p.role);cursor+=p.count;assert.ok(!nodes.has(p.node));nodes.add(p.node);}
assert.equal(cursor,103176);assert.equal(nodes.size,531);assert.throws(()=>pagodaRole('unknown_mesh',1000),/Unreviewed/);
for(const id of [19,99,187,275,363])assert.equal(PAGODA_PARTS.find(p=>p.node===id).role,'timber');
for(const id of [9,10,11,12,13,14,15,16,18])assert.equal(PAGODA_PARTS.find(p=>p.node===id).role,'stone');
const a=buildPagodaWood(),b=buildPagodaWood();assert.equal(a.children.length,9);
let triangles=0;
for(const mesh of a.children){
 const role=mesh.userData.pagodaRole,parts=PAGODA_PARTS.filter(p=>p.role===role);let dst=0;
 assert.equal(mesh.material.userData.detail,PAGODA_WOOD_PALETTE[role].kind);
 assert.equal(mesh.material.color.getHexString(),PAGODA_WOOD_PALETTE[role].color.slice(1));
 for(const p of parts){for(const name of ['position','normal'])assert.deepEqual(mesh.geometry.attributes[name].array.subarray(dst*3,(dst+p.count)*3),original.attributes[name].array.subarray(p.start*3,(p.start+p.count)*3));dst+=p.count;}
 assert.equal(dst,mesh.geometry.attributes.position.count);triangles+=dst/3;
 assert.equal(mesh.geometry.attributes.uv.count,dst);for(const v of mesh.geometry.attributes.uv.array)assert.ok(Number.isFinite(v));
 assert.equal(mesh.geometry.userData.detFit,1);
 assert.notEqual(mesh.geometry,b.children.find(m=>m.userData.pagodaRole===role).geometry);assert.notEqual(mesh.material,b.children.find(m=>m.userData.pagodaRole===role).material);
}
assert.equal(triangles,34392);
const bounds=o=>{o.updateMatrixWorld(true);return new T.Box3().setFromObject(o);},size=bounds(a).getSize(new T.Vector3());
size.toArray().forEach((v,i)=>assert.ok(Math.abs(v-PAGODA_INFO.sourceBounds.size[i])<1e-5));assert.ok(Math.abs(bounds(a).min.y)<1e-5);
const custom=buildPagodaWood({height:12,woodColor:'#663322',roofColor:'#112233',stoneColor:'#999999'});
assert.ok(Math.abs(bounds(custom).getSize(new T.Vector3()).y-12)<1e-5);
assert.equal(custom.children.find(m=>m.userData.pagodaRole==='timber').material.color.getHexString(),'663322');
assert.equal(custom.children.find(m=>m.userData.pagodaRole==='roof').material.color.getHexString(),'112233');
assert.equal(b.children.find(m=>m.userData.pagodaRole==='roof').material.color.getHexString(),'353d43');
a.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});assert.equal(b.children.reduce((s,m)=>s+m.geometry.attributes.position.count/3,0),34392);
assert.equal(buildPagoda().children[0].material.color.getHexString(),'c4c6c8');
console.log('PASS wood variant: all 531 source parts assigned; reviewed stone/upper rail exceptions; nine distinct PBR roles; all 34392 triangles/normals/positions preserved exactly; own UVs; independent instances/colors; unchanged gray builder');
