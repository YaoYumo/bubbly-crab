// ---------------------------------------------------------------------------
// 道路画笔 — 实时生成道路模型，使用模型库的道路模型
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { buildTwoWayRoad, buildOneWayRoad, buildConcreteRoad, buildGardenPath, buildGravelRoad } from './assets.js';

const ROAD_TYPES = [
  { id: 'asphalt', label: '沥青路', build: buildTwoWayRoad, params: { brickColor: null } },
  { id: 'oneway', label: '单向路', build: buildOneWayRoad, params: { brickColor: null } },
  { id: 'concrete', label: '混凝土路', build: buildConcreteRoad, params: { brickColor: null } },
  { id: 'garden', label: '花园小径', build: buildGardenPath, params: { brickColor: '#c45a3a' } },
  { id: 'gravel', label: '碎石路', build: buildGravelRoad, params: { brickColor: null } },
];

export { ROAD_TYPES };

export class RoadBrush {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.points = [];
    this.roadType = ROAD_TYPES[0];
    this.roadWidth = 4;
    this.filletOn = false;
    this.filletH = [];
    this._dragHandle = -1;
    this.editMode = false;
    this._dragIdx = -1;
    this._dragging = false;
    this.group = new THREE.Group();
    this.group.name = 'road-brush-preview';
    this.liveRoadMesh = null;
    this._roads = [];
    this._seq = 0;
    this._buildPreviewHelpers();
  }

  _buildPreviewHelpers() {
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4A90D9, linewidth: 2, transparent: true, opacity: 0.5 });
    const lineGeo = new THREE.BufferGeometry();
    this.previewLine = new THREE.Line(lineGeo, lineMat);
    this.previewLine.visible = false;
    this.previewLine.frustumCulled = false;
    this.group.add(this.previewLine);

    const dotGeo = new THREE.SphereGeometry(0.25, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.6 });
    this.previewDots = new THREE.Group();
    this.previewDots.visible = false;
    this._dotTemplate = new THREE.Mesh(dotGeo, dotMat);
    this.group.add(this.previewDots);

    this.filletDots = new THREE.Group();
    this.filletDots.visible = false;
    this.group.add(this.filletDots);
  }

  setType(typeId) {
    const idx = ROAD_TYPES.findIndex(t => t.id === typeId);
    if (idx >= 0) {
      this.roadType = ROAD_TYPES[idx];
      this._updateLiveRoad();
    }
  }

  cycleRoadType() {
    const idx = ROAD_TYPES.indexOf(this.roadType);
    const next = ROAD_TYPES[(idx + 1) % ROAD_TYPES.length];
    this.roadType = next;
    this._updateLiveRoad();
    return next;
  }

  setWidth(w) {
    this.roadWidth = Math.max(1, Math.min(20, w));
    this._updateLiveRoad();
  }

  toggleFillet() {
    this.filletOn = !this.filletOn;
    if (this.filletOn) this.syncFillets();
    this._updatePreview();
    this._updateLiveRoad();
    return this.filletOn;
  }

  // 转角 i（1..n-2）的几何：P 角点，u/v 指向两邻点的单位向量，bis 内角平分线
  _corner(i) {
    const pts = this.points;
    const P = pts[i];
    const u = new THREE.Vector3().subVectors(pts[i - 1], P);
    const v = new THREE.Vector3().subVectors(pts[i + 1], P);
    const lenA = u.length(), lenB = v.length();
    if (lenA < 0.01 || lenB < 0.01) return null;
    u.divideScalar(lenA);
    v.divideScalar(lenB);
    const bis = new THREE.Vector3().addVectors(u, v);
    const cosHalf = bis.length() / 2;
    if (cosHalf < 0.05) return null;
    bis.normalize();
    return { P, u, v, lenA, lenB, bis, cosHalf };
  }

  syncFillets() {
    const need = Math.max(0, this.points.length - 2);
    while (this.filletH.length < need) {
      const c = this._corner(this.filletH.length + 1);
      const hMax = c ? 0.45 * Math.min(c.lenA, c.lenB) * c.cosHalf : 1;
      this.filletH.push(Math.max(0.3, hMax * 0.5));
    }
    this.filletH.length = need;
  }

  handleMax(i) {
    const c = this._corner(i);
    return c ? 0.45 * Math.min(c.lenA, c.lenB) * c.cosHalf : 0;
  }

  // 倒角圆心手柄位置：角点沿内角平分线偏移 h（曲线实际穿过的内侧点）
  handlePos(i) {
    const c = this._corner(i);
    if (!c) return null;
    const h = this.filletH[i - 1] ?? 0;
    return c.P.clone().addScaledVector(c.bis, h).setY(c.P.y + 0.12);
  }

  setHandleFromWorld(i, w) {
    const c = this._corner(i);
    if (!c) return;
    const h = new THREE.Vector3().subVectors(w, c.P).dot(c.bis);
    this.filletH[i - 1] = Math.max(0.05, Math.min(this.handleMax(i), h));
  }

  start() {
    this.active = true;
    this.points = [];
    this.filletH = [];
    this._updatePreview();
    this.app.stage.host?.style && (this.app.stage.host.style.cursor = 'crosshair');
  }

  stop() {
    if (this.active && this.points.length >= 2) {
      this.finish();
    }
    this.active = false;
    this.points = [];
    this.filletH = [];
    this.previewLine.visible = false;
    this.previewDots.visible = false;
    this.previewDots.clear();
    this.filletDots.visible = false;
    this.filletDots.clear();
    this._clearLiveRoad();
    this.app.stage.host?.style && (this.app.stage.host.style.cursor = '');
  }

  addPoint(x, y, z) {
    if (!this.active) return;
    const terrain = this.app.terrain;
    const ty = terrain?.enabled ? terrain.heightAt(x, z) : 0;
    this.points.push(new THREE.Vector3(x, ty + 0.02, z));
    if (this.filletOn) this.syncFillets();
    this._updatePreview();
    this._updateLiveRoad();
  }

  undoPoint() {
    if (this.points.length > 0) {
      this.points.pop();
      if (this.filletOn) this.syncFillets();
      this._updatePreview();
      this._updateLiveRoad();
    }
  }

  // 路径曲线：未开倒角=直线段尖角；开倒角=每个转角用二次贝塞尔圆弧过渡
  _buildPathCurve() {
    const pts = this.points;
    if (pts.length < 2) return null;
    const path = new THREE.CurvePath();
    if (!this.filletOn || pts.length < 3) {
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i].clone(), pts[i + 1].clone()));
      return path;
    }
    let cursor = pts[0].clone();
    for (let i = 1; i < pts.length - 1; i++) {
      const c = this._corner(i);
      const h = this.filletH[i - 1];
      if (!c || h == null) {
        path.add(new THREE.LineCurve3(cursor, pts[i].clone()));
        cursor = pts[i].clone();
        continue;
      }
      const s = Math.min((2 * h) / c.cosHalf, c.lenA * 0.95, c.lenB * 0.95);
      if (s < 0.05) {
        path.add(new THREE.LineCurve3(cursor, pts[i].clone()));
        cursor = pts[i].clone();
        continue;
      }
      const t1 = c.P.clone().addScaledVector(c.u, s);
      const t2 = c.P.clone().addScaledVector(c.v, s);
      t1.y = c.P.y + (pts[i - 1].y - c.P.y) * (s / c.lenA);
      t2.y = c.P.y + (pts[i + 1].y - c.P.y) * (s / c.lenB);
      path.add(new THREE.LineCurve3(cursor, t1));
      path.add(new THREE.QuadraticBezierCurve3(t1, c.P.clone(), t2));
      cursor = t2;
    }
    path.add(new THREE.LineCurve3(cursor, pts[pts.length - 1].clone()));
    return path;
  }

  _updatePreview() {
    const pts = this.points;
    this.previewDots.clear();
    this.filletDots.clear();
    if (pts.length === 0) {
      this.previewLine.visible = false;
      this.previewDots.visible = false;
      this.filletDots.visible = false;
      return;
    }
    this.previewDots.visible = true;
    for (let i = 0; i < pts.length; i++) {
      const dotGeo = new THREE.SphereGeometry(0.3, 12, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.8 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pts[i]);
      dot.userData.pointIdx = i;
      this.previewDots.add(dot);
    }
    if (pts.length >= 2) {
      const curve = this._buildPathCurve();
      const linePoints = curve.getSpacedPoints(Math.max(24, Math.round(curve.getLength() * 2)));
      this.previewLine.geometry.dispose();
      this.previewLine.geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      this.previewLine.visible = true;
    } else {
      this.previewLine.visible = false;
    }
    if (this.filletOn && pts.length >= 3) {
      this.filletDots.visible = true;
      for (let i = 1; i < pts.length - 1; i++) {
        const hp = this.handlePos(i);
        if (!hp) continue;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xE8863A, transparent: true, opacity: 0.95 }),
        );
        dot.position.copy(hp);
        dot.userData.filletIdx = i;
        this.filletDots.add(dot);
      }
    } else {
      this.filletDots.visible = false;
    }
  }

  _clearLiveRoad() {
    if (this.liveRoadMesh) {
      this.group.remove(this.liveRoadMesh);
      this.liveRoadMesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.liveRoadMesh = null;
    }
  }

  _updateLiveRoad() {
    this._clearLiveRoad();
    if (this.points.length < 2) return;

    const curve = this._buildPathCurve();
    if (!curve) return;
    const gaps = this._detectIntersections(curve, this.roadWidth).map(is => this._gapFor(is, true));
    const mesh = this._buildRoadMesh(curve, gaps);
    if (mesh) {
      this.liveRoadMesh = mesh;
      this.group.add(mesh);
    }
  }

  finish() {
    if (this.points.length < 2) {
      this.app.notify?.('至少需要 2 个控制点', 'warn');
      return null;
    }

    const curve = this._buildPathCurve();
    const isects = curve ? this._detectIntersections(curve, this.roadWidth) : [];
    const mesh = curve ? this._addRoad(curve, {
      roadType: this.roadType, width: this.roadWidth,
      ctrl: this.points.map(p => [p.x, p.y, p.z]),
      filletH: this.filletH.slice(), filletOn: this.filletOn,
      isects,
    }) : null;

    this.points = [];
    this.filletH = [];
    this._clearLiveRoad();
    this._updatePreview();
    return mesh;
  }

  /** 由工程 JSON 恢复手绘道路（路口重新检测生成，不读存档里的 road_intersection） */
  restore(list = []) {
    const saved = { points: this.points, filletH: this.filletH, filletOn: this.filletOn, roadType: this.roadType, width: this.roadWidth };
    const out = [];
    for (const o of list) {
      const pts = (o.points || []).map(p => new THREE.Vector3(p[0], p[1], p[2]));
      if (pts.length < 2) continue;
      this.points = pts;
      this.filletOn = !!o.fillet;
      this.filletH = (o.filletH || []).slice();
      if (this.filletOn) this.syncFillets();
      const roadType = ROAD_TYPES.find(t => t.id === o.roadType) || ROAD_TYPES[0];
      const width = o.width || 4;
      this.roadType = roadType;
      this.roadWidth = width;
      const curve = this._buildPathCurve();
      if (!curve) continue;
      const isects = this._detectIntersections(curve, width);
      const mesh = this._addRoad(curve, {
        roadType, width,
        ctrl: pts.map(p => [p.x, p.y, p.z]),
        filletH: this.filletH.slice(), filletOn: this.filletOn,
        isects, so: o,
      });
      if (mesh) out.push(mesh);
    }
    this.points = saved.points; this.filletH = saved.filletH; this.filletOn = saved.filletOn;
    this.roadType = saved.roadType; this.roadWidth = saved.width;
    return out;
  }

  /** 建网格 + 注册成一等场景物体 + 生成路口并断开被交叉的既有道路 */
  _addRoad(curve, opt) {
    const { roadType, width, ctrl, filletH, filletOn, isects = [], so = null } = opt;
    const gaps = isects.map(is => { const g = this._gapFor(is, true); g.isect = is; return g; });
    const mesh = this._buildRoadMesh(curve, gaps, { width, roadType });
    if (!mesh) return null;

    const roadData = { curve, width, roadType, mesh, gaps, ctrl };
    const roadObj = {
      id: so?.id || `rb${++this._seq}`,
      root: mesh, name: so?.name || `道路_${roadType.label}`, type: 'road_brush',
      isChar: false, followTerrain: false,
      visible: so?.visible !== false, locked: !!so?.locked, params: {},
      motion: { active: false, keys: [] },
      _mgroup: new THREE.Group(),
      _roadData: roadData,
      apply() { this.root.visible = this.visible !== false; },
      onRemove: () => this._onRoadRemoved(roadData),
      serialize: () => ({
        id: roadObj.id, name: roadObj.name, type: 'road_brush',
        visible: roadObj.visible !== false, locked: !!roadObj.locked,
        roadType: roadType.id, width, fillet: filletOn, filletH, points: ctrl,
      }),
    };
    mesh.userData.so = roadObj;
    roadObj.apply();
    this.app.stage.world.add(mesh);
    this.app.objects.push(roadObj);

    for (const isect of isects) {
      const patch = this._buildIntersectionPatch(isect);
      if (patch) {
        const isectObj = {
          id: `ri${++this._seq}`,
          root: patch, name: '交叉路口', type: 'road_intersection',
          isChar: false, followTerrain: false,
          visible: true, locked: false, params: {},
          motion: { active: false, keys: [] },
          _mgroup: new THREE.Group(),
          _isect: isect,
          apply() { this.root.visible = this.visible !== false; },
          onRemove: () => this._onIsectRemoved(isect),
          serialize: () => ({
            id: isectObj.id, name: isectObj.name, type: 'road_intersection',
            visible: isectObj.visible !== false, locked: !!isectObj.locked,
            point: [isect.point.x, isect.point.y, isect.point.z],
          }),
        };
        patch.userData.so = isectObj;
        this.app.stage.world.add(patch);
        this.app.objects.push(isectObj);
      }
      // 被交叉的既有道路在路口范围内断开，避免路缘/标线穿过路口
      const ex = this._roads.find(r => r.curve === isect.existingCurve);
      if (ex) {
        ex.gaps = ex.gaps || [];
        const g = this._gapFor(isect, false);
        g.isect = isect;
        ex.gaps.push(g);
        this._rebuildRoad(ex);
      }
    }

    this._roads.push(roadData);
    return mesh;
  }

  _buildRoadMesh(curve, gaps = [], rd = null) {
    const terrain = this.app.terrain;
    const numSamples = Math.max(50, Math.round(curve.getLength() * 4));
    const halfW = (rd ? rd.width : this.roadWidth) / 2;
    const rt = rd ? rd.roadType : this.roadType;
    const roadGroup = new THREE.Group();
    roadGroup.name = `road_${rt.id}`;
    const mask = this._gapMask(numSamples, gaps);
    
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      
      const lx = point.x - right.x * halfW;
      const lz = point.z - right.z * halfW;
      const rx = point.x + right.x * halfW;
      const rz = point.z + right.z * halfW;
      
      const ly = terrain?.enabled ? terrain.heightAt(lx, lz) + 0.03 : 0.03;
      const ry = terrain?.enabled ? terrain.heightAt(rx, rz) + 0.03 : 0.03;
      
      positions.push(lx, ly, lz, rx, ry, rz);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, t * 10, 1, t * 10);
      
      if (i < numSamples && !(mask && (mask[i] || mask[i + 1]))) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();
    
    const roadMat = new THREE.MeshStandardMaterial({
      color: this._getRoadColor(rt.id),
      roughness: this._getRoadRoughness(rt.id),
      metalness: 0.02,
    });
    
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.name = `road_surface_${rt.id}`;
    roadGroup.add(roadMesh);
    
    if (rt.id === 'asphalt' || rt.id === 'oneway' || rt.id === 'concrete') {
      this._addCurbs(roadGroup, curve, numSamples, halfW, terrain, mask);
    }
    
    this._addRoadMarkings(roadGroup, curve, numSamples, rt.id, terrain, mask);
    
    return roadGroup;
  }

  // 路口范围内的采样标记：该段路面/路缘/标线不生成，由路口面片覆盖
  _gapMask(numSamples, gaps) {
    if (!gaps || !gaps.length) return null;
    const mask = new Uint8Array(numSamples + 1);
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      for (const g of gaps) {
        if (t >= g.t0 && t <= g.t1) { mask[i] = 1; break; }
      }
    }
    return mask;
  }

  // 路口在自身曲线参数上的缺口区间：两路带交集平行四边形沿自身切向的半长
  _gapFor(isect, isNew) {
    const tA = Math.max(0.001, Math.min(0.999, isect.tNew));
    const tB = Math.max(0.001, Math.min(0.999, isect.tExisting));
    const tanA = isect.newCurve.getTangentAt(tA).normalize();
    const tanB = isect.existingCurve.getTangentAt(tB).normalize();
    const c = tanA.x * tanB.z - tanA.z * tanB.x;
    const sinT = Math.abs(c);
    if (sinT < 0.08) return { t0: 0, t1: 0 };
    const cosT = Math.abs(tanA.x * tanB.x + tanA.z * tanB.z);
    const hNew = isect.newWidth / 2;
    const hEx = isect.existingWidth / 2;
    if (isNew) {
      const half = (hEx + cosT * hNew) / sinT;
      const t = isect.tNew;
      const dt = half / isect.newCurve.getLength();
      return { t0: Math.max(0, t - dt), t1: Math.min(1, t + dt) };
    }
    const half = (hNew + cosT * hEx) / sinT;
    const t = isect.tExisting;
    const dt = half / isect.existingCurve.getLength();
    return { t0: Math.max(0, t - dt), t1: Math.min(1, t + dt) };
  }

  _rebuildRoad(roadData) {
    const old = roadData.mesh;
    if (!old) return;
    const parent = old.parent;
    const mesh = this._buildRoadMesh(roadData.curve, roadData.gaps || [], roadData);
    mesh.userData.so = old.userData.so;
    if (parent) parent.add(mesh);
    if (parent) parent.remove(old);
    old.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    roadData.mesh = mesh;
    const obj = this.app.objects.find(o => o._roadData === roadData);
    if (obj) obj.root = mesh;
  }

  // 删除道路：连带清理其路口面片，并让其它道路填补留下的缺口
  _onRoadRemoved(rd) {
    const i = this._roads.indexOf(rd);
    if (i >= 0) this._roads.splice(i, 1);
    const related = o => o.type === 'road_intersection' && o._isect &&
      (o._isect.newCurve === rd.curve || o._isect.existingCurve === rd.curve);
    for (const o of this.app.objects.slice()) {
      if (related(o)) this.app.removeObject(o);
    }
    for (const other of this._roads) {
      const before = (other.gaps || []).length;
      other.gaps = (other.gaps || []).filter(g => !(g.isect && (g.isect.newCurve === rd.curve || g.isect.existingCurve === rd.curve)));
      if (other.gaps.length !== before) this._rebuildRoad(other);
    }
  }

  // 删除路口面片：两侧道路恢复连续路面
  _onIsectRemoved(isect) {
    for (const rd of this._roads) {
      const before = (rd.gaps || []).length;
      rd.gaps = (rd.gaps || []).filter(g => g.isect !== isect);
      if (rd.gaps.length !== before) this._rebuildRoad(rd);
    }
  }
  
  _addCurbs(group, curve, numSamples, halfW, terrain, mask = null) {
    const curbHeight = 0.15;
    const curbWidth = 0.2;
    
    for (const side of [-1, 1]) {
      const positions = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      
      for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
        
        const edgeX = point.x + right.x * halfW * side;
        const edgeZ = point.z + right.z * halfW * side;
        const edgeY = terrain?.enabled ? terrain.heightAt(edgeX, edgeZ) + 0.03 : 0.03;
        
        const outerX = edgeX + right.x * curbWidth * side;
        const outerZ = edgeZ + right.z * curbWidth * side;
        const outerY = terrain?.enabled ? terrain.heightAt(outerX, outerZ) + 0.03 : 0.03;
        
        positions.push(edgeX, edgeY + curbHeight, edgeZ);
        positions.push(outerX, outerY, outerZ);
        normals.push(0, 1, 0, 0, 1, 0);
        uvs.push(0, t * 10, 1, t * 10);
        
        if (i < numSamples && !(mask && (mask[i] || mask[i + 1]))) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
      
      const curbGeo = new THREE.BufferGeometry();
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      curbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      curbGeo.setIndex(indices);
      curbGeo.computeVertexNormals();
      
      const curbMat = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.05,
      });
      
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.name = `curb_${side > 0 ? 'right' : 'left'}`;
      group.add(curbMesh);
    }
  }
  
  _getRoadColor(roadId) {
    const colors = {
      asphalt: 0x33373c,
      oneway: 0x33373c,
      concrete: 0x999999,
      garden: 0xb07050,
      gravel: 0x8a8580,
    };
    return colors[roadId] || 0x33373c;
  }
  
  _getRoadRoughness(roadId) {
    const roughness = {
      asphalt: 0.95,
      oneway: 0.95,
      concrete: 0.9,
      garden: 0.85,
      gravel: 0.95,
    };
    return roughness[roadId] || 0.9;
  }
  
  _addRoadMarkings(group, curve, numSamples, roadId, terrain, mask = null) {
    // 根据道路类型添加不同的标线
    if (roadId === 'asphalt' || roadId === 'oneway') {
      // 双向路：中心黄色虚线 + 两侧白色边线
      this._addCenterLine(group, curve, numSamples, 0xffcc00, terrain, true, mask);
      this._addEdgeLines(group, curve, numSamples, 0xffffff, terrain, mask);
    } else if (roadId === 'concrete') {
      // 混凝土路：接缝线
      this._addConcreteJoints(group, curve, numSamples, terrain, mask);
    }
    // 花园小径和碎石路无标线
  }
  
  _addCenterLine(group, curve, numSamples, color, terrain, dashed = false, mask = null) {
    const pts = [];
    const dashLength = 2.0;
    const gapLength = 1.5;
    let currentDist = 0;
    let isDash = true;
    
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = curve.getPointAt(t);
      const y = terrain?.enabled ? terrain.heightAt(point.x, point.z) + 0.05 : 0.05;
      
      if (mask && mask[i]) {
        if (pts.length > 0) {
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
          group.add(new THREE.Line(lineGeo, lineMat));
          pts.length = 0;
        }
        continue;
      }
      
      if (dashed) {
        const segLength = curve.getLength() / numSamples;
        currentDist += segLength;
        
        if (isDash && currentDist >= dashLength) {
          isDash = false;
          currentDist = 0;
        } else if (!isDash && currentDist >= gapLength) {
          isDash = true;
          currentDist = 0;
        }
        
        if (isDash) {
          pts.push(new THREE.Vector3(point.x, y, point.z));
        } else if (pts.length > 0) {
          // 结束一段虚线
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
          group.add(new THREE.Line(lineGeo, lineMat));
          pts.length = 0;
        }
      } else {
        pts.push(new THREE.Vector3(point.x, y, point.z));
      }
    }
    
    if (pts.length > 0) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      group.add(new THREE.Line(lineGeo, lineMat));
    }
  }
  
  _addEdgeLines(group, curve, numSamples, color, terrain, mask = null) {
    const halfW = this.roadWidth / 2;
    
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
        
        const x = point.x + right.x * halfW * side;
        const z = point.z + right.z * halfW * side;
        const y = terrain?.enabled ? terrain.heightAt(x, z) + 0.05 : 0.05;
        if (mask && mask[i]) {
          if (pts.length > 0) {
            const g0 = new THREE.BufferGeometry().setFromPoints(pts);
            group.add(new THREE.Line(g0, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })));
            pts.length = 0;
          }
          continue;
        }
        pts.push(new THREE.Vector3(x, y, z));
      }
      
      if (pts.length > 0) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
        group.add(new THREE.Line(lineGeo, lineMat));
      }
    }
  }
  
  _addConcreteJoints(group, curve, numSamples, terrain, mask = null) {
    const jointSpacing = 3.0; // 每3米一个接缝
    const totalLength = curve.getLength();
    const numJoints = Math.floor(totalLength / jointSpacing);

    for (let i = 1; i <= numJoints; i++) {
      const t = i / (numJoints + 1);
      if (mask && mask[Math.round(t * numSamples)]) continue;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const halfW = this.roadWidth / 2;
      const lx = point.x - right.x * halfW;
      const lz = point.z - right.z * halfW;
      const rx = point.x + right.x * halfW;
      const rz = point.z + right.z * halfW;

      const y = terrain?.enabled ? terrain.heightAt(point.x, point.z) + 0.05 : 0.05;

      const pts = [
        new THREE.Vector3(lx, y, lz),
        new THREE.Vector3(rx, y, rz)
      ];

      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x777777, linewidth: 1 });
      group.add(new THREE.Line(lineGeo, lineMat));
    }
  }

  // ================= 交叉路口检测与生成 =================

  _detectIntersections(newCurve, newWidth) {
    const intersections = [];
    const threshold = (newWidth / 2) + 1.0; // 交叉检测阈值

    for (const existing of this._roads) {
      const exThreshold = (existing.width / 2) + 1.0;
      const combinedThreshold = threshold + exThreshold - 1.0;

      // 采样两条曲线，找最近点
      const samplesA = 60;
      const samplesB = 60;
      let bestDist = Infinity;
      let bestTA = 0, bestTB = 0;

      for (let i = 0; i <= samplesA; i++) {
        const tA = i / samplesA;
        const pA = newCurve.getPointAt(tA);
        for (let j = 0; j <= samplesB; j++) {
          const tB = j / samplesB;
          const pB = existing.curve.getPointAt(tB);
          const dx = pA.x - pB.x;
          const dz = pA.z - pB.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < bestDist) {
            bestDist = dist;
            bestTA = tA;
            bestTB = tB;
          }
        }
      }

      // 如果最近距离小于阈值，认为有交叉
      if (bestDist < combinedThreshold) {
        // 精确定位交叉点
        const refined = this._refineIntersection(newCurve, existing.curve, bestTA, bestTB);
        if (refined) {
          intersections.push({
            point: refined.point,
            tNew: refined.tA,
            tExisting: refined.tB,
            newCurve, existingCurve: existing.curve,
            newWidth, existingWidth: existing.width,
            newRoadType: this.roadType,
            existingRoadType: existing.roadType,
          });
        }
      }
    }

    return intersections;
  }

  _refineIntersection(curveA, curveB, initTA, initTB) {
    // 二分法精确查找最近点
    let tA = initTA, tB = initTB;
    const step = 0.005;
    const range = 0.1;

    for (let iter = 0; iter < 20; iter++) {
      let bestDist = Infinity;
      let bestTA = tA, bestTB = tB;

      const tAMin = Math.max(0, tA - range);
      const tAMax = Math.min(1, tA + range);
      const tBMin = Math.max(0, tB - range);
      const tBMax = Math.min(1, tB + range);

      for (let i = 0; i <= 10; i++) {
        const ta = tAMin + (tAMax - tAMin) * (i / 10);
        const pA = curveA.getPointAt(ta);
        for (let j = 0; j <= 10; j++) {
          const tb = tBMin + (tBMax - tBMin) * (j / 10);
          const pB = curveB.getPointAt(tb);
          const dx = pA.x - pB.x;
          const dz = pA.z - pB.z;
          const dist = dx * dx + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestTA = ta;
            bestTB = tb;
          }
        }
      }

      tA = bestTA;
      tB = bestTB;
      if (Math.sqrt(bestDist) < 0.01) break;
    }

    const pA = curveA.getPointAt(tA);
    const pB = curveB.getPointAt(tB);
    const point = new THREE.Vector3(
      (pA.x + pB.x) / 2,
      (pA.y + pB.y) / 2,
      (pA.z + pB.z) / 2
    );

    return { point, tA, tB };
  }

  _buildIntersectionPatch(isect) {
    const terrain = this.app.terrain;
    const { point, tNew, tExisting, newCurve, existingCurve, newWidth, existingWidth } = isect;

    const tanA = newCurve.getTangentAt(Math.max(0.001, Math.min(0.999, tNew))).normalize();
    const tanB = existingCurve.getTangentAt(Math.max(0.001, Math.min(0.999, tExisting))).normalize();

    const up = new THREE.Vector3(0, 1, 0);
    const rightA = new THREE.Vector3().crossVectors(tanA, up).normalize();
    const rightB = new THREE.Vector3().crossVectors(tanB, up).normalize();

    const hA = newWidth / 2;
    const hB = existingWidth / 2;
    const cross2 = (a, b) => a.x * b.z - a.z * b.x;
    const c = cross2(tanA, tanB);
    const sinT = Math.abs(c);
    if (sinT < 0.08) return null; // 近乎平行，不构成交叉口

    // 面片需向外扩张，完全盖住两条路被裁掉的端头，否则接缝处露出地面形成裂缝。
    // 裁剪半长 = (对向半宽 + cosT·自身半宽)/sinT；扩张量取 cosT·对向半宽 + 固定搭接 OVR，
    // 保证平行四边形沿每条路方向的延伸都超过裁剪端头 OVR 米。
    const cosT = Math.abs(tanA.x * tanB.x + tanA.z * tanB.z);
    const OVR = 0.4;
    const hAe = hA + cosT * hB + OVR * sinT;
    const hBe = hB + cosT * hA + OVR * sinT;

    // 两条路带的交集 = 平行四边形：四条边线两两求交（用扩张后的半宽）
    const corner = (sA, sB) => {
      const ex = point.x + rightA.x * hAe * sA;
      const ez = point.z + rightA.z * hAe * sA;
      const dx = (point.x + rightB.x * hBe * sB) - ex;
      const dz = (point.z + rightB.z * hBe * sB) - ez;
      const t = (dx * tanB.z - dz * tanB.x) / c;
      const px = ex + tanA.x * t;
      const pz = ez + tanA.z * t;
      const py = terrain?.enabled ? terrain.heightAt(px, pz) + 0.055 : 0.055;
      return new THREE.Vector3(px, py, pz);
    };
    const patchCorners = [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)];

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i < 4; i++) {
      positions.push(patchCorners[i].x, patchCorners[i].y, patchCorners[i].z);
      normals.push(0, 1, 0);
      uvs.push(i < 2 ? 0 : 1, i % 2 === 0 ? 0 : 1);
    }
    indices.push(0, 1, 2, 0, 2, 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const color = this._getRoadColor(isect.newRoadType.id);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: this._getRoadRoughness(isect.newRoadType.id),
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'intersection_patch';

    const group = new THREE.Group();
    group.name = 'road_intersection';
    group.add(mesh);

    this._addCrosswalks(group, point, tanA, tanB, hA, hB, sinT, terrain, hAe, hBe);

    return group;
  }

  // 四个进口道外侧：斑马线 + 停止线
  _addCrosswalks(group, point, tanA, tanB, hA, hB, sinT, terrain, hAe = hA, hBe = hB) {
    const up = new THREE.Vector3(0, 1, 0);
    // ext：面片沿该进口道方向的延伸（用扩张后的对向半宽），斑马线从其外缘起画
    const approaches = [
      { dir: tanA, half: hA, ext: hBe / sinT },
      { dir: tanA.clone().negate(), half: hA, ext: hBe / sinT },
      { dir: tanB, half: hB, ext: hAe / sinT },
      { dir: tanB.clone().negate(), half: hB, ext: hAe / sinT },
    ];
    const quad = (corners) => {
      const pos = [];
      const norm = [];
      const uv = [];
      corners.forEach((cc, i) => {
        pos.push(cc.x, cc.y, cc.z);
        norm.push(0, 1, 0);
        uv.push(i < 2 ? 0 : 1, i % 2 === 0 ? 0 : 1);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      return g;
    };
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
    const yAt = (x, z) => (terrain?.enabled ? terrain.heightAt(x, z) + 0.06 : 0.06);
    const bandDepth = 2.0;

    for (const ap of approaches) {
      const lat = new THREE.Vector3().crossVectors(ap.dir, up).normalize();
      const start = ap.ext + 0.5;
      // 斑马线条数随路宽自适应：以固定节距 pitch 铺满可用横向宽度，条宽≈节距一半
      const edgePad = 0.35;
      const usable = Math.max(0.6, ap.half * 2 - edgePad * 2);
      const pitch = 0.62;
      const n = Math.max(4, Math.round(usable / pitch));
      const step = usable / n;
      const w = step * 0.26; // 白条半宽
      for (let i = 0; i < n; i++) {
        const off = -usable / 2 + step * (i + 0.5);
        const p0 = point.clone().addScaledVector(ap.dir, start).addScaledVector(lat, off - w);
        const p1 = point.clone().addScaledVector(ap.dir, start + bandDepth).addScaledVector(lat, off - w);
        const p2 = point.clone().addScaledVector(ap.dir, start + bandDepth).addScaledVector(lat, off + w);
        const p3 = point.clone().addScaledVector(ap.dir, start).addScaledVector(lat, off + w);
        const y = yAt(p0.x, p0.z);
        p0.y = p1.y = p2.y = p3.y = y;
        const m = new THREE.Mesh(quad([p0, p1, p2, p3]), whiteMat);
        m.name = 'crosswalk_stripe';
        group.add(m);
      }
      // 停止线：行驶方向（朝向路口）右侧车道，斑马线外 0.7m
      const travel = ap.dir.clone().negate();
      const rt = new THREE.Vector3().crossVectors(travel, up).normalize();
      const s0 = start + bandDepth + 0.7;
      const q0 = point.clone().addScaledVector(ap.dir, s0).addScaledVector(rt, 0.1);
      const q1 = point.clone().addScaledVector(ap.dir, s0 + 0.35).addScaledVector(rt, 0.1);
      const q2 = point.clone().addScaledVector(ap.dir, s0 + 0.35).addScaledVector(rt, ap.half - 0.25);
      const q3 = point.clone().addScaledVector(ap.dir, s0).addScaledVector(rt, ap.half - 0.25);
      const yq = yAt(q0.x, q0.z);
      q0.y = q1.y = q2.y = q3.y = yq;
      const sm = new THREE.Mesh(quad([q0, q1, q2, q3]), whiteMat);
      sm.name = 'stop_line';
      group.add(sm);
    }
  }

  addToScene(scene) {
    scene.add(this.group);
    this._bindEvents();
  }

  removeFromScene(scene) {
    scene.remove(this.group);
    this._unbindEvents();
  }

  // ================= 指针事件 =================
  _projectToScreen(p) {
    const st = this.app.stage;
    const r = st.canvas.getBoundingClientRect();
    const proj = p.clone().project(st.view);
    if (proj.z > 1) return null;
    const sx = (proj.x * 0.5 + 0.5) * r.width;
    const sy = (-proj.y * 0.5 + 0.5) * r.height;
    if (sx < 0 || sx > r.width || sy < 0 || sy > r.height) return null;
    return { sx, sy };
  }

  _findPointAt(screenX, screenY) {
    const threshold = 6;
    for (let i = 0; i < this.points.length; i++) {
      const s = this._projectToScreen(this.points[i]);
      if (!s) continue;
      const dx = screenX - s.sx, dy = screenY - s.sy;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
    }
    return -1;
  }

  _findHandleAt(screenX, screenY) {
    if (!this.filletOn || this.points.length < 3) return -1;
    const threshold = 8;
    for (let i = 1; i < this.points.length - 1; i++) {
      const hp = this.handlePos(i);
      if (!hp) continue;
      const s = this._projectToScreen(hp);
      if (!s) continue;
      const dx = screenX - s.sx, dy = screenY - s.sy;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
    }
    return -1;
  }

  _bindEvents() {
    const st = this.app.stage;
    const host = st.host || st.canvas?.parentElement;
    if (!host) return;
    this._host = host;
    this._onPointerDown = (ev) => {
      if (!this.active || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (st.orbit) st.orbit.enabled = false;
      const r = st.canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const hi = this._findHandleAt(sx, sy);
      if (hi >= 0) {
        this._dragHandle = hi;
        this._dragging = true;
        try { host.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        return;
      }
      const idx = this._findPointAt(sx, sy);
      if (idx >= 0) {
        this._dragIdx = idx;
        this._dragging = true;
        try { host.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        return;
      }
      const p = this._aim(ev);
      if (p && isFinite(p.x)) {
        this.addPoint(p.x, p.y, p.z);
      }
    };
    this._onPointerMove = (ev) => {
      if (!this.active) return;
      if (this._dragging && this._dragHandle >= 0) {
        const p = this._aim(ev);
        if (p && isFinite(p.x)) {
          this.setHandleFromWorld(this._dragHandle, p);
          this._updatePreview();
          this._updateLiveRoad();
        }
        return;
      }
      if (this._dragging && this._dragIdx >= 0) {
        const p = this._aim(ev);
        if (p && isFinite(p.x)) {
          const terrain = this.app.terrain;
          const ty = terrain?.enabled ? terrain.heightAt(p.x, p.z) : 0;
          this.points[this._dragIdx].set(p.x, ty + 0.02, p.z);
          this._updatePreview();
          this._updateLiveRoad();
        }
        return;
      }
      this._updateGhost(ev);
    };
    this._onPointerUp = (ev) => {
      if (!this.active) return;
      if (st.orbit) st.orbit.enabled = true;
      this._dragIdx = -1;
      this._dragHandle = -1;
      this._dragging = false;
      try { host.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    };
    this._onDblClick = (ev) => {
      if (!this.active) return;
      ev.preventDefault();
      this.finish();
      this.app.bus.emit('objects');
      this.app.markDirty?.();
    };
    host.addEventListener('pointerdown', this._onPointerDown, true);
    host.addEventListener('pointermove', this._onPointerMove, true);
    host.addEventListener('pointerup', this._onPointerUp, true);
    host.addEventListener('dblclick', this._onDblClick, true);
  }

  _unbindEvents() {
    const host = this._host;
    if (!host) return;
    host.removeEventListener('pointerdown', this._onPointerDown, true);
    host.removeEventListener('pointermove', this._onPointerMove, true);
    host.removeEventListener('pointerup', this._onPointerUp, true);
    host.removeEventListener('dblclick', this._onDblClick, true);
  }

  _aim(ev) {
    const st = this.app.stage;
    const r = st.canvas.getBoundingClientRect();
    st.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    return st.groundPoint(0);
  }

  _updateGhost(ev) {
    const p = this._aim(ev);
    if (!p || !isFinite(p.x)) return;
    if (!this._ghost) {
      const geo = new THREE.SphereGeometry(0.3, 8, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.4 });
      this._ghost = new THREE.Mesh(geo, mat);
      this.group.add(this._ghost);
    }
    const terrain = this.app.terrain;
    const gy = terrain?.enabled ? terrain.heightAt(p.x, p.z) : 0;
    this._ghost.position.set(p.x, gy + 0.05, p.z);
    this._ghost.visible = true;
  }
}
