import assert from "node:assert/strict";
import * as THREE from "three";
import {
  worldAlignment,
  RoadSurfaceIndex,
  RoadDiagnostics,
  terrainSurfaceHeight,
} from "../src/road-diagnostics.js";
const root = new THREE.Group(),
  road = {
    root,
    _roadData: {
      curve: {
        _terrainProfile: {
          half: 4,
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 1, z: 0 },
            { x: 20, y: 2, z: 0 },
          ],
        },
      },
    },
  };
let r = worldAlignment(road);
assert.equal(r.length, 20);
assert.equal(r.maxGrade, 10);
assert.ok(Math.abs(r.length3D - 2 * Math.sqrt(101)) < 1e-10);
root.scale.set(2, 3, 1);
root.rotation.y = 0.7;
root.position.y = 7;
r = worldAlignment(road);
assert.ok(Math.abs(r.length - 40) < 1e-10);
assert.ok(Math.abs(r.maxGrade - 15) < 1e-10);
assert.equal(r.points[0].y, 7);
assert.equal(r.points.at(-1).y, 13);
road._roadData.curve._terrainProfile.points.reverse();
r = worldAlignment(road);
assert.ok(r.points[1].grade < 0);
const vertical = {
  root: new THREE.Group(),
  _roadData: {
    curve: {
      _terrainProfile: {
        half: 1,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 5, z: 0 },
        ],
      },
    },
  },
};
r = worldAlignment(vertical);
assert.equal(r.verticalSegments, 1);
assert.equal(r.points[1].grade, null);
const index = new RoadSurfaceIndex(),
  v = (x, y, z) => new THREE.Vector3(x, y, z);
index.add(v(-2, 5, -2), v(2, 5, -2), v(-2, 5, 2), "bridge");
index.add(v(-2, 6, -2), v(-2, 6, 2), v(2, 6, -2), "bridge");
assert.deepEqual(index.query(-1, -1).get("bridge").all, [5, 6]);
assert.equal(index.query(20, 20).size, 0);
assert.throws(
  () => index.add(v(0, 0, 0), v(100000, 0, 0), v(0, 0, 100000), "large"),
  /范围过大/,
);
console.log(
  "PASS metric horizontal distance / signed percent grade / affine transform / vertical segment / world triangle surfaces + underside / bounded spatial index",
);

assert.deepEqual(index.query(-1, -1).get("bridge").up, [6]);
const terrain = {
  enabled: true,
  n: 2,
  size: 2,
  h: new Float32Array([0, 4, 4, 0]),
  exaggerate: 1,
};
assert.equal(terrainSurfaceHeight(terrain, 0, 0), 4);
assert.equal(terrainSurfaceHeight(terrain, 1, 1), 0);
assert.equal(terrainSurfaceHeight(terrain, 2, 0), null);
const mirrored = new RoadSurfaceIndex();
mirrored.add(v(2, 6, -2), v(2, 6, 2), v(-2, 6, -2), "mirror", -1);
assert.deepEqual(mirrored.query(0, 0).get("mirror").up, [6]);

const meshGeometry = new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2);
for (let i = 0; i < 4; i++)
  meshGeometry.attributes.position.setY(i, terrain.h[i]);
const mesh = new THREE.Mesh(meshGeometry, new THREE.MeshBasicMaterial());
mesh.updateMatrixWorld(true);
const hit = new THREE.Raycaster(
  new THREE.Vector3(0, 10, 0),
  new THREE.Vector3(0, -1, 0),
).intersectObject(mesh)[0];
assert.ok(Math.abs(hit.point.y - terrainSurfaceHeight(terrain, 0, 0)) < 1e-8);
meshGeometry.dispose();
mesh.material.dispose();
console.log(
  "PASS upper-facing surfaces / mirrored normals / actual saddle-terrain triangle vs bilinear / outside extent excluded",
);

const service = new RoadDiagnostics({
  stage: { helperLayer: new THREE.Group() },
  bus: { on() {} },
});
assert.equal(service.configure("constructor", 10), false);
assert.equal(service.configure("maxGrade", NaN), false);
assert.equal(service.configure("maxGrade", -1), true);
assert.equal(service.options.maxGrade, 0.1);
assert.equal(service.configure("minClearance", 100), true);
assert.equal(service.options.minClearance, 30);
service.marker.geometry.dispose();
service.marker.material.dispose();
console.log("PASS threshold input validation and clamping");
