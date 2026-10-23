import assert from "node:assert/strict";
import * as THREE from "three";
import {
  validateEnvelope,
  validateAIRelations,
} from "../src/ai-scene-format.js";
import {
  lowerAISceneRelations,
  checkAIRelationClearance,
} from "../src/ai-scene-relations.js";
const entity = (id, pos = [0, 0, 0], yaw = 0) => ({
  id,
  key: "env:crate:木箱",
  pos,
  rot: [0, yaw, 0],
  scale: [1, 1, 1],
});
const add = (id, pos = [0, 0, 0]) => ({
  op: "add",
  id,
  key: "env:crate:木箱",
  pos,
});
const offset = (subject, reference, delta = [4, 0, 0], frame = "world") => ({
  type: "offset",
  subject,
  reference,
  delta,
  frame,
});
const face = (subject, target) => ({ type: "face", subject, target });
const host = entity("host", [10, 3, 10], Math.PI / 2);
host.locked = true;
const base = {
  schema: "previz-ai-scene/1",
  id: "relation-test",
  name: "Relations",
  baseFingerprint: "a".repeat(64),
  mode: "add",
  bounds: { center: [0, 0], size: [192, 192] },
  seed: 1,
  terrain: "preserve",
  durationSeconds: 6,
  operations: [add("child")],
};
function run(rules, options = {}) {
  const plan = {
    ...structuredClone(base),
    relations: { version: 1, rules },
    ...options.plan,
  };
  validateEnvelope(plan);
  const input = {
    plan,
    operations: plan.operations,
    objects: [host],
    permissions: { mode: plan.mode, editableIds: [] },
    protectedIds: new Set(["host"]),
    ...options,
  };
  const before = JSON.stringify(input);
  const result = lowerAISceneRelations(input);
  assert.equal(
    JSON.stringify(input),
    before,
    "must not mutate plan, operations or source objects",
  );
  return result;
}
let r = run([
  offset("child", "host"),
  face("child", "host"),
  { type: "distance", subject: "child", target: "host", min: 4, max: 4 },
]);
assert.deepEqual(r.operations[0].pos, [14, 3, 10]);
assert.equal(r.operations[0].rotationY, -Math.PI / 2);
assert.deepEqual(r.summaries.length, 3);
r = run([offset("child", "host", [2, 1, 3], "local")]);
assert(
  Math.hypot(...r.operations[0].pos.map((v, i) => v - [13, 4, 8][i])) < 1e-8,
);
// Independent local and world offsets, final-position target references, reciprocal facing.
r = run(
  [
    face("a", "b"),
    face("b", "a"),
    offset("b", "host", [0, 0, 4]),
    offset("a", "host", [4, 0, 0]),
  ],
  {
    plan: {
      ...base,
      operations: [add("a"), add("b")],
      relations: {
        version: 1,
        rules: [
          face("a", "b"),
          face("b", "a"),
          offset("b", "host", [0, 0, 4]),
          offset("a", "host", [4, 0, 0]),
        ],
      },
    },
  },
);
assert.equal(r.operations.length, 2);
assert.equal(r.operations[0].rotationY, -Math.PI / 4);
// Final host facing is used for local offsets, not the stale input yaw.
r = run([offset("child", "ref", [0, 0, 4], "local"), face("ref", "target")], {
  objects: [],
  plan: {
    ...base,
    operations: [
      add("child"),
      add("ref", [0, 0, 0]),
      add("target", [10, 0, 0]),
    ],
    relations: {
      version: 1,
      rules: [
        offset("child", "ref", [0, 0, 4], "local"),
        face("ref", "target"),
      ],
    },
  },
});
assert(Math.abs(r.operations[0].pos[0] - 4) < 1e-8);
// Relation-only edits are lowered into explicit permission-checked transforms.
const editable = entity("editable", [-10, 0, 0]);
r = run([offset("editable", "host")], {
  plan: {
    ...base,
    mode: "edit",
    operations: [{ op: "transform", objectId: "editable", pos: [-8, 0, 0] }],
    relations: { version: 1, rules: [offset("editable", "host")] },
  },
  objects: [host, editable],
  permissions: { mode: "edit", editableIds: ["editable"] },
});
assert.equal(r.operations.length, 1);
assert.deepEqual(r.operations[0].pos, [14, 3, 10]);
r = run([offset("editable", "host")], {
  plan: {
    ...base,
    mode: "edit",
    operations: [{ op: "transform", objectId: "other", pos: [-8, 0, 0] }],
    relations: { version: 1, rules: [offset("editable", "host")] },
  },
  objects: [host, editable, entity("other")],
  permissions: { mode: "edit", editableIds: ["editable", "other"] },
});
assert.equal(r.operations.length, 2);
assert.equal(r.operations[1].objectId, "editable");
// Ground placement is sampled before relation lowering; offsets are absolute world heights.
r = run([offset("child", "ref", [4, 1, 0])], {
  objects: [],
  heightAt: () => 7,
  plan: {
    ...base,
    operations: [{ ...add("ref"), placement: "ground" }, add("child")],
    relations: { version: 1, rules: [offset("child", "ref", [4, 1, 0])] },
  },
});
assert.deepEqual(r.operations[1].pos, [4, 8, 0]);
assert.equal(r.operations[1].placement, "absolute");
for (const [rules, options, pattern] of [
  [[offset("child", "missing")], {}, /缺失/],
  [[offset("host", "child")], {}, /无权/],
  [[offset("child", "host", [500, 0, 0])], {}, /范围/],
  [[offset("child", "host"), offset("child", "host")], {}, /冲突/],
  [
    [offset("a", "b"), offset("b", "a")],
    {
      plan: {
        ...base,
        operations: [add("a"), add("b")],
        relations: { version: 1, rules: [offset("a", "b"), offset("b", "a")] },
      },
    },
    /成环/,
  ],
  [
    [face("child", "host")],
    {
      plan: {
        ...base,
        operations: [add("child", [10, 3, 10])],
        relations: { version: 1, rules: [face("child", "host")] },
      },
    },
    /重合/,
  ],
  [
    [{ type: "distance", subject: "child", target: "host", min: 0, max: 1 }],
    {},
    /距离约束/,
  ],
  [
    [offset("child", "host")],
    { objects: [{ ...host, motion: { active: true } }] },
    /活动走位/,
  ],
  [
    [offset("child", "host")],
    { objects: [{ ...host, key: undefined }] },
    /库资产/,
  ],
  [
    [offset("child", "host")],
    { objects: [{ ...host, type: "road_brush" }] },
    /库资产/,
  ],
  [
    [offset("child", "host")],
    {
      plan: {
        ...base,
        previs: {
          subjectId: "child",
          camera: "none",
          motion: {
            anim: "walk",
            points: [
              [0, 0, 0, 0],
              [6, 0, 0, 4],
            ],
          },
        },
        relations: { version: 1, rules: [offset("child", "host")] },
      },
    },
    /活动走位/,
  ],
])
  assert.throws(() => run(rules, options), pattern);
