// Data-only contract shared by manual plans, local recipes and API plans.
export const AI_SCENE_SCHEMA = "previz-ai-scene/1";
export const MAX_PLAN_BYTES = 512 * 1024,
  MAX_OPS = 180;
export const cloneData = (v) => JSON.parse(JSON.stringify(v));
export function record(v, name = "对象") {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error(name + "必须是对象");
  return v;
}
export function exact(v, allowed, name) {
  record(v, name);
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw Error(`${name}未知字段：${k}`);
}
export function finite(n, lo, hi, name) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < lo || n > hi)
    throw Error(`${name}需为 ${lo}–${hi} 的有限数字`);
  return n;
}
export function ident(v) {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v))
    throw Error("ID 只能含字母、数字、下划线、短横线（1–100字符）");
  return v;
}
export function vec(v, count, lo, hi, name) {
  if (!Array.isArray(v) || v.length !== count) throw Error(name + "维度错误");
  return v.map((n) => finite(n, lo, hi, name));
}
export function safeData(v) {
  if (typeof v === "number" && !Number.isFinite(v))
    throw Error("不允许非有限数字");
  if (Array.isArray(v)) {
    for (const n of v) safeData(n);
  } else if (v && typeof v === "object")
    for (const [k, n] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(k))
        throw Error("不允许原型字段");
      safeData(n);
    }
}
export function parseAIPlan(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_PLAN_BYTES
  )
    throw Error("蓝图最多512KiB");
  const plan = JSON.parse(text);
  safeData(plan);
  return record(plan, "蓝图");
}
export function validateEnvelope(p) {
  safeData(p);
  if (new TextEncoder().encode(JSON.stringify(p)).length > MAX_PLAN_BYTES)
    throw Error("蓝图最多512KiB");
  exact(
    p,
    [
      "schema",
      "id",
      "baseFingerprint",
      "name",
      "mode",
      "bounds",
      "seed",
      "terrain",
      "durationSeconds",
      "operations",
      "recipe",
      "previs",
      "relations",
    ],
    "蓝图",
  );
  if (p.schema !== AI_SCENE_SCHEMA)
    throw Error("蓝图协议需要 " + AI_SCENE_SCHEMA);
  ident(p.id);
  if (!/^[a-f0-9]{64}$/.test(p.baseFingerprint || ""))
    throw Error("缺少有效工程指纹，请先导出当前工作包");
  if (!["add", "edit", "replace"].includes(p.mode))
    throw Error("mode需要 add/edit/replace");
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 120)
    throw Error("场景名称需1–120字符");
  exact(p.bounds, ["center", "size"], "范围");
  vec(p.bounds.center, 2, -500, 500, "范围中心");
  vec(p.bounds.size, 2, 10, 600, "范围尺寸");
  for (let i = 0; i < 2; i++)
    if (Math.abs(p.bounds.center[i]) + p.bounds.size[i] / 2 > 600)
      throw Error("范围超出世界±600m");
  if (!Number.isInteger(p.seed)) throw Error("种子需要整数");
  finite(p.seed, 1, 2147483647, "种子");
  if (!["preserve", "flat"].includes(p.terrain))
    throw Error("terrain需要preserve/flat");
  if (p.terrain === "flat" && p.mode !== "replace")
    throw Error("只有明确替换全场景才可关闭地形");
  finite(p.durationSeconds, 0.2, 30, "时间轴秒数");
  if (Boolean(p.recipe) === Boolean(p.operations))
    throw Error("recipe与operations需要且只能选择一个");
  if (
    p.operations &&
    (!Array.isArray(p.operations) ||
      p.operations.length > MAX_OPS ||
      !p.operations.length)
  )
    throw Error("操作数需1–180");
  if (p.recipe) {
    exact(
      p.recipe,
      ["kind", "template", "theme", "topology", "density", "vegetation"],
      "配方",
    );
    if (!["template", "town"].includes(p.recipe.kind))
      throw Error("不支持的配方");
    exact(
      p.recipe,
      p.recipe.kind === "template"
        ? ["kind", "template"]
        : ["kind", "theme", "topology", "density", "vegetation"],
      "配方类型",
    );
  }
  if (p.relations !== undefined) validateAIRelations(p.relations);
  if (p.relations && p.recipe)
    throw Error("空间关系首版仅配合显式operations，不与配方混用");
  if (p.previs) {
    exact(p.previs, ["subjectId", "camera", "motion"], "预演");
    ident(p.previs.subjectId);
    if (
      !["none", "overview", "orbit", "follow", "push", "all"].includes(
        p.previs.camera,
      )
    )
      throw Error("不支持的候选机位");
    if (p.previs.motion) {
      exact(p.previs.motion, ["anim", "points"], "走位");
      if (
        ![
          "idle",
          "walk",
          "run",
          "wave",
          "point",
          "talk",
          "look",
          "phone",
          "sit",
        ].includes(p.previs.motion.anim)
      )
        throw Error("不支持的基础动作");
      const points = p.previs.motion.points;
      if (!Array.isArray(points) || points.length < 2 || points.length > 32)
        throw Error("走位需要2–32个时间点");
      let prev = -1;
      for (const a of points) {
        vec(a, 4, -600, 600, "走位点");
        finite(a[0], 0, p.durationSeconds, "走位秒数");
        if (a[0] <= prev) throw Error("走位时间必须严格递增");
        prev = a[0];
      }
      if (points[0][0] !== 0 || points.at(-1)[0] !== p.durationSeconds)
        throw Error("走位必须覆盖0到时间轴末尾");
    }
  }
  return p;
}
export function inBounds(p, bounds) {
  return (
    Math.abs(p[0] - bounds.center[0]) <= bounds.size[0] / 2 + 1e-6 &&
    Math.abs(p[2] - bounds.center[1]) <= bounds.size[1] / 2 + 1e-6
  );
}
export function allowedParams(params, descriptors, animations = []) {
  record(params, "资产参数");
  const defs = new Map(descriptors.map((d) => [d.k, d]));
  for (const [k, value] of Object.entries(params)) {
    const d = defs.get(k);
    if (!d) throw Error("未知资产参数：" + k);
    if (d.t === "range" || d.t === "int") {
      finite(value, d.min, d.max, k);
      if (d.t === "int" && !Number.isInteger(value))
        throw Error(k + "需要整数");
    } else if (d.t === "bool") {
      if (typeof value !== "boolean") throw Error(k + "需要布尔值");
    } else if (d.t === "color") {
      const palette = typeof d.def === "string" && d.def.includes(",");
      const colors = typeof value === "string" ? value.split(",") : [];
      if (
        typeof value !== "string" ||
        (!(value === "" && d.def === "") &&
          (!colors.length ||
            colors.length > (palette ? 8 : 1) ||
            colors.some((c) => !/^#[a-f0-9]{6}$/i.test(c.trim()))))
      )
        throw Error(
          k + (palette ? "需要1–8个逗号分隔的#RRGGBB" : "需要#RRGGBB"),
        );
    } else if (d.t === "text") {
      if (
        typeof value !== "string" ||
        value.length > 120 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
      )
        throw Error(k + "需要最多120字符的文本");
    } else if (d.t === "sel" || d.t === "select") {
      const options =
        k === "anim"
          ? animations
          : (d.opts || []).map((v) =>
              typeof v === "string" ? v : (v.v ?? v.value),
            );
      if (!options.includes(value)) throw Error(k + "不是允许选项");
    } else throw Error("不支持的资产参数类型：" + d.t);
  }
  return params;
}

// AI-facing bounded relationship vocabulary; all references are stable IDs.
export function validateAIRelations(relations) {
  safeData(relations);
  exact(relations, ["version", "rules"], "AI空间关系");
  if (
    relations.version !== 1 ||
    !Array.isArray(relations.rules) ||
    relations.rules.length < 1 ||
    relations.rules.length > 128
  )
    throw Error("AI空间关系需version:1和1–128条规则");
  const fields = {
    offset: ["type", "subject", "reference", "delta", "frame"],
    face: ["type", "subject", "target"],
    distance: ["type", "subject", "target", "min", "max"],
    "keep-out": ["type", "subject", "obstacle", "margin"],
  };
  for (const r of relations.rules) {
    if (!Object.hasOwn(fields, r?.type)) throw Error("不支持的AI空间关系");
    exact(r, fields[r.type], "AI空间规则");
    ident(r.subject);
    ident(r.reference ?? r.target ?? r.obstacle);
    if (r.subject === (r.reference ?? r.target ?? r.obstacle))
      throw Error("空间关系不能引用自身");
    if (r.type === "offset") {
      vec(r.delta, 3, -500, 500, "关系偏移");
      if (!["world", "local"].includes(r.frame))
        throw Error("关系frame需world/local");
    }
    if (r.type === "distance") {
      finite(r.min, 0, 1200, "最短距离");
      finite(r.max, r.min, 1200, "最长距离");
    }
    if (r.type === "keep-out") finite(r.margin, 0, 50, "留空距离");
  }
  return relations;
}

// Current project diagnostics, not an intent history: newer rules replace the same slot.
export function mergeLayoutRelations(previous, next) {
  if (previous) validateAIRelations(previous);
  validateAIRelations(next);
  const slot = (r) =>
    r.type +
    ":" +
    r.subject +
    (["offset", "face"].includes(r.type) ? "" : ":" + (r.target || r.obstacle));
  const unique = new Map(
    [...(previous?.rules || []), ...next.rules].map((r) => [
      slot(r),
      cloneData(r),
    ]),
  );
  if (unique.size > 128)
    throw Error("工程AI关系记录超过128条，请先清理关系诊断记录或拆分工程");
  return { version: 1, rules: [...unique.values()] };
}
