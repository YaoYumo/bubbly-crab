import { sampleGrid } from './terrain-import.js';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function cleanRiver(input, size = 600) {
  if (!input || !Array.isArray(input.points) || input.points.length > 64 || input.points.length < 2) throw Error('河道需要 2–64 个路径点');
  const points = input.points.map((p) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(finite) || Math.abs(p[0]) > size / 2 || Math.abs(p[2]) > size / 2 || Math.abs(p[1]) > 10000) throw Error('河道坐标无效或超出地形边界');
    return [...p];
  });
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]) < .1) throw Error('相邻河道点至少相距 0.1m');
  const orient = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  for (let i = 1; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    const a = points[i - 1], b = points[i], c = points[j - 1], d = points[j];
    if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[2], b[2]) < Math.min(c[2], d[2]) || Math.max(c[2], d[2]) < Math.min(a[2], b[2])) continue;
    if (orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0) throw Error('单条河道不能自交或折返重叠，请拆成多条河道');
  }
  const num = (k, d, lo, hi) => finite(input[k]) ? clamp(input[k], lo, hi) : d;
  return { id: String(input.id || '').slice(0, 80), name: String(input.name || '河道').slice(0, 40), points,
    width: num('width', 6, 1, 60), depth: num('depth', 2, .1, 30), bank: num('bank', 4, .5, 60), water: input.water !== false };
}
export function nearestRiver(points, x, z) {
  let best = Infinity, result;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[2] - a[2];
    const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = a[0] + t * dx, pz = a[2] + t * dz, distance = Math.hypot(x - px, z - pz);
    if (distance < best) { best = distance; result = { x: px, z: pz, y: a[1] + t * (b[1] - a[1]), distance, dx, dz }; }
  }
  return result;
}
/** Compute on a copy, lower-only, in world metres regardless of height exaggeration.
 * The channel has a rounded bed and a smooth bank anchored to the outside terrain.
 * It is not hydraulic erosion and never raises embankments or auto-routes flow.
 */
export async function carveRiver(source, n, size, exaggerate, input, checkpoint = () => new Promise((r) => setTimeout(r, 0))) {
  const river = cleanRiver(input, size), h = source.slice(), half = river.width / 2, reach = half + river.bank;
  let changed = 0;
  const sample = (x, z) => sampleGrid(source, n, n, x / size + .5, z / size + .5) * exaggerate;
  const minX = Math.min(...river.points.map((p) => p[0])) - reach, maxX = Math.max(...river.points.map((p) => p[0])) + reach;
  const minZ = Math.min(...river.points.map((p) => p[2])) - reach, maxZ = Math.max(...river.points.map((p) => p[2])) + reach;
  for (let j = 0; j < n; j++) {
    const z = (j / (n - 1) - .5) * size;
    if (z >= minZ && z <= maxZ) for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - .5) * size;
      if (x < minX || x > maxX) continue;
      const q = nearestRiver(river.points, x, z), d = q.distance;
      if (d >= reach) continue;
      let target;
      if (d <= half) target = q.y - river.depth * (1 - .8 * (d / half) ** 2);
      else {
        const t = (d - half) / river.bank, smooth = t * t * (3 - 2 * t);
        let ux = x - q.x, uz = z - q.z; const len = Math.hypot(ux, uz) || 1; ux /= len; uz /= len;
        const outer = sample(q.x + ux * reach, q.z + uz * reach);
        target = (q.y - .2 * river.depth) * (1 - smooth) + outer * smooth;
      }
      const at = j * n + i, value = Math.fround(Math.min(source[at], target / exaggerate));
      if (value < source[at] - 1e-6) { h[at] = value; changed++; }
    }
    if (j % 8 === 0) await checkpoint();
  }
  return { h, changed, river };
}
/** Shared miter joins; capped miters prevent unlimited spikes at sharp corners. */
export function riverStrip(input, size) {
  const river = cleanRiver(input, size), positions = [], indices = [], { points } = river;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const direction = (p, q) => { const x = q[0] - p[0], z = q[2] - p[2], l = Math.hypot(x, z) || 1; return [-z / l, x / l]; };
    const before = direction(a, p), after = direction(p, b);
    if (i === 0) before.splice(0, 2, ...after); if (i === points.length - 1) after.splice(0, 2, ...before);
    const mx = before[0] + after[0], mz = before[1] + after[1], len = Math.hypot(mx, mz);
    if (len < .2) throw Error('河道转角过尖，请移动路径点或拆成两条');
    const nx = mx / len, nz = mz / len, width = Math.min(river.width, river.width / 2 / Math.max(.25, nx * after[0] + nz * after[1]));
    positions.push(p[0] + nx * width, p[1] + .02, p[2] + nz * width, p[0] - nx * width, p[1] + .02, p[2] - nz * width);
    if (i) { const k = (i - 1) * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  return { positions: new Float32Array(positions), indices };
}
