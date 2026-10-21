import * as THREE from "three";
import { cloneData, validateAIRelations } from "./ai-scene-format.js";
import { localAnchor, segmentHitsBox } from "./spatial-relations.js";
import {
  captureAttachment,
  validateAttachment,
  planAttachments,
  angleDelta,
} from "./layout-attachments.js";
const MAX_OBJECTS = 2000,
  MAX_CHECKS = 20000;
const data = (o) => ({
  id: o.id,
  name: o.name,
  key: o.item ? o.key : null,
  type: o.type,
  params: cloneData(o.params || {}),
  pos: o.root.position.toArray(),
  rot: [o.root.rotation.x, o.root.rotation.y, o.root.rotation.z],
  scale: o.root.scale.toArray(),
  locked: o.locked,
  followTerrain: o.followTerrain,
  motion: { active: !!o.motion?.active },
});
const box = (o) => new THREE.Box3().setFromObject(o.root);
const supportKey = (k) =>
  !/districtground|riverwater|groundplane|road|terrain/.test(k || "");
export class LayoutMaintenance {
  constructor(app) {
    this.app = app;
    this.revision = 0;
    this.report = null;
    this.open = false;
    this._writing = false;
    for (const event of [
      "objects",
      "gizmo-live",
      "terrain",
      "shots",
      "time",
      "playstate",
    ])
      app.bus.on(event, () => this.invalidate());
  }
  invalidate() {
    this.revision++;
    if (this.report) this.report.stale = true;
    this.app.bus.emit("layout-diagnostics");
  }
  assertIdle() {
    const a = this.app;
    if (
      this._writing ||
      a.behaviors?.busy ||
      a.state.playing ||
      a.stage.exportOwner ||
      a.stage.exporting ||
      a.exporter?.running ||
      a.reference?.busy ||
      a.aiScene?.busy ||
      a.sceneRecipeBusy ||
      a.terrain?._strokeActive ||
      a.terrain?.workflow?.busy ||
      a.terrain?.workflow?.erosionPreview ||
      a.roadBrush?.active ||
      a.roadBrush?._editBackup ||
      a.vegetationBrush?.active ||
      a.stage.dragging
    )
      throw Error("请先暂停播放，结束导出、AI、地形、道路、植被和拖拽任务");
    if (a.objects.length > MAX_OBJECTS)
      throw Error("检查首版限2000个对象，请拆分工程");
  }
  captureKits(list) {
    // Only called for a newly generated trusted scene, never when loading an old project.
    const groups = new Map();
    for (const o of list.filter(Boolean)) {
      const k = o.params?.sceneKit;
      if (!k) continue;
      const id = k.id + "|" + k.instance;
      const g = groups.get(id) || [];
      g.push(o);
      groups.set(id, g);
    }
    for (const group of groups.values()) {
      const host = group.filter((o) => o.params.sceneKit.role === "host"),
        part = group.filter((o) => o.params.sceneKit.role === "attachment");
      if (host.length !== 1 || part.length !== 1) continue;
      try {
        part[0].params.sceneAttachment = captureAttachment(
          data(part[0]),
          data(host[0]),
          host[0].params.sceneKit.id,
        );
        part[0].followTerrain = false;
      } catch {
        /* Unsupported groups stay diagnostic-only, never guessed. */
      }
    }
    this.invalidate();
  }
  transaction(label, fn, { undo = true } = {}) {
    this.assertIdle();
    const a = this.app;
    const before = cloneData(a.serialize({ assets: false }));
    if (JSON.stringify(before).length > 12e6)
      throw Error("超过12MB撤销保护，请先保存并拆分工程");
    const history = {
      undo: [...(a._undo || [])],
      redo: [...(a._redo || [])],
      bytes: a._undoBytes,
      undoAvail: a._undoAvail,
      redoAvail: a._redoAvail,
      key: a._opKey,
      at: a._opAt,
    };
    const saved = a.objects.map((o) => ({
      o,
      pos: o.root.position.clone(),
      rot: o.root.rotation.clone(),
      scale: o.root.scale.clone(),
      binding:
        o.params.sceneAttachment === undefined
          ? undefined
          : cloneData(o.params.sceneAttachment),
      follow: o.followTerrain,
    }));
    const previousRelations = a.layoutRelations;
    this._writing = true;
    try {
      fn();
      if (undo) {
        const previous = a._undo?.at(-1);
        a.pushUndo(label, before);
        if (!a._undo?.length || a._undo.at(-1) === previous)
          throw Error("无法记录撤销快照");
        a._redo = [];
        a._redoAvail = 0;
        a._opKey = null;
      }
      a.bus.emit("objects");
      a.bus.emit("layout-diagnostics");
    } catch (e) {
      for (const s of saved) {
        s.o.root.position.copy(s.pos);
        s.o.root.rotation.copy(s.rot);
        s.o.root.scale.copy(s.scale);
        s.o.root.updateMatrixWorld(true);
        s.o.followTerrain = s.follow;
        if (s.binding === undefined) delete s.o.params.sceneAttachment;
        else s.o.params.sceneAttachment = s.binding;
      }
      a.layoutRelations = previousRelations;
      a._undo = history.undo;
      a._redo = history.redo;
      a._undoBytes = history.bytes;
      a._undoAvail = history.undoAvail;
      a._redoAvail = history.redoAvail;
      a._opKey = history.key;
      a._opAt = history.at;
      this.invalidate();
      try {
        a.bus.emit("objects");
        a.bus.emit("undoable");
      } catch {
        /* State already restored; preserve the original failure. */
      }
      throw e;
    } finally {
      this._writing = false;
    }
    a.saveLocal();
  }
  bind(childId, hostId) {
    this.assertIdle();
    const a = this.app,
      child = a.byId(childId),
      host = a.byId(hostId);
    if (!child?.item || !host?.item || child.locked)
      throw Error("选择未锁定的静态库部件和库宿主");
    const binding = captureAttachment(data(child), data(host));
    const objects = a.objects.map(data),
      next = objects.find((o) => o.id === childId);
    next.params.sceneAttachment = binding;
    next.followTerrain = false;
    const plan = planAttachments(objects);
    if (plan.issues.length) throw Error(plan.issues[0].message);
    this.transaction("建立挂接", () => {
      child.params.sceneAttachment = binding;
      child.followTerrain = false;
    });
  }
  detach(childId) {
    const child = this.app.byId(childId);
    if (!child || child.locked) throw Error("部件缺失或已锁定");
    this.transaction("解除挂接", () => delete child.params.sceneAttachment);
  }
  setFollow(childId, enabled) {
    const child = this.app.byId(childId);
    if (!child || child.locked) throw Error("部件缺失或已锁定");
    const b = cloneData(validateAttachment(child.params.sceneAttachment));
    b.follow = !!enabled;
    this.transaction("切换编辑后联动", () => {
      child.params.sceneAttachment = b;
    });
  }
  clearRelations() {
    this.transaction("清除AI关系诊断记录", () => {
      this.app.layoutRelations = null;
    });
  }
  sync(selectedId = null, { auto = false } = {}) {
    this.assertIdle();
    const a = this.app,
      plan = planAttachments(a.objects.map(data), {
        selectedId,
        autoOnly: auto,
      });
    if (plan.issues.length) throw Error(plan.issues[0].message);
    if (!plan.patches.length) return 0;
    // Validate predicted final geometry without changing the live roots or disposing shared resources.
    const predicted = new Map(),
      geometryBudget = { count: 0, vertices: 0, boxes: new Map() };
    for (const p of plan.patches) {
      const so = a.byId(p.id),
        b = predictedAttachmentBox(so.root, p.next, geometryBudget);
      if (
        b.isEmpty() ||
        ![...b.min.toArray(), ...b.max.toArray()].every(
          (v) => Number.isFinite(v) && Math.abs(v) <= 600,
        )
      )
        throw Error("同步结果几何为空或超出世界±600m");
      predicted.set(p.id, b);
    }
    const protectedObjects = a.objects.filter((o) => o.locked);
    let checks = 0;
    for (const p of plan.patches) {
      const ancestors = new Set();
      let id = p.id;
      while (a.byId(id)?.params?.sceneAttachment) {
        id = a.byId(id).params.sceneAttachment.hostId;
        if (ancestors.has(id)) throw Error("挂接成环");
        ancestors.add(id);
      }
      for (const other of protectedObjects) {
        if (other.id === p.id || ancestors.has(other.id)) continue;
        if (++checks > MAX_CHECKS)
          throw Error("保护对象检查超过预算，请缩小同步范围");
        if (predicted.get(p.id).intersectsBox(box(other)))
          throw Error("同步部件将进入其他锁定对象包围盒：" + other.id);
      }
    }
    this.transaction(
      auto ? "编辑后联动" : "同步挂接部件",
      () => {
        for (const p of plan.patches) {
          const o = a.byId(p.id);
          o.root.position.fromArray(p.next.pos);
          o.root.rotation.set(...p.next.rot);
          o.root.scale.fromArray(p.next.scale);
          o.root.updateMatrixWorld(true);
        }
      },
      { undo: !auto },
    );
    return plan.patches.length;
  }
  afterHostEdit(host) {
    if (
      !host ||
      this._writing ||
      this.app._suspendUndo ||
      this.app._quietAdd ||
      this.app._clearingScene
    )
      return;
    if (
      !this.app.objects.some(
        (o) =>
          o.params?.sceneAttachment?.hostId === host.id &&
          o.params.sceneAttachment.follow === true,
      )
    )
      return;
    // No background listeners mutate a loaded/undone project. Only explicit edit completion calls this hook.
    try {
      this.sync(host.id, { auto: true });
    } catch (e) {
      this.app.notify("部件未自动同步：" + e.message, "warn");
      this.invalidate();
    }
  }
  inspect() {
    this.assertIdle();
    const a = this.app,
      issues = [],
      push = (code, subject, message, extra = {}) => {
        if (issues.length < 200)
          issues.push({ code, subject, message, ...extra });
      };
    a.stage.scene.updateMatrixWorld(true);
    const objects = a.objects.map(data),
      byId = new Map(objects.map((o) => [o.id, o]));
    const plan = planAttachments(objects);
    for (const e of plan.issues) push(e.code, e.subject, e.message);
    for (const p of plan.patches)
      push(
        "attachment-drift",
        p.id,
        "部件偏离挂接位置、朝向或缩放，可手动同步",
      );
    for (const o of objects)
      if (o.params.sceneKit?.role === "attachment" && !o.params.sceneAttachment)
        push(
          "unbound-kit",
          o.id,
          "组合件只有来源标记，尚未建立稳定ID挂接；请手动选择宿主",
        );
    const boxes = new Map();
    const getBox = (id) => {
      if (!boxes.has(id)) {
        const o = a.byId(id);
        boxes.set(id, o ? box(o) : null);
      }
      return boxes.get(id);
    };
    try {
      if (a.layoutRelations) {
        validateAIRelations(a.layoutRelations);
        for (const r of a.layoutRelations.rules) {
          const s = byId.get(r.subject),
            ref = byId.get(r.reference || r.target || r.obstacle);
          if (!s || !ref) {
            push("relation-missing", r.subject, "AI关系对象已删除或引用缺失");
            continue;
          }
          if (!s.key || !ref.key || s.motion.active || ref.motion.active) {
            push("relation-unchecked", s.id, "带活动走位的AI关系未检查");
            continue;
          }
          if (r.type === "offset") {
            if (
              r.frame === "local" &&
              (Math.abs(ref.rot[0]) > 1e-5 || Math.abs(ref.rot[2]) > 1e-5)
            ) {
              push("relation-unchecked", s.id, "local关系宿主有非Y轴旋转");
              continue;
            }
            const expected =
              r.frame === "world"
                ? ref.pos.map((v, i) => v + r.delta[i])
                : localAnchor(ref.pos, ref.rot[1], r.delta);
            if (Math.hypot(...s.pos.map((v, i) => v - expected[i])) > 0.002)
              push(
                "relation-offset",
                s.id,
                "AI相对偏移已变化（只诊断，不自动修复）",
              );
          }
          if (r.type === "face") {
            const dx = ref.pos[0] - s.pos[0],
              dz = ref.pos[2] - s.pos[2];
            if (
              Math.hypot(dx, dz) < 1e-6 ||
              Math.abs(angleDelta(s.rot[1], Math.atan2(dx, dz))) > 0.001
            )
              push("relation-face", s.id, "AI模型朝向已变化或目标重合");
          }
          if (r.type === "distance") {
            const d = Math.hypot(...s.pos.map((v, i) => v - ref.pos[i]));
            if (d < r.min - 1e-6 || d > r.max + 1e-6)
              push(
                "relation-distance",
                s.id,
                "AI距离约束不满足：" + d.toFixed(3) + "m",
              );
          }
          if (r.type === "keep-out") {
            const x = getBox(s.id),
              y = getBox(ref.id);
            if (!x || !y || x.isEmpty() || y.isEmpty())
              push("relation-unchecked", s.id, "AI留空关系没有有效几何");
            else if (
              x.min.x < y.max.x + r.margin - 1e-6 &&
              x.max.x > y.min.x - r.margin + 1e-6 &&
              x.min.z < y.max.z + r.margin - 1e-6 &&
              x.max.z > y.min.z - r.margin + 1e-6
            )
              push("relation-clearance", s.id, "AI平面留空约束不满足");
          }
        }
      }
    } catch (e) {
      push("relation-invalid", null, "AI关系记录无效：" + e.message);
    }
    const statics = a.objects.filter(
      (o) =>
        o.item &&
        o.visible &&
        o.type !== "fx" &&
        !o.motion?.active &&
        supportKey(o.key),
    );
    let comparisons = 0,
      complete = true;
    outer: for (let i = 0; i < statics.length; i++)
      for (let j = i + 1; j < statics.length; j++) {
        if (++comparisons > MAX_CHECKS) {
          complete = false;
          break outer;
        }
        const x = statics[i],
          y = statics[j];
        if (
          x.params.sceneAttachment?.hostId === y.id ||
          y.params.sceneAttachment?.hostId === x.id
        )
          continue;
        const bx = getBox(x.id),
          by = getBox(y.id);
        if (bx?.intersectsBox(by)) {
          const overlap = bx.clone().intersect(by).getSize(new THREE.Vector3());
          if (Math.min(overlap.x, overlap.y, overlap.z) > 0.01)
            push(
              "possible-overlap",
              x.id,
              "可能与 " + y.name + " 重叠（保守世界AABB）",
              { other: y.id },
            );
        }
      }
    let sweeps = 0;
    route: for (const o of a.objects.filter((o) => o.motion?.active)) {
      const keys = o.motion.keys || [];
      if (
        keys.length < 2 ||
        keys.length > 256 ||
        keys.some(
          (k, index) =>
            !Number.isFinite(k.t) ||
            k.t < 0 ||
            k.t > 1 ||
            (index > 0 && k.t <= keys[index - 1].t) ||
            !Array.isArray(k.p) ||
            k.p.length !== 3 ||
            !k.p.every(Number.isFinite),
        )
      ) {
        push("route-unchecked", o.id, "路径关键点缺失或超过256点预算");
        continue;
      }
      for (let i = 1; i < keys.length; i++)
        for (const other of statics) {
          if (other.id === o.id) continue;
          if (++sweeps > MAX_CHECKS) {
            complete = false;
            break route;
          }
          const b = getBox(other.id);
          if (!b || b.isEmpty()) continue;
          if (
            segmentHitsBox(keys[i - 1].p, keys[i].p, {
              min: b.min.toArray(),
              max: b.max.toArray(),
            })
          ) {
            push(
              "route-risk",
              o.id,
              "关键点折线可能穿入 " + other.name + "（非完整曲线或导航判定）",
              { other: other.id },
            );
            break;
          }
        }
    }
    if (!complete)
      push(
        "budget",
        null,
        "达到20000对/扫掠预算，报告不完整，请拆分或聚焦检查",
      );
    this.report = {
      version: 1,
      revision: this.revision,
      stale: false,
      createdAt: new Date().toISOString(),
      objects: objects.length,
      staticObjects: statics.length,
      excludedFromStaticOverlap: objects.length - statics.length,
      coverage:
        "visible static library AABBs; active keypoint polylines; persisted AI constraints and attachments; not full scene/mesh validation",
      bindings: plan.bindings,
      comparisons,
      sweeps,
      complete,
      issues,
      issuesCapped: issues.length === 200,
    };
    this.app.bus.emit("layout-diagnostics");
    return this.report;
  }
}

