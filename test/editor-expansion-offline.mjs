// Compiled, truly offline HTML: no development-module imports or mocked asset builds.
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
try {
  const page = await browser.newPage(),
    errors = [],
    outbound = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) outbound.push(r.url());
  });
  await page.setOfflineMode(true);
  await page.goto(pathToFileURL(resolve("previz-lab.html")).href + "?fresh=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.aiScene,
    { timeout: 90000 },
  );
  const result = await page.evaluate(async () => {
    app.suspended = true;
    app.state.playing = false;
    app.clearAll();
    app.terrain.setEnabled(false);
    const workflow = app.aiScene,
      permissions = { mode: "add", preserveTerrain: true },
      context = await workflow.context(permissions);
    const envelope = (c, mode, operations) => ({
      schema: "previz-ai-scene/1",
      id: "offline-expansion",
      name: "offline expansion",
      baseFingerprint: c.baseFingerprint,
      mode,
      bounds: c.bounds,
      seed: 1,
      terrain: "preserve",
      durationSeconds: c.durationSeconds,
      operations,
    });
    const base = app._undo?.length || 0;
    await workflow.prepare(
      envelope(context, "add", [
        {
          op: "add",
          id: "rough",
          key: "generated:ai_primitive:AI组合粗模",
          pos: [-15, 0, -15],
          params: {
            parts: [
              {
                shape: "box",
                size: [1, 2, 1],
                pos: [0, 1, 0],
                color: "#4080a0",
              },
              {
                shape: "cone",
                size: [1.5, 1, 1.5],
                pos: [0, 2.5, 0],
                color: "#e0b060",
              },
            ],
          },
        },
        {
          op: "add",
          id: "car",
          key: context.catalog.find((a) => a.key.startsWith("env:car:")).key,
          pos: [0, 0, 0],
        },
      ]),
      permissions,
    );
    await workflow.apply({ acceptWarnings: true });
    const rough = app.objects.find((o) => o.root.userData.primitiveModel),
      car = app.objects.find((o) => o.type === "car");
    if (!rough || !car || app._undo.length !== base + 1)
      throw Error("compiled rough asset/atomic add failed");
    const stored = await app.modelLibrary.savePrimitive(rough);
    await app.modelLibrary.place(
      stored,
      new rough.root.position.constructor(30, 0, 30),
    );
    if (app.objects.length !== 3)
      throw Error("offline primitive store/place failed");
    app.undo();
    const directing = {
      mode: "edit",
      conversational: true,
      preserveTerrain: true,
      editableIds: [car.id],
      conversationDirecting: {
        motions: [
          {
            objectId: car.id,
            points: [
              [0, 0, 0, 0],
              [app.state.duration, 20, 0, 10],
            ],
          },
        ],
        camera: { objectId: car.id, preset: "follow" },
        environment: { lighting: "golden", weather: "rain" },
      },
    };
    const ctx = await workflow.context(directing),
      undo = app._undo.length;
    await workflow.prepare(envelope(ctx, "edit", []), directing);
    await workflow.apply({ acceptWarnings: true });
    const vehicle = app.byId(car.id);
    app.suspended = false;
    app.state.time = app.state.duration * 0.4;
    app.tick();
    app.suspended = true;
    const V = vehicle.root.position.constructor,
      front = new V(1, 0, 0).applyQuaternion(vehicle.root.quaternion);
    if (front.dot(new V(20, 0, 10).normalize()) < 0.999)
      throw Error("compiled vehicle front-axis mismatch");
    if (
      !vehicle.motion.active ||
      !app.shots.some((s) => s.targetId === car.id) ||
      app.weather.type !== "rain" ||
      app.lighting.preset !== "golden" ||
      app._undo.length !== undo + 1
    )
      throw Error("compiled directing failed");
    app.undo();
    if (app.byId(car.id).motion.active) throw Error("directing undo failed");
    app.redo();
    if (!app.byId(car.id).motion.active) throw Error("directing redo failed");
    return {
      platform: "Linux Chromium, compiled file:// HTML, network disabled",
      primitive: true,
      libraryRoundtrip: true,
      directing: true,
      actualVehicleHeading: true,
      oneUndoRedo: true,
      realGGUF: false,
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  fs.mkdirSync(".shots", { recursive: true });
  fs.writeFileSync(
    ".shots/editor-expansion-offline.json",
    JSON.stringify({ ...result, errors, outbound }, null, 2),
  );
  console.log("PASS offline editor expansion", result);
} finally {
  await browser.close();
}
