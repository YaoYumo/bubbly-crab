import { tagRoadRoles, applyCompactCuts } from './road-compact-junction.js';
import { normalizeSection, sectionDimensions, sectionRoadType, sectionAtWidth } from './road-section.js';
import { endpointRoadContact } from './road-contact.js';
import { junctionHeightField } from './junction-elevation.js';
import { freewayConnections, applyFreewayCuts } from './freeway-junctions.js';
import { roadHeightGuide, hitRoadHeightGrip } from './road-point-controls.js';
import { validRoadPoints, shearRoadGrade } from './road-elevation.js';
import { dragOnLevel, pointGuide, hitCurvePoint } from './curve-handles.js';
// ---------------------------------------------------------------------------
// 道路画笔 — 重构版（任务33）
//
// 旧管线「沿曲线挖洞（1/sinT 公式）→ 盖平行四边形面片 → 贴模型库整件/角块 →
// 补标线」把三套坐标系靠常数对齐，任何交角都会错位（破面/黑面/闪烁/结构混乱）。
// 重构后整条链路收敛为两个清晰层次：
//
//   1) 网络层：控制点 → _buildPathCurve 曲线；_detectIntersections 采样找交叉；
//      每个交叉生成一份 junctionPlan（src/junction.js，全角度唯一生成器），
//      路的缺口 = 曲线与「路口内缩轮廓」的区间求交（不再有 sin/cos 挖洞公式）。
//   2) 铺装层：_buildRoadMesh 沿剩余跨段铺设模型库道路件（含斜接/尽端圆头），
//      buildJunction 生成路口本体（R5 回转、步道角块、大陆斑马线，外观照抄模型）。
//
// 路面与路口的搭接关系由标高保证：路件车行顶 0.17 / 步道顶 0.32，
// 路口车行面 0.10 / 步道顶 0.26——搭接段路件永远赢深度，共面处绝不闪烁。
// 对外契约（serialize 字段、public 方法、_roads/_editBackup/filletH 等）与旧版一致。
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { buildTwoWayRoad, buildOneWayRoad, buildConcreteRoad, buildGardenPath, buildGravelRoad, buildFreeway } from './assets.js';
import { batchRoadParts } from './road-batching.js';
import { buildRoadEndcap } from './road-endcap.js';
import { armsFromIsect, junctionPlan, buildJunction, gapIntervals, roadProfile } from './junction.js';

const ROAD_TYPES = [
  { id: 'asphalt', label: '沥青路', build: buildTwoWayRoad, params: { brickColor: null } },
  { id: 'oneway', label: '单向路', build: buildOneWayRoad, params: { brickColor: null } },
  { id: 'concrete', label: '混凝土路', build: buildConcreteRoad, params: { brickColor: null } },
  { id: 'garden', label: '花园小径', build: buildGardenPath, params: { brickColor: '#c45a3a' } },
  { id: 'gravel', label: '碎石路', build: buildGravelRoad, params: { brickColor: null } },
  { id: 'freeway', label: '高速公路', build: buildFreeway, params: { brickColor: null } },
];

export { ROAD_TYPES };

