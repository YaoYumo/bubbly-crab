import { actorFaceOffset, actorTangent, actorMotionDistance } from './actor-heading.js';
// ---------------------------------------------------------------------------
// App：状态与行为中枢（物体增删、选择、拖放、导入、路径、时间轴、导出）
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CameraEdit, readCameraEdit, resetCameraHistory } from './camera-edit.js';
import { ProjectAssets, packProject, unpackProject, localFileResources, persistLocal, restoreLocal } from './project-assets.js';
import { MaterialAppearance } from './material-appearance.js';
import { VegetationBrush, buildVegetationPatch } from './vegetation-brush.js';
import { Stage, ASPECTS } from './stage.js';
import { PerformanceMonitor } from './performance-monitor.js';
import { ModelInstancing } from './model-instancing.js';
import { RenderEffects } from './render-effects.js';
import { LocalLights } from './local-lights.js';
import { WindowLights } from './window-lights.js';
import { Lighting } from './lighting.js';
import { Shot, MOVE_BY_ID, SENSORS } from './camera.js';
import { LIB, LIB_INDEX, buildAsset, defaultsFor, shade } from './assets.js';
import { mergeSimilar, bakeMerge } from './geo.js';
import { updateChar, setCharAnim, stepCrowd, ANIMS, applyPathCharPose } from './character.js';
import { LEVELS, setDetailLevel, setTexForce, textureStats, pruneTextureCache, texOn } from './detail.js';

const v0 = new THREE.Vector3();
const v1 = new THREE.Vector3();
import { Mover } from './mover.js';
import { motionProgress } from './motion-schedule.js';
import { BehaviorWorkflow, hasBehavior, sampleActorBehavior } from './behavior-workflow.js';
import { readBehaviorProgram, behaviorKeys } from './behavior-program.js';
import { normalizePts, clonePts } from './curve.js';
import { RoadBrush } from './road-brush.js';
import { RoadPlanning } from './road-planning.js';
import { Terrain } from './terrain.js';
import { RoadTerrain } from './road-terrain.js';
import { LayoutMaintenance } from './layout-maintenance.js';
import { RoadDiagnostics } from './road-diagnostics.js';
import { WeatherSystem } from './weather.js';
import { clamp, uid, el, clear, busMake, snap as snapv, removeDeep, downloadBlob, copy, deg, rad } from './util.js';
const _fsN = new THREE.Vector3(), _fsM = new THREE.Matrix3();   // 贴面判定用的小工具：一次重建要看几千个网格，别反复 new

export class SceneObj {
  constructor(app, j = {}) {
    this.app = app;
    this.id = j.id || uid('obj');
    this.name = j.name || '物体';
    this.key = j.key || null;             // 库索引（可重建）
    this.type = j.type || 'prop';
    this.params = j.params || {};
    this.materialMode = ['on', 'off'].includes(j.materialMode) ? j.materialMode : 'inherit';
    this.followTerrain = j.followTerrain !== false;
    this.root = j.root || new THREE.Group();
    this.root.userData.so = this;
    this.visible = j.visible !== false;
    this.locked = !!j.locked;
    this.merged = !!j.merged;          // 批量造景时烘过几何：重建 / 载入后要再烘一次保持一致
    this.motion = j.motion || { keys: [], anim: 'idle', autoFace: true, speed: 1, easing: 'linear', loop: true, active: false };
    if (j.pos) this.root.position.fromArray(j.pos);
    if (j.rot) this.root.rotation.set(j.rot[0], j.rot[1], j.rot[2]);
    if (j.scale) this.root.scale.fromArray(j.scale);
    if (this.motion.behavior) {
      try {
        this.motion.behavior = readBehaviorProgram(this.motion.behavior);
        if (!this.isChar || this.root.userData.crowd || this.item?.type !== 'human') throw Error('行为只支持库中单个人物');
        this.motion.keys = behaviorKeys(this.motion.behavior);
        this.motion.mover = null;
        this.motion.behaviorError = null;
      } catch (e) {
        this.motion.behavior = null; this.motion.behaviorError = '行为方案已禁用：' + e.message;
        this.motion.active = false; this.motion.keys = []; this.motion.mover = null;
      }
    }
    this._mgroup = new THREE.Group();
    this._mgroup.userData.pickIgnore = false;
    app.stage.world.add(this.root);
    app.stage.helperLayer.add(this._mgroup);
    this.rebuildMarkers();
    this.apply();
  }
  apply() {
    this.root.visible = this.visible;
    this.app.appearance?.apply(this);
    if (this.motion?.anim) setCharAnim(this.root, this.motion.anim);
  }
  get item() { return this.key ? LIB_INDEX.get(this.key) : null; }
  get isChar() { return !!this.root.userData.char; }
  worldPos() { return this.root.getWorldPosition(new THREE.Vector3()); }
  height() {
    const bb = new THREE.Box3().setFromObject(this.root);
    return bb.isEmpty() ? 1 : bb.max.y - bb.min.y;
  }
  setParams(patch, rebuild = true) {
    if (hasBehavior(this)) throw Error('请先在多步骤行为里移除方案，再编辑人物参数');
    Object.assign(this.params, patch);
    if (rebuild) this.app.rebuildObject(this);
  }
  rebuildMarkers() {
    const g = this._mgroup;
    for (const c of [...g.children]) { c.traverse?.((o) => o.geometry?.dispose?.()); g.remove(c); }
    if (hasBehavior(this)) {
      if (this.motion.active && this.motion.behavior) {
        const pts = behaviorKeys(this.motion.behavior).map(k => new THREE.Vector3(...k.p));
        if (pts.length > 1) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x66d9a8, transparent: true, opacity: .85, depthTest: false }));
          line.renderOrder = 690; line.userData.pickIgnore = true; g.add(line);
        }
      }
      return;
    }
    const keys = this.motion?.keys || [];
    if (!this.motion?.active || !keys.length) return;
    keys.forEach((k, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(i === (this.app.selKeyIdx ?? -1) ? 0.2 : 0.13, 14, 10),
        new THREE.MeshBasicMaterial({ color: i === (this.app.selKeyIdx ?? -1) ? 0xffb547 : 0x7ce0b0, depthTest: false, transparent: true, opacity: 0.95 }));
      m.renderOrder = 700;
      m.position.fromArray(k.p);
      m.userData.keyRef = { objSo: this, i };
      g.add(m);
    });
    if (keys.length > 1) {
      const mv = new Mover(keys);
      const pts = [];
      for (let i = 0; i <= 140; i++) { const v = new THREE.Vector3(); if (mv.curve) mv.curve.getPoint(i / 140, v); else v.fromArray(keys[Math.round((i / 140) * (keys.length - 1))].p); pts.push(v); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x66d9a8, transparent: true, opacity: 0.85, depthTest: false }));
      line.renderOrder = 690;
      line.userData.pickIgnore = true;
      g.add(line);
    }
  }
  serialize() {
    const { mover: _runtimeMover, curvePts, ...motion } = this.motion || {};
    return {
      id: this.id, name: this.name, key: this.key, type: this.type, params: this.params,
      merged: this.merged ? 1 : undefined, materialMode: this.materialMode, followTerrain: this.followTerrain,
      pos: this.root.position.toArray(), rot: [this.root.rotation.x, this.root.rotation.y, this.root.rotation.z],
      scale: this.root.scale.toArray(), visible: this.visible, locked: this.locked,
      motion: this.motion ? { ...motion, ...(curvePts && !motion.curve ? { curve: clonePts(curvePts) } : {}), keys: (this.motion.keys || []).map((k) => ({ t: +k.t.toFixed(4), p: k.p.map((v) => +v.toFixed(3)) })) } : null,
    };
  }
}

export class App {
  constructor(host) {
    this.bus = busMake();
    this.stage = new Stage(host);
    this.stage.bus = this.bus;
    this.lighting = new Lighting(this.stage);
    this.objects = [];
    this.shots = [];
    this.sel = null;              // {kind:'obj'|'shot'|'key'|'objkey', ...}
    this.selKeyIdx = -1;
    this.editWhole = false;
    this.activeShot = null;
    this.state = {
      preview: false, aspect: '1.85', thirds: true, snap: 0.25, grid: false, roadSnap: false, roadGridSize: 5, parcelZones: {},
      perf: false, fps: 30, speed: 1, loop: true, time: 0, duration: 6, playing: false,
      showHelpers: true, importScale: 0,
      detail: 'std', env: 0.8, tex: true, // 模型精度档位 / 环境反射强度 / 表面贴图
      terrainTool: null,           // 地形笔刷（null = 未激活，指针交回轨道控制）
      followTerrain: true,        // 新放置的物体默认贴地
    };
    this._clock = new THREE.Clock();
    this._tmpV = new THREE.Vector3();
    this._prevObjPos = new Map();
    this._gizmoPrev = new THREE.Vector3();
    this._gizmoPrevQ = new THREE.Quaternion();
    this.projectAssets = new ProjectAssets();
    this.appearance = new MaterialAppearance(this);
    this.stage.appearance = this.appearance;
    this.bus.on('objects', () => this.appearance.applyAll());
    this.bus.on('light', () => this.appearance.applyAll());
    this.terrain = new Terrain(this);
    this.roadBrush = new RoadBrush(this);
    this.roadBrush.addToScene(this.stage.scene);
    this.weather = new WeatherSystem(this.stage.scene);
    // 绘制网格贴合地形；只有旧平面网格回退时才阻止穿插。
    this.stage.gridBlocked = () => !this.stage.drawingGrid && !!this.terrain?.enabled;
    this.roadPlanning = new RoadPlanning(this);
    this.vegetationBrush = new VegetationBrush(this);
    this.stage.setGridVisible(false);
    this.stage.setGroundY(-0.035);
    this.localLights = new LocalLights(this);
    this.lighting.localLights = this.localLights;
    this.windowLights = new WindowLights(this);
    this.lighting.windowLights = this.windowLights;
    this._bindStage();
    this.roadTerrain = new RoadTerrain(this);
    this.roadDiagnostics = new RoadDiagnostics(this);
    this.timeline = {
      get u() { return clamp(this.app.state.time / Math.max(0.05, this.app.state.duration), 0, 1); },
      app: this,
    };
    this.cameraEdit = new CameraEdit(this);
    this.storageReady = this.loadEnv();
    this.modelInstancing = new ModelInstancing(this);
    this.renderEffects = new RenderEffects(this);
    this.performance = new PerformanceMonitor(this);
    this.layout = new LayoutMaintenance(this);
    this.behaviors = new BehaviorWorkflow(this);
  }

