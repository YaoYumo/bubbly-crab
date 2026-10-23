import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.shots', { recursive: true });
const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage(),
    errors = [];
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || 'http://localhost:5174/?fresh=1',
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(
    () => window.__previzBooted && window.app?.aiScene,
    { timeout: 90000 },
  );
  const result = await page.evaluate(async () => {
    const a = app,
      w = a.aiScene;
    a.suspended = true;
    a._quietAdd = true;
    a._suspendUndo = true;
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.time = 0;
    a.state.playing = false;
    const original = a.addAsset('env:crate:木箱', [-40, 0, -40]);
    original.locked = true;
    a._suspendUndo = false;
    a._undo = [];
    a._redo = [];
    const permissions = {
      mode: 'add',
      editableIds: [],
      bounds: { center: [0, 0], size: [192, 192] },
      preserveTerrain: true,
    };
    const plan = await w.localPlan(permissions, {
      kind: 'template',
      template: 'plaza',
    });
    delete plan.recipe;
    plan.name = 'Exact test';
    plan.operations = [
      {
        op: 'add',
        id: plan.id + '-new',
        key: 'env:crate:木箱',
        pos: [20, 0, 20],
        params: {},
      },
    ];
    const snapshot = () =>
      JSON.stringify(a.serialize({ assets: false }), (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
            )
          : v,
      );
    const before = snapshot();
    await w.prepare(plan, permissions);
    if (snapshot() !== before || a._undo.length)
      throw Error('preview changed source');
    original.name += 'changed';
    let stale = false;
    try {
      await w.apply({ acceptWarnings: true });
    } catch (e) {
      stale = /变化/.test(e.message);
    }
    original.name = original.name.replace('changed', '');
    if (!stale) throw Error('stale candidate applied');
    const load = a.loadJson;
    let loads = 0;
    a.loadJson = function (doc) {
      load.call(this, doc);
      if (++loads === 1) throw Error('injected apply failure');
    };
    let rollback = false;
    try {
      await w.apply({ acceptWarnings: true });
    } catch (e) {
      rollback = /injected/.test(e.message);
    } finally {
      a.loadJson = load;
    }
    if (!rollback || snapshot() !== before || a._undo.length || w.busy)
      throw Error('failed rollback/source/undo');
    await w.apply({ acceptWarnings: true });
    if (
      a.objects.length !== 2 ||
      !a.byId(original.id).locked ||
      a._undo.length !== 1
    )
      throw Error('apply mismatch');
    a.undo();
    if (snapshot() !== before) throw Error('undo mismatch');
    a.redo();
    if (a.objects.length !== 2) throw Error('redo mismatch');
    a.undo();
    const protectedPlan = {
      ...plan,
      mode: 'edit',
      operations: [
        { op: 'transform', objectId: original.id, pos: [10, 0, 10] },
      ],
    };
    let protectedRefusal = false;
    try {
      await w.prepare(protectedPlan, {
        ...permissions,
        mode: 'edit',
        editableIds: [original.id],
      });
    } catch (e) {
      protectedRefusal = /无权/.test(e.message);
    }
    if (!protectedRefusal) throw Error('locked object changed');
    const ctx = await w.context(permissions);
    const actor = {
      ...plan,
      id: 'previs-test',
      baseFingerprint: ctx.baseFingerprint,
      operations: [
        {
          op: 'add',
          id: 'new-actor',
          key: 'char:human:男性',
          pos: [10, 0, 10],
          params: { anim: 'walk' },
        },
      ],
      previs: {
        subjectId: 'new-actor',
        camera: 'all',
        motion: {
          anim: 'walk',
          points: [
            [0, 10, 0, 10],
            [a.state.duration, 16, 0, 10],
          ],
        },
      },
    };
    const draft = await w.prepare(actor, permissions);
    if (
      draft.document.shots.length !== 4 ||
      draft.document.objects
        .find((o) => o.id === 'new-actor')
        .motion.keys.at(-1).t !== 1
    )
      throw Error('previs draft');
    await w.apply({ acceptWarnings: true });
    if (a.shots.length !== 4 || a.byId('new-actor').motion.keys.length !== 2)
      throw Error('previs apply');
    const ref = await a.reference.capture({
      width: 320,
      height: 180,
      fps: 5,
      duration: 0.4,
      subjectId: 'new-actor',
    });
    if (
      !ref.manifest.files.some(
        (f) => f.path === 'source/ai-scene-application.json',
      )
    )
      throw Error('AI audit not linked into reference');
    const bytes = new Uint8Array(await ref.archive.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const referenceZip = btoa(binary);
    a.undo();
    const cancelledPlan = await w.localPlan(permissions, {
      kind: 'template',
      template: 'plaza',
    });
    let cancelled = false;
    try {
      await w.prepare(cancelledPlan, permissions, () => w.cancel());
    } catch (e) {
      cancelled = /取消/.test(e.message);
    }
    if (!cancelled || w.busy || a.stage.exportOwner)
      throw Error('cancel failure');
    w.discard();
    window.aiTestPlan = await w.localPlan(permissions, {
      kind: 'template',
      template: 'plaza',
    });
    delete aiTestPlan.recipe;
    aiTestPlan.operations = [
      {
        op: 'add',
        id: 'ui-crate',
        key: 'env:crate:木箱',
        pos: [15, 0, 15],
        params: {},
      },
    ];
    return {
      sourceUnchangedByPreview: true,
      staleRefused: stale,
      injectedRollback: rollback,
      oneUndoRedo: true,
      lockedRefused: protectedRefusal,
      cameras: 4,
      motionSecondsToNormalized: true,
      referenceProvenance: true,
      referenceZip,
      cancelled,
      catalogEntries: ctx.catalog.length,
    };
  });
  const suffix = process.env.TEST_FILE_URL ? 'file' : 'dev';
  const referenceBytes = Buffer.from(result.referenceZip, 'base64'),
    files = unzipSync(referenceBytes),
    audit = JSON.parse(strFromU8(files['source/ai-scene-application.json'])),
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(audit.sourceChangedSinceApply, false);
  assert.equal(audit.resultFingerprint, audit.capturedFingerprint);
  assert(audit.plan.previs.motion);
  for (const f of manifest.files) {
    assert.equal(files[f.path].length, f.bytes);
    assert.equal(
      createHash('sha256').update(files[f.path]).digest('hex'),
      f.sha256,
    );
  }
  writeFileSync(`.shots/ai-scene-reference-${suffix}.zip`, referenceBytes);
  delete result.referenceZip;
  await page.click('[data-page="scene"]');
  await page.click('[data-ai-scene-open]');
  await page.waitForSelector('[data-ai-scene-dialog]');
  await page.click('[data-ai-scene-source="manual"]');
  await page.$eval('[data-ai-scene-blueprint]', (e) => {
    e.value = JSON.stringify(window.aiTestPlan);
  });
  await page.click('[data-ai-scene-action="prepare"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-ai-scene-action="apply"]').disabled,
    { timeout: 90000 },
  );
  assert.match(
    await page.$eval('[data-ai-scene-diff]', (e) => e.textContent),
    /新增.*ui-crate/,
  );
  await page.click('[data-ai-scene-action="top"]');
  await page.screenshot({
    path: `.shots/ai-scene-${process.env.TEST_FILE_URL ? 'file' : 'dev'}.png`,
  });
  await page.click('[data-ai-scene-action="close"]');
  assert.equal(
    await page.evaluate(
      () =>
        document.getElementById('app').inert ||
        !!document.querySelector('[data-ai-scene-dialog]'),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `.shots/ai-scene-${suffix}.json`,
    JSON.stringify({ ...result, uiPreview: true, errors }, null, 2),
  );
  console.log('PASS AI scene', result);
} finally {
  await browser.close();
}
