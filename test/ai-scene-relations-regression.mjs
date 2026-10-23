import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
try {
  const page = await browser.newPage(),
    errors = [];
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.aiScene,
    { timeout: 90000 },
  );
  const core = await page.evaluate(async () => {
    const a = app,
      w = a.aiScene;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    const host = a.addAsset("env:crate:木箱", [0, 0, 0]);
    host.locked = true;
    const editable = a.addAsset("env:crate:木箱", [-30, 0, -30]);
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    const snapshot = () =>
      JSON.stringify(a.serialize({ assets: false }), (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
            )
          : v,
      );
    const before = snapshot();
    const perms = {
      mode: "add",
      bounds: { center: [0, 0], size: [192, 192] },
      editableIds: [],
      preserveTerrain: true,
    };
    const ctx = await w.context(perms);
    if (
      !ctx.blueprintContract.relations ||
      !ctx.blueprintJSONSchema.properties.relations
    )
      throw Error("relations not advertised");
    const template = {
      schema: "previz-ai-scene/1",
      id: "relation-browser",
      name: "Relation browser fixture",
      baseFingerprint: ctx.baseFingerprint,
      mode: "add",
      bounds: perms.bounds,
      seed: 1,
      terrain: "preserve",
      durationSeconds: a.state.duration,
      operations: [
        {
          op: "add",
          id: "relation-child",
          key: "env:crate:木箱",
          pos: [0, 0, 0],
        },
      ],
      relations: {
        version: 1,
        rules: [
          {
            type: "offset",
            subject: "relation-child",
            reference: host.id,
            delta: [10, 0, 0],
            frame: "world",
          },
          { type: "face", subject: "relation-child", target: host.id },
          {
            type: "distance",
            subject: "relation-child",
            target: host.id,
            min: 10,
            max: 10,
          },
          {
            type: "keep-out",
            subject: "relation-child",
            obstacle: host.id,
            margin: 2,
          },
        ],
      },
    };
    const d = await w.prepare(template, perms);
    const child = d.document.objects.find((o) => o.id === "relation-child");
    if (
      child.pos[0] !== 10 ||
      child.rot[1] !== -Math.PI / 2 ||
      d.roots.get(child.id).position.x !== 10
    )
      throw Error("wrong lowered candidate");
    if (snapshot() !== before || a._undo.length)
      throw Error("prepare modified source");
    if (d.changes.relations.length !== 4) throw Error("relation audit missing");
    const failures = [];
    async function reject(label, mutate, permissions = perms) {
      const p = structuredClone(template);
      mutate(p);
      try {
        await w.prepare(p, permissions);
      } catch (e) {
        if (snapshot() !== before || a._undo.length || w.busy)
          throw Error("failed candidate corrupted source");
        failures.push({ label, error: e.message });
        return;
      }
      throw Error("unexpectedly accepted " + label);
    }
    await reject(
      "locked subject",
      (p) =>
        (p.relations.rules = [
          { type: "face", subject: host.id, target: editable.id },
        ]),
    );
    await reject(
      "unselected edit subject",
      (p) => {
        p.mode = "edit";
        p.operations = [
          { op: "transform", objectId: editable.id, pos: [-28, 0, -28] },
        ];
        p.relations.rules = [
          {
            type: "offset",
            subject: host.id,
            reference: editable.id,
            delta: [4, 0, 0],
            frame: "world",
          },
        ];
      },
      { ...perms, mode: "edit", editableIds: [editable.id] },
    );
    await reject("clearance", (p) => (p.relations.rules[3].margin = 20));
    await reject("distance", (p) => {
      p.relations.rules[2].min = 0;
      p.relations.rules[2].max = 9;
    });
    await reject("footprint outside bounds", (p) => {
      p.relations.rules = [
        {
          type: "offset",
          subject: "relation-child",
          reference: host.id,
          delta: [96, 0, 0],
          frame: "world",
        },
      ];
    });
    await reject(
      "protected geometry collision",
      (p) =>
        (p.relations.rules = [
          {
            type: "offset",
            subject: "relation-child",
            reference: host.id,
            delta: [0.1, 0, 0],
            frame: "world",
          },
        ]),
    );
    await reject(
      "missing reference",
      (p) => (p.relations.rules[0].reference = "missing"),
    );
    await reject(
      "removed reference",
      (p) => {
        p.mode = "edit";
        p.operations = [{ op: "remove", objectId: editable.id }];
        p.relations.rules = [
          {
            type: "distance",
            subject: host.id,
            target: editable.id,
            min: 0,
            max: 100,
          },
        ];
      },
      { ...perms, mode: "edit", editableIds: [editable.id] },
    );
    await w.prepare(template, perms);
    await w.apply({ acceptWarnings: true });
    if (
      a.byId("relation-child").root.position.x !== 10 ||
      a.byId(host.id).root.position.x !== 0 ||
      !a.byId(host.id).locked
    )
      throw Error("apply wrong");
    if (w.lastApplied.plan.relations.rules.length !== 4)
      throw Error("application audit missing relations");
    a.undo();
    if (snapshot() !== before) throw Error("undo did not restore original");
    // An editable object without its own explicit op is lowered into an authorized transform.
    const editPerms = { ...perms, mode: "edit", editableIds: [editable.id] };
    const ep = {
      ...structuredClone(template),
      mode: "edit",
      baseFingerprint: (await w.context(editPerms)).baseFingerprint,
      operations: [
        { op: "transform", objectId: editable.id, pos: [-30, 0, -30] },
      ],
      relations: {
        version: 1,
        rules: [
          {
            type: "offset",
            subject: editable.id,
            reference: host.id,
            delta: [12, 0, 0],
            frame: "world",
          },
          { type: "face", subject: editable.id, target: host.id },
        ],
      },
    };
    const ed = await w.prepare(ep, editPerms);
    if (ed.document.objects.find((o) => o.id === editable.id).pos[0] !== 12)
      throw Error("edit relation lowering wrong");
    await w.apply({ acceptWarnings: true });
    if (a.byId(editable.id).root.position.x !== 12) throw Error("edit apply");
    a.undo();
    if (snapshot() !== before) throw Error("edit undo");
    w.discard();
    a._suspendUndo = true;
    a.clearAll();
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    return {
      noSourceMutation: true,
      placeholderLoweredBeforeCollision: true,
      finalGeometryChecks: true,
      lockedReferenceReadOnly: true,
      applyAndUndo: true,
      editApplyAndUndo: true,
      relationAudit: true,
      rejections: failures,
    };
  });
  console.log("PASS relation workflow core", core);
  // Exercise the actual offline sample UI, confirmation gate, and difference list.
  await page.click('[data-page="scene"]');
  await page.click("[data-ai-scene-open]");
  await page.waitForSelector("[data-ai-scene-dialog]");
  await page.click('[data-ai-scene-source="manual"]');
  await page.$eval(
    '[data-ai-scene-action="relation-example"]',
    (e) => (e.closest("details").open = true),
  );
  const before = await page.evaluate(() =>
    JSON.stringify(app.serialize({ assets: false })),
  );
  await page.click('[data-ai-scene-action="relation-example"]');
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ai-scene-blueprint]")
      .value.includes('"relations"'),
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
    before,
  );
  await page.click('[data-ai-scene-action="prepare"]');
  await page.waitForFunction(
    () =>
      app.aiScene.draft?.changes.relations?.length === 4 && !app.aiScene.busy,
    { timeout: 90000 },
  );
  assert(
    await page.$eval('[data-ai-scene-action="apply"]', (e) => e.disabled),
    "relation warning requires confirmation",
  );
  assert(
    await page.$eval("[data-ai-scene-dialog]", (e) =>
      e.textContent.includes("空间关系 · 相对偏移"),
    ),
  );
  await page.$eval(".ai-scene-warning-box", (e) => (e.open = true));
  await page.click('[data-ai-scene-setting="acceptWarnings"]');
  assert(
    await page.$eval('[data-ai-scene-action="apply"]', (e) => !e.disabled),
  );
  await page.screenshot({
    path:
      ".shots/ai-scene-relations-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".png",
  });
  await page.click('[data-ai-scene-action="apply"]');
  await page.waitForFunction(
    () => app.objects.length === 2 && !app.aiScene.busy,
    { timeout: 90000 },
  );
  assert(
    await page.evaluate(
      () =>
        Math.abs(
          app.objects[0].root.position.x - app.objects[1].root.position.x,
        ) === 4,
    ),
  );
  await page.evaluate(() => app.undo());
  assert.equal(await page.evaluate(() => app.objects.length), 0);
  assert.deepEqual(errors, []);
  const result = {
    mode: process.env.TEST_FILE_URL ? "file-offline" : "dev",
    ...core,
    offlineExampleUI: true,
    confirmationGate: true,
    errors,
  };
  writeFileSync(
    ".shots/ai-scene-relations-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".json",
    JSON.stringify(result, null, 2),
  );
  console.log("PASS AI relations browser", result);
} finally {
  await browser.close();
}
