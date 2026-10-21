import assert from "node:assert/strict";
import { planStaticRoute } from "../src/behavior-navigation.js";
import {
  compileBehavior,
  readBehaviorProgram,
  sampleBehavior,
  behaviorKeys,
  validateBehaviorRequest,
} from "../src/behavior-program.js";
const copy = (x) => JSON.parse(JSON.stringify(x));
const request = {
  radius: 0.5,
  height: 2.5,
  cellSize: 0.5,
  margin: 6,
  steps: [
    { type: "move", target: [6, 0], seconds: 4, anim: "walk" },
    { type: "act", seconds: 2, anim: "wave", face: [10, 0] },
    { type: "move", target: [6, 5], seconds: 3, anim: "run" },
  ],
};
const obstacle = { min: [2, -1], max: [4, 1] },
  opts = { origin: [0, 0, 0], request, obstacles: [obstacle] };
const { program: p, stats } = compileBehavior(opts);
assert.deepEqual(compileBehavior(opts).program, p);
assert.ok(stats.visited > 0 && stats.points > 5 && stats.checks < 2000000);
assert.equal(p.duration, 9);
assert.equal(p.clips.length, 3);
assert.equal(p.clips[1].yaw, Math.PI / 2);
assert.ok(Object.isFrozen(p.clips[0].points[0]));
assert.throws(() => p.request.steps.push({}));
assert.deepEqual(readBehaviorProgram(copy(p)), p);
for (const t of [0, 1, 3.999, 4, 5, 6, 7.2, 9, 90]) {
  const s = sampleBehavior(p, t);
  sampleBehavior(p, 2);
  assert.deepEqual(sampleBehavior(p, t), s, "seek determinism");
}
assert.equal(sampleBehavior(p, 4).anim, "wave");
assert.equal(sampleBehavior(p, 6).anim, "run");
assert.equal(sampleBehavior(p, 90).held, true);
assert.deepEqual(sampleBehavior(p, 90), sampleBehavior(p, 9));
assert.deepEqual(sampleBehavior(p, -1).p, [0, 0, 0]);
assert.deepEqual(sampleBehavior(p, 5).p, [6, 0, 0]);
assert.equal(sampleBehavior(p, 5).phase, 2);
assert.deepEqual(behaviorKeys(p).at(-1), { t: 1, p: [6, 0, 5] });
assert.equal(readBehaviorProgram(p), p);
const bad = (mut, re = /./) => {
  const q = copy(p);
  mut(q);
  assert.throws(() => readBehaviorProgram(q), re);
};
bad((q) => (q.schema = "2"));
bad((q) => (q.scale[1] = 2));
bad((q) => (q.duration = "9"));
bad((q) => (q.clips[0].start = 0.5));
bad((q) => q.clips[1].points[0][0]++);
bad((q) => q.clips[0].points.push(q.clips[0].points.at(-1)));
bad((q) => (q.clips[0].points[1][1] = 2));
bad((q) => (q.clips[0].yaw = 0.5));
bad((q) => q.request.steps[0].target[0]++);
bad((q) => (q.clips[1].yaw = 0));
bad((q) => (q.clips[0].evil = 1));
bad((q) => (q.request.extra = JSON.parse('{"__proto__":{}}')));
assert.throws(
  () => readBehaviorProgram({ ...copy(p), extra: "x".repeat(140000) }),
  /128KiB/,
);
for (const mut of [
  (r) => (r.steps = []),
  (r) => (r.steps = Array(17).fill(r.steps[0])),
  (r) => (r.radius = 0),
  (r) => (r.cellSize = 0.1),
  (r) => (r.margin = 40),
  (r) => (r.steps[0].seconds = NaN),
  (r) => (r.steps[0].anim = "fly"),
  (r) => (r.steps[1].anim = "sit"),
  (r) => (r.steps[1].face = [Infinity, 0]),
  (r) => (r.steps[0].target = [601, 0]),
  (r) => (r.steps[0].extra = true),
  (r) => (r.steps = Array(3).fill({ ...r.steps[0], seconds: 50 })),
]) {
  const r = copy(request);
  mut(r);
  assert.throws(() => validateBehaviorRequest(r));
}
assert.throws(() => compileBehavior({ ...opts, origin: [0, 1, 0] }), /y=0/);
assert.throws(
  () =>
    compileBehavior({
      ...opts,
      request: {
        ...request,
        steps: [{ type: "move", target: [0, 0], anim: "walk", seconds: 1 }],
      },
    }),
  /停留/,
);
assert.throws(
  () =>
    compileBehavior({
      ...opts,
      request: {
        ...request,
        steps: [{ type: "act", anim: "look", seconds: 1, face: [0, 0] }],
      },
    }),
  /重合/,
);
assert.throws(
  () =>
    compileBehavior({ ...opts, obstacles: [{ min: [-1, -1], max: [1, 1] }] }),
  /障碍内/,
);
const stationary = compileBehavior({
  ...opts,
  obstacles: [],
  request: { ...request, steps: [{ type: "act", seconds: 2, anim: "idle" }] },
}).program;
assert.deepEqual(sampleBehavior(stationary, 50).p, [0, 0, 0]);
assert.equal(sampleBehavior(stationary, 50).phase, 4);
const nav = {
  start: [-3, 0],
  goal: [3, 0],
  bounds: { min: [-6, -6], max: [6, 6] },
  cellSize: 0.5,
  radius: 0.5,
  obstacles: [{ min: [-1, -1], max: [1, 1] }],
};
assert.deepEqual(planStaticRoute(nav), planStaticRoute(nav));
assert.throws(
  () =>
    planStaticRoute({ ...nav, obstacles: [{ min: [-1, -6], max: [1, 6] }] }),
  /没有可达路径/,
);
assert.throws(
  () =>
    planStaticRoute({ ...nav, bounds: { min: [-200, -200], max: [200, 200] } }),
  /预算/,
);
assert.throws(
  () => planStaticRoute({ ...nav, obstacles: Array(513).fill(obstacle) }),
  /512/,
);
assert.throws(() => planStaticRoute({ ...nav, start: [-5.9, 0] }), /边缘净空/);
assert.throws(
  () => planStaticRoute({ ...nav, budget: { checks: 1999999 } }),
  /预算/,
);
assert.throws(
  () => planStaticRoute({ ...nav, obstacles: [{ min: [1, 1], max: [0, 0] }] }),
  /倒置/,
);
// Independent dense-point oracle over random deterministic routes. Inclusive slab
// checks are in production; sampling here additionally catches corner-cutting regressions.
let seed = 123456789;
const rng = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
let successes = 0,
  failures = 0;
