import * as THREE from 'three';
import { LIB_INDEX, buildAsset, defaultsFor } from './assets.js';
import { removeDeep } from './util.js';
import { roadProfile } from './junction.js';
import { detectRoadParcels, inParcel, footprintFits, boxesOverlap } from './road-parcels.js';

export const PARCEL_ZONES = {
  residential: { label:'住宅区', color:0x74bf91, types:['cape_cod','craftsman'] },
  commercial: { label:'商业区', color:0xf2ba67, types:['craftsman_cafe','adobe_strip_mall'] },
  civic: { label:'公共服务区', color:0x81a9ed, types:['school','post_office','fire_station'] },
  park: { label:'公园绿地', color:0x62c5b2, types:['live_oak','sugar_maple'] },
};

export class RoadPlanning {
  constructor(app) {
    this.app=app; this.parcels=[]; this.selectedId=null; this.picking=false; this.guides=true;
    this.status='绘制闭合路网后，点击「识别封闭区域」';
    this.grid=new THREE.Group(); this.grid.name='drawing_ground_grid'; this.grid.visible=false;
    this.overlay=new THREE.Group(); this.overlay.name='road_parcel_helpers'; this.overlay.visible=false;
    this.grid.userData.pickIgnore=this.overlay.userData.pickIgnore=true;
    app.stage.scene.add(this.grid,this.overlay); app.stage.drawingGrid=this.grid;
    app.stage.prepareDrawingGrid=()=>this.ensureGrid();
    app.bus.on('terrain',()=>{this.gridDirty=true;this.overlayDirty=true;if(app.state.grid)this.ensureGrid();});
    app.bus.on('page-change',id=>{if(id!=='scene'&&this.picking)this.setPicking(false);});
    app.bus.on('objects',()=>this.checkRoads());
    this.gridDirty=true;
  }
  changed() { this.app.bus.emit('road-planning'); }
  gridSize() { return Math.max(1,Math.min(20,Number(this.app.state.roadGridSize)||5)); }
  setGridSize(value) {
    this.app.state.roadGridSize=Math.max(1,Math.min(20,Number(value)||5));
    this.gridDirty=true; this.ensureGrid(); this.changed(); this.app.markDirty?.();
  }
  setSnap(on) { this.app.state.roadSnap=!!on;this.changed();this.app.markDirty?.(); }
  snapPoint(point,orthogonal=false,anchor=null) {
    const p=point.clone();
    if(this.app.state.roadSnap) {
      const s=this.gridSize();p.x=Math.round(p.x/s)*s;p.z=Math.round(p.z/s)*s;
      if(orthogonal&&anchor) {
        if(Math.abs(p.x-anchor.x)<Math.abs(p.z-anchor.z))p.x=anchor.x;else p.z=anchor.z;
      }
    }
    const t=this.app.terrain;
    p.y=(t?.enabled?t.heightAt(p.x,p.z):0)+.02;
    return p;
  }
  ensureGrid() {
    if(!this.gridDirty)return;
    while(this.grid.children.length)removeDeep(this.grid.children[0]);
    const tr=this.app.terrain, half=(tr?.size||320)/2, step=this.gridSize();
    const fine=[],major=[];
    const water=tr?.enabled&&tr.state.water?tr.state.waterY:-Infinity;
    const y=(x,z)=>Math.max(tr?.enabled?tr.heightAt(x,z):0,water)+.045;
    const segment=(out,x1,z1,x2,z2)=>out.push(x1,y(x1,z1),z1,x2,y(x2,z2),z2);
    const sample=Math.min(2,step);
    for(let k=Math.ceil(-half/step);k*step<=half;k++) {
      const pos=k*step,out=k%5===0?major:fine;
      for(let v=-half;v<half;v+=sample) {
        const end=Math.min(half,v+sample);
        segment(out,pos,v,pos,end);segment(out,v,pos,end,pos);
      }
    }
    for(const [points,color,opacity]of [[fine,0x698998,.38],[major,0x9bbbc8,.65]]) {
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      const line=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
      line.userData.pickIgnore=true;this.grid.add(line);
    }
    this.gridDirty=false;
  }
  stamp() {
    return JSON.stringify(this.app.roadBrush._roads.map(r=>[r.ctrl,r.width,r.roadType.id,r.filletH,r.mesh?.visible]));
  }
  checkRoads() {
    if(this.parcels.length&&this.roadStamp!==this.stamp()) {
      this.reset(false);this.status='路网已改变，请重新识别区域；已有建筑不会自动删除。';this.changed();
    }
  }
  reset(clearZones=true) {
    this.parcels=[];this.selectedId=null;this.picking=false;
    this.status='绘制闭合路网后，点击「识别封闭区域」';
    while(this.overlay.children.length)removeDeep(this.overlay.children[0]);
    this.overlay.visible=false;
    if(clearZones)this.app.state.parcelZones={};
  }
  tick() {
    this.checkRoads();
    if(this.picking&&this.app.state.terrainTool){this.picking=false;this.changed();}
    if(this.overlayDirty){this.overlayDirty=false;this.rebuildOverlay();}
    this.grid.visible=!!this.app.stage.gridWanted&&!this.app.state.preview;
    this.overlay.visible=this.picking&&this.guides&&!this.app.state.preview;
  }
  detect() {
    const rb=this.app.roadBrush;
    if(rb.active&&rb.points.length)throw new Error('请先完成或取消当前道路，再识别封闭区域。');
    const roads=rb._roads.filter(r=>!r.noJunct&&r.mesh?.visible!==false).map(r=>{
      const n=Math.max(2,Math.ceil(r.curve.getLength()/2));
      return {points:r.curve.getSpacedPoints(n).map(p=>[p.x,p.z]),half:roadProfile(r.roadType,r.width).half};
    });
    const junctions=this.app.objects.filter(o=>o.type==='road_intersection'&&o.visible!==false)
      .map(o=>o._isect.plan?.hull.map(p=>[p.x,p.z])).filter(Boolean);
    this.parcels=detectRoadParcels(roads,junctions,2);this.roadStamp=this.stamp();
    this.selectedId=this.parcels[0]?.id||null;
    this.status=this.parcels.length?`识别到 ${this.parcels.length} 个封闭区域（已退让道路 2m）`:'未发现可填充封闭区域：请确认道路成环，且退让道路后仍有足够空间。';
    this.setPicking(this.parcels.length>0);this.rebuildOverlay();this.changed();
    return this.parcels;
  }
  setPicking(on) {
    if(on)this.app.vegetationBrush?.stop();
    this.picking=!!on;
    if(on){this.app.roadBrush.stop();this.app.state.terrainTool=null;this.app.state.dofPickMode=false;this.app.select(null);}
    this.tick();this.changed();
  }
  select(id) { this.selectedId=this.parcels.some(p=>p.id===id)?id:null;this.rebuildOverlay();this.changed(); }
  get selected() {return this.parcels.find(p=>p.id===this.selectedId)||null;}
  pick(ndc) {
    if(!this.picking)return false;
    this.checkRoads();const p=this.app.dropPoint(ndc);
    if(p)this.select(this.parcels.find(q=>inParcel(p.x,p.z,q.polygon))?.id);
    return true;
  }
  rebuildOverlay() {
    this.overlayDirty=false;
    while(this.overlay.children.length)removeDeep(this.overlay.children[0]);
    const tr=this.app.terrain;
    for(const parcel of this.parcels) {
      const path=ring=>ring.slice(0,-1).map(p=>new THREE.Vector2(p[0],-p[1]));
      const shape=new THREE.Shape(path(parcel.polygon[0]));
      for(const hole of parcel.polygon.slice(1))shape.holes.push(new THREE.Path(path(hole)));
      const geo=new THREE.ShapeGeometry(shape);geo.rotateX(-Math.PI/2);
      const pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++)pos.setY(i,(tr?.enabled?tr.heightAt(pos.getX(i),pos.getZ(i)):0)+.05);
      geo.computeVertexNormals();
      const zone=this.app.state.parcelZones?.[parcel.id];
      const color=PARCEL_ZONES[zone]?.color||0x77aeea;
      const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:parcel.id===this.selectedId ? .30 : .13,depthWrite:false,depthTest:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geo,mat);mesh.userData.pickIgnore=true;mesh.renderOrder=20;this.overlay.add(mesh);
      for(const ring of parcel.polygon) {
        const points=ring.map(([x,z])=>new THREE.Vector3(x,(tr?.enabled?tr.heightAt(x,z):0)+.08,z));
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:parcel.id===this.selectedId?0xffffff:color,depthTest:false}));
        line.userData.pickIgnore=true;line.renderOrder=21;this.overlay.add(line);
      }
    }
    this.tick();
  }
  clearSelected() {
    const p=this.selected;if(!p)return 0;
    const old=this.app.objects.filter(o=>o.params?._roadParcel?.id===p.id&&!o.locked);
    if(!old.length)return 0;
    this.app.batchOp('清除区域填充',()=>{
      old.forEach(o=>this.app.removeObject(o));
      if(!this.app.objects.some(o=>o.params?._roadParcel?.id===p.id))delete this.app.state.parcelZones[p.id];
    });
    this.app._redo=[];this.app._redoAvail=0;this.app.bus.emit('undoable');
    this.app.bus.emit('objects');this.app.markDirty?.();this.rebuildOverlay();this.changed();return old.length;
  }
  fillSelected(zone,spacing=20) {
    this.checkRoads();const parcel=this.selected,config=PARCEL_ZONES[zone];
    if(!parcel||!config)throw new Error('先识别并选择一个封闭区域。');
    spacing=Math.max(10,Math.min(40,Number(spacing)||20));
    const old=this.app.objects.filter(o=>o.params?._roadParcel?.id===parcel.id&&!o.locked);
    const existing=this.app.objects.filter(o=>!old.includes(o)&&o.type!=='road_brush'&&o.type!=='road_intersection');
    const occupied=existing.map(o=>{const b=new THREE.Box3().setFromObject(o.root);return {minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z};});
    const templates=[];const candidates=[];
    try {
      for(const type of config.types) {
        const entry=[...LIB_INDEX.entries()].find(([,item])=>item.type===type);if(!entry)continue;
        const [key,item]=entry,params=defaultsFor(item),root=buildAsset(item,params);
        // 沿最长边排列，建筑保持真实模型尺寸，不为硬塞地块而缩小。
        const ring=parcel.polygon[0];let best=0,yaw=0;
        for(let i=1;i<ring.length;i++){const dx=ring[i][0]-ring[i-1][0],dz=ring[i][1]-ring[i-1][1],len=dx*dx+dz*dz;if(len>best){best=len;yaw=-Math.atan2(dz,dx);}}
        root.rotation.y=yaw;root.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
        templates.push({key,params,root,yaw,size,center});
      }
      if(!templates.length)throw new Error('没有找到该功能对应的模型。');
      const b=parcel.bounds;let tries=0;
      outer:for(let z=b.minZ+spacing/2;z<b.maxZ;z+=spacing)for(let x=b.minX+spacing/2;x<b.maxX;x+=spacing){
        if(++tries>10000)break outer;
        if(!inParcel(x,z,parcel.polygon))continue;
        for(let k=0;k<templates.length;k++){
          const t=templates[(candidates.length+k)%templates.length];
          const bounds={minX:x-t.size.x/2-1,maxX:x+t.size.x/2+1,minZ:z-t.size.z/2-1,maxZ:z+t.size.z/2+1};
          if(!footprintFits(bounds,parcel.polygon)||occupied.some(o=>boxesOverlap(o,bounds)))continue;
          candidates.push({t,x:x-t.center.x,z:z-t.center.z});occupied.push(bounds);break;
        }
        if(candidates.length>=400)break outer;
      }
      if(!candidates.length)throw new Error('区域太小或已有物体占用，当前建筑无法完整放入；可调小间距、改为公园，或扩大地块。');
      // 大地块限量时均匀抽取，不只填满扫描起点附近的几行。
      if(candidates.length>40){const spread=Array.from({length:40},(_,i)=>candidates[Math.round(i*(candidates.length-1)/39)]);candidates.splice(0,candidates.length,...spread);}
      const quiet=this.app._quietAdd;
      this.app.batchOp(`填充${config.label}`,()=>{
        this.app._quietAdd=true;
        try {
          old.forEach(o=>this.app.removeObject(o));
          for(const c of candidates){
            const so=this.app.addAsset(c.t.key,new THREE.Vector3(c.x,0,c.z),{merge:true,params:{...c.t.params,_roadParcel:{id:parcel.id,zone}}});
            so.root.rotation.y=c.t.yaw;
          }
          this.app.state.parcelZones={...this.app.state.parcelZones,[parcel.id]:zone};
        }finally{this.app._quietAdd=quiet;}
      });
      this.app._redo=[];this.app._redoAvail=0;this.app.bus.emit('undoable');
      this.status=`${config.label}：已填充 ${candidates.length} 个对象${candidates.length===40?'（单次上限 40）':''}；可一步撤销。`;
      this.app.bus.emit('objects');this.app.markDirty?.();this.rebuildOverlay();this.changed();return candidates.length;
    } finally {templates.forEach(t=>removeDeep(t.root));}
  }
}
