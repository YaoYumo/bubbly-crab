import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: "shell",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--allow-file-access-from-files",
  ],
  protocolTimeout: 240000,
});
const errors = [],
  csp = [],
  evidence = {};
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1500, height: 1050 });
  p.on("pageerror", (e) => {
    errors.push(String(e));
    console.error("PAGE", String(e));
  });
  await p.evaluateOnNewDocument(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error("CSP_VIOLATION:" + e.violatedDirective),
    ),
  );
  p.on("console", (m) => {
    if (m.text().includes("CSP_VIOLATION")) csp.push(m.text());
  });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(
    process.env.TEST_FILE_URL ||
      process.env.TEST_URL ||
      "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await p.waitForFunction(() => window.app?.roadTerrain, { timeout: 60000 });
  await p.click('[data-page="scene"]');
  await p.evaluate(() => {
    // Production bundles deliberately do not expose DEV's __t. Derive the actual
    // runtime classes from existing Three objects, without enabling a debug API.
    const mesh = app.stage.scene
      .getObjectsByProperty("isMesh", true)
      .find((m) => m.geometry);
    mesh.geometry.computeBoundingBox();
    window.__roadT = {
      Vector3: app.stage.view.position.constructor,
      Raycaster: app.stage.raycaster.constructor,
      Box3: mesh.geometry.boundingBox.constructor,
    };
    // Input and CPU-ray tests do not compare rendered pixels. Keep their CSS viewport
    // intact while reducing software-WebGL fill cost on this two-CPU sandbox.
    app.stage.renderer.setPixelRatio(0.5);
    app.suspended = true; // Pause rendering only between actual viewport gestures, not geometry or UI updates.
  });
  const sel = (s) => "#inspector-scene " + s;
  const input = async (selector, value) => {
    await p.$eval(selector, (e) => e.scrollIntoView({ block: "center" }));
    await p.click(selector, { clickCount: 3 });
    await p.keyboard.type(String(value));
    await p.keyboard.press("Tab");
  };
  const selectRoad = async (id) =>
    p.evaluate((id) => app.select({ kind: "obj", so: app.byId(id) }), id);
  await p.evaluate(() => {
    app.clearAll();
    app.terrain.setResolution(65);
    app.terrain.h.fill(0);
    app.terrain.refresh();
    app.terrain.setWater(false);
    app.roadBrush.restore([
      {
        id: "lower",
        name: "下层主路",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-60, 0.02, 0],
          [60, 0.02, 0],
        ],
        streetLights: true,
        lampSpacing: 24,
      },
      {
        id: "upper",
        name: "上层高架",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [0, 8.02, -60],
          [0, 8.02, 60],
        ],
        streetLights: true,
        lampSpacing: 24,
      },
    ]);
    app.stage.view.position.set(90, 70, 95);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.orbit.update();
    app.stage.view.updateMatrixWorld(true);
  });
  evidence.interchange = await p.evaluate(() => {
    app.stage.world.updateMatrixWorld(true);
    const T = window.__roadT,
      upper = app.byId("upper"),
      lower = app.byId("lower"),
      r = new T.Raycaster(new T.Vector3(0, 25, 0), new T.Vector3(0, -1, 0));
    const hits = r
      .intersectObjects([upper.root, lower.root], true)
      .map((h) => h.point.y);
    const supports = upper.root.children
      .filter((c) => c.userData.roadSupport)
      .flatMap((c) => c.children);
    return {
      junctions: app.objects.filter((o) => o.type === "road_intersection")
        .length,
      gaps: [lower, upper].map((o) => o._roadData.gaps.length),
      hits,
      bridge: upper.root.userData.bridgeStatus,
      lamps: [lower, upper].map((o) => o.root.userData.roadLampCount),
      supportClear: supports.every((m) => {
        const b = new T.Box3().setFromObject(m);
        return !(
          b.min.z < 6.25 &&
          b.max.z > -6.25 &&
          b.min.x < 60 &&
          b.max.x > -60 &&
          b.min.y < 0.35
        );
      }),
    };
  });
  console.log("interchange", JSON.stringify(evidence.interchange));
  assert.equal(evidence.interchange.junctions, 0);
  assert.deepEqual(evidence.interchange.gaps, [0, 0]);
  assert.ok(evidence.interchange.bridge.built > 0);
  assert.ok(evidence.interchange.supportClear);
  for (const y of [0.19, 8.19])
    assert.ok(
      evidence.interchange.hits.some((h) => Math.abs(h - y) < 0.015),
      `missing deck ${y}`,
    );
  assert.ok(evidence.interchange.lamps.every((n) => n > 0));
  console.log(
    "PASS stacked interchange / two independently raycastable decks / no planar gaps / full-volume support avoidance",
  );
  // Actual inspector interactions: per-road toggle, spacing drag, side; manually placed lamp survives.
  const manual = await p.evaluate(async () => {
    const context = await app.aiScene.context({ mode: "add" });
    const o = app.addAsset(
      context.catalog.find((i) => i.type === "street_lamp").key,
      new window.__roadT.Vector3(22, 0, 22),
    );
    return o.id;
  });
  await selectRoad("upper");
  const light = sel('[data-road-lighting="1"]');
  await p.waitForSelector(light);
  await p.$eval(light + " .sw", (e) => e.scrollIntoView({ block: "center" }));
  await p.click(light + " .sw");
  assert.equal(
    await p.evaluate(() => app.byId("upper").root.userData.roadLampCount),
    0,
  );
  assert.ok(await p.evaluate((id) => !!app.byId(id), manual));
  assert.ok(
    await p.evaluate(() => app.byId("lower").root.userData.roadLampCount > 0),
  );
  await p.evaluate(() => app.undo());
  assert.ok(
    await p.evaluate(() => app.byId("upper").root.userData.roadLampCount > 0),
  );
  await p.evaluate(() => app.redo());
  assert.equal(
    await p.evaluate(() => app.byId("upper").root.userData.roadLampCount),
    0,
  );
  await selectRoad("upper");
  await p.click(light + " .sw");
  const slider = await p.$(light + ' input[type="range"]');
  await slider.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const b = await slider.boundingBox();
  await p.mouse.move(
    b.x + 8 + ((24 - 8) / 72) * (b.width - 16),
    b.y + b.height / 2,
  );
  await p.mouse.down();
  await p.mouse.move(b.x + b.width - 8, b.y + b.height / 2, { steps: 7 });
  assert.ok(
    await slider.evaluate((e) => e.isConnected),
    "lamp range detached before release",
  );
  await p.mouse.up();
  await p.waitForFunction(() => app.byId("upper")._roadData.lampSpacing === 80);
  await p.waitForSelector(light + " select", { visible: true });
  await p.select(light + " select", "left");
  evidence.lighting = await p.evaluate(
    (id) => ({
      upper: app.byId("upper").serialize(),
      count: app.byId("upper").root.userData.roadLampCount,
      lower: app.byId("lower").root.userData.roadLampCount,
      manual: !!app.byId(id),
    }),
    manual,
  );
  assert.equal(evidence.lighting.count, 2);
  assert.ok(evidence.lighting.manual);
  assert.equal(evidence.lighting.upper.lampSide, "left");
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate(() => app.byId("upper")._roadData.lampSide),
    "both",
  );
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate(() => app.byId("upper")._roadData.lampSpacing),
    24,
  );
  await p.evaluate(() => {
    app.redo();
    app.redo();
  });
  await p.evaluate(() => {
    app.lighting.applyGlow(1.7);
  });
  assert.ok(
    await p.evaluate(() =>
      app
        .byId("upper")
        .root.children.find((c) => c.userData.roadLamps)
        .userData.glow.every((m) => m.emissiveIntensity === 1.7),
    ),
  );
  await selectRoad("upper");
  await p.select(sel('[data-road-property="type"]'), "concrete");
  assert.ok(
    await p.evaluate(() => {
      const rd = app.byId("upper")._roadData;
      return rd.streetLights && rd.lampSpacing === 80 && rd.lampSide === "left";
    }),
  );
  const saved = await p.evaluate(() =>
    JSON.parse(JSON.stringify(app.serialize())),
  );
  await p.evaluate((s) => app.loadJson(s), saved);
  assert.ok(
    await p.evaluate(
      (id) =>
        app.byId("upper").root.userData.roadLampCount === 2 && !!app.byId(id),
      manual,
    ),
  );
  console.log(
    "PASS actual road lamp toggle / separate manual lamp / live range retained / spacing and side one-step undo-redo / glow / type edit / save-load",
  );
  // Ground and high-level roads joined by a ramp, through the real preset UI.
  await p.evaluate(() => {
    app.clearAll();
    app.roadBrush.restore([
      {
        id: "ground",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-65, 0.02, -40],
          [65, 0.02, -40],
        ],
      },
      {
        id: "sky",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-65, 8.02, 40],
          [65, 8.02, 40],
        ],
      },
      {
        id: "ramp",
        name: "升降匝道",
        roadType: "oneway",
        width: 6,
        terrainMode: "fixed",
        points: [
          [-40, 0.02, -40],
          [40, 0.02, 40],
        ],
        streetLights: true,
      },
    ]);
    app.select({ kind: "obj", so: app.byId("ramp") });
  });
  await p.click(sel('[data-road-preset="ramp"]'));
  evidence.ramp = await p.evaluate(() => {
    app.stage.world.updateMatrixWorld(true);
    const T = window.__roadT,
      o = app.byId("ramp"),
      rd = o._roadData;
    const samples = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t) => {
      const q = rd.curve.getPointAt(t),
        ray = new T.Raycaster(
          q.clone().add(new T.Vector3(0, 20, 0)),
          new T.Vector3(0, -1, 0),
        );
      const hit = ray
        .intersectObject(o.root, true)
        .find((h) => Math.hypot(h.point.x - q.x, h.point.z - q.z) < 0.01);
      return { t, expected: q.y + 0.17, actual: hit?.point.y };
    });
    return {
      points: rd.ctrl,
      junctions: app.objects
        .filter((o) => o.type === "road_intersection")
        .map((o) => o.root.position.y),
      samples,
      bridge: o.root.userData.bridgeStatus,
    };
  });
  assert.ok(evidence.ramp.points.length >= 17);
  assert.equal(evidence.ramp.points[0][1], 0.02);
  assert.ok(Math.abs(evidence.ramp.points.at(-1)[1] - 8.02) < 1e-9);
  assert.equal(evidence.ramp.junctions.length, 2);
  assert.ok(evidence.ramp.junctions.some((y) => Math.abs(y - 0.02) < 0.01));
  assert.ok(evidence.ramp.junctions.some((y) => Math.abs(y - 8.02) < 0.01));
  assert.ok(
    evidence.ramp.bridge.built > 0,
    "ramp cap must follow grade instead of colliding with its own deck",
  );
  for (const s of evidence.ramp.samples)
    assert.ok(Math.abs(s.actual - s.expected) < 0.04, JSON.stringify(s));
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate(() => app.byId("ramp")._roadData.ctrl.length),
    2,
  );
  await p.evaluate(() => app.redo());
  assert.ok(
    await p.evaluate(() => app.byId("ramp")._roadData.ctrl.length >= 17),
  );
  console.log(
    "PASS real ramp preset / smooth height transition / low and high T-junctions / raycast paved grade / atomic undo-redo",
  );
  evidence.loop = await p.evaluate(() => {
    const rb = app.roadBrush,
      T = window.__roadT;
    app.clearAll();
    rb.restore([
      {
        id: "main",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-65, 8, 0],
          [65, 8, 0],
        ],
      },
      {
        id: "loop",
        roadType: "oneway",
        width: 5,
        terrainMode: "fixed",
        points: [
          [-45, 0, -25],
          [-45, 0, 25],
          [45, 8, 25],
          [45, 8, -25],
        ],
      },
    ]);
    const joins = app.objects
      .filter((o) => o.type === "road_intersection")
      .map((o) => ({ x: o._isect.point.x, y: o.root.position.y }));
    app.clearAll();
    rb.restore([
      {
        id: "self",
        roadType: "asphalt",
        width: 6,
        terrainMode: "fixed",
        points: [
          [-40, 0, -30],
          [40, 0, 30],
          [40, 8, -30],
          [-40, 8, 30],
        ],
      },
    ]);
    const r = new T.Raycaster(new T.Vector3(0, 30, 0), new T.Vector3(0, -1, 0));
    app.stage.world.updateMatrixWorld(true);
    const stackedHits = r
      .intersectObject(app.byId("self").root, true)
      .map((h) => h.point.y);
    // A high junction at the SAME XZ as the low self-crossing must not punch a
    // second, disconnected gap in the low deck.
    rb.restore([
      {
        id: "highStem",
        roadType: "oneway",
        width: 5,
        terrainMode: "fixed",
        points: [
          [0, 8, -35],
          [0, 8, 0],
        ],
      },
    ]);
    app.stage.world.updateMatrixWorld(true);
    const lowAfterJoin = r
      .intersectObject(app.byId("self").root, true)
      .map((h) => h.point.y);
    const ownGaps = app.byId("self")._roadData.gaps.map((g) => ({
      t0: g.t0,
      t1: g.t1,
      midY: app.byId("self")._roadData.curve.getPointAt((g.t0 + g.t1) / 2).y,
    }));
    return { joins, stackedHits, lowAfterJoin, ownGaps };
  });
  assert.equal(evidence.loop.joins.length, 1);
  assert.ok(evidence.loop.joins[0].x > 40);
  assert.ok(Math.abs(evidence.loop.joins[0].y - 8) < 0.01);
  for (const y of [0.17, 8.17])
    assert.ok(
      evidence.loop.stackedHits.some((h) => Math.abs(h - y) < 0.025),
      `self-stacked deck ${y}`,
    );
  assert.ok(
    evidence.loop.lowAfterJoin.some((h) => Math.abs(h - 0.17) < 0.025),
    "high junction cut the lower self-stacked deck",
  );
  assert.ok(
    evidence.loop.ownGaps.length > 0 &&
      evidence.loop.ownGaps.every((g) => g.midY > 7.9),
  );
  console.log(
    "PASS loop ramp underpass then valid join on the same road / self-stacked alignment preserves both elevations",
  );
  // A high road is editable numerically and with an actual Shift+drag; no XZ drift.
  await p.evaluate(() => {
    app.clearAll();
    app.roadBrush.restore([
      {
        id: "drag",
        name: "可编辑高架",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-30, 8, 20],
          [30, 8, 20],
        ],
        streetLights: true,
        lampSide: "right",
      },
    ]);
    app.select({ kind: "obj", so: app.byId("drag") });
    app.stage.view.position.set(65, 60, 85);
    app.stage.orbit.target.set(0, 4, 20);
    app.stage.orbit.update();
    app.stage.view.updateMatrixWorld(true);
    app.suspended = false;
  });
  await p.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const project = async (i) =>
    p.evaluate((i) => {
      const o = app.byId("drag"),
        v = new window.__roadT.Vector3(...o._roadData.ctrl[i]).project(
          app.stage.view,
        ),
        r = app.stage.canvas.getBoundingClientRect();
      return {
        x: r.left + ((v.x + 1) * r.width) / 2,
        y: r.top + ((1 - v.y) * r.height) / 2,
      };
    }, i);
  const q = await project(0);
  await p.mouse.move(q.x, q.y);
  await p.keyboard.down("Shift");
  await p.mouse.down();
  await p.mouse.move(q.x, q.y - 32, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.up("Shift");
  evidence.drag = await p.evaluate(() => {
    app.suspended = true;
    return app.byId("drag").serialize();
  });
  assert.equal(evidence.drag.points[0][0], -30);
  assert.equal(evidence.drag.points[0][2], 20);
  assert.ok(evidence.drag.points[0][1] > 8.5);
  assert.equal(evidence.drag.streetLights, true);
  assert.equal(evidence.drag.lampSide, "right");
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate(() => app.byId("drag")._roadData.ctrl[0][1]),
    8,
  );
  await p.evaluate(() => app.redo());
  await selectRoad("drag");
  await p.click(sel("[data-road-point-details] summary"));
  await input(sel('[data-road-point="1"][data-road-axis="y"]'), 12);
  assert.equal(
    await p.evaluate(() => app.byId("drag")._roadData.ctrl[1][1]),
    12,
  );
  // High-level preset is one undoable operation and retains the road identity.
  await input(sel("[data-road-preset-end]"), 10);
  await p.click(sel('[data-road-preset="elevated"]'));
  assert.ok(
    await p.evaluate(() =>
      app.byId("drag")._roadData.ctrl.every((p) => p[1] === 10),
    ),
  );
  await p.evaluate(() => app.undo());
  assert.equal(
    await p.evaluate(() => app.byId("drag")._roadData.ctrl[1][1]),
    12,
  );
  await selectRoad("drag");
  const shotId = await p.evaluate(() => {
    const shot = app.addShot();
    shot.targetId = "drag";
    app.select({ kind: "obj", so: app.byId("drag") });
    return shot.id;
  });
  const beforeEdit = await p.evaluate(() => ({
    data: app.byId("drag").serialize(),
    undo: app._undo.length,
  }));
  await p.$$eval("#inspector-scene button", (bs) =>
    bs.find((b) => b.textContent === "编辑路径圆点（拖动调整）").click(),
  );
  await p.waitForSelector(sel('[data-road-elevation="draft"]'));
  await input(sel('[data-road-point="1"][data-road-axis="y"]'), 16);
  await p.click(sel("[data-road-draft-cancel]"));
  assert.deepEqual(
    await p.evaluate(() => app.byId("drag").serialize()),
    beforeEdit.data,
  );
  assert.equal(await p.evaluate(() => app._undo.length), beforeEdit.undo);
  assert.equal(
    await p.evaluate(
      (id) => app.shots.find((s) => s.id === id).targetId,
      shotId,
    ),
    "drag",
  );
  // Locked roads reject programmatic edits and disable actual coordinate/preset/light controls.
  await p.evaluate(() => {
    app.byId("drag").locked = true;
    app.select({ kind: "obj", so: app.byId("drag") });
  });
  assert.ok(
    await p.$$eval(
      "#inspector-scene [data-road-elevation] input,#inspector-scene [data-road-elevation] button,#inspector-scene [data-road-lighting] input,#inspector-scene [data-road-lighting] select,#inspector-scene [data-road-lighting] button",
      (es) => es.length > 0 && es.every((e) => e.disabled),
    ),
  );
  assert.equal(
    await p.evaluate(() =>
      app.roadBrush.updateRoadProperties(app.byId("drag"), {
        points: [
          [-30, 2, 20],
          [30, 4, 20],
        ],
      }),
    ),
    null,
  );
  console.log(
    "PASS real Shift height drag / stable XZ + settings / per-point numeric editing / high-level preset / cancel restores undo and camera targets / lock guard",
  );
  // New fixed-height drawing, not only retrofitting saved roads. Supports also work on flat
  // ground with terrain display switched off; existing old roads default lights to off.
  await p.evaluate(() => {
    app.clearAll();
    app.suspended = false;
    app.terrain.setEnabled(false);
    app.roadBrush.start();
  });
  await p.select(sel("[data-road-draft-mode]"), "fixed");
  await input(sel("[data-road-draft-height]"), 6);
  for (const [x, z] of [
    [-25, -10],
    [25, -10],
  ]) {
    const q = await p.evaluate(
      ({ x, z }) => {
        const v = new window.__roadT.Vector3(x, 6, z).project(app.stage.view),
          r = app.stage.canvas.getBoundingClientRect();
        return {
          x: r.left + ((v.x + 1) * r.width) / 2,
          y: r.top + ((1 - v.y) * r.height) / 2,
        };
      },
      { x, z },
    );
    await p.mouse.click(q.x, q.y);
  }
  await p.click(sel("[data-road-draft-finish]"));
  await p.keyboard.press("Escape");
  evidence.newFixed = await p.evaluate(() => {
    app.suspended = true;
    const o = app.objects.find((o) => o.type === "road_brush");
    return { data: o?.serialize(), bridge: o?.root.userData.bridgeStatus };
  });
  assert.ok(
    evidence.newFixed.data.points.every((p) => Math.abs(p[1] - 6) < 1e-8),
  );
  assert.ok(evidence.newFixed.bridge.built > 0);
  assert.equal(evidence.newFixed.data.streetLights, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  await mkdir(".shots", { recursive: true });
  await writeFile(
    `.shots/road-elevation-${process.env.TEST_FILE_URL ? "file" : process.env.TEST_URL ? "desktop-csp" : "web"}.json`,
    JSON.stringify(
      {
        url: process.env.TEST_FILE_URL || process.env.TEST_URL || "web",
        rendererPixelRatio: 0.5,
        continuousRenderingPausedOutsideViewportGestures: true,
        ...evidence,
        errors,
        csp,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS new fixed-height mouse drawing / ground-off supports / backwards-compatible lamps off / no JS or CSP errors",
  );
} finally {
  await browser.close();
}
