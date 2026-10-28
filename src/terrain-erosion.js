// Deterministic height-field approximation, not World Creator's proprietary algorithms.
// Every transfer accounts for removed/deposited material; unplaced particle load is reported.
export const EROSION_DEFAULTS = Object.freeze({ mode: 'combined', style: 'natural', strength: .6, iterations: 12, angle: 32, thermal: .3,
  drops: 8000, lifetime: 48, inertia: .3, erosion: .35, deposition: .4, evaporation: .035, capacity: 3, radius: 1.5,
  settling: .25, sedimentDepth: .7, maxChange: 3, layerScale: 3, seed: 12345,
  region: 'all', riverId: 'all', riverBand: 10, riverProtect: true, protectObjects: true, centerX: 0, centerZ: 0, width: 40, depth: 40 });
export const EROSION_PRESETS = Object.freeze({
  natural: { label: '自然坡地', values: { ...EROSION_DEFAULTS } },
  thermal: { label: '热力风化', values: { ...EROSION_DEFAULTS, mode: 'thermal', thermal: .5, iterations: 20, angle: 30 } },
  rain: { label: '雨水沟谷', values: { ...EROSION_DEFAULTS, mode: 'hydraulic', drops: 14000, erosion: .5, settling: .12 } },
  sediment: { label: '沉积整理', values: { ...EROSION_DEFAULTS, mode: 'sediment', iterations: 18, angle: 12, settling: .5, sedimentDepth: 1 } },
  rocky: { label: '岩质风化', values: { ...EROSION_DEFAULTS, style: 'rocky', angle: 43, thermal: .12, erosion: .55, layerScale: 2.5, maxChange: 2.5 } },
  ridged: { label: '脊状沟壑', values: { ...EROSION_DEFAULTS, style: 'ridged', angle: 46, thermal: .08, radius: .5, inertia: .15, erosion: .65, deposition: .2, drops: 14000, settling: .08 } },
});
export function erosionSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const limits = { strength: [0, 1], iterations: [1, 40], angle: [1, 65], thermal: [0, 1], drops: [0, 60000], lifetime: [4, 96], inertia: [0, .95], erosion: [0, 1], deposition: [0, 1], evaporation: [.001, .5], capacity: [.1, 10], radius: [.1, 8], settling: [0, 1], sedimentDepth: [0, 10], maxChange: [.01, 50], layerScale: [.2, 30], seed: [1, 2147483647], riverBand: [1, 80], centerX: [-2048, 2048], centerZ: [-2048, 2048], width: [1, 4096], depth: [1, 4096] };
  const result = { ...EROSION_DEFAULTS };
  for (const [key, [lo, hi]] of Object.entries(limits)) if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = Math.max(lo, Math.min(hi, value[key]));
  for (const key of ['iterations', 'drops', 'lifetime', 'seed']) result[key] = Math.round(result[key]);
  for (const [key, options] of Object.entries({ mode: ['combined', 'thermal', 'hydraulic', 'sediment'], style: ['natural', 'rocky', 'ridged'], region: ['all', 'river', 'outside', 'box'] })) if (options.includes(value[key])) result[key] = value[key];
  for (const key of ['riverProtect', 'protectObjects']) if (typeof value[key] === 'boolean') result[key] = value[key];
  result.riverId = typeof value.riverId === 'string' ? value.riverId.slice(0, 80) : 'all'; return result;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pause = () => new Promise((r) => setTimeout(r, 0));
