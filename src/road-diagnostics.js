import * as THREE from "three";

// Read-only, explicitly requested scene diagnostics, not a civil engineering solver.
const CELL = 8,
  MAX_TRIANGLES = 800000,
  MAX_CELLS = 1500000;
export const DIAGNOSTIC_DEFAULTS = {
  maxGrade: 10,
  minClearance: 4.5,
  terrainTolerance: 0.05,
};
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
// PlaneGeometry uses the b–d diagonal; bilinear heightAt is not the rendered triangle.
export function terrainSurfaceHeight(terrain, x, z) {
  if (
    !terrain.enabled ||
    Math.abs(x) > terrain.size / 2 ||
    Math.abs(z) > terrain.size / 2
  )
    return null;
  const n = terrain.n,
    u = (x / terrain.size + 0.5) * (n - 1),
    v = (z / terrain.size + 0.5) * (n - 1),
    i = Math.min(n - 2, Math.max(0, Math.floor(u))),
    j = Math.min(n - 2, Math.max(0, Math.floor(v))),
    fu = u - i,
    fv = v - j;
  const a = terrain.h[j * n + i],
    b = terrain.h[j * n + i + 1],
    c = terrain.h[(j + 1) * n + i],
    d = terrain.h[(j + 1) * n + i + 1];
  return (
    (fu + fv <= 1
      ? a + (b - a) * fu + (c - a) * fv
      : d + (c - d) * (1 - fu) + (b - d) * (1 - fv)) * (terrain.exaggerate || 1)
  );
}
function addCells(map, minX, maxX, minZ, maxZ, value, budget) {
  const x0 = Math.floor(minX / CELL),
    x1 = Math.floor(maxX / CELL),
    z0 = Math.floor(minZ / CELL),
    z1 = Math.floor(maxZ / CELL);
  const count = (x1 - x0 + 1) * (z1 - z0 + 1);
  if (
    !Number.isFinite(count) ||
    count > 10000 ||
    (budget && (budget.cells += count) > MAX_CELLS)
  )
    throw Error("道路范围过大，本次检查已停止；请缩小场景范围");
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const k = `${x},${z}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(value);
    }
}
export function worldAlignment(road) {
  road.root.updateWorldMatrix(true, true);
  const profile = road._roadData?.curve?._terrainProfile;
  if (!profile?.points?.length)
    throw Error("道路尚无有效高程剖面，请先完成绘制");
  let s = 0,
    length3D = 0;
  const points = profile.points.map((p, i) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(
      road.root.matrixWorld,
    );
    if (![v.x, v.y, v.z].every(Number.isFinite)) throw Error("道路坐标无效");
    return { x: v.x, y: v.y, z: v.z, local: p, s: 0 };
  });
  let maxGrade = 0,
    verticalSegments = 0,
    maxGradeAt = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      h = Math.hypot(b.x - a.x, b.z - a.z),
      dy = b.y - a.y;
    s += h;
    length3D += Math.hypot(h, dy);
    b.s = s;
    b.grade = h > 1e-8 ? (dy / h) * 100 : null;
    if (b.grade === null && Math.abs(dy) > 1e-6) verticalSegments++;
    if (b.grade !== null && Math.abs(b.grade) > maxGrade) {
      maxGrade = Math.abs(b.grade);
      maxGradeAt = i;
    }
  }
  return {
    points,
    length: s,
    length3D,
    maxGrade,
    maxGradeAt,
    verticalSegments,
    profile,
  };
}

// Vertical triangle intersection, independent of materials / face winding. Includes
// slab undersides for clearance; does NOT include support columns or render proxies.
export class RoadSurfaceIndex {
  constructor() {
    this.cells = new Map();
    this.triangles = 0;
    this.budget = { cells: 0 };
  }
  add(a, b, c, owner, orientation = 1) {
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-10) return; // A vertical wall has no horizontal surface area.
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    if (Math.abs(normal.y) / normal.length() < 0.15) return;
    if (++this.triangles > MAX_TRIANGLES)
      throw Error("道路几何超过检查预算，请减少道路或降低精度后重试");
    const t = {
      a: a.clone(),
      b: b.clone(),
      c: c.clone(),
      det,
      owner,
      up: normal.y * orientation > 0,
    };
    addCells(
      this.cells,
      Math.min(a.x, b.x, c.x),
      Math.max(a.x, b.x, c.x),
      Math.min(a.z, b.z, c.z),
      Math.max(a.z, b.z, c.z),
      t,
      this.budget,
    );
  }
  query(x, z) {
    const hits = new Map();
    for (const t of this.cells.get(cellKey(x, z)) || []) {
      const { a, b, c, det, owner } = t;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const y = u * a.y + v * b.y + (1 - u - v) * c.y;
      if (!hits.has(owner)) hits.set(owner, { all: [], up: [] });
      hits.get(owner).all.push(y);
      if (t.up) hits.get(owner).up.push(y);
    }
    return hits;
  }
}
function referenceIndex(alignment, road) {
  const cells = new Map(),
    e = road.root.matrixWorld.elements;
  const scale = Math.max(
    Math.hypot(e[0], e[1], e[2]),
    Math.hypot(e[8], e[9], e[10]),
  );
  const pad = alignment.profile.half * scale + 3;
  for (let i = 1; i < alignment.points.length; i++) {
    const a = alignment.points[i - 1],
      b = alignment.points[i];
    addCells(
      cells,
      Math.min(a.x, b.x) - pad,
      Math.max(a.x, b.x) + pad,
      Math.min(a.z, b.z) - pad,
      Math.max(a.z, b.z) + pad,
      [a, b],
    );
  }
  return (x, z) => {
    let distance = Infinity,
      y = null;
    for (const [a, b] of cells.get(cellKey(x, z)) || []) {
      const dx = b.x - a.x,
        dz = b.z - a.z,
        den = dx * dx + dz * dz,
        t = den
          ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / den))
          : 0;
      const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
      if (d < distance) {
        distance = d;
        y = a.y + t * (b.y - a.y);
      }
    }
    return y;
  };
}
export class RoadDiagnostics {
  constructor(app) {
    this.app = app;
    this.revision = 0;
    this.reports = new Map();
    this.options = { ...DIAGNOSTIC_DEFAULTS };
    this.open = false;
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false }),
    );
    this.marker.name = "road-diagnostic-location";
    this.marker.userData.pickIgnore = true;
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    app.stage.helperLayer.add(this.marker);
    for (const e of ["terrain", "objects", "gizmo-live"])
      app.bus.on(e, () => {
        this.revision++;
        this.marker.visible = false;
      });
    app.bus.on("select", () => {
      this.marker.visible = false;
    });
  }
  configure(key, input) {
    const ranges = {
        maxGrade: [0.1, 100],
        minClearance: [0, 30],
        terrainTolerance: [0, 1],
      },
      range = Object.hasOwn(ranges, key) ? ranges[key] : null,
      v = Number(input);
    if (!range || !Number.isFinite(v)) return false;
    const n = Math.max(range[0], Math.min(range[1], v));
    if (this.options[key] !== n) {
      this.options[key] = n;
      this.revision++;
      this.marker.visible = false;
    }
    return true;
  }
  cancel() {
    this.token = null;
  }
  async inspect(road, onProgress = () => {}) {
    if (road?.type !== "road_brush" || !this.app.objects.includes(road))
      throw Error("请先选中一条已完成的道路");
    const token = {},
      revision = this.revision,
      app = this.app,
      options = { ...this.options };
    this.token = token;
    const check = () => {
      if (
        this.token !== token ||
        this.revision !== revision ||
        !app.objects.includes(road)
      ) {
        const e = Error("场景或阈值已改变，请重新检查");
        e.name = "AbortError";
        throw e;
      }
    };
    try {
      const alignment = worldAlignment(road),
        index = new RoadSurfaceIndex(),
        references = new Map();
      const roads = app.objects.filter(
        (o) =>
          ["road_brush", "road_intersection"].includes(o.type) &&
          (o === road || o.visible !== false),
      );
      const connected = new Set(
        roads
          .filter(
            (o) =>
              o.type === "road_intersection" &&
              [o._isect?.newCurve, o._isect?.existingCurve].includes(
                road._roadData.curve,
              ),
          )
          .map((o) => o.id),
      );
      let operations = 0;
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3(),
        matrix = new THREE.Matrix4(),
        instance = new THREE.Matrix4();
      for (let ri = 0; ri < roads.length; ri++) {
        check();
        const other = roads[ri];
        if (other.type === "road_brush") {
          const ref = other === road ? alignment : worldAlignment(other);
          references.set(other.id, referenceIndex(ref, other));
        } else {
          other.root.updateWorldMatrix(true, true);
          const origin = new THREE.Vector3().applyMatrix4(
              other.root.matrixWorld,
            ),
            normal = new THREE.Vector3(0, 1, 0).applyNormalMatrix(
              new THREE.Matrix3().getNormalMatrix(other.root.matrixWorld),
            );
          references.set(other.id, (x, z) =>
            Math.abs(normal.y) > 0.15
              ? origin.y -
                (normal.x * (x - origin.x) + normal.z * (z - origin.z)) /
                  normal.y
              : null,
          );
        }
        const meshes = [];
        for (const child of other.root.children) {
          if (child.userData.roadSupport || child.userData.roadLamps) continue;
          child.traverseVisible((m) => {
            if (m.isMesh && m.geometry?.attributes.position) meshes.push(m);
          });
        }
        for (const m of meshes) {
          const pos = m.geometry.attributes.position,
            ix = m.geometry.index,
            count = ix ? ix.count : pos.count;
          for (let k = 0; k < (m.isInstancedMesh ? m.count : 1); k++) {
            matrix.copy(m.matrixWorld);
            if (m.isInstancedMesh) {
              m.getMatrixAt(k, instance);
              matrix.multiply(instance);
            }
            const orientation = matrix.determinant() < 0 ? -1 : 1;
            for (let i = 0; i + 2 < count; i += 3) {
              a.fromBufferAttribute(pos, ix ? ix.getX(i) : i).applyMatrix4(
                matrix,
              );
              b.fromBufferAttribute(
                pos,
                ix ? ix.getX(i + 1) : i + 1,
              ).applyMatrix4(matrix);
              c.fromBufferAttribute(
                pos,
                ix ? ix.getX(i + 2) : i + 2,
              ).applyMatrix4(matrix);
              index.add(a, b, c, other.id, orientation);
              if (++operations % 12000 === 0) {
                onProgress(`读取道路几何 ${ri + 1}/${roads.length}`);
                await yieldTask();
                check();
              }
            }
          }
        }
      }
      onProgress("采样横断面与净空");
      await yieldTask();
      check();
      let omittedIssues = 0;
      const ranges = new Map();
      const issues = [],
        samples = [],
        stride = Math.max(1, Math.ceil((alignment.points.length - 1) / 1024));
      let intrusion = null,
        clearance = null,
        coverage = 0,
        terrainSamples = 0,
        terrainOutside = 0;
      const groundAt = (x, z) => terrainSurfaceHeight(app.terrain, x, z);
      const addIssue = (issue) => {
        const key = issue.kind + ":" + (issue.otherId || "");
        const previous = ranges.get(key);
        if (
          previous &&
          issue.s - previous.endS < Math.max(3, stride * 1.5) &&
          issue.s >= previous.endS
        ) {
          previous.endS = issue.s;
          if (issue.severity > previous.severity) {
            previous.severity = issue.severity;
            previous.point = issue.point;
            previous.value = issue.value;
          }
          previous.count++;
        } else {
          const row = { ...issue, endS: issue.s, count: 1 };
          ranges.set(key, row);
          if (issues.length < 2000) issues.push(row);
          else omittedIssues++;
        }
      };
      // Grade uses every derived profile segment, not the decimated chart samples.
      for (let i = 1; i < alignment.points.length; i++) {
        const p = alignment.points[i];
        if (p.grade === null) {
          if (Math.abs(p.y - alignment.points[i - 1].y) > 1e-6)
            addIssue({
              kind: "vertical",
              s: p.s,
              point: [p.x, p.y, p.z],
              severity: 1,
              value: null,
            });
        } else if (Math.abs(p.grade) > options.maxGrade + 1e-6)
          addIssue({
            kind: "grade",
            s: p.s,
            point: [p.x, p.y, p.z],
            severity: Math.abs(p.grade),
            value: p.grade,
          });
      }
      const sampleIds = [];
      for (let i = 0; i < alignment.points.length; i += stride)
        sampleIds.push(i);
      if (sampleIds.at(-1) !== alignment.points.length - 1)
        sampleIds.push(alignment.points.length - 1);
      for (let si = 0; si < sampleIds.length; si++) {
        const i = sampleIds[si],
          p = alignment.points[i],
          before = alignment.points[Math.max(0, i - 1)].local,
          after =
            alignment.points[Math.min(alignment.points.length - 1, i + 1)]
              .local;
        const dx = after.x - before.x,
          dz = after.z - before.z,
          n = Math.hypot(dx, dz) || 1;
        const station = {
          s: p.s,
          y: p.y,
          grade: p.grade ?? null,
          ground: groundAt(p.x, p.z),
          intrusion: null,
          clearance: null,
          point: [p.x, p.y, p.z],
        };
        for (let j = 0; j < 9; j++) {
          const lateral = ((j / 8) * 2 - 1) * alignment.profile.half * 0.98;
          const v = new THREE.Vector3(
            p.local.x + (dz / n) * lateral,
            p.local.y,
            p.local.z - (dx / n) * lateral,
          ).applyMatrix4(road.root.matrixWorld);
          const hits = index.query(v.x, v.z),
            self = [...(hits.get(road.id)?.up || [])];
          for (const id of connected) self.push(...(hits.get(id)?.up || []));
          // Select the deck near this station, not a distant higher self-crossing.
          const deck = self.filter((y) => y >= v.y - 0.4 && y <= v.y + 1.5);
          if (!deck.length) continue;
          coverage++;
          const top = Math.max(...deck);
          const ground = groundAt(v.x, v.z);
          if (app.terrain.enabled && ground == null) terrainOutside++;
          if (ground != null) {
            terrainSamples++;
            const depth = ground - top;
            intrusion = Math.max(intrusion ?? -Infinity, depth);
            station.intrusion = Math.max(station.intrusion ?? -Infinity, depth);
            if (depth > options.terrainTolerance + 1e-6)
              addIssue({
                kind: "terrain",
                s: p.s,
                point: [v.x, top, v.z],
                severity: depth,
                value: depth,
              });
          }
          for (const [otherId, ys] of hits) {
            if (otherId === road.id) continue;
            const yRef = references.get(otherId)?.(v.x, v.z);
            if (yRef == null || yRef - v.y < 0.8) continue;
            // A separate upper road's actual underside, not its centerline or pavement top.
            const upper = ys.all;
            if (!upper.length) continue;
            const gap = Math.min(...upper) - top;
            clearance = Math.min(clearance ?? Infinity, gap);
            station.clearance = Math.min(station.clearance ?? Infinity, gap);
            if (gap < options.minClearance - 1e-6)
              addIssue({
                kind: "clearance",
                otherId,
                s: p.s,
                point: [v.x, top, v.z],
                severity: options.minClearance - gap,
                value: gap,
              });
          }
        }
        samples.push(station);
        if (si % 24 === 0) {
          onProgress(`横断面采样 ${si + 1}/${sampleIds.length}`);
          await yieldTask();
          check();
        }
      }
      const status = road.root.userData.bridgeStatus;
      for (const p of status?.blockedAt || []) {
        const v = new THREE.Vector3(...p.point).applyMatrix4(
          road.root.matrixWorld,
        );
        const near = alignment.points.reduce((a, b) =>
          Math.hypot(a.x - v.x, a.z - v.z) < Math.hypot(b.x - v.x, b.z - v.z)
            ? a
            : b,
        );
        addIssue({
          kind: "support",
          s: near.s,
          point: v.toArray(),
          severity: 1,
          value: null,
        });
      }
      const summary = {
        length: alignment.length,
        length3D: alignment.length3D,
        minY: Math.min(...alignment.points.map((p) => p.y)),
        maxY: Math.max(...alignment.points.map((p) => p.y)),
        maxGrade: alignment.maxGrade,
        verticalSegments: alignment.verticalSegments,
        maxIntrusion: intrusion,
        minClearance: clearance,
        terrainSamples,
        terrainOutside,
        builtSupports: status?.built || 0,
        blockedSupports: status?.blocked || 0,
      };
      check();
      const previous = this.reports.get(road.id),
        report = {
          roadId: road.id,
          name: road.name,
          revision,
          at: Date.now(),
          options,
          summary,
          samples,
          issues,
          omittedIssues,
          coverage,
          triangles: index.triangles,
          terrainEnabled: app.terrain.enabled,
          previous: previous
            ? {
                summary: previous.summary,
                at: previous.at,
                options: previous.options,
              }
            : null,
        };
      this.reports.delete(road.id);
      this.reports.set(road.id, report);
      while (this.reports.size > 8)
        this.reports.delete(this.reports.keys().next().value);
      return report;
    } finally {
      if (this.token === token) this.token = null;
    }
  }
  focus(report, point) {
    if (
      report.revision !== this.revision ||
      !this.app.byId(report.roadId) ||
      !point?.every(Number.isFinite)
    )
      return false;
    const app = this.app,
      st = app.stage;
    app.setPreview(false);
    st.orbit.autoRotate = false;
    const target = new THREE.Vector3(...point),
      direction = st.view.position.clone().sub(st.orbit.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 1, 1);
    st.orbit.target.copy(target);
    st.view.position.copy(target).addScaledVector(direction.normalize(), 24);
    st.orbit.update();
    this.marker.position.copy(target);
    this.marker.visible = true;
    return true;
  }
}
