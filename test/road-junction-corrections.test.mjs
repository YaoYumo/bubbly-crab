import assert from 'node:assert/strict';
import * as T from 'three';
import { junctionHeightField } from '../src/junction-elevation.js';
import { armsFromIsect,junctionPlan,gapIntervals,buildJunction } from '../src/junction.js';
import { freewayConnections } from '../src/freeway-junctions.js';
import { subtractRoadPrism } from '../src/road-prism-clip.js';
import { hitRoadHeightGrip,ROAD_HEIGHT_GRIP_OFFSET } from '../src/road-point-controls.js';
const line=(a,b)=>new T.LineCurve3(new T.Vector3(...a),new T.Vector3(...b));
const main=line([0,0,-100],[0,0,100]);
const connect=branch=>freewayConnections({newCurve:branch,newWidth:8,newType:{id:'asphalt'},existing:{curve:main,width:20,roadType:{id:'freeway'}}});
for(const end of [0,-10,50]){
  const connections=connect(line([-50,0,0],[end,0,0]));assert.equal(connections.length,end===50?2:1);
  for(const is of connections){const plan=junctionPlan(is.point,armsFromIsect(is),is.freeway);assert.equal(plan.arms.length,3);assert.equal(plan.walks.length,0);
    assert.ok(plan.hull.every(p=>(p.x-is.freeway.origin.x)*is.freeway.normal.x+(p.z-is.freeway.origin.z)*is.freeway.normal.z>=2.02-1e-8));
    assert.equal(plan.edges.filter(e=>e.mouth).length,3,'clipping must not turn a lane mouth into a transverse curb');
    const patch=buildJunction(plan);assert.equal(patch.userData.crosswalkBars,0);assert.equal(patch.userData.stopLines,0);
  }
}
assert.equal(connect(line([-50,8,0],[50,8,0])).length,0,'grade separation');
assert.equal(freewayConnections({newCurve:line([-50,0,0],[50,0,0]),newWidth:20,newType:{id:'freeway'},existing:{curve:main,width:20,roadType:{id:'freeway'}}}).length,0,'no invented median-crossing freeway/freeway portal');
console.log('PASS independent near-side freeway ports / opposite carriageway + median half-plane / no transverse mouth curb / no freeway pedestrian markings / grade separation');
for(const deg of [6,15,30,60,90])for(const grade of [0,.3,1])for(const widths of [[4,12],[16,6]]){
  const angle=deg*Math.PI/180,d={x:Math.cos(angle),z:Math.sin(angle)},a=line([-45,-45*grade,0],[45,45*grade,0]),b=line([0,0,0],[d.x*18,18*grade,d.z*18]);
  const is={newCurve:b,existingCurve:a,tNew:0,tExisting:.5,newWidth:widths[0],existingWidth:widths[1],newRoadType:{id:'asphalt'},existingRoadType:{id:'asphalt'}};
  const arms=armsFromIsect(is),plan=junctionPlan({x:0,z:0},arms);
  for(const arm of arms){assert.ok(Math.abs(Math.hypot(arm.dir.x,arm.dir.z)-1)<1e-9);assert.ok(arm.c<=arm.available+1e-9);}
  const branchArm=arms[0];if(branchArm.capped)assert.ok(plan.hull.every(p=>p.x*d.x+p.z*d.z<=18+1e-7));
  const field=junctionHeightField(plan,0);if(grade&&deg===90)assert.ok(Number.isFinite(field?.(3,2)));
  const flatA=line([-45,0,0],[45,0,0]),flatB=line([0,0,0],[d.x*18,0,d.z*18]);
  const flat=junctionPlan({x:0,z:0},armsFromIsect({...is,newCurve:flatB,existingCurve:flatA}));
  assert.equal(plan.hull.length,flat.hull.length);plan.hull.forEach((p,i)=>assert.ok(Math.hypot(p.x-flat.hull[i].x,p.z-flat.hull[i].z)<1e-5,'a vertical grade must not change a horizontal mouth'));
  for(const r of gapIntervals(a,plan,widths[1]/2+2.25))assert.ok(r.t0>=0&&r.t1<=1&&r.t1>=r.t0);
}
console.log('PASS 60 acute/short/wide/graded plans / horizontal unit frames / bounded real endpoints / grade-invariant XZ mouths');
// Real triangle splitting, including shared median/opposite-carriageway triangles.
const root=new T.Group(),slab=new T.Mesh(new T.BoxGeometry(20,.2,30),new T.MeshBasicMaterial({side:T.DoubleSide}));root.add(slab);
subtractRoadPrism(root,[{x:-12,z:-5},{x:-2.02,z:-5},{x:-2.02,z:5},{x:-12,z:5}]);root.updateMatrixWorld(true);
const ray=(x,z)=>new T.Raycaster(new T.Vector3(x,3,z),new T.Vector3(0,-1,0)).intersectObject(root,true);
assert.equal(ray(-6,0).length,0);for(const [x,z]of [[0,0],[6,0],[-6,9]])assert.ok(ray(x,z).length>0);
for(const [name,a]of Object.entries(slab.geometry.attributes)){assert.ok([...a.array].every(Number.isFinite),name);assert.equal(a.count,slab.geometry.attributes.position.count);}
assert.ok(slab.geometry.groups.length>0);
console.log('PASS triangle-level prism subtraction / preserved median and opposing slab / normals, UVs, material groups');
const camera=new T.PerspectiveCamera(50,1,.1,100);camera.position.set(0,8,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const stage={view:camera,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:600,height:600})}};
assert.equal(hitRoadHeightGrip({clientX:300,clientY:300-ROAD_HEIGHT_GRIP_OFFSET},stage,[[0,0,0]]),0);
assert.equal(hitRoadHeightGrip({clientX:300,clientY:300},stage,[[0,0,0]]),-1);
console.log('PASS explicit screen-offset Y grip hit target distinct from planar point');
