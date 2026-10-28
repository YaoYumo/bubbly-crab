import { el, downloadBlob } from "./util.js";
export function layoutMaintenanceControls(app) {
  const service = app.layout;
  const root = el("details", {
    class: "layout-maintenance",
    dataset: { layoutMaintenance: "1" },
  });
  root.append(el("summary", { text: "场景检查 / 部件联动" }));
  root.addEventListener("toggle", () => (service.open = root.open));
  root.open = service.open;
  const note = el("p", {
    class: "fnote",
    text: "按需检查，不逐帧扫描。可见静态库资产的AABB重叠和关键点折线仅提示风险，不是精确碰撞或导航。AI关系只诊断；挂接部件可同步。",
  });
  const status = el("p", {
    class: "fnote",
    role: "status",
    "aria-live": "polite",
    dataset: { layoutStatus: "1" },
  });
  const actionStatus = el("p", {
    class: "fnote",
    role: "status",
    dataset: { layoutActionStatus: "1" },
  });
  const issues = el("div", {
    dataset: { layoutIssues: "1" },
    style: "max-height:220px;overflow:auto",
  });
  let shown = null,
    lastSelection = null;
  const act = (fn) => {
    try {
      const result = fn();
      actionStatus.textContent =
        typeof result === "string" ? result : "操作完成。";
    } catch (e) {
      actionStatus.textContent = "未完成：" + e.message;
    }
  };
  const button = (text, action, fn) =>
    el("button", {
      class: "fbtn",
      type: "button",
      text,
      dataset: { layoutAction: action },
      onclick: () => act(fn),
    });
  const run = button("运行场景检查", "inspect", () => {
    const r = service.inspect();
    return `已完成检查：${r.issues.length}项提示${r.complete ? "" : "（预算内部分检查）"}。`;
  });
  const syncSelected = button("同步选中组合", "sync-selected", () => {
    const id = app.selObj?.id;
    if (!id) throw Error("请先选择宿主或部件");
    if (
      !confirm(
        "按当前宿主重新计算所选组合及其下游部件的位置、朝向和缩放；不会移动宿主、修复AI关系或自动找空位。可一步撤销。继续？",
      )
    )
      return "已取消。";
    return `已同步 ${service.sync(id)} 个部件。`;
  });
  const syncAll = button("同步全部挂接", "sync-all", () => {
    if (
      !confirm(
        "将同步所有已建立的挂接部件；遇到无效引用、锁定部件或保护碰撞会整批拒绝，不部分提交。可一步撤销。继续？",
      )
    )
      return "已取消。";
    return `已同步 ${service.sync()} 个部件。`;
  });
  const exportReport = button("导出检查摘要", "export", () => {
    if (!service.report) throw Error("请先运行检查");
    downloadBlob(
      new Blob([JSON.stringify(service.report, null, 2)], {
        type: "application/json",
      }),
      "scene-layout-check.json",
    );
    return "已导出，摘要含过期和预算状态。";
  });
  const clear = button("清除AI关系记录", "clear-relations", () => {
    if (confirm("只清除保存的AI关系诊断记录，不移动或删除对象。可撤销。继续？"))
      service.clearRelations();
  });
  const selection = el("p", {
    class: "fnote",
    dataset: { layoutSelection: "1" },
  });
  const host = el("select", {
    class: "sel",
    dataset: { layoutHost: "1" },
    "aria-label": "挂接宿主",
  });
  const follow = el("input", {
    type: "checkbox",
    dataset: { layoutFollow: "1" },
    onchange: () => {
      act(() => {
        const id = app.selObj?.id;
        service.setFollow(id, follow.checked);
        return "编辑后联动开关已更新；不立即移动部件。";
      });
      syncSelection();
    },
  });
  const bind = button("按当前位置建立挂接", "bind", () => {
    const child = app.selObj;
    if (!child || !host.value) throw Error("请选择部件和宿主");
    if (
      !confirm(
        "将选中对象作为部件，按当前位置建立宿主局部挂接，并关闭部件的地形跟随。默认不自动联动，可撤销。继续？",
      )
    )
      return "已取消。";
    service.bind(child.id, host.value);
    return "挂接已建立，位置未改变；可手动同步或明确开启编辑后联动。";
  });
  const detach = button("解除选中挂接", "detach", () => {
    service.detach(app.selObj?.id);
    return "挂接已解除，位置未改变。";
  });
  const controls = el("div", {}, [
    selection,
    host,
    el("div", { class: "btnrow" }, [bind, detach]),
    el("label", { class: "fnote" }, [
      follow,
      document.createTextNode(" 宿主编辑完成后联动（非播放rig，默认关闭）"),
    ]),
  ]);
  root.append(
    note,
    el("div", { class: "btnrow" }, [run, syncSelected, syncAll]),
    status,
    issues,
    el("details", {}, [
      el("summary", { text: "建立 / 管理挂接" }),
      controls,
      el("p", {
        class: "fnote",
        text: "只支持静态库资产、Y轴旋转和宿主等比缩放。组合件锚点随参数深度更新，不重塑部件或重排窗格。拖拽结束、变换面板、单个宿主参数重建可触发已启用的联动。",
      }),
    ]),
    el("div", { class: "btnrow" }, [exportReport, clear]),
    actionStatus,
  );
  function syncStatus() {
    const r = service.report;
    status.textContent = !r
      ? "尚未检查；编辑后请运行检查。"
      : `${r.stale ? "已过期 · 请重新检查" : "当前检查"} · ${r.objects}场景对象 / ${r.staticObjects}静态库候选 / ${r.bindings}挂接 · ${r.issues.length}项提示${r.issuesCapped ? "（最多200项）" : ""}${r.complete ? "" : " · 检查不完整"}`;
    exportReport.disabled = !r;
    clear.disabled = !app.layoutRelations;
    syncSelected.disabled = !app.selObj;
    if (r !== shown) {
      shown = r;
      issues.replaceChildren();
      for (const item of r?.issues || []) {
        const row = el("div", { class: "fnote" }, [
          el("span", { text: `${item.code} · ${item.message} ` }),
        ]);
        if (item.subject && app.byId(item.subject))
          row.append(
            button("定位", "focus", () => {
              const o = app.byId(item.subject);
              if (o) {
                app.select({ kind: "obj", so: o });
                app.focusSelected();
              }
              return "已定位报告中的对象；不会移动它。";
            }),
          );
        issues.append(row);
      }
    }
  }
  let optionsKey = "";
  function syncSelection() {
    const o = app.selObj,
      changed = lastSelection !== o?.id;
    lastSelection = o?.id;
    const candidates = app.objects.filter(
      (x) =>
        x.item &&
        x.type !== "fx" &&
        !x.key?.startsWith("char:") &&
        x.id !== o?.id &&
        !x.motion?.active,
    );
    const key = JSON.stringify([o?.id, candidates.map((x) => [x.id, x.name])]);
    if (key !== optionsKey) {
      const value = host.value;
      optionsKey = key;
      host.replaceChildren(
        el("option", { value: "", text: "选择宿主（锁定对象也可作只读宿主）" }),
        ...candidates.map((x) =>
          el("option", {
            value: x.id,
            text: x.name + (x.locked ? " · 锁定" : ""),
          }),
        ),
      );
      if (!changed && candidates.some((x) => x.id === value))
        host.value = value;
    }
    const b = o?.params?.sceneAttachment;
    selection.textContent = o
      ? `选中：${o.name}${b ? " · 宿主 " + b.hostId : " · 尚无挂接记录"}`
      : "请选择部件；绑定时保持当前局部偏移。";
    if (b?.hostId) host.value = b.hostId;
    bind.disabled =
      !o?.item ||
      o.type === "fx" ||
      !!o.key?.startsWith("char:") ||
      !!o.locked ||
      !!o.motion?.active;
    detach.disabled = o?.params?.sceneAttachment === undefined || !!o?.locked;
    follow.disabled = !b || !!o?.locked;
    follow.checked = !!b?.follow;
    syncStatus();
  }
  app.bus.on("layout-diagnostics", syncStatus);
  app.bus.on("select", syncSelection);
  app.bus.on("objects", syncSelection);
  syncSelection();
  return root;
}
