// Explicit cross sections. Legacy roads retain their original mesh until edited;
// new roads store these independent, metre-valued parameters, never a scale factor.
import * as THREE from 'three';
import { M, shade } from './mat.js';

export const LANE_ROADS = ['asphalt', 'oneway', 'concrete', 'freeway'];
const clamp = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function normalizeSection(type, input = {}) {
  if (!LANE_ROADS.includes(type)) return null;
  const divided = type !== 'oneway';
  let laneCount = Math.round(clamp(input.laneCount, divided ? 2 : 1, 12, divided ? 2 : 1));
  if (divided) laneCount = Math.min(12, Math.max(2, Math.round(laneCount / 2) * 2));
  return {
    laneCount,
    laneWidth: clamp(input.laneWidth, 2, 5, 3.5),
    shoulderWidth: clamp(input.shoulderWidth, 0, 5, type === 'freeway' ? 1 : .5),
    sidewalkWidth: type === 'freeway' ? 0 : clamp(input.sidewalkWidth, 0, 6, 1.8),
  };
}
export function sectionDimensions(type, section) {
  const s = normalizeSection(type, section);
  if (!s) return null;
  const medianWidth = type === 'freeway' ? 4 : 0;
  const curbWidth = type !== 'freeway' && s.sidewalkWidth > 0 ? .45 : 0;
  const pavementWidth = s.laneCount * s.laneWidth + 2 * s.shoulderWidth + medianWidth;
  return { ...s, curbWidth, medianWidth, pavementWidth, outerWidth: pavementWidth + 2 * (curbWidth + s.sidewalkWidth) };
}
export function sectionForRoad(type, width = 12, section) {
  if (section) return normalizeSection(type, section);
  // Editing an old road starts with its existing paved width, not stretched markings.
  if (!LANE_ROADS.includes(type)) return null;
  const available = Math.max(4, width - (type === 'freeway' ? 4 : 0));
  const lanes = type === 'oneway' ? Math.max(1, Math.round(available / 3.5)) : Math.max(2, Math.round(available / 7) * 2);
  return normalizeSection(type, { laneCount: lanes, laneWidth: available / lanes, shoulderWidth: 0, sidewalkWidth: type === 'freeway' ? 0 : 1.8 });
}
// Compatibility for chat/API callers that still request a total paved width:
// change the lane count, never scale the previously chosen single-lane width.
export function sectionAtWidth(type, section, width) {
  const s=normalizeSection(type,section);if(!s||!Number.isFinite(width))return s;
  return normalizeSection(type,{...s,laneCount:(width-2*s.shoulderWidth-(type==='freeway'?4:0))/s.laneWidth});
}
export function sectionRoadType(base, section, connection = null) {
  const s = normalizeSection(base.id, section);
  const type=s ? { ...base, section: s, build: params => buildSectionRoad(base.id, s, params.length) } : base;
  return connection?.kind==='ramp'&&base.id==='oneway'?{...type,junctionStyle:'merge',connectorRouting:connection.routing}:type;
}

export function buildSectionRoad(type, section, length = 10) {
  const d = sectionDimensions(type, section), g = new THREE.Group();
  g.name = 'explicit-road-section'; g.userData.section = d;
  const concrete = M.concrete(0xb0aca4, .9), walk = M.concrete(0xc8c3b7, .9);
  const asphalt = M.concrete(type === 'concrete' ? 0x999999 : 0x3a3d42, .95);
  const white = M.paint(0xf2f2ee, .75), yellow = M.paint(0xe0b230, .8);
  const box = (name, x, y, width, height, mat, z = 0, len = length, role = 'pavement') => {
    if (width <= 0 || len <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, len), mat);
    mesh.position.set(x, y, z); mesh.name = name; mesh.userData.roadRole = role; g.add(mesh);
  };
  const line = (x, dashed = false, mat = white) => {
    if (!dashed) { box('lane-edge', x, .162, .15, .02, mat, 0, length, 'marking'); return; }
    const period = 6, dash = 3;
    for (let z = -length / 2; z < length / 2; z += period) {
      const len = Math.min(dash, length / 2 - z);
      box('lane-divider', x, .162, .15, .02, mat, z + len / 2, len, 'marking');
    }
  };
  if (type === 'freeway') {
    // The median owns its surface. A full-width asphalt slab underneath it has
    // the same top height and z-fights as the camera moves (also after batching).
    const carriageWidth = (d.pavementWidth - d.medianWidth) / 2;
    for (const sign of [-1, 1]) box('road-pavement', sign * (d.medianWidth / 2 + carriageWidth / 2), .075, carriageWidth, .15, asphalt);
    box('road-median', 0, .075, 4, .15, concrete);
    box('road-median-base', 0, .25, 1, .25, concrete);
    box('road-median-wall', 0, .7, .6, .85, concrete);
    for (const sign of [-1, 1]) {
      line(sign * (2 + .15), false, yellow);
      for (let i = 1; i < d.laneCount / 2; i++) line(sign * (2 + i * d.laneWidth), true);
      line(sign * (2 + d.laneCount / 2 * d.laneWidth - .15));
      box('road-guardrail', sign * (d.pavementWidth / 2 - .2), .6, .1, .3, M.metal(0x999999, .35, .7), 0, length, 'side');
    }
  } else {
    box('road-pavement', 0, .075, d.pavementWidth, .15, asphalt);
    const laneHalf = d.laneCount * d.laneWidth / 2;
    line(-laneHalf + .15); line(laneHalf - .15);
    for (let i = 1; i < d.laneCount; i++) {
      const x = -laneHalf + i * d.laneWidth;
      if (type !== 'oneway' && i === d.laneCount / 2) { line(x - .12, false, yellow); line(x + .12, false, yellow); }
      else line(x, true);
    }
    for (const sign of [-1, 1]) {
      const edge = d.pavementWidth / 2;
      box('road-curb', sign * (edge + d.curbWidth / 2), .15, d.curbWidth, .3, concrete, 0, length, 'side');
      box('road-sidewalk', sign * (edge + d.curbWidth + d.sidewalkWidth / 2), .15, d.sidewalkWidth, .3, walk, 0, length, 'side');
    }
  }
  shade(g);
  return g;
}