for (let trial = 0; trial < 60; trial++) {
  const boxes = Array.from({ length: 8 }, () => {
    const x = -1 + rng() * 6,
      z = -4 + rng() * 8;
    return { min: [x, z], max: [x + 0.3 + rng(), z + 0.3 + rng()] };
  });
  let route;
  try {
    route = planStaticRoute({
      ...nav,
      start: [-4, 0],
      goal: [5, 0],
      obstacles: boxes,
    });
  } catch (e) {
    assert.match(e.message, /障碍内|不可达|没有可达路径|净空/);
    failures++;
    continue;
  }
  successes++;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    for (let j = 0; j <= 1000; j++) {
      const pt = a.map((v, k) => v + ((b[k] - v) * j) / 1000);
      for (const box of boxes)
        assert.ok(
          !(
            pt[0] >= box.min[0] - 0.501 &&
            pt[0] <= box.max[0] + 0.501 &&
            pt[1] >= box.min[1] - 0.501 &&
            pt[1] <= box.max[1] + 0.501
          ),
          "path crosses inflated AABB",
        );
    }
  }
}
assert.ok(successes > 10);

assert.throws(
  () =>
    planStaticRoute({
      start: [-3, 0],
      goal: [6, 0],
      bounds: { min: [-6, -6], max: [6.6, 6] },
      cellSize: 2,
      radius: 0.5,
      obstacles: [{ min: [-1, -1], max: [1, 1] }],
    }),
  /中心缺少边界|不可达|没有可达路径/,
);

console.log(
  JSON.stringify({
    status: "PASS",
    cases:
      "schema, finite values, budgets, blocked/stationary, deterministic A*, absolute sampling, immutable persistence, corner clearance",
    randomRoutes: { successes, failures },
    stats,
  }),
);
