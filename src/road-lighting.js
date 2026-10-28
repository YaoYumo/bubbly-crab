import {buildRoadLightPools} from "./road-light-pools.js";
import * as THREE from "three";
import { buildStreetLamp } from "./street-lamp.js";
import { pointAtRoadProfile } from "./road-elevation.js";

// Fixtures belong to their road, not the scene's independent luminaire objects. A small
// fixed set of instanced draws per road; never one realtime point-light per fixture.
export function planRoadLamps(rd) {
  if (!rd.streetLights || !rd.curve?._terrainProfile) return [];
  const profile = rd.curve._terrainProfile,
    length = profile.points.at(-1)?.s || 0;
  if (length < 12) return [];
  const spacing = Math.max(8, Math.min(80, Number(rd.lampSpacing) || 24));
  const count = Math.min(
    256,
    Math.max(1, Math.floor((length - 12) / spacing) + 1),
  );
  const sides =
    rd.lampSide === "left" ? [1] : rd.lampSide === "right" ? [-1] : [-1, 1];
  const type = rd.roadType?.id || "asphalt";
  const base = ["asphalt", "oneway", "concrete"].includes(type)
    ? 0.32
    : type === "gravel"
      ? 0.2
      : type === "garden"
        ? 0.12
        : 0.17;
  const out = [],
    step = count === 1 ? 0 : Math.max(spacing, (length - 12) / 255);
  const margin = count === 1 ? length / 2 : (length - step * (count - 1)) / 2;
  for (let i = 0; i < count; i++) {
    const s = margin + i * step,
      t = s / length;
    // Keep fixtures out of junction cutouts, including corner/approach clearance.
    if (
      (rd.gaps || []).some(
        (g) => t >= g.t0 - 4 / length && t <= g.t1 + 4 / length,
      )
    )
      continue;
    const p = pointAtRoadProfile(profile, s);
    if (!p) continue;
    const edge = Math.max(
      0.5,
      profile.half - (type === "freeway" ? 1.2 : 0.55),
    );
    for (const side of sides)
      out.push({
        x: p.x + p.nx * edge * side,
        y: p.y + base,
        z: p.z + p.nz * edge * side,
        yaw: Math.atan2(p.nz * side, -p.nx * side),
        s,
        side,
      });
  }
  return out;
}

function clashesWithDeck(p, owner, roads) {
  for (const other of roads) {
    if (other.visible === false) continue;
    const profile = other._roadData.curve._terrainProfile;
    if (!profile) continue;
    for (let i = 1; i < profile.points.length; i++) {
      const a = profile.points[i - 1],
        b = profile.points[i],
        dx = b.x - a.x,
        dz = b.z - a.z;
      if (
        other === owner &&
        Math.abs((a.s + b.s) / 2 - p.s) < profile.half * 3 + 6
      )
        continue;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
      if (
        Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) >
        profile.half + 0.9
      )
        continue;
      const y = a.y + (b.y - a.y) * t;
      if (y + 0.4 >= p.y && y <= p.y + 6.2) return true;
    }
  }
  return false;
}

export function updateRoadLighting(app) {
  const roads = app.objects.filter((o) => o.type === "road_brush" && o.root);
  const signature = JSON.stringify(
    roads.map((o) => [
      o.id,
      o.root.uuid,
      o.visible,
      o._roadData.curve.uuid,
      o._roadData.streetLights,
      o._roadData.lampSpacing,
      o._roadData.lampSide,
    ]),
  );
  if (app.roadTerrain._lampSignature === signature) return;
  for (const o of roads) {
    app.appearance?.release(o.root);
    for (const child of [...o.root.children])
      if (child.userData.roadLamps) app.roadTerrain.dispose(child);
    const fixtures = planRoadLamps(o._roadData).filter(
      (p) => !clashesWithDeck(p, o, roads),
    );
    o.root.userData.roadLampCount = fixtures.length;
    if (!fixtures.length) {
      app.appearance?.apply(o);
      continue;
    }
    const prototype = buildStreetLamp({ poleHeight: 6 });
    const group = new THREE.Group();
    group.name = "road-lamps";
    group.userData.roadLamps = true;
    group.userData.glow = prototype.userData.glow;
    prototype.updateMatrixWorld(true);
    const transform = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0);
    prototype.traverse((part) => {
      if (!part.isMesh) return;
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        fixtures.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      fixtures.forEach((p, i) => {
        rotation.setFromAxisAngle(up, p.yaw);
        pos.set(p.x, p.y, p.z);
        transform.compose(pos, rotation, scale).multiply(part.matrixWorld);
        mesh.setMatrixAt(i, transform);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
    const pools=buildRoadLightPools(o._roadData,fixtures);if(pools)group.add(pools);
    o.root.add(group);
    app.appearance?.apply(o);
  }
  app.roadTerrain._lampSignature = signature;
  app.lighting?.applyGlow();
}
