import * as THREE from "three";
import { IdleWork } from "./idle-work.js";

export const LOD_DEFAULTS = Object.freeze({
  enabled: false,
  near: 90,
  far: 200,
  pixels: 1.5,
});
const number = (v, d, min, max) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : d;
export function lodSettings(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const near = number(value.near, 90, 20, 1000);
  return {
    enabled: value.enabled === true,
    near,
    far: number(value.far, Math.max(200, near * 1.3), near * 1.3, 3000),
    pixels: number(value.pixels, 1.5, 0.25, 4),
  };
}
const categories = new Set(["house", "suburban", "functional", "city"]);
const triangles = (g) => (g.index?.count ?? g.attributes.position.count) / 3;

// Linear vertex clustering, not a topology-preserving mesh decimator. Preserve
// hard-normal / UV tile / color seams; unsupported attributes fail closed.
export function clusterGeometry(source, cells) {
  const job = clusterSteps(source, cells);
  let step;
  do { step = job.next(); } while (!step.done);
  return step.value;
}
function* clusterSteps(source, cells) {
  const attributes = Object.entries(source.attributes),
    p = source.attributes.position;
  if (
    !p ||
    p.itemSize !== 3 ||
    (source.index?.count ?? p.count) % 3 !== 0 ||
    p.count < 120 ||
    p.count > 12000 ||
    Object.keys(source.morphAttributes).length ||
    source.drawRange.start !== 0 ||
    source.drawRange.count !== Infinity ||
    attributes.some(
      ([key, a]) =>
        !["position", "normal", "uv", "color"].includes(key) ||
        a.isInterleavedBufferAttribute ||
        a.normalized ||
        a.usage !== THREE.StaticDrawUsage,
    )
  )
    return null;
  const box = new THREE.Box3(), pointForBox = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    if (i % 256 === 0) yield;
    box.expandByPoint(pointForBox.fromBufferAttribute(p, i));
  }
  const size = box.getSize(new THREE.Vector3());
  if (
    box.isEmpty() ||
    ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
  )
    return null;
  const groups = new Map(),
    vertices = [],
    mapping = new Uint32Array(p.count),
    n = source.attributes.normal,
    uv = source.attributes.uv,
    color = source.attributes.color;
  for (let i = 0; i < p.count; i++) {
    if (i % 128 === 0) yield;
    const point = [p.getX(i), p.getY(i), p.getZ(i)],
      key = point.map((v, j) =>
        Math.round(
          ((v - box.min.getComponent(j)) /
            Math.max(size.getComponent(j), 1e-9)) *
            cells,
        ),
      );
    if (n)
      key.push(
        Math.round(n.getX(i) * 3),
        Math.round(n.getY(i) * 3),
        Math.round(n.getZ(i) * 3),
      );
    if (uv) key.push(Math.floor(uv.getX(i) * 2), Math.floor(uv.getY(i) * 2));
    if (color)
      key.push(
        ...Array.from({ length: color.itemSize }, (_, k) =>
          Math.round(color.array[i * color.itemSize + k] * 16),
        ),
      );
    const id = key.join("|");
    let cluster = groups.get(id);
    if (cluster === undefined) {
      cluster = vertices.length;
      groups.set(id, cluster);
      vertices.push({
        count: 0,
        values: attributes.map(([, a]) => new Array(a.itemSize).fill(0)),
      });
    }
    mapping[i] = cluster;
    const entry = vertices[cluster];
    entry.count++;
    attributes.forEach(([, a], j) => {
      for (let k = 0; k < a.itemSize; k++)
        entry.values[j][k] += a.array[i * a.itemSize + k];
    });
  }
  const indices = [],
    idx = source.index;
  // Material groups are irrelevant only for the single-material meshes accepted below.
  for (let i = 0, length = idx?.count ?? p.count; i < length; i += 3) {
    if (i % 384 === 0) yield;
    const a = mapping[idx ? idx.getX(i) : i],
      b = mapping[idx ? idx.getX(i + 1) : i + 1],
      c = mapping[idx ? idx.getX(i + 2) : i + 2];
    if (a !== b && a !== c && b !== c) indices.push(a, b, c);
  }
  if (indices.length < 12 || indices.length > triangles(source) * 3 * 0.88)
    return null;
  const result = new THREE.BufferGeometry();
  for (const [j, [key, a]] of attributes.entries()) {
    const values = new Float32Array(vertices.length * a.itemSize);
    for (const [i, v] of vertices.entries()) {
      if (i % 256 === 0) yield;
      for (let k = 0; k < a.itemSize; k++)
        values[i * a.itemSize + k] = v.values[j][k] / v.count;
    }
    result.setAttribute(key, new THREE.BufferAttribute(values, a.itemSize));
  }
  result.setIndex(indices);
  if (result.attributes.normal) result.normalizeNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