export async function erodeHeightfield(source, n, size, ex, input = {}, mask = null, checkpoint = pause, progress = () => {}) {
  if (!Number.isInteger(n) || n < 3 || n > 513 || source.length !== n * n || !Number.isFinite(size) || size <= 0 || !Number.isFinite(ex) || ex <= 0 || !source.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6)) throw Error('无效或超出范围的侵蚀高度场');
  if (mask && (mask.length !== source.length || !mask.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))) throw Error('无效侵蚀遮罩');
  const p = erosionSettings(input), count = n * n, cell = size / (n - 1), area = cell * cell;
  const base = Float64Array.from(source, (v) => v * ex), h = base.slice(), loose = new Float64Array(count), weights = new Float32Array(count);
  const erosion = new Float32Array(count), sediment = new Float32Array(count), flow = new Float32Array(count);
  let randomState = p.seed >>> 0, unplaced = 0, returned = 0;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) weights[j * n + i] = mask ? mask[j * n + i] : 1;
  const hardness = (index) => {
    if (p.style === 'rocky') return .2 + .8 * (.5 + .5 * Math.cos(base[index] / p.layerScale * Math.PI * 2)) ** 2;
    if (p.style === 'ridged') {
      const crest = Math.max(0, base[index] - (base[index - 1] + base[index + 1] + base[index - n] + base[index + n]) / 4);
      return 1 / (1 + crest / (cell * .3));
    }
    return 1;
  };
  const atPoint = (x, y) => {
    const ix = clamp(Math.floor(x), 0, n - 2), iy = clamp(Math.floor(y), 0, n - 2), fx = x - ix, fy = y - iy, a = iy * n + ix;
    return { ids: [a, a + 1, a + n, a + n + 1], ws: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
      height: (h[a] * (1 - fx) + h[a + 1] * fx) * (1 - fy) + (h[a + n] * (1 - fx) + h[a + n + 1] * fx) * fy,
      gx: (h[a + 1] - h[a]) * (1 - fy) + (h[a + n + 1] - h[a + n]) * fy,
      gy: (h[a + n] - h[a]) * (1 - fx) + (h[a + n + 1] - h[a + 1]) * fx };
  };
  const deposit = (x, y, amount) => {
    const q = atPoint(x, y); let used = 0;
    for (let k = 0; k < 4; k++) {
      const id = q.ids[k], add = Math.min(amount * q.ws[k] * weights[id], Math.max(0, base[id] + p.maxChange * weights[id] - h[id]));
      h[id] += add; sediment[id] += add; loose[id] += add; used += add;
    }
    return used;
  };
  const radius = Math.min(4, Math.max(1, Math.ceil(p.radius / cell))), brush = [];
  for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) { const w = Math.max(0, 1 - Math.hypot(x, z) / (radius + .5)); if (w) brush.push([x, z, w]); }
  const brushTotal = brush.reduce((sum, v) => sum + v[2], 0);
  const remove = (x, y, amount, receipts) => {
    const ix = Math.floor(x), iy = Math.floor(y); let used = 0;
    for (const [dx, dy, w] of brush) {
      const i = ix + dx, j = iy + dy; if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
      const id = j * n + i, take = Math.min(amount * w / brushTotal * weights[id] * hardness(id), Math.max(0, h[id] - base[id] + p.maxChange * weights[id]));
      if (take > 0) receipts.push([id, take]);
      h[id] -= take; erosion[id] += take; loose[id] = Math.max(0, loose[id] - take); used += take;
    }
    return used;
  };
  async function redistribute(sedimentOnly, label, angle, rate, start, span) {
    const target = new Int32Array(count), desired = new Float64Array(count), incoming = new Float64Array(count);
    const talus = Math.tan(angle * Math.PI / 180) * cell;
    for (let iteration = 0; iteration < p.iterations; iteration++) {
      target.fill(-1); desired.fill(0); incoming.fill(0);
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          const id = j * n + i; if (!weights[id]) continue;
          let best = 0, dest = -1;
          // Alternate ties to avoid a fixed north-facing preference.
          const neighbors = iteration % 2 ? [id + 1, id + n, id - 1, id - n] : [id - 1, id - n, id + 1, id + n];
          for (const nb of neighbors) if (weights[nb]) { const excess = h[id] - h[nb] - talus; if (excess > best) { best = excess; dest = nb; } }
          if (dest < 0) continue;
          const amount = Math.min(best * .45 * rate * p.strength * Math.min(weights[id], weights[dest]), Math.max(0, h[id] - base[id] + p.maxChange * weights[id]), sedimentOnly ? loose[id] : Infinity);
          target[id] = dest; desired[id] = amount; incoming[dest] += amount;
        }
        if (j % 12 === 0) await checkpoint();
      }
      const delta = new Float64Array(count), looseOut = new Float64Array(count), looseIn = new Float64Array(count);
      for (let id = 0; id < count; id++) if (target[id] >= 0 && desired[id] > 0) {
        const dest = target[id], room = Math.max(0, base[dest] + p.maxChange * weights[dest] - h[dest]), amount = desired[id] * Math.min(1, room / (incoming[dest] || 1));
        delta[id] -= amount; delta[dest] += amount; erosion[id] += amount; sediment[dest] += amount; looseOut[id] += amount; looseIn[dest] += amount;
      }
      for (let id = 0; id < count; id++) { h[id] += delta[id]; loose[id] = Math.max(0, loose[id] - looseOut[id]) + looseIn[id]; }
      progress({ phase: label, value: start + span * (iteration + 1) / p.iterations }); await checkpoint();
    }
  }
  if (p.strength > 0) {
    if (p.mode === 'thermal' || p.mode === 'combined') await redistribute(false, '坡面搬移', p.angle, p.thermal, 0, .25);
    if (p.mode === 'hydraulic' || p.mode === 'combined') {
      for (let drop = 0; drop < p.drops; drop++) {
        let x = 1 + random() * (n - 3), y = 1 + random() * (n - 3), dx = 0, dy = 0, speed = 1, water = 1, load = 0;
        const receipts = [];
        if (drop % 64 === 0) { progress({ phase: '雨滴侵蚀 / 携沙', value: .25 + .55 * drop / Math.max(1, p.drops) }); await checkpoint(); }
        if (weights[Math.floor(y) * n + Math.floor(x)] <= .001) continue;
        for (let step = 0; step < p.lifetime; step++) {
          const q = atPoint(x, y);
          dx = dx * p.inertia - q.gx * (1 - p.inertia); dy = dy * p.inertia - q.gy * (1 - p.inertia);
          let length = Math.hypot(dx, dy); if (length < 1e-10) { const angle = random() * Math.PI * 2; dx = Math.cos(angle); dy = Math.sin(angle); length = 1; }
          dx /= length; dy /= length; const nx = x + dx, ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= n - 2 || ny >= n - 2 || weights[Math.floor(ny) * n + Math.floor(nx)] <= .001) break;
          const next = atPoint(nx, ny), change = next.height - q.height;
          const capacity = Math.max(-change, .001 * cell) * speed * water * p.capacity;
          if (change > 0 || load > capacity) { const amount = change > 0 ? Math.min(change, load) : (load - capacity) * p.deposition * p.strength; load -= deposit(x, y, amount); }
          else load += remove(x, y, Math.min(-change, (capacity - load) * p.erosion * p.strength), receipts);
          for (let k = 0; k < 4; k++) flow[q.ids[k]] += q.ws[k] * water * weights[q.ids[k]];
          speed = Math.sqrt(Math.max(.01, speed * speed - change * 4)); water *= 1 - p.evaporation;
          x = nx; y = ny; if (water < .01) break;
        }
        load -= deposit(x, y, Math.max(0, load));
        // A closed mask / rise cap is not an outlet. Return stranded material along
        // this drop's erosion track rather than silently deleting carried sediment.
        for (let k = receipts.length - 1; k >= 0 && load > 1e-12; k--) {
          const [id, removed] = receipts[k], add = Math.min(load, removed, Math.max(0, base[id] + p.maxChange * weights[id] - h[id]));
          h[id] += add; sediment[id] += add; loose[id] += add; returned += add; load -= add;
        }
        unplaced += Math.max(0, load);
      }
    }
    if (p.mode === 'sediment') for (let id = 0; id < count; id++) loose[id] = p.sedimentDepth * weights[id];
    if (p.mode === 'sediment' || ((p.mode === 'combined' || p.mode === 'hydraulic') && p.settling > 0)) await redistribute(true, '沉积整理', p.mode === 'sediment' ? p.angle : 12, p.settling, .8, .2);
  }
  const output = new Float32Array(count); let removed = 0, added = 0, volume = 0, rounding = 0, affected = 0, maxDelta = 0;
  for (let id = 0; id < count; id++) {
    output[id] = weights[id] ? Math.fround(h[id] / ex) : source[id];
    const delta = (output[id] - source[id]) * ex; if (Math.abs(delta) > 1e-6) affected++;
    maxDelta = Math.max(maxDelta, Math.abs(delta)); volume += delta * area; rounding += (output[id] * ex - h[id]) * area;
    removed += erosion[id] * area; added += sediment[id] * area;
  }
  progress({ phase: '完成', value: 1 }); await checkpoint();
  return { h: output, erosion, sediment, flow, mask: weights, settings: p,
    stats: { affected, maxDelta, erodedVolume: removed, depositedVolume: added, terrainVolumeDelta: volume, unplacedSedimentVolume: unplaced * area, returnedSedimentVolume: returned * area, floatRoundingVolume: rounding, cellSize: cell } };
}
