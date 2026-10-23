import { DESKTOP_BUILD, isDesktopShell } from "./desktop-runtime.js";
import {
  conversationInstruction as instruction,
  readConversationReply,
  terrainAuthorization,
  ModelToolError,
} from "./local-scene-tools.js";
import { terrainSummary } from "./local-scene-terrain.js";
import { uid } from "./util.js";

export const nativeLocalModel = {
  async call(command, args = {}) {
    if (!DESKTOP_BUILD || !isDesktopShell())
      throw Error(
        "本地模型仅在完整 Windows 桌面程序中可用，浏览器预检不会启动模型。",
      );
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke(command, args);
    } catch (e) {
      throw Error(typeof e === "string" ? e : e?.message || "本地模型调用失败");
    }
  },
  status() {
    return this.call("local_ai_status");
  },
  openFolder() {
    return this.call("local_ai_open_folder");
  },
  stop() {
    return this.call("local_ai_stop");
  },
  chat(model, messages, cpuOnly) {
    return this.call("local_ai_chat", { model, messages, cpuOnly });
  },
};
function messagesFor(
  workpack,
  prompt,
  history,
  recentIds,
  terrain,
  authorization,
) {
  const text = prompt.toLowerCase();
  const grams = new Set(
    (text.match(/[\p{L}\p{N}]+/gu) || []).flatMap((s) => [
      s,
      ...Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
        s.slice(i, i + 2),
      ),
    ]),
  );
  const catalog = workpack.catalog;
  const ranked = catalog
    .map((a) => ({
      a,
      score: [...grams].reduce(
        (n, s) =>
          n +
          (s.length > 1 && (a.name + " " + a.category).toLowerCase().includes(s)
            ? s.length
            : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const existing = new Set(
    workpack.objects.filter((o) => recentIds.includes(o.id)).map((o) => o.key),
  );
  const details = ranked
    .filter((x) => x.score > 0 || existing.has(x.a.key))
    .slice(0, 12)
    .map(({ a }) => ({
      key: a.key,
      parameters: a.parameters,
      defaults: a.defaultParameters,
    }));
  const scene = {
    bounds: workpack.bounds,
    objects: workpack.objects.map((o) => ({
      id: o.id,
      name: o.name,
      key: o.key,
      type: o.type,
      road: o.road,
      locked: o.locked,
      position: o.position,
      rotationY: o.rotation?.[1] || 0,
      scale: o.scale,
      parameters: existing.has(o.key) ? o.parameters : undefined,
    })),
    recentIds,
    terrain: {
      ...terrain,
      coarseHeights: workpack.terrain.coarseHeights,
      coarseBounds: workpack.bounds,
    },
  };
  const data = {
    request: prompt,
    ...authorization,
    history: history
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 1200) })),
    scene,
    catalog: catalog.map((a) => ({ key: a.key, name: a.name })),
    parameterDetails: details,
  };
  const content = JSON.stringify(data);
  if (
    new TextEncoder().encode(content).length >
    Math.min(52000, 60000 - new TextEncoder().encode(instruction).length)
  )
    throw Error("场景上下文过大，请先缩小工程或分场景处理。");
  return [
    { role: "system", content: instruction },
    { role: "user", content },
  ];
}

