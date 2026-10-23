// ---------------------------------------------------------------------------
// 「一句话生成街区」对话框（Scene 页）
// 纯本地解析 → 实时预览参数 chips → 一次生成（一步撤销）
// ---------------------------------------------------------------------------

import { el, clear } from "./util.js";
import { parsePromptLocally, describeSchema, randomSeed } from "./towngen.js";
import { generateTown } from "./townbuild.js";
import { TEMPLATES, matchTemplate, templateById } from "./templates.js";
import { autoCamera } from "./autocam.js";
import { RECIPE_LABELS } from "./scene-intent.js";
import {
  normalizeSceneRecipe,
  compileSceneRecipe,
  recipePlanSVG,
} from "./scene-recipes.js";
import { applySceneRecipe } from "./scene-recipe-workflow.js";

// 前两条演示精细配方，其后保留普通造镇的方格 / 中轴 / 放射等入口。
const EXAMPLES = [
  "赛博都市，高楼压迫，悬浮汽车穿行楼隙，20位行人，大雾下雨，夜景，种子82",
  "中式古城，建筑沿河两岸，石拱桥连接中轴道路，牌楼跨街，佛塔和108盏孔明灯，夜景，种子42",
  "棋盘格的现代城区，林荫，商业20%",
  "中轴对称的仿古小镇，棋盘格局",
  "放射状路网的老城区，黄昏",
  "现代住宅区与中式古建混搭，林荫",
  "黄昏的加州林荫小镇，商业30%，丘陵",
  "下雨的新英格兰老城区，晚上，纯住宅",
  "沙漠小镇，512米，稀疏，正午，种子 4242",
];

