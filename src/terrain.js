/**
 * terrain.js —— 地形编辑（高度场）
 * ---------------------------------------------------------------------------
 * 网格地形 + 6 种笔刷（抬起/压低/平滑/抹平/噪声/高原）+ 7 种一键生成 + 水面 +
 * 生物群系配色（草地/森林/沙漠/岩地/雪原/异星/焦土）。
 *
 * 与运镜的接口：
 *   - heightAt / slopeAt / normalAt：物体贴地、镜头离地高度提示
 *   - 物体默认 followTerrain，拖动时自动跟随地形
 *   - 数据（高度 + 参数）随工程 JSON 一起保存/加载，因此提示词里也能带上地形
 *
 * 编辑交互由 Stage 的 host 捕获层接管（画笔激活时禁用轨道控制）。
 */
import * as THREE from 'three';
import { TerrainWorkflow } from './terrain-workflow.js';
import { generateHeightfield, cleanGeneration } from './terrain-generation.js';
import { automaticSurface, cleanSurface } from './terrain-surface.js';
import { clamp, smoothNoise, makeRng } from './util.js';
import { terrainMaterial, setTerrainPalette, TERRAIN_MATERIALS, packWeights, unpackWeights } from './terrain-materials.js';

export const BIOMES = {
  grass: { name: '草地', low: '#4f7a3c', mid: '#6f9a4a', high: '#8d9b7a', rock: '#6b6459', snow: '#e8eef0' },
  forest: { name: '针叶林', low: '#33502f', mid: '#48683c', high: '#7b8272', rock: '#5b5a52', snow: '#eef3f5' },
  desert: { name: '沙漠', low: '#c9a469', mid: '#dcb87e', high: '#e6cba0', rock: '#b08d5c', snow: '#f2ece0' },
  rock: { name: '岩地', low: '#63605a', mid: '#84807a', high: '#a3a09a', rock: '#57544f', snow: '#dfe4e7' },
  snow: { name: '雪原', low: '#c9d6e0', mid: '#e6eef5', high: '#f7fbff', rock: '#8b94a0', snow: '#ffffff' },
  alien: { name: '异星', low: '#2f4a5c', mid: '#4c6f8a', high: '#8a5f9c', rock: '#39424f', snow: '#d9c7f0' },
  ash: { name: '焦土', low: '#3a3734', mid: '#575149', high: '#7a6a58', rock: '#2c2a28', snow: '#9a938a' },
};

export const TOOLS = [
  { id: 'raise', name: '抬起', icon: '⛰' },
  { id: 'lower', name: '压低', icon: '↧' },
  { id: 'smooth', name: '平滑', icon: '≈' },
  { id: 'slope', name: '坡度缓和', icon: '∠' },
  { id: 'flatten', name: '抹平', icon: '▭' },
  { id: 'noise', name: '噪声', icon: '∿' },
  { id: 'plateau', name: '高原台地', icon: '⌂' },
  { id: 'material', name: '涂材质', icon: '▧' },
  { id: 'roadfill', name: '路基填充', icon: '▰' },
];

export const TERRAIN_GEN = {
  plain: { name: '平原（近零）' },
  hills: { name: '丘陵' },
  ridge: { name: '山脊' },
  island: { name: '海岛' },
  craters: { name: '弹坑群' },
  canyon: { name: '峡谷' },
  plateau: { name: '台地' },
};

export class Terrain {
  /** @param {any} app 应用实例（需要 stage.world / bus / state） */
  constructor(app) {
    this.app = app;
    this.n = 97;                 // 网格单边顶点数（奇数，中心正好落在整数上）
    this.size = 160;             // 世界单位（米）
    this.h = new Float32Array(this.n * this.n);
    this.weights = new Float32Array(this.n * this.n * 6);
    this.biome = 'grass';
    this.autoSurface = cleanSurface();
    this.generation = cleanGeneration();
    this.enabled = true;
    this.exaggerate = 1;         // 高度夸张（不改变存下来的数据）
    this.state = { water: false, waterY: 0.06, brushSize: 9, brushStrength: 0.6, brushFalloff: .65, flattenHeight: 0, material: 'grass', maxSlope: 20 };
    this.rng = makeRng(20260924);

    this._buildMesh();
    this.setWater();
    this._bindPaint();
    this.workflow = new TerrainWorkflow(this);
    app.bus.on('dirty', () => this.app.saveLocal?.());
  }

