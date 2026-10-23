import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import puppeteer from "puppeteer";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [],
  results = [];
let injected = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !(injected && m.text().startsWith("[towngen]")))
      errors.push(m.text());
  });
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(() => window.__previzBooted && window.app, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    app.suspended = true;
    app._quietAdd = true;
  });
  const open = async (text) => {
    await page.click('.viewport-create');
    await page.waitForSelector(".tg-mask.on");
    await page.click(".tg-advanced > summary");
    await page.$eval(
      ".tg-input",
      (e, text) => {
        e.value = text;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      },
      text,
    );
  };
  const generate = async () => {
    await page.click(".tg-foot .tg-btn.pri");
    await page.waitForFunction(() => !document.querySelector(".tg-mask"), {
      timeout: 120000,
    });
  };
  for (const [kind, text] of [
    [
      "cyber-rain",
      "赛博都市，30层高楼，8辆悬浮车，20位行人，大雾下雨，夜景，种子82",
    ],
    [
      "lantern-river",
      "中式古城沿河两岸，河宽16米，石拱桥，中轴道路，牌楼跨街，佛塔，120盏孔明灯，28位行人，夜景，种子42",
    ],
  ]) {
    const before = await page.evaluate(() =>
      JSON.stringify(app.serialize({ assets: false })),
    );
    await open(text);
    await page.click(".tg-recipe-panel>.tg-btn");
    await page.waitForSelector(".tg-plan svg");
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(app.serialize({ assets: false })),
      ),
      before,
      "plan preview does not mutate source",
    );
    if (kind === "cyber-rain")
      await page.screenshot({ path: ".shots/recipe-plan.png" });
    await generate();
    const result = await page.evaluate((kind) => {
      const a = app,
        ck = (x, msg) => {
          if (!x) throw Error(msg);
        };
      ck(a.sceneGeneration.kind === kind, "recipe metadata");
      ck(!a.sceneReport.missing && !a.sceneReport.targetMiss, "missing assets");
      ck(
        a.objects.some((o) => o.params.sceneKit?.role === "attachment"),
        "editable/persistent kit parts",
      );
      const parts = a.objects.filter(
        (o) => o.params.sceneKit?.role === "attachment",
      );
      ck(
        parts.every(
          (o) =>
            o.params.sceneAttachment?.hostId &&
            a.byId(o.params.sceneAttachment.hostId),
        ),
        "stable kit links",
      );
      ck(
        parts.every((o) => o.params.sceneAttachment.follow === false),
        "kit follow opt-in",
      );
      const layoutReport = a.layout.inspect();
      ck(
        !layoutReport.issues.some((i) => i.code.startsWith("attachment-")),
        "fresh kit alignment",
      );
      ck(
        a.state.time === 0 && !a.state.playing && !a.state.preview,
        "clean opening",
      );
      if (kind === "cyber-rain") {
        ck(
          a.objects.filter((o) => o.type === "skycar").length === 8,
          "car count",
        );
        ck(a.objects.filter((o) => o.isChar).length === 20, "people count");
        ck(
          a.weather.type === "rain" && a.lighting.p.fogDens === 0.017,
          "rain and fog",
        );
        ck(a.stage.view.position.y < 2, "street opening");
      } else {
        ck(a.terrain.workflow.rivers[0].width === 16, "requested river width");
        ck(a.objects.filter((o) => o.isChar).length === 28, "total walkers");
        ck(
          a.objects
            .filter((o) => o.type === "lanterns")
            .reduce((n, o) => n + o.params.count, 0) === 120,
          "lantern count",
        );
        ck(
          a.objects.filter((o) => o.type === "road_brush").length === 4,
          "bank and split axis roads",
        );
        const bridge = a.objects.find((o) => o.type === "archbridge");
        ck(bridge.params.span === 26, "bridge follows river width");
      }
      const saved = JSON.parse(JSON.stringify(a.serialize()));
      a.loadJson(saved);
      ck(
        JSON.stringify(a.sceneGeneration) === JSON.stringify(saved.generation),
        "saved recipe/seed",
      );
      ck(
        a.objects.filter((o) => o.params.sceneKit).length ===
          saved.objects.filter((o) => o.params?.sceneKit).length,
        "saved assemblies",
      );
      const ids = a.objects
        .filter((o) => o.type !== "road_intersection")
        .map((o) => o.id)
        .sort()
        .join();
      ck(a.undo(), "one undo");
      ck(a.redo(), "redo");
      ck(
        a.objects
          .filter((o) => o.type !== "road_intersection")
          .map((o) => o.id)
          .sort()
          .join() === ids,
        "redo stable IDs",
      );
      a.step(0, true);
      a.weather.update(0, a.stage.view.position);
      a.stage.render();
      return {
        kind,
        models: a.sceneReport.models,
        objects: a.objects.length,
        options: a.sceneGeneration.options,
        undoRedo: true,
        roundtrip: true,
      };
    }, kind);
    const zip = new Uint8Array(
      await page.evaluate(async () => Array.from(await app.saveProject())),
    );
    const archived = JSON.parse(strFromU8(unzipSync(zip)["project.json"]));
    assert.equal(archived.generation.kind, kind);
    assert(archived.objects.some((o) => o.params?.sceneKit));
    await page.screenshot({ path: ".shots/recipe-" + kind + ".png" });
    results.push(result);
  }
  // Manual controls override text, including explicit actor removal and daylight.
  await open("赛博都市，白天，晴天无雾，无车，无人，鸟瞰，种子123");
  await page.$eval(".tg-recipe-panel details", (e) => (e.open = true));
  await page.$eval('[data-recipe-param="cars"]', (e) => {
    e.value = "2";
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await generate();
  assert(
    await page.evaluate(
      () =>
        app.objects.filter((o) => o.type === "skycar").length === 2 &&
        app.objects.filter((o) => o.isChar).length === 0 &&
        app.weather.type === null &&
        app.lighting.p.fogDens === 0 &&
        app.lighting.preset === "noon" &&
        app.sceneGeneration.options.opening === "overview",
    ),
  );
  // Cancellation during the queued frame must not replace the source.
  const unchanged = await page.evaluate(() =>
    JSON.stringify(app.serialize({ assets: false })),
  );
  await open("赛博都市，种子9");
  await page.evaluate(() => {
    document.querySelector(".tg-foot .tg-btn.pri").click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await page.waitForFunction(() => !document.querySelector(".tg-mask"));
  assert.equal(
    await page.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
    unchanged,
  );
  // Inject a mid-build failure. Project, generation metadata and history must roll back.
  await open("中式古城沿河，种子9");
  await page.evaluate(() => {
    window.__recipeBefore = JSON.stringify(app.serialize({ assets: false }));
    window.__recipeUndo = (app._undo || []).length;
    const old = app.addAsset.bind(app);
    let n = 0;
    app.__recipeAdd = old;
    app.addAsset = (...args) => {
      if (++n === 6) throw Error("injected recipe failure");
      return old(...args);
    };
  });
  injected = true;
  await page.click(".tg-foot .tg-btn.pri");
  await page.waitForFunction(
    () => !document.querySelector(".tg-foot .tg-btn.pri").disabled,
    { timeout: 120000 },
  );
  assert(
    await page.evaluate(
      () =>
        JSON.stringify(app.serialize({ assets: false })) ===
          window.__recipeBefore &&
        (app._undo || []).length === window.__recipeUndo &&
        !app.sceneRecipeBusy,
    ),
  );
  injected = false;
  await page.evaluate(() => {
    app.addAsset = app.__recipeAdd;
    delete app.__recipeAdd;
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".tg-mask"));
  // Legacy route is still available, rather than hijacking every modern/chinese prompt.
  await open("棋盘格的现代住宅区，192米，稀疏，商业20%，种子77");
  assert(
    await page.$eval(".tg-recipe-panel", (e) => e.style.display === "none"),
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  const mode = process.env.TEST_FILE_URL ? "file" : "dev";
  writeFileSync(
    `.shots/scene-recipes-${mode}.json`,
    JSON.stringify(
      {
        mode,
        results,
        previewPure: true,
        manualOverrides: true,
        cancelledQueue: true,
        injectedRollback: true,
        legacyRouting: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS local recipe UI",
    mode,
    JSON.stringify(results),
    "preview pure; portable archive; overrides; cancel; injected rollback; legacy routing",
  );
} finally {
  await browser.close();
}
