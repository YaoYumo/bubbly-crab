import assert from "node:assert/strict";
import * as THREE from "three";
import {
  cleanPrimitiveParts,
  PRIMITIVE_KEY,
} from "../src/primitive-model-spec.js";
import { buildPrimitiveModel } from "../src/primitive-model.js";
import {
  readConversationReply,
  terrainAuthorization,
} from "../src/local-scene-tools.js";
import { actorFaceOffset, actorTangent } from "../src/actor-heading.js";
import { Mover } from "../src/mover.js";
import { makeRig, poseFor, applyPose } from "../src/character.js";
import { cleanDirecting } from "../src/local-scene-directing.js";
const parts = [
  { shape: "box", size: [1, 2, 1], pos: [0, 1, 0], color: "#405060" },
  { shape: "cylinder", size: [0.2, 0.8, 0.2], pos: [0.4, 2.3, 0] },
];
assert.throws(() => cleanPrimitiveParts([]));
assert.throws(() =>
  cleanPrimitiveParts([{ shape: "eval", size: [1, 1, 1], pos: [0, 0, 0] }]),
);
assert.throws(() =>
  cleanPrimitiveParts([{ ...parts[0], url: "https://evil" }]),
);
assert.throws(() =>
  cleanPrimitiveParts([{ ...parts[0], size: [Infinity, 1, 1] }]),
);
assert.throws(() => cleanPrimitiveParts(Array(65).fill(parts[0])));
const root = buildPrimitiveModel({ parts });
assert.equal(root.children.length, 2);
assert.ok(new THREE.Box3().setFromObject(root).max.y > 2.6);
const reply = {
  reply: "创建库外机器人并运动",
  operations: [
    { op: "primitive", name: "机器人", parts, pos: [0, 0, 0] },
    {
      op: "motion",
      objectId: "last",
      points: [
        [0, 0, 0, 0],
        [6, 10, 0, 0],
      ],
    },
    { op: "camera", objectId: "name:机器人", preset: "follow" },
    { op: "environment", lighting: "golden", weather: "rain" },
  ],
};
const parsed = readConversationReply(
  JSON.stringify(reply),
  [{ key: PRIMITIVE_KEY }],
  terrainAuthorization("创建机器人粗模，运动到右侧并跟拍镜头，黄金光影和雨天"),
);
assert.equal(parsed.operations.length, 1);
assert.equal(parsed.operations[0].key, PRIMITIVE_KEY);
assert.equal(parsed.directing.motions[0].objectId, parsed.operations[0].id);
assert.equal(parsed.directing.camera.objectId, parsed.operations[0].id);
assert.throws(
  () =>
    readConversationReply(
      JSON.stringify(reply),
      [{ key: PRIMITIVE_KEY }],
      terrainAuthorization("只建一个模型，不改变其他内容"),
    ),
  /运动/,
);
assert.throws(
  () =>
    cleanDirecting({
      motions: [
        {
          objectId: "a",
          points: [
            [0, 0, 0, 0],
            [6, 1, 0, 0],
          ],
          loop: true,
        },
      ],
    }),
  /闭合/,
);
assert.equal(
  actorFaceOffset({ key: "env:car:轿车", motion: {} }),
  -Math.PI / 2,
);
assert.equal(
  actorFaceOffset({ key: "env:bus:公交车", motion: {} }),
  -Math.PI / 2,
);
assert.equal(actorFaceOffset({ key: "char:human:人物", motion: {} }), 0);
assert.equal(
  actorFaceOffset({
    key: "env:car:轿车",
    motion: { faceOffset: 0, faceOffsetMode: "manual" },
  }),
  0,
);
const motion = {
  easing: "inout",
  arc: true,
  schedule: { rate: 1, phase: 0.25 },
  keys: [
    { t: 0, p: [0, 0, 0] },
    { t: 0.1, p: [5, 0, 0] },
    { t: 1, p: [5, 0, 30] },
  ],
};
motion.mover = new Mover(motion.keys);
for (const u of [0.001, 0.12, 0.4, 0.7]) {
  const tangent = actorTangent(motion, u);
  assert.ok(Number.isFinite(tangent.x + tangent.z));
  const t = (u + 0.25) % 1,
    sample = (t) =>
      motion.mover.sample(t, undefined, "linear", { ease: "inout", arc: true })
        .p;
  const numerical = sample(t + 0.0001)
    .clone()
    .sub(sample(t - 0.0001))
    .normalize();
  assert.ok(tangent.dot(numerical) > 0.999);
}
const { root: human, rig } = makeRig({}),
  ys = [],
  bottom = [];
let prior = null,
  maxDelta = 0;
for (let i = 0; i <= 360; i++) {
  const phase = (i / 360) * Math.PI * 2,
    pose = poseFor("walk", phase);
  applyPose(rig, pose);
  human.updateMatrixWorld(true);
  ys.push(rig.hips.position.y);
  const foot = new THREE.Box3().setFromObject(rig.footL),
    other = new THREE.Box3().setFromObject(rig.footR);
  bottom.push(Math.min(foot.min.y, other.min.y));
  if (prior !== null)
    maxDelta = Math.max(maxDelta, Math.abs(rig.kneeL.rotation.x - prior));
  prior = rig.kneeL.rotation.x;
}
assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-8);
assert.ok(Math.max(...bottom) - Math.min(...bottom) < 0.012);
assert.ok(maxDelta < 0.04);
console.log(
  "PASS primitive schema/security + resolved references + authorized directing + model front axes + time-matched motion heading + grounded smooth walk",
  {
    soleRange: Math.max(...bottom) - Math.min(...bottom),
    maxKneeStep: maxDelta,
  },
);

assert.equal(
  actorFaceOffset({ key: "env:car:轿车", motion: { faceOffset: 0 } }),
  -Math.PI / 2,
);