assert.throws(
  () => run([offset("editable", "host")], { objects: [host, editable] }),
  /无权/,
);
assert.throws(
  () =>
    run([offset("editable", "host")], {
      objects: [host, { ...editable, followTerrain: true }],
      plan: {
        ...base,
        mode: "edit",
        relations: { version: 1, rules: [offset("editable", "host")] },
      },
      permissions: { mode: "edit", editableIds: ["editable"] },
    }),
  /地形跟随/,
);
assert.throws(
  () =>
    run([offset("child", "host", [1, 0, 0], "local")], {
      objects: [{ ...host, rot: [0.2, 0, 0] }],
    }),
  /仅Y轴/,
);
for (const rules of [
  [offset("child", "host", [Infinity, 0, 0])],
  [offset("child", "host", [1, 0, 0], "mesh")],
  [{ type: "distance", subject: "child", target: "host", min: 5, max: 1 }],
  [{ type: "keep-out", subject: "child", obstacle: "host", margin: -1 }],
  [{ type: "face", subject: "child", target: "child" }],
  [{ type: "constructor", subject: "child", target: "host" }],
  [{ type: "face", subject: "child", target: "host", script: "run()" }],
  [],
  Array(129).fill(face("child", "host")),
])
  assert.throws(() => validateAIRelations({ version: 1, rules }));
assert.throws(
  () =>
    validateAIRelations(JSON.parse('{"version":1,"rules":[],"__proto__":{}}')),
  /原型/,
);
assert.throws(
  () =>
    validateEnvelope({
      ...base,
      operations: undefined,
      recipe: { kind: "template", template: "plaza" },
      relations: { version: 1, rules: [face("child", "host")] },
    }),
  /配方/,
);
const box = (x, z) =>
  new THREE.Box3(
    new THREE.Vector3(x - 1, -1, z - 1),
    new THREE.Vector3(x + 1, 1, z + 1),
  );
