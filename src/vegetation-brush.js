import * as THREE from 'three';
import { LIB_INDEX, buildAsset, defaultsFor } from './assets.js';
import { bakeMerge, mergeSimilar } from './geo.js';
import { detailLevel } from './detail.js';
import { roadProfile } from './junction.js';
import { el, makeRng, removeDeep } from './util.js';
const LIMIT = 2000, STROKE_LIMIT = 160;
const TYPES = ['tree', 'sugar_maple', 'live_oak', 'sabal_palm', 'grass', 'flowers'];
export const VEGETATION = TYPES.map(type => {
  const entry = [...LIB_INDEX].find(([, v]) => v.type === type);
  return entry ? { key: entry[0], label: entry[1].name, type } : null;
}).filter(Boolean);
const prototypes = new Map();
function prototype(key) {
  const cacheKey = key + '@' + detailLevel();
  if (prototypes.has(cacheKey)) return prototypes.get(cacheKey);
  const item = LIB_INDEX.get(key); if (!item || !TYPES.includes(item.type)) throw new Error('植被种类无效');
  const params = { ...defaultsFor(item) };
  if (item.type === 'grass') Object.assign(params, { w: 1.5, d: 1.5, density: 24, height: .45 });
  if (item.type === 'flowers') Object.assign(params, { w: 1.5, d: 1.5, count: 24, height: .4 });
  const root = buildAsset(item, params);
  bakeMerge(root); mergeSimilar(root, { min: 2 }); root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), parts = [];
  root.traverse(m => {
    if (!m.isMesh) return;
    const transforms = [];
    for (let i = 0; i < (m.isInstancedMesh ? m.count : 1); i++) {
      const local = new THREE.Matrix4(); if (m.isInstancedMesh) m.getMatrixAt(i, local);
      transforms.push(m.matrixWorld.clone().multiply(local));
    }
    parts.push({ geometry: m.geometry, material: m.material, transforms });
  });
  const p = { parts, bounds, radius: Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))) };
  prototypes.set(cacheKey, p); return p;
}
export function vegetationBounds(plant, worldMatrix = new THREE.Matrix4()) {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...plant.p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), plant.rot || 0), new THREE.Vector3().setScalar(plant.s));
  return prototype(plant.key).bounds.clone().applyMatrix4(worldMatrix.clone().multiply(matrix));
}
export function buildVegetationPatch(params) {
  const root = new THREE.Group(); root.name = 'vegetation_patch';
  const plants = params.plants || []; if (plants.length > LIMIT) throw new Error('植被数量超过上限');
  const buckets = new Map();
  for (const plant of plants) {
    if (!VEGETATION.some(v => v.key === plant.key) || !plant.p?.every(Number.isFinite) || !(plant.s >= .3 && plant.s <= 2)) throw new Error('植被记录无效');
    if (!buckets.has(plant.key)) buckets.set(plant.key, []); buckets.get(plant.key).push(plant);
  }
  const placed = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3();
  for (const [key, list] of buckets) {
    const proto = prototype(key);
    const mats = new Map(), geoms = new Map();
    for (const part of proto.parts) {
      if (!geoms.has(part.geometry)) geoms.set(part.geometry, part.geometry.clone());
      const cloneMat = m => { if (!mats.has(m)) mats.set(m, m.clone()); return mats.get(m); };
      const mat = Array.isArray(part.material) ? part.material.map(cloneMat) : cloneMat(part.material);
      const mesh = new THREE.InstancedMesh(geoms.get(part.geometry), mat, list.length * part.transforms.length);
      let i = 0;
      for (const plant of list) {
        q.setFromAxisAngle(up, plant.rot || 0); s.setScalar(plant.s);
        placed.compose(new THREE.Vector3(...plant.p), q, s);
        for (const t of part.transforms) mesh.setMatrixAt(i++, new THREE.Matrix4().multiplyMatrices(placed, t));
      }
      mesh._vegetationLayout = { key, transforms: part.transforms };
      mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); root.add(mesh);
    }
  }
  return root;
}
/** Height-only refits keep instance buffers, display materials and root identity. */
export function updateVegetationPatch(root, params) {
  const buckets = new Map();
  for (const plant of params.plants || []) { if (!buckets.has(plant.key)) buckets.set(plant.key, []); buckets.get(plant.key).push(plant); }
  if (!root.children.length || root.children.some(mesh => { const l=mesh._vegetationLayout; return !l || !buckets.has(l.key) || mesh.count!==buckets.get(l.key).length*l.transforms.length; })) return false;
  if ([...buckets.keys()].some(key=>!root.children.some(m=>m._vegetationLayout.key===key))) return false;
  const placed=new THREE.Matrix4(),result=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),position=new THREE.Vector3(),scale=new THREE.Vector3();
  for (const mesh of root.children) {
    const {key,transforms}=mesh._vegetationLayout;let i=0;
    for (const plant of buckets.get(key)) {
      placed.compose(position.fromArray(plant.p),q.setFromAxisAngle(up,plant.rot||0),scale.setScalar(plant.s));
      for (const transform of transforms) mesh.setMatrixAt(i++,result.multiplyMatrices(placed,transform));
    }
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
  }
  return true;
}
function segmentDistance(x,z,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)):0;
  return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
}
export class VegetationBrush {
  constructor(app) {
    this.app=app; this.active=false; this.guides=true; this.settings={species:VEGETATION[0]?.key,radius:9,spacing:6,density:.6,scaleMin:.8,scaleMax:1.2,maxSlope:.55,seed:731};
    this.preview=new THREE.Group();this.preview.userData.pickIgnore=true;app.stage.helperLayer.add(this.preview);
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.96,1,48).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x78df86,transparent:true,opacity:.8,depthTest:false,side:THREE.DoubleSide}));
    this.ring.renderOrder=720;this.ring.visible=false;this.preview.add(this.ring);
    const dotGeometry=new THREE.BufferGeometry();dotGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(STROKE_LIMIT*3),3).setUsage(THREE.DynamicDrawUsage));dotGeometry.setDrawRange(0,0);
    this.dots=new THREE.Points(dotGeometry,new THREE.PointsMaterial({color:0x86ef95,size:.45,depthTest:false}));this.dots.frustumCulled=false;this.dots.renderOrder=721;this.preview.add(this.dots);
    app.bus.on('page-change',id=>{if(id!=='scene')this.stop();});
    app.bus.on('terrain',()=>this.refit());this.bind();
  }
  setActive(on) {
    if (on && this.app.terrain?.workflow?.busy) { this.app.notify?.('请先完成或取消地形任务', 'warn'); return false; }
    if (on) { this.app.terrain?.workflow?.cancelErosionPreview(); this.app.terrain?.workflow?.cancelDraft(); }
    if(!on){this.stop();return true;}
    const rb=this.app.roadBrush;if(rb?.active&&rb.points.length){this.app.notify('请先完成或取消当前道路绘制','warn');return false;}
    rb?.stop();this.app.state.terrainTool=null;this.app.roadPlanning?.setPicking(false);this.app.state.dofPickMode=false;
    this.active=true;this.app.bus.emit('vegetation-brush');return true;
  }
  stop() {
    this.active=false;this.stroke=null;this.ring.visible=false;this.dots.geometry.setDrawRange(0,0);
    this.app.stage.orbit.enabled=true;this.app.stage.host.style.cursor='';this.app.bus.emit('vegetation-brush');
  }
  tick() {this.preview.visible=this.active&&this.guides&&!this.app.state.preview&&!this.app.suspended;}
  obstacles() {
    const a=this.app;this.roads=(a.roadBrush?._roads||[]).map(rd=>{rd.mesh.updateMatrixWorld(true);return{half:roadProfile(rd.roadType,rd.width).half*Math.max(rd.mesh.scale.x,rd.mesh.scale.z),points:rd.curve.getSpacedPoints(Math.max(8,Math.ceil(rd.curve.getLength()/2))).map(p=>p.applyMatrix4(rd.mesh.matrixWorld))};});
    this.boxes=a.objects.filter(o=>o.visible!==false&&o.type!=='road_brush'&&o.type!=='vegetation_patch').map(o=>new THREE.Box3().setFromObject(o.root)).filter(b=>!b.isEmpty());
    this.existing=[];
    for(const o of a.objects.filter(o=>o.type==='vegetation_patch')){o.root.updateMatrixWorld(true);for(const p of o.params.plants||[]){const v=new THREE.Vector3(...p.p).applyMatrix4(o.root.matrixWorld);this.existing.push({x:v.x,z:v.z});}}
  }
  begin(point,erase=false) {
    if(!this.active)return;
    this.obstacles();this.stroke={plants:[],erase,removals:new Map(),last:null,changed:false,rng:makeRng(++this.settings.seed)};
    this.dab(point);
  }
  remember() { this.stroke.changed=true; }
  allowed(x,z,radius) {
    const tr=this.app.terrain,half=tr.size/2;
    if(Math.abs(x)+radius>half||Math.abs(z)+radius>half)return false;
    // Ground and canopy footprint must stay out of visible water / steep ground.
    const probes=[[x,z],[x-radius,z],[x+radius,z],[x,z-radius],[x,z+radius]];
    if(tr.enabled&&tr.state.water&&probes.some(([px,pz])=>tr.heightAt(px,pz)<tr.state.waterY-.1))return false;
    const slope=Math.max(Math.abs(tr.heightAt(x+1,z)-tr.heightAt(x-1,z))/2,Math.abs(tr.heightAt(x,z+1)-tr.heightAt(x,z-1))/2);
    if(slope>this.settings.maxSlope)return false;
    for(const b of this.boxes)if(x+radius>b.min.x&&x-radius<b.max.x&&z+radius>b.min.z&&z-radius<b.max.z)return false;
    for(const road of this.roads)for(let i=1;i<road.points.length;i++)if(segmentDistance(x,z,road.points[i-1],road.points[i])<road.half+radius+.5)return false;
    const min=this.settings.spacing;
    return !this.existing.some(p=>Math.hypot(x-p.x,z-p.z)<min)&&!this.stroke.plants.some(p=>Math.hypot(x-p.p[0],z-p.p[2])<min);
  }
  dab(point) {
    const stroke=this.stroke;if(!stroke)return;
    const gap=Math.max(.5,this.settings.radius*.25),last=stroke.last;
    if(last&&point.distanceTo(last)<gap)return;
    if(last){const length=point.distanceTo(last),n=Math.min(150,Math.ceil(length/gap));for(let i=1;i<=n;i++)this.sample(last.clone().lerp(point,i/n));}
    else this.sample(point);
    stroke.last=point.clone();this.updateDots();
  }
  sample(point) {
    const st=this.stroke,s=this.settings,r=s.radius;
    if(st.erase){
      for(const o of this.app.objects.filter(o=>o.type==='vegetation_patch'&&!o.locked)){
        o.root.updateMatrixWorld(true);const set=st.removals.get(o.id)||new Set();
        (o.params.plants||[]).forEach((p,i)=>{const v=new THREE.Vector3(...p.p).applyMatrix4(o.root.matrixWorld);if(Math.hypot(v.x-point.x,v.z-point.z)<=r){this.remember();set.add(i);}});
        if(set.size)st.removals.set(o.id,set);
      }
      return;
    }
    if(this.existing.length+st.plants.length>=LIMIT||st.plants.length>=STROKE_LIMIT)return;
    const rng=st.rng,attempts=Math.min(100,Math.max(1,Math.ceil(Math.PI*r*r/(s.spacing*s.spacing)*s.density*5)));
    for(let i=0;i<attempts;i++){
      if(this.existing.length+st.plants.length>=LIMIT||st.plants.length>=STROKE_LIMIT)break;
      const a=rng()*Math.PI*2,d=Math.sqrt(rng())*r,x=point.x+Math.cos(a)*d,z=point.z+Math.sin(a)*d;
      const options=s.species==='mixed'?VEGETATION.filter(v=>!['grass','flowers'].includes(v.type)):VEGETATION.filter(v=>v.key===s.species);
      const key=options[Math.floor(rng()*options.length)]?.key;if(!key)continue;
      const scale=s.scaleMin+(s.scaleMax-s.scaleMin)*rng(),proto=prototype(key);
      if(!this.allowed(x,z,proto.radius*scale))continue;
      this.remember();st.plants.push({key,p:[x,this.app.terrain.enabled?this.app.terrain.heightAt(x,z):0,z],s:scale,rot:rng()*Math.PI*2});
    }
  }
  updateDots(){
    const plants=this.stroke?.plants||[],attr=this.dots.geometry.attributes.position;
    for(let i=0;i<plants.length;i++)attr.setXYZ(i,plants[i].p[0],plants[i].p[1]+.2,plants[i].p[2]);
    attr.needsUpdate=true;this.dots.geometry.setDrawRange(0,plants.length);
  }

  end() {
    const st=this.stroke;if(!st)return 0;
    if(st.changed)this.app.beginOp(st.erase?'擦除植被':'种植植被','vegetation:'+Date.now(),true);
    this.stroke=null;let count=0;
    if(st.erase){
      const suspended=this.app._suspendUndo;this.app._suspendUndo=true;
      try{for(const [id,indices]of st.removals){const o=this.app.byId(id);if(!o||o.locked)continue;count+=indices.size;o.params.plants=o.params.plants.filter((_,i)=>!indices.has(i));if(o.params.plants.length)this.rebuild(o);else this.app.removeObject(o);}}finally{this.app._suspendUndo=suspended;}
    }else if(st.plants.length){count=st.plants.length;this.app.addVegetationPatch({plants:st.plants,seed:this.settings.seed});}
    this.updateDots();this.app.stage.orbit.enabled=true;
    if(st.changed){this.app.bus.emit('objects');this.app.saveLocal();}
    this.app.notify(st.erase?`已擦除 ${count} 株笔刷植被`:`已种植 ${count} 株（每笔最多 ${STROKE_LIMIT}，总量最多 ${LIMIT}）`);
    return count;
  }
  rebuild(o){const old=o.root,root=buildVegetationPatch(o.params);root.position.copy(old.position);root.quaternion.copy(old.quaternion);root.scale.copy(old.scale);root.userData.so=o;o.root=root;this.app.stage.world.add(root);this.app.appearance.release(old);removeDeep(old);o.apply();if(this.app.selObj===o)this.app.stage.setSelected(o);}
  refit(){
    const world=new THREE.Vector3();
    for(const o of this.app.objects.filter(o=>o.type==='vegetation_patch')){
      o.root.updateWorldMatrix(true,false);const inv=o.root.matrixWorld.clone().invert();let changed=false;
      for(const p of o.params.plants){
        world.fromArray(p.p).applyMatrix4(o.root.matrixWorld);
        const height=this.app.terrain.enabled?this.app.terrain.heightAt(world.x,world.z):0;
        if(Math.abs(height-world.y)<1e-6)continue;
        world.y=height;world.applyMatrix4(inv);p.p=world.toArray();changed=true;
      }
      if(changed && !updateVegetationPatch(o.root,o.params))this.rebuild(o);
    }
  }

  bind(){
    const st=this.app.stage,host=st.host;
    const aim=e=>{const r=st.canvas.getBoundingClientRect(),ndc=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);return this.app.dropPoint(ndc);};
    host.addEventListener('pointerdown',e=>{if(!this.active||e.button!==0||this.app.state.playing)return;e.preventDefault();e.stopPropagation();const p=aim(e);if(!p)return;st.orbit.enabled=false;host.setPointerCapture?.(e.pointerId);this.begin(p,e.shiftKey);},true);
    host.addEventListener('pointermove',e=>{if(!this.active)return;const p=aim(e);if(!p)return;this.ring.visible=true;this.ring.position.set(p.x,p.y+.12,p.z);this.ring.scale.setScalar(this.settings.radius);this.ring.material.color.set(e.shiftKey?0xf19080:0x78df86);this.dab(p);this.tick();},true);
    host.addEventListener('pointerup',e=>{if(!this.active||!this.stroke)return;e.stopPropagation();host.releasePointerCapture?.(e.pointerId);this.end();},true);
    host.addEventListener('pointercancel',()=>this.stop(),true);
    host.addEventListener('pointerleave',()=>{this.ring.visible=false;},true);
  }
}
export function vegetationControls(app){
  const b=app.vegetationBrush,s=b.settings,section=el('div',{class:'vegetation-controls'});
  const row=(label,control)=>el('div',{class:'row'},[el('label',{class:'lab',text:label}),el('div',{class:'ctl'},[control])]);
  const toggle=el('button',{class:'fbtn wide',type:'button',id:'vegetation-toggle',onclick:()=>b.setActive(!b.active)});
  const sync=()=>{toggle.textContent=b.active?'退出植被笔刷':'开启植被笔刷';toggle.classList.toggle('on',b.active);};sync();
  const off=app.bus.on('vegetation-brush',()=>{if(!section.isConnected){off();return;}sync();});
  const species=el('select',{class:'sel',id:'vegetation-species',onchange:e=>s.species=e.target.value},[el('option',{value:'mixed',text:'混合乔木'}),...VEGETATION.map(v=>el('option',{value:v.key,text:v.label}))]);species.value=s.species;
  section.append(toggle,row('植被种类',species));
  for(const [key,label,min,max,step]of [['radius','半径 m',2,40,1],['spacing','最小间距 m',1,20,.5],['density','种植密度',.1,1,.1],['scaleMin','最小缩放',.3,1,.05],['scaleMax','最大缩放',1,2,.05]]){
    section.appendChild(row(label,el('input',{class:'num',type:'number',id:'vegetation-'+key,min,max,step,value:s[key],onchange:e=>{if(Number.isFinite(e.target.valueAsNumber))s[key]=Math.max(min,Math.min(max,e.target.valueAsNumber));e.target.value=s[key];}})));
  }
  section.appendChild(el('div',{class:'fnote',text:'拖动预览种植点，松开生成；Shift 拖动擦除，Esc 退出。一笔一步撤销；避让道路、建筑、水面和陡坡，不擦除手动物品或锁定植被。'}));return section;
}
