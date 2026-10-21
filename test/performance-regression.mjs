import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import puppeteer from "puppeteer";
import { VEGETATION } from "../src/vegetation-brush.js";
import { disposeDeep } from "../src/util.js";
import { summarize } from "../src/performance-monitor.js";
assert.deepEqual(summarize([]), {
  samples: 0,
  mean: null,
  p50: null,
  p95: null,
  max: null,
});
assert.deepEqual(summarize([100, 3, 1, 2]), {
  samples: 4,
  mean: 26.5,
  p50: 2,
  p95: 100,
  max: 100,
});
{
  const geometry = new THREE.BoxGeometry(),
    texture = new THREE.Texture(),
    material = new THREE.MeshBasicMaterial({ map: texture }),
    root = new THREE.Group();
  let geometries = 0,
    materials = 0,
    textures = 0,
    instances = 0;
  geometry.addEventListener("dispose", () => geometries++);
  material.addEventListener("dispose", () => materials++);
  texture.addEventListener("dispose", () => textures++);
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.addEventListener("dispose", () => instances++);
    root.add(mesh);
  }
  disposeDeep(root);
  assert.deepEqual(
    { geometries, materials, textures, instances },
    { geometries: 1, materials: 1, textures: 1, instances: 2 },
  );
}
const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    protocolTimeout: 480000,
  }),
  errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (
      m.type() === "error" &&
      /shader|WebGLProgram|GL_INVALID|ReferenceError/i.test(m.text())
    )
      errors.push(m.text());
  });
};
try {
  const parent = await browser.newPage();
  watch(parent);
  await parent.setViewport({ width: 1440, height: 1000 });
  await parent.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
  );
  await parent.waitForFunction(
    () => window.__previzBooted && window.app?.performance,
  );
  assert.ok(
    await parent.evaluate(
      () =>
        app.performance.startup.constructionMs > 0 &&
        app.performance.startup.readyAtMs > 0,
    ),
    "Startup milestones populated",
  );
  const result = await parent.evaluate(async (key) => {
    const a = app,
      p = a.performance,
      stage = a.stage,
      tr = a.terrain,
      b = a.vegetationBrush;
    a.suspended = true;
    a._suspendUndo = true;
    let refused = false;
    const initial = JSON.stringify(a.serialize());
    try {
      await a.runPerformanceBenchmarks({ samples: 1, warmup: 1 });
    } catch (e) {
      refused = /独立/.test(e.message);
    }
    if (!refused || initial !== JSON.stringify(a.serialize()))
      throw new Error("Parent benchmark isolation failed");
    a.benchmarkMode = true;
    a.clearAll();
    tr.setWater(false);
    tr.h.fill(0);
    tr.refresh();
    a.lighting.setMode("physical");
    a.lighting.physical.configure({
      shadows: false,
      sunElev: 48,
      quality: "low",
    });
    a.lighting.flushEnvironment();
    stage.renderer.setPixelRatio(1);
    stage.renderer.setSize(320, 180, false);
    stage.w = 320;
    stage.h = 180;
    stage.view.aspect = 320 / 180;
    stage.view.updateProjectionMatrix();
    const plants = Array.from({ length: 400 }, (_, i) => ({
      key,
      p: [(i % 20) * 5 - 48, 0, Math.floor(i / 20) * 5 - 48],
      s: 1,
      rot: 0,
    }));
    let o = a.addVegetationPatch({ plants });
    a.bus.emit("objects");
    const root = o.root,
      meshes = [...root.children],
      geometries = meshes.map((m) => m.geometry),
      matrices = meshes.map((m) => m.instanceMatrix);
    a.select({ kind: "obj", so: o });
    a.appearance.setMode(o, "off");
    const materials = meshes.map((m) => m.material);
    let disposals = 0;
    meshes.forEach((m) => m.addEventListener("dispose", () => disposals++));
    for (let i = 0; i < 12; i++) {
      tr.h.fill(i % 2);
      tr.refresh();
      b.refit();
    }
    const identity =
      o.root === root &&
      a.selObj === o &&
      stage.tc.object === root &&
      meshes.every(
        (m, i) =>
          root.children[i] === m &&
          m.geometry === geometries[i] &&
          m.material === materials[i] &&
          m.instanceMatrix === matrices[i],
      );
    const versions = meshes.map((m) => m.instanceMatrix.version);
    b.refit();
    const unchanged = meshes.every(
      (m, i) => m.instanceMatrix.version === versions[i],
    );
    root.position.set(3, 2, 4);
    root.rotation.y = 0.6;
    root.scale.set(1.2, 0.8, 1.1);
    tr.h.fill(6);
    b.refit();
    root.updateWorldMatrix(true, false);
    const v = stage.view.position.clone();
    const transformed = o.params.plants.every(
      (p) =>
        Math.abs(v.fromArray(p.p).applyMatrix4(root.matrixWorld).y - 6) < 1e-5,
    );
    p.capture();
    const multiPassBefore = stage.renderer.info.autoReset;
    stage.anamorphicEnabled = true;
    const composer = stage.useComposer;
    stage.useComposer = false;
    p.capture();
    const multipass = p.frames.at(-1).calls;
    stage.anamorphicEnabled = false;
    stage.useComposer = composer;
    const render = stage.render;
    let restoredAfterThrow = false;
    try {
      stage.render = () => {
        throw new Error("expected test render failure");
      };
      p.capture();
    } catch {
      restoredAfterThrow = stage.renderer.info.autoReset === multiPassBefore;
    } finally {
      stage.render = render;
    }
    let now = 1000;
    p.reset();
    p.beginFrame(now);
    p.endFrame(1, 2);
    p.beginFrame(now + 400);
    p.endFrame(1, 2);
    const trueInterval = p.snapshot({ resources: false }).frame.interval.mean;
    for (let i = 0; i < 300; i++) {
      p.beginFrame(now + 500 + i * 16);
      p.endFrame(1, 2);
    }
    for (let i = 0; i < 100; i++) p.record("bounded" + i, i);
    const bounded =
      p.frames.length === 240 &&
      p.recent.length === 40 &&
      p.operations.size === 32;
    a.removeObject(o);
    const finalDisposals = disposals;
    const attr = b.dots.geometry.attributes.position;
    for (let i = 0; i < 20; i++) {
      b.stroke = { plants: plants.slice(0, 10) };
      b.updateDots();
      b.stop();
    }
    const dotBuffer =
      b.dots.geometry.attributes.position === attr &&
      b.dots.geometry.drawRange.count === 0;
    // Same-process, warmed CPU comparison of the former rebuild-every-time algorithm.
    tr.h.fill(0);
    o = a.addVegetationPatch({
      plants: plants.map((p) => ({ ...p, p: [p.p[0], 0, p.p[2]] })),
    });
    a.bus.emit("objects");
    p.enabled = false;
    const legacy = () => {
      for (const object of a.objects.filter(
        (o) => o.type === "vegetation_patch",
      )) {
        object.root.updateMatrixWorld(true);
        const inverse = object.root.matrixWorld.clone().invert();
        for (const plant of object.params.plants) {
          const world = stage.view.position
            .clone()
            .fromArray(plant.p)
            .applyMatrix4(object.root.matrixWorld);
          world.y = tr.enabled ? tr.heightAt(world.x, world.z) : 0;
          plant.p = world.applyMatrix4(inverse).toArray();
        }
        b.rebuild(object);
      }
    };
    const time = (fn, changed) => {
      const start = performance.now();
      for (let i = 0; i < 12; i++) {
        tr.h.fill(changed ? i % 2 : 0);
        fn();
      }
      return performance.now() - start;
    };
    legacy();
    b.refit();
    const comparison = {
      legacyUnchanged: [],
      inPlaceUnchanged: [],
      legacyChanged: [],
      inPlaceChanged: [],
      plants: 400,
      iterations: 12,
    };
    for (let round = 0; round < 5; round++) {
      comparison.legacyUnchanged.push(time(legacy, false));
      comparison.inPlaceUnchanged.push(time(() => b.refit(), false));
      comparison.legacyChanged.push(time(legacy, true));
      comparison.inPlaceChanged.push(time(() => b.refit(), true));
    }
    p.enabled = true;
    a.clearAll();
    // Repeated create / delete / undo / quality changes: compare warmed residency, not zero.
    a._suspendUndo = false;
    const residency = [];
    for (let i = 0; i < 5; i++) {
      a.setDetail(i % 2 ? "std" : "lite", { silent: true });
      a.beginOp("性能回归种植");
      const patch = a.addVegetationPatch({ plants: plants.slice(0, 40) });
      a.bus.emit("objects");
      p.capture();
      const beforeQuality = patch.root;
      a.setDetail(i % 2 ? "lite" : "std", { silent: true });
      if (patch.root === beforeQuality)
        throw new Error("Detail switch did not rebuild existing vegetation");
      a.undo();
      if (a.byId(patch.id)) throw new Error("Undo did not remove vegetation");
      a.redo();
      if (!a.byId(patch.id)) throw new Error("Redo did not restore vegetation");
      p.capture();
      a.removeObject(a.byId(patch.id));
      a.localLights.setQuality(i % 2 ? "high" : "low");
      a.lighting.physical.configure({ sunElev: i % 2 ? -14 : 48 });
      a.lighting.flushEnvironment();
      a.bus.emit("objects");
      p.capture();
      residency.push({ ...p.snapshot({ resources: false }).renderer });
    }
    a._suspendUndo = true;
    a.clearAll();
    a.setDetail("std", { silent: true });
    const canary = a.addAsset(key, [0, 0, 0]);
    canary.name = "PERFORMANCE_ISOLATION_CANARY";
    a.benchmarkMode = false;
    await a.saveLocal();
    a.benchmarkMode = true;
    // An interval save may have queued while our explicit save awaited IndexedDB.
    // Settle this parent's own permitted writes before installing the immutable canary.
    await a._saveQueue;
    const saved = localStorage.getItem("cameraref.project");
    a.openPerformance();
    return {
      refused,
      identity,
      unchanged,
      transformed,
      finalDisposals,
      expectedDisposals: meshes.length,
      dotBuffer,
      multipass,
      restoredAfterThrow,
      trueInterval,
      bounded,
      comparison,
      residency,
      saved,
      parentDocument: JSON.stringify(a.serialize()),
    };
  }, VEGETATION[0].key);
  for (const name of [
    "refused",
    "identity",
    "unchanged",
    "transformed",
    "dotBuffer",
    "restoredAfterThrow",
    "bounded",
  ])
    assert.ok(result[name], name);
  assert.equal(result.finalDisposals, result.expectedDisposals);
  assert.equal(result.trueInterval, 400);
  assert.ok(result.multipass >= 3);
  for (const field of ["geometries", "textures", "programs"])
    assert.ok(
      result.residency.at(-1)[field] <=
        Math.max(result.residency[1][field], result.residency[2][field]) + 2,
      `${field} residency grows after warmup`,
    );
  assert.match(
    await parent.$eval("[data-performance-metrics]", (el) => el.textContent),
    /RAF p50 \/ p95/,
  );
  await parent.keyboard.press("Delete");
  assert.equal(
    await parent.evaluate(() => JSON.stringify(app.serialize())),
    result.parentDocument,
    "Modal blocks editor shortcuts",
  );
  await parent.click("[data-performance-export]");
  assert.ok(
    await parent.evaluate(async () => {
      document.querySelector("[data-performance-dialog]").close();
      app.openPerformance();
      await new Promise((r) => setTimeout(r, 0));
      return (
        document.querySelectorAll("[data-performance-dialog][open]").length ===
        1
      );
    }),
    "Rapid reopen keeps the new modal",
  );
  // Build the second tab's URL from the same loaded entry (also works with file://).
  const scratchURL = await parent.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("fresh", "1");
    url.searchParams.set("benchmark", "1");
    url.searchParams.delete("scene");
    return url.href;
  });
  const scratch = await browser.newPage();
  watch(scratch);
  await scratch.setViewport({ width: 1440, height: 1000 });
  await scratch.goto(scratchURL);
  await scratch.waitForFunction(
    () => window.__previzBooted && window.app?.runPerformanceBenchmarks,
  );
  assert.deepEqual(
    await scratch.evaluate(async () => ({
      mode: app.benchmarkMode,
      objects: app.objects.length,
      saveResult: await app.saveLocal(),
    })),
    { mode: true, objects: 0, saveResult: false },
  );
  await scratch.evaluate(() => app.openPerformance());
  await scratch.click("[data-benchmark-run]");
  await scratch.waitForFunction(() => app._benchmarkRunning);
  await scratch.$$eval("button", (bs) =>
    bs.find((b) => b.textContent === "取消基准").click(),
  );
  await scratch.waitForFunction(
    () => app._benchmarkReport?.cancelled && !app._benchmarkRunning,
    { timeout: 120000 },
  );
  assert.match(
    await scratch.$eval("[data-benchmark-status]", (el) => el.textContent),
    /已取消/,
  );
  await scratch.evaluate(() =>
    document.querySelector("[data-performance-dialog]").close(),
  );
  const report = await scratch.evaluate(
    async () => await app.runPerformanceBenchmarks({ samples: 3, warmup: 2 }),
  );
  assert.equal(report.error, undefined);
  assert.equal(report.cancelled, false);
  assert.deepEqual(
    report.fixtures.map((f) => f.fixture.id),
    ["town", "dense", "terrain", "night"],
  );
  for (const row of report.fixtures) {
    assert.equal(row.submit.samples, 3);
    assert.equal(row.interval.samples, 2);
    assert.ok(row.interval.p95 > 0);
    assert.ok(row.calls.mean > 0 && row.triangles.mean > 0);
    assert.ok(row.archiveBytes > 100 && row.packMs > 0 && row.restoreMs > 0);
    assert.equal(row.snapshot.viewport.width, 960);
    assert.equal(row.snapshot.viewport.height, 540);
    assert.equal(row.snapshot.viewport.pixelRatio, 1);
    assert.ok(row.buildOperations.length > 0);
  }
  const night = report.fixtures.find((f) => f.fixture.id === "night");
  assert.equal(night.snapshot.lights.active, 8);
  assert.equal(night.snapshot.lights.shadows, 1);
  assert.ok(
    report.fixtures.find((f) => f.fixture.id === "terrain").terrainEditMs > 0,
  );
  assert.equal(
    await parent.evaluate(() => localStorage.getItem("cameraref.project")),
    result.saved,
  );
  assert.equal(
    await parent.evaluate(() => JSON.stringify(app.serialize())),
    result.parentDocument,
  );
  assert.ok(
    await scratch.evaluate(async () => {
      await app.loadEnv();
      return app._auto?.objects.some(
        (o) => o.name === "PERFORMANCE_ISOLATION_CANARY",
      );
    }),
    "IndexedDB canary preserved",
  );
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/performance-regression.json",
    JSON.stringify(
      { comparison: result.comparison, residency: result.residency, report },
      null,
      2,
    ),
  );
  console.log(
    "PASS performance: real intervals / bounded sampling / multipass / renderer restore / stable instancing and preview buffers / mesh disposal / undo-quality lifecycle / isolated cancellable four-fixture benchmarks / autosave protection / JSON archive roundtrip",
  );
  console.log(
    JSON.stringify(
      {
        comparison: result.comparison,
        residency: result.residency,
        fixtures: report.fixtures.map((f) => ({
          id: f.fixture.id,
          calls: f.calls.mean,
          triangles: f.triangles.mean,
          p50: f.submit.p50,
          p95: f.submit.p95,
          archiveBytes: f.archiveBytes,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
