import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSectionRoad, sectionDimensions, sectionRoadType } from '../src/road-section.js';
import { buildRoadEndcap } from '../src/road-endcap.js';
import { batchRoadParts } from '../src/road-batching.js';

const tops = (root, x, z, y = .15) => {
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0))
    .intersectObject(root, true).filter(h => Math.abs(h.point.y - y) < 1e-6);
};
for (const lanes of [2, 4, 6]) for (const batched of [false, true]) {
  const section = { laneCount: lanes, laneWidth: 3.5, shoulderWidth: 1, sidewalkWidth: 0 };
  let root = buildSectionRoad('freeway', section, 20);
  if (batched) { const wrapper = new THREE.Group(); wrapper.add(root); batchRoadParts(wrapper); root = wrapper; }
  for (const x of [-1.73, -1.23, .83, 1.23, 1.73]) {
    assert.equal(tops(root, x, 2.31).length, 1, `median must have ONE top surface: lanes=${lanes}, batched=${batched}, x=${x}`);
  }
  for (const sign of [-1, 1]) assert.equal(tops(root, sign * 3.37, 2.31).length, 1, 'both carriageways remain paved');
  const rt = sectionRoadType({ id: 'freeway' }, section), d = sectionDimensions('freeway', section);
  const cap = buildRoadEndcap(rt, d.outerWidth);
  for (const [x, z] of [[1.23, .41], [-1.37, .53], [.73, 1.41], [1.03, 1.53]]) {
    assert.equal(tops(cap, x, z).length, 1, 'endcap median must not overlap asphalt');
  }
  for (const sign of [-1, 1]) assert.equal(tops(cap, sign * 3.37, .41).length, 1, 'endcap pavement remains closed');
}
// Old saved roads use the legacy cap builder too.
const cap = buildRoadEndcap({ id: 'freeway' }, 20);
assert.equal(tops(cap, 1.23, .41).length, 1, 'legacy freeway endcap shares the fix');
console.log('PASS unique freeway median surfaces / 2,4,6 lanes / both carriageways / batching on-off / new and legacy endcaps');
