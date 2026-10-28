import * as T from "three";
import {
  TRAFFIC_DEFAULTS,
  trafficSettings,
  buildTrafficNetwork,
  TrafficSimulation,
  signalPhase,
} from "./traffic-network.js";
const UP = new T.Vector3(0, 1, 0);
export class TrafficSystem {
  constructor(app) {
    this.app = app;
    this.settings = { ...TRAFFIC_DEFAULTS };
    this.root = new T.Group();
    this.root.name = "automatic-traffic";
    this.root.userData.pickIgnore = true;
    app.stage.world.add(this.root);
    this.previewTime = 0;
    this.previewMode = false;
    this.running = false;
    this.dirty = true;
    this.signalHeads = [];
    for (const event of ["objects", "road-edit", "terrain"])
      app.bus.on(event, () => {
        this.dirty = true;
      });
  }
  toJSON() {
    return { ...this.settings };
  }
  load(value) {
    this.settings = trafficSettings({ ...TRAFFIC_DEFAULTS, ...value });
    this.running = false;
    this.previewMode = false;
    this.previewTime = 0;
    this.dirty = true;
    this.rebuild();
    this.app.bus.emit("traffic");
  }
  configure(patch) {
    this.app.beginOp("自动交通设置");
    this.settings = trafficSettings({ ...this.settings, ...patch });
    this.dirty = true;
    this.rebuild();
    this.app.markDirty?.();
    this.app.bus.emit("traffic");
  }
  clear() {
    const gs = new Set(),
      ms = new Set();
    this.root.traverse((m) => {
      if (m.geometry) gs.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material])
        if (mat) ms.add(mat);
      if (m.isInstancedMesh) m.dispose();
    });
    this.root.clear();
    gs.forEach((g) => g.dispose());
    ms.forEach((m) => m.dispose());
    this.signalHeads = [];
    this.parts = [];
  }
  rebuild() {
    this.clear();
    this.dirty = false;
    this.network = buildTrafficNetwork(this.app.objects);
    this.sim = new TrafficSimulation(this.network, this.settings);
    this.root.visible = this.settings.enabled;
    if (!this.settings.enabled) return;
    const cars = this.sim.agents.filter((a) => a.kind === "car"),
      peds = this.sim.agents.filter((a) => a.kind === "pedestrian");
    const add = (name, geometry, color, agents, offset, animate = null) => {
      if (!agents.length) {
        geometry.dispose();
        return;
      }
      const mesh = new T.InstancedMesh(
        geometry,
        new T.MeshStandardMaterial({ color, roughness: 0.7 }),
        agents.length,
      );
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.pickIgnore = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.parts.push({ mesh, agents, offset, animate });
      return mesh;
    };
    const car = add(
      "traffic-cars",
      new T.BoxGeometry(1.75, 0.65, 4.2),
      0xffffff,
      cars,
      [0, 0.6, 0],
    );
    if (car)
      cars.forEach((a, i) =>
        car.setColorAt(
          i,
          new T.Color(
            [0xdce5ee, 0x566e8c, 0xbb5044, 0xe0b05d, 0x646a70][i % 5],
          ),
        ),
      );
    add(
      "traffic-windows",
      new T.BoxGeometry(1.5, 0.65, 2.2),
      0x243a48,
      cars,
      [0, 1.25, -0.15],
    );
    add(
      "traffic-front",
      new T.BoxGeometry(1.45, 0.17, 0.08),
      0xfff0b6,
      cars,
      [0, 0.65, 2.11],
    );
    add(
      "traffic-rear",
      new T.BoxGeometry(1.45, 0.15, 0.08),
      0xb13732,
      cars,
      [0, 0.65, -2.11],
    );
    for (const x of [-0.93, 0.93])
      for (const z of [-1.35, 1.35]) {
        const wheel = new T.CylinderGeometry(0.31, 0.31, 0.22, 8);
        wheel.rotateZ(Math.PI / 2);
        add("traffic-wheels", wheel, 0x1d2228, cars, [x, 0.32, z]);
      }
    add(
      "traffic-pedestrians",
      new T.BoxGeometry(0.42, 0.65, 0.28),
      0x547ea0,
      peds,
      [0, 1.05, 0],
    );
    add(
      "traffic-heads",
      new T.SphereGeometry(0.16, 8, 6),
      0xcba387,
      peds,
      [0, 1.6, 0],
    );
    for (const side of [-1, 1])
      add(
        "traffic-legs",
        new T.BoxGeometry(0.14, 0.65, 0.16),
        0x353e48,
        peds,
        [side * 0.12, 0.35, 0],
        (a, time) =>
          Math.sin(time * 7 + Number(a.id.split("-")[1])) *
          Math.min(0.2, a.speed * 0.15) *
          side,
      );
    if (this.settings.signals)
      for (const node of this.network.nodes.values())
        if (node.controlled) {
          for (const group of [0, 1, 2]) {
            const e = node.events.find(
              (e) =>
                e.group === (group === 2 ? 0 : group) &&
                e.lane.kind === (group === 2 ? "pedestrian" : "car"),
            );
            if (!e) continue;
            const p = e.lane.position(e.entry),
              d = e.lane.tangent(e.entry),
              right = new T.Vector3(d.z, 0, -d.x);
            p.addScaledVector(
              right,
              group === 2 ? 0.5 : Math.max(2, e.lane.road._roadData.width / 2),
            );
            const pole = new T.Mesh(
              new T.CylinderGeometry(0.06, 0.08, 2.8, 6),
              new T.MeshStandardMaterial({ color: 0x515b64 }),
            );
            pole.position.copy(p).add(new T.Vector3(0, 1.4, 0));
            this.root.add(pole);
            for (const [i, color] of ["red", "amber", "green"].entries()) {
              const lamp = new T.Mesh(
                new T.SphereGeometry(0.16, 8, 6),
                new T.MeshStandardMaterial({
                  color: 0x25272b,
                  emissive: 0x000000,
                }),
              );
              lamp.position.copy(p).add(new T.Vector3(0, 2.85 - i * 0.36, 0));
              lamp.userData.trafficSignal = { node: node.id, group, color };
              this.signalHeads.push(lamp);
              this.root.add(lamp);
            }
          }
        }
  }
  update(dt = 0, forExport = false) {
    if (this.app._clearingScene) return;
    if (this.app.roadBrush?.active || this.app._roadPropertyCommit) {
      this.root.visible = false;
      return;
    }
    this.root.visible = this.settings.enabled;
    if (this.dirty) {
      this.rebuild();
      this.app.bus.emit("traffic");
    }
    if (!this.settings.enabled) return;
    if (
      this.app.state.playing &&
      !forExport &&
      (this.previewMode || this.running)
    ) {
      this.previewMode = false;
      this.running = false;
      this.app.bus.emit("traffic");
    }
    if (
      this.running &&
      !forExport &&
      !this.app.stage.exporting &&
      !this.app.state.playing
    )
      this.previewTime += dt;
    const time =
      forExport ||
      this.app.stage.exporting ||
      this.app.state.playing ||
      !this.previewMode
        ? this.app.state.time
        : this.previewTime;
    this.renderAt(time);
  }
  renderAt(time) {
    if (!this.sim) return;
    this.sim.sample(time);
    const m = new T.Matrix4(),
      q = new T.Quaternion(),
      scale = new T.Vector3(1, 1, 1);
    for (const { mesh, agents, offset, animate } of this.parts || []) {
      agents.forEach((original, i) => {
        const a = this.sim.agentById.get(original.id);
        const pose = this.sim.pose(a),
          t = pose.tangent;
        const yaw = Math.atan2(t.x, t.z);
        q.setFromAxisAngle(UP, yaw);
        if (a.kind === "car") {
          const z = t.clone().normalize(),
            x = UP.clone().cross(z).normalize(),
            y = z.clone().cross(x).normalize();
          q.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
        }
        const p = new T.Vector3(...offset);
        if (animate) p.z += animate(a, time);
        p.applyQuaternion(q).add(pose.position);
        m.compose(p, q, scale);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    const phase = signalPhase(time),
      colors = { red: 0xe34236, amber: 0xf0b52f, green: 0x43df87 };
    for (const lamp of this.signalHeads) {
      const { group, color } = lamp.userData.trafficSignal,
        active = color === (phase.group === group ? phase.color : "red");
      lamp.material.color.setHex(active ? colors[color] : 0x25272b);
      lamp.material.emissive.setHex(active ? colors[color] : 0);
      lamp.material.emissiveIntensity = active ? 0.7 : 0;
    }
  }
}
