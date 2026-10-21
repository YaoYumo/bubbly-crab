import { resolveSpatialRelations } from "./spatial-relations.js";
// Adapter only: the underlying data-only solver is reusable outside these recipes.
export function inspectSceneRelations(scene) {
  const entities = scene.objs.map((o, i) => {
      const p = o[4];
      let half = [0, 0];
      if (/:streetshop:|:folkhouse:/.test(o[0]))
        half = [p.w / 2 + 1.5, p.d / 2 + 1.5];
      if (o[0].includes(":pagoda:")) half = [p.r * 1.55, p.r * 1.55];
      return {
        id: `node-${i}`,
        position: [o[1], o[5].y || 0, o[2]],
        yaw: o[3],
        half,
      };
    }),
    rules = [];
  const instances = new Map();
  scene.objs.forEach((o, i) => {
    const a = o[5].assembly;
    if (!a) return;
    if (
      !["host", "attachment"].includes(a.role) ||
      !["cyber-frontage", "river-frontage"].includes(a.id)
    )
      throw Error("未知组合规则");
    const entry = instances.get(a.instance) || {};
    if (entry[a.role] != null) throw Error("组合角色重复");
    entry[a.role] = i;
    instances.set(a.instance, entry);
  });
  for (const entry of instances.values()) {
    if (entry.host == null || entry.attachment == null)
      throw Error("组合件挂接引用缺失");
    const host = scene.objs[entry.host],
      part = scene.objs[entry.attachment],
      a = host[5].assembly;
    if (a.id !== part[5].assembly.id) throw Error("组合类型不匹配");
    const offset =
      a.id === "cyber-frontage"
        ? [-Math.sin(host[3]) * 6, 4, host[4].depth / 2 + 0.2]
        : [0, 0, host[4].d / 2 + 0.07];
    rules.push({
      type: "anchor",
      subject: `node-${entry.attachment}`,
      host: `node-${entry.host}`,
      offset,
    });
  }
  scene.objs.forEach((tower, t) => {
    if (!tower[0].includes(":pagoda:")) return;
    scene.objs.forEach((house, h) => {
      if (/:streetshop:|:folkhouse:/.test(house[0]))
        rules.push({
          type: "keep-out",
          subject: `node-${h}`,
          obstacle: `node-${t}`,
          margin: 0,
        });
    });
  });
  const graph = { version: 1, entities, rules },
    result = resolveSpatialRelations(graph);
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i],
      b = result.entities[i];
    if (
      Math.hypot(...a.position.map((v, j) => v - b.position[j])) > 1e-5 ||
      Math.abs(a.yaw - b.yaw) > 1e-5
    )
      result.issues.push({ code: "anchor-drift", subject: a.id });
  }
  result.ok = result.issues.length === 0;
  return {
    graph,
    report: {
      version: 1,
      entities: entities.length,
      rules: rules.length,
      anchors: rules.filter((r) => r.type === "anchor").length,
      reserved: rules.filter((r) => r.type === "keep-out").length,
      issues: result.issues,
      ok: result.ok,
    },
  };
}
