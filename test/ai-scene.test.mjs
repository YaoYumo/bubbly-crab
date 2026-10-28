import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { AI_SCENE_JSON_SCHEMA } from '../src/ai-scene-schema.js';
assert.deepEqual(
  AI_SCENE_JSON_SCHEMA,
  JSON.parse(
    readFileSync(new URL('../docs/ai-scene.schema.json', import.meta.url)),
  ),
);
import {
  AI_SCENE_SCHEMA,
  validateEnvelope,
  parseAIPlan,
  allowedParams,
} from '../src/ai-scene-format.js';
import { LIB_INDEX, defaultsFor } from '../src/assets.js';
import { validateAsset } from '../src/ai-scene-catalog.js';
for (const [key, item] of LIB_INDEX) validateAsset(key, defaultsFor(item));
const [textKey, textItem] = [...LIB_INDEX].find(([, item]) =>
  item.params.some((p) => p.t === 'text'),
);
const textParam = textItem.params.find((p) => p.t === 'text').k;
assert.throws(
  () => validateAsset(textKey, { [textParam]: 'a'.repeat(121) }),
  /文本|字符/,
);
validateAsset(textKey, { [textParam]: '街角茶馆' });
assert.throws(
  () => validateAsset('nat:flowers:花田', { colors: '#000000, url(x)' }),
  /RRGGBB/,
);
import { createAISceneGateway } from '../scripts/ai-scene-gateway.mjs';
const plan = {
  schema: AI_SCENE_SCHEMA,
  id: 'test-plan',
  baseFingerprint: 'a'.repeat(64),
  name: 'Fixture',
  mode: 'add',
  bounds: { center: [0, 0], size: [192, 192] },
  seed: 4,
  terrain: 'preserve',
  durationSeconds: 6,
  operations: [{ op: 'add', id: 'new-1', key: 'fixture', pos: [0, 0, 0] }],
};
validateEnvelope(plan);
assert.throws(() => parseAIPlan('{"__proto__":{}}'), /原型/);
assert.throws(() => validateEnvelope({ ...plan, seed: NaN }), /有限|整数/);
assert.throws(() => validateEnvelope({ ...plan, terrain: 'flat' }), /替换/);
assert.throws(() => validateEnvelope({ ...plan, script: 'evil' }), /未知/);
assert.throws(
  () => allowedParams({ h: 200 }, [{ k: 'h', t: 'range', min: 1, max: 10 }]),
  /有限/,
);
assert.throws(() => allowedParams({ bogus: 1 }, []), /未知/);
const listen = (server) =>
  new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r('http://127.0.0.1:' + server.address().port),
    ),
  );
let calls = 0;
const upstream = http.createServer(async (req, res) => {
  calls++;
  assert.equal(req.headers.authorization, 'Bearer fixture-server-secret');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks));
  assert.equal(body.model, 'fixture');
  assert(body.messages[1].content.includes('workpack'));
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(plan) } }],
    }),
  );
});
const url = await listen(upstream),
  gateway = createAISceneGateway({
    endpoint: url,
    key: 'fixture-server-secret',
    model: 'fixture',
    accessToken: 'fixture-gateway-passphrase-32-chars',
    allowLocal: true,
  }),
  base = await listen(gateway);
