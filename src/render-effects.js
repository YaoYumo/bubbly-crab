import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SelectiveBloomPass, bloomSelection } from "./selective-bloom.js";
import { RenderLOD, lodSettings } from "./render-lod.js";

export const BLOOM_DEFAULTS = Object.freeze({
  enabled: false,
  strength: 0.35,
  radius: 0.25,
  threshold: 1.1,
  quality: "medium",
  mode: "all",
  windows: true,
});
const number = (v, d, min, max) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : d;
export function bloomSettings(v = {}) {
  if (!v || typeof v !== "object") v = {};
  return {
    enabled: v.enabled === true,
    mode: v.mode === "selective" ? "selective" : "all",
    windows: v.windows !== false,
    strength: number(v.strength, 0.35, 0, 2),
    radius: number(v.radius, 0.25, 0, 1),
    threshold: number(v.threshold, 1.1, 0, 10),
    quality: ["low", "medium", "high"].includes(v.quality)
      ? v.quality
      : "medium",
  };
}
export class RenderEffects {
  constructor(app) {
    this.app = app;
    this.stage = app.stage;
    this.stage.effects = this;
    this.lod = new RenderLOD(app);
    this.bloom = { ...BLOOM_DEFAULTS };
    this.pass = null;
  }
  configure(value = {}, { replace = false } = {}) {
    if (!value || typeof value !== "object") value = {};
    this.lod.configure(
      replace ? lodSettings(value.lod) : { ...this.lod.settings, ...value.lod },
    );
    const oldMode = this.bloom.mode;
    this.bloom = bloomSettings(
      replace ? value.bloom : { ...this.bloom, ...value.bloom },
    );
    if (oldMode !== this.bloom.mode || !this.bloom.enabled || this.bloom.strength === 0) this.releaseBloom();
  }
  setObject(so, patch) {
    if (!so || so.locked || !this.app.objects.includes(so)) return false;
    this.app.beginOp("修改选择性泛光");
    so.params.bloomSelection = bloomSelection({ ...bloomSelection(so.params.bloomSelection), ...patch });
    this.app.bus.emit("bloom-selection", so);
    this.app.bus.emit("select");
    this.app.saveLocal();
    return true;
  }
  toJSON() {
    return { lod: { ...this.lod.settings }, bloom: { ...this.bloom } };
  }
  releaseBloom() {
    if (this.pass) {
      this.stage.composer.removePass(this.pass);
      this.pass.materialHighPassFilter.dispose();
      this.pass.dispose();
      this.pass = null;
    }
  }
  prepare() {
    const b = this.bloom;
    this.blockedReason =
      b.enabled && b.strength > 0
        ? this.stage.perfMode
          ? "低内存 Basic 模式暂停 Bloom"
          : !this.stage.renderer.extensions.has("EXT_color_buffer_float")
            ? "当前设备缺少 HDR 颜色附件支持，已跳过 Bloom"
            : null
        : null;
    const active = b.enabled && b.strength > 0 && !this.blockedReason;
    if (!active) {
      this.releaseBloom();
      return;
    }
    if (!this.pass) {
      const p = (this.pass = b.mode === "selective" ? new SelectiveBloomPass(this) : new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        b.strength,
        b.radius,
        b.threshold,
      ));
      const resize = p.setSize.bind(p);
      // Composer target stays full resolution; only the glow pyramid is scaled.
      if (b.mode !== "selective") p.setSize = (w, h) => {
        const scale = { low: 0.25, medium: 0.5, high: 1 }[this.bloom.quality];
        resize(
          Math.max(2, Math.round(w * scale)),
          Math.max(2, Math.round(h * scale)),
        );
      };
      const composer = this.stage.composer;
      composer.insertPass(
        p,
        composer.passes.indexOf(this.stage.anamorphicPass),
      );
      this.quality = null;
    }
    Object.assign(this.pass, {
      strength: b.strength,
      radius: b.radius,
      threshold: b.threshold,
      enabled: true,
    });
    if (this.quality !== b.quality) {
      this.quality = b.quality;
      const size =
        this.stage.postSize ??
        this.stage.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.pass.setSize(size.x, size.y);
    }
  }
  begin(camera) {
    // Build render batches from original geometry and visibility, before LOD edits.
    if (this.lod.settings.enabled) this.app.modelInstancing.sync();
    this.lod.enter(camera, this.lod.settings.enabled);
  }
  end() {
    this.lod.exit();
  }
  dispose() {
    this.bloom.enabled = false;
    this.lod.configure({ enabled: false });
    this.releaseBloom();
    this.blockedReason = null;
  }
  snapshot() {
    return {
      lod: {
        settings: { ...this.lod.settings },
        ...this.lod.stats,
        geometryBytes: this.lod.bytes ?? 0,
        cachedGeometries: this.lod.cache.size,
        pending: this.lod.work.jobs.size,
        idle: { ...this.lod.work.stats },
      },
      bloom: {
        ...this.bloom,
        active: !!this.pass,
        selection: this.pass?.selectionTarget ? {
          ...this.pass.stats,
          width: this.pass.selectionTarget.width, height: this.pass.selectionTarget.height,
          estimatedTargetBytes: this.pass.selectionTarget.width * this.pass.selectionTarget.height * 12,
          materialVariants: [...this.pass.variants.values()].reduce((n, group) => n + group.values.size, 0),
        } : null,
        blockedReason: this.blockedReason ?? null,
        glowWidth: this.pass?.renderTargetBright.width ?? 0,
        glowHeight: this.pass?.renderTargetBright.height ?? 0,
      },
    };
  }
}
