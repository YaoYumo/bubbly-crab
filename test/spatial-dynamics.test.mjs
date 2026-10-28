import assert from "node:assert/strict";
import {
  resolveSpatialRelations,
  segmentHitsBox,
} from "../src/spatial-relations.js";
import { motionProgress } from "../src/motion-schedule.js";
import { inspectSceneDynamics } from "../src/scene-dynamics.js";
import { inspectSceneRelations } from "../src/scene-relations.js";
import {
  compileSceneRecipe,
  validateRecipeScene,
} from "../src/scene-recipes.js";
import { parseSceneIntent } from "../src/scene-intent.js";
import { parsePromptLocally } from "../src/towngen.js";
const e = (id, position = [0, 0, 0], yaw = 0, half = [0, 0]) => ({
  id,
  position,
  yaw,
  half,
});
const graph = {
  version: 1,
  entities: [e("a", [5, 2, 7], Math.PI / 2), e("b"), e("c")],
  rules: [
    { type: "anchor", subject: "c", host: "b", offset: [0, 1, 2] },
    { type: "anchor", subject: "b", host: "a", offset: [1, 2, 3] },
  ],
};
const before = JSON.stringify(graph),
  solved = resolveSpatialRelations(graph);
assert.equal(JSON.stringify(graph), before);
assert(
  Math.hypot(...solved.entities[1].position.map((v, i) => v - [8, 4, 6][i])) <
    1e-6,
);
assert(
  Math.hypot(...solved.entities[2].position.map((v, i) => v - [10, 5, 6][i])) <
    1e-6,
);
assert.deepEqual(solved, resolveSpatialRelations(graph));
assert.equal(
  resolveSpatialRelations({
    version: 1,
    entities: [e("a")],
    rules: [{ type: "face", subject: "a", target: [1, 0, 0] }],
  }).entities[0].yaw,
  Math.PI / 2,
);
assert.throws(
  () =>
    resolveSpatialRelations({
      ...graph,
      rules: [
        { type: "anchor", subject: "a", host: "b", offset: [0, 0, 0] },
        { type: "anchor", subject: "b", host: "a", offset: [0, 0, 0] },
      ],
    }),
  /成环/,
);
assert.throws(
  () =>
    resolveSpatialRelations({
      ...graph,
      rules: [...graph.rules, graph.rules[0]],
    }),
  /冲突/,
);
assert.throws(
  () => resolveSpatialRelations({ ...graph, entities: [e("a")] }),
  /缺失/,
);
assert.throws(
  () => resolveSpatialRelations({ ...graph, entities: [e("a"), e("a")] }),
  /重复/,
);
assert.throws(
  () => resolveSpatialRelations({ ...graph, entities: [e("a", [NaN, 0, 0])] }),
  /有限/,
);
assert.throws(
  () =>
    resolveSpatialRelations({
      ...graph,
      rules: [{ type: "execute", code: "alert(1)" }],
    }),
  /不支持/,
);
assert.throws(
  () =>
    resolveSpatialRelations(
      JSON.parse('{"version":1,"entities":[],"rules":[],"__proto__":{}}'),
    ),
  /原型/,
);
assert.throws(
  () =>
    resolveSpatialRelations({
      ...graph,
      entities: Array.from({ length: 301 }, (_, i) => e("a" + i)),
    }),
  /预算/,
);
const obstacles = {
  version: 1,
  entities: [
    e("a", [0, 0, 0], Math.PI / 2, [4, 1]),
    e("b", [0, 0, 3], 0, [1, 1]),
  ],
  rules: [{ type: "keep-out", subject: "a", obstacle: "b", margin: 0 }],
};
assert.equal(resolveSpatialRelations(obstacles).ok, false);
obstacles.entities[1].position = [4, 0, 0];
assert.equal(resolveSpatialRelations(obstacles).ok, true);
obstacles.rules = [
  { type: "distance", subject: "a", target: "b", min: 5, max: 6 },
];
assert.equal(resolveSpatialRelations(obstacles).ok, false);
assert(
  segmentHitsBox([-5, 0, 0], [5, 0, 0], { min: [-1, -1, -1], max: [1, 1, 1] }),
  "detect crossing even when endpoints are outside",
);
assert(
  !segmentHitsBox([-5, 3, 0], [5, 3, 0], { min: [-1, -1, -1], max: [1, 1, 1] }),
);
assert(
  segmentHitsBox(
    [-5, 2, 0],
    [5, 2, 0],
    { min: [-1, -1, -1], max: [1, 1, 1] },
    [0, 1, 0],
  ),
);
assert.equal(
  motionProgress({ speed: 2 }, 0.3),
  0.3,
  "legacy speed remains gait speed, not path rate",
);
assert.equal(
  motionProgress({ schedule: { rate: 2, phase: 0.25 } }, 0.25),
  0.75,
);
assert.equal(
  motionProgress({ schedule: { rate: NaN, phase: 0 } }, 0.25),
  0.25,
  "bad imported schedule fails safely at runtime",
);
assert.equal(
  parseSceneIntent("行人快走，河流"),
  null,
  "timing words alone cannot hijack town routing",
);
const parsed = parsePromptLocally(
  "赛博都市，行人速度0.5倍，飞车速度2倍，错峰，种子82",
);
assert.deepEqual(parsed.ignored, []);
for (const kind of ["cyber-rain", "lantern-river"]) {
  const base = compileSceneRecipe({ kind, values: { seed: 82 } }),
    plan = compileSceneRecipe({
      kind,
      values: { seed: 82, walkRate: 0.5, trafficRate: 2, stagger: true },
    });
  assert(plan.checks.relations.ok);
  assert(plan.checks.relations.anchors > 0);
  assert(plan.checks.dynamics.corridorSamples > 0);
  assert.deepEqual(
    plan,
    compileSceneRecipe({
      kind,
      values: { seed: 82, walkRate: 0.5, trafficRate: 2, stagger: true },
    }),
  );
  assert.deepEqual(
    plan.scene.objs.map((o) => o[5].m?.keys),
    base.scene.objs.map((o) => o[5].m?.keys),
    "timing never resamples or distorts geometry",
  );
  assert(plan.scene.objs.some((o) => o[5].m?.schedule?.phase > 0));
  assert(plan.checks.dynamics.warnings.some((w) => w.code === "timeline-seam"));
  const drift = structuredClone(plan.scene),
    part = drift.objs.find((o) => o[5].assembly?.role === "attachment");
  part[1] += 1;
  assert.equal(inspectSceneRelations(drift).report.ok, false);
  assert.throws(() => validateRecipeScene(drift), /挂接/);
  const invalid = structuredClone(plan.scene),
    m = invalid.objs.find((o) => o[5].m?.active)[5].m;
  m.schedule = { rate: Infinity, phase: 0 };
  assert.throws(() => inspectSceneDynamics(invalid), /时序/);
  const bad = structuredClone(plan.scene),
    walker = bad.objs.find(
      (o) => o[5].routeRole === (kind === "cyber-rain" ? "sidewalk" : "bank"),
    );
  for (const k of walker[5].m.keys) k.p[0] = 0;
  assert.throws(() => inspectSceneDynamics(bad), /步行带/);
  if (kind === "cyber-rain") {
    const sized = structuredClone(plan.scene);
    for (const car of sized.objs.filter((o) => o[0].includes(":skycar:"))) {
      car[4].length = 6;
      car[4].width = 3;
    }
    assert(
      inspectSceneDynamics(sized).sweeps > 0,
      "clearance accounts for maximum registered car dimensions",
    );
    const hit = structuredClone(plan.scene),
      car = hit.objs.find((o) => o[5].routeRole === "flight"),
      tower = hit.objs.find((o) => o[0].startsWith("building:tower:"));
    car[5].m.keys = [
      { t: 0, p: [tower[1] - 60, 10, tower[2]] },
      { t: 0.5, p: [tower[1] + 60, 10, tower[2]] },
      { t: 1, p: [tower[1] - 60, 10, tower[2]] },
    ];
    assert.throws(() => inspectSceneDynamics(hit), /扫掠/);
  } else {
    const hit = structuredClone(plan.scene),
      walker = hit.objs.find((o) => o[5].routeRole === "bridge");
    for (const k of walker[5].m.keys) k.p[1] -= 2;
    assert.throws(() => inspectSceneDynamics(hit), /拱面/);
  }
}
console.log(
  "PASS data-only anchor/face/distance/keep-out solver, cycles/conflicts/budgets/prototype rejection, swept crossings, 3 walking corridors, schedule determinism/seams, drift rejection and legacy timing",
);
