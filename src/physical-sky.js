import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { CameraColor, kelvinColor } from "./camera-color.js";
import { clamp } from "./util.js";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const SKY_DEFAULTS = {
  source: "manual",
  sunElev: 48,
  sunAzim: 135,
  date: today(),
  hour: 12,
  latitude: 0,
  longitude: 0,
  timezone: 0,
  north: 0,
  turbidity: 3,
  rayleigh: 2,
  mie: 0.005,
  mieG: 0.8,
  energy: 1,
  environment: 0.65,
  ev: 0,
  whiteBalance: 6500,
  fog: 0.001,
  shadows: true,
  quality: "medium",
};
const limits = {
  sunElev: [-90, 90],
  sunAzim: [0, 360],
  hour: [0, 23.99],
  latitude: [-89.9, 89.9],
  longitude: [-180, 180],
  timezone: [-12, 14],
  north: [0, 360],
  turbidity: [1, 20],
  rayleigh: [0.1, 4],
  mie: [0.0001, 0.05],
  mieG: [0, 0.98],
  energy: [0, 4],
  environment: [0, 2],
  ev: [-6, 6],
  whiteBalance: [2000, 12000],
  fog: [0, 0.02],
};
export function cleanSky(input = {}) {
  const s = { ...SKY_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    const v = Number(input[k]);
    if (Number.isFinite(v)) s[k] = clamp(v, lo, hi);
  }
  if (["manual", "date"].includes(input.source)) s.source = input.source;
  if (["low", "medium", "high"].includes(input.quality))
    s.quality = input.quality;
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") &&
    Number.isFinite(Date.parse(input.date)) &&
    new Date(input.date).toISOString().slice(0, 10) === input.date
  )
    s.date = input.date;
  if (typeof input.shadows === "boolean") s.shadows = input.shadows;
  return s;
}
/** Geometric solar position, azimuth clockwise from north. No geolocation/network request. */
export function solarPosition(s) {
  const ms =
    Date.parse(s.date + "T00:00:00Z") + (s.hour - s.timezone) * 3600000;
  const d = ms / 86400000 + 2440587.5 - 2451545,
    rad = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * rad,
    q = (280.459 + 0.98564736 * d) * rad;
  const lambda = q + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad,
    e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(lambda), Math.cos(lambda)),
    dec = Math.asin(Math.sin(e) * Math.sin(lambda));
  const ha = (280.16 + 360.9856235 * d + s.longitude) * rad - ra,
    lat = s.latitude * rad;
  const elevation =
    Math.asin(
      clamp(
        Math.sin(lat) * Math.sin(dec) +
          Math.cos(lat) * Math.cos(dec) * Math.cos(ha),
        -1,
        1,
      ),
    ) / rad;
  const azimuth =
    (((Math.atan2(
      Math.sin(ha),
      Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
    ) /
      rad +
      180 +
      s.north) %
      360) +
      360) %
    360;
  return { elevation, azimuth };
}
export function sunDirection(elevation, azimuth) {
  const el = (elevation * Math.PI) / 180,
    az = (azimuth * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  );
}
export const nightAmount = (elevation) =>
  1 - THREE.MathUtils.smoothstep(elevation, -3, 5);

