import * as T from "three";
import { pointAtRoadProfile } from "./road-elevation.js";
import { roadProfile } from "./junction.js";
let texture;
// One shared CPU-prebaked falloff texture. This is an inexpensive illumination
// approximation, NOT an occlusion/GI bake or a realtime lamp/shadow per fixture.
export function roadLightTexture() {
  if (texture) return texture;
  const n = 64,
    data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * 2 - 1,
        v = ((y + 0.5) / n) * 2 - 1,
        r = u * u + v * v;
      const a = Math.max(0, Math.exp(-r * 3.8) - Math.exp(-3.8));
      const k = (y * n + x) * 4;
      data[k] = 255;
      data[k + 1] = 255;
      data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  texture = new T.DataTexture(data, n, n, T.RGBAFormat);
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  return texture;
}
export function buildRoadLightPools(rd, fixtures) {
  const profile = rd.curve._terrainProfile,
    pav = roadProfile(rd.roadType, rd.width).pav,
    pos = [],
    uv = [];
  for (const fixture of fixtures) {
    const center = pointAtRoadProfile(profile, fixture.s);
    if (!center) continue;
    const lateral =
      (fixture.x - center.x) * center.nx + (fixture.z - center.z) * center.nz;
    const side = fixture.side,
      acrossCenter = lateral - side * 2.8;
    for (let iz = 0; iz < 4; iz++)
      for (let ix = 0; ix < 4; ix++) {
        const corners = [];
        for (const [dx, dz] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const u = (ix + dx) / 4,
            v = (iz + dz) / 4,
            s = fixture.s + (v - 0.5) * 11;
          const p = pointAtRoadProfile(
            profile,
            Math.max(0, Math.min(profile.points.at(-1).s, s)),
          );
          const x = Math.max(
            -pav + 0.04,
            Math.min(pav - 0.04, acrossCenter + (u - 0.5) * 7),
          );
          corners.push({
            p: [
              p.x + p.nx * x,
              p.y +
                (rd.roadType.id === "garden"
                  ? 0.129
                  : rd.roadType.id === "gravel"
                    ? 0.209
                    : 0.179),
              p.z + p.nz * x,
            ],
            uv: [u, v],
          });
        }
        const station = fixture.s + ((iz + 0.5) / 4 - 0.5) * 11;
        if (
          (rd.gaps || []).some(
            (g) =>
              station / profile.points.at(-1).s >= g.t0 &&
              station / profile.points.at(-1).s <= g.t1,
          )
        )
          continue;
        for (const k of [0, 2, 1, 1, 2, 3]) {
          pos.push(...corners[k].p);
          uv.push(...corners[k].uv);
        }
      }
  }
  if (!pos.length) return null;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  const material = new T.MeshBasicMaterial({
    map: roadLightTexture(),
    color: 0xffcf83,
    transparent: true,
    opacity: 0,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = "road-prebaked-light-pools";
  mesh.raycast = () => {};
  mesh.userData.bakedRoadLightPool = true;
  mesh.userData.pickIgnore = true;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return mesh;
}
export function updateRoadLightPool(mesh, glow) {
  mesh.material.opacity = Math.min(0.65, Math.max(0, glow) * 0.4);
  mesh.visible = glow > 0.05;
}
