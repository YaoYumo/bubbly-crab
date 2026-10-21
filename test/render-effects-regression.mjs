import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    protocolTimeout: 480000,
  }),
  errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL?.startsWith("file:"))
    await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.renderEffects,
  );
  const result = await page.evaluate(async () => {
    const a = app,
      s = a.stage,
      fx = a.renderEffects,
      lod = fx.lod,
      perf = a.performance,
      check = (v, m) => {
        if (!v) throw Error(m);
      };
    check(
      !lod.settings.enabled && !fx.bloom.enabled && !fx.pass,
      "legacy defaults changed",
    );
    const fixture = await a.runPerformanceBenchmarks({
      ids: ["dense"],
      warmup: 1,
      samples: 1,
    });
    check(!fixture.error, fixture.error);
    const keys = fixture.fixtures[0].assets;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.select(null);
    a.lighting.physical.configure({
      sunElev: 48,
      shadows: false,
      fog: 0,
      whiteBalance: 6500,
    });
    a.localLights.configure({ enabled: false });
    for (let i = 0; i < 12; i++)
      a.addAsset(
        keys.building,
        [(i % 4) * 20 - 30, 0, Math.floor(i / 4) * 20 - 20],
        { merge: true },
      );
    a.select(null);
    a.bus.emit("objects");
    s.orbit.enableDamping = false;
    s.helperLayer.visible = false;
    s.setGridVisible(false);
    s.renderer.setPixelRatio(1);
    s.renderer.setSize(400, 260, false);
    s.w = 400;
    s.h = 260;
    s.view.aspect = 400 / 260;
    s.view.updateProjectionMatrix();
    s.view.position.set(0, 90, 310);
    s.orbit.target.set(0, 2, 0);
    s.orbit.update();
    const sources = [];
    for (const so of a.objects)
      so.root.traverse((n) => {
        if (n.isMesh) sources.push([n, n.geometry, n.visible]);
      });
    const logical = JSON.stringify(a.objects.map((o) => o.serialize())),
      ids = a.objects.map((o) => o.id);
    const capture = () => {
      perf.beginFrame();
      try {
        s.render();
      } finally {
        perf.endFrame(0, 0);
      }
      const gl = s.renderer.getContext(),
        rgba = new Uint8Array(s.canvas.width * s.canvas.height * 4);
      gl.readPixels(
        0,
        0,
        s.canvas.width,
        s.canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba,
      );
      check(
        sources.every(([m, g, v]) => m.geometry === g && m.visible === v),
        "render transaction leaked source geometry/visibility",
      );
      check(
        !lod.rendering &&
          !a.modelInstancing.rendering &&
          !a.modelInstancing.group.visible &&
          !a.modelInstancing.geometrySwaps.length,
        "transaction flags leaked",
      );
      return {
        rgba,
        calls: perf.frames.at(-1).calls,
        triangles: perf.frames.at(-1).triangles,
        stats: fx.snapshot(),
      };
    };
    const difference = (x, y) => {
      let sum = 0,
        changed = 0,
        max = 0;
      for (let i = 0; i < x.length; i++) {
        if (i % 4 === 3) continue;
        const d = Math.abs(x[i] - y[i]);
        sum += d;
        changed += d > 3;
        max = Math.max(max, d);
      }
      return {
        mean: sum / (x.length * 0.75),
        fraction: changed / (x.length * 0.75),
        max,
      };
    };
    const original = capture();
    fx.configure({ lod: { enabled: true } });
    let cold;
    for (let i = 0; i < 35; i++) {
      const r = capture();
      if (!i) cold = { ...r.stats.lod };
    }
    await lod.work.drain();
    const distant = capture(),
      pixels = difference(original.rgba, distant.rgba);
    check(distant.stats.lod.far > 0, "not in far LOD");
    check(
      distant.stats.lod.culledMeshes + distant.stats.lod.simplifiedMeshes > 0,
      "LOD did no work",
    );
    check(
      distant.triangles < original.triangles,
      "LOD did not reduce submitted triangles",
    );
    check(
      pixels.mean < 8 && pixels.fraction < 0.2,
      "far silhouette changed excessively",
    );
    check(
      logical === JSON.stringify(a.objects.map((o) => o.serialize())),
      "LOD changed logical objects",
    );
    const sample = async (enabled) => {
      fx.configure({ lod: { enabled } });
      for (let i = 0; i < 8; i++) capture();
      await lod.work.drain();
      if (enabled) check(capture().stats.lod.simplifiedMeshes > 0, "LOD sample not warm");
      const times = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        s.render();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return {
        samples: 30,
        mean: times.reduce((a, b) => a + b, 0) / 30,
        p50: times[14],
        p95: times[28],
      };
    };
    const cpu = { original: await sample(false), lod: await sample(true) };
    const select = a.objects[0];
    a.select({ kind: "obj", so: select });
    s.render();
    check(
      s.tc.object === select.root &&
        sources.every(([m, g]) => m.geometry === g),
      "selected source not full quality",
    );
    a.select(null);
    s.view.position.set(0, 20, 50);
    s.orbit.update();
    const near = capture();
    check(
      near.stats.lod.far === 0 && near.stats.lod.simplifiedMeshes === 0,
      "near scene simplified",
    );
    // Artificial renderer failure exercises both restoration layers, not just success.
    s.view.position.set(0, 90, 310);
    s.orbit.update();
    const enter = a.modelInstancing.enter;
    a.modelInstancing.enter = function (camera) {
      enter.call(this, camera);
      throw Error("intentional LOD render failure");
    };
    let caught = false;
    try {
      s.render();
    } catch (e) {
      caught = /intentional/.test(e.message);
    } finally {
      a.modelInstancing.enter = enter;
    }
    check(
      caught &&
        sources.every(([m, g, v]) => m.geometry === g && m.visible === v) &&
        !lod.rendering &&
        !a.modelInstancing.rendering &&
        !a.modelInstancing.geometrySwaps.length,
      "failure did not restore LOD/instances",
    );
    const orthoView = s.view;
    s.setOrthoTop();
    if (s.view.isOrthographicCamera) {
      s.render();
      check(
        sources.every(([m, g]) => m.geometry === g),
        "orthographic restoration",
      );
    }
    s.view = orthoView;
    s.orbit.object = orthoView;
    fx.configure({ lod: { enabled: false } });
    check(
      lod.cache.size === 0 && lod.bytes === 0,
      "LOD disable retained cache",
    );
    // Stable near night view, with real source window shaders and non-neutral WB.
    s.view.position.set(37, 24, 65);
    s.orbit.target.set(0, 2, 0);
    s.orbit.update();
    a.lighting.physical.configure({
      sunElev: -12,
      energy: 0.6,
      environment: 0.2,
      whiteBalance: 3200,
      shadows: false,
      fog: 0,
    });
    a.windowLights.configure({
      mode: "on",
      ratio: 1,
      intensity: 4,
      temperature: 3000,
    });
    const plain = capture();
    fx.configure({
      bloom: {
        enabled: true,
        strength: 0.6,
        threshold: 0.8,
        radius: 0.3,
        quality: "medium",
      },
    });
    for (let i = 0; i < 3; i++) capture();
    const glow = capture(),
      bloomPixels = difference(plain.rgba, glow.rgba);
    check(
      bloomPixels.mean > 0.02 && bloomPixels.fraction > 0.0001,
      "Bloom not visible",
    );
    check(glow.calls > plain.calls && fx.pass, "Bloom channels absent");
    check(s.bokehPass.enabled === false, "Bloom accidentally enabled DOF");
    fx.configure({ bloom: { quality: "low" } });
    capture();
    const lowSize = fx.snapshot().bloom;
    fx.configure({ bloom: { quality: "high" } });
    capture();
    const highSize = fx.snapshot().bloom;
    check(highSize.glowWidth > lowSize.glowWidth, "quality target not resized");
    s.renderer.setPixelRatio(2);
    capture();
    check(s.composer.renderTarget1.width === 800, "composer DPR stale");
    s.renderer.setPixelRatio(1);
    capture();
    const hasExtension = s.renderer.extensions.has;
    s.renderer.extensions.has = function (name) {
      return name === "EXT_color_buffer_float"
        ? false
        : hasExtension.call(this, name);
    };
    capture();
    check(
      !fx.pass && fx.bloom.enabled && fx.snapshot().bloom.blockedReason,
      "missing HDR support not bypassed",
    );
    s.renderer.extensions.has = hasExtension;
    capture();
    check(fx.pass, "Bloom did not recover after capability bypass");
    fx.configure({ bloom: { strength: 0 } });
    const zero = capture();
    check(
      !fx.pass && difference(plain.rgba, zero.rgba).max === 0,
      "zero strength did not restore original rendering",
    );
    fx.configure({ bloom: { strength: 0.6, quality: "medium" } });
    s.setDofEnabled(true, { focus: 65, aperture: 0.001, maxblur: 0.002 });
    capture();
    check(s.bokehPass.enabled && fx.pass, "DOF + Bloom not composable");
    s.setDofEnabled(false);
    s.anamorphicEnabled = true;
    s.anamorphicPass.enabled = true;
    capture();
    s.anamorphicEnabled = false;
    s.anamorphicPass.enabled = false;
    s.setPerfMode(true);
    capture();
    check(!fx.pass && fx.bloom.enabled, "Basic mode did not pause Bloom");
    s.setPerfMode(false);
    capture();
    check(fx.pass, "Bloom not restored after Basic");
    const rect = { W: 400, H: 260, k: 1, m: 0.5 };
    s.preview = true;
    s.renderFramed(rect);
    const gl = s.renderer.getContext(),
      framed = new Uint8Array(400 * 260 * 4);
    gl.readPixels(0, 0, 400, 260, gl.RGBA, gl.UNSIGNED_BYTE, framed);
    let bars = 0,
      center = 0;
    for (let y = 0; y < 260; y++)
      for (let x = 0; x < 400; x++) {
        const i = (y * 400 + x) * 4,
          light = framed[i] + framed[i + 1] + framed[i + 2];
        if (y < 60 || y > 200) bars = Math.max(bars, light);
        else center += light;
      }
    check(bars === 0 && center > 0, "letterboxed post output not correct");
    const target = s.composer.renderTarget1;
    let targetDisposals = 0;
    const countDispose = () => targetDisposals++;
    target.addEventListener("dispose", countDispose);
    s.renderFramed(rect);
    s.renderFramed(rect);
    target.removeEventListener("dispose", countDispose);
    check(
      targetDisposals === 0,
      "video letterbox reallocates full-size targets every frame",
    );

    check(
      s.composer.renderToScreen && !s.postSize,
      "framed composer state leaked",
    );
    s.preview = false;
    const url = await a.exporter.still({
      width: 400,
      height: 260,
      asDataUrl: true,
    });
    check(url.startsWith("data:image/png"), "PNG export failed");
    const image = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const pngCanvas = document.createElement("canvas");
    pngCanvas.width = image.width;
    pngCanvas.height = image.height;
    const pngCtx = pngCanvas.getContext("2d");
    pngCtx.drawImage(image, 0, 0);
    check(
      image.width === 400 &&
        image.height === 260 &&
        pngCtx
          .getImageData(0, 0, 400, 260)
          .data.some((v, i) => i % 4 !== 3 && v > 0),
      "PNG empty or wrong size",
    );
    const sampleBloom = (enabled) => {
      fx.configure({ bloom: { enabled } });
      for (let i = 0; i < 8; i++) capture();
      const values = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        s.render();
        values.push(performance.now() - start);
      }
      values.sort((a, b) => a - b);
      return {
        samples: 30,
        mean: values.reduce((a, b) => a + b, 0) / 30,
        p50: values[14],
        p95: values[28],
      };
    };
    const bloomCpu = {
      disabled: sampleBloom(false),
      enabled: sampleBloom(true),
    };
    fx.configure({ lod: { enabled: true } });
    s.view.position.set(0, 90, 310);
    s.orbit.target.set(0, 2, 0);
    s.orbit.update();
    for (let i = 0; i < 35; i++) capture();
    await lod.work.drain();
    const combined = capture();
    check(
      combined.stats.lod.far > 0 &&
        combined.stats.lod.simplifiedMeshes > 0 &&
        fx.pass,
      "combined LOD/Bloom path inactive",
    );
    const video = await a.exporter.run({
      width: 400,
      height: 260,
      duration: 0.2,
      fps: 5,
      bitrate: 1,
    });
    a.suspended = true;
    check(video?.size > 0 && video.frames === 1, "effects video export failed");
    // Native setting controls + one-step undo/redo, real .previz archive, legacy migration.
    a._suspendUndo = false;
    a.beginOp("Bloom undo");
    fx.configure({ bloom: { strength: 0.9 }, lod: { enabled: true } });
    check(a.undo() && fx.bloom.strength === 0.6, "effects undo");
    check(
      a.redo() && fx.bloom.strength === 0.9 && lod.settings.enabled,
      "effects redo",
    );
    a._suspendUndo = true;
    const expected = JSON.stringify(fx.toJSON()),
      archive = await a.saveProject();
    await a.importFiles([new File([archive], "effects.previz")]);
    check(JSON.stringify(fx.toJSON()) === expected, "archive lost effects");
    check(
      a.objects.map((o) => o.id).join() === ids.join(),
      "archive changed object IDs/order",
    );
    const restored = a.byId(ids[0]);
    a.rebuildObject(restored);
    await lod.work.drain();
    const liveGeometries = new Set();
    for (const so of a.objects) so.root.traverse((n) => { if (n.geometry) liveGeometries.add(n.geometry); });
    check([...lod.cache.values()].every((entry) => liveGeometries.has(entry.source) && lod.matches(entry.revision, lod.revision(entry.source))), "rebuild retained removed/stale LOD resources");
    a.select({ kind: "obj", so: restored });
    s.render();
    s.view.position.set(37, 24, 65);
    s.orbit.target.set(0, 2, 0);
    s.orbit.update();
    s.render();
    const point = restored.root.position.clone();
    point.y += 3.7;
    s.pointer.copy(point.project(s.view));
    check(
      s.pick().so === restored && s.tc.object === restored.root,
      "original picking/gizmo with effects",
    );
    const old = a.serialize({ assets: false });
    delete old.rendering;
    a.loadJson(old);
    check(
      !fx.bloom.enabled && !lod.settings.enabled && !fx.pass,
      "old project not migrated to disabled effects",
    );
    document.querySelector('[data-page="scene"]').click();
    const tabs = [...document.querySelectorAll("#inspector-scene .itab")];
    tabs.find((b) => /光影/.test(b.textContent))?.click();
    check(
      document.querySelector('[data-render-setting="bloom.enabled"]'),
      "native Bloom setting missing",
    );
    const toggle = document.querySelector(
      '[data-render-setting="bloom.enabled"]',
    );
    toggle.click();
    check(fx.bloom.enabled, "native Bloom toggle failed");
    fx.dispose();
    s.render();
    check(!fx.pass && lod.cache.size === 0, "dispose failed");
    return {
      entry: location.protocol,
      offline: !navigator.onLine,
      ids: ids.length,
      lod: {
        original: { calls: original.calls, triangles: original.triangles },
        distant: {
          calls: distant.calls,
          triangles: distant.triangles,
          stats: distant.stats.lod,
        },
        pixels,
        cold,
        cpu,
      },
      bloom: {
        original: { calls: plain.calls, triangles: plain.triangles },
        enabled: { calls: glow.calls, triangles: glow.triangles },
        pixels: bloomPixels,
        cpu: bloomCpu,
        combined: {
          calls: combined.calls,
          triangles: combined.triangles,
          lod: combined.stats.lod,
        },
        videoBytes: video.size,
        pngBytes: url.length,
        lowSize,
        highSize,
        blackBarsMax: bars,
      },
      checks: [
        "source references/visibility stable",
        "actual far triangle reduction",
        "30 render submission samples/path",
        "selected + near full quality",
        "failure restoration + instances",
        "Bloom pixels + no DOF",
        "quality + DPR + unsupported HDR fallback",
        "repeated framed output keeps target allocation stable",
        "zero strength exact bypass",
        "DOF + anamorphic composition",
        "Basic pause/restore",
        "letterboxed output + PNG + one-frame video",
        "combined active far LOD/Bloom + 30 Bloom submission samples/path",
        "undo/redo + archive IDs",
        "rebuild release + original pick/gizmo",
        "legacy defaults + native UI",
        "dispose",
      ],
    };
  });
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    `.shots/render-effects-${result.entry === "file:" ? "file" : "dev"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log("PASS LOD + Bloom", JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
