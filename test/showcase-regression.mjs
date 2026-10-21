import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [],
  results = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
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
    app.setTex(false);
    app.state.perf = true;
    app.lighting.setEnabled(false);
  });
  for (const id of ["cyber-rain", "lantern-river"]) {
    await page.click('#top button[title="场景"]');
    await page.evaluate(() =>
      [...document.querySelectorAll(".tb-dropdown.open .dd-item")]
        .find((e) => e.textContent.includes("示例场景"))
        .click(),
    );
    await page.waitForSelector(".menu.scenes.on", { visible: true });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".menu.scenes .sc-preview")].length ===
          2 &&
        [...document.querySelectorAll(".menu.scenes .sc-preview")].every(
          (e) => e.complete && e.naturalWidth === 640,
        ),
    );
    assert(
      await page.$eval(".menu.scenes", (e) => {
        const r = e.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.left >= 0 &&
          r.right <= innerWidth &&
          r.bottom <= innerHeight
        );
      }),
      "gallery within viewport",
    );
    if (id === "cyber-rain")
      await page.screenshot({ path: ".shots/showcase-gallery.png" });
    await page.click(
      ".menu.scenes.on .scard:nth-child(" + (id === "cyber-rain" ? 1 : 2) + ")",
    );
    const result = await page.evaluate((id) => {
      const a = app,
        T = {
          Vector3: app.stage.view.position.constructor,
          Quaternion: app.stage.view.quaternion.constructor,
          Box3: app.stage.selBox.box.constructor,
        };
      a.suspended = true;
      a._quietAdd = true;
      const ck = (v, m) => {
        if (!v) throw Error(id + ": " + m);
      };
      ck(a.sceneReport?.id === id, "real gallery card loads requested scene");
      a.step(0, true);
      a.stage.render();
      const report = { ...a.sceneReport };
      ck(!report.missing && !report.targetMiss, "missing asset/target");
      ck(
        a.state.tex && !a.state.perf && a.lighting.enabled,
        "authored lighting and materials restored from gray/unlit mode",
      );
      ck(!a.state.grid && !a.state.showHelpers, "clean authored view");
      ck(
        a.objects.every((o) => !o._mgroup?.visible),
        "motion helpers hidden",
      );
      ck(
        a.shots.every((s) => !s.showFrustum),
        "frustums hidden",
      );
      const moving = a.objects.filter((o) => o.motion?.active);
      const buildings = a.objects.filter(
        (o) => o.item?.catId === "building" && o.type === "tower",
      );
      const boxes = buildings.map((o) => new T.Box3().setFromObject(o.root));
      let routeSamples = 0,
        moved = 0;
      for (const so of moving) {
        const first = so.root.position.clone();
        for (let i = 0; i <= 240; i++) {
          const out = so.motion.mover.sample(
            i / 240,
            { p: new T.Vector3(), q: new T.Quaternion(), f: null },
            "linear",
            { arc: false },
          );
          ck(out.p.toArray().every(Number.isFinite), "nonfinite route");
          routeSamples++;
          if (out.p.distanceTo(first) > 1) moved++;
          // Conservative center-plus-clearance check, not a general mesh collision solver.
          if (so.type === "skycar")
            for (const box of boxes) {
              const expanded = box
                .clone()
                .expandByVector(new T.Vector3(1.6, 1.45, 2.65));
              ck(
                !expanded.containsPoint(out.p),
                "flight penetrates tower " +
                  so.name +
                  " point " +
                  out.p.toArray() +
                  " box " +
                  box.min.toArray() +
                  " / " +
                  box.max.toArray(),
              );
            }
        }
      }
      ck(moved > 0, "animation inactive");
      for (const shot of a.shots)
        for (let i = 0; i <= 30; i++) {
          const out = shot.mover.sample(
            i / 30,
            { p: new T.Vector3(), q: new T.Quaternion(), f: null },
            shot.easing,
            shot.moverOpts(),
          );
          ck(
            (out
              ? [...out.p.toArray(), ...out.q.toArray()]
              : shot.rig.position.toArray()
            ).every(Number.isFinite),
            "nonfinite camera",
          );
        }
      if (id === "cyber-rain") {
        ck(a.weather.particles.isLineSegments, "rain streaks");
        ck(a.lighting.p.fogDens >= 0.015, "rain and fog coexist");
        ck(a.stage.view.position.y < 2, "street-level opening");
      } else {
        ck(a.terrain.workflow.rivers.length === 1, "real river");
        ck(a.terrain.heightAt(0, 0) < -2.8, "carved channel");
        ck(a.terrain.heightAt(16, 0) > -0.01, "level riverbank road");
        ck(
          a.objects.filter((o) => o.type === "road_brush").length === 4,
          "bank and axis roads",
        );
        const gate = a.objects.find((o) => o.type === "paifang");
        ck(
          Math.abs(gate.root.rotation.y - Math.PI / 2) < 1e-6,
          "gate crosses X axis",
        );
      }
      const snapshot = JSON.parse(JSON.stringify(a.serialize()));
      const terrain = [
        a.terrain.heightAt(0, 0),
        a.terrain.heightAt(6, 60),
        a.terrain.heightAt(16, 0),
      ];
      a.loadJson(snapshot);
      const restored = a.serialize();
      ck(
        restored.objects.length === snapshot.objects.length,
        "roundtrip object count",
      );
      for (const key of ["weather", "rendering", "light"])
        ck(
          JSON.stringify(restored[key]) === JSON.stringify(snapshot[key]),
          "roundtrip " + key,
        );
      ck(restored.view.fov === snapshot.view.fov, "roundtrip fov");
      ck(restored.state.showHelpers === false, "roundtrip helpers");
      for (const before of snapshot.objects.filter(
        (o) => o.type !== "road_intersection",
      )) {
        const after = restored.objects.find((o) => o.id === before.id);
        ck(after, "roundtrip ID");
        for (const key of [
          "key",
          "params",
          "motion",
          "followTerrain",
          "points",
          "width",
          "roadType",
        ])
          ck(
            JSON.stringify(before[key]) === JSON.stringify(after[key]),
            "roundtrip " +
              key +
              " " +
              before.name +
              " " +
              JSON.stringify(before[key]) +
              " vs " +
              JSON.stringify(after[key]),
          );
      }
      for (const so of a.objects.filter((o) => o.motion?.active))
        ck(so.motion.mover.opts.arc === false, "roundtrip arc speed mapping");
      for (const before of snapshot.objects.filter(
        (o) => o.type !== "road_intersection",
      )) {
        const after = restored.objects.find((o) => o.id === before.id);
        ck(
          !before.pos ||
            before.pos.every((v, i) => Math.abs(v - after.pos[i]) < 0.001),
          "roundtrip millimetre pose tolerance",
        );
      }
      [
        a.terrain.heightAt(0, 0),
        a.terrain.heightAt(6, 60),
        a.terrain.heightAt(16, 0),
      ].forEach((v, i) =>
        ck(Math.abs(v - terrain[i]) < 1e-4, "precise terrain reload"),
      );
      a.state.time = 15;
      a.step(0, true);
      ck(
        a.objects
          .filter((o) => o.motion?.active)
          .some(
            (o) =>
              o.root.position.distanceTo(
                new T.Vector3().fromArray(o.motion.keys[0].p),
              ) > 1,
          ),
        "timeline scrub moves actors",
      );
      a.state.time = 0;
      a.step(0, true);
      a.stage.render();
      return {
        id,
        report,
        objects: a.objects.length,
        shots: a.shots.length,
        moving: moving.length,
        routeSamples,
        roundtrip: true,
      };
    }, id);
    await page.screenshot({ path: ".shots/showcase-" + id + ".png" });
    results.push(result);
  }
  await page.click('#top button[title="场景"]');
  await page.evaluate(() =>
    [...document.querySelectorAll(".tb-dropdown.open .dd-item")]
      .find((e) => e.textContent.includes("示例场景"))
      .click(),
  );
  await page.click(".menu.scenes.on .scard:first-child");
  const undo = await page.evaluate(() => {
    const a = app;
    if (
      !a.undo() ||
      a.projectName !== "万家灯火 · 望河古城" ||
      a.weather.type !== null ||
      a.terrain.workflow.rivers.length !== 1
    )
      throw Error("undo to town");
    if (
      !a.redo() ||
      a.projectName !== "霓雨深城 · 悬浮航道" ||
      a.weather.type !== "rain"
    )
      throw Error("redo to city");
    // Legacy project fixture intentionally has no weather, rendering, fov or helper fields.
    a.loadJson({
      v: 4,
      name: "Legacy project",
      objects: [],
      shots: [],
      state: { duration: 6 },
    });
    a.step(0, true);
    if (a.weather.type || a.terrain.workflow.rivers.length)
      throw Error("weather/river leak into legacy scene");
    return true;
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    ".shots/showcase-regression-" +
      (process.env.TEST_FILE_URL ? "file" : "dev") +
      ".json",
    JSON.stringify(
      {
        mode: process.env.TEST_FILE_URL ? "offline" : "dev",
        results,
        undo,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ results, undo, errors }, null, 2));
} finally {
  await browser.close();
}
