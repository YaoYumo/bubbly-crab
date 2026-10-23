// Deterministic path generation for a bounded, high-level conversational river tool.
// No scene mutations; generated coordinates still pass the existing river validator.
import { finite, vec } from "./ai-scene-format.js";
export const riverPathFields = [
  "shape",
  "center",
  "axis",
  "length",
  "bend",
  "level",
];
export function checkRiverPath(r) {
  if (r.shape === undefined) {
    if (riverPathFields.slice(1).some((k) => r[k] !== undefined))
      throw Error("自动河道路径需要shape");
    return;
  }
  if (r.action !== "add")
    throw Error("自动河形仅用于新增河道；修改现有河道请提供points");
  if (!["straight", "meander"].includes(r.shape))
    throw Error("河形需straight或meander");
  if (r.points !== undefined) throw Error("河道points与自动shape只能选一个");
  if (r.center !== undefined) vec(r.center, 2, -300, 300, "河道中心");
  if (r.axis !== undefined && !["x", "z"].includes(r.axis))
    throw Error("河道方向需x或z");
  if (r.length !== undefined) finite(r.length, 5, 600, "河道长度");
  if (r.bend !== undefined) {
    finite(r.bend, 0, 150, "河道弯曲幅度");
    if (r.shape === "straight" && r.bend !== 0)
      throw Error("直河道不能设置弯曲幅度");
  }
  if (r.level !== undefined) finite(r.level, -100, 100, "河面高度");
}
export function expandRiverPath(input, size, heightAt) {
  if (input.shape === undefined) return input;
  const r = { ...input },
    center = r.center ?? [0, 0],
    axis = r.axis ?? "z",
    width = r.width ?? 6,
    bank = r.bank ?? 4,
    reach = width / 2 + bank;
  const along = axis === "x" ? 0 : 1,
    across = 1 - along;
  const availableAlong = size / 2 - reach - Math.abs(center[along]),
    availableAcross = size / 2 - reach - Math.abs(center[across]);
  const length = r.length ?? Math.min(size * 0.7, 2 * availableAlong);
  if (length < 5 || length / 2 > availableAlong || availableAcross < 0)
    throw Error("地形空间不足以容纳河道及河岸，请缩短/缩窄河道或增大地形");
  // Keep the default curvature radius at least twice the bed+bank reach.
  const safeBend = Math.min(
    availableAcross,
    length / 4,
    (length * length) / (8 * Math.PI * Math.PI * reach),
  );
  const bend =
    r.shape === "meander" ? (r.bend ?? Math.min(size * 0.12, safeBend)) : 0;
  if (r.shape === "meander" && bend <= 0)
    throw Error("没有可容纳弯曲的空间，请调整中心/长度或增大地形");
  if (bend > safeBend + 1e-6)
    throw Error("河道弯曲幅度超出安全空间，请降低bend或加长河道");
  const level = r.level ?? heightAt(center[0], center[1]);
  finite(level, -1000, 1000, "河面高度");
  const count = r.shape === "meander" ? 17 : 2;
  r.points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1) - 0.5,
      p = [...center];
    p[along] += t * length;
    p[across] += bend * Math.sin(t * 2 * Math.PI);
    return [p[0], level, p[1]];
  });
  for (const key of riverPathFields) delete r[key];
  return r;
}
// Only narrow, unambiguous single-new-river commands use the short model protocol.
// Mixed scenes, edits/deletes, questions and explicit multi-river commands keep the full protocol.
export function singleRiverRequest(prompt) {
  if (
    !/(?:生成|制造|创建|新建|修建|添加|新增|开挖|挖|造|建|create|generate|add)[^。；;！？?!]{0,55}(?:河流|河道|小河|溪流|river|stream)/i.test(
      prompt,
    )
  )
    return null;
  if (
    /不要|无需|不需要|禁止|别|删除|移除|去掉|撤销|修改|加宽|加深|[?？]|怎么|如何|能否|可以吗|房|建筑|塔|宫殿|路网|道路|桥|树|人物|角色|水面|湖|海|山|丘陵|岛|水位|模型|houses?|buildings?|roads?|bridges?/i.test(
      prompt,
    )
  )
    return null;
  if (/\b(?:rivers|streams)\b/i.test(prompt)) return null;
  const count = prompt.match(/([一二两三四五六七八九十\d]+)\s*条/);
  if (count && !["一", "1"].includes(count[1])) return null;
  const number = "(-?\\d+(?:\\.\\d+)?)",
    meters = "(?:米|m)",
    fill = "\\s*(?:度|约|为|是|大约|:|：|=|的|\\s)*\\s*";
  const dimension = (name) => {
    const forward = new RegExp(
        name + fill + number + "\\s*" + meters + "?",
        "i",
      ).exec(prompt),
      backward = new RegExp(number + "\\s*" + meters + "\\s*" + name, "i").exec(
        prompt,
      );
    return forward
      ? Number(forward[1])
      : backward
        ? Number(backward[1])
        : undefined;
  };
  const request = {};
  for (const [name, key] of [
    ["宽", "width"],
    ["深", "depth"],
  ]) {
    const v = dimension(name);
    if (v !== undefined) request[key] = v;
  }
  if (/弯|曲|蜿蜒|meander|curv|winding/i.test(prompt))
    request.shape = "meander";
  else if (/笔直|直线|直的|straight/i.test(prompt)) request.shape = "straight";
  return request;
}
export const riverConversationInstruction = `你是本地河道工具助手。本轮只新增一条河流，不摆放模型，不生成其他地形，不开启全局水面。只返回JSON，不能返回空terrain、空unsupported、虚构素材key或程序代码。request是本轮要求，scene是数据，riverRequest是从本轮明确数字提取的约束，必须遵守。
完整返回示例：{"reply":"在中央生成宽20米、深5米的弯曲河道。","operations":[],"terrain":{"rivers":[{"action":"add","shape":"meander","width":20,"depth":5,"water":true}]}}
形状shape仅straight(直线)/meander(弯曲)。用户说弯曲/蜿蜒用meander；未说明默认straight。width默认6米，范围1–60；depth默认2米，范围0.1–30。明确数字以riverRequest为准，不要把示例的20和5当默认值。通常只需action/shape/width/depth/water，缺省center/axis/length/bend/level由程序按当前地形计算。
可选center为[X,Z]世界米，中央默认[0,0]；axis默认为z，东西方向用x。length是路径长度，5–600米；bend是弯曲幅度，必须容纳在地形内。level是河面世界高度，不是深度；不指定时使用中心地表高度。不要手写points，不要用terrain.generate重置已有地形；不额外增加water/biome/groundObjects或物体操作。越界或无法确定的请求用{"unsupported":"具体的非空中文原因"}。/no_think`;
