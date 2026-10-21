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
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /shader|WebGLProgram/i.test(m.text()))
      errors.push(m.text());
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await page.waitForFunction(() => window.__previzBooted);
  const r = await page.evaluate(async () => {
    const a = app,
      s = a.stage,
      m = a.modelInstancing,
      perf = a.performance;
    const check = (v, text) => {
      if (!v) throw Error(text);
    };
    const fixture = await a.runPerformanceBenchmarks({
      ids: ["dense"],
      warmup: 2,
      samples: 3,
    });
    const dense = fixture.fixtures[0];
    const key = dense.assets.building;
    a.suspended = true;
    a._quietAdd = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.lighting.physical.configure({
      sunElev: 48,
      shadows: true,
      fog: 0,
      whiteBalance: 6500,
    });
    a.addAsset(key, [8, 0, 8], { merge: true });
    a.addAsset(key, [24, 0, 8], { merge: true });
    a.addAsset(key, [40, 0, 8], { merge: true });
    a.select(null);
    a.bus.emit("objects");
    s.orbit.enableDamping = false;
    s.helperLayer.visible = false;
    s.renderer.setSize(400, 260, false);
    s.view.aspect = 400 / 260;
    s.view.updateProjectionMatrix();
    s.view.position.set(37, 24, 45);
    s.orbit.target.set(23, 2, 8);
    s.orbit.update();
    const capture = (enabled) => {
      m.enabled = enabled;
      m.invalidate();
      perf.requestDrawAttribution();
      perf.beginFrame();
      const update = s.orbit.update;
      s.orbit.update = () => {};
      try {
        s.render();
      } finally {
        s.orbit.update = update;
        perf.endFrame(0, 0);
      }
      const gl = s.renderer.getContext(),
        rgba = new Uint8Array(400 * 260 * 4);
      gl.readPixels(0, 0, 400, 260, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return {
        rgba,
        calls: perf.frames.at(-1).calls,
        triangles: perf.frames.at(-1).triangles,
        attribution: perf.snapshot().drawAttribution,
      };
    };
    const before = capture(false);
    const stored = JSON.stringify(a.serialize());
    const after = capture(true);
    check(
      after.calls < before.calls * 0.7,
      "insufficient instance call reduction",
    );
    check(
      JSON.stringify(a.serialize()) === stored,
      "render changed project: " +
        Object.keys(a.serialize())
          .filter(
            (k) =>
              JSON.stringify(a.serialize()[k]) !==
              JSON.stringify(JSON.parse(stored)[k]),
          )
          .join(","),
    );
    let total = 0,
      changed = 0,
      max = 0;
    for (let i = 0; i < before.rgba.length; i++) {
      if (i % 4 === 3) continue;
      const d = Math.abs(before.rgba[i] - after.rgba[i]);
      total += d;
      max = Math.max(max, d);
      if (d > 3) changed++;
    }
    const mean = total / (400 * 260 * 3),
      changedFraction = changed / (400 * 260 * 3);
    check(
      mean < 0.6 && changedFraction < 0.01,
      `pixel mismatch ${mean}/${changedFraction}`,
    );
    check(
      after.attribution.rows.some((x) => x.category === "adobe" && x.main > 0),
      "proxy draw category missing",
    );
    const originalIds = a.objects.map((o) => o.id),
      first = a.objects[0],
      root = first.root;
    a.select({ kind: "obj", so: first });
    s.render();
    check(s.tc.object === root, "gizmo detached");
    const point = root.position.clone();
    point.y = 3.7;
    s.pointer.copy(point.project(s.view));
    const picked = s.pick();
    check(picked.so?.id === first.id, "original object picking failed");
    a._suspendUndo = false;
    a.beginOp("move building");
    first.root.position.x += 2;
    s.render();
    check(
      a.byId(first.id).root === root && m.batches.length > 0,
      "move replaced logical object",
    );
    check(
      a.undo() && a.byId(first.id).root.position.x === 8,
      "move undo failed",
    );
    check(
      a.redo() && a.byId(first.id).root.position.x === 10,
      "move redo failed",
    );
    check(
      JSON.stringify(a.objects.map((o) => o.id)) ===
        JSON.stringify(originalIds),
      "undo changed IDs/order",
    );
    const target = a.byId(first.id);
    a.appearance.setMode(target, "off");
    s.render();
    check(target.materialMode === "off", "individual material override lost");
    const privateMeshes = new Set();
    target.root.traverse((o) => {
      if (o.isMesh) privateMeshes.add(o);
    });
    check(
      !m.batches.some(
        (b) =>
          b.members.some((x) => privateMeshes.has(x.mesh)) &&
          b.members.some((x) => x.so !== target),
      ),
      "different display policies mixed",
    );
    target.visible = false;
    target.apply();
    a.bus.emit("objects");
    s.render();
    check(
      !m.batches.some((b) => b.members.some((x) => x.so === target)),
      "hidden building instanced",
    );
    target.visible = true;
    target.apply();
    a.bus.emit("objects");
    a.rebuildObject(target);
    s.render();
    check(
      a.byId(target.id) === target && target.root !== root,
      "parameter rebuild lost object identity",
    );
    const archive = await a.saveProject();
    await a.importFiles([new File([archive], "instanced.previz")]);
    s.render();
    check(
      JSON.stringify(a.objects.map((o) => o.id)) ===
        JSON.stringify(originalIds),
      "archive IDs/order lost",
    );
    check(
      a.byId(first.id).materialMode === "off",
      "archive material override lost",
    );
    a.appearance.setMode(a.byId(first.id), "inherit");
    s.render();
    const proxies = m.batches.map((b) => b.proxy);
    let disposed = 0;
    for (const p of proxies) p.addEventListener("dispose", () => disposed++);
    m.invalidate();
    check(disposed === proxies.length, "instance buffers not disposed");
    s.render();
    // A negative/sheared transform must use the ordinary path, not incorrect instance normals.
    const moved = a.byId(first.id);
    moved.root.scale.set(-1, 1, 1);
    s.render();
    check(
      !m.batches.some((b) => b.members.some((x) => x.so === moved)),
      "negative scale did not fall back",
    );
    moved.root.scale.set(1, 1, 1);
    a.bus.emit("objects");
    s.render();
    // Custom source shader hooks cannot safely assume instancing semantics.
    const custom = [];
    moved.root.traverse((o) => {
      if (o.isMesh) {
        o.onBeforeRender = function () {};
        custom.push(o);
      }
    });
    a.bus.emit("objects");
    s.render();
    check(
      !m.batches.some((b) => b.members.some((x) => custom.includes(x.mesh))),
      "custom callbacks batched",
    );
    for (const o of custom) delete o.onBeforeRender;
    a.bus.emit("objects");
    s.render();
    const enter = m.enter;
    m.enter = function () {
      enter.call(this, s.view);
      throw Error("intentional render preparation failure");
    };
    let caught = false;
    try {
      s.render();
    } catch (e) {
      caught = e.message.includes("intentional");
    } finally {
      m.enter = enter;
    }
    check(
      caught && !m.rendering && !m.group.visible && !m.hidden.length,
      "failed render leaked transaction state",
    );
    for (const b of m.batches)
      for (const x of b.members)
        check(x.mesh.visible, "failed render left source invisible");
    return {
      entry: location.protocol,
      dense: { calls: dense.calls, triangles: dense.triangles },
      before: { calls: before.calls, triangles: before.triangles },
      after: { calls: after.calls, triangles: after.triangles },
      pixels: { mean, changedFraction, max },
      instanceDisposals: disposed,
      objectIds: originalIds.length,
      groups: m.batches.length,
    };
  });
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/model-instancing-regression.json",
    JSON.stringify(r, null, 2),
  );
  console.log(
    "PASS building render-only instancing / pixels / original picking + gizmo / move undo-redo / material + hidden fallback / rebuild / archive / disposal / negative scale + callbacks / failure restoration",
    r,
  );
} finally {
  await browser.close();
}
