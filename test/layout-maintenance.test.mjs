import assert from "node:assert/strict";
import * as THREE from "three";
import {
  captureAttachment,
  expectedAttachment,
  planAttachments,
  validateAttachment,
  attachmentDrift,
} from "../src/layout-attachments.js";
import {
  LayoutMaintenance,
  predictedAttachmentBox,
} from "../src/layout-maintenance.js";
const e = (id, pos = [0, 0, 0]) => ({
  id,
  key: "env:crate:木箱",
  type: "prop",
  params: {},
  pos,
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  locked: false,
  visible: true,
  followTerrain: false,
  motion: { active: false },
});
const host = e("host", [10, 2, 10]),
  part = e("part", [12, 3, 14]);
part.params.sceneAttachment = captureAttachment(part, host);
let next = expectedAttachment(
  part,
  { ...host, pos: [20, 4, 10], rot: [0, Math.PI / 2, 0], scale: [2, 2, 2] },
  part.params.sceneAttachment,
);
assert(Math.hypot(...next.pos.map((v, i) => v - [28, 6, 6][i])) < 1e-8);
assert.equal(next.rot[1], Math.PI / 2);
assert.deepEqual(next.scale, [2, 2, 2]);
const before = JSON.stringify([host, part]);
let p = planAttachments([{ ...host, pos: [20, 2, 10] }, part]);
assert.equal(p.patches.length, 1);
assert.equal(JSON.stringify([host, part]), before);
assert(
  !attachmentDrift(
    part,
    expectedAttachment(part, host, part.params.sceneAttachment),
  ),
);
// Known recipe anchors preserve authored offsets and update only depth differences.
const shop = {
  ...e("shop"),
  key: "cn:streetshop:街市铺面",
  scale: [0.8, 0.8, 0.8],
  params: { d: 8 },
};
const windows = {
  ...e("windows", [0, 0, 4.07]),
  key: "showcase:shoplights:古城暖窗格栅",
};
const known = captureAttachment(windows, shop, "river-frontage");
assert(!attachmentDrift(windows, expectedAttachment(windows, shop, known)));
next = expectedAttachment(windows, { ...shop, params: { d: 10 } }, known);
assert(Math.abs(next.pos[2] - 4.87) < 1e-8);
const tip = e("tip", [13, 3, 14]);
tip.params.sceneAttachment = captureAttachment(tip, part);
p = planAttachments([{ ...host, pos: [20, 2, 10] }, part, tip]);
assert.equal(p.patches.length, 2);
assert.deepEqual(p.expected.get("tip").pos, [23, 3, 14]);
// Auto follows only opted-in descendants, not a directly edited attachment itself.
part.params.sceneAttachment.follow = true;
tip.params.sceneAttachment.follow = true;
p = planAttachments([{ ...host, pos: [20, 2, 10] }, part, tip], {
  selectedId: "host",
  autoOnly: true,
});
assert.equal(p.patches.length, 2);
p = planAttachments([host, { ...part, pos: [30, 3, 14] }, tip], {
  selectedId: "part",
  autoOnly: true,
});
assert.equal(p.patches.length, 1);
assert.equal(p.patches[0].id, "tip");
part.params.sceneAttachment.follow = false;
assert.equal(
  planAttachments([{ ...host, pos: [20, 2, 10] }, part, tip], {
    selectedId: "host",
    autoOnly: true,
  }).selected,
  0,
);
for (const [h, c] of [
  [{ ...host, scale: [1, 2, 1] }, part],
  [{ ...host, rot: [0.1, 0, 0] }, part],
  [host, { ...part, motion: { active: true } }],
  [host, { ...part, key: "char:human:男性" }],
])
  assert.throws(() => captureAttachment(c, h));
assert.throws(() => captureAttachment(host, host), /自身/);
assert.throws(
  () => validateAttachment({ ...part.params.sceneAttachment, run: "code" }),
  /未知/,
);
assert.throws(() =>
  validateAttachment({
    ...part.params.sceneAttachment,
    offset: [Infinity, 0, 0],
  }),
);
assert.throws(() => validateAttachment(JSON.parse('{"__proto__":{}}')), /原型/);
const missing = planAttachments([part]);
assert(missing.issues.some((i) => i.message.includes("引用缺失")));
const locked = planAttachments([
  { ...host, pos: [30, 2, 10] },
  { ...part, locked: true },
]);
assert(locked.issues.some((i) => i.code === "attachment-locked"));
assert.equal(locked.patches.length, 0);
const terrain = planAttachments([
  { ...host, pos: [30, 2, 10] },
  { ...part, followTerrain: true },
]);
assert.equal(terrain.patches.length, 0);
assert.equal(terrain.issues[0].code, "attachment-terrain");
const cyclicHost = {
  ...host,
  params: { sceneAttachment: captureAttachment(host, part) },
};
assert(
  planAttachments([cyclicHost, part]).issues.some((i) =>
    i.message.includes("成环"),
  ),
);
assert.throws(() => planAttachments([host, host]), /ID重复/);
assert.throws(
  () =>
    planAttachments(
      Array.from({ length: 257 }, (_, i) => ({
        ...e("part-" + i),
        params: { sceneAttachment: part.params.sceneAttachment },
      })),
    ),
  /256/,
);
// Circular Three.js userData is never cloned; shared geometry remains alive and unchanged.
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial(),
);
mesh.userData.circular = mesh;
mesh.position.set(1, 0, 0);
const oldPos = mesh.position.toArray(),
  geometry = mesh.geometry;
