import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import * as THREE from "three";
import puppeteer from "puppeteer";
import { subdivideForTerrain } from "../src/road-terrain.js";
import { batchRoadParts, roadCollisionBounds } from "../src/road-batching.js";

// Reference the previous subdivision algorithm; assert every Float32 attribute and group,
// not just triangle count. Matrix4 here is an object/world affine transform, not projection.
function reference(g, matrix, step = 2) {
  const attrs = Object.entries(g.attributes),
    out = Object.fromEntries(attrs.map(([k]) => [k, []])),
    groups = [];
  let written = 0;
  const read = (i) =>
    Object.fromEntries(
      attrs.map(([k, a]) => [
        k,
        Array.from(
          { length: a.itemSize },
          (_, j) => a.array[i * a.itemSize + j],
        ),
      ]),
    );
  const mid = (a, b) =>
    Object.fromEntries(
      attrs.map(([k]) => [k, a[k].map((v, i) => (v + b[k][i]) / 2)]),
    );
  const dist = (a, b) => {
    const p = new THREE.Vector3(...a.position).applyMatrix4(matrix),
      q = new THREE.Vector3(...b.position).applyMatrix4(matrix);
    return (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
  };
  function emit(a, b, c, depth) {
    const ds = [dist(a, b), dist(b, c), dist(c, a)],
      max = Math.max(...ds),
      edge = ds.indexOf(max);
    if (max > step * step && depth < 12) {
      if (edge === 0) {
        const p = mid(a, b);
        emit(a, p, c, depth + 1);
        emit(p, b, c, depth + 1);
      } else if (edge === 1) {
        const p = mid(b, c);
        emit(a, b, p, depth + 1);
        emit(a, p, c, depth + 1);
      } else {
        const p = mid(c, a);
        emit(a, b, p, depth + 1);
        emit(p, b, c, depth + 1);
      }
      return;
    }
    for (const v of [a, b, c]) for (const [k] of attrs) out[k].push(...v[k]);
    written += 3;
  }
  const count = g.index ? g.index.count : g.attributes.position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const start = written,
      mat =
        g.groups.find((v) => i >= v.start && i < v.start + v.count)
          ?.materialIndex || 0;
    emit(
      ...[i, i + 1, i + 2].map((j) => read(g.index ? g.index.getX(j) : j)),
      0,
    );
    if (g.groups.length) {
      const prev = groups.at(-1);
      if (prev && prev.materialIndex === mat) prev.count += written - start;
      else groups.push({ start, count: written - start, materialIndex: mat });
    }
  }
  return {
    attrs: Object.fromEntries(
      attrs.map(([k]) => [k, new Float32Array(out[k])]),
    ),
    groups,
  };
}
for (const indexed of [true, false])
  for (const scale of [1, 0.7, 2.1]) {
    let g = new THREE.BoxGeometry(7, 0.3, 13);
    if (!indexed) g = g.toNonIndexed();
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(11, -3, 7),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.21, 0.43, 0.16)),
      new THREE.Vector3(scale, 0.9, 1.2),
    );
    const expected = reference(g, matrix),
      actual = subdivideForTerrain(g, matrix);
    for (const [k, a] of Object.entries(expected.attrs))
      assert.deepEqual(
        actual.attributes[k].array,
        a,
        `subdivision ${indexed}/${scale}/${k}`,
      );
    assert.deepEqual(actual.groups, expected.groups);
    actual.dispose();
    g.dispose();
  }
{
  const road = new THREE.Group(),
    span = new THREE.Group();
  road.add(span);
  const material = new THREE.MeshStandardMaterial({ color: 0x555555 });
  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.2, 3),
      material.clone(),
    );
    mesh.position.set(i * 3, 1, i);
    mesh.rotation.y = i * 0.2;
    mesh.castShadow = mesh.receiveShadow = true;
    span.add(mesh);
  }
  const original = span.clone(true);
  const collisionBefore = roadCollisionBounds(span);
  const box = new THREE.Box3().setFromObject(road),
    triangles = span.children.reduce(
      (s, m) => s + m.geometry.index.count / 3,
      0,
    );
  assert.equal(batchRoadParts(road), 4);
  assert.equal(span.children.length, 1);
  assert.deepEqual(roadCollisionBounds(span), collisionBefore);
  span.position.x = original.position.x = 3;
  span.rotation.y = original.rotation.y = 0.4;
  const movedCollision = roadCollisionBounds(span),
    movedOriginal = new THREE.Box3().setFromObject(original);
  assert.ok(
    movedCollision.min.distanceTo(movedOriginal.min) < 1e-6 &&
      movedCollision.max.distanceTo(movedOriginal.max) < 1e-6,
  );
  span.position.x = 0;
  span.rotation.y = 0;
  assert.equal(span.children[0].geometry.index.count / 3, triangles);
  assert.ok(
    box.min.distanceTo(new THREE.Box3().setFromObject(road).min) < 1e-5,
  );
  assert.ok(
    box.max.distanceTo(new THREE.Box3().setFromObject(road).max) < 1e-5,
  );
  const root = new THREE.Group(),
    parts = new THREE.Group();
  root.add(parts);
  for (const color of [0x777777, 0x777778])
    parts.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ color }),
      ),
    );
  assert.equal(
    batchRoadParts(root),
    0,
    "close colors must not be rounded together",
  );
  parts.children[1].material = parts.children[0].material.clone();
  parts.children[1].castShadow = true;
  assert.equal(batchRoadParts(root), 0, "shadow policy retained");
}
const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    protocolTimeout: 480000,
  }),
  errors = [];
