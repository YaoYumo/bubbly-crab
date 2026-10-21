import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    protocolTimeout: 360000,
  }),
  errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push(m.text());
      console.log("WINDOW_ERROR", m.text().slice(0, 280));
    } else if (m.text().startsWith("WINDOW_PHASE")) console.log(m.text());
  });
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL?.startsWith("file:"))
    await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await page.waitForFunction(() => window.__previzBooted);
  const r = await page.evaluate(async () => {
    const a = app,
      s = a.stage,
      w = a.windowLights,
      m = a.modelInstancing,
      perf = a.performance,
      check = (v, text) => {
        if (!v) throw Error(text);
      };
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.lighting.setMode("physical");
    a.lighting.physical.configure({
      source: "manual",
      sunElev: -12,
      shadows: false,
      fog: 0,
      whiteBalance: 6500,
    });
    const one = a.addAsset("house:adobe:Adobe 土坯平顶房", [0, 0, 0]),
      two = a.addAsset("house:adobe:Adobe 土坯平顶房", [17, 0, 0], {
        merge: true,
      }),
      three = a.addAsset("house:adobe:Adobe 土坯平顶房", [34, 0, 0], {
        merge: true,
      }),
      tower = a.addAsset("building:tower:玻璃幕墙写字楼", [16, 0, -28], {
        params: { floors: 6, width: 12, depth: 10 },
      });
    check(one && two && three && tower, "fixture missing");
    one.name = "窗灯 <safe>";
    a.select(null);
    a.bus.emit("objects");
    check(
      w.settings.mode === "legacy" && w.states.size === 0,
      "old model appearance altered by default",
    );
    const ids = a.objects.map((o) => o.id),
      sources = [];
    one.root.traverse((o) => {
      if (o.material?.userData.role === "glass")
        sources.push([
          o.material,
          o.material.emissive.getHex(),
          o.material.emissiveIntensity,
        ]);
    });
    const lights = () => {
      let n = 0;
      s.scene.traverse((o) => {
        if (o.isLight) n++;
      });
      return n;
    };
    const lightCount = lights();
    s.orbit.enableDamping = false;
    s.helperLayer.visible = false;
    s.renderer.setSize(400, 260, false);
    s.view.aspect = 400 / 260;
    s.view.updateProjectionMatrix();
    s.view.position.set(50, 26, 60);
    s.orbit.target.set(17, 8, -8);
    s.orbit.update();
    const capture = (enabled) => {
      m.enabled = enabled;
      m.invalidate();
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
        pixels = new Uint8Array(400 * 260 * 4);
      gl.readPixels(0, 0, 400, 260, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const frame = perf.frames.at(-1);
      return { pixels, calls: frame.calls, triangles: frame.triangles };
    };
    const difference = (x, y) => {
      let sum = 0,
        changed = 0;
      for (let i = 0; i < x.length; i++) {
        if (i % 4 === 3) continue;
        sum += Math.abs(x[i] - y[i]);
        if (Math.abs(x[i] - y[i]) > 3) changed++;
      }
      return { mean: sum / (400 * 260 * 3), changed };
    };

    w.configure({ mode: "on", ratio: 0 });
    const dark = capture(false);
    w.configure({ ratio: 1 });
    const bright = capture(false),
      brightness = difference(dark.pixels, bright.pixels);
    check(
      brightness.mean > 0.1 && brightness.changed > 100,
      "windows did not visibly illuminate " + JSON.stringify(brightness),
    );
    check(
      s.canvas.toDataURL("image/png").startsWith("data:image/png"),
      "emissive frame PNG capture failed",
    );
    check(
      dark.calls === bright.calls && dark.triangles === bright.triangles,
      "window emission increased draw calls/triangles",
    );
    check(lights() === lightCount, "real light added per window");
    check(
      w.states.get(two.root).gpu.length > 0 &&
        w.states.get(tower.root).gpu.some((p) => p.grid),
      "merged/curtainwall shader paths missing",
    );
    check(
      w.states.get(one.root).selected === w.states.get(one.root).units,
      "ratio 1 not all ordinary windows",
    );
    w.configure({ ratio: 0.45, seed: 42 });
    const seeded = capture(true),
      selected = w.states.get(one.root).selected;
    w.configure({ seed: 43 });
    const changed = capture(true);
    check(
      difference(seeded.pixels, changed.pixels).changed > 20,
      "seed did not affect visible windows",
    );
    w.configure({ seed: 42 });
    const repeated = capture(true);
    check(
      difference(seeded.pixels, repeated.pixels).mean === 0,
      "same seed moved pattern",
    );
    const ordinaryRoot = one.root;
    one.root.position.x += 1;
    one.root.rotation.y = 0.2;
    a.bus.emit("objects");
    check(
      w.states.get(ordinaryRoot).selected === selected,
      "gizmo movement reshuffled ordinary rooms",
    );
    one.root.position.x -= 1;
    one.root.rotation.y = 0;
    a.bus.emit("objects");
    const unbatched = capture(false),
      batched = capture(true);
    check(batched.calls < unbatched.calls, "opaque building instancing lost");
    check(
      batched.triangles === unbatched.triangles,
      "instancing changed triangle count",
    );
    check(
      difference(unbatched.pixels, batched.pixels).mean < 0.6,
      "window instancing fallback changed image",
    );
    w.setObject(one, { mode: "off" });
    check(
      w.factor(w.states.get(one.root).settings) === 0,
      "local off not honored",
    );
    check(
      w.factor(w.states.get(two.root).settings) > 0,
      "local override modified peer",
    );
    w.setObject(one, { mode: "inherit" });
    w.configure({ mode: "auto" });
    a.lighting.physical.configure({ sunElev: 48 });
    w.tick();
    check(
      [...w.states.values()].every((st) => w.factor(st.settings) === 0),
      "day not off",
    );
    a.lighting.physical.configure({ sunElev: -12 });
    w.tick();
    check(
      [...w.states.values()].every((st) => w.factor(st.settings) === 1),
      "night not on",
    );

    a.appearance.setMode(two, "off");
    capture(true);
    const gray = w.states.get(two.root);
    check(
      gray.gpu.every((p) => {
        const meshMat = p.mesh.material;
        const hook = a.lighting.physical.color.sources.get(meshMat);
        const shader = {
          vertexShader: "#include <begin_vertex>",
          fragmentShader:
            "#include <map_fragment>\n#include <emissivemap_fragment>\n#include <tonemapping_fragment>",
          uniforms: {},
        };
        meshMat.onBeforeCompile(shader, s.renderer);
        return (
          shader.fragmentShader.includes("totalEmissiveRadiance+=") ||
          shader.fragmentShader.includes("totalEmissiveRadiance +=")
        );
      }),
      "gray mode stripped window mask shader",
    );

    a.stage.setPerfMode(true);
    w.tick();
    capture(true);
    a.stage.setPerfMode(false);
    w.tick();
    capture(true);
    check(
      w.factor(w.states.get(one.root).settings) === 1,
      "Basic mode did not restore",
    );
    for (const [source, hex, intensity] of sources)
      check(
        source.emissive.getHex() === hex &&
          source.emissiveIntensity === intensity,
        "canonical source mutated",
      );

    a.lighting.physical.configure({ whiteBalance: 3200 });
    w.configure({ seed: 44 });
    capture(true);
    const displayState = w.states.get(two.root);
    for (const part of displayState.gpu) {
      const display = part.mesh.material,
        shader = {
          vertexShader: "#include <begin_vertex>",
          fragmentShader:
            "#include <map_fragment>\n#include <emissivemap_fragment>\n#include <tonemapping_fragment>",
          uniforms: {},
        };
      display.onBeforeCompile(shader, s.renderer);
      check(
        shader.uniforms.previzCameraWhite?.value ===
          a.lighting.physical.color.gain &&
          (
            shader.fragmentShader.match(/uniform vec3 previzCameraWhite;/g) ||
            []
          ).length === 1,
        "new gray window display lost or duplicated white balance",
      );
    }
    w.configure({ mode: "legacy" });
    capture(true);
    two.root.traverse((mesh) => {
      if (mesh.material)
        for (const mat of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          check(
            a.lighting.physical.color.sources.get(mat)?.wrapper ===
              mat.onBeforeCompile,
            "legacy gray display not white balanced",
          );
    });
    w.configure({ mode: "auto" });
    a.lighting.physical.configure({ whiteBalance: 6500 });
    capture(true);
    const beforeGeometry = s.renderer.info.memory.geometries,
      programs = s.renderer.info.programs.length,
      materials = [...w.states.values()].reduce(
        (n, st) => n + st.materials.size,
        0,
      );
    for (let i = 0; i < 8; i++) {
      w.configure({ seed: 100 + i, ratio: i % 2 ? 0.3 : 0.7 });
      capture(true);
    }
    check(
      s.renderer.info.memory.geometries === beforeGeometry,
      "window changes allocate geometry",
    );
    check(
      s.renderer.info.programs.length <= programs + 1,
      "seed/ratio recompiled unbounded shaders",
    );
    check(
      [...w.states.values()].reduce((n, st) => n + st.materials.size, 0) <=
        materials + 4,
      "unbounded material variants",
    );

    a._suspendUndo = false;
    a.beginOp("窗灯撤销专项");
    w.configure({ ratio: 0.2 });
    check(a.undo() && w.settings.ratio === 0.3, "global undo");
    check(a.redo() && w.settings.ratio === 0.2, "global redo");
    a._suspendUndo = true;

    const current = a.objects.find((o) => o.id === ids[0]);
    w.setObject(current, { mode: "on", temperature: 2200, seed: 77 });
    const project = await a.saveProject();
    await a.importFiles([new File([project], "windows.previz")]);
    check(
      w.settings.ratio === 0.2 &&
        a.byId(current.id).params.windowLighting.temperature === 2200,
      "archive lost window controls",
    );
    check(a.objects.map((o) => o.id).join() === ids.join(), "IDs/order lost");

    const rebuilt = a.byId(current.id);
    a.rebuildObject(rebuilt);
    check(
      w.states.get(rebuilt.root).settings.temperature === 2200,
      "parameter rebuild lost override",
    );
    a.select({ kind: "obj", so: rebuilt });
    s.helperLayer.visible = true;
    s.render();
    check(s.tc.object === rebuilt.root, "gizmo lost after window setup");

    const old = a.serialize({ assets: false });
    delete old.light.windows;
    for (const object of old.objects) delete object.params.windowLighting;
    a.loadJson(old);
    check(
      w.settings.mode === "legacy" && w.states.size === 0,
      "old project migration not preserving legacy",
    );
    const live = a.byId(current.id);
    w.configure({ mode: "on", ratio: 0.5 });
    a.select({ kind: "obj", so: live });
    return {
      entry: location.protocol,
      brightness,
      dark: { calls: dark.calls, triangles: dark.triangles },
      bright: { calls: bright.calls, triangles: bright.triangles },
      batched: { calls: batched.calls, triangles: batched.triangles },
      unbatched: { calls: unbatched.calls, triangles: unbatched.triangles },
      lights: lightCount,
      ordinaryUnits: w.states.get(live.root).units,
      proceduralSurfaces: [...w.states.values()].reduce(
        (n, st) => n + st.gpu.length,
        0,
      ),
      legacyPreserved: true,
      archive: true,
    };
  });
  // Real inspector controls, not just the service API.
  const scope = '#inspector-scene [data-window-lighting="object"]';
  await page.select(scope + ' [data-window-setting="mode"]', "on");
  await page.$eval(
    scope + ' input.num[data-window-setting="temperature"]',
    (e) => {
      e.value = "2400";
      e.dispatchEvent(new Event("change", { bubbles: true }));
    },
  );
  assert.equal(
    await page.evaluate(() => app.selObj.params.windowLighting.temperature),
    2400,
  );
  await page.evaluate(() => {
    app.selObj.locked = true;
    app.bus.emit("objects");
  });
  assert.equal(await page.$eval(scope + " select", (e) => e.disabled), true);
  await page.evaluate(() => {
    app.selObj.locked = false;
    app.bus.emit("objects");
  });
  await page.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => /光影/.test(b.textContent)).click(),
  );
  const global = '#inspector-scene [data-window-lighting="global"]';
  await page.select(global + ' [data-window-setting="mode"]', "auto");
  await page.click(global + ' [data-window-day-night="夜景"]');
  assert.equal(
    await page.evaluate(() => app.lighting.physical.settings.sunElev),
    -12,
  );
  await page.evaluate(() => {
    app._suspendUndo = false;
  });
  await page.click(global + ' [data-window-day-night="日景"]');
  assert.equal(
    await page.evaluate(() => app.lighting.physical.settings.sunElev),
    48,
  );
  const dayUndo = await page.evaluate(() => {
    if (!app.undo()) return null;
    const night = {
      sun: app.lighting.physical.settings.sunElev,
      mode: app.windowLights.settings.mode,
    };
    if (!app.redo()) return null;
    return { night, day: app.lighting.physical.settings.sunElev };
  });
  assert.deepEqual(dayUndo, { night: { sun: -12, mode: "auto" }, day: 48 });
  const cleaned = await page.evaluate(() => {
    let disposed = 0,
      total = 0;
    for (const state of app.windowLights.states.values())
      for (const mat of state.materials) {
        total++;
        mat.addEventListener("dispose", () => disposed++);
      }
    app.clearAll();
    app.bus.emit("objects");
    return { retained: app.windowLights.states.size, disposed, total };
  });
  assert.equal(cleaned.retained, 0, "removed roots retained");
  assert.equal(
    cleaned.disposed,
    cleaned.total,
    "owned window materials not disposed",
  );
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/window-lights-regression.json",
    JSON.stringify(r, null, 2),
  );
  console.log(
    "PASS window emission / ordinary and instanced rooms + city grid / deterministic seed / no geometry or real lights / opaque instancing / gray shader chain / Basic restore / bounded variants / per-object controls / undo-redo / archive / old project / native UI + day-night + locked / cleanup",
    r,
  );
} finally {
  await browser.close();
}