// Hashes only locate a bucket; a byte-for-byte comparison prevents hash collisions
// from ever substituting different UVs/vertices between buildings.
function* sameGeometry(a, b) {
  const ak = Object.keys(a.attributes).sort(),
    bk = Object.keys(b.attributes).sort();
  if (ak.join("|") !== bk.join("|")) return false;
  const aa = ak.map((k) => a.attributes[k]).concat(a.index ?? []),
    bb = bk.map((k) => b.attributes[k]).concat(b.index ?? []);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    const v = aa[i], other = bb[i];
    if (v.itemSize !== other.itemSize || v.normalized !== other.normalized ||
        v.array.constructor !== other.array.constructor || v.array.byteLength !== other.array.byteLength) return false;
    const av = new Uint8Array(v.array.buffer, v.array.byteOffset, v.array.byteLength),
      bv = new Uint8Array(other.array.buffer, other.array.byteOffset, other.array.byteLength);
    for (let j = 0; j < av.length; j++) {
      if (j % 4096 === 0) yield;
      if (av[j] !== bv[j]) return false;
    }
  }
  return true;
}

export class RenderLOD {
  constructor(app) {
    this.app = app;
    this.settings = { ...LOD_DEFAULTS };
    this.work = new IdleWork(() => !!app.stage.exporting);
    this.pending = new Map();
    this.cache = new Map();
    this.lookup = new WeakMap();
    this.hidden = [];
    this.swapped = [];
    this.swappedSet = new Set();
    this.levels = new WeakMap();
    this.culled = new WeakSet();
    this.stats = {};
    this.rendering = false;
    // Transforms, lights and terrain do not change source vertex buffers. Recheck
    // material/animation safety every render; geometry revisions are checked below.
    app.bus.on("objects", () => this.prune());
  }
  configure(value) {
    const previous = this.settings;
    this.settings = lodSettings({ ...this.settings, ...value });
    if (
      previous.near !== this.settings.near ||
      previous.far !== this.settings.far ||
      previous.pixels !== this.settings.pixels
    ) {
      this.levels = new WeakMap();
      this.culled = new WeakSet();
    }
    if (!this.settings.enabled) this.invalidate();
  }
  invalidate() {
    this.work.cancel();
    this.pending.clear();
    this.exit();
    for (const r of this.cache.values())
      for (const g of r.geometries) g?.dispose();
    this.cache.clear();
    this.lookup = new WeakMap();
    this.levels = new WeakMap();
    this.culled = new WeakSet();
    this.bytes = 0;
  }
  safe(mesh) {
    const m = mesh.material,
      g = mesh.geometry;
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
      m.isShaderMaterial ||
      mesh.morphTargetInfluences?.length ||
      mesh.morphTexture ||
      mesh.animations?.length ||
      (mesh.isInstancedMesh &&
        mesh.instanceMatrix.usage !== THREE.StaticDrawUsage) ||
      Object.keys(g.morphAttributes).length ||
      mesh.customDepthMaterial ||
      mesh.customDistanceMaterial ||
      mesh.userData.noLOD ||
      mesh.userData.role === "window" ||
      m.userData.role === "glass" ||
      m.userData.detail === "glass" ||
      (m.emissive?.getHex() && m.emissiveIntensity > 0)
    )
      return false;
    const record = this.app.lighting.physical.color.sources.get(m),
      hook =
        record?.wrapper === m.onBeforeCompile
          ? record.compile
          : m.onBeforeCompile;
    if (hook !== THREE.Material.prototype.onBeforeCompile) return false;
    if (
      [
        "onBeforeRender",
        "onAfterRender",
        "onBeforeShadow",
        "onAfterShadow",
      ].some((k) => mesh[k] !== THREE.Mesh.prototype[k])
    )
      return false;
    if (
      mesh.raycast !==
      (mesh.isInstancedMesh
        ? THREE.InstancedMesh.prototype.raycast
        : THREE.Mesh.prototype.raycast)
    )
      return false;
    return Object.values(g.attributes).every(
      (a) =>
        a.usage === THREE.StaticDrawUsage && !a.isInterleavedBufferAttribute,
    );
  }
  revision(source) {
    const keys = Object.keys(source.attributes).sort();
    const attrs = keys.map((k) => source.attributes[k]).concat(source.index ?? []);
    return { attrs, arrays: attrs.map((a) => a.array), versions: attrs.map((a) => a.version),
      range: JSON.stringify([keys, source.groups, source.drawRange, attrs.map((a) => [a.itemSize, a.normalized, a.count])]) };
  }
  matches(a, b) {
    return a && a.range === b.range && a.attrs.length === b.attrs.length &&
      a.attrs.every((v, i) => v === b.attrs[i] && a.arrays[i] === b.arrays[i] && a.versions[i] === b.versions[i]);
  }
  prune() {
    // Removal/import cancels in-flight references, but retains still-live generated
    // geometries. No borrowed source resource is ever disposed here.
    this.work.cancel();
    this.pending.clear();
    if (this.cache.size) this.work.request('prune', () => this.pruneSteps());
  }
  *pruneSteps() {
    const live = new Set();
    for (const so of this.app.objects) {
      const stack = [so.root];
      while (stack.length) {
        const n = stack.pop();
        stack.push(...n.children);
        if (n.geometry) live.add(n.geometry);
        yield;
      }
    }
    for (const [key, entry] of this.cache) {
      if (!live.has(entry.source) || !this.matches(entry.revision, this.revision(entry.source))) {
        entry.retired = true;
        for (const g of entry.geometries) if (g) { this.bytes -= g.userData.lodBytes; g.dispose(); }
        this.cache.delete(key);
      }
      yield;
    }
  }
  *build(source, revision) {
    try {
      let h = 2166136261;
      for (const attr of revision.attrs) {
        const bytes = new Uint8Array(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength);
        for (let i = 0; i < bytes.length; i++) {
          if (i % 4096 === 0) yield;
          h = Math.imul(h ^ bytes[i], 16777619);
        }
      }
      if (!this.matches(revision, this.revision(source))) return;
      const hash = revision.range + ':' + (h >>> 0);
      let key = hash, entry = this.cache.get(key);
      if (entry && (!this.matches(entry.revision, this.revision(entry.source)) || !(yield* sameGeometry(entry.source, source)))) {
        key += ':' + source.uuid;
        entry = this.cache.get(key);
      }
      if (!entry) {
        if (this.cache.size >= 128) return;
        entry = { source, revision, geometries: [], attempted: [] };
        this.cache.set(key, entry);
      }
      this.lookup.set(source, { ...revision, entry });
      const request = this.pending.get(source);
      while (request?.levels.size) {
        const level = request.levels.values().next().value;
        request.levels.delete(level);
        if (entry.attempted[level]) continue;
        const g = yield* clusterSteps(source, level === 1 ? 24 : 10);
        if (!this.matches(revision, this.revision(source))) { g?.dispose(); return; }
        entry.attempted[level] = true;
        if (g) {
          const bytes = Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0);
          if ((this.bytes ?? 0) + bytes > 8 * 1024 * 1024) { g.dispose(); continue; }
          g.userData.lodBytes = bytes;
          this.bytes = (this.bytes ?? 0) + bytes;
          entry.geometries[level] = g;
        }
      }
    } finally { this.pending.delete(source); }
  }
  simplified(source, level) {
    const p = source.attributes.position;
    if (!p || p.count < 120 || p.count > 12000) return null;
    const revision = this.revision(source), old = this.lookup.get(source);
    const known = old && !old.entry.retired && this.matches(old, revision) && this.matches(old.entry.revision, this.revision(old.entry.source));
    if (known) {
      if (old.entry.attempted[level]) return old.entry.geometries[level] ?? null;
    }
    if (this.cache.size >= 128 && !known) return null;
    if (this.app.stage.exporting && !this.preparing) return null;
    let request = this.pending.get(source);
    if (request && !this.matches(request.revision, revision)) {
      // Invalidate explicitly for deep edits; this also guards needsUpdate edits.
      this.invalidate(); request = null;
    }
    if (!request && this.pending.size < 256) {
      request = { revision, levels: new Set() };
      this.pending.set(source, request);
      this.work.request(source, () => this.build(source, revision));
    }
    request?.levels.add(level);
    return null;
  }
  async prewarm(options) {
    if (!this.settings.enabled) return;
    this.preparing = true;
    try {
      // Camera movement during recording must not start a cold clustering job.
      for (const so of this.app.objects) {
        if (!categories.has(so.item?.catId) || so.isChar || so.item?.anim || so.motion?.active) continue;
        so.root.traverse((mesh) => { if (this.safe(mesh)) {
          this.simplified(mesh.geometry, 1); this.simplified(mesh.geometry, 2);
        } });
      }
      return await this.work.drain(options);
    } finally { this.preparing = false; }
  }
  enter(camera, matricesCurrent = false) {
    if (this.rendering) throw Error("nested LOD transaction");
    this.rendering = true;
    this.started = performance.now();
    this.builds = 0;
    this.stats = {
      near: 0,
      medium: 0,
      far: 0,
      culledMeshes: 0,
      simplifiedMeshes: 0,
      sourceTriangles: 0,
      lodTriangles: 0,
    };
    if (!this.settings.enabled) return;
    const s = this.app.stage,
      { near, far, pixels } = this.settings,
      cam = camera.getWorldPosition(new THREE.Vector3()),
      point = new THREE.Vector3(),
      sphere = new THREE.Sphere(),
      height = s.postSize?.y ?? s.renderer.getSize(new THREE.Vector2()).y;
    if (!matricesCurrent) s.world.updateWorldMatrix(true, true);
    for (const so of this.app.objects) {
      if (
        !categories.has(so.item?.catId) ||
        so.isChar ||
        so.item?.anim ||
        so.motion?.active ||
        so.root.animations?.length ||
        so === this.app.selObj ||
        !so.root.visible
      )
        continue;
      const distance = so.root.getWorldPosition(point).distanceTo(cam),
        last = this.levels.get(so.root) ?? 0;
      let level =
        distance > far * (last === 2 ? 0.9 : 1.1)
          ? 2
          : distance > near * (last >= 1 ? 0.9 : 1.1)
            ? 1
            : 0;
      this.levels.set(so.root, level);
      this.stats[["near", "medium", "far"][level]]++;
      if (!level) continue;
      so.root.traverseVisible((mesh) => {
        if (!this.safe(mesh)) return;
        const g = mesh.geometry;
        if (mesh.isInstancedMesh) {
          if (!mesh.boundingSphere) mesh.computeBoundingSphere();
          sphere.copy(mesh.boundingSphere);
        } else {
          if (!g.boundingSphere) g.computeBoundingSphere();
          sphere.copy(g.boundingSphere);
        }
        sphere.applyMatrix4(mesh.matrixWorld);
        const distance = Math.max(
            camera.near,
            -point.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse)
              .z - sphere.radius,
          ),
          diameter = camera.isOrthographicCamera
            ? (2 * sphere.radius * height * camera.zoom) /
              (camera.top - camera.bottom)
            : ((sphere.radius * height) /
                (distance *
                  Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))) *
              camera.zoom;
        const threshold =
            pixels *
            (level === 1 ? 0.5 : 1) *
            (this.culled.has(mesh) ? 1.15 : 0.85),
          count = mesh.isInstancedMesh ? mesh.count : 1;
        if (diameter < threshold) {
          this.hidden.push([mesh, mesh.visible]);
          mesh.visible = false;
          this.culled.add(mesh);
          this.stats.culledMeshes++;
          this.stats.sourceTriangles += triangles(g) * count;
          return;
        }
        this.culled.delete(mesh);
        if (diameter > 220) return;
        const low = this.simplified(g, level);
        if (low) {
          this.swapped.push([mesh, g]);
          this.swappedSet.add(mesh);
          mesh.geometry = low;
          this.stats.simplifiedMeshes++;
          this.stats.sourceTriangles += triangles(g) * count;
          this.stats.lodTriangles += triangles(low) * count;
        }
      });
    }
    this.stats.prepareMs = performance.now() - this.started;
    this.stats.builds = 0; // Geometry construction is never performed in enter().
    this.stats.pending = this.work.jobs.size;
    this.stats.idle = { ...this.work.stats };
    this.stats.cachedGeometries = this.cache.size;
    this.stats.geometryBytes = this.bytes ?? 0;
  }
  exit() {
    for (const [mesh, g] of this.swapped) mesh.geometry = g;
    for (const [mesh, visible] of this.hidden) mesh.visible = visible;
    this.swapped = [];
    this.swappedSet.clear();
    this.hidden = [];
    this.rendering = false;
  }
}
