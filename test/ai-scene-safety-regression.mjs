import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.shots', { recursive: true });
const b = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 180000,
});
try {
  const p = await b.newPage(),
    errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (process.env.TEST_FILE_URL) await p.setOfflineMode(true);
  await p.goto(process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1', {
    waitUntil: 'domcontentloaded',
  });
  await p.waitForFunction(() => window.__previzBooted && app.aiScene, {
    timeout: 90000,
  });
  const result = await p.evaluate(async () => {
    const a = app,
      w = a.aiScene;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setResolution(33);
    a.terrain.h.fill(3);
    a.terrain.refresh();
    a.terrain.setEnabled(true);
    const src = new a.stage.ground.constructor(
      new a.stage.ground.geometry.constructor(2, 2),
      a.stage.selRing.material.clone(),
    );
    await a._adoptModel(
      src,
      'AI-resource-fixture.glb',
      { x: 0, y: 3, z: 0 },
      {},
    );
    const imported = a.objects[0];
    imported.locked = true;
    const actor = a.addAsset('char:human:男性', [-30, 3, -30], { keepY: true });
    actor.params.bloomSelection = { mode: 'off', refs: [] };
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    const permissions = {
        mode: 'add',
        bounds: { center: [0, 0], size: [192, 192] },
        editableIds: [],
        preserveTerrain: true,
      },
      ctx = await w.context(permissions),
      pose = actor.root.userData.animPhase;
    const plan = {
      schema: 'previz-ai-scene/1',
      id: 'safety-plan',
      baseFingerprint: ctx.baseFingerprint,
      name: 'Safety',
      mode: 'add',
      bounds: permissions.bounds,
      seed: 1,
      terrain: 'preserve',
      durationSeconds: a.state.duration,
      operations: [
        {
          op: 'add',
          id: 'ground-crate',
          key: 'env:crate:木箱',
          pos: [20, 1, 20],
          placement: 'ground',
        },
      ],
    };
    const first = w.prepare(plan, permissions),
      second = w.prepare(plan, permissions),
      blockedCapture = a.reference.capture({
        width: 320,
        height: 180,
        fps: 5,
        duration: 0.2,
      }),
      blockedPNG = a.exporter.still();
    let terrainBlocked = false;
    try {
      a.terrain.workflow.assertEditable();
    } catch {
      terrainBlocked = true;
    }
    const outcomes = await Promise.allSettled([
      first,
      second,
      blockedCapture,
      blockedPNG,
    ]);
    if (
      outcomes[2].status !== 'rejected' ||
      outcomes[3].value !== null ||
      !terrainBlocked
    )
      throw Error('AI/export/terrain mutex failed');
    const parallel = outcomes.slice(0, 2);
    if (parallel.filter((v) => v.status === 'fulfilled').length !== 1 || w.busy)
      throw Error('concurrent prepare not refused');
    if (
      w.draft.document.objects.find((o) => o.id === 'ground-crate').pos[1] !== 4
    )
      throw Error('ground mapping');
    let sourceDisposed = 0;
    imported.root.traverse((n) => {
      n.geometry?.addEventListener('dispose', () => sourceDisposed++);
      for (const m of Array.isArray(n.material)
        ? n.material
        : n.material
          ? [n.material]
          : [])
        m.addEventListener('dispose', () => sourceDisposed++);
    });
    for (let i = 0; i < 4; i++) {
      await w.prepare(plan, permissions);
      w.discard();
    }
    if (sourceDisposed) throw Error('candidate disposed source resources');
    const road = {
      ...plan,
      operations: [
        {
          op: 'road',
          id: 'blocked-road',
          width: 6,
          roadType: 'asphalt',
          points: [
            [-80, 3, 0],
            [80, 3, 0],
          ],
        },
      ],
    };
    let roadRefused = false;
    try {
      await w.prepare(road, permissions);
    } catch (e) {
      roadRefused = /保护对象/.test(e.message);
    }
    if (!roadRefused) throw Error('road segment crossed protected import');
    let concurrentEdit = false;
    try {
      await w.prepare(plan, permissions, () => {
        actor.name = 'external edit';
      });
    } catch (e) {
      concurrentEdit = /变化/.test(e.message);
    }
    if (!concurrentEdit || actor.name !== 'external edit')
      throw Error('external edit lost/not detected');
    actor.name = ctx.objects.find((o) => o.id === actor.id).name;
    const before = (await w.context(permissions)).baseFingerprint;
    if (before !== plan.baseFingerprint)
      throw Error('source changed by preparation');
    await w.prepare(plan, permissions);
    const load = a.loadJson;
    let count = 0;
    a.loadJson = function (doc) {
      load.call(this, doc);
      if (++count === 1) throw Error('injected imported rollback');
    };
    let rolledBack = false;
    try {
      await w.apply({ acceptWarnings: true });
    } catch (e) {
      rolledBack = /injected/.test(e.message);
    } finally {
      a.loadJson = load;
    }
    if (
      !rolledBack ||
      (await w.context(permissions)).baseFingerprint !== before ||
      a._undo.length ||
      a.byId(actor.id).root.userData.animPhase !== pose ||
      !a.byId(imported.id).params.assetId
    )
      throw Error('imported rollback mismatch');
    await w.apply({ acceptWarnings: true });
    const key = a.byId(imported.id).params.assetId;
    if (
      !a.projectAssets.records.has(key) ||
      !a.terrain.h.every((v) => v === 3) ||
      !a.byId(imported.id).locked ||
      a._undo.length !== 1
    )
      throw Error('resource/terrain lost on apply');
    a.undo();
    if (a.byId('ground-crate') || !a.byId(imported.id))
      throw Error('resource undo');
    a.redo();
    if (!a.byId('ground-crate') || !a.byId(imported.id))
      throw Error('resource redo');
    const editPermission = {
        ...permissions,
        mode: 'edit',
        editableIds: [actor.id],
      },
      editContext = await w.context(editPermission),
      editPlan = {
        ...plan,
        id: 'selected-edit',
        mode: 'edit',
        baseFingerprint: editContext.baseFingerprint,
        operations: [
          { op: 'transform', objectId: actor.id, pos: [-30, 3, -20] },
        ],
      };
    const protectedBefore = JSON.stringify(a.byId(imported.id).serialize()),
      crateBefore = JSON.stringify(a.byId('ground-crate').serialize());
    let unselectedRefused = false;
    try {
      await w.prepare(
        {
          ...editPlan,
          operations: [
            { op: 'transform', objectId: 'ground-crate', pos: [40, 4, 40] },
          ],
        },
        editPermission,
      );
    } catch (e) {
      unselectedRefused = /无权/.test(e.message);
    }
    if (!unselectedRefused) throw Error('edit changed unselected object');
    await w.prepare(editPlan, editPermission);
    await w.apply({ acceptWarnings: true });
    if (
      a.byId(actor.id).root.position.z !== -20 ||
      JSON.stringify(a.byId(imported.id).serialize()) !== protectedBefore ||
      JSON.stringify(a.byId('ground-crate').serialize()) !== crateBefore
    )
      throw Error('selected-only edit mismatch');
    const regenContext = await w.context(editPermission),
      oldHeight = a.byId(actor.id).params.height,
      nextHeight = oldHeight === 1.9 ? 1.8 : 1.9,
      motionBefore = JSON.stringify(a.byId(actor.id).serialize().motion),
      regen = {
        ...editPlan,
        id: 'selected-rebuild',
        baseFingerprint: regenContext.baseFingerprint,
        operations: [
          { op: 'rebuild', objectId: actor.id, params: { height: nextHeight } },
        ],
      };
    let metadataRefused = false;
    try {
      await w.prepare(
        {
          ...regen,
          operations: [
            {
              op: 'rebuild',
              objectId: actor.id,
              params: { bloomSelection: { mode: 'all' } },
            },
          ],
        },
        editPermission,
      );
    } catch (e) {
      metadataRefused = /未知资产参数/.test(e.message);
    }
    if (!metadataRefused) throw Error('AI patched application metadata');
    await w.prepare(regen, editPermission);
    await w.apply({ acceptWarnings: true });
    if (
      a.byId(actor.id).params.height !== nextHeight ||
      JSON.stringify(a.byId(actor.id).serialize().motion) !== motionBefore ||
      a.byId(actor.id).params.bloomSelection.mode !== 'off' ||
      JSON.stringify(a.byId(imported.id).serialize()) !== protectedBefore
    )
      throw Error('selected regen mismatch');
    a.undo();
    if (a.byId(actor.id).params.height !== oldHeight) throw Error('regen undo');
    a.redo();
    if (a.byId(actor.id).params.height !== nextHeight)
      throw Error('regen redo');
    return {
      selectedRebuildStableIdUndoRedo: true,
      existingMetadataPreserved: true,
      metadataPatchRefused: true,
      selectedOnlyEditApplied: true,
      unselectedEditRefused: true,
      parallelRefused: true,
      referencePNGAndTerrainMutex: true,
      exactGroundY: 4,
      sourceResourcesNotDisposed: true,
      fourPrepareDiscardCycles: true,
      protectedRoadSegmentRefused: roadRefused,
      concurrentEditPreserved: concurrentEdit,
      importedRollback: rolledBack,
      personPhaseRestored: true,
      importedResourceAndTerrainUndoRedo: true,
    };
  });
  assert.deepEqual(errors, []);
  const suffix = process.env.TEST_FILE_URL ? 'file' : 'dev';
  writeFileSync(
    `.shots/ai-scene-safety-${suffix}.json`,
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log('PASS AI safety', result);
} finally {
  await b.close();
}
