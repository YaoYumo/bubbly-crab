// 道路画笔的等宽半圆端头。局部 +Z 朝道路外，直径位于 z=0；不改模型库独立尽端。
// 所有半径均由实际铺装横断面推导，不使用固定颈宽/大圆盘/矩形基座。
import * as THREE from 'three';
import { M, shade } from './mat.js';
import { sectionDimensions } from './road-section.js';

export function buildRoadEndcap(roadType, fullWidth) {
  const id = roadType.id;
  const sided = ['asphalt', 'oneway', 'concrete'].includes(id);
  const half = fullWidth / 2;
  const section=roadType.section?sectionDimensions(id,roadType.section):null;
  const curbWidth=section?.curbWidth??.45,sidewalkWidth=section?.sidewalkWidth??1.8;
  const radius = sided ? half - curbWidth - sidewalkWidth : half;
  if (!(radius > 0)) return null;
  const g = new THREE.Group();
  g.name = 'road_endcap';
  g.userData.profile = { roadType: id, pavementWidth: radius * 2, outerWidth: fullWidth };
  // 弧长步进 ≤ 0.3m，最少 48 段，切口端点精确落在 (±r,0)。
  const segments = 2 * Math.ceil(Math.max(48, Math.PI * half / .3) / 2);
  const concrete = (color, roughness = .9) => M.concrete(color, roughness);
  const asphalt = concrete(0x3a3d42, .95);
  const curb = concrete(0xb0aca4), walk = concrete(0xc8c3b7), dark = concrete(0x6f6e6a);
  const white = M.paint(0xf2f2ee, .75), yellow = M.paint(0xe0b230, .8);
  const polar = (r, i) => {
    if (i === 0) return [r, 0];
    if (i === segments) return [-r, 0];
    const a = Math.PI * i / segments;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  // 半圆/半圆环棱柱：顶面、内外壁、底面。直径处不盖墙，直接接道路横断面。
  const band = (name, r0, r1, bottom, top, material) => {
    if (!(r1 > r0 && r0 >= 0)) return;
    const pos = [], uv = [], normal = [];
    const tri = (a,b,c,n) => {
      for (const p of [a,b,c]) { pos.push(...p); uv.push(p[0],-p[2]); normal.push(...n); }
    };
    const v = (p,y) => [p[0],y,p[1]];
    for (let i=0;i<segments;i++) {
      const a=polar(r0,i), b=polar(r1,i), c=polar(r1,i+1), d=polar(r0,i+1);
      tri(v(a,top),v(c,top),v(b,top),[0,1,0]);
      if (r0>0) tri(v(a,top),v(d,top),v(c,top),[0,1,0]);
      tri(v(a,bottom),v(b,bottom),v(c,bottom),[0,-1,0]);
      if (r0>0) tri(v(a,bottom),v(c,bottom),v(d,bottom),[0,-1,0]);
      // 连续径向法线（不让端头呈低面数棱柱）；顶面仍保持平面法线。
      const wall = (p,q,r,sgn) => {
        for (const x of [p,q,r]) {
          pos.push(...x); uv.push(x[0],-x[2]);
          const l=Math.hypot(x[0],x[2]); normal.push(sgn*x[0]/l,0,sgn*x[2]/l);
        }
      };
      wall(v(b,bottom),v(b,top),v(c,top),1);
      wall(v(b,bottom),v(c,top),v(c,bottom),1);
      if(r0>0) {
        wall(v(a,bottom),v(d,top),v(a,top),-1);
        wall(v(a,bottom),v(d,bottom),v(d,top),-1);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    // 与库里 ShapeGeometry 一样使用米制 UV；shade 不再按整体包围盒拉伸纹理。
    geo.type='ShapeGeometry';
    const mesh=new THREE.Mesh(geo,material); mesh.name=name; g.add(mesh);
  };

  if (sided) {
    band('endcap_pavement',0,radius,0,.15,id==='concrete'?concrete(0x9d9c97):asphalt);
    band('endcap_curb',radius,radius+curbWidth,0,.30,curb);
    band('endcap_walk',radius+curbWidth,half,0,.30,walk);
    if (id!=='concrete' && radius>.675) {
      // 直路边线中心距路缘 0.6m，厚 0.02；在端头保持同样偏距连续绕回。
      const inset=section?section.shoulderWidth+.15:.6;
      band('endcap_edge_line',radius-inset-.075,radius-inset+.075,.152,.172,white);
    }
    // 步道分缝沿弧长约 1.8m，宽度/标高与直路 rdSideZ 一致。
    const count=Math.max(2,Math.round(Math.PI*(radius+curbWidth+sidewalkWidth/2)/1.8));
    const mat=dark;
    for(let i=1;sidewalkWidth>0&&i<count;i++) {
      const geo=new THREE.BoxGeometry(sidewalkWidth*.94,.02,.04);
      const mesh=new THREE.Mesh(geo,mat), a=Math.PI*i/count;
      const r=radius+curbWidth+sidewalkWidth/2;
      mesh.position.set(r*Math.cos(a),.31,r*Math.sin(a));
      mesh.rotation.y=-a; mesh.name='endcap_walk_joint'; g.add(mesh);
    }
  } else if (id==='freeway') {
    // The inner disk belongs to the median, not a second coplanar asphalt top.
    band('endcap_pavement',2,half,0,.15,asphalt);
    band('endcap_median',0,2,0,.15,concrete(0x8f8b82));
    band('endcap_median_base',0,.5,.125,.375,curb);
    band('endcap_median_wall',0,.3,.275,1.125,concrete(0xb5b1a8));
    const inset=section?section.shoulderWidth+.15:2.8;
    band('endcap_edge_line',half-inset-.075,half-inset+.075,.152,.172,white);
    band('endcap_median_line',section?2.075:2.45,section?2.225:2.55,.152,.172,yellow);
    band('endcap_guardrail',half-(section?.25:.6),half-(section?.15:.5),.45,.75,M.metal(0x999999,.35,.7));
  } else if (id==='gravel') {
    const gr=fullWidth-1.2;
    band('endcap_base',0,half,0,.1,concrete(0xc7ad83,.95));
    band('endcap_pavement',0,gr/2,.08,.16,concrete(0x8a8580,.95));
    band('endcap_crown',0,gr*.25,.15,.19,concrete(0x938e88,.95));
    band('endcap_track',gr*.14,gr*.30,.18,.2,concrete(0x6e6963,.95));
    band('endcap_shoulder',half-.55,half-.05,.08,.18,concrete(0x7a7570,.95));
  } else {
    const pw=Math.min(1.5,fullWidth*.5);
    band('endcap_base',0,half,0,.1,concrete(0xc7ad83,.95));
    band('endcap_bedding',0,(pw+.24)/2,.085,.135,concrete(0xbfa87e,.95));
    band('endcap_pavement',0,pw/2,.12,.18,M.paint(roadType.params?.brickColor || '#c45a3a',.85));
    band('endcap_border',pw/2+.02,pw/2+.12,.11,.19,concrete(0x9a958c));
  }
  shade(g);
  return g;
}
