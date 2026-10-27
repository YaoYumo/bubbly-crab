import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__sliderCSP = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      __sliderCSP.push(e.effectiveDirective),
    );
  });
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL ||
      process.env.TEST_URL ||
      "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.aiScene,
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    app.suspended = true;
    app.state.playing = false;
    app.clearAll();
    app.terrain.setEnabled(false);
  });
  const cap = (label) =>
    page.evaluate(
      (label) =>
        [...document.querySelectorAll("#top .cap")]
          .find((n) => n.textContent.trim() === label)
          .click(),
      label,
    );
  const tab = (host, label) =>
    page.evaluate(
      ({ host, label }) =>
        [...document.querySelectorAll(host + " .itab")]
          .find((n) => n.textContent === label)
          .click(),
      { host, label },
    );
  const read = (kind, key) =>
    page.evaluate(
      ({ kind, key }) => {
        if (kind === "motion") return app.byId(window.__sliderObject).motion[key];
      if (kind === "param")
          return app.byId(window.__sliderObject).params[key];
        if (kind === "terrain") return app.terrain[key];
        if (kind === "terrain-state") return app.terrain.state[key];
        if (kind === "light") return app.lighting.p[key];
        if (kind === "sky") return app.lighting.physical.settings[key];
        if (kind === "bloom") return app.renderEffects.bloom[key];
        if (kind === "camera") return app.activeShot[key];
        if (kind === "move") return app.activeShot.moveParams[key];
      },
      { kind, key },
    );
  const cases = [];
  async function drag(
    selector,
    kind,
    key,
    { commit = false, notify = null } = {},
  ) {
    const element = await page.$(selector);
    assert.ok(element, selector);
    await element.evaluate((n) => {
      const pane = n.closest(".terrain-pane");
      if (pane?.hidden)
        n.closest(".terrain-organized")
          .querySelector(`[data-terrain-tab="${pane.dataset.terrainPane}"]`)
          .click();
      for (let i = 0; i < 8; i++) {
        const section = n.closest(".sec.closed");
        if (!section) break;
        section.querySelector(".sec-h").click();
      }
      n.scrollIntoView({ block: "center" });
    });
    const geometry = await element.evaluate((n) => {
      const r = n.getBoundingClientRect(),
        min = +n.min,
        max = +n.max;
      return { x: r.x, y: r.y, w: r.width, h: r.height, min, max, v: +n.value };
    });
    if (!(geometry.w > 25 && geometry.h > 0))
      console.log(
        "HIDDEN RANGE",
        await element.evaluate((n) => {
          const out = [];
          for (let x = n; x; x = x.parentElement)
            out.push([
              x.tagName,
              x.className,
              x.id,
              getComputedStyle(x).display,
            ]);
          return out;
        }),
      );
    assert.ok(geometry.w > 25 && geometry.h > 0, selector + " must be visible");
    const { x, y, w, h, min, max, v } = geometry,
      px = (ratio) => x + 8 + (w - 16) * ratio;
    await element.evaluate((n) => {
      window.__dragNode = n;
      window.__rangeValues = [];
      n.addEventListener("input", () => __rangeValues.push(+n.value));
    });
    const original = await read(kind, key);
    await page.mouse.move(px((v - min) / (max - min)), y + h / 2);
    await page.mouse.down();
    await page.mouse.move(px(0.32), y + h / 2, { steps: 5 });
    await page.evaluate(async (notify) => {
      if (notify) app.bus.emit(notify);
      app.bus.emit("tick");
      await new Promise((resolve) => setTimeout(resolve, 240));
      app.bus.emit("tick");
    }, notify);
    assert.equal(
      await element.evaluate((n) => n.isConnected),
      true,
      selector + " detached mid-drag",
    );
    const first = await element.evaluate((n) => +n.value);
    if (commit)
      assert.equal(
        await read(kind, key),
        original,
        selector + " committed before release",
      );
    else
      assert.ok(
        Math.abs((await read(kind, key)) - first) < 1e-5,
        selector + " live data not applied",
      );
    await page.mouse.move(px(0.78), y + h / 2, { steps: 7 });
    await page.evaluate(async (notify) => {
      if (notify) app.bus.emit(notify);
      app.bus.emit("tick");
      await new Promise((resolve) => setTimeout(resolve, 240));
      app.bus.emit("tick");
    }, notify);
    assert.equal(
      await element.evaluate((n) => n.isConnected),
      true,
      selector + " detached after second move",
    );
    const final = await element.evaluate((n) => +n.value);
    assert.notEqual(final, first, selector + " stopped responding");
    const pair = await element.evaluate(
      (n) => n.closest(".rg")?.querySelector("input[type=number]")?.value,
    );
    if (pair !== undefined)
      assert.equal(+pair, final, selector + " paired readout reset while held");
    await page.mouse.up();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 220)),
    );
    const source = await read(kind, key);
    assert.ok(Math.abs(source - final) < 1e-5, selector + " final value lost");
    const current = await page.$eval(selector, (n) => +n.value);
    assert.equal(current, final, selector + " replacement reset the thumb");
    const inputs = await page.evaluate(() => __rangeValues.length);
    assert.ok(inputs >= 2, selector + " did not receive continuous inputs");
    cases.push({
      kind,
      key,
      inputs,
      first,
      final,
      commitOnly: commit,
      heldAcrossRebuildDelay: true,
    });
  }
  await cap("Scene");
  const keys = await page.evaluate(async () => {
    const c = await app.aiScene.context({ mode: "add" }),
      key = c.catalog.find((a) => a.key.startsWith("bld:wall:")).key;
    const so = app.addAsset(key);
    app.select({ kind: "obj", so });
    window.__sliderObject = so.id;
    return so.item.params
      .filter((p) => ["range", "int"].includes(p.t))
      .slice(0, 3)
      .map((p) => p.k);
  });
  assert.equal(
    keys.length,
    3,
    "fixture must include three real rebuild parameters",
  );
  for (const key of keys)
    await drag(
      `#inspector-scene [data-field="${key}"] input[type=range]`,
      "param",
      key,
    );
  // Cancellation/focus-loss must flush the queued form and allow the next drag.
  for (const termination of ["pointercancel", "lostpointercapture", "blur"]) {
    const selector = `#inspector-scene [data-field="${keys[0]}"] input[type=range]`,
      handle = await page.$(selector);
    const r = await handle.evaluate((n) => {
      n.scrollIntoView({ block: "center" });
      const r = n.getBoundingClientRect();
      window.__cancelRange = n;
      n.addEventListener(
        "pointerdown",
        (e) => (window.__cancelPointer = e.pointerId),
        { once: true },
      );
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        min: +n.min,
        max: +n.max,
        value: +n.value,
      };
    });
    await page.mouse.move(
      r.x + 8 + ((r.w - 16) * (r.value - r.min)) / (r.max - r.min),
      r.y + r.h / 2,
    );
    await page.mouse.down();
    await page.mouse.move(r.x + r.w * 0.42, r.y + r.h / 2, { steps: 4 });
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    );
    assert.equal(await handle.evaluate((n) => n.isConnected), true);
    await page.evaluate((termination) => {
      if (termination === "blur") window.dispatchEvent(new Event("blur"));
      else
        __cancelRange.dispatchEvent(
          new PointerEvent(termination, {
            pointerId: __cancelPointer,
            bubbles: true,
          }),
        );
    }, termination);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 30)),
    );
    await page.mouse.up();
    await drag(selector, "param", keys[0]);
  }
  await page.evaluate(async () => {
    const c = await app.aiScene.context({mode:'add'});
    const so = app.addAsset(c.catalog.find(a => a.key.startsWith('char:human:')).key);
    window.__sliderObject=so.id;app.select({kind:'obj',so});
  });
  await drag('#inspector-scene [data-field=speed] input[type=range]','motion','speed');
  // A programmatic notification while a drag is paused must not replace its control either.
  await page.evaluate(() => app.terrain.setEnabled(true));
  await tab("#inspector-scene", "地形");
  await drag(
    "#inspector-scene [data-field=exag] input[type=range]",
    "terrain",
    "exaggerate",
  );
  await drag(
    "#inspector-scene [data-terrain-radius]",
    "terrain-state",
    "brushSize",
    { notify: "terrain-workflow" },
  );
  await drag(
    "#inspector-scene [data-field=waterY] input[type=range]",
    "terrain-state",
    "waterY",
    { commit: true },
  );
  await page.evaluate(() => {
    app.lighting.setMode("legacy");
    app.bus.emit("perf-changed");
  });
  await tab("#inspector-scene", "光影");
  await drag(
    "#inspector-scene [data-field=sunInt] input[type=range]",
    "light",
    "sunInt",
    { notify: "perf-changed" },
  );
  await drag(
    '#inspector-scene [data-render-setting="bloom.strength"]',
    "bloom",
    "strength",
    { commit: true, notify: "perf-changed" },
  );
  await page.evaluate(() => {
    app.lighting.setMode("physical");
    app.bus.emit("perf-changed");
  });
  await drag(
    "#inspector-scene [data-physical-sky] [data-field=ev] input[type=range]",
    "sky",
    "ev",
    { commit: true },
  );
  await page.evaluate(() => {
    const s = app.addShot({ name: "Slider camera" });
    app.setActiveShot(s);
    app.select({ kind: "shot", shot: s });
  });
  await cap("Direct");
  await tab("#inspector", "运镜");
  await drag(
    "#inspector [data-field=focal] input[type=range]",
    "camera",
    "focal",
  );
  await drag(
    "#inspector [data-field=duration] input[type=range]",
    "camera",
    "duration",
  );
  await cap("Camera");
  await page.evaluate(() => {
    app.activeShot.generateMove("orbit");
    app.bus.emit("shots");
  });
  const key = await page.$eval(
    "#inspector-camera input[type=range]",
    (n) => n.dataset.moveParam,
  );
  await drag(`#inspector-camera [data-move-param="${key}"]`, "move", key, {
    notify: "shots",
  });
  // Keyboard repeat is also a continuous gesture; a panel event must not lose focus.
  await cap("Direct");
  await tab("#inspector", "运镜");
  const selector = "#inspector [data-field=focal] input[type=range]";
  await page.$eval(selector, (n) => {
    n.scrollIntoView({ block: "center" });
    n.focus();
    window.__keyRange = n;
  });
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => app.bus.emit("shot-change"));
  assert.equal(
    await page.evaluate(
      () => __keyRange.isConnected && document.activeElement === __keyRange,
    ),
    true,
  );
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.equal(
    await page.$eval(selector, (n) => +n.value),
    await read("camera", "focal"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => __sliderCSP), []);
  const mode = process.env.TEST_FILE_URL
    ? "file"
    : process.env.TEST_URL
      ? "desktop-csp"
      : "web";
  fs.mkdirSync(".shots", { recursive: true });
  fs.writeFileSync(
    `.shots/range-drag-${mode}.json`,
    JSON.stringify(
      {
        platform: "Linux Chromium, not native Windows",
        cases,
        keyboardRepeatAndFocus: true,
        cancelLostCaptureBlurRecovery: true,
        errors,
        csp: await page.evaluate(() => __sliderCSP),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS range dragging",
    mode,
    cases.length,
    "real mouse drags: model/terrain/brush/water/light/Bloom/physical sky/lens/duration/camera move, paused across rebuilds, paired readouts, final values and held keyboard",
  );
} finally {
  await browser.close();
}
