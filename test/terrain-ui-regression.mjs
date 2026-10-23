import assert from "node:assert/strict";
import puppeteer from "puppeteer";
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
  await p.waitForFunction(() => window.app?.roadTerrain, { timeout: 60000 });
  await p.click('[data-page="scene"]');
  await p.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => b.textContent === "地形").click(),
  );
  await p.evaluate(() => {
    app.clearAll();
    app.stage.renderer.setPixelRatio(0.5);
    app.lighting.override.shadow = false;
    app.lighting.update();
    app.terrain.setWater(false);
    app.stage.view.position.set(0.001, 120, 0.001);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.orbit.update();
    app.stage.view.updateMatrixWorld(true);
    app.bus.emit("select");
  });
  await p.select('#inspector-scene [data-field="res"] select', "257");
  assert.equal(await p.evaluate(() => app.terrain.n), 257);
  await p.evaluate(() => app.undo());
  assert.equal(await p.evaluate(() => app.terrain.n), 97);
  await p.evaluate(() => app.redo());
  assert.equal(await p.evaluate(() => app.terrain.n), 257);
  await p.select('#inspector-scene [data-field="res"] select', "513");
  assert.equal(
    await p.evaluate(() => app.terrain.mesh.geometry.attributes.position.count),
    513 * 513,
  );
  await p.select('#inspector-scene [data-field="res"] select', "129");
  const project = async (x, z) =>
    p.evaluate(
      ({ x, z }) => {
        const cam = app.stage.view;
        cam.updateMatrixWorld(true);
        let v = [x, app.terrain.heightAt(x, z), z, 1];
        for (const matrix of [cam.matrixWorldInverse, cam.projectionMatrix]) {
          const m = matrix.elements;
          v = [0, 1, 2, 3].map(
            (i) =>
              m[i] * v[0] +
              m[i + 4] * v[1] +
              m[i + 8] * v[2] +
              m[i + 12] * v[3],
          );
        }
        const r = app.stage.canvas.getBoundingClientRect();
        return {
          x: r.left + ((v[0] / v[3] + 1) * r.width) / 2,
          y: r.top + ((1 - v[1] / v[3]) * r.height) / 2,
        };
      },
      { x, z },
    );
  const sum = () =>
    p.evaluate(() => app.terrain.weights.reduce((s, v) => s + v, 0));
  const pixel = () =>
    p.evaluate(() => {
      const st = app.stage;
      st.renderer.render(st.scene, st.view);
      const gl = st.renderer.getContext(),
        out = new Uint8Array(4);
      const x = Math.floor(st.canvas.width / 2),
        y = Math.floor(st.canvas.height / 2);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    });
  await p.click('#inspector-scene [data-terrain-tab="sculpt"]');
  await p.click('[data-brush="material"]');
  await p.select(
    '[data-terrain-brush-settings] [data-field="surface"] select',
    "soil",
  );
  await p.evaluate(() => app.terrain.setBrush({ size: 9, strength: 1 }));
  const before = await pixel(),
    undoCount = await p.evaluate(() => app._undo?.length || 0);
  let q = await project(0, 0);
  await p.mouse.move(q.x, q.y);
  await p.mouse.down();
  await p.mouse.move(q.x + 18, q.y, { steps: 5 });
  await p.mouse.up();
  const painted = await sum(),
    after = await pixel();
  assert.ok(painted > 0);
  assert.notDeepEqual(before, after);
  assert.equal(await p.evaluate(() => app._undo.length), undoCount + 1);
  await p.evaluate(() => app.undo());
  assert.ok((await sum()) < 0.01);
  await p.evaluate(() => app.redo());
  assert.ok((await sum()) > painted * 0.95);
  await p.click('[data-brush="material"]'); // it was still active after redo; exit before re-entering below
  if (!(await p.evaluate(() => app.state.terrainTool === "material")))
    await p.click('[data-brush="material"]');
  q = await project(0, 0);
  const beforeErase = await sum();
  await p.keyboard.down("Shift");
  await p.mouse.click(q.x, q.y);
  await p.keyboard.up("Shift");
  assert.ok((await sum()) < beforeErase);
  // Pointer capture cancellation restores BOTH terrain channels and removes its provisional undo entry.
  await p.click('[data-brush="raise"]');
  const undoBeforeCancel = await p.evaluate(() => app._undo.length),
    heights = await p.evaluate(() => app.terrain.pack());
  q = await project(20, 0);
  await p.mouse.move(q.x, q.y);
  await p.mouse.down();
  await p.mouse.move(q.x + 12, q.y, { steps: 2 });
  await p.keyboard.press("Escape");
  await p.mouse.up();
  assert.equal(await p.evaluate(() => app.terrain.pack()), heights);
  assert.equal(await p.evaluate(() => app._undo.length), undoBeforeCancel);
  assert.equal(await p.evaluate(() => app.stage.orbit.enabled), true);
  assert.equal(await p.evaluate(() => app.state.terrainTool), null);
  // Actual terrain stroke updates an existing follow road; one undo restores the entire derived network.
  await p.evaluate(() => {
    app.roadBrush.restore([
      {
        id: "ui-road",
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
        points: [
          [-40, 0, -18],
          [40, 0, -18],
        ],
      },
    ]);
  });
  await p.click('[data-brush="raise"]');
  const oldRoad = await p.evaluate(() =>
    app.roadTerrain.height(app.byId("ui-road")._roadData.curve, 0, -18),
  );
  q = await project(0, -18);
  await p.mouse.move(q.x, q.y);
  await p.mouse.down();
  await p.mouse.move(q.x + 8, q.y, { steps: 2 });
  await p.mouse.up();
  const newRoad = await p.evaluate(() =>
    app.roadTerrain.height(app.byId("ui-road")._roadData.curve, 0, -18),
  );
  assert.ok(newRoad > oldRoad + 0.2);
  await p.evaluate(() => app.undo());
  assert.ok(
    Math.abs(
      (await p.evaluate(() =>
        app.roadTerrain.height(app.byId("ui-road")._roadData.curve, 0, -18),
      )) - oldRoad,
    ) < 0.03,
  );
  await p.evaluate(() => app.redo());
  await p.click('[data-brush="flatten"]');
  q = await project(0, -18);
  await p.keyboard.down("Control");
  await p.mouse.click(q.x, q.y);
  await p.keyboard.up("Control");
  const sampled = await p.evaluate(() => ({
    state: app.terrain.state.flattenHeight,
    ui: Number(
      document.querySelector('[data-field="target"] input[type="number"]')
        .value,
    ),
  }));
  assert.ok(sampled.state > 0.2 && Math.abs(sampled.state - sampled.ui) < 0.01);
  // Ctrl-sampling over the road may select it via the existing pointer-up picker.
  // Re-enter the terrain inspector explicitly rather than clicking a hidden duplicate.
  await p.$$eval('#inspector-scene .itab', bs => bs.find(b => b.textContent === '地形').click());
  await p.click('#inspector-scene [data-terrain-tab="sculpt"]');
  await p.click('#inspector-scene [data-terrain-exit]');
  assert.equal(await p.evaluate(() => app.state.terrainTool), null);
  // Selected road inspector mode, height, bridges and safe fill work via real UI controls.
  await p.evaluate(() => app.select({ kind: "obj", so: app.byId("ui-road") }));
  await p.select(
    '#inspector-scene [data-road-terrain] [data-field="mode"] select',
    "fixed",
  );
  const heightInput =
    '#inspector-scene [data-road-terrain] [data-field="level"] input[type="number"]';
  await p.click(heightInput, { clickCount: 3 });
  await p.keyboard.type("8");
  await p.keyboard.press("Tab");
  assert.equal(
    await p.evaluate(() => app.byId("ui-road").serialize().points[0][1]),
    8,
  );
  assert.equal(
    await p.evaluate(() => app.byId("ui-road").serialize().terrainMode),
    "fixed",
  );
  assert.ok(
    await p.evaluate(
      () => app.byId("ui-road").root.userData.bridgeStatus.built > 0,
    ),
  );
  await p.click("#inspector-scene [data-road-fill]");
  assert.ok(await p.evaluate(() => app.terrain.heightAt(20, -18) > 6));
  await p.evaluate(() => app.undo());
  assert.ok(await p.evaluate(() => app.terrain.heightAt(20, -18) < 6));
  const archive = await p.evaluate(async () => {
    const tr = app.terrain,
      weight = tr.weights.reduce((s, v) => s + v, 0),
      n = tr.n,
      blob = await app.saveProject();
    app.clearAll();
    await app.importFiles([new File([blob], "terrain-and-bridge.previz")]);
    return {
      weight,
      restored: tr.weights.reduce((s, v) => s + v, 0),
      n,
      restoredN: tr.n,
      mode: app.byId("ui-road")._roadData.terrainMode,
      piers: app.byId("ui-road").root.userData.bridgeStatus.built,
    };
  });
  assert.equal(archive.n, archive.restoredN);
  assert.ok(
    archive.weight > 0 &&
      Math.abs(archive.restored - archive.weight) < archive.weight * 0.05,
  );
  assert.equal(archive.mode, "fixed");
  assert.ok(archive.piers > 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS real UI refinement 257/513, procedural material pixels, plant-free terrain painting/erase, one-stroke undo, Esc cancellation, linked road geometry, Ctrl sampled flatten target, bridge inspector + earth fill",
  );
} finally {
  await browser.close();
}