export class LocalSceneConversation {
  constructor(app, runtime = nativeLocalModel) {
    this.app = app;
    this.runtime = runtime;
    this.messages = [];
    this.recentIds = [];
    this.busy = false;
    this.serial = 0;
  }
  async cancel() {
    if (this.committing)
      throw Error("正在提交场景，完成后可撤销；此时不能中断。");
    this.serial++;
    this.app.aiScene.cancel();
    await this.runtime.stop();
  }
  async send(
    prompt,
    {
      model,
      cpuOnly = false,
      confirm = () => Promise.resolve(false),
      progress = () => {},
    } = {},
  ) {
    prompt = String(prompt).trim();
    if (!prompt || prompt.length > 2000)
      throw Error("请输入1–2000字的场景要求。");
    if (this.busy) throw Error("正在处理上一句话，请等待或停止。");
    if (!model) throw Error("请先将 GGUF 模型放入 models 文件夹并刷新。");
    const a = this.app,
      w = a.aiScene;
    w.checkIdle();
    this.busy = true;
    const serial = ++this.serial;
    const check = () => {
      if (serial !== this.serial) throw Error("已停止，本次回复不应用。");
    };
    const root = document.getElementById("app"),
      inert = root?.inert;
    if (root) root.inert = true;
    this.messages.push({ role: "user", text: prompt });
    try {
      progress("加载本地模型并理解需求…首次加载可能需要几分钟");
      const eligible = a.objects.filter(
        (o) =>
          (o.key || o.type === "road_brush") &&
          !o.locked &&
          !["road_intersection", "vegetation_patch"].includes(o.type),
      );
      const permissions = {
        mode: eligible.length ? "edit" : "add",
        editableIds: eligible.map((o) => o.id),
        preserveTerrain: true,
        allowReplace: false,
        conversational: true,
        bounds: { center: [0, 0], size: [600, 600] },
      };
      const context = await w.context(permissions);
      check();
      const authorization = terrainAuthorization(prompt, this.recentTerrain);
      const messages = messagesFor(
        context,
        prompt,
        this.messages.slice(0, -1),
        this.recentIds,
        terrainSummary(a.terrain),
        authorization,
      );
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await this.runtime.chat(model, messages, cpuOnly);
        check();
        try {
          data = readConversationReply(
            response,
            context.catalog,
            authorization,
          );
          break;
        } catch (e) {
          if (attempt || !(e instanceof ModelToolError)) throw e;
          progress("模型返回的工具指令无效，正在自动纠正一次…场景尚未改变");
          const previous = new TextDecoder().decode(
            new TextEncoder().encode(response).slice(0, 1500),
          );
          messages.push(
            { role: "assistant", content: previous },
            {
              role: "user",
              content:
                "上一条返回无效：" +
                e.message.slice(0, 400) +
                "。请严格按原始request、catalog和工具协议修正，只返回JSON；不要替换为默认场景，不要添加未请求的河流或地形。",
            },
          );
          if (
            messages.reduce(
              (n, m) => n + new TextEncoder().encode(m.content).length,
              0,
            ) > 64000
          )
            throw e;
        }
      }
      if (data.unsupported) throw Error(data.unsupported);
      if (!data.operations.length && !data.terrain) {
        const result = {
          text: data.reply || "请进一步描述场景要求。",
          changed: false,
        };
        this.messages.push({ role: "assistant", text: result.text });
        return result;
      }
      const operations = data.operations;
      if (data.terrain) permissions.conversationTerrain = data.terrain;
      const plan = {
        schema: "previz-ai-scene/1",
        id: uid("chat_"),
        name: prompt.slice(0, 100),
        baseFingerprint: context.baseFingerprint,
        mode: permissions.mode,
        bounds: context.bounds,
        seed: 12345,
        terrain: "preserve",
        durationSeconds: context.durationSeconds,
        operations,
      };
      progress("正在搭建场景…");
      const draft = await w.prepare(plan, permissions);
      check();
      const removed = draft.changes.removed.length;
      const confirmations = [];
      if (
        removed > 0 &&
        (removed === a.objects.length ||
          (removed >= 3 && removed >= a.objects.length / 2))
      )
        confirmations.push(
          `删除 ${removed} 个物体（清空或不少于当前场景一半）`,
        );
      if (draft.changes.terrain?.overwrite)
        confirmations.push(
          "重新生成并覆盖当前地形高度/手绘地表材质，现有河道将重新刻蚀",
        );
      if (confirmations.length) {
        const approved = await confirm(
          "本轮将" + confirmations.join("；") + "。是否继续？整轮可撤销。",
        );
        check();
        if (!approved) {
          w.discard();
          const result = {
            text: "已取消本轮修改，场景没有改变。",
            changed: false,
          };
          this.messages.push({ role: "assistant", text: result.text });
          return result;
        }
      }
      const warningCount = draft.warnings.length;
      const notices = draft.warnings
        .filter((s) => /河道|沟槽|地形|世界高度|贴地/.test(s))
        .slice(0, 3);
      check();
      this.committing = true;
      progress("正在提交修改，请稍候…");
      const applied = await w.apply({ acceptWarnings: true });
      this.recentIds = [...applied.changes.added, ...applied.changes.modified];
      this.recentTerrain = data.terrain?.rivers?.length
        ? "river"
        : data.terrain?.water
          ? "water"
          : data.terrain
            ? "terrain"
            : false;
      const text = `${data.reply}\n已完成：新增 ${applied.changes.added.length}，调整 ${applied.changes.modified.length}，删除 ${applied.changes.removed.length}。${applied.changes.terrain ? " 地形：" + applied.changes.terrain.actions.join("、") + "。" : ""}${warningCount ? " 有 " + warningCount + " 条布局提示。" : ""} 可撤销。${notices.length ? "\n提示：" + notices.join("；") : ""}`;
      this.messages.push({ role: "assistant", text });
      this.messages = this.messages.slice(-20);
      return { text, changed: true, warnings: applied.warnings };
    } catch (e) {
      if (!w.busy && w.draft) w.discard();
      this.messages.push({ role: "assistant", text: "未完成：" + e.message });
      throw e;
    } finally {
      this.messages = this.messages.slice(-20);
      this.committing = false;
      this.busy = false;
      if (root) root.inert = inert;
    }
  }
}
