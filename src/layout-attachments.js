// Bounded, data-only attachment transforms. No DOM, App, Three.js or live mutation.
import { exact, finite, ident, safeData, vec } from "./ai-scene-format.js";
import { localAnchor } from "./spatial-relations.js";
export const ATTACHMENT_LIMIT = 256;
export const angleDelta = (a, b) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
function pose(o) {
  if (
    !o?.key ||
    o.key.startsWith("char:") ||
    ["road_brush", "fx"].includes(o.type) ||
    o.motion?.active
  )
    throw Error("只支持静态库资产，不支持人物、道路、导入模型或活动走位");
  vec(o.pos, 3, -600, 600, "挂接位置");
  vec(o.rot, 3, -32, 32, "挂接旋转");
  vec(o.scale, 3, 0.01, 40, "挂接缩放");
  if (Math.abs(o.rot[0]) > 1e-5 || Math.abs(o.rot[2]) > 1e-5)
    throw Error("挂接首版只支持Y轴旋转");
}
function uniform(o) {
  pose(o);
  if (Math.max(...o.scale) - Math.min(...o.scale) > 1e-5)
    throw Error("宿主需正的等比缩放；非等比缩放不会自动近似");
  return o.scale[0];
}
export function validateAttachment(b) {
  safeData(b);
  exact(
    b,
    [
      "version",
      "hostId",
      "kind",
      "offset",
      "yawOffset",
      "relativeScale",
      "follow",
      "depthBase",
    ],
    "挂接记录",
  );
  if (
    b.version !== 1 ||
    !["local", "cyber-frontage", "river-frontage"].includes(b.kind) ||
    typeof b.follow !== "boolean"
  )
    throw Error("挂接记录版本、类型或开关无效");
  ident(b.hostId);
  vec(b.offset, 3, -600, 600, "挂接局部偏移");
  finite(b.yawOffset, -Math.PI, Math.PI, "挂接朝向差");
  vec(b.relativeScale, 3, 0.00025, 4000, "挂接相对缩放");
  if (b.kind !== "local") finite(b.depthBase, 1, 100, "挂接初始深度");
  return b;
}
export function captureAttachment(child, host, kind = "local") {
  pose(child);
  const s = uniform(host);
  if (child.id === host.id) throw Error("不能挂接到自身");
  const dx = child.pos[0] - host.pos[0],
    dz = child.pos[2] - host.pos[2],
    yaw = host.rot[1];
  const b = {
    version: 1,
    hostId: host.id,
    kind,
    offset: [
      (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / s,
      (child.pos[1] - host.pos[1]) / s,
      (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / s,
    ],
    yawOffset: angleDelta(child.rot[1], yaw),
    relativeScale: child.scale.map((v) => v / s),
    follow: false,
  };
  if (kind === "cyber-frontage") b.depthBase = host.params?.depth;
  if (kind === "river-frontage") b.depthBase = host.params?.d;
  validateAttachment(b);
  expectedAttachment(child, host, b);
  return b;
}
export function expectedAttachment(child, host, b) {
  validateAttachment(b);
  pose(child);
  const s = uniform(host);
  if (child.id === host.id || host.id !== b.hostId) throw Error("挂接引用无效");
  const offset = [...b.offset];
  if (b.kind === "cyber-frontage") {
    if (
      host.key !== "building:shophouse:沿街商铺" ||
      child.key !== "showcase:neonsign:霓虹灯牌"
    )
      throw Error("赛博组合件资产不匹配");
    offset[2] +=
      (finite(host.params?.depth, 1, 100, "宿主depth") - b.depthBase) / 2;
  }
  if (b.kind === "river-frontage") {
    if (
      host.key !== "cn:streetshop:街市铺面" ||
      child.key !== "showcase:shoplights:古城暖窗格栅"
    )
      throw Error("暖窗组合件资产不匹配");
    offset[2] += (finite(host.params?.d, 1, 100, "宿主d") - b.depthBase) / 2;
  }
  const result = {
    ...child,
    pos: localAnchor(
      host.pos,
      host.rot[1],
      offset.map((v) => v * s),
    ),
    rot: [
      0,
      Math.atan2(
        Math.sin(host.rot[1] + b.yawOffset),
        Math.cos(host.rot[1] + b.yawOffset),
      ),
      0,
    ],
    scale: b.relativeScale.map((v) => v * s),
  };
  vec(result.pos, 3, -600, 600, "挂接结果位置");
  vec(result.scale, 3, 0.01, 40, "挂接结果缩放");
  return result;
}
export function attachmentDrift(a, b) {
  return (
    Math.hypot(...a.pos.map((v, i) => v - b.pos[i])) > 0.002 ||
    Math.abs(angleDelta(a.rot[1], b.rot[1])) > 0.001 ||
    Math.max(...a.scale.map((v, i) => Math.abs(v - b.scale[i]))) > 0.001
  );
}
export function planAttachments(
  objects,
  { selectedId = null, autoOnly = false } = {},
) {
  const byId = new Map(),
    bindings = new Map(),
    issues = [],
    expected = new Map(),
    active = new Set(),
    failed = new Set();
  for (const o of objects) {
    if (byId.has(o.id)) throw Error("场景对象ID重复");
    byId.set(o.id, o);
    if (o.params?.sceneAttachment !== undefined)
      bindings.set(o.id, o.params.sceneAttachment);
  }
  if (bindings.size > ATTACHMENT_LIMIT)
    throw Error("挂接超过256个预算，请拆分工程");
  const desired = new Set();
  if (!selectedId) {
    for (const [id, b] of bindings)
      if (!autoOnly || b?.follow === true) desired.add(id);
  } else {
    if (bindings.has(selectedId) && !autoOnly) desired.add(selectedId);
    let change = true;
    while (change) {
      change = false;
      for (const [id, b] of bindings)
        if (
          (b?.hostId === selectedId || desired.has(b?.hostId)) &&
          (!autoOnly || b?.follow === true) &&
          !desired.has(id)
        ) {
          desired.add(id);
          change = true;
        }
    }
  }
  function solve(id) {
    if (expected.has(id)) return expected.get(id);
    if (active.has(id)) throw Error("挂接依赖成环");
    if (failed.has(id)) throw Error("上游挂接未通过");
    const child = byId.get(id),
      b = validateAttachment(bindings.get(id)),
      source = byId.get(b.hostId);
    if (!source) throw Error("宿主已删除或引用缺失：" + b.hostId);
    active.add(id);
    try {
      const host = desired.has(source.id) ? solve(source.id) : source;
      const result = expectedAttachment(child, host, b);
      expected.set(id, result);
      return result;
    } finally {
      active.delete(id);
    }
  }
  for (const id of desired)
    try {
      solve(id);
    } catch (e) {
      failed.add(id);
      issues.push({
        code: "attachment-invalid",
        subject: id,
        message: e.message,
      });
    }
  const patches = [];
  for (const [id, next] of expected) {
    const old = byId.get(id);
    if (attachmentDrift(old, next)) {
      if (old.locked)
        issues.push({
          code: "attachment-locked",
          subject: id,
          message: "部件已锁定，不能同步",
        });
      else if (old.followTerrain)
        issues.push({
          code: "attachment-terrain",
          subject: id,
          message: "部件已启用地形跟随，请先关闭再同步",
        });
      else patches.push({ id, next });
    }
  }
  return {
    patches,
    issues,
    expected,
    bindings: bindings.size,
    selected: desired.size,
  };
}
