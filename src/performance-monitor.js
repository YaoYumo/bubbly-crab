const now = () => performance.now();
export function summarize(values) {
  if (!values.length)
    return { samples: 0, mean: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.ms = null;
    this.pending = null;
    this.active = null;
  }
  begin() {
    const g = this.gl,
      e = this.ext;
    if (!e || g.isContextLost()) return;
    if (g.getParameter(e.GPU_DISJOINT_EXT)) {
      if (this.pending) g.deleteQuery(this.pending);
      this.pending = null;
      this.ms = null;
      return;
    }
    if (
      this.pending &&
      g.getQueryParameter(this.pending, g.QUERY_RESULT_AVAILABLE)
    ) {
      this.ms = g.getQueryParameter(this.pending, g.QUERY_RESULT) / 1e6;
      g.deleteQuery(this.pending);
      this.pending = null;
    }
    if (this.pending || g.getQuery(e.TIME_ELAPSED_EXT, g.CURRENT_QUERY)) return;
    this.active = g.createQuery();
    g.beginQuery(e.TIME_ELAPSED_EXT, this.active);
  }
  end() {
    if (this.active) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending = this.active;
      this.active = null;
    }
  }
}
export function sceneResources(scene) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    attributes = new Set();
  let nodes = 0,
    meshes = 0,
    instances = 0,
    attributeBytes = 0,
    textureBytes = 0;
  const texture = (t) => {
    if (t?.isTexture) textures.add(t);
  };
  scene.traverse((o) => {
    nodes++;
    if (o.isMesh) meshes++;
    if (o.isInstancedMesh) instances += o.count;
    if (o.geometry) geometries.add(o.geometry);
    if (o.instanceMatrix) attributes.add(o.instanceMatrix);
    if (o.instanceColor) attributes.add(o.instanceColor);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      materials.add(m);
      for (const v of Object.values(m)) texture(v);
      for (const u of Object.values(m.uniforms || {})) {
        texture(u.value);
        if (Array.isArray(u.value)) u.value.forEach(texture);
      }
    }
  });
  texture(scene.environment);
  texture(scene.background);
  for (const g of geometries) {
    for (const a of Object.values(g.attributes))
      attributes.add(a.isInterleavedBufferAttribute ? a.data : a);
    if (g.index) attributes.add(g.index);
    for (const list of Object.values(g.morphAttributes || {}))
      list.forEach((a) => attributes.add(a));
  }
  for (const a of attributes) attributeBytes += a.array?.byteLength || 0;
  for (const t of textures) {
    let pixels = 0;
    const images = Array.isArray(t.image) ? t.image : [t.image];
    for (const image of images)
      pixels +=
        (image?.width || image?.image?.width || 0) *
        (image?.height || image?.image?.height || 0) *
        (image?.depth || 1);
    const componentBytes = t.type === 1015 ? 4 : t.type === 1016 ? 2 : 1;
    textureBytes +=
      pixels * 4 * componentBytes * (t.generateMipmaps ? 4 / 3 : 1);
  }
  return {
    nodes,
    meshes,
    instances,
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    attributeBytes,
    textureBytesEstimate: Math.round(textureBytes),
  };
}
/** Bounded diagnostics. All operation durations are inclusive; async operations include waiting. */
export class PerformanceMonitor {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.startup = {
      constructionMs: null,
      firstFrameAtMs: null,
      firstSubmitMs: null,
      readyAtMs: null,
    };
    this.frames = [];
    this.operations = new Map();
    this.recent = [];
    this.gpu = new GpuTimer(app.stage.renderer);
    this.sequence = 0;
    this.resourceSample = null;
    for (const [object, name, label] of [
      [app, "serialize", "工程序列化"],
      [app, "saveProject", "工程打包（异步）"],
      [app, "loadJson", "工程恢复"],
      [app, "refitAll", "物体重新贴地"],
      [app, "rebuildAll", "全部模型重建"],
      [app.terrain, "generate", "地形生成"],
      [app.terrain, "refresh", "地形网格更新"],
      [app.terrain, "refreshSurface", "自动地貌分类"],
      [app.roadTerrain, "sync", "道路网络更新（含采样）"],
      [app.roadTerrain, "terrainAffected", "道路高程变化检测"],
      [app.roadBrush, "_buildRoadMesh", "道路几何构建 / 批处理"],
      [app.roadTerrain, "warp", "道路细分 / 贴地变形"],
      [app.roadTerrain, "updateSupports", "桥墩更新"],
      [app.vegetationBrush, "refit", "植被重新贴地"],
      [app.vegetationBrush, "rebuild", "植被批次重建"],
      [app.lighting.physical, "flush", "天空反射更新"],
    ])
      this.wrap(object, name, label);
  }
  wrap(object, key, label) {
    const old = object?.[key];
    if (typeof old !== "function") return;
    const monitor = this;
    object[key] = function (...args) {
      if (!monitor.enabled) return old.apply(this, args);
      const start = now();
      let asynchronous = false;
      try {
        const value = old.apply(this, args);
        if (value?.then) {
          asynchronous = true;
          return Promise.resolve(value).finally(() =>
            monitor.record(label, now() - start),
          );
        }
        return value;
      } finally {
        if (!asynchronous) monitor.record(label, now() - start);
      }
    };
  }
  record(label, ms) {
    if (!this.operations.has(label) && this.operations.size >= 32)
      this.operations.delete(this.operations.keys().next().value);
    const old = this.operations.get(label) || {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
    };
    old.count++;
    old.totalMs += ms;
    old.maxMs = Math.max(old.maxMs, ms);
    old.lastMs = ms;
    this.operations.set(label, old);
    this.recent.push({ label, ms, at: Date.now() });
    if (this.recent.length > 40) this.recent.shift();
  }
  requestDrawAttribution() {
    this.enabled = true;
    this._attributeNext = true;
  }
  beginAttribution() {
    this.app.modelInstancing?.sync();
    const rows = new Map(),
      restore = [];
    this.app.stage.scene.traverse((o) => {
      if (!o.isMesh) return;
      let node = o,
        category = "天空 / 地面 / 辅助",
        support = false;
      while (node) {
        support ||= !!node.userData.roadSupport;
        if (node.userData.so) {
          category = support ? "道路桥墩" : node.userData.so.type;
          break;
        }
        node = node.parent;
      }
      category = o.userData.renderCategory || category;
      for (const [method, pass] of [
        ["onBeforeRender", "main"],
        ["onBeforeShadow", "shadow"],
      ]) {
        const original = o[method],
          own = Object.hasOwn(o, method);
        if (typeof original !== "function") continue;
        const wrapped = function (...args) {
          let row = rows.get(category);
          if (!row) {
            row = { category, main: 0, shadow: 0 };
            rows.set(category, row);
          }
          row[pass]++;
          return original.apply(this, args);
        };
        o[method] = wrapped;
        restore.push(() => {
          if (o[method] !== wrapped) return;
          if (own) o[method] = original;
          else delete o[method];
        });
      }
    });
    this._attribution = { rows, restore };
    this._attributeNext = false;
  }
  endAttribution(calls) {
    const trace = this._attribution;
    if (!trace) return;
    trace.restore.forEach((fn) => fn());
    this._attribution = null;
    const rows = [...trace.rows.values()].map((r) => ({
      ...r,
      total: r.main + r.shadow,
    }));
    this.drawAttribution = {
      at: new Date().toISOString(),
      calls,
      rows,
      otherCalls: calls - rows.reduce((s, r) => s + r.total, 0),
      note: "单帧 mesh 绘制回调归因，主场景 / 阴影分列；后处理、非 mesh 或本帧新增节点可能未归因，空绘制等会使差额为负。采样有额外开销，非 GPU 耗时。",
    };
  }
  beginFrame(timestamp = now()) {
    if (!this.enabled) return;
    const r = this.app.stage.renderer;
    this.started = now();
    this.frameGap =
      this.lastTimestamp == null ? null : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.previousAutoReset = r.info.autoReset;
    r.info.autoReset = false;
    r.info.reset();
    this.gpu.begin();
    if (this._attributeNext) this.beginAttribution();
  }
  endFrame(stepMs, renderMs) {
    if (this.started == null) return;
    const r = this.app.stage.renderer;
    this.gpu.end();
    r.info.autoReset = this.previousAutoReset;
    const frame = {
      stepMs,
      renderMs,
      submitMs: now() - this.started,
      intervalMs: this.frameGap,
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      points: r.info.render.points,
      lines: r.info.render.lines,
    };
    if (this.startup.firstFrameAtMs == null) {
      this.startup.firstFrameAtMs = now();
      this.startup.firstSubmitMs = frame.submitMs;
    }
    this.endAttribution(frame.calls);
    this.frames.push(frame);
    if (this.frames.length > 240) this.frames.shift();
    this.sequence++;
    this.started = null;
  }
  pauseFrames() {
    this.lastTimestamp = null;
  }
  capture(dt = 1 / 60, timestamp = now()) {
    this.beginFrame(timestamp);
    let step, render;
    try {
      let t = now();
      this.app.step(dt);
      this.app.weather?.update(dt, this.app.stage.view.position);
      step = now() - t;
      t = now();
      this.app.stage.render();
      render = now() - t;
    } finally {
      this.endFrame(step || 0, render || 0);
    }
    return this.frames.at(-1);
  }
  snapshot({ resources = true } = {}) {
    const r = this.app.stage.renderer;
    if (resources) this.resourceSample = sceneResources(this.app.stage.scene);
    const intervals = this.frames
        .map((f) => f.intervalMs)
        .filter((v) => Number.isFinite(v) && v > 0),
      interval = summarize(intervals),
      last = this.frames.at(-1) || null;
    return {
      version: 1,
      startup: { ...this.startup },
      at: new Date().toISOString(),
      enabled: this.enabled,
      sequence: this.sequence,
      frame: {
        interval,
        submit: summarize(this.frames.map((f) => f.submitMs)),
        step: summarize(this.frames.map((f) => f.stepMs)),
        render: summarize(this.frames.map((f) => f.renderMs)),
        fps: interval.mean ? 1000 / interval.mean : null,
        last,
      },
      gpu: { supported: !!this.gpu.ext, lastMs: this.gpu.ms },
      renderer: {
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programs: r.info.programs?.length || 0,
      },
      scene: this.resourceSample,
      drawAttribution: this.drawAttribution || null,
      modelInstances: {
        enabled: this.app.modelInstancing.enabled,
        ...this.app.modelInstancing.stats,
      },
      renderEffects: this.app.renderEffects.snapshot(),
      picking: {
        enabled: this.app.stage.pickIndex.enabled,
        dirty: this.app.stage.pickIndex.dirty,
        last: this.app.stage.pickIndex.stats,
      },
      roads: {
        lastSync: this.app.roadTerrain.lastSync || null,
        supportBuilds: this.app.roadTerrain.supportBuilds || 0,
        supportCacheHits: this.app.roadTerrain.supportCacheHits || 0,
      },
      heapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      lights: { ...this.app.localLights.stats },
      viewport: {
        width: r.domElement.width,
        height: r.domElement.height,
        pixelRatio: r.getPixelRatio(),
        detail: this.app.state.detail,
      },
      operations: [...this.operations].map(([label, v]) => ({
        label,
        ...v,
        meanMs: v.totalMs / v.count,
      })),
      recent: [...this.recent],
    };
  }
  reset() {
    this.drawAttribution = null;
    this._attributeNext = false;
    this.frames.length = 0;
    this.operations.clear();
    this.recent.length = 0;
    this.lastTimestamp = null;
  }
  hardware() {
    const gl = this.app.stage.renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      renderer: gl.getParameter(
        ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
      ),
      vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      visibility: document.visibilityState,
    };
  }
}
