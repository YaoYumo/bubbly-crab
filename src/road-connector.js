import * as THREE from 'three';
import { removeDeep } from './util.js';
import { roadDesignHeight } from './road-contact.js';
import { roadProfile } from './junction.js';
import { sectionForRoad, sectionDimensions, normalizeSection } from './road-section.js';
import { automaticSpiralPath } from './road-connector-spiral.js';
import { automaticRoadPath } from './road-connector-path.js';

function closestStation(road, point) {
  const curve = road._roadData.curve;
  const distance = t => { const q = curve.getPointAt(t); return (q.x - point.x) ** 2 + (q.z - point.z) ** 2 + (roadDesignHeight(curve, t) - point.y) ** 2; };
  let best = 0, dist = Infinity; const n = 160;
  for (let i = 0; i <= n; i++) { const d = distance(i / n); if (d < dist) { dist = d; best = i / n; } }
  let lo = Math.max(0, best - 1 / n), hi = Math.min(1, best + 1 / n);
  for (let i = 0; i < 24; i++) { const a = (2 * lo + hi) / 3, b = (lo + 2 * hi) / 3; if (distance(a) < distance(b)) hi = b; else lo = a; }
  const t = (lo + hi) / 2;
  return t < .0001 ? 0 : t > .9999 ? 1 : t;
}
// Station-local deck projection also works on curved/graded hosts; do not use
// nearest-XZ over a whole stacked road, or flatten a sloped host to anchor.y.
function nearbyDeckHeight(road,t){
  const curve=road._roadData.curve,dt=(road._roadData.width+24)/Math.max(1,curve.getLength()),lo=Math.max(0,t-dt),hi=Math.min(1,t+dt),n=16;
  const samples=Array.from({length:n+1},(_,i)=>{const t=lo+(hi-lo)*i/n;return{t,p:curve.getPointAt(t)};});
  return p=>{
    let best=samples[0],d=Infinity;
    for(const s of samples){const q=(s.p.x-p.x)**2+(s.p.z-p.z)**2;if(q<d){d=q;best=s;}}
    let l=Math.max(lo,best.t-(hi-lo)/n),r=Math.min(hi,best.t+(hi-lo)/n);
    const distance=t=>{const q=curve.getPointAt(t);return(q.x-p.x)**2+(q.z-p.z)**2;};
    for(let i=0;i<20;i++){const a=(2*l+r)/3,b=(l+2*r)/3;if(distance(a)<distance(b))r=b;else l=a;}
    return roadDesignHeight(curve,(l+r)/2);
  };
}
export class RoadConnector {
  constructor(app) {
    this.routeMode='auto'; this.app = app; this.marks = [null, null]; this.picking = null;
    this.status = '标记 A → 标记 B → 自动生成连接。可选整条路，也可指定路上任意接点。';
    this.overlay = new THREE.Group(); this.overlay.name = 'road-connection-markers';
    this.overlay.userData.pickIgnore = true; app.stage.helperLayer.add(this.overlay);
    app.bus.on('objects', () => {
      if (this.marks.some(m => m && !this.usable(app.byId(m.roadId)))) this.reset();
    });
    app.bus.on('page-change', id => { if (id !== 'scene') this.setPicking(null); });
  }
  usable(so) { return so?.type === 'road_brush' && !so.locked && so.visible !== false && so._roadData && !so._roadData.noJunct; }
  changed() { this.app.bus.emit('road-connector'); }
  setPicking(slot, mode = 'road') {
    if (slot !== null) {
      const rb = this.app.roadBrush;
      if (rb._editBackup || (rb.active && rb.points.length)) { this.app.notify('请先完成或取消当前道路编辑。', 'warn'); return false; }
      if (this.app.state.preview || this.app.state.playing || this.app.aiScene?.busy || this.app.suspended || this.app.terrain?.workflow?.busy) return false;
      rb.stop(); this.app.vegetationBrush?.stop(); this.app.roadPlanning?.setPicking(false);
      this.app.state.terrainTool = null; this.app.state.dofPickMode = false;
      this.app.stage.tc.detach();
      this.picking = { slot, mode };
      this.status = `请在视口点击${mode === 'road' ? '道路' : '道路上的连接点'} ${slot ? 'B' : 'A'}；Esc 退出标记。`;
    } else this.picking = null;
    this.changed(); return true;
  }
  mark(slot, so, t = 0, mode = 'point') {
    if (![0, 1].includes(slot) || !this.usable(so)) throw new Error('请选择可见且已解锁、允许接入的道路。');
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error('连接点超出道路范围。');
    const other = this.marks[1 - slot];
    if (other?.roadId === so.id && (mode === 'road' || other.mode === 'road' || Math.abs(other.t - t) < .01)) throw new Error('请标记另一条路或同一路上不同的连接点。');
    this.marks[slot] = { roadId: so.id, mode, t }; this.picking = null;
    this.status = this.marks.every(Boolean) ? 'A、B 已标记，点击「自动生成连接」。' : `已标记 ${slot ? 'B' : 'A'}，请标记另一端。`;
    this.drawMarkers(); this.changed(); return this.marks[slot];
  }
  pick(hit, ndc) {
    if (!this.picking) return false;
    const so = hit?.kind === 'obj' ? hit.so : null;
    if (!this.usable(so)) { this.app.notify('请点击一条可见、已解锁的道路，不是地面或路口面片。', 'warn'); return true; }
    const { slot, mode } = this.picking;
    let point = hit.point;
    if (mode === 'point' && ndc) {
      // A blue control point is also a valid one-click target; otherwise pick the
      // actual visible deck station, including the correct level of a stacked road.
      let best = .035;
      for (const p of this.app.roadBrush.controlPointsFor(so)) {
        const q = new THREE.Vector3(...p).project(this.app.stage.view), distance = Math.hypot(q.x - ndc.x, q.y - ndc.y);
        if (q.z >= -1 && q.z <= 1 && distance < best) { best = distance; point = new THREE.Vector3(...p); }
      }
    }
    try { this.mark(slot, so, closestStation(so, point), mode); } catch (e) { this.app.notify(e.message, 'warn'); }
    return true;
  }
  reset() {
    this.marks = [null, null]; this.picking = null;
    while (this.overlay.children.length) removeDeep(this.overlay.children[0]);
    this.status = '标记 A → 标记 B → 自动生成连接。可选整条路，也可指定路上任意接点。'; this.changed();
  }
  pairs() {
    if (!this.marks.every(Boolean)) return [];
    const [ma, mb] = this.marks, A = this.app.byId(ma.roadId), B = this.app.byId(mb.roadId);
    if (!this.usable(A) || !this.usable(B)) return [];
    const curveA = A._roadData.curve, curveB = B._roadData.curve, pairs = [];
    const add = (ta, tb) => {
      if (pairs.some(p => Math.abs(p[0] - ta) < .001 && Math.abs(p[1] - tb) < .001)) return;
      pairs.push([ta, tb]);
    };
    const point = (road, t) => road._roadData.curve.getPointAt(t).setY(roadDesignHeight(road._roadData.curve, t));
    if (ma.mode === 'point' && mb.mode === 'point') add(ma.t, mb.t);
    else if (ma.mode === 'point') { add(ma.t, closestStation(B, point(A, ma.t))); for (let i=0;i<=8;i++)add(ma.t,i/8); }
    else if (mb.mode === 'point') { add(closestStation(A, point(B, mb.t)), mb.t); for (let i=0;i<=8;i++)add(i/8,mb.t); }
    else {
      add(ma.t,mb.t);
      for (let i=0;i<=8;i++) {const t=i/8;add(t, closestStation(B, point(A, t))); add(closestStation(A, point(B, t)), t);}
      for (const a of [0, 1]) for (const b of [0, 1]) add(a, b);
    }
    return pairs.map(([ta, tb]) => {
      const make = (road, t, toward, other) => {
        const rd = road._roadData, p = point(road, t), tan = rd.curve.getTangentAt(t);let outwardNormal;
        if (rd.roadType.id === 'freeway') {
          const sign = (toward.x - p.x) * tan.z - (toward.z - p.z) * tan.x >= 0 ? 1 : -1;
          const width = rd.roadType.section ? rd.width : Math.max(20, rd.width), offset = 2 + (width - 4) / 4;
          const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize().multiplyScalar(sign * offset); p.add(n);outwardNormal=n.clone().normalize();
        }else if(other._roadData.roadType.id==='freeway'&&t>.001&&t<.999){
          // Join the near directional half, not the street centreline across traffic.
          const normal=new THREE.Vector3(tan.z,0,-tan.x).normalize();
          if((toward.x-p.x)*normal.x+(toward.z-p.z)*normal.z<0)normal.negate();
          const offset=rd.roadType.id==='oneway'?Math.max(0,rd.width/2-2.5):rd.width/4;
          p.addScaledVector(normal,offset);outwardNormal=normal;
        }
        const dt = .001, lo = Math.max(0, t - dt), hi = Math.min(1, t + dt);
        const h = rd.curve.getPointAt(hi).sub(rd.curve.getPointAt(lo)); h.y = roadDesignHeight(rd.curve, hi) - roadDesignHeight(rd.curve, lo); h.normalize();
        return { roadId: road.id, t, position: p.toArray(), tangent: h, end: t < .001 ? 0 : t > .999 ? 1 : undefined, freeway: rd.roadType.id === 'freeway', deckHeight:outwardNormal&&t>.001&&t<.999?nearbyDeckHeight(road,t):null, deckHalf:(rd.roadType.id==='freeway'&&!rd.roadType.section?Math.max(20,rd.width):rd.width)/2, lateral:outwardNormal?Math.abs((p.x-point(road,t).x)*outwardNormal.x+(p.z-point(road,t).z)*outwardNormal.z):0, outwardNormal };
      };
      const a = make(A, ta, curveB.getPointAt(tb),B), b = make(B, tb, curveA.getPointAt(ta),A);
      return { a, b, span:Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2]), distance: Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) + 5 * Math.abs(a.position[1] - b.position[1]) };
    }).sort((a, b) => a.distance - b.distance);
  }
  drawMarkers() {
    while (this.overlay.children.length) removeDeep(this.overlay.children[0]);
    const pair = this.pairs()[0];
    this.marks.forEach((m, i) => {
      const so = m && this.app.byId(m.roadId); if (!so) return;
      const position = pair ? (i ? pair.b : pair.a).position : so._roadData.curve.getPointAt(m.t).setY(roadDesignHeight(so._roadData.curve, m.t)).toArray();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const c = canvas.getContext('2d'); c.fillStyle = i ? '#f08b3e' : '#39bd8a'; c.beginPath(); c.arc(32, 32, 29, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff'; c.font = 'bold 38px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(i ? 'B' : 'A', 32, 34);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, depthWrite: false }));
      sprite.position.fromArray(position); sprite.position.y += 1; sprite.scale.setScalar(3); sprite.renderOrder = 1000; sprite.userData.pickIgnore = true;
      this.overlay.add(sprite);
    });
  }
  regenerate(so) {
    const connection=so?._roadData?.connection;
    if(!this.usable(so)||!connection?.generated||connection.anchors?.length!==2)throw new Error('请选择已解锁的自动连接道路。');
    const previous=this.marks,oldPicking=this.picking;
    this.marks=connection.anchors.map(a=>({roadId:a.roadId,t:a.t,mode:'point'}));this.picking=null;
    try{return this.generate({replace:so});}catch(e){this.marks=previous;this.picking=oldPicking;this.drawMarkers();this.changed();throw e;}
  }
  generate({replace=null,routeMode=this.routeMode}={}) {
    if (!this.marks.every(Boolean)) throw new Error('请先标记 A 和 B。');
    const app = this.app, rb = app.roadBrush;
    if (rb._editBackup || (rb.active && rb.points.length) || app.state.preview || app.state.playing || app.aiScene?.busy || app.terrain?.workflow?.busy) throw new Error('请先结束当前编辑或预演。');
    if(replace&&!this.usable(replace))throw new Error('请先解锁需要重新生成的连接道路。');
    if(!['auto','short','spiral'].includes(routeMode))throw new Error('未知连接方式。');
    const pairs = this.pairs(); if (!pairs.length) throw new Error('目标道路已删除、隐藏或锁定，请重新标记。');
    const roadA = app.byId(this.marks[0].roadId), roadB = app.byId(this.marks[1].roadId);
    const highway = pairs[0].a.freeway || pairs[0].b.freeway;
    if(routeMode==='spiral'&&!highway)throw new Error('螺旋模式目前用于高速相关的高差匝道；普通道路请选择自动或仅短连接。');
    const roadType = highway ? 'oneway' : roadA._roadData.roadType.id === 'oneway' ? 'oneway' : 'asphalt';
    const directionalWidth=road=>{const rd=road._roadData;return rd.roadType.id==='freeway'?(rd.width-4)/2:rd.roadType.id==='oneway'?rd.width:rd.width/2;};
    const available=Math.min(directionalWidth(roadA),directionalWidth(roadB));
    if(highway&&available<3.5-.01)throw new Error('目标方向车道过窄，无法接入固定 3.5m 车道；请增加目标道路车道宽或换接点。');
    const section = highway ? normalizeSection('oneway', { laneCount: 1, laneWidth: 3.5, shoulderWidth: Math.min(.75,Math.max(0,(available-3.5)/2)), sidewalkWidth: 0 }) :
      sectionForRoad(roadType, roadA._roadData.width, roadA._roadData.roadType.section);
    const dimensions = sectionDimensions(roadType, section), half = dimensions.outerWidth / 2;
    const roads = app.objects.filter(o => o.type === 'road_brush'&&o!==replace).map(o => ({
      id: o.id, half: roadProfile(o._roadData.roadType, o._roadData.width).pav,
      samples: Array.from({ length: 81 }, (_, i) => { const p = o._roadData.curve.getPointAt(i / 80); p.y = roadDesignHeight(o._roadData.curve, i / 80); return p; }),
    }));
    const obstacles = app.objects.filter(o => !['road_brush', 'road_intersection'].includes(o.type) && o.visible !== false && !o.isChar)
      .map(o => new THREE.Box3().setFromObject(o.root)).filter(b => !b.isEmpty());
    let currentPair,candidateShape='short';
    const accept = (points, stations) => {
      const length = stations.at(-1);
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        for(const [anchor,host,remaining]of [[currentPair.a,roadA,stations[i]],[currentPair.b,roadB,length-stations[i]]]){
          if(!anchor.freeway||remaining>25)continue;
          const curve=host._roadData.curve,axis=curve.getPointAt(anchor.t),tan=curve.getTangentAt(anchor.t).setY(0).normalize();
          const side=(anchor.position[0]-axis.x)*tan.z-(anchor.position[2]-axis.z)*tan.x>=0?1:-1;
          const lateral=((p.x-axis.x)*tan.z-(p.z-axis.z)*tan.x)*side;
          if(lateral<2.02+half-.05)return false;
        }
        for (const road of roads) {
          const host = road.id === roadA.id || road.id === roadB.id;
          if (host && ((road.id === roadA.id && stations[i] < Math.max(18, half + road.half + 3)) || (road.id === roadB.id && length - stations[i] < Math.max(18, half + road.half + 3)))) continue;
          const r = road.half + half + .5;
          if (road.samples.some(q => Math.hypot(q.x - p.x, q.z - p.z) < r && Math.abs(q.y - p.y) < (candidateShape==='spiral'?5.5:4)))return false;
        }
        if (obstacles.some(b => p.x + half > b.min.x && p.x - half < b.max.x && p.z + half > b.min.z && p.z - half < b.max.z && p.y + 1 > b.min.y && p.y - .2 < b.max.y))return false;
      }
      return true;
    };
    let solution, chosen, failure;
    for (const pair of routeMode==='spiral'?[]:pairs) {
      if(solution&&pair.span>solution.score)continue;
      currentPair=pair;
      try {
        const candidate = automaticRoadPath(pair.a, pair.b, { halfWidth: half, accept, terrainHeight: app.terrain?.enabled ? (x, z) => app.terrain.heightAt(x, z) : null, halfExtent: (app.terrain?.size || 320) / 2 });
        if(!solution||candidate.score<solution.score){solution=candidate;chosen=pair;}
      } catch (e) { failure = e; }
    }
    // Exhaust short host-station candidates before considering a deliberate spiral.
    if(!solution&&routeMode!=='short'&&highway){
      for(const pair of pairs.slice(0,12)){
        if(Math.abs(pair.a.position[1]-pair.b.position[1])<5.5){failure=new Error('螺旋需要至少 5.5m 设计高差以预留桥面厚度与层间净空，请选择其他接点。');continue;}
        currentPair=pair;candidateShape='spiral';
        try{
          const candidate=automaticSpiralPath(pair.a,pair.b,{halfWidth:half,accept,terrainHeight:app.terrain?.enabled?(x,z)=>app.terrain.heightAt(x,z):null,halfExtent:(app.terrain?.size||320)/2});
          if(!solution||candidate.score<solution.score){solution=candidate;chosen=pair;}
        }catch(e){failure=e;}
      }
    }
    if (!solution) throw failure || new Error('没有可用的连接点。');
    const id = replace?.id || `rc_${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    const source = { version: 2, kind:highway?'ramp':'road', generated: true, routing:{mode:routeMode,shape:solution.shape,flatStart:solution.flatStart,flatEnd:solution.flatEnd,...(solution.shape==='spiral'?{radius:solution.spiralRadius,turns:solution.turns,clearance:solution.clearance,nominalHeadroom:solution.nominalHeadroom}:{})}, anchors: [chosen.a, chosen.b].map(a => ({ roadId: a.roadId, t: a.t, position: a.position })) };
    const data = { ...replace?.serialize(),id, type: 'road_brush', name: replace?.name||'自动连接道路', roadType, section, width: dimensions.pavementWidth, points: solution.points, fillet: false, terrainMode: 'fixed', terrainOffset: 0, bridges: true, connection: source };
    // Generate inside the established edit transaction. Existing roads, their shots,
    // supports, ids and all pre-existing junctions are restored by the same pipeline.
    const before = app.serialize({ assets: false });
    const undoState=Object.fromEntries(['_undo','_redo','_undoBytes','_undoAvail','_redoAvail','_opKey'].map(k=>[k,Array.isArray(app[k])?[...app[k]]:app[k]]));
    try {
      const shots=replace?app.shots.filter(s=>s.targetId===id):[];
      app.batchOp(replace?'重新生成连接道路':'自动连接道路 A → B', () => {
        if(replace)app.removeObject(replace);
        rb.restore([data]);app.roadTerrain.sync();
        for(const shot of shots){shot.targetId=id;shot.markDirty();}
      });
    } catch (e) {
      app.loadJson(before); // no half-created network on a geometry failure
      Object.assign(app,undoState);app.bus.emit('undoable');throw e;
    }
    this.reset();
    this.status = `已自动生成${solution.shape==='spiral'?'螺旋匝道':'短连接'} ${solution.length.toFixed(1)} m 连接 · 最大纵坡 ${(solution.maxGrade * 100).toFixed(1)}%。可一步撤销；这是布景近似，不是道路工程校核。`;
    app.select({ kind: 'obj', so: app.byId(id) }); app.bus.emit('objects'); app.bus.emit('undoable'); app.markDirty?.(); this.changed();
    return app.byId(id);
  }
}
