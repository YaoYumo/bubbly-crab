import { SKY_DEFAULTS } from "./physical-sky.js";
import { setTexForce } from "./detail.js";
import { LIB_INDEX } from "./assets.js";
import { VEGETATION } from "./vegetation-brush.js";
import { unpackProject } from "./project-assets.js";
import { summarize } from "./performance-monitor.js";
export const BENCHMARKS = [
  {
    id: "town",
    name: "普通小镇",
    buildings: 12,
    trees: 24,
    lamps: 4,
    roads: 2,
    terrain: 65,
  },
  {
    id: "dense",
    name: "密集城区",
    buildings: 48,
    trees: 0,
    lamps: 8,
    roads: 4,
    terrain: 65,
  },
  {
    id: "terrain",
    name: "起伏地形 + 植被",
    buildings: 0,
    trees: 600,
    lamps: 0,
    roads: 2,
    terrain: 129,
  },
  {
    id: "night",
    name: "夜景多灯",
    buildings: 12,
    trees: 0,
    lamps: 32,
    palaces: 4,
    roads: 2,
    terrain: 65,
  },
];
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));
const asset = (type) => {
  const entry = [...LIB_INDEX].find(([, item]) => item.type === type);
  if (!entry) throw new Error("缺少基准资产：" + type);
  return entry[0];
};
const check = (signal) => {
  if (signal?.aborted) throw new DOMException("已取消基准测试", "AbortError");
};
async function build(app, fixture, signal, progress) {
  const tr = app.terrain;
  app.clearAll();
  app.renderEffects.configure({}, {replace:true});
  app.state.playing = false;
  app.state.time = 0;
  app.state.grid = false;
  app.setPreview(false);
  app.weather?.set(null);
  app.state.tex = true;
  app.state.perf = false;
  setTexForce(null);
  app.stage.setPerfMode(false);
  app.stage.setPerspective();
  app.stage.view.fov = 46;
  app.stage.view.zoom = 1;
  app.stage.view.near = 0.2;
  app.stage.view.far = 3000;
  app.stage.view.up.set(0, 1, 0);
  app.stage.orbit.autoRotate = false;
  app.stage.orbit.enableDamping = false;
  app.stage.orbit.update();
  app.stage.useComposer = false;
  app.stage.anamorphicEnabled = false;
  app.stage.anamorphicPass.enabled = false;
  app.setDetail("std", { silent: true });
  tr.setResolution(fixture.terrain);
  tr.setSize(160);
  tr.setWater(false);
  tr.setExaggerate(1);
  tr.setBiome("grass");
  tr.setAutoSurface({
    enabled: true,
    rockSlope: 32,
    snowLine: 26,
    shoreWidth: 5,
  });
  if (fixture.id === "terrain") tr.generate("hills", 12, 731);
  else tr.setEnabled(false);
  app.lighting.setEnabled(true);
  app.state.perf = false;
  app.lighting.setMode("physical");
  app.lighting.physical.configure({
    ...SKY_DEFAULTS,
    date: "2026-10-16",
    source: "manual",
    sunElev: fixture.id === "night" ? -14 : 48,
    sunAzim: 135,
    ev: 0,
    whiteBalance: 6500,
    shadows: true,
    quality: "medium",
    fog: 0.001,
    energy: 1,
    environment: 0.65,
  });
  app.localLights.configure({ enabled: true, quality: "medium" });
  const keys = {
    building: asset("adobe"),
    lamp: asset("street_lamp"),
    palace: asset("lanternpole"),
    tree: VEGETATION[0].key,
  };
  let done = 0;
  const total = fixture.buildings + fixture.lamps + (fixture.palaces || 0);
  for (let i = 0; i < fixture.buildings; i++) {
    check(signal);
    const x = (i % 8) * 16 - 56,
      z = Math.floor(i / 8) * 17 - 45;
    app.addAsset(keys.building, [x, 0, z], { merge: true });
    if (++done % 4 === 0) {
      progress({ phase: "建造", done, total });
      await nextFrame();
    }
  }
  for (let i = 0; i < fixture.lamps; i++) {
    check(signal);
    app.addAsset(
      keys.lamp,
      [(i % 8) * 14 - 49, 0, Math.floor(i / 8) * 18 + 5],
      { merge: true },
    );
    if (++done % 4 === 0) {
      progress({ phase: "建造", done, total });
      await nextFrame();
    }
  }
  for (let i = 0; i < (fixture.palaces || 0); i++) {
    check(signal);
    app.addAsset(keys.palace, [i * 14 - 21, 0, 8], { merge: true });
  }
  if (fixture.trees) {
    const plants = Array.from({ length: fixture.trees }, (_, i) => {
      const x = (i % 30) * 4.5 - 65,
        z = Math.floor(i / 30) * 5 - 48;
      return {
        key: keys.tree,
        p: [x, tr.enabled ? tr.heightAt(x, z) : 0, z],
        s: 0.75 + (i % 5) * 0.08,
        rot: ((i * 0.61803398875) % 1) * Math.PI * 2,
      };
    });
    app.addVegetationPatch({ plants, seed: 731 });
  }
  const roads = Array.from({ length: fixture.roads }, (_, i) => ({
    id: "benchmark-road-" + i,
    name: "基准道路 " + i,
    roadType: "asphalt",
    width: 8,
    terrainMode: tr.enabled ? "follow" : "fixed",
    bridges: false,
    points: [
      [-72, 0, -8 + i * 19],
      [72, 0, -8 + i * 19],
    ],
  }));
  app.roadBrush.restore(roads);
  app.select(null);
  app.bus.emit("objects");
  app.bus.emit("shots");
  app.stage.helperLayer.visible = false;
  app.stage.setGridVisible(false);
  app.stage.orbit.target.set(0, 2, 0);
  if (fixture.id === "night") app.stage.view.position.set(15, 10, 28);
  else app.stage.view.position.set(88, 70, 110);
  app.stage.orbit.update();
  app.stage.renderer.setPixelRatio(1);
  app.stage.renderer.setSize(960, 540, false);
  app.stage.w = 960;
  app.stage.h = 540;
  app.stage.view.aspect = 960 / 540;
  app.stage.view.updateProjectionMatrix();
  app.lighting.flushEnvironment();
  return keys;
}
/** Only runs in a scratch tab: never serialize/replace the user's working document. */
export async function runBenchmarks(
  app,
  {
    signal,
    onProgress = () => {},
    samples = 30,
    warmup = 8,
    ids = BENCHMARKS.map((x) => x.id),
  } = {},
) {
  if (!app.benchmarkMode)
    throw new Error("请在独立基准标签页运行，不会替换当前工程");
  if (app._benchmarkRunning) throw new Error("基准测试正在运行");
  if (
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > 240 ||
    !Number.isInteger(warmup) ||
    warmup < 1 ||
    warmup > 60
  )
    throw new Error("基准采样数量无效");
  const fixtures = ids.map((id) => BENCHMARKS.find((f) => f.id === id));
  if (!fixtures.length || fixtures.some((f) => !f))
    throw new Error("未知基准场景");
  app._benchmarkRunning = true;
  app.suspended = true;
  app._suspendUndo = true;
  app._quietAdd = true;
  app.performance.enabled = true;
  const report = {
    version: 1,
    date: new Date().toISOString(),
    seed: 731,
    hardware: app.performance.hardware(),
    settings: {
      detail: "std",
      postprocessing: "off",
      weather: null,
      width: 960,
      height: 540,
      pixelRatio: 1,
      warmup,
      samples,
      lightQuality: "medium",
    },
    fixtures: [],
    cancelled: false,
    notes: [
      "RAF 间隔含浏览器调度；JS/渲染提交含驱动等待，不是纯 CPU 时间。",
      "GPU 计时仅扩展可用时记录，资源字节是引用估算，不是显存实测。",
      "运行结果只代表本设备 / 浏览器；各场景独立预热，冷帧单列。",
      "场景按顺序运行并复用引擎缓存，构建并非浏览器全冷启动。",
    ],
  };
  try {
    for (const fixture of fixtures) {
      check(signal);
      if (document.hidden)
        throw new Error("请保持基准标签页在前台，后台节流会使结果失真");
      const progress = (event) =>
        onProgress({ fixture: fixture.id, name: fixture.name, ...event });
      progress({ phase: "准备" });
      app.performance.reset();
      const start = performance.now();
      const keys = await build(app, fixture, signal, progress);
      check(signal);
      const buildMs = performance.now() - start;
      const buildOperations = app.performance.snapshot({
        resources: false,
      }).operations;
      app.performance.reset();
      const cold = { ...app.performance.capture(1 / 60, await nextFrame()) };
      for (let i = 0; i < warmup; i++) {
        check(signal);
        app.performance.capture(1 / 60, await nextFrame());
      }
      app.performance.reset();
      const frames = [];
      for (let i = 0; i < samples; i++) {
        check(signal);
        if (document.hidden) throw new Error("基准标签页进入后台，已停止采样");
        progress({ phase: "采样", done: i + 1, total: samples });
        frames.push({ ...app.performance.capture(1 / 60, await nextFrame()) });
      }
      const scene = app.performance.snapshot(),
        row = {
          fixture: { ...fixture },
          assets: keys,
          buildOperations,
          sky: { ...app.lighting.physical.settings },
          camera: {
            fov: app.stage.view.fov,
            position: app.stage.view.position.toArray(),
            target: app.stage.orbit.target.toArray(),
          },
          buildMs,
          cold,
          submit: summarize(frames.map((f) => f.submitMs)),
          interval: summarize(
            frames.map((f) => f.intervalMs).filter((v) => v > 0),
          ),
          calls: summarize(frames.map((f) => f.calls)),
          triangles: summarize(frames.map((f) => f.triangles)),
          snapshot: scene,
        };
      progress({ phase: "保存 / 恢复" });
      let t = performance.now();
      const blob = await app.saveProject();
      row.packMs = performance.now() - t;
      row.archiveBytes = blob.byteLength ?? blob.size;
      check(signal);
      t = performance.now();
      const doc = await unpackProject(blob);
      check(signal);
      app.loadJson(doc);
      row.restoreMs = performance.now() - t;
      if (fixture.id === "terrain") {
        const prev = app.state.terrainTool;
        app.state.terrainTool = "raise";
        app.terrain.setBrush({ size: 8, strength: 0.6 });
        t = performance.now();
        app.terrain.paintAt(35, 25);
        app.bus.emit("terrain");
        app.bus.emit("objects");
        row.terrainEditMs = performance.now() - t;
        app.state.terrainTool = prev;
      }
      report.fixtures.push(row);
      progress({ phase: "完成" });
      await nextFrame();
    }
  } catch (error) {
    if (error.name === "AbortError") report.cancelled = true;
    else report.error = error.message;
  } finally {
    try {
      app.clearAll();
      app.bus.emit("objects");
      app.stage.helperLayer.visible = true;
      app.stage.orbit.enableDamping = true;
      app.stage.resize();
      app.performance.capture();
      report.afterCleanup = app.performance.snapshot();
    } finally {
      app._quietAdd = false;
      app._benchmarkRunning = false;
      app.suspended = false;
      app.performance.pauseFrames();
      app._benchmarkReport = report;
    }
  }
  return report;
}
