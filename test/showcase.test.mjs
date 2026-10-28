import assert from "node:assert/strict";
import * as THREE from "three";
import { SHOWCASE_SCENES, riverX } from "../src/showcase-scenes.js";
import { validateAsset } from "../src/ai-scene-catalog.js";
import { cleanRiver } from "../src/terrain-river.js";
import { WeatherSystem, WEATHER } from "../src/weather.js";
let assets = 0;
for (const s of SHOWCASE_SCENES) {
  assert(s.authored);
  assert(s.shots.length >= 3);
  for (const [key, x, z, r, p, e] of s.objs) {
    const { light, ...geometryParams } = p;
    validateAsset(key, geometryParams);
    assets++;
    if (light) {
      assert.equal(light.mode, "on");
      assert(light.lumens > 0 && light.lumens <= 550);
      assert(light.range > 0 && light.range <= 60);
    }
    assert([x, z, r, e.y ?? 0].every(Number.isFinite));
    if (e.m) {
      assert(e.m.keys.length >= 2);
      assert.equal(e.follow, false);
      assert.equal(e.m.arc, false);
      assert(e.m.keys.flatMap((k) => k.p).every(Number.isFinite));
    }
  }
}
const [city, town] = SHOWCASE_SCENES;
assert(city.view.pos[1] < 2);
assert.equal(city.weather.type, "rain");
assert(city.light.fogDens >= 0.015);
assert.equal(city.objs.filter((o) => o[0].includes(":skycar:")).length, 9);
assert.equal(city.objs.filter((o) => o[0].startsWith("char:")).length, 20);
assert.equal(cleanRiver(town.river, town.terrain.size).points.length, 25);
for (const road of town.roads.filter((r) => r.id.includes("axis"))) {
  assert(road.points.every((p) => p[2] === 0));
  assert(road.points.every((p) => Math.abs(p[0]) >= 15)); // never lay a flat road across the water
}
const gate = town.objs.find((o) => o[0].includes(":paifang:"));
assert.equal(gate[2], 0);
assert.equal(gate[3], Math.PI / 2);
assert.equal(
  town.objs
    .filter((o) => o[0].includes(":lanterns:"))
    .reduce((n, o) => n + o[4].count, 0),
  108,
);
for (const o of town.objs.filter((o) => o[5].name === "第二进 · 街坊院落")) {
  assert(!(o[1] > riverX(o[2]) && Math.abs(o[2] + 68) < 22));
}
const weather = new WeatherSystem(new THREE.Scene());
for (const cfg of WEATHER)
  for (const style of ["points", "streaks"]) {
    weather.set(cfg.id, { style, seed: 0 });
    const stride = style === "streaks" && cfg.id === "rain" ? 6 : 3;
    assert.equal(
      weather.geometry.attributes.position.array.length,
      cfg.count * stride,
    );
    const initial = weather.geometry.attributes.position.array.slice();
    const json = weather.toJSON();
    assert.equal(json.seed, 0);
    weather.fromJSON(json);
    assert.deepEqual(weather.geometry.attributes.position.array, initial);
    for (let i = 0; i < 80; i++)
      weather.update(0.1, new THREE.Vector3(13, 5, 68));
    assert(weather.geometry.attributes.position.array.every(Number.isFinite));
    if (stride === 6) {
      const a = weather.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 6)
        assert(Math.abs(a[i + 4] - a[i + 1] - 0.85) < 1e-5);
    }
  }
weather.set("unknown");
assert.equal(weather.type, null);
assert.equal(weather.enabled, false);
assert.equal(weather.particles, null);
weather.fromJSON(null);
assert.equal(weather.type, null);
weather.dispose();
console.log(
  `PASS showcase data: ${assets} authored assets, river/axis/gate/plaza, all weather styles, deterministic seed 0, finite animation`,
);
