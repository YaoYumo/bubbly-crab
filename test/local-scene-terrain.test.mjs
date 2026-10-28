import assert from "node:assert/strict";
import {
  compileConversationTerrain,
  cleanConversationTerrain,
} from "../src/local-scene-terrain.js";
import {
  readConversationReply,
  terrainAuthorization,
  ModelToolError,
} from "../src/local-scene-tools.js";
import { singleRiverRequest } from "../src/local-scene-river.js";
import { generateHeightfield } from "../src/terrain-generation.js";
import { validateEnvelope } from "../src/ai-scene-format.js";
const make = () => ({
  n: 33,
  size: 160,
  h: new Float32Array(33 * 33),
  enabled: true,
  exaggerate: 1,
  generation: { kind: "hills", amp: 8, seed: 123 },
  state: { water: false, waterY: 0.06 },
});
const doc = (t) => ({
  n: t.n,
  size: t.size,
  enabled: t.enabled,
  biome: "grass",
  exaggerate: t.exaggerate,
  water: t.state.water,
  waterY: t.state.waterY,
  generation: t.generation,
  workflow: { rivers: [] },
});
const t = make(),
  before = t.h.slice();
let checks = 0;
const a = await compileConversationTerrain(
  t,
  doc(t),
  { generate: { kind: "hills", amp: 12, seed: 42, size: 200 } },
  {
    checkpoint: async () => {
      checks++;
    },
  },
);
const b = await compileConversationTerrain(t, doc(t), {
  generate: { kind: "hills", amp: 12, seed: 42, size: 200 },
});
assert.equal(a.document.h32, b.document.h32);
assert.deepEqual(t.h, before);
assert.equal(a.document.water, false);
assert.ok(checks > 0);
assert.equal(a.overwrite, false);
const island = await compileConversationTerrain(t, doc(t), {
  generate: { kind: "island", amp: 12, seed: 42 },
});
assert.equal(island.document.water, false);
const high = make();
high.exaggerate = 3;
const scaled = await compileConversationTerrain(high, doc(high), {
  generate: { kind: "hills", amp: 0.5, seed: 42 },
});
assert.ok(
  Math.abs(
    scaled.heightAt(0, 0) -
      generateHeightfield(33, 160, { kind: "hills", amp: 0.5, seed: 42 }).h[
        16 * 33 + 16
      ],
  ) < 1e-6,
);
const raised = await compileConversationTerrain(t, doc(t), {
  edits: [{ tool: "raise", center: [0, 0], radius: 20, amount: 5 }],
});
assert.equal(raised.heightAt(0, 0), 5);
assert.equal(raised.heightAt(70, 70), 0);
assert.deepEqual(t.h, before);
const disabled = make();
disabled.enabled = false;
disabled.h[0] = 10;
const off = await compileConversationTerrain(
  disabled,
  doc(disabled),
  { water: { enabled: false } },
  {
    protect: () => {
      throw Error("must not reveal hidden heights");
    },
  },
);
assert.equal(off.document.enabled, false);
assert.equal(off.heightAt(-80, -80), 0);
const flat = await compileConversationTerrain(t, doc(t), {
  generate: { kind: "flat", height: 3 },
});
assert.equal(flat.heightAt(0, 0), 3);
const river = await compileConversationTerrain(t, doc(t), {
  rivers: [
    {
      action: "add",
      id: "r1",
      name: "河流",
      points: [
        [-50, 0, 0],
        [50, 0, 0],
      ],
      width: 8,
      depth: 3,
      bank: 4,
      water: true,
    },
  ],
});
assert.equal(river.document.workflow.rivers.length, 1);
assert.equal(river.document.water, false);
assert.ok(river.heightAt(0, 0) < -2.9);
const carved = make();
carved.h = new Float32Array(
  Uint8Array.from(atob(river.document.h32), (c) => c.charCodeAt(0)).buffer,
);
const metadata = await compileConversationTerrain(carved, river.document, {
  rivers: [{ action: "edit", id: "r1", water: false }],
});
assert.equal(metadata.document.h32, river.document.h32);
assert.equal(metadata.document.workflow.rivers[0].water, false);
const removed = await compileConversationTerrain(carved, river.document, {
  rivers: [{ action: "remove", id: "r1" }],
});
assert.equal(removed.document.workflow.rivers.length, 0);
assert.equal(removed.heightAt(0, 0), carved.h[16 * 33 + 16]);
const overwrite = await compileConversationTerrain(carved, river.document, {
  generate: { kind: "flat" },
  rivers: [{ action: "remove", id: "r1" }],
});
assert.equal(overwrite.overwrite, true);
assert.equal(overwrite.heightAt(0, 0), 0);
await assert.rejects(
  compileConversationTerrain(t, doc(t), {
    edits: [{ tool: "raise", center: [79, 79], radius: 5, amount: 2 }],
  }),
  /超出/,
);
await assert.rejects(
  compileConversationTerrain(
    t,
    doc(t),
    { generate: { kind: "hills" } },
    {
      protect: () => {
        throw Error("locked");
      },
    },
  ),
  /locked/,
);
await assert.rejects(
  compileConversationTerrain(
    t,
    doc(t),
    { edits: [{ tool: "smooth", center: [0, 0], radius: 20 }] },
    {
      checkpoint: async () => {
        throw Error("cancelled");
      },
    },
  ),
  /cancelled/,
);
assert.deepEqual(t.h, before);
for (const p of [
  { water: { enabled: true, level: 999 } },
  { generate: { kind: "evil" } },
  { edits: [{ tool: "raise", center: [0, 0], radius: -1, amount: 5 }] },
  {
    rivers: [
      {
        action: "add",
        id: "r",
        points: [
          [-1, 0, 0],
          [1, 0, 0],
        ],
        width: 999,
      },
    ],
  },
])
  assert.throws(() => cleanConversationTerrain(p));
