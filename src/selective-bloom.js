import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { windowSurface } from './window-lights.js';

const native = (source) => !!source && !source.isShaderMaterial && !!(source.isMeshStandardMaterial || source.isMeshBasicMaterial || source.isMeshLambertMaterial || source.isMeshPhongMaterial || source.isMeshToonMaterial);
const modes = new Set(['auto', 'custom', 'emissive', 'off']);
export function bloomSelection(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    mode: modes.has(value.mode) ? value.mode : 'auto',
    source: value.source === 'color' ? 'color' : 'emission',
    gain: typeof value.gain === 'number' && Number.isFinite(value.gain) ? Math.max(0, Math.min(16, value.gain)) : 2,
    parts: [...new Set(Array.isArray(value.parts) ? value.parts.filter((p) => typeof p === 'string' && p.length <= 2048) : [])].slice(0, 256),
  };
}
export function sourceMaterial(app, so, mesh, slot) {
  const original = app.appearance?.roots.get(so.root)?.meshes.get(mesh) ?? mesh.material;
  return Array.isArray(original) ? original[slot] : original;
}
// Structural, UUID-free references. A changed local transform/name/topology fails
// closed instead of choosing an arbitrary replacement after a rebuild/import.
export function surfaceKey(mesh, path, slot, material, geometry = mesh.geometry) {
  return JSON.stringify([path, slot, mesh.name, material?.name, material?.type,
    geometry?.type, geometry?.attributes.position?.count, geometry?.index?.count ?? 0,
    ...(path.length ? [mesh.position, mesh.quaternion, mesh.scale] : []).map((v) => v.toArray().map((n) => Math.round(n * 1e6) / 1e6))]);
}
export function objectSurfaces(app, so, originals = new Map()) {
  const result = [];
  function visit(node, path) {
    if (node.isMesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((display, slot) => {
        const source = sourceMaterial(app, so, node, slot);
        result.push({ mesh: node, slot, source, display,
          key: surfaceKey(node, path, slot, source, originals.get(node)),
          window: windowSurface(so, source),
          label: `${node.name || '网格 ' + (path.join('.') || '根')} · ${source?.name || source?.type || '材质'} #${slot + 1}` });
      });
    }
    node.children.forEach((child, i) => visit(child, path.concat(i)));
  }
  visit(so.root, []);
  return result;
}
export function surfaceContribution(policy, surface, windows) {
  if (policy.mode === 'off') return null;
  if (policy.mode === 'auto') return windows && surface.window ? { kind: 'emission', gain: 1 } : null;
  if (policy.mode === 'emissive') return { kind: 'emission', gain: 1 };
  return policy.parts.includes(surface.key) ? { kind: policy.source, gain: policy.gain } : null;
}

