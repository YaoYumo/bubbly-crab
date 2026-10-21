import * as THREE from "three";
import { nearestRiver } from "./terrain-river.js";
import { Mover } from "./mover.js";
import { makeRng } from "./util.js";
import { validMotionSchedule, motionProgress } from "./motion-schedule.js";
import { segmentHitsBox } from "./spatial-relations.js";
export function scheduleSceneMotion(scene, options) {
  const rng = makeRng(options.seed);
  for (const o of scene.objs) {
    const m = o[5].m;
    if (!m?.active) continue;
    o[5].routeRole = o[0].includes(":skycar:")
      ? "flight"
      : o[0].startsWith("char:")
        ? scene.river
          ? o[5].name.startsWith("过桥")
            ? "bridge"
            : "bank"
          : "sidewalk"
        : "drift";
    const rate = o[0].startsWith("char:")
      ? options.walkRate
      : o[0].includes(":skycar:")
        ? options.trafficRate
        : 1;
    const phase = options.stagger ? Math.floor(rng() * 1000) / 1000 : 0;
    if (rate !== 1 || phase !== 0) m.schedule = { rate, phase };
  }
}
export function inspectSceneDynamics(scene) {
  const obstacles = scene.objs
    .filter((o) => o[0].startsWith("building:tower:"))
    .map((o) => ({
      min: [o[1] - o[4].width / 2 - 0.25, 0, o[2] - o[4].depth / 2 - 0.25],
      max: [
        o[1] + o[4].width / 2 + 0.25,
        o[4].floors * 3.1 + 7,
        o[2] + o[4].depth / 2 + 0.25,
      ],
    }));
  const routes = [],
    warnings = [];
  let samples = 0,
    sweeps = 0,
    corridorSamples = 0;
  const bridge = scene.objs.find((o) => o[0].includes(":archbridge:")),
    ground = scene.objs.find((o) => o[0].includes(":districtground:"));
  for (let index = 0; index < scene.objs.length; index++) {
    const o = scene.objs[index],
      m = o[5].m;
    if (!m?.active) continue;
    if (!Array.isArray(m.keys) || m.keys.length < 2 || m.keys.length > 2000)
      throw Error("动态关键点预算无效");
    if (
      o[5].routeRole != null &&
      !["flight", "bridge", "bank", "sidewalk", "drift"].includes(
        o[5].routeRole,
      )
    )
      throw Error("未知动态约束角色");
    let prev = -1;
    for (const k of m.keys) {
      if (
        !Number.isFinite(k.t) ||
        k.t < 0 ||
        k.t > 1 ||
        k.t <= prev ||
        !Array.isArray(k.p) ||
        k.p.length !== 3 ||
        !k.p.every(Number.isFinite)
      )
        throw Error("动态路线无效");
      prev = k.t;
    }
    if (m.schedule && !validMotionSchedule(m.schedule))
      throw Error("动态时序无效");
    if (
      m.schedule &&
      Math.hypot(...m.keys[0].p.map((v, j) => v - m.keys.at(-1).p[j])) > 0.001
    )
      throw Error("时序循环要求闭合路线");
    if (m.schedule && m.schedule.rate % 1 !== 0)
      warnings.push({
        code: "timeline-seam",
        subject: `node-${index}`,
        message: "非整数倍率在整段时间轴循环处可能跳回；路线自身循环连续",
      });
    const mover = new Mover(m.keys, false, { arc: false, ease: "linear" }),
      points = [];
    // Inspect the entire geometric path, not only the portion used by the schedule.
    for (let i = 0; i <= 240; i++) {
      const out = mover.sample(
        i / 240,
        { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null },
        "linear",
        { arc: false },
      );
      if (!out?.p.toArray().every(Number.isFinite)) throw Error("动态路线无效");
      points.push(out.p.toArray());
      samples++;
    }
    for (const p of points) {
      const role = o[5].routeRole;
      if (role === "bank") {
        const d = nearestRiver(scene.river.points, p[0], p[2]).distance,
          half = scene.river.width / 2;
        if (d < half + 2.5 || d > half + 7)
          throw Error("沿河行人偏离岸上步行带");
        corridorSamples++;
      } else if (role === "bridge") {
        if (!bridge) throw Error("桥上路线缺少桥体");
        const half = bridge[4].span / 2,
          x = p[0] - bridge[1],
          z = p[2] - bridge[2],
          rise = bridge[4].rise,
          R = (half * half + rise * rise) / (2 * rise);
        const y =
          (bridge[5].y || 0) +
          0.55 +
          rise -
          R +
          Math.sqrt(Math.max(0, R * R - x * x)) +
          0.15;
        if (
          Math.abs(x) > half + 0.15 ||
          Math.abs(z) > bridge[4].w / 2 - 0.4 ||
          Math.abs(p[1] - y) > 0.3
        )
          throw Error("桥上行人偏离拱面步行带");
        corridorSamples++;
      } else if (role === "sidewalk") {
        const half = ground[4].roadW / 2;
        if (
          Math.abs(p[0]) < half + 0.3 ||
          Math.abs(p[0]) > half + ground[4].walkW - 0.3
        )
          throw Error("行人偏离街侧步行带");
        corridorSamples++;
      }
    }
    const flightRadius =
      Math.hypot(
        (1.525 * (o[4].width ?? 2.7)) / 2.7,
        (o[4].length ?? 5.1) / 2,
      ) + 0.05;
    if (o[0].includes(":skycar:"))
      for (let i = 1; i < points.length; i++)
        for (const box of obstacles) {
          sweeps++;
          // Radius bounds all autoFace orientations; intentionally conservative.
          if (
            segmentHitsBox(points[i - 1], points[i], box, [
              flightRadius,
              1.6,
              flightRadius,
            ])
          )
            throw Error("航道侵入塔楼净空（扫掠体积）");
        }
    routes.push({
      id: `node-${index}`,
      key: o[0],
      m,
      mover,
      radius: Math.hypot(flightRadius, 1.6),
    });
  }
  // Time-synchronous vehicle proximity is advisory, never claimed as traffic AI.
  const cars = routes.filter((r) => r.key.includes(":skycar:")),
    near = new Set();
  for (let i = 0; i <= 240; i++) {
    const pos = cars.map(
      (r) =>
        r.mover.sample(
          motionProgress(r.m, i / 240),
          { p: new THREE.Vector3(), q: new THREE.Quaternion(), f: null },
          "linear",
          { arc: false },
        ).p,
    );
    for (let a = 0; a < cars.length; a++)
      for (let b = a + 1; b < cars.length; b++)
        if (pos[a].distanceTo(pos[b]) < cars[a].radius + cars[b].radius)
          near.add(`${cars[a].id}/${cars[b].id}`);
  }
  for (const pair of near)
    warnings.push({
      code: "vehicle-proximity",
      subject: pair,
      message:
        "同步采样中飞车保守包围球接近；可减少车辆或调整错峰，非精确碰撞判定",
    });
  return {
    version: 1,
    routes: routes.length,
    samples,
    sweeps,
    corridorSamples,
    vehiclePairs: (cars.length * (cars.length - 1)) / 2,
    warnings,
    method:
      "241 path samples plus swept chords against tower AABBs; synchronous vehicle spheres advisory, no pedestrian navigation",
  };
}
