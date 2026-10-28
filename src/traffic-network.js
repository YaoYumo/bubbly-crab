import * as T from "three";
import { sectionForRoad, sectionDimensions } from "./road-section.js";
import { roadDesignHeight } from "./road-contact.js";
const clamp = T.MathUtils.clamp;
export const TRAFFIC_DEFAULTS = {
  enabled: false,
  vehicles: 24,
  pedestrians: 12,
  signals: true,
  seed: 17,
};
export function trafficSettings(input = {}) {
  return {
    enabled: input.enabled === true,
    vehicles: clamp(Math.round(Number(input.vehicles) || 0), 0, 120),
    pedestrians: clamp(Math.round(Number(input.pedestrians) || 0), 0, 80),
    signals: input.signals !== false,
    seed: clamp(Math.floor(Number(input.seed) || 17), 1, 100000),
  };
}
export function signalPhase(time) {
  const t = ((time % 33) + 33) % 33;
  return t < 10
    ? { group: 0, color: "green" }
    : t < 12
      ? { group: 0, color: "amber" }
      : t < 13
        ? { group: -1, color: "red" }
        : t < 23
          ? { group: 1, color: "green" }
          : t < 25
            ? { group: 1, color: "amber" }
            : t < 26
              ? { group: -1, color: "red" }
              : t < 32
                ? { group: 2, color: "green" }
                : { group: -1, color: "red" };
}
export function buildTrafficNetwork(objects, { terrainSize = null } = {}) {
  const boundary = (p) =>
    Number.isFinite(terrainSize) &&
    Math.max(Math.abs(p.x), Math.abs(p.z)) >= terrainSize / 2 - 2 &&
    Math.max(Math.abs(p.x), Math.abs(p.z)) <= terrainSize / 2 + 2;
  const roads = objects.filter(
      (o) => o.type === "road_brush" && o.visible !== false,
    ),
    byCurve = new Map(roads.map((o) => [o._roadData.curve, o])),
    lanes = new Map(),
    nodes = new Map();
  for (const o of roads) {
    const rd = o._roadData,
      type = rd.roadType.id,
      curve = rd.curve,
      L = curve.getLength(),
      section = sectionForRoad(type, rd.width, rd.roadType.section),
      d = section && sectionDimensions(type, section);
    if (!(L > 9)) continue;
    let oneDirection = 1;
    if (type === "oneway" && rd.connection?.kind === "ramp") {
      let score = 0;
      for (const [i, anchor] of (rd.connection.anchors || []).entries()) {
        const host = roads.find((r) => r.id === anchor.roadId);
        if (!host || host._roadData.roadType.id === "oneway") continue;
        const h = host._roadData.curve,
          p = curve.getPointAt(i === 0 ? 0 : 1),
          axis = h.getPointAt(anchor.t),
          tan = h.getTangentAt(anchor.t).setY(0).normalize(),
          side = (p.x - axis.x) * tan.z - (p.z - axis.z) * tan.x;
        if (Math.abs(side) < 0.2) continue;
        score +=
          Math.sign(side) *
          tan.dot(
            curve
              .getTangentAt(i === 0 ? 0 : 1)
              .setY(0)
              .normalize(),
          );
      }
      if (score < 0) oneDirection = -1;
    }
    const add = (kind, dir, index, offset, speed) => {
      const id = `${o.id}:${kind}:${dir}:${index}`,
        lane = {
          id,
          roadId: o.id,
          road: o,
          kind,
          dir,
          index,
          offset,
          length: L,
          speed,
          events: [],
          boundaryEntry: boundary(curve.getPointAt(dir > 0 ? 0 : 1)),
          boundaryExit: boundary(curve.getPointAt(dir > 0 ? 1 : 0)),
          lateralRoom:
            kind === "car"
              ? Math.max(
                  0,
                  Math.min(0.12, ((section?.laneWidth || 3.5) - 1.9) / 2),
                )
              : Math.max(
                  0,
                  Math.min(
                    0.35,
                    (section?.sidewalkWidth || rd.width / 2) / 2 - 0.3,
                  ),
                ),
        };
      lane.position = (s) => {
        const t = clamp(dir > 0 ? s / L : 1 - s / L, 0, 1),
          p = curve.getPointAt(t),
          v = curve.getTangentAt(t).setY(0).normalize();
        let lateral = offset;
        if (kind === "pedestrian")
          for (const e of lane.events) {
            if (!Number.isFinite(e.walkOffset)) continue;
            const distance = Math.abs(s - e.center),
              inner = e.crossHalf + 1,
              outer = e.reach + 6;
            const u = clamp(
                (outer - distance) / Math.max(1, outer - inner),
                0,
                1,
              ),
              w = u * u * (3 - 2 * u);
            lateral += (e.walkOffset - offset) * w;
          }
        p.x += v.z * lateral;
        p.z -= v.x * lateral;
        p.y =
          roadDesignHeight(curve, t) +
          (kind === "car"
            ? 0.17
            : section?.sidewalkWidth > 0 ||
                ["asphalt", "concrete", "oneway"].includes(type)
              ? 0.32
              : 0.18);
        return p;
      };
      lane.tangent = (s) =>
        lane
          .position(Math.min(L, s + 0.1))
          .sub(lane.position(Math.max(0, s - 0.1)))
          .normalize();
      lanes.set(id, lane);
    };
    if (section) {
      const n = section.laneCount,
        w = section.laneWidth,
        speed =
          rd.connection?.kind === "ramp"
            ? 8.3
            : type === "freeway"
              ? 25
              : type === "concrete"
                ? 8.3
                : 11.1;
      if (type === "oneway")
        for (let i = 0; i < n; i++)
          add("car", oneDirection, i, (i - (n - 1) / 2) * w, speed);
      else
        for (const dir of [-1, 1])
          for (let i = 0; i < n / 2; i++)
            add(
              "car",
              dir,
              i,
              dir * ((type === "freeway" ? 2 : 0) + (i + 0.5) * w),
              speed,
            );
    }
    const sidewalk = section?.sidewalkWidth ?? 0;
    if (
      type !== "freeway" &&
      (sidewalk > 0 || ["garden", "gravel"].includes(type))
    )
      for (const dir of [-1, 1])
        add(
          "pedestrian",
          dir,
          0,
          section
            ? dir * (d.pavementWidth / 2 + d.curbWidth + sidewalk / 2)
            : dir * Math.min(0.65, rd.width / 4),
          1.35,
        );
  }
  for (const o of objects.filter(
    (o) => o.type === "road_intersection" && o.visible !== false,
  )) {
    const is = o._isect,
      plan = is?.plan;
    if (!plan) continue;
    const a = byCurve.get(is.newCurve),
      b = byCurve.get(is.existingCurve);
    if (!a || !b) continue;
    const f = is.freeway || is.streetMerge || plan.freeway,
      controlled = !f && !plan.merge && plan.arms.length >= 3;
    const id = [
      a.id,
      b.id,
      Math.round(is.tNew * 10000),
      Math.round(is.tExisting * 10000),
    ].join("|");
    const node = {
      id,
      object: o,
      plan,
      controlled,
      freeflow: !!f || !!plan.merge,
      mainRoad: f ? byCurve.get(f.curve)?.id : null,
      events: [],
    };
    nodes.set(id, node);
    for (const [group, road, t] of [
      [0, a, is.tNew],
      [1, b, is.tExisting],
    ])
      for (const lane of lanes.values()) {
        if (lane.roadId !== road.id) continue;
        if (
          f &&
          road._roadData.curve === f.curve &&
          lane.kind === "car" &&
          Math.sign(lane.offset) !== f.side
        )
          continue;
        const arm = plan.arms.find(
          (arm) =>
            arm.curve === road._roadData.curve ||
            (f &&
              road._roadData.curve === f.curve &&
              arm.curve === f.laneCurve),
        );
        const reach = Math.min(22, Math.max(4, arm?.c || 6)),
          center = (lane.dir > 0 ? t : 1 - t) * lane.length;
        const e = {
          node,
          id,
          group,
          center,
          reach,
          crossHalf: (group === 0 ? b : a)._roadData.width / 2,
          entry: Math.max(0, center - reach - 2.4),
          exit: Math.min(lane.length, center + reach + 3),
          lane,
        };
        if (lane.kind === "pedestrian" && controlled) {
          const at = road._roadData.curve.getPointAt(t),
            tan = road._roadData.curve.getTangentAt(t).setY(0).normalize(),
            normal = new T.Vector3(tan.z, 0, -tan.x);
          const candidates = plan.arms
            .filter((x) => x.curve === (group === 0 ? b : a)._roadData.curve)
            .map((x) => {
              const p = x.curve.getPointAt(x.t);
              return (
                (p.x - at.x + x.dir.x * (x.c - 2.8)) * normal.x +
                (p.z - at.z + x.dir.z * (x.c - 2.8)) * normal.z
              );
            })
            .filter((offset) => Math.sign(offset) === Math.sign(lane.offset));
          if (candidates.length)
            e.walkOffset = candidates.reduce((a, b) =>
              Math.abs(a - lane.offset) < Math.abs(b - lane.offset) ? a : b,
            );
        }
        node.events.push(e);
        lane.events.push(e);
      }
  }
  for (const lane of lanes.values())
    lane.events.sort((a, b) => a.center - b.center);
  return { lanes, nodes };
}
export const trafficRandom = (n) => {
  n = (n ^ 0x9e3779b9) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
};
const hash = trafficRandom;
export class TrafficSimulation {
  constructor(network, settings) {
    this.network = network;
    this.settings = trafficSettings({ ...TRAFFIC_DEFAULTS, ...settings });
    this.reset();
  }
  reset() {
    this.time = 0;
    this.agents = [];
    this.reservations = new Map();
    this.stats = { stops: 0, transfers: 0, respawns: 0 };
    for (const [kind, count] of [
      ["car", this.settings.vehicles],
      ["pedestrian", this.settings.pedestrians],
    ]) {
      const lanes = [...this.network.lanes.values()].filter(
        (l) => l.kind === kind,
      );
      if (!lanes.length) continue;
      const shuffled = lanes
        .map((lane, i) => ({ lane, key: hash(this.settings.seed + i * 137) }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.lane);
      for (let i = 0; i < count; i++) {
        const lane = shuffled[i % shuffled.length];
        let s = 3 + hash(i + this.settings.seed) * (lane.length - 7),
          placed = false;
        for (let k = 0; k < 60; k++) {
          if (
            !lane.events.some((e) => Math.abs(s - e.center) < e.reach + 5) &&
            !this.agents.some(
              (a) =>
                a.lane === lane && Math.abs(a.s - s) < (kind === "car" ? 9 : 2),
            )
          ) {
            placed = true;
            break;
          }
          s = 3 + ((s + 11) % (lane.length - 7));
        }
        if (placed)
          this.agents.push({
            id: `${kind}-${i}`,
            kind,
            lane,
            s,
            speed:
              kind === "car" && lane.boundaryEntry
                ? lane.speed
                : lane.speed *
                  (0.45 + 0.55 * hash(i * 1877 + this.settings.seed)),
            speedFactor:
              kind === "car"
                ? 0.87 + 0.13 * hash(i * 313 + this.settings.seed)
                : 0.75 + 0.5 * hash(i * 313 + this.settings.seed),
            gap:
              kind === "car"
                ? 6 + 2 * hash(i * 577 + this.settings.seed)
                : 1.4 + 0.6 * hash(i * 577 + this.settings.seed),
            lateralBias:
              (hash(i * 911 + this.settings.seed) * 2 - 1) * lane.lateralRoom,
            sizeScale: 0.92 + 0.14 * hash(i * 1237 + this.settings.seed),
            animationPhase: hash(i * 2377 + this.settings.seed) * Math.PI * 2,
            inactive: false,
            visits: 0,
            crossing: null,
            turn: null,
          });
      }
    }
    this.agentById = new Map(this.agents.map((a) => [a.id, a]));
  }
  sample(time) {
    const target = Math.max(0, Math.min(3600, Number(time) || 0)),
      step = 1 / 30;
    if (target < this.time - 1e-6) this.reset();
    while (this.time + step <= target + 1e-7) {
      this.advance(step);
      this.time += step;
    }
    return this.agents;
  }
  canEnter(a, e) {
    if (e.node.freeflow && a.kind === "pedestrian")
      return !(this.reservations.get(e.id) || []).some(
        (b) =>
          b.kind === "car" && (b.turn || b.lane.roadId !== e.node.mainRoad),
      );
    if (e.node.freeflow && a.kind === "car") {
      // Grade-separated merge/diverge: through traffic has priority, not a
      // city-junction mutex. Joining traffic only yields for a real gap.
      if (a.lane.roadId === e.node.mainRoad) return true;
      if (
        (this.reservations.get(e.id) || []).some((b) => b.kind === "pedestrian")
      )
        return false;
      const incoming = a.lane.tangent(e.entry);
      const targets = e.node.events.filter(
        (x) =>
          x.lane.kind === "car" &&
          x.lane.roadId === e.node.mainRoad &&
          x.center < x.lane.length - 5 &&
          x.lane.tangent(x.exit).dot(incoming) > -0.45,
      );
      return targets.some(
        (target) =>
          !this.agents.some(
            (b) =>
              b !== a &&
              !b.inactive &&
              b.lane === target.lane &&
              Math.abs(b.s - target.exit) < Math.max(10, b.speed * 1.6),
          ) &&
          !this.agents.some(
            (b) => b !== a && b.turn?.destination.lane === target.lane,
          ),
      );
    }
    const holders = this.reservations.get(e.id) || [];
    if (holders.some((b) => b !== a && (b.kind === "car" || a.kind === "car")))
      return false;
    if (e.node.controlled && this.settings.signals) {
      const phase = signalPhase(this.time);
      if (
        phase.color !== "green" ||
        phase.group !== (a.kind === "pedestrian" ? 2 : e.group)
      )
        return false;
    }
    if (
      !e.node.controlled &&
      a.kind === "car" &&
      e.node.mainRoad &&
      a.lane.roadId !== e.node.mainRoad
    ) {
      if (
        this.agents.some(
          (b) =>
            b.kind === "car" &&
            b.lane.roadId === e.node.mainRoad &&
            b.lane.events.some(
              (x) => x.id === e.id && x.entry - b.s >= 0 && x.entry - b.s < 20,
            ),
        )
      )
        return false;
    }
    return true;
  }
  enter(a, e) {
    const list = this.reservations.get(e.id) || [];
    list.push(a);
    this.reservations.set(e.id, list);
    a.crossing = { event: e, end: e.exit };
    a.visits++;
    if (
      a.kind !== "car" ||
      (!(e.node.freeflow && a.lane.roadId !== e.node.mainRoad) &&
        hash(a.visits * 17 + Number(a.id.split("-")[1]) + this.settings.seed) >
          (e.node.freeflow ? 0.18 : 0.45))
    )
      return;
    if (
      e.node.freeflow &&
      a.lane.roadId === e.node.mainRoad &&
      (this.reservations.get(e.id) || []).some((b) => b.kind === "pedestrian")
    )
      return;
    const at = a.lane.position(e.entry),
      incoming = a.lane.tangent(e.entry),
      choices = e.node.events.filter(
        (x) =>
          x.lane.kind === "car" &&
          x.lane.roadId !== a.lane.roadId &&
          x.center < x.lane.length - 5 &&
          x.lane.tangent(x.exit).dot(incoming) > -0.45,
      );
    choices.sort(
      (a, b) =>
        at.distanceToSquared(a.lane.position(a.exit)) -
        at.distanceToSquared(b.lane.position(b.exit)),
    );
    for (const other of choices) {
      if (
        this.agents.some(
          (b) =>
            b !== a &&
            !b.inactive &&
            b.lane === other.lane &&
            Math.abs(b.s - other.exit) <
              (e.node.freeflow && a.lane.roadId !== e.node.mainRoad
                ? Math.max(10, b.speed * 1.6)
                : 9),
        )
      )
        continue;
      const end = other.lane.position(other.exit),
        tangent = other.lane.tangent(other.exit),
        handle = Math.min(18, Math.max(3, at.distanceTo(end) * 0.4));
      const curve = new T.CubicBezierCurve3(
        at,
        at.clone().addScaledVector(incoming, handle),
        end.clone().addScaledVector(tangent, -handle),
        end,
      );
      a.turn = { curve, length: curve.getLength(), s: 0, destination: other };
      return;
    }
  }
  release(a) {
    const e = a.crossing?.event;
    if (e) {
      this.reservations.set(
        e.id,
        (this.reservations.get(e.id) || []).filter((b) => b !== a),
      );
    }
    a.crossing = null;
  }
  advance(dt) {
    const groups = new Map();
    for (const a of this.agents)
      if (!a.turn && !a.inactive) {
        if (!groups.has(a.lane.id)) groups.set(a.lane.id, []);
        groups.get(a.lane.id).push(a);
      }
    const reservedStops = new Map();
    for (const a of this.agents)
      if (a.turn) {
        const e = a.turn.destination;
        if (e.node.freeflow && e.lane.roadId === e.node.mainRoad) continue;
        reservedStops.set(
          e.lane.id,
          Math.min(reservedStops.get(e.lane.id) ?? Infinity, e.exit - 7),
        );
      }
    const leaders = new Map();
    for (const group of groups.values()) {
      group.sort((a, b) => b.s - a.s);
      for (let i = 1; i < group.length; i++)
        leaders.set(group[i], group[i - 1]);
    }
    for (const a of this.agents) {
      if (a.inactive) {
        const clearance = a.lane.boundaryEntry
          ? Math.max(12, (a.lane.speed * a.lane.speed) / 8 + 8)
          : 10;
        if (
          !this.agents.some(
            (b) =>
              b !== a && !b.inactive && b.lane === a.lane && b.s < clearance,
          )
        ) {
          a.inactive = false;
          a.s = a.lane.boundaryEntry ? 0 : 2;
          a.speed = a.lane.boundaryEntry ? a.lane.speed : 0;
          this.stats.respawns++;
        } else continue;
      }
      if (a.pauseUntil > this.time) continue;
      if (a.turn) {
        a.turn.s += Math.min(a.lane.speed, 7) * dt;
        if (a.turn.s >= a.turn.length) {
          const target = a.turn.destination;
          a.lane = target.lane;
          a.s = target.exit;
          a.speed = Math.min(7, a.lane.speed);
          a.turn = null;
          this.release(a);
          this.stats.transfers++;
        }
        continue;
      }
      if (a.crossing && a.s >= a.crossing.end - 0.01) this.release(a);
      const next = a.crossing
        ? null
        : a.lane.events.find(
            (e) =>
              e.center > Math.max(3, e.reach * 0.3) && e.entry >= a.s - 0.15,
          );
      let desired =
          a.lane.speed *
          (a.kind === "car" &&
          a.lane.boundaryEntry &&
          a.s < Math.max(12, a.lane.speed * 1.5)
            ? 1
            : (a.speedFactor ?? 1)),
        maxMove = Infinity;
      const mergeStop = reservedStops.get(a.lane.id);
      if (Number.isFinite(mergeStop) && a.s <= mergeStop) {
        const gap = mergeStop - a.s;
        maxMove = Math.min(maxMove, Math.max(0, gap));
        desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * 4 * gap)));
      }
      const leader = leaders.get(a);
      if (leader) {
        const gap = leader.s - a.s - (a.gap ?? (a.kind === "car" ? 6 : 1.4));
        maxMove = Math.min(maxMove, Math.max(0, gap));
        desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * 3 * gap)));
      }
      if (next) {
        const distance = next.entry - a.s;
        if (!this.canEnter(a, next)) {
          desired = Math.min(
            desired,
            Math.sqrt(Math.max(0, 2 * 4 * (distance - 0.05))),
          );
          maxMove = Math.min(maxMove, Math.max(0, distance));
          if (a.speed > 0.2 && distance < 3) this.stats.stops++;
        } else if (distance <= Math.max(0.15, a.speed * dt + 0.02)) {
          this.enter(a, next);
          if (a.turn) continue;
        }
      }
      a.speed = Math.max(0, Math.min(desired, a.speed + 2.5 * dt));
      a.s += Math.min(maxMove, a.speed * dt);
      if (a.s >= a.lane.length - (a.lane.boundaryExit ? 0.05 : 2)) {
        this.release(a);
        const reverse = this.network.lanes.get(
          `${a.lane.roadId}:pedestrian:${-a.lane.dir}:0`,
        );
        if (a.kind === "pedestrian" && reverse) {
          a.lane = reverse;
          a.s = 2;
          a.speed = 0;
          a.pauseUntil =
            this.time + 0.2 + hash(a.visits++ + this.settings.seed) * 1.5;
        } else {
          a.inactive = true;
        } // disappear immediately; never queue at the exit
      }
    }
  }
  pose(a) {
    if (a.turn) {
      const t = Math.min(1, a.turn.s / a.turn.length);
      return {
        position: a.turn.curve.getPointAt(t),
        tangent: a.turn.curve.getTangentAt(t),
      };
    }
    const position = a.lane.position(a.s),
      tangent = a.lane.tangent(a.s);
    const room = a.crossing ? 0 : a.lateralBias || 0;
    position.addScaledVector(new T.Vector3(tangent.z, 0, -tangent.x), room);
    return { position, tangent };
  }
}