const request = {
  requestId: 'fixture-request',
  prompt: 'Fixture, no inference',
  workpack: {
    schema: 'previz-ai-workpack/1',
    baseFingerprint: plan.baseFingerprint,
    bounds: plan.bounds,
    permissions: { mode: 'add' },
  },
};
try {
  const cap = await (await fetch(base + '/api/ai-scenes/capabilities')).json();
  assert(cap.configured);
  assert(cap.requiresAuth);
  assert.equal(
    (await fetch(base + '/api/ai-scenes/jobs', { method: 'POST' })).status,
    401,
  );
  assert(!JSON.stringify(cap).includes('fixture-server-secret'));
  const submit = () =>
    fetch(base + '/api/ai-scenes/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fixture-gateway-passphrase-32-chars',
      },
      body: JSON.stringify(request),
    });
  const [r1, r2] = await Promise.all([submit(), submit()]),
    [j1, j2] = await Promise.all([r1.json(), r2.json()]);
  assert.equal(j1.id, j2.id);
  let job;
  for (let i = 0; i < 30; i++) {
    job = await (
      await fetch(base + '/api/ai-scenes/requests/fixture-request', {
        headers: {
          Authorization: 'Bearer fixture-gateway-passphrase-32-chars',
        },
      })
    ).json();
    if (job.status === 'succeeded') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(job.status, 'succeeded');
  assert.deepEqual(job.blueprint, plan);
  assert.equal(calls, 1);
  const conflict = await fetch(base + '/api/ai-scenes/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fixture-gateway-passphrase-32-chars',
    },
    body: JSON.stringify({ ...request, prompt: 'different' }),
  });
  assert.equal(conflict.status, 409);
  const denied = await fetch(base + '/api/ai-scenes/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.invalid',
    },
    body: JSON.stringify(request),
  });
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
} finally {
  gateway.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([
    new Promise((r) => gateway.close(r)),
    new Promise((r) => upstream.close(r)),
  ]);
}
const disabled = createAISceneGateway({
    endpoint: null,
    key: null,
    model: null,
  }),
  disabledURL = await listen(disabled);
try {
  assert.equal(
    (await (await fetch(disabledURL + '/api/ai-scenes/capabilities')).json())
      .configured,
    false,
  );
} finally {
  disabled.closeAllConnections();
  await new Promise((r) => disabled.close(r));
}
for (const failure of ['timeout', 'invalid', 'unsupported']) {
  let upstreamCalls = 0;
  const server = createAISceneGateway({
      endpoint: 'https://fixture.invalid/chat/completions',
      key: 'fixture-server-only',
      model: 'fixture',
      accessToken: 'fixture-gateway-passphrase-32-chars',
      fetcher: async () => {
        upstreamCalls++;
        if (failure === 'timeout')
          throw new DOMException('timeout fixture', 'TimeoutError');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    failure === 'unsupported'
                      ? { unsupported: 'required asset is unavailable' }
                      : { script: 'forbidden' },
                  ),
                },
              },
            ],
          }),
        );
      },
    }),
    url = await listen(server),
    headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fixture-gateway-passphrase-32-chars',
    };
  try {
    const payload = { ...request, requestId: 'failure-' + failure };
    await fetch(url + '/api/ai-scenes/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    let job;
    for (let n = 0; n < 30; n++) {
      job = await (
        await fetch(url + '/api/ai-scenes/requests/' + payload.requestId, {
          headers,
        })
      ).json();
      if (job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(job.status, 'failed');
    assert.match(job.error, /可能已计费/);
    assert.equal(job.blueprint, undefined);
    await fetch(url + '/api/ai-scenes/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(upstreamCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
const noAccess = createAISceneGateway({
    endpoint: 'https://fixture.invalid/chat/completions',
    key: 'fixture-model-key',
    model: 'fixture',
    accessToken: null,
    fetcher: () => {
      throw Error('must never be called');
    },
  }),
  noAccessURL = await listen(noAccess);
try {
  assert.equal(
    (await (await fetch(noAccessURL + '/api/ai-scenes/capabilities')).json())
      .configured,
    false,
  );
  assert.equal(
    (await fetch(noAccessURL + '/api/ai-scenes/jobs', { method: 'POST' }))
      .status,
    503,
  );
} finally {
  noAccess.closeAllConnections();
  await new Promise((r) => noAccess.close(r));
}
console.log(
  'PASS AI blueprint bounds/numbers/prototype safety/parameter whitelist; local OpenAI-compatible gateway fixture, parallel idempotency, request-ID recovery, origin refusal, server-key/access-token isolation, required auth, disabled defaults, timeout/invalid/unsupported failures without retries. NOT real model inference.',
);
