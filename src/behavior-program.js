import { exact, finite, vec, safeData, cloneData } from "./ai-scene-format.js";
import { planStaticRoute } from "./behavior-navigation.js";
export const BEHAVIOR_SCHEMA = "previz-behavior/1";
export const MOVE_ANIMS = ["walk", "run"],
  ACT_ANIMS = ["idle", "wave", "point", "talk", "look", "phone"];
const prepared = new WeakSet(),
  runtime = new WeakMap();
const near = (a, b) => Math.abs(a - b) < 1e-7;
const eq = (a, b) => a.every((v, i) => near(v, b[i]));
export function validateBehaviorRequest(r) {
  exact(r, ["steps", "radius", "height", "cellSize", "margin"], "行为请求");
  finite(r.radius, 0.05, 2, "代理半径");
  finite(r.height, 0.5, 5, "代理高度");
  finite(r.cellSize, 0.25, 2, "导航间距");
  finite(r.margin, 2, 30, "绕行范围");
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > 16)
    throw Error("行为需要1–16步");
  let duration = 0;
  for (const s of r.steps) {
    exact(
      s,
      s?.type === "move"
        ? ["type", "target", "seconds", "anim"]
        : ["type", "seconds", "anim", "face"],
      "行为步骤",
    );
    finite(s.seconds, 0.1, 60, "步骤秒数");
    duration += s.seconds;
    if (s.type === "move") {
      vec(s.target, 2, -590, 590, "世界XZ目标");
      if (!MOVE_ANIMS.includes(s.anim)) throw Error("移动只支持walk/run");
    } else if (s.type === "act") {
      if (!ACT_ANIMS.includes(s.anim)) throw Error("停留动作不支持：" + s.anim);
      if (s.face !== undefined) vec(s.face, 2, -590, 590, "世界XZ朝向点");
    } else throw Error("步骤type需要move或act");
  }
  if (duration > 120 + 1e-8) throw Error("行为总时长最多120秒");
  safeData(r);
  return duration;
}
export function compileBehavior({
  request,
  origin,
  yaw = 0,
  scale = [1, 1, 1],
  obstacles = [],
}) {
  const duration = validateBehaviorRequest(request);
  vec(origin, 3, -590, 590, "行为起点");
  finite(yaw, -1000, 1000, "起始朝向");
  vec(scale, 3, 0.01, 40, "人物缩放");
  if (!near(origin[1], 0)) throw Error("首版只支持世界y=0平地上的人物");
  const targets = [
    origin.filter((_, i) => i !== 1),
    ...request.steps.filter((s) => s.type === "move").map((s) => s.target),
  ];
  const bounds = {
    min: [0, 1].map((i) =>
      Math.max(-600, Math.min(...targets.map((p) => p[i])) - request.margin),
    ),
    max: [0, 1].map((i) =>
      Math.min(600, Math.max(...targets.map((p) => p[i])) + request.margin),
    ),
  };
  let pos = origin.slice(),
    time = 0,
    currentYaw = yaw,
    totalPoints = 0;
  const clips = [];
  const budget = { checks: 0 };
  let visited = 0;
  // Validate the stationary start too, including an action-only plan.
  planStaticRoute({
    start: [pos[0], pos[2]],
    goal: [pos[0], pos[2]],
    bounds,
    cellSize: request.cellSize,
    radius: request.radius,
    obstacles,
    budget,
  });
  for (const s of request.steps) {
    const clip = {
      type: s.type,
      anim: s.anim,
      start: time,
      end: time + s.seconds,
      points: [pos.slice()],
      yaw: currentYaw,
    };
    if (s.type === "move") {
      if (Math.hypot(s.target[0] - pos[0], s.target[1] - pos[2]) < 0.01)
        throw Error("移动不足0.01m，请使用停留动作");
      const route = planStaticRoute({
        start: [pos[0], pos[2]],
        goal: s.target,
        bounds,
        cellSize: request.cellSize,
        radius: request.radius,
        obstacles,
        budget,
      });
      visited += route.visited;
      clip.points = route.points.map((p) => [p[0], 0, p[1]]);
      pos = clip.points.at(-1).slice();
      const prev = clip.points.at(-2);
      currentYaw = Math.atan2(pos[0] - prev[0], pos[2] - prev[2]);
    } else if (s.face) {
      const dx = s.face[0] - pos[0],
        dz = s.face[1] - pos[2];
      if (Math.hypot(dx, dz) < 0.01) throw Error("朝向点不能与停留位置重合");
      currentYaw = clip.yaw = Math.atan2(dx, dz);
    }
    totalPoints += clip.points.length;
    if (totalPoints > 256) throw Error("整套行为路径超过256点");
    clips.push(clip);
    time = clip.end;
  }
  const program = readBehaviorProgram({
    schema: BEHAVIOR_SCHEMA,
    origin: origin.slice(),
    yaw,
    scale: scale.slice(),
    duration,
    request: cloneData(request),
    clips,
  });
  return {
    program,
    stats: {
      checks: budget.checks,
      visited,
      points: totalPoints,
      obstacles: obstacles.length,
    },
  };
}
export function readBehaviorProgram(input) {
  if (input && prepared.has(input)) return input;
  if (new TextEncoder().encode(JSON.stringify(input)).length > 128 * 1024)
    throw Error("行为方案超过128KiB");
  exact(
    input,
    ["schema", "origin", "yaw", "scale", "duration", "request", "clips"],
    "行为方案",
  );
  safeData(input);
  if (input.schema !== BEHAVIOR_SCHEMA) throw Error("不支持的行为方案版本");
  vec(input.origin, 3, -590, 590, "方案起点");
  if (!near(input.origin[1], 0)) throw Error("行为只支持y=0平面");
  vec(input.scale, 3, 0.01, 40, "人物缩放");
  if (
    !near(input.scale[0], input.scale[1]) ||
    !near(input.scale[0], input.scale[2])
  )
    throw Error("行为人物需要正均匀缩放");
  finite(input.yaw, -1000, 1000, "方案朝向");
  finite(input.duration, 0.1, 120, "行为时长");
  const duration = validateBehaviorRequest(input.request);
  if (!near(input.duration, duration)) throw Error("行为时长不一致");
  if (
    !Array.isArray(input.clips) ||
    input.clips.length !== input.request.steps.length
  )
    throw Error("行为片段数量不一致");
  let pos = input.origin,
    time = 0,
    count = 0,
    currentYaw = input.yaw;
  for (let i = 0; i < input.clips.length; i++) {
    const c = input.clips[i],
      s = input.request.steps[i];
    exact(c, ["type", "anim", "start", "end", "points", "yaw"], "行为片段");
    finite(c.start, 0, 120, "片段开始");
    finite(c.end, 0, 120, "片段结束");
    finite(c.yaw, -1000, 1000, "片段朝向");
    if (
      c.type !== s.type ||
      c.anim !== s.anim ||
      !near(c.start, time) ||
      !near(c.end - c.start, s.seconds)
    )
      throw Error("片段和步骤不一致");
    if (
      !Array.isArray(c.points) ||
      c.points.length < (c.type === "move" ? 2 : 1) ||
      c.points.length > 256
    )
      throw Error("行为路径点数量错误");
    for (const p of c.points) {
      vec(p, 3, -600, 600, "路径点");
      if (!near(p[1], 0)) throw Error("路径必须在y=0平面");
    }
    if (!eq(c.points[0], pos)) throw Error("行为路径不连续");
    if (c.type === "move") {
      if (
        !eq(c.points.at(-1), [s.target[0], 0, s.target[1]]) ||
        !near(c.yaw, currentYaw)
      )
        throw Error("移动目标或朝向不一致");
      for (let j = 1; j < c.points.length; j++)
        if (
          Math.hypot(
            c.points[j][0] - c.points[j - 1][0],
            c.points[j][2] - c.points[j - 1][2],
          ) < 1e-8
        )
          throw Error("行为路径含重复相邻点");
      const last = c.points.at(-1),
        prev = c.points.at(-2);
      currentYaw = Math.atan2(last[0] - prev[0], last[2] - prev[2]);
    } else {
      if (c.points.length !== 1) throw Error("停留只能含一个位置");
      if (s.face) {
        const dx = s.face[0] - pos[0],
          dz = s.face[1] - pos[2];
        if (Math.hypot(dx, dz) < 0.01) throw Error("朝向点与人物重合");
        currentYaw = Math.atan2(dx, dz);
      }
      if (!near(c.yaw, currentYaw)) throw Error("停留朝向不一致");
    }
    pos = c.points.at(-1);
    time = c.end;
    count += c.points.length;
    if (count > 256) throw Error("整套行为最多256路径点");
  }
  const p = cloneData(input);
  const freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  freeze(p);
  prepared.add(p);
  return p;
}
export function sampleBehavior(input, seconds) {
  const p = readBehaviorProgram(input);
  finite(seconds, -1e9, 1e9, "采样秒数");
  if (!runtime.has(p))
    runtime.set(
      p,
      p.clips.map((c) => {
        const lengths = [0];
        for (let i = 1; i < c.points.length; i++)
          lengths.push(
            lengths.at(-1) +
              Math.hypot(
                c.points[i][0] - c.points[i - 1][0],
                c.points[i][2] - c.points[i - 1][2],
              ),
          );
        return lengths;
      }),
    );
  const t = Math.max(0, Math.min(p.duration, seconds));
  let i = p.clips.findIndex((c) => t < c.end);
  if (i < 0) i = p.clips.length - 1;
  const c = p.clips[i],
    local = t - c.start,
    lengths = runtime.get(p)[i],
    total = lengths.at(-1);
  if (c.type === "act")
    return {
      p: c.points[0].slice(),
      yaw: c.yaw,
      anim: c.anim,
      phase: local * 2,
      index: i,
      held: seconds >= p.duration,
    };
  const distance = Math.min(total, (total * local) / (c.end - c.start));
  let j = 1;
  while (j < lengths.length - 1 && distance >= lengths[j]) j++;
  const a = c.points[j - 1],
    b = c.points[j],
    u = (distance - lengths[j - 1]) / (lengths[j] - lengths[j - 1]);
  return {
    p: a.map((v, k) => v + (b[k] - v) * u),
    yaw: Math.atan2(b[0] - a[0], b[2] - a[2]),
    anim: c.anim,
    phase: (distance / (c.anim === "run" ? 2.6 : 1.9)) * Math.PI * 2,
    index: i,
    held: seconds >= p.duration,
  };
}
export function behaviorKeys(input) {
  const p = readBehaviorProgram(input),
    keys = [];
  for (const c of p.clips) {
    const lengths = [0];
    for (let i = 1; i < c.points.length; i++)
      lengths.push(
        lengths.at(-1) +
          Math.hypot(
            c.points[i][0] - c.points[i - 1][0],
            c.points[i][2] - c.points[i - 1][2],
          ),
      );
    c.points.forEach((point, i) => {
      const t =
        (c.start +
          (lengths.at(-1)
            ? (lengths[i] / lengths.at(-1)) * (c.end - c.start)
            : 0)) /
        p.duration;
      if (!keys.length || !near(keys.at(-1).t, t))
        keys.push({ t, p: point.slice() });
    });
    if (c.type === "act")
      keys.push({ t: c.end / p.duration, p: c.points[0].slice() });
  }
  return keys;
}
