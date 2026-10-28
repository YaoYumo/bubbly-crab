// Explicit opt-in destructive benchmark. Use a fresh disposable tab; never an existing project.
import puppeteer from "puppeteer";
import fs from "node:fs";
const b = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 600000,
});
try {
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("ERROR", String(e)));
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1&benchmark=1",
  );
  await p.waitForFunction(() => window.__previzBooted);
  const r = await p.evaluate(async () => {
    const a = app,
      m = a.performance,
      rt = a.roadTerrain,
      rb = a.roadBrush;
    for (const [o, k] of [
      [rb, "restore"],
      [rb, "_buildRoadMesh"],
      [rt, "prepare"],
      [rt, "warp"],
      [rt, "obstacles"],
    ])
      m.wrap(o, k, k);
    const attribution = {},
      seen = new WeakSet();
    let counts = {};
    const category = (o) => {
      let support = false;
      while (o) {
        support ||= !!o.userData.roadSupport;
        if (o.userData.so) return support ? "road-support" : o.userData.so.type;
        o = o.parent;
      }
      return "sky/helpers/ground";
    };
    const report = await a.runPerformanceBenchmarks({
      warmup: 2,
      samples: 3,
      onProgress: (p) => {
        if (p.phase === "采样") {
          if (p.done === 1) counts = {};
          a.stage.scene.traverse((o) => {
            if (!o.isMesh || seen.has(o)) return;
            seen.add(o);
            const k = category(o);
            for (const method of ["onBeforeRender", "onBeforeShadow"]) {
              const old = o[method];
              o[method] = function (...args) {
                counts[k] = (counts[k] || 0) + 1;
                return old.apply(this, args);
              };
            }
          });
        }
        if (p.phase === "保存 / 恢复")
          attribution[p.fixture] = Object.fromEntries(
            Object.entries(counts).map(([k, v]) => [k, v / 3]),
          );
      },
    });
    a.suspended = true;
    a._suspendUndo = true;
    a._quietAdd = true;
    a.clearAll();
    a.terrain.setResolution(129);
    a.terrain.setWater(false);
    a.terrain.generate("hills", 12, 731);
    rb.restore(
      [-45, -15, 15, 45].map((z, i) => ({
        id: "measure" + i,
        points: [
          [-70, 0, z],
          [70, 0, z],
        ],
        width: 8,
        roadType: "asphalt",
        terrainMode: "follow",
      })),
    );
    a.bus.emit("objects");
    m.reset();
    const edits = [];
    let replaced = 0;
    for (let i = 0; i < 3; i++) {
      const roots = a.objects
        .filter((o) => o.type === "road_brush")
        .map((o) => o.root);
      a.state.terrainTool = "raise";
      a.terrain.setBrush({ size: 8, strength: 0.6 });
      const t = performance.now();
      a.terrain.paintAt(35, 45);
      a.bus.emit("terrain");
      a.bus.emit("objects");
      edits.push(performance.now() - t);
      replaced += a.objects
        .filter((o) => o.type === "road_brush")
        .filter((o, j) => o.root !== roots[j]).length;
    }
    return {
      attribution,
      fixtures: report.fixtures.map((f) => ({
        id: f.fixture.id,
        calls: f.calls.mean,
        triangles: f.triangles.mean,
        editMs: f.terrainEditMs,
        buildOperations: f.buildOperations,
      })),
      edits,
      replaced,
      operations: m.snapshot().operations,
      hardware: m.hardware(),
      error: report.error,
    };
  });
  fs.writeFileSync(
    process.argv[2] || ".shots/roads-measure.json",
    JSON.stringify(r, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        attribution: r.attribution,
        edits: r.edits,
        replaced: r.replaced,
        operations: r.operations,
        error: r.error,
      },
      null,
      2,
    ),
  );
} finally {
  await b.close();
}
