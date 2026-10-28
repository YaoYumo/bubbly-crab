import { mergePaintOffsets } from "../src/road-merge-markings.js";
import assert from "node:assert/strict";
import * as T from "three";
import {
  buildTrafficNetwork,
  TrafficSimulation,
  trafficRandom,
} from "../src/traffic-network.js";
import {
  buildRoadLightPools,
  roadLightTexture,
  updateRoadLightPool,
} from "../src/road-light-pools.js";
import { cleanHeightMapping } from "../src/terrain-import.js";
import { cleanConversationTerrain } from "../src/local-scene-terrain.js";
const road = {
  id: "edge",
  type: "road_brush",
  _roadData: {
    roadType: { id: "asphalt" },
    width: 12,
    curve: new T.LineCurve3(new T.Vector3(-80, 0, 0), new T.Vector3(80, 0, 0)),
  },
};
const n = buildTrafficNetwork([road], { terrainSize: 160 }),
  sim = new TrafficSimulation(n, { vehicles: 12, pedestrians: 8, seed: 17 });
assert.ok(
  [...n.lanes.values()].every((l) => l.boundaryEntry && l.boundaryExit),
);
assert.ok(
  sim.agents
    .filter((a) => a.kind === "car")
    .every((a) => a.speed === a.lane.speed),
);
const values = Array.from({ length: 24 }, (_, i) => trafficRandom(i + 17));
assert.ok(Math.max(...values) - Math.min(...values) > 0.85);
assert.ok(new Set(sim.agents.map((a) => a.speedFactor.toFixed(2))).size > 8);
const snapshot = () =>
  sim.agents.map((a) => [a.id, a.s, a.speedFactor, a.lateralBias]);
const initial = snapshot();
sim.sample(12);
sim.sample(0);
assert.deepEqual(snapshot(), initial);
const lane = [...n.lanes.values()].find((l) => l.kind === "car"),
  car = {
    id: "car-0",
    kind: "car",
    lane,
    s: lane.length - 0.1,
    speed: lane.speed,
    gap: 6,
    visits: 0,
    speedFactor: 1,
  };
const blocker = { ...car, id: "car-1", s: 2 };
sim.agents = [car, blocker];
sim.advance(1 / 30);
assert.equal(car.inactive, true, "vanish at exit even when entrance is full");
assert.ok(car.speed > 0, "no stop before vanishing");
sim.advance(1 / 30);
assert.equal(car.inactive, true);
blocker.s = 100;
sim.advance(1 / 30);
assert.equal(car.inactive, false);
assert.equal(car.speed, lane.speed, "boundary re-entry at full speed");
const main = { ...lane, roadId: "main" },
  branch = { ...lane, id: "ramp", roadId: "ramp" },
  node = { freeflow: true, mainRoad: "main", controlled: false, events: [] },
  e = { id: "merge", node, entry: 30, exit: 60, center: 45, lane: main };
main.events = [e];
const target = { ...e, lane: main };
node.events = [target];
const joining = { ...car, lane: branch, s: 20 },
  through = { ...car, lane: main, s: 35 };
sim.agents = [joining, through];
sim.reservations.set("merge", [joining]);
assert.equal(
  sim.canEnter(through, e),
  true,
  "mainline must never wait for junction reservation",
);
through.s = target.exit;
assert.equal(
  sim.canEnter(joining, { ...e, lane: branch }),
  false,
  "ramp yields only to real target-lane gap",
);
through.s = 120;
assert.equal(sim.canEnter(joining, { ...e, lane: branch }), true);
const rd = {
  roadType: { id: "asphalt" },
  width: 12,
  gaps: [],
  curve: {
    _terrainProfile: {
      points: [
        { x: -80, y: 0, z: 0, s: 0 },
        { x: 80, y: 8, z: 0, s: 160 },
      ],
    },
  },
};
const pool = buildRoadLightPools(rd, [{ x: 0, y: 4, z: 7, s: 80, side: 1 }]);
assert.ok(pool?.isMesh);
assert.equal(pool.material.isMeshBasicMaterial, true);
assert.equal(pool.material.map, roadLightTexture());
assert.equal(pool.material.map, roadLightTexture());
assert.equal(pool.castShadow, false);
assert.equal(pool.material.depthWrite, false);
updateRoadLightPool(pool, 0);
assert.equal(pool.visible, false);
updateRoadLightPool(pool, 2);
assert.equal(pool.visible, true);
assert.ok(pool.material.opacity > 0);
assert.ok(pool.geometry.attributes.position.array.every(Number.isFinite));
pool.geometry.dispose();
pool.material.dispose();
assert.equal(cleanHeightMapping({ size: 4096 }).size, 4096);
assert.equal(
  cleanConversationTerrain({ generate: { kind: "hills", size: 4096 } }).generate
    .size,
  4096,
);
assert.throws(() =>
  cleanConversationTerrain({ generate: { kind: "hills", size: 4097 } }),
);
console.log(
  "PASS deterministic non-linear randomness / variation / full-speed boundary birth and re-entry / no exit queue / mainline priority + actual gap yielding / shared prebaked light pools / 4096m import and conversation bounds",
);

for (const side of [-1, 1]) {
  const section = {
      laneCount: 6,
      laneWidth: 3.5,
      shoulderWidth: 1,
      sidewalkWidth: 0,
    },
    offset = side * 7.75;
  const values = mergePaintOffsets(
    { curve: { offset }, pav: 5.75 },
    { side, branchCurve: {} },
    { roadType: { id: "freeway", section }, width: 27 },
  );
  assert.deepEqual(
    values.map((v) => Math.round((v + offset) * 100) / 100),
    [side * 5.5, side * 9, side * 12.35],
  );
}
