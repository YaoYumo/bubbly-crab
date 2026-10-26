import { pointGuide, hitCurvePoint, dragOnLevel } from './curve-handles.js';
import * as THREE from 'three';
import { decodeHeightPNG, cleanHeightMapping, mappedHeights } from './terrain-import.js';
import { cleanRiver, carveRiver, riverStrip } from './terrain-river.js';
import { erosionSettings, EROSION_PRESETS, erodeHeightfield } from './terrain-erosion.js';
import { erosionRegion } from './terrain-erosion-region.js';
import { uid } from './util.js';
const clone = (v) => JSON.parse(JSON.stringify(v));
const yieldTask = () => new Promise((r) => setTimeout(r, 0));
const disposeGroup = (group) => { for (const child of [...group.children]) { group.remove(child); child.geometry?.dispose(); child.material?.dispose(); } };
const safeURL = (url) => typeof url === 'string' && url.length < 3 * 1024 * 1024 && /^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(url);
async function bitmap(blob) { return createImageBitmap(blob, { imageOrientation: 'none' }); }
function imageDimensions(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 255) throw Error('JPEG 标记无效');
      while (bytes[at] === 255) at++;
      const marker = bytes[at++]; if (marker === 0xda || marker === 0xd9) break;
      const length = bytes[at] * 256 + bytes[at + 1]; if (length < 2 || at + length > bytes.length) throw Error('JPEG 数据截断');
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return [bytes[at + 5] * 256 + bytes[at + 6], bytes[at + 3] * 256 + bytes[at + 4]];
      at += length;
    }
  }
  throw Error('地表贴图请选择 PNG 或 JPEG');
}
export class TerrainWorkflow {
  constructor(terrain) {
    this.terrain = terrain; this.app = terrain.app; this.epoch = 0; this.overlayEpoch = 0; this.busy = false; this.rivers = []; this.guides = true;
    this.riverGroup = new THREE.Group(); this.riverGroup.name = 'terrain-rivers';
    this.previewGroup = new THREE.Group(); this.previewGroup.name = 'terrain-river-preview';
    this.app.stage.world.add(this.riverGroup); this.app.stage.helperLayer.add(this.previewGroup);
    this.mapping = cleanHeightMapping({ size: terrain.size, n: terrain.n }); this.overlay = null; this.texture = null; this.readyPromise = Promise.resolve();
    this.erosionSettings = erosionSettings(); this.erosionView = 'result';
    this.offs = [];
    this.offs.push(this.app.bus.on('terrain', () => { if (this.riverSize !== terrain.size) this.rebuildRivers(); this.riverGroup.visible = terrain.enabled; this.syncOverlay(); if (this.erosionPreview && !this.erosionSourceValid(this.erosionPreview.source)) this.cancelErosionPreview(); }));
    this.offs.push(this.app.bus.on('terrain-material', () => { if (this.erosionPreview && !this.erosionSourceValid(this.erosionPreview.source)) this.cancelErosionPreview(); }));
    for (const event of ['perf', 'objects', 'light']) this.offs.push(this.app.bus.on(event, () => this.syncOverlay()));
    this.offs.push(this.app.bus.on('objects', () => { if (this.erosionPreview && !this.erosionSourceValid(this.erosionPreview.source)) this.cancelErosionPreview(); }));
    this.offs.push(this.app.bus.on('page-change', (page) => { if (page !== 'scene') {
      this.cancelDraft();
      if (this.busy && this.status === '计算侵蚀预览（尚未应用）') this.cancelJob();
      if (this.erosionPreview) { this.cancelErosionPreview(); this.app.notify?.('已离开场景，未应用的侵蚀预览已放弃'); }
    } }));
    this.bind();
  }
  changed() {
    if (this.drawing && !this.busy) { this.app.stage.host.style.cursor = 'crosshair'; this.cursorOwned = true; }
    else if (this.cursorOwned) { this.app.stage.host.style.cursor = ''; this.cursorOwned = false; }
    this.app.bus.emit('terrain-workflow');
  }
  assertEditable(allowBusy = false, allowPreview = false) { if (this.erosionPreview && !allowPreview) throw Error('请先应用或放弃侵蚀预览'); if (this.busy && !allowBusy) throw Error('另一个地形任务正在运行，请先取消'); if (this.app.aiScene?.busy || this.app.stage.exporting || this.app.exporter?.running || this.app.state.playing || this.app.state.preview) throw Error('请先停止播放 / 预览 / 导出再编辑地形'); }
  cancelJob() { this.epoch++; this.busy = false; this.status = ''; this.erosionProgress = null; this.changed(); }
  async job(label, fn) {
    this.assertEditable(); if (this.busy) throw Error('另一个地形任务正在运行，请先取消');
    const token = ++this.epoch; this.busy = true; this.erosionProgress = null; this.status = label; this.changed();
    const checkpoint = async () => { if (token !== this.epoch) throw Error('地形任务已取消'); await yieldTask(); if (token !== this.epoch) throw Error('地形任务已取消'); };
    try { return await fn(checkpoint, () => { if (token !== this.epoch) throw Error('地形任务已取消'); this.assertEditable(true); }); }
    finally { if (token === this.epoch) { this.busy = false; this.status = ''; this.changed(); } }
  }
  async stageHeight(file, channel = 'red') {
    return this.job('读取 PNG 高度图', async (checkpoint, valid) => {
      if (file.size > 16 * 1024 * 1024) throw Error('高度图文件不能超过 16MB');
      const decoded = await decodeHeightPNG(await file.arrayBuffer(), { channel, checkpoint }); valid();
      this.pendingHeight = decoded; this.heightName = file.name; this.changed(); return decoded;
    });
  }
  stopTools() {
    const a = this.app; this.terrain._cancelStroke?.(); a.state.terrainTool = null; this.terrain.refreshUI();
    a.vegetationBrush?.stop(); a.roadPlanning?.setPicking(false);
    if (a.roadBrush?._editBackup) a.roadBrush.cancelEdit(); else a.roadBrush?.stop();
  }
  async applyHeight(input = this.mapping) {
    if (!this.pendingHeight) throw Error('请先选择高度 PNG');
    this.assertEditable(); this.stopTools();
    const decoded = this.pendingHeight, sourceMesh = this.terrain.mesh, source = this.terrain.h, before = source.slice();
    const sourceWeights = this.terrain.weights, weights = sourceWeights.slice(), ex = this.terrain.exaggerate, enabled = this.terrain.enabled;
    return this.job('重采样高度图', async (checkpoint, valid) => {
      const result = await mappedHeights(decoded, input, checkpoint); valid();
      if (sourceMesh !== this.terrain.mesh || source !== this.terrain.h || sourceWeights !== this.terrain.weights || ex !== this.terrain.exaggerate || enabled !== this.terrain.enabled || !source.every((v, i) => v === before[i]) || !sourceWeights.every((v, i) => v === weights[i])) throw Error('地形已变化，请重新应用导入');
      const tr = this.terrain; this.stopTools(); this.cancelDraft(); this.app.beginOp('导入地形高度图');
      tr.n = result.settings.n; tr.size = result.settings.size; tr.exaggerate = 1; tr.h = result.h;
      tr.weights = new Float32Array(tr.n * tr.n * 6); tr.enabled = true; tr.autoSurface.enabled = true;
      this.mapping = result.settings; this.precise = true;
      this.heightSource = { name: String(this.heightName || '').slice(0, 120), width: decoded.width, height: decoded.height, depth: decoded.depth, channel: decoded.channel, ...result.settings };
      this.rebuildTerrain(); this.rebuildRivers(); this.app.bus.emit('terrain'); this.app.bus.emit('objects'); this.app.saveLocal?.();
      return result;
    });
  }
  frameTerrain() {
    this.assertEditable();
    const stage = this.app.stage, box = new THREE.Box3().setFromObject(this.terrain.mesh), sphere = box.getBoundingSphere(new THREE.Sphere());
    const vfov = THREE.MathUtils.degToRad(stage.view.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * stage.view.aspect);
    const distance = Math.max(10, sphere.radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.15);
    stage.orbit.target.copy(sphere.center); stage.view.position.copy(sphere.center).addScaledVector(new THREE.Vector3(1, .8, 1).normalize(), distance);
    stage.view.far = Math.max(stage.view.far, distance + sphere.radius * 2); stage.view.updateProjectionMatrix();
    stage.orbit.maxDistance = Math.max(stage.orbit.maxDistance, distance * 2); stage.view.lookAt(sphere.center); stage.orbit.update();
  }
  rebuildTerrain() {
    const tr = this.terrain; tr.mesh.removeFromParent(); tr.mesh.geometry.dispose(); tr.mesh.material.dispose(); tr._buildMesh(); tr.refresh(); this.syncOverlay();
  }
  async importOverlay(file) {
    return this.job('读取地表颜色贴图', async (checkpoint, valid) => {
      if (file.size > 16 * 1024 * 1024) throw Error('贴图文件不能超过 16MB');
      const bytes = new Uint8Array(await file.arrayBuffer()), [w, h] = imageDimensions(bytes);
      if (w < 1 || h < 1 || w > 8192 || h > 8192 || w * h > 16 * 1024 * 1024) throw Error('贴图最多 8192 单边 / 16777216 像素');
      await checkpoint(); let image;
      try {
        image = await bitmap(new Blob([bytes])); valid();
        if (image.width > 8192 || image.height > 8192 || image.width * image.height > 16 * 1024 * 1024) throw Error('解码后的贴图尺寸超过限制');
        const scale = Math.min(1, 1024 / Math.max(image.width, image.height)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/png'); if (!safeURL(url)) throw Error('压缩后的贴图仍超过约 2MB，请缩小图片后重试'); valid();
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        this.app.beginOp('导入地表贴图'); this.overlayEpoch++; this.texture?.dispose(); this.texture = texture;
        this.overlay = { url, name: String(file.name || '').slice(0, 120), width: canvas.width, height: canvas.height, opacity: 1, flipX: false, flipY: false };
        this.syncOverlay(); this.app.saveLocal?.(); this.changed();
      } finally { image?.close(); }
    });
  }
  syncOverlay() {
    const uniforms = this.terrain.mesh.material._terrainOverlay; if (!uniforms) return;
    uniforms.texture.value = this.texture; uniforms.enabled.value = this.texture && !this.app.stage.perfMode && this.app.state.tex !== false ? 1 : 0;
    uniforms.opacity.value = this.overlay?.opacity ?? 1; uniforms.flip.value.set(this.overlay?.flipX ? 1 : 0, this.overlay?.flipY ? 1 : 0);
  }
  configureOverlay(patch) {
    this.assertEditable(); if (!this.overlay) return;
    this.app.beginOp('调整地表贴图');
    if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) this.overlay.opacity = Math.max(0, Math.min(1, patch.opacity));
    for (const key of ['flipX', 'flipY']) if (typeof patch[key] === 'boolean') this.overlay[key] = patch[key];
    this.syncOverlay(); this.app.saveLocal?.(); this.changed();
  }
  removeOverlay() {
    this.assertEditable(); if (!this.overlay) return; this.cancelJob(); this.app.beginOp('移除地表贴图'); this.overlayEpoch++; this.texture?.dispose(); this.texture = null; this.overlay = null; this.syncOverlay(); this.app.saveLocal?.(); this.changed();
  }
  beginDraft(id = null) {
    this.assertEditable(); if (this.busy) throw Error('请先完成地形任务'); this.stopTools();
    const old = this.rivers.find((r) => r.id === id);
    if (!old && this.rivers.length >= 16) throw Error('最多保存 16 条手绘河道');
    this.draft = old ? clone(old) : { id: uid('river'), name: '河道 ' + (this.rivers.length + 1), points: [], width: 6, depth: 2, bank: 4, water: true };
    this.editingId = old?.id; this.drawing = !old; this.renderDraft(); this.rebuildRivers(); this.changed();
  }
  addPoint(point) {
    this.assertEditable();
    if (!this.draft || this.draft.points.length >= 64) throw Error('最多 64 个河道点');
    if (Math.abs(point.x) > this.terrain.size / 2 || Math.abs(point.z) > this.terrain.size / 2) return;
    this.draft.points.push([point.x, point.y - .15, point.z]); this.renderDraft(); this.changed();
  }
  updateDraft(patch) { this.assertEditable(); if (!this.draft) return; Object.assign(this.draft, patch); this.renderDraft(); this.changed(); }
  releasePointDrag(cancel = false) {
    const d = this.pointDrag; if (!d) return;
    if (cancel && this.draft?.points[d.index]) this.draft.points[d.index] = d.before;
    this.app.stage.orbit.enabled = d.orbitEnabled; this.pointDrag = null;
    try { this.app.stage.host.releasePointerCapture(d.pointerId); } catch {}
    if(this.draft) { this.renderDraft(); this.changed(); }
  }
  cancelDraft() { this.releasePointDrag(); this.draft = null; this.editingId = null; this.drawing = false; disposeGroup(this.previewGroup); this.rebuildRivers(); this.changed(); }
  setGuides(on) { this.guides = !!on; this.previewGroup.visible = !!on && !!this.draft && !this.app.state.preview; }
  riverMesh(river, preview = false) {
    const data = riverStrip(river, this.terrain.size), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setIndex(data.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: preview ? 0x51e0cf : 0x287687, transparent: true, opacity: preview ? .5 : .78, roughness: .22, metalness: .15, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = preview ? 'river-preview' : river.name; mesh.userData.pickIgnore = true; return mesh;
  }
  renderDraft() {
    disposeGroup(this.previewGroup); this.draftError = ''; if (!this.draft) return;
    if (this.draft.points.length >= 2) try { if (this.draft.water) this.previewGroup.add(this.riverMesh(this.draft, true)); else riverStrip(this.draft, this.terrain.size); } catch (e) { this.draftError = e.message; }
    if (this.draft.points.length) {
      const geometry = new THREE.BufferGeometry().setFromPoints(this.draft.points.map((p) => new THREE.Vector3(p[0], p[1] + .2, p[2])));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x66ffe3, depthTest: false })); line.userData.pickIgnore = true; line.renderOrder = 740; this.previewGroup.add(line);
    }
    if (this.draft.points.length) this.previewGroup.add(pointGuide(this.draft.points));
    this.setGuides(this.guides);
  }
  rebuildRivers() {
    disposeGroup(this.riverGroup); this.riverSize = this.terrain.size; this.invalidRivers = 0;
    for (const river of this.rivers) if (river.water && river.id !== this.editingId) try { this.riverGroup.add(this.riverMesh(river)); } catch { this.invalidRivers++; }
    this.riverGroup.visible = this.terrain.enabled;
  }
  async commitDraft(carve = false) {
    this.assertEditable(); if (!this.draft) throw Error('请先绘制或编辑一条河道');
    if (!this.terrain.enabled) throw Error('请先启用地形');
    const river = cleanRiver(this.draft, this.terrain.size); riverStrip(river, this.terrain.size);
    if (carve) return this.applyCarve(river, true);
    this.app.beginOp('保存手绘河道'); this.storeRiver(river); this.app.saveLocal?.();
  }
  storeRiver(river) {
    const index = this.rivers.findIndex((r) => r.id === river.id);
    if (index >= 0) this.rivers[index] = clone(river); else { if (this.rivers.length >= 16) throw Error('最多保存 16 条河道'); this.rivers.push(clone(river)); }
    this.cancelDraft(); this.rebuildRivers(); this.changed();
  }
  async applyCarve(river, save = false) {
    const tr = this.terrain, source = tr.h, before = source.slice(), n = tr.n, size = tr.size, ex = tr.exaggerate;
    return this.job('刻蚀手绘河道', async (checkpoint, valid) => {
      const result = await carveRiver(before, n, size, ex, river, checkpoint); valid();
      if (source !== tr.h || n !== tr.n || size !== tr.size || ex !== tr.exaggerate || !source.every((v, i) => v === before[i])) throw Error('计算期间地形已变化，未应用刻蚀，请重试');
      this.stopTools(); this.app.beginOp('刻蚀手绘河道'); tr.h = result.h; this.precise = true;
      if (save) this.storeRiver(result.river);
      tr.refresh(); this.app.bus.emit('terrain'); this.app.bus.emit('objects'); this.app.saveLocal?.(); this.status = `已降低 ${result.changed} 个顶点`; return result;
    });
  }
  deleteRiver(id) {
    this.assertEditable(); if (this.busy) throw Error('请先取消任务'); this.app.beginOp('删除河面 / 路径（保留已刻蚀地形）');
    this.rivers = this.rivers.filter((r) => r.id !== id); if (this.editingId === id) this.cancelDraft(); this.rebuildRivers(); this.app.saveLocal?.(); this.changed();
  }
  erosionSceneSignature() {
    return JSON.stringify(this.app.objects.map((o) => ({ id: o.id, type: o.type, params: o.params, p: o.root.position.toArray(), q: o.root.quaternion.toArray(), s: o.root.scale.toArray(), follow: o.followTerrain })));
  }
  erosionSourceValid(s) {
    const t = this.terrain;
    return s.mesh === t.mesh && s.h === t.h && s.weights === t.weights && s.n === t.n && s.size === t.size && s.ex === t.exaggerate && s.enabled === t.enabled &&
      s.rivers === JSON.stringify(this.rivers) && s.scene === this.erosionSceneSignature() &&
      s.surface === JSON.stringify({ biome: t.biome, auto: t.autoSurface, water: t.state.water, waterY: t.state.waterY }) &&
      t.h.every((v, i) => v === s.before[i]) && t.weights.every((v, i) => v === s.beforeWeights[i]);
  }
  configureErosion(patch) {
    this.assertEditable(false, true); this.cancelErosionPreview(false);
    this.erosionSettings = erosionSettings({ ...this.erosionSettings, ...patch }); this.app.saveLocal?.(); this.changed();
  }
  erosionPreset(key) {
    const preset = EROSION_PRESETS[key]; if (!preset) throw Error('无效侵蚀预设');
    const p = this.erosionSettings, region = {};
    for (const k of ['region', 'riverId', 'riverBand', 'riverProtect', 'protectObjects', 'centerX', 'centerZ', 'width', 'depth', 'seed']) region[k] = p[k];
    this.configureErosion({ ...preset.values, ...region });
  }
  async previewErosion() {
    this.assertEditable(false, true); if (!this.terrain.enabled) throw Error('请先启用地形');
    this.cancelErosionPreview(false); this.stopTools(); this.cancelDraft();
    const t = this.terrain, p = erosionSettings(this.erosionSettings);
    const source = { mesh: t.mesh, h: t.h, before: t.h.slice(), weights: t.weights, beforeWeights: t.weights.slice(), n: t.n, size: t.size, ex: t.exaggerate, enabled: t.enabled,
      rivers: JSON.stringify(this.rivers), scene: this.erosionSceneSignature(), surface: JSON.stringify({ biome: t.biome, auto: t.autoSurface, water: t.state.water, waterY: t.state.waterY }) };
    const boxes = [];
    if (p.protectObjects) for (const o of this.app.objects) {
      if (!o.root || ['fx', 'vegetation_patch'].includes(o.type)) continue;
      o.root.updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(o.root);
      if (!b.isEmpty() && [b.min.x, b.min.z, b.max.x, b.max.z].every(Number.isFinite)) boxes.push({ minX: b.min.x, minZ: b.min.z, maxX: b.max.x, maxZ: b.max.z });
    }
    return this.job('计算侵蚀预览（尚未应用）', async (checkpoint, valid) => {
      this.erosionProgress = { phase: '建立区域遮罩', value: 0 }; this.app.bus.emit('terrain-erosion-progress', this.erosionProgress);
      const mask = await erosionRegion(source.n, source.size, p, JSON.parse(source.rivers), boxes, checkpoint);
      const result = await erodeHeightfield(source.before, source.n, source.size, source.ex, p, mask, checkpoint, (progress) => {
        this.erosionProgress = progress; this.app.bus.emit('terrain-erosion-progress', progress);
      });
      valid(); if (!this.erosionSourceValid(source)) throw Error('计算期间地形 / 河道 / 场景已变化，未应用侵蚀，请重算');
      const geometry = source.mesh.geometry.clone(), pos = geometry.attributes.position;
      for (let i = 0; i < result.h.length; i++) pos.setY(i, result.h[i] * source.ex);
      pos.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, source.mesh.material); mesh.name = 'terrain-erosion-preview'; mesh.userData.pickIgnore = true; mesh.receiveShadow = true;
      mesh.position.copy(source.mesh.position); mesh.quaternion.copy(source.mesh.quaternion); mesh.scale.copy(source.mesh.scale);
      this.erosionPreview = { source, result, mesh, colors: geometry.attributes.color?.clone() };
      source.mesh.parent.add(mesh); this.erosionView = 'result'; this.showErosionPreview('result'); return result;
    });
  }
  showErosionPreview(view) {
    const p = this.erosionPreview; if (!p) return;
    this.assertEditable(true, true);
    if (!['result', 'before', 'erosion', 'sediment', 'flow', 'mask', 'delta'].includes(view)) return;
    this.erosionView = view; const mesh = p.mesh, { result, source } = p;
    if (mesh.material !== source.mesh.material) mesh.material.dispose();
    mesh.material = source.mesh.material;
    if (p.colors) mesh.geometry.setAttribute('color', p.colors);
    if (!['result', 'before'].includes(view)) {
      const values = view === 'delta' ? Float32Array.from(result.h, (v, i) => (v - source.before[i]) * source.ex) : result[view];
      let max = 0; for (const v of values) max = Math.max(max, Math.abs(v));
      const colors = new Float32Array(result.h.length * 3);
      for (let i = 0; i < values.length; i++) {
        const v = Math.log1p(Math.abs(values[i]) * 10) / Math.log1p((max || 1) * 10), at = i * 3;
        const color = view === 'mask' ? [values[i], values[i], values[i]] : view === 'flow' ? [.04 + .05 * v, .08 + .55 * v, .12 + .88 * v] : view === 'sediment' || (view === 'delta' && values[i] > 0) ? [.06 + .94 * v, .06 + .65 * v, .06 + .12 * v] : [.06 + .94 * v, .06 + .12 * v, .06 + .1 * v];
        colors.set(color, at);
      }
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    }
    source.mesh.visible = view === 'before'; mesh.visible = view !== 'before';
    let lo = 0; const heights = view === 'before' ? source.before : result.h; for (const v of heights) lo = Math.min(lo, v * source.ex);
    this.app.stage.setGroundY(lo - .35); this.changed();
  }
  cancelErosionPreview(emit = true) {
    const p = this.erosionPreview; if (!p) return;
    this.erosionPreview = null; p.mesh.removeFromParent(); p.mesh.geometry.dispose();
    if (p.mesh.material !== p.source.mesh.material) p.mesh.material.dispose();
    p.source.mesh.visible = this.terrain.mesh === p.source.mesh && this.terrain.enabled;
    let lo = 0; for (const v of this.terrain.h) lo = Math.min(lo, v * this.terrain.exaggerate);
    this.app.stage.setGroundY(this.terrain.enabled ? lo - .35 : -.035); this.erosionView = 'result';
    if (emit) this.changed();
  }
  applyErosionPreview() {
    this.assertEditable(false, true); const preview = this.erosionPreview; if (!preview) throw Error('请先计算侵蚀预览');
    if (!this.erosionSourceValid(preview.source)) { this.cancelErosionPreview(); throw Error('预览来源已变化，请重新计算'); }
    const result = preview.result; this.cancelErosionPreview(false); this.stopTools();
    if (!result.stats.affected) { this.changed(); this.app.notify?.('未产生可见高程变化，请调整强度、坡度阈值或区域'); return result; }
    // Capture the BEFORE state as Float32 too, even when it came from the legacy
    // generated/brush height field. Otherwise undo would quantize it to centimetres.
    this.precise = true; this.app.beginOp('应用地形侵蚀 / 沉积'); this.terrain.h = result.h.slice();
    this.erosionLastStats = { ...result.stats }; this.terrain.refresh();
    this.app.bus.emit('terrain'); this.app.bus.emit('objects'); this.app.saveLocal?.(); this.changed(); return result;
  }
  toJSON() { return { erosion: erosionSettings(this.erosionSettings), precise: !!this.precise, heightSource: this.heightSource ? clone(this.heightSource) : null, overlay: this.overlay ? { ...this.overlay } : null, rivers: clone(this.rivers) }; }
  reset() {
    this.releasePointDrag();
    this.cancelErosionPreview(false); this.erosionSettings = erosionSettings(); this.erosionProgress = null; this.erosionLastStats = null;
    this.cancelJob(); this.overlayEpoch++; this.readyPromise = Promise.resolve(); this.draft = null; this.editingId = null; this.drawing = false; this.pendingHeight = null; this.heightSource = null; this.precise = false;
    this.texture?.dispose(); this.texture = null; this.overlay = null; this.rivers = []; disposeGroup(this.previewGroup); disposeGroup(this.riverGroup); this.syncOverlay();
  }
  restore(value) {
    this.reset(); if (!value || typeof value !== 'object') return;
    this.erosionSettings = erosionSettings(value.erosion);
    this.mapping = cleanHeightMapping(value.heightSource || { size: this.terrain.size, n: this.terrain.n });
    this.precise = value.precise === true; this.heightSource = value.heightSource && typeof value.heightSource === 'object' ? { name: String(value.heightSource.name || '').slice(0, 120), ...cleanHeightMapping(value.heightSource), depth: value.heightSource.depth === 16 ? 16 : 8 } : null;
    this.rivers = (Array.isArray(value.rivers) ? value.rivers : []).slice(0, 16).flatMap((r) => { try { const river = cleanRiver(r, 600); riverStrip(river, 600); return [river]; } catch { return []; } });
    const ids = new Set(); for (const river of this.rivers) { if (!river.id || ids.has(river.id)) river.id = uid('river'); ids.add(river.id); }
    this.rebuildRivers();
    const record = value.overlay;
    if (record && safeURL(record.url)) {
      this.overlay = { url: record.url, name: String(record.name || '').slice(0, 120), width: Math.min(1024, Number(record.width) || 1024), height: Math.min(1024, Number(record.height) || 1024), opacity: Number.isFinite(record.opacity) ? Math.max(0, Math.min(1, record.opacity)) : 1, flipX: record.flipX === true, flipY: record.flipY === true };
      const token = this.overlayEpoch;
      this.readyPromise = (async () => {
        let image;
        try {
          const bin = atob(record.url.split(',')[1]), bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)), [w, h] = imageDimensions(bytes);
          if (w > 1024 || h > 1024 || w < 1 || h < 1) throw Error('存档地表贴图尺寸无效');
          image = await bitmap(new Blob([bytes])); if (token !== this.overlayEpoch) return;
          this.texture?.dispose(); this.texture = new THREE.Texture(image); this.texture.colorSpace = THREE.SRGBColorSpace;
          // Texture uploads are lazy; retain a canvas, not a closed ImageBitmap.
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0);
          this.texture.image = canvas; this.texture.needsUpdate = true; this.syncOverlay(); this.changed();
        } catch (e) { if (token === this.overlayEpoch) this.app.notify?.('地表贴图恢复失败：' + e.message, 'warn'); }
        finally { image?.close(); }
      })();
    }
    this.syncOverlay(); this.changed();
  }
  ready() { return this.readyPromise; }
  dispose() { this.reset(); this.bindController?.abort(); for (const off of this.offs) off(); this.riverGroup.removeFromParent(); this.previewGroup.removeFromParent(); }
  bind() {
    const host = this.app.stage.host, signal = (this.bindController = new AbortController()).signal;
    host.addEventListener('pointerdown', (event) => {
      if (!this.draft || event.button !== 0 || this.app.state.playing || this.app.state.preview || this.app.suspended || this.busy) return;
      const index = this.guides ? hitCurvePoint(event, this.app.stage, this.draft.points) : -1;
      if (index < 0 && !this.drawing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        this.assertEditable();
        if(index >= 0) {
          this.pointDrag = {index, before: [...this.draft.points[index]], pointerId: event.pointerId, orbitEnabled: this.app.stage.orbit.enabled};
          this.app.stage.orbit.enabled = false; host.setPointerCapture(event.pointerId);
        } else { const p = this.terrain.pointerPoint(event); if (p) this.addPoint(p); }
      } catch (e) { this.releasePointDrag(true); this.app.notify?.(e.message, 'warn'); }
    }, { capture: true, signal });
    host.addEventListener('pointermove', (event) => {
      const d = this.pointDrag; if(!d || event.pointerId !== d.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        this.assertEditable();
        const p = dragOnLevel(event, this.app.stage, d.before[1]);
        if(p && Math.abs(p.x) <= this.terrain.size/2 && Math.abs(p.z) <= this.terrain.size/2) {
          this.draft.points[d.index] = [p.x, d.before[1], p.z]; this.renderDraft();
        }
      } catch(e) { this.releasePointDrag(true); this.app.notify?.(e.message,'warn'); }
    }, {capture: true, signal});
    host.addEventListener('pointerup', (e) => {
      if(this.pointDrag && e.pointerId === this.pointDrag.pointerId) { e.preventDefault(); e.stopImmediatePropagation(); this.releasePointDrag(); }
      else if(this.drawing && e.button === 0) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, { capture: true, signal });
    for(const name of ['pointercancel', 'lostpointercapture']) host.addEventListener(name, e => {
      if(this.pointDrag && e.pointerId === this.pointDrag.pointerId) this.releasePointDrag(true);
    }, {signal});
    window.addEventListener('keydown', (event) => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName)) return;
      if (event.key === 'Escape' && this.erosionPreview) { event.preventDefault(); this.cancelErosionPreview(); return; }
      if (!this.draft) return;
      if (event.key === 'Escape') { event.preventDefault(); if(this.pointDrag) this.releasePointDrag(true); else this.cancelDraft(); }
      else if (event.key === 'Enter') { event.preventDefault(); this.drawing = false; this.changed(); }
      else if (event.key === 'Backspace' && this.drawing) { event.preventDefault(); this.draft.points.pop(); this.renderDraft(); this.changed(); }
    }, { signal });
  }
}
