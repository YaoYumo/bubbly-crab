import { el } from "./util.js";
import { hasBehavior } from "./behavior-workflow.js";
import { MOVE_ANIMS, ACT_ANIMS } from "./behavior-program.js";
import { BehaviorPreview } from "./behavior-preview.js";
const names = {
  walk: "步行",
  run: "跑步",
  idle: "停留",
  wave: "挥手",
  point: "指向",
  talk: "说话",
  look: "观察",
  phone: "看手机",
};
const note = (text) => el("p", { class: "fnote", text });
export function behaviorControls(app, so) {
  const root = el("div", { class: "sec", dataset: { behaviorControls: "1" } }),
    body = el("div", { class: "sec-b" });
  root.append(
    el("div", { class: "sec-h" }, [el("b", { text: "多步骤行为 / 静态导航" })]),
    body,
  );
  body.append(
    note(
      hasBehavior(so)
        ? so.motion.behaviorError ||
            `${so.motion.behavior.request.steps.length}步 · ${so.motion.behavior.duration.toFixed(1)}秒 · ${so.motion.active ? "已启用" : "已停用"}。生成路径和人物变换为只读；改起点／身形请先移除。`
        : "单个人物：走到世界XZ目标 → 停留／动作 → 继续。先暂停并回到0秒，在y=0平面预演。",
    ),
  );
  body.append(
    el("button", {
      class: "fbtn wide",
      type: "button",
      text: "编辑步骤 / 独立预演",
      dataset: { behaviorAction: "open" },
      onclick: () => openBehaviorDialog(app, so),
    }),
  );
  if (hasBehavior(so))
    body.append(
      note(
        "保存的是确认时的静态路线；改场景后请重新预演。仅按输入的半径／高度代理绕AABB，不检查其他角色、四肢接触、脚滑、水域或地面支撑。",
      ),
    );
  return root;
}
export function openBehaviorDialog(app, so) {
  if (document.querySelector("[data-behavior-dialog]")) return;
  const w = app.behaviors;
  try {
    w.assertIdle();
    w.actor(so.id);
  } catch (e) {
    app.notify(e.message, "warn");
    return;
  }
  w.discard();
  let request = so.motion.behavior
    ? JSON.parse(JSON.stringify(so.motion.behavior.request))
    : {
        radius: 0.6,
        height: 2.5,
        cellSize: 0.5,
        margin: 8,
        steps: [
          {
            type: "move",
            target: [so.root.position.x + 4, so.root.position.z],
            seconds: 3,
            anim: "walk",
          },
          { type: "act", seconds: 2, anim: "wave" },
          {
            type: "move",
            target: [so.root.position.x + 4, so.root.position.z + 4],
            seconds: 3,
            anim: "walk",
          },
        ],
      };
  let preview = null,
    draft = null,
    busy = false,
    raf = 0,
    playing = false,
    closed = false;
  const focus = document.activeElement,
    mask = el("div", {
      class: "ai-scene-mask",
      dataset: { behaviorDialog: "1" },
    }),
    dialog = el("section", {
      class: "ai-scene-dialog",
      role: "dialog",
      "aria-modal": true,
      "aria-label": "多步骤行为与静态导航",
      tabindex: "-1",
      style: "width:min(1080px,96vw);max-height:94vh;overflow:auto",
    });
  const status = el("p", {
      class: "fnote",
      role: "status",
      "aria-live": "polite",
      dataset: { behaviorStatus: "1" },
    }),
    rows = el("div", { dataset: { behaviorSteps: "1" } }),
    host = el("div", { style: "min-width:0;width:100%" }),
    readout = note("预演不会改动场景人物、工程时长或撤销栈。");
  const slider = el("input", {
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    "aria-label": "候选预演秒数",
    dataset: { behaviorScrub: "1" },
    style: "width:100%",
  });
  const stop = () => {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const clear = () => {
    stop();
    preview?.dispose();
    preview = null;
    draft = null;
    w.discard();
    apply.disabled = true;
    slider.disabled = true;
    warnings.checked = false;
  };
  const change = () => {
    clear();
    status.textContent = "步骤或代理设置已改变，请重新预演。";
  };
  const run = async (fn) => {
    if (busy) return;
    stop();
    busy = true;
    dialog
      .querySelectorAll("input,select,button")
      .forEach((n) => (n.disabled = true));
    try {
      await fn();
    } catch (e) {
      status.textContent = "未完成：" + e.message;
    } finally {
      busy = false;
      if (!closed) {
        dialog
          .querySelectorAll("input,select,button")
          .forEach((n) => (n.disabled = false));
        apply.disabled = !draft;
        slider.disabled = !draft;
      }
    }
  };
  const button = (text, action, fn) =>
    el("button", {
      class: "fbtn",
      type: "button",
      text,
      dataset: { behaviorAction: action },
      onclick: fn,
    });
  const field = (label, node) =>
    el(
      "label",
      { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap" },
      [el("span", { text: label }), node],
    );
  const number = (value, label, fn, props = {}) =>
    el("input", {
      class: "num",
      type: "number",
      value,
      step: 0.1,
      "aria-label": label,
      style: "width:70px;min-width:0",
      ...props,
      onchange: (e) => {
        fn(e.target.valueAsNumber);
        change();
      },
    });
  function renderRows() {
    rows.replaceChildren();
    request.steps.forEach((s, i) => {
      const box = el("div", {
        style:
          "border:1px solid #384354;padding:10px;margin:6px 0;border-radius:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap",
        dataset: { behaviorStep: i },
      });
      const type = el(
        "select",
        {
          class: "sel",
          "aria-label": `第${i + 1}步类型`,
          onchange: (e) => {
            request.steps[i] =
              e.target.value === "move"
                ? {
                    type: "move",
                    anim: "walk",
                    seconds: s.seconds,
                    target: [so.root.position.x + 4, so.root.position.z],
                  }
                : { type: "act", anim: "idle", seconds: s.seconds };
            change();
            renderRows();
          },
        },
        [
          el("option", { value: "move", text: "移动" }),
          el("option", { value: "act", text: "停留／动作" }),
        ],
      );
      type.value = s.type;
      const anim = el(
        "select",
        {
          class: "sel",
          "aria-label": `第${i + 1}步动作`,
          onchange: (e) => {
            s.anim = e.target.value;
            change();
          },
        },
        (s.type === "move" ? MOVE_ANIMS : ACT_ANIMS).map((v) =>
          el("option", { value: v, text: names[v] }),
        ),
      );
      anim.value = s.anim;
      box.append(
        el("b", { text: String(i + 1) }),
        type,
        anim,
        field(
          "秒",
          number(s.seconds, `第${i + 1}步秒数`, (v) => (s.seconds = v), {
            min: 0.1,
            max: 60,
          }),
        ),
      );
      if (s.type === "move")
        for (const [k, label] of ["目标X", "目标Z"].entries())
          box.append(
            field(
              label,
              number(
                s.target[k],
                `第${i + 1}步${label}`,
                (v) => (s.target[k] = v),
                { min: -590, max: 590 },
              ),
            ),
          );
      else {
        const face = el("input", {
          type: "checkbox",
          checked: !!s.face,
          "aria-label": `第${i + 1}步指定朝向`,
          onchange: (e) => {
            if (e.target.checked)
              s.face = [so.root.position.x, so.root.position.z + 5];
            else delete s.face;
            change();
            renderRows();
          },
        });
        box.append(field("指定朝向点", face));
        if (s.face)
          for (const [k, label] of ["朝向X", "朝向Z"].entries())
            box.append(
              field(
                label,
                number(
                  s.face[k],
                  `第${i + 1}步${label}`,
                  (v) => (s.face[k] = v),
                  { min: -590, max: 590 },
                ),
              ),
            );
      }
      box.append(
        button("↑", `up-${i}`, () => {
          if (i > 0) {
            [request.steps[i - 1], request.steps[i]] = [
              s,
              request.steps[i - 1],
            ];
            change();
            renderRows();
          }
        }),
        button("删除", `delete-${i}`, () => {
          request.steps.splice(i, 1);
          change();
          renderRows();
        }),
      );
      rows.append(box);
    });
  }
  const settings = el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" });
  for (const [key, label, min, max] of [
    ["radius", "代理半径 m", 0.05, 2],
    ["height", "代理高度 m", 0.5, 5],
    ["cellSize", "网格间距 m", 0.25, 2],
    ["margin", "范围余量 m", 2, 30],
  ])
    settings.append(
      field(
        label,
        number(request[key], label, (v) => (request[key] = v), {
          min,
          max,
          step: key === "cellSize" ? 0.25 : 0.05,
        }),
      ),
    );
  const warnings = el("input", {
      type: "checkbox",
      dataset: { behaviorConfirm: "1" },
    }),
    extend = el("input", {
      type: "checkbox",
      dataset: { behaviorExtend: "1" },
    });
  const apply = button("确认应用（一步撤销）", "apply", () =>
    run(async () => {
      await w.apply({
        confirmedWarnings: warnings.checked,
        extendDuration: extend.checked,
      });
      status.textContent =
        "已应用，可关闭后播放或拖动时间轴；Ctrl+Z可一步撤销。";
      stop();
      draft = null;
      preview?.dispose();
      preview = null;
      host.replaceChildren();
    }),
  );
  apply.disabled = true;
  const sample = (t) => {
    if (!preview) return;
    const s = preview.at(t);
    readout.textContent = `${t.toFixed(2)} / ${draft.program.duration.toFixed(2)}秒 · 第${s.index + 1}步 ${names[s.anim]}${s.held ? " · 末态保持" : ""}。灰框为参与导航的平面障碍代理，非原场景精细模型。`;
  };
  slider.disabled = true;
  slider.addEventListener("input", () => {
    stop();
    sample(Number(slider.value));
  });
  const close = () => {
    if (busy) return;
    closed = true;
    clear();
    mask.remove();
    window.removeEventListener("keydown", keys, true);
    if (focus?.isConnected) focus.focus();
  };
  const keys = (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const nodes = [...dialog.querySelectorAll("button,input,select")].filter(
        (n) => !n.disabled && n.getClientRects().length,
      );
      if (nodes.length) {
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    }
  };
  dialog.append(
    el("h2", { text: "多步骤行为 · 静态导航首版" }),
    note(
      "仅库中单个人物、y=0平面。世界XZ目标，逐步秒数；折线路径在拐角即时转向，不做平滑穿角。预演独立，绝不自动应用。",
    ),
    settings,
    rows,
    el("div", { class: "btnrow" }, [
      button("+ 移动", "add-move", () => {
        if (request.steps.length >= 16) {
          status.textContent = "最多16步";
          return;
        }
        request.steps.push({
          type: "move",
          anim: "walk",
          seconds: 3,
          target: [so.root.position.x + 4, so.root.position.z + 4],
        });
        change();
        renderRows();
      }),
      button("+ 停留／动作", "add-act", () => {
        if (request.steps.length >= 16) {
          status.textContent = "最多16步";
          return;
        }
        request.steps.push({ type: "act", anim: "idle", seconds: 2 });
        change();
        renderRows();
      }),
      button("生成独立预演", "preview", () =>
        run(async () => {
          clear();
          const d = await w.preview(so.id, request);
          const current = app.byId(so.id);
          try {
            preview = new BehaviorPreview(host, d, current);
          } catch (e) {
            w.discard();
            throw e;
          }
          draft = d;
          slider.max = d.program.duration;
          slider.value = 0;
          sample(0);
          status.textContent = `候选：${d.program.request.steps.length}步 / ${d.program.duration.toFixed(1)}秒 / ${d.stats.points}路径点；静态AABB ${d.coverage.obstacles}，动态对象未检查 ${d.coverage.dynamic}，特效忽略 ${d.coverage.effects}。${d.program.duration > app.state.duration ? "应用时需要明确延长工程时间轴。" : ""}`;
        }),
      ),
    ]),
    status,
    host,
    readout,
    slider,
    el("div", { class: "btnrow" }, [
      button("播放／暂停候选", "play-preview", () => {
        if (!preview || busy) return;
        if (playing) {
          stop();
          return;
        }
        playing = true;
        let last = performance.now();
        const tick = (now) => {
          if (!playing || !preview || closed) return;
          const t = Number(slider.value) + (now - last) / 1000;
          last = now;
          slider.value = t > draft.program.duration ? 0 : t;
          sample(Number(slider.value));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }),
      button("丢弃候选", "discard", () => {
        clear();
        host.replaceChildren();
        status.textContent = "候选已丢弃，现场未改动。";
      }),
    ]),
    field(
      "我理解：只检查确认时的静态AABB与输入代理；不检查动态避让、四肢接触、脚滑、水域、台阶与地面支撑，修改场景需重新预演。",
      warnings,
    ),
    field("行为超出工程时长时，同意延长时间轴（不会缩短原工程）。", extend),
    el("div", { class: "btnrow" }, [
      apply,
      button("移除现有方案", "remove", () =>
        run(() => {
          if (!hasBehavior(app.byId(so.id))) throw Error("当前人物没有方案");
          if (
            !confirm(
              "移除该人物的行为与生成路径，保留当前姿态位置，之后可重新编辑变换；可一步撤销。继续？",
            )
          )
            return;
          w.remove(so.id, { confirmed: true });
          clear();
          status.textContent = "已移除方案；可关闭后编辑人物起点或参数。";
        }),
      ),
      button("关闭", "close", close),
    ]),
  );
  mask.append(dialog);
  document.body.append(mask);
  renderRows();
  window.addEventListener("keydown", keys, true);
  dialog.focus();
}