try {
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (
      m.type() === "error" &&
      /shader|WebGLProgram|ReferenceError/i.test(m.text())
    )
      errors.push(m.text());
  });
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await p.waitForFunction(() => window.__previzBooted);
  const result = await p.evaluate(async () => {
    const a = app,
      tr = a.terrain,
      rt = a.roadTerrain,
      rb = a.roadBrush,
      m = a.performance;
    const check = (v, msg) => {
      if (!v) throw new Error(msg);
    };
    a.suspended = true;
    a.benchmarkMode = true;
    a._suspendUndo = true;
    a._quietAdd = true;
    // Geometry fingerprint independent of mesh/batch order, excluding derived supports.
    const fingerprint = (o) => {
      o.root.updateWorldMatrix(true, true);
      let hash = 0,
        count = 0;
      const v = a.stage.view.position.clone();
      o.root.traverse((mesh) => {
        let parent = mesh;
        while (parent) {
          if (parent.userData.roadSupport) return;
          parent = parent.parent;
        }
        if (!mesh.isMesh) return;
        const g = mesh.geometry,
          n = g.index ? g.index.count : g.attributes.position.count;
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(
            g.attributes.position,
            g.index ? g.index.getX(i) : i,
          ).applyMatrix4(mesh.matrixWorld);
          let h = 2166136261;
          for (const x of [v.x, v.y, v.z])
            h = Math.imul(h ^ Math.round(x * 1e4), 16777619);
          hash = (hash + (h >>> 0)) >>> 0;
          count++;
        }
      });
      return { hash, count };
    };
    const roads = () => a.objects.filter((o) => o.type === "road_brush");
    const reset = () => {
      a.clearAll();
      tr.setResolution(65);
      tr.setSize(160);
      tr.setWater(false);
      tr.setEnabled(true);
      tr.h.fill(0);
      tr.refresh();
    };
    reset();
    rb.restore(
      [-50, 0, 50].map((z, i) => ({
        id: "local" + i,
        points: [
          [-65, 0, z],
          [65, 0, z],
        ],
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
      })),
    );
    a.bus.emit("objects");
    const roots = roads().map((o) => o.root),
      ids = roads().map((o) => o.id);
    a.select({ kind: "obj", so: roads()[0] });
    a.state.terrainTool = "raise";
    tr.setBrush({ size: 8, strength: 1 });
    tr.paintAt(35, 50);
    a.bus.emit("terrain");
    a.bus.emit("objects");
    check(
      rt.lastSync.rebuilt === 1,
      "local edit must rebuild only one independent road",
    );
    check(
      roads()[0].root === roots[0] &&
        roads()[1].root === roots[1] &&
        roads()[2].root !== roots[2],
      "unaffected roots stay alive",
    );
    check(
      a.selObj?.id === ids[0] && a.stage.tc.object === roots[0],
      "selection/gizmo retained",
    );
    check(
      JSON.stringify(roads().map((o) => o.id)) === JSON.stringify(ids),
      "road order/ids retained",
    );
    const local = roads().map(fingerprint);
    rt.sync();
    check(
      JSON.stringify(roads().map(fingerprint)) === JSON.stringify(local),
      "incremental road geometry differs from full rebuild",
    );
    const target = roads()[2];
    a.appearance.setMode(target, "off");
    a.select({ kind: "obj", so: target });
    tr.paintAt(35, 50);
    a.bus.emit("terrain");
    a.bus.emit("objects");
    const updated = a.byId(target.id);
    check(
      updated.root !== target.root &&
        updated.materialMode === "off" &&
        a.selObj === updated &&
        a.stage.tc.object === updated.root,
      "affected selection/material policy lost",
    );
    updated.root.traverse((o) => {
      if (o.isMesh)
        check(!o.material.map, "affected road lost untextured display mode");
    });
    const nowRoots = roads().map((o) => o.root);
    tr.setBrush({ size: 3, strength: 1 });
    tr.paintAt(35, 25);
    const builds = rt.supportBuilds;
    a.bus.emit("terrain");
    a.bus.emit("objects");
    check(
      rt.lastSync.rebuilt === 0 &&
        roads().every((o, i) => o.root === nowRoots[i]),
      "off-road edit rebuilt roads",
    );
    check(
      rt.supportBuilds === builds,
      "off-road edit rebuilt unchanged supports",
    );
    // Bridges depend on terrain below a fixed deck, not just road profile changes.
    reset();
    rb.restore([
      {
        id: "fixed",
        points: [
          [-55, 7, 0],
          [55, 7, 0],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "fixed",
      },
    ]);
    a.bus.emit("objects");
    const fixed = roads()[0],
      fixedRoot = fixed.root;
    const support = () =>
      fixed.root.children
        .filter((c) => c.userData.roadSupport)
        .flatMap((c) => c.children);
    check(support().length > 0, "fixed bridge has no piers");
    const originalSupport = support()[0];
    tr.h.fill(1);
    tr.refresh();
    a.bus.emit("terrain");
    a.bus.emit("objects");
    check(roads()[0].root === fixedRoot, "fixed deck unnecessarily rebuilt");
    check(
      support()[0] !== originalSupport,
      "ground beneath fixed bridge did not refresh piers",
    );
    const stable = support()[0];
    const cachedBuilds = rt.supportBuilds;
    a.bus.emit("objects");
    check(
      support()[0] === stable && rt.supportBuilds === cachedBuilds,
      "redundant objects event rebuilt piers",
    );
    // Ordinary obstacle moves/visibility and new vegetation must still invalidate or clear.
    const keys = (
      await a.runPerformanceBenchmarks({ ids: ["town"], samples: 1, warmup: 1 })
    ).fixtures[0].assets;
    const treeKey = keys.tree;
    a.suspended = true;
    a._quietAdd = true;
    reset();
    rb.restore([
      {
        id: "bridge",
        points: [
          [-55, 7, 0],
          [55, 7, 0],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "fixed",
      },
    ]);
    a.bus.emit("objects");
    const bridge = roads()[0],
      beforeSupports = rt.supportBuilds;
    const plant = a.addAsset(treeKey, [0, 0, 0]);
    a.bus.emit("objects");
    check(
      !a.byId(plant.id),
      "cached support clearance skipped newly placed tree",
    );
    check(
      rt.supportBuilds === beforeSupports,
      "plant-only addition rebuilt bridge layout",
    );
    const house = a.addAsset(keys.building, [25, 0, 25]);
    let buildsBefore = rt.supportBuilds;
    a.bus.emit("objects");
    check(
      rt.supportBuilds > buildsBefore,
      "new obstacle did not invalidate supports",
    );
    buildsBefore = rt.supportBuilds;
    house.root.position.x += 3;
    a.bus.emit("objects");
    check(
      rt.supportBuilds > buildsBefore,
      "moving obstacle did not invalidate supports",
    );
    buildsBefore = rt.supportBuilds;
    house.visible = false;
    house.apply();
    a.bus.emit("objects");
    check(
      rt.supportBuilds > buildsBefore,
      "hiding obstacle did not invalidate supports",
    );
    // Grade-separated crossing becomes a junction and back; disconnected far road remains.
    reset();
    rb.restore([
      {
        id: "follow",
        points: [
          [-55, 0, 0],
          [55, 0, 0],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "follow",
      },
      {
        id: "cross",
        points: [
          [0, 4, -50],
          [0, 4, 50],
        ],
        width: 8,
        roadType: "concrete",
        terrainMode: "fixed",
      },
      {
        id: "far",
        points: [
          [-55, 0, 75],
          [55, 0, 75],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "fixed",
      },
    ]);
    a.bus.emit("objects");
    check(
      !a.objects.some((o) => o.type === "road_intersection"),
      "initial grade separation lost",
    );
    for (const height of [4, 0]) {
      const far = a.byId("far").root;
      tr.h.fill(height);
      tr.refresh();
      a.bus.emit("terrain");
      a.bus.emit("objects");
      check(a.byId("far").root === far, "disconnected far road rebuilt");
      check(
        a.objects.filter((o) => o.type === "road_intersection").length ===
          (height === 4 ? 1 : 0),
        "junction topology did not change with grade",
      );
      const derived = roads().map(fingerprint);
      rt.sync();
      check(
        JSON.stringify(roads().map(fingerprint)) === JSON.stringify(derived),
        "crossing differs from full rebuild",
      );
    }
    // Same library road geometry with batching on/off: fewer calls and identical triangles.
    reset();
    tr.setEnabled(false);
    const spec = [
      {
        id: "draw",
        points: [
          [-55, 0, 0],
          [55, 0, 0],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "fixed",
      },
    ];
    a.stage.renderer.setPixelRatio(1);
    a.stage.renderer.setSize(320, 180, false);
    a.stage.w = 320;
    a.stage.h = 180;
    a.stage.view.aspect = 320 / 180;
    a.stage.view.updateProjectionMatrix();
    const measure = (flag) => {
      a.clearAll();
      tr.setEnabled(false);
      rb.batchRoads = flag;
      rb.restore(spec);
      a.select(null);
      a.bus.emit("objects");
      m.capture();
      const callbacks = new Map();
      a.stage.scene.traverse((o) => {
        if (o.isMesh)
          callbacks.set(o, [
            o.onBeforeRender,
            Object.hasOwn(o, "onBeforeRender"),
            o.onBeforeShadow,
            Object.hasOwn(o, "onBeforeShadow"),
          ]);
      });
      m.requestDrawAttribution();
      m.capture();
      for (const [o, old] of callbacks)
        check(
          o.onBeforeRender === old[0] &&
            Object.hasOwn(o, "onBeforeRender") === old[1] &&
            o.onBeforeShadow === old[2] &&
            Object.hasOwn(o, "onBeforeShadow") === old[3],
          "attribution callback leaked",
        );
      const gl = a.stage.renderer.getContext(),
        raw = new Uint8Array(320 * 180 * 4);
      gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const pixels = [];
      for (let i = 0; i < raw.length; i += 64)
        pixels.push(raw[i], raw[i + 1], raw[i + 2]);
      return {
        pixels,
        calls: m.frames.at(-1).calls,
        triangles: m.frames.at(-1).triangles,
        attribution: m.snapshot().drawAttribution,
        shape: fingerprint(roads()[0]),
      };
    };
    const unbatched = measure(false),
      batched = measure(true);
    const pixelDifference =
      batched.pixels.reduce(
        (s, v, i) => s + Math.abs(v - unbatched.pixels[i]),
        0,
      ) / batched.pixels.length;
    check(pixelDifference < 1, "batched road pixels changed");
    delete unbatched.pixels;
    delete batched.pixels;
    check(
      batched.calls < unbatched.calls * 0.6,
      "batching draw reduction too small",
    );
    check(
      batched.triangles === unbatched.triangles,
      "batching changed triangles",
    );
    check(
      batched.shape.count === unbatched.shape.count,
      "batching vertex/index content changed",
    );
    check(
      batched.attribution.rows.some((r) => r.category === "road_brush"),
      "road draw attribution absent",
    );
    check(
      batched.attribution.rows.reduce((s, r) => s + r.total, 0) +
        batched.attribution.otherCalls ===
        batched.calls,
      "attribution does not reconcile",
    );
    check(
      batched.shape.hash === unbatched.shape.hash,
      "batched world geometry changed",
    );
    m.requestDrawAttribution();
    m.beginFrame();
    m.enabled = false;
    m.endFrame(0, 0);
    check(
      !m._attribution && a.stage.renderer.info.autoReset === true,
      "mid-frame pause leaked renderer or callbacks",
    );
    m.enabled = true;
    a.openPerformance();
    return {
      pixelDifference,
      localRebuilt: 1,
      offRoadRebuilt: 0,
      unbatched,
      batched,
      supportCacheHits: rt.supportCacheHits,
    };
  });
  assert.ok(await p.$("[data-draw-attribution]"));
  await p.click("[data-draw-attribution]");
  await p.evaluate(() => app.performance.capture());
  assert.equal(await p.evaluate(() => app.performance._attributeNext), false);
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/road-performance-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    "PASS exact subdivision / conservative material batching / incremental vs full geometry / road IDs-order-selection / off-road no-op / fixed-deck terrain supports / cached vegetation clearance / grade topology / draw attribution restore / native diagnostic button",
    JSON.stringify(result),
  );
} finally {
  await browser.close();
}
