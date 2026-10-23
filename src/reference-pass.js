import * as THREE from 'three';
/** Owned diagnostic materials; canonical source materials and geometry never mutated. */
export class ReferencePass {
  constructor(app, width, height) {
    this.app = app; this.width = width; this.height = height; this.materials = new Map(); this.owned = new Set(); this.members = new Map(); this.ids = [];
    const add = (root, id, name, type) => { if (!root) return; const number = this.ids.length + 1; this.ids.push({ number, rgb: [number >> 16 & 255, number >> 8 & 255, number & 255], id, name, type }); root.traverse(n => { if (n.isMesh) this.members.set(n, number); }); };
    for (const o of [...app.objects].sort((a, b) => a.id.localeCompare(b.id))) if (o.type !== 'fx') add(o.root, o.id, o.name, o.type);
    add(app.terrain?.mesh, 'terrain', '地形', 'terrain'); add(app.stage.ground, 'ground', '远景地面', 'ground');
    this.target = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.ambient = new THREE.AmbientLight(0xffffff, 1.5); this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.position.set(3, 7, 5);
  }
  material(source, mode, id) {
    const key = `${source.uuid}:${mode}:${mode === 'id' || mode === 'subject' ? id : ''}`; if (this.materials.has(key)) return this.materials.get(key);
    const alpha = { side: source.side, alphaTest: Math.max(source.alphaTest || 0, source.transparent ? .5 : 0), map: source.map, alphaMap: source.alphaMap, opacity: source.opacity ?? 1 };
    let m;
    if (mode === 'gray') {
      m = new THREE.MeshLambertMaterial({ ...alpha, color: 0xaeb5be });
      m.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = diffuse;'); };
      m.customProgramCacheKey = () => 'reference-gray-v1';
    } else if (mode === 'depth') {
      m = new THREE.MeshDepthMaterial({ ...alpha, depthPacking: THREE.BasicDepthPacking });
      m.onBeforeCompile = shader => {
        shader.uniforms.refNear = this.near; shader.uniforms.refFar = this.far;
        shader.fragmentShader = 'uniform float refNear; uniform float refFar;\n' + shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', `float z = refNear * refFar / (refFar - fragCoordZ * (refFar - refNear));
float code = 1.0 + floor(clamp((z - refNear) / (refFar - refNear), 0.0, 1.0) * 65534.0 + 0.5);
gl_FragColor = vec4(floor(code / 256.0) / 255.0, mod(code, 256.0) / 255.0, 0.0, 1.0);`);
      }; m.customProgramCacheKey = () => 'reference-linear-depth16-v1';
    } else {
      const color = mode === 'subject' ? (this.ids[id - 1].id === this.subjectId ? 0xffffff : 0x000000) : id;
      m = new THREE.MeshBasicMaterial({ ...alpha, color: 0, toneMapped: false }); m.color.setRGB((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255);
      m.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = diffuse;'); }; m.customProgramCacheKey = () => 'reference-id-v1';
    }
    m.toneMapped = false; this.materials.set(key, m); this.owned.add(m); return m;
  }
  render(mode, screen = false) {
    const s = this.app.stage, r = s.renderer, scene = s.scene, cam = s.view, rect = s.exportRect;
    this.near ||= { value: cam.near }; this.far ||= { value: cam.far }; this.near.value = cam.near; this.far.value = cam.far;
    const old = { target: r.getRenderTarget(), viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), test: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), tone: r.toneMapping, space: r.outputColorSpace, shadow: r.shadowMap.enabled, background: scene.background, fog: scene.fog, environment: scene.environment, override: scene.overrideMaterial, selection: this.app.renderEffects.selectionRendering };
    const hidden = [], materials = [];
    try {
      scene.traverseVisible(n => {
        if (n.isLight) { hidden.push([n, n.visible]); n.visible = false; }
        if (!n.material) return;
        if (!n.isMesh || !this.members.has(n) || n.material?.isShaderMaterial || (Array.isArray(n.material) && n.material.some(m => m.isShaderMaterial))) { hidden.push([n, n.visible]); n.visible = false; return; }
        materials.push([n, n.material]); const list = Array.isArray(n.material) ? n.material : [n.material];
        const swapped = list.map(m => this.material(m, mode, this.members.get(n))); n.material = Array.isArray(n.material) ? swapped : swapped[0];
      });
      if (mode === 'gray') scene.add(this.ambient, this.sun);
      scene.background = null; scene.fog = null; scene.environment = null; scene.overrideMaterial = null;
      this.app.renderEffects.selectionRendering = true; r.shadowMap.enabled = false; r.toneMapping = THREE.NoToneMapping;
      r.outputColorSpace = mode === 'gray' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      r.setRenderTarget(screen ? null : this.target); r.setScissorTest(false); r.setViewport(0, 0, this.width, this.height); r.setClearColor(0, 1); r.clear();
      const vw = rect.vw, vh = rect.vh, x = Math.round((this.width - vw) / 2), y = Math.round((this.height - vh) / 2);
      r.setViewport(x, y, vw, vh); r.setScissor(x, y, vw, vh); r.setScissorTest(true); if (mode === 'gray') { r.setClearColor(0xd2d6dc, 1); r.clear(); } r.render(scene, cam);
      const bottom = new Uint8Array(this.width * this.height * 4), out = new Uint8Array(bottom.length);
      if (screen) r.getContext().readPixels(0, 0, this.width, this.height, r.getContext().RGBA, r.getContext().UNSIGNED_BYTE, bottom);
      else r.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, bottom);
      for (let y = 0; y < this.height; y++) out.set(bottom.subarray((this.height - y - 1) * this.width * 4, (this.height - y) * this.width * 4), y * this.width * 4);
      return out;
    } finally {
      this.ambient.removeFromParent(); this.sun.removeFromParent(); for (const [n, m] of materials) n.material = m; for (const [n, v] of hidden) n.visible = v;
      Object.assign(scene, { background: old.background, fog: old.fog, environment: old.environment, overrideMaterial: old.override });
      r.toneMapping = old.tone; r.outputColorSpace = old.space; r.shadowMap.enabled = old.shadow; this.app.renderEffects.selectionRendering = old.selection;
      r.setRenderTarget(old.target); r.setViewport(old.viewport); r.setScissor(old.scissor); r.setScissorTest(old.test); r.setClearColor(old.color, old.alpha);
    }
  }
  dispose() { this.target.dispose(); for (const m of this.owned) m.dispose(); }
}
