import assert from "node:assert/strict";
import * as THREE from "three";
import { PickSpatialIndex, resolvePick } from "../src/pick-spatial-index.js";
const stage = {
  world: new THREE.Group(),
  helperLayer: new THREE.Group(),
  groundPoint: () => new THREE.Vector3(1, 0, 2),
};
const index = new PickSpatialIndex(stage),
  ray = new THREE.Raycaster();
const geo = new THREE.BoxGeometry(2, 2, 2),
  material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
let checks = 0;
function root(x = 0, z = 0) {
  const r = new THREE.Group();
  r.position.set(x, 0, z);
  r.userData.so = {
    id: "object-" + checks,
    root: r,
    motion: { active: false },
  };
  r.add(new THREE.Mesh(geo, material));
  stage.world.add(r);
  return r;
}
function compare(origin = [0, 10, 0], direction = [0, -1, 0], expected) {
  stage.world.updateMatrixWorld(true);
  stage.helperLayer.updateMatrixWorld(true);
  ray.set(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
  );
  const raw = resolvePick(
    stage,
    ray.intersectObjects([stage.world, stage.helperLayer], true),
  );
  const actual = resolvePick(stage, index.intersections(ray));
  assert.equal(actual.kind, raw.kind);
  assert.equal(actual.so, raw.so);
  assert.equal(actual.object, raw.object);
  assert.equal(actual.shot, raw.shot);
  assert.equal(actual.i, raw.i);
  assert.equal(actual.objSo, raw.objSo);
  assert.ok(actual.point.distanceTo(raw.point) < 1e-7);
  assert.equal(actual.distance, raw.distance);
  if (expected) assert.equal(actual.kind, expected);
  checks++;
  return actual;
}
function reset() {
  stage.world.clear();
  stage.helperLayer.clear();
  index.invalidate("test");
  ray.layers.set(0);
  ray.near = 0;
  ray.far = Infinity;
}
reset();
compare(undefined, undefined, "empty");
const first = root(),
  second = root();
assert.equal(compare().so, first.userData.so, "equal-distance order");
first.visible = false;
assert.equal(compare().so, first.userData.so, "legacy ignores visibility");
first.children[0].userData.pickIgnore = true;
assert.equal(compare().so, second.userData.so);
first.children[0].userData.pickIgnore = false;
first.children[0].userData.keyRef = { i: 4, objSo: first.userData.so };
compare(undefined, undefined, "key");
delete first.children[0].userData.keyRef;
first.layers.set(2);
first.children[0].layers.set(2);
compare();
ray.layers.enable(2);
compare();
ray.near = 10;
compare();
ray.near = 0;
ray.far = 3;
compare(undefined, undefined, "empty");
ray.far = Infinity;
reset();
const shot = new THREE.Group();
shot.userData.shotRef = { id: "shot" };
shot.add(new THREE.Mesh(geo, material));
stage.helperLayer.add(shot);
compare(undefined, undefined, "shot");
const key = new THREE.Mesh(geo, material);
key.position.y = 2;
key.userData.keyRef = { shot: shot.userData.shotRef, i: 2 };
stage.helperLayer.add(key);
compare(undefined, undefined, "key");
reset();
const ground = new THREE.Mesh(geo, material);
ground.userData.ground = true;
stage.world.add(ground);
compare(undefined, undefined, "ground");
const terrain = new THREE.Mesh(geo, material);
terrain.position.y = 3;
terrain.userData.terrain = true;
stage.world.add(terrain);
compare(undefined, undefined, "ground");
assert.equal(index.stats.ignoredRoots, 1);
terrain.userData.ground = true;
compare();
assert.equal(index.stats.ignoredRoots, 0);
reset();
const moved = root();
compare();
moved.position.set(30, 2, -5);
moved.rotation.set(0.2, 0.5, -0.3);
moved.scale.set(-2, 0.7, 3);
assert.equal(compare([30, 20, -5]).so, moved.userData.so);
assert.equal(index.stats.refit, true);
assert.equal(index.stats.cold, false);
compare([30, 20, -5]);
assert.equal(index.stats.refit, false);
// Children matrices must follow a root transform even before the next render.
moved.position.set(60, 2, -5);
ray.set(new THREE.Vector3(60, 20, -5), new THREE.Vector3(0, -1, 0));
assert.equal(
  resolvePick(stage, index.intersections(ray)).so,
  moved.userData.so,
);
checks++;
moved.children[0].position.x = 30;
index.invalidate("child edit");
compare([0, 20, 0]);
assert.equal(index.stats.cold, true);
const own = geo.clone();
moved.children[0].geometry = own;
own.translate(0, 40, 0);
index.invalidate("geometry edit");
compare([60, 80, -5]);
const replacement = root(2, 2);
stage.world.remove(moved);
compare([2, 20, 2]);
assert.ok(index.entries.every((e) => e.root !== moved));
replacement.userData.so.motion.active = true;
compare([2, 20, 2]);
assert.equal(index.stats.indexedRoots, 0);
replacement.position.x = 8;
compare([8, 20, 2]);
replacement.userData.so.motion.active = false;
replacement.userData.so.isChar = true;
compare();
assert.equal(index.stats.fallbackRoots, 1);
reset();
const instances = root();
instances.clear();
const im = new THREE.InstancedMesh(geo, material, 2);
im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
im.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-10, 0, 0));
instances.add(im);
compare([10, 10, 0], undefined, "obj");
compare([-10, 10, 0], undefined, "obj");
compare();
assert.equal(index.stats.indexedRoots, 1);
im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(30, 0, 0));
im.instanceMatrix.needsUpdate = true;
im.computeBoundingSphere();
index.invalidate("instance edit");
compare([30, 10, 0], undefined, "obj");
im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
index.invalidate();
compare();
assert.equal(index.stats.fallbackRoots, 1);
compare();
assert.equal(index.stats.cold, false, "fallback must not repeatedly rebuild");
reset();
const custom = root();
custom.children[0].raycast = function (rc, hits) {
  hits.push({
    object: this,
    point: rc.ray.at(2, new THREE.Vector3()),
    distance: 2,
  });
};
compare([300, 20, 0], undefined, "obj");
assert.equal(index.stats.fallbackRoots, 1);
compare();
assert.equal(index.stats.cold, false);
stage.world.raycast = function () {
  return false;
};
compare(undefined, undefined, "empty");
assert.equal(index.stats.indexed, false);
delete stage.world.raycast;
reset();
const morph = root();
morph.children[0].morphTargetInfluences = [0];
compare();
assert.equal(index.stats.fallbackRoots, 1);
delete morph.children[0].morphTargetInfluences;
morph.scale.setScalar(0);
index.invalidate();
compare();
assert.equal(index.stats.fallbackRoots, 1);
reset();
root();
const original = index.localBounds;
index.localBounds = () => {
  throw Error("intentional index failure");
};
compare();
assert.equal(index.stats.indexed, false);
assert.match(index.stats.reason, /intentional/);
index.localBounds = original;
compare();
index.enabled = false;
compare();
assert.equal(index.stats.indexed, false);
index.enabled = true;
// A seeded dense, nested and transformed scene: compare many hit + miss rays.
reset();
let seed = 731;
const rng = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
for (let z = 0; z < 18; z++)
  for (let x = 0; x < 18; x++) {
    const r = root(x * 8 - 68, z * 8 - 68);
    r.rotation.y = rng() * 6.28;
    r.scale.set(0.5 + rng() * 2, 0.5 + rng() * 3, 0.5 + rng() * 2);
    const group = new THREE.Group();
    group.position.set(0, 3, 0);
    r.add(group);
    for (let j = 0; j < 4; j++) {
      const m = new THREE.Mesh(geo, material);
      m.position.set((j % 2) * 2, Math.floor(j / 2) * 2, 0);
      group.add(m);
    }
  }
