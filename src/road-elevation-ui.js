import * as THREE from "three";
import { el } from "./util.js";
import { buildForm } from "./ui.js";
import { roadElevationPreset } from "./road-elevation.js";

export function roadElevationControls(app, so = null) {
  const rb = app.roadBrush,
    draft = !so,
    rd = so?._roadData;
  const root = el("div", {
    class: "road-elevation-controls",
    dataset: { roadElevation: draft ? "draft" : "saved" },
  });
  const points = () =>
    draft
      ? rb.points.map((p) => p.toArray())
      : rd.ctrl.map((p) => [
          p[0],
          rd.terrainMode === "follow"
            ? (app.roadTerrain.height(rd.curve, p[0], p[2]) ?? p[1])
            : p[1],
          p[2],
        ]);
  const commit = (next) => {
    if (draft) {
      rb.points = next.map((p) => new THREE.Vector3(...p));
      rb.terrainMode = "fixed";
      if (rb.filletOn) rb.syncFillets();
      rb._updatePreview();
      rb._updateLiveRoad();
      app.bus.emit("road-edit");
    } else if (
      !rb.updateRoadProperties(so, { points: next, terrainMode: "fixed" })
    )
      app.notify?.("请先解锁道路，完成或取消当前绘制", "warn");
  };
  root.appendChild(
    el("div", {
      class: "fnote",
      text: "三维道路：每个控制点可独立设置 X / 标高 Y / Z；按住 Shift 拖动圆点调高低，普通拖动只改平面位置。不同标高交叉保持上下分层，同高交叉生成路口。",
    }),
  );
  if (draft) {
    const mode = el(
      "select",
      {
        class: "sel",
        dataset: { roadDraftMode: "1" },
        onchange: (e) => {
          rb.terrainMode = e.target.value;
          if (rb.terrainMode === "fixed") {
            if (!rb.points.length) rb.draftHeight = 8;
          } else
            for (const p of rb.points)
              p.y =
                (app.terrain.enabled ? app.terrain.heightAt(p.x, p.z) : 0) +
                0.02;
          rb._updatePreview();
          rb._updateLiveRoad();
          app.bus.emit("road-edit");
        },
      },
      [
        el("option", { value: "follow", text: "贴地绘制" }),
        el("option", { value: "fixed", text: "固定标高 / 三维路径" }),
      ],
    );
    mode.value = rb.terrainMode || "follow";
    root.appendChild(mode);
    if (!rb.points.length && rb.terrainMode === "fixed")
      root.appendChild(
        el("input", {
          class: "num",
          type: "number",
          step: 0.1,
          value: rb.draftHeight ?? 8,
          "aria-label": "新路标高 m",
          dataset: { roadDraftHeight: "1" },
          onchange: (e) => {
            if (Number.isFinite(e.target.valueAsNumber))
              rb.draftHeight = e.target.valueAsNumber;
          },
        }),
      );
  }
  const ps = points();
  if (ps.length >= 2) {
    const start = el("input", {
      class: "num",
      type: "number",
      step: 0.1,
      value: ps[0][1].toFixed(2),
      "aria-label": "匝道起点标高 m",
      dataset: { roadPresetStart: "1" },
    });
    const end = el("input", {
      class: "num",
      type: "number",
      step: 0.1,
      value: (Math.abs(ps.at(-1)[1] - ps[0][1]) > 0.1
        ? ps.at(-1)[1]
        : ps[0][1] + 8
      ).toFixed(2),
      "aria-label": "高架或匝道终点标高 m",
      dataset: { roadPresetEnd: "1" },
    });
    root.appendChild(
      el("div", { class: "row" }, [
        el("label", { class: "lab", text: "起 / 终标高 m" }),
        el("div", { class: "ctl" }, [start, end]),
      ]),
    );
    const apply = (kind) => {
      const next = roadElevationPreset(
        points(),
        kind,
        kind === "elevated" ? end.valueAsNumber : start.valueAsNumber,
        end.valueAsNumber,
      );
      if (next) commit(next);
      else
        app.notify?.("请输入有效标高，并保留至少两个不同位置的控制点", "warn");
    };
    root.appendChild(
      el("div", { class: "btnrow" }, [
        el("button", {
          class: "fbtn",
          type: "button",
          text: "设为高架（终点标高）",
          disabled: !!so?.locked,
          dataset: { roadPreset: "elevated" },
          onclick: () => apply("elevated"),
        }),
        el("button", {
          class: "fbtn",
          type: "button",
          text: "设为升降匝道",
          disabled: !!so?.locked,
          dataset: { roadPreset: "ramp" },
          onclick: () => apply("ramp"),
        }),
      ]),
    );
  }
  const details = el(
    "details",
    { open: draft, dataset: { roadPointDetails: "1" } },
    [el("summary", { text: `逐点坐标与标高（${ps.length} 点，单位 m）` })],
  );
  const table = el("div", {
    style:
      "max-height:260px;overflow:auto;display:grid;grid-template-columns:24px repeat(3,minmax(0,1fr));gap:4px;padding:6px 0",
  });
  for (const text of ["点", "X", "Y 标高", "Z"])
    table.appendChild(el("span", { class: "stat", text }));
  ps.forEach((p, i) => {
    table.appendChild(el("span", { class: "stat", text: String(i + 1) }));
    ["x", "y", "z"].forEach((axis, k) =>
      table.appendChild(
        el("input", {
          class: "num",
          type: "number",
          step: 0.1,
          value: p[k].toFixed(2),
          disabled: !!so?.locked,
          "aria-label": `控制点 ${i + 1} ${axis.toUpperCase()}`,
          dataset: { roadPoint: String(i), roadAxis: axis },
          onchange: (e) => {
            const value = e.target.valueAsNumber;
            if (!Number.isFinite(value) || Math.abs(value) > 10000) {
              e.target.value = p[k];
              return;
            }
            if (draft) rb.setDraftPoint(i, axis, value);
            else {
              const next = points();
              next[i][k] = value;
              commit(next);
            }
          },
        }),
      ),
    );
  });
  details.appendChild(table);
  root.appendChild(details);
  if (draft)
    root.appendChild(
      el("div", { class: "btnrow" }, [
        el("button", {
          class: "fbtn",
          type: "button",
          text: rb._editBackup ? "完成编辑" : "完成本条道路",
          disabled: ps.length < 2,
          dataset: { roadDraftFinish: "1" },
          onclick: () => {
            rb.finish();
            app.bus.emit("objects");
            app.markDirty?.();
          },
        }),
        el("button", {
          class: "fbtn alt",
          type: "button",
          text: "取消 / 恢复原路",
          dataset: { roadDraftCancel: "1" },
          onclick: () => {
            if (rb._editBackup) rb.cancelEdit();
            else rb.stop();
          },
        }),
      ]),
    );
  if (so?.locked)
    root
      .querySelectorAll("input,select,button")
      .forEach((e) => (e.disabled = true));
  return root;
}