const catalog = [{ key: "cn:hall:宫殿", name: "宫殿" }],
  auth = terrainAuthorization("生成丘陵和一条河流");
assert.ok(auth.allowTerrain && auth.allowRivers && !auth.allowWater);
assert.equal(
  terrainAuthorization("30座建筑，中轴对称路网").allowTerrain,
  false,
);
const grid = readConversationReply(
  JSON.stringify({
    reply: "30座",
    operations: [
      {
        op: "grid",
        key: catalog[0].key,
        count: 30,
        columns: 6,
        center: [0, 0, 0],
        spacing: [20, 25],
      },
    ],
  }),
  catalog,
  auth,
);
assert.equal(grid.operations.length, 30);
assert.equal(new Set(grid.operations.map((o) => o.id)).size, 30);
assert.equal(grid.operations[0].pos[0], -grid.operations[5].pos[0]);
assert.throws(
  () =>
    readConversationReply(
      '{"reply":"x","operations":[{"op":"add","key":"env:river:河流"}]}',
      catalog,
      auth,
    ),
  ModelToolError,
);
assert.throws(
  () =>
    readConversationReply(
      '{"reply":"x","operations":[],"terrain":{"water":{"enabled":true}}}',
      catalog,
      auth,
    ),
  /全局水面/,
);
assert.throws(
  () =>
    readConversationReply(
      JSON.stringify({
        reply: "x",
        operations: [],
        terrain: {
          rivers: [
            {
              action: "add",
              points: [
                [-5, 0, 0],
                [5, 0, 0],
              ],
            },
          ],
        },
      }),
      catalog,
      terrainAuthorization("古城不要河流"),
    ),
  /不新增河道/,
);
assert.throws(
  () =>
    readConversationReply(
      JSON.stringify({
        reply: "x",
        operations: [],
        terrain: { water: { enabled: true } },
      }),
      catalog,
      terrainAuthorization("关闭水面"),
    ),
  /关闭全局水面/,
);
const envelope = {
  schema: "previz-ai-scene/1",
  id: "x",
  name: "x",
  baseFingerprint: "a".repeat(64),
  mode: "add",
  bounds: { center: [0, 0], size: [160, 160] },
  seed: 1,
  terrain: "preserve",
  durationSeconds: 6,
  operations: [],
};
assert.throws(() => validateEnvelope(envelope), /操作数/);
assert.doesNotThrow(() =>
  validateEnvelope(envelope, { allowEmptyOperations: true }),
);
console.log(
  "PASS pure conversational terrain: seeded generation, exact world amplitude, local-only edits, river carving/removal, water default, no live mutation, bounds/lock/cancel rejection; grid and private-vs-v1 envelope. NOT real LLM inference.",
);

