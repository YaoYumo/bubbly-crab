import { clamp, makeRng } from "./util.js";
export function cleanGeneration(p = {}) {
  const number = (k, d, lo, hi) =>
    Number.isFinite(Number(p[k])) ? clamp(Number(p[k]), lo, hi) : d;
  return {
    kind: [
      "plain",
      "hills",
      "ridge",
      "island",
      "craters",
      "canyon",
      "plateau",
    ].includes(p.kind)
      ? p.kind
      : "hills",
    amp: number("amp", 8, 0.5, 200),
    seed: Math.round(number("seed", 20261016, 1, 2147483647)),
  };
}
/** Seeded continuous 2D value noise. World coordinates keep shared samples stable on refinement. */
export function terrainNoise(x, z, seed = 1) {
  const hash = (i, j) => {
    let h =
      Math.imul(i, 374761393) ^
      Math.imul(j, 668265263) ^
      Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const i = Math.floor(x),
    j = Math.floor(z);
  let u = x - i,
    v = z - j;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  return (
    ((hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) +
      (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v) *
      2 -
    1
  );
}
export function generateHeightfield(n, size, input) {
  const p = cleanGeneration(input),
    h = new Float32Array(n * n),
    rng = makeRng(p.seed),
    a = p.amp;
  const f = (x, z) => {
    let sum = 0,
      weight = 1,
      total = 0;
    for (let k = 0; k < 4; k++) {
      sum += terrainNoise(x, z, p.seed + k * 1013) * weight;
      total += weight;
      x = x * 2.03 + 17.1;
      z = z * 2.03 - 9.2;
      weight *= 0.48;
    }
    return sum / total;
  };
  const craters = Array.from({ length: 9 }, () => ({
    x: (rng() - 0.5) * size,
    z: (rng() - 0.5) * size,
    r: 3 + rng() * size * 0.06,
    depth: a * (0.7 + rng() * 0.7),
  }));
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * size,
        z = (j / (n - 1) - 0.5) * size,
        b = f(x * 0.035, z * 0.035);
      let y = 0;
      if (p.kind === "plain") y = b * a * 0.08;
      else if (p.kind === "hills") y = b * a;
      else if (p.kind === "ridge") {
        const r = 1 - Math.abs(terrainNoise(x * 0.024, z * 0.024, p.seed));
        y = a * (1.55 * r * r + 0.35 * b - 0.18);
      } else if (p.kind === "island") {
        const d = Math.hypot(x / (size * 0.48), z / (size * 0.48)),
          fall = 1 - smooth(0.2, 1, d);
        y = a * ((0.4 + 0.6 * (b * 0.5 + 0.5)) * fall - 0.4 * (1 - fall));
      } else if (p.kind === "canyon") {
        const path =
            Math.sin(z * 0.028 + p.seed * 0.001) * size * 0.17 +
            f(z * 0.02, 3) * size * 0.06,
          d = Math.abs(x - path) / (size * 0.1);
        y =
          a *
          (0.55 * (1 - Math.exp(-d * d)) -
            1.1 * Math.exp(-d * d * 2) +
            b * 0.12);
      } else if (p.kind === "plateau") {
        const steps = Math.round((b + 0.3) * 5) / 5;
        y = a * (steps * 0.85 + f(x * 0.16, z * 0.16) * 0.035);
      } else {
        y = b * a * 0.1;
        for (const c of craters) {
          const d = Math.hypot(x - c.x, z - c.z) / c.r;
          if (d < 2.5)
            y +=
              -Math.exp(-d * d * 2.2) * c.depth +
              Math.exp(-((d - 1.05) ** 2) * 12) * c.depth * 0.34;
        }
      }
      h[j * n + i] = y;
    }
  return { h, waterY: p.kind === "island" ? a * 0.06 : undefined, settings: p };
}
export function smooth(a, b, x) {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
