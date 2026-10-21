import { cleanRiver, nearestRiver } from './terrain-river.js';
import { erosionSettings } from './terrain-erosion.js';
const smooth = (v) => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
/** Static world-XZ mask. Rivers are user paths, not inferred drainage catchments. */
export async function erosionRegion(n, size, input, rivers = [], boxes = [], checkpoint = async () => {}) {
  const p = erosionSettings(input), cell = size / (n - 1), mask = new Float32Array(n * n);
  const valid = rivers.flatMap((r) => { try { return [cleanRiver(r, size)]; } catch { return []; } });
  const selected = valid.filter((r) => p.riverId === 'all' || p.riverId === r.id);
  if (['river', 'outside'].includes(p.region) && !selected.length) throw Error('请先保存范围内的手绘河道，或改选有效河道 / 全图范围');
  for (let j = 1; j < n - 1; j++) {
    const z = (j / (n - 1) - .5) * size;
    for (let i = 1; i < n - 1; i++) {
      const x = (i / (n - 1) - .5) * size; let weight = 1;
      if (p.region === 'box') weight = smooth(Math.min(p.width / 2 - Math.abs(x - p.centerX), p.depth / 2 - Math.abs(z - p.centerZ)) / cell);
      if (p.region === 'river' || p.region === 'outside') {
        let influence = 0;
        for (const r of selected) { const d = nearestRiver(r.points, x, z).distance; influence = Math.max(influence, 1 - smooth((d - r.width / 2 - r.bank) / p.riverBand)); }
        weight = p.region === 'river' ? influence : 1 - influence;
      }
      if (p.riverProtect && weight) for (const r of valid) { const d = nearestRiver(r.points, x, z).distance; weight *= smooth((d - r.width / 2) / Math.max(cell, r.bank)); }
      if (p.protectObjects && weight) for (const b of boxes) {
        // Conservative projected AABBs, including elevated objects. One-cell soft margin.
        if (x > b.minX - cell && x < b.maxX + cell && z > b.minZ - cell && z < b.maxZ + cell) {
          const distance = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ, 0); weight *= smooth(distance / cell);
        }
      }
      mask[j * n + i] = weight;
    }
    if (j % 8 === 0) await checkpoint();
  }
  if (!mask.some((v) => v > 0)) throw Error('作用范围全部被保护 / 在地形外，没有可侵蚀顶点');
  return mask;
}
