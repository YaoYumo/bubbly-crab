import {
  compileBehavior,
  behaviorKeys,
  readBehaviorProgram,
  sampleBehavior,
  validateBehaviorRequest,
} from "./behavior-program.js";
import { cloneData } from "./ai-scene-format.js";
import { canonical, sha256 } from "./reference-format.js";
import { predictedAttachmentBox } from "./layout-maintenance.js";
import { subjectRuntime, restoreSubjects } from "./scene-runtime.js";
import { applyAbsoluteCharPose } from "./character.js";
const freeze = (v) => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const source = (a) => canonical(a.serialize({ assets: false }));
export const hasBehavior = (o) =>
  !!(o?.motion?.behavior || o?.motion?.behaviorError);
export function sampleActorBehavior(so, seconds) {
  if (so.app?.terrain?.enabled)
    throw Error("地形已启用；该平面行为已停用，请关闭地形后重新预演");
  const m = so.motion,
    p = (m.behavior = readBehaviorProgram(m.behavior)),
    s = sampleBehavior(p, seconds);
  if (!so.isChar || so.root.userData.crowd || so.item?.type !== "human")
    throw Error("行为仅支持库中单个人物");
  if (
    so.root.scale
      .toArray()
      .some((v, i) => !Number.isFinite(v) || Math.abs(v - p.scale[i]) > 1e-8)
  )
    throw Error("人物缩放已改变，请移除后重新预演行为");
  so.root.position.fromArray(s.p);
  so.root.rotation.set(0, s.yaw, 0);
  applyAbsoluteCharPose(so.root, s.anim, s.phase);
  return s;
}
export class BehaviorWorkflow {
  constructor(app) {
    this.app = app;
    this.busy = false;
    this._writing = false;
    this.draft = null;
    this._issued = null;
  }
  assertIdle(own = false) {
    const a = this.app;
    if (
      (this.busy && !own) ||
      a.state.playing ||
      Math.abs(a.state.time) > 1e-8 ||
      a.stage.dragging ||
      a.stage.exportOwner ||
      a.stage.exporting ||
      a.exporter?.running ||
      a.reference?.busy ||
      a.aiScene?.busy ||
      a.sceneRecipeBusy ||
      a.layout?._writing ||
      a.terrain?._strokeActive ||
      a.terrain?.workflow?.busy ||
      a.terrain?.workflow?.erosionPreview ||
      a.roadBrush?.active ||
      a.roadBrush?._editBackup ||
      a.vegetationBrush?.active
    )
      throw Error(
        "请暂停播放并回到0秒，结束导出、AI、拖拽、地形和道路／植被编辑任务",
      );
    if (a.objects.length > 2000) throw Error("导航首版最多2000个对象");
  }
  actor(id) {
    const o = this.app.byId(id);
    if (
      !o ||
      !o.visible ||
      !o.root.visible ||
      o.locked ||
      !o.isChar ||
      o.root.userData.crowd ||
      o.item?.type !== "human"
    )
      throw Error("请选择可见、未锁定的库中单个人物（不支持人群／导入骨骼）");
    if (
      o.params.sceneAttachment ||
      Math.abs(o.root.rotation.x) > 1e-8 ||
      Math.abs(o.root.rotation.z) > 1e-8 ||
      o.root.scale.toArray().some((v) => !Number.isFinite(v) || v <= 0) ||
      Math.abs(o.root.scale.x - o.root.scale.y) > 1e-8 ||
      Math.abs(o.root.scale.x - o.root.scale.z) > 1e-8
    )
      throw Error("行为人物不能挂接、倾斜、镜像或非均匀缩放");
    return o;
  }
  compile(id, request) {
    validateBehaviorRequest(request);
    const a = this.app,
      o = this.actor(id);
    if (a.terrain?.enabled)
      throw Error(
        "首版只支持y=0平面，请自行关闭地形后重新预演；不会自动关闭地形",
      );
    const coverage = {
        static: 0,
        obstacles: 0,
        ground: 0,
        aboveBelow: 0,
        dynamic: 0,
        effects: 0,
        hidden: 0,
      },
      obstacles = [],
      budget = { count: 0, vertices: 0, boxes: new Map() };
    for (const x of a.objects) {
      if (x === o) continue;
      if (!x.visible || !x.root.visible) {
        coverage.hidden++;
        continue;
      }
      if (x.isChar || x.motion?.active) {
        coverage.dynamic++;
        continue;
      }
      if (
        x.type === "fx" ||
        x.item?.type === "fx" ||
        x.item?.catId === "fx" ||
        x.root.userData.fx
      ) {
        coverage.effects++;
        continue;
      }
      if (
        !x.item &&
        !["road_brush", "road_intersection", "vegetation_patch"].includes(
          x.type,
        )
      )
        throw Error(
          "存在不支持的可见静态对象：" +
            x.name +
            "。首版请隐藏导入／未知资产后重试",
        );
      coverage.static++;
      if (coverage.static > 512)
        throw Error("静态障碍候选超过512个，请隐藏无关对象或拆分工程");
      let deforming = false;
      x.root.traverse((n) => {
        if (
          n.isSkinnedMesh ||
          n.morphTargetInfluences?.length ||
          (Array.isArray(n.material) ? n.material : [n.material]).some(
            (m) => m?.isShaderMaterial,
          )
        )
          deforming = true;
      });
      if (deforming) throw Error("不支持变形静态障碍：" + x.name);
      x.root.updateWorldMatrix(true, false);
      const det = x.root.matrixWorld.determinant();
      if (!Number.isFinite(det) || Math.abs(det) < 1e-10)
        throw Error("静态障碍变换不可逆：" + x.name);
      const box = predictedAttachmentBox(
        x.root,
        {
          pos: x.root.position.toArray(),
          rot: [x.root.rotation.x, x.root.rotation.y, x.root.rotation.z],
          scale: x.root.scale.toArray(),
        },
        budget,
      );
      if (box.isEmpty()) throw Error("静态对象缺少可检查网格：" + x.name);
      if (
        [...box.min.toArray(), ...box.max.toArray()].some(
          (v) => !Number.isFinite(v) || Math.abs(v) > 5000,
        )
      )
        throw Error("静态障碍包围盒无效或越界：" + x.name);
      if (
        [
          "road",
          "districtground",
          "groundplane",
          "road_brush",
          "road_intersection",
        ].includes(x.item?.type || x.type) &&
        box.max.y <= 0.12 &&
        box.min.y >= -0.2
      ) {
        coverage.ground++;
        continue;
      }
      if (box.max.y < -0.001 || box.min.y > request.height) {
        coverage.aboveBelow++;
        continue;
      }
      obstacles.push({
        min: [box.min.x, box.min.z],
        max: [box.max.x, box.max.z],
      });
      coverage.obstacles++;
    }
    const result = compileBehavior({
      request,
      origin: o.root.position.toArray(),
      yaw: o.root.rotation.y,
      scale: o.root.scale.toArray(),
      obstacles,
    });
    return { ...result, coverage, obstacles };
  }
  async preview(id, request) {
    this.assertIdle();
    this.draft = this._issued = null;
    const r = cloneData(request),
      before = source(this.app);
    if (before.length > 12e6) throw Error("超过12MB撤销保护，请先拆分工程");
    this.busy = true;
    try {
      const fingerprint = await sha256(before);
      this.assertIdle(true);
      if (source(this.app) !== before) throw Error("工程已变化，请重新预演");
      const result = this.compile(id, r);
      if (source(this.app) !== before) throw Error("工程已变化，请重新预演");
      const draft = freeze({
        actorId: id,
        baseFingerprint: fingerprint,
        ...result,
      });
      this.draft = this._issued = draft;
      return draft;
    } finally {
      this.busy = false;
    }
  }
  discard() {
    if (this.busy) throw Error("请等待当前任务结束");
    this.draft = this._issued = null;
  }
  async apply({ confirmedWarnings = false, extendDuration = false } = {}) {
    this.assertIdle();
    const d = this.draft;
    if (!d || d !== this._issued) throw Error("候选无效，请重新预演");
    if (confirmedWarnings !== true)
      throw Error("请先确认静态代理、动态障碍与接触限制");
    const a = this.app,
      before = source(a);
    this.busy = true;
    try {
      const f = await sha256(before);
      this.assertIdle(true);
      if (f !== d.baseFingerprint || source(a) !== before)
        throw Error("候选已过期，请重新预演");
      const fresh = this.compile(d.actorId, d.program.request);
      if (
        canonical(fresh) !==
        canonical({
          program: d.program,
          stats: d.stats,
          coverage: d.coverage,
          obstacles: d.obstacles,
        })
      )
        throw Error("候选校验不一致，请重新预演");
      if (
        d.program.duration > a.state.duration + 1e-8 &&
        extendDuration !== true
      )
        throw Error("行为超出工程时长，请明确同意延长时间轴");
      const o = this.actor(d.actorId);
      this.transaction(o, "应用多步骤行为", () => {
        a.setMotion(o, {
          behavior: fresh.program,
          behaviorError: null,
          active: true,
          keys: behaviorKeys(fresh.program),
          anim: "idle",
          speed: 1,
          autoFace: true,
          loop: false,
          curve: null,
        });
        if (extendDuration)
          a.state.duration = Math.max(a.state.duration, d.program.duration);
        sampleActorBehavior(o, 0);
      });
      this.draft = this._issued = null;
      return o;
    } finally {
      this.busy = false;
    }
  }
  remove(id, { confirmed = false } = {}) {
    this.assertIdle();
    if (confirmed !== true) throw Error("请明确确认移除行为");
    const o = this.app.byId(id);
    if (!o || o.locked || !hasBehavior(o))
      throw Error("请选择未锁定、带行为方案的人物");
    this.transaction(o, "移除多步骤行为", () => {
      this.app.setMotion(o, {
        behavior: null,
        behaviorError: null,
        active: false,
        keys: [],
        anim: o.params.anim || "idle",
      });
    });
  }
  transaction(o, label, fn) {
    const a = this.app,
      before = cloneData(a.serialize({ assets: false }));
    if (JSON.stringify(before).length > 12e6) throw Error("超过12MB撤销保护");
    const history = {
      _undo: [...(a._undo || [])],
      _redo: [...(a._redo || [])],
      _undoBytes: a._undoBytes,
      _undoAvail: a._undoAvail,
      _redoAvail: a._redoAvail,
      _opKey: a._opKey,
      _opAt: a._opAt,
    };
    const oldSelection = a.sel;
    const oldMotion = o.motion,
      duration = a.state.duration,
      runtime = subjectRuntime(a),
      poses = a.objects.map((x) => [
        x,
        x.root.position.clone(),
        x.root.rotation.clone(),
        x.root.scale.clone(),
      ]);
    this._writing = true;
    try {
      o.motion = { ...oldMotion };
      fn();
      const last = a._undo?.at(-1);
      a.pushUndo(label, before);
      if (!a._undo?.length || a._undo.at(-1) === last)
        throw Error("无法记录行为撤销快照");
      a._redo = [];
      a._redoAvail = 0;
      a._opKey = null;
      a.select({ kind: "obj", so: o });
      a.bus.emit("objects");
      a.bus.emit("time");
      a.bus.emit("undoable");
    } catch (e) {
      o.motion = oldMotion;
      a.state.duration = duration;
      Object.assign(a, history);
      for (const [x, pos, rot, scale] of poses) {
        x.root.position.copy(pos);
        x.root.rotation.copy(rot);
        x.root.scale.copy(scale);
        x.root.updateMatrixWorld(true);
      }
      restoreSubjects(a, runtime);
      o.rebuildMarkers();
      try {
        a.select(oldSelection);
        a.bus.emit("objects");
        a.bus.emit("time");
        a.bus.emit("undoable");
      } catch {}
      throw e;
    } finally {
      this._writing = false;
    }
    a.saveLocal();
  }
}
