import { el } from "./util.js";
import { sceneResources } from "./performance-monitor.js";
const mib = (n) =>
  Number.isFinite(n) ? (n / 1048576).toFixed(1) + " MiB" : "不可读";
export function installPerformanceHud(app) {
  const root = el("aside", {
    class: "performance-hud",
    dataset: { performanceHud: "1" },
    "aria-label": "视窗性能信息",
  });
  const text = el("pre", {}),
    close = el("button", {
      type: "button",
      text: "×",
      title: "关闭性能浮层",
      onclick: () => hud.setEnabled(false),
    }),
    details = el("button", {
      type: "button",
      text: "详情",
      onclick: () => app.openPerformance?.(),
    });
  root.append(
    el("div", { class: "performance-hud-head" }, [
      el("b", { text: "性能 · 当前视窗" }),
      details,
      close,
    ]),
    text,
  );
  app.stage.host.append(root);
  let lastResources = 0,
    resources = null,
    lastSequence = -1,
    lastFrameAt = performance.now();
  const hud = {
    enabled: !!app.state.perf,
    setEnabled(on) {
      this.enabled = !!on;
      root.hidden = !this.enabled;
      this.update(true);
    },
    update(force = false) {
      root.hidden = !this.enabled;
      if (!this.enabled) return;
      const monitor = app.performance,
        now = performance.now();
      if (now - lastResources > 2000 || !resources || force) {
        resources = sceneResources(app.stage.scene);
        lastResources = now;
      }
      if (monitor.sequence !== lastSequence) {
        lastSequence = monitor.sequence;
        lastFrameAt = now;
      }
      const frames = monitor.frames.slice(-60),
        intervals = frames
          .map((f) => f.intervalMs)
          .filter((n) => Number.isFinite(n) && n > 0),
        mean = intervals.reduce((a, b) => a + b, 0) / intervals.length,
        last = frames.at(-1);
      const active =
        monitor.enabled && !app.suspended && now - lastFrameAt < 2000;
      text.textContent = [
        `FPS ${active && mean ? (1000 / mean).toFixed(1) : "暂停 / 未采样"}   帧间隔 ${active && mean ? mean.toFixed(1) + " ms" : "—"}`,
        `GPU ${monitor.gpu.ms != null ? monitor.gpu.ms.toFixed(2) + " ms" : "计时不可读"}`,
        `Draw ${last?.calls ?? "—"}   三角面 ${last?.triangles?.toLocaleString() ?? "—"}`,
        `JS 堆 ${mib(performance.memory?.usedJSHeapSize)}`,
        `显存资源估算 ${mib(resources.attributeBytes + resources.textureBytesEstimate)}`,
        `几何 ${resources.geometries}  纹理 ${resources.textures}  实例 ${resources.instances}`,
        `总内存 / 总显存：浏览器不可读`,
        `估算不含驱动、渲染目标及其他程序`,
      ].join("\n");
    },
  };
  app.performanceHud = hud;
  app.bus.on("perf", (on) => hud.setEnabled(on));
  setInterval(() => hud.update(), 500);
  hud.setEnabled(hud.enabled);
  return hud;
}
