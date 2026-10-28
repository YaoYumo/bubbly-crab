import assert from 'node:assert/strict';
import { CameraEdit, readCameraEdit, sampleCameraEdit } from '../src/camera-edit.js';
const shots=[{id:'a',duration:6},{id:'b',duration:4}];
const clip=(id,shotId,start,end,sourceIn=0)=>({id,shotId,start,end,sourceIn});
const raw={version:1,enabled:true,clips:[clip('b1','b',4,6,1),clip('a1','a',1,3)]};
const edit=readCameraEdit(raw,shots,8);
assert.equal(edit.clips[0].id,'a1');assert.ok(Object.isFrozen(edit.clips[0]));
for(const [t,shot,time] of [[0,'a',0],[1,'a',0],[2,'a',1],[3,'a',2],[3.9,'a',2],[4,'b',1],[5,'b',2],[6,'b',3],[8,'b',3]]){
 const s=sampleCameraEdit(edit,shots,t);assert.equal(s.shot.id,shot);assert.equal(s.time,time);
}
assert.equal(sampleCameraEdit(readCameraEdit(),shots,3),null);
assert.equal(sampleCameraEdit({...edit,enabled:false},shots,3),null);
assert.equal(sampleCameraEdit(edit,[...shots].reverse(),4).shot.id,'b');
for(const bad of [null,NaN,Infinity,-1])assert.throws(()=>readCameraEdit({...raw,clips:[clip('c','a',bad,3)]},shots,8));
for(const clips of [[clip('c','missing',0,2)],[clip('c','a',0,3),clip('d','b',2,4)],[clip('c','a',0,2),clip('c','b',2,4)],[clip('c','a',0,9)],[clip('c','a',0,0)]])assert.throws(()=>readCameraEdit({...raw,clips},shots,8));
assert.throws(()=>readCameraEdit({...raw,version:2},shots,8));
assert.throws(()=>readCameraEdit(raw,shots,'bad'));
let undos=0;
const app={shots,state:{duration:6,time:0,fps:30,playing:false},stage:{previewControls:{}},bus:{emit(){}},beginOp(){undos++;}};
app.cameraEdit=new CameraEdit(app); const c=app.cameraEdit;
const a=c.append('a'),b=c.append('b');assert.equal(app.state.duration,10);assert.equal(c.clips[1].start,6);
assert.throws(()=>c.update(b,{start:5}));assert.equal(undos,2);assert.equal(c.clips[1].start,6);
c.split(a,2);assert.equal(c.clips.length,3);assert.equal(c.clips[1].sourceIn,2);assert.equal(c.sample(2).time,2);
assert.throws(()=>c.split(a,0));assert.throws(()=>c.duration(3));
const serialized=c.toJSON();serialized.clips[0].start=99;assert.equal(c.clips[0].start,0);
app.state.playing=true;assert.throws(()=>c.remove(a));app.state.playing=false;
app.stage.exportOwner={};assert.throws(()=>c.assemble());delete app.stage.exportOwner;
app.shots=shots.filter(s=>s.id!=='a');c.dropShot('a');assert.deepEqual(c.clips.map(x=>x.id),[b]);assert.equal(c.sample(0).shot.id,'b');
app.shots=shots;c.assemble();assert.equal(app.state.duration,10);assert.equal(c.clips.length,2);
c.update(c.clips[1].id,{sourceIn:4});c.split(c.clips[1].id,8);assert.equal(c.sample(8).time,4);
assert.equal(c.clips[2].sourceIn,4); // Split inside held source tail is continuous.
console.log('PASS camera edit validation, boundary/gap/end sampling, stable IDs, immutable data, authoring and locks');
