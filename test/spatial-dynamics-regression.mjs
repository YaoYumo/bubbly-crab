import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";
const b = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
mkdirSync(".shots", { recursive: true });
try {
  const p = await b.newPage(),
    errors = [],
    results = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.setViewport({ width: 1600, height: 1000 });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.__previzBooted && window.app, {
    timeout: 90000,
  });
  await p.evaluate(() => {
    app.suspended = true;
    app._quietAdd = true;
  });
  for (const [kind, prompt] of [
    [
      "cyber-rain",
      "赛博都市，4辆悬浮车，6位行人，行人速度1.5倍，飞车速度2倍，关闭错峰，种子82",
    ],
    ["lantern-river", "中式古城沿河，6位行人，行人速度1.5倍，错峰，种子42"],
  ]) {
    await p.click('#top button[title^="一句话生成街区"]');
    await p.waitForSelector(".tg-mask.on");
    await p.$eval(
      ".tg-input",
      (e, t) => {
        e.value = t;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      },
      prompt,
    );
    if (kind === "cyber-rain") {
      await p.$eval(".tg-recipe-panel details", (e) => {
        e.open = true;
      });
      await p.$eval('[data-recipe-param="walkRate"]', (e) => {
        e.value = ".5";
        e.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await p.$eval('[data-recipe-param="stagger"]', (e) => {
        e.checked = true;
        e.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const before = await p.evaluate(() =>
      JSON.stringify(app.serialize({ assets: false })),
    );
    await p.click(".tg-recipe-panel>.tg-btn");
    await p.waitForSelector(".tg-relation-summary");
    assert(
      (await p.$eval(".tg-relation-summary", (e) => e.textContent)).includes(
        "空间关系",
      ),
    );
    assert(
      (await p.$eval(".tg-plan", (e) => e.textContent)).includes("非整数倍率"),
    );
    assert.equal(
      await p.evaluate(() => JSON.stringify(app.serialize({ assets: false }))),
      before,
    );
    await p.screenshot({ path: `.shots/dynamics-plan-${kind}.png` });
    await p.click(".tg-foot .tg-btn.pri");
    await p.waitForFunction(() => !document.querySelector(".tg-mask"), {
      timeout: 120000,
    });
    const result = await p.evaluate((kind) => {
      const a = app,
        ck = (v, msg) => {
          if (!v) throw Error(msg);
        },
        g = a.sceneGeneration;
      ck(g.options.stagger, "phase option");
      ck(
        g.checks.relations.ok && g.checks.relations.anchors > 0,
        "relations report",
      );
      ck(g.checks.dynamics.corridorSamples > 0, "corridor report");
      const ids = new Set(
        a.objects.map((o) => o.params.sceneRecipeNode).filter(Boolean),
      );
      ck(
        g.relations.entities.every((e) => ids.has(e.id)),
        "portable node mapping",
      );
      function verify() {
        for (const u of [0, 0.217, 0.751]) {
          a.state.time = u * a.state.duration;
          a.step(0, true);
          for (const o of a.objects.filter((o) => o.motion?.schedule)) {
            const m = o.motion,
              s = m.schedule,
              t = (((u * s.rate + s.phase) % 1) + 1) % 1;
            const expected = m.mover.sample(
              t,
              {
                p: o.root.position.clone(),
                q: o.root.quaternion.clone(),
                f: null,
              },
              "linear",
              { arc: false },
            ).p;
            ck(
              o.root.position.distanceTo(expected) < 1e-7,
              "runtime uses rate/phase, not just metadata",
            );
          }
        }
      }
      ck(
        a.objects
          .filter((o) => o.isChar)
          .every(
            (o) =>
              o.motion.schedule.rate === (kind === "cyber-rain" ? 0.5 : 1.5),
          ),
        "walker path rate",
      );
      if (kind === "cyber-rain")
        ck(
          a.objects
            .filter((o) => o.type === "skycar")
            .every((o) => o.motion.schedule.rate === 2),
          "traffic path rate",
        );
      verify();
      const saved = JSON.parse(JSON.stringify(a.serialize({ assets: false })));
      a.loadJson(saved);
      verify();
      ck(
        JSON.stringify(a.sceneGeneration) === JSON.stringify(saved.generation),
        "relations persist",
      );
      ck(a.undo() && a.redo(), "transaction undo/redo");
      verify();
      a.state.time = 0;
      a.step(0, true);
      a.stage.render();
      return {
        kind,
        relations: g.checks.relations,
        dynamics: g.checks.dynamics,
        runtimeRateAndPhase: true,
        roundtrip: true,
        undoRedo: true,
      };
    }, kind);
    results.push(result);
    await p.screenshot({ path: `.shots/dynamics-${kind}.png` });
  }
  assert.deepEqual(errors, []);
  const mode = process.env.TEST_FILE_URL ? "file" : "dev";
  writeFileSync(
    `.shots/spatial-dynamics-${mode}.json`,
    JSON.stringify(
      { mode, results, previewPure: true, manualTimingControls: true, errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS spatial/dynamics UI",
    mode,
    "preview diagnostics, runtime phase/rate, 3 corridors, portable node mapping, roundtrip and undo/redo",
  );
} finally {
  await b.close();
}
