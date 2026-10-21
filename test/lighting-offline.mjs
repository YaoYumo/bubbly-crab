import assert from "node:assert/strict";
import puppeteer from "puppeteer";
const b = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [];
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto("file://" + process.cwd() + "/previz-lab.html?fresh=1", {
    waitUntil: "load",
  });
  await p.waitForFunction(
    () => window.__previzBooted && window.app?.localLights,
  );
  await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.stage.renderer.setPixelRatio(0.5);
  });
  await p.click('[data-page="scene"]');
  await p.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => b.textContent === "光影").click(),
  );
  await p.select("#inspector-scene [data-lighting-mode] select", "physical");
  await p.click('#inspector-scene [data-sky-preset="无月夜"]');
  assert.equal(
    await p.evaluate(() => app.lighting.physical.settings.sunElev),
    -14,
  );
  // Use the shipped library UI, not development-only module exports.
  await p.evaluate(() => {
    [...document.querySelectorAll("#page-scene .card")]
      .find((e) => e.textContent.includes("Street Lamp 路灯"))
      .click();
  });
  const id = await p.evaluate(() => app.selObj.id);
  await p.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => b.textContent === "物体").click(),
  );
  await p.waitForSelector("#inspector-scene [data-luminaire]", {
    visible: true,
  });
  await p.select(
    '#inspector-scene [data-luminaire] [data-field="mode"] select',
    "on",
  );
  const field =
    '#inspector-scene [data-luminaire] [data-field="lumens"] input[type="number"]';
  await p.click(field, { clickCount: 3 });
  await p.keyboard.type("2000");
  await p.keyboard.press("Tab");
  assert.equal(
    await p.evaluate((id) => app.byId(id).params.light.lumens, id),
    2000,
  );
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate((id) => app.byId(id).params.light.lumens, id),
    1500,
  );
  await p.evaluate(() => app.redo());
  assert.equal(
    await p.evaluate((id) => app.byId(id).params.light.lumens, id),
    2000,
  );
  const result = await p.evaluate(async () => {
    const so = app.objects[0];
    so.root.position.set(0, 0, 0);
    app.stage.view.position.set(8, 8, 14);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.orbit.update();
    app.step(0, true);
    app.stage.render();
    const lit = app.localLights.stats.active,
      shadowMap = !!app.localLights.pool[0].shadow.map;
    const P = app.lighting.physical,
      before = P.bakes;
    P.configure({ whiteBalance: 4200, ev: 1 });
    app.step(0, true);
    const noRebake = P.bakes === before;
    const key = so.key;
    await app.importFiles([
      new File([await app.saveProject()], "night.previz"),
    ]);
    app.step(0, true);
    const restored = app.objects[0],
      project =
        restored.key === key &&
        restored.params.light.lumens === 2000 &&
        P.settings.whiteBalance === 4200 &&
        P.settings.ev === 1 &&
        app.lighting.mode === "physical";
    const shot = app.addShot();
    shot.iso = 800;
    app.state.preview = false;
    app.step(0, true);
    const exposure = app.stage.renderer.toneMappingExposure;
    let during;
    const original = app.stage.renderFramed.bind(app.stage);
    app.stage.renderFramed = (...args) => {
      during = app.stage.renderer.toneMappingExposure;
      return original(...args);
    };
    const png = await app.exporter.still({
      asDataUrl: true,
      width: 320,
      height: 180,
    });
    app.stage.renderFramed = original;
    return {
      lit,
      shadowMap,
      noRebake,
      project,
      exposure,
      during,
      after: app.stage.renderer.toneMappingExposure,
      png: png.startsWith("data:image/png;base64,"),
    };
  });
  assert.equal(result.lit, 1);
  for (const k of ["shadowMap", "noRebake", "project", "png"])
    assert.equal(result[k], true, k);
  assert.equal(result.during, result.exposure * 2);
  assert.equal(result.after, result.exposure);
  assert.deepEqual(errors, []);
  console.log(
    "PASS offline shipped UI / lamp parameters / undo-redo / real light and shadow map / WB-IBL separation / .previz reload / PNG ISO consistency",
    result,
  );
} finally {
  await b.close();
}
