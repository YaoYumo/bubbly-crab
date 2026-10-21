import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 480000,
});
const errors = [];
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
  await p.setViewport({ width: 1280, height: 900 });
  if (process.env.TEST_FILE_URL?.startsWith("file:"))
    await p.setOfflineMode(true);
  await p.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await p.waitForFunction(
    () => window.__previzBooted && window.app?.stage.pickIndex,
  );
  const result = await p.evaluate(async (smoke) => {
    const a = app,
      s = a.stage,
      index = s.pickIndex;
    const check = (v, m) => {
      if (!v) throw Error(m);
    };
    let comparisons = 0,
      objectHits = 0;
    const equal = (x, y) => {
      check(
        x.kind === y.kind &&
          x.so === y.so &&
          x.object === y.object &&
          x.shot === y.shot &&
          x.i === y.i &&
          x.objSo === y.objSo,
        "pick identity mismatch",
      );
      check(
        x.point.distanceTo(y.point) < 1e-6 && x.distance === y.distance,
        "pick point/distance mismatch",
      );
      comparisons++;
      if (x.kind === "obj") objectHits++;
    };
    // Original precise path + original acceptance policy, independently of the new resolver.
    function legacy() {
      s.raycaster.setFromCamera(s.pointer, s.view);
      for (const h of s.raycaster.intersectObjects(
        [s.world, s.helperLayer],
        true,
      )) {
        if (h.object.userData?.pickIgnore) continue;
        if (h.object.userData?.keyRef)
          return { kind: "key", ...h.object.userData.keyRef, point: h.point };
        let o = h.object;
        while (o && !o.userData?.so && o !== s.world) o = o.parent;
        if (o?.userData?.so)
          return {
            kind: "obj",
            so: o.userData.so,
            object: o,
            point: h.point,
            distance: h.distance,
          };
        o = h.object;
        while (o && !o.userData?.shotRef && o !== s.world) o = o.parent;
        if (o?.userData?.shotRef)
          return { kind: "shot", shot: o.userData.shotRef, point: h.point };
        if (h.object.userData?.ground)
          return { kind: "ground", point: h.point };
      }
      return { kind: "empty", point: s.groundPoint(0) };
    }
    function matrices() {
      s.world.updateMatrixWorld(true);
      s.helperLayer.updateMatrixWorld(true);
      s.view.updateMatrixWorld(true);
    }
    function comparePointers(pointers) {
      matrices();
      for (const [x, y] of pointers) {
        s.pointer.set(x, y);
        equal(legacy(), s.pick());
      }
    }
    const summarize = (values) => {
      const v = [...values].sort((a, b) => a - b);
      return {
        samples: v.length,
        mean: v.reduce((a, b) => a + b, 0) / v.length,
        p50: v[Math.ceil(v.length * 0.5) - 1],
        p95: v[Math.ceil(v.length * 0.95) - 1],
        max: v.at(-1),
      };
    };
    const evidence = [];
    function measure(fixture) {
      const serialized = JSON.stringify(a.serialize({ assets: false })),
        selected = a.sel,
        attached = s.tc.object;
      const pointers = [];
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 7; x++)
          pointers.push([-0.9 + x * 0.3, -0.85 + y * 0.425]);
      matrices();
      for (const so of a.objects.slice(0, 14)) {
        const at = so.root.getWorldPosition(s.view.position.clone());
        at.y += Math.min(3, (so.height?.() ?? 3) * 0.45);
        at.project(s.view);
        pointers.push([at.x, at.y]);
      }
      // Independent first query, then broad-phase cold query (bounds may be shared engine caches).
      s.pointer.set(...pointers[0]);
      let start = performance.now();
      legacy();
      const legacyFirstMs = performance.now() - start;
      index.invalidate("benchmark cold");
      start = performance.now();
      s.pick();
      const cold = { ...index.stats, wallMs: performance.now() - start };
      // Explicit test warmup outside the measured query: cold production queries
      // now use precise fallback while idle jobs prepare bounds.
      while (index.work.jobs.size) index.work.slice();
      comparePointers(pointers);
      function batch(indexed) {
        const start = performance.now();
        for (const [x, y] of pointers) {
          s.pointer.set(x, y);
          indexed ? s.pick() : legacy();
        }
        return (performance.now() - start) / pointers.length;
      }
      for (let i = 0; i < 8; i++) {
        batch(i % 2 === 0);
        batch(i % 2 !== 0);
      }
      const raw = [],
        indexed = [];
      for (let i = 0; i < 30; i++) {
        if (i % 2) {
          indexed.push(batch(true));
          raw.push(batch(false));
        } else {
          raw.push(batch(false));
          indexed.push(batch(true));
        }
      }
      const counts = [],
        phases = [];
      for (const [x, y] of pointers) {
        s.pointer.set(x, y);
        s.pick();
        counts.push(index.stats.candidates);
        phases.push({ ...index.stats });
      }
      check(
        serialized === JSON.stringify(a.serialize({ assets: false })) &&
          selected === a.sel &&
          attached === s.tc.object,
        "query mutated project/selection",
      );
      check(
        phases.every((x) => x.indexed && !x.cold),
        "hot picks rebuilt index",
      );
      evidence.push({
        fixture,
        rays: pointers.length,
        warmupBatches: 8,
        sampleBatches: 30,
        legacyFirstMs,
        cold,
        legacyMsPerPick: summarize(raw),
        indexedMsPerPick: summarize(indexed),
        rawBatches: raw,
        indexedBatches: indexed,
        candidates: summarize(counts),
        roots: index.stats.roots,
        indexedRoots: index.stats.indexedRoots,
        fallbackRoots: index.stats.fallbackRoots,
        ignoredRoots: index.stats.ignoredRoots,
        last: index.stats,
        meanRatio: summarize(indexed).mean / summarize(raw).mean,
      });
    }
    // Longer fixed-scene render sample too; no assertions on machine-dependent timings.
    const benchmark = await a.runPerformanceBenchmarks({
      warmup: smoke ? 1 : 8,
      samples: smoke ? 1 : 30,
      ids: smoke ? ["dense"] : ["town", "dense", "terrain", "night"],
      onProgress: (e) => {
        if (e.phase === "保存 / 恢复") measure(e.fixture);
      },
    });
    check(
      !benchmark.error && evidence.length === (smoke ? 1 : 4),
      "benchmark failed: " + benchmark.error,
    );
    a.suspended = true;
    a._suspendUndo = true;
    a._quietAdd = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    const key = benchmark.fixtures.find((x) => x.fixture.id === "dense").assets
      .building;
    for (let i = 0; i < 8; i++)
      a.addAsset(key, [i * 20, 0, 0], { merge: true });
    a.select(null);
    a.bus.emit("objects");
    s.orbit.enableDamping = false;
    s.helperLayer.visible = true;
    const aim = (so) => {
      const at = so.worldPos();
      at.y += 3.7;
      s.view.position.copy(at).add(s.view.position.clone().set(0, 28, 24));
      s.orbit.target.copy(at);
      s.orbit.update();
      s.render();
      matrices();
      s.pointer.copy(at.project(s.view));
    };
    const checkObject = (so) => {
      aim(so);
      const actual = s.pick();
      equal(legacy(), actual);
      check(
        actual.so === so && actual.object === so.root,
        "target not original",
      );
      return actual;
    };
    const ids = a.objects.map((x) => x.id),
      so = a.objects[0];
    checkObject(so);
    a.select({ kind: "obj", so });
    check(s.tc.object === so.root, "gizmo detached");
    // Render proxy batching must not become a selectable replacement.
    s.render();
    const batches = a.modelInstancing.batches.length;
    check(batches > 0, "fixture did not instance");
    checkObject(so);
    a._suspendUndo = false;
    a.beginOp("拾取索引移动");
    so.root.position.x += 4;
    a.bus.emit("gizmo-live");
    check(
      index.dirty && index.entries.length === 0,
      "gizmo invalidation retained roots",
    );
    checkObject(so);
    check(a.undo(), "undo failed");
    checkObject(a.byId(ids[0]));
    check(a.redo(), "redo failed");
    checkObject(a.byId(ids[0]));
    a._suspendUndo = true;
    const live = a.byId(ids[0]),
      oldRoot = live.root;
    a.rebuildObject(live);
    check(
      index.dirty && index.entries.length === 0,
      "rebuild retained old roots",
    );
    check(live.root !== oldRoot, "fixture not rebuilt");
    checkObject(live);
    await index.prewarm();
    checkObject(live);
    live.root.position.x += 3;
    checkObject(live);
    check(
      !index.stats.cold && index.stats.refit,
      "root transform did not refit",
    );
    live.root.rotation.y = 0.4;
    live.root.scale.x = -1;
    checkObject(live);
    live.visible = false;
    live.apply();
    a.bus.emit("objects");
    checkObject(live);
    live.visible = true;
    live.apply();
    a.bus.emit("objects");
    live.motion.active = true;
    checkObject(live);
    check(
      index.entries.find((e) => e.root === live.root).mode === "fallback",
      "active path indexed",
    );
    live.motion.active = false;
    const shot=a.addShot({name:'拾取回退测试机位'});
    matrices();s.pick();
    check(index.entries.find(e=>e.root===shot.rig)?.mode==='fallback','camera rig not on precise fallback');
    a.removeShot(shot);
    check(index.dirty&&index.entries.length===0&&index.tree===null,'shot deletion retained roots');
    a.select({kind:'obj',so:live});checkObject(live);
    a.windowLights.configure({ mode: "on", ratio: 0.5 });
    a.appearance.setMode(live, "off");
    checkObject(live);
    a.openPerformance();
    const toggle = document.querySelector("[data-pick-index-toggle]");
    check(toggle, "toggle missing");
    const before = JSON.stringify(a.serialize({ assets: false }));
    toggle.click();
    check(!index.enabled, "disable failed");
    checkObject(live);
    check(!index.stats.indexed, "legacy disabled path not used");
    toggle.click();
    check(index.enabled, "enable failed");
    checkObject(live);
    check(
      before === JSON.stringify(a.serialize({ assets: false })),
      "toggle saved in project",
    );
    document.querySelector("[data-performance-dialog]").close();
    // Imported geometry and real archive round-trip, without changing source resource identity.
    a.select(null);
    const [imported] = await a.importFiles([
      new File(
        ["o PickFixture\nv 0 0 0\nv 0 0 4\nv 4 0 0\nf 1 2 3\n"],
        "pick.obj",
      ),
    ]);
    check(imported, "OBJ fixture missing");
    imported.root.position.set(220, 0, 0);
    a.bus.emit("objects");
    const assetId = imported.params.assetId,
      importedId = imported.id,
      archive = await a.saveProject();
    // Triangle aim differs from the building target helper.
    function compareImported(obj) {
      matrices();
      let mesh;
      obj.root.traverse((n) => {
        if (!mesh && n.isMesh) mesh = n;
      });
      const position = mesh.geometry.attributes.position,
        indices = mesh.geometry.index;
      const at = s.view.position.clone().set(0, 0, 0);
      for (let i = 0; i < 3; i++)
        at.add(
          s.view.position
            .clone()
            .fromBufferAttribute(position, indices ? indices.getX(i) : i),
        );
      at.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      s.view.position.copy(at).add(s.view.position.clone().set(0, 25, 5));
      s.orbit.target.copy(at);
      s.orbit.update();
      s.render();
      matrices();
      s.pointer.copy(at.project(s.view));
      equal(legacy(), s.pick());
      check(s.pick().so === obj, "imported original not picked");
    }
    compareImported(imported);
    await a.importFiles([new File([archive], "pick.previz")]);
    check(
      a.byId(importedId).params.assetId === assetId,
      "source asset ID changed",
    );
    check(
      a.objects
        .slice(0, ids.length)
        .map((x) => x.id)
        .join() === ids.join(),
      "archive IDs/order changed",
    );
    compareImported(a.byId(importedId));
    checkObject(a.byId(ids[0]));
    a.removeObject(a.byId(importedId));
    check(
      index.entries.length === 0 && index.tree === null,
      "delete retained roots",
    );
    checkObject(a.byId(ids[0]));
    a.terrain.setEnabled(true);
    a.terrain.generate("hills", 4, 731);
    checkObject(a.byId(ids[0]));
    a.clearAll();
    check(
      index.entries.length === 0 && index.tree === null,
      "clear retained roots",
    );
    const clickSo = a.addAsset(key, [0, 0, 0], { merge: true });
    a.terrain.setEnabled(false);
    a.select(null);
    aim(clickSo);
    const rect = s.canvas.getBoundingClientRect(),
      nativeClick = {
        id: clickSo.id,
        x: rect.left + ((s.pointer.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - s.pointer.y) * rect.height) / 2,
      };
    return {
      nativeClick,
      smoke,
      entry: location.protocol,
      offline: navigator.onLine === false,
      comparisons,
      objectHits,
      batches,
      fixtures: evidence,
      renderBenchmark: benchmark,
      checks: [
        "legacy independent resolver",
        "identity + points + distance",
        "stable project + selection",
        "instanced source picking",
        "gizmo",
        "move + undo-redo",
        "rebuild + root refit",
        "negative scale",
        "hidden legacy semantics",
        "dynamic fallback",
        "gray + windows",
        "runtime toggle + diagnostic UI",
        "imported OBJ + real archive",
        "IDs/order/resource ID",
        "delete/clear releases",
        "terrain refit",
      ],
    };
  }, process.env.PICK_SMOKE === "1");
  await p.mouse.click(result.nativeClick.x, result.nativeClick.y);
  await p.evaluate((id) => {
    if (app.selObj?.id !== id || app.stage.tc.object !== app.selObj.root)
      throw Error("native click did not select original + gizmo");
    app.clearAll();
    if (app.stage.pickIndex.entries.length || app.stage.pickIndex.tree)
      throw Error("native cleanup retained roots");
  }, result.nativeClick.id);
  result.checks.push("native pointer click selects original + gizmo");
  assert.deepEqual(errors, []);
  assert.ok(result.objectHits > 10);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    `.shots/pick-spatial-index-${result.entry === "file:" ? "file" : "dev"}${result.smoke ? "-smoke" : ""}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    "PASS pick spatial index / original exact raycast + editing + archive",
    JSON.stringify(
      {
        entry: result.entry,
        offline: result.offline,
        comparisons: result.comparisons,
        objectHits: result.objectHits,
        fixtures: result.fixtures.map((f) => ({
          fixture: f.fixture,
          roots: f.roots,
          candidates: f.candidates.mean,
          cold: f.cold.wallMs,
          legacy: f.legacyMsPerPick,
          index: f.indexedMsPerPick,
          ratio: f.meanRatio,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
