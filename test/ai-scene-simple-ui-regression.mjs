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
  const p = await browser.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("dialog", (d) => d.accept());
  await p.setViewport({ width: 1440, height: 980 });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.__previzBooted && window.app?.aiScene, {
    timeout: 90000,
  });
  await p.evaluate(() => {
    app.suspended = true;
    app._quietAdd = true;
    app.clearAll();
    app.terrain.setEnabled(false);
    app.addAsset("env:crate:木箱", [0, 0, 0]);
  });
  await p.click('[data-page="scene"]');
  await p.click("[data-ai-scene-open]");
  await p.waitForSelector("[data-ai-scene-dialog]");
  assert(
    await p.$eval(
      "[data-ai-scene-blueprint]",
      (e) => !e.getClientRects().length,
    ),
    "JSON is not shown by default",
  );
  assert(
    await p.$eval(
      '[data-ai-scene-source="local"]',
      (e) => e.getAttribute("aria-selected") === "true",
    ),
  );
  assert(await p.$eval('[data-ai-scene-action="apply"]', (e) => e.disabled));
  assert(
    await p.$eval(
      ".ai-scene-setup",
      (e) =>
        ![...e.querySelectorAll("details")].some(
          (d) => d.open && d.getClientRects().length,
        ),
    ),
    "advanced controls folded",
  );
  const fit = () =>
    p.evaluate(() => {
      const d = document
          .querySelector(".ai-scene-dialog")
          .getBoundingClientRect(),
        f = document.querySelector(".ai-scene-footer").getBoundingClientRect();
      return (
        d.left >= 0 &&
        d.right <= innerWidth &&
        d.top >= 0 &&
        d.bottom <= innerHeight &&
        f.bottom <= innerHeight &&
        document.querySelector(".ai-scene-dialog").scrollWidth <= d.width + 1
      );
    });
  assert(await fit());
  await p.screenshot({ path: ".shots/ai-scene-simple-empty.png" });
  const before = await p.evaluate(() =>
    JSON.stringify(app.serialize({ assets: false })),
  );
  await p.click('[data-ai-scene-action="prepare"]');
  await p.waitForSelector(".ai-scene-canvas canvas", { timeout: 120000 });
  await p.waitForFunction(
    () => !document.querySelector('[data-ai-scene-action="prepare"]').disabled,
  );
  assert.equal(
    await p.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
    before,
    "one-click local preview leaves project untouched",
  );
  assert(
    await p.$eval("[data-ai-scene-diff]", (e) => !e.closest("details").open),
    "diff folded",
  );
  await p.screenshot({ path: ".shots/ai-scene-simple-candidate.png" });
  await p.click('[data-ai-scene-action="top"]');
  await p.click('[data-ai-scene-action="perspective"]');
  // Review a guaranteed overlapping candidate to verify warning acknowledgement cannot be bypassed.
  await p.click('[data-ai-scene-source="manual"]');
  await p.$eval("[data-ai-scene-blueprint]", (e) => {
    const plan = JSON.parse(e.value);
    delete plan.recipe;
    plan.id = "simple-ui-warning";
    plan.operations = [
      {
        op: "add",
        id: "simple-ui-crate",
        key: "env:crate:木箱",
        pos: [0, 0, 0],
      },
    ];
    e.value = JSON.stringify(plan);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await p.click('[data-ai-scene-action="prepare"]');
  await p.waitForFunction(
    () =>
      app.aiScene.draft?.plan.id === "simple-ui-warning" && !app.aiScene.busy,
  );
  assert(
    await p.$eval(
      ".ai-scene-warning-box",
      (e) => !e.hidden && e.textContent.includes("重叠"),
    ),
  );
  assert(await p.$eval('[data-ai-scene-action="apply"]', (e) => e.disabled));
  await p.click(".ai-scene-warning-box summary");
  await p.click('[data-ai-scene-setting="acceptWarnings"]');
  assert(await p.$eval('[data-ai-scene-action="apply"]', (e) => !e.disabled));
  await p.$eval('[data-ai-scene-setting="size"]', (e) => {
    e.value = "200";
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(
    await p.$eval('[data-ai-scene-action="apply"]', (e) => e.disabled),
    "changed settings invalidate candidate",
  );
  await p.$eval('[data-ai-scene-setting="size"]', (e) => {
    e.value = "192";
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await p.click('[data-ai-scene-action="prepare"]');
  await p.waitForFunction(
    () =>
      !app.aiScene.busy &&
      !document.querySelector('[data-ai-scene-action="prepare"]').disabled,
  );
  await p.click('[data-ai-scene-setting="acceptWarnings"]');
  await p.click('[data-ai-scene-action="apply"]');
  await p.waitForFunction(
    () => app.byId("simple-ui-crate") && !app.aiScene.busy,
  );
  assert(
    await p.$eval(
      ".ai-scene-empty",
      (e) => !e.hidden && e.textContent.includes("已应用"),
    ),
  );
  assert(
    await p.evaluate(
      () =>
        app.undo() &&
        !app.byId("simple-ui-crate") &&
        app.redo() &&
        !!app.byId("simple-ui-crate"),
    ),
  );
  await p.click('[data-ai-scene-action="close"]');
  assert(
    await p.evaluate(
      () =>
        !document.getElementById("app").inert &&
        document.activeElement.matches("[data-ai-scene-open]"),
    ),
  );
  await p.click("[data-ai-scene-open]");
  await p.select('[data-ai-scene-setting="mode"]', "replace");
  assert(
    await p.$eval(
      ".ai-scene-danger",
      (e) => !e.hidden && !e.querySelector("input").checked,
    ),
    "replacement authorization stays explicit",
  );
  await p.select('[data-ai-scene-setting="mode"]', "add");
  await p.focus('[data-ai-scene-source="local"]');
  await p.keyboard.press("ArrowRight");
  assert(
    await p.$eval(
      '[data-ai-scene-source="manual"]',
      (e) => e.getAttribute("aria-selected") === "true",
    ),
    "keyboard source switch",
  );
  for (const [width, height] of [
    [800, 600],
    [390, 720],
  ]) {
    await p.setViewport({ width, height });
    assert(await fit(), "responsive footer and width");
  }
  await p.screenshot({ path: ".shots/ai-scene-simple-mobile.png" });
  await p.focus('[data-ai-scene-action="apply"]'); // Disabled buttons cannot take focus; explicitly focus the last available control.
  await p.evaluate(() => {
    const nodes = [
      ...document
        .querySelector("[data-ai-scene-dialog]")
        .querySelectorAll("button,input,select,textarea,summary"),
    ].filter((e) => !e.disabled && e.getClientRects().length);
    nodes.at(-1).focus();
  });
  await p.keyboard.press("Tab");
  assert(
    await p.evaluate(() =>
      document
        .querySelector("[data-ai-scene-dialog]")
        .contains(document.activeElement),
    ),
  );
  await p.keyboard.press("Escape");
  assert(
    await p.evaluate(
      () =>
        !document.querySelector("[data-ai-scene-dialog]") &&
        !document.getElementById("app").inert,
    ),
  );
  assert.deepEqual(errors, []);
  const mode = process.env.TEST_FILE_URL ? "file" : "dev";
  const result = {
    mode,
    defaultJSONHidden: true,
    oneClickLocalPreview: true,
    sourceUnchanged: true,
    advancedFolded: true,
    warningsGateApply: true,
    staleCandidateDisabled: true,
    explicitReplacePermission: true,
    applyUndoRedo: true,
    keyboardAndFocus: true,
    responsiveViewports: ["1440x980", "800x600", "390x720"],
    errors,
  };
  writeFileSync(
    `.shots/ai-scene-simple-${mode}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log("PASS simplified AI builder", result);
} finally {
  await browser.close();
}