const predicted = predictedAttachmentBox(mesh, {
  pos: [10, 0, 0],
  rot: [0, Math.PI / 2, 0],
  scale: [2, 2, 2],
});
assert(predicted.min.distanceTo(new THREE.Vector3(8, -2, -2)) < 1e-8);
assert(predicted.max.distanceTo(new THREE.Vector3(12, 2, 2)) < 1e-8);
assert.deepEqual(mesh.position.toArray(), oldPos);
assert.equal(mesh.geometry, geometry);
const instance = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial(),
  1,
);
instance.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 0, 0));
assert.equal(
  predictedAttachmentBox(instance, {
    pos: [10, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
  }).min.x,
  11.5,
);
function fakeApp() {
  const listeners = new Map(),
    scene = new THREE.Scene();
  const app = {
    objects: [],
    state: { playing: false },
    stage: { scene, dragging: false },
    terrain: { workflow: {} },
    _undo: [],
    _redo: [],
    _undoBytes: 0,
    notices: [],
    saves: 0,
    bus: {
      on(name, fn) {
        const a = listeners.get(name) || [];
        a.push(fn);
        listeners.set(name, a);
      },
      emit(name) {
        for (const fn of listeners.get(name) || []) fn();
      },
    },
    byId(id) {
      return this.objects.find((o) => o.id === id);
    },
    notify(message) {
      this.notices.push(message);
    },
    saveLocal() {
      this.saves++;
    },
    serialize() {
      return {
        objects: this.objects.map((o) => ({
          id: o.id,
          key: o.key,
          params: o.params,
          pos: o.root.position.toArray(),
          rot: [o.root.rotation.x, o.root.rotation.y, o.root.rotation.z],
          scale: o.root.scale.toArray(),
          followTerrain: o.followTerrain,
          locked: o.locked,
        })),
        layoutRelations: this.layoutRelations || null,
      };
    },
    pushUndo(label, j) {
      const size = JSON.stringify(j).length;
      this._undo.push({ label, j: structuredClone(j), size });
      this._undoBytes += size;
    },
  };
  app.add = (id, pos) => {
    const o = {
      ...e(id, pos),
      name: id,
      item: true,
      root: new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial(),
      ),
    };
    o.root.position.fromArray(pos);
    scene.add(o.root);
    app.objects.push(o);
    return o;
  };
  app.layout = new LayoutMaintenance(app);
  return app;
}
const a = fakeApp(),
  h = a.add("host", [0, 0, 0]),
  c = a.add("part", [4, 0, 0]);