// Compute the new world AABB from unchanged shared geometry and relative mesh matrices.
// Object3D.clone would JSON-copy userData.so (a circular App reference), so never clone it.
export function predictedAttachmentBox(
  root,
  next,
  budget = { count: 0, vertices: 0, boxes: new Map() },
) {
  root.updateWorldMatrix(true, true);
  const target = new THREE.Matrix4().compose(
    new THREE.Vector3(...next.pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...next.rot)),
    new THREE.Vector3(...next.scale),
  );
  if (root.parent) target.premultiply(root.parent.matrixWorld);
  const delta = target.multiply(root.matrixWorld.clone().invert()),
    result = new THREE.Box3();
  root.traverse((n) => {
    const geometry = n.geometry;
    if (!n.isMesh || !geometry?.attributes?.position) return;
    if (!budget.boxes.has(geometry)) {
      if (
        !geometry.boundingBox &&
        (budget.vertices += geometry.attributes.position.count) > 3000000
      )
        throw Error("同步包围盒计算超过300万顶点预算");
      budget.boxes.set(
        geometry,
        geometry.boundingBox?.clone() ||
          new THREE.Box3().setFromBufferAttribute(geometry.attributes.position),
      );
    }
    const local = budget.boxes.get(geometry).clone();
    const matrix = new THREE.Matrix4().multiplyMatrices(delta, n.matrixWorld);
    if (n.isInstancedMesh) {
      for (let i = 0; i < n.count; i++) {
        if (++budget.count > 25000)
          throw Error("同步几何检查超过25000个网格/实例预算");
        const instance = new THREE.Matrix4();
        n.getMatrixAt(i, instance);
        result.union(
          local
            .clone()
            .applyMatrix4(
              new THREE.Matrix4().multiplyMatrices(matrix, instance),
            ),
        );
      }
    } else {
      if (++budget.count > 25000)
        throw Error("同步几何检查超过25000个网格/实例预算");
      result.union(local.applyMatrix4(matrix));
    }
  });
  return result;
}