export function roadLightingControls(app, so) {
  const rd = so._roadData;
  const form = buildForm(
    [
      {
        k: "enabled",
        l: "路灯分布",
        t: "bool",
        on: "开启",
        off: "关闭",
        set: (v) => app.roadTerrain.setRoad(so, { streetLights: v }),
      },
      {
        k: "side",
        l: "分布位置",
        t: "sel",
        opts: [
          { v: "both", l: "道路两侧" },
          { v: "left", l: "行进方向左侧" },
          { v: "right", l: "行进方向右侧" },
        ],
        set: (v) => app.roadTerrain.setRoad(so, { lampSide: v }),
      },
      {
        k: "spacing",
        l: "路灯间距 m",
        t: "range",
        commit: true,
        min: 8,
        max: 80,
        step: 2,
        set: (v) => app.roadTerrain.setRoad(so, { lampSpacing: v }),
      },
    ],
    {
      enabled: !!rd.streetLights,
      side: rd.lampSide || "both",
      spacing: rd.lampSpacing || 24,
    },
    () => {},
  );
  form.root.dataset.roadLighting = "1";
  if (so.locked)
    form.root
      .querySelectorAll("input,select,button")
      .forEach((e) => (e.disabled = true));
  form.root.appendChild(
    el("div", {
      class: "fnote",
      dataset: { roadLampCount: "1" },
      text: `附属路灯 ${so.root.userData.roadLampCount || 0} 盏；随道路标高和编辑更新，避开路口及其他路面阻挡。关闭只移除本路附属灯，不动手动摆放的灯。灯面随光影自发光设置变化，不逐盏新增实时点光源。`,
    }),
  );
  return form.root;
}
