import { makeRng } from "./util.js";
import { buildShowcaseScenes } from "./showcase-scenes.js";
import { validateAsset } from "./ai-scene-catalog.js";
import { cleanRiver } from "./terrain-river.js";
import { inspectSceneDynamics, scheduleSceneMotion } from "./scene-dynamics.js";
import { inspectSceneRelations } from "./scene-relations.js";
import { RECIPE_LABELS } from "./scene-intent.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function normalizeSceneRecipe(intent, overrides = {}) {
  if (!RECIPE_LABELS[intent?.kind]) throw Error("未知高质量场景配方");
  const v = { ...intent.values, ...overrides },
    warnings = [],
    city = intent.kind === "cyber-rain";
  const num = (key, def, lo, hi, integer = false) => {
    const raw = v[key];
    if (raw != null && (typeof raw !== "number" || !Number.isFinite(raw)))
      throw Error(key + " 必须为有限数字");
    const x = raw ?? def,
      n = clamp(integer ? Math.round(x) : x, lo, hi);
    if (n !== x) warnings.push(`${key} 已限制为 ${n}（本地资产/预算范围）`);
    return n;
  };
  if (v.layoutRequest)
    warnings.push(
      `本配方保留${city ? "街谷与横街" : "沿河双岸与桥头中轴"}骨架，不应用「${v.layoutRequest}」路网；需要该路网请用普通造镇`,
    );
  const seed = num("seed", 82, 1, 999999999, true),
    rng = makeRng(seed);
  const size = num("size", 320, 256, 384, true),
    density = num("density", 0.65, 0.2, 1);
  const lanterns = num("lanterns", 108, 0, 180, true);
  const options = {
    seed,
    size,
    density,
    floors: num("floors", 34, 12, 40, true),
    cars: num("cars", 9, 0, 12, true),
    people: num("people", city ? 20 : 28, 0, 48, true),
    riverWidth: num("riverWidth", 20, 12, 20),
    lanterns: lanterns > 0 && lanterns < 12 ? 12 : lanterns,
    weather: ["rain", "storm", "snow", "none"].includes(v.weather)
      ? v.weather
      : city
        ? "rain"
        : "none",
    lighting: ["night", "noon", "golden", "blue"].includes(v.lighting)
      ? v.lighting
      : "night",
    fog: num("fog", city ? 0.017 : 0.0024, 0, 0.04),
    opening: ["street", "overview", "river"].includes(v.opening)
      ? v.opening
      : city
        ? "street"
        : "river",
    walkRate: num("walkRate", 1, 0.5, 2),
    trafficRate: num("trafficRate", 1, 0.5, 2),
    stagger: v.stagger === true,
    palette: v.palette === "violet" ? "violet" : "cyan",
  };
  if (options.lanterns !== lanterns)
    warnings.push("孔明灯最少 12 盏（3 个灯群各至少 4 盏）；可设为 0 关闭");
  const rows =
    size < 290
      ? density > 0.75
        ? 7
        : 5
      : density < 0.4
        ? 5
        : density > 0.75 || size > 350
          ? 9
          : 7;
  const factory = {
    seed,
    rows,
    spacing: 26 + rng() * 6,
    streetHalf: 12 + rng() * 2,
    towerWidth: 20 + rng() * 4,
    floors: options.floors,
    cars: options.cars,
    people: options.people,
    lengthFactor: size / 320,
    terrainSize: size,
    bays: density < 0.4 ? 6 : density > 0.75 ? 12 : 10,
    riverWidth: options.riverWidth,
    bend: v.bend === 0 ? 0 : (5 + rng() * 6) * (rng() < 0.5 ? -1 : 1),
    townPeople: Math.max(0, options.people - Math.min(4, options.people)),
    bridgePeople: Math.min(4, options.people),
    lanterns: options.lanterns,
  };
  return { version: 1, kind: intent.kind, options, factory, warnings };
}
export function compileSceneRecipe(intent, overrides = {}) {
  const plan = normalizeSceneRecipe(intent, overrides),
    { options: o } = plan;
  const scene = buildShowcaseScenes(plan.factory).find(
    (s) => s.id === plan.kind,
  );
  scene.name = `${RECIPE_LABELS[plan.kind]} · 种子 ${o.seed}`;
  scene.atmos = o.lighting;
  scene.weather =
    o.weather === "none"
      ? null
      : {
          type: o.weather,
          style: o.weather === "rain" ? "streaks" : "points",
          seed: o.seed,
        };
  scene.light =
    o.lighting === "night"
      ? { ...scene.light, fogDens: o.fog }
      : { fogDens: o.fog };
  scene.bloom.strength = o.lighting === "night" ? 0.42 : 0.2;
  for (const obj of scene.objs) {
    if (obj[5].windows) {
      obj[5].windows.seed = o.seed;
      obj[5].windows.mode = o.lighting === "night" ? "on" : "auto";
    }
    if (obj[0].includes(":neonsign:"))
      obj[4].color = o.palette === "violet" ? "#b45eff" : obj[4].color;
  }
  if (o.opening === "overview")
    scene.view = {
      pos: [...scene.shots[2].from],
      target: [...scene.shots[2].to],
      fov: 58,
    };
  else if (plan.kind === "lantern-river" && o.opening === "street")
    scene.view = {
      pos: [...scene.shots[1].from],
      target: [...scene.shots[1].to],
      fov: 63,
    };
  // The first saved shot must use the same opening, not a different camera hidden behind it.
  scene.shots[0].from = [...scene.view.pos];
  scene.shots[0].to = [...scene.view.target];
  if (o.opening === "overview") {
    delete scene.shots[0].mv;
    delete scene.shots[0].p;
  }
  scheduleSceneMotion(scene, o);
  scene.relations = inspectSceneRelations(scene).graph;
  const checks = validateRecipeScene(scene);
  return {
    ...plan,
    scene,
    checks,
    summary: {
      models: scene.objs.length,
      roads: scene.roads?.length || 0,
      shots: scene.shots.length,
      moving: scene.objs.filter((o) => o[5].m?.active).length,
      kits: scene.objs.filter((o) => o[5].assembly?.role === "host").length,
    },
  };
}
export function validateRecipeScene(scene) {
  if (scene.objs.length > 240) throw Error("场景超过 240 模型预算");

  const towers = [];
  for (const [key, x, z, yaw, params, extra] of scene.objs) {
    const { light, ...geometry } = params;
    validateAsset(key, geometry);
    if (![x, z, yaw, extra.y ?? 0].every(Number.isFinite))
      throw Error("资产坐标无效");
    if (
      light &&
      !(
        light.range > 0 &&
        light.range <= 60 &&
        light.lumens >= 0 &&
        light.lumens <= 10000
      )
    )
      throw Error("灯具参数超出预算");
    if (key.startsWith("building:tower:"))
      towers.push({
        x,
        z,
        w: params.width / 2 + 0.25,
        d: params.depth / 2 + 0.25,
        h: params.floors * 3.1 + 7,
      });
  }
  const dynamics = inspectSceneDynamics(scene);
  const relations = inspectSceneRelations(scene).report;
  if (!relations.ok)
    throw Error(
      "空间关系检查失败：" +
        relations.issues
          .map(
            (i) =>
              (i.code === "reserved-space"
                ? "建筑侵入佛塔保留场地"
                : "组合件偏离挂接点") +
              "/" +
              i.subject,
          )
          .join("、"),
    );
  for (const b of towers) {
    const p = scene.view.pos;
    if (
      Math.abs(p[0] - b.x) < b.w + 0.5 &&
      Math.abs(p[2] - b.z) < b.d + 0.5 &&
      p[1] < b.h
    )
      throw Error("开场相机位于塔楼内");
  }
  if (scene.river) {
    cleanRiver(scene.river, scene.terrain.size);
    const bridge = scene.objs.find((o) => o[0].includes(":archbridge:"));
    const gate = scene.objs.find((o) => o[0].includes(":paifang:"));
    if (!bridge || bridge[4].span < scene.river.width + 8)
      throw Error("桥未跨越河岸");
    const half = bridge[4].span / 2;
    for (const r of scene.roads.filter((r) => r.id.includes("axis")))
      if (r.points.some((p) => Math.abs(p[0]) < half || p[2] !== 0))
        throw Error("中轴道路盖住河道/拱桥");
    if (!gate || Math.abs(gate[3] - Math.PI / 2) > 1e-6 || gate[2] !== 0)
      throw Error("牌楼未横跨中轴");
  }
  return {
    reservedLandmarks: !!scene.river,
    assetParameters: true,
    flightClearance: true,
    openingOutsideTowers: true,
    riverBridgeAxis: !!scene.river,
    routeSamples: dynamics.samples,
    dynamics,
    relations,
    method:
      "data-only anchor/keep-out relations and swept sampled tower AABBs; not general mesh collision or cinematic scoring",
  };
}
// A small plan preview, not a misleading photoreal/3D candidate. Only finite,
// compiler-owned numbers enter SVG; prompt text is never interpolated as markup.
export function recipePlanSVG(plan) {
  const s = plan.scene,
    range = 200,
    xy = (x, z) => `${160 + (x * 140) / range},${130 + (z * 110) / range}`;
  let body = '<rect width="320" height="260" fill="#101d2b"/>';
  if (s.river)
    body += `<polyline points="${s.river.points.map((p) => xy(p[0], p[2])).join(" ")}" fill="none" stroke="#246c8a" stroke-width="${(s.river.width * 140) / range}"/>`;
  for (const road of s.roads || [])
    body += `<polyline points="${road.points.map((p) => xy(p[0], p[2])).join(" ")}" fill="none" stroke="#b79872" stroke-width="${(road.width * 140) / range}"/>`;
  for (const [key, x, z, , p] of s.objs) {
    if (
      !/building:tower:|cn:streetshop:|cn:pagoda:|cn:paifang:|cn:archbridge:/.test(
        key,
      )
    )
      continue;
    const [cx, cy] = xy(x, z).split(",").map(Number);
    body += `<rect x="${cx - 4}" y="${cy - 3}" width="8" height="6" fill="${key.includes("tower") ? "#697f95" : key.includes("archbridge") ? "#f9d99b" : "#db9758"}"/>`;
  }
  const [x, y] = xy(s.view.pos[0], s.view.pos[2]).split(",");
  body += `<circle cx="${x}" cy="${y}" r="4" fill="#81e7e3"/>`;
  return `<svg viewBox="0 0 320 260" role="img" aria-label="布局草图：河流道路建筑与青色开场机位">${body}</svg>`;
}
