import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.shots', { recursive: true });
const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const p = await browser.newPage(),
    errors = [];
  await p.setViewport({ width: 1440, height: 1000 });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  p.on('dialog', (d) => d.accept());
  let posts = 0,
    gets = 0,
    complete = false,
    blueprint;
  await p.setRequestInterception(true);
  p.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/ai-scenes')) return request.continue();
    if (!path.endsWith('/capabilities'))
      assert.equal(
        request.headers().authorization,
        'Bearer browser-fixture-access-token-32',
      );
    let data;
    if (path.endsWith('/capabilities'))
      data = {
        version: 1,
        configured: true,
        requiresAuth: true,
        model: 'ui-contract-fixture',
        output: 'previz-ai-scene/1',
      };
    else if (request.method() === 'POST') {
      posts++;
      const body = JSON.parse(request.postData()),
        ctx = body.workpack;
      blueprint = {
        schema: 'previz-ai-scene/1',
        id: 'api-ui-plan',
        baseFingerprint: ctx.baseFingerprint,
        mode: ctx.permissions.mode,
        bounds: ctx.bounds,
        name: 'Fixture (no inference)',
        seed: 12345,
        terrain: 'preserve',
        durationSeconds: ctx.durationSeconds,
        operations: [
          {
            op: 'add',
            id: 'api-crate',
            key: 'env:crate:木箱',
            pos: [20, 0, 20],
          },
        ],
      };
      data = {
        id: 'ui-fixture-job',
        model: 'ui-contract-fixture',
        status: 'queued',
      };
    } else {
      gets++;
      data = {
        id: 'ui-fixture-job',
        model: 'ui-contract-fixture',
        status: complete ? 'succeeded' : 'running',
        ...(complete ? { blueprint } : {}),
      };
    }
    return request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await p.goto('http://localhost:5174/?fresh=1', {
    waitUntil: 'domcontentloaded',
  });
  await p.waitForFunction(() => window.__previzBooted && app.aiScene, {
    timeout: 90000,
  });
  await p.evaluate(() => {
    app.suspended = true;
    app._quietAdd = true;
    app.clearAll();
    app.terrain.setEnabled(false);
    app.addAsset('env:crate:木箱', [-40, 0, -40]);
  });
  await p.click('[data-page="scene"]');
  await p.click('[data-ai-scene-open]');
  await p.click('[data-ai-scene-source="api"]');
  await p.$eval('[data-ai-scene-action="discover"]', (e) => {
    e.closest('details').open = true;
  });
  await p.click('[data-ai-scene-action="discover"]');
  await p.waitForFunction(() =>
    document
      .querySelector('[data-ai-scene-dialog]')
      .textContent.includes('ui-contract-fixture'),
  );
  await p.$eval('[data-ai-scene-access]', (e) => {
    e.value = 'browser-fixture-access-token-32';
    e.dispatchEvent(new Event('input'));
  });
  await p.$eval('[data-ai-scene-prompt]', (e) => {
    e.value = 'Local protocol fixture, not paid inference';
  });
  await p.$eval('[data-ai-scene-action="submit"]', (e) => {
    e.click();
    e.click();
  });
  await p.waitForFunction(() =>
    document
      .querySelector('[data-ai-scene-dialog]')
      .textContent.includes('：running'),
  );
  await p.click('[data-ai-scene-action="stop-wait"]');
  await p.waitForFunction(() =>
    document
      .querySelector('[data-ai-scene-dialog]')
      .textContent.includes('不代表远端取消'),
  );
  await p.click('[data-ai-scene-action="close"]');
  complete = true;
  await p.click('[data-ai-scene-open]');
  await p.click('[data-ai-scene-source="api"]');
  await p.$eval('[data-ai-scene-action="resume"]', (e) => {
    e.closest('details').open = true;
  });
  assert.equal(await p.$eval('[data-ai-scene-access]', (e) => e.value), '');
  await p.$eval('[data-ai-scene-access]', (e) => {
    e.value = 'browser-fixture-access-token-32';
    e.dispatchEvent(new Event('input'));
  });
  await p.click('[data-ai-scene-action="resume"]');
  await p.waitForFunction(() =>
    document
      .querySelector('[data-ai-scene-blueprint]')
      .value.includes('api-ui-plan'),
  );
  assert.equal(await p.evaluate(() => app.objects.length), 1);
  assert.equal(posts, 1);
  await p.click('[data-ai-scene-action="prepare"]');
  await p.waitForFunction(
    () => !document.querySelector('[data-ai-scene-action="apply"]').disabled,
  );
  assert.equal(
    await p.evaluate(() => app.aiScene.draft.origin.model),
    'ui-contract-fixture',
  );
  await p.click('[data-ai-scene-action="apply"]');
  await p.waitForFunction(() => app.byId('api-crate') && !app.aiScene.busy);
  assert.equal(await p.evaluate(() => app.objects.length), 2);
  assert.equal(
    await p.evaluate(() => app.aiScene.lastApplied.origin.jobId),
    'ui-fixture-job',
  );
  await p.click('[data-ai-scene-action="close"]');
  assert.deepEqual(errors, []);
  const result = {
    contractOnly: true,
    realInference: false,
    accessTokenMemoryOnly: true,
    posts,
    gets,
    doubleClickRefused: true,
    stopIsLocalOnly: true,
    resumeWithoutPOST: true,
    doesNotAutoApply: true,
    manualPrepareAndConfirm: true,
    originAudit: true,
    errors,
  };
  writeFileSync('.shots/ai-scene-api-ui.json', JSON.stringify(result, null, 2));
  console.log('PASS AI API UI contract', result);
} finally {
  await browser.close();
}
