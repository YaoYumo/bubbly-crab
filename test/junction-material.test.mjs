import assert from 'node:assert/strict';
import {junctionPlan,buildJunction,roadProfile,junctionSurface} from '../src/junction.js';
const types=['asphalt','oneway','freeway','concrete','gravel','garden'];
const arm=(id,x,z)=>{const roadType={id},p=roadProfile(roadType,12);return{dir:{x,z},pav:p.pav,half:p.half,sid:p.sid,roadType};};
for(const a of types)for(const b of types)for(const angle of [90,30]){
  const r=angle*Math.PI/180,dx=Math.cos(r),dz=Math.sin(r);
  const arms=[arm(a,1,0),arm(a,-1,0),arm(b,dx,dz),arm(b,-dx,-dz)];
  const plan=junctionPlan({x:0,z:0},arms),g=buildJunction(plan),face=g.getObjectByName('junction_face');
  const asphalt=[a,b].some(t=>['asphalt','oneway','freeway'].includes(t));
  assert.equal(junctionSurface(arms).asphalt,asphalt);
  assert.deepEqual(junctionSurface(arms),junctionSurface([...arms].reverse()),'order-independent material');
  assert.equal(g.userData.surface,asphalt?'asphalt':junctionSurface(arms).id);
  if(asphalt){assert.equal(face.material.color.getHex(),0x3a3d42);assert.equal(face.material.roughness,.95);assert.ok(g.userData.crosswalkBars>0);}
  else assert.equal(g.userData.crosswalkBars,0,'non-asphalt surfaces must not have crosswalk bars');
  const mark=g.getObjectByName('junction_markings');
  assert.equal(mark.geometry.attributes.position.count,30*(g.userData.crosswalkBars+g.userData.stopLines),'metadata must match actual generated geometry');
  assert.equal(g.userData.stopLines,4,'stop-line rules unchanged');
  for(const m of g.children){m.geometry?.dispose();m.material?.dispose();}
}
console.log('PASS: all 36 road-type pairs × 2 angles; asphalt priority independent of order; crosswalk geometry only on asphalt; stop lines preserved');
