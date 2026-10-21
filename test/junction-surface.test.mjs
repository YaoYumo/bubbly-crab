import assert from "node:assert/strict";
import * as THREE from "three";
import Clipper from "clipper-lib";
import { junctionPlan, buildJunction, roadProfile } from "../src/junction.js";
const area = (p) =>
  Math.abs(
    p.reduce((n, a, i) => {
      const b = p[(i + 1) % p.length];
      return n + a.x * b.z - b.x * a.z;
    }, 0) / 2,
  );
for (const degrees of [90, 60, 45, 30, 20, 15])
  for (const count of [3, 4]) {
    const rad = (degrees * Math.PI) / 180;
    const angles =
      count === 4 ? [0, Math.PI, rad, rad + Math.PI] : [0, Math.PI, rad];
    const arms = angles.map((a, i) => ({
      dir: { x: Math.cos(a), z: Math.sin(a) },
      ...roadProfile({ id: "asphalt" }, i < 2 ? 12 : 8),
      roadType: { id: "asphalt" },
    }));
    const p = junctionPlan({ x: 123, z: -87 }, arms),
      g = buildJunction(p),
      face = g.getObjectByName("junction_face"),
      pos = face.geometry.attributes.position;
    let triangleArea = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i),
        b = new THREE.Vector3().fromBufferAttribute(pos, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      triangleArea +=
        new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a))
          .length() / 2;
    }
    const toPath = (ring) => {
      const r = ring.map((p) => ({
        X: Math.round(p.x * 1e5),
        Y: Math.round(p.z * 1e5),
      }));
      if (!Clipper.Clipper.Orientation(r)) r.reverse();
      return r;
    };
    const clip = new Clipper.Clipper(),
      intersection = [];
    clip.AddPaths(
      p.walks.map((w) => toPath(w.poly)),
      Clipper.PolyType.ptSubject,
      true,
    );
    clip.AddPath(toPath(p.hull), Clipper.PolyType.ptClip, true);
    clip.Execute(
      Clipper.ClipType.ctIntersection,
      intersection,
      Clipper.PolyFillType.pftNonZero,
      Clipper.PolyFillType.pftNonZero,
    );
    const walkArea =
      intersection.reduce((n, p) => n + Clipper.Clipper.Area(p), 0) / 1e10;
    assert.ok(
      Math.abs(triangleArea + walkArea - area(p.hull)) < 0.02,
      `${degrees}/${count} surface area mismatch`,
    );
    const ray = new THREE.Raycaster();
    for (const w of p.walks) {
      const center = w.poly.reduce(
        (v, p) =>
          v.add(new THREE.Vector3(p.x / w.poly.length, 0, p.z / w.poly.length)),
        new THREE.Vector3(),
      );
      ray.set(
        center.clone().add(new THREE.Vector3(0, 2, 0)),
        new THREE.Vector3(0, -1, 0),
      );
      assert.equal(
        ray.intersectObject(face).length,
        0,
        `${degrees}/${count} hidden asphalt under sidewalk`,
      );
    }
    g.traverse((o) => {
      o.geometry?.dispose();
    });
    new Set(g.children.map((m) => m.material)).forEach((m) => m?.dispose());
  }
console.log(
  "PASS junction asphalt subtraction, area conservation and sidewalk ray coverage: 6 angles × T/four-way × unequal widths",
);
