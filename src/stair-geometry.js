import * as THREE from "three";
export function beamBetween(a, b, radius, material) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b),
    delta = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius,
      radius,
      Math.max(0.001, delta.length()),
      10,
    ),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return mesh;
}
const block = (w, h, d, material, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};
export function stairFlight({
  height,
  width,
  steps,
  going,
  material,
  railMaterial = material,
  rail = true,
}) {
  const group = new THREE.Group(),
    rise = height / steps,
    depth = steps * going,
    handHeight = 0.9;
  const treads = [],
    posts = [];
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * rise,
      z = (i + 0.5) * going;
    const tread = block(width, rise, going, material, 0, y - rise / 2, z);
    tread.name = "stair-tread";
    group.add(tread);
    treads.push({ y, z, start: i * going, end: (i + 1) * going });
    if (rail)
      for (const side of [-1, 1]) {
        const x = side * (width / 2 + 0.025);
        group.add(
          beamBetween(
            [x, y - 0.015, z],
            [x, y + handHeight, z],
            0.023,
            railMaterial,
          ),
        );
        posts.push([x, y + handHeight, z]);
      }
  }
  // Slope-cropped stringers: no underground protruding rectangle, no full-height side walls.
  const band = Math.min(height * 0.6, 0.28),
    shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo((band / height) * depth, 0);
  shape.lineTo(depth, height - band);
  shape.lineTo(depth, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.08,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.04);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(geometry, material);
    m.rotation.y = -Math.PI / 2;
    m.position.x = side * (width / 2 - 0.04);
    m.name = "stair-stringer";
    group.add(m);
  }
  if (rail)
    for (const side of [-1, 1])
      group.add(
        beamBetween(
          [side * (width / 2 + 0.025), rise + handHeight, going / 2],
          [side * (width / 2 + 0.025), height + handHeight, depth - going / 2],
          0.032,
          railMaterial,
        ),
      );
  group.userData.stairFlight = {
    height,
    width,
    steps,
    going,
    rise,
    depth,
    treads,
    posts,
  };
  return { g: group, depth, top: { y: height, z: depth } };
}
export function spiralStair({
  height,
  radius,
  postRadius,
  steps,
  turn,
  rail,
  material,
  railMaterial = material,
}) {
  const group = new THREE.Group(),
    rise = height / steps,
    delta = (turn * Math.PI * 2) / steps,
    outer = radius,
    inner = Math.min(postRadius, radius * 0.6);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(inner, inner, height + 0.12, 20),
    railMaterial,
  );
  column.position.y = (height + 0.12) / 2;
  group.add(column);
  const railPoints = [];
  for (let i = 0; i < steps; i++) {
    const a = i * delta,
      b = (i + 1) * delta,
      y = (i + 1) * rise,
      shape = new THREE.Shape();
    shape.moveTo(inner * Math.cos(a), inner * Math.sin(a));
    shape.lineTo(outer * Math.cos(a), outer * Math.sin(a));
    shape.absarc(0, 0, outer, a, b, false);
    shape.lineTo(inner * Math.cos(b), inner * Math.sin(b));
    shape.absarc(0, 0, inner, b, a, true);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: rise,
      bevelEnabled: false,
      curveSegments: Math.max(4, Math.ceil(delta * 12)),
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, y, 0);
    const tread = new THREE.Mesh(geometry, material);
    tread.name = "spiral-tread";
    group.add(tread);
    const mid = (a + b) / 2,
      x = (outer - 0.04) * Math.cos(mid),
      z = (outer - 0.04) * Math.sin(mid),
      top = [x, y + 0.9, z];
    if (rail) {
      group.add(beamBetween([x, y - 0.01, z], top, 0.022, railMaterial));
      railPoints.push(top);
    }
  }
  if (rail)
    for (let i = 1; i < railPoints.length; i++)
      group.add(
        beamBetween(railPoints[i - 1], railPoints[i], 0.032, railMaterial),
      );
  group.userData.spiralStair = {
    height,
    radius: outer,
    postRadius: inner,
    steps,
    turn,
    rise,
  };
  return group;
}
