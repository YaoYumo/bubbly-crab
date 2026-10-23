import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    protocolTimeout: 480000,
  }),
  errors = [];
try {
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (
      m.type() === "error" &&
      /shader|WebGLProgram|ReferenceError/.test(m.text())
    )
      errors.push(m.text());
  });
  await p.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL?.startsWith("file:"))
    await p.setOfflineMode(true);
  await p.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await p.waitForFunction(() => window.__previzBooted);
  const result = await p.evaluate(async () => {
    const a = app,
      d = a.roadDiagnostics,
      tr = a.terrain,
      rb = a.roadBrush;
    const check = (v, m) => {
      if (!v) throw Error(m);
    };
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    const reset = () => {
      a.clearAll();
      tr.setResolution(65);
      tr.setEnabled(true);
      tr.setWater(false);
      tr.h.fill(0);
      tr.refresh();
    };
    const restore = (roads) => {
      rb.restore(
        roads.map((r) => ({
          width: 8,
          roadType: "asphalt",
          terrainMode: "fixed",
          bridges: false,
          ...r,
        })),
      );
      a.bus.emit("objects");
    };
    reset();
    restore([
      {
        id: "slope",
        name: "slope <safe>",
        points: [
          [-30, 0, 0],
          [30, 6, 0],
        ],
      },
    ]);
    d.configure("maxGrade", 5);
    const before = JSON.stringify(a.serialize()),
      slope = await d.inspect(a.byId("slope"));
    check(
      JSON.stringify(a.serialize()) === before,
      "inspection changed project",
    );
    check(
      Math.abs(slope.summary.length - 60) < 0.01 &&
        Math.abs(slope.summary.maxGrade - 10) < 0.01,
      "grade not percent per horizontal metre",
    );
    check(
      slope.issues.some((i) => i.kind === "grade"),
      "slope not flagged",
    );
    d.configure("maxGrade", 10);
    const boundary = await d.inspect(a.byId("slope"));
    check(
      !boundary.issues.some((i) => i.kind === "grade"),
      "floating point grade boundary falsely flagged",
    );
    const old = d.reports.get("slope");
    let cancelled = false;
    try {
      await d.inspect(a.byId("slope"), () => d.cancel());
    } catch (e) {
      cancelled = e.name === "AbortError";
    }
    check(
      cancelled && d.reports.get("slope") === old,
      "cancel replaced previous result",
    );
    let staleCancelled = false;
    try {
      await d.inspect(a.byId("slope"), () => a.bus.emit("objects"));
    } catch (e) {
      staleCancelled = e.name === "AbortError";
    }
    check(staleCancelled, "scene mutation did not invalidate in-flight check");
    check(!d.focus(old, old.samples[0].point), "stale result can navigate");
    reset();
    tr.h.fill(2);
    tr.refresh();
    restore([
      {
        id: "buried",
        points: [
          [-25, 0, 0],
          [25, 0, 0],
        ],
      },
    ]);
    const buried = await d.inspect(a.byId("buried"));
    check(
      buried.summary.maxIntrusion > 1.6 &&
        buried.issues.some((i) => i.kind === "terrain"),
      "buried pavement not found",
    );
    reset();
    restore([
      {
        id: "lower",
        points: [
          [-30, 0, 0],
          [30, 0, 0],
        ],
      },
      {
        id: "upper",
        points: [
          [0, 3, -30],
          [0, 3, 30],
        ],
      },
    ]);
    const low = await d.inspect(a.byId("lower"));
    check(
      low.summary.minClearance > 2.5 && low.summary.minClearance < 3.1,
      "clearance did not use slab underside",
    );
    check(
      low.issues.some((i) => i.kind === "clearance"),
      "low bridge not found",
    );
    check(
      d.focus(low, low.issues.find((i) => i.kind === "clearance").point) &&
        d.marker.visible,
      "valid issue cannot focus",
    );
    const target = a.stage.orbit.target.clone();
    check(
      target.distanceTo(d.marker.position) < 1e-8,
      "focus target/marker mismatch",
    );
    const upper = a.byId("upper");
    upper.visible = false;
    upper.apply();
    a.bus.emit("objects");
    check(!d.marker.visible, "scene change kept old marker");
    const hidden = await d.inspect(a.byId("lower"));
    check(hidden.summary.minClearance === null, "hidden upper road counted");
    reset();
    restore([
      {
        id: "lower",
        points: [
          [-30, 0, 0],
          [30, 0, 0],
        ],
      },
      {
        id: "upper",
        points: [
          [0, 8, -30],
          [0, 8, 30],
        ],
      },
    ]);
    const high = await d.inspect(a.byId("lower"));
    check(
      high.summary.minClearance > 7.4 &&
        !high.issues.some((i) => i.kind === "clearance"),
      "high bridge incorrectly failed",
    );
    check(
      high.previous && high.previous.summary.minClearance === null,
      "previous summary not retained",
    );
    reset();
    restore([
      {
        id: "lower",
        points: [
          [-30, 0, 0],
          [30, 0, 0],
        ],
      },
      {
        id: "upper",
        points: [
          [-30, 3, 9],
          [30, 3, 9],
        ],
      },
    ]);
    const edge = await d.inspect(a.byId("lower"));
    check(
      edge.summary.minClearance != null &&
        edge.issues.some((i) => i.kind === "clearance"),
      "lateral overlap missed",
    );
    reset();
    restore([
      {
        id: "lower",
        points: [
          [-30, 0, 0],
          [30, 0, 0],
        ],
      },
      {
        id: "upper",
        points: [
          [0, 0, -30],
          [0, 0, 30],
        ],
      },
    ]);
    const junction = await d.inspect(a.byId("lower"));
    check(
      junction.summary.minClearance === null &&
        !junction.issues.some((i) => i.kind === "clearance"),
      "at-grade junction counted as low clearance",
    );
    reset();
    restore([
      {
        id: "underJunction",
        points: [
          [-6, 0, 0],
          [6, 0, 0],
        ],
      },
      {
        id: "elevatedEast",
        points: [
          [-35, 3, 0],
          [35, 3, 0],
        ],
      },
      {
        id: "elevatedNorth",
        points: [
          [0, 3, -35],
          [0, 3, 35],
        ],
      },
    ]);
    check(
      a.objects.some((o) => o.type === "road_intersection"),
      "no elevated junction",
    );
    const underJunction = await d.inspect(a.byId("underJunction"));
    check(
      underJunction.issues.some(
        (i) =>
          i.kind === "clearance" &&
          a.byId(i.otherId)?.type === "road_intersection",
      ),
      "actual elevated junction pavement omitted",
    );
    reset();
    tr.h.fill(2);
    tr.refresh();
    restore([
      {
        id: "outside",
        points: [
          [tr.size, 0, 0],
          [tr.size + 30, 0, 0],
        ],
      },
    ]);
    const outside = await d.inspect(a.byId("outside"));
    check(
      outside.summary.terrainOutside > 0 &&
        outside.summary.maxIntrusion === null,
      "clamped terrain outside extent treated as actual mesh",
    );
    reset();
    restore(
      Array.from({ length: 10 }, (_, i) => ({
        id: "limit" + i,
        points: [
          [-5, 0, i * 20],
          [5, 0, i * 20],
        ],
      })),
    );
    a.stage.view.position.set(20, 300, 110);
    a.stage.orbit.target.set(0, 0, 90);
    a.stage.orbit.update();
    a.stage.render();
    const geometryCount = a.stage.renderer.info.memory.geometries,
      markerGeometry = d.marker.geometry,
      archiveBefore = JSON.stringify(a.serialize());
    for (let i = 0; i < 10; i++) await d.inspect(a.byId("limit" + i));
    a.stage.render();
    check(
      d.reports.size === 8 &&
        !d.reports.has("limit0") &&
        d.reports.has("limit2"),
      "report cache not bounded",
    );
    check(
      a.stage.renderer.info.memory.geometries === geometryCount &&
        d.marker.geometry === markerGeometry,
      "read-only scans allocated renderer geometry",
    );
    check(
      archiveBefore === JSON.stringify(a.serialize()),
      "repeat scans mutated project",
    );
    reset();
    restore([
      {
        id: "follow",
        terrainMode: "follow",
        points: [
          [-30, 0, 0],
          [30, 0, 0],
        ],
      },
    ]);
    tr.h.fill(3);
    tr.refresh();
    a.bus.emit("terrain");
    a.bus.emit("objects");
    const follow = await d.inspect(a.byId("follow"));
    check(
      follow.summary.minY >= 2.99 && follow.summary.maxIntrusion <= 0.05,
      "following derived road not inspected " + JSON.stringify(follow.summary),
    );
    reset();
    restore([
      {
        id: "blocked",
        name: "实际受阻桥梁",
        bridges: true,
        points: [
          [-45, 7, 0],
          [45, 7, 0],
        ],
      },
    ]);
    const bridge = a.byId("blocked"),
      pier = bridge.root.children.find((c) => c.userData.roadSupport)
        ?.children[0];
    check(pier, "missing test pier");
    const geometry = pier.geometry.clone();
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(pier.position.clone());
    geometry.scale(130 / size.x, 10 / size.y, 30 / size.z);
    geometry.type = "BufferGeometry";
    delete geometry.parameters;
    await a._adoptModel(
      new pier.constructor(geometry, pier.material.clone()),
      "obstacle.glb",
    );
    check(
      bridge.root.userData.bridgeStatus.blocked > 0 &&
        bridge.root.userData.bridgeStatus.blockedAt.length ===
          bridge.root.userData.bridgeStatus.blocked,
      "blocked pier locations missing",
    );
    const blocked = await d.inspect(bridge);
    check(
      blocked.issues.some((i) => i.kind === "support"),
      "blocked support not located",
    );
    a._suspendUndo = false;
    rb.updateRoadProperties(a.byId("blocked"), { width: 10 });
    const undoBefore = a._undo.length,
      redoBefore = a._redo.length,
      edited = await d.inspect(a.byId("blocked"));
    check(
      a._undo.length === undoBefore && a._redo.length === redoBefore,
      "inspection polluted undo/redo",
    );
    check(
      a.undo() && a.byId("blocked")._roadData.width === 8,
      "undo changed after inspection",
    );
    check(
      !d.focus(edited, edited.samples[0].point),
      "undo kept old report valid",
    );
    check(
      a.redo() && a.byId("blocked")._roadData.width === 10,
      "redo changed after inspection",
    );
    a._suspendUndo = true;
    const project = await a.saveProject();
    await a.importFiles([new File([project], "diagnostics.previz")]);
    check(
      !JSON.stringify(a.serialize({ assets: false })).includes(
        "diagnostic-location",
      ),
      "diagnostic helper archived",
    );
    check(a.byId("blocked"), "road archive lost");
    a.select({ kind: "obj", so: a.byId("blocked") });
    return {
      entry: location.protocol,
      slope: slope.summary,
      buried: buried.summary,
      low: low.summary,
      high: high.summary,
      edge: edge.summary,
      follow: follow.summary,
      underJunction: underJunction.summary,
      outside: outside.summary,
      blocked: blocked.summary,
      cancelled,
      staleCancelled,
    };
  });
  await p.click("#inspector-scene [data-road-diagnostics] summary");
  await p.click("#inspector-scene [data-road-diagnostic-run]");
  await p.waitForFunction(
    () =>
      document
        .querySelector("#inspector-scene [data-road-diagnostic-status]")
        ?.textContent.startsWith("检查完成"),
    { timeout: 120000 },
  );
  assert.match(
    await p.$eval(
      "#inspector-scene [data-road-diagnostic-summary]",
      (x) => x.textContent,
    ),
    /基准标高/,
  );
  assert.ok(
    await p.$('#inspector-scene [data-road-diagnostic-issue="support"]'),
    await p.evaluate(() =>
      JSON.stringify({
        status: app.byId("blocked").root.userData.bridgeStatus,
        summary: app.roadDiagnostics.reports.get("blocked").summary,
        issues: app.roadDiagnostics.reports.get("blocked").issues,
        html: document.querySelector("[data-road-diagnostic-issues]")
          ?.textContent,
      }),
    ),
  );
  await p.evaluate(() => {
    const scope = document.querySelector("#inspector-scene");
    scope.querySelector("[data-road-diagnostic-run]").click();
    scope.querySelector("[data-road-diagnostic-cancel]").click();
    if (
      !scope
        .querySelector("[data-road-diagnostic-status]")
        .textContent.includes("已取消")
    )
      throw Error("native cancel ignored");
    scope.querySelector("[data-road-diagnostic-run]").click();
  });
  await p.waitForFunction(
    () =>
      document
        .querySelector("#inspector-scene [data-road-diagnostic-status]")
        ?.textContent.startsWith("检查完成"),
    { timeout: 120000 },
  );
  assert.equal(
    await p.$eval(
      "#inspector-scene [data-road-diagnostic-run]",
      (e) => e.disabled,
    ),
    false,
  );
  const immutable = await p.evaluate(() => JSON.stringify(app.serialize()));
  const field = '#inspector-scene [data-road-diagnostic-setting="maxGrade"]';
  await p.click(field, { clickCount: 3 });
  await p.keyboard.type("8");
  await p.keyboard.press("Tab");
  assert.match(
    await p.$eval(
      "#inspector-scene [data-road-diagnostic-status]",
      (x) => x.textContent,
    ),
    /已过期/,
  );
  assert.equal(
    await p.$eval(
      '#inspector-scene [data-road-diagnostic-focus="sample"]',
      (x) => x.disabled,
    ),
    true,
  );
  await p.click("#inspector-scene [data-road-diagnostic-run]");
  await p.waitForFunction(
    () =>
      document
        .querySelector("#inspector-scene [data-road-diagnostic-status]")
        ?.textContent.startsWith("检查完成"),
    { timeout: 120000 },
  );
  assert.ok(await p.$("#inspector-scene [data-road-diagnostic-comparison]"));
  assert.equal(
    await p.evaluate(() => JSON.stringify(app.serialize())),
    immutable,
    "thresholds/report changed archive",
  );
  await p.click('#inspector-scene [data-road-diagnostic-issue="support"]');
  assert.equal(
    await p.evaluate(() => app.roadDiagnostics.marker.visible),
    true,
  );
  await p.evaluate(() => {
    const layer = app.stage.helperLayer;
    layer.visible = false;
    app.stage.render();
    if (layer.visible !== false) throw Error("helper visibility changed");
    layer.visible = true;
  });
  assert.deepEqual(errors, []);
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/road-diagnostics-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    "PASS road diagnostics: signed metric grade / read-only / cancel + stale guard / terrain / actual underside clearance + lateral checks / at-grade exclusion / hidden road / derived following / actual blocked pier location / native UI + focus / comparison / archive / helper exclusion",
    result,
  );
} finally {
  await browser.close();
}
