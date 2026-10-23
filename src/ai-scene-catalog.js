import { LIB_INDEX, defaultsFor, buildAsset } from './assets.js';
import { ANIMS } from './character.js';
import { allowedParams } from './ai-scene-format.js';
export const animationIds = ANIMS.map((a) => a.v);
export function assetEntry(key) {
  const item = LIB_INDEX.get(key);
  if (!item || item.type === 'fx')
    throw Error('不存在或不支持的搭景资产：' + key);
  return item;
}
export function validateAsset(key, params = {}) {
  const item = assetEntry(key);
  allowedParams(params, item.params || [], animationIds);
  return item;
}
export function catalogEntries(query = '') {
  const q = query.toLowerCase().trim();
  return [...LIB_INDEX]
    .filter(
      ([key, v]) =>
        v.type !== 'fx' &&
        (!q || (key + ' ' + v.cat).toLowerCase().includes(q)),
    )
    .map(([key, item]) => ({
      key,
      name: item.name,
      category: item.cat,
      type: item.type,
      parameters: item.params || [],
      defaultParameters: defaultsFor(item),
      dimensions:
        'Measured during candidate build; no semantic entrance anchors advertised',
    }));
}
export function makeAsset(key, params, { trustedSource = false } = {}) {
  // Existing application-owned metadata is not an AI patch; new/changed parameters are validated separately.
  const item = trustedSource ? assetEntry(key) : validateAsset(key, params);
  return buildAsset(item, { ...defaultsFor(item), ...params });
}
// Procedural detail textures can be globally cached; never dispose those when releasing a candidate.
export function releaseCandidate(root) {
  const geo = new Set(),
    mat = new Set();
  root?.traverse((n) => {
    if (n.isInstancedMesh) n.dispose?.();
    if (n.geometry) geo.add(n.geometry);
    for (const m of Array.isArray(n.material)
      ? n.material
      : n.material
        ? [n.material]
        : [])
      mat.add(m);
  });
  root?.removeFromParent();
  for (const g of geo) g.dispose();
  for (const m of mat) m.dispose();
}
