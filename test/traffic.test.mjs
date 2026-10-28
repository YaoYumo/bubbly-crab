import assert from "node:assert/strict";
import * as T from "three";
import {
  buildTrafficNetwork,
  TrafficSimulation,
  signalPhase,
  trafficSettings,
} from "../src/traffic-network.js";
import { armsFromIsect, junctionPlan } from "../src/junction.js";
const line = (a, b) =>
  new T.LineCurve3(new T.Vector3(...a), new T.Vector3(...b));
const road = (id, type, curve, width = 12, extra = {}) => ({
  id,
  type: "road_brush",
  visible: true,
  _roadData: { roadType: { id: type }, curve, width, ...extra },
});
const a = road("a", "asphalt", line([-120, 0, 0], [120, 0, 0])),
  b = road("b", "concrete", line([0, 0, -120], [0, 0, 120]));
const is = {
  newCurve: a._roadData.curve,
  existingCurve: b._roadData.curve,
  tNew: 0.5,
  tExisting: 0.5,
  newWidth: 12,
  existingWidth: 12,
  newRoadType: a._roadData.roadType,
  existingRoadType: b._roadData.roadType,
  point: new T.Vector3(),
};
is.plan = junctionPlan(is.point, armsFromIsect(is));
const junction = { id: "j", type: "road_intersection", _isect: is };
const freeway = road("h", "freeway", line([-120, 8, 30], [120, 8, 30]), 20),
  path = road("p", "garden", line([-80, 0, 60], [80, 0, 60]), 4);
const network = buildTrafficNetwork([a, b, junction, freeway, path]);
assert.equal([...network.nodes.values()].filter((n) => n.controlled).length, 1);
assert.equal(
  [...network.lanes.values()].filter(
    (l) => l.roadId === "h" && l.kind === "pedestrian",
  ).length,
  0,
);
assert.ok(
  [...network.lanes.values()].some(
    (l) => l.roadId === "p" && l.kind === "pedestrian",
  ),
);
assert.equal(
  [...network.lanes.values()].filter(
    (l) => l.roadId === "p" && l.kind === "car",
  ).length,
  0,
);
assert.ok(
  [...network.lanes.values()].find((l) => l.roadId === "h" && l.kind === "car")
    .speed >
    [...network.lanes.values()].find(
      (l) => l.roadId === "a" && l.kind === "car",
    ).speed,
);
assert.equal(signalPhase(1).group, 0);
assert.equal(signalPhase(11).color, "amber");
assert.equal(signalPhase(15).group, 1);
assert.equal(signalPhase(27).group, 2);
assert.equal(signalPhase(32.5).color, "red");
const sim = new TrafficSimulation(network, {
  vehicles: 24,
  pedestrians: 12,
  enabled: true,
  seed: 11,
});
const lane = [...network.lanes.values()].find(
    (l) => l.roadId === "b" && l.kind === "car" && l.dir === 1,
  ),
  event = lane.events[0];
const car = {
  id: "car-0",
  kind: "car",
  lane,
  s: event.entry - 14,
  speed: 0,
  visits: 0,
};
sim.agents = [car];
sim.sample(9);
assert.ok(car.s <= event.entry + 0.001);
assert.ok(car.speed < 0.1);
sim.sample(18);
assert.ok(car.s > event.entry + 1, "green releases queued car");
// Independent pedestrian phase and occupied-crosswalk clearance hold vehicles.
const pedLane = [...network.lanes.values()].find(
    (l) => l.roadId === "a" && l.kind === "pedestrian" && l.dir === 1,
  ),
  pe = pedLane.events[0];
const ped = {
  id: "pedestrian-0",
  kind: "pedestrian",
  lane: pedLane,
  s: pe.entry - 0.1,
  speed: 0,
  visits: 0,
};
const sim2 = new TrafficSimulation(network, {
  vehicles: 0,
  pedestrians: 0,
  enabled: true,
});
sim2.agents = [ped];
sim2.sample(25);
assert.ok(ped.s <= pe.entry + 0.001);
sim2.sample(28);
assert.ok(ped.s > pe.entry + 0.2);
assert.ok(ped.crossing);
const incoming = [...network.lanes.values()].find(
    (l) => l.roadId === "a" && l.kind === "car",
  ),
  ce = incoming.events[0];
assert.equal(sim2.canEnter({ kind: "car", lane: incoming }, ce), false);
const sample = (s) =>
  s.agents.map((a) => ({
    id: a.id,
    lane: a.lane.id,
    s: a.s,
    turn: a.turn?.s,
    speed: a.speed,
  }));
const deterministic = new TrafficSimulation(network, {
  vehicles: 40,
  pedestrians: 15,
  enabled: true,
  seed: 71,
});
deterministic.sample(38);
const x = sample(deterministic);
deterministic.sample(3);
deterministic.sample(38);
assert.deepEqual(
  sample(deterministic),
  x,
  "seek-back reproduces exact traffic state",
);
assert.ok(
  deterministic.stats.transfers > 0,
  "cars actually transfer between connected roads",
);
for (const lane of network.lanes.values()) {
  const agents = deterministic.agents
    .filter((a) => a.lane === lane && !a.turn)
    .sort((a, b) => a.s - b.s);
  for (let i = 1; i < agents.length; i++)
    assert.ok(
      agents[i].s - agents[i - 1].s >= (lane.kind === "car" ? 5.99 : 1.39),
      "following gap",
    );
}
// A geometrical one-way ramp may have been drawn opposite the correct near-side traffic flow.
const h = road("h", "freeway", line([-120, 8, 0], [120, 8, 0]), 20),
  street = road("s", "asphalt", line([0, 0, -120], [0, 0, 120]));
const ramp = road("r", "oneway", line([-24, 8, 6], [-3, 0, 24]), 5, {
  connection: {
    kind: "ramp",
    anchors: [
      { roadId: "h", t: 0.4 },
      { roadId: "s", t: 0.6 },
    ],
  },
});
assert.equal(
  [...buildTrafficNetwork([h, street, ramp]).lanes.values()].find(
    (l) => l.roadId === "r" && l.kind === "car",
  ).dir,
  -1,
);
const hidden = buildTrafficNetwork([{ ...h, visible: false }, street]);
assert.equal(
  [...hidden.lanes.values()].filter((l) => l.roadId === "h").length,
  0,
);
assert.equal(trafficSettings({ vehicles: 999, pedestrians: -3 }).vehicles, 120);
assert.equal(trafficSettings({ pedestrians: -3 }).pedestrians, 0);
console.log(
  "PASS lane topology / right-side flow + generated ramp direction / road-type speeds / no motorway pedestrians / traffic lights and amber / pedestrian clearance / following gaps / actual road transfers / deterministic seek / hidden roads / budgets",
);
