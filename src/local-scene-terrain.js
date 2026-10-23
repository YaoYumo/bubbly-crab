// Private conversational terrain compiler. Works on copies; never invokes live editing tools.
import { exact, finite, vec, cloneData } from "./ai-scene-format.js";
import { generateHeightfield } from "./terrain-generation.js";
import { sampleGrid } from "./terrain-import.js";
import { cleanRiver, carveRiver, riverStrip } from "./terrain-river.js";
import {
  checkRiverPath,
  expandRiverPath,
  riverPathFields,
} from "./local-scene-river.js";
const kinds = [
  "flat",
  "plain",
  "hills",
  "ridge",
  "island",
  "craters",
  "canyon",
  "plateau",
];
const biomes = ["grass", "forest", "desert", "rock", "snow", "alien", "ash"];
export function cleanConversationTerrain(input) {
  exact(
    input,
    ["generate", "edits", "rivers", "water", "biome", "groundObjects"],
    "地形指令",
  );
  if (!Object.keys(input).length) throw Error("地形指令不能为空");
  const p = cloneData(input);
  if (p.generate !== undefined) {
    exact(p.generate, ["kind", "amp", "seed", "size", "height"], "地形生成");
    if (!kinds.includes(p.generate.kind)) throw Error("地形类型无效");
    if (p.generate.kind === "flat" && p.generate.amp !== undefined)
      throw Error("flat地形请用height而非amp");
    if (p.generate.amp !== undefined)
      finite(p.generate.amp, 0.5, 100, "地形起伏");
    if (p.generate.height !== undefined) {
      if (p.generate.kind !== "flat") throw Error("height仅用于flat地形");
      finite(p.generate.height, -100, 100, "平地高度");
    }
    if (p.generate.seed !== undefined) {
      finite(p.generate.seed, 1, 2147483647, "地形种子");
      if (!Number.isInteger(p.generate.seed)) throw Error("地形种子需整数");
    }
    if (p.generate.size !== undefined)
      finite(p.generate.size, 40, 600, "地形边长");
  }
  if (p.biome !== undefined && !biomes.includes(p.biome))
    throw Error("地表群系无效");
  if (p.groundObjects !== undefined && typeof p.groundObjects !== "boolean")
    throw Error("groundObjects需布尔值");
  if (p.water !== undefined) {
    exact(p.water, ["enabled", "level"], "水面");
    if (typeof p.water.enabled !== "boolean") throw Error("水面需明确enabled");
    if (p.water.level !== undefined) finite(p.water.level, -100, 100, "水位");
  }
  if (p.edits !== undefined) {
    if (!Array.isArray(p.edits) || p.edits.length > 8)
      throw Error("单轮地形局部操作最多8项");
    for (const e of p.edits) {
      exact(
        e,
        ["tool", "center", "radius", "amount", "height", "iterations"],
        "局部地形",
      );
      if (!["raise", "lower", "flatten", "smooth"].includes(e.tool))
        throw Error("局部工具无效");
      vec(e.center, 2, -300, 300, "笔刷中心");
      finite(e.radius, 1, 150, "笔刷半径");
      if (["raise", "lower"].includes(e.tool))
        finite(e.amount, 0.1, 50, "局部高度变化");
      else if (e.amount !== undefined) throw Error("该工具不使用amount");
      if (e.tool === "flatten") finite(e.height, -100, 100, "目标高度");
      else if (e.height !== undefined) throw Error("该工具不使用height");
      if (
        e.iterations !== undefined &&
        (e.tool !== "smooth" ||
          !Number.isInteger(e.iterations) ||
          e.iterations < 1 ||
          e.iterations > 4)
      )
        throw Error("平滑次数需1–4");
    }
  }
  if (p.rivers !== undefined) {
    if (!Array.isArray(p.rivers) || p.rivers.length > 4)
      throw Error("单轮河道操作最多4项");
    for (const r of p.rivers) {
      exact(
        r,
        [
          "action",
          "id",
          "name",
          "points",
          "width",
          "depth",
          "bank",
          "water",
          ...riverPathFields,
        ],
        "河道",
      );
      if (!["add", "edit", "remove"].includes(r.action))
        throw Error("河道action无效");
      if (
        r.action !== "add" &&
        (typeof r.id !== "string" || !r.id || r.id.length > 80)
      )
        throw Error("修改河道需要当前河道ID");
      if (
        r.action === "remove" &&
        Object.keys(r).some((k) => !["id", "action"].includes(k))
      )
        throw Error("删除河道只接受id");
      if (
        r.action === "edit" &&
        Object.keys(r).every((k) => ["action", "id"].includes(k))
      )
        throw Error("河道修改不能为空");
      checkRiverPath(r);
      if (
        r.action === "add" &&
        !Array.isArray(r.points) &&
        r.shape === undefined
      )
        throw Error("新增河道需要shape或points");
      if (r.action === "add" && !r.id) throw Error("缺少内部河道ID");
      if (r.points !== undefined) {
        if (
          !Array.isArray(r.points) ||
          r.points.length < 2 ||
          r.points.length > 64
        )
          throw Error("河道需2–64点");
        for (const point of r.points) vec(point, 3, -300, 300, "河道点");
      }
      if (
        r.name !== undefined &&
        (typeof r.name !== "string" || !r.name.trim() || r.name.length > 40)
      )
        throw Error("河道名称需1–40字符");
      for (const [k, lo, hi] of [
        ["width", 1, 60],
        ["depth", 0.1, 30],
        ["bank", 0.5, 60],
      ])
        if (r[k] !== undefined) finite(r[k], lo, hi, "河道" + k);
      if (r.water !== undefined && typeof r.water !== "boolean")
        throw Error("河面开关需布尔值");
    }
  }
  return p;
}
export function terrainSummary(t) {
  let min = Infinity,
    max = -Infinity;
  for (const v of t.h) {
    min = Math.min(min, v * t.exaggerate);
    max = Math.max(max, v * t.exaggerate);
  }
  return {
    enabled: t.enabled,
    size: t.size,
    biome: t.biome,
    generation: t.generation,
    range: [min, max],
    water: { enabled: t.state.water, level: t.state.waterY },
    rivers: (t.workflow.rivers || []).map((r) => ({
      id: r.id,
      name: r.name,
      points: r.points,
      width: r.width,
      depth: r.depth,
      bank: r.bank,
      water: r.water,
    })),
  };
}
function packFloat32(h) {
  let text = "";
  const bytes = new Uint8Array(h.buffer, h.byteOffset, h.byteLength);
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export async function compileConversationTerrain(
  terrain,
  saved,
  input,
  { checkpoint = async () => {}, protect = () => {} } = {},
) {
  const p = cleanConversationTerrain(input),
    doc = cloneData(saved);
  let h = terrain.h.slice(),
    size = terrain.size,
    n = terrain.n;
  const ex = terrain.exaggerate || 1,
    warnings = [],
    actions = [];
  let heightChanged = false,
    overwrite = false;
  if (p.generate) {
    protect(null);
    const g = p.generate;
    size = g.size ?? size;
    overwrite =
      terrain.h.some((v) => Math.abs(v) > 0.005) ||
      !!doc.p64 ||
      !!doc.workflow?.heightSource;
    if (g.kind === "flat") {
      h = new Float32Array(n * n).fill((g.height ?? 0) / ex);
      doc.generation = {
        kind: "plain",
        amp: 0.5,
        seed: g.seed ?? terrain.generation?.seed ?? 12345,
      };
    } else {
      const result = generateHeightfield(n, size, {
        kind: g.kind,
        amp: g.amp ?? 8,
        seed: g.seed ?? terrain.generation?.seed ?? 12345,
      });
      h = result.h.map((v) => v / ex);
      doc.generation = result.settings;
    }
    // Global water is never switched on merely because the preset is island.
    delete doc.p64;
    doc.autoSurface = { ...doc.autoSurface, enabled: true };
    if (doc.workflow) doc.workflow.heightSource = null;
    heightChanged = true;
    actions.push("生成" + g.kind + "地形");
    await checkpoint();
  }
  for (const e of p.edits || []) {
    if (
      Math.abs(e.center[0]) + e.radius > size / 2 ||
      Math.abs(e.center[1]) + e.radius > size / 2
    )
      throw Error("笔刷范围超出地形边界");
    protect({
      minX: e.center[0] - e.radius,
      maxX: e.center[0] + e.radius,
      minZ: e.center[1] - e.radius,
      maxZ: e.center[1] + e.radius,
    });
    for (
      let iteration = 0;
      iteration < (e.tool === "smooth" ? (e.iterations ?? 1) : 1);
      iteration++
    ) {
      const source = h.slice();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1) - 0.5) * size,
            z = (j / (n - 1) - 0.5) * size,
            d = Math.hypot(x - e.center[0], z - e.center[1]) / e.radius;
          if (d >= 1) continue;
          const q = 1 - d * d * (3 - 2 * d),
            at = j * n + i;
          let target = source[at];
          if (e.tool === "raise" || e.tool === "lower")
            target += ((e.tool === "raise" ? 1 : -1) * e.amount * q) / ex;
          else if (e.tool === "flatten") target += (e.height / ex - target) * q;
          else {
            let sum = 0,
              count = 0;
            for (let dz = -1; dz <= 1; dz++)
              for (let dx = -1; dx <= 1; dx++) {
                const row = j + dz,
                  col = i + dx;
                if (row >= 0 && row < n && col >= 0 && col < n) {
                  sum += source[row * n + col];
                  count++;
                }
              }
            target += (sum / count - target) * q;
          }
          h[at] = target;
        }
        if (j % 16 === 0) await checkpoint();
      }
    }
    heightChanged = true;
    actions.push("局部" + e.tool);
  }
  const rivers = cloneData(doc.workflow?.rivers || []),
    seen = new Set(),
    recarve = new Set(p.generate ? rivers.map((r) => r.id) : []);
  for (const r of p.rivers || []) {
    if (seen.has(r.id)) throw Error("同一河道一轮只能修改一次");
    seen.add(r.id);
    const index = rivers.findIndex((v) => v.id === r.id);
    if (r.action === "add" && index >= 0) throw Error("河道ID重复");
    if (r.action !== "add" && index < 0) throw Error("河道不存在：" + r.id);
    if (r.action === "remove") {
      rivers.splice(index, 1);
      recarve.delete(r.id);
      if (!p.generate)
        warnings.push(
          "删除河面/路径保留已刻蚀沟槽，需要填平可继续对话使用flatten",
        );
      actions.push("删除河道");
      continue;
    }
    if (
      r.action === "edit" &&
      (r.points ||
        r.width !== undefined ||
        r.depth !== undefined ||
        r.bank !== undefined)
    )
      warnings.push("修改河道为降低式再刻蚀，旧沟槽不自动填回");
    const merged = { ...(index >= 0 ? rivers[index] : {}), ...r };
    delete merged.action;
    const river = cleanRiver(
      expandRiverPath(
        merged,
        size,
        (x, z) => sampleGrid(h, n, n, x / size + 0.5, z / size + 0.5) * ex,
      ),
      size,
    );
    riverStrip(river, size);
    if (index >= 0) rivers[index] = river;
    else rivers.push(river);
    if (rivers.length > 16) throw Error("河道总数最多16条");
    if (
      r.action === "add" ||
      ["points", "width", "depth", "bank"].some((k) => r[k] !== undefined)
    )
      recarve.add(river.id);
    actions.push(r.action === "add" ? "新增河道" : "修改河道");
  }
  for (const r of rivers)
    if (recarve.has(r.id)) {
      const reach = r.width / 2 + r.bank;
      protect({
        minX: Math.min(...r.points.map((p) => p[0])) - reach,
        maxX: Math.max(...r.points.map((p) => p[0])) + reach,
        minZ: Math.min(...r.points.map((p) => p[2])) - reach,
        maxZ: Math.max(...r.points.map((p) => p[2])) + reach,
      });
      const result = await carveRiver(h, n, size, ex, r, checkpoint);
      h = result.h;
      heightChanged = true;
    }
  if (!h.every((v) => Number.isFinite(v) && Math.abs(v * ex) <= 1000))
    throw Error("地形高度超过安全范围±1000米");
  if (p.biome) {
    doc.biome = p.biome;
    actions.push("设置" + p.biome + "地表");
  }
  if (p.water) {
    doc.water = p.water.enabled;
    if (p.water.level !== undefined) doc.waterY = p.water.level;
    actions.push(p.water.enabled ? "开启全局水面" : "关闭全局水面");
  }
  doc.size = size;
  doc.enabled = terrain.enabled || heightChanged;
  if (
    !terrain.enabled &&
    heightChanged &&
    terrain.h.some((v) => Math.abs(v) > 0.005)
  )
    protect(null);
  if (p.water?.enabled && !doc.enabled)
    warnings.push("当前地形关闭，水面设置已保存但尚不显示；可继续要求生成地形");
  doc.h32 = packFloat32(h);
  delete doc.h64;
  doc.workflow = { ...doc.workflow, precise: true, rivers };
  const heightAt = (x, z) =>
    doc.enabled ? sampleGrid(h, n, n, x / size + 0.5, z / size + 0.5) * ex : 0;
  if (p.groundObjects) actions.push("原静态物体贴地");
  if (!actions.length) throw Error("没有可执行的地形操作");
  return {
    document: doc,
    heightAt,
    heightChanged,
    overwrite,
    groundObjects: p.groundObjects === true,
    actions,
    warnings,
  };
}
