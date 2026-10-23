import { el, downloadBlob } from "./util.js";
import { runBenchmarks } from "./performance-benchmarks.js";
const ms = (v) => (Number.isFinite(v) ? v.toFixed(2) + " ms" : "—");
const mb = (v) =>
  Number.isFinite(v) ? (v / 1048576).toFixed(1) + " MiB" : "—";
const exportJson = (value, name) =>
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    name,
  );
export function benchmarkURL() {
  const url = new URL(location.href);
  url.searchParams.set("fresh", "1");
  url.searchParams.set("benchmark", "1");
  url.searchParams.delete("scene");
  url.hash = "";
  return url.href;
}
export function installPerformanceUI(app, toolbar, tbtn) {
  app.runPerformanceBenchmarks = (options) => runBenchmarks(app, options);
  let currentDialog = null;
  const open = () => {
    if (currentDialog?.open) return;
    const dialog = el("dialog", {
      class: "performance-dialog",
      dataset: { performanceDialog: "1" },
    });
    currentDialog = dialog;
    const heading = el("h2", {
        text: app.benchmarkMode ? "独立性能基准" : "性能诊断",
      }),
      metrics = el("pre", {
        class: "performance-metrics",
        dataset: { performanceMetrics: "1" },
      }),
      operations = el("pre", { class: "performance-operations" }),
      buttons = el("div", { class: "btnrow" });
    const close = el("button", {
      type: "button",
      class: "fbtn",
      text: "关闭",
      onclick: () => dialog.close(),
    });
    const pause = el("button", {
      type: "button",
      class: "fbtn",
      text: "暂停采样",
      onclick: () => {
        app.performance.enabled = !app.performance.enabled;
        app.performance.pauseFrames();
        pause.textContent = app.performance.enabled ? "暂停采样" : "继续采样";
        update();
      },
    });
    buttons.append(
      pause,
      el("button", {
        type: "button",
        class: "fbtn",
        text: "测一帧绘制归因",
        dataset: { drawAttribution: "1" },
        onclick: () => {
          app.performance.requestDrawAttribution();
          pause.textContent = "暂停采样";
        },
      }),
      el("button", {
        type: "button",
        class: "fbtn",
        text: "重置统计",
        onclick: () => {
          app.performance.reset();
          update();
        },
      }),
      el("button", {
        type: "button",
        class: "fbtn",
        dataset: { performanceExport: "1" },
        text: "导出诊断 JSON",
        onclick: () =>
          exportJson(
            {
              hardware: app.performance.hardware(),
              ...app.performance.snapshot(),
              notes: [
                "帧间隔包含调度 / 主线程阻塞，JS 提交包含驱动等待。",
                "操作计时包含子调用，不可相加；异步操作包含等待。",
                "属性 / 纹理字节是场景引用估算，非显存实测，未覆盖全部离屏目标、缓存及驱动开销。",
                "JS heap 是浏览器提供的估算，并非本项目独占内存。",
              ],
            },
            "previz-performance.json",
          ),
      }),
      close,
    );
    const pickToggle = el("button", {
      type: "button",
      class: "fbtn",
      dataset: { pickIndexToggle: "1" },
      onclick: () => {
        app.stage.pickIndex.enabled = !app.stage.pickIndex.enabled;
        app.stage.pickIndex.invalidate("toggle");
        update();
      },
    });
    buttons.appendChild(pickToggle);
    dialog.append(
      heading,
      buttons,
      metrics,
      el("p", {
        class: "fnote",
        text: "最近 240 帧：实际 RAF 间隔与动画步长分开统计；绘制调用累计一帧的阴影 / 后处理通道。GPU 计时仅浏览器扩展可用时显示。资源引用估算不等于显存，缓存未归零不一定是泄漏。",
      }),
      operations,
    );
    const benchmark = el("section", { class: "performance-benchmark" }),
      status = el("p", {
        dataset: { benchmarkStatus: "1" },
        text: "基准：普通小镇、密集城区、起伏地形＋植被、夜景多灯。固定种子与 960×540 / DPR 1 / 均衡模型精度。结果只代表当前设备，不保证其他设备 FPS。",
      });
    benchmark.append(el("h3", { text: "固定场景基准" }), status);
    dialog.append(benchmark);
    let controller = null;
    if (!app.benchmarkMode) {
      benchmark.append(
        el("a", {
          class: "fbtn",
          href: benchmarkURL(),
          target: "_blank",
          rel: "noopener",
          dataset: { benchmarkLaunch: "1" },
          text: "打开独立基准标签页（不修改当前工程）",
        }),
      );
    } else {
      benchmark.append(
        el("p", {
          class: "fnote",
          text: "此标签页是测试工作区，自动存档已禁用，不会覆盖原工程。每组先测冷帧，再预热 8 帧、采样 30 帧；分帧建造可取消。同步构建 / 压缩中的取消会在下一个可让出点生效。请保持此标签页前台；关闭或进入后台会使本轮数据不完整。",
        }),
      );
      const result = el("pre", { dataset: { benchmarkResult: "1" } }),
        cancel = el("button", {
          type: "button",
          class: "fbtn",
          text: "取消基准",
          disabled: true,
          onclick: () => {
            controller?.abort();
            status.textContent = "正在取消，等待当前任务让出主线程…";
          },
        });
      const start = el("button", {
        type: "button",
        class: "fbtn",
        dataset: { benchmarkRun: "1" },
        text: "运行 4 组固定基准",
        onclick: async () => {
          controller = new AbortController();
          start.disabled = true;
          cancel.disabled = false;
          close.disabled = true;
          for (const button of buttons.querySelectorAll("button"))
            button.disabled = true;
          result.textContent = "";
          try {
            const report = await app.runPerformanceBenchmarks({
              signal: controller.signal,
              onProgress: (p) => {
                status.textContent = `${p.name} · ${p.phase}${p.total ? ` ${p.done}/${p.total}` : ""}`;
              },
            });
            status.textContent = report.cancelled
              ? "已取消；保留已完成场景的报告"
              : report.error
                ? "未完成：" + report.error
                : "基准完成（未改动原工程）";
            result.textContent = report.fixtures
              .map(
                (row) =>
                  `${row.fixture.name}\n  构建 ${ms(row.buildMs)} · 冷帧提交 ${ms(row.cold.submitMs)}\n  预热后提交 p50 / p95 ${ms(row.submit.p50)} / ${ms(row.submit.p95)}\n  RAF p95 ${ms(row.interval.p95)} · 绘制 ${row.calls.mean?.toFixed(0)} · 三角形 ${row.triangles.mean?.toFixed(0)}\n  打包 ${ms(row.packMs)} · 恢复 ${ms(row.restoreMs)}${row.terrainEditMs != null ? " · 改地形 " + ms(row.terrainEditMs) : ""}`,
              )
              .join("\n\n");
          } catch (error) {
            status.textContent = "测试失败：" + error.message;
          } finally {
            start.disabled = false;
            cancel.disabled = true;
            close.disabled = false;
            for (const button of buttons.querySelectorAll("button"))
              button.disabled = false;
            controller = null;
            update();
          }
        },
      });
      benchmark.append(
        el("div", { class: "btnrow" }, [
          start,
          cancel,
          el("button", {
            type: "button",
            class: "fbtn",
            text: "导出基准报告 JSON",
            onclick: () => {
              if (app._benchmarkReport)
                exportJson(app._benchmarkReport, "previz-benchmarks.json");
              else status.textContent = "请先运行基准；暂无报告。";
            },
          }),
        ]),
        result,
      );
    }
    function update() {
      pause.textContent = app.performance.enabled ? "暂停采样" : "继续采样";
      pickToggle.textContent = app.stage.pickIndex.enabled
        ? "拾取索引：开（点击对照原路径）"
        : "拾取索引：关（原路径）";
      const s = app.performance.snapshot(),
        f = s.frame,
        last = f.last;
      metrics.textContent = [
        `状态：${app.performance.enabled ? "采样中" : "已暂停"}${app.suspended ? " · 编辑循环暂停" : ""} · ${document.visibilityState} · ${f.submit.samples} 帧`,
        `启动：构造 ${ms(s.startup.constructionMs)} · 首帧提交 ${ms(s.startup.firstSubmitMs)} · 页面就绪 ${ms(s.startup.readyAtMs)}（含加载 / 恢复等待）`,
        `实际 FPS：${f.fps?.toFixed(1) || "—"} · RAF p50 / p95：${ms(f.interval.p50)} / ${ms(f.interval.p95)}`,
        `JS / 渲染提交 p50 / p95：${ms(f.submit.p50)} / ${ms(f.submit.p95)}`,
        `更新均值：${ms(f.step.mean)} · 渲染提交均值：${ms(f.render.mean)} · GPU 最近完成：${s.gpu.supported ? ms(s.gpu.lastMs) : "扩展不可用"}`,
        `上一帧绘制调用：${last?.calls ?? "—"} · 三角形：${last?.triangles ?? "—"} · 点：${last?.points ?? "—"}`,
        `渲染器驻留：几何 ${s.renderer.geometries} · 纹理 ${s.renderer.textures} · 程序 ${s.renderer.programs}`,
        `建筑实例化：${s.modelInstances.enabled ? "开" : "关"} · 最近一帧 ${s.modelInstances.activeGroups || 0} 批替代 ${s.modelInstances.activeSourceMeshes || 0} 个源网格（跨裁剪边界自动回退）`,
        `LOD：${s.renderEffects.lod.settings.enabled?'开':'关'} · 中 / 远景 ${s.renderEffects.lod.medium??0} / ${s.renderEffects.lod.far??0} · 简化 ${s.renderEffects.lod.simplifiedMeshes??0} / 隐去细节 ${s.renderEffects.lod.culledMeshes??0} · 缓存 ${mb(s.renderEffects.lod.geometryBytes??0)} · 后台任务 ${s.renderEffects.lod.pending??0} · 分片最大 ${ms(s.renderEffects.lod.idle?.maxSliceMs)}`,
        `Bloom：${s.renderEffects.bloom.mode==='selective'?'选择性 / ':'全屏 / '}${s.renderEffects.bloom.active?'运行中':s.renderEffects.bloom.enabled?'暂停 / 待渲染':'关'} · 高亮目标 ${s.renderEffects.bloom.glowWidth}×${s.renderEffects.bloom.glowHeight}（增加 GPU 通道，不是实光）${s.renderEffects.bloom.blockedReason?' · '+s.renderEffects.bloom.blockedReason:''}${s.renderEffects.bloom.selection?' · 遮罩 '+s.renderEffects.bloom.selection.width+'×'+s.renderEffects.bloom.selection.height+' / '+s.renderEffects.bloom.selection.maskDrawCalls+' draws / '+s.renderEffects.bloom.selection.selectedSlots+' 候选来源槽 / '+mb(s.renderEffects.bloom.selection.estimatedTargetBytes)+' / '+s.renderEffects.bloom.selection.unsupported+' 不支持 / '+s.renderEffects.bloom.selection.staleParts+' 失配':''}`,
        `拾取：${s.picking.enabled ? "索引" : "原路径"}${app.stage.pickIndex.work.jobs.size ? " · 后台准备中（未就绪走精确回退）" : s.picking.dirty ? " · 待同步" : ""} · 上次候选 ${s.picking.last?.candidates ?? "—"}/${s.picking.last?.roots ?? "—"} · 总耗时 ${ms(s.picking.last?.totalMs)}${s.picking.last?.cold ? "（冷同步 / 回退）" : ""} · 回退 ${s.picking.last?.fallbackRoots ?? "—"} 个根节点`,
        `拾取分段：同步 / refit ${ms(s.picking.last?.syncMs)} · 候选筛选 ${ms(s.picking.last?.broadMs)} · 精确检测 ${ms(s.picking.last?.exactMs)}（CPU，上次查询；未点选时为空）`,
        `场景引用：材质 ${s.scene.materials} · 网格 ${s.scene.meshes} · 实例 ${s.scene.instances}`,
        `属性缓冲估算 ${mb(s.scene.attributeBytes)} · 纹理估算 ${mb(s.scene.textureBytesEstimate)} · 浏览器 JS heap ${mb(s.heapUsedBytes)}`,
        `实光 ${s.lights.active || 0}/${s.lights.budget || 0} · 灯具阴影 ${s.lights.shadows || 0} · ${s.viewport.width}×${s.viewport.height} / DPR ${s.viewport.pixelRatio}`,
      ].join("\n");
      operations.textContent =
        "操作耗时（含子调用 / 异步等待，不可相加）\n" +
        [...s.operations]
          .sort((a, b) => b.maxMs - a.maxMs)
          .slice(0, 10)
          .map(
            (o) =>
              `${o.label}：最近 ${ms(o.lastMs)} · 最大 ${ms(o.maxMs)} · ${o.count} 次`,
          )
          .join("\n");
      if (s.roads.lastSync)
        operations.textContent += `\n道路最近更新：${s.roads.lastSync.rebuilt}/${s.roads.lastSync.total} 条重建，保留 ${s.roads.lastSync.retained} 条 · 桥墩缓存命中 ${s.roads.supportCacheHits}`;
      if (s.drawAttribution)
        operations.textContent +=
          "\n\n最近一次绘制归因（回调提交次数，非 GPU 耗时）\n" +
          s.drawAttribution.rows
            .sort((a, b) => b.total - a.total)
            .map(
              (r) =>
                `${r.category}：主场景 ${r.main} · 阴影 ${r.shadow} · 合计 ${r.total}`,
            )
            .join("\n") +
          `\n与渲染器计数差额：${s.drawAttribution.otherCalls}`;
    }
    document.body.appendChild(dialog);
    // Native modal inertness does not stop window-level editor keyboard shortcuts.
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    dialog.showModal();
    update();
    const timer = setInterval(update, 1000);
    dialog.addEventListener("cancel", (event) => {
      if (controller) {
        event.preventDefault();
        controller.abort();
      }
    });
    dialog.addEventListener(
      "close",
      () => {
        clearInterval(timer);
        controller?.abort();
        dialog.remove();
        if (currentDialog === dialog) currentDialog = null;
      },
      { once: true },
    );
  };
  toolbar.appendChild(
    tbtn(app.benchmarkMode ? "独立基准（不自动保存）" : "性能", {
      icon: "◴",
      title: "性能诊断 / 固定基准场景",
      onClick: open,
    }),
  );
  app.openPerformance = open;
}
