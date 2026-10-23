import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 480000 });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1280, height: 850 });
  if (process.env.TEST_FILE_URL?.startsWith('file:')) await page.setOfflineMode(true);
  await page.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1&benchmark=1');
  await page.waitForFunction(() => window.__previzBooted && window.app?.renderEffects);
  const result = await page.evaluate(async () => {
    const a = app, s = a.stage, fx = a.renderEffects;
    const check = (v, m) => { if (!v) throw Error(m); };
    a.suspended = true; a._quietAdd = true; a._suspendUndo = true; a.clearAll(); a.terrain.setEnabled(false); a.select(null);
    const template = a.addAsset('house:adobe:Adobe 土坯平顶房', [0, 0, 0]), SO = template.constructor;
    a.removeObject(template);
    const Group = s.world.constructor, Mesh = s.ground.constructor, Plane = s.ground.geometry.constructor;
    const Standard = s.ground.material.constructor, Basic = s.selRing.material.constructor, Color = s.ground.material.color.constructor;
    a.lighting.setEnabled(true); a.lighting.setMode('physical'); a.lighting.physical.configure({ source: 'manual', sunElev: 35, shadows: false, fog: 0, whiteBalance: 6500 });
    s.ground.visible = false; s.gridFine.visible = false; s.gridCoarse.visible = false; s.helperLayer.visible = false;
    if (s.sky) s.sky.visible = false; if (a.lighting.physical.mesh) a.lighting.physical.mesh.visible = false;
    s.scene.fog = null; s.scene.background = new Color(0, 0, 0);
    s.orbit.update = () => false; s.view.position.set(0, 0, 12); s.view.lookAt(0, 0, 0); s.view.fov = 35; s.view.aspect = 1.5; s.view.updateProjectionMatrix();
    s.renderer.setPixelRatio(1); s.renderer.setSize(480, 320); s.syncPostSize(); s.renderer.setScissorTest(false);
    const fixtures = [];
    function add(name, material, x = 0, key = null, width = 2.5) {
      const root = new Group(), mesh = new Mesh(new Plane(width, 2.5), material); mesh.name = name; root.add(mesh); root.position.x = x;
      const so = new SO(a, { root, key, name, params: { bloomSelection: { mode: 'off' } } });
      a.objects.push(so); fixtures.push(so); return { so, mesh };
    }
    const mat = new Standard({ color: 0, emissive: new Color(8, 2, .5), roughness: .5 }); mat.name = 'emitter';
    const hot = add('emitter', mat);
    const bright = add('bright non-target', new Basic({ color: new Color(16, 16, 16) }), -3.5, null, 1.5);
    const mirror = add('selected reflective non-emitter', new Standard({ color: 0xffffff, metalness: 1, roughness: .05, envMapIntensity: 50 }), 3.5, null, 1.5);
    a.bus.emit('objects'); a.modelInstancing.sync(true);
    const image = () => { s.renderer.setSize(480, 320, false); s.view.aspect = 1.5; s.view.updateProjectionMatrix(); s.render(); const gl = s.renderer.getContext(), out = new Uint8Array(480 * 320 * 4); gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; };
    const diff = (left, right) => { let total = 0, max = 0, changed = 0; for (let i = 0; i < left.length; i++) if (i % 4 !== 3) { const d = Math.abs(left[i] - right[i]); total += d; max = Math.max(max, d); if (d > 2) changed++; } return { mean: total / (480 * 320 * 3), max, changed }; };
    const config = (patch = {}) => fx.configure({ bloom: { enabled: true, mode: 'selective', strength: 1, radius: .3, threshold: 1.1, quality: 'medium', ...patch } });
    const baseImage = () => {
      fx.prepare(); const pass = fx.pass, original = pass.render;
      pass.render = function (...args) { const strength = this.strength; this.strength = 0; try { return original.apply(this, args); } finally { this.strength = strength; } };
      try { return image(); } finally { pass.render = original; }
    };
    config(); const empty = image(); check(fx.pass.stats.selectedSlots === 0, 'excluded objects selected');
    const off = baseImage();
    const excluded = diff(empty, off); check(excluded.mean < .05, 'unselected highlights entered glow ' + JSON.stringify(excluded));
    // A deliberately HDR bright sky/background must remain identical without contributors.
    s.scene.background = new Color(16, 16, 16); config(); const skyOn = image(); const skyOff = baseImage();
    const skyRejected = diff(skyOn, skyOff); check(skyRejected.mean < .05, 'HDR sky entered glow');
    config({ mode: 'all' }); const legacySky = diff(image(), skyOff); check(legacySky.mean > .5, 'legacy positive control did not glow');
    s.scene.background = new Color(0, 0, 0);
    s.sky.visible = true; config(); const nativeSkyRejected = diff(image(), baseImage()); check(nativeSkyRejected.mean === 0, 'native shader sky entered glow'); s.sky.visible = false;
    fx.setObject(mirror.so, { mode: 'emissive' }); config(); const reflected = image();
    const projectedMirror = mirror.so.worldPos().project(s.view), mirrorAt = (Math.floor((projectedMirror.y + 1) * 160) * 480 + Math.floor((projectedMirror.x + 1) * 240)) * 4;
    const reflectionLevel = Math.max(...reflected.slice(mirrorAt, mirrorAt + 3)); check(reflectionLevel > 200, 'reflective positive control was not bright: ' + reflectionLevel);
    const reflectionRejected = diff(reflected, baseImage()); check(reflectionRejected.mean < .05, 'specular radiance entered selected emission');
    fx.setObject(hot.so, { mode: 'emissive' }); config(); const glowing = image(); const stats = { ...fx.pass.stats };
    const positive = diff(glowing, off); check(positive.mean > .3 && stats.selectedSlots === 2, 'emission source failed ' + JSON.stringify({ positive, stats }));
    // Ordinary opaque depth occlusion, not a visibility-only mask.
    const block = add('opaque occluder', new Basic({ color: 0 }), 0, null, 3.5); block.mesh.position.z = 1;
    a.bus.emit('objects'); const blocked = image(); const blockedOff = baseImage();
    const occlusion = diff(blocked, blockedOff); check(occlusion.mean < .05, 'hidden emitter leaked through opaque geometry ' + JSON.stringify(occlusion));
    // Alpha-tested native occluder: black side blocks, cutout side transmits.
    const alphaCanvas = document.createElement('canvas'); alphaCanvas.width = 2; alphaCanvas.height = 1;
    const ac = alphaCanvas.getContext('2d'); ac.fillStyle = 'white'; ac.fillRect(0, 0, 1, 1); ac.fillStyle = 'black'; ac.fillRect(1, 0, 1, 1);
    const alphaTexture = new s.composer.renderTarget1.texture.constructor(alphaCanvas); alphaTexture.needsUpdate = true;
    block.mesh.material.alphaMap = alphaTexture; block.mesh.material.alphaTest = .5; block.mesh.material.needsUpdate = true;
    config(); const cutout = diff(image(), baseImage()); check(cutout.mean > .3, 'alpha-tested hole blocked emission');
    block.so.root.visible = false; image();
    const fullAfterCutout = diff(image(), baseImage()); check(fullAfterCutout.mean > cutout.mean, 'opaque alpha texels did not attenuate emission');
    alphaTexture.dispose();
    // Two material groups are independent surface references, not one whole-object selection.
    fx.setObject(hot.so, { mode: 'off' }); fx.setObject(mirror.so, { mode: 'off' });
    const multi = add('multi-slot', [new Basic({ color: new Color(8, 0, 0) }), new Basic({ color: new Color(0, 8, 0) })]);
    multi.mesh.geometry.clearGroups(); multi.mesh.geometry.addGroup(0, 3, 0); multi.mesh.geometry.addGroup(3, 3, 1);
    a.select({ kind: 'obj', so: multi.so });
    const groups = document.querySelectorAll('[data-bloom-surface]'); check(new Set([...groups].map((n) => n.dataset.bloomSurface)).size === 2, 'multi-material slots collapsed');
    groups[1].checked = true; groups[1].dispatchEvent(new Event('change', { bubbles: true }));
    config(); image(); check(fx.pass.stats.selectedSlots === 1, 'custom material group selected whole object');
    const multiSelected = fx.pass.stats.selectedSlots; fx.setObject(multi.so, { mode: 'off' });
    const Shader = s.sky.material.constructor;
    const unsupported = add('custom shader', new Shader({ vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(16.0,16.0,16.0,1.0);}' }));
    fx.setObject(unsupported.so, { mode: 'emissive' });
    const shaderRejected = diff(image(), baseImage()); check(shaderRejected.mean === 0 && fx.pass.stats.unsupported > 0 && fx.pass.stats.selectedSlots === 0, 'unsupported shader became a light source');
    const unsupportedCount = fx.pass.stats.unsupported;
    fx.setObject(unsupported.so, { mode: 'off' }); unsupported.so.root.visible = false;

    // Color-source lamp signs via the actual object inspector; emission-only basic remains an explicit opt-in.
    a.select({ kind: 'obj', so: bright.so }); a._suspendUndo = false;
    const objectControl = document.querySelector('[data-bloom-object-setting="mode"]');
    check(objectControl && document.querySelector('[data-bloom-surface]'), 'object surface UI missing');
    objectControl.value = 'custom'; objectControl.dispatchEvent(new Event('change', { bubbles: true }));
    const surface = document.querySelector('[data-bloom-surface]'); surface.checked = true; surface.dispatchEvent(new Event('change', { bubbles: true }));
    const source = document.querySelector('[data-bloom-object-setting="source"]'); source.value = 'color'; source.dispatchEvent(new Event('change', { bubbles: true }));
    const stored = structuredClone(bright.so.params.bloomSelection); check(stored.parts.length === 1 && stored.source === 'color', 'custom UI did not persist');
    check(a.undo(), 'selection undo unavailable'); check(a.byId(bright.so.id).params.bloomSelection.source === 'emission', 'undo did not restore source');
    check(a.redo(), 'selection redo unavailable');
    // Undo rebuilds objects; discard synthetic fixtures before archive roundtrip (real library geometry below).
    a._suspendUndo = true; a.clearAll(); a.select(null);
    const house = a.addAsset('house:adobe:Adobe 土坯平顶房', [0, 0, 0]); a.windowLights.setObject(house, { mode: 'on', ratio: 1, intensity: 5 }); a.windowLights.tick();
    a.lighting.setEnabled(true); s.view.position.set(14, 10, 20); s.view.lookAt(0, 2, 0); s.scene.fog = null;
    fx.setObject(house, { mode: 'auto', parts: [] }); config(); image(); const autoOn = fx.pass.stats.selectedSlots; check(autoOn > 0, 'automatic library windows absent');
    const sumTarget = () => { const target = fx.pass.selectionTarget, data = new Uint16Array(target.width * target.height * 4); s.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data); let total = 0; for (let i = 0; i < data.length; i++) if (i % 4 !== 3) total += data[i] & 0x7fff; return total; };
    const lit = sumTarget(); check(lit > 0, 'window mask black');
    a.windowLights.setObject(house, { mode: 'off' }); a.windowLights.tick(); image(); const unlit = sumTarget(); check(unlit === 0, 'off windows still glow ' + unlit);
    a.windowLights.setObject(house, { mode: 'on', ratio: 0 }); a.windowLights.tick(); image(); check(sumTarget() === 0, 'ratio zero windows still glow');
    a.windowLights.setObject(house, { ratio: 1 }); a.windowLights.tick(); a.appearance.setMode(house, 'off'); image(); check(sumTarget() > 0, 'grey mode lost automatic window emission');
    config({ windows: false }); image(); check(fx.pass.stats.selectedSlots === 0 && sumTarget() === 0, 'automatic windows switch ignored');
    // GPU procedural window hooks must survive mask cloning, including ratio zero.
    const tower = a.addAsset('building:tower:玻璃幕墙写字楼', [20, 0, 0], { params: { floors: 4, width: 10, depth: 8 } });
    fx.setObject(house, { mode: 'off' }); a.windowLights.setObject(tower, { mode: 'on', ratio: 1, intensity: 5 });
    check(a.windowLights.states.get(tower.root).gpu.some((p) => p.grid), 'procedural GPU window fixture missing');
    s.view.position.set(38, 24, 32); s.view.lookAt(20, 8, 0); config({ windows: true }); image();
    const gpuLit = sumTarget(); check(gpuLit > 0, 'GPU window hook did not emit');
    a.windowLights.setObject(tower, { ratio: 0 }); image(); const gpuDark = sumTarget(); check(gpuDark === 0, 'GPU ratio zero still glows');
    a.removeObject(tower); s.view.position.set(14, 10, 20); s.view.lookAt(0, 2, 0);
    // Stable UUID-free references across duplication, local serialize/load, archive load, and a same-params rebuild.
    a.appearance.setMode(house, 'inherit'); a.select({ kind: 'obj', so: house });
    const list = [...document.querySelectorAll('[data-bloom-surface]')]; check(list.length > 0, 'house surface UI empty');
    list[0].checked = true; list[0].dispatchEvent(new Event('change', { bubbles: true }));
    fx.setObject(house, { mode: 'custom', source: 'color', gain: 4 });
    const savedPolicy = structuredClone(house.params.bloomSelection);
    a.duplicateSelected(); const duplicate = a.selObj;
    check(JSON.stringify(duplicate.params.bloomSelection) === JSON.stringify(savedPolicy), 'copy lost surface policy');
    a.rebuildObject(house); config(); image(); check(fx.pass.stats.staleParts === 0, 'same-params rebuild invalidated references');
    const serialized = a.serialize(); a.loadJson(serialized); config(); image(); check(fx.pass.stats.staleParts === 0, 'serialize/load invalidated references');
    check(a.objects.some((o) => o.params.bloomSelection?.parts?.length === 1), 'load lost policy');
    const archive = await a.saveProject(); await a.importFiles([new File([archive], "selective.previz")]); config(); image(); check(fx.pass.stats.staleParts === 0, 'archive reference mismatch');
    const activeGroups = a.modelInstancing.stats.activeGroups;
    check(activeGroups > 0, 'base render instancing was disabled by selection mask');
    const batchMaterials = a.modelInstancing.batches.map((b) => b.proxy.material); image();
    check(batchMaterials.every((m, i) => a.modelInstancing.batches[i]?.proxy.material === m && !m.customProgramCacheKey().includes('selective-bloom')), 'mask polluted model instancing cache');
    const selected = a.objects.find((o) => o.params.bloomSelection?.mode === 'custom');
    fx.setObject(selected, { parts: ['missing-surface'] }); image(); check(fx.pass.stats.staleParts === 1, 'stale reference diagnostics absent');
    fx.setObject(selected, savedPolicy);
    // Error injection in the mask must restore renderer, visibility, source materials, and batching state.
    const pass = fx.pass, oldRender = s.renderer.render, seen = [];
    s.world.traverse((n) => { if (n.isMesh) seen.push([n, n.material, n.visible]); });
    const before = { target: s.renderer.getRenderTarget(), tone: s.renderer.toneMapping, background: s.scene.background, auto: s.renderer.autoClear, shadow: s.renderer.shadowMap.autoUpdate };
    s.renderer.render = function (scene, camera) { if (fx.selectionRendering) throw Error('injected-selection'); return oldRender.call(this, scene, camera); };
    let caught = false; try { image(); } catch (e) { caught = String(e).includes('injected-selection'); } finally { s.renderer.render = oldRender; }
    check(caught, 'mask fault injection did not run');
    check(seen.every(([n, m, v]) => n.material === m && n.visible === v), 'mask fault mutated source meshes');
    check(!fx.selectionRendering && !a.modelInstancing.rendering && !fx.lod.rendering, 'mask fault left batching/LOD transaction active');
    check(s.renderer.getRenderTarget() === before.target && s.renderer.toneMapping === before.tone && s.scene.background === before.background && s.renderer.autoClear === before.auto && s.renderer.shadowMap.autoUpdate === before.shadow, 'mask fault left renderer state');
    image();
    // LOD render transaction and structural reference use the original, not temporary low geometry.
    const mergedLOD = a.addAsset('house:adobe:Adobe 土坯平顶房', [12, 0, 0], { merge: true });
    a.select({ kind: 'obj', so: mergedLOD });
    const mergedSurface = [...document.querySelectorAll('[data-bloom-surface]')].find((n) => JSON.parse(n.dataset.bloomSurface)[6] > 64);
    check(mergedSurface, 'merged LOD fixture has no complex surface');
    fx.setObject(mergedLOD, { mode: 'custom', source: 'color', parts: [mergedSurface.dataset.bloomSurface] });
    a.select(null); fx.configure({ lod: { enabled: true, near: 20, far: 26 } });
    s.view.position.set(0, 30, 80); s.view.lookAt(0, 2, 0); image(); await fx.lod.work.drain(); image();
    const combinedLOD = { ...fx.lod.stats }; check(combinedLOD.far > 0 && combinedLOD.simplifiedMeshes > 0 && fx.pass.stats.staleParts === 0, 'LOD broke source references ' + JSON.stringify({ lod: combinedLOD, mask: fx.pass.stats }));
    check(!fx.lod.rendering && fx.lod.swapped.length === 0, 'LOD did not restore originals');
    fx.configure({ lod: { enabled: false } }); s.view.position.set(14, 10, 20); s.view.lookAt(0, 2, 0);
    a.select({ kind: 'obj', so: selected }); image();
    const point = selected.root.position.clone(); point.y += 3.7; s.pointer.copy(point.project(s.view));
    check(s.pick().so === selected && s.tc.object === selected.root, 'selective Bloom broke source pick/gizmo');
    a.select(null);
    s.setDofEnabled(true, { focus: 25, aperture: .001, maxblur: .002 }); image(); check(s.bokehPass.enabled && fx.pass.selectionTarget, 'DOF/selective composition failed'); s.setDofEnabled(false);
    s.anamorphicEnabled = true; s.anamorphicPass.enabled = true; image(); s.anamorphicEnabled = false; s.anamorphicPass.enabled = false;
    s.setPerfMode(true); image(); check(!fx.pass && fx.bloom.enabled, 'Basic mode did not suspend selective Bloom');
    s.setPerfMode(false); image(); check(fx.pass.selectionTarget, 'selective Bloom not restored from Basic');
    const rect = { W: 480, H: 320, k: 1, m: .5 }; s.preview = true; s.renderFramed(rect);
    const gl = s.renderer.getContext(), framed = new Uint8Array(480 * 320 * 4); gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, framed);
    let bars = 0, center = 0;
    for (let y = 0; y < 320; y++) for (let x = 0; x < 480; x++) { const at = (y * 480 + x) * 4, v = framed[at] + framed[at + 1] + framed[at + 2]; if (y < 80 || y >= 240) bars += v; else center += v; }
    check(bars === 0 && center > 0 && !s.postSize && s.composer.renderToScreen, 'selective letterbox/state restoration failed ' + JSON.stringify({ bars, center, post: s.postSize, screen: s.composer.renderToScreen })); s.preview = false;
    const png = await a.exporter.still({ width: 480, height: 320, asDataUrl: true });
    const pngImage = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = png; });
    check(pngImage.width === 480 && pngImage.height === 320, 'selective PNG export failed');
    if (!a.shots.length) a.addShot();
    const video = await a.exporter.run({ width: 480, height: 320, duration: .4, fps: 5, bitrate: 1 }); a.suspended = true;
    check(video?.size > 0 && video.frames === 2, 'selective video export failed');
    // Warm deferred source texture/program allocations before the four measured cycles.
    for (let i = 0; i < 2; i++) { config(); image(); fx.configure({ bloom: { enabled: false } }); image(); }
    const samples = [], releasedSamples = [];
    for (let i = 0; i < 4; i++) { config({ mode: 'selective' }); image(); samples.push({ ...s.renderer.info.memory, variants: fx.snapshot().bloom.selection.materialVariants, programs: s.renderer.info.programs.length }); fx.configure({ bloom: { enabled: false } }); image(); releasedSamples.push({ ...s.renderer.info.memory, programs: s.renderer.info.programs.length }); }
    check(samples.every((v, i) => v.textures - releasedSamples[i].textures === 12), 'owned HDR/pyramid textures not released');
    check(releasedSamples.every((v) => v.textures === releasedSamples[0].textures && v.programs === releasedSamples[0].programs), 'released resource counts grew');
    check(samples.every((v) => v.textures === samples[0].textures && v.geometries === samples[0].geometries && v.variants === samples[0].variants && v.programs === samples[0].programs), 'selection allocations grew across release/recreate ' + JSON.stringify(samples));
    config(); image(); const selectedSnapshot = fx.snapshot();
    fx.configure({ bloom: { strength: 0 } }); image(); check(!fx.pass, 'zero strength retains selective target');
    fx.configure({ bloom: { mode: 'all', strength: 1 } }); image(); check(fx.pass && !fx.pass.selectionTarget, 'legacy mode retained selection pass');
    fx.configure({ bloom: { mode: 'selective' } }); image(); check(!!fx.pass.selectionTarget, 'selective mode not restored');
    fx.configure({ bloom: { enabled: true } }, { replace: true }); check(fx.bloom.mode === 'all', 'old archive did not restore legacy mode');
    a._suspendUndo = false; a._quietAdd = false;
    return { media: { video: btoa(String.fromCharCode(...new Uint8Array(await video.blob.arrayBuffer()))), png }, entry: location.protocol, excluded, skyRejected, nativeSkyRejected, legacySky, reflectionRejected, reflectionLevel, positive, occlusion, cutout, fullAfterCutout, multiSelected, shaderRejected, unsupportedCount, autoOn, lit, unlit, gpuLit, gpuDark, activeGroups, combinedLOD, exportCheck: { pngWidth: pngImage.width, pngHeight: pngImage.height, videoFrames: video.frames, videoBytes: video.size }, samples, releasedSamples, selectedSnapshot,
      checks: ['sky + unselected HDR + selected non-emissive reflections rejected', 'positive emission and legacy controls', 'opaque depth + native alpha cutout occlusion', 'multi-material group selection + unsupported ShaderMaterial fail-closed', 'object inspector surface/source selection + undo/redo', 'auto windows + off + ratio zero + grey mode', 'global automatic windows switch', 'procedural GPU grid window hooks + ratio zero', 'base instancing cache isolation + LOD structural refs + pick/gizmo', 'DOF + anamorphic + Basic suspend/restore + letterbox + PNG + two-frame video', 'copy + rebuild + serialize + archive stable references', 'unmatched surface fails closed + diagnostics', 'injected mask failure restoration', 'four release/recreate resource plateau', 'all/selective/zero-strength mode lifecycle + legacy defaults'] };
  });
  assert.deepEqual(errors, []);
  mkdirSync('.shots', { recursive: true });
  const suffix = result.entry === 'file:' ? 'file' : 'dev';
  writeFileSync(`.shots/selective-bloom-${suffix}.webm`, Buffer.from(result.media.video, 'base64'));
  writeFileSync(`.shots/selective-bloom-${suffix}.png`, Buffer.from(result.media.png.split(',')[1], 'base64'));
  delete result.media;
  writeFileSync(`.shots/selective-bloom-${result.entry === 'file:' ? 'file' : 'dev'}.json`, JSON.stringify(result, null, 2));
  console.log('PASS selective Bloom', JSON.stringify(result, null, 2));
} finally { await browser.close(); }
