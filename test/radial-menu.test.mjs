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

// Safety stays in place, but every rejected invocation has an actionable reason.
const {radialBlockedReason}=await import('../src/radial-menu.js');
assert.equal(radialBlockedReason({state:{},stage:{}}),'');
for(const [patch,pattern] of [
 [{state:{playing:true}},/暂停/],
 [{stage:{dragging:true}},/松开鼠标/],
 [{stage:{exporting:true}},/导出/],
 [{exporter:{running:true}},/导出/],
 [{aiScene:{busy:true}},/等待/],
 [{reference:{busy:true}},/等待/],
 [{behaviors:{busy:true}},/等待/],
 [{sceneRecipeBusy:true},/等待/],
 [{roadBrush:{active:true}},/道路.*Enter.*Esc/],
 [{vegetationBrush:{active:true}},/植被.*笔刷|植被/],
 [{state:{terrainTool:'raise'}},/地形/],
 [{state:{dofPickMode:true}},/对焦/],
 [{terrain:{workflow:{drawing:true}}},/河道.*Enter|Enter.*河道/],
 [{terrain:{workflow:{pointDrag:{}}}},/松开鼠标/],
 [{terrain:{workflow:{erosionPreview:{}}}},/侵蚀/],
 [{terrain:{workflow:{busy:true}}},/等待/],
 [{roadPlanning:{picking:true}},/道路区域/],
])assert.match(radialBlockedReason({state:{},stage:{},...patch}),pattern);
console.log('PASS radial guards: explain busy/tool/playback states without dropping safety');
