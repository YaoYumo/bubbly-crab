import * as THREE from "three";
import { kelvinColor } from "./camera-color.js";
import { nightAmount } from "./physical-sky.js";

export const WINDOW_DEFAULTS = Object.freeze({
  mode: "legacy",
  ratio: 0.65,
  seed: 1,
  temperature: 3000,
  intensity: 2,
});
const modes = new Set(["legacy", "auto", "on", "off"]);
export function windowSettings(input = {}, base = WINDOW_DEFAULTS) {
  const out = { ...base };
  if (modes.has(input.mode)) out.mode = input.mode;
  for (const [key, lo, hi, integer] of [
    ["ratio", 0, 1],
    ["seed", 0, 2147483647, true],
    ["temperature", 1500, 10000],
    ["intensity", 0, 8],
  ]) {
    if (
      input[key] == null ||
      input[key] === "" ||
      typeof input[key] === "boolean"
    )
      continue;
    const v = Number(input[key]);
    if (Number.isFinite(v))
      out[key] = Math.max(lo, Math.min(hi, integer ? Math.round(v) : v));
  }
  return out;
}
export function windowRandom(id, seed, key) {
  let h = 2166136261;
  for (const c of `${id}|${seed}|${key}`)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export const supportsWindows = (so) =>
  !!so?.item &&
  ["house", "suburban", "functional", "building"].includes(so.item.catId) &&
  !so.isChar;
// Existing library metadata only. No inference on imported glass, cars, water or signs.
export function windowSurface(so, material) {
  if (!supportsWindows(so) || !material?.isMeshStandardMaterial) return false;
  if (
    material.userData.role === "glass" ||
    material.userData.detail === "glass"
  )
    return true;
  if (so.item.catId !== "building") return false;
  const hex = material.color?.getHex();
  return (
    (
      {
        tower: [0x4e6b7c],
        cluster: [0x56707f],
        residential: [0x5f7686],
        shophouse: [0x87b6cf, 0x60788a],
        house: [0x88aacc],
      }[so.type] || []
    ).includes(hex) && material.roughness <= 0.21
  );
}
function sourceHooks(app, mat) {
  const rec = app.lighting.physical.color.sources.get(mat);
  return rec &&
    rec.wrapper === mat.onBeforeCompile &&
    rec.wrapperCache === mat.customProgramCacheKey
    ? { compile: rec.compile, cache: rec.cache }
    : { compile: mat.onBeforeCompile, cache: mat.customProgramCacheKey };
}
const vertexHeader = `varying vec3 vWindowPosition;
varying vec3 vWindowNormal;
varying float vWindowRoom;
uniform mat4 windowObject;
uniform mat3 windowNormal;
uniform float windowSeed;
float windowHash(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,37.719))+windowSeed)*43758.5453); }
`;
const vertexBody = `vec4 windowP=vec4(position,1.0);
#ifdef USE_INSTANCING
windowP=instanceMatrix*windowP;
vWindowRoom=windowHash(instanceMatrix[3].xyz);
#else
vWindowRoom=windowHash(vec3(0.0));
#endif
vWindowPosition=(windowObject*windowP).xyz;
vWindowNormal=windowNormal*normal;
`;
const fragmentHeader = `varying vec3 vWindowPosition;
varying vec3 vWindowNormal;
varying float vWindowRoom;
uniform float windowSeed;
uniform float windowRatio;
uniform float windowGrid;
uniform float windowIntensity;
uniform vec3 windowColor;
float windowHash(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,37.719))+windowSeed)*43758.5453); }
`;
const fragmentBody = `float windowMask=step(vWindowRoom,windowRatio)*step(0.000001,windowRatio);
if(windowGrid>0.5){
 vec3 wn=normalize(vWindowNormal);vec3 an=abs(wn);
 float horizontal=an.x>an.z?vWindowPosition.z:vWindowPosition.x;
 vec2 room=vec2(horizontal/2.6,vWindowPosition.y/3.1);
 float face=an.x>an.z?sign(wn.x):2.0*sign(wn.z);
 float randomRoom=windowHash(vec3(floor(room),face));
 vec2 inside=fract(room);
 windowMask=step(randomRoom,windowRatio)*step(0.000001,windowRatio)*step(.12,inside.x)*step(inside.x,.88)*step(.18,inside.y)*step(inside.y,.82)*(1.0-step(.7,an.y));
}
totalEmissiveRadiance+=windowColor*windowIntensity*windowMask;
`;
export class WindowLights {
  constructor(app) {
    this.app = app;
    this.settings = { ...WINDOW_DEFAULTS };
    this.states = new Map();
    this.variants = new WeakSet();
    this.stats = { roots: 0, units: 0, selected: 0, procedural: 0 };
    for (const event of ["objects", "light"])
      app.bus.on(event, () => this.sync());
  }
  toJSON() {
    return { ...this.settings };
  }
  fromJSON(input) {
    this.settings = windowSettings(input || {});
    this.sync();
  }
  configure(patch) {
    this.settings = windowSettings(patch, this.settings);
    this.sync();
    this.app.bus.emit("window-lighting");
  }
  resolved(so) {
    const local = so.params?.windowLighting;
    return local?.mode && local.mode !== "inherit"
      ? windowSettings(local, this.settings)
      : this.settings;
  }
  setObject(so, patch) {
    if (!supportsWindows(so) || so.locked || !this.app.objects.includes(so))
      return false;
    this.app.beginOp("修改此建筑窗灯");
    if (patch.mode === "inherit") delete so.params.windowLighting;
    else so.params.windowLighting = windowSettings(patch, this.resolved(so));
    this.sync();
    this.app.bus.emit("window-lighting");
    this.app.saveLocal();
    return true;
  }
  hooksFor(mat) {
    return this.variants.has(mat) ? sourceHooks(this.app, mat) : null;
  }
  clone(source, state) {
    const mat = source.clone(),
      hooks = sourceHooks(this.app, source);
    mat.onBeforeCompile = hooks.compile;
    mat.customProgramCacheKey = hooks.cache;
    this.variants.add(mat);
    state.materials.add(mat);
    return mat;
  }
  prepare(so) {
    const app = this.app;
    app.appearance.release(so.root);
    so.root.updateWorldMatrix(true, true);
    const inv = so.root.matrixWorld.clone().invert();
    const state = {
      so,
      root: so.root,
      slots: [],
      materials: new Set(),
      normal: new Map(),
      gpu: [],
      signature: null,
      selection: null,
    };
    so.root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isSkinnedMesh) return;
      const originals = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      if (!originals.some((m) => windowSurface(so, m))) return;
      let group = mesh;
      for (
        let parent = mesh.parent;
        parent && parent !== so.root;
        parent = parent.parent
      )
        if (parent.userData.role === "window") {
          group = parent;
          break;
        }
      const relative = new THREE.Matrix4().multiplyMatrices(
          inv,
          group.matrixWorld,
        ),
        key = relative.elements
          .map((v, i) =>
            i >= 12 && i < 15
              ? Math.round(v * 1000)
              : i < 12
                ? Math.round(v * 1000)
                : v,
          )
          .join(",");
      const slot = {
        mesh,
        original: mesh.material,
        parts: originals.map((source) => {
          if (!windowSurface(so, source)) return { source };
          const grid =
            so.item.catId === "building" &&
            ["tower", "cluster", "residential", "shophouse"].includes(so.type);
          if (mesh.isInstancedMesh || grid) {
            const mat = this.clone(source, state),
              hooks = sourceHooks(app, mat),
              cache = hooks.cache.call(mat);
            const object = new THREE.Matrix4().multiplyMatrices(
              inv,
              mesh.matrixWorld,
            );
            const uniforms = {
              windowObject: { value: object },
              windowNormal: {
                value: new THREE.Matrix3().getNormalMatrix(object),
              },
              windowSeed: { value: 0 },
              windowRatio: { value: 0 },
              windowGrid: { value: grid ? 1 : 0 },
              windowIntensity: { value: 0 },
              windowColor: { value: new THREE.Color() },
            };
            mat.emissive.set(0);
            mat.emissiveIntensity = 0;
            mat.onBeforeCompile = function (shader, renderer) {
              hooks.compile.call(this, shader, renderer);
              Object.assign(shader.uniforms, uniforms);
              shader.vertexShader = vertexHeader + shader.vertexShader;
              shader.vertexShader = shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n" + vertexBody,
              );
              shader.fragmentShader = fragmentHeader + shader.fragmentShader;
              shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\n" + fragmentBody,
              );
            };
            mat.customProgramCacheKey = () => cache + "|window-mask-v1";
            mat.needsUpdate = true;
            const part = { source, mat, uniforms, mesh, grid, key };
            state.gpu.push(part);
            return part;
          }
          return { source, key, window: true };
        }),
      };
      state.slots.push(slot);
    });
    this.states.set(so.root, state);
    return state;
  }
  variant(state, source, lit) {
    let pair = state.normal.get(source);
    if (!pair) state.normal.set(source, (pair = []));
    if (!pair[+lit]) {
      const mat = this.clone(source, state);
      mat.emissive.set(0);
      mat.emissiveIntensity = 0;
      pair[+lit] = mat;
    }
    return pair[+lit];
  }
  sync() {
    const app = this.app;
    if (app._clearingScene) return;
    const live = new Set(app.objects.map((so) => so.root));
    for (const root of this.states.keys())
      if (!live.has(root)) this.release(root);
    for (const so of app.objects) {
      if (!supportsWindows(so)) continue;
      const settings = this.resolved(so);
      let state = this.states.get(so.root);
      if (settings.mode === "legacy") {
        if (state) this.release(so.root, true);
        continue;
      }
      state ||= this.prepare(so);
      state.settings = { ...settings };
      state.signature = null;
    }
    this.tick();
  }
  factor(settings) {
    if (
      settings.mode === "off" ||
      this.app.stage.perfMode ||
      !this.app.lighting.enabled
    )
      return 0;
    if (settings.mode === "on") return 1;
    const L = this.app.lighting;
    return L.mode === "physical"
      ? nightAmount(L.physical.elevation ?? L.physical.position().elevation)
      : Math.max(0, Math.min(1, (L.p.glow || 0) / 2));
  }
  tick() {
    let changed = false;
    for (const state of this.states.values()) {
      const s = state.settings,
        factor = this.factor(s),
        signature = [s.ratio, s.seed, s.temperature, s.intensity, factor].join(
          "|",
        );
      if (state.signature === signature) continue;
      const color = kelvinColor(s.temperature),
        selection = [s.ratio, s.seed].join("|");
      if (state.selection !== selection) {
        this.app.appearance.release(state.root);
        const units = new Map();
        for (const slot of state.slots) {
          const materials = slot.parts.map((part) => {
            if (part.mat) return part.mat;
            if (!part.window) return part.source;
            const lit = windowRandom(state.so.id, s.seed, part.key) < s.ratio;
            units.set(part.key, lit);
            return this.variant(state, part.source, lit);
          });
          slot.mesh.material = Array.isArray(slot.original)
            ? materials
            : materials[0];
        }
        state.units = units.size;
        state.selected = [...units.values()].filter(Boolean).length;
        state.selection = selection;
      }
      for (const pair of state.normal.values())
        for (let i = 0; i < pair.length; i++)
          if (pair[i]) {
            pair[i].emissive.copy(color);
            pair[i].emissiveIntensity = i ? s.intensity * factor : 0;
          }
      for (const part of state.gpu) {
        part.uniforms.windowSeed.value =
          windowRandom(state.so.id, s.seed, "gpu") * 1000;
        part.uniforms.windowRatio.value = s.ratio;
        part.uniforms.windowColor.value.copy(color);
        part.uniforms.windowIntensity.value = s.intensity * factor;
      }
      this.app.appearance.apply(state.so);
      for (const mat of state.materials)
        this.app.lighting.physical.color.patch(mat);
      state.signature = signature;
      changed = true;
    }
    if (!changed && this.stats.roots === this.states.size) return;
    this.stats = {
      roots: this.states.size,
      units: 0,
      selected: 0,
      procedural: 0,
    };
    for (const state of this.states.values()) {
      this.stats.units += state.units || 0;
      this.stats.selected +=
        this.factor(state.settings) > 0 ? state.selected || 0 : 0;
      this.stats.procedural += state.gpu.length;
    }
    if (changed) this.app.modelInstancing?.invalidate();
  }
  release(root, restoreDisplay = false) {
    const state = this.states.get(root);
    if (!state) return;
    this.app.appearance.release(root);
    for (const slot of state.slots) slot.mesh.material = slot.original;
    for (const mat of state.materials) mat.dispose();
    this.states.delete(root);
    if (restoreDisplay) this.app.appearance.apply(state.so);
    this.app.modelInstancing?.invalidate();
  }
}
