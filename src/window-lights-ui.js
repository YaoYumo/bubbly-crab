import { buildForm, section } from "./ui.js";
import { el } from "./util.js";
import { supportsWindows } from "./window-lights.js";
export function windowLightingControls(app, rerender, so = null) {
  if (so && !supportsWindows(so)) return null;
  const service = app.windowLights,
    g = section(so ? "此建筑窗灯" : "夜景窗灯 · 自发光"),
    root = g.wrap;
  root.dataset.windowLighting = so ? "object" : "global";
  const current = () => ({
    ...service.resolved(so || {}),
    mode: so
      ? so.params.windowLighting?.mode || "inherit"
      : service.settings.mode,
  });
  const state = current();
  const form = buildForm(
    [
      {
        k: "mode",
        l: so ? "窗灯覆盖" : "窗灯模式",
        t: "sel",
        opts: [
          ...(so ? [{ v: "inherit", l: "跟随全局" }] : []),
          { v: "legacy", l: "保持原模型（兼容）" },
          { v: "auto", l: "随昼夜自动" },
          { v: "on", l: "常亮" },
          { v: "off", l: "熄灭" },
        ],
      },
      {
        k: "ratio",
        l: "亮灯比例 0–1",
        t: "range",
        min: 0,
        max: 1,
        step: 0.05,
        commit: true,
      },
      {
        k: "seed",
        l: "随机种子",
        t: "int",
        min: 0,
        max: 2147483647,
        step: 1,
        commit: true,
      },
      {
        k: "temperature",
        l: "色温 K",
        t: "range",
        min: 1500,
        max: 10000,
        step: 100,
        commit: true,
      },
      {
        k: "intensity",
        l: "自发光亮度",
        t: "range",
        min: 0,
        max: 8,
        step: 0.1,
        commit: true,
      },
    ],
    state,
    (key, value) => {
      if (so) service.setObject(so, { [key]: value });
      else {
        app.beginOp("修改全局窗灯", "window:" + key);
        service.configure({ [key]: value });
        app.saveLocal();
      }
      seen = null;
      sync();
    },
  );
  // Stable native selectors; labels are accessible even in the compact inspector layout.
  [...form.root.children].forEach((row, i) => {
    const key = ["mode", "ratio", "seed", "temperature", "intensity"][i];
    row.querySelectorAll("input,select").forEach((input) => {
      input.dataset.windowSetting = key;
      input.setAttribute(
        "aria-label",
        row.querySelector("label")?.textContent || key,
      );
    });
  });
  g.body.appendChild(form.root);
  if (!so)
    g.body.appendChild(
      el(
        "div",
        { class: "btnrow" },
        [
          ["日景", 48],
          ["夜景", -12],
        ].map(([label, elevation]) =>
          el("button", {
            class: "fbtn",
            type: "button",
            text: label + " · 天空 + 自动窗灯",
            dataset: { windowDayNight: label },
            onclick: () => {
              app.beginOp("切换" + label);
              service.configure({ mode: "auto" });
              app.lighting.setMode("physical");
              app.lighting.physical.configure({
                source: "manual",
                sunElev: elevation,
              });
              app.saveLocal();
              rerender();
            },
          }),
        ),
      ),
    );
  const status = el("div", { class: "fnote", dataset: { windowStatus: "1" } });
  g.body.appendChild(status);
  g.body.appendChild(
    el("div", {
      class: "fnote",
      text: "只增加窗面自发光，不增加光源、阴影或几何。0–1 是稳定随机亮灯概率，不是精确户数。普通窗按窗组；合批窗在 GPU 按实例分配；城市幕墙 / 窗带用程序化窗格。导入模型、不带兼容标记的窗面和招牌不自动处理。",
    }),
  );
  g.body.appendChild(
    el("div", {
      class: "fnote",
      text: "「保持原模型」完全保留旧外观；「熄灭」只关闭识别窗面的发光。自动模式：物理天空按太阳高度过渡，经典模式跟随夜间辉光。日 / 夜按钮会切换物理天空及手动太阳高度，可一步撤销。不含 Bloom、室内结构或照亮周边；低内存 Basic 模式不显示窗灯。",
    }),
  );
  let seen = null,
    lastStatus = null;
  function sync() {
    const live = current(),
      signature = JSON.stringify([live, so?.locked]);
    if (signature !== seen) {
      seen = signature;
      Object.assign(state, live);
      form.update();
      form.root.querySelectorAll("input,select").forEach((input) => {
        input.disabled =
          !!so?.locked ||
          (!!so &&
            live.mode === "inherit" &&
            input.dataset.windowSetting !== "mode");
      });
    }
    const entry = so ? service.states.get(so.root) : null,
      stats = service.stats;
    const text = so
      ? entry
        ? `独立窗组 ${entry.units || 0} · 程序窗面 ${entry.gpu.length} · 昼夜系数 ${service.factor(entry.settings).toFixed(2)}`
        : "保持原模型；启用覆盖或全局窗灯后按兼容窗面生效。"
      : `当前接管 ${stats.roots} 栋 · 独立窗组 ${stats.units} · 程序窗面 ${stats.procedural}`;
    if (text !== lastStatus) {
      status.textContent = text;
      lastStatus = text;
    }
  }
  sync();
  return { root, sync };
}
