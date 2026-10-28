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
try {
  const p = await browser.newPage(),
    errors = [],
    csp = [];
  await p.setViewport({ width: 1500, height: 1000 });
  p.on("pageerror", (e) => errors.push(String(e)));
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
  await p.waitForFunction(() => window.app?.traffic);
  await p.click('[data-page="scene"]');
  const bridge = await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.terrain.setSize(320);
    app.terrain.setResolution(33);
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
    const rc = app.roadConnector;
    rc.mark(0, app.byId("h"), 0.4);
    rc.mark(1, app.byId("s"), 0.6);
    const ramp = rc.generate(),
      status = ramp.root.userData.bridgeStatus;
    const Box = app.roadTerrain.obstacles()[0].box.constructor,
      Matrix = ramp.root.matrixWorld.constructor,
      children = app.objects
        .filter((o) => o.type === "road_brush")
        .flatMap((o) =>
          o.root.children.filter(
            (c) => !c.userData.roadSupport && !c.userData.roadLamps,
          ),
        );
    let intersections = 0;
    for (const group of ramp.root.children.filter(
      (c) => c.userData.roadSupport,
    ))
      for (const mesh of group.children) {
        const box = new Box().setFromObject(mesh),
          inverse = mesh.userData.supportSolidMatrix
            ? new Matrix().fromArray(mesh.userData.supportSolidMatrix).invert()
            : null;
        for (const child of children)
          if (
            box.intersectsBox(new Box().setFromObject(child)) &&
            app.roadTerrain.intersectsGeometry(box, child, inverse)
          )
            intersections++;
      }
    const stable = JSON.stringify(status.stations);
    app.roadTerrain.updateSupports();
    const cached =
      JSON.stringify(ramp.root.userData.bridgeStatus.stations) === stable;
    const marks = app.objects
      .filter((o) => o.type === "road_intersection")
      .map((o) => ({
        guides: o.root.userData.mergeGuideSegments,
        zebra: o.root.userData.crosswalkBars,
        stop: o.root.userData.stopLines,
      }));
    const Ray = app.stage.raycaster.constructor,
      V = app.stage.view.position.constructor,
      ray = new Ray(),
      surfaces = [],
      markGaps = [];
    for (const o of app.objects.filter((o) =>
      ["road_brush", "road_intersection"].includes(o.type),
    ))
      o.root.traverse((m) => {
        if (m.isMesh && m.name !== "junction-merge-guides") surfaces.push(m);
      });
    for (const o of app.objects.filter((o) => o.type === "road_intersection")) {
      const guide = o.root.getObjectByName("junction-merge-guides");
      if (!guide) continue;
      const a = guide.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 3) {
        const q = new V();
        for (let j = 0; j < 3; j++)
          q.add(new V().fromBufferAttribute(a, i + j));
        q.divideScalar(3).applyMatrix4(guide.matrixWorld);
        ray.set(new V(q.x, q.y + 0.2, q.z), new V(0, -1, 0));
        ray.far = 0.5;
        const hits = ray
          .intersectObjects(surfaces, false)
          .filter((h) => Math.abs(q.y - h.point.y) < 0.3);
        markGaps.push(
          hits.length ? q.y - Math.max(...hits.map((h) => h.point.y)) : null,
        );
      }
    }
    const snapshot = JSON.parse(JSON.stringify(app.serialize()));
    app.loadJson(snapshot);
    const reloaded = app.byId(ramp.id).root.userData.bridgeStatus;
    return {
      status,
      markMinGap: Math.min(...markGaps),
      markMaxGap: Math.max(...markGaps),
      markMissing: markGaps.includes(null),
      intersections,
      cached,
      marks,
      reloadedBuilt: reloaded.built,
      reloadedStations: JSON.stringify(reloaded.stations) === stable,
    };
  });
  assert.ok(bridge.status.built >= 6, JSON.stringify(bridge));
  assert.ok(bridge.status.effectiveSpacing < bridge.status.requestedSpacing);
  assert.ok(bridge.status.maxSupportGap <= 10);
  assert.equal(bridge.intersections, 0);
  assert.equal(bridge.markMissing, false);
  assert.ok(
    bridge.markMinGap >= 0.004 && bridge.markMaxGap <= 0.09,
    "guides must stay visible above actual pavement, including retained-deck seams",
  );
  assert.equal(bridge.cached, true);
  assert.equal(bridge.reloadedStations, true);
  for (const m of bridge.marks) {
    assert.ok(m.guides >= 2);
    assert.equal(m.zebra, 0);
    assert.equal(m.stop, 0);
  }
  if (!process.env.TEST_FILE_URL && !process.env.TEST_URL) {
    await mkdir(".shots", { recursive: true });
    await p.evaluate(() => {
      app.select(null);
      const c = app.objects
        .find((o) => o._roadData?.connection)
        ._roadData.curve.getPointAt(0.55);
      app.stage.view.position.set(c.x + 43, c.y + 24, c.z + 40);
      app.stage.orbit.target.set(c.x, c.y - 2, c.z);
      app.stage.orbit.update();
      app.stage.render();
    });
    const clip = await p.$eval("#stage canvas", (c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.floor(r.width),
        height: Math.floor(r.height),
      };
    });
    await p.screenshot({ path: ".shots/road-supports.png", clip });
  }
  await p.evaluate(() => {
    app.clearAll();
    app.roadBrush.restore([
      {
        id: "edit",
        roadType: "asphalt",
        width: 12,
        terrainMode: "fixed",
        points: [
          [-70, 0, -40],
          [70, 0, -40],
        ],
        bridges: false,
      },
    ]);
    app.select({ kind: "obj", so: app.byId("edit") });
    window.draftFlashes = 0;
    window.formObserver = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (
            n.nodeType === 1 &&
            (n.matches?.('[data-road-elevation="draft"]') ||
              n.querySelector?.('[data-road-elevation="draft"]'))
          )
            window.draftFlashes++;
    });
    window.formObserver.observe(document.querySelector("#inspector-scene"), {
      childList: true,
      subtree: true,
    });
  });
  await p.waitForSelector('#inspector-scene [data-road-property="laneWidth"]', {
    visible: true,
  });
  await p.focus('#inspector-scene [data-road-property="laneWidth"]');
  await p.keyboard.down("Control");
  await p.keyboard.press("KeyA");
  await p.keyboard.up("Control");
  await p.keyboard.type("4.2");
  const retained = await p.evaluate(() => {
    window.oldRoadInput = document.activeElement;
    app.bus.emit("road-edit");
    app.bus.emit("objects");
    return (
      oldRoadInput.isConnected &&
      document.activeElement === oldRoadInput &&
      oldRoadInput.value === "4.2"
    );
  });
  assert.equal(retained, true, "typing must keep focus/value/node");
  await p.focus('#inspector-scene [data-road-property="laneCount"]');
  await p.keyboard.down("Control");
  await p.keyboard.press("KeyA");
  await p.keyboard.up("Control");
  await p.keyboard.type("4");
  await p.focus('#inspector-scene [data-road-property="shoulderWidth"]');
  await p.keyboard.down("Control");
  await p.keyboard.press("KeyA");
  await p.keyboard.up("Control");
  await p.keyboard.type("0.8");
  const panel = await p.evaluate(() => {
    document.activeElement.blur();
    const d = app.byId("edit").serialize();
    return {
      section: d.section,
      flashes: window.draftFlashes,
      oldInputConnected: oldRoadInput.isConnected,
    };
  });
  assert.equal(panel.section.laneWidth, 4.2);
  assert.equal(panel.section.laneCount, 4);
  assert.equal(panel.section.shoulderWidth, 0.8);
  assert.equal(panel.flashes, 0);
  await p.evaluate(() => window.formObserver.disconnect());
  await p.evaluate(() => {
    app.clearAll();
    app.roadBrush.restore([
      {
        id: "a",
        roadType: "asphalt",
        width: 12,
        terrainMode: "fixed",
        points: [
          [-120, 0, 0],
          [120, 0, 0],
        ],
        bridges: false,
      },
      {
        id: "b",
        roadType: "concrete",
        width: 12,
        terrainMode: "fixed",
        points: [
          [0, 0, -120],
          [0, 0, 120],
        ],
        bridges: false,
      },
      {
        id: "h",
        roadType: "freeway",
        width: 20,
        terrainMode: "fixed",
        points: [
          [-120, 8, 45],
          [120, 8, 45],
        ],
        bridges: false,
      },
      {
        id: "p",
        roadType: "garden",
        width: 4,
        terrainMode: "fixed",
        points: [
          [40, 0, 90],
          [100, 0, 90],
        ],
        bridges: false,
      },
    ]);
    app.select({ kind: "obj", so: app.byId("a") });
    window.trafficBefore = app._undo.length;
  });
  await p.waitForSelector("#inspector-scene [data-traffic-enabled]", {
    visible: true,
  });
  await p.click("#inspector-scene [data-traffic-enabled]");
  const traffic = await p.evaluate(() => {
    const tool = app.traffic;
    tool.update(0);
    const before = app.objects.length,
      sim = tool.sim,
      lanes = [...tool.network.lanes.values()],
      node = [...tool.network.nodes.values()].find((n) => n.controlled),
      lane = node.events.find(
        (e) => e.group === 1 && e.lane.kind === "car" && e.lane.dir === 1,
      ).lane,
      event = lane.events.find((e) => e.id === node.id),
      actor = sim.agents.find((a) => a.lane === lane);
    actor.s = event.entry - 14;
    actor.speed = 0;
    sim.sample(9);
    const redStopped = actor.s <= event.entry + 0.01 && actor.speed < 0.1;
    sim.sample(23);
    const greenMoved = actor.lane !== lane || actor.s > event.entry + 1;
    tool.renderAt(23);
    const movedPose = sim.agents
      .filter((a) => a.kind === "car")
      .map((a) => sim.pose(a).position.toArray());
    const snapshots = JSON.parse(JSON.stringify(app.serialize()));
    app.undo();
    const undoDisabled = !app.traffic.settings.enabled;
    app.redo();
    const redoEnabled = app.traffic.settings.enabled;
    app.loadJson(snapshots);
    app.traffic.update(0);
    app.traffic.renderAt(23);
    const newPoses = app.traffic.sim.agents
      .filter((a) => a.kind === "car")
      .map((a) => app.traffic.sim.pose(a).position.toArray());
    return {
      redStopped,
      greenMoved,
      undoDisabled,
      redoEnabled,
      noSceneActors: app.objects.length === before,
      settings: snapshots.traffic,
      cars: app.traffic.sim.agents.filter((a) => a.kind === "car").length,
      pedestrians: app.traffic.sim.agents.filter((a) => a.kind === "pedestrian")
        .length,
      heads: app.traffic.signalHeads.length,
      noMotorwayPedestrians:
        lanes.filter((l) => l.roadId === "h" && l.kind === "pedestrian")
          .length === 0,
      noGardenCars:
        lanes.filter((l) => l.roadId === "p" && l.kind === "car").length === 0,
      nativeInstancing: app.traffic.parts.every((p) => p.mesh.isInstancedMesh),
      oneUndo: window.trafficBefore + 1 === app._undo.length,
      seed: app.traffic.settings.seed,
    };
  });
  for (const k of [
    "redStopped",
    "greenMoved",
    "undoDisabled",
    "redoEnabled",
    "noSceneActors",
    "noMotorwayPedestrians",
    "noGardenCars",
    "nativeInstancing",
    "oneUndo",
  ])
    assert.equal(traffic[k], true, k);
  assert.ok(traffic.cars >= 12 && traffic.pedestrians >= 6);
  assert.ok(traffic.heads >= 6);
  assert.equal(traffic.settings.enabled, true);
  await p.evaluate(() => {
    app.select({ kind: "obj", so: app.byId("a") });
  });
  await p.click("#inspector-scene [data-traffic-play]");
  const running = await p.evaluate(() => {
    app.traffic.update(1);
    return app.traffic.previewTime;
  });
  await p.click("#inspector-scene [data-traffic-play]");
  const paused = await p.evaluate(() => {
    app.traffic.update(1);
    return app.traffic.sim.time;
  });
  assert.ok(
    paused >= running - 0.04 && paused <= running + 0.04,
    "pause retains the preview, not timeline zero",
  );
  const pngSafe = await p.evaluate(async () => {
    const t = app.traffic.previewTime,
      pose = JSON.stringify(
        app.traffic.sim.agents.map((a) =>
          app.traffic.sim.pose(a).position.toArray(),
        ),
      );
    const image = await app.exporter.still({
      asDataUrl: true,
      width: 320,
      height: 180,
    });
    return (
      image?.startsWith("data:image/png;") &&
      pose ===
        JSON.stringify(
          app.traffic.sim.agents.map((a) =>
            app.traffic.sim.pose(a).position.toArray(),
          ),
        ) &&
      app.traffic.previewTime === t
    );
  });
  assert.equal(pngSafe, true, "real PNG transaction restores paused traffic");
  const gpuSeekSafe = await p.evaluate(() => {
    const tool = app.traffic,
      part = tool.parts.find((p) => p.mesh.name === "traffic-cars"),
      matrix = part.mesh.matrixWorld.clone();
    for (const time of [30, 0, 8, 3]) {
      tool.renderAt(time);
      part.mesh.getMatrixAt(0, matrix);
      const a = tool.sim.agents.find((a) => a.id === part.agents[0].id),
        p = tool.sim.pose(a).position;
      if (
        Math.abs(matrix.elements[12] - p.x) > 0.001 ||
        Math.abs(matrix.elements[14] - p.z) > 0.001
      )
        return false;
    }
    return true;
  });
  assert.equal(
    gpuSeekSafe,
    true,
    "GPU instances follow new actor references after backwards seek/reset",
  );
  const exportSafe = await p.evaluate(() => {
    const t = app.traffic.previewTime;
    app.traffic.previewMode = true;
    app.traffic.renderAt(t);
    const pose = JSON.stringify(
      app.traffic.sim.agents.map((a) =>
        app.traffic.sim.pose(a).position.toArray(),
      ),
    );
    app.state.time = 2;
    app.traffic.update(0, true);
    app.traffic.update(0, false);
    return (
      pose ===
      JSON.stringify(
        app.traffic.sim.agents.map((a) =>
          app.traffic.sim.pose(a).position.toArray(),
        ),
      )
    );
  });
  assert.equal(exportSafe, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  const mode = process.env.TEST_FILE_URL
    ? "file"
    : process.env.TEST_URL
      ? "desktop-csp"
      : "web";
  await mkdir(".shots", { recursive: true });
  await writeFile(
    `.shots/road-traffic-${mode}.json`,
    JSON.stringify(
      {
        platform:
          "Linux Chromium software WebGL, not native Windows GPU acceptance",
        bridge,
        panel,
        traffic,
        exportSafe,
        pngSafe,
        gpuSeekSafe,
        errors,
        csp,
      },
      null,
      2,
    ),
  );
  if (mode === "web") {
    await p.evaluate(() => {
      app.select(null);
      app.traffic.previewMode = true;
      app.traffic.previewTime = 18;
      app.traffic.renderAt(18);
      app.stage.view.position.set(60, 85, 110);
      app.stage.orbit.target.set(0, 0, 5);
      app.stage.orbit.update();
      app.stage.world.updateMatrixWorld(true);
      app.stage.render();
    });
    const rect = await p.$eval("#stage canvas", (c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.floor(r.width),
        height: Math.floor(r.height),
      };
    });
    await p.screenshot({ path: ".shots/road-traffic.png", clip: rect });
  }
  console.log(
    "PASS " +
      mode +
      " spiral support distribution/contact/cache/reload / merge guides without freeway zebra / real multi-field number editing without draft flashes / actual traffic switch / stop-go signals / road rules / instancing / undo-redo-save-load / paused preview and export restoration",
  );
} finally {
  await browser.close();
}
