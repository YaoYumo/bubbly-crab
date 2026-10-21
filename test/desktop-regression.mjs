import {inspectDesktopVisuals,desktopVisualFailures} from './desktop-visual-checks.mjs';
// Linux Chromium + mock native IPC. This does NOT validate Windows/WebView2,
// actual filesystem permissions, OS dialogs, NSIS or installed runtime behavior.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
const report = {
  platform: "Linux Chromium (NOT Windows native)",
  nativeValidated: false,
};
try {
  const page = await browser.newPage(),
    errors = [],
    violations = [],
    outbound = [];
  page.on("console", (m) => {
    if (m.type() === "error") console.log("BROWSER ERROR:", m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://localhost:5181/")
    )
      outbound.push(r.url());
    if (r.url().includes("/api/")) outbound.push(r.url());
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      __csp.push({ directive: e.violatedDirective, blocked: e.blockedURI }),
    );
  });
  await page.goto("http://localhost:5181/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.exporter,
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    app.suspended = true;
    app.state.playing = false;
  });
  assert.equal(
    await page.$eval("[data-desktop-tools]", (n) => n.textContent),
    "桌面检查",
  );
  report.visuals = await inspectDesktopVisuals(page);
  assert.deepEqual(desktopVisualFailures(report.visuals), []);
  await page.click("[data-desktop-tools]");
  report.browserPreflight = await page.$eval(
    "[data-desktop-capabilities]",
    (n) => JSON.parse(n.textContent),
  );
  assert.equal(report.browserPreflight.nativeShell, false);
  assert.equal(report.browserPreflight.webgl, true);
  await page.click("[data-desktop-probe]");
  await page.waitForFunction(() =>
    document
      .querySelector("[data-desktop-probe-status]")
      .textContent.includes("通过"),
  );
  await page.click("[data-desktop-save-test]");
  assert.match(
    await page.$eval("[data-desktop-probe-status]", (n) => n.textContent),
    /不能验收原生/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.$("[data-desktop-panel]"), null);
  await page.evaluate(() => {
    window.__anchorDownloads = 0;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) __anchorDownloads++;
      return click.call(this);
    };
    [...document.querySelectorAll("button.dd-item")]
      .find((n) => n.textContent.includes("保存工程"))
      .click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-desktop-save-status]")?.dataset.state ===
      "error",
  );
  assert.equal(
    await page.evaluate(() => __anchorDownloads),
    0,
    "missing bridge must not silently fall back to browser download",
  );
  assert.match(
    await page.$eval("[data-desktop-save-status]", (n) => n.textContent),
    /无法原生保存/,
  );
  report.browserPreflightRefusesNativeSave = true;
  // A second page boots with the real JS plugin implementations against a fake
  // native command transport. This catches SDK argument/return mismatches only.
  await page.evaluateOnNewDocument(() => {
    const state = (window.__mockNative = {
      commands: [],
      files: {},
      handles: {},
      callbacks: {},
      next: 1,
      mode: "save",
      closeHandler: null,
      destroyed: 0,
    });
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback) {
        const id = state.next++;
        state.callbacks[id] = callback;
        return id;
      },
      async invoke(cmd, args) {
        state.commands.push(cmd);
        if (cmd === "plugin:event|listen") {
          if (args.event === "tauri://close-requested")
            state.closeHandler = state.callbacks[args.handler];
          return state.next++;
        }
        if (cmd === "plugin:event|unlisten") return;
        if (cmd === "plugin:window|destroy") {
          state.destroyed++;
          return;
        }
        if (cmd === "plugin:dialog|save") {
          if (state.mode === "cancel") return null;
          if (state.mode === "gate")
            await new Promise((r) => (state.release = r));
          return "C:\\chosen\\" + args.options.defaultPath;
        }
        if (cmd === "plugin:fs|create") {
          const id = state.next++;
          state.handles[id] = args.path;
          state.files[args.path] = [];
          return id;
        }
        if (cmd === "plugin:fs|write") {
          if (state.mode === "disk-full") throw Error("simulated disk full");
          const n = Math.min(args.data.length, 65536);
          state.files[state.handles[args.rid]].push(
            ...Array.from(args.data.subarray(0, n)),
          );
          return n;
        }
        if (cmd === "plugin:resources|close") {
          delete state.handles[args.rid];
          return;
        }
        throw Error("Unexpected IPC " + cmd);
      },
    };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__previzBooted && window.__mockNative?.closeHandler,
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    app.suspended = true;
    app.state.playing = false;
  });
  await page.click("[data-desktop-tools]");
  const nativeCaps = await page.$eval("[data-desktop-capabilities]", (n) =>
    JSON.parse(n.textContent),
  );
  assert.equal(nativeCaps.nativeShell, true);
  assert.match(nativeCaps.closeGuard, /已注册/);
  await page.click("[data-desktop-save-test]");
  await page.waitForFunction(() =>
    document
      .querySelector("[data-desktop-probe-status]")
      .textContent.includes("已写入磁盘"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(
          new TextDecoder().decode(
            new Uint8Array(Object.values(__mockNative.files)[0]),
          ),
        ).nativeShell,
    ),
    true,
  );
  await page.evaluate(() => (__mockNative.mode = "cancel"));
  await page.click("[data-desktop-save-test]");
  await page.waitForFunction(() =>
    document
      .querySelector("[data-desktop-probe-status]")
      .textContent.includes("已取消保存"),
  );
  await page.evaluate(() => (__mockNative.mode = "gate"));
  await page.click("[data-desktop-save-test]");
  await page.waitForFunction(() => typeof __mockNative.release === "function");
  await page.evaluate(async () => {
    await __mockNative.closeHandler({
      event: "tauri://close-requested",
      payload: null,
      id: 1,
    });
  });
  assert.equal(
    await page.evaluate(() => __mockNative.destroyed),
    0,
    "pending save must prevent native destroy",
  );
  await page.evaluate(() => {
    __mockNative.mode = "save";
    __mockNative.release();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-desktop-probe-status]")
      .textContent.includes("已写入磁盘"),
  );
  await page.keyboard.press("Escape");
  report.project = await page.evaluate(async () => {
    const a = app,
      ck = (v, m) => {
        if (!v)
          throw Error(
            m +
              " · " +
              JSON.stringify({
                csp: window.__csp,
                toasts: window.__testToasts,
              }),
          );
      };
    window.__testToasts = [];
    a.bus.on("toast", (e) => __testToasts.push(e.msg));
    a.suspended = true;
    a.state.playing = false;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.followTerrain = false;
    a.addAsset("env:crate:木箱", [0, 0, 0]);
    a.addAsset("char:human:男性", [-2, 0, 0]);
    a.addShot({ duration: 1 });
    a.state.duration = 1;
    a.state.time = 0.25;
    a.activeShot.handheld = 0;
    a.lighting.physical.configure({ shadows: false, fog: 0 });
    const geometry = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    const gltf = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
              material: 0,
            },
          ],
        },
      ],
      buffers: [{ uri: "triangle.bin", byteLength: geometry.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 24 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
      ],
      images: [{ uri: "tex.png" }],
      textures: [{ source: 0 }],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            metallicFactor: 0,
            roughnessFactor: 1,
          },
        },
      ],
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e96080";
    ctx.fillRect(0, 0, 2, 2);
    const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const imported = await a.importFiles(
      [
        new File([JSON.stringify(gltf)], "triangle.gltf"),
        new File([geometry], "triangle.bin"),
        new File([png], "tex.png"),
      ],
      [2, 0, 0],
    );
    ck(imported.length === 1, "gltf + local BIN/PNG import under desktop CSP");
    const id = imported[0].id,
      name = imported[0].name,
      before = JSON.stringify(a.serialize({ assets: false }));
    const archive = new Blob([await a.saveProject()], {
      type: "application/zip",
    });
    ck(archive.size > 100, "project ZIP nonempty");
    const restored = await a.importFiles([
      new File([archive], "desktop-check.previz"),
    ]);
    ck(restored.projectLoaded, "project package reopened");
    await a.projectAssets.ready();
    ck(
      a.objects.length === 3 &&
        a.byId(id)?.name === name &&
        a.shots.length === 1,
      "objects/imported asset/shot round trip",
    );
    const asset = a.byId(id),
      texts = [];
    asset.root.traverse((n) => {
      if (n.isMesh && n.material?.map) texts.push(n.material.map.image?.width);
    });
    ck(
      texts.some((w) => w === 2),
      "embedded texture restored",
    );
    // Some loading-only metadata is normalized on reopen; transforms/IDs/material
    // resources and counts above are the assertions, not byte-identical metadata.
    a.state.time = 0.25;
    a.step(0, true);
    const snapshot = JSON.stringify(a.serialize({ assets: false })),
      suspended = a.suspended;
    const still = await a.exporter.still({ width: 320, height: 180 });
    ck(still.size > 0, "PNG export");
    ck(
      JSON.stringify(a.serialize({ assets: false })) === snapshot &&
        a.suspended === suspended,
      "PNG authored state restored",
    );
    const video = await a.exporter.run({
      width: 320,
      height: 180,
      fps: 2,
      duration: 1,
    });
    ck(
      video.size > 0 &&
        video.frames === 2 &&
        video.mode === "webcodecs" &&
        video.diskSave === "saved",
      "2-frame WebM encode + mocked save",
    );
    ck(
      JSON.stringify(a.serialize({ assets: false })) === snapshot &&
        a.suspended === suspended &&
        !a.stage.exporting &&
        !a.stage.exportOwner,
      "video state restored before disk dialog",
    );
    const key = Object.keys(__mockNative.files).find((p) =>
        p.endsWith(".webm"),
      ),
      bytes = __mockNative.files[key];
    ck(
      bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes.length === video.blob.size,
      "exact WebM bytes delivered through real SDK chunk writer",
    );
    __mockNative.mode = "disk-full";
    const failed = await a.exporter.run({
      width: 320,
      height: 180,
      fps: 2,
      duration: 1,
    });
    ck(
      failed.blob.size > 0 &&
        failed.diskSave === "error" &&
        a.exporter.last === failed,
      "failed disk save preserves encoded video for retry",
    );
    ck(
      Object.keys(__mockNative.handles).length === 0,
      "failed write handle closed",
    );
    __mockNative.mode = "cancel";
    const cancelled = await a.exporter.run({
      width: 320,
      height: 180,
      fps: 2,
      duration: 1,
    });
    ck(
      cancelled.blob.size > 0 && cancelled.diskSave === "cancelled",
      "cancel disk save preserves export",
    );
    __mockNative.mode = "save";
    return {
      objects: a.objects.length,
      shots: a.shots.length,
      projectBytes: archive.size,
      localGltfBinTextureImport: true,
      textureRestored: true,
      pngBytes: still.size,
      webmBytes: video.size,
      frames: video.frames,
      videoStateRestored: true,
      mockDiskFailurePreservesVideo: true,
      mockCancelPreservesVideo: true,
      handlesClosed: true,
    };
  });
  // Real project menu: no success toast until the native writer has closed.
  await page.evaluate(() => {
    __mockNative.mode = "gate";
    __mockNative.release = null;
    app.projectName = "desktop-roundtrip";
    [...document.querySelectorAll("button.dd-item")]
      .find((n) => n.textContent.includes("保存工程"))
      .click();
  });
  await page.waitForFunction(() => typeof __mockNative.release === "function");
  assert.equal(
    await page.evaluate(() =>
      [...document.querySelectorAll(".toast")].some((n) =>
        n.textContent.includes("已保存完整工程包"),
      ),
    ),
    false,
  );
  await page.evaluate(() => {
    __mockNative.mode = "save";
    __mockNative.release();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".toast")].some((n) =>
      n.textContent.includes("已保存完整工程包"),
    ),
  );
  report.projectMenuUsesNativeWriter = await page.evaluate(() => {
    const b = __mockNative.files["C:\\chosen\\desktop-roundtrip.previz"];
    return (
      b?.[0] === 0x50 &&
      b?.[1] === 0x4b &&
      Object.keys(__mockNative.handles).length === 0
    );
  });
  assert.equal(report.projectMenuUsesNativeWriter, true);
  // Main Export page, not just the old inspector: native cancel stops a batch,
  // retains the video, and exposes an explicit retry without another encoding.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((n) => n.textContent.includes("Export"))
      .click();
    const original = app.exporter.run.bind(app.exporter);
    window.__encodeCount = 0;
    window.__restoreRun = () => (app.exporter.run = original);
    app.exporter.run = (opts, progress) => {
      __encodeCount++;
      return original(
        { ...opts, width: 320, height: 180, fps: 2, duration: 1 },
        progress,
      );
    };
    const buttons = [...document.querySelectorAll("#page-export button")];
    const add = buttons.find((n) =>
      n.textContent.includes("添加当前设置到队列"),
    );
    add.click();
    add.click();
    __mockNative.mode = "cancel";
    buttons.find((n) => n.textContent.includes("开始批量渲染")).click();
  });
  await page.waitForFunction(
    () => {
      const button = [...document.querySelectorAll("#page-export button")].find(
        (n) => n.textContent.includes("开始批量渲染"),
      );
      return (
        button &&
        !button.disabled &&
        __encodeCount === 1 &&
        document.querySelector("#page-export .exp-queue-item .status")
          ?.textContent === "已取消"
      );
    },
    { timeout: 90000 },
  );
  assert.equal(
    await page.$$eval("#page-export .exp-queue-item .status", (nodes) =>
      nodes.map((n) => n.textContent).join(","),
    ),
    "已取消,等待中",
  );
  await page.evaluate(() => {
    __mockNative.mode = "save";
    document.querySelector("#page-export [data-export-save-again]").click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-desktop-save-status]")?.dataset.state ===
        "saved" &&
      !document.querySelector("#page-export [data-export-save-again]").disabled,
  );
  assert.equal(
    await page.evaluate(() => __encodeCount),
    1,
    "retry must reuse the completed video Blob",
  );
  await page.evaluate(() => __restoreRun());
  report.exportPageNativeCancelStopsBatchAndRetryReusesBlob = true;
  // Actual UI-driven gateway check: it must reject BEFORE fetch, even offline.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((n) =>
      n.textContent.includes("Generate"),
    );
    if (!b) throw Error("Generate nav missing");
    b.click();
  });
  await page.waitForSelector('[data-reference-action="gateway-discover"]');
  await page.evaluate(() => {
    document.querySelector(".reference-gateway").open = true;
    document
      .querySelector('[data-reference-action="gateway-discover"]')
      .click();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-reference-review]")
      .textContent.includes("轻量桌面版未内置"),
  );
  assert.equal(
    await page.$(".reference-legacy"),
    null,
    "desktop hides legacy key entry",
  );
  await page.setOfflineMode(true);
  await page.evaluate(() =>
    document
      .querySelector('[data-reference-action="gateway-discover"]')
      .click(),
  );
  await page.waitForFunction(() =>
    document
      .querySelector("[data-reference-review]")
      .textContent.includes("轻量桌面版未内置"),
  );
  report.gatewayBlockedBeforeFetch = true;
  const offline = await page.evaluate(async () => {
    const a = app;
    const result = await a.exporter.run({
      width: 320,
      height: 180,
      fps: 2,
      duration: 1,
    });
    return {
      bytes: result.size,
      frames: result.frames,
      saved: result.diskSave,
    };
  });
  assert.ok(offline.bytes > 0);
  assert.equal(offline.saved, "saved");
  report.offlineFrontendExport = offline;
  await page.setOfflineMode(false);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((n) => n.textContent.includes("Scene"))
      .click(),
  );
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
  ]) {
    await page.setViewport({ width, height });
    await page.click("[data-desktop-tools]");
    const rect = await page.$eval("[data-desktop-panel] section", (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    });
    assert.ok(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.right <= width + 1 &&
        rect.bottom <= height + 1,
      "desktop modal fits minimum viewport",
    );
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: ".shots/desktop-frontend-preflight.png" });
  await page.evaluate(async () => {
    await __mockNative.closeHandler({
      event: "tauri://close-requested",
      payload: null,
      id: 2,
    });
  });
  assert.equal(
    await page.evaluate(() => __mockNative.destroyed),
    1,
    "idle close forwarded to native destroy",
  );
  violations.push(...(await page.evaluate(() => window.__csp)));
  assert.deepEqual(violations, []);
  assert.deepEqual(outbound, []);
  assert.deepEqual(errors, []);
  report.errors = errors;
  report.cspViolations = violations;
  report.outboundRequests = outbound;
  report.nativeIPC =
    "mock only: dialog/create/partial-write/close, cancel/error, close guard";
  report.status = "PASS";
  mkdirSync(".shots", { recursive: true });
  writeFileSync(
    ".shots/desktop-regression.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
