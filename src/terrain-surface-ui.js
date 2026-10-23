import { buildForm, section } from "./ui.js";
import { el } from "./util.js";
export function terrainSurfaceControls(app) {
  const tr = app.terrain,
    g = section("自动地貌底材 / Auto surface");
  const f = buildForm(
    [
      { k: "enabled", l: "按高度 / 坡度自动着色", t: "bool" },
      {
        k: "rockSlope",
        l: "裸岩坡度 °",
        t: "range",
        min: 10,
        max: 70,
        step: 1,
        commit: true,
      },
      {
        k: "slopeBlend",
        l: "坡度过渡 ±°",
        t: "range",
        min: 1,
        max: 20,
        step: 1,
        commit: true,
      },
      {
        k: "snowLine",
        l: "雪线标高 m",
        t: "range",
        min: -50,
        max: 300,
        step: 1,
        commit: true,
      },
      {
        k: "snowBlend",
        l: "雪线过渡 ±m",
        t: "range",
        min: 0.5,
        max: 40,
        step: 0.5,
        commit: true,
      },
      {
        k: "shoreWidth",
        l: "岸带水平宽度 m",
        t: "range",
        min: 0.5,
        max: 30,
        step: 0.5,
        commit: true,
      },
      {
        t: "note",
        l: "自动底材与手绘覆盖分开：山形 / 水位改变时自动重算，Shift 擦除手绘后露出当前底材。沙漠、焦土、异星不自动降雪；雪原自带低地积雪。岸带需要实际水面和邻近水下网格，不是整张图按海拔涂沙。雪线为世界标高，坡度包含格距与高度夸张。",
      },
    ],
    { ...tr.autoSurface },
    (k, v) => {
      app.beginOp("自动地貌：" + k);
      tr.setAutoSurface({ [k]: v });
    },
  );
  f.root.dataset.terrainAutoSurface = "1";
  g.body.appendChild(f.root);
  g.body.appendChild(
    el("button", {
      type: "button",
      class: "fbtn wide",
      dataset: { terrainRecolor: "1" },
      text: "重新计算底材（保留手绘）",
      onclick: () => {
        if (!tr.autoSurface.enabled) app.beginOp("启用自动地貌");
        tr.setAutoSurface({ enabled: true });
        app.bus.emit("select");
      },
    }),
  );
  return g.wrap;
}
