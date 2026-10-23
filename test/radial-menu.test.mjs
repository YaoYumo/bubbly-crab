import assert from 'node:assert/strict';
import {radialPlacement} from '../src/radial-menu.js';
for(const rect of [
 {left:274,top:52,width:824,height:716},
 {left:274,top:52,width:184,height:450},
 {left:20,top:10,width:40,height:60},
]){
 for(const x of [-999,rect.left,rect.left+rect.width/2,rect.left+rect.width,9999]){
  for(const y of [-999,rect.top,rect.top+rect.height/2,rect.top+rect.height,9999]){
   const p=radialPlacement(rect,x,y);
   assert.ok(p.size>0&&p.left>=rect.left+8&&p.top>=rect.top+8);
   assert.ok(p.left+p.size<=rect.left+rect.width-8);
   assert.ok(p.top+p.size<=rect.top+rect.height-8);
   assert.equal(p.size<240,rect.width-16<240||rect.height-16<240);
  }
 }
}
assert.equal(radialPlacement({left:0,top:0,width:800,height:600},400,300).size,320);
console.log('PASS radial placement: viewport edges, off-screen anchors, compact fallback');