  // ---------------------------------------------------------------- 选择
  byId(id) { return this.objects.find((o) => o.id === id) || null; }
  get selObj() { return this.sel?.kind === 'obj' || this.sel?.kind === 'objkey' ? this.sel.so || this.sel.objSo : null; }
  get selShot() { return this.sel?.kind === 'shot' || this.sel?.kind === 'key' ? this.sel.shot : null; }

  select(sel) {
    if (sel?.kind === 'objkey' && hasBehavior(sel.so)) sel = { kind: 'obj', so: sel.so };
    this.sel = sel;
    if (sel?.kind === 'obj') this._prevObjPos.set(sel.so.id, sel.so.root.position.clone());
    this.selKeyIdx = sel?.i ?? -1;
    const st = this.stage;
    if (!sel) { st.tc.detach(); st.setSelected(null); }
    else if (sel.kind === 'obj') st.setSelected(sel.so);
    else if (sel.kind === 'objkey') {
      st.setSelected(null);
      const m = sel.so._mgroup.children[sel.i];
      if (m) st.tc.attach(m);
    } else if (sel.kind === 'shot') {
      st.setSelected(null);
      const shot = sel.shot;
      if (!shot.mover.count) st.tc.attach(shot.rig);
      else st.tc.attach(this.editWhole ? shot.anchor : shot.markers.children[shot.selKey] || shot.anchor);
    } else if (sel.kind === 'key') { st.setSelected(null); this.selectKey(sel.shot, sel.i); }
    this.refreshGizmoSpace();
    this.bus.emit('select');
  }
  selectKey(target, i) {
    // 允许传入带 motion 的场景物体（其路径关键帧在世界空间）
    if (target && target.motion && !target.mover) {
      const so = target;
      const n = so.motion.keys.length;
      const idx = n ? clamp(i, 0, n - 1) : -1;
      this.select(idx >= 0 ? { kind: 'objkey', so, i: idx } : { kind: 'obj', so });
      return;
    }
    const shot = target;
    if (!shot) return;
    const idx = shot.mover.count ? clamp(i, 0, shot.mover.count - 1) : -1;
    shot.selectKey(idx);
    this.sel = { kind: 'key', shot, i: idx };
    this.selKeyIdx = idx;
    const mk = shot.markers.children[idx];
    if (mk) this.stage.tc.attach(mk);
    else this.stage.tc.attach(shot.anchor);
    this.refreshGizmoSpace();
    this.bus.emit('select');
  }
  refreshGizmoSpace() {
    const st = this.stage;
    const k = this.sel?.kind;
    if (k === 'key') st.tc.setSpace('local');
    if (k === 'shot' && !this.sel?.shot.mover.count) this.sel.shot.syncAnchor();
  }

  // ---------------------------------------------------------------- 物体路径关键帧
  syncMotion(so) {
    if (hasBehavior(so)) { this.notify('行为路线为只读，请重新预演或移除方案', 'warn'); return false; }
    so.motion.mover = so.motion.active && so.motion.keys?.length > 1 ? new Mover(so.motion.keys) : null;
    so.rebuildMarkers();
    this.bus.emit('objects');
  }
  addObjectKey(so = this.selObj, u = this.timeline.u) {
    if (!so) return null;
    if (hasBehavior(so)) { this.notify('行为路线为只读，请重新预演或移除方案', 'warn'); return null; }
    this.beginOp('加物体关键帧 ' + (so.name || ''));
    so.motion.keys = so.motion.keys || [];
    const t = +clamp(u, 0, 1).toFixed(4);
    const k = { t, p: so.root.position.toArray().map((v) => +v.toFixed(3)) };
    const near = so.motion.keys.findIndex((x) => Math.abs((x.t || 0) - t) < 5e-3);
    if (near >= 0) so.motion.keys[near] = k; else so.motion.keys.push(k);
    so.motion.keys.sort((a, b) => a.t - b.t);
    so.motion.active = true;
    this.syncMotion(so);
    this.select({ kind: 'objkey', so, i: so.motion.keys.indexOf(k) });
    return k;
  }
  removeObjectKey(so = this.selObj, i = this.selKeyIdx) {
    if (hasBehavior(so)) { this.notify('行为路线为只读，请重新预演或移除方案', 'warn'); return false; }
    if (!so || !so.motion?.keys || i < 0 || !so.motion.keys[i]) return false;
    so.motion.keys.splice(i, 1);
    if (this.selKeyIdx >= so.motion.keys.length) this.selKeyIdx = so.motion.keys.length - 1;
    this.syncMotion(so);
    this.select({ kind: 'obj', so });
    return true;
  }
  clearMotion(so = this.selObj) {
    if (!so) return;
    if (hasBehavior(so)) { this.notify('请在多步骤行为里明确确认移除方案', 'warn'); return; }
    so.motion.keys = [];
    so.motion.active = false;
    so.motion.mover = null;
    this.syncMotion(so);
    this.select({ kind: 'obj', so });
  }

