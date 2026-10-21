import assert from "node:assert/strict";
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(() => window.app?.roadTerrain, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const a = window.app,
      tr = a.terrain,
      rb = a.roadBrush,
      T =
        window.__t?.THREE ||
        (await import("/node_modules/three/build/three.module.js"));
    a.clearAll();
    tr.weights.fill(0);
    tr.setWater(false);
    tr.setResolution(129);
    // Local material changes do not modify heights or distant material weights.
    a.state.terrainTool = "material";
    tr.state.material = "sand";
    tr.setBrush({ size: 7, strength: 1 });
    const before = tr.h.slice();
    tr.paintAt(-20, -20);
    const c =
      (Math.round((-20 / tr.size + 0.5) * (tr.n - 1)) * tr.n +
        Math.round((-20 / tr.size + 0.5) * (tr.n - 1))) *
      6;
    const local = {
      paint: tr.weights[c + 4],
      far: tr.weights[0],
      heightSame: tr.h.every((v, i) => v === before[i]),
    };
    const oldHeight = tr.heightAt(-20, -20);
    tr.setResolution(257);
    local.refined = tr.n;
    local.height = tr.heightAt(-20, -20) - oldHeight;
    local.paintRetained = tr.weights.some((v) => v > 0.4);
    const td = tr.toJSON();
    tr.weights.fill(0);
    tr.fromJSON(td);
    local.saved = tr.weights.some((v) => v > 0.4);
    // Symmetric broad smoothing handles a cliff and remains stable.
    for (let j = 0; j < tr.n; j++)
      for (let i = 0; i < tr.n; i++) tr.h[j * tr.n + i] = i < tr.n / 2 ? 0 : 10;
    tr.refresh();
    const cliffBefore = tr.slopeAt(0, 0);
    a.state.terrainTool = "smooth";
    tr.setBrush({ size: 12, strength: 1 });
    for (let k = 0; k < 4; k++) tr.paintAt(0, 0);
    const cliffAfter = tr.slopeAt(0, 0);
    a.state.terrainTool = "slope";
    tr.state.maxSlope = 15;
    tr.paintAt(0, 0);
    const slopeFinite = tr.h.every(Number.isFinite);
    // Follow roads sample the FULL width; a peak midway between control points is not missed.
    tr.h.fill(0);
    tr.weights.fill(0);
    tr.setResolution(97);
    for (let j = 0; j < tr.n; j++)
      for (let i = 0; i < tr.n; i++) {
        const x = -tr.size / 2 + (i * tr.size) / (tr.n - 1),
          z = -tr.size / 2 + (j * tr.size) / (tr.n - 1);
        tr.h[j * tr.n + i] = 4 * Math.exp(-((x / 10) ** 2 + (z / 16) ** 2));
      }
    tr.refresh();
    rb.restore([
      {
        id: "follow",
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
        terrainOffset: 0.02,
        points: [
          [-45, 0, 0],
          [45, 0, 0],
        ],
      },
    ]);
    const follower = a.byId("follow"),
      profile = follower._roadData.curve._terrainProfile,
      center = a.roadTerrain.height(follower._roadData.curve, 0, 0);
    const ray = new T.Raycaster(
      new T.Vector3(0, 40, 0),
      new T.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObject(follower.root, true)[0];
    let finite = true,
      verts = 0;
    follower.root.traverse((m) => {
      if (m.isMesh) {
        const p = m.geometry.attributes.position;
        verts += p.count;
        for (let i = 0; i < p.array.length; i++)
          if (!Number.isFinite(p.array[i])) finite = false;
      }
    });
    const hills = {
      center,
      terrain: tr.heightAt(0, 0),
      actual: hit?.point.y,
      finite,
      verts,
    };
    // Terrain edit keeps road identity, changes its actual geometry, and roundtrips with undo.
    a.beginOp("terrain linked edit");
    for (let i = 0; i < tr.h.length; i++) tr.h[i] += 2;
    tr.refresh();
    a.bus.emit("terrain");
    const raised = a.roadTerrain.height(a.byId("follow")._roadData.curve, 0, 0);
    a.undo();
    const undo = a.roadTerrain.height(a.byId("follow")._roadData.curve, 0, 0);
    a.redo();
    const redo = a.roadTerrain.height(a.byId("follow")._roadData.curve, 0, 0);
    // Grade separated roads: no junction and piers cannot touch ANY part of the lower road.
    a.clearAll();
    tr.setResolution(97);
    tr.h.fill(0);
    tr.refresh();
    tr.setWater(false);
    rb.restore([
      {
        id: "lower",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-55, 0, 0],
          [55, 0, 0],
        ],
      },
      {
        id: "upper",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [0, 9, -55],
          [0, 9, 55],
        ],
      },
    ]);
    const supports = (o) =>
      o.root.children
        .filter((c) => c.userData.roadSupport)
        .flatMap((g) => g.children);
    const upper = a.byId("upper"),
      lower = a.byId("lower"),
      lowBoxes = lower.root.children
        .filter((c) => !c.userData.roadSupport)
        .map((c) => new T.Box3().setFromObject(c));
    const bridge = {
      junctions: a.objects.filter((o) => o.type === "road_intersection").length,
      count: supports(upper).length,
      status: { ...upper.root.userData.bridgeStatus },
      collision: supports(upper).some((m) =>
        lowBoxes.some((b) => b.intersectsBox(new T.Box3().setFromObject(m))),
      ),
    };
    // A wide building blocks all candidate shifts; blocked piers must be omitted, not forced through.

    const module = await import("/src/app.js");
    const buildingRoot = new T.Group();
    const mesh = new T.Mesh(
      new T.BoxGeometry(30, 15, 60),
      new T.MeshStandardMaterial(),
    );
    mesh.position.y = 7.5;
    buildingRoot.add(mesh);
    const building = new module.SceneObj(a, {
      id: "building",
      name: "Building collision obstacle",
      type: "building",
      root: buildingRoot,
      params: {},
      pos: [0, 0, 0],
      followTerrain: false,
    });
    a.objects.push(building);
    a.stage.world.add(building.root);
    a.bus.emit("objects");
    const blocked = a.byId("upper").root.userData.bridgeStatus;
    const box = new T.Box3().setFromObject(building.root);
    bridge.buildingCollision = supports(a.byId("upper")).some((m) =>
      box.intersectsBox(new T.Box3().setFromObject(m)),
    );
    bridge.blocked = blocked.blocked;
    // Removing an obstacle regenerates supports without moving the road.
    const withBuilding = blocked.built;
    a.removeObject(building);
    a.bus.emit("objects");
    bridge.regenerated =
      a.byId("upper").root.userData.bridgeStatus.built > withBuilding;
    // A building below the deck (not intersecting the deck itself) still blocks the full shaft.
    const root2 = new T.Group(),
      m2 = new T.Mesh(new T.BoxGeometry(8, 3, 8), new T.MeshStandardMaterial());
    m2.position.set(0, 1.5, 30);
    root2.add(m2);
    const b2 = new module.SceneObj(a, {
      id: "low-building",
      type: "building",
      root: root2,
      params: {},
      followTerrain: false,
    });
    a.objects.push(b2);
    a.stage.world.add(root2);
    a.bus.emit("objects");
    bridge.lowBuildingCollision = supports(a.byId("upper")).some((m) =>
      new T.Box3()
        .setFromObject(root2)
        .intersectsBox(new T.Box3().setFromObject(m)),
    );
    a.removeObject(b2);
    a.bus.emit("objects");
    // Plant intersecting a future shaft is removed, but a short plant below a clear bridge span survives.
    const veg = await import("/src/vegetation-brush.js"),
      species = veg.VEGETATION.find((v) => v.type === "tree").key;
    const clear = a.addVegetationPatch({
      plants: [{ key: species, p: [3, 0, 35], s: 0.3, rot: 0 }],
    });
    const first = supports(a.byId("upper"))[0],
      bp = new T.Box3().setFromObject(first).getCenter(new T.Vector3());
    a.beginOp("pier plant cleanup");
    const patch = a.addVegetationPatch({
      plants: [{ key: species, p: [bp.x, 0, bp.z], s: 0.7, rot: 0 }],
    });
    // addVegetationPatch emits objects; the overlap must already have been removed atomically.
    a.bus.emit("objects");
    const plants = {
      deleted: !a.byId(patch.id) || !a.byId(patch.id).params.plants.length,
      clearRetained: !!a.byId(clear.id),
    };
    // Fill under the high road, but leave the crossing lower road corridor untouched.
    const crossingBefore = tr.heightAt(0, 0),
      awayBefore = tr.heightAt(0, 35);
    a.roadTerrain.fillRoad(a.byId("upper"));
    const fill = {
      crossing: tr.heightAt(0, 0) - crossingBefore,
      away: tr.heightAt(0, 35) - awayBefore,
      remote: tr.heightAt(45, 45),
    };
    const saved = a.serialize();
    a.loadJson(JSON.parse(JSON.stringify(saved)));
    const archive = {
      mode: a.byId("upper")._roadData.terrainMode,
      height: tr.heightAt(0, 35),
      n: tr.n,
    };
    return {
      local,
      cliffBefore,
      cliffAfter,
      slopeFinite,
      hills,
      raised,
      undo,
      redo,
      bridge,
      plants,
      fill,
      archive,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.ok(
    result.local.paint > 0.3 &&
      result.local.far === 0 &&
      result.local.heightSame &&
      result.local.paintRetained &&
      result.local.saved,
  );
  assert.equal(result.local.refined, 257);
  assert.ok(Math.abs(result.local.height) < 0.01);
  assert.ok(result.cliffAfter < result.cliffBefore && result.slopeFinite);
  assert.ok(
    result.hills.center >= result.hills.terrain &&
      result.hills.actual >= result.hills.terrain &&
      result.hills.finite &&
      result.hills.verts > 1000,
  );
  assert.ok(Math.abs(result.raised - result.hills.center - 2) < 0.1);
  assert.ok(Math.abs(result.undo - result.hills.center) < 0.1);
  assert.ok(Math.abs(result.redo - result.raised) < 0.1);
  assert.equal(result.bridge.junctions, 0);
  assert.ok(result.bridge.count > 0);
  assert.equal(result.bridge.collision, false);
  assert.equal(result.bridge.buildingCollision, false);
  assert.ok(result.bridge.blocked > 0 && result.bridge.regenerated);
  assert.equal(result.bridge.lowBuildingCollision, false);
  assert.ok(result.plants.deleted && result.plants.clearRetained);
  assert.ok(
    Math.abs(result.fill.crossing) < 0.05 &&
      result.fill.away > 5 &&
      Math.abs(result.fill.remote) < 0.01,
  );
  assert.equal(result.archive.mode, "fixed");
  assert.ok(result.archive.height > 5);
  const extra = await page.evaluate(async () => {
    const a = app,
      tr = a.terrain,
      rb = a.roadBrush,
      T = window.__t.THREE,
      veg = await import("/src/vegetation-brush.js");
    a.clearAll();
    tr.setWater(false);
    tr.setResolution(129);
    // A non-flat SOURCE alignment must not introduce pitched slab seams or double-subtract design heights.
    for (let j = 0; j < tr.n; j++)
      for (let i = 0; i < tr.n; i++) {
        const x = -tr.size / 2 + (i * tr.size) / (tr.n - 1),
          z = -tr.size / 2 + (j * tr.size) / (tr.n - 1);
        tr.h[j * tr.n + i] =
          4 * Math.exp((-x * x) / 100 - (z * z) / 300) +
          3 * Math.exp(-((x - 6) ** 2 + (z - 6) ** 2) / 5);
      }
    tr.refresh();
    rb.restore([
      {
        id: "hill-main",
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
        points: [
          [-45, 0, 0],
          [0, 4, 0],
          [45, 0, 0],
        ],
      },
      {
        id: "hill-stem",
        roadType: "asphalt",
        width: 8,
        terrainMode: "follow",
        points: [
          [0, 0, -45],
          [0, 4, 0],
        ],
      },
    ]);
    const roots = a.objects
        .filter((o) => ["road_brush", "road_intersection"].includes(o.type))
        .map((o) => o.root),
      ray = new T.Raycaster(),
      dir = new T.Vector3(0, -1, 0);
    let holes = 0,
      buried = 0,
      minClear = Infinity;
    for (let x = -35; x <= 35; x += 1)
      for (const z of [-3, 0, 3]) {
        ray.set(new T.Vector3(x, 40, z), dir);
        const hit = ray.intersectObjects(roots, true)[0];
        if (!hit) {
          holes++;
          continue;
        }
        const clear = hit.point.y - tr.heightAt(x, z);
        minClear = Math.min(minClear, clear);
        if (clear < -0.03) buried++;
      }
    const junctions = a.objects.filter(
      (o) => o.type === "road_intersection",
    ).length;
    // Automatic bridge cleanup is part of the SAME transaction and undo can restore the plant.
    a.clearAll();
    tr.setWater(false);
    rb.restore([
      {
        id: "plant-road",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        bridges: false,
        points: [
          [0, 8, -45],
          [0, 8, 45],
        ],
      },
    ]);
    const key = veg.VEGETATION.find((v) => v.type === "tree").key,
      plant = a.addVegetationPatch({
        plants: [{ key, p: [0, 0, -39], s: 0.6, rot: 0 }],
      });
    const initial = !!a.byId(plant.id),
      count = a._undo.length;
    a.roadTerrain.setRoad(a.byId("plant-road"), { bridges: true });
    const deleted = !a.byId(plant.id),
      oneUndo = a._undo.length === count + 1;
    a.undo();
    const restored =
      !!a.byId(plant.id) && a.byId("plant-road")._roadData.bridges === false;
    a.redo();
    const redone =
      !a.byId(plant.id) && a.byId("plant-road")._roadData.bridges !== false;
    // Same-road overpasses also treat their own LOWER deck as an obstacle.
    a.clearAll();
    tr.setWater(false);
    rb.restore([
      {
        id: "self-cross",
        roadType: "asphalt",
        width: 8,
        terrainMode: "fixed",
        points: [
          [-40, 0, 0],
          [40, 0, 0],
          [45, 8, 40],
          [0, 8, 40],
          [0, 8, -40],
        ],
      },
    ]);
    const o = a.byId("self-cross"),
      low = o.root.children
        .filter((c) => !c.userData.roadSupport)
        .map((c) => new T.Box3().setFromObject(c))
        .filter((b) => b.max.y < 1);
    const supports = o.root.children
      .filter((c) => c.userData.roadSupport)
      .flatMap((g) => g.children);
    const selfCollision = supports.some((m) =>
      low.some((b) => b.intersectsBox(new T.Box3().setFromObject(m))),
    );
    // A fixed bridge keeps its elevation when its alignment is edited/extended.
    rb.editRoad(o);
    rb.addPoint(-20, 0, -40);
    const editLevel = rb.points.at(-1).y,
      editMode = rb.terrainMode;
    rb.cancelEdit();
    // Extreme exaggeration no longer silently clips heights in saved projects.
    tr.h.fill(500);
    tr.exaggerate = 0.2;
    tr.refresh();
    const json = tr.toJSON();
    tr.h.fill(0);
    tr.fromJSON(json);
    const overflowHeight = tr.heightAt(0, 0);
    return {
      holes,
      buried,
      minClear,
      junctions,
      initial,
      deleted,
      oneUndo,
      restored,
      redone,
      selfCollision,
      supportCount: supports.length,
      editLevel,
      editMode,
      overflowHeight,
    };
  });
  console.log("Extra checks", extra);
  assert.equal(extra.holes, 0);
  assert.equal(extra.buried, 0);
  assert.equal(extra.junctions, 1);
  assert.ok(
    extra.initial &&
      extra.deleted &&
      extra.oneUndo &&
      extra.restored &&
      extra.redone,
  );
  assert.equal(extra.selfCollision, false);
  assert.ok(extra.supportCount > 0);
  assert.equal(extra.editLevel, 8);
  assert.equal(extra.editMode, "fixed");
  assert.ok(Math.abs(extra.overflowHeight - 100) < 0.01);
  assert.deepEqual(errors, []);
  console.log(
    "PASS local splat materials, refinement, steep smoothing, following roads, grade separation, full-volume pier collisions, vegetation clearance, safe embankment, undo/redo and archive",
  );
} finally {
  await browser.close();
}
