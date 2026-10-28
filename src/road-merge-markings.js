import * as T from "three";
import { roadDesignHeight } from "./road-contact.js";

// Compact mouths need lane-edge/merge guides, not a freeway zebra crossing.
// Place marks on the actual owning pavement, never on a flat world-Y plane.
export function addMergeMarkings(app, root, plan) {
  for (const child of [...root.children])
    if (child.name === "junction-merge-guides") {
      child.geometry?.dispose();
      child.material?.dispose();
      root.remove(child);
    }
  if (!plan.compact) return;
  const roots = [
    ...app.objects
      .filter((o) => o.type === "road_brush" && o.visible !== false)
      .map((o) => o.root),
    root,
  ];
  roots.forEach((r) => r.updateWorldMatrix(true, true));
  const ray = new T.Raycaster(),
    pos = [],
    f = plan.freeway;
  const arms = f
    ? plan.arms.filter((a) => a.curve === f.branchCurve)
    : plan.arms;
  const surface = (p, expected) => {
    ray.set(new T.Vector3(p.x, expected + 1, p.z), new T.Vector3(0, -1, 0));
    ray.far = 2;
    const hits = ray
      .intersectObjects(roots, true)
      .filter((h) => Math.abs(h.point.y - expected) < 0.35);
    return hits.length
      ? Math.max(...hits.map((h) => h.point.y)) + 0.008
      : expected;
  };
  let count = 0;
  for (const arm of arms) {
    const curve = arm.curve,
      L = Math.max(1, curve.getLength()),
      reach = Math.min(arm.available, Math.max(arm.c, 6) + 3);
    for (const side of [-1, 1])
      for (let s = 0.3; s < reach; s += 2.4) {
        const end = Math.min(s + 1.4, reach),
          steps = Math.ceil((end - s) / 0.35),
          rings = [];
        for (let i = 0; i <= steps; i++) {
          const distance = s + ((end - s) * i) / steps;
          const t = T.MathUtils.clamp(arm.t + (arm.sign * distance) / L, 0, 1),
            p = curve.getPointAt(t),
            d = curve.getTangentAt(t).setY(0).normalize(),
            n = new T.Vector3(d.z, 0, -d.x);
          const center = p
            .clone()
            .addScaledVector(n, Math.max(0.25, arm.pav - 0.2) * side);
          if (!plan.insideHull(center)) break;
          const expected = roadDesignHeight(curve, t) + 0.17;
          rings.push({
            expected,
            points: [-0.065, 0.065].map((w) => {
              const q = center.clone().addScaledVector(n, w);
              q.y = surface(q, expected);
              return q;
            }),
          });
        }
        if (rings.length !== steps + 1) continue;
        for (let i = 0; i < steps; i++) {
          const strip = [...rings[i].points, ...rings[i + 1].points],
            expected = (rings[i].expected + rings[i + 1].expected) / 2;
          for (const tri of [
            [0, 2, 1],
            [1, 2, 3],
          ]) {
            const center = tri
              .reduce((v, k) => v.add(strip[k]), new T.Vector3())
              .divideScalar(3);
            // A dash can cross a retained-deck/patch seam. Sample its interior too,
            // so a short piece is not buried beneath the higher owning pavement.
            const lift = Math.max(0, surface(center, expected) - center.y);
            for (const k of tri)
              pos.push(
                strip[k].x,
                strip[k].y + lift - root.position.y,
                strip[k].z,
              );
          }
        }
        count++;
      }
  }
  if (pos.length) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new T.Mesh(
      g,
      new T.MeshStandardMaterial({
        color: 0xf2f2ee,
        roughness: 0.8,
        side: T.DoubleSide,
      }),
    );
    m.name = "junction-merge-guides";
    m.userData.roadRole = "marking";
    root.add(m);
  }
  root.userData.mergeGuideSegments = count;
}
