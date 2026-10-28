import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
const b = await puppeteer.launch({
  headless: "shell",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--allow-file-access-from-files",
  ],
  protocolTimeout: 240000,
});
try {
  const p = await b.newPage(),
    errors = [],
    csp = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.setViewport({ width: 1500, height: 1000 });
  await p.evaluateOnNewDocument(() =>
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error("CSP:" + e.violatedDirective),
    ),
  );
  p.on("console", (m) => {
    if (m.text().startsWith("CSP:")) csp.push(m.text());
  });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(
    process.env.TEST_FILE_URL ||
      process.env.TEST_URL ||
      "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await p.waitForFunction(
    () => window.app?.traffic && window.app?.performanceHud,
  );
  await p.click('[data-page="scene"]');
  const merge = await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.terrain.setResolution(33);
    app.terrain.setSize(320);
    app.terrain.h.fill(0);
    app.terrain.refresh();
    app.terrain.setWater(false);
    app.roadBrush.restore([
      {
        id: "h",
        roadType: "freeway",
        width: 20,
        terrainMode: "fixed",
        points: [
          [-120, 8, 0],
          [120, 8, 0],
        ],
        bridges: false,
      },
      {
        id: "s",
        roadType: "asphalt",
        width: 12,
        terrainMode: "fixed",
        points: [
          [0, 0, -120],
          [0, 0, 120],
        ],
        bridges: false,
      },
    ]);
    app.roadConnector.mark(0, app.byId("h"), 0.4);
    app.roadConnector.mark(1, app.byId("s"), 0.6);
    app.roadConnector.generate();
    app.traffic.configure({ enabled: true, vehicles: 36, pedestrians: 16 });
    app.traffic.update(0);
    const tool = app.traffic,
      sim = tool.sim,
      nodes = [...tool.network.nodes.values()],
      actors = sim.agents;
    let minimum = 100;
    for (const node of nodes) {
      const e = node.events.find(
        (e) =>
          e.lane.kind === "car" &&
          e.lane.roadId === node.mainRoad &&
          e.center > e.reach * 2 &&
          e.center < e.lane.length - 40,
      );
      if (!e) continue;
      const actor = actors.find((a) => a.lane === e.lane);
      actor.s = e.entry - 8;
      actor.speed = e.lane.speed;
      sim.agents = [actor];
      sim.reservations.set(e.id, [{ kind: "car", lane: { roadId: "other" } }]);
      if (!sim.canEnter(actor, e)) return { badMain: true };
      for (let i = 0; i < 90; i++) {
        sim.advance(1 / 30);
        sim.time += 1 / 30;
        minimum = Math.min(minimum, actor.speed);
      }
    }
    tool.rebuild();
    tool.renderAt(10);
    const guides = app.objects
      .filter((o) => o.type === "road_intersection")
      .map((o) => o.root.userData.mergeLaneGuideSegments || 0);
    return {
      minimum,
      guides,
      nodes: nodes.map((n) => ({
        controlled: n.controlled,
        freeflow: n.freeflow,
        main: n.mainRoad,
      })),
      speeds: new Set(tool.sim.agents.map((a) => a.speedFactor.toFixed(2)))
        .size,
      positions: tool.sim.agents.map((a) => a.s),
    };
  });
  assert.ok(!merge.badMain);
  assert.ok(merge.minimum > 1);
  assert.ok(merge.guides.every((n) => n > 0));
  assert.ok(merge.nodes.every((n) => n.freeflow && !n.controlled && n.main));
  assert.ok(merge.speeds > 8);
  const lights = await p.evaluate(() => {
    app.roadTerrain.setRoad(app.byId("s"), {
      streetLights: true,
      lampSpacing: 24,
    });
    app.lighting.applyPreset("night");
    app.traffic.update(0);
    app.traffic.renderAt(10);
    let pools = [],
      realLights = 0;
    app.byId("s").root.traverse((m) => {
      if (m.isLight) realLights++;
      if (m.userData.bakedRoadLightPool) pools.push(m);
    });
    const ids = pools.map((m) => m.material.map.uuid),
      night = pools.every((m) => m.visible && m.material.opacity > 0),
      count = pools.length;
    app.lighting.applyPreset("noon");
    const day = pools.every((m) => !m.visible);
    app.lighting.applyPreset("night");
    const saved = JSON.parse(JSON.stringify(app.serialize()));
    app.loadJson(saved);
    app.traffic.update(0);
    let loaded = [];
    app.byId("s").root.traverse((m) => {
      if (m.userData.bakedRoadLightPool) loaded.push(m);
    });
    app.select(null);
    app.stage.view.position.set(42, 38, 70);
    app.stage.orbit.target.set(0, 0, 20);
    app.stage.orbit.update();
    app.stage.render();
    return {
      count,
      night,
      day,
      realLights,
      sharedTexture: loaded.every((m) => ids.includes(m.material.map.uuid)),
      reload: loaded.every((m) => m.visible),
      shader: loaded.every((m) => m.material.isMeshBasicMaterial),
    };
  });
  for (const key of ["night", "day", "sharedTexture", "reload", "shader"])
    assert.equal(lights[key], true, key);
  assert.ok(lights.count > 0);
  assert.equal(lights.realLights, 0);
  const mode = process.env.TEST_FILE_URL
    ? "file"
    : process.env.TEST_URL
      ? "desktop-csp"
      : "web";
  await mkdir(".shots", { recursive: true });
  if (mode === "web") {
    const clip = await p.$eval("#stage canvas", (c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.floor(r.width),
        height: Math.floor(r.height),
      };
    });
    await p.screenshot({ path: ".shots/road-light-pools.png", clip });
  }
  await p.evaluate(() => {
    app.openPerformance();
  });
  await p.waitForSelector("[data-performance-dialog]");
  await p.evaluate(() =>
    document.querySelector("[data-performance-dialog]").close(),
  );
  await p.waitForSelector("[data-performance-hud]", { visible: true });
  const hud = await p.$eval("[data-performance-hud]", (e) => ({
    text: e.textContent,
    inViewport: !!e.closest("#stage"),
  }));
  assert.ok(hud.inViewport);
  for (const label of ["FPS", "JS 堆", "显存资源估算", "浏览器不可读"])
    assert.ok(hud.text.includes(label), label);
  const png = await p.evaluate(async () => {
    const result = await app.exporter.still({
      asDataUrl: true,
      width: 320,
      height: 180,
    });
    return (
      result?.startsWith("data:image/png;") &&
      document.querySelector("[data-performance-hud]").isConnected
    );
  });
  assert.equal(png, true);
  await p.evaluate(() => {
    app.performanceHud.setEnabled(false);
    app.select(null);
    document.querySelectorAll("#inspector-scene .itab").forEach((b) => {
      if (b.textContent === "地形") b.click();
    });
  });
  await p.waitForSelector(
    '#inspector-scene [data-field="size"] input[type=number]',
    { visible: true },
  );
  await p.focus('#inspector-scene [data-field="size"] input[type=number]');
  await p.keyboard.down("Control");
  await p.keyboard.press("KeyA");
  await p.keyboard.up("Control");
  await p.keyboard.type("4096");
  await p.keyboard.press("Tab");
  const world = await p.evaluate(() => {
    const size = app.terrain.size,
      n = app.terrain.n,
      cells = app.terrain.h.length,
      far = app.stage.view.far,
      maxDistance = app.stage.orbit.maxDistance;
    const saved = JSON.parse(JSON.stringify(app.serialize()));
    app.undo();
    const undo = app.terrain.size;
    app.redo();
    const redo = app.terrain.size;
    app.loadJson(saved);
    return {
      size,
      n,
      cells,
      far,
      maxDistance,
      undo,
      redo,
      loaded: app.terrain.size,
    };
  });
  assert.equal(world.size, 4096);
  assert.equal(world.loaded, 4096);
  assert.equal(world.redo, 4096);
  assert.equal(world.undo, 320);
  assert.equal(world.cells, world.n ** 2);
  assert.equal(world.n, 33);
  assert.ok(world.far > 4096 && world.maxDistance > 4096);
  const riverPersistence = await p.evaluate(() => {
    app.terrain.workflow.rivers = [
      {
        id: "large-river",
        name: "large river",
        points: [
          [-500, 0, 700],
          [500, 0, 700],
        ],
        width: 6,
        depth: 2,
        bank: 4,
        water: false,
      },
    ];
    const large = JSON.parse(JSON.stringify(app.serialize()));
    app.terrain.setSize(320);
    const small = JSON.parse(JSON.stringify(app.serialize()));
    app.loadJson(small);
    const retained = app.terrain.workflow.rivers.length === 1;
    app.loadJson(large);
    return retained && app.terrain.workflow.rivers[0]?.id === "large-river";
  });
  assert.equal(
    riverPersistence,
    true,
    "temporarily shrinking terrain must not silently delete saved rivers",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  await writeFile(
    `.shots/traffic-world-${mode}.json`,
    JSON.stringify(
      {
        platform:
          "Linux Chromium software WebGL, not native Windows acceptance",
        merge,
        lights,
        hud,
        png,
        world,
        riverPersistence,
        errors,
        csp,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS " +
      mode +
      " actual ramp priority + continuing lane guides / randomized traffic / shared prebaked pools night-day-reload without realtime lights / viewport HUD and PNG / real 4096m UI + fixed resolution + undo-redo-load",
  );
} finally {
  await b.close();
}
