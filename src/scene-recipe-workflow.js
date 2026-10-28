import { inspectSceneRelations } from "./scene-relations.js";
import { subjectRuntime, restoreSubjects } from "./scene-runtime.js";
import { applySceneData } from "./scenes.js";
import { validateRecipeScene } from "./scene-recipes.js";
// Whole-scene trusted local recipes only. Does not broaden the AI v1 contract.
export function applySceneRecipe(app, plan, prompt = "") {
  if (app.aiScene) app.aiScene.checkIdle();
  if (
    app.aiScene?.busy ||
    app.exporter?.running ||
    app.reference?.busy ||
    app.stage.exportOwner ||
    app.terrain.workflow.busy ||
    app.terrain.workflow.erosionPreview ||
    app.roadBrush.active ||
    app.roadBrush._editBackup ||
    app.vegetationBrush.active
  )
    throw Error("请先结束导出、AI、地形或道路编辑任务");
  const checks = validateRecipeScene(plan.scene); // recompute, never trust stored reports
  const before = JSON.parse(JSON.stringify(app.serialize({ assets: false })));
  if (JSON.stringify(before).length > 12e6)
    throw Error("当前工程超过12MB撤销保护，请先保存并拆分工程");
  const runtime = subjectRuntime(app),
    state = { ...app.state },
    selection = app.sel?.kind === "obj" ? app.sel.so.id : null;
  const oldTick = app.tick;
  let success = false;
  const undo = [...(app._undo || [])],
    redo = [...(app._redo || [])],
    bytes = app._undoBytes;
  const flags = {
    quiet: app._quietAdd,
    suspended: app.suspended,
    time: app.state.time,
    preview: app.state.preview,
    playing: app.state.playing,
  };
  const t = performance.now();
  app.sceneRecipeBusy = true;
  app.tick = () => {};
  app._quietAdd = true;
  app.suspended = true;
  try {
    applySceneData(app, plan.scene);
    if (app.sceneReport.missing || app.sceneReport.targetMiss)
      throw Error("资产/机位引用缺失");
    app.sceneGeneration = {
      version: 1,
      kind: plan.kind,
      options: { ...plan.options },
      factory: { ...plan.factory },
      prompt: String(prompt).slice(0, 2000),
      checks,
      relations: inspectSceneRelations(plan.scene).graph,
    };
    app._redo = [];
    app._redoAvail = 0;
    app.step(0, true);
    app.weather.update(0, app.stage.view.position);
    app.stage.render();
    success = true;
    return {
      recipe: true,
      label: plan.scene.name,
      schema: { ...plan.options, mapSize: plan.options.size },
      ...plan.summary,
      warnings: [...plan.warnings],
      checks,
      ms: Math.round(performance.now() - t),
    };
  } catch (error) {
    try {
      app.loadJson(before);
      Object.assign(app.state, state);
      app.state.time = flags.time;
      app.state.playing = flags.playing;
      app.setPreview(flags.preview);
      app.step(0, true);
      // loadJson samples rounded motion keys; restore exact source transforms
      // after sampling so a failed generation cannot move objects by a millimetre.
      for (const saved of before.objects) {
        const so = app.byId(saved.id);
        if (so && saved.pos) {
          so.root.position.fromArray(saved.pos);
          so.root.rotation.set(...saved.rot);
          so.root.scale.fromArray(saved.scale);
        }
      }
      app.stage.view.position.fromArray(before.view.pos);
      app.stage.orbit.target.fromArray(before.view.target);
      restoreSubjects(app, runtime);
      if (selection && app.byId(selection))
        app.select({ kind: "obj", so: app.byId(selection) });
    } catch (restoreError) {
      throw new Error(
        "生成失败且恢复失败，请打开已保存工程：" + restoreError.message,
        { cause: error },
      );
    } finally {
      app._undo = undo;
      app._redo = redo;
      app._undoBytes = bytes;
      app._undoAvail = undo.length;
      app._redoAvail = redo.length;
      app.bus.emit("undoable");
    }
    throw error;
  } finally {
    app.sceneRecipeBusy = false;
    app.tick = oldTick;
    if (success) app.saveLocal();
    app._quietAdd = flags.quiet;
    app.suspended = flags.suspended;
  }
}
