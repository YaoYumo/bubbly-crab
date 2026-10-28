import assert from "node:assert/strict";
import * as T from "three";
import {
  roadElevationPreset,
  validRoadPoints,
  shearRoadGrade,
  pointAtRoadProfile,
} from "../src/road-elevation.js";
import { planRoadLamps } from "../src/road-lighting.js";
assert.ok(
  validRoadPoints([
    [0, 0, 0],
    [0, 8, 50],
  ]),
);
assert.equal(
  validRoadPoints([
    [0, 0, 0],
    [NaN, 0, 50],
  ]),
  false,
);
assert.equal(
  validRoadPoints([
    [0, 0, 0],
    [0, 8, 0],
  ]),
  false,
);
const points = [
    [0, 0, 0],
    [0, 0, 40],
    [30, 0, 40],
  ],
  original = JSON.stringify(points);
const ramp = roadElevationPreset(points, "ramp", 0.02, 8.02);
assert.deepEqual(ramp[0], [0, 0.02, 0]);
assert.deepEqual(ramp.at(-1), [30, 8.02, 40]);
assert.ok(ramp.some((p) => p[0] === 0 && p[2] === 40));
assert.ok(ramp.every((p, i) => !i || p[1] >= ramp[i - 1][1]));
assert.equal(JSON.stringify(points), original);
assert.ok(
  roadElevationPreset(points, "ramp", 8, 0).every(
    (p, i, a) => !i || p[1] <= a[i - 1][1],
  ),
);
assert.deepEqual(roadElevationPreset(points, "elevated", 10), [
  [0, 10, 0],
  [0, 10, 40],
  [30, 10, 40],
]);
assert.equal(roadElevationPreset(points, "ramp", NaN, 8), null);
// Grade shear: full-width endpoint cross-sections meet at exact heights, no pitch shortening.
const g = new T.Group(),
  m = new T.Mesh(new T.BoxGeometry(8, 0.2, 20));
m.position.y = 0.1;
g.add(m);
shearRoadGrade(g, 0.4);
m.updateMatrixWorld(true);
const v = new T.Vector3(),
  pos = m.geometry.attributes.position;
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
  assert.ok(Math.abs(Math.abs(v.z) - 10) < 1e-6);
  assert.ok(
    Math.min(Math.abs(v.y - v.z * 0.4), Math.abs(v.y - v.z * 0.4 - 0.2)) < 1e-6,
  );
}
const profile = {
  half: 6,
  points: [
    { x: 0, y: 0, z: 0, s: 0 },
    { x: 0, y: 8, z: 120, s: 120 },
  ],
};
assert.deepEqual(pointAtRoadProfile(profile, 60), {
  x: 0,
  y: 4,
  z: 60,
  nx: -1,
  nz: 0,
});
const rd = {
  streetLights: true,
  lampSpacing: 24,
  lampSide: "both",
  curve: { _terrainProfile: profile },
  gaps: [],
};
const plan = planRoadLamps(rd);
assert.equal(plan.length, 10);
for (const p of plan) {
  assert.ok(Math.abs(p.y - ((p.z / 120) * 8 + 0.32)) < 1e-9);
  assert.ok(Math.abs(Math.abs(p.x) - 5.45) < 1e-9);
}
assert.equal(planRoadLamps({ ...rd, lampSide: "left" }).length, 5);
assert.equal(planRoadLamps({ ...rd, streetLights: false }).length, 0);
assert.ok(
  planRoadLamps({ ...rd, gaps: [{ t0: 0.35, t1: 0.65 }] }).length < plan.length,
);
assert.ok(
  planRoadLamps({
    ...rd,
    curve: {
      _terrainProfile: {
        ...profile,
        points: [
          { x: 0, y: 0, z: 0, s: 0 },
          { x: 0, y: 0, z: 100000, s: 100000 },
        ],
      },
    },
  }).length <= 512,
);
console.log(
  "PASS road elevation presets / exact endpoints + original corners / input validation / grade shear + full-width section heights / lamp spacing, side, grade, gaps and bounded instances",
);
