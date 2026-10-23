import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || "http://localhost:5174/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.behaviors,
    { timeout: 90000 },
  );
  const core = await page.evaluate(async () => {
    const a = app,
      w = a.behaviors,
      ck = (v, m) => {
        if (!v) throw Error(m);
      },
      copy = (v) => JSON.parse(JSON.stringify(v));
    const canonical = (v) =>
      JSON.stringify(v, (_k, x) =>
        x && typeof x === "object" && !Array.isArray(x)
          ? Object.fromEntries(
              Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
            )
          : x,
      );
    const snapshot = () => canonical(a.serialize({ assets: false }));
    const runtime = () =>
      canonical(
        a.objects
          .filter((o) => o.isChar)
          .map((o) => {
            const nodes = [];
            o.root.traverse((n) =>
              nodes.push([
                n.position.toArray(),
                n.rotation.toArray(),
                n.scale.toArray(),
              ]),
            );
            return [
              o.id,
              nodes,
              o.root.userData.animPhase,
              o.root.userData.humans.map((h) => ({
                ph: h.ph,
                anim: h.anim,
                dist: h.dist,
                w: h.w,
              })),
            ];
          }),
      );
    const fails = async (fn, text) => {
      let e;
      try {
        await fn();
      } catch (x) {
        e = x;
      }
      ck(
        e && (!text || e.message.includes(text)),
        "expected failure " + text + " got " + e?.message,
      );
    };
    a.suspended = true;
    a.state.playing = false;
    a.state.time = 0;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.followTerrain = false;
    const actor = a.addAsset("char:human:男性", [0, 0, 0]),
      crate = a.addAsset("env:crate:木箱", [3, 0, 0]);
    ck(actor && crate, "fixtures");
    const id = actor.id,
      cid = crate.id;
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    a._undoBytes = 0;
    a.state.duration = 5;
    const request = {
      radius: 0.5,
      height: 2.5,
      cellSize: 0.5,
      margin: 6,
      steps: [
        { type: "move", target: [6, 0], seconds: 3, anim: "walk" },
        { type: "act", seconds: 2, anim: "wave", face: [10, 0] },
        { type: "move", target: [6, 5], seconds: 3, anim: "run" },
      ],
    };
    let before = snapshot(),
      rt = runtime(),
      count = a._undo.length;
    let d = await w.preview(id, request);
    ck(
      snapshot() === before && runtime() === rt && a._undo.length === count,
      "preview mutation",
    );
    ck(
      d.program.clips[0].points.length > 2 && d.coverage.obstacles === 1,
      "detour",
    );
    ck(Object.isFrozen(d.program.clips[0].points[0]), "immutable candidate");
    await fails(() => w.apply(), "确认");
    await fails(() => w.apply({ confirmedWarnings: true }), "时长");
    ck(snapshot() === before, "rejected apply mutation");
    crate.root.position.x += 0.1;
    await fails(
      () => w.apply({ confirmedWarnings: true, extendDuration: true }),
      "过期",
    );
    crate.root.position.x -= 0.1;
    d = await w.preview(id, request);
    const issued = w.draft;
    w.draft = copy(d);
    await fails(
      () => w.apply({ confirmedWarnings: true, extendDuration: true }),
      "候选无效",
    );
    w.draft = issued;
    const push = a.pushUndo;
    a.pushUndo = () => {};
    await fails(
      () => w.apply({ confirmedWarnings: true, extendDuration: true }),
      "撤销",
    );
    a.pushUndo = push;
    ck(
      snapshot() === before && runtime() === rt && a._undo.length === count,
      "failed snapshot rollback",
    );
    a.pushUndo = function (...args) {
      push.apply(this, args);
      throw Error("injected post-append");
    };
    await fails(
      () => w.apply({ confirmedWarnings: true, extendDuration: true }),
      "post-append",
    );
    a.pushUndo = push;
    ck(
      snapshot() === before && runtime() === rt && a._undo.length === count,
      "post-append rollback",
    );
    const set = a.setMotion;
    a.setMotion = function (...args) {
      set.apply(this, args);
      throw Error("injected partial motion");
    };
    await fails(
      () => w.apply({ confirmedWarnings: true, extendDuration: true }),
      "partial motion",
    );
    a.setMotion = set;
    ck(
      snapshot() === before && runtime() === rt && a._undo.length === count,
      "partial motion rollback",
    );
    await w.apply({ confirmedWarnings: true, extendDuration: true });
    ck(
      a.state.duration === 8 && a._undo.length === count + 1,
      "single undo apply / duration",
    );
    ck(
      !actor.motion.mover &&
        actor._mgroup.children.every((n) => !n.userData.keyRef),
      "no Catmull or editable markers",
    );
    ck(!a.stage.tc.object, "no transform gizmo");
    let current = a.byId(id);
    a.state.time = 4;
    a.step(0.123, true);
    ck(current.root.userData.humans[0].anim === "wave", "action switch");
    ck(
      current.root.position.x === 6 && current.root.position.z === 0,
      "stop position",
    );
    const pose = runtime();
    a.step(0.71, true);
    ck(runtime() === pose, "paused absolute pose");
    a.state.time = 1.25;
    a.step(0.1, true);
    const sought = runtime();
    a.state.time = 7.8;
    a.step(0.91, true);
    a.state.time = 1.25;
    a.step(0.001, true);
    ck(runtime() === sought, "seek / dt independence");
    a.state.time = 8;
    a.step(0, true);
    const end = runtime();
    a.state.time = 80;
    a.step(0, true);
    ck(runtime() === end, "end hold");
    a.state.time = 0;
    a.step(0, true);
    const beginning = runtime();
    a.state.loop = true;
    a.state.playing = true;
    a.state.time = 7.9;
    a.step(0.1, true);
    a.state.playing = false;
    ck(Math.abs(a.state.time) < 1e-8 && runtime() === beginning, "global loop");
    before = snapshot();
    a.addObjectKey(current);
    a.removeObjectKey(current, 0);
    a.clearMotion(current);
    ck(snapshot() === before, "key editing guard");
    await fails(() => a.setMotion(current, { keys: [] }), "预演");
    await fails(() => current.setParams({ height: 2 }), "移除");
    let saved = copy(a.serialize({ assets: false }));
    a.loadJson(saved);
    current = a.byId(id);
    a.state.time = 0;
    a.step(0, true);
    ck(!current.motion.mover && current.motion.behavior, "program load");
    ck(
      canonical(current.motion.behavior) ===
        canonical(saved.objects.find((o) => o.id === id).motion.behavior),
      "plan roundtrip",
    );
    a.undo();
    ck(
      !a.byId(id).motion.behavior && a.state.duration === 5,
      "undo program/duration",
    );
    a.redo();
    ck(
      a.byId(id).motion.behavior && a.state.duration === 8,
      "redo program/duration",
    );
    a.state.time = 0;
    a.step(0, true);
    a.select({ kind: "obj", so: a.byId(id) });
    const dup = a.duplicateSelected();
    ck(
      !dup.motion.behavior && !dup.motion.active && !dup.motion.keys.length,
      "duplicate must not snap to source route",
    );
    a.removeObject(dup);
    a.state.time = 0;
    before = snapshot();
    rt = runtime();
    count = a._undo.length;
    w.remove(id, { confirmed: true });
    ck(
      !a.byId(id).motion.behavior && a._undo.length === count + 1,
      "remove undo",
    );
    a.undo();
    ck(a.byId(id).motion.behavior, "undo removal");
    a.state.time = 0;
    a.step(0, true);
    const valid = copy(a.serialize({ assets: false }));
    let corrupt = copy(valid);
    corrupt.objects.find(
      (o) => o.id === id,
    ).motion.behavior.clips[0].points[0][1] = 9;
    a.loadJson(corrupt);
    ck(
      !a.byId(id).motion.active &&
        a.byId(id).motion.behaviorError &&
        !a.byId(id).motion.mover,
      "malformed save fail closed",
    );
    a.loadJson(valid);
    current = a.byId(id);
    a.state.time = 0;
    a.step(0, true);
    a.terrain.setEnabled(true);
    await fails(() => w.preview(id, request), "关闭地形");
    a.terrain.setEnabled(false);
    current.locked = true;
    await fails(() => w.preview(id, request), "未锁定");
    current.locked = false;
    a.state.time = 1;
    await fails(() => w.preview(id, request), "0秒");
    a.state.time = 0;
    for (const [object, key, value] of [
      [a.state, "playing", true],
      [a.exporter, "running", true],
      [a.aiScene, "busy", true],
      [a.reference, "busy", true],
      [a.terrain.workflow, "erosionPreview", {}],
    ]) {
      const old = object[key];
      object[key] = value;
      await fails(() => w.preview(id, request));
      object[key] = old;
    }
    w.busy = true;
    await fails(() => a.aiScene.checkIdle());
    await fails(() => a.layout.assertIdle());
    ck((await a.exporter.run({ duration: 0.1 })) === null, "export interlock");
    w.busy = false;
    // Static snapshot refuses unknown objects instead of silently pretending complete coverage.
    const oldkey = a.byId(cid).key;
    a.byId(cid).key = null;
    await fails(() => w.preview(id, request), "未知");
    a.byId(cid).key = oldkey;
    const pending = w.preview(id, request);
    const originalName = a.byId(cid).name;
    a.byId(cid).name += " changed during hash";
    await fails(() => pending, "变化");
    a.byId(cid).name = originalName;
    ck(!w.draft, "failed fresh preview retained old draft");
    const other = a.addAsset("char:human:女性", [-12, 0, 0]),
      fx = a.addAsset("fx:glow:地面光斑", [0, 0, 0]),
      overhead = a.addAsset("env:crate:木箱", [0, 6, 0], {
        keepY: true,
        authored: true,
      });
    const coverageDraft = await w.preview(id, request);
    ck(
      coverageDraft.coverage.dynamic === 1 &&
        coverageDraft.coverage.effects === 1 &&
        coverageDraft.coverage.aboveBelow === 1,
      "coverage categories",
    );
    w.discard();
    for (const o of [other, fx, overhead]) a.removeObject(o);
    const scaleBefore = a.byId(cid).root.scale.clone();
    a.byId(cid).root.scale.x = 0;
    await fails(() => w.preview(id, request), "不可逆");
    a.byId(cid).root.scale.copy(scaleBefore);
    const planeSave = copy(a.serialize({ assets: false }));
    a.terrain.setEnabled(true);
    a.step(0, true);
    ck(
      !a.byId(id).motion.active &&
        a.byId(id).motion.behaviorError?.includes("地形"),
      "enabled terrain fails closed at runtime",
    );
    a.loadJson(planeSave);
    // Legacy motion still uses the old Mover and phase path.
    const legacy = a.addAsset("env:crate:木箱", [-10, 0, -10]);
    a.setMotion(legacy, {
      active: true,
      keys: [
        { t: 0, p: [-10, 0, -10] },
        { t: 1, p: [-5, 0, -10] },
      ],
    });
    ck(legacy.motion.mover, "legacy mover");
    const legacyExpected = legacy.motion.mover.sample(0.5).p.toArray();
    a.state.time = 4;
    a.step(0, true);
    ck(
      legacy.root.position
        .toArray()
        .every((v, i) => Math.abs(v - legacyExpected[i]) < 1e-6),
      "legacy timeline",
    );
    a.removeObject(legacy);
    // PNG snapshots must restore actual source pose, phase, root transform and project time.
    a.state.time = 4;
    a.step(0, true);
    rt = runtime();
    before = snapshot();
    const png = await a.exporter.still({ width: 320, height: 180 });
    ck(png?.size > 0, "PNG");
    ck(
      snapshot() === before && runtime() === rt && a.state.time === 4,
      "PNG runtime restore",
    );
    const snap = a.exporter.snapshot();
    a.state.time = 7;
    a.step(0.5, true);
    a.exporter.restore(snap);
    ck(runtime() === rt && a.state.time === 4, "multi-frame restore");
    const pngMethod = a.stage.renderer.domElement.toBlob;
    a.stage.renderer.domElement.toBlob = () => {
      throw Error("injected png failure");
    };
    try {
      await a.exporter.still({ width: 320, height: 180 });
    } catch {
    } finally {
      a.stage.renderer.domElement.toBlob = pngMethod;
    }
    ck(snapshot() === before && runtime() === rt, "failed PNG restore");
    // Actual fixed-timestamp video and reference package, not just a mocked restore.
    a.stage.view.position.set(12, 7, 13);
    a.stage.view.lookAt(3, 1, 2);
    a.shotFromView();
    a.activeShot.aim = "none";
    a.activeShot.duration = 8;
    a.activeShot.handheld = 0;
    a.lighting.physical.configure({ shadows: false, fog: 0 });
    a.state.time = 4;
    a.step(0, true);
    before = snapshot();
    rt = runtime();
    const seen = [];
    const video = await a.exporter.run(
      { width: 320, height: 180, fps: 4, duration: 8 },
      (e) => {
        if (e.phase !== "render") return;
        const c = a.byId(id),
          t = a.state.time,
          anim = c.root.userData.humans[0].anim;
        ck(
          anim === (t < 3 ? "walk" : t < 5 ? "wave" : "run"),
          "video action at " + t,
        );
        if (t >= 3 && t < 5)
          ck(
            c.root.position.x === 6 &&
              c.root.position.z === 0 &&
              Math.abs(c.root.userData.animPhase - (t - 3) * 2) < 1e-8,
            "video stationary phase",
          );
        seen.push({ t, anim });
      },
    );
    ck(
      video?.size > 0 &&
        video.mode === "webcodecs" &&
        video.frames === 32 &&
        seen.length === 32,
      "actual video encoding " + JSON.stringify(video),
    );
    ck(
      snapshot() === before && runtime() === rt && a.state.time === 4,
      "video source restore",
    );
    const cancelled = await a.exporter.run(
      { width: 320, height: 180, fps: 4, duration: 8 },
      (e) => {
        if (e.phase === "render" && e.i === 2) a.exporter.cancel();
      },
    );
    ck(
      cancelled.cancelled &&
        !a.exporter.running &&
        !a.stage.exportOwner &&
        snapshot() === before &&
        runtime() === rt,
      "cancelled video restore",
    );
    const oldStep = a.step;
    a.step = () => {
      throw Error("injected video failure");
    };
    const failed = await a.exporter.run({
      width: 320,
      height: 180,
      fps: 4,
      duration: 8,
    });
    a.step = oldStep;
    ck(
      failed.error?.includes("injected") &&
        !a.exporter.running &&
        !a.stage.exportOwner &&
        snapshot() === before &&
        runtime() === rt,
      "failed video restore",
    );
    const referenceInput = {
      width: 320,
      height: 180,
      fps: 2,
      duration: 8,
      channels: true,
      subjectId: id,
    };
    const ref = await a.reference.capture(referenceInput);
    ck(
      ref.archive.size > 0 &&
        ref.manifest.settings.frames === 16 &&
        ref.manifest.frameFiles.length === 3,
      "reference package",
    );
    ck(
      snapshot() === before && runtime() === rt && a.state.time === 4,
      "reference restore",
    );
    const repeat = await a.reference.capture(referenceInput);
    const equalBlob = async (a, b) => {
      const x = new Uint8Array(await a.arrayBuffer()),
        y = new Uint8Array(await b.arrayBuffer());
      return x.length === y.length && x.every((v, i) => v === y[i]);
    };
    ck(
      (await equalBlob(ref.first, repeat.first)) &&
        (await equalBlob(ref.last, repeat.last)),
      "reference repeat pose pixels",
    );
    ck(snapshot() === before && runtime() === rt, "repeated reference restore");
    const data = new Uint8Array(await ref.archive.arrayBuffer());
    let binary = "";
    for (let i = 0; i < data.length; i += 0x8000)
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    const archiveBase64 = btoa(binary);
    const media = {
      video: {
        frames: video.frames,
        seconds: video.seconds,
        bytes: video.size,
        actions: [...new Set(seen.map((s) => s.anim))],
      },
      reference: {
        frames: 16,
        keyframes: 3,
        bytes: ref.archive.size,
        repeatedFirstLastPixelsEqual: true,
      },
      cancellationAndFailureRestore: true,
    };
    a.state.time = 0;
    a.step(0, true);
    a.select({ kind: "obj", so: a.byId(id) });
    a.bus.emit("objects");
    window.__behaviorTest = { id, request, snapshot, runtime };
    return {
      status: "PASS",
      media,
      archiveBase64,
      points: d.stats.points,
      coverage: d.coverage,
      checks: [
        "readonly preview",
        "stale/tamper",
        "warning/duration confirmation",
        "no-undo and partial / post-append rollback",
        "one-step undo/redo",
        "seek and loop",
        "hold",
        "save/load",
        "invalid load fail closed",
        "read-only keys / transforms",
        "duplicate independence",
        "busy / terrain / unknown guards",
        "legacy mover",
        "PNG / multi-frame / failed PNG restore",
        "32-frame WebCodecs / cancelled / failed video restore",
        "16-frame reference normal + gray + depth/ID/mask, repeat pixel equality",
      ],
    };
  });
  const zipBytes = Buffer.from(core.archiveBase64, "base64"),
    files = unzipSync(zipBytes);
  delete core.archiveBase64;
  const metadata = JSON.parse(strFromU8(files["camera/keyframes.json"]));
  assert.equal(metadata.subjects[0].behavior.clips[1].anim, "wave");
  assert.equal(metadata.subjects[0].behavior.clips[1].start, 3);
  assert.ok(metadata.subjects[0].time_basis.includes("absolute seconds"));
  assert.ok(
    strFromU8(files["prompt.txt"]).includes("3.00–5.00s wave"),
    strFromU8(files["prompt.txt"]),
  );
  const scene = JSON.parse(strFromU8(files["source/scene.json"]));
  assert.equal(
    scene.objects.find((o) => o.motion?.behavior).motion.behavior.duration,
    8,
  );
  assert.ok(
    files["source/project.previz"].length &&
      files["frames/00015-depth.png"].length &&
      files["frames/00015-subject.png"].length,
  );
  writeFileSync(
    `.shots/behavior-${process.env.TEST_FILE_URL ? "file" : "dev"}-reference.zip`,
    zipBytes,
  );
  console.log("core", core);
  // Real form interaction, standalone renderer, candidate playback, confirmation and cleanup.
  const openButtons = await page.$$('[data-behavior-action="open"]');
  let opened = false;
  for (const b of openButtons) {
    if (await b.boundingBox()) {
      await b.click();
      opened = true;
      break;
    }
  }
  assert.ok(opened, "no visible behavior entry");
  await page.waitForSelector("[data-behavior-dialog]");
  await page.click('[data-behavior-action="preview"]');
  await page.waitForFunction(
    () =>
      document.querySelector("[data-behavior-dialog] canvas") &&
      !app.behaviors.busy,
    { timeout: 90000 },
  );
  await page.$eval('[aria-label="第1步秒数"]', (n) => {
    n.value = "3";
    n.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.ok(
    await page.$eval('[data-behavior-action="apply"]', (n) => n.disabled),
  );
  assert.equal(
    await page.$("[data-behavior-dialog] canvas"),
    null,
    "edited form leaked preview renderer",
  );
  await page.click('[data-behavior-action="preview"]');
  await page.waitForFunction(
    () =>
      document.querySelector("[data-behavior-dialog] canvas") &&
      !app.behaviors.busy,
    { timeout: 90000 },
  );
  const previewOnly = await page.evaluate(() => {
    window.__beforeUI = __behaviorTest.snapshot();
    window.__runtimeUI = __behaviorTest.runtime();
    window.__undoUI = app._undo.length;
    return document.querySelector("[data-behavior-status]").textContent;
  });
  assert.ok(previewOnly.includes("候选"));
  await page.click('[data-behavior-action="play-preview"]');
  await new Promise((r) => setTimeout(r, 450));
  await page.click('[data-behavior-action="play-preview"]');
  assert.ok(
    await page.evaluate(
      () =>
        __beforeUI === __behaviorTest.snapshot() &&
        __runtimeUI === __behaviorTest.runtime() &&
        __undoUI === app._undo.length,
    ),
    "standalone preview mutated source",
  );
  await page.click('[data-behavior-action="apply"]');
  assert.ok(
    (await page.$eval("[data-behavior-status]", (n) => n.textContent)).includes(
      "确认",
    ),
  );
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
    [390, 720],
  ]) {
    await page.setViewport({ width, height });
    const overflow = await page.$eval(
      "[data-behavior-dialog]",
      (d) => d.scrollWidth > d.clientWidth + 2,
    );
    assert.equal(overflow, false, `dialog overflow ${width}`);
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.$eval("[data-behavior-scrub]", (n) => {
    n.value = 4;
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.screenshot({
    path: `.shots/behavior-${process.env.TEST_FILE_URL ? "file" : "dev"}.png`,
  });
  await page.click("[data-behavior-confirm]");
  await page.click('[data-behavior-action="apply"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-behavior-status]")
        .textContent.includes("已应用"),
    { timeout: 90000 },
  );
  assert.ok(
    await page.evaluate(() => app._undo.length === __undoUI + 1),
    "UI not one undo",
  );
  await page.screenshot({
    path: `.shots/behavior-${process.env.TEST_FILE_URL ? "file" : "dev"}-applied.png`,
  });
  await page.click('[data-behavior-action="close"]');
  assert.equal(await page.$("[data-behavior-dialog]"), null);
  assert.deepEqual(errors, []);
  const report = {
    mode: process.env.TEST_FILE_URL ? "file-offline" : "dev",
    core,
    ui: "PASS: form, standalone preview, local playback, mandatory confirmation, single undo, responsive 1440/800/390, close cleanup",
    errors,
  };
  writeFileSync(
    `.shots/behavior-${process.env.TEST_FILE_URL ? "file" : "dev"}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
