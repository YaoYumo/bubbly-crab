import { el, downloadBlob } from "./util.js";
import { AISceneWorkflow } from "./ai-scene-workflow.js";
import { AIScenePreview } from "./ai-scene-preview.js";
import { AISceneGateway } from "./ai-scene-gateway.js";
import { parseAIPlan } from "./ai-scene-format.js";
const note = (text) => el("p", { class: "fnote", text });
export function openAISceneDialog(app) {
  if (document.querySelector("[data-ai-scene-dialog]")) return;
  app.aiScene ||= new AISceneWorkflow(app);
  const w = app.aiScene;
  try {
    w.checkIdle();
  } catch (e) {
    app.notify(e.message, "warn");
    return;
  }
  const mask = el("div", {
      class: "ai-scene-mask",
      dataset: { aiSceneDialog: "1" },
    }),
    dialog = el("section", {
      class: "ai-scene-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "AI场景搭建",
    });
  mask.append(dialog);
  const previousFocus = document.activeElement;
  const wasSuspended = app.suspended;
  app.suspended = true;
  const appRoot = document.getElementById("app"),
    inert = appRoot?.inert;
  if (appRoot) appRoot.inert = true;
  let source = "local",
    ready = false,
    preparing = false,
    planning = false,
    applying = false,
    warningCount = 0;
  let origin = { type: "manual" };
  let preview,
    polling,
    apiBusy = false,
    closed = false,
    editableIds = app.selObj ? [app.selObj.id] : [];
  const status = note(
      "选择模板，生成候选后再确认应用。默认离线，预览不会改动原场景。",
    ),
    stats = el("div", {
      class: "ai-scene-stats",
      text: "生成后可在这里查看布局",
    }),
    diffList = el("ul", {
      class: "ai-scene-diff",
      dataset: { aiSceneDiff: "1" },
    }),
    warnings = el("ul", { class: "ai-scene-warnings" }),
    previewHost = el("div", { class: "ai-scene-canvas" });
  status.classList.add("ai-scene-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const empty = el("div", { class: "ai-scene-empty" }, [
    el("strong", { text: "先看看，再应用" }),
    el("span", {
      text: "生成候选后，可旋转、缩放或切换俯视。原场景保持不变。",
    }),
  ]);
  previewHost.append(empty);
  const technical = note("候选使用基础灯光；原场景为线框示意，不是最终渲染。");
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      if (!closed) {
        status.textContent = e.message;
        app.notify(e.message, "warn");
      }
    }
  };
  const button = (label, key, fn) =>
    el("button", {
      class: "exp-btn secondary",
      type: "button",
      text: label,
      dataset: { aiSceneAction: key },
      onclick: run(fn),
    });
  const select = (key, choices) =>
    el(
      "select",
      { class: "sel", dataset: { aiSceneSetting: key } },
      choices.map(([value, text]) => el("option", { value, text })),
    );
  const field = (key, value, min, max) =>
    el("input", {
      class: "num",
      type: "number",
      value,
      min,
      max,
      dataset: { aiSceneSetting: key },
    });
  const mode = select("mode", [
    ["add", "添加：保留原场景"],
    ["edit", "局部：仅允许修改打开时选中的对象"],
    ["replace", "替换：清空对象与机位（需确认）"],
  ]);
  const size = field("size", 192, 10, 600),
    x = field("centerX", 0, -500, 500),
    z = field("centerZ", 0, -500, 500),
    seed = field("seed", 12345, 1, 2147483647);
  const preserve = el("input", {
      type: "checkbox",
      checked: true,
      dataset: { aiSceneSetting: "preserveTerrain" },
    }),
    replace = el("input", {
      type: "checkbox",
      dataset: { aiSceneSetting: "allowReplace" },
    });
  const bounds = () => ({
    center: [Number(x.value), Number(z.value)],
    size: [Number(size.value), Number(size.value)],
  });
  const permissions = () => ({
    mode: mode.value,
    editableIds,
    bounds: bounds(),
    preserveTerrain: preserve.checked,
    allowReplace: replace.checked,
  });
  const recipe = select("recipe", [
    ["template:plaza", "本地模板 · 城市广场"],
    ["template:street", "本地模板 · 街区街口"],
    ["template:boulevard", "本地模板 · 林荫大道（范围≥320m）"],
    ["town:chinese", "程序街区 · 中式"],
    ["town:suburb", "程序街区 · 郊区"],
    ["town:modern", "程序街区 · 现代"],
  ]);
  const topology = select("topology", [
    ["grid", "方格路网"],
    ["axis", "中轴路网"],
    ["radial", "放射路网"],
    ["spine_and_loop", "主路与环线"],
  ]);
  const text = el("textarea", {
    class: "txt",
    rows: 7,
    spellcheck: false,
    dataset: { aiSceneBlueprint: "1" },
    placeholder:
      "粘贴 previz-ai-scene/1 蓝图；旧 Scene DSL 仍由原入口导入，不会在此偷偷清空场景。",
  });
  const accept = el("input", {
    type: "checkbox",
    dataset: { aiSceneSetting: "acceptWarnings" },
  });
  const apply = button("应用到场景", "apply", async () => {
    if (!ready || preparing) return;
    if (
      !confirm(
        "即将应用已检查的候选。建议先保存工程；整个工程对象会重新装配，保留未修改内容的稳定ID。继续？",
      )
    )
      return;
    status.textContent = "应用中，请等待…";
    preparing = true;
    applying = true;
    syncActions();
    let audit;
    try {
      audit = await w.apply({ acceptWarnings: accept.checked });
    } catch (e) {
      ready = false;
      throw e;
    } finally {
      preparing = false;
      applying = false;
      syncActions();
    }
    if (!closed) {
      preview?.clear();
      preview?.render();
      ready = false;
      empty.hidden = false;
      empty.querySelector("strong").textContent = "已应用到场景";
      empty.querySelector("span").textContent =
        "关闭窗口继续编辑，Ctrl+Z 可一步撤销。";
      acceptLabel.hidden = true;
      syncActions();
      status.textContent =
        "已应用；Ctrl+Z一步撤销。可导出应用记录，或关闭后在Export生成参考包。";
      stats.textContent = changeSummary(audit.changes);
    }
  });
  apply.disabled = true;
  const invalidate = () => {
    ready = false;
    syncActions();
    accept.checked = false;
    status.textContent = "设置已变化，请重新准备候选。";
  };
  text.addEventListener("input", () => {
    origin = { type: "manual-edited" };
  });
  for (const e of [
    mode,
    size,
    x,
    z,
    seed,
    preserve,
    replace,
    recipe,
    topology,
    text,
  ])
    e.addEventListener("input", invalidate);
  async function prepare(plan) {
    if (closed) return;
    if (preparing) throw Error("候选正在处理中，请稍候");
    ready = false;
    preparing = true;
    syncActions();
    accept.checked = false;
    status.textContent = "校验和构建候选中…";
    let d;
    try {
      d = await w.prepare(plan, permissions(), (p) => {
        if (!closed)
          status.textContent = `准备候选 ${p.i}/${p.total}（可取消）`;
      });
    } finally {
      preparing = false;
      syncActions();
    }
    if (closed) {
      w.discard();
      return;
    }
    d.origin = { ...origin };
    preview ||= new AIScenePreview(previewHost);
    preview.show(d);
    empty.hidden = true;
    stats.textContent =
      changeSummary(d.changes) + ` · ${d.document.shots.length} 个机位`;
    technical.textContent = `候选约 ${Math.round(d.triangles).toLocaleString()} 三角。原场景为最多1000个线框包围盒，道路为中心线；地形高程与路口网格未预览，最终效果请在主视图检查。`;

    const diffs = [];
    for (const [kind, label] of [
      ["added", "新增"],
      ["modified", "修改"],
      ["removed", "删除"],
    ])
      for (const id of d.changes[kind]) {
        const next = d.document.objects.find((o) => o.id === id),
          old = app.byId(id)?.serialize(),
          o = next || old;
        let detail = next ? "位置 " + JSON.stringify(next.pos) : "";
        if (kind === "modified") {
          const changed = Object.keys(next.params || {}).filter(
            (k) =>
              JSON.stringify(next.params[k]) !==
              JSON.stringify(old?.params?.[k]),
          );
          detail =
            JSON.stringify(old?.pos) +
            " → " +
            JSON.stringify(next.pos) +
            `；朝向Y ${old?.rot?.[1] ?? 0} → ${next.rot?.[1] ?? 0} 弧度` +
            (changed.length ? "；参数 " + changed.join(",") : "");
        }
        diffs.push(`${label} ${o?.name || id} [${id}] ${detail}`);
      }
    for (const shot of d.document.shots)
      if (!app.shots.some((s) => s.id === shot.id))
        diffs.push(`新增机位 ${shot.name} [${shot.id}]`);
    for (const id of d.changes.camerasRemoved)
      diffs.push(
        `删除原机位 ${app.shots.find((s) => s.id === id)?.name || ""} [${id}]`,
      );
    for (const id of d.changes.camerasModified)
      diffs.push(`修改原机位主体引用 [${id}]`);
    if (d.plan.previs?.motion)
      diffs.push(
        `设置主体走位 [${d.plan.previs.subjectId}] ${d.plan.previs.motion.anim}`,
      );
    if (d.plan.terrain === "flat" && app.terrain.enabled)
      diffs.push("关闭原地形显示（仅在明确授权的替换模式）");
    if (d.document.state.duration !== app.state.duration)
      diffs.push(
        `全局时长 ${app.state.duration} → ${d.document.state.duration}秒`,
      );
    for (const r of d.changes.relations || []) {
      const label = {
        offset: "相对偏移",
        face: "朝向目标",
        distance: "距离校验",
        "keep-out": "留空校验",
      }[r.type];
      const target = r.reference || r.target || r.obstacle;
      diffs.push(
        `空间关系 · ${label} [${r.subject}] → [${target}] ${r.type === "offset" ? JSON.stringify(r.delta) + " " + r.frame : r.type === "distance" ? `${r.min}–${r.max}米` : r.type === "keep-out" ? `${r.margin}米` : "模型+Z朝向"}`,
      );
    }
    diffList.replaceChildren(...diffs.map((text) => el("li", { text })));
    warnings.replaceChildren(...d.warnings.map((s) => el("li", { text: s })));
    warningCount = d.warnings.length;
    ready = true;
    warningSummary.textContent = warningCount
      ? `${warningCount} 项提示 · 展开检查`
      : "检查通过，无额外提示";
    warningDetails.hidden = !warningCount;
    acceptLabel.hidden = !warningCount;
    acceptText.textContent = `我已检查并接受这 ${warningCount} 项提示`;
    syncActions();
    status.textContent =
      "候选已准备，原工程未改变。请检查空间、改动范围和警告后确认。";
    const selected = subject.value;
    subject.replaceChildren(
      el("option", { value: "", text: "选择明确主体" }),
      ...d.document.objects
        .filter((o) => o.key)
        .map((o) => el("option", { value: o.id, text: o.name + " · " + o.id })),
    );
    subject.value = selected;
  }
  async function buildLocal() {
    const [kind, name] = recipe.value.split(":"),
      r =
        kind === "town"
          ? {
              kind,
              theme: name,
              topology: topology.value,
              density: 0.35,
              vegetation: 0.25,
            }
          : { kind, template: name };
    origin = { type: "local", recipe: r };
    const plan = await w.localPlan(permissions(), r);
    plan.seed = Number(seed.value);
    text.value = JSON.stringify(plan, null, 2);
    invalidate();
    return plan;
  }
  const local = button("仅生成蓝图", "local-plan", async () => {
    await buildLocal();
    status.textContent = "本地蓝图已生成，可导出或预览。";
  });
  const file = el("input", {
    type: "file",
    accept: ".json,application/json",
    dataset: { aiSceneFile: "1" },
    onchange: run(async () => {
      const f = file.files[0];
      if (!f || f.size > 512 * 1024) throw Error("蓝图文件最多512KiB");
      origin = { type: "manual-file", name: f.name };
      text.value = JSON.stringify(parseAIPlan(await f.text()), null, 2);
      invalidate();
    }),
  });
  const jsonDownload = (data, name) =>
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      name,
    );
  const subject = select("subject", [["", "准备候选后选择主体"]]),
    camera = select("camera", [
      ["orbit", "环绕主体候选"],
      ["overview", "全景候选"],
      ["push", "推镜候选"],
      ["follow", "跟拍（需提供走位）"],
      ["all", "全部四个机位候选"],
    ]);
  const motion = el("textarea", {
      class: "txt",
      rows: 3,
      placeholder:
        "可选人物走位：[[0,0,0,0],[6,10,0,0]]，每点[秒,x,y,z]；末秒须等于工程时长。留空不改动作。",
      dataset: { aiSceneMotion: "1" },
    }),
    anim = select("anim", [
      ["walk", "走路"],
      ["run", "跑步"],
      ["idle", "待机"],
    ]);
  const gateway = new AISceneGateway(),
    access = el("input", {
      class: "txt",
      type: "password",
      autocomplete: "off",
      placeholder: "独立网关口令（不是模型Key，仅在当前弹窗内存保存）",
      dataset: { aiSceneAccess: "1" },
      oninput: () => {
        gateway.accessToken = access.value;
      },
    }),
    prompt = el("textarea", {
      class: "txt",
      rows: 3,
      maxlength: 8000,
      placeholder: "描述需求；AI只提出候选，不直接修改场景。",
      dataset: { aiScenePrompt: "1" },
    }),
    capsNote = note(
      "网关默认未配置。只上传工作包的资产目录和对象摘要，不上传模型二进制 / 截图 / 整个工程。",
    );
  async function watch() {
    polling?.abort();
    const ctl = (polling = new AbortController());
    try {
      const job = await gateway.poll((job) => {
        if (!closed) status.textContent = `AI任务 ${job.id}：${job.status}`;
      }, ctl.signal);
      if (closed) return;
      if (job.status === "succeeded") {
        origin = {
          type: "api-adapter",
          model: job.model,
          jobId: job.id,
          verified: false,
        };
        text.value = JSON.stringify(job.blueprint, null, 2);
        invalidate();
        status.textContent = "AI蓝图已返回，点击预览返回的蓝图；没有自动应用。";
      } else throw Error(job.error || "AI任务失败");
    } catch (e) {
      if (e.name === "AbortError") {
        if (!closed)
          status.textContent =
            "已停止本地等待，不代表远端取消或停止计费；可恢复查询。";
        return;
      }
      throw e;
    } finally {
      if (polling === ctl) polling = null;
    }
  }
  const gatewayBox = el("details", {}, [
    el("summary", { text: "AI 服务连接与请求恢复" }),
    capsNote,
    access,
    prompt,
    button("检查AI网关能力", "discover", async () => {
      const c = await gateway.discover();
      capsNote.textContent =
        c.provider === "local"
          ? `本地模型接口 · ${c.configured ? "已配置" : "未就绪"} · ${c.localModel?.runtime || "本地运行时"} · ${c.model || "尚未选模型"}。配置就绪不代表已安装、运行或通过推理验证；仍需主动提交并确认候选。`
          : `${c.configured ? "已配置" : "未配置"} · ${c.model || "无模型"} · ${c.requiresAuth ? "需独立网关口令" : "本地测试协议"} · 不代表真实生成已验证。任务仅在网关本进程保留1小时，停止等待不取消上游计费。`;
    }),
    button("确认调用AI生成蓝图（可能计费）", "submit", async () => {
      if (apiBusy) throw Error("请求正在进行，请勿重复提交");
      if (!prompt.value.trim()) throw Error("请输入需求");
      if (!gateway.caps?.configured) throw Error("请先检查已配置的网关能力");
      apiBusy = true;
      syncActions();
      try {
        const ctx = await w.context(permissions());
        if (
          !confirm(
            `将上传${ctx.objects.length}个对象摘要及${ctx.catalog.length}个资产参数描述到配置的AI，可能计费。不会直接应用。继续？`,
          )
        )
          return;
        await gateway.submit(prompt.value, ctx);
        if (!closed) await watch();
      } finally {
        apiBusy = false;
        syncActions();
      }
    }),
    button("恢复查询（不重新提交）", "resume", watch),
    button("停止本地等待（非远端取消）", "stop-wait", () => polling?.abort()),
    button("清除请求记录（先确认旧计费）", "reset-request", () => {
      if (
        confirm(
          "清除不会取消上游任务，也不会退款。确认已检查服务商后台，不会盲目重复提交？",
        )
      )
        gateway.remember(null);
    }),
  ]);
  gatewayBox.append(
    el("details", { dataset: { aiSceneLocalHelp: "1" } }, [
      el("summary", { text: "本地模型接入（预留）" }),
      note(
        "尚未内置或下载模型。本机项目预留 local-ai/models、runtimes、cache、logs 目录；Ollama/LM Studio 也可使用它们自己的模型目录。",
      ),
      note(
        "在项目终端运行 npm run local-ai:init，再运行 npm run local-ai:check 查看配置与路径。安装运行时后按 docs/local-ai.md 配置，使用 npm run ai:local 启动可选网关；不会自动下载安装或加载权重。",
      ),
      note(
        "模型目录由本机配置文件指定，网页不能读写任意磁盘路径。单文件离线版继续使用配方/手动蓝图；服务模式才连接本地模型。",
      ),
    ]),
  );
  function close() {
    if (w.busy) {
      w.cancel();
      status.textContent = "已请求取消准备；应用提交中不能中断，请稍候再关闭。";
      return;
    }
    closed = true;
    polling?.abort();
    preview?.dispose();
    w.discard();
    mask.remove();
    window.removeEventListener("keydown", keydown, true);
    if (appRoot) appRoot.inert = inert;
    app.suspended = wasSuspended;
    previousFocus?.focus?.();
  }
  const keydown = (e) => {
    e.stopImmediatePropagation();
    if (sourceTabs.contains(e.target)) sourceKeydown(e);
    if (e.key === "Tab") {
      const items = [
        ...dialog.querySelectorAll(
          'button,input,select,textarea,summary,[tabindex="0"]',
        ),
      ].filter(
        (n) =>
          !n.disabled && !n.closest("[inert]") && n.getClientRects().length,
      );
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", keydown, true);
  function changeSummary(c) {
    return `新增 ${c.added.length} · 修改 ${c.modified.length} · 删除 ${c.removed.length}`;
  }
  const prepareButton = button("生成候选预览", "prepare", async () => {
    if (planning || preparing || apiBusy) return;
    planning = true;
    syncActions();
    try {
      await prepare(
        source === "local" ? await buildLocal() : parseAIPlan(text.value),
      );
    } finally {
      planning = false;
      syncActions();
    }
  });
  prepareButton.classList.add("ai-scene-primary");
  apply.classList.add("ai-scene-primary");
  const cancel = button("取消准备", "cancel", () => w.cancel());
  const acceptText = el("span"),
    acceptLabel = el("label", { class: "ai-scene-accept", hidden: true }, [
      accept,
      acceptText,
    ]);
  accept.addEventListener("change", syncActions);
  const warningSummary = el("summary", { text: "候选提示" }),
    warningDetails = el(
      "details",
      { class: "ai-scene-warning-box", hidden: true },
      [warningSummary, warnings],
    );
  function syncActions() {
    apply.disabled =
      preparing || planning || !ready || (warningCount > 0 && !accept.checked);
    prepareButton.disabled = preparing || planning || apiBusy;
    cancel.hidden = !preparing || applying;
    setupInputs.inert = preparing || planning;
  }
  const labeled = (label, input) =>
    el("label", { class: "ai-scene-field" }, [
      el("span", { text: label }),
      input,
    ]);
  const topologyField = labeled("道路布局", topology);
  recipe.addEventListener("change", () => {
    topologyField.hidden = !recipe.value.startsWith("town:");
  });
  topologyField.hidden = true;
  const sourcePanels = {
    local: el("div", {}, [
      labeled("场景模板", recipe),
      topologyField,
      note("本地模板直接生成预览，不联网、不消耗积分。"),
    ]),
    manual: el("div", {}, [
      note("导入或粘贴蓝图，再点击下方生成预览。"),
      el("details", {}, [
        el("summary", { text: "空间关系蓝图（受控首版）" }),
        note(
          "支持相对偏移、模型朝向、距离与留空校验。+X东、+Z南；朝向不是识别门口。只生成一次布局，不会持续跟随，也不自动避障。",
        ),
        button("填入离线空间关系示例", "relation-example", async () => {
          if (mode.value !== "add")
            throw Error("关系示例仅用于添加模式，请先切换为添加。");
          const ctx = await w.context(permissions());
          const id = "rel-" + crypto.randomUUID(),
            [x, z] = ctx.bounds.center;
          const first = id + "-a",
            second = id + "-b";
          text.value = JSON.stringify(
            {
              schema: "previz-ai-scene/1",
              id,
              name: "离线关系示例（未调用模型）",
              baseFingerprint: ctx.baseFingerprint,
              mode: "add",
              bounds: ctx.bounds,
              seed: 1,
              terrain: "preserve",
              durationSeconds: ctx.durationSeconds,
              operations: [
                {
                  op: "add",
                  id: first,
                  key: "env:crate:木箱",
                  pos: [x - 2, 0, z],
                  placement: "ground",
                },
                {
                  op: "add",
                  id: second,
                  key: "env:crate:木箱",
                  pos: [x, 0, z],
                },
              ],
              relations: {
                version: 1,
                rules: [
                  {
                    type: "offset",
                    subject: second,
                    reference: first,
                    delta: [4, 0, 0],
                    frame: "world",
                  },
                  { type: "face", subject: second, target: first },
                  {
                    type: "distance",
                    subject: second,
                    target: first,
                    min: 4,
                    max: 4,
                  },
                  {
                    type: "keep-out",
                    subject: second,
                    obstacle: first,
                    margin: 1,
                  },
                ],
              },
            },
            null,
            2,
          );
          origin = { type: "manual-relation-example", verified: false };
          invalidate();
          status.textContent =
            "已填入两木箱的关系示例，未调用模型或修改工程；请生成候选预览。";
        }),
      ]),
      file,
      text,
    ]),
    api: el("div", {}, [
      note("仅在你主动连接并确认后调用，可能计费。返回蓝图仍需预览和确认。"),
      gatewayBox,
    ]),
  };
  gatewayBox.open = true;
  const sourceTabs = el("div", {
    class: "ai-scene-sources",
    role: "tablist",
    "aria-label": "候选来源",
  });
  for (const [id, label] of [
    ["local", "本地模板"],
    ["manual", "导入蓝图"],
    ["api", "AI 服务"],
  ]) {
    const tab = el("button", {
      type: "button",
      role: "tab",
      text: label,
      id: `ai-source-${id}`,
      dataset: { aiSceneSource: id },
      onclick: () => setSource(id),
    });
    tab.setAttribute("aria-controls", `ai-source-panel-${id}`);
    sourceTabs.append(tab);
    sourcePanels[id].id = `ai-source-panel-${id}`;
    sourcePanels[id].setAttribute("role", "tabpanel");
    sourcePanels[id].setAttribute("aria-labelledby", tab.id);
  }
  function setSource(id) {
    if (preparing || planning || apiBusy) return;
    source = id;
    for (const [key, panel] of Object.entries(sourcePanels))
      panel.hidden = key !== id;
    for (const tab of sourceTabs.children) {
      tab.classList.toggle("on", tab.dataset.aiSceneSource === id);
      tab.setAttribute(
        "aria-selected",
        String(tab.dataset.aiSceneSource === id),
      );
    }
    prepareButton.textContent =
      id === "api" ? "预览返回的蓝图" : "生成候选预览";
    if (id === "api") gatewayBox.open = true;
    invalidate();
  }
  const sourceKeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...sourceTabs.children],
      i = tabs.indexOf(document.activeElement),
      next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
    setSource(tabs[next].dataset.aiSceneSource);
    tabs[next].focus();
  };
  const replaceLabel = el("label", { class: "ai-scene-danger", hidden: true }, [
    replace,
    "允许清空并替换原对象和机位",
  ]);
  const editNote = note(
    "仅修改打开窗口前选中的对象；请使用导入蓝图或 AI 服务。",
  );
  editNote.hidden = true;
  mode.addEventListener("change", () => {
    replaceLabel.hidden = mode.value !== "replace";
    editNote.hidden = mode.value !== "edit";
    if (mode.value === "edit" && source === "local") setSource("manual");
  });
  const scope = el("div", { class: "ai-scene-fields" }, [
    labeled("应用方式", mode),
    labeled("范围边长（米）", size),
  ]);
  const settings = el("details", {}, [
    el("summary", { text: "更多设置与导出" }),
    el("div", { class: "ai-scene-fields" }, [
      labeled("中心 X", x),
      labeled("中心 Z", z),
      labeled("种子", seed),
      el("label", {}, [preserve, "保留地形"]),
    ]),
    note(
      `局部授权：${editableIds.join("、") || "未选中对象"}。锁定对象始终保护。`,
    ),
    el("div", { class: "reference-actions" }, [
      button("导出工作包", "workpack", async () =>
        jsonDownload(await w.context(permissions()), "ai-scene-workpack.json"),
      ),
      local,
      button("导出蓝图", "plan-download", () =>
        jsonDownload(parseAIPlan(text.value), "ai-scene-blueprint.json"),
      ),
      button("导出应用记录", "audit-download", () => {
        if (!w.lastApplied) throw Error("暂无应用记录");
        jsonDownload(w.lastApplied, "ai-scene-application.json");
      }),
    ]),
  ]);
  const previs = el("details", {}, [
    el("summary", { text: "走位与机位（可选）" }),
    labeled("候选主体", subject),
    labeled("机位方式", camera),
    labeled("人物动作", anim),
    motion,
    button("更新预演候选", "previs", async () => {
      const p = parseAIPlan(text.value);
      p.previs = { subjectId: subject.value, camera: camera.value };
      if (motion.value.trim())
        p.previs.motion = {
          anim: anim.value,
          points: JSON.parse(motion.value),
        };
      text.value = JSON.stringify(p, null, 2);
      await prepare(p);
    }),
    note("基础走位不含导航、接触或脚滑修正。"),
  ]);
  const setupInputs = el("div", {}, [
    sourceTabs,
    ...Object.values(sourcePanels),
    scope,
    replaceLabel,
    editNote,
    settings,
    previs,
  ]);
  const left = el("aside", { class: "ai-scene-setup" }, [
    el("h3", { text: "1 · 选择内容" }),
    setupInputs,
    el("div", { class: "ai-scene-generate" }, [prepareButton, cancel]),
  ]);
  const right = el(
    "section",
    { class: "ai-scene-result", "aria-label": "候选预览" },
    [
      el("div", { class: "ai-scene-preview-head" }, [
        el("h3", { text: "2 · 检查预览" }),
        el("div", { class: "reference-actions" }, [
          button("透视", "perspective", () => preview?.perspective()),
          button("俯视", "top", () => preview?.top()),
        ]),
      ]),
      previewHost,
      stats,
      warningDetails,
      el("details", {}, [el("summary", { text: "查看改动明细" }), diffList]),
      el("details", {}, [el("summary", { text: "预览说明" }), technical]),
    ],
  );
  dialog.append(
    el("header", {}, [
      el("div", {}, [
        el("h2", { text: "AI 场景搭建" }),
        note("选择内容 → 检查预览 → 确认应用"),
      ]),
      button("关闭", "close", close),
    ]),
    el("div", { class: "ai-scene-body" }, [left, right]),
    el("footer", { class: "ai-scene-footer" }, [
      el("div", { class: "ai-scene-footer-info" }, [status, acceptLabel]),
      el("div", { class: "ai-scene-apply" }, [
        apply,
        note("一步撤销 · 不自动应用"),
      ]),
    ]),
  );
  setSource("local");
  status.textContent =
    "选择模板，生成候选后再确认应用。默认离线，预览不会改动原场景。";
  document.body.append(mask);
  dialog.querySelector("button")?.focus();
  return { close };
}
