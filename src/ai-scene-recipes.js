import * as THREE from 'three';
import { templateById } from './templates.js';
import { normalizeSchema, TOWN_THEMES } from './towngen.js';
import {
  layoutRoads,
  layoutParcels,
  scatterTrees,
  densifyHeight,
} from './townbuild.js';
import { LIB_INDEX } from './assets.js';
import { validateAsset } from './ai-scene-catalog.js';
import { finite } from './ai-scene-format.js';
export const townThemes = Object.keys(TOWN_THEMES);
// Reuse the real template programs against a data recorder, NOT the user's App.
export function recordTemplate(id, seed) {
  const template = templateById(id);
  if (!template) throw Error('模板仅支持street/plaza/boulevard');
  const objects = [],
    roads = [];
  const recorder = {
    objects,
    shots: [],
    terrain: { setEnabled() {} },
    lighting: { p: {}, applyGlow() {} },
    bus: { emit() {} },
    select() {},
    saveLocal() {},
    batchOp(_label, fn) {
      return fn();
    },
    clearAll() {
      objects.length = 0;
      roads.length = 0;
    },
    addAsset(key, pos, opts = {}) {
      const o = {
        key,
        params: opts.params || {},
        root: new THREE.Group(),
        motion: null,
      };
      o.root.position.copy(pos);
      objects.push(o);
      return o;
    },
    setMotion(o, patch) {
      if (o) o.motion = patch;
    },
    roadBrush: {
      restore(data) {
        roads.push(...data);
      },
    },
  };
  template.build(recorder, { seed, cameras: false });
  return { objects, roads };
}
function internalParams(key, source, warnings) {
  const params = {};
  for (const [k, v] of Object.entries(source || {})) {
    try {
      validateAsset(key, { [k]: v });
      params[k] = v;
    } catch {
      warnings.push(
        `配方参数${key}/${k}不在严格目录中，使用资产默认值（未改原模板入口）`,
      );
    }
  }
  return params;
}
export function expandRecipe(plan, heightAt) {
  const recipe = plan.recipe,
    warnings = [],
    operations = [],
    [cx, cz] = plan.bounds.center;
  const y = (x, z) => (plan.terrain === 'flat' ? 0 : heightAt(x, z));
  let index = 0;
  const id = () => `${plan.id}-${++index}`;
  const add = (key, x, z, rotationY = 0, params = {}, fit) => {
    if (!LIB_INDEX.has(key)) throw Error('配方缺少资产：' + key);
    const op = {
      op: 'add',
      id: id(),
      key,
      pos: [x + cx, y(x + cx, z + cz), z + cz],
      rotationY,
      params: internalParams(key, params, warnings),
    };
    if (fit) op.fit = fit;
    operations.push(op);
  };
  const road = (pts, width, roadType, name) =>
    operations.push({
      op: 'road',
      id: id(),
      name,
      width,
      roadType,
      points: densifyHeight(
        pts.map((p) => [p[0] + cx, p[1] + cz]),
        y,
      ),
    });
  if (recipe.kind === 'template') {
    const data = recordTemplate(recipe.template, plan.seed);
    for (const r of data.roads)
      road(
        r.points.map((p) => [p[0], p[2]]),
        r.width,
        r.roadType,
        r.name || '模板道路',
      );
    for (const o of data.objects) {
      const { x, z } = o.root.position,
        angle = o.root.rotation.y;
      if (o.key.startsWith('env:road:')) {
        const len = o.params.length || 100;
        road(
          [
            [x - (Math.sin(angle) * len) / 2, z - (Math.cos(angle) * len) / 2],
            [x + (Math.sin(angle) * len) / 2, z + (Math.cos(angle) * len) / 2],
          ],
          o.params.width || 12,
          'asphalt',
          '模板道路',
        );
      } else add(o.key, x, z, angle, o.params);
    }
    warnings.push(
      '模板只复用搭景；原模板自带动作与机位未自动应用，请在预演步骤显式选择。',
    );
  } else {
    if (
      plan.bounds.size[0] !== plan.bounds.size[1] ||
      plan.bounds.size[0] < 128 ||
      plan.bounds.size[0] > 384 ||
      plan.bounds.size[0] % 64
    )
      throw Error('街区配方范围需128–384m、64倍数的正方形');
    if (!TOWN_THEMES[recipe.theme]) throw Error('未知街区主题');
    if (!['grid', 'axis', 'radial', 'spine_and_loop'].includes(recipe.topology))
      throw Error('未知道路拓扑');
    finite(recipe.density, 0, 1, '建筑密度');
    finite(recipe.vegetation, 0, 1, '植被密度');
    const s = normalizeSchema({
      mapSize: plan.bounds.size[0],
      theme: recipe.theme,
      roadTopology: recipe.topology,
      density: recipe.density,
      vegetationDensity: recipe.vegetation,
      seed: plan.seed,
    });
    const sample = (x, z) => y(x + cx, z + cz),
      roads = layoutRoads(s),
      parcels = layoutParcels(s, roads, sample),
      trees = scatterTrees(s, roads, parcels, sample),
      theme = TOWN_THEMES[s.theme];
    if (!parcels.length)
      throw Error(
        '当前范围 / 密度没有可用建筑地块，请扩大范围至192/256m或调整密度；没有发布只有道路的街区',
      );
    const keyFor = (type) =>
      [...LIB_INDEX].find(([, item]) => item.type === type)?.[0];
    for (const r of roads) road(r.pts, r.width, r.roadType, r.name);
    for (const p of parcels.slice(0, 70)) {
      const pool =
        p.kind === 'commercial'
          ? theme.commerce
          : p.kind === 'civic'
            ? theme.civic
            : theme.houses;
      const type = pool[Math.floor(s.rng() * pool.length)],
        key = keyFor(type);
      if (!key) throw Error('主题缺少资产：' + type);
      add(key, p.x, p.z, p.rotY, {}, [Math.min(p.w, 25), Math.min(p.d, 25)]);
    }
    for (const [x, z] of trees.slice(0, 35)) {
      const type = theme.trees[Math.floor(s.rng() * theme.trees.length)],
        key = keyFor(type);
      if (key) add(key, x, z);
    }
    if (parcels.length > 70 || trees.length > 35)
      warnings.push(
        '首版性能预算最多70栋建筑 / 35棵树，已明确截取候选；可缩小范围提高完整度。',
      );
    warnings.push(
      '街区复用原路网 / 地块 / 植被布局，保留地形：不自动找平地块、不改侵蚀 / 河道 / 天气 / 灯光。建筑按地块缩放，入口朝向仅为配方假设。',
    );
  }
  return { operations, warnings: [...new Set(warnings)] };
}
