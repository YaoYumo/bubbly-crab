import { shearRoadGrade } from './road-elevation.js';
import { updateRoadLighting } from './road-lighting.js';
/** Height-field road adaptation and conservative, full-volume bridge collision checks.
 * Source controls remain the design alignment; derived geometry is rebuilt, never accumulated.
 * A blocked pier is omitted and reported, never forced through an obstacle.
 */
import * as THREE from "three";
import { roadCollisionBounds } from "./road-batching.js";
import { roadProfile } from "./junction.js";
import { vegetationBounds } from "./vegetation-brush.js";
import { clamp } from "./util.js";
const V = () => new THREE.Vector3();
const key = (x, z) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
export function nearestProfile(profile, x, z) {
  let best = Infinity,
    result = null;
  const points = profile.points;
  const ids = profile.buckets.get(key(x, z)) || profile.indices;
  for (const i of ids) {
    const a = points[i],
      b = points[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = clamp(
      ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1),
      0,
      1,
    );
    const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (d < best) {
      best = d;
      result = {
        x: a.x + t * dx,
        z: a.z + t * dz,
        y: a.y + t * (b.y - a.y),
        base: a.base + t * (b.base - a.base),
        s: a.s + t * (b.s - a.s),
        distance: Math.sqrt(d),
        i,
        t,
      };
    }
  }
  return result;
}

// Split long triangles before warping: a 22 m library slab cannot bend using its 8 corners alone.
// Attributes and material groups are retained; library/source geometry is never mutated.
export function subdivideForTerrain(geometry, matrix, step = 2) {
  const attrs = Object.entries(geometry.attributes),
    index = geometry.index;
  const count = index ? index.count : geometry.attributes.position.count;
  let stride = 0;
  const layout = attrs.map(([name, a]) => {
    const offset = stride;
    stride += a.itemSize;
    return { name, a, offset };
  });
  const position = layout.find((v) => v.name === "position").offset,
    e = matrix.elements;
  let capacity = Math.max(96, count),
    written = 0;
  const outputs = layout.map(
    ({ a }) => new Float32Array(capacity * a.itemSize),
  );
  const groups = [];
  const read = (i) => {
    const v = new Float64Array(stride);
    for (const { a, offset } of layout)
      for (let j = 0; j < a.itemSize; j++)
        v[offset + j] = a.array[i * a.itemSize + j];
    return v;
  };
  const midpoint = (a, b) => {
    const p = new Float64Array(stride);
    for (let j = 0; j < stride; j++) p[j] = (a[j] + b[j]) / 2;
    return p;
  };
  const distance = (a, b) => {
    const ax = a[position],
      ay = a[position + 1],
      az = a[position + 2],
      bx = b[position],
      by = b[position + 1],
      bz = b[position + 2];
    const dx =
      e[0] * ax +
      e[4] * ay +
      e[8] * az +
      e[12] -
      (e[0] * bx + e[4] * by + e[8] * bz + e[12]);
    const dz =
      e[2] * ax +
      e[6] * ay +
      e[10] * az +
      e[14] -
      (e[2] * bx + e[6] * by + e[10] * bz + e[14]);
    return dx * dx + dz * dz;
  };
  const emit = (a, b, c, depth) => {
    const ab = distance(a, b),
      bc = distance(b, c),
      ca = distance(c, a),
      max = Math.max(ab, bc, ca);
    if (max > step * step && depth < 12) {
      if (ab === max) {
        const p = midpoint(a, b);
        emit(a, p, c, depth + 1);
        emit(p, b, c, depth + 1);
      } else if (bc === max) {
        const p = midpoint(b, c);
        emit(a, b, p, depth + 1);
        emit(a, p, c, depth + 1);
      } else {
        const p = midpoint(c, a);
        emit(a, b, p, depth + 1);
        emit(p, b, c, depth + 1);
      }
      return;
    }
    if (written + 3 > capacity) {
      capacity *= 2;
      for (let k = 0; k < layout.length; k++) {
        const next = new Float32Array(capacity * layout[k].a.itemSize);
        next.set(outputs[k]);
        outputs[k] = next;
      }
    }
    for (const v of [a, b, c]) {
      for (let k = 0; k < layout.length; k++) {
        const { a: attr, offset } = layout[k];
        for (let j = 0; j < attr.itemSize; j++)
          outputs[k][written * attr.itemSize + j] = v[offset + j];
      }
      written++;
    }
  };
  for (let i = 0; i + 2 < count; i += 3) {
    const start = written;
    emit(
      read(index ? index.getX(i) : i),
      read(index ? index.getX(i + 1) : i + 1),
      read(index ? index.getX(i + 2) : i + 2),
      0,
    );
    if (geometry.groups.length) {
      const materialIndex =
          geometry.groups.find((g) => i >= g.start && i < g.start + g.count)
            ?.materialIndex || 0,
        prev = groups.at(-1);
      if (prev && prev.materialIndex === materialIndex)
        prev.count += written - start;
      else groups.push({ start, count: written - start, materialIndex });
    }
  }
  const out = new THREE.BufferGeometry();
  for (let k = 0; k < layout.length; k++) {
    const { name, a } = layout[k];
    out.setAttribute(
      name,
      new THREE.BufferAttribute(
        outputs[k].slice(0, written * a.itemSize),
        a.itemSize,
      ),
    );
  }
  out.groups = groups;
  return out;
}

