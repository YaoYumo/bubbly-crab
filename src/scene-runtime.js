// Shared character phase/pose snapshot for transactional scene application.
import { cloneData } from "./ai-scene-format.js";
export function subjectRuntime(app) {
  return app.objects
    .filter((o) => o.root.userData.humans)
    .map((o) => {
      const nodes = [];
      o.root.traverse((n) =>
        nodes.push([
          n.position.toArray(),
          n.rotation.toArray(),
          n.scale.toArray(),
        ]),
      );
      return {
        id: o.id,
        nodes,
        phase: o.root.userData.animPhase,
        init: o.root.userData.crowdInit,
        humans: o.root.userData.humans.map((h) => ({
          ph: h.ph,
          anim: h.anim,
          dist: h.dist,
          w: h.w && { ...h.w },
        })),
      };
    });
}
export function restoreSubjects(app, saved) {
  for (const s of saved) {
    const o = app.byId(s.id);
    if (!o?.root.userData.humans) continue;
    let i = 0;
    o.root.traverse((n) => {
      const v = s.nodes[i++];
      if (v && n !== o.root) {
        n.position.fromArray(v[0]);
        n.rotation.fromArray(v[1]);
        n.scale.fromArray(v[2]);
      }
    });
    o.root.userData.animPhase = s.phase;
    o.root.userData.crowdInit = s.init;
    for (let j = 0; j < s.humans.length; j++)
      if (o.root.userData.humans[j])
        for (const [key, value] of Object.entries(s.humans[j]))
          o.root.userData.humans[j][key] = value === undefined ? undefined : cloneData(value);
  }
}
