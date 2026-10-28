import { el } from "./util.js";
export function trafficControls(app) {
  const tool = app.traffic,
    root = el("div", { class: "traffic-controls" }),
    inputs = {};
  const enabled = el("input", {
    type: "checkbox",
    dataset: { trafficEnabled: "1" },
    onchange: (e) => tool.configure({ enabled: e.target.checked }),
  });
  root.append(
    el("label", { class: "row" }, [
      enabled,
      el("span", { text: "启用自动交通" }),
    ]),
  );
  for (const [key, label, max] of [
    ["vehicles", "车辆数量", 120],
    ["pedestrians", "行人数量", 80],
  ]) {
    const input = el("input", {
      type: "number",
      class: "num",
      min: 0,
      max,
      step: 1,
      dataset: { trafficCount: key },
      "aria-label": label,
      onchange: (e) => tool.configure({ [key]: e.target.valueAsNumber }),
    });
    inputs[key] = input;
    root.append(
      el("div", { class: "row" }, [
        el("label", { class: "lab", text: label }),
        input,
      ]),
    );
  }
  const signals = el("input", {
    type: "checkbox",
    dataset: { trafficSignals: "1" },
    onchange: (e) => tool.configure({ signals: e.target.checked }),
  });
  root.append(
    el("label", { class: "row" }, [
      signals,
      el("span", { text: "普通同层路口自动信号控制" }),
    ]),
  );
  const play = el("button", {
    class: "fbtn",
    type: "button",
    dataset: { trafficPlay: "1" },
    onclick: () => {
      if (app.state.playing) {
        app.notify("请先暂停时间轴，再播放独立交通预览", "warn");
        return;
      }
      if (!tool.previewMode) tool.previewTime = app.state.time;
      tool.previewMode = true;
      tool.running = !tool.running;
      render();
    },
  });
  const reset = el("button", {
    class: "fbtn alt",
    type: "button",
    text: "重置交通预览",
    dataset: { trafficReset: "1" },
    onclick: () => {
      tool.previewMode = true;
      tool.previewTime = 0;
      tool.sim?.reset();
      tool.renderAt(0);
      render();
    },
  });
  const status = el("div", {
    class: "fnote",
    "aria-live": "polite",
    dataset: { trafficStatus: "1" },
  });
  root.append(
    el("div", { class: "btnrow" }, [play, reset]),
    status,
    el("div", {
      class: "fnote",
      text: "车辆靠右沿车道行驶：高速限速高、匝道低速，合流让行；高速不生成行人，无步道的车道也不放行人。普通路口按红黄绿灯停行，行人使用独立放行相位。预览不改时间轴，正式播放／导出按时间轴重算。道路改线后重新生成交通。车辆可在有接入关系的路口转向；自由端会重新入场，行人沿步道往返。手摆的装饰信号灯不接管自动控制。",
    }),
  );
  function render() {
    enabled.checked = tool.settings.enabled;
    signals.checked = tool.settings.signals;
    for (const [k, v] of Object.entries(inputs))
      if (v !== document.activeElement) v.value = tool.settings[k];
    play.textContent = tool.running ? "暂停交通预览" : "播放交通预览";
    play.disabled = !tool.settings.enabled;
    const agents = tool.sim?.agents || [];
    status.textContent = `车辆 ${agents.filter((a) => a.kind === "car").length} · 行人 ${agents.filter((a) => a.kind === "pedestrian").length} · 信号路口 ${[...(tool.network?.nodes.values() || [])].filter((n) => n.controlled && tool.settings.signals).length}。保存数量／种子与控制规则，不新增成百上千个场景物体。`;
  }
  render();
  const off = app.bus.on("traffic", () => {
    if (!root.isConnected) {
      off();
      return;
    }
    render();
  });
  return root;
}
