import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.shots', { recursive: true });
const b = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  protocolTimeout: 240000,
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
    a.clearAll();
    a.terrain.setEnabled(false);
    a.state.playing = false;
    const recipes = [
        { kind: 'template', template: 'plaza' },
        { kind: 'template', template: 'street' },
        { kind: 'template', template: 'boulevard' },
        ...['chinese', 'suburb', 'modern'].map((theme) => ({
          kind: 'town',
          theme,
          topology: 'grid',
          density: 0.25,
          vegetation: 0.2,
        })),
      ],
      rows = [];
    for (const recipe of recipes) {
      const permissions = {
        mode: 'add',
        bounds: {
          center: [0, 0],
          size:
            recipe.template === 'boulevard'
              ? [384, 384]
              : recipe.kind === 'town'
                ? [192, 192]
                : [192, 192],
        },
        preserveTerrain: true,
        editableIds: [],
      };
      try {
        const plan = await w.localPlan(permissions, recipe),
          source = JSON.stringify(a.serialize({ assets: false })),
          d = await w.prepare(plan, permissions);
        if (source !== JSON.stringify(a.serialize({ assets: false })))
          throw Error('recipe changed source');
        if (
          recipe.kind === 'town' &&
          (!d.triangles || !d.document.objects.some((o) => o.key))
        )
          throw Error('town has no real buildings/assets');
        rows.push({
          recipe,
          added: d.changes.added.length,
          triangles: d.triangles,
          warnings: d.warnings.length,
        });
        w.discard();
      } catch (e) {
        throw Error(JSON.stringify(recipe) + ': ' + e.message);
      }
    }
    const permissions = {
        mode: 'replace',
        bounds: { center: [0, 0], size: [192, 192] },
        preserveTerrain: true,
        allowReplace: true,
        editableIds: [],
      },
      plan = await w.localPlan(permissions, {
        kind: 'town',
        theme: 'suburb',
        topology: 'grid',
        density: 0.25,
        vegetation: 0.2,
      });
    await w.prepare(plan, permissions);
    await w.apply({ acceptWarnings: true });
    const roadIDs = a.objects
      .filter((o) => o.type === 'road_brush')
      .map((o) => o.id);
    if (!roadIDs.length) throw Error('recipe roads not applied');
    const json = a.serialize({ assets: false });
    const roadPlan = await a.roadDiagnostics.inspect(
      a.objects.find((o) => o.type === 'road_brush'),
    );
    a.undo();
    if (a.objects.length) throw Error('recipe undo');
    a.redo();
    if (
      a.objects.filter((o) => o.type === 'road_brush').length !== roadIDs.length
    )
      throw Error('recipe redo');
    return {
      rows,
      appliedRoads: roadIDs.length,
      objects: json.objects.length,
      undoRedo: true,
      roadPlan: !!roadPlan,
    };
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    `.shots/ai-scene-recipes-${process.env.TEST_FILE_URL ? 'file' : 'dev'}.json`,
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log('PASS AI recipes', result);
} finally {
  await b.close();
}
