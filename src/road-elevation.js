import * as THREE from "three";

export function validRoadPoints(points) {
  return (
    Array.isArray(points) &&
    points.length >= 2 &&
    points.length <= 2048 &&
    points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        p.every((v) => Number.isFinite(v) && Math.abs(v) <= 10000),
    ) &&
    points.some(
      (p, i) =>
        i &&
        Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]) > 0.01,
    )
  );
}

/** Resample by horizontal station, preserving every original corner and the two endpoints.
 * Smoothstep gives a ramp flat approaches; this is a layout tool, not civil engineering. */
export function roadElevationPreset(points, kind, start = 8, end = 8) {
  if (
    !validRoadPoints(points) ||
    !["elevated", "ramp"].includes(kind) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  )
    return null;
  if (kind === "elevated") return points.map((p) => [p[0], start, p[2]]);
  const stations = [0];
  for (let i = 1; i < points.length; i++)
    stations.push(
      stations.at(-1) +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][2] - points[i - 1][2],
        ),
    );
  const length = stations.at(-1);
  const stops = [
    ...new Set([
      ...stations,
      ...Array.from({ length: 17 }, (_, i) => (length * i) / 16),
    ]),
  ].sort((a, b) => a - b);
  let i = 1;
  return stops.map((s) => {
    while (i < points.length - 1 && stations[i] < s) i++;
    const f = (s - stations[i - 1]) / (stations[i] - stations[i - 1] || 1),
      t = s / length;
    return [
      points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f,
      start + (end - start) * t * t * (3 - 2 * t),
      points[i - 1][2] + (points[i][2] - points[i - 1][2]) * f,
    ];
  });
}

/** Shear freshly owned road geometry BEFORE mitering: cross-section ends keep a common
 * height across their full width, including vertical-grade changes. No pitch-shortening.
 * Unlike XZ height projection, station-based deformation also preserves stacked loops. */
export function shearRoadGrade(root, slope) {
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) return;
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert(),
    v = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const transform = new THREE.Matrix4().multiplyMatrices(
        rootInverse,
        m.matrixWorld,
      ),
      inverse = transform.clone().invert();
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(transform);
      v.y += v.z * slope;
      v.applyMatrix4(inverse);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  });
}

export function pointAtRoadProfile(profile, station) {
  const pts = profile?.points || [];
  if (pts.length < 2) return null;
  let lo = 0,
    hi = pts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s < station) lo = mid;
    else hi = mid;
  }
  const a = pts[lo],
    b = pts[hi],
    t = Math.max(0, Math.min(1, (station - a.s) / (b.s - a.s || 1)));
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    nx: -(b.z - a.z) / length,
    nz: (b.x - a.x) / length,
  };
}
