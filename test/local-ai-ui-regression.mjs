import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".shots", { recursive: true });
const b = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
try {
  const p = await b.newPage(),
    errors = [];
  let capabilities = 0,
    jobs = 0,
    files = 0;
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.setViewport({ width: 1440, height: 1000 });
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes("/local-ai/") && !u.pathname.startsWith("/src/"))
      files++;
    if (u.pathname === "/api/ai-scenes/capabilities") {
      capabilities++;
      return r.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          configured: false,
          requiresAuth: true,
          model: "",
          output: "previz-ai-scene/1",
          provider: "local",
          localModel: {
            runtime: "ollama",
            enabled: false,
            status: "not-ready",
            modelFilePresent: null,
            inferenceVerified: false,
          },
        }),
      });
    }
    if (u.pathname === "/api/ai-scenes/jobs") jobs++;
    return r.continue();
  });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || "http://localhost:5174/", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.__previzBooted && window.app?.aiScene, {
    timeout: 90000,
  });
  await p.evaluate(() => {
    app.suspended = true;
  });
  await p.click('[data-page="scene"]');
  await p.click("[data-ai-scene-open]");
  assert.equal(capabilities, 0);
  assert.equal(jobs, 0);
  const before = await p.evaluate(() =>
    JSON.stringify(app.serialize({ assets: false })),
  );
  await p.click('[data-ai-scene-source="api"]');
  assert(await p.$eval("[data-ai-scene-local-help]", (e) => !e.open));
  await p.click("[data-ai-scene-local-help]>summary");
  assert(
    (
      await p.$eval("[data-ai-scene-local-help]", (e) => e.textContent)
    ).includes("local-ai/models"),
  );
  assert(
    (
      await p.$eval("[data-ai-scene-local-help]", (e) => e.textContent)
    ).includes("npm run local-ai:init"),
  );
  assert.equal(capabilities, 0, "help must not probe or download anything");
  await p.click('[data-ai-scene-action="discover"]');
  if (process.env.TEST_FILE_URL) {
    await p.waitForFunction(() =>
      document
        .querySelector(".ai-scene-status")
        .textContent.includes("file离线版"),
    );
    assert.equal(capabilities, 0);
  } else {
    await p.waitForFunction(() =>
      document
        .querySelector("[data-ai-scene-dialog]")
        .textContent.includes("本地模型接口 · 未就绪"),
    );
    assert.equal(capabilities, 1);
  }
  await p.$eval("[data-ai-scene-prompt]", (e) => {
    e.value = "Do not invoke an unconfigured model";
  });
  await p.click('[data-ai-scene-action="submit"]');
  await p.waitForFunction(() =>
    document
      .querySelector(".ai-scene-status")
      .textContent.includes("请先检查已配置"),
  );
  assert.equal(jobs, 0);
  assert.equal(
    files,
    0,
    "browser must not read machine configuration or weights",
  );
  assert.equal(
    await p.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
    before,
  );
  await p.screenshot({
    path:
      ".shots/local-ai-help-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".png",
  });
  await p.click('[data-ai-scene-action="close"]');
  assert.deepEqual(errors, []);
  const mode = process.env.TEST_FILE_URL ? "file" : "dev",
    result = {
      mode,
      helpCollapsed: true,
      zeroAutomaticRequests: true,
      noWeightOrConfigRequests: true,
      disabledProfileCannotSubmit: true,
      offlineGuard: !!process.env.TEST_FILE_URL,
      sourceUnchanged: true,
      errors,
    };
  writeFileSync(
    `.shots/local-ai-ui-${mode}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log("PASS local AI reserved UI", result);
} finally {
  await b.close();
}
