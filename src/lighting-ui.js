import { buildForm, section } from "./ui.js";
import { el } from "./util.js";
import { isLuminaire, lampSettings, LIGHT_BUDGETS } from "./local-lights.js";

export function lightingModeControls(app, rerender) {
  const form = buildForm(
    [
      {
        k: "mode",
        l: "照明模式",
        t: "sel",
        opts: [
          { v: "physical", l: "物理天空 · 太阳 / 大气" },
          { v: "legacy", l: "经典氛围 · 手动 / 棚拍" },
        ],
      },
    ],
    { mode: app.lighting.mode },
    (k, v) => {
      app.beginOp("切换照明模式");
      app.lighting.setMode(v);
      app.saveLocal();
      rerender();
    },
  );
  form.root.dataset.lightingMode = "1";
  return form.root;
}
export function localLightingControls(app) {
  const s = app.localLights.toJSON(),
    g = section("灯具真实照明 / Local lights");
  const form = buildForm(
    [
      { k: "enabled", l: "启用近景真实灯光", t: "bool" },
      {
        k: "quality",
        l: "灯光预算",
        t: "sel",
        opts: Object.entries(LIGHT_BUDGETS).map(([v, b]) => ({
          v,
          l: `${{ low: "低", medium: "中", high: "高" }[v]} · ${b.lights} 光源 / ${b.shadows} 投影`,
        })),
      },
      {
        t: "note",
        l: "路灯、宫灯杆和落地灯可在物体页单独调节。远处保留灯罩自发光；近处按最终渲染相机筛选实际光源。宫灯杆的两盏灯各占一个光源。投影为最近的少量点光源（每盏需渲染 6 面）；预算外不投影，可能漏光。建筑窗灯由独立自发光面板控制，不占真实光源预算；不新增泛光。",
      },
    ],
    s,
    (k, v) => {
      app.beginOp("修改灯具照明预算");
      app.localLights.configure({ [k]: v });
      app.saveLocal();
    },
  );
  form.root.dataset.localLighting = "1";
  g.body.appendChild(form.root);
  return g.wrap;
}
export function physicalLightingControls(app, rerender, ctx) {
  const root = el("div"),
    L = app.lighting,
    P = L.physical,
    s = {
      ...P.settings,
      enabled: L.enabled,
      tex: app.state.tex,
      grid: app.state.grid,
    };
  const apply = (patch) => {
    app.beginOp("修改物理天空");
    P.configure(patch);
    Object.assign(s, P.settings);
    app.saveLocal();
  };
  const presets = section("自然光起点 / Sky");
  presets.body.appendChild(
    el("div", { class: "btnrow" }, [
      ...[
        ["晴天", 48, 135],
        ["暖日落", 4, 270],
        ["蓝调", -4, 275],
        ["无月夜", -14, 275],
      ].map(([name, sunElev, sunAzim]) =>
        el("button", {
          class: "chip",
          type: "button",
          dataset: { skyPreset: name },
          text: name,
          onclick: () => {
            apply({
              source: "manual",
              sunElev,
              sunAzim,
              ev: 0,
              whiteBalance: 6500,
            });
            rerender();
          },
        }),
      ),
    ]),
  );
  presets.body.appendChild(
    el("div", {
      class: "fnote",
      text: "解析大气散射 + 同源天空反射。太阳盘只进入背景，直射由太阳光负责；不重复叠加旧环境补光。夜间是无月暗场，不是完整夜空模型。",
    }),
  );
  root.appendChild(presets.wrap);
  const f = buildForm(
    [
      {
        k: "enabled",
        l: "开启光影",
        t: "bool",
        set: (v) => {
          s.enabled = v;
          app.beginOp("切换光影");
          L.setEnabled(v);
          app.state.perf = !v;
          app.saveLocal();
        },
      },
      {
        k: "source",
        l: "太阳位置",
        t: "sel",
        opts: [
          { v: "manual", l: "手动角度" },
          { v: "date", l: "日期 / 时间 / 经纬度" },
        ],
      },
      {
        k: "sunElev",
        l: "太阳高度 °",
        t: "range",
        min: -90,
        max: 90,
        step: 0.5,
        commit: true,
        when: (x) => x.source === "manual",
      },
      {
        k: "sunAzim",
        l: "太阳方位 °",
        t: "range",
        min: 0,
        max: 360,
        step: 1,
        commit: true,
        when: (x) => x.source === "manual",
        help: "0° 为 +Z 北，90° 为 +X 东",
      },
      {
        k: "date",
        l: "日期 YYYY-MM-DD",
        t: "date",
        when: (x) => x.source === "date",
      },
      {
        k: "hour",
        l: "当地时间 h",
        t: "range",
        min: 0,
        max: 23.99,
        step: 0.05,
        commit: true,
        when: (x) => x.source === "date",
      },
      {
        k: "latitude",
        l: "纬度 °（北为正）",
        t: "range",
        min: -89.9,
        max: 89.9,
        step: 0.01,
        commit: true,
        when: (x) => x.source === "date",
      },
      {
        k: "longitude",
        l: "经度 °（东为正）",
        t: "range",
        min: -180,
        max: 180,
        step: 0.01,
        commit: true,
        when: (x) => x.source === "date",
      },
      {
        k: "timezone",
        l: "UTC 时差 h",
        t: "range",
        min: -12,
        max: 14,
        step: 0.25,
        commit: true,
        when: (x) => x.source === "date",
      },
      {
        k: "north",
        l: "北向旋转 °",
        t: "range",
        min: 0,
        max: 360,
        step: 1,
        commit: true,
        when: (x) => x.source === "date",
      },
      {
        t: "btns",
        l: "地点示例",
        items: [
          {
            l: "新加坡 UTC+8",
            onClick: () => {
              apply({
                source: "date",
                latitude: 1.3521,
                longitude: 103.8198,
                timezone: 8,
              });
              rerender();
            },
          },
          {
            l: "北京 UTC+8",
            onClick: () => {
              apply({
                source: "date",
                latitude: 39.9042,
                longitude: 116.4074,
                timezone: 8,
              });
              rerender();
            },
          },
        ],
      },
      {
        k: "turbidity",
        l: "大气浑浊度",
        t: "range",
        min: 1,
        max: 20,
        step: 0.1,
        commit: true,
      },
      {
        k: "rayleigh",
        l: "瑞利散射",
        t: "range",
        min: 0.1,
        max: 4,
        step: 0.1,
        commit: true,
      },
      {
        k: "mie",
        l: "米氏散射",
        t: "range",
        min: 0.0001,
        max: 0.05,
        step: 0.0001,
        commit: true,
      },
      {
        k: "energy",
        l: "天空 / 直射增益",
        t: "range",
        min: 0,
        max: 4,
        step: 0.05,
        commit: true,
        help: "统一缩放天空和太阳；预演相对亮度，非绝对照度校准",
      },
      {
        k: "environment",
        l: "天空环境反射",
        t: "range",
        min: 0,
        max: 2,
        step: 0.05,
        commit: true,
      },
      {
        k: "ev",
        l: "曝光补偿 EV",
        t: "range",
        min: -6,
        max: 6,
        step: 0.1,
        commit: true,
        help: "每 +1 EV 为 2 倍曝光。机位预览 / 导出只再乘一次 ISO÷400；光圈和快门暂不参与测光。",
      },
      {
        k: "whiteBalance",
        l: "相机白平衡 K",
        t: "range",
        min: 2000,
        max: 12000,
        step: 100,
        commit: true,
        help: "近似色温适应；6500K 中性，较高数值偏暖。只作用于画面，不烘进天空反射。",
      },
      {
        k: "fog",
        l: "距离雾浓度",
        t: "range",
        min: 0,
        max: 0.02,
        step: 0.0002,
        commit: true,
      },
      { k: "shadows", l: "允许投影", t: "bool" },
      {
        k: "quality",
        l: "太阳阴影质量",
        t: "sel",
        opts: [
          { v: "low", l: "低 · 1024²" },
          { v: "medium", l: "中 · 2048²" },
          { v: "high", l: "高 · 2048² / 较大覆盖" },
        ],
      },
      {
        k: "tex",
        l: "全部物品材质显示",
        t: "bool",
        set: (v) => {
          s.tex = v;
          app.setTex(v);
        },
      },
      {
        k: "grid",
        l: "显示网格",
        t: "bool",
        set: (v) => {
          s.grid = v;
          app.state.grid = v;
          app.stage.setGridVisible(v);
        },
      },
    ],
    s,
    (k, v, field) => {
      if (!field.set) {
        apply({ [k]: v });
        f.update();
      }
    },
  );
  f.root.dataset.physicalSky = "1";
  const g = section("太阳 / 大气 / 相机");
  g.body.appendChild(f.root);
  root.appendChild(g.wrap);
  root.appendChild(localLightingControls(app));
  const status = el("div", {
    class: "fnote",
    dataset: { lightingStatus: "1" },
  });
  root.appendChild(status);
  ctx.sync = () => {
    const p = P.position(),
      b = app.localLights.stats || {};
    status.textContent = `太阳高度 ${p.elevation.toFixed(1)}° · 方位 ${p.azimuth.toFixed(1)}° ｜ 实光 ${b.active || 0}/${b.budget || 0} · 灯具投影 ${b.shadows || 0} ｜ 天空反射按需更新，不逐帧烘焙`;
  };
  ctx.sync();
  return root;
}
export function luminaireControls(app, so) {
  if (!isLuminaire(so)) return null;
  const g = section("灯具照明 / Luminaire"),
    s = lampSettings(so),
    f = buildForm(
      [
        {
          k: "mode",
          l: "亮灯方式",
          t: "sel",
          opts: [
            { v: "auto", l: "自动 · 昼灭夜亮" },
            { v: "on", l: "强制开启" },
            { v: "off", l: "强制关闭" },
          ],
        },
        {
          k: "emission",
          l: "灯罩自发光",
          t: "range",
          min: 0,
          max: 8,
          step: 0.1,
          commit: true,
        },
        { k: "illuminate", l: "照亮周围物体", t: "bool" },
        {
          k: "lumens",
          l: "光通量 lm",
          t: "range",
          min: 0,
          max: 10000,
          step: 20,
          commit: true,
          help: "Three.js 光源参数，按平方反比衰减；不是现场测光校准值。宫灯杆按比例分配给两盏灯。",
        },
        {
          k: "range",
          l: "作用半径 m",
          t: "range",
          min: 2,
          max: 60,
          step: 1,
          commit: true,
        },
        { k: "modelColor", l: "沿用模型灯色", t: "bool" },
        {
          k: "temperature",
          l: "光源色温 K",
          t: "range",
          min: 1500,
          max: 10000,
          step: 100,
          commit: true,
          when: (x) => !x.modelColor,
        },
        {
          k: "shadow",
          l: "申请近景投影",
          t: "bool",
          help: "仍受全局投影开关和最近灯光预算限制。",
        },
        {
          t: "note",
          l: "自发光不等于真实照明：关闭「照亮周围物体」仍可保留灯罩亮度。超出相机距离或预算的灯只保留自发光。设置支持工程保存 / 撤销。",
        },
      ],
      s,
      (k, v) => {
        if (app.localLights.setLamp(so, { [k]: v })) {
          Object.assign(s, lampSettings(so));
          f.update();
        }
      },
    );
  f.root.dataset.luminaire = "1";
  if (so.locked)
    f.root
      .querySelectorAll("input,select,button")
      .forEach((e) => (e.disabled = true));
  g.body.appendChild(f.root);
  return g.wrap;
}
