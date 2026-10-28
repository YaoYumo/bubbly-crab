// Bounded data-only relations, independent of App, Three.js and the two recipes.
// +Z is forward. Solving never mutates input; this is not a general mesh solver.
import { exact, finite, ident, vec, safeData } from "./ai-scene-format.js";
const EPS = 1e-5;
export function localAnchor(position, yaw, offset) {
  const [side, y, forward] = offset;
  return [
    position[0] + Math.cos(yaw) * side + Math.sin(yaw) * forward,
    position[1] + y,
    position[2] - Math.sin(yaw) * side + Math.cos(yaw) * forward,
  ];
}
export function resolveSpatialRelations(input) {
  safeData(input);
  exact(input, ["version", "entities", "rules"], "空间关系");
  if (
    input.version !== 1 ||
    !Array.isArray(input.entities) ||
    input.entities.length > 300 ||
    !Array.isArray(input.rules) ||
    input.rules.length > 1000
  )
    throw Error("空间关系版本或预算无效");
  const nodes = new Map(),
    rules = [],
    writers = new Map(),
    issues = [];
  for (const e of input.entities) {
    exact(e, ["id", "position", "yaw", "half"], "空间实体");
    ident(e.id);
    if (nodes.has(e.id)) throw Error("空间实体ID重复");
    nodes.set(e.id, {
      id: e.id,
      position: vec(e.position, 3, -5000, 5000, "位置"),
      yaw: finite(e.yaw, -Math.PI * 4, Math.PI * 4, "朝向"),
      half: e.half ? vec(e.half, 2, 0, 500, "平面半尺寸") : [0, 0],
    });
  }
  const node = (id) => {
    ident(id);
    if (!nodes.has(id)) throw Error("空间关系引用缺失：" + id);
    return nodes.get(id);
  };
  for (const r of input.rules) {
    if (r?.type === "anchor") {
      exact(r, ["type", "subject", "host", "offset"], "挂接");
      node(r.subject);
      node(r.host);
      vec(r.offset, 3, -500, 500, "挂接偏移");
    } else if (r?.type === "face") {
      exact(r, ["type", "subject", "target"], "朝向");
      node(r.subject);
      vec(r.target, 3, -5000, 5000, "朝向目标");
    } else if (r?.type === "keep-out") {
      exact(r, ["type", "subject", "obstacle", "margin"], "留空");
      node(r.subject);
      node(r.obstacle);
      finite(r.margin, 0, 50, "留空距离");
    } else if (r?.type === "distance") {
      exact(r, ["type", "subject", "target", "min", "max"], "距离");
      node(r.subject);
      node(r.target);
      finite(r.min, 0, 10000, "最短距离");
      finite(r.max, r.min, 10000, "最长距离");
    } else throw Error("不支持的空间关系");
    if (["anchor", "face"].includes(r.type)) {
      if (writers.has(r.subject)) throw Error("同一实体存在冲突的空间写入");
      writers.set(r.subject, r);
    }
    rules.push(r);
  }
  const done = new Set(),
    active = new Set();
  function solve(id) {
    if (done.has(id)) return;
    if (active.has(id)) throw Error("空间挂接关系成环");
    active.add(id);
    const r = writers.get(id),
      e = node(id);
    if (r?.type === "anchor") {
      solve(r.host);
      const h = node(r.host);
      e.position = localAnchor(h.position, h.yaw, r.offset);
      e.yaw = h.yaw;
    } else if (r?.type === "face") {
      const dx = r.target[0] - e.position[0],
        dz = r.target[2] - e.position[2];
      if (Math.hypot(dx, dz) < EPS) throw Error("朝向目标与实体重合");
      e.yaw = Math.atan2(dx, dz);
    }
    if (!e.position.every((v) => Number.isFinite(v) && Math.abs(v) <= 5000))
      throw Error("求解位置超出预算");
    active.delete(id);
    done.add(id);
  }
  for (const id of nodes.keys()) solve(id);
  for (const r of rules) {
    const a = node(r.subject);
    if (r.type === "keep-out") {
      const b = node(r.obstacle),
        extent = (e) => [
          Math.abs(Math.cos(e.yaw)) * e.half[0] +
            Math.abs(Math.sin(e.yaw)) * e.half[1],
          Math.abs(Math.sin(e.yaw)) * e.half[0] +
            Math.abs(Math.cos(e.yaw)) * e.half[1],
        ],
        ah = extent(a),
        bh = extent(b);
      if (
        Math.abs(a.position[0] - b.position[0]) <
          ah[0] + bh[0] + r.margin - EPS &&
        Math.abs(a.position[2] - b.position[2]) < ah[1] + bh[1] + r.margin - EPS
      )
        issues.push({
          code: "reserved-space",
          subject: r.subject,
          obstacle: r.obstacle,
        });
    } else if (r.type === "distance") {
      const b = node(r.target),
        distance = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
      if (distance < r.min - EPS || distance > r.max + EPS)
        issues.push({
          code: "distance",
          subject: r.subject,
          target: r.target,
          distance,
        });
    }
  }
  return {
    version: 1,
    entities: [...nodes.values()],
    rules: rules.length,
    issues,
    ok: issues.length === 0,
  };
}
// Continuous segment vs expanded axis-aligned volume (slab test).
export function segmentHitsBox(a, b, box, padding = [0, 0, 0]) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 3; i++) {
    const min = box.min[i] - padding[i],
      max = box.max[i] + padding[i],
      d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) {
      if (a[i] < min || a[i] > max) return false;
      continue;
    }
    const t0 = (min - a[i]) / d,
      t1 = (max - a[i]) / d;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  return true;
}