// Independent HDR emission buffer with ordinary geometry depth/alpha occlusion.
// The existing bloom pyramid reads ONLY this texture, but adds its glow onto the
// original composer image. Sky/environment/specular radiance never enters it.
export class SelectiveBloomPass extends UnrealBloomPass {
  constructor(effects) {
    const b = effects.bloom;
    super(new THREE.Vector2(1, 1), b.strength, b.radius, b.threshold);
    this.effects = effects;
    this.selectionTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.selectionTarget.texture.name = 'SelectiveBloom.emission';
    this.selectionTarget.texture.generateMipmaps = false;
    this.variants = new Map();
    this.epoch = 0;
    this.stats = { selectedSlots: 0, unsupported: 0, staleParts: 0, candidateMeshes: 0, maskDrawCalls: 0 };
    const shader = this.materialHighPassFilter;
    if (!shader.fragmentShader.includes('texture2D( tDiffuse, vUv )')) throw Error('Unsupported Three bloom shader');
    this.highPassUniforms.selectionTexture = { value: this.selectionTarget.texture };
    shader.fragmentShader = 'uniform sampler2D selectionTexture;\n' + shader.fragmentShader.replace('texture2D( tDiffuse, vUv )', 'texture2D( selectionTexture, vUv )');
  }
  setSize(w, h) {
    this.selectionTarget.setSize(w, h);
    const scale = { low: .25, medium: .5, high: 1 }[this.effects.bloom.quality];
    super.setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
  }
  variant(source, contribution) {
    if (!native(source)) this.stats.unsupported++;
    const kind = contribution?.kind ?? 'black', gain = contribution?.gain ?? 0;
    const key = `${kind}:${gain}`;
    let group = this.variants.get(source);
    if (!group || group.version !== source.version) {
      if (group) for (const { mat } of group.values.values()) mat.dispose();
      group = { version: source.version, values: new Map() };
      this.variants.set(source, group);
    }
    let record = group.values.get(key);
    if (!record) {
      const supported = native(source);
      const mat = supported ? source.clone() : new THREE.MeshBasicMaterial({ color: 0, side: source.side, depthTest: source.depthTest, depthWrite: source.depthWrite, transparent: source.transparent, opacity: source.opacity, map: source.map ?? null, alphaMap: source.alphaMap ?? null, alphaTest: source.alphaTest });
      if (!supported) mat.fog = false;
      mat.toneMapped = false;
      const compile = source.onBeforeCompile, cacheKey = source.customProgramCacheKey();
      const colorGain = this.effects.app.lighting.physical.color.gain;
      if (supported) {
        mat.onBeforeCompile = function (shader, renderer) {
          compile.call(this, shader, renderer);
          if (!shader.fragmentShader.includes('#include <tonemapping_fragment>')) {
            shader.fragmentShader = 'void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}';
            return;
          }
          const radiance = kind === 'black' ? 'vec3(0.0)' : kind === 'color' || source.isMeshBasicMaterial ? 'diffuseColor.rgb' : 'totalEmissiveRadiance';
          shader.uniforms.selectiveCameraGain = { value: colorGain };
          shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', 'gl_FragColor.rgb *= 1.0 - fogFactor;'));
          shader.fragmentShader = 'uniform vec3 selectiveCameraGain;\n' + shader.fragmentShader.replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = ${radiance} * ${gain.toFixed(8)} * selectiveCameraGain;\n#include <tonemapping_fragment>`);
        };
        mat.customProgramCacheKey = () => cacheKey + '|selective-bloom-v1:' + key;
      } else mat.color.set(0);
      record = { mat, supported, epoch: this.epoch };
      group.values.set(key, record);
    }
    // Window variants update radiance/uniforms without increasing material.version.
    for (const k of ['color', 'emissive']) if (source[k] && record.mat[k]) record.mat[k].copy(source[k]);
    if (!record.supported) record.mat.color.set(0);
    for (const k of ['opacity', 'emissiveIntensity', 'visible', 'map', 'alphaMap', 'emissiveMap', 'alphaTest', 'depthWrite', 'depthTest', 'colorWrite', 'side', 'transparent', 'blending', 'premultipliedAlpha']) if (k in source) record.mat[k] = source[k];
    record.epoch = this.epoch;
    return record.mat;
  }
  prune() {
    for (const [source, group] of this.variants) {
      for (const [key, record] of group.values) if (record.epoch !== this.epoch) {
        record.mat.dispose(); group.values.delete(key);
      }
      if (!group.values.size) this.variants.delete(source);
    }
  }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const fx = this.effects, app = fx.app, s = fx.stage, scene = s.scene;
    const restore = { background: scene.background, override: scene.overrideMaterial,
      auto: renderer.autoClear, tone: renderer.toneMapping, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
      target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), test: renderer.getScissorTest(),
      shadowAuto: renderer.shadowMap.autoUpdate, shadowNeeds: renderer.shadowMap.needsUpdate, selecting: fx.selectionRendering };
    const materials = [], hidden = [], contributions = new Map(), content = new Set();
    this.epoch++;
    this.stats = { selectedSlots: 0, unsupported: 0, staleParts: 0, candidateMeshes: 0, maskDrawCalls: 0 };
    try {
      const originals = new Map(fx.lod.swapped);
      for (const so of app.objects) {
        const policy = bloomSelection(so.params.bloomSelection), matched = new Set();
        for (const surface of objectSurfaces(app, so, originals)) {
          const c = surfaceContribution(policy, surface, fx.bloom.windows);
          if (c) {
            if (!contributions.has(surface.mesh)) contributions.set(surface.mesh, new Map());
            contributions.get(surface.mesh).set(surface.slot, c);
            if (native(surface.display)) this.stats.selectedSlots++; matched.add(surface.key);
          }
        }
        if (policy.mode === 'custom') this.stats.staleParts += policy.parts.filter((key) => !matched.has(key)).length;
      }
      // Only physical scene content, never camera rigs, helpers or render proxies.
      for (const so of app.objects) so.root.traverse((n) => content.add(n));
      for (const root of [app.terrain?.mesh, app.terrain?.water, app.terrain?.workflow?.riverGroup, app.terrain?.workflow?.erosionPreview?.mesh]) root?.traverse((n) => content.add(n));
      fx.selectionRendering = true; // mixed per-object policy must not become one render proxy
      scene.background = null; scene.overrideMaterial = null;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      scene.traverseVisible((node) => {
        if (!node.material) return;
        if (!node.isMesh || (!content.has(node) && node !== s.ground) || node === app.terrain?._ring) {
          hidden.push([node, node.visible]); node.visible = false; return;
        }
        const original = node.material;
        materials.push([node, original]);
        const selected = contributions.get(node), list = Array.isArray(original) ? original : [original];
        const masked = list.map((mat, slot) => mat ? this.variant(mat, selected?.get(slot)) : mat);
        node.material = Array.isArray(original) ? masked : masked[0];
        this.stats.candidateMeshes++;
      });
      renderer.autoClear = true;
      renderer.setRenderTarget(this.selectionTarget);
      renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear();
      const beforeCalls = renderer.info.render.calls;
      renderer.render(scene, s.view);
      this.stats.maskDrawCalls = renderer.info.autoReset ? renderer.info.render.calls : renderer.info.render.calls - beforeCalls;
      // Restore originals before fullscreen passes, also on any renderer failure.
      for (const [node, material] of materials) node.material = material;
      for (const [node, visible] of hidden) node.visible = visible;
      scene.background = restore.background; scene.overrideMaterial = restore.override;
      fx.selectionRendering = restore.selecting;
      renderer.toneMapping = restore.tone;
      renderer.autoClear = restore.auto;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      for (const [node, material] of materials) node.material = material;
      for (const [node, visible] of hidden) node.visible = visible;
      scene.background = restore.background; scene.overrideMaterial = restore.override;
      fx.selectionRendering = restore.selecting;
      renderer.shadowMap.autoUpdate = restore.shadowAuto; renderer.shadowMap.needsUpdate = restore.shadowNeeds;
      renderer.toneMapping = restore.tone; renderer.autoClear = restore.auto;
      renderer.setClearColor(restore.color, restore.alpha);
      renderer.setRenderTarget(restore.target, restore.face, restore.mip);
      renderer.setViewport(restore.viewport); renderer.setScissor(restore.scissor); renderer.setScissorTest(restore.test);
      this.prune();
    }
  }
  dispose() {
    for (const group of this.variants.values()) for (const { mat } of group.values.values()) mat.dispose();
    this.variants.clear(); this.selectionTarget.dispose(); super.dispose();
  }
}
