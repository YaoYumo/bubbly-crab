import assert from 'node:assert/strict';
import http from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { referenceSettings, depthPNG, depthFromCode, sampleIndices, canonical, sha256, summaryChecks } from '../src/reference-format.js';
import { decodeHeightPNG } from '../src/terrain-import.js';
import { cleanCapabilities, supportedInput, ReferenceGateway } from '../src/reference-gateway.js';
import { createReferenceGateway } from '../scripts/reference-gateway.mjs';
assert.deepEqual(sampleIndices(1), [0]); assert.deepEqual(sampleIndices(4), [0, 1, 3]);
assert.throws(() => referenceSettings({ fps: Infinity }), /fps/); assert.throws(() => referenceSettings({ width: 1920, height: 1920 }), /像素/); assert.throws(() => referenceSettings({ duration: 30, fps: 60 }), /900/);
assert.equal(referenceSettings({ duration: .6, fps: 5 }).frames, 3);
assert.equal(canonical({ z: 1, a: { c: 2, b: 3 } }), canonical({ a: { b: 3, c: 2 }, z: 1 })); assert.equal((await sha256('test')).length, 64);
const rgba = new Uint8Array([0, 0, 0, 255, 0, 1, 0, 255, 255, 255, 0, 255, 128, 0, 0, 255]);
const png = depthPNG(2, 2, rgba), decoded = await decodeHeightPNG(png.buffer); assert.equal(decoded.depth, 16); assert.deepEqual([...decoded.data].map(v => Math.round(v * 65535)), [0, 1, 65535, 32768]);
assert.equal(depthFromCode(0, .1, 100), null); assert.equal(depthFromCode(1, .1, 100), .1); assert.equal(depthFromCode(65535, .1, 100), 100);
const report = summaryChecks([{ index: 0, time: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hfovDegrees: 50, groundClearance: -.1, collisionIds: ['building'], proximityIds: ['wall'], proximityThreshold: .25, subject: { inFrame: false } }, { index: 1, time: .1, position: [0, 0, 0], quaternion: [0, 1, 0, 0], hfovDegrees: 60, subject: { inFrame: true, visibleSamples: 0 } }], 10);
for (const type of ['ground-clearance', 'camera-in-projected-volume', 'camera-near-volume', 'subject-out-of-frame', 'subject-occluded', 'rotation-rate', 'fov-jump']) assert(report.issues.some(i => i.type === type));
assert.throws(() => cleanCapabilities({}), /协议/); const cap = cleanCapabilities({ version: 1, configured: true, inputs: { text: true, video: false } }); assert.equal(cap.inputs.video, false); assert.throws(() => supportedInput(cap, 'video'), /未配置或不支持/);
const client = new ReferenceGateway(); client.caps = cleanCapabilities({ version: 1, configured: true, inputs: { 'first-last': true } }); assert.throws(() => client.prepare({ meta: { manifest: { settings: {} } } }, { mode: 'first-last', prompt: 'reference', variant: 'gray' }), /灰模/);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
let posts = 0; const upstream = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/capabilities') return res.end(JSON.stringify({ version: 1, configured: true, provider: 'contract-fixture', model: 'fixture', inputs: { text: true, 'first-last': true, video: false } }));
  if (req.method === 'POST') { posts++; let bytes = 0; for await (const chunk of req) bytes += chunk.length; assert(bytes > 0); assert.equal(req.headers.authorization, 'Bearer server-only-test-token'); return res.end(JSON.stringify({ id: 'fixture-1', status: 'queued' })); }
  res.end(JSON.stringify({ id: 'fixture-1', status: 'succeeded', resultURL: 'https://example.invalid/result.webm' }));
});
const upstreamURL = await listen(upstream), bff = createReferenceGateway({ gatewayURL: upstreamURL, token: 'server-only-test-token', allowLocal: true }), base = await listen(bff);
try {
  const caps = await (await fetch(base + '/api/reference-jobs/capabilities')).json(); assert.equal(caps.inputs['first-last'], true); assert(!JSON.stringify(caps).includes('server-only-test-token'));
  const form = new FormData(); form.set('input', 'video'); form.set('prompt', 'camera move'); form.set('video', new Blob(['fixture']), 'a.webm');
  let response = await fetch(base + '/api/reference-jobs', { method: 'POST', body: form }); assert.equal(response.status, 422); assert.equal(posts, 0);
  form.set('input', 'first-last'); form.delete('video'); form.set('first', new Blob(['fixture']), 'first.png'); form.set('last', new Blob(['fixture']), 'last.png');
  response = await fetch(base + '/api/reference-jobs', { method: 'POST', body: form }); assert.equal(response.status, 200); assert.equal((await response.json()).id, 'fixture-1'); assert.equal(posts, 1);
  response = await fetch(base + '/api/reference-jobs/fixture-1'); assert.equal((await response.json()).status, 'succeeded');
  response = await fetch(base + '/api/reference-jobs', { method: 'POST', body: form, headers: { Origin: 'https://untrusted.invalid' } }); assert.equal(response.status, 403); assert.equal(posts, 1);
} finally { bff.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(r => bff.close(r)), new Promise(r => upstream.close(r))]); }
const disabled = createReferenceGateway({ gatewayURL: null, token: null, arkKey: null, arkModel: null }), disabledURL = await listen(disabled);
try { assert.equal((await (await fetch(disabledURL + '/api/reference-jobs/capabilities')).json()).configured, false); } finally { disabled.closeAllConnections(); await new Promise(r => disabled.close(r)); }
console.log('PASS reference settings / frame convention / exact PNG16 / depth units / diagnostics / capability fail-closed / local BFF first-last multipart / status / credential isolation / origin refusal. Contract fixture only, NOT real vendor inference.');
