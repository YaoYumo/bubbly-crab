import { clamp } from "./util.js";
import { smooth, terrainNoise } from "./terrain-generation.js";
export const SURFACE_DEFAULTS = {
  enabled: true,
  rockSlope: 32,
  slopeBlend: 8,
  snowLine: 26,
  snowBlend: 5,
  shoreWidth: 5,
};
export function cleanSurface(input = {}) {
  const s = { ...SURFACE_DEFAULTS };
  for (const [k, lo, hi] of [
    ["rockSlope", 10, 70],
    ["slopeBlend", 1, 20],
    ["snowLine", -50, 300],
    ["snowBlend", 0.5, 40],
    ["shoreWidth", 0.5, 30],
  ]) {
    if (Number.isFinite(Number(input[k])))
      s[k] = clamp(Number(input[k]), lo, hi);
  }
  if (typeof input.enabled === "boolean") s.enabled = input.enabled;
  return s;
}
/** Geometric slope in degrees, including cell spacing and displayed height scale. */
export function slopeDegrees(h, n, size, scale, i, j) {
  const l = Math.max(0, i - 1),
    r = Math.min(n - 1, i + 1),
    u = Math.max(0, j - 1),
    d = Math.min(n - 1, j + 1),
    cell = size / (n - 1);
  const dx = ((h[j * n + r] - h[j * n + l]) * scale) / ((r - l) * cell),
    dz = ((h[d * n + i] - h[u * n + i]) * scale) / ((d - u) * cell);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
}
/** Approximate horizontal distance to submerged terrain, not altitude alone. */
function shoreDistances(h, n, cell, scale, level) {
  const dist = new Float32Array(n * n);
  for (let k = 0; k < dist.length; k++)
    dist[k] = h[k] * scale <= level ? 0 : 1e9;
  const diag = cell * Math.SQRT2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = dist[k];
      if (i) v = Math.min(v, dist[k - 1] + cell);
      if (j) v = Math.min(v, dist[k - n] + cell);
      if (i && j) v = Math.min(v, dist[k - n - 1] + diag);
      if (j && i < n - 1) v = Math.min(v, dist[k - n + 1] + diag);
      dist[k] = v;
    }
  for (let j = n - 1; j >= 0; j--)
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = dist[k];
      if (i < n - 1) v = Math.min(v, dist[k + 1] + cell);
      if (j < n - 1) v = Math.min(v, dist[k + n] + cell);
      if (i < n - 1 && j < n - 1) v = Math.min(v, dist[k + n + 1] + diag);
      if (i && j < n - 1) v = Math.min(v, dist[k + n - 1] + diag);
      dist[k] = v;
    }
  return dist;
}
/** Derived base only; manual weights are deliberately never read or overwritten here. */
export function automaticSurface(
  h,
  n,
  size,
  scale,
  biome,
  settings,
  water,
  out = new Float32Array(n * n * 6),
) {
  out.fill(0);
  if (!settings.enabled) return out;
  const cell = size / (n - 1),
    distance = water.enabled
      ? shoreDistances(h, n, cell, scale, water.level)
      : null;
  const base =
    biome === "desert"
      ? [0, 0.08, 0.12, 0, 0.8, 0]
      : biome === "snow"
        ? [0, 0, 0.12, 0, 0, 0.88]
        : biome === "rock"
          ? [0, 0.12, 0.5, 0.38, 0, 0]
          : biome === "ash"
            ? [0, 0.55, 0.3, 0.15, 0, 0]
            : [0.92, 0.08, 0, 0, 0, 0];
  const grassLike = ["grass", "forest", "alien"].includes(biome),
    allowSnow = !["desert", "ash", "alien"].includes(biome);
  const patchMix = [0.3, 0.5, 0.2, 0, 0, 0],
    slopeMix = [0, 0.12, 0.78, 0.1, 0, 0],
    rockMix = [0, 0, 0.08, 0.92, 0, 0],
    snowMix = [0, 0, 0, 0.03, 0, 0.97];
  const shoreMix =
    biome === "forest"
      ? [0, 0.65, 0.15, 0, 0.2, 0]
      : biome === "snow"
        ? [0, 0, 0.6, 0.4, 0, 0]
        : [0, 0.12, 0.18, 0, 0.7, 0];
  const w = new Float64Array(6),
    mix = (target, f) => {
      for (let k = 0; k < 6; k++) w[k] = w[k] * (1 - f) + target[k] * f;
    };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const idx = j * n + i,
        y = h[idx] * scale,
        x = i * cell - size / 2,
        z = j * cell - size / 2,
        slope = slopeDegrees(h, n, size, scale, i, j);
      w.set(base);
      const patch = terrainNoise(x * 0.13, z * 0.13, 731) * 0.5 + 0.5;
      if (grassLike) mix(patchMix, smooth(0.5, 0.85, patch) * 0.3);
      mix(slopeMix, smooth(8, settings.rockSlope, slope) * 0.35);
      if (distance) {
        const beach =
          (1 - smooth(0, settings.shoreWidth, distance[idx])) *
          (1 - smooth(12, 30, slope));
        mix(shoreMix, beach);
      }
      const rock = smooth(
        settings.rockSlope - settings.slopeBlend,
        settings.rockSlope + settings.slopeBlend,
        slope,
      );
      mix(rockMix, rock);
      if (allowSnow) {
        const snow =
          smooth(
            settings.snowLine - settings.snowBlend,
            settings.snowLine + settings.snowBlend,
            y +
              terrainNoise(x * 0.07, z * 0.07, 181) * settings.snowBlend * 0.12,
          ) *
          (1 - smooth(28, 52, slope));
        mix(snowMix, snow);
      }
      for (let k = 0; k < 6; k++) out[idx * 6 + k] = w[k];
    }
  return out;
}
