import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { generateHeightfield } from "../src/terrain-generation.js";
import {
  automaticSurface,
  cleanSurface,
  slopeDegrees,
} from "../src/terrain-surface.js";
const kinds = [
  "plain",
  "hills",
  "ridge",
  "island",
  "craters",
  "canyon",
  "plateau",
];
for (const kind of kinds) {
  const p = { kind, amp: 16, seed: 123 },
    a = generateHeightfield(65, 160, p).h,
    b = generateHeightfield(65, 160, p).h,
    c = generateHeightfield(65, 160, { ...p, seed: 124 }).h;
  assert.deepEqual(a, b);
  assert.ok(a.every(Number.isFinite));
  assert.ok(
    a.some((v, i) => v !== c[i]),
    kind,
  );
  assert.ok(Math.max(...a) - Math.min(...a) > 0.01);
}
const n = 65,
  size = 160,
  plane = (n, height, angle = 0) =>
    Float32Array.from(
      { length: n * n },
      (_, k) =>
        height +
        ((k % n) / (n - 1) - 0.5) * size * Math.tan((angle * Math.PI) / 180),
    );
for (const m of [33, 65, 129, 257, 513])
  assert.ok(
    Math.abs(
      slopeDegrees(plane(m, 4, 30), m, size, 1, (m - 1) / 2, (m - 1) / 2) - 30,
    ) < 0.0001,
  );
assert.ok(slopeDegrees(plane(n, 4, 30), n, size, 2, 32, 32) > 49);
const cfg = cleanSurface(),
  auto = (h, b = "grass", water = { enabled: false, level: 0 }) =>
    automaticSurface(h, n, size, 1, b, cfg, water),
  center = (n * 32 + 32) * 6;
assert.ok(auto(plane(n, 4))[center] > 0.7);
assert.equal(auto(plane(n, 4))[center + 5], 0);
assert.ok(auto(plane(n, 40))[center + 5] > 0.9);
assert.ok(auto(plane(n, 40, 60))[center + 3] > 0.85);
assert.equal(auto(plane(n, 40, 60))[center + 5], 0);
assert.equal(auto(plane(n, 40), "desert")[center + 5], 0);
assert.ok(auto(plane(n, 4), "desert")[center + 4] > 0.7);
const shore = Float32Array.from({ length: n * n }, (_, k) =>
    k % n < 32 ? -1 : 0.2,
  ),
  coast = auto(shore, "grass", { enabled: true, level: 0 });
assert.ok(coast[(n * 32 + 32) * 6 + 4] > 0.3);
assert.equal(coast[(n * 32 + 55) * 6 + 4], 0);
assert.equal(auto(shore)[center + 4], 0);
const a = generateHeightfield(33, 160, { kind: "hills", seed: 345 }).h,
  b = generateHeightfield(65, 160, { kind: "hills", seed: 345 }).h;
for (let j = 0; j < 33; j++)
  for (let i = 0; i < 33; i++)
    assert.equal(a[j * 33 + i], b[j * 2 * 65 + i * 2]);
