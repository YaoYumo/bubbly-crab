import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer";
const b = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 180000,
});
try {
  const p = await b.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/?fresh=1", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await p.waitForFunction(() => window.__previzBooted && window.app?.aiScene, {
    timeout: 90000,
  });
  const report = await p.evaluate(async () => {
    app.suspended = true;
    app.state.playing = false;
    app.clearAll();
    app.terrain.setEnabled(false);
    const THREE = window.__t.THREE,
      { LIB, buildAsset, defaultsFor } = await import("/src/assets.js"),
      { setTexForce } = await import("/src/detail.js");
    setTexForce(false);
    const out = {
      platform: "Linux Chromium, NOT Windows or real GGUF",
      models: [],
    };
    const release = (r) =>
      r.traverse((n) => {
        n.geometry?.dispose();
        for (const m of Array.isArray(n.material)
          ? n.material
          : n.material
            ? [n.material]
            : [])
          m.dispose();
      });
    const fixtures = LIB.filter((g) => ["furniture", "bld"].includes(g.id));
    for (const group of fixtures)
      for (const item of group.items)
        for (const mode of ["default", "min", "max"]) {
          const params = defaultsFor(item);
          if (mode !== "default")
            for (const def of item.params)
              if (["range", "int"].includes(def.t)) params[def.k] = def[mode];
          const root = buildAsset(item, params);
          root.updateMatrixWorld(true);
          let bad = 0,
            vertices = 0;
          root.traverse((n) => {
            const a = n.geometry?.attributes.position;
            if (!a) return;
            vertices += a.count;
            for (let i = 0; i < a.array.length; i++)
              if (!Number.isFinite(a.array[i])) bad++;
          });
          const box = new THREE.Box3().setFromObject(root);
          if (bad || box.isEmpty()) throw Error(item.name + " invalid " + mode);
          const flights = [];
          root.traverse((n) => {
            if (n.userData.stairFlight) flights.push(n);
          });
          const ray = new THREE.Raycaster(),
            floorChecks = [];
          for (const flight of flights) {
            const f = flight.userData.stairFlight;
            for (let i = 0; i < f.steps; i++)
              for (const fraction of [0.06, 0.5, 0.94]) {
                const origin = new THREE.Vector3(
                  0,
                  f.height + 2,
                  (i + fraction) * f.going,
                ).applyMatrix4(flight.matrixWorld);
                const direction = new THREE.Vector3(0, -1, 0);
                ray.set(origin, direction);
                const hits = ray.intersectObject(flight, true);
                if (!hits.length)
                  throw Error(item.name + " has stair gaps " + mode);
                const expected =
                  (i + 1) * f.rise +
                  flight.getWorldPosition(new THREE.Vector3()).y;
                if (Math.abs(hits[0].point.y - expected) > 0.001)
                  throw Error(item.name + " wrong tread height");
                floorChecks.push(hits[0].point.y);
              }
          }
          if (flights.length && box.min.y < -0.001)
            throw Error(item.name + " underground stair geometry");
          out.models.push({
            group: group.id,
            type: item.type,
            mode,
            vertices,
            stairFloorSamples: floorChecks.length,
            minY: box.min.y,
          });
          release(root);
        }
    // Glazed cells must not have hidden opaque full-size wall/trim backboards.
    for (const type of ["sash_window", "front_door"]) {
      const item = fixtures[0].items.find((i) => i.type === type),
        params = defaultsFor(item),
        root = buildAsset(item, params);
      root.updateMatrixWorld(true);
      const x =
          type === "sash_window" ? params.width * 0.2 : params.width / 2 + 0.2,
        y =
          type === "sash_window"
            ? params.height * 0.23 + 0.02
            : params.height * 0.5 + 0.15;
      const ray = new THREE.Raycaster(
        new THREE.Vector3(x, y, 2),
        new THREE.Vector3(0, 0, -1),
      );
      const opaque = ray
        .intersectObject(root, true)
        .filter((h) => !h.object.material.transparent);
      if (opaque.length)
        throw Error(
          "Opaque board blocks glass " +
            type +
            " " +
            JSON.stringify(
              opaque.map((h) => ({
                p: h.point.toArray(),
                pos: h.object.position.toArray(),
                geo: h.object.geometry.type,
                args: h.object.geometry.parameters,
              })),
            ),
        );
      release(root);
    }
    // Rough model + vehicle motion + follow camera + environment in ONE chat transaction.
    const { LocalSceneConversation } = await import("/src/local-scene-chat.js");
    const carKey = LIB.find((g) => g.id === "env").items.find(
      (i) => i.type === "car",
    );
    const payload = {
      reply: "已生成粗模与车辆运动和跟拍氛围",
      operations: [
        {
          op: "primitive",
          name: "库外巡检机器人",
          pos: [-10, 0, -10],
          parts: [
            {
              shape: "box",
              size: [0.8, 1.1, 0.6],
              pos: [0, 0.9, 0],
              color: "#4f83b0",
            },
            {
              shape: "sphere",
              size: [0.5, 0.5, 0.5],
              pos: [0, 1.7, 0],
              color: "#dde5ec",
            },
            { shape: "cylinder", size: [0.2, 0.4, 0.2], pos: [-0.25, 0.2, 0] },
            { shape: "cylinder", size: [0.2, 0.4, 0.2], pos: [0.25, 0.2, 0] },
          ],
        },
        {
          op: "add",
          key: `env:car:${carKey.name}`,
          name: "测试轿车",
          pos: [0, 0, 0],
        },
        {
          op: "motion",
          objectId: "last",
          points: [
            [0, 0, 0, 0],
            [app.state.duration, 20, 0, 10],
          ],
        },
        { op: "camera", objectId: "last", preset: "follow" },
        { op: "environment", lighting: "golden", weather: "rain" },
      ],
    };
    const before = app.serialize(),
      undo = app._undo?.length || 0,
      session = new LocalSceneConversation(app, {
        chat: async () => JSON.stringify(payload),
        stop: async () => {},
      });
    const result = await session.send(
      "创建一个库外巡检机器人和轿车，车辆沿路径行驶，跟拍镜头，黄金光影雨天",
      { model: "mock.gguf" },
    );
    if (!result.changed) throw Error("not committed");
    const primitive = app.objects.find((o) => o.root.userData.primitiveModel),
      car = app.objects.find((o) => o.type === "car");
    if (
      !primitive ||
      primitive.root.children.length !== 4 ||
      !car.motion.active ||
      app.lighting.preset !== "golden" ||
      app.weather.type !== "rain" ||
      app._undo.length !== undo + 1
    )
      throw Error("mixed tools not atomic");
    if (!app.shots.some((s) => s.targetId === car.id))
      throw Error("follow shot missing");
    const data = app.serialize();
    app.undo();
    if (
      app.objects.length !== before.objects.length ||
      app.lighting.preset !== before.light.preset
    )
      throw Error("undo mixed tools");
    app.redo();
    const generated = app.objects.find((o) => o.root.userData.primitiveModel);
    if (generated.params.parts.length !== 4)
      throw Error("rough redo lost parts");
    const savedKey = await app.modelLibrary.savePrimitive(generated),
      saved = app.modelLibrary.find(savedKey);
    if (!saved || saved.name !== generated.name)
      throw Error("model library save failed");
    await app.modelLibrary.place(savedKey, new THREE.Vector3(-20, 0, -20));
    if (app.objects.length !== 3)
      throw Error("rough model library re-place failed");
    out.ai = {
      primitiveParts: generated.params.parts.length,
      oneUndo: true,
      redo: true,
      motion: true,
      camera: true,
      environment: true,
      libraryRoundtrip: true,
      realGGUF: false,
    };
    // Locked target / bad loop / unknown geometry must never modify the live scene.
    const target = app.objects.find((o) => o.type === "car");
    target.locked = true;
    let beforeJSON = JSON.stringify(app.serialize());
    const bad = new LocalSceneConversation(app, {
      chat: async () =>
        JSON.stringify({
          reply: "move",
          operations: [
            {
              op: "motion",
              objectId: target.id,
              points: [
                [0, 0, 0, 0],
                [app.state.duration, 20, 0, 10],
              ],
            },
          ],
        }),
      stop: async () => {},
    });
    let rejected = false;
    try {
      await bad.send("车辆沿路径行驶", { model: "mock.gguf" });
    } catch {
      rejected = true;
    }
    if (!rejected || JSON.stringify(app.serialize()) !== beforeJSON)
      throw Error("locked motion mutated scene");
    app.loadJson(data);
    await app.terrain.workflow.ready();
    const movingCar = app.objects.find((o) => o.type === "car");
    movingCar.motion.faceOffset = 0;
    app.suspended = false;
    app.state.time = app.state.duration * 0.4;
    app.tick();
    const front = new THREE.Vector3(1, 0, 0).applyQuaternion(
        movingCar.root.quaternion,
      ),
      expected = new THREE.Vector3(20, 0, 10).normalize();
    if (front.dot(expected) < 0.999)
      throw Error("legacy AI car still goes sideways");
    const actor = app.addAsset(
      "char:human:男性",
      new THREE.Vector3(-30, 0, -30),
    );
    app.setMotion(actor, {
      active: true,
      autoFace: true,
      anim: "walk",
      keys: [
        { t: 0, p: [-30, 0, -30] },
        { t: 0.3, p: [-25, 0, -28] },
        { t: 1, p: [-20, 0, -30] },
      ],
    });
    const pose = () => {
      const r = actor.root.userData.rig;
      return [
        r.hips.position.y,
        r.legL.rotation.x,
        r.kneeL.rotation.x,
        r.legR.rotation.x,
        r.kneeR.rotation.x,
      ];
    };
    app.state.time = 2.7;
    app.tick();
    const firstPose = pose();
    app.state.time = 4.2;
    app.tick();
    app.state.time = 2.7;
    app.tick();
    if (pose().some((v, i) => Math.abs(v - firstPose[i]) > 1e-9))
      throw Error("walk seek non-deterministic");
    out.ai.nativeCarFrontAxisSampled = true;
    out.ai.legacyZeroFixed = true;
    out.ai.walkSeekDeterministic = true;
    app.suspended = true;
    out.ai.lockedRejected = true;
    return out;
  });
  // Pointer tests use actual browser events, not direct assignment of coordinates.
  await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.state.preview = false;
    app.state.playing = false;
    app.terrain.setEnabled(true);
    app.terrain.h.fill(0);
    app.terrain.refresh();
    const w = app.terrain.workflow;
    w.rivers = [
      {
        id: "drag-river",
        name: "拖点测试",
        points: [
          [-18, 0, -12],
          [0, 0, 0],
          [18, 0, 12],
        ],
        width: 6,
        depth: 2,
        bank: 4,
        water: true,
      },
    ];
    w.rebuildRivers();
    w.beginDraft("drag-river");
    app.suspended = false;
    app.stage.view.position.set(38, 45, 55);
    app.stage.orbit.target.set(0, 0, 0);
    app.stage.orbit.update();
    app.stage.view.updateMatrixWorld(true);
  });
  const screen = async (point) =>
    p.evaluate((point) => {
      const st = app.stage,
        r = st.canvas.getBoundingClientRect(),
        v = new __t.THREE.Vector3(...point).project(st.view);
      return {
        x: r.left + ((v.x + 1) * r.width) / 2,
        y: r.top + ((1 - v.y) * r.height) / 2,
      };
    }, point);
  let pt = await screen([0, 0, 0]);
  await p.mouse.move(pt.x, pt.y);
  await p.mouse.down();
  await p.mouse.move(pt.x + 45, pt.y - 16, { steps: 8 });
  await p.mouse.up();
  const river = await p.evaluate(() => {
    const w = app.terrain.workflow;
    return {
      draft: w.draft.points[1],
      source: w.rivers[0].points[1],
      orbit: app.stage.orbit.enabled,
      drag: !!w.pointDrag,
    };
  });
  assert.ok(Math.hypot(river.draft[0], river.draft[2]) > 1);
  assert.deepEqual(river.source, [0, 0, 0]);
  assert.equal(river.draft[1], 0);
  assert.equal(river.drag, false);
  assert.equal(river.orbit, true);
  await p.evaluate(async () => {
    const w = app.terrain.workflow;
    window.__pointUndo = app._undo.length;
    await w.commitDraft(false);
  });
  assert.equal(
    await p.evaluate(() => app._undo.length),
    await p.evaluate(() => __pointUndo + 1),
  );
  const road = await p.evaluate(() => {
    app.suspended = true;
    app.terrain.workflow.cancelDraft();
    app.terrain.setEnabled(false);
    app.roadBrush.restore([
      {
        id: "drag-road",
        name: "拖点道路",
        type: "road_brush",
        points: [
          [-20, 0.02, 0],
          [0, 0.02, 0],
          [20, 0.02, 15],
        ],
        width: 5,
        roadType: "concrete",
        fillet: false,
        terrainMode: "fixed",
        noJunct: true,
      },
    ]);
    const road = app.byId("drag-road");
    app.select({ kind: "obj", so: road });
    app.stage.tc.detach();
    app.suspended = false;
    return {
      id: road.id,
      points: road.serialize().points,
      guides: app.roadBrush.selectedGuides.children.length,
    };
  });
  assert.ok(road.guides > 0);
  pt = await screen(road.points[1]);
  await p.mouse.move(pt.x, pt.y);
  await p.mouse.down();
  await p.mouse.move(pt.x - 35, pt.y + 14, { steps: 8 });
  await p.mouse.up();
  const changed = await p.evaluate(() => ({
    points: app.byId("drag-road")?.serialize().points,
    active: app.roadBrush.active,
    edit: !!app.roadBrush._editBackup,
  }));
  assert.ok(changed.points);
  assert.ok(Math.hypot(changed.points[1][0], changed.points[1][2]) > 1);
  assert.equal(changed.active, false);
  assert.equal(changed.edit, false);
  // A cancelled direct drag must restore the exact path and consume no undo.
  const cancelBefore = await p.evaluate(() => ({
    points: app.byId("drag-road").serialize().points,
    undo: app._undo.length,
  }));
  pt = await screen(cancelBefore.points[1]);
  await p.mouse.move(pt.x, pt.y);
  await p.mouse.down();
  await p.mouse.move(pt.x + 25, pt.y + 10, { steps: 5 });
  await p.keyboard.press("Escape");
  await p.mouse.up();
  const cancelled = await p.evaluate(() => ({
    points: app.byId("drag-road")?.serialize().points,
    undo: app._undo.length,
    orbit: app.stage.orbit.enabled,
  }));
  assert.deepEqual(cancelled.points, cancelBefore.points);
  assert.equal(cancelled.undo, cancelBefore.undo);
  assert.equal(cancelled.orbit, true);
  report.river = {
    realPointerDrag: true,
    heightPreserved: true,
    draftOnly: true,
    oneSaveUndo: true,
  };
  report.road = {
    realPointerDrag: true,
    selectShowsPoints: true,
    commitOnRelease: true,
    idPreserved: true,
    cancelRestoresPathAndUndo: true,
  };
  report.errors = errors;
  assert.deepEqual(errors, []);
  fs.mkdirSync(".shots", { recursive: true });
  fs.writeFileSync(
    ".shots/editor-expansion.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS six-request regression",
    report.ai,
    report.river,
    report.road,
    "group/variant builds",
    report.models.length,
  );
} finally {
  await b.close();
}
