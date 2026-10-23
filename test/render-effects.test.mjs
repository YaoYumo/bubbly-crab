import assert from "node:assert/strict";
import * as THREE from "three";
import {
  clusterGeometry,
  RenderLOD,
  lodSettings,
  LOD_DEFAULTS,
} from "../src/render-lod.js";
import { bloomSettings, BLOOM_DEFAULTS } from "../src/render-effects.js";
import { ModelInstancing } from "../src/model-instancing.js";
assert.deepEqual(lodSettings(), LOD_DEFAULTS);
assert.deepEqual(lodSettings(null), LOD_DEFAULTS);
assert.deepEqual(bloomSettings(), BLOOM_DEFAULTS);
assert.deepEqual(bloomSettings(null), BLOOM_DEFAULTS);
assert.equal(lodSettings({ near: 1000, far: NaN }).far, 1300);
assert.equal(bloomSettings({ strength: 99, threshold: -1 }).strength, 2);
const source = new THREE.SphereGeometry(3, 64, 40),
  normal = source.attributes.normal.array.slice(),
  position = source.attributes.position.array.slice();
const low = clusterGeometry(source, 10);
assert.ok(low && low.index.count < source.index.count * 0.8);
assert.deepEqual(source.attributes.position.array, position);
assert.deepEqual(source.attributes.normal.array, normal);
assert.equal(source.index.count, 64 * 39 * 6);
for (const a of Object.values(low.attributes))
  assert.ok(a.array.every(Number.isFinite));
source.computeBoundingBox();
assert.ok(source.boundingBox.containsBox(low.boundingBox));
const unsupported = source.clone();
unsupported.setAttribute(
  "custom",
  new THREE.BufferAttribute(
    new Float32Array(source.attributes.position.count),
    1,
  ),
);
assert.equal(clusterGeometry(unsupported, 10), null);
const app = {
  stage: {
    world: new THREE.Group(),
    renderer: { getSize: () => new THREE.Vector2(800, 600) },
  },
  objects: [],
  bus: { on() {} },
  lighting: { physical: { color: { sources: new WeakMap() } } },
};
app.modelInstancing = {
  geometryHashes: new WeakMap(),
  geometryHash: ModelInstancing.prototype.geometryHash,
};
const lod = new RenderLOD(app),
  mesh = new THREE.Mesh(source, new THREE.MeshStandardMaterial()),
  root = new THREE.Group();
root.add(mesh);
app.stage.world.add(root);
const so = { id: "fixed", root, item: { catId: "house" } };
root.userData.so = so;
app.objects.push(so);
const camera = new THREE.PerspectiveCamera(46, 4 / 3, 0.2, 3000);
camera.position.set(0, 0, 300);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
lod.configure({ enabled: true });
for (let i = 0; i < 4; i++) {
  lod.enter(camera);
  lod.exit();
}
await lod.work.drain();
lod.enter(camera);
assert.equal(lod.stats.far, 1);
assert.ok(lod.stats.simplifiedMeshes > 0);
assert.notEqual(mesh.geometry, source);
const generated = mesh.geometry;
lod.exit();
assert.equal(mesh.geometry, source);
assert.ok(mesh.visible);
// Same bytes reuse the same low geometry across distinct source objects.
const mesh2 = new THREE.Mesh(source.clone(), mesh.material),
  root2 = new THREE.Group();
root2.position.x = 8;
root2.add(mesh2);
app.stage.world.add(root2);
app.objects.push({ root: root2, item: { catId: "house" } });
lod.enter(camera); lod.exit();
await lod.work.drain();
lod.enter(camera);
assert.equal(mesh.geometry, mesh2.geometry);
lod.exit();
app.selObj = so;
lod.enter(camera);
assert.equal(mesh.geometry, source);
lod.exit();
app.selObj = null;
so.motion = { active: true };
lod.enter(camera);
assert.equal(mesh.geometry, source);
lod.exit();
so.motion.active = false;
mesh.material.transparent = true;
lod.enter(camera);
assert.equal(mesh.geometry, source);
lod.exit();
mesh.material.transparent = false;
camera.position.z = 30;
camera.updateMatrixWorld();
lod.enter(camera);
assert.equal(mesh.geometry, source);
lod.exit();
camera.position.z = 300;
camera.updateMatrixWorld();
const tiny = new THREE.Mesh(
  new THREE.BoxGeometry(0.01, 0.01, 0.01),
  mesh.material,
);
root.add(tiny);
lod.enter(camera);
assert.equal(tiny.visible, false);
lod.exit();
assert.equal(tiny.visible, true);
let released = 0;
generated.addEventListener("dispose", () => released++);
lod.invalidate();
assert.equal(released, 1);
assert.equal(lod.cache.size, 0);
assert.equal(lod.bytes, 0);
assert.equal(lod.swappedSet.size, 0);
source.dispose();
low.dispose();
unsupported.dispose();
mesh2.geometry.dispose();
mesh.material.dispose();
tiny.geometry.dispose();
console.log(
  "PASS defaults/clamps, finite clustered geometry + source immutability, seam attributes, shared cache, near/far + selected/dynamic/transparent fallback, tiny-detail restore, release",
);