console.log(
  "PASS all 7 seeded heightfields / real slope degrees stable at 33–513 / height snowline / cliffs / climate / actual shore proximity / shared generated samples",
);
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [];
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (process.env.TEST_FILE_URL?.startsWith('file:')) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.app?.terrain?.generation, {
    timeout: 60000,
  });
  await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.lighting.setMode("physical");
    app.lighting.physical.configure({
      shadows: false,
      whiteBalance: 6500,
      ev: 0,
    });
    app.terrain.setWater(false);
    app.terrain.setResolution(65);
    app.stage.renderer.setPixelRatio(0.5);
  });
  await p.click('[data-page="scene"]');
  await p.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => b.textContent === "地形").click(),
  );
  const form = "#inspector-scene [data-terrain-generation]",
    button = form + " .row-btn button:first-child";
  await p.select(form + ' [data-field="gen"] select', "");
  const count = await p.evaluate(() => app._undo?.length || 0);
  await p.click(button);
  assert.equal(await p.evaluate(() => app._undo?.length || 0), count);
  await p.select(form + ' [data-field="gen"] select', "ridge");
  for (const [k, v] of [
    ["amp", "24"],
    ["seed", "12345"],
  ]) {
    const selector = form + ` [data-field="${k}"] input[type="number"]`;
    await p.click(selector, { clickCount: 3 });
    await p.keyboard.type(v);
    await p.keyboard.press("Tab");
  }
  assert.equal(
    await p.$eval(form + ' [data-field="gen"] select', (e) => e.value),
    "ridge",
  );
  const old = await p.evaluate(() => ({
    height: app.terrain.pack(),
    undo: app._undo?.length || 0,
  }));
  await p.click(button);
  const generated = await p.evaluate(() => ({
    height: app.terrain.pack(),
    undo: app._undo?.length || 0,
    g: { ...app.terrain.generation },
    enabled: app.terrain.autoSurface.enabled,
    paint: app.terrain.weights.some((v) => v !== 0),
  }));
  assert.notEqual(generated.height, old.height);
  assert.equal(generated.undo, old.undo + 1);
  assert.equal(generated.g.seed, 12345);
  assert.equal(generated.g.amp, 24);
  assert.equal(generated.g.kind, "ridge");
  assert.equal(generated.enabled, true);
  assert.equal(generated.paint, false);
  await p.evaluate(() => app.undo());
  assert.equal(await p.evaluate(() => app.terrain.pack()), old.height);
  await p.evaluate(() => app.redo());
  assert.equal(await p.evaluate(() => app.terrain.pack()), generated.height);
  await p.click(button);
  assert.equal(await p.evaluate(() => app.terrain.pack()), generated.height);
  for (const kind of kinds) {
    await p.select(form + ' [data-field="gen"] select', kind);
    await p.click(button);
    assert.equal(await p.evaluate(() => app.terrain.generation.kind), kind);
    assert.equal(
      await p.evaluate(() => app.terrain.h.every(Number.isFinite)),
      true,
    );
  }
  console.log(
    "PASS real generation button / empty selection no undo / seed and amplitude survive UI / single-step undo-redo / all 7 actual buttons",
  );
  await p.click('#inspector-scene [data-terrain-tab="materials"]');
  const snowField =
    '#inspector-scene [data-terrain-auto-surface] [data-field="snowLine"] input[type="number"]';
  await p.click(snowField, { clickCount: 3 });
  await p.keyboard.type("18");
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => app.terrain.autoSurface.snowLine), 18);
  await p.evaluate(() => app.undo());
  assert.equal(await p.evaluate(() => app.terrain.autoSurface.snowLine), 26);
  await p.evaluate(() => app.redo());
  assert.equal(await p.evaluate(() => app.terrain.autoSurface.snowLine), 18);
  await p.click('#inspector-scene [data-terrain-tab="base"]');
  await p.$eval('#inspector-scene [data-field="waterY"]', e => { const sec = e.closest(".sec"); if (sec.classList.contains("closed")) sec.querySelector(".sec-h").click(); });
  const oldWater = await p.evaluate(() => app.terrain.state.waterY),
    waterField = '#inspector-scene [data-field="waterY"] input[type="number"]';
  await p.click(waterField, { clickCount: 3 });
  await p.keyboard.type("3");
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => app.terrain.state.waterY), 3);
  await p.evaluate(() => app.undo());
  assert.equal(await p.evaluate(() => app.terrain.state.waterY), oldWater);
  console.log(
    "PASS actual automatic-surface and water-level controls / one-step undo-redo",
  );
  const pixels = await p.evaluate(() => {
    const tr = app.terrain,
      st = app.stage;
    app.state.terrainTool = null;
    app.select(null);
    tr.h.fill(4);
    tr.setWater(false);
    tr.setBiome("grass");
    tr.setAutoSurface({ enabled: true, snowLine: 26 });
    tr.refresh();
    st.setGroundVisible(false);
    st.setGridVisible(false);
    st.helperLayer.visible = false;
    st.view.position.set(0.001, 124, 0.001);
    st.orbit.target.set(0, 4, 0);
    st.orbit.update();
    const ctx = document.createElement("canvas").getContext("2d"),
      sample = () => {
        st.render();
        ctx.canvas.width = st.canvas.width;
        ctx.canvas.height = st.canvas.height;
        ctx.drawImage(st.canvas, 0, 0);
        return [
          ...ctx.getImageData(
            Math.floor(ctx.canvas.width / 2),
            Math.floor(ctx.canvas.height / 2),
            1,
            1,
          ).data,
        ].slice(0, 3);
      };
    const grass = sample();
    tr.setAutoSurface({ snowLine: 0 });
    const snow = sample();
    app.state.terrainTool = "material";
    tr.state.material = "soil";
    tr.setBrush({ size: 20, strength: 3 });
    tr.paintAt(0, 0);
    app.state.terrainTool = null;
    const manual = tr.weights.slice(),
      before = sample();
    tr.setAutoSurface({ snowLine: 200 });
    const after = sample(),
      preserved = tr.weights.every((v, i) => v === manual[i]);
    tr.generate("ridge", 30, 55);
    const generationPreserves = tr.weights.every((v, i) => v === manual[i]);
    st.helperLayer.visible = true;
    return {
      grass,
      snow,
      before,
      after,
      preserved,
      generationPreserves,
      autoChanges: tr.autoWeights.some((v) => v > 0),
    };
  });
  console.log("PIXELS", pixels);
  assert.ok(
    pixels.snow.reduce((a, b) => a + b, 0) >
      pixels.grass.reduce((a, b) => a + b, 0) + 30,
  );
  assert.deepEqual(pixels.before, pixels.after);
  assert.equal(pixels.preserved, true);
  assert.equal(pixels.generationPreserves, true);
  const saved = await p.evaluate(async () => {
    const tr = app.terrain;
    tr.setAutoSurface({ rockSlope: 28, shoreWidth: 7, snowLine: 18 });
    tr.setResolution(129);
    const center = (((tr.n - 1) / 2) * tr.n + (tr.n - 1) / 2) * 6,
      manual = tr.weights[center + 1];
    const blob = await app.saveProject();
    await app.importFiles([new File([blob], "generated-terrain.previz")]);
    const restored = {
      g: { ...tr.generation },
      s: { ...tr.autoSurface },
      paint: tr.weights[center + 1],
      finite: tr.autoWeights.every(Number.isFinite),
    };
    const legacy = tr.toJSON();
    delete legacy.autoSurface;
    delete legacy.generation;
    tr.fromJSON(legacy);
    const old =
      tr.autoSurface.enabled === false &&
      tr.autoWeights.every((v) => v === 0) &&
      tr.weights[center + 1] > 0;
    tr.setAutoSurface({ enabled: true });
    app.state.terrainTool = "material";
    tr.state.material = "soil";
    tr.setBrush({ size: 20, strength: 3 });
    for (let i = 0; i < 20; i++) tr.paintAt(0, 0, -1);
    const erased =
      tr.weights[center + 1] < 0.00001 &&
      tr.autoWeights.slice(center, center + 6).some((v) => v > 0);
    app.state.terrainTool = null;
    app.roadBrush.restore([
      {
        id: "gen-road",
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
        points: [
          [-40, 0, 0],
          [40, 0, 0],
        ],
      },
    ]);
    const originalId = app.byId("gen-road").id;
    tr.generate("hills", 12, 339);
    const road =
      app.byId("gen-road")?.id === originalId &&
      app.byId("gen-road")._roadData.terrainMode === "follow";
    return {
      manual,
      restored,
      old,
      erased,
      road,
      height: app.roadTerrain.height(
        app.byId("gen-road")._roadData.curve,
        0,
        0,
      ),
      ground: tr.heightAt(0, 0),
    };
  });
  assert.ok(saved.manual > 0.99);
  assert.equal(saved.restored.g.seed, 55);
  assert.equal(saved.restored.s.rockSlope, 28);
  assert.equal(saved.restored.s.shoreWidth, 7);
  assert.equal(saved.restored.paint, saved.manual);
  assert.equal(saved.restored.finite, true);
  assert.equal(saved.old, true);
  assert.equal(saved.erased, true);
  assert.equal(saved.road, true);
  assert.ok(Number.isFinite(saved.height));
  assert.ok(saved.height >= saved.ground);
  console.log(
    "PASS automatic PBR pixel changes / opaque hand paint survives recolor and generation / refinement / erasing reveals base / archive reload / legacy opt-in / follow-road rebuild",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS terrain generation and automatic surface, no browser or shader errors",
  );
} finally {
  await browser.close();
}
