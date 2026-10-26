export const PRIMITIVE_KEY = "generated:ai_primitive:AI组合粗模";
export const DEFAULT_PARTS = [
  { shape: "box", size: [1, 1, 1], pos: [0, 0.5, 0], color: "#8396ac" },
];
const num = (v, min, max, label) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label}需为${min}–${max}有限数`);
  return v;
};
const vec = (v, min, max, label) => {
  if (!Array.isArray(v) || v.length !== 3) throw Error(label + "需要三个数字");
  return v.map((n) => num(n, min, max, label));
};
export function cleanPrimitiveParts(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 64)
    throw Error("组合粗模需要1–64个基础形状");
  return parts.map((p) => {
    if (!p || typeof p !== "object" || Array.isArray(p))
      throw Error("粗模部件必须为对象");
    for (const k of Object.keys(p))
      if (!["shape", "size", "pos", "rot", "color", "name"].includes(k))
        throw Error("粗模部件未知字段：" + k);
    if (
      !["box", "sphere", "cylinder", "cone", "capsule", "torus"].includes(
        p.shape,
      )
    )
      throw Error(
        "粗模只支持box/sphere/cylinder/cone/capsule/torus，不执行代码或URL",
      );
    if (
      p.color !== undefined &&
      (typeof p.color !== "string" || !/^#[a-f0-9]{6}$/i.test(p.color))
    )
      throw Error("部件颜色需#RRGGBB");
    if (
      p.name !== undefined &&
      (typeof p.name !== "string" || p.name.length > 60)
    )
      throw Error("部件名称最多60字");
    return {
      shape: p.shape,
      size: vec(p.size, 0.01, 40, "部件尺寸"),
      pos: vec(p.pos, -40, 40, "部件位置"),
      rot: p.rot === undefined ? [0, 0, 0] : vec(p.rot, -32, 32, "部件弧度"),
      color: p.color ?? "#8396ac",
      name: p.name ?? p.shape,
    };
  });
}
