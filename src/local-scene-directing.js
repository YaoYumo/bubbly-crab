import {
  exact,
  ident,
  vec,
  finite,
  cloneData,
  inBounds,
} from "./ai-scene-format.js";
import { ANIMS } from "./character.js";
const animationIds = ANIMS.map((a) => a.v);
export function cleanDirecting(raw) {
  exact(raw, ["motions", "camera", "environment"], "扩展工具");
  const out = { motions: [] };
  if (raw.motions !== undefined) {
    if (!Array.isArray(raw.motions) || raw.motions.length > 12)
      throw Error("单轮最多12个运动对象");
    const used = new Set();
    for (const m of raw.motions) {
      exact(
        m,
        ["objectId", "points", "anim", "autoFace", "loop", "placement"],
        "运动",
      );
      ident(m.objectId);
      if (used.has(m.objectId)) throw Error("同一对象一轮只能设置一次运动");
      used.add(m.objectId);
      if (
        !Array.isArray(m.points) ||
        m.points.length < 2 ||
        m.points.length > 32
      )
        throw Error("运动需要2–32个时间点");
      let last = -1;
      for (const p of m.points) {
        vec(p, 4, -600, 600, "运动点");
        finite(p[0], 0, 30, "运动秒数");
        if (p[0] <= last) throw Error("运动时间必须严格递增");
        last = p[0];
      }
      if (m.anim !== undefined && !animationIds.includes(m.anim))
        throw Error("未知人物动作");
      for (const k of ["autoFace", "loop"])
        if (m[k] !== undefined && typeof m[k] !== "boolean")
          throw Error(k + "需布尔值");
      if (
        m.placement !== undefined &&
        !["ground", "absolute"].includes(m.placement)
      )
        throw Error("运动placement需ground/absolute");
      if (
        m.loop &&
        Math.hypot(
          ...m.points[0].slice(1).map((v, i) => v - m.points.at(-1)[i + 1]),
        ) > 0.001
      )
        throw Error("循环运动必须首尾闭合，避免车辆跳回起点");
      out.motions.push(cloneData(m));
    }
  }
  if (raw.camera) {
    exact(raw.camera, ["objectId", "preset"], "机位");
    ident(raw.camera.objectId);
    if (
      !["overview", "orbit", "follow", "push", "all"].includes(
        raw.camera.preset,
      )
    )
      throw Error("未知机位预设");
    out.camera = cloneData(raw.camera);
  }
  if (raw.environment) {
    const e = raw.environment;
    exact(e, ["lighting", "weather"], "氛围");
    if (
      e.lighting !== undefined &&
      !["noon", "golden", "blue", "overcast", "night", "studio"].includes(
        e.lighting,
      )
    )
      throw Error("未知光影预设");
    if (
      e.weather !== undefined &&
      !["none", "rain", "snow", "sand", "storm"].includes(e.weather)
    )
      throw Error("未知天气预设");
    if (e.lighting === undefined && e.weather === undefined)
      throw Error("氛围工具不能为空");
    out.environment = cloneData(e);
  }
  if (!out.motions.length && !out.camera && !out.environment)
    throw Error("扩展工具不能为空");
  return out;
}
export function applyDirecting({
  raw,
  doc,
  changes,
  permissions,
  protectedIds,
  bounds,
  duration,
  terrainEnabled,
  heightAt,
  warnings,
}) {
  if (permissions.conversational !== true)
    throw Error("扩展工具仅由本地对话授权");
  const data = cleanDirecting(raw);
  for (const m of data.motions) {
    const o = doc.objects.find((o) => o.id === m.objectId);
    if (
      !o?.key ||
      protectedIds.has(o.id) ||
      (!changes.added.includes(o.id) &&
        !permissions.editableIds?.includes(o.id))
    )
      throw Error("无权修改运动对象：" + m.objectId);
    if (m.points[0][0] !== 0 || Math.abs(m.points.at(-1)[0] - duration) > 1e-7)
      throw Error("运动必须覆盖当前时间轴0到" + duration + "秒");
    if (m.anim && !o.key.startsWith("char:"))
      throw Error("骨骼动作只用于人物，车辆仅设置路径");
    const ground = m.placement !== "absolute";
    const keys = m.points.map(([t, x, y, z]) => {
      if (!inBounds([x, y, z], bounds)) throw Error("运动路径超出授权范围");
      return {
        t: t / duration,
        p: [x, y + (ground && terrainEnabled ? heightAt(x, z) : 0), z],
      };
    });
    o.followTerrain = ground;
    o.motion = {
      active: true,
      anim: m.anim ?? (o.key.startsWith("char:") ? "walk" : "idle"),
      autoFace: m.autoFace !== false,
      speed: 1,
      loop: !!m.loop,
      easing: "linear",
      arc: true,
      keys,
    };
    if (!changes.added.includes(o.id)) changes.modified.push(o.id);
  }
  if (data.environment) {
    const e = data.environment;
    if (e.lighting !== undefined)
      doc.light = {
        ...doc.light,
        mode: "legacy",
        preset: e.lighting,
        override: {},
        enabled: true,
      };
    if (e.weather !== undefined)
      doc.weather = {
        ...doc.weather,
        type: e.weather === "none" ? null : e.weather,
      };
  }
  if (
    data.camera &&
    !doc.objects.some((o) => o.id === data.camera.objectId && o.key)
  )
    throw Error("机位主体必须是现有或本轮新增模型");
  changes.directing = {
    motions: data.motions.map((m) => m.objectId),
    camera: !!data.camera,
    environment: data.environment ?? null,
  };
  if (data.motions.length)
    warnings.push(
      "运动按当前时间轴执行，自动朝向按模型前轴修正；尚无车辆导航/避撞或人物脚步接触求解，请预演核查路径。",
    );
  return data.camera;
}
