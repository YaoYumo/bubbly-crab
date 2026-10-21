import * as THREE from "three";
import { IdleWork } from "./idle-work.js";

const meshRaycast = THREE.Mesh.prototype.raycast;
const instanceRaycast = THREE.InstancedMesh.prototype.raycast;
const groupRaycast = THREE.Object3D.prototype.raycast;
const now = () => performance.now();
const finiteBox = (box) =>
  !box.isEmpty() &&
  [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite);
const sameMatrix = (a, b) => a.every((v, i) => v === b[i]);

// Only CPU broad-phase. Originals still perform Three's precise recursive raycast.
// No visibility pruning: Three's existing raycast ignores Object3D.visible.
export class PickSpatialIndex {
  constructor(stage) {
    this.stage = stage;
    this.enabled = true;
    this.background = typeof window !== "undefined";
    this.work = new IdleWork(() => !!stage.exporting);
    this.localCache = new WeakMap();
    this.geometryBounds = new WeakMap();
    this.invalidate("initial");
    this.stats = null;
  }
  // Built-in editing events call this. External deep edits (including instance
  // matrices/geometry attributes) must invalidate explicitly before querying.
  invalidate(reason = "scene") {
    this.work.cancel();
    if (reason !== "gizmo-live") this.localCache = new WeakMap();
    this.dirty = true;
    this.reason = reason;
    this.entries = [];
    this.tree = null;
    if (this.background) this.work.request("prepare", () => this.prepare());
  }
  *prepare() {
    for (const root of this.stage.world.children.slice()) {
      if (this.mode(root) !== "static") continue;
      const cached = this.localCache.get(root);
      if (cached && cached.childCount === root.children.length && cached.geometry === root.geometry) continue;
      const childCount = root.children.length, geometry = root.geometry;
      const local = yield* this.localBoundsSteps(root);
      this.localCache.set(root, { local, childCount, geometry });
      this.dirty = true;
      yield;
    }
  }
  async prewarm(options) {
    this.work.request("prepare", () => this.prepare());
    return this.work.drain(options);
  }
  mode(root, helper = false) {
    // A childless default Object3D raycast cannot emit any intersection (empty markers too).
    if (!root.children.length && root.raycast === groupRaycast)
      return "ignored";
    if (helper) return "fallback";
    if (
      root.isMesh &&
      !root.isSkinnedMesh &&
      root.raycast === meshRaycast &&
      !root.children.length
    ) {
      if (root.userData.pickIgnore) return "ignored";
      if (
        root.userData.terrain &&
        !root.userData.so &&
        !root.userData.keyRef &&
        !root.userData.shotRef &&
        !root.userData.ground
      )
        return "ignored";
    }
    const so = root.userData.so;
    if (
      !so ||
      so.isChar ||
      so.item?.anim ||
      so.motion?.active ||
      root.animations?.length
    )
      return "fallback";
    return "static";
  }
  localBounds(root) {
    const job = this.localBoundsSteps(root);
    let step;
    do { step = job.next(); } while (!step.done);
    return step.value;
  }
  *localBoundsSteps(root) {
    // A singular root cannot be inverted reliably; keep the original path.
    root.updateWorldMatrix(true, true);
    if (Math.abs(root.matrixWorld.determinant()) < 1e-12) return null;
    const rootMatrix = root.matrixWorld.clone();
    const inverse = rootMatrix.clone().invert(),
      box = new THREE.Box3(),
      relative = new THREE.Matrix4();
    let safe = true,
      meshes = 0;
    const stack = [root];
    while (stack.length) {
      yield;
      const node = stack.pop();
      stack.push(...node.children);
      if (!safe) break;
      if (!node.isMesh) {
        if (node.raycast !== groupRaycast) safe = false;
        continue;
      }
      const expected = node.isInstancedMesh ? instanceRaycast : meshRaycast;
      const g = node.geometry,
        p = g?.attributes.position;
      if (
        node.isSkinnedMesh ||
        node.raycast !== expected ||
        node.getVertexPosition !== THREE.Mesh.prototype.getVertexPosition ||
        node.morphTargetInfluences?.length ||
        g?.morphAttributes?.position?.length ||
        node.animations?.length ||
        (node.isInstancedMesh &&
          (node.computeBoundingBox !==
            THREE.InstancedMesh.prototype.computeBoundingBox ||
            node.morphTexture ||
            node.instanceMatrix.usage !== THREE.StaticDrawUsage)) ||
        !g?.isBufferGeometry ||
        !p ||
        p.usage !== THREE.StaticDrawUsage ||
        g.computeBoundingBox !==
          THREE.BufferGeometry.prototype.computeBoundingBox
      ) {
        safe = false;
        break;
      }
      const old = this.geometryBounds.get(g);
      if (
        !old ||
        old.position !== p ||
        old.array !== p.array ||
        old.version !== p.version
      ) {
        // Native position bounds, split even for large imported meshes.
        const bounds = new THREE.Box3(), point = new THREE.Vector3(), version = p.version;
        for (let i = 0; i < p.count; i++) {
          if (i % 256 === 0) yield;
          bounds.expandByPoint(point.fromBufferAttribute(p, i));
        }
        if (g.attributes.position !== p || p.version !== version) return null;
        g.boundingBox = bounds;
        this.geometryBounds.set(g, {
          position: p,
          array: p.array,
          version: p.version,
        });
      }
      let bounds = g.boundingBox;
      if (node.isInstancedMesh) {
        bounds = new THREE.Box3();
        const matrix = new THREE.Matrix4(), instanceBox = new THREE.Box3();
        for (let i = 0; i < node.count; i++) {
          if (i % 32 === 0) yield;
          node.getMatrixAt(i, matrix);
          bounds.union(instanceBox.copy(g.boundingBox).applyMatrix4(matrix));
        }
        node.boundingBox = bounds;
      }
      if (!bounds || !finiteBox(bounds)) {
        safe = false;
        break;
      }
      relative.multiplyMatrices(inverse, node.matrixWorld);
      box.union(bounds.clone().applyMatrix4(relative));
      meshes++;
    }
    root.updateWorldMatrix(true, false);
    if (!sameMatrix(rootMatrix.elements, root.matrixWorld.elements)) return null;
    return safe && meshes && finiteBox(box) ? box : null;
  }
  buildTree(entries) {
    if (!entries.length) return null;
    const box = new THREE.Box3();
    for (const e of entries) box.union(e.box);
    if (entries.length <= 8) return { box, items: entries };
    const size = box.getSize(new THREE.Vector3()),
      axis =
        size.x >= size.y && size.x >= size.z
          ? "x"
          : size.y >= size.z
            ? "y"
            : "z";
    entries.sort(
      (a, b) =>
        a.box.min[axis] +
          a.box.max[axis] -
          (b.box.min[axis] + b.box.max[axis]) || a.order - b.order,
    );
    const middle = entries.length >> 1;
    return {
      box,
      left: this.buildTree(entries.slice(0, middle)),
      right: this.buildTree(entries.slice(middle)),
    };
  }
  sync() {
    const stage = this.stage,
      roots = [...stage.world.children, ...stage.helperLayer.children],
      worldCount = stage.world.children.length;
    let cold = this.dirty || roots.length !== this.entries.length;
    if (!cold)
      for (let i = 0; i < roots.length; i++) {
        const old = this.entries[i],
          root = roots[i];
        if (
          old.root !== root ||
          old.requested !== this.mode(root, i >= worldCount) ||
          old.childCount !== root.children.length ||
          old.geometry !== root.geometry
        ) {
          cold = true;
          break;
        }
      }
    if (cold) {
      this.entries = roots.map((root, order) => {
        let mode = this.mode(root, order >= worldCount),
          local = null;
        if (mode === "static") {
          if (!this.background) local = this.localBounds(root);
          else {
            const cached = this.localCache.get(root);
            if (cached && cached.childCount === root.children.length && cached.geometry === root.geometry) local = cached.local;
            else this.work.request("prepare", () => this.prepare());
          }
          if (!local) mode = "fallback";
        }
        // Store the requested classification too: a conservative fallback is not a dirty scene.
        return {
          root,
          order,
          mode,
          requested: this.mode(root, order >= worldCount),
          local,
          childCount: root.children.length,
          geometry: root.geometry,
          matrix: [],
          box: new THREE.Box3(),
        };
      });
    }
    let moved = cold;
    for (const entry of this.entries) {
      if (entry.mode !== "static") continue;
      entry.root.updateWorldMatrix(true, false);
      const elements = entry.root.matrixWorld.elements;
      if (cold || !sameMatrix(entry.matrix, elements)) {
        if (!cold) entry.root.updateWorldMatrix(false, true);
        entry.matrix = [...elements];
        entry.box.copy(entry.local).applyMatrix4(entry.root.matrixWorld);
        if (Math.abs(entry.root.matrixWorld.determinant()) < 1e-12 || !finiteBox(entry.box)) {
          entry.mode = "fallback";
          moved = true;
          continue;
        }
        const size = entry.box.getSize(new THREE.Vector3());
        entry.box.expandByScalar(
          1e-5 + Math.max(size.x, size.y, size.z) * 1e-9,
        );
        moved = true;
      }
    }
    if (moved)
      this.tree = this.buildTree(
        this.entries.filter((e) => e.mode === "static"),
      );
    this.dirty = false;
    return { cold, moved };
  }
  intersections(raycaster) {
    const started = now(),
      stage = this.stage;
    // Nonstandard container raycasts can affect recursion; never flatten them.
    if (
      !this.enabled ||
      stage.world.raycast !== groupRaycast ||
      stage.helperLayer.raycast !== groupRaycast
    ) {
      const hits = raycaster.intersectObjects(
        [stage.world, stage.helperLayer],
        true,
      );
      this.stats = {
        indexed: false,
        roots: stage.world.children.length + stage.helperLayer.children.length,
        candidates:
          stage.world.children.length + stage.helperLayer.children.length,
        cold: false,
        totalMs: now() - started,
        reason: !this.enabled ? "disabled" : "custom container",
      };
      return hits;
    }
    let sync, buildMs;
    try {
      sync = this.sync();
      buildMs = now() - started;
    } catch (error) {
      this.invalidate("index failure");
      const hits = raycaster.intersectObjects(
        [stage.world, stage.helperLayer],
        true,
      );
      this.stats = {
        indexed: false,
        reason: "index failure: " + error.message,
        totalMs: now() - started,
      };
      return hits;
    }
    const candidates = this.entries.filter((e) => e.mode === "fallback");
    let boundsTested = 0;
    const visit = (node) => {
      if (!node) return;
      boundsTested++;
      if (!raycaster.ray.intersectsBox(node.box)) return;
      if (node.items)
        for (const entry of node.items) {
          boundsTested++;
          if (raycaster.ray.intersectsBox(entry.box)) candidates.push(entry);
        }
      else {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(this.tree);
    // Preserve original DFS root order so equal-distance stable sorting is identical.
    candidates.sort((a, b) => a.order - b.order);
    const beforeExact = now(),
      hits = raycaster.intersectObjects(
        candidates.map((e) => e.root),
        true,
      );
    const afterExact = now();
    this.stats = {
      pending: this.work.jobs.size,
      idle: { ...this.work.stats },
      indexed: true,
      roots: this.entries.length,
      indexedRoots: this.entries.filter((e) => e.mode === "static").length,
      fallbackRoots: this.entries.filter((e) => e.mode === "fallback").length,
      ignoredRoots: this.entries.filter((e) => e.mode === "ignored").length,
      candidates: candidates.length,
      boundsTested,
      cold: sync.cold,
      refit: sync.moved,
      syncMs: buildMs,
      broadMs: beforeExact - started - buildMs,
      exactMs: afterExact - beforeExact,
      totalMs: now() - started,
    };
    return hits;
  }
}

// Exactly the existing Stage.pick acceptance policy, including ignored leaves,
// object/shot/key identity and nearest accepted hit (not just nearest box).
export function resolvePick(stage, hits) {
  for (const h of hits) {
    if (h.object.userData?.pickIgnore) continue;
    if (h.object.userData?.keyRef)
      return { kind: "key", ...h.object.userData.keyRef, point: h.point };
    let o = h.object;
    while (o && !o.userData?.so && o !== stage.world) o = o.parent;
    if (o?.userData?.so)
      return {
        kind: "obj",
        so: o.userData.so,
        object: o,
        point: h.point,
        distance: h.distance,
      };
    o = h.object;
    while (o && !o.userData?.shotRef && o !== stage.world) o = o.parent;
    if (o?.userData?.shotRef)
      return { kind: "shot", shot: o.userData.shotRef, point: h.point };
    if (h.object.userData?.ground) return { kind: "ground", point: h.point };
  }
  return { kind: "empty", point: stage.groundPoint(0) };
}