export class PhysicalSky {
  constructor(lighting) {
    this.lighting = lighting;
    this.stage = lighting.stage;
    this.settings = cleanSky();
    this.color = new CameraColor(this.stage);
    this.mesh = this.makeSky();
    this.mesh.name = "physical-atmosphere";
    this.mesh.renderOrder = -1100;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (r, s, c) => {
      c.getWorldPosition(this.mesh.position);
      this.mesh.updateMatrixWorld(true);
    };
    this.stage.scene.add(this.mesh);
    this.captureScene = new THREE.Scene();
    this.captureSky = this.makeSky(true);
    this.captureScene.add(this.captureSky);
    this.stage.environmentProvider = this;
    this.bakes = 0;
    this.dirty = true;
    this.lastKey = null;
  }
  get active() {
    return this.lighting.mode === "physical";
  }
  makeSky(capture = false) {
    const sky = new Sky();
    sky.scale.setScalar(1800);
    sky.material.depthWrite = false;
    // Sun disc appears in the background; direct sunlight owns its energy and shadow.
    // Exclude the disc from IBL to avoid a second unshadowed sun.
    if (capture)
      sky.material.fragmentShader = sky.material.fragmentShader.replace(
        "L0 += ( vSunE * 19000.0 * Fex ) * sundisk;",
        "",
      );
    sky.material.uniforms.previzSkyEnergy = { value: 1 };
    sky.material.fragmentShader =
      "uniform float previzSkyEnergy;\n" +
      sky.material.fragmentShader.replace(
        "vec4( retColor, 1.0 )",
        "vec4( retColor * previzSkyEnergy, 1.0 )",
      );
    return sky;
  }
  configure(patch) {
    this.settings = cleanSky({ ...this.settings, ...patch });
    this.lighting.update();
  }
  position() {
    const s = this.settings;
    return s.source === "date"
      ? solarPosition(s)
      : { elevation: s.sunElev, azimuth: s.sunAzim };
  }
  update() {
    const L = this.lighting,
      st = this.stage,
      s = this.settings,
      { elevation, azimuth } = this.position(),
      on = L.enabled && !st.perfMode;
    const dir = sunDirection(elevation, azimuth);
    this.direction = dir;
    this.elevation = elevation;
    this.azimuth = azimuth;
    this.mesh.visible = on;
    st.sky.visible = !on;
    if (st._envTimer) {
      clearTimeout(st._envTimer);
      st._envTimer = 0;
    }
    const daylight = THREE.MathUtils.smoothstep(elevation, -12, -3);
    for (const sky of [this.mesh, this.captureSky]) {
      const u = sky.material.uniforms;
      u.sunPosition.value.copy(dir);
      u.turbidity.value = s.turbidity;
      u.rayleigh.value = s.rayleigh;
      u.mieCoefficient.value = s.mie;
      u.mieDirectionalG.value = s.mieG;
      u.previzSkyEnergy.value = s.energy * daylight;
    }
    L.sun.position.copy(dir).multiplyScalar(140);
    L.sun.target.position.set(0, 0, 0);
    L.sun.color.copy(
      kelvinColor(2200 + 4300 * THREE.MathUtils.smoothstep(elevation, 0, 35)),
    );
    L.sun.intensity = on
      ? s.energy *
        3.5 *
        THREE.MathUtils.smoothstep(elevation, 0, 12) *
        Math.exp(-Math.max(0, s.turbidity - 2) * 0.035)
      : 0;
    L.sun.castShadow = !!(on && s.shadows && elevation > 0 && s.energy > 0);
    for (const light of [L.fill, L.rim, L.amb, L.hemi]) light.intensity = 0;
    if (!on) {
      L.amb.intensity = 1.35;
      L.amb.color.set(0xffffff);
    }
    st.renderer.shadowMap.enabled = !!(on && s.shadows);
    st.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const size = s.quality === "low" ? 1024 : 2048;
    if (L.sun.shadow.mapSize.x !== size) {
      L.sun.shadow.map?.dispose();
      L.sun.shadow.map = null;
      L.sun.shadow.mapSize.setScalar(size);
    }
    const range = s.quality === "high" ? 150 : 100,
      sc = L.sun.shadow.camera;
    sc.left = sc.bottom = -range;
    sc.right = sc.top = range;
    sc.near = 1;
    sc.far = 600;
    sc.updateProjectionMatrix();
    L.sun.shadow.normalBias = 0.05 + (range / size) * 0.4;
    L.sun.shadow.bias = -0.0002;
    this.applyExposure();
    this.color.setWhiteBalance(s.whiteBalance);
    L.fog.color
      .set(elevation < 0 ? 0x172438 : 0xaec5db)
      .lerp(L.sun.color, Math.max(0, 1 - Math.abs(elevation) / 20) * 0.45);
    L.fog.color.multiplyScalar(s.energy * Math.max(0.01, daylight));
    L.fog.density = on ? s.fog : 0;
    st.scene.fog = L.fog;
    L.p = {
      ...L.params(),
      sunElev: elevation,
      sunAzim: azimuth,
      envInt: s.environment,
      shadow: s.shadows,
      glow: nightAmount(elevation) * 2,
    };
    L.applyGlow(L.p.glow);
    const key = JSON.stringify([
      elevation,
      azimuth,
      s.turbidity,
      s.rayleigh,
      s.mie,
      s.mieG,
      s.energy,
    ]);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.dirty = true;
    }
    if (on) {
      st.envOn = true;
      this.schedule();
    } else this.cancelTimer();
    this.restoreEnvironment();
    st.view.invalidate?.();
    L.emitChange();
  }
  anchorSun(preview = false) {
    if (!this.active || !this.direction) return;
    const target = this.lighting.sun.target.position;
    if (preview) {
      this.stage.view.getWorldDirection(target);
      target.multiplyScalar(40).add(this.stage.view.position);
    } else target.copy(this.stage.orbit.target);
    this.lighting.sun.position
      .copy(this.direction)
      .multiplyScalar(180)
      .add(target);
  }
  applyExposure() {
    this.stage.renderer.toneMappingExposure =
      Math.pow(2, this.settings.ev) * this.lighting.isoMultiplier;
  }
  schedule() {
    if (
      !this.active ||
      !this.lighting.enabled ||
      this.stage.perfMode ||
      !this.dirty
    )
      return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.flush();
    }, 220);
  }
  cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
  }
  restoreEnvironment() {
    if (!this.active) return;
    const st = this.stage,
      on = this.lighting.enabled && !st.perfMode && st.envOn !== false;
    st.scene.environmentIntensity = on ? this.settings.environment : 0;
    st.scene.environment = on && this.target ? this.target.texture : null;
  }
  flush() {
    this.cancelTimer();
    if (
      !this.active ||
      !this.lighting.enabled ||
      this.stage.perfMode ||
      !this.dirty
    )
      return;
    const r = this.stage.renderer,
      viewport = r.getViewport(new THREE.Vector4()),
      scissor = r.getScissor(new THREE.Vector4()),
      test = r.getScissorTest(),
      target = r.getRenderTarget(),
      face = r.getActiveCubeFace(),
      mip = r.getActiveMipmapLevel();
    try {
      r.setScissorTest(false);
      const next = this.color.neutral(() =>
        this.lighting.pmrem.fromScene(this.captureScene, 0, 0.1, 3000),
      );
      const old = this.target;
      this.target = next;
      this.dirty = false;
      this.bakes++;
      this.restoreEnvironment();
      old?.dispose();
    } finally {
      r.setRenderTarget(target, face, mip);
      r.setViewport(viewport);
      r.setScissor(scissor);
      r.setScissorTest(test);
    }
    this.stage.view.invalidate?.();
  }
  deactivate() {
    this.cancelTimer();
    this.mesh.visible = false;
    this.stage.sky.visible = true;
    this.stage.scene.environment = this.stage.envOn
      ? this.stage.envRT?.texture || this.lighting._envRT?.texture || null
      : null;
    this.color.setWhiteBalance(6500);
  }
  toJSON() {
    return { ...this.settings };
  }
  fromJSON(j) {
    this.settings = cleanSky(j || {});
    this.lastKey = null;
    this.dirty = true;
  }
}
