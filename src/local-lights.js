import * as THREE from "three";
import { kelvinColor } from "./camera-color.js";
import { nightAmount } from "./physical-sky.js";
import { clamp } from "./util.js";
export const LIGHT_BUDGETS = {
  low: { lights: 4, shadows: 0, distance: 45, map: 256 },
  medium: { lights: 8, shadows: 1, distance: 70, map: 512 },
  high: { lights: 12, shadows: 2, distance: 100, map: 512 },
};
const TYPES = new Set(["street_lamp", "lanternpole", "lamp"]);
export const isLuminaire = (so) => TYPES.has(so?.type);
export function lampSettings(so) {
  const street = so.type === "street_lamp",
    p = so.params?.light || {};
  const num = (k, d, lo, hi) =>
    Number.isFinite(Number(p[k])) ? clamp(Number(p[k]), lo, hi) : d;
  return {
    mode: ["auto", "on", "off"].includes(p.mode) ? p.mode : "auto",
    illuminate: p.illuminate !== false,
    lumens: num("lumens", street ? 1500 : 220, 0, 10000),
    range: num("range", street ? 25 : 12, 2, 60),
    temperature: num("temperature", street ? 4000 : 2600, 1500, 10000),
    modelColor: p.modelColor ?? !street,
    emission: num(
      "emission",
      Number.isFinite(Number(so.params?.glow)) ? Number(so.params.glow) : 1.5,
      0,
      8,
    ),
    shadow: p.shadow !== false,
  };
}
function anchors(so) {
  const p = so.params;
  return so.type === "street_lamp"
    ? [{ p: [0.7, (p.poleHeight || 6) - 0.22, 0], weight: 1 }]
    : so.type === "lanternpole"
      ? [
          { p: [1.9, (p.height || 4.2) - 0.38, 0], weight: 0.45 },
          { p: [-0.95, (p.height || 4.2) + 0.06, 0], weight: 0.55 },
        ]
      : [{ p: [0, (p.h || 1.7) + 0.35, 0], weight: 1 }];
}
export class LocalLights {
  constructor(app) {
    this.app = app;
    this.enabled = true;
    this.quality = "medium";
    this.prepared = new WeakMap();
    this.entries = [];
    this.activeIds = new Set();
    this.group = new THREE.Group();
    this.group.name = "budgeted-local-lights";
    this.group.userData.pickIgnore = true;
    app.stage.scene.add(this.group);
    this.pool = [];
    app.bus.on("objects", () => this.sync());
    app.bus.on("light", () => this.sync());
    this.setQuality("medium");
  }
  prepare(so) {
    if (this.prepared.has(so.root)) return this.prepared.get(so.root);
    // Per-instance emitters: never edit shared library glow materials.
    this.app.appearance.release(so.root);
    const clones = new Map();
    const clone = (m) => {
      if (!m?.emissive || m.emissive.getHex() === 0) return m;
      if (!clones.has(m)) clones.set(m, m.clone());
      return clones.get(m);
    };
    so.root.traverse((o) => {
      if (o.material) {
        const src = Array.isArray(o.material) ? o.material : [o.material];
        if (src.some((m) => m?.emissive?.getHex() > 0)) o.castShadow = false;
        o.material = Array.isArray(o.material)
          ? o.material.map(clone)
          : clone(o.material);
      }
    });
    so.root.traverse((o) => {
      if (o.userData?.glow)
        o.userData.glow = o.userData.glow.map((m) => clones.get(m) || m);
    });
    const state = { materials: [...clones.values()], signature: null };
    this.prepared.set(so.root, state);
    this.app.appearance.apply(so);
    return state;
  }
  sync() {
    if (this.app._clearingScene) return;
    this.entries = (
      !this.enabled && this.app.lighting.mode === "legacy"
        ? []
        : this.app.objects.filter(isLuminaire)
    ).map((so) => ({ so, anchors: anchors(so), state: this.prepare(so) }));
    this.tick(true);
    this.app.lighting.physical.color.patchAll();
  }
  setQuality(q) {
    this.quality = LIGHT_BUDGETS[q] ? q : "medium";
    const budget = LIGHT_BUDGETS[this.quality];
    if (this.pool.length !== budget.lights) {
      for (const light of this.pool) {
        light.dispose();
        this.group.remove(light);
      }
      this.pool = [];
      for (let i = 0; i < budget.lights; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 1, 2);
        light.userData.pickIgnore = true;
        light.castShadow = i < budget.shadows;
        light.shadow.mapSize.setScalar(budget.map);
        light.shadow.camera.near = 0.08;
        light.shadow.normalBias = 0.025;
        light.shadow.bias = -0.00015;
        light.shadow.autoUpdate = false;
        this.pool.push(light);
        this.group.add(light);
      }
    }
    this.tick(true);
  }
  factor(settings) {
    if (settings.mode === "off") return 0;
    if (settings.mode === "on") return 1;
    const L = this.app.lighting;
    return L.mode === "physical"
      ? nightAmount(L.physical.elevation ?? L.physical.position().elevation)
      : clamp((L.p.glow || 0) / 2, 0, 1);
  }
  tick(force = false) {
    const a = this.app,
      L = a.lighting,
      allowed = this.enabled && L.enabled && !a.stage.perfMode,
      budget = LIGHT_BUDGETS[this.quality],
      candidates = [];
    let emitting = 0;
    for (const entry of this.entries) {
      const { so, state } = entry;
      if (so.root.parent !== a.stage.world) continue;
      const s = lampSettings(so),
        factor = so.visible !== false && so.root.visible ? this.factor(s) : 0;
      const color =
        s.modelColor && so.params.color
          ? new THREE.Color(so.params.color)
          : kelvinColor(s.temperature);
      // Emissive surfaces stay visible beyond the realtime light budget. Off is truly off.
      const signature = [factor, s.emission, color.getHex()].join("|");
      if (
        (this.enabled || L.mode === "physical") &&
        (force || state.signature !== signature)
      ) {
        for (const mat of state.materials) {
          mat.emissive.copy(color);
          mat.emissiveIntensity = s.emission * factor;
        }
        state.signature = signature;
        a.appearance.apply(so);
      }
      if (!allowed || !factor || !s.illuminate || s.lumens <= 0) continue;
      so.root.updateWorldMatrix(true, false);
      for (let i = 0; i < entry.anchors.length; i++) {
        const anchor = entry.anchors[i],
          position = new THREE.Vector3(...anchor.p).applyMatrix4(
            so.root.matrixWorld,
          ),
          d = position.distanceTo(a.stage.view.position),
          id = so.id + ":" + i;
        emitting++;
        const limit = Math.min(budget.distance, s.range + 40);
        if (d > limit) continue;
        const fade = 1 - THREE.MathUtils.smoothstep(d, limit - 10, limit);
        candidates.push({
          id,
          so,
          settings: s,
          factor: factor * fade,
          color,
          position,
          weight: anchor.weight,
          d,
          score: d * (this.activeIds.has(id) ? 0.85 : 1),
        });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const chosen = candidates.slice(0, budget.lights);
    // Shadow-enabled emitters occupy fixed shadow slots. Light count remains stable while moving.
    chosen.sort(
      (a, b) =>
        Number(b.settings.shadow) - Number(a.settings.shadow) ||
        a.score - b.score,
    );
    this.activeIds = new Set(chosen.map((c) => c.id));
    this.group.visible = allowed && chosen.length > 0;
    let shadows = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i],
        c = chosen[i];
      light.intensity = 0;
      light.shadow.needsUpdate = false;
      light.userData.fixtureId = null;
      if (!c) continue;
      light.position.copy(c.position);
      light.color.copy(c.color);
      light.distance = c.settings.range;
      light.decay = 2;
      light.power = c.settings.lumens * c.weight * c.factor;
      light.userData.fixtureId = c.so.id;
      const wantsShadow =
        a.stage.renderer.shadowMap.enabled &&
        light.castShadow &&
        c.settings.shadow &&
        (L.mode !== "physical" || L.physical.settings.shadows);
      // Keep the same shader shadow slots, but mask an unrequested shadow with an empty range map.
      light.shadow.intensity = wantsShadow ? 1 : 0;
      if (wantsShadow) {
        light.shadow.needsUpdate = true;
        shadows++;
      }
    }
    this.stats = {
      active: allowed ? chosen.length : 0,
      shadows: allowed ? shadows : 0,
      budget: budget.lights,
      emitters: emitting,
      culled: Math.max(0, emitting - chosen.length),
    };
    a.stage.view.invalidate?.();
  }
  configure(patch) {
    if ("enabled" in patch) {
      this.enabled = !!patch.enabled;
      if (!this.enabled && this.app.lighting.mode === "legacy") {
        this.app.lighting.applyGlow();
        this.app.appearance.applyAll();
      }
    }
    if (patch.quality) this.setQuality(patch.quality);
    this.sync();
  }
  setLamp(so, patch) {
    so = this.app.byId(so?.id);
    if (!so || so.locked || !isLuminaire(so)) return false;
    this.app.beginOp("灯具照明参数");
    so.params.light = { ...lampSettings(so), ...patch };
    this.sync();
    this.app.saveLocal();
    return true;
  }
  toJSON() {
    return { enabled: this.enabled, quality: this.quality };
  }
  fromJSON(j) {
    this.enabled = j?.enabled === true;
    this.setQuality(j?.quality || "medium");
    this.sync();
  }
}