  // ================= 网格 =================
  _buildMesh() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.n - 1, this.n - 1);
    geo.rotateX(-Math.PI / 2);
    this.colors = new Float32Array(this.n * this.n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = terrainMaterial();
    if (this.weights?.length !== this.n*this.n*6) this.weights = new Float32Array(this.n*this.n*6);
    geo.setAttribute('terrainWeightsA', new THREE.BufferAttribute(new Float32Array(this.n*this.n*3),3));
    geo.setAttribute('terrainWeightsB', new THREE.BufferAttribute(new Float32Array(this.n*this.n*3),3));
    this.autoWeights = new Float32Array(this.n*this.n*6);
    geo.setAttribute('terrainAutoA', new THREE.BufferAttribute(new Float32Array(this.n*this.n*3),3));
    geo.setAttribute('terrainAutoB', new THREE.BufferAttribute(new Float32Array(this.n*this.n*3),3));
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    this.mesh.userData.terrain = true;
    this.mesh.visible = this.enabled;
    this.app.stage.world.add(this.mesh);

    if (!this.water) {
      const wg = new THREE.PlaneGeometry(this.size * 1.6, this.size * 1.6, 1, 1);
      wg.rotateX(-Math.PI / 2);
      this.water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
        color: 0x2c5d6e, transparent: true, opacity: 0.72, roughness: 0.14, metalness: 0.35,
        depthWrite: false,                                  // 与地形斜交的水面若写深度，岸线会随帧闪
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      this.water.name = 'terrain-water';
      this.water.userData.pickIgnore = true;
      this.app.stage.world.add(this.water);
    } else {
      this.water.geometry.dispose();
      const wg = new THREE.PlaneGeometry(this.size * 1.6, this.size * 1.6, 1, 1);
      wg.rotateX(-Math.PI / 2);
      this.water.geometry = wg;
    }
    this.water.position.y = this.state.waterY;
    this.water.visible = this.enabled && this.state.water;
    this.workflow?.syncOverlay();
  }

  dispose() {
    this.workflow?.dispose();
    for (const o of [this.mesh, this.water, this._ring]) {
      if (!o) continue;
      o.parent?.remove(o);
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    }
    this._ring = null;
  }

  /** 高度数据 → 网格顶点（含夸张系数） */
  refresh() {
    const stage=this.app.stage;
    if(stage.terrainExtent!==this.size){
      stage.terrainExtent=this.size;
      stage.orbit.maxDistance=Math.max(900,this.size*2);
      stage.view.far=Math.max(3000,this.size*4);stage.view.updateProjectionMatrix();
    }
    const pos = this.mesh.geometry.attributes.position;
    let lo = 0;
    const ex = this.exaggerate || 1;
    for (let i = 0; i < this.n * this.n; i++) {
      const v = this.h[i] * ex;
      if (v < lo) lo = v;
      pos.setY(i, v);
    }
    pos.needsUpdate = true;
    // 地面压在容器最低点之下：地形覆盖不到的远景仍然有地面接阴影，但不会在山谷里顶穿地形
    if (this.app?.stage?.setGroundY) this.app.stage.setGroundY(this.enabled ? lo - 0.35 : -0.035);
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingBox(); this.mesh.geometry.computeBoundingSphere();
    this.refreshSurface();
    this.mesh.visible = this.enabled;
    this.water.visible = this.enabled && this.state.water;

  }

  /** 开关地形：开启时把默认平地与网格让位给地形（避免与高度场穿插） */
  setEnabled(v) {
    this.enabled = !!v;
    this.mesh.visible = this.enabled;
    this.water.visible = this.enabled && this.state.water;
    if (this.app.stage.syncGrid) this.app.stage.syncGrid();
    this.refresh();                      // 地面高度要跟地形状态联动（藏在地形最低点之下）
    if (this._ring) this._ring.visible = false;
    this.app.bus.emit('terrain');
  }

  setBiome(id) {
    if (!BIOMES[id]) return;
    this.biome = id;
    this.refreshSurface();
    this.app.bus.emit('terrain-material');
    this.app.saveLocal?.();
  }

  setBrush(o = {}) {
    if (o.size != null) this.state.brushSize = clamp(o.size, 1, this.size * 0.45);
    if (o.strength != null) this.state.brushStrength = clamp(o.strength, 0.02, 3);
    this._syncBrushUI();
  }

  setWater(force) {
    this.state.water = force == null ? this.state.water : !!force;
    this.water.visible = this.enabled && this.state.water;
    this.refreshSurface();
    this.app.bus.emit('terrain');
  }

  /** 水面高度（相对平均地面），-999 表示关闭 */
  setWaterLevel(v, { enable = true } = {}) {
    if (!Number.isFinite(v)) return;
    if (v <= -900) { this.state.water = false; }
    else { if (enable) this.state.water = true; this.state.waterY = clamp(v, -6, 30); }
    this.water.position.y = this.state.waterY;
    this.water.visible = this.enabled && this.state.water;
    this.refreshSurface();
    this.app.bus.emit('terrain');
  }

  setResolution(n) {
    n = clamp(Math.round(n), 33, 513) | 1;
    if (n === this.n) return;
    const old = { n: this.n, h: this.h, weights: this.weights };
    this.n = n;
    this.h = new Float32Array(n * n);
    this.weights = new Float32Array(n*n*6);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), v = j / (n - 1);
        const x = clamp(u * (old.n - 1), 0, old.n - 2) | 0;
        const y = clamp(v * (old.n - 1), 0, old.n - 2) | 0;
        const fx = u * (old.n - 1) - x, fy = v * (old.n - 1) - y;
        const a = old.h[y * old.n + x], b = old.h[y * old.n + Math.min(old.n - 1, x + 1)];
        const c = old.h[Math.min(old.n - 1, y + 1) * old.n + x], d = old.h[Math.min(old.n - 1, y + 1) * old.n + Math.min(old.n - 1, x + 1)];
        this.h[j * n + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
        for(let k=0;k<6;k++){
          const a=old.weights[(y*old.n+x)*6+k],b=old.weights[(y*old.n+x+1)*6+k],c=old.weights[((y+1)*old.n+x)*6+k],d=old.weights[((y+1)*old.n+x+1)*6+k];
          this.weights[(j*n+i)*6+k]=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
        }
      }
    }
    this.app.stage.world.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this._buildMesh();
    this.refresh();
  }

  setSize(size) {
    this.size = clamp(size, 40, 4096);
    this.app.stage.world.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this._buildMesh();
    this.refresh();
    this.app.bus.emit('terrain');
  }

  setExaggerate(v) {
    this.exaggerate = clamp(v, 0.2, 3);
    this.refresh();
  }

  // ================= 查询 =================
  _uv(x, z) {
    return [clamp((x / this.size + 0.5) * (this.n - 1), 0, this.n - 1.0001), clamp((z / this.size + 0.5) * (this.n - 1), 0, this.n - 1.0001)];
  }

  heightAt(x, z) {
    if (!this.enabled) return 0;
    const [u, v] = this._uv(x, z);
    const i = u | 0, j = v | 0;
    const fu = u - i, fv = v - j;
    const n = this.n, h = this.h;
    const i1 = Math.min(n - 1, i + 1), j1 = Math.min(n - 1, j + 1);
    const a = h[j * n + i], b = h[j * n + i1], c = h[j1 * n + i], d = h[j1 * n + i1];
    return ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv) * this.exaggerate;
  }

  slopeAt(x, z) {
    const e = this.size / (this.n - 1);
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.atan2(Math.hypot(hx, hz), 2 * e);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.size / (this.n - 1);
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** 某点的贴地坐标（物体/落点用） */
  snap(v) {
    if (!this.enabled) return v;
    v.y = Math.max(v.y, this.heightAt(v.x, v.z));
    return v;
  }

  // ================= 生成 =================
  generate(kind = this.generation.kind, amp = this.generation.amp, seed = this.generation.seed) {
    if(!Object.hasOwn(TERRAIN_GEN,kind))return false;
    this._cancelStroke?.();
    this.app.vegetationBrush?.stop();
    if(this.app.roadBrush?._editBackup)this.app.roadBrush.cancelEdit();else this.app.roadBrush?.stop();
    this.app.state.terrainTool=null;this.refreshUI();
    this.app.beginOp('生成地形与自动地貌');
    const result=generateHeightfield(this.n,this.size,{kind,amp,seed});
    this.generation=result.settings;this.h=result.h;this.autoSurface.enabled=true;
    if(result.waterY!==undefined){this.state.waterY=result.waterY;this.water.position.y=result.waterY;}
    this.enabled=true;this.refresh();
    this.app.bus.emit('terrain');this.app.bus.emit('objects');this.app.saveLocal?.();
    return true;
  }

  setAutoSurface(patch={}) {
    this.autoSurface=cleanSurface({...this.autoSurface,...patch});
    this.refreshSurface();this.app.bus.emit('terrain-material');this.app.saveLocal?.();
  }
  refreshSurface() {
    this.autoWeights=automaticSurface(this.h,this.n,this.size,this.exaggerate||1,this.biome,this.autoSurface,{enabled:this.state.water,level:this.state.waterY},this.autoWeights);
    const a=this.mesh.geometry.attributes.terrainAutoA,b=this.mesh.geometry.attributes.terrainAutoB;
    for(let i=0;i<this.n*this.n;i++){a.setXYZ(i,this.autoWeights[i*6],this.autoWeights[i*6+1],this.autoWeights[i*6+2]);b.setXYZ(i,this.autoWeights[i*6+3],this.autoWeights[i*6+4],this.autoWeights[i*6+5]);}
    a.needsUpdate=b.needsUpdate=true;
    setTerrainPalette(this.mesh.material,BIOMES[this.biome]||BIOMES.grass,this.biome);
    this._refreshWeights();
    if(this.autoSurface.enabled){this.colors.fill(1);this.mesh.geometry.attributes.color.needsUpdate=true;}else this._applyVertexColors();
    this.app.lighting?.physical?.color.patch(this.mesh.material);
  }

  /** 挖一个平滑凹地（池塘 / 河湾 / 弹坑），半径 r、深度 depth */
  basin(x, z, r = 12, depth = 1.6) {
    const n = this.n, cell = this.size / (n - 1), h = this.h;
    const rr = Math.max(cell * 2, r);
    const [ci, cj] = this._uv(x, z);
    const i0 = Math.max(0, Math.floor(ci - rr / cell)), i1 = Math.min(n - 1, Math.ceil(ci + rr / cell));
    const j0 = Math.max(0, Math.floor(cj - rr / cell)), j1 = Math.min(n - 1, Math.ceil(cj + rr / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -this.size / 2 + i * cell, pz = -this.size / 2 + j * cell;
        const w = clamp(1 - Math.hypot(px - x, pz - z) / rr, 0, 1);
        h[j * n + i] -= depth * (w * w * (3 - 2 * w));
      }
    }
    this.refresh();
    this.app?.bus?.emit('terrain'); this.app?.bus?.emit('objects'); this.app?.markDirty?.();
  }
  /** 找平一块圆形地基（大体积建筑 / 长廊放在起伏地面上时会「架空」，先把它脚下压平） */
  padAt(x, z, r = 10, y = 0, opts = {}) {
    if (!this.enabled) return null;
    const n = this.n, cell = this.size / (n - 1), h = this.h, ex = this.exaggerate || 1;
    const rr = Math.max(cell * 3, r);
    const [ci, cj] = this._uv(x, z);
    const i0 = Math.max(0, Math.floor(ci - rr / cell)), i1 = Math.min(n - 1, Math.ceil(ci + rr / cell));
    const j0 = Math.max(0, Math.floor(cj - rr / cell)), j1 = Math.min(n - 1, Math.ceil(cj + rr / cell));
    const tgt = y / ex;
    const snap = { i0, i1, j0, j1, h: new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1)), dirty: false };
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -this.size / 2 + i * cell, pz = -this.size / 2 + j * cell;
        const w = clamp(1 - Math.hypot(px - x, pz - z) / rr, 0, 1);
        const idx = j * n + i, k = (j - j0) * (i1 - i0 + 1) + (i - i0);
        snap.h[k] = h[idx];
        if (w <= 0) continue;
        const fall = w * w * (3 - 2 * w);
        const nv = h[idx] + (tgt - h[idx]) * fall * 0.92;
        if (Math.abs(nv - h[idx]) > 1e-5) { h[idx] = nv; snap.dirty = true; }
      }
    }
    if (!snap.dirty) return null;                                  // 已经平了：不用记还原，也省一次重算
    if (!opts.silent) { this.refresh(); this.app?.bus?.emit('terrain'); this.app?.markDirty?.(); }
    return snap;
  }
  /** 圆盘范围内地面的平均高度：给「脚下找平」当目标值 —— 只抹掉起伏，不会挖坑也不会堆包 */
  meanHeight(x, z, r = 10) {
    const n = this.n, cell = this.size / (n - 1), h = this.h, ex = this.exaggerate || 1;
    const rr = Math.max(cell * 2, r);
    const [ci, cj] = this._uv(x, z);
    const i0 = Math.max(0, Math.floor(ci - rr / cell)), i1 = Math.min(n - 1, Math.ceil(ci + rr / cell));
    const j0 = Math.max(0, Math.floor(cj - rr / cell)), j1 = Math.min(n - 1, Math.ceil(cj + rr / cell));
    let sum = 0, wsum = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -this.size / 2 + i * cell, pz = -this.size / 2 + j * cell;
        const d = Math.hypot(px - x, pz - z);
        const w = 1 - d / rr;
        if (w <= 0) continue;
        sum += h[j * n + i] * w; wsum += w;
      }
    }
    return wsum > 0 ? (sum / wsum) * ex : this.heightAt(x, z);
  }
  /** 撤销找平：把 padAt 记下的高度写回去（物件被删掉时调用，地形恢复原样） */
  unpadAt(snap, opts = {}) {
    if (!snap || !this.enabled || !snap.h) return false;
    const n = this.n, w = snap.i1 - snap.i0 + 1, h = this.h;
    for (let j = snap.j0; j <= snap.j1; j++) for (let i = snap.i0; i <= snap.i1; i++) h[j * n + i] = snap.h[(j - snap.j0) * w + (i - snap.i0)];
    if (!opts.silent) { this.refresh(); this.app?.bus?.emit('terrain'); this.app?.markDirty?.(); }
    return true;
  }

  /** 自动水位：把水面定在高度场的某个分位（frac=0.14 → 只有最低的 14% 积水），避免「整张地图发洪水」 */
  autoWaterLevel(frac = 0.14) {
    const ex = this.exaggerate || 1;
    const arr = Array.from(this.h, (v) => v * ex).sort((a, b) => a - b);
    const q = arr[clamp(Math.floor(arr.length * frac), 0, arr.length - 1)] - 0.06;
    this.setWaterLevel(q);
    return q;
  }

  // ================= 绘制 =================
  paintAt(x, z, dir = 1, options = {}) {
    const tool = options.tool || this.app.state.terrainTool;
    if (!tool || !this.enabled) return;
    const n = this.n, cell = this.size / (n - 1);
    const r = Math.max(cell, this.state.brushSize);
    const s = this.state.brushStrength * dir;
    if(tool==='roadfill'){this.app.roadTerrain?.fillAt(x,z,r,Math.abs(s));if(options.refresh!==false)this.refresh();return;}
    const src=tool==='smooth'?Float32Array.from(this.h):this.h;
    const integral=tool==='smooth'?new Float64Array((n+1)*(n+1)):null;
    if(integral)for(let j=0;j<n;j++){let row=0;for(let i=0;i<n;i++){row+=src[j*n+i];integral[(j+1)*(n+1)+i+1]=row+integral[j*(n+1)+i+1];}}
    const smoothRadius=Math.max(1,Math.min(10,Math.round(r/cell*.3)));
    const layer=TERRAIN_MATERIALS.findIndex(m=>m.id===this.state.material);
    // 世界坐标 → 顶点下标：i = (x + size/2) / cell（与 _uv 同一套映射）
    const [cx, cz] = this._uv(x, z);
    const rr = r / cell;
    const i0 = Math.max(0, Math.floor(cx - rr));
    const i1 = Math.min(n - 1, Math.ceil(cx + rr));
    const j0 = Math.max(0, Math.floor(cz - rr));
    const j1 = Math.min(n - 1, Math.ceil(cz + rr));
    const h = this.h;
    const avg = (this.state.flattenHeight ?? this.heightAt(x,z)) / this.exaggerate;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -this.size / 2 + i * cell, pz = -this.size / 2 + j * cell;
        const w = clamp(1 - Math.hypot(px - x, pz - z) / r, 0, 1);
        const edge=clamp(w / Math.max(.02,this.state.brushFalloff??.65),0,1);
        const fall = edge * edge * (3 - 2 * edge);
        const idx = j * n + i;
        if (tool === 'raise') h[idx] += s * fall * .65 / this.exaggerate;
        else if (tool === 'lower') h[idx] -= s * fall * .65 / this.exaggerate;
        else if (tool === 'smooth') {
          const a = h[idx];
          const x0=Math.max(0,i-smoothRadius),x1=Math.min(n-1,i+smoothRadius)+1,z0=Math.max(0,j-smoothRadius),z1=Math.min(n-1,j+smoothRadius)+1;
          const sum=integral[z1*(n+1)+x1]-integral[z0*(n+1)+x1]-integral[z1*(n+1)+x0]+integral[z0*(n+1)+x0],cnt=(x1-x0)*(z1-z0);
          h[idx] = a + (sum / Math.max(1, cnt) - a) * clamp(fall * Math.abs(s) * 1.6, 0, 1);
        } else if (tool === 'slope') {
          const anchor=(this._slopeAnchor??this.heightAt(x,z))/this.exaggerate;
          const limit=Math.hypot(px-x,pz-z)*Math.tan((this.state.maxSlope??20)*Math.PI/180)/this.exaggerate;
          h[idx]+=(clamp(src[idx],anchor-limit,anchor+limit)-h[idx])*clamp(fall*Math.abs(s)*1.8,0,1);
        } else if (tool === 'material' && layer>=0) {
          const amount=clamp(fall*Math.abs(s)*.65,0,1);
          for(let k=0;k<6;k++)this.weights[idx*6+k]*=1-amount;
          if(dir>0)this.weights[idx*6+layer]+=amount;
        } else if (tool === 'flatten') {
          h[idx] += (avg - h[idx]) * clamp(fall * s * 1.8, 0, 1);
        } else if (tool === 'noise') {
          h[idx] += (smoothNoise(px * 0.35, pz * 0.35) * 2 - 1) * s * fall * cell * 1.2;
        } else if (tool === 'plateau') {
          const step = Math.max(0.4, r * 0.18);
          const target = Math.round((h[idx] + s * 0.6) / step) * step;
          h[idx] += (target - h[idx]) * clamp(fall * s * 1.2, 0, 1);
        }
      }
    }
    if(options.refresh!==false){if(tool==='material')this._refreshWeights();else this.refresh();}
  }

  /** 全图平滑 N 轮（3×3 均值），用于削掉笔刷留下的尖刺 */
  smoothAll(rounds = 2) {
    const n = this.n, h = this.h;
    let touched = 0;
    for (let r = 0; r < clamp(rounds, 1, 8); r++) {
      const src = Float32Array.from(h);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let sum = 0, cnt = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj < 0 || ii < 0 || jj >= n || ii >= n) continue;
            sum += src[jj * n + ii]; cnt++;
          }
          h[j * n + i] = sum / Math.max(1, cnt);
          touched++;
        }
      }
    }
    this.refresh();
    return touched;
  }

  /** 拾取：射线与地形求交（未启用时由调用方回退到平面） */
  raycastToGround(raycaster, out = new THREE.Vector3()) {
    if (!this.enabled) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    return out.copy(hit.point);
  }

  _refreshWeights(){
    const a=this.mesh.geometry.attributes.terrainWeightsA,b=this.mesh.geometry.attributes.terrainWeightsB;
    for(let i=0;i<this.n*this.n;i++){a.setXYZ(i,this.weights[i*6],this.weights[i*6+1],this.weights[i*6+2]);b.setXYZ(i,this.weights[i*6+3],this.weights[i*6+4],this.weights[i*6+5]);}
    a.needsUpdate=b.needsUpdate=true;
  }
  activateTool(id){
    if (this.workflow?.busy) { this.app.notify?.('请先完成或取消地形任务', 'warn'); return false; }
    this.workflow?.cancelErosionPreview();
    this.workflow?.cancelDraft();
    this._cancelStroke?.();
    this.app.vegetationBrush?.stop();this.app.roadPlanning?.setPicking(false);this.app.roadConnector?.setPicking(null);
    if(this.app.roadBrush?._editBackup)this.app.roadBrush.cancelEdit();else this.app.roadBrush?.stop();
    this.app.state.terrainTool=id===this.app.state.terrainTool?null:id;this.refreshUI();
  }

  // ================= 着色 =================
  _applyVertexColors() {
    const pal = BIOMES[this.biome] || BIOMES.grass;
    const cLow = new THREE.Color(pal.low), cMid = new THREE.Color(pal.mid), cHigh = new THREE.Color(pal.high);
    const cRock = new THREE.Color(pal.rock), cSnow = new THREE.Color(pal.snow);
    const n = this.n, h = this.h;
    const maxH = Math.max(0.001, h.reduce((a, b) => Math.max(a, b), 0));
    const col = this.colors;
    const tmp = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const hn = clamp(h[idx] / maxH, -1, 1);
        const sl = Math.min(1, slopeOf(h, n, i, j) * 2.6);
        tmp.copy(cLow).lerp(cMid, clamp(hn + 0.5, 0, 1));
        if (hn > 0.32) tmp.lerp(cHigh, clamp((hn - 0.32) / 0.5, 0, 1));
        if (sl > 0.35) tmp.lerp(cRock, clamp((sl - 0.35) / 0.5, 0, 1));
        if (hn > 0.62 && sl < 0.5) tmp.lerp(cSnow, clamp((hn - 0.62) / 0.3, 0, 1) * (1 - clamp((sl - 0.3) * 2, 0, 1)));
        const m = 1 + (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1) * 0.04;
        const o = idx * 3;
        col[o] = clamp(tmp.r * m, 0, 1);
        col[o + 1] = clamp(tmp.g * m, 0, 1);
        col[o + 2] = clamp(tmp.b * m, 0, 1);
      }
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  // ================= 序列化 =================
  /** 高度 → Int16(厘米) → base64，避免工程 JSON 膨胀 */
  pack() {
    const n = this.n;
    const buf = new ArrayBuffer(n * n * 2);
    const v = new Int16Array(buf);
    for (let i = 0; i < v.length; i++) v[i] = Math.max(-32768, Math.min(32767, Math.round(this.h[i] * 100)));
    let bin = '';
    const u8 = new Uint8Array(buf);
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(u8).toString('base64');
  }

  packFloat32(){
    const bytes=new Uint8Array(this.h.buffer,this.h.byteOffset,this.h.byteLength);let bin='';
    for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin);
  }

  unpack(data) {
    const n = this.n;
    if (typeof data !== 'string') return;
    try {
      const bin = typeof atob === 'function' ? atob(data) : Buffer.from(data, 'base64').toString('binary');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
      const v = new Int16Array(u8.buffer);
      if (v.length !== n * n) return;
      for (let i = 0; i < v.length; i++) this.h[i] = v[i] / 100;
      this.refresh();
    } catch (e) { console.warn('terrain unpack', e); }
  }

  toJSON() {
    return {
      n: this.n, size: this.size, biome: this.biome, enabled: this.enabled,
      workflow: this.workflow?.toJSON(),
      autoSurface: {...this.autoSurface}, generation: {...this.generation},
      exaggerate: this.exaggerate, water: this.state.water, waterY: this.state.waterY,
      brushSize: this.state.brushSize, brushStrength: this.state.brushStrength,
      maxSlope: this.state.maxSlope, brushFalloff: this.state.brushFalloff, flattenHeight: this.state.flattenHeight, material: this.state.material,
      p64: this.weights.some(v=>v>0)?packWeights(this.weights):undefined,
      h32: (this.workflow?.precise || this.h.some(v=>v < -327.68 || v > 327.67))?this.packFloat32():undefined,
      h64: (this.workflow?.precise || this.h.some(v=>v < -327.68 || v > 327.67))?undefined:this.pack(),
    };
  }

  fromJSON(d = {}) {
    if (!d || typeof d !== 'object') { this.refresh(); return; }
    this.biome = BIOMES[d.biome] ? d.biome : this.biome;
    this.autoSurface=cleanSurface(d.autoSurface||{enabled:false});
    this.generation=cleanGeneration(d.generation);
    if (d.size) this.size = clamp(d.size, 40, 4096);
    if (d.exaggerate) this.exaggerate = clamp(d.exaggerate, 0.2, 3);
    if (d.n && d.n !== this.n) { this.n = clamp(Math.round(d.n), 33, 513) | 1; this.h = new Float32Array(this.n * this.n); }
    this.weights = unpackWeights(d.p64, this.n*this.n*6);
    this.state.maxSlope=clamp(d.maxSlope??20,5,60);
    this.state.brushFalloff = clamp(d.brushFalloff ?? .65,.02,1); this.state.flattenHeight = d.flattenHeight ?? 0;
    this.state.material = TERRAIN_MATERIALS.some(m=>m.id===d.material)?d.material:'grass';
    this.enabled = d.enabled !== false;
    this.state.water = d.water === true;
    this.state.waterY = d.waterY ?? this.state.waterY;
    this.state.brushSize = d.brushSize ?? this.state.brushSize;
    this.state.brushStrength = d.brushStrength ?? this.state.brushStrength;
    this.app.stage.world.remove(this.mesh);
    this.mesh.geometry?.dispose(); this.mesh.material?.dispose();
    this._buildMesh();
    this.water.position.y = this.state.waterY;
    if (d.h32) {
      try { const bin=atob(d.h32); if(bin.length!==this.n*this.n*4)throw new Error('地形高度尺寸不匹配'); const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0)); const heights=new Float32Array(bytes.buffer); if(!heights.every(Number.isFinite))throw new Error('无效地形高度'); this.h.set(heights); } catch(e){console.warn('terrain float32',e);}
      this.refresh();
    } else if (d.h64) this.unpack(d.h64);
    else this.refresh();
    this.workflow?.restore(d.workflow);
    // A restored snapshot already contains authored transforms/heights; don't refit them again.
    this.app.bus.emit('terrain', { restored: true });
  }

  // ================= UI 同步 =================
  refreshUI() {
    this._syncBrushUI();
  }

  _syncBrushUI() {
    if (!this.app.state.terrainTool && this._ring) this._ring.visible = false;
    const host = this.app.panels?.terrainHost;
    if (!host) return;
    host.querySelectorAll('[data-field="target"] input').forEach(e=>{if(document.activeElement!==e)e.value=this.state.flattenHeight;});
    host.querySelectorAll('[data-terrain-radius]').forEach(e=>{if(document.activeElement!==e)e.value=this.state.brushSize;});
    host.querySelectorAll('[data-tsize]').forEach((e) => { e.textContent = `${this.state.brushSize.toFixed(1)} m`; });
    host.querySelectorAll('[data-tstrength]').forEach((e) => { e.textContent = this.state.brushStrength.toFixed(2); });
    host.querySelectorAll('.brushgrid .bchip').forEach((b) => b.classList.toggle('on', b.dataset.brush === this.app.state.terrainTool));
  }

  // ================= 指针接管 =================
  _bindPaint() {
    const st=this.app.stage,host=st.host||st.canvas.parentElement;
    if(!host)return;
    let stroke=null;
    const active=()=>!!this.app.state.terrainTool&&!this.app.state.playing&&!this.app.state.preview&&!this.app.suspended&&this.enabled;
    const aim=ev=>this.pointerPoint(ev);
    const stamp=(ev,p)=>{
      if(!p)return;
      const prev=stroke.last||p,d=Math.hypot(prev.x-p.x,prev.z-p.z),steps=Math.min(48,Math.max(1,Math.ceil(d/Math.max(.3,this.state.brushSize*.18))));
      for(let i=1;i<=steps;i++){const q=prev.clone().lerp(p,i/steps);this.paintAt(q.x,q.z,ev.shiftKey?-1:1,{refresh:false,tool:ev.altKey?'smooth':this.app.state.terrainTool});}
      if(ev.altKey || this.app.state.terrainTool!=='material')stroke.heightChanged=true;
      if(ev.altKey||this.app.state.terrainTool!=='material')this.refresh();else this._refreshWeights();
      stroke.last=p.clone();st.view.invalidate?.();
    };
    this._cancelStroke=()=>{
      if(!stroke)return;const old=stroke;stroke=null;this._strokeActive=false;this.h=old.h;this.weights=old.weights;this.refresh();
      if(old.undo){this.app._undo=old.undoEntries;this.app._undoBytes=this.app._undo.reduce((n,u)=>n+(u.size||0),0);this.app._undoAvail=this.app._undo.length;this.app._redo=old.redo;this.app._redoAvail=old.redo.length;this.app.bus.emit('undoable');}
      st.orbit.enabled=old.orbit;try{host.releasePointerCapture(old.pointer);}catch{}this._slopeAnchor=null;
    };
    host.addEventListener('pointerdown',ev=>{
      if(ev.button!==0||!active())return;const p=aim(ev);if(!p)return;
      ev.preventDefault();ev.stopImmediatePropagation();
      if(ev.ctrlKey||ev.metaKey){this.state.flattenHeight=p.y;this.refreshUI();this.app.bus.emit('terrain-brush');return;}
      this._strokeActive=true;this._slopeAnchor=p.y;
      stroke={h:this.h.slice(),weights:this.weights.slice(),orbit:st.orbit.enabled,pointer:ev.pointerId,undoLength:this.app._undo?.length||0,undoEntries:[...(this.app._undo||[])],redo:[...(this.app._redo||[])]};
      stroke.undo=this.app.beginOp?.(this.app.state.terrainTool==='material'?'局部地形材质':'地形笔刷','',true);
      st.orbit.enabled=false;try{host.setPointerCapture(ev.pointerId);}catch{}stamp(ev,p);
    },true);
    host.addEventListener('pointermove',ev=>{if(active())this._cursor(ev);if(stroke){ev.preventDefault();ev.stopImmediatePropagation();stamp(ev,aim(ev));}},true);
    const end=ev=>{if(!stroke)return;if(!this.h.some((v,i)=>v!==stroke.h[i])&&!this.weights.some((v,i)=>v!==stroke.weights[i])){this._cancelStroke();return;}const old=stroke;stroke=null;this._strokeActive=false;this._slopeAnchor=null;st.orbit.enabled=old.orbit;try{host.releasePointerCapture(old.pointer);}catch{}if(old.heightChanged){this.app.bus.emit('terrain');this.app.bus.emit('objects');}else this.app.bus.emit('terrain-material');this.app.saveLocal?.();ev.stopImmediatePropagation();};
    host.addEventListener('pointerup',end,true);host.addEventListener('pointercancel',()=>this._cancelStroke(),true);
    host.addEventListener('lostpointercapture',()=>{if(stroke)this._cancelStroke();},true);
    host.addEventListener('pointerleave',()=>{if(this._ring)this._ring.visible=false;},true);
    window.addEventListener('keydown',ev=>{if(ev.key==='Escape')this._cancelStroke();});
    host.addEventListener('wheel',ev=>{if(active()&&ev.altKey){ev.preventDefault();ev.stopImmediatePropagation();this.setBrush({size:this.state.brushSize*(ev.deltaY>0?.9:1.1)});}}, {capture:true,passive:false});
  }

  pointerPoint(ev) {
    const st=this.app.stage,r=st.canvas.getBoundingClientRect();
    st.pointer.set((ev.clientX-r.left)/r.width*2-1,-(ev.clientY-r.top)/r.height*2+1);
    st.raycaster.setFromCamera(st.pointer,st.view);
    return this.raycastToGround(st.raycaster);
  }

  _cursor(ev) {
    const st = this.app.stage;
    const p = this.pointerPoint(ev);
    if (!p || !isFinite(p.x)) return;
    if (!this._ring) {
      const geo = new THREE.RingGeometry(0.975, 1, 96);
      geo.rotateX(-Math.PI / 2);
      geo.userData.flatPositions=geo.attributes.position.array.slice();
      const mat = new THREE.MeshBasicMaterial({ color: 0x7ce0b0, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide });
      this._ring = new THREE.Mesh(geo, mat);
      this._ring.renderOrder = 720;
      this._ring.userData.pickIgnore = true;
      st.world.add(this._ring);
    }
    this._ring.visible = this.guides !== false && !this.app.state.preview;
    this._ring.position.set(p.x, this.heightAt(p.x, p.z) + 0.14, p.z);
    const pos=this._ring.geometry.attributes.position,flat=this._ring.geometry.userData.flatPositions,radius=this.state.brushSize;
    for(let i=0;i<pos.count;i++){const x=flat[i*3]*radius,z=flat[i*3+2]*radius;pos.setXYZ(i,x,this.heightAt(p.x+x,p.z+z)-this.heightAt(p.x,p.z),z);}
    pos.needsUpdate=true;this._ring.geometry.computeBoundingSphere();this._ring.scale.setScalar(1);
  }
}

/** 顶点法线方向的粗略坡度（0 = 平地，1 = 陡壁） */
function slopeOf(h, n, i, j) {
  const a = h[j * n + Math.max(0, i - 1)], b = h[j * n + Math.min(n - 1, i + 1)];
  const c = h[Math.max(0, j - 1) * n + i], d = h[Math.min(n - 1, j + 1) * n + i];
  return Math.hypot(b - a, d - c) * 0.5;
}
