import assert from "node:assert/strict";
import * as THREE from "three";
import {
  WindowLights,
  WINDOW_DEFAULTS,
  windowSettings,
  windowRandom,
  windowSurface,
} from "../src/window-lights.js";
import { MaterialAppearance } from "../src/material-appearance.js";
import { CameraColor } from "../src/camera-color.js";
assert.deepEqual(windowSettings(), WINDOW_DEFAULTS);
assert.equal(windowSettings({ ratio: NaN, intensity: Infinity }).ratio, 0.65);
assert.equal(
  windowSettings({ seed: -8, ratio: 2, temperature: 999999 }).seed,
  0,
);
assert.equal(windowSettings({ ratio: 2 }).ratio, 1);
assert.equal(windowSettings({ ratio: "" }).ratio, 0.65);
const random = Array.from({ length: 1000 }, (_, i) =>
  windowRandom("permanent", 42, "window" + i),
);
assert.equal(random.filter((x) => x < 0.5).length > 430, true);
assert.deepEqual(
  random,
  Array.from({ length: 1000 }, (_, i) =>
    windowRandom("permanent", 42, "window" + i),
  ),
);
assert.notEqual(random[0], windowRandom("other", 42, "window0"));
const stage = {
  scene: new THREE.Scene(),
  world: new THREE.Group(),
  perfMode: false,
};
stage.scene.add(stage.world);
const app = {
  stage,
  state: { tex: true },
  objects: [],
  bus: { on() {}, emit() {} },
  lighting: {
    mode: "legacy",
    enabled: true,
    p: { glow: 2 },
    physical: { color: new CameraColor(stage) },
  },
  beginOp() {},
  saveLocal() {},
};
app.appearance = new MaterialAppearance(app);
const service = (app.windowLights = new WindowLights(app));
const root = new THREE.Group(),
  source = new THREE.MeshStandardMaterial({
    color: 0x88bbdd,
    transparent: true,
    opacity: 0.55,
  });
source.userData.role = "glass";
const geo = new THREE.BoxGeometry(1, 1, 0.02);
for (let i = 0; i < 20; i++) {
  const group = new THREE.Group();
  group.userData.role = "window";
  group.position.x = i * 2;
  group.add(new THREE.Mesh(geo, source));
  root.add(group);
}
stage.world.add(root);
const so = {
  id: "permanent",
  root,
  item: { catId: "house" },
  type: "adobe",
  params: {},
  materialMode: "inherit",
  visible: true,
};
app.objects.push(so);
app.appearance.apply(so);
assert.equal(
  windowSurface({ ...so, item: { catId: "traffic" } }, source),
  false,
);
service.configure({ mode: "on", ratio: 1 });
assert.equal(service.stats.units, 20);
assert.equal(service.stats.selected, 20);
assert.equal(source.emissive.getHex(), 0);
const state = service.states.get(root);
assert.equal(state.materials.size, 1);
assert.equal(root.children[0].children[0].geometry, geo);
service.configure({ ratio: 0 });
assert.equal(service.stats.selected, 0);
assert.equal(root.children[0].children[0].material.emissiveIntensity, 0);
service.configure({ ratio: 0.5, seed: 42 });
const selected = service.stats.selected;
assert.ok(selected > 0 && selected < 20);
assert.ok(state.materials.size <= 2);
service.sync();
assert.equal(service.stats.selected, selected);
app.appearance.setMode = () => {};
so.materialMode = "off";
app.appearance.apply(so);
service.configure({ mode: "legacy" });
assert.equal(service.states.size, 0);
assert.notEqual(
  root.children[0].children[0].material,
  source,
  "gray policy lost on legacy restore",
);
app.appearance.release(root);
assert.equal(root.children[0].children[0].material, source);
service.configure({ mode: "auto" });
assert.equal(service.factor(service.settings), 1);
app.lighting.p.glow = 0;
service.tick();
assert.equal(service.factor(service.settings), 0);
service.configure({ mode: "off" });
assert.equal(service.factor(service.settings), 0);
service.release(root);
assert.equal(service.states.size, 0);
assert.equal(root.children[0].children[0].material, source);
geo.dispose();
source.dispose();
console.log(
  "PASS window settings / deterministic occupancy / metadata scope / no source mutation / bounded material pairs / unchanged geometry / gray + legacy restore / day-night factor / release",
);
