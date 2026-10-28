import assert from 'node:assert/strict';
import * as T from 'three';
import {endpointRoadContact} from '../src/road-contact.js';
import {freewayConnections} from '../src/freeway-junctions.js';
const line=(a,b)=>new T.LineCurve3(new T.Vector3(...a),new T.Vector3(...b));
// Reproduces the screenshot's missing portal: the ramp reaches height 8 at the
// freeway centre, but the near-carriageway axis is 6m away and below height 8.
for(const angle of [10,20,45,75,90])for(const reverse of [false,true])for(const direction of [-1,1]){
 const d=angle*Math.PI/180,main=line([-180,8,0],[180,8,0]);
 const points=[[-30,8,0],[-30+100*Math.cos(d),0,direction*100*Math.sin(d)]];
 const ramp=line(...(reverse?points.slice().reverse():points));
 for(const mainNew of [false,true]){
  const ports=freewayConnections(mainNew?{newCurve:main,newWidth:20,newType:{id:'freeway'},existing:{curve:ramp,width:8,roadType:{id:'asphalt'}}}:{newCurve:ramp,newWidth:8,newType:{id:'asphalt'},existing:{curve:main,width:20,roadType:{id:'freeway'}}});
  assert.equal(ports.length,1,JSON.stringify({angle,reverse,direction,mainNew}));assert.ok(ports[0].endpointContact);assert.equal(ports[0].joinHeight,8);
 }
}
console.log('PASS 40 graded diagonal endpoint freeway ports: both endpoint directions / sides / creation orders, including 10-degree plan angle');
const main=line([-60,8,0],[60,8,0]);
for(const y of [0,4,7,9,12]){const ramp=line([-30,y,0],[30,0,60]);assert.equal(freewayConnections({newCurve:ramp,newWidth:8,newType:{id:'asphalt'},existing:{curve:main,width:20,roadType:{id:'freeway'}}}).length,0,'disconnected endpoint is not a join');}
assert.equal(endpointRoadContact(line([0,8,12],[0,0,60]),0,main,.5,10,4),null,'endpoint beyond finite deck');
assert.equal(endpointRoadContact(line([80,8,0],[80,0,60]),0,main,1,10,4),null,'no invented continuation past target endpoint');
const ordinary=endpointRoadContact(line([0,8.1,0],[60,0,60]),0,main,.5,6,4);assert.ok(ordinary);assert.equal(ordinary.height,8);
const crossing=line([0,0,-60],[0,16,60]);assert.equal(endpointRoadContact(crossing,.5,main,.5,6,4),null,'an unrelated remote endpoint cannot turn a through-crossing into a T');
console.log('PASS narrow endpoint deck/rounding tolerance / finite target / distant endpoints and real grade separation rejected');
