import assert from "node:assert/strict";
import * as THREE from "three";
import { WeatherSystem, WEATHER } from "../src/weather.js";
const weather = new WeatherSystem(new THREE.Scene());
for (const type of ["rain", "storm", "snow"]) {
  for (const style of ["points", "streaks"]) {
    weather.set(type, { style, seed: 82 });
    const count = WEATHER.find((w) => w.id === type).count;
    const stride = weather.particles.isLineSegments ? 6 : 3;
    for (const y of [1.75, 80, 220, 1200, -300, 0]) {
      const camera = new THREE.Vector3(300, y, -250);
      weather.update(0, camera);
      const p = weather.geometry.attributes.position.array;
      let above = 0,
        below = 0;
      for (let i = 0; i < p.length; i += stride) {
        assert(Math.abs(p[i] - camera.x) <= weather.fieldHalf.x + 1e-4);
        assert(Math.abs(p[i + 1] - y) <= weather.fieldHalf.y + 1e-4);
        assert(Math.abs(p[i + 2] - camera.z) <= weather.fieldHalf.z + 1e-4);
        if (p[i + 1] > y) above++;
        else below++;
      }
      assert(
        above > count * 0.4 && below > count * 0.4,
        `${type}: altitude ${y} must surround the camera, not spawn one flat sheet`,
      );
      assert.equal(p.length / stride, count, "fixed particle budget");
    }
    // Inside particles remain world anchored when the camera moves; not glued to it.
    weather.update(0, new THREE.Vector3(0, 100, 0));
    const before = weather.geometry.attributes.position.array.slice();
    weather.update(0, new THREE.Vector3(1, 101, 1));
    const after = weather.geometry.attributes.position.array;
    let unchanged = 0;
    for (let i = 0; i < after.length; i += stride) {
      if (
        before[i] === after[i] &&
        before[i + 1] === after[i + 1] &&
        before[i + 2] === after[i + 2]
      )
        unchanged++;
    }
    assert(
      unchanged > count * 0.9,
      "camera move must not translate every drop",
    );
    // Both stock Three shader variants get world-space edge fade before output.
    const source = structuredClone(
      style === "streaks" && type === "rain"
        ? THREE.ShaderLib.basic
        : THREE.ShaderLib.points,
    );
    source.uniforms = {};
    weather.material.onBeforeCompile(source);
    assert(source.vertexShader.includes("vWeatherWorld = (modelMatrix"));
    assert(
      source.fragmentShader.includes("diffuseColor.a *= 1.0 - smoothstep"),
    );
    assert.equal(source.uniforms.weatherCenter.value, weather.center);
  }
}
weather.set("sand");
weather.update(0, new THREE.Vector3(0, 500, 0));
assert.equal(weather.center.y, 4, "dust remains ground-level");
weather.dispose();
console.log(
  "PASS camera-local precipitation: high/low altitude and teleports, world anchoring, no extra particles, Points/Line edge fade, ground-level dust",
);