const clearance = {
  version: 1,
  rules: [{ type: "keep-out", subject: "child", obstacle: "host", margin: 1 }],
};
checkAIRelationClearance(clearance, (id) =>
  id === "child" ? box(3, 0) : box(0, 0),
);
assert.throws(
  () =>
    checkAIRelationClearance(clearance, (id) =>
      id === "child" ? box(2.9, 0) : box(0, 0),
    ),
  /留空/,
);
assert.throws(() => checkAIRelationClearance(clearance, () => null), /几何/);
console.log(
  "PASS AI relations: data-only lowering, chained world/local offsets, offset+facing, permissions, readonly locked references, final-pose distances/clearance, cycles, bounds, schema and no mutation. NOT real model inference.",
);

// Relations must not launder malformed fields that they would otherwise overwrite.
assert.throws(
  () =>
    run([face("child", "host")], {
      plan: {
        ...base,
        operations: [{ ...add("child"), rotationY: "bad" }],
        relations: { version: 1, rules: [face("child", "host")] },
      },
    }),
  /朝向/,
);
assert.throws(
  () =>
    run([offset("child", "host")], {
      plan: {
        ...base,
        operations: [{ ...add("child"), placement: "remote-script" }],
        relations: { version: 1, rules: [offset("child", "host")] },
      },
    }),
  /placement/,
);
assert.throws(
  () =>
    run([offset("editable", "host")], {
      objects: [host, editable],
      permissions: { mode: "edit", editableIds: ["editable"] },
      plan: {
        ...base,
        mode: "edit",
        operations: [{ op: "transform", objectId: "editable" }],
        relations: { version: 1, rules: [offset("editable", "host")] },
      },
    }),
  /位置/,
);

// 180 explicit edits plus a relation-only edit must not bypass the operation budget.
const many = Array.from({ length: 180 }, (_, i) =>
  entity("existing-" + i, [20, 0, 20]),
);
assert.throws(
  () =>
    run([offset("editable", "host")], {
      plan: {
        ...base,
        mode: "edit",
        operations: many.map((o) => ({
          op: "transform",
          objectId: o.id,
          pos: o.pos,
        })),
        relations: { version: 1, rules: [offset("editable", "host")] },
      },
      objects: [host, editable, ...many],
      permissions: {
        mode: "edit",
        editableIds: [editable.id, ...many.map((o) => o.id)],
      },
    }),
  /180/,
);

// Existing authenticated API accepts the optional relations extension, not code.
const { createAISceneGateway } =
  await import("../scripts/ai-scene-gateway.mjs");
let upstreamCalls = 0;
const apiPlan = {
  ...base,
  relations: {
    version: 1,
    rules: [offset("child", "host"), face("child", "host")],
  },
};
const server = createAISceneGateway({
  endpoint: "http://127.0.0.1:12345/v1/chat/completions",
  key: "fixture-provider-only",
  model: "fixture-relations",
  accessToken: "fixture-relations-access-token-32",
  allowLocal: true,
  fetcher: async (_url, options) => {
    upstreamCalls++;
    const body = JSON.parse(options.body);
    assert(body.messages[0].content.includes("blueprintContract.relations"));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(apiPlan) } }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
});
try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = "http://127.0.0.1:" + server.address().port;
  const request = {
    requestId: "relation-api-fixture",
    prompt: "放在锁定参考物东侧并朝向参考物",
    workpack: {
      schema: "previz-ai-workpack/1",
      baseFingerprint: base.baseFingerprint,
      bounds: base.bounds,
      permissions: { mode: "add" },
      blueprintContract: { relations: { version: 1 } },
    },
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer fixture-relations-access-token-32",
  };
  const submitted = await fetch(baseURL + "/api/ai-scenes/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  assert.equal(submitted.status, 202);
  const first = await submitted.json();
  let job;
  for (let i = 0; i < 40; i++) {
    job = await (
      await fetch(baseURL + "/api/ai-scenes/jobs/" + first.id, { headers })
    ).json();
    if (job.status === "succeeded" || job.status === "failed") break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.blueprint.relations, apiPlan.relations);
  await fetch(baseURL + "/api/ai-scenes/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  assert.equal(upstreamCalls, 1);
  console.log(
    "PASS AI relations authenticated gateway fixture; optional schema extension preserved, duplicate submit does not repeat provider. NOT real model inference.",
  );
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
