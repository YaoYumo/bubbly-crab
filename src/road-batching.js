import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Only freshly generated, owned road geometry is passed here. Keep span/endcap groups:
// they are the conservative collision volumes and carry endpoint metadata.
const identities = new WeakMap();
let nextIdentity = 1;
function identity(value) {
  if (!identities.has(value)) identities.set(value, nextIdentity++);
  return identities.get(value);
}
function materialKey(material) {
  // Compare all enumerable rendering properties, not rounded color/roughness guesses.
  // Shared textures/callbacks must have the same identity; unknown objects stay separate.
  return Object.keys(material)
    .sort()
    .filter(
      (k) => !["uuid", "id", "version", "_listeners", "userData"].includes(k),
    )
    .map((k) => {
      const v = material[k];
      let value;
      if (v == null || ["string", "boolean", "number"].includes(typeof v))
        value = v;
      else if (
        v.isColor ||
        v.isVector2 ||
        v.isVector3 ||
        v.isVector4 ||
        v.isEuler
      )
        value = v.toArray();
      else if (["defines", "extensions"].includes(k))
        value = Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [
            key,
            value == null ||
            ["string", "boolean", "number"].includes(typeof value)
              ? value
              : identity(value),
          ]);
      else value = identity(v);
      return [k, value];
    })
    .concat([
      [
        "userData",
        Object.entries(material.userData)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [
            k,
            v == null || ["string", "number", "boolean"].includes(typeof v)
              ? v
              : identity(v),
          ]),
      ],
      ["compile", identity(material.onBeforeCompile)],
      ["cache", identity(material.customProgramCacheKey)],
    ]);
}
const collisionParts = new WeakMap();
/** Preserve the pre-batch per-part collision boxes: merged render bounds can be wider.
 * Private weak records contain boxes/matrices only, not source meshes or geometry buffers. */
export function roadCollisionBounds(span) {
  const record = collisionParts.get(span);
  if (!record) return new THREE.Box3().setFromObject(span);
  span.updateWorldMatrix(true, true);
  const box = new THREE.Box3(),
    tmp = new THREE.Box3();
  const unchanged = span.matrixWorld.equals(record.world),
    delta = span.matrixWorld.clone().multiply(record.inverse),
    matrix = new THREE.Matrix4();
  for (const part of record.parts)
    box.union(
      tmp
        .copy(part.box)
        .applyMatrix4(
          unchanged ? part.world : matrix.multiplyMatrices(delta, part.world),
        ),
    );
  return box;
}
function captureCollision(span) {
  const parts = [];
  span.traverse((o) => {
    if (!o.geometry) return;
    let box;
    if (o.boundingBox !== undefined) {
      if (o.boundingBox === null) o.computeBoundingBox();
      box = o.boundingBox;
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box = o.geometry.boundingBox;
    }
    if (box && !box.isEmpty())
      parts.push({ box: box.clone(), world: o.matrixWorld.clone() });
  });
  return {
    parts,
    world: span.matrixWorld.clone(),
    inverse: span.matrixWorld.clone().invert(),
  };
}
export function batchRoadParts(road) {
  let removed = 0;
  for (const span of road.children) {
    if (span.userData.roadSupport) continue;
    span.updateWorldMatrix(true, true);
    const collision = captureCollision(span);
    const inverse = span.matrixWorld.clone().invert(),
      buckets = new Map(),
      sources = [];
    span.traverseVisible((mesh) => {
      const g = mesh.geometry,
        m = mesh.material;
      if (
        !mesh.isMesh ||
        mesh.isInstancedMesh ||
        mesh.isSkinnedMesh ||
        !g?.attributes.position ||
        !m ||
        Array.isArray(m) ||
        m.transparent ||
        m.opacity < 1 ||
        mesh.userData.noMerge ||
        Object.keys(g.morphAttributes).length ||
        g.isInstancedBufferGeometry ||
        g.drawRange.start !== 0 ||
        Number.isFinite(g.drawRange.count)
      )
        return;
      if (
        !m.isMeshStandardMaterial &&
        !m.isMeshBasicMaterial &&
        !m.isMeshPhongMaterial &&
        !m.isMeshLambertMaterial
      )
        return;
      if (
        m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        m.customProgramCacheKey !==
          THREE.Material.prototype.customProgramCacheKey
      )
        return;
      // A custom per-mesh callback or a nested sorting group may depend on mesh identity.
      if (
        mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
        mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
        mesh.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow ||
        mesh.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow
      )
        return;
      for (
        let parent = mesh.parent;
        parent && parent !== span;
        parent = parent.parent
      )
        if (parent.renderOrder) return;
      const matrix = inverse.clone().multiply(mesh.matrixWorld);
      if (matrix.determinant() <= 0) return;
      const attrs = Object.entries(g.attributes).map(([k, a]) => [
        k,
        a.itemSize,
        a.normalized,
        a.array?.constructor.name,
      ]);
      const key = JSON.stringify([
        materialKey(m),
        mesh.name,
        mesh.userData,
        attrs,
        !!g.index,
        mesh.castShadow,
        mesh.receiveShadow,
        mesh.renderOrder,
        mesh.layers.mask,
        mesh.frustumCulled,
      ]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ mesh, matrix });
    });
    for (const parts of buckets.values()) {
      if (parts.length < 2) continue;
      const inputs = parts.map(({ mesh, matrix }) => {
        const g = mesh.geometry.clone();
        g.applyMatrix4(matrix);
        return g;
      });
      const geometry = mergeGeometries(inputs, false);
      inputs.forEach((g) => g.dispose());
      if (!geometry) continue;
      collisionParts.set(span, collision);
      const first = parts[0].mesh,
        mesh = new THREE.Mesh(geometry, first.material);
      mesh.name = first.name;
      Object.assign(mesh.userData, first.userData);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.layers.mask = first.layers.mask;
      mesh.frustumCulled = first.frustumCulled;
      mesh.userData.roadBatchParts = parts.length;
      mesh.userData.detDone = 1;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      for (const part of parts) {
        part.mesh.removeFromParent();
        sources.push(part.mesh);
      }
      span.add(mesh);
      removed += parts.length - 1;
    }
    // Never dispose a source geometry/material still referenced by another part of the road.
    const liveGeometry = new Set(),
      liveMaterial = new Set();
    road.traverse((o) => {
      if (o.geometry) liveGeometry.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m) liveMaterial.add(m);
    });
    const geometries = new Set(sources.map((m) => m.geometry)),
      materials = new Set(sources.map((m) => m.material));
    for (const g of geometries) if (!liveGeometry.has(g)) g.dispose();
    for (const m of materials) if (!liveMaterial.has(m)) m.dispose();
  }
  return removed;
}