export class RoadTerrain {
  constructor(app) {
    this.app = app;
    this.busy = false;
    app.bus.on("terrain", () => {
      if (!app._clearingScene) this.sync({ terrainOnly: true });
    });
    app.bus.on("objects", () => {
      if (!this.busy && !app._clearingScene) this.updateSupports();
    });
  }
  modeFor(saved) {
    if (["follow", "fixed"].includes(saved.terrainMode))
      return saved.terrainMode;
    // Legacy elevations are intentional. Legacy flat, ground-level roads can follow new terrain.
    return (saved.points || []).some((p) => Math.abs(p[1]) > 0.1)
      ? "fixed"
      : "follow";
  }
  prepare(curve, settings = {}, width = 12, type = { id: "asphalt" }) {
    const tr = this.app.terrain,
      follow = settings.terrainMode === "follow" && tr.enabled;
    const length = curve.getLength(),
      count = Math.min(4096, Math.max(2, Math.ceil(length / 0.75)));
    const half =
        type.id === "freeway"
          ? (type.section ? width : Math.max(width, 20)) / 2
          : Math.max(
              roadProfile(type, width).half,
              ["asphalt", "oneway", "concrete"].includes(type.id) ? 3.3 : 0.3,
            ),
      points = [],
      buckets = new Map(),
      indices = [];
    const transverse = Math.max(
      2,
      Math.ceil((half * 2) / Math.min(0.75, tr.size / (tr.n - 1))),
    );
    let s = 0,
      last = null;
    for (let i = 0; i <= count; i++) {
      const p = curve.getPointAt(i / count),
        dir = curve.getTangentAt(i / count),
        len = Math.hypot(dir.x, dir.z) || 1;
      if (last) s += Math.hypot(p.x - last.x, p.z - last.z);
      last = p;
      let y = p.y;
      if (follow) {
        y = -Infinity;
        for (let j = 0; j <= transverse; j++) {
          const side = ((j / transverse) * 2 - 1) * half;
          y = Math.max(
            y,
            tr.heightAt(p.x + (dir.z / len) * side, p.z - (dir.x / len) * side),
          );
        }
        // Include round endcaps, not just the centerline.
        if (i === 0 || i === count)
          for (let j = 0; j < 32; j++) {
            const a = (j / 32) * Math.PI * 2;
            y = Math.max(
              y,
              tr.heightAt(p.x + Math.cos(a) * half, p.z + Math.sin(a) * half),
            );
          }
        y += settings.terrainOffset ?? 0.02;
      }
      points.push({ x: p.x, z: p.z, y, base: p.y, s });
    }
    // A small upper envelope prevents a narrow terrain peak from punching through a tessellated slab.
    if (follow) {
      const ys = points.map((p) => p.y);
      for (let i = 0; i < points.length; i++)
        for (
          let j = Math.max(0, i - 2);
          j <= Math.min(points.length - 1, i + 2);
          j++
        )
          points[i].y = Math.max(points[i].y, ys[j]);
    }
    for (let i = 0; i < count; i++) {
      indices.push(i);
      const a = points[i],
        b = points[i + 1],
        pad = half + 3;
      for (
        let x = Math.floor((Math.min(a.x, b.x) - pad) / 8);
        x <= Math.floor((Math.max(a.x, b.x) + pad) / 8);
        x++
      )
        for (
          let z = Math.floor((Math.min(a.z, b.z) - pad) / 8);
          z <= Math.floor((Math.max(a.z, b.z) + pad) / 8);
          z++
        ) {
          const k = `${x},${z}`;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(i);
        }
    }
    curve._terrainProfile = {
      points,
      buckets,
      indices,
      half,
      follow,
      rawY: Float64Array.from(points, (p) => p.y),
    };
    return curve;
  }
  height(curve, x, z) {
    const p = curve._terrainProfile;
    return p ? nearestProfile(p, x, z)?.y : null;
  }
  warp(root, curve, flatBase = false) {
    const profile = curve._terrainProfile;
    if (
      !profile ||
      !profile.follow ||
      profile.points.every(
        (p) => Math.abs(p.y - (flatBase ? 0 : p.base)) < 1e-6,
      )
    )
      return;
    this.warpWith(root, (x, z) => {
      const p = nearestProfile(profile, x, z);
      return p ? p.y - (flatBase ? 0 : p.base) : 0;
    });
  }
  warpWith(root, delta) {
    root.updateMatrixWorld(true);
    root.traverse((m) => {
      if (!m.isMesh || !m.geometry?.attributes.position || m.isInstancedMesh)
        return;
      const inv = m.matrixWorld.clone().invert();
      m.geometry = subdivideForTerrain(m.geometry, m.matrixWorld);
      const pos = m.geometry.attributes.position,
        v = V();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        v.y += delta(v.x, v.z);
        v.applyMatrix4(inv);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingBox();
      m.geometry.computeBoundingSphere();
    });
  }
  /** Give every connected arm a shared flat junction core, with a smooth approach outside its hull. */
  joinProfiles(isects) {
    for (const is of isects) {
      const profiles = [
        is.newCurve._terrainProfile,
        is.existingCurve._terrainProfile,
      ].filter(Boolean);
      if (!profiles.length) continue;
      const fixed = profiles.find((p) => !p.follow),
        samples = profiles.map((p) =>
          nearestProfile(p, is.point.x, is.point.z),
        );
      let y = is.joinHeight ?? (fixed
        ? (is.newCurve._terrainProfile === fixed ? is.newCurve.getPointAt(is.tNew).y : is.existingCurve.getPointAt(is.tExisting).y)
        : Math.max(...samples.map((p) => p.y)));
      const plan = this.app.roadBrush._planForIsect(is);
      const radius =
        Math.max(
          4,
          ...(plan?.hull || []).map((p) =>
            Math.hypot(p.x - is.point.x, p.z - is.point.z),
          ),
        ) + 1;
      if (!fixed)
        for (const p of profiles)
          for (const v of p.points)
            if (Math.hypot(v.x - is.point.x, v.z - is.point.z) < radius)
              y = Math.max(y, v.y);
      is.terrainY = y;
      for (const p of profiles)
        if (p.follow)
          for (const v of p.points) {
            const d = Math.hypot(v.x - is.point.x, v.z - is.point.z),
              w = clamp((radius + 6 - d) / 6, 0, 1);
            v.y += (y - v.y) * w * w * (3 - 2 * w);
          }
    }
  }
  /** Probe raw (pre-junction) heights; derived junction envelopes must not cause false invalidations. */
  terrainAffected(roads) {
    const changed = new Set(),
      bounds = new Map();
    for (const o of roads) {
      const rd = o._roadData,
        old = rd.curve._terrainProfile;
      try {
        this.prepare(rd.curve, rd, rd.width, rd.roadType);
        const next = rd.curve._terrainProfile;
        if (
          !old?.rawY ||
          old.follow !== next.follow ||
          old.rawY.length !== next.rawY.length ||
          next.rawY.some((v, i) => v !== old.rawY[i])
        )
          changed.add(o);
      } finally {
        rd.curve._terrainProfile = old;
      }
      const box = new THREE.Box2();
      for (const p of old?.points || [])
        box.expandByPoint(new THREE.Vector2(p.x, p.z));
      // Broadphase deliberately over-connects: crossing roads of any grade and nearby endcaps
      // are rebuilt together, so grade transitions, T gaps and arm order still use restore().
      box.expandByScalar((old?.half || rd.width) + 3);
      bounds.set(o, box);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of roads)
        if (
          !changed.has(o) &&
          [...changed].some((c) => bounds.get(o).intersectsBox(bounds.get(c)))
        ) {
          changed.add(o);
          grew = true;
        }
    }
    return changed;
  }
  sync({ terrainOnly = false } = {}) {
    if (this.busy) return;
    const app = this.app,
      rb = app.roadBrush;
    if (rb._editBackup) return;
    const roads = app.objects.filter((o) => o.type === "road_brush");
    if (!roads.length) return;
    const affected = terrainOnly ? this.terrainAffected(roads) : new Set(roads);
    if (!affected.size) {
      this.lastSync = {
        total: roads.length,
        rebuilt: 0,
        retained: roads.length,
      };
      this.updateSupports();
      return;
    }
    const curves = new Set([...affected].map((o) => o._roadData.curve));
    // Unknown legacy intersection ownership is a reason to fall back, not guess locality.
    if (app.objects.some((o) => o.type === "road_intersection" && !o._isect))
      for (const o of roads) {
        affected.add(o);
        curves.add(o._roadData.curve);
      }
    const replace = (o) =>
      affected.has(o) ||
      (o.type === "road_intersection" &&
        (curves.has(o._isect?.newCurve) ||
          curves.has(o._isect?.existingCurve)));
    const previous = [...app.objects],
      roadOrder = new Map(rb._roads.map((rd, i) => [rd, i])),
      oldIds = new Map(roads.map((o) => [o.id, roadOrder.get(o._roadData)]));
    const list = roads.filter((o) => affected.has(o)).map((o) => o.serialize());
    this.busy = true;
    try {
      const selected = app.selObj?.id;
      for (const o of previous.filter(replace)) this.dispose(o.root);
      app.objects = previous.filter((o) => !replace(o));
      rb._roads = rb._roads.filter((rd) => !curves.has(rd.curve));
      rb.restore(list);
      const replacements = new Map(
        app.objects
          .filter((o) => o.type === "road_brush")
          .map((o) => [o.id, o]),
      );
      const newIntersections = app.objects.filter(
        (o) => o.type === "road_intersection" && !previous.includes(o),
      );
      app.objects = previous.flatMap((o) =>
        affected.has(o)
          ? [replacements.get(o.id)].filter(Boolean)
          : replace(o)
            ? []
            : [o],
      );
      app.objects.push(...newIntersections);
      const ranks = new Map(
        app.objects
          .filter((o) => o.type === "road_brush")
          .map((o) => [o._roadData, oldIds.get(o.id)]),
      );
      rb._roads.sort((a, b) => ranks.get(a) - ranks.get(b));
      if (selected) {
        const so = app.byId(selected);
        if (so) app.select({ kind: "obj", so });
        else if (app.selObj?.type === "road_intersection") app.select(null);
      }
      this.lastSync = {
        total: roads.length,
        rebuilt: affected.size,
        retained: roads.length - affected.size,
      };
      app.roadPlanning?.changed();
    } finally {
      this.busy = false;
    }
    this.updateSupports();
  }
  dispose(root) {
    this.app.appearance?.release(root);
    root.parent?.remove(root);
    const gs = new Set(),
      ms = new Set();
    root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) gs.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m) ms.add(m);
    });
    gs.forEach((g) => g.dispose());
    ms.forEach((m) => m.dispose());
  }
  isPlant(o) {
    return (
      o.params?.isVegetation === true ||
      o.item?.catId === "vegetation" ||
      [
        "tree",
        "pine",
        "palm",
        "bush",
        "grass",
        "flower",
        "crop",
        "cactus",
      ].includes(o.item?.icon) ||
      o.type === "vegetation_patch" ||
      /^(tree|sugar_maple|live_oak|sabal_palm|grass|flowers|pine|bush|reed|bamboo|palm|flower|forest)$/.test(
        o.type,
      )
    );
  }
  intersectsGeometry(box, root, solidInverse = null) {
    let hit = false;
    root.updateMatrixWorld(true);
    const targetBox = solidInverse ? new THREE.Box3(V().setScalar(-.5), V().setScalar(.5)) : box;
    const triangle = new THREE.Triangle(),
      local = new THREE.Matrix4();
    root.traverse((m) => {
      if (hit || !m.isMesh || !m.geometry?.attributes.position) return;
      const pos = m.geometry.attributes.position,
        index = m.geometry.index,
        count = index ? index.count : pos.count;
      for (
        let instance = 0;
        instance < (m.isInstancedMesh ? m.count : 1) && !hit;
        instance++
      ) {
        if (m.isInstancedMesh) {
          m.getMatrixAt(instance, local);
          local.premultiply(m.matrixWorld);
        } else local.copy(m.matrixWorld);
        for (let i = 0; i + 2 < count; i += 3) {
          triangle.a
            .fromBufferAttribute(pos, index ? index.getX(i) : i)
            .applyMatrix4(local);
          triangle.b
            .fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1)
            .applyMatrix4(local);
          triangle.c
            .fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2)
            .applyMatrix4(local);
          if (solidInverse) { triangle.a.applyMatrix4(solidInverse); triangle.b.applyMatrix4(solidInverse); triangle.c.applyMatrix4(solidInverse); }
          if (targetBox.intersectsTriangle(triangle)) {
            hit = true;
            break;
          }
        }
      }
    });
    return hit;
  }
  obstacles(owner = null, includeSelf = false) {
    const out = [];
    for (const o of this.app.objects) {
      if (
        (o === owner && !includeSelf) ||
        o.visible === false ||
        this.isPlant(o) ||
        !o.root
      )
        continue;
      o.root.updateMatrixWorld(true);
      if (o.type === "road_brush") {
        for (const child of o.root.children) {
          if (child.userData.roadSupport || child.userData.roadLamps) continue;
          const box = roadCollisionBounds(child);
          if (!box.isEmpty())
            out.push({
              box,
              object: o,
              road: true,
              self: o === owner,
              shape: child,
            });
        }
      } else {
        const box = new THREE.Box3().setFromObject(o.root);
        if (!box.isEmpty())
          out.push({ box, object: o, road: o.type === "road_intersection" });
      }
    }
    return out;
  }
  updateSupports() {
    if (this.busy) return;
    this.busy = true;
    try {
      const roads = this.app.objects.filter((o) => o.type === "road_brush"),
        allSupportBoxes = [];
      const allObstacles = this.obstacles(),
        tr = this.app.terrain;
      const signature = JSON.stringify([
        tr.n,
        tr.size,
        tr.enabled,
        tr.exaggerate,
        roads.map((o) => [
          o.id,
          o.root.uuid,
          o.visible,
          o._roadData.bridges,
          o._roadData.pierSpacing,
          o._roadData.bridgeThreshold,
        ]),
        allObstacles.map((v) => [
          v.object.id,
          v.shape?.uuid,
          v.box.min.toArray(),
          v.box.max.toArray(),
          v.shape?.matrixWorld.elements,
        ]),
      ]);
      if (
        signature === this._supportSignature &&
        (this._supportGround || []).every((p) => (tr.enabled ? tr.heightAt(p.x, p.z) : 0) === p.y)
      ) {
        if (this._supportSolids?.length) this.removePlants(this._supportSolids);
        this.supportCacheHits = (this.supportCacheHits || 0) + 1;
        return;
      }
      this._supportSignature = null;
      // Track the exact height reads of this deterministic candidate search. If every
      // previously evaluated branch input is unchanged, its placements remain identical.
      const groundSamples = [];
      const groundAt = (x, z) => {
        const y = tr.enabled ? tr.heightAt(x, z) : 0;
        groundSamples.push({ x, z, y });
        return y;
      };
      // Remove every old support before collecting obstacles, so order never changes collision results.
      for (const o of roads)
        for (const c of [...o.root.children])
          if (c.userData.roadSupport) this.dispose(c);
      for (const o of roads) {
        const rd = o._roadData,
          profile = rd.curve._terrainProfile;
        const status = {
          built: 0,
          blocked: 0,
          plantsRemoved: 0,
          blockedAt: [],
        };
        o.root.userData.bridgeStatus = status;
        if (
          !profile ||
          rd.bridges === false ||
          o.visible === false
        )
          continue;
        const obstacles = allObstacles.map((v) => ({
            ...v,
            self: v.object === o,
          })),
          spacing = clamp(Number(rd.pierSpacing) || 12, 6, 30),
          length = profile.points.at(-1).s,
          occupied = [];
        const group = new THREE.Group();
        group.name = "road-supports";
        group.userData.roadSupport = true;
        for (let s = spacing / 2; s < length; s += spacing) {
          const seed = this.atDistance(profile, s);
          if (
            !seed ||
            seed.y - groundAt(seed.x, seed.z) < (rd.bridgeThreshold || 1.8)
          )
            continue;
          let placed = false;
          for (const shift of [0, -2, 2, -4, 4, -6, 6]) {
            const p = this.atDistance(profile, clamp(s + shift, 1, length - 1));
            if (!p || occupied.some((d) => Math.abs(d - p.s) < spacing * 0.5))
              continue;
            if (
              (rd.gaps || []).some(
                (g) =>
                  p.s / length >= g.t0 - 0.01 && p.s / length <= g.t1 + 0.01,
              )
            )
              continue;
            const ground = groundAt(p.x, p.z),
              top = p.y + 0.015;
            if (top - ground < (rd.bridgeThreshold || 1.8)) continue;
            const column = new THREE.Box3(
              new THREE.Vector3(p.x - 0.65, ground - 0.35, p.z - 0.65),
              new THREE.Vector3(p.x + 0.65, top - 0.35, p.z + 0.65),
            );
            const next = this.atDistance(profile, Math.min(length, p.s + 0.3)),
              prev = this.atDistance(profile, Math.max(0, p.s - 0.3));
            const yaw = Math.atan2(next.x - prev.x, next.z - prev.z),
              span = Math.min(profile.half * 0.7, 4),
              grade = (next.y-prev.y)/(Math.hypot(next.x-prev.x,next.z-prev.z)||1);
            const shear = new THREE.Matrix4().set(1,0,0,0, 0,1,grade,0, 0,0,1,0, 0,0,0,1);
            const capMatrix = new THREE.Matrix4().makeRotationY(yaw).multiply(shear)
              .scale(new THREE.Vector3(span*2,.5,1.6)).setPosition(p.x,top-.25,p.z);
            const cap = new THREE.Box3(V().setScalar(-.5),V().setScalar(.5)).applyMatrix4(capMatrix);
            const capInverse = capMatrix.clone().invert();
            // Other objects use conservative full-volume bounds. Self geometry uses the
            // actual sheared cap volume, so a sloped deck is not mistaken for a collision.
            const boxes = [column, cap],
              hit = boxes.some(
                (b) =>
                  obstacles.some((v) =>
                    v.self
                      ? b.intersectsBox(v.box) &&
                        this.intersectsGeometry(b, v.shape, b === cap ? capInverse : null)
                      : b
                          .clone()
                          .expandByScalar(v.road ? 0.35 : 0.15)
                          .intersectsBox(v.box),
                  ) || allSupportBoxes.some((v) => b.intersectsBox(v)),
              );
            if (hit) continue;
            for (const box of boxes) {
              const size = box.getSize(V()),
                center = box.getCenter(V());
              if (size.y <= 0) continue;
              const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(
                  box === cap ? span * 2 : size.x,
                  box === cap ? .5 : size.y,
                  box === cap ? 1.6 : size.z,
                ),
                new THREE.MeshStandardMaterial({
                  color: 0x92918b,
                  roughness: 0.94,
                }),
              );
              mesh.position.copy(center);
              if (box === cap) { shearRoadGrade(mesh, grade); mesh.rotation.y = yaw; }
              mesh.castShadow = mesh.receiveShadow = true;
              mesh.userData.roadSupport = true;
              group.add(mesh);
              allSupportBoxes.push(box);
            }
            occupied.push(p.s);
            status.built++;
            placed = true;
            break;
          }
          if (!placed) {
            status.blocked++;
            status.blockedAt.push({ s, point: [seed.x, seed.y, seed.z] });
          }
        }
        if (group.children.length) o.root.add(group);
        this.app.appearance?.apply(o);
      }
      const decks = roads.flatMap((o) =>
        o.root.children
          .filter((c) => !c.userData.roadSupport && !c.userData.roadLamps)
          .map((c) => roadCollisionBounds(c)),
      );
      const solids = allSupportBoxes.concat(decks);
      this.removePlants(solids);
      this._supportGround = groundSamples;
      this._supportSolids = solids;
      this._supportSignature = signature;
      this.supportBuilds = (this.supportBuilds || 0) + 1;
      this.app.stage.view.invalidate?.();
    } finally {
      this.busy = false;
      updateRoadLighting(this.app);
    }
  }
  atDistance(profile, s) {
    const pts = profile.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      if (s > b.s) continue;
      const t = clamp((s - a.s) / (b.s - a.s || 1), 0, 1);
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t,
        s,
      };
    }
    return pts.at(-1);
  }
  removePlants(boxes) {
    const app = this.app,
      prev = app._suspendUndo,
      refit = app._inRefit;
    app._suspendUndo = true;
    app._inRefit = true;
    try {
      for (const o of [...app.objects]) {
        if (!this.isPlant(o) || !o.root || o.visible === false) continue;
        if (o.type === "vegetation_patch") {
          o.root.updateMatrixWorld(true);
          const kept = o.params.plants.filter((p) => {
            const b = vegetationBounds(p, o.root.matrixWorld);
            return !boxes.some((box) => box.intersectsBox(b));
          });
          if (kept.length === o.params.plants.length) continue;
          o.params.plants = kept;
          if (kept.length) app.vegetationBrush.rebuild(o);
          else app.removeObject(o);
        } else {
          const b = new THREE.Box3().setFromObject(o.root);
          if (boxes.some((box) => box.intersectsBox(b))) app.removeObject(o);
        }
      }
    } finally {
      app._suspendUndo = prev;
      app._inRefit = refit;
    }
  }
  setRoad(so, patch) {
    so = this.app.byId(so?.id);
    if (
      !so ||
      so.locked ||
      this.app.roadBrush._editBackup ||
      (this.app.roadBrush.active && this.app.roadBrush.points.length)
    )
      return false;
    this.app.beginOp("道路地形与桥梁参数");
    Object.assign(so._roadData, patch);
    this.sync();
    this.app.bus.emit("objects");
    this.app.bus.emit("select");
    this.app.saveLocal?.();
    return true;
  }
  liftRoad(so, y) {
    so = this.app.byId(so?.id);
    if (
      !so ||
      !Number.isFinite(y) ||
      so.locked ||
      this.app.roadBrush._editBackup
    )
      return false;
    const delta = y - so._roadData.ctrl[0][1];
    this.app.beginOp("道路设计标高");
    so._roadData.ctrl = so._roadData.ctrl.map((p) => [
      p[0],
      p[1] + delta,
      p[2],
    ]);
    so._roadData.terrainMode = "fixed";
    this.sync();
    this.app.bus.emit("objects");
    this.app.bus.emit("select");
    this.app.saveLocal?.();
    return true;
  }
  fillAt(x, z, r, strength = 1, only = null) {
    const tr = this.app.terrain,
      roads = this.app.roadBrush._roads.filter((rd) => {
        if (only && rd !== only._roadData) return false;
        const profile = rd.curve._terrainProfile;
        return (
          profile &&
          nearestProfile(profile, x, z).distance <= r + profile.half + 3
        );
      }),
      cell = tr.size / (tr.n - 1),
      obstacles = new Map();
    let changed = 0;
    for (const rd of roads)
      obstacles.set(
        rd,
        this.obstacles(this.app.objects.find((o) => o._roadData === rd)),
      );
    const i0 = Math.max(0, Math.floor((x - r + tr.size / 2) / cell)),
      i1 = Math.min(tr.n - 1, Math.ceil((x + r + tr.size / 2) / cell)),
      j0 = Math.max(0, Math.floor((z - r + tr.size / 2) / cell)),
      j1 = Math.min(tr.n - 1, Math.ceil((z + r + tr.size / 2) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = -tr.size / 2 + i * cell,
          pz = -tr.size / 2 + j * cell,
          dist = Math.hypot(px - x, pz - z);
        if (dist > r) continue;
        const idx = j * tr.n + i,
          old = tr.h[idx] * tr.exaggerate;
        let target = old;
        for (const rd of roads) {
          const profile = rd.curve._terrainProfile;
          if (!profile) continue;
          const p = nearestProfile(profile, px, pz);
          if (!p || p.distance > profile.half + 3) continue;
          const side = clamp((profile.half + 3 - p.distance) / 3, 0, 1),
            radial = clamp((r - dist) / Math.max(cell, r * 0.2), 0, 1);
          const proposed =
            old +
            Math.max(0, p.y - 0.02 - old) *
              side *
              radial *
              clamp(strength, 0, 1);
          if (proposed <= target + 0.001) continue;
          const volume = new THREE.Box3(
            new THREE.Vector3(px - cell / 2, old + 0.05, pz - cell / 2),
            new THREE.Vector3(px + cell / 2, proposed, pz + cell / 2),
          );
          if (
            obstacles
              .get(rd)
              .some((v) =>
                volume.clone().expandByScalar(0.15).intersectsBox(v.box),
              )
          )
            continue;
          target = proposed;
        }
        if (target > old + 0.001) {
          tr.h[idx] = target / tr.exaggerate;
          changed++;
        }
      }
    return changed;
  }
  fillRoad(so) {
    so = this.app.byId(so?.id);
    if (!so || so.locked || this.app.roadBrush._editBackup) return;
    this.app.beginOp("填充道路下方路基");
    const changed = this.fillAt(0, 0, this.app.terrain.size * 1.5, 1, so);
    this.app.terrain.refresh();
    this.app.bus.emit("terrain");
    this.app.bus.emit("objects");
    this.app.saveLocal?.();
    return changed;
  }
  bakeTransform(so) {
    if (so?.type !== "road_brush") return;
    const root = so.root;
    if (
      root.position.lengthSq() < 1e-12 &&
      root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6 &&
      root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6
    )
      return;
    root.updateMatrixWorld(true);
    so._roadData.ctrl = so._roadData.ctrl.map((p) =>
      new THREE.Vector3(...p).applyMatrix4(root.matrixWorld).toArray(),
    );
    if (
      Math.abs(root.position.y) > 0.05 ||
      Math.abs(root.rotation.x) > 0.001 ||
      Math.abs(root.rotation.z) > 0.001
    )
      so._roadData.terrainMode = "fixed";
    this.sync();
  }
}