export class RoadBrush {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.points = [];
    this.roadType = ROAD_TYPES[0];
    this.roadWidth = 12;                       // 车行宽（库件总宽自动 +4.5 侧带）
    this.filletOn = false;
    this.filletH = [];
    this.editMode = false;
    this.terrainMode = null; this.terrainOffset = 0;
    this.group = new THREE.Group();
    this.group.name = 'road-brush-preview';
    this.liveRoadMesh = null;
    this._roads = [];
    this._seq = 0;
    this._drag = null;                         // 指针拖拽状态 { kind:'point'|'handle', idx }
    this._buildPreviewHelpers();
    this.selectedGuides = new THREE.Group(); this.selectedGuides.name = 'selected-road-points';
    this.app.stage.helperLayer.add(this.selectedGuides);
    for(const event of ['select','objects','undoable']) this.app.bus.on(event, () => this.showSelectedPoints());
  }

  showSelectedPoints() {
    this._disposeChildren(this.selectedGuides);
    const so = this.app.selObj;
    if(this.active || !so || so.type !== 'road_brush' || so.locked || so.visible === false || this.app.state.preview) return;
    const points = this.controlPointsFor(so);
    if(points?.length) this.selectedGuides.add(pointGuide(points, 0x4a90d9), roadHeightGuide(points));
  }
  controlPointsFor(so) {
    const rd=so?._roadData;
    return (rd?.ctrl || so?.serialize?.().points || []).map(p=>[p[0], rd?.terrainMode==='follow' ? (this.app.roadTerrain?.height(rd.curve,p[0],p[2]) ?? p[1]) : p[1], p[2]]);
  }
  draftControlPoints() {
    const points=this.points.map(p=>p.toArray());
    if(this.terrainMode!=='follow'||points.length<2||this._editBackup)return points;
    const curve=this._buildPathCurve();
    return points.map(p=>[p[0],this.app.roadTerrain?.height(curve,p[0],p[2])??p[1],p[2]]);
  }
  freezeDraftHeights() {
    if(this.terrainMode!=='follow')return;
    const points=this.draftControlPoints();
    this.points.forEach((p,i)=>{p.y=points[i][1];});
  }
  _buildPreviewHelpers() {
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4A90D9, linewidth: 2, transparent: true, opacity: 0.5 });
    const lineGeo = new THREE.BufferGeometry();
    this.previewLine = new THREE.Line(lineGeo, lineMat);
    this.previewLine.visible = false;
    this.previewLine.frustumCulled = false;
    this.group.add(this.previewLine);

    this.previewDots = new THREE.Group();
    this.previewDots.visible = false;
    this.group.add(this.previewDots);

    this.filletDots = new THREE.Group();
    this.filletDots.visible = false;
    this.group.add(this.filletDots);
  }

  // ============ 面板参数 API（契约：与旧版一致） ============

  setType(typeId) {
    const idx = ROAD_TYPES.findIndex(t => t.id === typeId);
    if (idx >= 0) {
      this.roadType = this.roadType.section ? sectionRoadType(ROAD_TYPES[idx], this.roadType.section) : ROAD_TYPES[idx];
      if(this.roadType.section)this.roadWidth=sectionDimensions(this.roadType.id,this.roadType.section).pavementWidth;
      this._updateLiveRoad();this.app.bus.emit('road-section');
    }
  }

  cycleRoadType() {
    const idx = ROAD_TYPES.findIndex(t=>t.id===this.roadType.id);
    const next = ROAD_TYPES[(idx + 1) % ROAD_TYPES.length];
    this.setType(next.id);
    return next;
  }

  setWidth(w) {
    if(this.roadType.section)return this.setSection(sectionAtWidth(this.roadType.id,this.roadType.section,w));
    this.roadWidth = Math.max(1, Math.min(20, w));
    this._updateLiveRoad();
  }

  setSection(section) {
    const value=normalizeSection(this.roadType.id,section);
    if(!value)return false;
    this.roadType=sectionRoadType(ROAD_TYPES.find(t=>t.id===this.roadType.id),value);
    this.roadWidth=sectionDimensions(this.roadType.id,value).pavementWidth;
    this._updateLiveRoad();this.app.bus.emit('road-section');return true;
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

  // ============ 画笔生命周期 ============

  start() {
    if (this.app.terrain?.workflow?.busy) { this.app.notify?.('请先完成或取消地形任务', 'warn'); return false; }
    this.app.terrain?.workflow?.cancelErosionPreview();
    this.app.terrain?.workflow?.cancelDraft();
    this.app.vegetationBrush?.stop();
    this.app.state.terrainTool = null; this.app.terrain?.refreshUI();
    this.app.roadPlanning?.setPicking(false);
    this.app.roadConnector?.setPicking(null);
    this.active = true; this.showSelectedPoints();
    this.terrainMode = 'follow'; this.terrainOffset = .02; this.draftHeight = 8;
    this.points = [];
    this.filletH = [];
    this._drag = null;
    this._updatePreview();
    this.app.stage.host?.style && (this.app.stage.host.style.cursor = 'crosshair');
    this.app.bus.emit('road-edit');
  }

  stop() {
    const drag=this._drag;this._drag=null;
    if(drag && this.app.stage.orbit)this.app.stage.orbit.enabled=this._pointerOrbit ?? true;
    if(drag?.pointerId!==undefined)try{this._host?.releasePointerCapture(drag.pointerId);}catch{}
    // 纯取消：清掉当前笔画，不落路（完成走 finish —— 双击 / Enter / 面板按钮）
    this.active = false;
    this.points = [];
    this.filletH = [];
    this._drag = null;
    this.previewLine.visible = false;
    if (this._ghost) this._ghost.visible = false;
    this.previewDots.visible = false;
    this._disposeChildren(this.previewDots);
    this.filletDots.visible = false;
    this._disposeChildren(this.filletDots);
    this._clearLiveRoad();
    this.app.stage.host?.style && (this.app.stage.host.style.cursor = '');
    this.app.bus.emit('road-edit');
  }

  addPoint(x, y, z) {
    if (!this.active) return;
    const snapped = this.app.roadPlanning?.snapPoint(new THREE.Vector3(x, y, z));
    if (snapped) { x = snapped.x; z = snapped.z; }
    if (!this.terrainMode) { this.terrainMode = 'follow'; this.terrainOffset = .02; }
    const terrain = this.app.terrain;
    const ty = terrain?.enabled ? terrain.heightAt(x, z) : 0;
    const fixed = this.terrainMode === 'fixed';
    this.points.push(new THREE.Vector3(x, fixed ? (this.points.at(-1)?.y ?? this.draftHeight ?? 8) : ty + 0.02, z));
    if (this.filletOn) this.syncFillets();
    this._updatePreview();
    this._updateLiveRoad();
    this.app.bus.emit('road-edit');
  }

  undoPoint() {
    if (this.points.length > 0) {
      this.points.pop();
      if (this.filletOn) this.syncFillets();
      this._updatePreview();
      this._updateLiveRoad();
      this.app.bus.emit('road-edit');
    }
  }

  setDraftPoint(index, axis, value) {
    const p = this.points[index];
    if (!this.active || !p || !['x','y','z'].includes(axis) || !Number.isFinite(value) || Math.abs(value) > 10000) return false;
    if(axis==='y')this.freezeDraftHeights();
    p[axis] = value;
    if (axis === 'y') this.terrainMode = 'fixed';
    else if (this.terrainMode !== 'fixed') p.y = (this.app.terrain?.enabled ? this.app.terrain.heightAt(p.x,p.z) : 0) + .02;
    if (this.filletOn) this.syncFillets();
    this._updatePreview(); this._updateLiveRoad(); this.app.bus.emit('road-edit');
    return true;
  }

  // 路径曲线：未开倒角=直线段尖角；开倒角=每个转角用二次贝塞尔圆弧过渡
  _buildPathCurve() {
    const curve = this._designPathCurve();
    if (!curve) return null;
    return this.app.roadTerrain?.prepare(curve, { terrainMode: this.terrainMode || 'fixed', terrainOffset: this.terrainOffset }, this.roadWidth, this.roadType) || curve;
  }

  _designPathCurve() {
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

  _disposeChildren(group) {
    for (const c of group.children.slice()) {
      group.remove(c);
      c.geometry?.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    }
  }

  _updatePreview() {
    const pts = this.points;
    this._disposeChildren(this.previewDots);
    this._disposeChildren(this.filletDots);
    if (pts.length === 0) {
      this.previewLine.visible = false;
      this.previewDots.visible = false;
      this.filletDots.visible = false;
      return;
    }
    this.previewDots.visible = true;
    for (let i = 0; i < pts.length; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }),
      );
      dot.position.copy(pts[i]);
      dot.userData.pointIdx = i; dot.renderOrder = 1000; dot.userData.pickIgnore = true;
      this.previewDots.add(dot);
    }
    this.previewDots.add(pointGuide(pts.map(p => p.toArray()), 0x4a90d9), roadHeightGuide(pts.map(p=>p.toArray())));
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
        child.geometry?.dispose?.();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      this.liveRoadMesh = null;
    }
  }

  // 试铺：与成路同一条缺口链路（路口计划干跑），只是不注册成物体、不生成路口本体
  _updateLiveRoad() {
    this._clearLiveRoad();
    if (this.points.length < 2) return;

    const curve = this._buildPathCurve();
    if (!curve) return;
    const isects = this._detectIntersections(curve, this.roadWidth);
    this._prepareJunctionLimits(isects);
    const gaps = this._gapsForCurve(curve, isects, this.roadType, this.roadWidth);
    const mesh = this._buildRoadMesh(curve, gaps);
    if (mesh) {
      this.liveRoadMesh = mesh;
      this.group.add(mesh);
    }
  }

  // ============ 完成 / 编辑 / 恢复 ============

  finish() {
    if (this.points.length < 2) {
      this.app.notify?.('至少需要 2 个控制点', 'warn');
      return null;
    }

    const curve = this._buildPathCurve();
    const isects = curve ? this._detectIntersections(curve, this.roadWidth, !!this._editNoJunct) : [];
    if(curve?._freewayConflicts?.length){
      this.app.notify?.('高速公路不能同高穿越中央隔离带。请拖绿色箭头调整各点标高形成跨线立交，或用普通道路作为匝道接入近侧车道。','warn');
      return null;
    }
    if (!this._editBackup) this.app.beginOp?.('绘制道路', '', true);
    let mesh = curve ? this._addRoad(curve, {
      roadType: this.roadType, width: this.roadWidth,
      ctrl: this.points.map(p => [p.x, p.y, p.z]),
      filletH: this.filletH.slice(), filletOn: this.filletOn,
      isects, noJunct: !!this._editNoJunct,
      terrainMode: this.terrainMode || 'follow', terrainOffset: this.terrainOffset,
      streetLights: this._editBackup?.streetLights, lampSpacing: this._editBackup?.lampSpacing, lampSide: this._editBackup?.lampSide,
      bridges: this._editBackup?.bridges, pierSpacing: this._editBackup?.pierSpacing, bridgeThreshold: this._editBackup?.bridgeThreshold,
      so: this._editBackup || null,             // 编辑后仍是同一道路：保留 ID / 名称 / 可见与锁定状态
    }) : null;

    this.points = [];
    this.filletH = [];
    this._clearLiveRoad();
    this._updatePreview();
    if (mesh) {
      const wasEdit = !!this._editBackup;                 // 编辑接管模式：完成即收笔（不保持连续绘制）
      this._editBackup = null;this._editUndoBefore=null;this._editUndoMark=null;
      this._editNoJunct = false;
      if (wasEdit) {
        this.stop();
        this._restoreEditTargets(mesh.userData.so.id);
        this.app.select({ kind: 'obj', so: mesh.userData.so });
      }
    }
    if(mesh&&this._junctionReflow){
      this._junctionReflow=false;const id=mesh.userData.so.id;
      this.app.roadTerrain?.sync();mesh=this.app.byId(id)?.root||mesh;
    }
    this.app.bus.emit('road-edit');
    return mesh;
  }

  /** 已完成道路的属性编辑：一次提交一次撤销，不进入持续绘制状态。 */
  updateRoadProperties(so, { roadType = so?._roadData?.roadType?.id, width = so?._roadData?.width, points, terrainMode, section } = {}) {
    if (!so || so.type !== 'road_brush' || so.locked || !this.app.objects.includes(so)) return null;
    let type = ROAD_TYPES.find(t => t.id === roadType);
    let explicit=section!==undefined?section:so?._roadData?.roadType?.section;
    if(explicit&&section===undefined&&width!==so?._roadData?.width)explicit=sectionAtWidth(roadType,explicit,width);
    if(type&&explicit){type=sectionRoadType(type,explicit);width=sectionDimensions(type.id,explicit)?.pavementWidth??width;}
    if (!type || !Number.isFinite(width) || (points !== undefined && !validRoadPoints(points)) || (terrainMode !== undefined && !['fixed', 'follow'].includes(terrainMode))) return null;
    width = Math.max(1, Math.min(type.section ? 80 : 20, width));
    if (this._editBackup || (this.active && this.points.length)) {
      this.app.notify?.('请先完成或取消当前道路绘制', 'warn');
      return null;
    }
    if (type === so._roadData.roadType && width === so._roadData.width && points === undefined && terrainMode === undefined) return so;
    if (!this.editRoad(so)) return null;
    try {
      this.roadType = type;
      this.roadWidth = width;
      if (points) this.points = points.map(p => new THREE.Vector3(...p));
      if (terrainMode) this.terrainMode = terrainMode;
      if (this.filletOn) this.syncFillets();
      const mesh = this.finish();
      if (!mesh) { this.cancelEdit(); return null; }
      this.app._redo = []; this.app._redoAvail = 0;
      this.app.bus.emit('objects');
      this.app.bus.emit('undoable');
      this.app.markDirty?.();
      return mesh.userData.so;
    } catch (err) {
      this.cancelEdit();
      this.app.notify?.('道路参数更新失败：' + (err.message || err), 'warn');
      return null;
    }
  }

  _restoreEditTargets(id) {
    for (const shot of this._editTargetShots || []) {
      if (this.app.shots.includes(shot)) { shot.targetId = id; shot.markDirty(); }
    }
    this._editTargetShots = null;
  }

  /**
   * 编辑一条已生成/已保存的道路：把它的控制点载回画笔（原路先移除，完成时以新物体落回）。
   * Esc 走 cancelEdit() 会把原路原样恢复。
   */
  editRoad(so) {
    if (!so || so.type !== 'road_brush' || so.locked) return false;
    const data = so.serialize();
    const effectivePoints=this.controlPointsFor(so);
    if (!data.points || data.points.length < 2) return false;
    if (this._editBackup) this.cancelEdit();      // 正在编辑另一条：先还原上一条
    this.stop();                                  // 结束可能进行中的普通绘制（纯取消）
    const app = this.app;
    this._editUndoBefore = { _undo:[...(app._undo||[])], _redo:[...(app._redo||[])], _undoBytes:app._undoBytes, _undoAvail:app._undoAvail, _redoAvail:app._redoAvail, _opKey:app._opKey };
    this._editBackup = data;
    this._editNoJunct = !!data.noJunct;
    this._editTargetShots = app.shots.filter(s => s.targetId === so.id);
    app.batchOp(`编辑 ${so.name || '道路'}`, () => app.removeObject(so));
    this._editUndoMark = app._undo?.at(-1);
    this.start();
    this.points = effectivePoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.roadWidth = data.width || 12;
    this.roadType = ROAD_TYPES.find((t) => t.id === data.roadType) || ROAD_TYPES[0];
    if(data.section)this.roadType=sectionRoadType(this.roadType,data.section);
    this.terrainMode = data.terrainMode; this.terrainOffset = data.terrainOffset ?? 0;
    this.filletOn = !!data.fillet;
    this.filletH = (data.filletH || []).slice();
    if (this.filletOn) this.syncFillets();
    this._updatePreview();
    this._updateLiveRoad();
    app.select(null);
    app.bus.emit('objects');
    return true;
  }

  /** 放弃编辑：清空画笔并把原路原样恢复（路口重新检测） */
  cancelEdit() {
    const undoBefore=this._editUndoBefore,undoMark=this._editUndoMark;this._editUndoBefore=null;this._editUndoMark=null;
    const b = this._editBackup;
    this._editBackup = null;
    this._editNoJunct = false;
    this.stop();
    if (b) {
      this.restore([b]);
      this._restoreEditTargets(b.id);
      const restored = this.app.byId(b.id);
      if (restored) this.app.select({ kind: 'obj', so: restored });
      this.app.bus.emit('objects');
      this.app.markDirty?.();
      if(undoBefore && this.app._undo?.at(-1)===undoMark && this.app._undo.length===undoBefore._undo.length+1) {
        Object.assign(this.app,undoBefore);this.app.bus.emit('undoable');
      }
    }
  }

  /**
   * 由工程 JSON 恢复手绘道路（路口重新检测生成，不读存档里的 road_intersection）。
   * 三阶段批处理：①挂桩+逐条检测（保持「与更早的路相交」的顺序语义）
   * ②全网路口计划→每条路取「涉及它的所有路口」的挖洞并集
   * ③建网格+注册（物体出现顺序与旧版一致：道路、其路口、下一条…）。
   */
  restore(list = []) {
    const saved = { terrainMode: this.terrainMode, terrainOffset: this.terrainOffset, points: this.points, filletH: this.filletH, filletOn: this.filletOn, roadType: this.roadType, width: this.roadWidth };
    const out = [];

    const entries = [];
    for (const o of list) {
      const pts = (o.points || []).map(p => new THREE.Vector3(p[0], p[1], p[2]));
      if (pts.length < 2) continue;
      this.points = pts;
      this.terrainMode = this.app.roadTerrain?.modeFor(o) || 'fixed'; this.terrainOffset = o.terrainOffset ?? 0;
      this.filletOn = !!o.fillet;
      this.filletH = (o.filletH || []).slice();
      if (this.filletOn) this.syncFillets();
      const baseType = ROAD_TYPES.find(t => t.id === o.roadType) || ROAD_TYPES[0];
      const roadType = o.section ? sectionRoadType(baseType,o.section) : baseType;
      const width = roadType.section ? sectionDimensions(roadType.id,roadType.section).pavementWidth : o.width || 12;
      this.roadType = roadType;
      this.roadWidth = width;
      const curve = this._buildPathCurve();
      if (!curve) continue;
      entries.push({
        o, curve, roadType, width, terrainMode: this.terrainMode, terrainOffset: this.terrainOffset,
        ctrl: pts.map(p => [p.x, p.y, p.z]),
        filletH: this.filletH.slice(), filletOn: this.filletOn,
        noJunct: !!o.noJunct,
        name: o.name || `道路_${roadType.label}`,
      });
    }

    // ① 桩 + 检测
    const pending = [];
    for (const e of entries) {
      this.roadType = e.roadType;
      const isects = this._detectIntersections(e.curve, e.width, e.noJunct);
      const rd = {
        curve: e.curve, width: e.width, roadType: e.roadType, mesh: null, gaps: [],
        ctrl: e.ctrl, noJunct: e.noJunct, name: e.name,
        streetLights: !!e.o.streetLights, lampSpacing: e.o.lampSpacing || 24, lampSide: e.o.lampSide || 'both',
        terrainMode: e.terrainMode, terrainOffset: e.terrainOffset, bridges: e.o.bridges !== false, pierSpacing: e.o.pierSpacing || 12, bridgeThreshold: e.o.bridgeThreshold || 1.8,
        filletOn: e.filletOn, filletH: e.filletH, connection: e.o.connection,
      };
      this._roads.push(rd);
      pending.push({ e, rd, isects });
    }

    // Legacy projects keep both roads, with a derived warning on each. Draft
    // detection must never stamp an uncommitted conflict onto an existing road.
    for(const {rd}of pending)for(const peer of rd.curve._freewayConflicts||[]){
      peer._freewayConflicts ||= [];if(!peer._freewayConflicts.includes(rd.curve))peer._freewayConflicts.push(rd.curve);
    }
    // ② 计划 + 挖洞并集
    const hits = new Map();
    const addHit = (rd, is) => {
      if (!rd) return;
      if (!hits.has(rd)) hits.set(rd, []);
      hits.get(rd).push(is);
    };
    for (const p of pending) {
      for (const is of p.isects) {
        addHit(p.rd, is);
        addHit(this._roads.find(r => r.curve === is.existingCurve), is);
      }
    }
    this._prepareJunctionLimits([...hits.values()].flat());
    for (const [rd, isList] of hits) rd.gaps = this._gapsForCurve(rd.curve, isList, rd.roadType, rd.width);

    this.app.roadTerrain?.joinProfiles(pending.flatMap(p => p.isects));

    // ③ 网格 + 注册
    for (const p of pending) {
      const { e, rd, isects } = p;
      const mesh = this._buildRoadMesh(rd.curve, rd.gaps, rd);
      rd.mesh = mesh;
      const roadObj = this._roadObject(rd, e.o);
      mesh.userData.so = roadObj;
      roadObj.apply();
      this.app.stage.world.add(mesh);
      this.app.objects.push(roadObj);
      out.push(mesh);
      for (const is of isects) this._registerIsect(is);
    }

    this.terrainMode = saved.terrainMode; this.terrainOffset = saved.terrainOffset;
    this.points = saved.points; this.filletH = saved.filletH; this.filletOn = saved.filletOn;
    this.roadType = saved.roadType; this.roadWidth = saved.width;
    this.app.roadTerrain?.updateSupports();
    return out;
  }

  // 道路物体（serialize 字段契约与旧版一致）
  _roadObject(rd, so = null) {
    const { roadType, width, ctrl, filletH, filletOn, noJunct } = rd;
    const app = this.app;
    const roadObj = {
      id: so?.id || `rb${++this._seq}`,
      root: rd.mesh, name: rd.name, type: 'road_brush',
      materialMode: so?.materialMode || 'inherit',
      isChar: false, followTerrain: false,
      visible: so?.visible !== false, locked: !!so?.locked, params: {},
      motion: { active: false, keys: [] },
      _mgroup: new THREE.Group(),
      _roadData: rd,
      apply() { this.root.visible = this.visible !== false; app.appearance?.apply(this); },
      onRemove: () => this._onRoadRemoved(rd),
      serialize: () => ({
        id: roadObj.id, name: roadObj.name, type: 'road_brush', materialMode: roadObj.materialMode,
        visible: roadObj.visible !== false, locked: !!roadObj.locked,
        roadType: roadType.id, width, ...(roadType.section ? {section:{...roadType.section}} : {}), ...(rd.connection ? {connection:rd.connection} : {}), fillet: filletOn, filletH, points: rd.ctrl,
        streetLights: !!rd.streetLights, lampSpacing: rd.lampSpacing || 24, lampSide: rd.lampSide || 'both',
        terrainMode: rd.terrainMode, terrainOffset: rd.terrainOffset, bridges: rd.bridges !== false, pierSpacing: rd.pierSpacing || 12, bridgeThreshold: rd.bridgeThreshold || 1.8,
        noJunct: !!noJunct,
      }),
    };
    return roadObj;
  }

  /** 建网格 + 注册成一等场景物体 + 生成路口并断开被交叉的既有道路 */
  _addRoad(curve, opt) {
    const { roadType, width, ctrl, filletH, filletOn, isects = [], so = null, noJunct = false } = opt;
    const oldNodes=this.app.objects.filter(o=>o.type==='road_intersection').map(o=>o._isect).filter(Boolean);
    this._junctionReflow=this._prepareJunctionLimits([...oldNodes,...isects]);
    const gaps = this._gapsForCurve(curve, isects, roadType, width);
    const roadName = so?.name || `道路_${roadType.label}`;
    const rd = {
      curve, width, roadType, mesh: null, gaps, ctrl, noJunct, name: roadName,
      filletOn, filletH, connection: so?.connection,
      streetLights: !!opt.streetLights, lampSpacing: opt.lampSpacing || 24, lampSide: opt.lampSide || 'both',
      terrainMode: opt.terrainMode || 'follow', terrainOffset: opt.terrainOffset ?? .02, bridges: opt.bridges !== false, pierSpacing: opt.pierSpacing || 12, bridgeThreshold: opt.bridgeThreshold || 1.8,
    };
    this.app.roadTerrain?.joinProfiles(isects);
    const mesh = this._buildRoadMesh(curve, gaps, rd);
    if (!mesh) return null;
    rd.mesh = mesh;
    const roadObj = this._roadObject(rd, so);
    mesh.userData.so = roadObj;
    roadObj.apply();
    this.app.stage.world.add(mesh);
    this.app.objects.push(roadObj);

    for (const isect of isects) {
      // 车行路口：统一生成器产出的路口本体（全角度，含 T 形；不再摆模型库整件）
      this._registerIsect(isect);
      // 被交叉的既有道路在路口范围内断开，避免路缘/标线穿过路口
      const ex = this._roads.find(r => r.curve === isect.existingCurve);
      if (ex) {
        const plan = this._planForIsect(isect);
        if (plan) {
          const exHalf = roadProfile(ex.roadType, ex.width).half;
          for (const r of this._junctionIntervals(ex.curve, plan, exHalf, isect)) ex.gaps.push({ t0: r.t0, t1: r.t1, isect });
          this._rebuildRoad(ex);
        }
      }
    }

    this._roads.push(rd);
    this.app.roadTerrain?.updateSupports();
    return mesh;
  }

  // 路口计划：每条交叉记录只解析一次（两条路与路口本体共用同一份轮廓）
  _prepareJunctionLimits(isects) {
    const nodes=[...new Set(isects)],byCurve=new Map(),next=new Map(nodes.map(is=>[is,new Map()]));
    for(const is of nodes)for(const [curve,t]of [[is.newCurve,is.tNew],[is.existingCurve,is.tExisting]]){
      if(!byCurve.has(curve))byCurve.set(curve,[]);byCurve.get(curve).push({is,t});
    }
    for(const [curve,entries]of byCurve){
      entries.sort((a,b)=>a.t-b.t);
      for(const a of entries){const limits={};
        for(const b of entries){if(a===b||Math.abs(a.t-b.t)<1e-5)continue;
          const tan=curve.getTangentAt(a.t),distance=Math.abs(b.t-a.t)*curve.getLength()*Math.hypot(tan.x,tan.z),sign=b.t>a.t?1:-1;
          limits[sign]=Math.min(limits[sign]??Infinity,distance*.45);
        }if(Object.keys(limits).length)next.get(a.is).set(curve,limits);
      }
    }
    let changed=false;
    for(const is of nodes){const old=is.armLimits,limits=next.get(is);
      const same=old&&old.size===limits.size&&[...limits].every(([curve,lim])=>JSON.stringify(old.get(curve))===JSON.stringify(lim));
      if(!same){if(is.plan)changed=true;is.armLimits=limits;delete is.plan;}
    }
    return changed;
  }
  _planForIsect(is) {
    if (is.plan !== undefined) return is.plan;
    const arms = armsFromIsect(is);
    is.plan = junctionPlan(is.point, arms, is.freeway);
    return is.plan;
  }

  // 一条曲线在这些路口计划下的挖洞并集（判定=整条横断面缩进轮廓内，无任何三角公式）
  _gapsForCurve(curve, isects = [], roadType = null, width = null) {
    const rt = roadType || this.roadType;
    const w = width || this.roadWidth;
    const half = roadProfile(rt, w).half;
    const gaps = [];
    for (const is of isects) {
      const plan = this._planForIsect(is);
      if (!plan) continue;
      for (const r of this._junctionIntervals(curve, plan, half, is)) gaps.push({ t0: r.t0, t1: r.t1, isect: is });
    }
    return gaps;
  }

  _junctionIntervals(curve, plan, half, isect) {
    const t = curve === isect.newCurve ? isect.tNew : isect.tExisting;
    if(plan.compact&&!isect.freeway){const own=gapIntervals(curve,plan,0).filter(r=>t>=r.t0-1e-5&&t<=r.t1+1e-5);return own.length?own:[{t0:t,t1:t}];}
    if(isect.freeway){
      const f=isect.freeway,main=curve===f.curve,virtual=main?f.laneCurve:curve;
      const centre=gapIntervals(virtual,plan,0);
      const own=centre.filter(r=>t>=r.t0-1e-5&&t<=r.t1+1e-5);
      // A lateral port can lie just outside a short branch's centreline. Its
      // dedicated geometry cut still needs an owning t interval, never a full-width gap.
      return own.length?own:[{t0:t,t1:t}];
    }
    // The same alignment can pass through the same XZ footprint on another level.
    // Only cut the contiguous interval owning this particular accepted crossing.
    return gapIntervals(curve, plan, half).filter(r => !Number.isFinite(t) || (t >= r.t0 - 1e-5 && t <= r.t1 + 1e-5));
  }

  // 路口物体注册（serialize / 面板字段与旧版一致；_isect 仍是检测记录，plan 缓存其上）
  _registerIsect(isect) {
    const plan = this._planForIsect(isect);
    if (!plan) return null;
    const terrain = this.app.terrain;
    // 材质与斑马线由生成器根据全部接入道路统一决策，不再取「新画入道路」的材质。
    const patch = buildJunction(plan);
    if (!patch) return null;
    patch.position.y = isect.terrainY ?? (terrain?.enabled ? terrain.heightAt(isect.point.x, isect.point.z) : 0);
    const field=junctionHeightField(plan,patch.position.y);
    if(field)this.app.roadTerrain?.warpWith(patch,field);
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
    return isectObj;
  }

  // ============ 交叉检测（采样 + 二分精化；与旧版语义一致） ============

  _detectIntersections(newCurve, newWidth, noJunct = false) {
    const intersections = [];newCurve._freewayConflicts=[];
    if (noJunct) return intersections;                       // 基座/台面：贴地但不生成路口
    const threshold = (newWidth / 2) + 1.0; // 交叉检测阈值

    for (const existing of this._roads) {
      if (existing.noJunct) continue;                        // 对面是基座：只贴不接
      if(this.roadType.id==='freeway'||existing.roadType.id==='freeway'){
        if(this.roadType.id==='freeway'&&existing.roadType.id==='freeway'){
          const ports=freewayConnections({newCurve,newWidth,newType:this.roadType,existing:{...existing,roadType:{...existing.roadType,id:'asphalt'}}});
          if(ports.length)newCurve._freewayConflicts.push(existing.curve);
        }else intersections.push(...freewayConnections({newCurve,newWidth,newType:this.roadType,existing}));
        continue;
      }
      const exThreshold = (existing.width / 2) + 1.0;
      const combinedThreshold = threshold + exThreshold - 1.0;

      // Cache samples once. Keep every actual XZ crossing, not just the globally
      // closest pair: a loop ramp can pass under a road before joining it later.
      const samplesA = Math.min(256, Math.max(60, Math.ceil(newCurve.getLength() / 3)));
      const samplesB = Math.min(256, Math.max(60, Math.ceil(existing.curve.getLength() / 3)));
      const A = Array.from({length:samplesA+1},(_,i)=>newCurve.getPointAt(i/samplesA));
      const B = Array.from({length:samplesB+1},(_,i)=>existing.curve.getPointAt(i/samplesB));
      let bestDist = Infinity, bestTA = 0, bestTB = 0;
      const seeds = [];
      for (let i=0;i<=samplesA;i++) for (let j=0;j<=samplesB;j++) {
        const dist = Math.hypot(A[i].x-B[j].x,A[i].z-B[j].z);
        if (dist<bestDist) { bestDist=dist;bestTA=i/samplesA;bestTB=j/samplesB; }
        if (i===samplesA || j===samplesB) continue;
        const ax=A[i+1].x-A[i].x, az=A[i+1].z-A[i].z;
        const bx=B[j+1].x-B[j].x, bz=B[j+1].z-B[j].z;
        const den=ax*bz-az*bx;
        if(Math.abs(den)<1e-9)continue;
        const dx=B[j].x-A[i].x,dz=B[j].z-A[i].z;
        const u=(dx*bz-dz*bx)/den,v=(dx*az-dz*ax)/den;
        if(u< -1e-8||u>1+1e-8||v< -1e-8||v>1+1e-8)continue;
        const ta=(i+Math.max(0,Math.min(1,u)))/samplesA,tb=(j+Math.max(0,Math.min(1,v)))/samplesB;
        if(!seeds.some(q=>Math.abs(q[0]-ta)<1/samplesA&&Math.abs(q[1]-tb)<1/samplesB))seeds.push([ta,tb]);
      }
      // Preserve near-end T-junction semantics when centerlines do not quite touch.
      if(!seeds.length && bestDist<combinedThreshold)seeds.push([bestTA,bestTB]);
      const accepted=[];
      for(const [ta,tb] of seeds) {
        const refined = this._refineIntersection(newCurve, existing.curve, ta, tb);
        if (!refined) continue;
        const height = (curve,t) => curve._terrainProfile?.follow
          ? this.app.roadTerrain.height(curve,refined.point.x,refined.point.z) : curve.getPointAt(t).y;
        const hA=height(newCurve,refined.tA),hB=height(existing.curve,refined.tB);
        const limit = newCurve._terrainProfile?.follow && existing.curve._terrainProfile?.follow ? Infinity : .08;
        const endpointContact=endpointRoadContact(newCurve,refined.tA,existing.curve,refined.tB,roadProfile(existing.roadType,existing.width).half,roadProfile(this.roadType,newWidth).half)
          || endpointRoadContact(existing.curve,refined.tB,newCurve,refined.tA,roadProfile(this.roadType,newWidth).half,roadProfile(existing.roadType,existing.width).half);
        if (Math.abs(hA-hB)>limit && !endpointContact)continue;
        const tA=newCurve.getTangentAt(refined.tA).setY(0).normalize(),tB=existing.curve.getTangentAt(refined.tB).setY(0).normalize();
        if(Math.abs(tA.x*tB.z-tA.z*tB.x)<.08)continue;
        if(accepted.some(q=>q.point.distanceTo(refined.point)<.5))continue;
        accepted.push(refined);
        intersections.push({endpointContact,joinHeight:endpointContact?.height,point:refined.point,tNew:refined.tA,tExisting:refined.tB,
          newCurve,existingCurve:existing.curve,newWidth,existingWidth:existing.width,
          newRoadType:this.roadType,existingRoadType:existing.roadType});
      }
    }

    return intersections;
  }

  _refineIntersection(curveA, curveB, initTA, initTB) {
    // 二分法精确查找最近点
    let tA = initTA, tB = initTB;
    let range = 0.04;

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
      range *= .5;
      if (Math.sqrt(bestDist) < 0.001) break;
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

  // ============ 铺装层：沿跨段铺设模型库道路件 ============

  /**
   * 模型库拼装：沿路按跨段调用库道路件 build——
   * 缘石/人行道/标线/锯缝随件生成。宽度语义：asphalt/oneway/concrete 库件
   * width=总宽（车行+两侧各2.25m路侧带），画笔记的 width=车行宽 → 传入时补回两侧。
   * 分跨：密采样折线化，缺口区（路口）跳过，按转角/目标长切跨（库件为直件，
   * 弯处以短件拟合）；相邻跨端面按关节转角斜接（_miterPieceEnds）。
   */
  _buildRoadMesh(curve, gaps = [], rd = null) {
    const rt = (rd && rd.roadType) || this.roadType;
    const width = (rd && rd.width) || this.roadWidth;
    const roadGroup = new THREE.Group();
    roadGroup.name = `road_${rt.id}`;
    const L = curve.getLength();
    if (!(L > 0.01) || !rt || typeof rt.build !== 'function') return roadGroup;

    const SIDED = { asphalt: 1, oneway: 1, concrete: 1 };
    let pieceW;
    if (rt.section) pieceW = sectionDimensions(rt.id,rt.section).outerWidth;
    else if (rt.id === 'freeway') pieceW = Math.max(width, 20);                    // 高速=全宽结构（中央带+护栏），守库下限
    else pieceW = Math.max(SIDED[rt.id] ? width + 4.5 : width, SIDED[rt.id] ? 6.6 : 0.6);
    const target = rt.id === 'garden' ? 6 : 22;            // 分段目标长（贴近库件默认模数）

    const n = Math.max(16, Math.ceil(L / 0.75));           // ~0.75m 密采样
    const following = !!curve._terrainProfile?.follow;
    const pts = curve.getSpacedPoints(n).map(p => following ? p.clone().setY(0) : p);
    const inGap = (i) => {
      const t = i / n;
      for (const g of gaps || []) if (!g.isect?.plan?.compact && !(g.isect?.freeway && curve===g.isect.freeway.curve) && g.t1 > g.t0 && t >= g.t0 && t <= g.t1) return true;
      return false;
    };
    const spans = [];
    let a = null, b = null, len = 0, t0=0,t1=0;
    const push = () => { if (a && b && len >= 0.01) spans.push({ a, b, len, t0,t1 }); a = null; b = null; len = 0; };
    for (let i = 0; i <= n; i++) {
      if (inGap(i)) { push(); continue; }
      const p = pts[i];
      if (!a) { a = p; b = p; len = 0;t0=t1=i/n; continue; }
      const dx = p.x - b.x, dz = p.z - b.z;
      const seg = Math.hypot(dx, dz);
      if (seg < 1e-9) continue;
      if (len > 0) {
        const clen = Math.hypot(b.x - a.x, b.z - a.z);
        const cos = clen > 1e-9 ? ((b.x - a.x) * dx + (b.z - a.z) * dz) / (clen * seg) : 1;
        if (!following && Math.abs((p.y - b.y) / seg - (b.y - a.y) / (clen || 1)) > .002) {
          const joint = b, jointT=t1; push(); a = joint; b = p; len = seg;t0=jointT;t1=i/n; continue;
        }
        if (cos < 0.995 || len + seg > target) {           // 转角 >~5.7° 或超长 → 拆跨
          b = p; len += seg;t1=i/n;                               // 把引发断跨的段并入本跨，端点落在关节顶点
          push();                                          // a/b 清空
          a = p; b = p; len = 0;t0=t1=i/n;                           // 新跨从同一顶点出发 → 相邻跨端点严格重合
          continue;
        }
      }
      b = p;t1=i/n;
      len += seg;
    }
    push();

    // 接缝处理：「模型拉伸分段自适应」（见下方 _miterPieceEnds）——
    // 相邻跨在关节顶点重合后，按本段转角把端面顶点拉到角分面上斜接，V 形缝从几何上消除

    // 自由端等宽半圆收口：半径、侧带与实际路件横断面一致，不再外挂固定颈宽的大圆盘。
    if (!rd?.noJunct && spans.length && (rt.section || SIDED[rt.id] || width >= 5.5)) {
      const terrain = this.app.terrain;
      const halfEdge = (terrain?.size || 320) / 2;
      const eA = curve.getPointAt(0), eB = curve.getPointAt(1);
      if (following) eA.y = eB.y = 0;
      const tA = curve.getTangentAt(0).normalize(), tB = curve.getTangentAt(1).normalize();
      const ends = [
        { p: eA, dir: tA, other: eB, t: 0 },                              // t=0 端：车体方向= +切向
        { p: eB, dir: tB.clone().negate(), other: eA, t: 1 },             // t=1 端：车体方向= −切向
      ];
      for (const en of ends) {
        // 路口缺口已经接管的端点不是自由端。绘制顺序为「支路→主路」时，
        // 主路尚未加入 _roads，不能仅靠邻路扫描决定圆头，否则会在 T 口残留圆盘。
        if (gaps.some(g => g.t1 > g.t0 && en.t >= g.t0 - 1e-8 && en.t <= g.t1 + 1e-8)) continue;
        if (Math.max(Math.abs(en.p.x), Math.abs(en.p.z)) >= halfEdge - 16) continue;
        if (en.p.distanceTo(en.other) < 0.1) continue;              // 仅首尾重合才是闭环，短直路仍需收口
        let busy = false;
        for (const r of this._roads) {
          if (r.curve === curve) continue;
          const sp = r.curve.getSpacedPoints(20);
          for (const q of sp) {
            if (Math.abs((this.app.roadTerrain?.height(r.curve,q.x,q.z)??q.y)-(this.app.roadTerrain?.height(curve,en.p.x,en.p.z)??en.p.y)) < .8 && Math.hypot(q.x - en.p.x, q.z - en.p.z) < (r.width + width) / 2 + 1.5) { busy = true; break; }
          }
          if (busy) break;
        }
        if (busy) continue;
        const endSpan = en.t === 0 ? spans[0] : spans[spans.length - 1];
        const endPoint = en.t === 0 ? endSpan.a : endSpan.b;
        if (endPoint.distanceTo(en.p) > 1e-5) continue;            // 缺口边不是自由端
        const outward = en.t === 0 ? endSpan.a.clone().sub(endSpan.b) : endSpan.b.clone().sub(endSpan.a);
        outward.normalize();                                    // 对齐端部实际跨段（含弯道及坡度），不拿曲线切线近似
        const cap = buildRoadEndcap(rt, pieceW);
        if (!cap) continue;
        cap.rotation.order = 'YXZ';
        cap.rotation.y = Math.atan2(outward.x, outward.z);
        shearRoadGrade(cap, outward.y / (Math.hypot(outward.x, outward.z) || 1));
        cap.position.set(en.p.x, en.p.y + .02, en.p.z);            // 与路件使用完全相同的标高偏置
        cap.userData.endpoint = en.t;
        roadGroup.add(cap);
      }
    }

    const prm = { ...(rt.params || {}) };
    // 关节转角（有符号，左转为正）：相邻跨端点重合才算关节；跨过路口缺口不接 → τ=0
    const jointTau = (A, B) => {
      if (!A || !B) return 0;
      if (Math.abs(A.b.x - B.a.x) > 1e-6 || Math.abs(A.b.z - B.a.z) > 1e-6) return 0;
      const ax = A.b.x - A.a.x, az = A.b.z - A.a.z;
      const bx = B.b.x - B.a.x, bz = B.b.z - B.a.z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-9 || lb < 1e-9) return 0;
      return Math.atan2((ax * bz - az * bx) / (la * lb), (ax * bx + az * bz) / (la * lb));
    };
    for (let k = 0; k < spans.length; k++) {
      const s = spans[k];
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, dy = s.b.y - s.a.y;
      const chord = Math.hypot(dx, dz);
      if (chord < .01) continue;
      const piece = rt.build({ ...prm, width: pieceW, length: chord });
      if (!piece) continue;
      tagRoadRoles(piece,roadProfile(rt,width).pav);
      if(rt.id==='freeway')piece.traverse(m=>{if(m.isMesh)m.userData.freewaySide=Math.abs(m.position.x)<2?0:Math.sign(m.position.x);});
      shearRoadGrade(piece, dy / chord);
      this._miterPieceEnds(piece, chord, jointTau(spans[k - 1], s), jointTau(s, spans[k + 1]));
      piece.rotation.order = 'YXZ';
      piece.rotation.y = Math.atan2(dx, dz);               // 件 +Z 对齐行进方向
      // Grade is a vertical shear, not a pitch: adjacent deck/curb ends remain joined.
      piece.position.set((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 + 0.02, (s.a.z + s.b.z) / 2);
      piece.userData.roadRange=[s.t0,s.t1];
      roadGroup.add(piece);
    }
    this.app.roadTerrain?.warp(roadGroup, curve, true);
    applyFreewayCuts(roadGroup,curve,gaps);
    applyCompactCuts(roadGroup,curve,gaps);
    if(this.batchRoads!==false)batchRoadParts(roadGroup);
    return roadGroup;
  }

  /** 模型拉伸分段自适应：按本段关节转角 τ 把件端面顶点拉伸到与相邻件共有的角分面上
   * （斜接/miter）——两件端面落在同一平面、沿斜缝精确对接，转角外缘 V 形楔缝从几何上
   * 消除。只动到达端面（组坐标 |z∓d/2|≤0.05）且沿轴向（|nz|>0.9）的顶点，内部标线、
   * 横缝、箭头不受影响；直缝（τ≈0）为恒等变换；跨过路口缺口的两端 τ=0 保持原端面。
   * @param tauStart 上一件→本件的转角（z=−d/2 端），左转为正
   * @param tauEnd   本件→下一件的转角（z=+d/2 端），左转为正
   */
  _miterPieceEnds(grp, d, tauStart, tauEnd) {
    const endT = Math.abs(tauEnd) > 1e-3 ? Math.tan(tauEnd / 2) : 0;
    const staT = Math.abs(tauStart) > 1e-3 ? Math.tan(tauStart / 2) : 0;
    if (!endT && !staT) return;
    grp.updateMatrixWorld(true);                // 件尚在原点恒等位姿 → matrixWorld 即子件→件的链
    const eps = Math.min(0.05, d * .2);
    const eSin = Math.sin(tauEnd / 2), eCos = Math.cos(tauEnd / 2);
    const sSin = Math.sin(tauStart / 2), sCos = Math.cos(tauStart / 2);
    grp.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      const nor = o.geometry.attributes.normal;
      const m = o.matrixWorld;
      const mInv = new THREE.Matrix4().copy(m).invert();
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const nmInv = new THREE.Matrix3().copy(nm).invert();
      const v = new THREE.Vector3(), nv = new THREE.Vector3();
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const atEnd = Math.abs(v.z - d / 2) <= eps;
        const atStart = Math.abs(v.z + d / 2) <= eps;
        if (!atEnd && !atStart) continue;
        if (atEnd && endT) v.z += v.x * endT;
        if (atStart && staT) v.z -= v.x * staT;
        v.applyMatrix4(mInv);
        pos.setXYZ(i, v.x, v.y, v.z);
        touched = true;
        if (!nor) continue;
        nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        if (atEnd && endT && nv.z > 0.9) nv.set(-eSin, 0, eCos);
        else if (atStart && staT && nv.z < -0.9) nv.set(-sSin, 0, -sCos);
        else continue;                          // 侧面/顶面所在平面不变，法线保持
        nv.applyMatrix3(nmInv).normalize();
        nor.setXYZ(i, nv.x, nv.y, nv.z);
      }
      if (touched) {
        pos.needsUpdate = true;
        if (nor) nor.needsUpdate = true;
        o.geometry.computeBoundingSphere();
        o.geometry.computeBoundingBox();
      }
    });
  }

  _getRoadColor(roadId) {
    const colors = {
      asphalt: 0x3a3d42,
      oneway: 0x3a3d42,
      concrete: 0x999999,
      garden: 0xb07050,
      gravel: 0x8a8580,
    };
    return colors[roadId] || 0x3a3d42;
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

  // ============ 网络维护 ============

  _rebuildRoad(roadData) {
    const old = roadData.mesh;
    if (!old) return;
    this.app.appearance?.release(old);
    const parent = old.parent;
    const mesh = this._buildRoadMesh(roadData.curve, roadData.gaps || [], roadData);
    mesh.userData.so = old.userData.so;
    if (parent) parent.add(mesh);
    if (parent) parent.remove(old);
    old.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
    roadData.mesh = mesh;
    const obj = this.app.objects.find(o => o._roadData === roadData);
    if (obj) { obj.root = mesh; this.app.appearance?.apply(obj); if (this.app.selObj === obj) this.app.stage.setSelected(obj); }
  }

  // 删除道路：连带清理其路口，并让其它道路填补留下的缺口
  _onRoadRemoved(rd) {
    const i = this._roads.indexOf(rd);
    if (i >= 0) this._roads.splice(i, 1);
    const related = o => o.type === 'road_intersection' && o._isect &&
      (o._isect.newCurve === rd.curve || o._isect.existingCurve === rd.curve);
    for (const o of this.app.objects.slice()) {
      if (related(o)) this.app.removeObject(o);
    }
    for (const other of this._roads) {
      if(other.curve._freewayConflicts)other.curve._freewayConflicts=other.curve._freewayConflicts.filter(c=>c!==rd.curve);
      const before = (other.gaps || []).length;
      other.gaps = (other.gaps || []).filter(g => !(g.isect && (g.isect.newCurve === rd.curve || g.isect.existingCurve === rd.curve)));
      if (other.gaps.length !== before) this._rebuildRoad(other);
    }
  }

  // 删除路口：两侧道路恢复连续路面（挖洞源自同一份计划记录，按 isect 引用剥离）
  _onIsectRemoved(isect) {
    for (const rd of this._roads) {
      const before = (rd.gaps || []).length;
      rd.gaps = (rd.gaps || []).filter(g => g.isect !== isect);
      if (rd.gaps.length !== before) this._rebuildRoad(rd);
    }
  }

  // ============ 场景挂载 / 指针事件 ============

  addToScene(scene) {
    scene.add(this.group);
    this._bindEvents();
  }

  removeFromScene(scene) {
    scene.remove(this.group);
    this._unbindEvents();
  }

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
    const threshold = 14;
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

  // 交互状态机：idle（悬停幽灵）/ 点位或倒角手柄拖拽 / 落点。事件面收敛为 4 个监听器。
  _bindEvents() {
    const st = this.app.stage;
    const host = st.host || st.canvas?.parentElement;
    if (!host) return;
    this._host = host;
    this._drag = null;

    const pick = (ev) => {
      const r = st.canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const yi=hitRoadHeightGrip(ev,st,this.points.map(p=>p.toArray()));
      if(yi>=0)return {kind:'height',idx:yi};
      const pi = this._findPointAt(sx, sy);
      if (pi >= 0) return { kind: 'point', idx: pi };
      const hi = this._findHandleAt(sx, sy);
      if (hi >= 0) return { kind: 'handle', idx: hi };
      return null;
    };

    this._onPointerDown = (ev) => {
      if(this.app.roadConnector?.picking)return;
      if(ev.button !== 0 || this.app.state.playing || this.app.state.preview || this.app.suspended || this.app.aiScene?.busy) return;
      let immediate = null;
      if(!this.active) {
        const so = this.app.selObj;
        if(!this.selectedGuides.children.length || !so || so.locked) return;
        const controls=this.controlPointsFor(so),heightIndex=hitRoadHeightGrip(ev,st,controls);
        const index = heightIndex>=0 ? heightIndex : hitCurvePoint(ev, st, controls);
        if(index < 0 || !this.editRoad(so)) return;
        immediate = {kind:heightIndex>=0?'height':'point', idx:index, autoCommit:true, before:this.points[index].clone()};
        st.tc.detach();
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this._pointerOrbit=st.orbit?.enabled;
      if (st.orbit) st.orbit.enabled = false;
      try{host.setPointerCapture(ev.pointerId);}catch{}
      const hit = immediate || pick(ev);
      if (hit) {
        const heightDrag=hit.kind==='height' || (hit.kind==='point' && ev.shiftKey);
        if(heightDrag)this.freezeDraftHeights();
        const before = this.points[hit.idx]?.clone();
        const camera = st.view, rect = st.canvas.getBoundingClientRect();
        const units = camera.isOrthographicCamera ? (camera.top-camera.bottom)/camera.zoom/rect.height : 2*Math.tan((camera.fov||50)*Math.PI/360)*(before?.distanceTo(camera.position)||30)/rect.height;
        this._drag = {...hit, before, pointerId:ev.pointerId, heightDrag, startY:ev.clientY, units};
        try { host.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        return;
      }
      const p = this._aim(ev);
      if (p && isFinite(p.x)) this.addPoint(p.x, p.y, p.z);
    };

    this._onPointerMove = (ev) => {
      if (!this.active) return;
      if (this._drag) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        if (this._drag.heightDrag) {
          const pt = this.points[this._drag.idx];
          if (pt) { pt.y = Math.max(-100, Math.min(200, this._drag.before.y + (this._drag.startY-ev.clientY)*this._drag.units)); this.terrainMode = 'fixed'; }
          this._updatePreview(); this._updateLiveRoad(); return;
        }
        const p = this._drag.kind === 'point' && this.terrainMode === 'fixed' ? dragOnLevel(ev, st, this._drag.before.y) : this._aim(ev);
        if (!p || !isFinite(p.x)) return;
        if (this._drag.kind === 'handle') {
          this.setHandleFromWorld(this._drag.idx, p);
        } else {
          const terrain = this.app.terrain;
          const ty = terrain?.enabled ? terrain.heightAt(p.x, p.z) : 0;
          const pt = this.points[this._drag.idx];
          if (pt) pt.set(p.x, this.terrainMode === 'fixed' ? pt.y : ty + 0.02, p.z);
        }
        this._updatePreview();
        this._updateLiveRoad();
        return;
      }
      this._updateGhost(ev);
    };

    this._onPointerUp = (ev) => {
      if (!this.active) return;
      if (st.orbit) st.orbit.enabled = this._pointerOrbit ?? true;
      const autoCommit = this._drag?.autoCommit;
      const unchanged=autoCommit && this._drag.before && this.points[this._drag.idx]?.distanceTo(this._drag.before)<.0001;
      if(this._drag) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      this._drag = null;
      if(unchanged) this.cancelEdit();
      else if(autoCommit) { try { this.finish(); this.app.bus.emit('objects'); this.app.markDirty?.(); } catch(e) { this.cancelEdit(); this.app.notify?.(e.message,'warn'); } }
      try { host.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      this.app.bus.emit('road-edit');
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
    this._onPointerCancel = () => { if(this._drag?.autoCommit) this.cancelEdit(); this._drag = null; if(st.orbit) st.orbit.enabled = this._pointerOrbit ?? true; };
    host.addEventListener('pointercancel', this._onPointerCancel, true);
    host.addEventListener('lostpointercapture', this._onPointerCancel, true);
    host.addEventListener('dblclick', this._onDblClick, true);
  }

  _unbindEvents() {
    const host = this._host;
    if (!host) return;
    host.removeEventListener('pointerdown', this._onPointerDown, true);
    host.removeEventListener('pointermove', this._onPointerMove, true);
    host.removeEventListener('pointerup', this._onPointerUp, true);
    host.removeEventListener('pointercancel', this._onPointerCancel, true);
    host.removeEventListener('lostpointercapture', this._onPointerCancel, true);
    host.removeEventListener('dblclick', this._onDblClick, true);
    this._host = null;
    this._drag = null;
  }

  _aim(ev) {
    const st = this.app.stage;
    const r = st.canvas.getBoundingClientRect();
    st.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const p = this.terrainMode === 'fixed' ? dragOnLevel(ev, st, this._drag?.before?.y ?? this.points.at(-1)?.y ?? this.draftHeight ?? 8) : (this.app.dropPoint ? this.app.dropPoint(st.pointer) : st.groundPoint(0));
    return p && this.app.roadPlanning ? this.app.roadPlanning.snapPoint(p, ev.shiftKey, this.points[this.points.length - 1]) : p;
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
    this._ghost.position.set(p.x, this.terrainMode === 'fixed' ? p.y + .03 : gy + .05, p.z);
    this._ghost.visible = true;
  }
}
