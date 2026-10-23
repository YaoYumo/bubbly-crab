import {
  lowerAISceneRelations,
  checkAIRelationClearance,
} from "./ai-scene-relations.js";
import { subjectRuntime, restoreSubjects } from "./scene-runtime.js";
import * as THREE from "three";
import { AI_SCENE_JSON_SCHEMA } from "./ai-scene-schema.js";
import { defaultsFor } from "./assets.js";
import { Shot } from "./camera.js";
import { autoCamera } from "./autocam.js";
import {
  AI_SCENE_SCHEMA,
  validateEnvelope,
  mergeLayoutRelations,
  exact,
  record,
  finite,
  vec,
  ident,
  inBounds,
  cloneData,
  MAX_OPS,
} from "./ai-scene-format.js";
import {
  makeAsset,
  validateAsset,
  catalogEntries,
  releaseCandidate,
} from "./ai-scene-catalog.js";
import { expandRecipe, townThemes } from "./ai-scene-recipes.js";
import { canonical, sha256 } from "./reference-format.js";
const pause = () => new Promise((r) => setTimeout(r, 0));
const fingerprint = (app) =>
  sha256(canonical(app.serialize({ assets: false })));
export class AISceneWorkflow {
  constructor(app) {
    this.app = app;
    this.busy = false;
    this.draft = null;
    this.lastApplied = null;
  }
  checkIdle() {
    const a = this.app;
    if (
      this.busy ||
      a.behaviors?.busy ||
      a.state.playing ||
      a.exporter?.running ||
      a.reference?.busy ||
      a.stage.exportOwner ||
      a.terrain.workflow.busy ||
      a.terrain.workflow.erosionPreview ||
      a.roadBrush.active ||
      a.roadBrush._editBackup ||
      a.vegetationBrush.active
    )
      throw Error(
        "请先停止播放、导出、道路 / 植被编辑和地形任务，并应用或放弃侵蚀预览",
      );
  }
  cancel() {
    this.controller?.abort(new DOMException("AI搭景任务已取消", "AbortError"));
  }
  discard() {
    if (this.busy) throw Error("请先取消正在进行的任务");
    if (this.draft)
      for (const r of this.draft.roots.values()) releaseCandidate(r);
    this.draft = null;
    this.app.bus.emit("ai-scene-draft");
  }
  async context({
    mode = "add",
    editableIds = [],
    bounds = { center: [0, 0], size: [192, 192] },
    preserveTerrain = true,
    allowReplace = false,
  } = {}) {
    this.checkIdle();
    if (!["add", "edit", "replace"].includes(mode)) throw Error("模式无效");
    exact(bounds, ["center", "size"], "范围");
    vec(bounds.center, 2, -500, 500, "范围中心");
    vec(bounds.size, 2, 10, 600, "范围尺寸");
    for (let i = 0; i < 2; i++)
      if (Math.abs(bounds.center[i]) + bounds.size[i] / 2 > 600)
        throw Error("范围超出世界±600m");
    finite(this.app.state.duration, 0.2, 30, "首版AI搭景支持的全局时长");
    if (mode === "edit" && !editableIds.length)
      throw Error("请先选择允许修改的库资产");
    if (
      mode === "replace" &&
      (!allowReplace || this.app.objects.some((o) => o.locked))
    )
      throw Error("替换需明确授权且不能有锁定对象");
    if (!preserveTerrain && mode !== "replace")
      throw Error("只有替换模式才可关闭地形");
    await this.app.projectAssets.ready();
    const a = this.app,
      source = cloneData(a.serialize({ assets: false }));
    if (JSON.stringify(source).length > 12e6)
      throw Error(
        "当前工程超过12MB撤销快照保护，首版AI应用已禁用；请先拆分并备份工程",
      );
    a.stage.scene.updateMatrixWorld(true);
    const summaries = a.objects
      .filter((o) => o.type !== "road_intersection")
      .map((o) => {
        const box = new THREE.Box3().setFromObject(o.root),
          data = {
            id: o.id,
            name: o.name,
            key: o.key,
            type: o.type,
            locked: o.locked,
            position: o.root.position.toArray(),
            rotation: o.root.rotation.toArray(),
            scale: o.root.scale.toArray(),
            bounds: box.isEmpty()
              ? null
              : { min: box.min.toArray(), max: box.max.toArray() },
          };
        if (o.key) data.parameters = cloneData(o.params);
        const saved = o.serialize();
        if (o.type === "road_brush")
          data.road = {
            points: saved.points,
            width: saved.width,
            roadType: saved.roadType,
          };
        if (o.motion?.active)
          data.motion = {
            anim: o.motion.anim,
            pointsSeconds: (o.motion.keys || []).map((k) => [
              k.t * a.state.duration,
              ...k.p,
            ]),
          };
        return data;
      });
    const workpack = {
      schema: "previz-ai-workpack/1",
      units: "meters, Y-up, radians, motion times in seconds",
      baseFingerprint: null,
      permissions: { mode, editableIds, preserveTerrain, allowReplace },
      bounds,
      terrain: {
        enabled: a.terrain.enabled,
        size: a.terrain.size,
        coarseHeights: Array.from({ length: 9 }, (_, z) =>
          Array.from({ length: 9 }, (_, x) =>
            a.terrain.enabled
              ? a.terrain.heightAt(
                  bounds.center[0] + (x / 8 - 0.5) * bounds.size[0],
                  bounds.center[1] + (z / 8 - 0.5) * bounds.size[1],
                )
              : 0,
          ),
        ),
        note: "9x9 rows Z then columns X across bounds; coarse only. Use add placement:ground for exact local terrain sampling; pos.y is offset in ground mode, world Y in absolute mode.",
      },
      durationSeconds: a.state.duration,
      objects: summaries,
      catalog: catalogEntries(),
      blueprintJSONSchema: AI_SCENE_JSON_SCHEMA,
      blueprintContract: {
        schema: AI_SCENE_SCHEMA,
        rootFields: [
          "id",
          "baseFingerprint",
          "name",
          "mode",
          "bounds",
          "seed",
          "terrain",
          "durationSeconds",
          "operations OR recipe",
          "previs(optional)",
          "relations(optional; version:1,rules)",
        ],
        operations: {
          add: [
            "id",
            "key",
            "pos",
            "rotationY(optional)",
            "scale(optional)",
            "placement:ground|absolute(optional; default absolute)",
            "params(optional)",
            "fit(optional)",
          ],
          transform: [
            "objectId",
            "pos",
            "rotationY(optional)",
            "scale(optional)",
          ],
          rebuild: [
            "objectId",
            "params(partial whitelist; nonempty)",
            "pos(optional)",
            "rotationY(optional)",
            "scale(optional)",
          ],
          remove: ["objectId"],
          road: ["id", "points", "width", "roadType", "name(optional)"],
        },
        relations: {
          version: 1,
          maxRules: 128,
          rules: {
            offset: [
              "subject",
              "reference",
              "delta:[x,y,z]",
              "frame:world|local",
            ],
            face: ["subject", "target:stable object ID"],
            distance: ["subject", "target:stable object ID", "min", "max"],
            "keep-out": ["subject", "obstacle", "margin"],
          },
          instruction:
            "Explicit operations only, no recipe. Relations reference stable IDs of static library assets, not names or semantic doors. +X east, +Z south; +Z model forward. offset places a pivot relative to the reference pivot; local delta is [right,up,forward] in reference yaw. face aims model +Z toward target pivot. One offset plus one face per subject is allowed. Checks distance (3D pivot) and keep-out (final planar conservative AABB) reject unmet constraints; never auto-find a solution. No walking subjects, terrain-follow, arbitrary mesh anchors or persistent parenting. New add subjects can use placeholder pos; relations are lowered before geometry checks. Existing write subjects require edit mode, editableIds and no locks. Existing references can be read-only/locked. Specify explicit Y; offset Y is not terrain projection.",
        },
        recipes: {
          template: ["street", "plaza", "boulevard"],
          town: {
            themes: townThemes,
            topology: ["grid", "axis", "radial", "spine_and_loop"],
            density: "0..1",
            vegetation: "0..1",
            size: "square128–384m,multiple64; small/dense layouts can have no parcels and will be refused",
          },
        },
        instruction:
          'Return ONLY a JSON blueprint, not JavaScript, no invented asset keys, IDs or semantic entrance anchors; use the supplied fingerprint, permissions, bounds and duration. Template example: recipe:{kind:"template",template:"plaza"}. Explicit operations carry op:add/transform/rebuild/remove/road. terrain is preserve or flat (replace only). Stable object IDs, never array indices. Unsupported requests must be explained, not silently changed into a town.',
      },
    };
    workpack.baseFingerprint = await sha256(canonical(source));
    if ((await fingerprint(a)) !== workpack.baseFingerprint)
      throw Error("导出工作包期间工程已变化，请重试");
    return workpack;
  }
  async localPlan(options, recipe) {
    if (options.mode === "edit")
      throw Error(
        "局部模式请导出工作包或手写transform/rebuild/remove蓝图；本地配方只用于添加/替换",
      );
    const ctx = await this.context(options);
    return {
      schema: AI_SCENE_SCHEMA,
      id: "ai-" + crypto.randomUUID(),
      baseFingerprint: ctx.baseFingerprint,
      name: "本地配方候选（未调用AI）",
      mode: ctx.permissions.mode,
      bounds: ctx.bounds,
      seed: 12345,
      terrain: ctx.permissions.preserveTerrain ? "preserve" : "flat",
      durationSeconds: ctx.durationSeconds,
      recipe,
    };
  }
  async prepare(input, permissions, onProgress = () => {}) {
    this.checkIdle();
    const p = validateEnvelope(cloneData(input)),
      a = this.app;
    if (!permissions || p.mode !== permissions.mode)
      throw Error("蓝图模式与用户授权不一致");
    if (permissions.preserveTerrain !== false && p.terrain !== "preserve")
      throw Error("用户要求保留地形");
    if (
      permissions.bounds &&
      canonical(p.bounds) !== canonical(permissions.bounds)
    )
      throw Error("蓝图范围与用户授权不一致");
    if (p.mode !== "replace" && p.durationSeconds !== a.state.duration)
      throw Error("增量模式不能改变原全局时间轴时长");
    if (p.mode === "edit" && p.recipe)
      throw Error("局部模式不允许配方新增，请使用transform/rebuild/remove操作");
    if (p.mode === "edit" && !permissions.editableIds?.length)
      throw Error("局部修改请先选择允许修改的对象");
    this.busy = true;
    this.controller = new AbortController();
    const signal = this.controller.signal,
      suspended = a.suspended;
    a.suspended = true;
    const roots = new Map(),
      warnings = [],
      changes = { added: [], modified: [], removed: [] },
      sourceBoxes = new Map();
    try {
      await a.projectAssets.ready();
      signal.throwIfAborted();
      const before = cloneData(a.serialize({ assets: false })),
        base = await sha256(canonical(before));
      if (p.baseFingerprint !== base)
        throw Error("工程已变化，请重新导出工作包 / 生成方案");
      const protectedIds = new Set([
        ...before.objects.filter((o) => o.locked).map((o) => o.id),
        ...(permissions.protectedIds || []),
      ]);
      if (
        p.mode === "replace" &&
        (!permissions.allowReplace || protectedIds.size)
      )
        throw Error("替换需明确授权，且不能含锁定 / 保护对象");
      a.stage.scene.updateMatrixWorld(true);
      for (const o of a.objects)
        if (o.root.visible && o.type !== "road_intersection")
          sourceBoxes.set(o.id, new THREE.Box3().setFromObject(o.root));
      const doc = cloneData(before);
      if (p.mode === "replace") {
        changes.removed = before.objects
          .filter((o) => o.type !== "road_intersection")
          .map((o) => o.id);
        doc.objects = [];
        doc.shots = [];
        doc.activeShot = null;
        doc.name = p.name;
        doc.state.duration = p.durationSeconds;
      }
      if (p.terrain === "flat" && doc.terrain) doc.terrain.enabled = false;
      if (p.mode === "replace") delete doc.layoutRelations;
      if (p.relations) {
        doc.layoutRelations = mergeLayoutRelations(
          doc.layoutRelations,
          p.relations,
        );
      }
      const expanded = p.recipe
        ? expandRecipe(p, (x, z) =>
            a.terrain.enabled ? a.terrain.heightAt(x, z) : 0,
          )
        : { operations: p.operations, warnings: [] };
      const lowered = lowerAISceneRelations({
        plan: p,
        operations: expanded.operations,
        objects: doc.objects,
        permissions,
        protectedIds,
        heightAt: (x, z) =>
          p.terrain !== "flat" && a.terrain.enabled
            ? a.terrain.heightAt(x, z)
            : 0,
      });
      expanded.operations = lowered.operations;
      if (p.relations) {
        changes.relations = lowered.summaries;
        warnings.push(
          "空间关系为一次性静态布局，不会持续跟随宿主；+X东、+Z南，面向按模型+Z轴，非语义门口。距离约束只校验，不自动找位；留空为平面保守AABB。",
        );
      }
      warnings.push(...expanded.warnings);
      if (expanded.operations.length > MAX_OPS)
        throw Error("生成操作超过180个预算");
      const ids = new Set(doc.objects.map((o) => o.id)),
        touched = new Set();
      let triangles = 0;
      const mutable = (id) => {
        ident(id);
        const o = doc.objects.find((o) => o.id === id);
        if (!o) throw Error("引用对象不存在：" + id);
        if (
          p.mode === "add" ||
          protectedIds.has(id) ||
          (p.mode === "edit" && !permissions.editableIds.includes(id))
        )
          throw Error("无权修改对象：" + id);
        if (!o.key || o.type === "road_brush")
          throw Error(
            "首版仅允许变换 / 删除库资产，不编辑道路、植被patch或导入模型",
          );
        if (!inBounds(o.pos, p.bounds))
          throw Error("修改对象不在授权范围内：" + id);
        return o;
      };
      for (let i = 0; i < expanded.operations.length; i++) {
        signal.throwIfAborted();
        const op = record(expanded.operations[i], "操作");
        if (
          op.name != null &&
          (typeof op.name !== "string" ||
            !op.name.trim() ||
            op.name.length > 120)
        )
          throw Error("对象名称需1–120字符");
        if (op.op === "add" || op.op === "road") {
          if (p.mode === "edit" && permissions.conversational !== true)
            throw Error(
              "局部模式只允许变换/重建/删除授权对象，不允许新增对象或道路",
            );
          ident(op.id);
          if (ids.has(op.id)) throw Error("对象ID重复：" + op.id);
          ids.add(op.id);
          if (op.op === "road") {
            exact(
              op,
              ["op", "id", "name", "points", "width", "roadType"],
              "道路",
            );
            finite(op.width, 2, 20, "路宽");
            if (
              !["asphalt", "concrete", "gravel", "garden"].includes(op.roadType)
            )
              throw Error("道路类型无效");
            if (
              a.objects.some(
                (o) =>
                  protectedIds.has(o.id) &&
                  ["road_brush", "road_intersection"].includes(o.type),
              )
            )
              throw Error("新增道路会重算路口，不能触及锁定 / 保护路网");
            if (
              !Array.isArray(op.points) ||
              op.points.length < 2 ||
              op.points.length > 128
            )
              throw Error("道路需2–128点");
            let distance = 0;
            op.points.forEach((v, n) => {
              vec(v, 3, -600, 600, "道路点");
              if (!inBounds(v, p.bounds)) throw Error("道路点超出范围");
              if (n)
                distance += new THREE.Vector3(...v).distanceTo(
                  new THREE.Vector3(...op.points[n - 1]),
                );
            });
            if (distance < 1) throw Error("道路长度不足");
            const road = {
              id: op.id,
              name: String(op.name || "AI道路").slice(0, 120),
              type: "road_brush",
              points: op.points,
              width: op.width,
              roadType: op.roadType,
              fillet: false,
              visible: true,
              locked: false,
              terrainMode: "follow",
              terrainOffset: 0.02,
            };
            // Check a conservative corridor against protected objects before touching the live road registry.
            for (const [id, box] of sourceBoxes)
              if (protectedIds.has(id)) {
                const corridor = box.clone().expandByScalar(op.width / 2);
                corridor.min.y = -10000;
                corridor.max.y = 10000;
                for (let j = 1; j < op.points.length; j++) {
                  const start = new THREE.Vector3(...op.points[j - 1]),
                    end = new THREE.Vector3(...op.points[j]),
                    delta = end.clone().sub(start),
                    hit = new THREE.Ray(
                      start,
                      delta.clone().normalize(),
                    ).intersectBox(corridor, new THREE.Vector3());
                  if (
                    corridor.containsPoint(start) ||
                    (hit && hit.distanceTo(start) <= delta.length())
                  )
                    throw Error("新道路进入保护对象：" + id);
                }
              }
            doc.objects.push(road);
            changes.added.push(op.id);
            continue;
          }
          exact(
            op,
            [
              "op",
              "id",
              "name",
              "key",
              "params",
              "pos",
              "rotationY",
              "scale",
              "fit",
              "placement",
            ],
            "新增",
          );
          const item = validateAsset(op.key, op.params || {});
          vec(op.pos, 3, -600, 600, "位置");
          if (
            op.placement != null &&
            !["ground", "absolute"].includes(op.placement)
          )
            throw Error("placement需要ground/absolute");
          finite(op.rotationY ?? 0, -32, 32, "朝向");
          if (op.scale) vec(op.scale, 3, 0.05, 10, "缩放");
          if (op.fit) vec(op.fit, 2, 1, 100, "占地");
          doc.objects.push({
            id: op.id,
            name: String(op.name || item.name).slice(0, 120),
            key: op.key,
            type: item.type,
            params: { ...defaultsFor(item), ...(op.params || {}) },
            pos: [
              op.pos[0],
              op.pos[1] +
                (op.placement === "ground" &&
                p.terrain !== "flat" &&
                a.terrain.enabled
                  ? a.terrain.heightAt(op.pos[0], op.pos[2])
                  : 0),
              op.pos[2],
            ],
            rot: [0, op.rotationY || 0, 0],
            scale: op.scale || [1, 1, 1],
            visible: true,
            locked: false,
            followTerrain: false,
          });
          changes.added.push(op.id);
        } else if (
          op.op === "transform" ||
          op.op === "remove" ||
          op.op === "rebuild"
        ) {
          exact(
            op,
            op.op === "remove"
              ? ["op", "objectId"]
              : op.op === "rebuild"
                ? ["op", "objectId", "pos", "rotationY", "scale", "params"]
                : ["op", "objectId", "pos", "rotationY", "scale"],
            "修改",
          );
          const o = mutable(op.objectId);
          if (touched.has(o.id)) throw Error("同一对象重复修改");
          touched.add(o.id);
          if (op.op === "remove") {
            doc.objects = doc.objects.filter((v) => v.id !== o.id);
            changes.removed.push(o.id);
            for (const s of doc.shots)
              if (s.targetId === o.id) {
                s.targetId = null;
                warnings.push(`删除主体将清除机位${s.id}的主体引用`);
              }
          } else {
            if (op.op === "rebuild") {
              validateAsset(o.key, op.params);
              if (!Object.keys(op.params).length)
                throw Error("参数重建至少需要一个声明参数");
              o.params = { ...o.params, ...op.params };
              if (op.params.anim && o.motion) o.motion.anim = op.params.anim;
              warnings.push(
                `${o.name}按白名单参数局部重建，保留ID/走位；人物姿态与部件选面需复查`,
              );
            }
            if (op.op === "transform" || op.pos != null)
              o.pos = vec(op.pos, 3, -600, 600, "位置");
            if (op.rotationY != null)
              o.rot[1] = finite(op.rotationY, -32, 32, "朝向");
            if (op.scale) o.scale = vec(op.scale, 3, 0.05, 10, "缩放");
            changes.modified.push(o.id);
          }
        } else throw Error("未知操作：" + op.op);
        const o = doc.objects.find((v) => v.id === (op.id || op.objectId));
        if (!o) continue;
        const root = makeAsset(o.key, o.params, {
          trustedSource: changes.modified.includes(o.id),
        });
        roots.set(o.id, root);
        root.position.fromArray(o.pos);
        root.rotation.fromArray(o.rot);
        root.scale.fromArray(o.scale);
        root.updateMatrixWorld(true);
        if (op.fit) {
          const size = new THREE.Box3()
              .setFromObject(root)
              .getSize(new THREE.Vector3()),
            k = Math.min(
              1,
              op.fit[0] / Math.max(0.01, size.x),
              op.fit[1] / Math.max(0.01, size.z),
            );
          if (k < 0.05) throw Error("资产无法合理缩放到地块");
          root.scale.multiplyScalar(k);
          o.scale = root.scale.toArray();
          root.updateMatrixWorld(true);
        }
        const box = new THREE.Box3().setFromObject(root);
        if (box.isEmpty()) throw Error("资产几何为空");
        if (
          p.terrain !== "flat" &&
          a.terrain.enabled &&
          Math.abs(o.pos[1] - a.terrain.heightAt(o.pos[0], o.pos[2])) > 0.25
        )
          warnings.push(
            `${o.name}离中心地表较远：请检查absolute位置 / 悬空，或使用placement:ground`,
          );
        if (p.terrain !== "flat" && a.terrain.enabled) {
          const hs = [
            [box.min.x, box.min.z],
            [box.min.x, box.max.z],
            [box.max.x, box.min.z],
            [box.max.x, box.max.z],
          ].map(([x, z]) => a.terrain.heightAt(x, z));
          if (Math.max(...hs) - Math.min(...hs) > 0.5)
            warnings.push(
              `${o.name}占地地表起伏较大：可能悬空/穿坡，未自动找平`,
            );
        }
        if (
          !inBounds(box.min.toArray(), p.bounds) ||
          !inBounds(box.max.toArray(), p.bounds)
        )
          throw Error("资产占地超出授权范围：" + o.name);
        for (const [id, other] of sourceBoxes)
          if (
            id !== o.id &&
            !changes.removed.includes(id) &&
            box.intersectsBox(other)
          ) {
            if (protectedIds.has(id))
              throw Error("资产进入保护对象包围盒：" + id);
            warnings.push(`可能与原对象${id}重叠（保守AABB）`);
          }
        for (const [id, other] of roots)
          if (
            id !== o.id &&
            box.intersectsBox(new THREE.Box3().setFromObject(other))
          )
            warnings.push(`候选对象${o.id}与${id}可能重叠（保守AABB）`);
        root.traverse((n) => {
          if (n.isMesh)
            triangles +=
              ((n.geometry?.index?.count ||
                n.geometry?.attributes.position?.count ||
                0) /
                3) *
              (n.isInstancedMesh ? n.count : 1);
        });
        if (triangles > 2000000) throw Error("候选资产超过200万三角形预算");
        onProgress({ i: i + 1, total: expanded.operations.length });
        if (i % 3 === 0) await pause();
      }
      checkAIRelationClearance(p.relations, (id) => {
        const root = roots.get(id) || a.byId(id)?.root;
        return root ? new THREE.Box3().setFromObject(root) : null;
      });
      if (p.previs) {
        const subject = doc.objects.find((o) => o.id === p.previs.subjectId);
        if (!subject?.key) throw Error("预演主体必须是存在的库资产");
        if (p.previs.motion) {
          if (
            protectedIds.has(subject.id) ||
            (!changes.added.includes(subject.id) &&
              (p.mode === "add" ||
                !permissions.editableIds?.includes(subject.id)))
          )
            throw Error("无权修改主体走位");
          if (!subject.key.startsWith("char:"))
            throw Error("基础人物动作只用于char资产");
          for (const point of p.previs.motion.points)
            if (!inBounds(point.slice(1), p.bounds))
              throw Error("走位超出授权范围");
          subject.motion = {
            active: true,
            anim: p.previs.motion.anim,
            autoFace: true,
            speed: 1,
            easing: "linear",
            loop: false,
            keys: p.previs.motion.points.map(([t, x, y, z]) => ({
              t: t / p.durationSeconds,
              p: [x, y, z],
            })),
          };
          if (!changes.added.includes(subject.id))
            changes.modified.push(subject.id);
          warnings.push("基础走位未做导航 / 接触 / 脚滑求解，需预演核查。");
        }
        if (p.previs.camera !== "none")
          this.buildCameras(doc, roots, p, warnings);
      }
      signal.throwIfAborted();
      if ((await fingerprint(a)) !== base)
        throw Error("准备期间工程已变化，候选未发布");
      signal.throwIfAborted();
      changes.camerasAdded = doc.shots
        .filter((s) => !before.shots.some((o) => o.id === s.id))
        .map((s) => s.id);
      changes.camerasRemoved = before.shots
        .filter((s) => !doc.shots.some((o) => o.id === s.id))
        .map((s) => s.id);
      changes.camerasModified = doc.shots
        .filter((s) => {
          const old = before.shots.find((o) => o.id === s.id);
          return old && canonical(old) !== canonical(s);
        })
        .map((s) => s.id);
      changes.motionSubject = p.previs?.motion ? p.previs.subjectId : null;
      changes.terrainVisibility =
        before.terrain?.enabled !== doc.terrain?.enabled
          ? [before.terrain?.enabled, doc.terrain?.enabled]
          : null;
      changes.durationSeconds =
        before.state.duration !== doc.state.duration
          ? [before.state.duration, doc.state.duration]
          : null;
      const uniqueWarnings = [...new Set(warnings)];
      if (uniqueWarnings.length > 200)
        throw Error("候选警告超过200条，请缩小范围或拆分处理，未允许应用");
      if (this.draft)
        for (const root of this.draft.roots.values()) releaseCandidate(root);
      this.draft = {
        plan: p,
        permissions: cloneData(permissions),
        baseFingerprint: base,
        document: doc,
        roots,
        sourceBoxes,
        changes,
        triangles,
        warnings: uniqueWarnings,
        createdAt: new Date().toISOString(),
      };
      a.bus.emit("ai-scene-draft");
      return this.draft;
    } catch (e) {
      for (const root of roots.values()) releaseCandidate(root);
      throw e;
    } finally {
      a.suspended = suspended;
      this.busy = false;
      this.controller = null;
    }
  }
  buildCameras(doc, roots, p, warnings) {
    const scene = new THREE.Scene(),
      shots = [],
      a = this.app,
      objects = doc.objects
        .filter((o) => o.key)
        .map((o) => ({
          id: o.id,
          type: o.type,
          motion: o.motion,
          root: roots.get(o.id) || a.byId(o.id)?.root,
        }))
        .filter((o) => o.root);
    const fake = {
      objects,
      shots,
      stage: { scene },
      state: { preview: false },
      bus: { emit() {} },
      byId: (id) => objects.find((o) => o.id === id),
      setActiveShot(s) {
        this.activeShot = s;
      },
      addShot(opts) {
        const s = new Shot(this, {
          ...opts,
          id: `${p.id}-camera-${shots.length}`,
          duration: p.durationSeconds,
        });
        shots.push(s);
        return s;
      },
    };
    try {
      autoCamera(fake, {
        hero: fake.byId(p.previs.subjectId),
        moving:
          p.previs.motion || fake.byId(p.previs.subjectId)?.motion?.active
            ? fake.byId(p.previs.subjectId)
            : null,
      });
      const index = { overview: 0, orbit: 1, follow: 2, push: 3 },
        selected =
          p.previs.camera === "all" ? shots : [shots[index[p.previs.camera]]];
      if (
        p.previs.camera === "follow" &&
        !p.previs.motion &&
        (!fake.byId(p.previs.subjectId)?.motion?.active ||
          (fake.byId(p.previs.subjectId)?.motion?.keys?.length || 0) < 2)
      )
        throw Error("跟拍需要主体走位，请先提供运动点");
      for (const s of selected) {
        if (doc.shots.some((o) => o.id === s.id)) throw Error("机位ID重复");
        doc.shots.push(s.toJSON());
      }
      doc.activeShot = selected[0].id;
      warnings.push(
        "机位由现有自动机位生成；不是最优构图，应用后请使用参考包镜头诊断。",
      );
    } finally {
      for (const s of shots) {
        releaseCandidate(s.rig);
        releaseCandidate(s.helper);
      }
    }
  }
  async apply({ acceptWarnings = false } = {}) {
    this.checkIdle();
    const d = this.draft,
      a = this.app;
    if (!d) throw Error("请先准备候选");
    if (d.warnings.length && !acceptWarnings)
      throw Error("请明确确认候选警告后应用");
    if ((await fingerprint(a)) !== d.baseFingerprint)
      throw Error("工程已变化，旧候选不能应用；请重新准备");
    // A caller cannot mutate the public candidate to bypass validation. Recompile before commit.
    const origin = cloneData(d.origin || { type: "manual" }),
      expected = canonical(d.document);
    await this.prepare(d.plan, d.permissions);
    const current = this.draft;
    if (canonical(current.document) !== expected)
      throw Error("候选数据被修改，已拒绝提交，请重新检查预览");
    const before = cloneData(a.serialize({ assets: false })),
      runtime = subjectRuntime(a),
      state = { ...a.state },
      oldSelection = a.sel?.kind === "obj" ? a.sel.so.id : null;
    if (JSON.stringify(before).length > 12e6)
      throw Error("当前工程超过12MB撤销保护，未应用；请先拆分并备份工程");
    const undo = {
      _undo: [...(a._undo || [])],
      _redo: [...(a._redo || [])],
      _undoBytes: a._undoBytes,
      _undoAvail: a._undoAvail,
      _redoAvail: a._redoAvail,
      _opKey: a._opKey,
    };
    const suspended = a.suspended,
      oldTick = a.tick,
      quiet = a._quietAdd,
      oldUndo = a._suspendUndo,
      appRoot = document.getElementById("app"),
      inert = appRoot?.inert;
    this.busy = true;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.tick = () => {};
    if (appRoot) appRoot.inert = true;
    try {
      a.loadJson(cloneData(current.document));
      await a.projectAssets.ready();
      Object.assign(a.state, state, {
        duration: current.document.state.duration,
      });
      const rebuiltIds = new Set(
        (current.plan.operations || [])
          .filter((op) => op.op === "rebuild")
          .map((op) => op.objectId),
      );
      restoreSubjects(
        a,
        runtime.filter((s) => !rebuiltIds.has(s.id)),
      );
      a.stage.view.fov = current.document.view.fov;
      a.stage.view.updateProjectionMatrix();
      a._suspendUndo = false;
      a._undo = [...undo._undo];
      a.pushUndo("AI搭景 · " + current.plan.name, before);
      a._redo = [];
      a._redoAvail = 0;
      this.lastApplied = {
        origin,
        baseFingerprint: current.baseFingerprint,
        resultFingerprint: await fingerprint(a),
        plan: current.plan,
        changes: current.changes,
        warnings: current.warnings,
        appliedAt: new Date().toISOString(),
      };
      a.select(null);
    } catch (e) {
      try {
        a.loadJson(before);
        await a.projectAssets.ready();
        Object.assign(a.state, state);
        restoreSubjects(a, runtime);
        a.stage.view.fov = before.view.fov;
        a.stage.view.updateProjectionMatrix();
        if (oldSelection && a.byId(oldSelection))
          a.select({ kind: "obj", so: a.byId(oldSelection) });
      } catch (rollback) {
        throw Error(
          "应用失败且恢复异常，请打开应用前保存的工程：" + rollback.message,
          { cause: e },
        );
      } finally {
        Object.assign(a, undo);
      }
      throw e;
    } finally {
      a.tick = oldTick;
      a._quietAdd = quiet;
      a._suspendUndo = oldUndo;
      a.suspended = suspended;
      this.busy = false;
      if (appRoot) appRoot.inert = inert;
    }
    this.discard();
    for (const ev of ["objects", "shots", "terrain", "undoable", "select"])
      a.bus.emit(ev);
    await a.saveLocal();
    return this.lastApplied;
  }
}
