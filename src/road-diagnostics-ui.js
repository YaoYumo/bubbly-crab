import { el, downloadBlob } from "./util.js";
const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const kindLabel = {
  grade: "纵坡超过参考值",
  vertical: "垂直区段（纵坡不可定义）",
  terrain: "地形穿入可见路面",
  clearance: "上方道路净空低于参考值",
  support: "桥墩受阻未放置",
};
export function roadDiagnosticControls(app, road) {
  const service = app.roadDiagnostics,
    root = el("details", {
      class: "road-diagnostics",
      dataset: { roadDiagnostics: "1" },
    });
  root.open = service.open;
  root.addEventListener("toggle", () => {
    service.open = root.open;
  });
  root.appendChild(el("summary", { text: "道路检查 · 标高 / 纵坡 / 净空" }));
  root.appendChild(
    el("div", {
      class: "fnote",
      text: "按需采样，不逐帧扫描。标高为道路基准线，非沥青完成面；阈值仅为自设预演参考，不是规范合格判定。",
    }),
  );
  const settings = el("div");
  for (const [key, label, unit, min, max, step] of [
    ["maxGrade", "纵坡参考上限", "%", 0.1, 100, 0.1],
    ["minClearance", "道路净空参考下限", "m", 0, 30, 0.1],
    ["terrainTolerance", "地形穿入容差", "m", 0, 1, 0.01],
  ]) {
    const input = el("input", {
      class: "num",
      type: "number",
      min,
      max,
      step,
      value: service.options[key],
      dataset: { roadDiagnosticSetting: key },
      onchange: () => {
        if (input.value.trim()) service.configure(key, input.valueAsNumber);
        input.value = service.options[key];
        sync();
      },
    });
    settings.appendChild(
      el("div", { class: "row" }, [
        el("label", { class: "lab", text: `${label} ${unit}` }),
        el("div", { class: "ctl" }, [input]),
      ]),
    );
  }
  root.appendChild(settings);
  const status = el("div", {
      class: "fnote",
      dataset: { roadDiagnosticStatus: "1" },
      role: "status",
      "aria-live": "polite",
    }),
    output = el("div", { dataset: { roadDiagnosticResult: "1" } });
  let request = null,
    shown = null,
    staleShown = null;
  const run = el("button", {
    class: "fbtn",
    type: "button",
    text: "运行检查",
    dataset: { roadDiagnosticRun: "1" },
    onclick: async () => {
      const own = {};
      request = own;
      run.disabled = true;
      cancel.disabled = false;
      status.textContent = "准备检查…";
      try {
        await service.inspect(app.byId(road.id), (text) => {
          if (request === own) status.textContent = text;
        });
        if (request === own) {
          shown = null;
          sync();
        }
      } catch (e) {
        if (request === own)
          status.textContent =
            e.name === "AbortError"
              ? "检查已取消或场景已变化，请重新运行。"
              : "检查未完成：" + e.message;
      } finally {
        if (request === own) {
          request = null;
          run.disabled = false;
          cancel.disabled = true;
        }
      }
    },
  });
  const cancel = el("button", {
    class: "fbtn",
    type: "button",
    text: "取消",
    disabled: true,
    dataset: { roadDiagnosticCancel: "1" },
    onclick: () => {
      service.cancel();
      request = null;
      run.disabled = false;
      cancel.disabled = true;
      status.textContent = "检查已取消，未修改场景。";
    },
  });
  root.append(el("div", { class: "btnrow" }, [run, cancel]), status, output);
  function sync() {
    const report = service.reports.get(road.id),
      stale = report && report.revision !== service.revision;
    if (shown === report && staleShown === stale) return;
    shown = report;
    staleShown = stale;
    output.replaceChildren();
    if (!report) {
      if (!request)
        status.textContent = "尚未检查。修改道路或地形后，需重新运行。";
      return;
    }
    status.textContent = stale
      ? "结果已过期：场景或阈值已改变，请重新检查。"
      : `检查完成 · ${report.samples.length} 个纵向采样站 · ${report.coverage} 个有效路面采样点`;
    const s = report.summary;
    output.appendChild(
      el("div", {
        class: "fnote",
        dataset: { roadDiagnosticSummary: "1" },
        text: [
          `记录于 ${new Date(report.at).toLocaleTimeString()} · 参考阈值：纵坡 ${report.options.maxGrade}% / 净空 ${report.options.minClearance}m / 穿入 ${report.options.terrainTolerance}m`,
          `水平长度 ${n(s.length)} m · 三维长度 ${n(s.length3D)} m`,
          `基准标高 ${n(s.minY)} ～ ${n(s.maxY)} m · 最大绝对纵坡 ${s.verticalSegments ? "含垂直区段；其它区段 " : ""}${n(s.maxGrade)}%`,
          report.terrainEnabled
            ? s.maxIntrusion == null
              ? "没有范围内有效地形采样，不能判断穿入"
              : `最大采样穿入 ${n(Math.max(0, s.maxIntrusion))} m`
            : "地形未启用：不检查地形穿入",
          `不同道路之间最小采样净空 ${n(s.minClearance)} m（— 表示未采到不同标高的上方道路）`,
          `桥墩 ${s.builtSupports} 处 · 受阻 ${s.blockedSupports} 处`,
          s.terrainOutside
            ? `有 ${s.terrainOutside} 个有效路面采样点位于地形范围外，未检查穿入。`
            : "",
          !report.coverage ? "未采到路面，不能据此判断无问题。" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    );
    if (report.previous) {
      const before = report.previous.summary;
      output.appendChild(
        el("div", {
          class: "fnote",
          dataset: { roadDiagnosticComparison: "1" },
          text: `与上次检查比较（也可能包含阈值 / 采样差异）\n水平长度变化 ${n(s.length - before.length)} m · 三维长度变化 ${n(s.length3D - before.length3D)} m
基准标高最小 / 最大变化 ${n(s.minY - before.minY)} / ${n(s.maxY - before.maxY)} m
最大采样穿入变化 ${s.maxIntrusion != null && before.maxIntrusion != null ? n(Math.max(0, s.maxIntrusion) - Math.max(0, before.maxIntrusion)) + " m" : "—"}
最大纵坡变化 ${n(s.maxGrade - before.maxGrade)} 个百分点\n最小净空变化 ${s.minClearance != null && before.minClearance != null ? n(s.minClearance - before.minClearance) + " m" : "—（两次均采到上方道路时才比较）"}
已建 / 受阻桥墩数量变化 ${s.builtSupports - before.builtSupports} / ${s.blockedSupports - before.blockedSupports}`,
        }),
      );
    }
    const samples = report.samples,
      width = 320,
      height = 110,
      pad = 9,
      ys = samples.flatMap((p) => [p.y, p.ground].filter(Number.isFinite)),
      low = Math.min(...ys),
      high = Math.max(...ys),
      range = Math.max(1, high - low);
    const path = (key) => {
      let started = false;
      return samples
        .map((p) => {
          if (!Number.isFinite(p[key])) {
            started = false;
            return "";
          }
          const move = started ? "L" : "M";
          started = true;
          return `${move}${n(pad + (p.s / Math.max(0.001, s.length)) * (width - pad * 2))},${n(height - pad - ((p[key] - low) / range) * (height - pad * 2))}`;
        })
        .join(" ");
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "道路基准标高和中心地形剖面，横轴为水平里程",
    );
    svg.style.cssText =
      "width:100%;height:110px;background:rgba(127,127,127,.08);border-radius:5px";
    for (const [key, color] of [
      ["ground", "#8e9d63"],
      ["y", "#58a9ee"],
    ]) {
      const p = document.createElementNS(svg.namespaceURI, "path");
      p.setAttribute("d", path(key));
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", "1.5");
      svg.appendChild(p);
    }
    output.append(
      svg,
      el("div", {
        class: "fnote",
        text: "蓝：道路基准线 · 绿：中心地形。横轴水平里程；纵向已自动缩放，不表示真实坡度角。",
      }),
    );
    const sampleText = el("div", {
        class: "fnote",
        dataset: { roadDiagnosticSample: "1" },
      }),
      slider = el("input", {
        class: "rng",
        type: "range",
        min: 0,
        max: samples.length - 1,
        step: 1,
        value: 0,
        "aria-label": "选择沿线采样站",
        dataset: { roadDiagnosticStation: "1" },
      });
    function select() {
      const p = samples[Number(slider.value)];
      sampleText.textContent = `里程 ${n(p.s)} m · 基准标高 ${n(p.y)} m · 纵坡 ${n(p.grade)}% · 中心地形 ${n(p.ground)} m · 横断面最小净空 ${n(p.clearance)} m`;
    }
    slider.addEventListener("input", select);
    select();
    output.append(
      slider,
      sampleText,
      el("button", {
        class: "fbtn",
        type: "button",
        text: "定位当前采样站",
        disabled: stale,
        dataset: { roadDiagnosticFocus: "sample" },
        onclick: () => {
          if (!service.focus(report, samples[Number(slider.value)].point))
            status.textContent = "结果已过期，请重新检查。";
        },
      }),
    );
    const list = el("div", {
      class: "road-diagnostic-issues",
      dataset: { roadDiagnosticIssues: "1" },
    });
    const count = report.issues.length;
    list.appendChild(
      el("div", {
        class: "fnote",
        text: count
          ? `发现 ${count} 个记录区段${report.omittedIssues ? `，另有 ${report.omittedIssues} 段超出记录上限` : ""}。每页最多 40 条；同类连续采样已合并。`
          : "当前采样未发现超出参考值的问题，不代表全线无问题或满足规范。",
      }),
    );
    let page = 0;
    const rows = el("div"),
      pager = el("div", { class: "btnrow" });
    function showPage() {
      rows.replaceChildren();
      for (const issue of report.issues.slice(page * 40, page * 40 + 40)) {
        const owner = issue.otherId ? app.byId(issue.otherId) : null;
        const text = `${kindLabel[issue.kind]} · ${n(issue.s, 1)}～${n(issue.endS, 1)} m${issue.value == null ? "" : ` · ${n(issue.value)}${issue.kind === "grade" ? "%" : " m"}`}${owner ? " · 上方 " + owner.name : ""}`;
        rows.appendChild(
          el("button", {
            class: "fbtn wide",
            type: "button",
            text,
            disabled: stale,
            dataset: { roadDiagnosticIssue: issue.kind },
            onclick: () => {
              if (!service.focus(report, issue.point))
                status.textContent = "结果已过期，请重新检查。";
            },
          }),
        );
      }
      pager.replaceChildren();
      if (count > 40) {
        pager.append(
          el("button", {
            class: "fbtn",
            type: "button",
            text: "上一页",
            disabled: page === 0,
            onclick: () => {
              page--;
              showPage();
            },
          }),
          el("span", {
            class: "fnote",
            text: `${page + 1}/${Math.ceil(count / 40)}`,
          }),
          el("button", {
            class: "fbtn",
            type: "button",
            text: "下一页",
            disabled: (page + 1) * 40 >= count,
            onclick: () => {
              page++;
              showPage();
            },
          }),
        );
      }
    }
    list.append(rows, pager);
    showPage();
    output.appendChild(list);
    output.append(
      el("button", {
        class: "fbtn",
        type: "button",
        text: "导出本次检查 JSON",
        onclick: () =>
          downloadBlob(
            new Blob(
              [
                JSON.stringify(
                  { ...report, stale: report.revision !== service.revision },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            ),
            "road-diagnostics.json",
          ),
      }),
      el("div", {
        class: "fnote",
        text: "首版范围：最多 1025 站 × 9 横向点；净空取其它道路真实几何下表面，排除桥墩。含实际路口铺装；无实际路面处不测。高差至少 0.8m 才视作不同标高的上方道路；横断面含步道侧带，不等同于车道净空。不含同一道路自跨、建筑 / 管线 / 车辆净空。极端缩放 / 旋转、多层自交不作完整保证；细小障碍和采样间地形峰可能漏检。隐藏的其它道路 / 路口不计入检查。阈值、报告和定位标记仅属本次会话，不写入工程。",
      }),
    );
  }
  sync();
  return { root, sync };
}