  // ---------------------------------------------------------------- 物体
  itemByKey(k) { return LIB_INDEX.get(k); }
  /** 构件库的「层高」默认值：天花板 / 屋顶放进来就自动抬到一层之上 */
  /** 放置高度：地形开启时用地面高度；keepY 时至少不小于地面 */
  groundY(x, z, current = null) {
    const tr = this.terrain;
    if (tr?.enabled) {
      const gy = tr.heightAt(x, z);
      return current == null ? gy : Math.max(gy, current);
    }
    return current == null ? 0 : Math.max(0, current);
  }
  /** 扁平贴花（路面 / 草地 / 光斑…）：把每一片水平四边形按地形高度逐顶点抬起来。
   *  共面硬拼（z-fighting）与多边形偏移（偏移量随相机距离漂）都会表现成「颜色不停闪」，贴合才是正解。 */
  makeDecalSafe(so) {
    const root = so && so.root;
    if (!root) return so;
    root.updateMatrixWorld(true);
    let flats = 0;
    root.traverse((c) => { if (this._isFlatSheet(c)) flats++; });
    so.decal = flats > 0;
    if (!so.decal) return so;
    this.conformDecal(so);
    return so;
  }
  /** 是否是一张「水平大贴面」：极薄 + 跨度大 + 世界法线朝上 */
  _isFlatSheet(c) {
    if (!c || !c.isMesh || c.isInstancedMesh || !c.geometry?.attributes?.position) return false;
    const g = c.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb || bb.isEmpty()) return false;
    const ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
    if (Math.min(ex, ey, ez) > 0.03) return false;
    if (Math.max(ex, ey, ez) < 2.4) return false;
    if (ex < 0.03 && ey < 0.03) return false;                        // 一条细长条（石板行）不处理
    const n = _fsN.set(0, 0, 1).applyMatrix3(_fsM.getNormalMatrix(c.matrixWorld)).normalize();
    if (!Number.isFinite(n.y) || Math.abs(n.y) < 0.86) return false;  // 墙面、立牌之类不算贴面
    return true;
  }
  /** 地形变化后：把所有「贴地类」物体重新压一遍（幂等，内部有防重入） */
  refitAll() {
    if (this._inRefit) return;
    const tr = this.terrain;
    if (!tr || !tr.enabled) return;
    this._inRefit = true;
    try {
      for (const so of this.objects) {
        if (!so.pad) continue;
        // 找平目标按「当前」脚下平均高度重算：地形被刷高 / 挖低之后物件跟着起落，不会留下悬空或半埋
        const y = tr.meanHeight(so.pad.x, so.pad.z, so.pad.r);
        so.pad.y = y;
        tr.padAt(so.pad.x, so.pad.z, so.pad.r, y, { silent: true });
        so.root.position.y = y + (so.baseDrop || 0);
      }
      tr.refresh();                                  // 高度场先生效，再让贴面 / 散件跟着重贴
      for (const so of this.objects) { this.alignLinear(so); this.seatSmall(so); this.conformDecal(so); this.hugChildren(so); }
    } finally { this._inRefit = false; }
  }
  /**
   * 楼梯 → 天花板自动留洞：把每个楼梯顶部的洞口多边形搬到「高度对得上的那块楼板」的局部坐标，
   * 再交给天花板生成器用 Shape.holes 挖出来（所以洞口是真几何，不是贴图）。
   * 楼板 params.autoHole=false 可以单独关掉；楼梯被删 / 挪走时洞会自动补回来。
   */
  updateCeilingHoles() {
    if (this._inCeil) return 0;
    const v = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const ceil = this.objects.filter((o) => o.root && o.root.userData.ceiling);
    const stairs = this.objects.filter((o) => o.root && o.root.userData.stairOpen);
    this._inCeil = true;
    let touched = 0;
    try {
      for (const c of ceil) {
        const want = [];
        if (c.params.autoHole !== false) {
          c.root.updateMatrixWorld(true);
          inv.copy(c.root.matrixWorld).invert();
          const cy = c.root.getWorldPosition(v0).y;
          for (const st of stairs) {
            const o = st.root.userData.stairOpen;
            if (!o) continue;
            st.root.updateMatrixWorld(true);
            const oy = (o.y || 0) * (st.root.scale.y || 1) + st.root.getWorldPosition(v1).y;
            if (Math.abs(oy - cy) > Math.max(0.4, o.band || 2)) continue;
            const hw = (o.w || 0) / 2, hd = (o.d || 0) / 2;
            let pts;
            if (o.round > 0) {
              pts = [];
              for (let i = 0; i < 8; i++) {
                const ang = (i / 8) * Math.PI * 2;
                pts.push([Math.cos(ang) * o.round, Math.sin(ang) * o.round]);
              }
            } else {
              const cx = o.cx || 0, cz = o.cz || 0;
              pts = [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
            }
            const local = [];
            for (const [x, z] of pts) {
              v.set(x, (o.y || 0), z).applyMatrix4(st.root.matrixWorld).applyMatrix4(inv);
              local.push([+v.x.toFixed(2), +v.z.toFixed(2)]);
            }
            let area = 0;
            for (let i = 0; i < local.length; i++) {
              const [x1, z1] = local[i], [x2, z2] = local[(i + 1) % local.length];
              area += x1 * z2 - x2 * z1;
            }
            if (Math.abs(area) < 0.6) continue;                                             // 太小 / 退化的不算洞
            want.push(local);
          }
        }
        const cur = (c.params.holes || []).map((h) => h.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]));
        const same = cur.length === want.length && JSON.stringify(cur) === JSON.stringify(want);
        if (same) continue;
        const was = cur.length;
        c.params.holes = want;
        this.rebuildObject(c);
        touched++;
        if (want.length > was && !this._loading) this.notify(`已在「${c.name}」上留出 ${want.length} 处楼梯洞口（通向上一层）`, 'info');
      }
    } finally { this._inCeil = false; }
    if (touched) this.bus.emit('objects');
    return touched;
  }
  /** 小道具（横向 <6m）整体坐回地面：地形被改过之后不会留下悬空 / 半埋的东西 */
  seatSmall(so) {
    const tr = this.terrain;
    if (!tr || !tr.enabled || !so || !so.root || so.pad || so.decal || so.isChar || so.followTerrain === false) return;
    const item = so.item || {};
    if (item.cat === 'fx' || item.type === 'clouds' || item.type === 'stars') return;
    so.root.updateMatrixWorld(true);
    let bb = null;
    try { bb = new THREE.Box3().setFromObject(so.root); } catch (e) { return; }
    if (!bb || bb.isEmpty()) return;
    if (Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) > 6) return;
    const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
    const d = tr.heightAt(cx, cz) - bb.min.y;
    if (Math.abs(d) > 1.2 && Math.abs(d) < 12) so.root.position.y += d;
  }
  /** 细长构件沿地面坡度倾斜（局部长轴 → 沿轴采样 5 个地面高度 → 最小二乘斜率 → 绕水平法向转过去） */
  alignLinear(so) {
    const tr = this.terrain;
    const it = so && so.item;
    if (!tr || !tr.enabled || !so || !so.root || !it || so.decal || !App.LINEAR.has(it.type)) return;
    if (so.yaw0 == null) so.yaw0 = so.root.rotation.y || 0;
    so.root.updateMatrixWorld(true);
    const yaw = so.yaw0;
    so.root.rotation.set(0, 0, 0);
    so.root.updateMatrixWorld(true);
    const lb = new THREE.Box3().setFromObject(so.root);                 // 未旋转的包围盒：拿到建模的长轴方向
    so.root.rotation.set(0, yaw, 0);
    so.root.updateMatrixWorld(true);
    const lx = lb.max.x - lb.min.x, lz = lb.max.z - lb.min.z;
    const span = Math.max(lx, lz);
    if (!Number.isFinite(span) || span < 12) return;
    const alongX = lx >= lz;
    const dx = alongX ? Math.cos(yaw) : -Math.sin(yaw), dz = alongX ? Math.sin(yaw) : Math.cos(yaw);
    const c = so.root.position, half = span * 0.46;
    let suu = 0, suv = 0;
    for (let i = 0; i <= 4; i++) {
      const u = -half + (i / 4) * 2 * half;
      const v = tr.heightAt(c.x + dx * u, c.z + dz * u);
      suu += u * u; suv += u * v;
    }
    const k = suu > 1e-6 ? suv / suu : 0;                               // 地面沿长轴的斜率（rise/run）
    if (!Number.isFinite(k)) return;
    const th = Math.atan(Math.max(-0.4, Math.min(0.4, k)));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-dz, 0, dx).normalize(), th)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    so.root.quaternion.copy(q);                                          // 世界系先转 yaw 再绕水平法向倾
    so.root.updateMatrixWorld(true);
  }
  /** 单个物件重新贴地：移动 / 旋转 / 缩放之后，或模板把所有物件摆好之后（姿态变了，找平范围也得跟着变）。
   *  先把上一次找平填回去，再按当前包围盒重算，所以反复拖动不会在地形上留一堆旧补丁。 */
  refitOne(so, opts = {}) {
    if (['road_brush','road_intersection','vegetation_patch'].includes(so?.type)) return;
    const tr = this.terrain;
    if (!so || !so.root || !tr || !tr.enabled) return;
    this._inRefit = true;
    try {
      if (so.pad && so.pad.snap) tr.unpadAt(so.pad.snap, { silent: true });
      so.pad = null; so.baseDrop = null; so.hug = false; so.yaw0 = null;   // 姿态（位置 / 朝向 / 缩放）以当前值为准重算
      this.fitToGround(so);
      this.hugChildren(so);
      if (so.decal) this.conformDecal(so);
      if (!opts.quiet) tr.refresh();
    } finally { this._inRefit = false; }
  }
  /** 线性 / 跨越型构件不该把地面压平（桥、回廊、城墙、路、台阶都是顺着地走的） */
  static NO_PAD = new Set(['archbridge', 'corridor', 'citywall', 'road', 'walk', 'stonepath', 'wall', 'stairs', 'railing', 'fence', 'trench', 'sandbag', 'pipeline', 'runway']);
  /** 顺着地走的细长构件：整条按地面坡度倾一下，两端都踩到地上（拱桥 / 跑道是作者摆平的，不动） */
  static LINEAR = new Set(['corridor', 'citywall', 'wall', 'walk', 'road', 'stonepath', 'stairs', 'railing', 'fence', 'trench']);
  /**
   * 放置后贴地：
   *  1) 地面附近的小散件（石板 / 立柱 / 栅栏段）逐个落到地上；
   *  2) 紧凑型大体量（殿宇 / 谷仓 / 塔）把脚下找平一块圆台地；
   *  3) 贴花另走 conformDecal。
   */
  fitToGround(so, refit = false) {
    const tr = this.terrain;
    if (!so || !so.root || !tr || !tr.enabled || so.isChar) return;
    const item = so.item || {};
    if (item.cat === 'fx' || item.type === 'clouds' || item.type === 'stars') return;
    so.root.updateMatrixWorld(true);
    let bb = null;
    try { bb = new THREE.Box3().setFromObject(so.root); } catch (e) { return; }
    if (!bb || bb.isEmpty()) return;
    if (so.baseDrop == null) {                            // 帐篷 / 巨石之类网格垂到原点之下：记下这段距离，之后按「底面贴地」而不是原点贴地
      const drop = so.root.position.y - bb.min.y;
      so.baseDrop = drop > 0.35 && drop < 12 ? drop : 0;
    }
    so.hug = true;
    if (refit && !so.pad) return;
    const keepSnap = so.pad && so.pad.snap;               // 重复找平时沿用最早记下的高度：物件删掉能还原成原地形
    so.pad = null;
    const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z, tall = bb.max.y - bb.min.y;
    const span = Math.max(sx, sz);
    const ratio = span / Math.max(0.8, Math.min(sx, sz));
    const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
    if (!refit && ratio < 3 && span > 9 && tall > 1.6 && !App.NO_PAD.has(item.type)) {
      // 大体量又方正的物件（亭子 / 大殿 / 穹顶基地）：脚下抹一块平地，物件坐在平地上
      const r = Math.max(6, span * 0.66);
      const y = tr.meanHeight(cx, cz, r);                             // 取平均高度：只抹平起伏，不挖坑也不堆包
      const snap = keepSnap || tr.padAt(cx, cz, r, y, { silent: true });
      so.root.position.y = y + (so.baseDrop || 0);                    // 垫平的是地面，物件再按「模型垂到原点之下多少」抬起来
      so.pad = { x: cx, z: cz, r, y, snap };
      tr.refresh();
      this.conformDecal(so);
      if (!this._inRefit) for (const o of this.objects) if (o !== so) this.conformDecal(o);
    } else if (!refit && so.baseDrop && !so.decal && item.type !== 'pond') {
      so.root.position.y += so.baseDrop;                             // 底面抬回地面（一次即可，refit 不重复抬）
    }
  }
  /** 小散件逐件贴地：只处理本来就在地面附近的东西（桌上的灯不会被拽到地上） */
  hugChildren(so) {
    const tr = this.terrain;
    if (!tr || !tr.enabled || !so || !so.root || !so.hug) return;
    so.root.updateMatrixWorld(true);
    const sy = so.root.scale.y || 1;
    const base = new THREE.Vector3();
    so.root.getWorldPosition(base);
    for (const k of so.root.children) {
      if (!k.isGroup && !k.isMesh) continue;
      const b = new THREE.Box3().setFromObject(k);
      if (b.isEmpty()) continue;
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), h = b.max.y - b.min.y;
      if (w > 16 || h > 3.2) continue;                                   // 大板 / 屋顶 / 整栋楼不硬拽（倒木、树丛这类还是要贴）
      const cx = (b.max.x + b.min.x) / 2, cz = (b.max.z + b.min.z) / 2;
      const gy = tr.heightAt(cx, cz);
      if (b.min.y - gy > 1.3 || b.min.y - gy < -3) continue;             // 本来就离地太远 → 作者有意为之
      const d = gy - b.min.y;
      if (Math.abs(d) > 0.004) k.position.y += d / sy;
    }
  }
  /** 让贴面顶点贴住地形（可重复调用：地形被刷过之后再抬一次） */
  conformDecal(so) {
    const root = so && so.root;
    if (!root || !so.decal) return;
    const tr = this.terrain;
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const base = new THREE.Vector3();
    root.getWorldPosition(base);
    root.traverse((c) => {
      if (!this._isFlatSheet(c)) return;
      {                                                    // 只贴「落在物体基准高度附近」的片：屋顶之类悬空的薄板不要拉下来
        const bb2 = new THREE.Box3().setFromObject(c);
        if (!bb2.isEmpty() && (bb2.min.y + bb2.max.y) / 2 - base.y > 0.9) return;
      }
      const pos = c.geometry.attributes.position;
      const wm = new THREE.Matrix4().copy(c.matrixWorld), im = new THREE.Matrix4().copy(wm).invert();
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(wm);
        const want = (tr && tr.enabled) ? tr.heightAt(v.x, v.z) + 0.02 : 0.014;
        if (!Number.isFinite(want)) continue;
        if (Math.abs(v.y - want) < 1e-4) continue;
        v.y = want; v.applyMatrix4(im);
        pos.setXYZ(i, v.x, v.y, v.z);
        touched = true;
      }
      if (touched) { pos.needsUpdate = true; c.geometry.computeVertexNormals(); c.geometry.computeBoundingSphere(); }
    });
  }

  /** 落点：射线先打地形网格，取不到再退回 y=0 平面 */
  dropPoint(ndc) {
    const st = this.stage;
    if (ndc) st.pointer.copy(ndc);
    st.raycaster.setFromCamera(st.pointer, st.view);
    if (this.terrain?.enabled) {
      const hit = this.terrain.raycastToGround(st.raycaster);
      if (hit) return hit;
    }
    return st.groundPoint(0);
  }
  addAsset(key, point = new THREE.Vector3(0, 0, 0), opts = {}) {
    if (key?.startsWith('userlib:')) return this.modelLibrary?.place(key, point);
    const item = this.itemByKey(key);
    if (!item) return null;
    this.beginOp('放置 ' + (item.name || key));
    const params = { ...defaultsFor(item), ...(opts.params || {}) };
    const root = buildAsset(item, params);
    if (opts.merge) this.mergeRoot(root);
    const arr = Array.isArray(point) ? point : point?.pos;
    const src = arr ? { x: arr[0], y: arr[1], z: arr[2] } : (point || {});
    const g = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const so = new SceneObj(this, {
      name: opts.name || nextName(this, item.name), key, type: item.type, params, root,
      merged: !!opts.merge,
      pos: [g(src.x), this.groundY(g(src.x), g(src.z), opts.keepY ? g(src.y) : null), g(src.z)],
    });
    if (item.anim) so.motion.anim = params.anim || 'idle';
    this.makeDecalSafe(so);
    if (opts.authored) { so.followTerrain = false; }
    else if (item.elev) {                                          // 屋顶 / 天花板：抬到一层之上，且不参与贴地（贴地会把它拽回地面）
      so.root.position.y += item.elev;
      so.followTerrain = false;
      so.pad = true;
    } else {
      this.fitToGround(so);
      this.alignLinear(so);
      this.hugChildren(so);
    }
    so.followTerrain = !opts.authored && this.state.followTerrain && item.type !== 'fx' && this.terrain?.enabled !== false;
    if (item.elev) so.followTerrain = false;                   // 楼板 / 屋顶不跟地形起伏（跟了就会被拽回地面）
    if (item.elev) so.pad = true;
    so.root.userData.itemKey = key;
    this.objects.push(so);
    // 批量造景（一句话街区）期间由调用方统一刷新 UI，避免每个物体重绘一次面板
    if (!this._quietAdd) {
      this.select({ kind: 'obj', so });
      this.lighting.applyGlow(this.lighting.p.glow);
      this.bus.emit('objects');
    }
    return so;
  }
  addVegetationPatch(params) {
    const root = buildVegetationPatch(params);
    const so = new SceneObj(this, { name: '植被笔刷区域', type: 'vegetation_patch', params, root, followTerrain: false });
    this.objects.push(so);
    return so;
  }
  /** 批量造景减 draw call：同规格重复件实例化 + 同材质零碎件烘成一个几何（geo.js 既有工具，外观不变） */
  mergeRoot(root) {
    mergeSimilar(root, { min: 2 });
    bakeMerge(root);
    return root;
  }
  /** 精度切换：按当前 params 重建所有程序化资产（段数/倒角/贴图都会变），只刷一次 UI */
  rebuildAll() {
    const t0 = performance.now();
    this._inCeil = true;
    for (const so of this.objects) {
      if (so.type === 'vegetation_patch') { this.vegetationBrush.rebuild(so); continue; }
      if (!so.item) continue;                       // 导入的外部模型不做重建
      const old = so.root;
      const pos = old.position.clone(), rot = old.rotation.clone(), scl = old.scale.clone();
      const root = buildAsset(so.item, so.params);
      if (so.merged) this.mergeRoot(root);
      so.root = root;
      root.userData.so = so;
      root.position.copy(pos); root.rotation.copy(rot); root.scale.copy(scl);
      this.makeDecalSafe(so);
      this.fitToGround(so);
      this.stage.world.add(root);
      this.windowLights.release(old);
      this.appearance.release(old);
      removeDeep(old);
      so.apply();
    }
    this._inCeil = false;
    this.stage.refreshGroundDetail?.();
    this.updateCeilingHoles();
    this.lighting.applyGlow(this.lighting.p.glow);
    if (this.sel?.kind === 'obj') this.stage.setSelected(this.sel.so);
    this.bus.emit('objects');
    this.bus.emit('select');
    return Math.round(performance.now() - t0);
  }
  /** 切换模型精度（lite/std/fine）：立即重建，并记住到工程 JSON 里 */
  setDetail(l, { silent = false } = {}) {
    const lvl = LEVELS[l] ? l : 'std';
    this.state.detail = lvl;
    if (!setDetailLevel(lvl)) return 0;              // 档位没变 → 不用重建
    pruneTextureCache();                             // 释放上一档的贴图显存
    const ms = this.rebuildAll();
    if (!silent) this.notify(`模型精度 → ${LEVELS[lvl].name}（${ms}ms）`, 'ok');
    return ms;
  }
  setEnv(v) {
    this.state.env = clamp(+v || 0, 0, 2);
    if (this.lighting.mode === 'physical') this.lighting.physical.configure({ environment: this.state.env });
    else this.stage.setEnvIntensity(this.state.env);
  }
  /** 表面贴图开关（面板上的勾）：关 → 纯色低内存外观；开 → 跟随精度档位 */
  setTex(on) {
    this.beginOp(on ? '全部开启材质' : '全部关闭材质');
    this.state.tex = !!on;
    setTexForce(null);
    for (const so of this.objects) so.materialMode = 'inherit';
    this.appearance.applyAll();
    this.bus.emit('objects'); this.bus.emit('select');
    this.saveLocal();
    return 0;
  }
  detailStats() {
    const st = textureStats();
    let tri = 0, mesh = 0;
    this.stage.world.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { mesh++; const c = o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3; tri += (o.isInstancedMesh ? c * o.count : c); } });
    return { level: this.state.detail, tri: Math.round(tri), mesh, kinds: st.kinds, texels: st.texels, tex: texOn(), env: this.state.env };
  }
  rebuildObject(so) {
    if (!this._inCeil) this.updateCeilingHoles();          // 形状变了 → 天花板上的楼梯孔要重算
    const item = so.item;
    if (!item) { this.bus.emit('objects'); return; }
    const old = so.root;
    const pos = old.position.clone(), rot = old.rotation.clone(), scl = old.scale.clone();
    const root = buildAsset(item, so.params);
    if (so.merged) this.mergeRoot(root);
    so.root = root;
    root.userData.so = so;
    root.position.copy(pos); root.rotation.copy(rot); root.scale.copy(scl);
    this.makeDecalSafe(so);
    this.fitToGround(so);
    this.stage.world.add(root);
    this.windowLights.release(old);
    this.appearance.release(old);
    removeDeep(old);
    so.apply();
    this.lighting.applyGlow(this.lighting.p.glow);
    if (this.sel?.kind === 'obj' && this.sel.so === so) this.stage.setSelected(so);
    this.layout?.afterHostEdit(so);
    this.bus.emit('objects');
    this.bus.emit('select');
  }
  removeObject(so) {
    if (!so) return;
    this.beginOp('删除 ' + (so.name || '物体'));
    so.onRemove?.();
    this.windowLights.release(so.root);
    this.appearance.release(so.root);
    removeDeep(so.root);
    so._mgroup.parent?.remove(so._mgroup);
    this.objects = this.objects.filter((o) => o !== so);
    if (so.pad?.snap && this.terrain?.enabled && !this._inRefit) this.terrain.unpadAt(so.pad.snap);   // 找平过地形 → 物件删掉就复原
    for (const s of this.shots) if (s.targetId === so.id) { s.targetId = null; s.markDirty(); }
    if (this.selObj === so || this.sel?.so === so) this.select(null);
    this.bus.emit('objects');
  }
  duplicateSelected() {
    const so = this.selObj;
    if (!so) return null;
    this.beginOp('复制物体');
    const root = so.item ? buildAsset(so.item, so.params) : so.type === 'vegetation_patch' ? buildVegetationPatch(so.params) : this.projectAssets.instantiate(so.params?.assetId) || so.root.clone(true);
    const np = so.root.position.clone(); np.x += 2; np.z += 2;
    const ns = new SceneObj(this, {
      name: so.name + ' 副本', key: so.key, type: so.type, params: copy(so.params), root,
      pos: np.toArray(), rot: [so.root.rotation.x, so.root.rotation.y, so.root.rotation.z],
      scale: so.root.scale.toArray(), motion: copy(so.motion), materialMode: so.materialMode, followTerrain: so.followTerrain,
    });
    if (hasBehavior(ns)) { ns.motion = { keys: [], active: false, anim: ns.params.anim || 'idle', autoFace: true, speed: 1, loop: true, easing: 'linear' }; ns.rebuildMarkers(); ns.apply(); }
    // A duplicate is an independent object, not a second linked copy snapping onto its source.
    delete ns.params.sceneAttachment; delete ns.params.sceneKit; delete ns.params.sceneRecipeNode;
    if (!so.item) { ns.imported = true; }
    this.objects.push(ns);
    this.select({ kind: 'obj', so: ns });
    this.lighting.applyGlow(this.lighting.p.glow);
    this.bus.emit('objects');
    return ns;
  }
  focusSelected() {
    const t = this.selObj ? this.selObj.root : this.selShot ? this.selShot.rig : null;
    if (!t) return;
    const bb = new THREE.Box3().setFromObject(t);
    if (bb.isEmpty()) return;
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3()).length();
    this.stage.orbit.target.copy(c);
    const dir = this.stage.view.position.clone().sub(c).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.4, 0.7);
    this.stage.view.position.copy(c).addScaledVector(dir, Math.max(3, size * 1.1));
    this.stage.orbit.update();
  }
  setMotion(so, patch) {
    if (!so) return;
    if ((hasBehavior(so) || 'behavior' in (patch || {})) && !this.behaviors?._writing) throw Error('请通过多步骤行为预演并确认；生成的路径不可直接编辑');
    if (patch?.behavior) patch = { ...patch, behavior: readBehaviorProgram(patch.behavior) };
    Object.assign(so.motion, patch || {});
    if ('curve' in (patch || {})) so.motion.curvePts = normalizePts(so.motion.curve);
    if (so.motion.anim && so.isChar) setCharAnim(so.root, so.motion.anim);
    so.motion.mover = !so.motion.behavior && so.motion.active && so.motion.keys && so.motion.keys.length > 1
      ? new Mover(so.motion.keys, false, { ease: so.motion.easing || 'linear', scope: so.motion.scope || 'global', arc: so.motion.arc !== false, rot: 'slerp' })
      : null;
    so.rebuildMarkers();
    this.bus.emit('objects');
  }

  // ---------------------------------------------------------------- 机位
  addShot(opts = {}) {
    this.beginOp('新建机位');
    const s = new Shot(this, opts);
    this.stage.world.add(s.rig);
    this.shots.push(s);
    this.setActiveShot(s);
    this.select({ kind: 'shot', shot: s });
    this.refreshShotColors();
    this.bus.emit('shots');
    this.bus.emit('objects');
    return s;
  }
  removeShot(s) {
    this.beginOp('删除机位 ' + (s && s.name ? s.name : ''));
    if (!s) return;
    s.rig.parent?.remove(s.rig);
    s.dispose?.();
    this.shots = this.shots.filter((x) => x !== s);
    this.cameraEdit?.dropShot(s.id);
    if (this.activeShot === s) {
      this.activeShot = this.shots[0] || null;
      if (this.state.preview && !this.activeShot) this.setPreview(false);
    }
    if (this.selShot === s) this.select(null);
    this.refreshShotColors();
    this.bus.emit('shots');
  }
  /** 每个机位一个颜色：视口里的机身/路径线/名牌、左栏列表圆点、预览角标都同色 */
  /** 把一个机位的运动质量设置复制到所有机位（或全部物体走位） */
  syncMotionToAll(src, alsoObjects = true) {
    const o = { scope: src.motionScope, arc: src.arcSpeed, tension: src.tension, rot: src.rotMode, ease: src.easing };
    for (const s of this.shots) {
      if (s === src) continue;
      s.motionScope = o.scope; s.arcSpeed = o.arc; s.tension = o.tension; s.rotMode = o.rot; s.easing = o.ease;
      s.curves = { prog: src.curves?.prog ? clonePts(src.curves.prog) : null, shake: src.curves?.shake ? clonePts(src.curves.shake) : null };
      s.mover.opts = { ...s.mover.opts, ...s.moverOpts() };
      s.mover.rebuild();
      s.markDirty();
    }
    if (alsoObjects) {
      for (const so of this.objects) {
        if (!so.motion?.mover) continue;
        Object.assign(so.motion, { scope: o.scope, arc: o.arc, tension: o.tension, easing: o.ease });
        so.motion.mover.opts = { ...so.motion.mover.opts, ease: o.ease, scope: o.scope, arc: o.arc, tension: o.tension };
        so.motion.mover.rebuild();
      }
    }
    this.bus.emit('shot-change', src);
  }
  refreshShotColors() {
    this.shots.forEach((s, i) => { s.colorIdx = i; s.setActivePath(s === this.activeShot); s.refreshColors?.(); });
  }
  /** [ / ] 上一台 / 下一台机位 */
  cycleShot(dir = 1) {
    if (this.shots.length < 2) return null;
    const i = this.shots.indexOf(this.activeShot);
    const n = ((i < 0 ? 0 : i) + dir + this.shots.length) % this.shots.length;
    const s = this.shots[n];
    this.setActiveShot(s);
    this.select({ kind: 'shot', shot: s });
    if (this.state.preview) this.applyCameraSample();
    return s;
  }
  setActiveShot(s) {
    this.activeShot = s || null;
    for (const x of this.shots) x.setActivePath(x === s);
    if (s) {
      s.rig.updateMatrixWorld(true);
      this.stage.orbit.target.copy(s.rig.getWorldPosition(new THREE.Vector3()));
      this.lighting.setIso(s.iso || 400);
    } else {
      this.lighting.setIso(400);
    }
    this.bus.emit('shots');
  }
  /** 以当前视口视角建立机位 */
  shotFromView() {
    const v = this.stage.view;
    const q = v.quaternion.clone();
    const p = v.position.clone();
    const aspect = this.exportAspectValue();
    const hfov = 2 * Math.atan(Math.tan(rad(v.fov) / 2) * (v.aspect || aspect));
    const s = this.addShot({
      pos: p.toArray(), quat: [q.x, q.y, q.z, q.w],
      focal: clamp(Math.round((this.activeShot?.sensorInfo().sw || 36) / 2 / Math.tan(hfov / 2)), 8, 400),
    });
    return s;
  }
  exportAspectValue() {
    const a = ASPECTS[this.state.aspect];
    return a && a.v ? a.v : this.stage.w / Math.max(1, this.stage.h);
  }

  // ---------------------------------------------------------------- 预览
  setPreview(on) {
    this.state.preview = !!on;
    const st = this.stage;
    st.preview = this.state.preview;
    st.orbit.enabled = !st.preview;
    if (st.preview) {
      st.previewControls.activate();
      if (!this.activeShot) this.setActiveShot(this.shots[0] || this.addShot());
    } else {
      st.previewControls.deactivate();
    }
    this.refreshShotColors();
    this.updateAspectOverlay();
    this.bus.emit('preview');
  }
  updateAspectOverlay() {
    const a = ASPECTS[this.state.aspect];
    this.stage.aspect = this.state.preview && a ? a.v : 0;
    this.stage.thirds = this.state.thirds;
    this.stage.setOverlay();
    const sel = document.getElementById('aspectSel');
    if (sel && sel.value !== this.state.aspect) sel.value = this.state.aspect;
  }

  // ---------------------------------------------------------------- 舞台事件
  _bindStage() {
    const st = this.stage;
    for (const event of ['objects', 'terrain', 'gizmo-live', 'shots']) {
      this.bus.on(event, () => st.pickIndex.invalidate(event));
    }
    st.bus.on('click', ({ hit, ndc }) => {
      if (this.roadPlanning?.pick(ndc)) return;
      if (!hit) return;
      // DOF 点选模式
      if (this.state.dofPickMode && hit.kind === 'obj') {
        const shot = this.state.dofPickShot;
        if (shot) {
          shot.targetId = hit.so.uuid;
          shot.aim = 'target';
          if (shot.rig) {
            const dist = shot.rig.position.distanceTo(hit.so.root.position);
            shot.focusDist = dist;
          }
          this.state.dofPickMode = false;
          this.state.dofPickShot = null;
          this.bus.emit('shots');
          toast(`已设置对焦主体：${hit.so.name || '物体'}，相机将始终对准主体`);
        }
        return;
      }
      if (this.state.dofPickMode) {
        this.state.dofPickMode = false;
        this.state.dofPickShot = null;
      }
      if (hit.kind === 'obj') this.select({ kind: 'obj', so: hit.so });
      else if (hit.kind === 'key') {
        if (hit.shot) this.selectKey(hit.shot, hit.i);
        else if (hit.objSo) this.select({ kind: 'objkey', so: hit.objSo, i: hit.i });
      } else if (hit.kind === 'shot') this.select({ kind: 'shot', shot: hit.shot });
      else this.select(null);
    });
    st.bus.on('drop', ({ type, point, ndc }) => {
      if (!type) return;
      const key = type;
      if (!LIB_INDEX.has(key) && !this.modelLibrary?.find(key)) return;
      const at = ndc ? this.dropPoint(ndc) : point;
      this.addAsset(key, at, { keepY: false });
    });
    st.bus.on('transform-start', () => {
      const so = this.selObj;
      if (so) this._prevObjPos.set(so.id, so.root.position.clone());
      const gm = this.stage.gizmoMode;
      this.beginOp(gm === 'rotate' ? '旋转物体' : gm === 'scale' ? '缩放物体' : '移动物体', '', true);
    });
    st.bus.on('transform-change', (obj) => this.onGizmoChange(obj));
    st.bus.on('transform-end', () => {
      const so = this.sel && this.sel.kind === 'obj' ? this.sel.so : null;
      if (so?.type === 'road_brush') this.roadTerrain?.bakeTransform(so);
      if (so && this.terrain && this.terrain.enabled) {
        this.refitOne(so);                              // 旧的找平先还原，再按新的位置 / 朝向 / 缩放重算
        this.bus.emit('objects');
      }
      this.layout?.afterHostEdit(so);
      this.bus.emit('objects');
      this._prevObjPos.clear();
      if (this.selShot) this.selShot.syncAnchor();
      this.bus.emit('select');
    });
    st.bus.on('perf', () => this.lighting.update());
    st.bus.on('terrain', event => { if (!event?.restored) this.refitAll(); });           // 地形被改过 → 贴面/散件/地基全部重算
  }

  onGizmoChange(obj) {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === 'obj') {
      const so = sel.so;
      const prev = this._prevObjPos.get(so.id);
      const cur = so.root.position;
      // 贴地跟随：抬起超过 1.6m 视为「用户要悬空」，此后不再吸附
      const tr = this.terrain;
      if (tr?.enabled && so.followTerrain !== false) {
        const gy = tr.heightAt(cur.x, cur.z);
        if (cur.y - gy > 1.6) so.followTerrain = false;
        else cur.y = gy;
      }
      if (prev && so.motion?.active && so.motion.keys?.length) {
        const d = cur.clone().sub(prev);
        if (d.lengthSq() > 1e-8) {
          for (const k of so.motion.keys) k.p = [k.p[0] + d.x, k.p[1] + d.y, k.p[2] + d.z];
          so.rebuildMarkers();
        }
      }
      this._prevObjPos.set(so.id, cur.clone());
    } else if (sel.kind === 'key') {
      const m = sel.shot.markers.children[sel.i];
      if (!m) return;
      const k = sel.shot.mover.keys[sel.i];
      k.p = [m.position.x, m.position.y, m.position.z];
      k.q = [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w];
      sel.shot.mover.rebuild();
      sel.shot._rebuildPathLine();
    } else if (sel.kind === 'objkey') {
      const m = sel.so._mgroup.children[sel.i];
      if (!m) return;
      const k = sel.so.motion.keys[sel.i];
      k.p = [m.position.x, m.position.y, m.position.z];
      sel.so.rebuildMarkers();
    } else if (sel.kind === 'shot') {
      if (this.editWhole) sel.shot.applyAnchorDelta();
    }
    this.bus.emit('gizmo-live');
  }

  // ---------------------------------------------------------------- 每帧
  tick() {
    const dt = Math.min(0.05, this._clock.getDelta());
    this.step(dt, false);
    this.weather?.update(dt, this.stage.view?.position);
    this.stage.render();
  }
  /** 若 gizmo 附加的对象已被重建（refreshGizmos / rebuildObject 会重建节点），重新附加，避免 three 报「not part of scene graph」 */
  _repairGizmo() {
    const o = this.stage.tc?.object;
    if (!o || o.parent) return;
    const s = this.sel;
    const alive = s && (s.kind === 'key' || s.kind === 'shot') ? this.shots.includes(s.shot)
      : s && (s.kind === 'obj' || s.kind === 'objkey') ? this.objects.includes(s.so) : false;
    if (alive) { this.sel = null; this.select(s); }
    else { this.stage.tc.detach(); this.stage.setSelected(null); }
  }
  step(dt = 1 / 30, forExport = false) {
    this.roadPlanning?.tick();
    this.vegetationBrush?.tick();
    const S = this.state;
    this._repairGizmo();
    if (S.playing) {
      S.time += dt * S.speed;
      if (S.time >= S.duration) {
        if (S.loop) S.time = S.time % S.duration;
        else { S.time = S.duration; S.playing = false; this.bus.emit('playstate'); }
      }
    }
    const u = this.timeline.u;
    // 人物 / 物体路径
    for (const so of this.objects) {
      const m = so.motion;
      if (so._mgroup) so._mgroup.visible = S.showHelpers && !S.preview;
      if (!so.root.visible) continue;
      if (hasBehavior(so)) {
        if (m.active && m.behavior) {
          try { sampleActorBehavior(so, S.time); }
          catch (e) { m.active = false; m.behaviorError = '行为方案已禁用：' + e.message; so.rebuildMarkers(); this.notify(m.behaviorError, 'warn'); this.bus.emit('objects'); }
        }
        continue;
      }
      let dist = 0;
      if (m?.active && m.mover && m.mover.count > 1) {
        const prev = so.root.position.clone();
        const s = m.mover.sample(motionProgress(m, u), { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null }, 'linear',
          { ease: m.easing || 'linear', scope: m.scope || 'global', arc: m.arc !== false, tension: m.tension ?? 0.5, progCurve: m.curvePts || null });
        if (s) {
          so.root.position.copy(s.p);
          const tr = this.terrain;
          if (tr && tr.enabled && so.followTerrain !== false) {
            const gy = tr.heightAt(s.p.x, s.p.z);
            // 角色走位一律贴地（作者写的路径常常是平地 y=0）；非角色只在离地不远时贴，飞行的东西保持写好的高度
            if (so.isChar || Math.abs(s.p.y - gy) < 1.6) {
              so._ty = so._ty == null ? gy : so._ty + (gy - so._ty) * (1 - Math.exp(-dt / 0.12));
              so.root.position.y = so._ty;
            } else {
              so._ty = null;                            // 明显离地（跳 / 飞）→ 用作者写的 y
            }
          }
          dist = so.root.position.distanceTo(prev);
          if (m.autoFace) {
            const t = actorTangent(m, u);
            // faceOffset：模型车头非 +z（如轿车车头沿 +x → 偏移 -PI/2）时对齐行进方向
            if (t.lengthSq() > 1e-6) so.root.rotation.y = Math.atan2(t.x, t.z) + actorFaceOffset(so);
          }
        }
      }
      if (so.isChar) {
        if (so.root.userData.crowd) stepCrowd(so, dt, this.terrain);   // 人群：各自随机漫游（避水 + 贴地）
        if(!so.root.userData.crowd && m?.active && m.mover?.count>1)applyPathCharPose(so.root,m.anim||'walk',actorMotionDistance(m,u),m.speed??1,S.time);
        else updateChar(so.root, dt, dist, m?.speed ?? 1);
      }
    }
    // 预览相机：编辑选择与实际播出的镜头分离
    const cameraSample = this.cameraSample();
    const previewShot = cameraSample?.shot;
    if (S.preview && previewShot) {
      const st = this.stage;
      const pc = st.previewControls;
      if (!pc.interacted) {
        this.applyCameraSample(cameraSample);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(st.view.quaternion);
        pc.focus.copy(st.view.position).addScaledVector(dir, previewShot.focusDist || 8);
      }
      st.orbit.enabled = false;
      // 景深后处理
      if (previewShot.dofEnabled) {
        const aperture = previewShot.aperture || 2.8;
        const focusDist = previewShot.focusDist || 8;
        const apertureSize = 1.0 / aperture;
        st.setDofEnabled(true, {
          focus: focusDist,
          aperture: apertureSize * 0.01,
          maxblur: 0.015
        });
      } else {
        st.setDofEnabled(false);
      }
    } else {
      if (!S.preview) {
        this.stage.orbit.enabled = !this.stage.dragging;
      }
      this.stage.setDofEnabled(false);
    }
    this.stage.tcHelper.visible = !S.preview && !!this.sel;
    for (const s of this.shots) {
      // 视锥显示：尊重用户开关 + 仅在非预览且为活动机位时显示
      s.helper.visible = s.showFrustum && (s === this.activeShot) && !S.preview;
      s.transformAxes.visible = s.showFrustum && (s === this.activeShot) && !S.preview;
      s.markers.visible = this.state.showHelpers && !S.preview;
      s.body.visible = this.state.showHelpers && !S.preview;
      if (s.pathLine) s.pathLine.visible = this.state.showHelpers && !S.preview;
      if (s.label) {
        s.label.visible = this.state.showHelpers && !S.preview;
        s.fitLabel(this.stage.view.position);
      }
    }
    if (this.activeShot && !S.preview) {
      this.activeShot.rig.updateMatrixWorld(true);
      this.activeShot.helper.update?.();
    }
    this.lighting.setIso(S.preview && previewShot ? previewShot.iso : 400);
    this.lighting.physical.anchorSun(S.preview);
    this.localLights.tick();
    this.windowLights.tick();
    if (forExport) this.lighting.flushEnvironment();
    this.bus.emit('tick', dt);
  }

  // ---------------------------------------------------------------- 导入
  notify(msg, kind = 'info') { this.bus.emit('toast', { msg, kind }); }
  async importFiles(files, at, opts = {}) {
    if (!opts.libraryOnly) this.beginOp('导入模型');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
    const out = [];
    out.errors = [];
    const list = Array.from(files);
    const resources = localFileResources(list);
    const mtlFile = list.find((f) => /\.mtl$/i.test(f.name));
    for (const f of list) {
      const name = f.name;
      resources.setBase(f);
      try {
      if (opts.libraryOnly && /\.(previz|zip|json)$/i.test(name)) throw Error('模型库不接收工程文件');
      if (/\.(previz|zip)$/i.test(name)) {
        this.loadJson(await unpackProject(await f.arrayBuffer()));
        await this.projectAssets.ready();
        await this.saveLocal();
        this.notify('工程包已恢复，含模型与贴图');
        out.projectLoaded = true;
      } else if (/\.(glb|gltf)$/i.test(name)) {
        const buf = await f.arrayBuffer();
        const gltf = await new Promise((res, rej) => new GLTFLoader(resources.manager).parse(buf, '', res, rej));
        const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!scene) throw new Error('文件里没有可用网格');
        await resources.ready();
        out.push(await this._adoptModel(scene, name, at, gltf, opts));
      } else if (/\.fbx$/i.test(name)) {
        const buf = await f.arrayBuffer();
        const o = new FBXLoader(resources.manager).parse(buf, '');
        await resources.ready();
        out.push(await this._adoptModel(o, name, at, null, opts));
      } else if (/\.obj$/i.test(name)) {
        const txt = await f.text();
        let o = new OBJLoader(resources.manager).parse(txt);
        const reference = txt.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
        const materialFile = reference ? resources.file(reference) : mtlFile;
        if (reference && !materialFile) throw new Error('缺少材质文件「' + reference + '」，请连同 OBJ 一起导入');
        if (materialFile) {
          try {
            resources.setBase(materialFile);
            const mats = new MTLLoader(resources.manager).parse(await materialFile.text(), '');
            mats.preload();
            o = new OBJLoader(resources.manager).setMaterials(mats).parse(txt);
          } catch (e) { throw new Error('MTL 载入失败：' + e.message); }
        }
        await resources.ready();
        out.push(await this._adoptModel(o, name, at, null, opts));
      } else if (/\.(mtl|bin|png|jpe?g|webp|gif|bmp)$/i.test(name)) { /* 模型依赖，与主模型同批处理 */ }
      else if (/\.(json)$/i.test(name)) {
        try { this.pushUndo('载入工程文件'); this.loadJson(JSON.parse(await f.text())); await this.projectAssets.ready(); await this.saveLocal(); this.notify('已载入工程文件（Ctrl+Z 可退回）'); } catch (e) { this.notify('工程文件解析失败：' + (e.message || e), 'err'); }
      } else this.notify(`「${name}」暂不支持，可用格式：.glb / .gltf / .obj(+.mtl) / .fbx / 工程 .json`, 'warn');
      } catch (e) {
        out.errors.push({file:name,message:e.message});
        console.warn('导入失败', name, e);
        this.notify(`导入 ${name} 失败：${e.message || e}`, 'err');
      }
    }
    resources.dispose();
    if (out.length && !opts.libraryOnly) await this.saveLocal();
    if (out.length && !opts.libraryOnly) this.notify(`已导入 ${out.length} 个模型（已贴地${this.state.importScale > 0 ? '并归一化到 ' + this.state.importScale + 'm' : '，保持原始尺寸'}）`);
    return out;
  }
  async _adoptModel(src, filename, at, meta, opts = {}) {
    const root = new THREE.Group();
    root.add(src);
    const bb = new THREE.Box3().setFromObject(src);
    const size = bb.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const norm = opts.scale ?? this.state.importScale;
    if (norm > 0) src.scale.setScalar(norm / maxDim);
    const bb2 = new THREE.Box3().setFromObject(src);
    const c = bb2.getCenter(new THREE.Vector3());
    src.position.x -= c.x; src.position.z -= c.z; src.position.y -= bb2.min.y;
    shade(root);
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m && 'flatShading' in m) m.needsUpdate = true; });
      }
    });
    if (meta?.animations?.length) root.animations = meta.animations;
    const assetId = await (opts.resources || this.projectAssets).register(root);
    if (opts.libraryOnly) return {name:filename.replace(/\.[^.]+$/, ''),file:filename,assetId};
    const so = new SceneObj(this, {
      name: filename.replace(/\.[^.]+$/, ''), key: null, type: 'import',
      params: { assetId, file: filename, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)] },
      root, pos: [at?.x || 0, at?.y || 0, at?.z || 0],
    });
    so.imported = true;
    this.objects.push(so);
    this.select({ kind: 'obj', so });
    this.bus.emit('objects');
    return so;
  }

  async addStoredModel(model, text, at) {
    this.projectAssets.hydrate({[model.assetId]:text});
    const root = this.projectAssets.instantiate(model.assetId);
    await this.projectAssets.ready();
    try {
      this.modelLibrary.assertEditable();
      if (!this.modelLibrary.find(model.key)) throw Error('模型已从库中删除');
      this.beginOp('放置用户模型 ' + model.name);
      const x=at?.x||0,z=at?.z||0;
      const so=new SceneObj(this,{name:model.name,key:null,type:'import',params:{assetId:model.assetId,file:model.name},root,pos:[x,this.groundY(x,z),z]});
      so.imported=true;
      this.objects.push(so);this.select({kind:'obj',so});this.bus.emit('objects');
      this.notify('已放置 '+model.name);
      return so;
    } catch(e) { removeDeep(root);throw e; }
  }

  /** Shared by paused seeks, playback, PNGs and both video export paths. */
  cameraSample(time = this.state.time) {
    return this.cameraEdit.sample(time) || (this.activeShot ? {
      shot: this.activeShot, clip: null, time,
      u: clamp(time / Math.max(.05, this.state.duration), 0, 1),
    } : null);
  }
  applyCameraSample(sample = this.cameraSample()) {
    if (!sample) return;
    // A cut/seek must not inherit damping from a different clip or past seek.
    // In edit mode samples are stateless; path interpolation/handheld still apply.
    if (sample.clip) resetCameraHistory(sample.shot);
    const fa = this.stage.framingAspect(this.stage.aspect || 0);
    sample.shot.applyTo(this.stage.view, sample.u, sample.time, fa.canvasAspect, fa.eff);
  }

  // ---------------------------------------------------------------- 序列化
  serialize({ assets = true } = {}) {
    return {
      v: 4, assets: assets ? this.projectAssets.export(this.objects) : undefined, name: this.projectName || '未命名场景',
      generation: this.sceneGeneration || null,
      layoutRelations: this.layoutRelations || undefined,
      state: { aspect: this.state.aspect, duration: this.state.duration, fps: this.state.fps, showHelpers:this.state.showHelpers, thirds: this.state.thirds, snap: this.state.snap, grid: this.state.grid, roadSnap: this.state.roadSnap, roadGridSize: this.state.roadGridSize, parcelZones: this.state.parcelZones, perf: this.state.perf, detail: this.state.detail, env: this.state.env, tex: this.state.tex },
      view: { pos: this.stage.view.position.toArray(), target: this.stage.orbit.target.toArray(), fov: this.stage.view.fov },
      light: this.lighting.toJSON(),
      rendering: this.renderEffects.toJSON(),
      weather: this.weather.toJSON(),
      terrain: this.terrain?.toJSON() || null,
      objects: this.objects.map((o) => o.serialize()),
      shots: this.shots.map((s) => s.toJSON()),
      activeShot: this.activeShot?.id || null,
      cameraEdit: this.cameraEdit.toJSON(),
    };
  }
  clearAll() {
    this.sceneGeneration = null;
    this.layoutRelations = null;
    this.cameraEdit.reset();
    this.weather?.set(null);
    this._clearingScene = true;
    this.terrain?._cancelStroke?.();
    this.terrain?.workflow?.reset();
    this.roadPlanning?.reset();
    this.vegetationBrush?.stop();
    const prev = this._suspendUndo;
    this._suspendUndo = true;                       // 清空是「一步」，由调用方（载入模板 / 一键清空）负责留快照
    for (const o of [...this.objects]) this.removeObject(o);
    if (this.terrain) { this.terrain.h.fill(0); this.terrain.weights.fill(0); this.terrain.refresh(); this.terrain.setEnabled(true); }
    for (const s of [...this.shots]) this.removeShot(s);
    this.activeShot = null;
    this._suspendUndo = prev;
    this._clearingScene = false;
  }
  /** 破坏性操作前留一份快照，Ctrl+Z 可回 */
  pushUndo(label = '', snapshot = null) {
    this._undo = this._undo || [];
    this._undoBytes = this._undoBytes || 0;
    try {
      const j = JSON.parse(JSON.stringify(snapshot || this.serialize({ assets: false })));
      const size = JSON.stringify(j).length;
      this._undo.push({ label, j, size });
      this._undoBytes += size;
      // 40 步或 12MB 为限（批量摆景也不会吃内存）
      while (this._undo.length > 40 || this._undoBytes > 12e6) {
        const gone = this._undo.shift();
        if (!gone) break;
        this._undoBytes -= gone.size || 0;
      }
      this._undoAvail = this._undo.length;
      this.bus?.emit('undoable');
    } catch (e) { this.notify('快照失败：' + (e.message || e), 'warn'); }
  }
  /**
   * 每步操作开始前调用：留下「这一步之前」的状态，于是 Ctrl+Z 一次只退一步。
   * mergeKey 相同的连续操作（拖滑块、拖手柄）会合并成一步，不会把栈撑爆。
   */
  beginOp(label = '', mergeKey = '', force = false) {
    if (this._suspendUndo) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && mergeKey && this._opKey === mergeKey && now - (this._opAt || 0) < 1400) { this._opAt = now; return false; }
    this._opKey = mergeKey || null;
    this._opAt = now;
    this.pushUndo(label);
    this._redo = [];
    this._redoAvail = 0;
    return true;
  }
  /** 批量操作（载入模板 / 一键清空）期间不打扰撤销栈，由调用方自己打一步 */
  batchOp(label = '', fn = null) {
    const prev = this._suspendUndo;
    this._suspendUndo = true;
    try { this.pushUndo(label); return fn ? fn() : undefined; } finally { this._suspendUndo = prev; }
  }
  undo() {
    if (this.terrain?._strokeActive) { this.terrain._cancelStroke(); return true; }
    const u = (this._undo || []).pop();
    if (!u) { this.notify('没有可撤销的操作', 'warn'); this.bus?.emit('undoable'); return false; }
    this._undoBytes = Math.max(0, (this._undoBytes || 0) - (u.size || 0));
    this._opKey = null;
    try {
      const cur = JSON.parse(JSON.stringify(this.serialize({ assets: false })));
      this._redo = this._redo || [];
      this._redo.push({ label: u.label, j: cur, size: JSON.stringify(cur).length });
      if (this._redo.length > 40) this._redo.shift();
      this._redoAvail = this._redo.length;
      this.loadJson(u.j);
      this.bus?.emit('undoable');
      this.notify(u.label ? `已撤销「${u.label}」` : '已撤销');
      return true;
    } catch (e) { this.notify('撤销失败：' + (e.message || e), 'err'); return false; }
  }
  redo() {
    const r = (this._redo || []).pop();
    if (!r) { this.notify('没有可重做的操作', 'warn'); this.bus?.emit('undoable'); return false; }
    this._opKey = null;
    try {
      const cur = JSON.parse(JSON.stringify(this.serialize({ assets: false })));
      this._undo = this._undo || [];
      this._undo.push({ label: r.label, j: cur, size: JSON.stringify(cur).length });
      this._undoBytes = (this._undoBytes || 0) + this._undo.at(-1).size;
      while (this._undo.length > 40 || this._undoBytes > 12e6) { const g2 = this._undo.shift(); if (!g2) break; this._undoBytes -= g2.size || 0; }
      this._undoAvail = this._undo.length;
      this.loadJson(r.j);
      this.bus?.emit('undoable');
      this.notify(r.label ? `已重做「${r.label}」` : '已重做');
      return true;
    } catch (e) { this.notify('重做失败：' + (e.message || e), 'err'); return false; }
  }
  /** 一键清空：模型 / 机位 / 地形全清，回到可直接摆景的空白场 */
  clearScene({ blank = true } = {}) {
    const nObj = this.objects.length, nShot = this.shots.length;
    this.pushUndo(blank ? '空白场景' : '清空场景');
    this.state.playing = false;
    this.state.time = 0;
    this.state.duration = 8;
    this.clearAll();
    const tr = this.terrain;
    if (tr) {
      tr.setEnabled(blank);
      tr.h.fill(0);
      tr.setTool && (this.state.terrainTool = null);
      tr.refresh();
      tr.refreshUI && tr.refreshUI();
    }
    if (this.stage.setGroundVisible) this.stage.setGroundVisible(blank);
    if (this.curve && this.curve.close) this.curve.close();
    this.select(null);
    for (const ev of ['objects', 'shots', 'terrain', 'time', 'select']) this.bus.emit(ev);
    this.updateAspectOverlay && this.updateAspectOverlay();
    this.saveLocal();
    this.notify(nObj || nShot
      ? `已一键清空：${nObj} 个模型 · ${nShot} 个机位 → 空白场就绪 · Ctrl+Z 可撤销`
      : '已是空白场景：点顶栏 ✦ 一句话生成造景，或展开「模型库」拖入模型，按 C 建机位');
    return true;
  }
  /** 工程 JSON 无法保存外部模型网格，导入物用半透明占位盒代替，位置/路径/朝向仍然保留 */
  _importPlaceholder(o) {
    const g = new THREE.Group();
    const sz = Array.isArray(o.params?.size) && o.params.size.every((v) => Number.isFinite(v)) ? o.params.size : [1, 1, 1];
    const w = Math.max(0.05, sz[0] || 1), h = Math.max(0.05, sz[1] || 1), d = Math.max(0.05, sz[2] || 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x4a5a6c, transparent: true, opacity: 0.32, roughness: 0.8, metalness: 0 }));
    mesh.position.y = h / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x9fd0ff }));
    edges.position.copy(mesh.position);
    g.add(mesh, edges);
    g.userData.char = false;
    return g;
  }
  loadJson(j) {
    if (!j || !Array.isArray(j.objects)) throw new Error('不是有效的工程 JSON');
    // Validate edits before any destructive scene/resource changes.
    const cameraEdit = readCameraEdit(j.cameraEdit, j.shots || [], j.state?.duration || 6);
    this.projectAssets.hydrate(j.assets);
    for (const o of j.objects) if (o.params?.assetId && !this.projectAssets.records.has(o.params.assetId)) throw new Error('工程缺少模型资源，请打开完整 .previz 工程包');
    const importedRoots = new Map();
    for (const o of j.objects) if (o.params?.assetId) importedRoots.set(o, this.projectAssets.instantiate(o.params.assetId));
    const dl = LEVELS[j.state?.detail] ? j.state.detail : 'std';   // 精度要先落到全局，后面建模型才用得上
    setDetailLevel(dl);
    this.state.detail = dl;
    this.state.env = j.state?.env ?? this.state.env;
    this.state.tex = j.state?.tex ?? true;
    setTexForce(null);
    this.stage.setEnvIntensity(this.state.env);
    this.clearAll();
    if (j.name) this.projectName = j.name;
    this.sceneGeneration = j.generation || null;
    this.layoutRelations = j.layoutRelations ? JSON.parse(JSON.stringify(j.layoutRelations)) : null;
    for (const o of j.objects) {
      if (o.type === 'road_brush' || o.type === 'road_intersection') continue;   // 手绘道路走 RoadBrush.restore，路口自动重建
      let root;
      const item = o.key ? LIB_INDEX.get(o.key) : null;
      if (item) root = buildAsset(item, o.params || {});
      else if (o.type === 'vegetation_patch') root = buildVegetationPatch(o.params || {});
      else root = importedRoots.get(o) || this._importPlaceholder(o);
      if (o.merged && item) this.mergeRoot(root);
      const so = new SceneObj(this, {
        id: o.id, name: o.name, key: o.key, type: o.type, params: o.params || {}, root, merged: !!o.merged, materialMode: o.materialMode, followTerrain: o.followTerrain,
        pos: o.pos, rot: o.rot, scale: o.scale, visible: o.visible, locked: o.locked,
        motion: o.motion ? { ...o.motion, curvePts: normalizePts(o.motion.curve), mover: !o.motion.behavior && !o.motion.behaviorError && o.motion.keys?.length > 1 ? new Mover(o.motion.keys, false, { ease: o.motion.easing || 'linear', scope: o.motion.scope || 'global', arc: o.motion.arc !== false, rot: 'slerp' }) : null } : null,
      });
      so.imported = !item && o.type !== 'vegetation_patch';
      this.objects.push(so);
    }
    for (const sj of j.shots || []) {
      const s = Shot.fromJSON(this, sj);
      this.stage.world.add(s.rig);
      this.shots.push(s);
    }
    this.activeShot = this.shots.find((s) => s.id === j.activeShot) || this.shots[0] || null;
    this.refreshShotColors();
    for (const so of this.objects) if (!hasBehavior(so) && so.motion?.active && so.motion.keys?.length > 1) { so.motion.mover = new Mover(so.motion.keys, false, { ease: so.motion.easing || 'linear', scope: so.motion.scope || 'global', arc: so.motion.arc !== false, rot: 'slerp' }); so.rebuildMarkers(); }
    this.lighting.fromJSON(j.light);
    this.renderEffects.configure(j.rendering, { replace: true });
    this.weather.fromJSON(j.weather);
    this.bus.emit('weather');
    if (this.terrain) this.terrain.fromJSON(j.terrain || null);
    const roads = (j.objects || []).filter((o) => o.type === 'road_brush');
    if (roads.length) this.roadBrush.restore(roads);
    Object.assign(this.state, { aspect: j.state?.aspect || '1.85', duration: j.state?.duration || 6, fps: j.state?.fps || 30, showHelpers:j.state?.showHelpers!==false, perf: !!j.state?.perf });
    Object.assign(this.state, { grid: j.state?.grid === true, roadSnap: j.state?.roadSnap === true,
      roadGridSize: Math.max(1, Math.min(20, Number(j.state?.roadGridSize) || 5)), parcelZones: j.state?.parcelZones || {} });
    this.state.time = clamp(this.state.time, 0, this.state.duration);
    this.cameraEdit.load(cameraEdit);
    this.roadPlanning.gridDirty = true;
    this.stage.setGridVisible(this.state.grid);
    this.roadPlanning.changed();
    if (j.view) { this.stage.view.position.fromArray(j.view.pos); this.stage.orbit.target.fromArray(j.view.target); if(Number.isFinite(j.view.fov)){this.stage.view.fov=clamp(j.view.fov,10,120);this.stage.view.updateProjectionMatrix();} this.stage.orbit.update(); }
    this.stage.setPerfMode(!!this.state.perf);
    this.updateAspectOverlay();
    const missing = this.objects.filter((x) => x.imported && !x.params?.assetId).length;
    if (missing) this.notify(`${missing} 个导入模型只保留了占位盒与走位，请把原文件再拖进来`, 'warn');
    this.bus.emit('objects');
    this.bus.emit('shots');
    this.bus.emit('select');
    this.tick();
  }
  async saveProject() { return packProject(this); }
  async saveLocal() {
    // Do not persist temporary export poses, sampling duration or diagnostic state.
    if (this.stage.exportOwner || this.stage.exporting || this.reference?.busy || this.aiScene?.busy || this.sceneRecipeBusy) return false;
    if (this.benchmarkMode) return false; // Isolated benchmark tabs must never overwrite the user project.
    let savedAt;
    try {
      const doc = JSON.parse(JSON.stringify(this.serialize({ assets: false })));
      savedAt = this._lastSaveAt = Math.max(Date.now(), (this._lastSaveAt || 0) + 1);
      doc._savedAt = savedAt;
      const records = this.projectAssets.export(this.objects);
      const pending = (this._saveQueue || Promise.resolve()).catch(() => {}).then(() => persistLocal(doc, records));
      this._saveQueue = pending;
      await pending;
      // Lightweight synchronous fallback. Heavy resources live in IndexedDB.
      try { localStorage.setItem('cameraref.project', JSON.stringify(doc)); } catch { /* IndexedDB succeeded */ }
      this._saveWarning = false;
      return true;
    } catch (e) {
      try {
        localStorage.setItem('cameraref.project', JSON.stringify({ ...this.serialize(), _savedAt: savedAt || Date.now() }));
        return true;
      } catch {
        if (!this._saveWarning) this.notify('自动保存失败（空间不足或浏览器限制），请使用「保存工程」下载完整工程包', 'warn');
        this._saveWarning = true; return false;
      }
    }
  }
  async loadEnv() {
    try {
      const raw = localStorage.getItem('cameraref.project');
      this._auto = raw ? JSON.parse(raw) : null;
    } catch { this._auto = null; }
    try { const doc = await restoreLocal(); if (doc && (!this._auto || (doc._savedAt || 0) >= (this._auto._savedAt || 0))) this._auto = doc; } catch { /* legacy/local fallback */ }
  }
  maybeRestore() {
    if (!this._auto) return false;
    try { this.loadJson(this._auto); return true; } catch (e) { return false; }
  }
}

let nameSeq = {};
function nextName(app, base) {
  nameSeq[base] = (nameSeq[base] || 0) + 1;
  return `${base} ${nameSeq[base]}`;
}

export { LIB, LIB_INDEX, SENSORS, MOVE_BY_ID, ANIMS };
