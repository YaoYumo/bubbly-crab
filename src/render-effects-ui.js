import { buildForm, section } from "./ui.js";
import { el } from "./util.js";
export function renderEffectsControls(app) {
  const root = el("div", { dataset: { renderEffects: "1" } }),
    effects = app.renderEffects;
  const make = (kind, title, fields, note) => {
    const group = section(title),
      state = { ...(kind === "lod" ? effects.lod.settings : effects.bloom) };
    const form = buildForm(fields, state, (key, value) => {
      app.beginOp("修改 " + title, "render:" + kind + ":" + key);
      effects.configure({ [kind]: { [key]: value } });
      Object.assign(
        state,
        kind === "lod" ? effects.lod.settings : effects.bloom,
      );
      form.update();
      form.root
        .querySelectorAll("button[data-render-setting]")
        .forEach((button) =>
          button.setAttribute("aria-pressed", String(state[button.dataset.renderSetting.split(".").at(-1)])),
        );
      app.saveLocal();
    });
    [...form.root.children].forEach((row, i) =>
      row.querySelectorAll("input,select,button").forEach((input) => {
        input.dataset.renderSetting = kind + "." + fields[i].k;
        input.setAttribute("aria-label", fields[i].l);
        if (fields[i].t === "bool")
          input.setAttribute("aria-pressed", String(state[fields[i].k]));
      }),
    );
    group.body.append(form.root, el("p", { class: "fnote", text: note }));
    root.append(group.wrap);
  };
  make(
    "lod",
    "远景 LOD · 建筑细节",
    [
      { k: "enabled", l: "启用远景 LOD", t: "bool", on: "近景保留，远景简化" },
      {
        k: "near",
        l: "中景距离 m",
        t: "range",
        min: 20,
        max: 1000,
        step: 10,
        commit: true,
      },
      {
        k: "far",
        l: "远景距离 m",
        t: "range",
        min: 26,
        max: 3000,
        step: 10,
        commit: true,
      },
      {
        k: "pixels",
        l: "远景细节阈值 px",
        t: "range",
        min: 0.25,
        max: 4,
        step: 0.25,
        commit: true,
      },
    ],
    "默认关闭以兼容旧工程。仅静态库建筑；选中物体恢复全精度。简化可能改变远景轮廓 / 阴影；不隐藏整栋，不替换拾取和存档模型。",
  );
  make(
    "bloom",
    "Bloom · 泛光范围",
    [
      { k: "enabled", l: "启用 Bloom", t: "bool", on: "增加高亮光晕" },
      { k: "mode", l: "泛光来源", t: "sel", opts: [
        { v: "all", l: "全屏高亮（兼容旧工程）" },
        { v: "selective", l: "选择性 · 窗灯与指定表面" },
      ] },
      { k: "windows", l: "自动纳入库建筑窗面", t: "bool", on: "仅选择性模式；仍需窗灯发亮" },
      {
        k: "strength",
        l: "泛光强度",
        t: "range",
        min: 0,
        max: 2,
        step: 0.05,
        commit: true,
      },
      {
        k: "radius",
        l: "扩散半径",
        t: "range",
        min: 0,
        max: 1,
        step: 0.05,
        commit: true,
      },
      {
        k: "threshold",
        l: "HDR 高亮阈值",
        t: "range",
        min: 0,
        max: 10,
        step: 0.1,
        commit: true,
      },
      {
        k: "quality",
        l: "泛光精度",
        t: "sel",
        opts: [
          { v: "low", l: "低 · 1/4 输入" },
          { v: "medium", l: "中 · 1/2 输入" },
          { v: "high", l: "高 · 标准输入" },
        ],
      },
    ],
    "默认关闭；夜景建议从强度 0.35 / 阈值 1.1 起调。旧工程保持全屏模式。选择性模式只提取库窗面与物体页指定表面的光源内容，天空与亮反射不作为来源；不会照亮周围。另需一次带遮挡的场景绘制和 HDR 目标，增加 CPU / GPU 成本；低内存模式暂停。",
  );
  return root;
}