a.layout.bind(c.id, h.id);
assert.equal(a._undo.length, 1);
assert.equal(c.params.sceneAttachment.follow, false);
const snapshot = () => JSON.stringify(a.serialize());
let snap = snapshot();
let report = a.layout.inspect();
assert(!report.stale);
assert.equal(snapshot(), snap);
h.root.position.x = 10;
a.bus.emit("objects");
assert(report.stale);
report = a.layout.inspect();
assert(report.issues.some((i) => i.code === "attachment-drift"));
let undoLength = a._undo.length;
assert.equal(a.layout.sync("host"), 1);
assert.equal(c.root.position.x, 14);
assert.equal(a._undo.length, undoLength + 1);
assert.equal(a._undo.at(-1).j.objects[1].pos[0], 4);
a.layout.setFollow("part", true);
h.root.position.x = 20;
undoLength = a._undo.length;
a.layout.afterHostEdit(h);
assert.equal(c.root.position.x, 24);
assert.equal(
  a._undo.length,
  undoLength,
  "auto update must share host edit undo",
);
// Locking or foreign protected geometry refuses the entire sync, no partial mutation/history.
h.root.position.x = 30;
c.locked = true;
snap = snapshot();
assert.throws(() => a.layout.sync("host"), /锁定/);
assert.equal(snapshot(), snap);
c.locked = false;
const block = a.add("blocked", [34, 0, 0]);
block.locked = true;
snap = snapshot();
assert.throws(() => a.layout.sync("host"), /锁定对象/);
assert.equal(snapshot(), snap);
block.root.position.x = 100;
// Transaction failure injected after mutation restores transforms, metadata, and exact history.
const originalPush = a.pushUndo;
a.pushUndo = function (label, j) {
  originalPush.call(this, label, j);
  throw Error("injected");
};
snap = snapshot();
undoLength = a._undo.length;
assert.throws(() => a.layout.sync("host"), /injected/);
assert.equal(snapshot(), snap);
assert.equal(a._undo.length, undoLength);
a.pushUndo = originalPush;
for (const setup of [
  () => (a.state.playing = true),
  () => (a.stage.exportOwner = "fixture"),
  () => (a.stage.dragging = true),
  () => (a.aiScene = { busy: true }),
  () => (a.terrain.workflow.busy = true),
]) {
  setup();
  assert.throws(() => a.layout.sync("host"), /结束/);
  a.state.playing = false;
  a.stage.exportOwner = null;
  a.stage.dragging = false;
  a.aiScene = null;
  a.terrain.workflow.busy = false;
}
// Persisted AI rules diagnose changes, never automatically modify subjects.
a.layoutRelations = {
  version: 1,
  rules: [
    { type: "distance", subject: "part", target: "host", min: 1, max: 2 },
  ],
};
snap = snapshot();
report = a.layout.inspect();
assert(report.issues.some((i) => i.code === "relation-distance"));
assert.equal(snapshot(), snap);
a.layoutRelations.rules = [
  {
    type: "offset",
    subject: "part",
    reference: "missing",
    delta: [1, 0, 0],
    frame: "world",
  },
];
assert(a.layout.inspect().issues.some((i) => i.code === "relation-missing"));
a.layoutRelations = { version: 7, rules: [] };
assert(a.layout.inspect().issues.some((i) => i.code === "relation-invalid"));
a.layout.detach("part");
assert(!c.params.sceneAttachment);
console.log(
  "PASS layout maintenance: local transforms/chains/depth changes; opt-in descendants; guards/locks/cycles/budgets; read-only diagnostics/stale state; geometric prediction without cloning circular userData; transactional sync/rollback and no automatic AI repair.",
);

const risk = fakeApp();
risk.add("obstacle", [0, 0, 0]);
const actor = risk.add("walker", [-3, 0, 0]);
actor.motion = {
  active: true,
  keys: [
    { t: 0, p: [-3, 0, 0] },
    { t: 1, p: [3, 0, 0] },
  ],
};
assert(risk.layout.inspect().issues.some((i) => i.code === "route-risk"));
actor.motion.keys[1].t = 0;
assert(risk.layout.inspect().issues.some((i) => i.code === "route-unchecked"));
const large = fakeApp();
for (let i = 0; i < 203; i++)
  large.add("obj-" + i, [(i % 20) * 3, 0, Math.floor(i / 20) * 3]);
const bounded = large.layout.inspect();
assert(!bounded.complete);
assert(bounded.issues.some((i) => i.code === "budget"));
console.log(
  "PASS diagnostic path risk, invalid timing and explicit incomplete-budget report.",
);

const { mergeLayoutRelations } = await import("../src/ai-scene-format.js");
const rule = (delta) => ({
  version: 1,
  rules: [
    {
      type: "offset",
      subject: "part",
      reference: "host",
      delta: [delta, 0, 0],
      frame: "world",
    },
  ],
});
const firstRule = rule(4),
  secondRule = rule(6),
  firstText = JSON.stringify(firstRule);
const merged = mergeLayoutRelations(firstRule, secondRule);
assert.equal(merged.rules.length, 1);
assert.equal(merged.rules[0].delta[0], 6);
assert.equal(JSON.stringify(firstRule), firstText);
const checkA = {
  version: 1,
  rules: [
    { type: "distance", subject: "part", target: "host", min: 0, max: 5 },
  ],
};
const checkB = {
  version: 1,
  rules: [
    { type: "distance", subject: "part", target: "host", min: 0, max: 10 },
  ],
};
assert.equal(mergeLayoutRelations(checkA, checkB).rules.length, 1);
console.log(
  "PASS current relation-slot replacement without contradictory stale intents or source mutation.",
);
assert(
  planAttachments([
    { ...e("bad-metadata"), params: { sceneAttachment: null } },
  ]).issues.some((i) => i.code === "attachment-invalid"),
);
assert(
  planAttachments([
    { ...e("bad-metadata"), params: { sceneAttachment: false } },
  ]).issues.some((i) => i.code === "attachment-invalid"),
);
