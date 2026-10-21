import assert from "node:assert/strict";
import { parsePromptLocally } from "../src/towngen.js";
import { parseSceneIntent } from "../src/scene-intent.js";
import {
  compileSceneRecipe,
  normalizeSceneRecipe,
  recipePlanSVG,
  validateRecipeScene,
} from "../src/scene-recipes.js";
import { SHOWCASE_SCENES } from "../src/showcase-scenes.js";
import { SCENE_KITS } from "../src/scene-kits.js";
const original = JSON.stringify(SHOWCASE_SCENES);
const prompts = [
  "赛博都市，高楼压迫，8辆悬浮车，20位行人，大雾下雨，夜景，种子82",
  "中式古城，建筑沿河两岸，河宽16米，石拱桥，中轴线道路，牌楼跨街，佛塔，120盏孔明灯，夜景，种子42",
];
for (const prompt of prompts) {
  const parsed = parsePromptLocally(prompt);
  assert(parsed.schema.sceneRecipe);
  assert.equal(parsed.unsupported.length, 0);
  const p = compileSceneRecipe(parsed.schema.sceneRecipe);
  assert(p.summary.kits > 0);
  assert(p.checks.routeSamples > 0);
  assert.equal(
    JSON.stringify(p),
    JSON.stringify(compileSceneRecipe(parsed.schema.sceneRecipe)),
  );
  assert(!recipePlanSVG(p).includes("<script"));
  assert(recipePlanSVG(p).includes("<svg"));
}
assert.equal(parseSceneIntent("现代住宅区，棋盘格，商业20%"), null);
assert.equal(parseSceneIntent("中轴对称的仿古小镇，棋盘格局"), null);
assert(
  parsePromptLocally("赛博都市，地下铁和太空飞船").unsupported.some(
    (x) => x.hint === "轨道交通",
  ),
);
let runs = 0;
for (const kind of ["cyber-rain", "lantern-river"])
  for (let seed = 1; seed <= 24; seed++) {
    const p = compileSceneRecipe({
      kind,
      values: {
        seed,
        size: [256, 320, 384][seed % 3],
        density: [0.2, 0.65, 1][seed % 3],
        riverWidth: [12, 16, 20][seed % 3],
        cars: seed % 13,
        people: seed % 49,
        lanterns: seed % 2 ? 0 : 180,
      },
    });
    assert(p.scene.objs.length <= 240);
    assert(p.scene.objs.every((o) => o[5].follow === false));
    if (kind === "cyber-rain")
      assert.equal(
        p.scene.objs.filter((o) => o[0].includes(":skycar:")).length,
        seed % 13,
      );
    else {
      assert.equal(
        p.scene.objs
          .filter((o) => o[0].includes(":lanterns:"))
          .reduce((sum, o) => sum + o[4].count, 0),
        seed % 2 ? 0 : 180,
      );
      assert.equal(p.scene.river.width, [12, 16, 20][seed % 3]);
    }
    const people = p.scene.objs.filter((o) => o[0].startsWith("char:"));
    assert.equal(people.length, seed % 49);
    for (const host of p.scene.objs.filter(
      (o) => o[5].assembly?.role === "host",
    )) {
      const part = p.scene.objs.find(
        (o) =>
          o[5].assembly?.instance === host[5].assembly.instance &&
          o[5].assembly.role === "attachment",
      );
      assert(part);
      assert.equal(part[3], host[3]);
    }
    runs++;
  }
// Independent boundary combinations, including the actor maxima absent from the seed sweep.
for (const kind of ["cyber-rain", "lantern-river"])
  for (const seed of [1, 42, 82])
    for (const size of [256, 320, 384])
      for (const density of [0.2, 0.65, 1])
        for (const riverWidth of [12, 16, 20]) {
          const p = compileSceneRecipe({
            kind,
            values: {
              seed,
              size,
              density,
              riverWidth,
              cars: 12,
              people: 48,
              lanterns: 180,
            },
          });
          assert.equal(
            p.scene.objs.filter((o) => o[0].startsWith("char:")).length,
            48,
          );
          assert(p.scene.objs.length <= 240);
          if (kind === "lantern-river")
            assert.equal(p.checks.reservedLandmarks, true);
          runs++;
        }
const a = compileSceneRecipe({ kind: "cyber-rain", values: { seed: 1 } }),
  b = compileSceneRecipe({ kind: "cyber-rain", values: { seed: 2 } });
assert.notDeepEqual(
  a.scene.objs.map((o) => [o[1], o[2], o[4].floors]),
  b.scene.objs.map((o) => [o[1], o[2], o[4].floors]),
  "seed changes actual street spacing/building masses, not just colors",
);
for (const kind of ["cyber-rain", "lantern-river"]) {
  const small = compileSceneRecipe({ kind, values: { seed: 82, size: 256 } });
  const large = compileSceneRecipe({ kind, values: { seed: 82, size: 384 } });
  assert.notDeepEqual(
    small.scene.objs,
    large.scene.objs,
    "size changes actual layout",
  );
  const sparse = compileSceneRecipe({
    kind,
    values: { seed: 82, density: 0.2 },
  });
  const dense = compileSceneRecipe({ kind, values: { seed: 82, density: 1 } });
  assert(
    dense.scene.objs.length > sparse.scene.objs.length,
    "density changes building count",
  );
}
const invaded = compileSceneRecipe({
  kind: "lantern-river",
  values: { seed: 82 },
}).scene;
const tower = invaded.objs.find((o) => o[0].includes(":pagoda:"));
const house = invaded.objs.find((o) => o[0].includes(":streetshop:"));
house[1] = tower[1];
house[2] = tower[2];
assert.throws(() => validateRecipeScene(invaded), /佛塔保留场地/);
const c = compileSceneRecipe(
  parseSceneIntent("赛博都市，晴天无雾，白天，无车，无人，鸟瞰"),
);
assert.equal(c.scene.weather, null);
assert.equal(c.scene.light.fogDens, 0);
assert.equal(c.scene.atmos, "noon");
assert.equal(c.options.cars, 0);
assert.equal(c.options.people, 0);
assert.deepEqual(c.scene.shots[0].from, c.scene.view.pos);
const d = compileSceneRecipe(
  parseSceneIntent("中式古城沿河，直河，河宽12米，无孔明灯"),
);
assert(d.scene.river.points.every((p) => p[0] === 0));
assert.equal(d.options.lanterns, 0);
const bounded = normalizeSceneRecipe({
  kind: "lantern-river",
  values: { riverWidth: 99, lanterns: 999, size: 2048, floors: 100 },
});
assert(bounded.warnings.length >= 4);
assert.equal(bounded.options.riverWidth, 20);
assert.throws(() => compileSceneRecipe({ kind: "bad", values: {} }));
assert.throws(() =>
  compileSceneRecipe({ kind: "cyber-rain", values: { seed: NaN } }),
);
assert.equal(
  JSON.stringify(SHOWCASE_SCENES),
  original,
  "curated golden scenes are not mutated",
);
assert.equal(SCENE_KITS.length, 2);
console.log(
  `PASS ${runs} seeded parametric layouts, exact actor counts, facade anchors, spatial checks, weather/fog/day overrides, safe bounds, legacy routing, golden fixtures unchanged`,
);
