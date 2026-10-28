import * as THREE from "three";

// Render-only acceleration for static library buildings. Original SceneObjs remain the
// sole edit/pick/archive representation. Proxies borrow geometry/material; never own them.
const CATEGORIES = new Set(["house", "suburban", "functional"]);
const ids = new WeakMap();
let serial = 0;
const id = (o) => {
  if (!ids.has(o)) ids.set(o, ++serial);
  return ids.get(o);
};
function value(v) {
  if (v == null || ["string", "number", "boolean"].includes(typeof v)) return v;
  if (v.isColor || v.isVector2 || v.isVector3 || v.isVector4 || v.isEuler)
    return v.toArray();
  return ["identity", id(v)];
}
function sourceHooks(m, cameraColor) {
  const record = cameraColor?.sources?.get(m);
  return record &&
    record.wrapper === m.onBeforeCompile &&
    record.wrapperCache === m.customProgramCacheKey
    ? record
    : { compile: m.onBeforeCompile, cache: m.customProgramCacheKey };
}
function materialKey(m, cameraColor) {
  const hooks = sourceHooks(m, cameraColor);
  return Object.keys(m)
    .sort()
    .filter(
      (k) =>
        ![
          "id",
          "uuid",
          "version",
          "_listeners",
          "onBeforeCompile",
          "customProgramCacheKey",
        ].includes(k),
    )
    .map((k) => [
      k,
      ["defines", "extensions", "userData"].includes(k)
        ? Object.entries(m[k] || {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, value(v)])
        : value(m[k]),
    ])
    .concat([
      ["compile", id(hooks.compile)],
      ["cache", id(hooks.cache)],
    ]);
}
function orthogonal(m) {
  const e = m.elements,
    cols = [
      [e[0], e[1], e[2]],
      [e[4], e[5], e[6]],
      [e[8], e[9], e[10]],
    ];
  if (m.determinant() <= 0) return false;
  return cols.every((a, i) =>
    cols.every(
      (b, j) =>
        i === j ||
        Math.abs(a.reduce((s, x, k) => s + x * b[k], 0)) <=
          1e-6 * Math.hypot(...a) * Math.hypot(...b),
    ),
  );
}
const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function equalGeometry(a, b) {
  const aa = [
    ...Object.keys(a.attributes)
      .sort()
      .map((k) => a.attributes[k].array),
    a.index?.array,
  ];
  const bb = [
    ...Object.keys(b.attributes)
      .sort()
      .map((k) => b.attributes[k].array),
    b.index?.array,
  ];
  return aa.every((v, i) => {
    if (!v) return !bb[i];
    if (v.byteLength !== bb[i]?.byteLength) return false;
    const b = bytes(bb[i]);
    return bytes(v).every((x, j) => x === b[j]);
  });
}
export class ModelInstancing {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.dirty = true;
    this.batches = [];
    this.hidden = [];
    this.geometrySwaps = [];
    this.geometryHashes = new WeakMap();
    this.group = new THREE.Group();
    this.group.name = "model_render_instances";
    this.group.visible = false;
    app.stage.world.add(this.group);
    app.stage.modelInstancing = this;
    for (const event of ["objects", "light", "terrain"])
      app.bus.on(event, () => this.invalidate());
    const renderer = app.stage.renderer,
      original = renderer.render;
    const manager = this;
    renderer.render = function (scene, camera) {
      if (
        scene !== app.stage.scene ||
        app.stage.effects?.selectionRendering ||
        manager.rendering ||
        scene.overrideMaterial?.isShaderMaterial
      )
        return original.call(this, scene, camera);
      if (!(app.stage.effects?.lod.settings.enabled && app.stage.effects.lod.rendering)) manager.sync();
      try {
        manager.enter(camera);
        return original.call(this, scene, camera);
      } finally {
        manager.exit();
      }
    };
  }
  invalidate() {
    this.dirty = true;
    this.clear();
  }
  clear() {
    for (const b of this.batches) {
      b.proxy.removeFromParent();
      b.proxy.dispose();
    }
    this.batches = [];
    this.stats = { groups: 0, sourceMeshes: 0 };
    this.signature = null;
  }
  geometryHash(g) {
    const attrs = Object.keys(g.attributes).sort();
    const arrays = attrs.map((k) => g.attributes[k]).concat(g.index || []);
    const revision =
      JSON.stringify([
        g.groups,
        g.drawRange,
        attrs.map((k) => [
          k,
          g.attributes[k].itemSize,
          g.attributes[k].normalized,
        ]),
      ]) +
      arrays
        .map((a) => `${id(a)}:${a.version}:${id(a.array)}:${a.array.length}`)
        .join("|");
    const old = this.geometryHashes.get(g);
    if (old?.revision === revision) return old.hash;
    let h = 2166136261;
    for (const a of arrays)
      for (const n of bytes(a.array)) h = Math.imul(h ^ n, 16777619);
    const hash = JSON.stringify([
      h >>> 0,
      attrs.map((k) => {
        const a = g.attributes[k];
        return [k, a.itemSize, a.normalized, a.array.constructor.name, a.count];
      }),
      g.index?.array.constructor.name,
      g.groups,
      g.drawRange,
    ]);
    this.geometryHashes.set(g, { revision, hash });
    return hash;
  }
  sync() {
    if (this.rendering) return;
    const app = this.app;
    app.stage.world.updateWorldMatrix(true, true);
    const objects = app.objects.filter(
      (o) =>
        o.item && CATEGORIES.has(o.item.catId) && !o.item.anim && !o.isChar,
    );
    const signature = JSON.stringify([
      this.enabled,
      app.stage.perfMode,
      app.state.tex,
      ...objects.map((o) => [
        o.id,
        o.root.uuid,
        o.root.visible,
        o.materialMode,
        Math.floor(o.root.matrixWorld.elements[12] / 64),
        Math.floor(o.root.matrixWorld.elements[14] / 64),
        orthogonal(o.root.matrixWorld),
      ]),
    ]);
    if (!this.dirty && signature === this.signature) return;
    this.clear();
    this.dirty = false;
    this.signature = signature;
    if (!this.enabled) return;
    const buckets = new Map(),
      geometries = new Map(),
      materials = new WeakMap();
    let nextGeometry = 0;
    for (const so of objects) {
      if (
        !so.visible ||
        !so.root.visible ||
        so.root.renderOrder ||
        !orthogonal(so.root.matrixWorld)
      )
        continue;
      const e = so.root.matrixWorld.elements,
        cell = [Math.floor(e[12] / 64), Math.floor(e[14] / 64)];
      so.root.traverseVisible((mesh) => {
        const g = mesh.geometry,
          m = mesh.material;
        if (
          !mesh.isMesh ||
          mesh.isSkinnedMesh ||
          mesh.children.length ||
          !g?.attributes.position ||
          !m ||
          Array.isArray(m) ||
          m.transparent ||
          m.opacity !== 1 ||
          m.transmission > 0 ||
          m.blending !== THREE.NormalBlending ||
          !m.depthTest ||
          !m.depthWrite ||
          !m.visible ||
          mesh.instanceColor ||
          mesh.morphTexture ||
          mesh.morphTargetInfluences ||
          Object.keys(g.morphAttributes).length ||
          mesh.customDepthMaterial ||
          mesh.customDistanceMaterial ||
          mesh.userData.noMerge ||
          !orthogonal(mesh.matrixWorld)
        )
          return;
        const hooks = sourceHooks(m, app.lighting.physical.color);
        if (
          m.isShaderMaterial ||
          hooks.compile !== THREE.Material.prototype.onBeforeCompile ||
          hooks.cache !== THREE.Material.prototype.customProgramCacheKey
        )
          return;
        if (
          [
            "onBeforeRender",
            "onAfterRender",
            "onBeforeShadow",
            "onAfterShadow",
          ].some((k) => mesh[k] !== THREE.Mesh.prototype[k])
        )
          return;
        if (
          Object.values(g.attributes).some(
            (a) =>
              a.isInterleavedBufferAttribute ||
              a.usage !== THREE.StaticDrawUsage,
          )
        )
          return;
        for (let p = mesh.parent; p && p !== so.root; p = p.parent)
          if (p.renderOrder) return;
        const hash = this.geometryHash(g);
        let same = geometries.get(hash);
        if (!same) geometries.set(hash, (same = []));
        let geo = same.find((p) => equalGeometry(p.g, g));
        if (!geo) {
          geo = { g, id: ++nextGeometry };
          same.push(geo);
        }
        let mk = materials.get(m);
        if (!mk) {
          mk = materialKey(m, app.lighting.physical.color);
          materials.set(m, mk);
        }
        const key = JSON.stringify([
          so.key,
          cell,
          geo.id,
          mk,
          mesh.castShadow,
          mesh.receiveShadow,
          mesh.renderOrder,
          mesh.layers.mask,
          mesh.frustumCulled,
        ]);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ mesh, so });
      });
    }
    for (const members of buckets.values()) {
      // Across-object repetitions only: a lone building retains its normal render path.
      if (new Set(members.map((p) => p.so.id)).size < 2) continue;
      const first = members[0].mesh,
        count = members.reduce(
          (s, p) => s + (p.mesh.isInstancedMesh ? p.mesh.count : 1),
          0,
        );
      if (!count) continue;
      const proxy = new THREE.InstancedMesh(
        first.geometry,
        first.material,
        count,
      );
      proxy.name = "building_instances";
      proxy.userData.pickIgnore = true;
      proxy.userData.renderCategory = members[0].so.type;
      proxy.raycast = () => {};
      proxy.castShadow = first.castShadow;
      proxy.receiveShadow = first.receiveShadow;
      proxy.layers.mask = first.layers.mask;
      proxy.renderOrder = first.renderOrder;
      proxy.frustumCulled = first.frustumCulled;
      proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(proxy);
      this.batches.push({ members, proxy });
    }
    this.stats = {
      groups: this.batches.length,
      sourceMeshes: this.batches.reduce((n, b) => n + b.members.length, 0),
    };
  }
  enter(camera) {
    this.stats.activeGroups = 0;
    this.stats.activeSourceMeshes = 0;
    if (!this.batches.length || !orthogonal(this.group.matrixWorld)) {
      this.rendering = true;
      return;
    }
    // Keep original per-mesh culling when a spatial batch would straddle a camera /
    // shadow face. In particular, point-light cubemaps must not submit an entire
    // 64m block into several faces merely because its merged sphere crosses them.
    const stage = this.app.stage,
      frusta = [];
    camera.updateMatrixWorld();
    frusta.push({
      frustum: new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ),
      ),
      shadow: false,
    });
    stage.scene.updateMatrixWorld(true);
    if (
      stage.renderer.shadowMap.enabled &&
      (stage.renderer.shadowMap.autoUpdate ||
        stage.renderer.shadowMap.needsUpdate)
    )
      stage.scene.traverseVisible((light) => {
        if (
          !light.isLight ||
          !light.castShadow ||
          !light.shadow ||
          (!light.shadow.autoUpdate && !light.shadow.needsUpdate)
        )
          return;
        for (let face = 0; face < light.shadow.getViewportCount(); face++) {
          light.shadow.updateMatrices(light, face);
          frusta.push({
            frustum: light.shadow.getFrustum().clone(),
            shadow: true,
          });
        }
      });
    this.rendering = true;
    this.group.visible = true;
    const inverse = this.group.matrixWorld.clone().invert(),
      local = new THREE.Matrix4(),
      matrix = new THREE.Matrix4();
    for (const { members, proxy } of this.batches) {
      // Share a single low-detail geometry when every visible member agrees;
      // mixed near/far batches fall back to source rendering, never full-detail proxies.
      const lodGeometry = this.app.stage.effects?.lod;
      const replaced = members.some(({mesh})=>lodGeometry?.swappedSet.has(mesh));
      const geometries=replaced?new Set(members.filter(({mesh})=>mesh.visible).map(({mesh})=>mesh.geometry)):new Set();
      if(geometries.size>1){proxy.visible=false;continue;}
      const geometry=geometries.values().next().value;
      if(geometry && geometry!==proxy.geometry){this.geometrySwaps.push([proxy,proxy.geometry]);proxy.geometry=geometry;}
      const toHide = [];
      let i = 0;
      for (const { mesh } of members) {
        let visible = mesh.visible;
        for (let p = mesh.parent; p && p !== this.app.stage.world; p = p.parent)
          visible &&= p.visible;
        if (!visible || !orthogonal(mesh.matrixWorld)) continue;
        matrix.multiplyMatrices(inverse, mesh.matrixWorld);
        if (mesh.isInstancedMesh) {
          const transforms = [];
          for (let j = 0; j < mesh.count; j++) {
            mesh.getMatrixAt(j, local);
            transforms.push(
              new THREE.Matrix4().multiplyMatrices(matrix, local),
            );
          }
          if (transforms.some((t) => !orthogonal(t))) continue;
          for (const t of transforms) proxy.setMatrixAt(i++, t);
        } else proxy.setMatrixAt(i++, matrix);
        toHide.push(mesh);
      }
      proxy.count = i;
      proxy.visible = i > 0;
      proxy.instanceMatrix.needsUpdate = true;
      proxy.computeBoundingBox();
      proxy.computeBoundingSphere();
      let safe = true;
      if (proxy.frustumCulled) {
        const batchSphere = proxy.boundingSphere
            .clone()
            .applyMatrix4(this.group.matrixWorld),
          sphere = new THREE.Sphere();
        for (const { frustum, shadow } of frusta) {
          if (shadow && !proxy.castShadow) continue;
          let inside = 0;
          for (const mesh of toHide) {
            if (mesh.isInstancedMesh && mesh.boundingSphere === null)
              mesh.computeBoundingSphere();
            if (!mesh.geometry.boundingSphere)
              mesh.geometry.computeBoundingSphere();
            sphere
              .copy(
                mesh.isInstancedMesh
                  ? mesh.boundingSphere
                  : mesh.geometry.boundingSphere,
              )
              .applyMatrix4(mesh.matrixWorld);
            if (frustum.intersectsSphere(sphere)) inside++;
          }
          if (
            (inside > 0 && inside < toHide.length) ||
            (inside === 0 && frustum.intersectsSphere(batchSphere))
          ) {
            safe = false;
            break;
          }
        }
      }
      if (safe) {
        this.stats.activeGroups++;
        this.stats.activeSourceMeshes += toHide.length;
        for (const mesh of toHide) {
          this.hidden.push([mesh, mesh.visible]);
          mesh.visible = false;
        }
      } else proxy.visible = false;
    }
  }
  exit() {
    for(const [proxy,geometry]of this.geometrySwaps)proxy.geometry=geometry;
    this.geometrySwaps=[];
    for (const [mesh, visible] of this.hidden) mesh.visible = visible;
    this.hidden = [];
    this.group.visible = false;
    this.rendering = false;
  }
}