/** 打开对话框；返回关闭函数 */
export function openTownDialog(app) {
  if (document.querySelector(".tg-mask")) return () => {};

  let recipePick = null,
    recipeEdits = {},
    sessionSeed = randomSeed(),
    pending = null,
    closed = false, running = false;
  let seedOverride = 0; // 0 = 跟随文本里的种子 / 随机
  let layoutPick = null; // 手动「道路布局」点选（最高优先；输入文字即清除）
  let templatePick = null; // 手动「场景模板」点选（最高优先；输入文字即清除）
  let parsed = parsePromptLocally("");

  const ta = el("textarea", {
    class: "tg-input",
    rows: 3,
    spellcheck: "false",
    placeholder:
      "描述想要的场景，例如：沿河的中式小镇，石桥与佛塔，黄昏",
  });
  const matchedBox = el("div", { class: "tg-chips" });
  const noteBox = el("div", { class: "tg-note" });
  const genBtn = el("button", {
    class: "tg-btn pri",
    type: "button",
    text: "生成街区",
  });
  const cancelBtn = el("button", {
    class: "tg-btn",
    type: "button",
    text: "取消",
  });
  const statusEl = el("div", { class: "tg-status", text: "" });

  // ---- 道路布局：显式点选（不依赖关键词/防抖；高亮 = 当前生效拓扑） ----
  const LAYOUTS = [
    ["grid", "方格网"],
    ["axis", "中轴对称"],
    ["radial", "放射状"],
    ["spine_and_loop", "主干道+环路"],
  ];
  const layoutBtns = [];
  const layoutRow = el("div", { class: "tg-lrow" });
  for (const [v, label] of LAYOUTS) {
    const b = el("button", {
      class: "tg-chip act",
      type: "button",
      title: `路网布局：${label}`,
      text: label,
    });
    b.onclick = () => {
      layoutPick = layoutPick === v ? null : v;
      render();
    };
    layoutBtns.push({ b, v });
    layoutRow.appendChild(b);
  }

  // ---- 场景模板：点选覆盖 / 关键词自动命中（方案 A 的入口） ----
  const tplBtns = [];
  const tplRow = el("div", { class: "tg-lrow" });
  for (const t of TEMPLATES) {
    const b = el("button", {
      class: "tg-chip act",
      type: "button",
      title: t.hint,
      text: t.label,
    });
    b.onclick = () => {
      templatePick = templatePick === t.id ? null : t.id;
      recipePick = null;
      recipeEdits = {};
      parsed = readPrompt();
      if (parsed.schema.sceneRecipe) delete parsed.schema.sceneRecipe;
      render();
    };
    tplBtns.push({ b, id: t.id });
    tplRow.appendChild(b);
  }

  const recipeRow = el("div", { class: "tg-lrow" }),
    recipeButtons = [];
  for (const [id, label] of [
    [null, "自动识别"],
    ...Object.entries(RECIPE_LABELS),
  ]) {
    const b = el("button", {
      class: "tg-chip act",
      type: "button",
      text: label,
      onclick: () => {
        recipePick = id;
        recipeEdits = {};
        templatePick = null;
        layoutPick = null;
        parsed = readPrompt();
        render();
      },
    });
    recipeRow.appendChild(b);
    recipeButtons.push({ id, b });
  }
  const recipePanel = el("div", { class: "tg-recipe-panel" }),
    recipeSummary = el("div", { class: "tg-recipe-summary" }),
    previewBox = el("div", { class: "tg-plan" });
  const controls = el("details", {}, [
    el("summary", { text: "配方参数 · 受资产与预算约束" }),
  ]);
  const controlGrid = el("div", { class: "tg-recipe-controls" }),
    controlEls = {};
  controls.appendChild(controlGrid);
  for (const [key, label, min, max, step] of [
    ["size", "场域米", 256, 384, 1],
    ["density", "密度", 0.2, 1, 0.05],
    ["floors", "楼层基准", 12, 40, 1],
    ["cars", "悬浮车", 0, 12, 1],
    ["people", "行人", 0, 48, 1],
    ["riverWidth", "河宽米", 12, 20, 0.5],
    ["lanterns", "孔明灯", 0, 180, 1],
    ["walkRate", "行人路径倍率", 0.5, 2, 0.25],
    ["trafficRate", "飞车路径倍率", 0.5, 2, 0.25],
  ]) {
    const input = el("input", {
      type: "number",
      min,
      max,
      step,
      dataset: { recipeParam: key },
      onchange: () => {
        recipeEdits[key] = Number(input.value);
        render();
      },
    });
    const labelEl = el("label", {}, [el("span", { text: label }), input]);
    controlGrid.appendChild(labelEl);
    controlEls[key] = { input, labelEl };
  }
  const opening = el(
    "select",
    {
      dataset: { recipeParam: "opening" },
      onchange: () => {
        recipeEdits.opening = opening.value;
        render();
      },
    },
    [
      el("option", { value: "street", text: "街面人眼" }),
      el("option", { value: "river", text: "沿河望桥" }),
      el("option", { value: "overview", text: "高处全景" }),
    ],
  );
  controlGrid.appendChild(
    el("label", {}, [el("span", { text: "开场" }), opening]),
  );
  const stagger = el("input", {
    type: "checkbox",
    dataset: { recipeParam: "stagger" },
    onchange: () => {
      recipeEdits.stagger = stagger.checked;
      render();
    },
  });
  controlGrid.appendChild(
    el("label", {}, [el("span", { text: "种子错峰出发" }), stagger]),
  );
  const previewBtn = el("button", {
    class: "tg-btn",
    type: "button",
    text: "预览布局（不改当前工程）",
    onclick: () => {
      try {
        const plan = prepareRecipe();
        previewBox.innerHTML = recipePlanSVG(plan);
        previewBox.appendChild(
          el("div", {
            text: `布局草图（非最终3D） · ${plan.summary.models} 模型 / ${plan.summary.kits} 组合 / ${plan.summary.shots} 机位 · ${plan.checks.routeSamples} 个动态样本通过检查`,
          }),
        );
        const r = plan.checks.relations,
          d = plan.checks.dynamics;
        previewBox.appendChild(
          el("div", {
            class: "tg-relation-summary",
            text: `空间关系：${r.anchors} 个局部挂接 / ${r.reserved} 条地块留空 · 动态：${d.routes} 条路线 / ${d.sweeps} 次保守扫掠 · 检查为生成时快照，不随编辑自动约束`,
          }),
        );
        if (d.warnings.length) {
          const detail = el("details", {}, [
            el("summary", {
              text: `动态提示 ${d.warnings.length} 项（非精确碰撞判定）`,
            }),
          ]);
          for (const w of d.warnings)
            detail.appendChild(
              el("div", {
                class: "tg-warnline",
                text: `${w.subject}：${w.message}`,
              }),
            );
          previewBox.appendChild(detail);
        }
      } catch (e) {
        previewBox.textContent = "布局检查未通过：" + e.message;
      }
    },
  });
  recipePanel.append(recipeSummary, controls, previewBtn, previewBox);
  function readPrompt() {
    return parsePromptLocally(ta.value, { sceneRecipe: recipePick });
  }
  function recipeIntent() {
    return templatePick ? null : parsed.schema.sceneRecipe;
  }
  function recipeOverrides() {
    return {
      ...recipeEdits,
      seed: seedOverride || recipeIntent()?.values.seed || sessionSeed,
    };
  }
  function prepareRecipe() {
    return compileSceneRecipe(recipeIntent(), recipeOverrides());
  }

  function render() {
    genBtn.disabled = running || !(ta.value.trim() || templatePick || recipePick || layoutPick);
    const intent = recipeIntent();
    for (const { id, b } of recipeButtons)
      b.classList.toggle("on", id === recipePick);
    recipePanel.style.display = intent ? "" : "none";
    layoutRow.style.display = intent ? "none" : "";
    tplRow.style.display = intent ? "none" : "";
    clear(previewBox);
    if (intent) {
      const p = normalizeSceneRecipe(intent, recipeOverrides()),
        o = p.options;
      recipeSummary.textContent = `${RECIPE_LABELS[p.kind]} · 种子 ${o.seed} · ${o.lighting} / ${o.weather} · 雾 ${o.fog} · 整套资产、组合件、路线和开场一起生成`;
      for (const [key, { input, labelEl }] of Object.entries(controlEls)) {
        input.value = o[key];
        labelEl.style.display =
          (p.kind === "cyber-rain" &&
            ["riverWidth", "lanterns"].includes(key)) ||
          (p.kind === "lantern-river" &&
            ["floors", "cars", "trafficRate"].includes(key))
            ? "none"
            : "";
      }
      opening.value = o.opening;
      stagger.checked = o.stagger;
      clear(matchedBox);
      matchedBox.appendChild(
        el("span", { class: "tg-chip", text: RECIPE_LABELS[p.kind] }),
      );
      matchedBox.appendChild(
        el("button", {
          class: "tg-chip act",
          type: "button",
          text: "⟳ 种子 " + o.seed,
          onclick: () => {
            seedOverride = randomSeed();
            render();
          },
        }),
      );
      clear(noteBox);
      for (const warning of p.warnings)
        noteBox.appendChild(el("div", { class: "tg-warnline", text: warning }));
      if (parsed.unsupported.length)
        noteBox.appendChild(
          el("div", {
            class: "tg-warnline",
            text:
              "未支持（不会生成）：" +
              parsed.unsupported.map((u) => u.text + "→" + u.hint).join("、"),
          }),
        );
      if (parsed.ignored.length)
        noteBox.appendChild(
          el("div", {
            class: "tg-warnline dim",
            text: "未解释片段（可改写）：" + parsed.ignored.join("、"),
          }),
        );
      genBtn.textContent = "生成" + RECIPE_LABELS[p.kind];
      return;
    }
    const schema = {
      ...parsed.schema,
      seed: seedOverride || parsed.schema.seed,
    };
    if (layoutPick) schema.roadTopology = layoutPick; // 点选覆盖文本解析结果
    const eff = schema.roadTopology;
    for (const { b, v } of layoutBtns) b.classList.toggle("on", v === eff);
    const effTpl = templatePick || matchTemplate(ta.value)?.id || null;
    for (const { b, id } of tplBtns) b.classList.toggle("on", id === effTpl);
    clear(matchedBox);
    for (const c of describeSchema(schema))
      matchedBox.appendChild(el("span", { class: "tg-chip", text: c.label }));
    const reroll = el("button", {
      class: "tg-chip act",
      type: "button",
      title: "换一个随机种子",
      text: "⟳ 种子",
    });
    reroll.onclick = () => {
      seedOverride = randomSeed();
      render();
    };
    matchedBox.appendChild(reroll);

    clear(noteBox);
    if (parsed.unsupported.length) {
      noteBox.appendChild(
        el("div", {
          class: "tg-warnline",
          text:
            "暂不支持（已忽略）：" +
            parsed.unsupported.map((u) => `${u.text}→${u.hint}`).join("、"),
        }),
      );
    }
    if (parsed.ignored.length) {
      noteBox.appendChild(
        el("div", {
          class: "tg-warnline dim",
          text: "没看懂：" + parsed.ignored.join("、"),
        }),
      );
    }
    if (
      ta.value.trim() &&
      !parsed.matched.length &&
      !parsed.unsupported.length &&
      !parsed.ignored.length
    ) {
      noteBox.appendChild(
        el("div", {
          class: "tg-warnline dim",
          text: "用默认参数生成一座 256m 郊区小镇",
        }),
      );
    }
    genBtn.textContent =
      ta.value.trim() ? "生成场景" : "生成";
  }

  // 同步解析：不设防抖。预览 iframe / 后台页的 setTimeout 会被 Chrome 节流到 1s+，
  // 防抖会导致「解析结果停在默认（主干道+环路）」和「点生成时用旧 parsed」两类事故。
  // 输入法组合期（isComposing）跳过，compositionend 再解析一次。
  const parseNow = () => {
    seedOverride = 0;
    layoutPick = null;
    templatePick = null;
    recipePick = null;
    recipeEdits = {};
    parsed = readPrompt();
    render();
  };
  ta.addEventListener("input", (e) => {
    if (!e.isComposing) parseNow();
  });
  ta.addEventListener("compositionend", parseNow);

  const examples = el("div", { class: "tg-examples" });
  for (const ex of EXAMPLES) {
    const b = el("button", { class: "tg-chip act", type: "button", text: ex });
    b.onclick = () => {
      ta.value = ex;
      seedOverride = 0;
      layoutPick = null;
      templatePick = null;
      recipePick = null;
      recipeEdits = {};
      parsed = readPrompt();
      render();
      ta.focus();
    };
    examples.appendChild(b);
  }

  const advanced = el("details", {class:"tg-advanced"}, [
    el("summary", {text:"更多选项"}),
    el("div",{class:"tg-advanced-body"},[
      examples,
      el("div",{class:"tg-plabel",text:"生成配方"}),recipeRow,recipePanel,
      el("div",{class:"tg-plabel",text:"场景模板"}),tplRow,
      el("div",{class:"tg-plabel",text:"道路布局"}),layoutRow,
      el("div",{class:"tg-plabel",text:"解析结果"}),matchedBox,
    ]),
  ]);
  const previousFocus=document.activeElement;
  const modal = el("div", {class:"tg-modal",role:"dialog","aria-label":"一句话生成"},[
    el("div",{class:"tg-head"},[
      el("b",{text:"一句话生成"}),el("span",{class:"tg-sub",text:"本地生成 · 无需联网"}),
      el("button",{class:"tg-x",type:"button",text:"✕","aria-label":"关闭一句话生成",onclick:close}),
    ]),
    el("div",{class:"tg-body"},[ta,advanced,noteBox,statusEl]),
    el("div",{class:"tg-foot"},[
      el("span",{class:"tg-hint",text:"会替换当前场景，可撤销 · Ctrl+Enter 生成"}),cancelBtn,genBtn,
    ]),
  ]);
  const mask=el("div",{class:"tg-mask tg-viewport-mask"},[modal]);
  function positionDialog(){
    const r=app.stage.canvas.getBoundingClientRect();
    mask.style.left=r.left+'px';mask.style.top=r.top+'px';mask.style.width=r.width+'px';mask.style.height=r.height+'px';
  }
  document.body.appendChild(mask);positionDialog();
  const observer=new ResizeObserver(positionDialog);observer.observe(app.stage.canvas);
  window.addEventListener('resize',positionDialog);
  const offPage=app.bus.on('page-change',close);
  requestAnimationFrame(() => {if(!closed)mask.classList.add("on");});

  function close() {
    if(closed)return;
    closed = true;
    observer.disconnect();window.removeEventListener('resize',positionDialog);offPage();
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    if (pending != null) clearTimeout(pending);
    mask.classList.remove("on");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => mask.remove(), 160);
  }
  function onKey(e) {
    e.stopPropagation();
    if(e.key==='Tab'){
      const nodes=[...modal.querySelectorAll('button,textarea,select,input,summary')].filter(n=>!n.disabled&&n.getClientRects().length);
      const i=nodes.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();nodes.at(-1)?.focus();}
      else if(!e.shiftKey&&i===nodes.length-1){e.preventDefault();nodes[0]?.focus();}
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (!e.isComposing && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      run();
    }
  }
  document.addEventListener("keydown", onKey, true);
  mask.addEventListener("pointerdown", (e) => {
    if (e.target === mask) close();
  });
  cancelBtn.onclick = close;
  genBtn.onclick = run;

  function run() {
    if (closed || running || genBtn.disabled) return;
    // 生成前同步重解析：以输入框当前内容为准 + 布局点选覆盖，绝不依赖防抖定时器
    parsed = readPrompt();
    if (layoutPick) parsed.schema.roadTopology = layoutPick;
    render();
    const schema = {
      ...parsed.schema,
      seed: seedOverride || parsed.schema.seed,
    };
    running=true;ta.disabled=true;
    genBtn.disabled = cancelBtn.disabled = true;
    statusEl.textContent = "生成中…";
    // 让「生成中」先绘制出来：生成本身是同步的重活
    pending = setTimeout(() => {
      pending = null;
      if (closed) return;
      let stats,
        tpl = null;
      try {
        const tplId = templatePick || matchTemplate(ta.value)?.id || null;
        tpl = tplId ? templateById(tplId) : null;
        if (recipeIntent()) {
          const plan = prepareRecipe();
          stats = applySceneRecipe(app, plan, ta.value);
        } else if (tpl) {
          // 方案 A：模板槽位搭建（内部已含方案 C 的自动运镜，一步撤销）
          const r = tpl.build(app, { seed: schema.seed });
          stats = { tpl: true, label: tpl.label, ...r, schema, ms: 0 };
        } else {
          stats = generateTown(app, schema, {
            onProgress: (p, label) => {
              statusEl.textContent = `生成中… ${Math.round(p * 100)}% ${label}`;
            },
          });
          // 方案 C：为一句话生成的街区离线自动配机位（独立撤销组）
          const before = app.shots.length;
          app.batchOp("自动运镜", () => {
            autoCamera(app, {});
            app.select(null);
          });
          stats.autoShots = app.shots.length - before;
        }
      } catch (e) {
        console.error("[towngen]", e);
        statusEl.textContent = "";
        running=false;ta.disabled=false;
        genBtn.disabled = cancelBtn.disabled = false;
        app.notify("生成失败：" + (e?.message || e), "err");
        return;
      }
      close();
      genBtn.disabled = cancelBtn.disabled = false; // 成功也复位：disabled 会吞掉后续点击
      const msg = stats.recipe
        ? `已生成「${stats.label}」：${stats.models} 模型 / ${stats.kits} 组合 / ${stats.shots} 机位 · Ctrl+Z 一步退回`
        : tpl
          ? `已用模板「${tpl.label}」搭建：${stats.objects} 物体 · ${stats.shots} 机位（${stats.auto} 自动） · ${stats.motions} 段运动 · Ctrl+Z 可整场退回`
          : `已生成 ${stats.schema.mapSize}m 街区：${stats.roads} 条路 / ${stats.houses} 栋建筑${stats.towers ? `（含 ${stats.towers} 塔楼）` : ""} / ${stats.trees} 棵树 · 自动配 ${stats.autoShots || 0} 个机位（${stats.ms}ms）`;
      app.notify(
        stats.warnings?.length ? msg + " · " + stats.warnings.join("；") : msg,
        "ok",
      );
      window.__townStats = stats;
    }, 30);
  }

  render();
  ta.focus();
  return close;
}
