import assert from 'node:assert/strict';
import * as T from 'three';
import { sectionAtWidth, normalizeSection, sectionDimensions, sectionForRoad, buildSectionRoad, sectionRoadType } from '../src/road-section.js';
import { automaticRoadPath } from '../src/road-connector-path.js';
import { roadProfile, armsFromIsect, junctionPlan } from '../src/junction.js';
import { subtractRoadPrism } from '../src/road-prism-clip.js';
import { buildRoadEndcap } from '../src/road-endcap.js';
for (const type of ['asphalt', 'oneway', 'concrete', 'freeway']) for (const lanes of [2, 4, 6]) {
  const s = normalizeSection(type, { laneCount: lanes, laneWidth: 3.5, shoulderWidth: .75, sidewalkWidth: 2.6 });
  const d = sectionDimensions(type, s), rt = sectionRoadType({ id: type }, s);
  assert.equal(d.pavementWidth, lanes * 3.5 + 1.5 + (type === 'freeway' ? 4 : 0));
  assert.equal(roadProfile(rt, d.pavementWidth).half * 2, d.outerWidth);
  const g = buildSectionRoad(type, s, 18), bounds = new T.Box3().setFromObject(g);
  assert.ok(Math.abs(bounds.max.x - bounds.min.x - d.outerWidth) < 1e-5);
  const wider = sectionDimensions(type, { ...s, shoulderWidth: 3, sidewalkWidth: 4 });
  assert.equal(wider.laneWidth, 3.5); assert.equal(wider.laneCount, lanes);
  const count = type === 'freeway' ? (lanes - 2) * 3 : (type === 'oneway' ? lanes - 1 : lanes - 2) * 3;
  assert.equal(g.children.filter(m => m.name === 'lane-divider').length, count);
  const cap = buildRoadEndcap(rt, d.outerWidth);
  assert.ok(Math.abs(cap.userData.profile.pavementWidth - d.pavementWidth) < 1e-6);
  if (type !== 'freeway') assert.equal(cap.children.some(m => m.name === 'endcap_walk'), true);
}
assert.equal(sectionAtWidth('asphalt',{laneCount:2,laneWidth:3.5,shoulderWidth:.5,sidewalkWidth:1.8},20).laneWidth,3.5);
assert.equal(sectionForRoad('garden', 4), null);
assert.equal(normalizeSection('asphalt', { laneCount: 5 }).laneCount, 6);
assert.equal(normalizeSection('oneway', { laneCount: 5 }).laneCount, 5);
const a = { position: [0, 0, 0], tangent: new T.Vector3(1, 0, 0), end: 1 };
const b = { position: [80, 8, 35], tangent: new T.Vector3(0, 0, 1), end: 0 };
for (const [A, B] of [[a, b], [b, a]]) {
  const route = automaticRoadPath(A, B, { halfWidth: 3, halfExtent: 160 });
  assert.deepEqual(route.points[0], A.position); assert.deepEqual(route.points.at(-1), B.position);
  assert.ok(route.maxGrade <= .182); assert.ok(route.minRadius >= 3.6);
  assert.ok(route.points.every(p => p.every(Number.isFinite) && p[1] >= 0 && p[1] <= 8));
}
assert.throws(() => automaticRoadPath(a, { ...b, position: [0, 8, 0] }), /平面距离/);
assert.throws(() => automaticRoadPath(a, b, { accept: () => false }), /没有找到/);
const line = (a, b) => new T.LineCurve3(new T.Vector3(...a), new T.Vector3(...b));
for (const angle of [6, 10, 15, 20, 30, 45]) {
  const rad = angle * Math.PI / 180, main = line([-200, 0, 0], [200, 0, 0]), branch = line([0, 0, 0], [200 * Math.cos(rad), 0, 200 * Math.sin(rad)]);
  const is = { newCurve: branch, existingCurve: main, tNew: 0, tExisting: .5, newWidth: 8, existingWidth: 12, newRoadType: { id: 'asphalt' }, existingRoadType: { id: 'asphalt' } };
  const plan = junctionPlan({ x: 0, z: 0 }, armsFromIsect(is));
  assert.equal(plan.compact, true);
  assert.ok(plan.arms.every(a => a.c <= 16.21), angle);
  assert.ok(plan.arms.some(a => a.overlapReach > a.c));
}
// Height-limited clipping must remove only the shared level, not another bridge.
const root = new T.Group();
for (const y of [0, 8]) { const m = new T.Mesh(new T.BoxGeometry(10, .3, 10), new T.MeshBasicMaterial()); m.position.y = y; root.add(m); }
subtractRoadPrism(root, [{ x: -3, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 3 }, { x: -3, z: 3 }], null, { origin: { x: 0, y: 0, z: 0 }, gradient: { x: 0, z: 0 }, below: .5, above: .5 });
root.updateMatrixWorld(true);
const ys = new T.Raycaster(new T.Vector3(0, 20, 0), new T.Vector3(0, -1, 0)).intersectObject(root, true).map(h => h.point.y);
assert.ok(ys.length && ys.every(y => y > 7));
console.log('PASS explicit lane widths / counts / independent shoulders + sidewalks / actual mesh + marking counts / matching caps and profiles / automatic 3D routes + rejected impossible cases / bounded acute cores / height-safe triangle cuts');
