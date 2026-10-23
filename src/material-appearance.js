import * as THREE from 'three';
const MODES = new Set(['inherit', 'on', 'off']);
// Non-destructive display policy. Never mutate a shared library material or the
// canonical imported resource. Each root owns its temporary display variants.
export class MaterialAppearance {
  constructor(app) { this.app = app; this.roots = new WeakMap(); }
  enabled(so) { return so.materialMode === 'on' || (so.materialMode !== 'off' && this.app.state.tex !== false); }
  apply(so) {
    const root = so?.root; if (!root) return;
    let state = this.roots.get(root);
    if (!state) { state = { meshes: new Map(), off: new Map(), perf: new Map() }; this.roots.set(root, state); }
    const on = this.enabled(so), perf = !!this.app.stage.perfMode;
    const display = source => {
      if (!source) return source;
      let mat = source;
      if (!on) {
        if (!state.off.has(source)) {
          const m = source.clone();
          const windowHooks=this.app.windowLights?.hooksFor(source);
          if(windowHooks){m.onBeforeCompile=windowHooks.compile;m.customProgramCacheKey=windowHooks.cache;}
          m.color?.set(0xb9bec5); m.vertexColors = false;
          for (const key of ['normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'envMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap']) if (key in m) m[key] = null;
          if (!source.transparent && !(source.alphaTest > 0)) m.map = null;
          else {const original=m.onBeforeCompile,key=m.customProgramCacheKey();m.onBeforeCompile=function(shader,renderer){original.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = diffuse;');};m.customProgramCacheKey=()=>key+'|appearance-gray-v1';}
          if ('roughness' in m) m.roughness = .95;
          if ('metalness' in m) m.metalness = 0;
          if ('envMapIntensity' in m) m.envMapIntensity = 0;
          m.needsUpdate = true; state.off.set(source, m);
        }
        mat = state.off.get(source);
        if (source.emissive && mat.emissive) { mat.emissive.copy(source.emissive); mat.emissiveIntensity = source.emissiveIntensity; }
      }
      if (perf && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshPhongMaterial || mat.isMeshLambertMaterial || mat.isMeshToonMaterial)) {
        if (!state.perf.has(mat)) {
          const m = new THREE.MeshBasicMaterial({ color: mat.color, map: mat.map, alphaMap: mat.alphaMap, alphaTest: mat.alphaTest, transparent: mat.transparent, opacity: mat.opacity, side: mat.side, vertexColors: mat.vertexColors, depthWrite: mat.depthWrite });
          // Basic mode has no emissive pipeline. Copy only the gray/alpha policy,
          // not a Standard/window or already white-balanced shader wrapper.
          if (!on) {m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = diffuse;');};m.customProgramCacheKey=()=> 'appearance-basic-gray-v1';}
          state.perf.set(mat, m);
        }
        const flat=state.perf.get(mat);this.app.lighting?.physical?.color?.patch?.(flat);
        return flat;
      }
      // Display variants may be rebuilt by a window seed/ratio change without a
      // light/objects event. Register the actual displayed material, not just its source.
      this.app.lighting?.physical?.color?.patch?.(mat);
      return mat;
    };
    root.traverse(mesh => {
      if (!mesh.material || (!mesh.isMesh && !mesh.isPoints && !mesh.isSprite)) return;
      if (!state.meshes.has(mesh)) state.meshes.set(mesh, this.app.stage._matSwap?.get(mesh) || mesh.material);
      const source = state.meshes.get(mesh);
      mesh.material = Array.isArray(source) ? source.map(display) : display(source);
    });
  }
  applyAll() { for (const so of this.app.objects) this.apply(so); }
  release(root) {
    const state = this.roots.get(root); if (!state) return;
    for (const [mesh, source] of state.meshes) mesh.material = source;
    for (const m of [...state.off.values(), ...state.perf.values()]) m.dispose();
    this.roots.delete(root);
  }
  setMode(so, mode) {
    if (!so || so.locked || !MODES.has(mode) || !this.app.objects.includes(so)) return false;
    this.app.beginOp('修改物品材质显示'); so.materialMode = mode;
    this.apply(so); this.app.bus.emit('objects'); this.app.bus.emit('select'); this.app.saveLocal();
    return true;
  }
}
