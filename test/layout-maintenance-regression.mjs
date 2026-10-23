import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage(),
    errors = [];
  await page.setViewport({ width: 1500, height: 1000 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.layout && window.app?.aiScene,
    { timeout: 90000 },
  );
  const core = await page.evaluate(async () => {
    const a = app,
      l = a.layout,
      w = a.aiScene,
      ck = (b, m) => {
        if (!b) throw Error(m);
      },
      copy = (o) => JSON.parse(JSON.stringify(o));
    a.benchmarkMode = true;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.followTerrain = false;
    let host = a.addAsset("env:crate:木箱", [0, 0, 0]),
      part = a.addAsset("env:crate:木箱", [4, 0, 0]);
    const h = host.id,
      c = part.id;
    a._quietAdd = false;
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    a._undoBytes = 0;
    const snapshot = () =>
      JSON.stringify(a.serialize({ assets: false }), (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
            )
          : v,
      );
    const original = snapshot();
    l.bind(c, h);
    ck(!a.byId(c).params.sceneAttachment.follow, "default follow");
    a.undo();
    ck(snapshot() === original, "bind undo");
    a.redo();
    ck(a.byId(c).params.sceneAttachment.hostId === h, "bind redo");
    let saved = copy(a.serialize({ assets: false }));
    a.loadJson(saved);
    ck(a.byId(c).params.sceneAttachment.hostId === h, "binding persistence");
    let before = snapshot(),
      r = l.inspect();
    ck(snapshot() === before && !r.stale, "readonly diagnostics");
    a.beginOp("manual host edit", "", true);
    a.byId(h).root.position.x = 10;
    a.bus.emit("objects");
    ck(r.stale, "stale flag");
    ck(a.byId(c).root.position.x === 4, "default no auto mutation");
    ck(
      l.inspect().issues.some((x) => x.code === "attachment-drift"),
      "drift missing",
    );
    let count = a._undo.length;
    l.sync(h);
    ck(
      a.byId(c).root.position.x === 14 && a._undo.length === count + 1,
      "manual sync one undo",
    );
    a.undo();
    ck(
      a.byId(h).root.position.x === 10 && a.byId(c).root.position.x === 4,
      "sync undo preserves edited host",
    );
    a.redo();
    l.setFollow(c, true);
    before = snapshot();
    count = a._undo.length;
    a.select({ kind: "obj", so: a.byId(h) });
    a.bus.emit("transform-start");
    a.byId(h).root.position.x = 20;
    a.bus.emit("transform-change", a.byId(h).root);
    a.bus.emit("transform-end");
    ck(
      a.byId(c).root.position.x === 24 && a._undo.length === count + 1,
      "gizmo auto sync shares undo",
    );
    a.undo();
    ck(snapshot() === before, "gizmo undo host and part");
    a.redo();
    saved = copy(a.serialize({ assets: false }));
    saved.objects.find((o) => o.id === c).pos[0] = -12;
    a.loadJson(saved);
    ck(a.byId(c).root.position.x === -12, "load triggered auto mutation");
    ck(
      l.inspect().issues.some((x) => x.code === "attachment-drift"),
      "loaded drift missing",
    );
    l.sync(h);
    // Locks leave the host edit intact, but prevent child mutation and extra undo entries.
    a.byId(c).locked = true;
    before = a.byId(c).root.position.x;
    count = a._undo.length;
    a.bus.emit("transform-start");
    a.byId(h).root.position.x = 25;
    a.bus.emit("transform-end");
    ck(
      a.byId(c).root.position.x === before && a._undo.length === count + 1,
      "locked auto mutation",
    );
    ck(
      l.inspect().issues.some((x) => x.code === "attachment-locked"),
      "locked report",
    );
    a.undo();
    a.byId(c).locked = false;
    // Inject a failure after one of two parts was moved; no partial sync or history leak.
    const second = a.addAsset("env:crate:木箱", [20, 0, 5]);
    const secondId = second.id;
    l.bind(secondId, h);
    a.byId(h).root.position.x = 30;
    a.bus.emit("objects");
    before = snapshot();
    count = a._undo.length;
    const vec = a.byId(secondId).root.position,
      method = vec.fromArray;
    vec.fromArray = function () {
      throw Error("injected second part update");
    };
    let refused = false;
    try {
      l.sync(h);
    } catch (e) {
      refused = e.message.includes("injected");
    } finally {
      vec.fromArray = method;
    }
    ck(
      refused && snapshot() === before && a._undo.length === count,
      "partial rollback",
    );
    l.sync(h);
    // Copying parts does not make a second automatically snapping attachment.
    a.select({ kind: "obj", so: a.byId(c) });
    const duplicate = a.duplicateSelected();
    ck(
      !duplicate.params.sceneAttachment && !duplicate.params.sceneKit,
      "duplicate inherited binding",
    );
    a.undo();
    // Actual AI candidate applies/persists relation records, then diagnostics detect editing drift.
    const perms = {
      mode: "add",
      bounds: { center: [0, 0], size: [192, 192] },
      editableIds: [],
      preserveTerrain: true,
    };
    const ctx = await w.context(perms),
      aiId = "layout-ai-child";
    const plan = {
      schema: "previz-ai-scene/1",
      id: "layout-ai-plan",
      name: "AI relation persistence fixture",
      baseFingerprint: ctx.baseFingerprint,
      mode: "add",
      bounds: perms.bounds,
      seed: 1,
      terrain: "preserve",
      durationSeconds: a.state.duration,
      operations: [
        { op: "add", id: aiId, key: "env:crate:木箱", pos: [0, 0, 0] },
      ],
      relations: {
        version: 1,
        rules: [
          {
            type: "offset",
            subject: aiId,
            reference: h,
            delta: [10, 0, 30],
            frame: "world",
          },
        ],
      },
    };
    await w.prepare(plan, perms);
    await w.apply({ acceptWarnings: true });
    ck(
      a.layoutRelations?.rules.length === 1 &&
        !a.byId(aiId).params.sceneAttachment,
      "AI constraints not stored independently",
    );
    saved = copy(a.serialize({ assets: false }));
    a.loadJson(saved);
    ck(a.layoutRelations.rules.length === 1, "AI record roundtrip");
    const aiX = a.byId(aiId).root.position.x;
    a.byId(h).root.position.x += 3;
    a.bus.emit("objects");
    ck(
      l.inspect().issues.some((x) => x.code === "relation-offset"),
      "AI drift absent",
    );
    l.sync(h);
    ck(
      a.byId(aiId).root.position.x === aiX,
      "AI relation was silently converted into rig",
    );
    const positions = a.objects.map((o) => o.root.position.toArray());
    l.clearRelations();
    ck(!a.layoutRelations, "clear AI records");
    ck(
      JSON.stringify(positions) ===
        JSON.stringify(a.objects.map((o) => o.root.position.toArray())),
      "clear moved objects",
    );
    a.undo();
    ck(a.layoutRelations.rules.length === 1, "clear undo");
    // Host deletion produces an orphan diagnostic, never cascades deletion or guesses a new host.
    const childCount = a.objects.length;
    a.removeObject(a.byId(h));
    ck(
      a.objects.length === childCount - 1 && a.byId(c),
      "host delete cascaded",
    );
    ck(
      l.inspect().issues.some((x) => x.message.includes("引用缺失")),
      "orphan report",
    );
    a.undo();
    // Trusted recipe pair capture + actual parameter rebuild updates depth anchor only when enabled.
    a._suspendUndo = true;
    a._quietAdd = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.followTerrain = false;
    host = a.addAsset("cn:streetshop:街市铺面", [0, 0, 0], {
      params: { d: 8 },
    });
    part = a.addAsset("showcase:shoplights:古城暖窗格栅", [0, 0, 4.07]);
    host.params.sceneKit = {
      id: "river-frontage",
      instance: "fixture-kit",
      role: "host",
    };
    part.params.sceneKit = {
      id: "river-frontage",
      instance: "fixture-kit",
      role: "attachment",
    };
    l.captureKits([host, part]);
    ck(
      part.params.sceneAttachment?.hostId === host.id,
      "trusted kit stable ID",
    );
    const partId = part.id,
      hostId = host.id,
      oldZ = part.root.position.z;
    a._quietAdd = false;
    a._suspendUndo = false;
    l.setFollow(part.id, true);
    before = snapshot();
    a.beginOp("change host depth", "", true);
    host.params.d = 10;
    a.rebuildObject(host);
    ck(
      Math.abs(a.byId(partId).root.position.z - oldZ - 1) < 1e-6,
      "depth parameter auto link",
    );
    a.undo();
    ck(snapshot() === before, "rebuild undo");
    saved = copy(a.serialize({ assets: false }));
    a.loadJson(saved);
    ck(a.byId(partId).params.sceneAttachment.follow, "follow persisted");
    window.layoutFixture = { hostId, partId };
    return {
      readOnlyInspection: true,
      staleOnEdit: true,
      defaultFollowOff: true,
      manualSyncUndoRedo: true,
      gizmoAutoOneUndo: true,
      loadDoesNotAutoRepair: true,
      lockedChildRefused: true,
      partialFailureRollback: true,
      duplicateUnlinked: true,
      AIConstraintPersistence: true,
      AINotAutoRig: true,
      orphanDiagnostic: true,
      trustedKitCaptured: true,
      parameterRebuildLink: true,
    };
  });
  console.log("PASS layout core", core);
  await page.click('[data-page="scene"]');
  await page.$eval("[data-layout-maintenance]", (e) => (e.open = true));
  await page.click('[data-layout-action="inspect"]');
  assert(
    await page.$eval("[data-layout-status]", (e) =>
      e.textContent.includes("当前检查"),
    ),
  );
  // Actual transform panel setter includes auto children in the original host edit undo.
  await page.evaluate(() => {
    app.select({ kind: "obj", so: app.byId(layoutFixture.hostId) });
  });
  await page.waitForFunction(() => document.querySelector(".ibody .v3g input"));
  const before = await page.evaluate(() =>
    JSON.stringify(app.serialize({ assets: false })),
  );
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".ibody .row")].find(
      (r) => r.querySelector(".lab")?.textContent === "位置 m",
    );
    const input = row.querySelector("input");
    input.value = "12";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(
    await page.evaluate(
      () => app.byId(layoutFixture.partId).root.position.x === 12,
    ),
  );
  assert(
    await page.$eval("[data-layout-status]", (e) =>
      e.textContent.includes("已过期"),
    ),
  );
  await page.evaluate(() => app.undo());
  assert.equal(
    await page.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
    before,
  );
  await page.evaluate(() =>
    app.select({ kind: "obj", so: app.byId(layoutFixture.partId) }),
  );
  // Toggle, detach, and bind through the real collapsed controls.
  await page.$eval(
    "[data-layout-follow]",
    (e) => (e.closest("details").open = true),
  );
  assert(await page.$eval("[data-layout-follow]", (e) => e.checked));
  await page.click("[data-layout-follow]");
  assert(
    await page.evaluate(
      () => !app.byId(layoutFixture.partId).params.sceneAttachment.follow,
    ),
  );
  await page.click('[data-layout-action="detach"]');
  assert(
    await page.evaluate(
      () => !app.byId(layoutFixture.partId).params.sceneAttachment,
    ),
  );
  await page.select(
    "[data-layout-host]",
    await page.evaluate(() => layoutFixture.hostId),
  );
  await page.click('[data-layout-action="bind"]');
  assert(
    await page.evaluate(
      () =>
        app.byId(layoutFixture.partId).params.sceneAttachment.hostId ===
        layoutFixture.hostId,
    ),
  );
  await page.click('[data-layout-action="inspect"]');
  await page.screenshot({
    path:
      ".shots/layout-maintenance-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".png",
  });
  assert.deepEqual(errors, []);
  const result = {
    mode: process.env.TEST_FILE_URL ? "file-offline" : "dev",
    ...core,
    actualPanelAutoLink: true,
    UIBindDetachFollow: true,
    errors,
  };
  writeFileSync(
    ".shots/layout-maintenance-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".json",
    JSON.stringify(result, null, 2),
  );
  console.log("PASS layout maintenance browser", result);
} finally {
  await browser.close();
}