for (let i = 0; i < 600; i++)
  compare(
    [rng() * 180 - 90, 20 + rng() * 60, rng() * 180 - 90],
    [rng() * 0.2 - 0.1, -1, rng() * 0.2 - 0.1],
  );
assert.ok(index.stats.candidates < index.stats.roots / 10);
// Deep edits follow the same explicit invalidation contract as application events.
reset();
const nested = root();
nested.children[0].position.x = 10;
assert.equal(compare([10, 20, 0]).so, nested.userData.so);
nested.children[0].position.x = 20;
index.invalidate("nested transform");
assert.equal(compare([20, 20, 0]).so, nested.userData.so);
const edited = geo.clone();
nested.children[0].geometry = edited;
edited.translate(20, 0, 0);
index.invalidate("nested geometry");
assert.equal(compare([40, 20, 0]).so, nested.userData.so);
stage.world.position.x = 50;
stage.world.rotation.y = 0.4;
const center = nested.children[0].localToWorld(new THREE.Vector3(20, 0, 0));
compare([center.x, 40, center.z]);
stage.world.position.set(0, 0, 0);
stage.world.rotation.set(0, 0, 0);
reset();
const a = root(),
  b = root();
assert.equal(compare().so, a.userData.so);
stage.world.remove(a);
stage.world.add(a);
assert.equal(compare().so, b.userData.so);
reset();
ray.camera = new THREE.PerspectiveCamera();
for (const node of [
  new THREE.Line(geo, material),
  new THREE.Points(geo, material),
  new THREE.Sprite(),
]) {
  const r = root();
  r.clear();
  r.add(node);
  index.invalidate();
  compare([100, 20, 0]);
  assert.equal(index.entries.find((e) => e.root === r).mode, "fallback");
}
const skin = root();
skin.clear();
skin.add(new THREE.SkinnedMesh(geo, material));
index.invalidate();
index.sync();
assert.equal(index.entries.find((e) => e.root === skin).mode, "fallback");
edited.dispose();
index.invalidate("release");
assert.equal(index.entries.length, 0);
assert.equal(index.tree, null);
geo.dispose();
own.dispose();
material.dispose();
console.log(
  `PASS ${checks} exact-pick comparisons / ties / ignore / hidden / layers / near-far / keys / shots / ground / terrain / transforms / descendants / geometry / delete / dynamic fallback / instances / custom raycasts / singular / failure / toggle / release`,
);