// Reproductions for the screenshot: empty unsupported must never yield missing operations;
// empty terrain is a repairable model output, not a successful no-op.
const screenshotRequest = "在中央生成一条约20米宽弯曲的河流，深度5米";
assert.deepEqual(singleRiverRequest(screenshotRequest), {
  width: 20,
  depth: 5,
  shape: "meander",
});
for (const request of [
  "生成两条河流",
  "不要生成一条河流",
  "生成一条河流和一座桥",
  "如何生成一条河流？",
  "修改河道宽度",
])
  assert.equal(singleRiverRequest(request), null, request);
const riverAuth = terrainAuthorization(screenshotRequest);
for (const data of [
  { unsupported: "" },
  { reply: "完成", unsupported: "", operations: [] },
  { reply: "完成", operations: [], terrain: {} },
  { reply: "完成", operations: [], terrain: null },
  { reply: "完成", operations: [], terrain: { rivers: {} } },
  { reply: "完成", operations: [], terrain: { rivers: [null] } },
])
  assert.throws(
    () => readConversationReply(JSON.stringify(data), [], riverAuth),
    ModelToolError,
  );
const highLevel = readConversationReply(
  JSON.stringify({
    reply: "生成弯曲河流",
    unsupported: "",
    operations: [],
    terrain: { rivers: [{ action: "add", shape: "meander", water: true }] },
  }),
  [],
  riverAuth,
);
assert.deepEqual(highLevel.operations, []);
assert.equal(highLevel.terrain.rivers[0].width, 20);
assert.equal(highLevel.terrain.rivers[0].depth, 5);
const curved = await compileConversationTerrain(t, doc(t), highLevel.terrain),
  path = curved.document.workflow.rivers[0];
assert.equal(path.width, 20);
assert.equal(path.depth, 5);
assert.equal(path.points.length, 17);
assert.ok(path.points.some((p) => Math.abs(p[0]) > 5));
assert.ok(Math.abs(curved.heightAt(0, 0) + 5) < 1e-6);
assert.equal(curved.document.water, false);
assert.deepEqual(t.h, before);
assert.throws(
  () =>
    readConversationReply(
      JSON.stringify({
        reply: "x",
        terrain: {
          rivers: [{ action: "add", shape: "straight", width: 20, depth: 5 }],
        },
      }),
      [],
      riverAuth,
    ),
  /河形/,
);
assert.throws(
  () =>
    readConversationReply(
      JSON.stringify({
        reply: "x",
        terrain: {
          rivers: [{ action: "add", shape: "meander", width: 10, depth: 5 }],
        },
      }),
      [],
      riverAuth,
    ),
  /width/,
);
await assert.rejects(
  compileConversationTerrain(t, doc(t), {
    rivers: [
      {
        action: "add",
        id: "bad-shape",
        shape: "meander",
        width: 20,
        depth: 5,
        length: 400,
      },
    ],
  }),
  /空间不足/,
);
await assert.rejects(
  compileConversationTerrain(t, doc(t), highLevel.terrain, {
    protect: () => {
      throw Error("locked river footprint");
    },
  }),
  /locked river footprint/,
);
assert.deepEqual(
  readConversationReply('{"unsupported":"无法判断河流位置"}', [], riverAuth),
  { unsupported: "无法判断河流位置", operations: [] },
);
console.log(
  "PASS screenshot regressions: empty unsupported/terrain never dereference missing operations; literal 20m/5m + curved path compiled on a copy, no global flood, no asset fallback, bounded river-only protocol.",
);
