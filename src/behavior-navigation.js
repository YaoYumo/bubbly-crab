// Bounded deterministic 2D A*, exact polyline clearance against inflated static AABBs.
// No terrain, navmesh, moving obstacles, mesh contact or scene mutation.
import { exact, finite, vec } from "./ai-scene-format.js";
export function planStaticRoute({
  start,
  goal,
  bounds,
  cellSize,
  radius,
  obstacles,
  budget = { checks: 0 },
}) {
  vec(start, 2, -590, 590, "导航起点");
  vec(goal, 2, -590, 590, "导航终点");
  exact(bounds, ["min", "max"], "导航范围");
  vec(bounds.min, 2, -600, 600, "范围min");
  vec(bounds.max, 2, -600, 600, "范围max");
  finite(cellSize, 0.25, 2, "网格间距");
  finite(radius, 0.05, 2, "人物半径");
  if (!Array.isArray(obstacles) || obstacles.length > 512)
    throw Error("静态导航最多512个障碍");
  const boxes = obstacles.map((o) => {
    exact(o, ["min", "max"], "障碍");
    vec(o.min, 2, -5000, 5000, "障碍min");
    vec(o.max, 2, -5000, 5000, "障碍max");
    if (o.min.some((v, i) => v > o.max[i])) throw Error("障碍范围倒置");
    return {
      min: o.min.map((v) => v - radius - 0.001),
      max: o.max.map((v) => v + radius + 0.001),
    };
  });
  const n = bounds.max.map((v, i) => Math.ceil((v - bounds.min[i]) / cellSize));
  if (
    n.some((v) => !Number.isInteger(v) || v < 1 || v > 256) ||
    n[0] * n[1] > 16384
  )
    throw Error("导航网格超过16384格预算，请缩小范围或增大间距");
  const inside = (p) =>
    p.every(
      (v, i) => v >= bounds.min[i] + radius && v <= bounds.max[i] - radius,
    );
  if (!inside(start) || !inside(goal))
    throw Error("起终点没有足够的范围边缘净空");
  let checks = 0;
  function clear(a, b) {
    for (const box of boxes) {
      checks++;
      if (++budget.checks > 2000000) throw Error("导航几何检查超过200万次预算");
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 2; i++) {
        const d = b[i] - a[i];
        if (Math.abs(d) < 1e-12) {
          if (a[i] < box.min[i] || a[i] > box.max[i]) {
            lo = 2;
            break;
          }
        } else {
          const x = (box.min[i] - a[i]) / d,
            y = (box.max[i] - a[i]) / d;
          lo = Math.max(lo, Math.min(x, y));
          hi = Math.min(hi, Math.max(x, y));
        }
      }
      if (lo <= hi && lo <= 1 && hi >= 0) return false;
    }
    return true;
  }
  if (!clear(start, start) || !clear(goal, goal))
    throw Error("起点或终点在膨胀障碍内，请调整位置");
  if (Math.hypot(...goal.map((v, i) => v - start[i])) < 1e-8)
    return { points: [start.slice()], visited: 0, checks };
  if (clear(start, goal))
    return { points: [start.slice(), goal.slice()], visited: 0, checks };
  const index = (p) =>
    Math.min(n[1] - 1, Math.floor((p[1] - bounds.min[1]) / cellSize)) * n[0] +
    Math.min(n[0] - 1, Math.floor((p[0] - bounds.min[0]) / cellSize));
  const center = (id) => [
    bounds.min[0] + ((id % n[0]) + 0.5) * cellSize,
    bounds.min[1] + (Math.floor(id / n[0]) + 0.5) * cellSize,
  ];
  const first = index(start),
    last = index(goal);
  if (!inside(center(first)) || !inside(center(last)))
    throw Error("起终点网格中心缺少边界净空，请扩大范围或减小间距");
  if (!clear(start, center(first)) || !clear(center(last), goal))
    throw Error("起终点网格中心不可达，请减小间距或调整位置");
  const g = new Float64Array(n[0] * n[1]).fill(Infinity),
    parent = new Int32Array(g.length).fill(-1),
    closed = new Uint8Array(g.length),
    heap = [];
  const h = (id) =>
    Math.abs((id % n[0]) - (last % n[0])) +
    Math.abs(Math.floor(id / n[0]) - Math.floor(last / n[0]));
  let serial = 0,
    visited = 0;
  const less = (a, b) =>
    a.f < b.f || (a.f === b.f && (a.h < b.h || (a.h === b.h && a.s < b.s)));
  const push = (id, cost) => {
    const entry = { id, cost, h: h(id), f: cost + h(id), s: serial++ };
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      tail = heap.pop();
    if (heap.length) {
      heap[0] = tail;
      let i = 0;
      for (;;) {
        let k = i,
          l = i * 2 + 1,
          r = l + 1;
        if (l < heap.length && less(heap[l], heap[k])) k = l;
        if (r < heap.length && less(heap[r], heap[k])) k = r;
        if (k === i) break;
        [heap[i], heap[k]] = [heap[k], heap[i]];
        i = k;
      }
    }
    return top;
  };
  g[first] = 0;
  push(first, 0);
  let found = false;
  while (heap.length) {
    const entry = pop(),
      id = entry.id;
    if (closed[id] || entry.cost !== g[id]) continue;
    closed[id] = 1;
    visited++;
    if (id === last) {
      found = true;
      break;
    }
    const x = id % n[0],
      z = Math.floor(id / n[0]);
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = x + dx,
        nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n[0] || nz >= n[1]) continue;
      const next = nz * n[0] + nx;
      if (closed[next] || g[id] + 1 >= g[next]) continue;
      const point = center(next);
      if (!inside(point) || !clear(center(id), point)) continue;
      parent[next] = id;
      g[next] = g[id] + 1;
      push(next, g[next]);
    }
  }
  if (!found) throw Error("导航范围内没有可达路径，不会穿墙或传送");
  const ids = [];
  for (let id = last; id !== -1; id = parent[id]) {
    ids.push(id);
    if (ids.length > g.length) throw Error("路径重建预算错误");
  }
  ids.reverse();
  const raw = [start, ...ids.map(center), goal],
    points = [start.slice()];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !clear(raw[i], raw[j])) j--;
    if (!clear(raw[i], raw[j])) throw Error("路径净空校验失败");
    points.push(raw[j].slice());
    i = j;
    if (points.length > 256) throw Error("路径超过256点，请拆分任务");
  }
  return { points, visited, checks };
}
