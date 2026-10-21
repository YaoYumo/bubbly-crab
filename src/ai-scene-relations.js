// Data-only lowering for AI blueprints. Never touches App or live scene objects.
// This is a one-shot layout, NOT a persisted rig, navigation or general constraint solver.
import {
  cloneData,
  finite,
  inBounds,
  MAX_OPS,
  validateAIRelations,
  vec,
} from "./ai-scene-format.js";
import { localAnchor } from "./spatial-relations.js";
const EPS = 1e-6;
export function lowerAISceneRelations({
  plan,
  operations,
  objects,
  permissions,
  protectedIds = new Set(),
  heightAt = () => 0,
}) {
  if (!plan.relations) return { operations, summaries: [] };
  validateAIRelations(plan.relations);
  const ops = cloneData(operations),
    nodes = new Map(),
    added = new Set(),
    indices = new Map();
  for (const o of objects) nodes.set(o.id, cloneData(o));
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // Validate fields before a relation can overwrite them; do not launder malformed ops.
    if (
      ["add", "transform", "rebuild"].includes(op.op) &&
      op.rotationY !== undefined
    )
      finite(op.rotationY, -32, 32, "原操作朝向");
    if (
      op.op === "add" &&
      op.placement != null &&
      !["ground", "absolute"].includes(op.placement)
    )
      throw Error("原操作placement需ground/absolute");
    if (op.op === "transform" || (op.op === "rebuild" && op.pos != null))
      vec(op.pos, 3, -600, 600, "原操作位置");
    if (op.op === "add") {
      const pos = vec(op.pos, 3, -600, 600, "关系初始位置").slice();
      if (op.placement === "ground") pos[1] += heightAt(pos[0], pos[2]);
      nodes.set(op.id, {
        id: op.id,
        key: op.key,
        pos,
        rot: [0, op.rotationY ?? 0, 0],
        scale: op.scale || [1, 1, 1],
      });
      added.add(op.id);
      indices.set(op.id, i);
    } else if (op.op === "remove") nodes.delete(op.objectId);
    else if (op.op === "transform" || op.op === "rebuild") {
      const o = nodes.get(op.objectId);
      if (!o) throw Error("关系操作引用对象缺失：" + op.objectId);
      if (op.pos) o.pos = cloneData(op.pos);
      if (op.rotationY !== undefined) o.rot[1] = op.rotationY;
      indices.set(o.id, i);
    }
  }
  const node = (id) => {
    const o = nodes.get(id);
    if (!o?.key || o.type === "road_brush")
      throw Error("关系仅支持存在的库资产，引用缺失或不支持：" + id);
    vec(o.pos, 3, -600, 600, "关系位置");
    if (
      o.motion?.active ||
      (plan.previs?.motion && plan.previs.subjectId === id)
    )
      throw Error("关系首版不支持带活动走位的对象：" + id);
    return o;
  };
  const writable = (id) => {
    const o = node(id);
    if (
      o.locked ||
      protectedIds.has(id) ||
      (!added.has(id) &&
        (plan.mode !== "edit" || !permissions.editableIds?.includes(id)))
    )
      throw Error("无权通过空间关系修改对象：" + id);
    if (!added.has(id) && !inBounds(o.pos, plan.bounds))
      throw Error("关系主体不在授权范围内：" + id);
    if (
      o.followTerrain ||
      Math.abs(o.rot?.[0] || 0) > EPS ||
      Math.abs(o.rot?.[2] || 0) > EPS
    )
      throw Error("关系主体需静态、仅Y轴旋转且未启用地形跟随：" + id);
    return o;
  };
  const offsets = new Map(),
    faces = new Map();
  for (const r of plan.relations.rules) {
    node(r.subject);
    node(r.reference ?? r.target ?? r.obstacle);
    if (r.type === "offset" || r.type === "face") {
      writable(r.subject);
      const map = r.type === "offset" ? offsets : faces;
      if (map.has(r.subject))
        throw Error("同一对象同类空间写入冲突：" + r.subject);
      map.set(r.subject, r);
    }
  }
  // Component dependencies avoid false cycles for reciprocal facing or facing an anchored child.
  const done = new Set(),
    active = new Set();
  const solve = (id, component) => {
    const key = id + ":" + component,
      o = node(id);
    if (done.has(key)) return;
    if (active.has(key)) throw Error("AI空间关系依赖成环");
    active.add(key);
    if (component === "pos" && offsets.has(id)) {
      const r = offsets.get(id),
        ref = node(r.reference);
      solve(ref.id, "pos");
      if (r.frame === "local") {
        if (
          Math.abs(ref.rot?.[0] || 0) > EPS ||
          Math.abs(ref.rot?.[2] || 0) > EPS
        )
          throw Error("local关系参考物需仅Y轴旋转");
        solve(ref.id, "yaw");
        o.pos = localAnchor(ref.pos, ref.rot[1], r.delta);
      } else o.pos = ref.pos.map((v, i) => v + r.delta[i]);
      vec(o.pos, 3, -600, 600, "关系求解位置");
    }
    if (component === "yaw" && faces.has(id)) {
      const r = faces.get(id),
        target = node(r.target);
      solve(id, "pos");
      solve(target.id, "pos");
      const dx = target.pos[0] - o.pos[0],
        dz = target.pos[2] - o.pos[2];
      if (Math.hypot(dx, dz) < EPS) throw Error("朝向目标与主体平面位置重合");
      o.rot[1] = Math.atan2(dx, dz);
    }
    finite(o.rot[1], -32, 32, "关系朝向");
    active.delete(key);
    done.add(key);
  };
  for (const id of new Set([...offsets.keys(), ...faces.keys()])) {
    solve(id, "pos");
    solve(id, "yaw");
  }
  for (const id of new Set([...offsets.keys(), ...faces.keys()])) {
    const o = node(id);
    if (!inBounds(o.pos, plan.bounds))
      throw Error("关系求解位置超出授权范围：" + id);
    const index = indices.get(id);
    if (index !== undefined) {
      ops[index].pos = cloneData(o.pos);
      ops[index].rotationY = o.rot[1];
      if (ops[index].op === "add") ops[index].placement = "absolute";
    } else
      ops.push({
        op: "transform",
        objectId: id,
        pos: cloneData(o.pos),
        rotationY: o.rot[1],
      });
  }
  if (ops.length > MAX_OPS) throw Error("关系展开后超过180个操作预算");
  for (const r of plan.relations.rules)
    if (r.type === "distance") {
      const a = node(r.subject),
        b = node(r.target),
        distance = Math.hypot(...a.pos.map((v, i) => v - b.pos[i]));
      if (distance < r.min - EPS || distance > r.max + EPS)
        throw Error("距离约束未满足：" + r.subject + " → " + r.target);
    }
  return {
    operations: ops,
    summaries: plan.relations.rules.map((r) => cloneData(r)),
  };
}

// Final world-space AABBs, after all offsets, facing and fit scaling. No auto-relocation.
export function checkAIRelationClearance(relations, boxFor) {
  for (const r of relations?.rules || [])
    if (r.type === "keep-out") {
      const a = boxFor(r.subject),
        b = boxFor(r.obstacle);
      if (!a || !b || a.isEmpty() || b.isEmpty())
        throw Error("留空约束缺少有效几何包围盒");
      if (
        a.min.x < b.max.x + r.margin - EPS &&
        a.max.x > b.min.x - r.margin + EPS &&
        a.min.z < b.max.z + r.margin - EPS &&
        a.max.z > b.min.z - r.margin + EPS
      )
        throw Error(
          "留空约束未满足（平面保守AABB）：" + r.subject + " → " + r.obstacle,
        );
    }
}
