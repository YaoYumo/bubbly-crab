import { resolveSpatialRelations } from "./spatial-relations.js";
// Approved assemblies over registered library parts. Never execute generated code.
// +Z is the host's front; attachment coordinates are host-local metres.
export const SCENE_KITS = Object.freeze([
  {
    id: "cyber-frontage",
    name: "赛博商业立面",
    parts: ["building:shophouse:沿街商铺", "showcase:neonsign:霓虹灯牌"],
    anchors: ["front-sign"],
    clearance: "sign projects 0.2m beyond shop front; preserve sidewalk",
  },
  {
    id: "river-frontage",
    name: "滨河暖窗商楼",
    parts: ["cn:streetshop:街市铺面", "showcase:shoplights:古城暖窗格栅"],
    anchors: ["front-windows"],
    clearance: "warm window panel faces river, 0.07m in front of facade",
  },
]);
export function attachTo(host, part, { forward, side = 0, y = 0 }) {
  const solved = resolveSpatialRelations({
    version: 1,
    entities: [
      {
        id: "host",
        position: [host[1], host[5].y || 0, host[2]],
        yaw: host[3],
      },
      {
        id: "part",
        position: [part[1], part[5].y || 0, part[2]],
        yaw: part[3],
      },
    ],
    rules: [
      {
        type: "anchor",
        subject: "part",
        host: "host",
        offset: [side, y, forward],
      },
    ],
  });
  const p = solved.entities[1];
  part[1] = p.position[0];
  part[2] = p.position[2];
  part[3] = p.yaw;
  part[5].y = p.position[1];
}
function tag(host, part, id, index, anchor) {
  const instance = `${id}-${index}`;
  host[5].assembly = { id, instance, role: "host" };
  part[5].assembly = { id, instance, role: "attachment", anchor };
}
export function cyberFrontage(objects) {
  let index = 0;
  for (let i = 0; i < objects.length; i++) {
    const host = objects[i],
      part = objects[i + 1];
    if (
      !host[0].startsWith("building:shophouse:") ||
      !part?.[0].startsWith("showcase:neonsign:")
    )
      continue;
    attachTo(host, part, {
      forward: host[4].depth / 2 + 0.2,
      side: -Math.sin(host[3]) * 6,
      y: 4,
    });
    tag(host, part, "cyber-frontage", index++, "front-sign");
  }
}
export function riverFrontage(objects) {
  let index = 0;
  for (let i = 0; i < objects.length; i++) {
    const host = objects[i],
      part = objects[i + 1];
    if (
      !host[0].startsWith("cn:streetshop:") ||
      !part?.[0].startsWith("showcase:shoplights:")
    )
      continue;
    attachTo(host, part, { forward: host[4].d / 2 + 0.07 });
    tag(host, part, "river-frontage", index++, "front-windows");
  }
}
