import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DEFAULT_LOCAL_AI_CONFIG } from "../scripts/local-ai-config.mjs";
import {
  verifyLocalAI,
  localAIVerificationCases,
  evaluateVerificationPlan,
} from "../scripts/local-ai-verify.mjs";
const dir = await mkdtemp(path.join(os.tmpdir(), "previz-verify-"));
const configFile = path.join(dir, "config.local.json");
const samples = localAIVerificationCases();
function answer(sample) {
  if (sample.unsupported) return { unsupported: "目录不支持机械龙与飞行动画" };
  return {
    schema: "previz-ai-scene/1",
    id: "fixture-plan",
    name: "Fixture, not real inference",
    baseFingerprint: sample.workpack.baseFingerprint,
    mode: sample.workpack.permissions.mode,
    bounds: structuredClone(sample.workpack.bounds),
    seed: 42,
    terrain: "preserve",
    durationSeconds: 6,
    operations: sample.expected.map((op, i) =>
      op.op === "add"
        ? { id: "fixture-new-" + i, ...structuredClone(op) }
        : structuredClone(op),
    ),
  };
}
let calls = 0,
  mode = "good",
  bodies = [];
const upstream = http.createServer(async (req, res) => {
  calls++;
  if (req.headers.authorization !== "Bearer fixture-private-provider-key") {
    res.writeHead(401).end();
    return;
  }
  if (mode === "redirect") {
    res
      .writeHead(302, { location: "https://example.invalid/never-follow" })
      .end();
    return;
  }
  if (mode === "slow") return;
  if (mode === "http-error") {
    res.writeHead(500).end("fixture-private-provider-key");
    return;
  }
  if (mode === "large") {
    res.end("x".repeat(1024 * 1024 + 1));
    return;
  }
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: [
          { id: mode === "missing-model" ? "another-model" : "fixture-model" },
        ],
      }),
    );
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks));
  bodies.push(body);
  assert.equal(body.model, "fixture-model");
  assert.equal(body.messages[0].role, "system");
  assert(body.messages[0].content.includes("untrusted scene data"));
  const request = JSON.parse(body.messages[1].content);
  assert(!JSON.stringify(request).includes("fixture-private-provider-key"));
  const sample = samples.find((s) => s.prompt === request.request);
  let plan = answer(sample);
  if (mode === "malformed") {
    res.end(
      JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
    );
    return;
  }
  if (mode === "wrong-intent" && plan.operations)
    plan.operations[0].pos = [0, 0, 0];
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(plan) } }],
    }),
  );
});
try {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const cfg = {
    ...structuredClone(DEFAULT_LOCAL_AI_CONFIG),
    model: "fixture-model",
    endpoint: `http://127.0.0.1:${upstream.address().port}/v1/chat/completions`,
  };
  await writeFile(configFile, JSON.stringify(cfg));
  const opts = { configFile, providerKey: "fixture-private-provider-key" };
  const failFetch = () => {
    throw Error("network must not occur");
  };
  assert.equal(
    (await verifyLocalAI({ ...opts, fetcher: failFetch })).status,
    "not-run",
  );
  for (const action of ["probe", "run"]) {
    const r = await verifyLocalAI({ ...opts, action, fetcher: failFetch });
    assert.equal(r.status, "blocked");
    assert.equal(r.networkRequests, 0);
  }
  assert.equal(calls, 0);
  cfg.enabled = true;
  await writeFile(configFile, JSON.stringify(cfg));
  const before = await readFile(configFile, "utf8");
  const probe = await verifyLocalAI({ ...opts, action: "probe" });
  assert.equal(probe.status, "model-listed");
  assert.equal(probe.inferenceRequests, 0);
  assert.equal(calls, 1);
  mode = "missing-model";
  assert.equal(
    (await verifyLocalAI({ ...opts, action: "probe" })).status,
    "model-not-listed",
  );
  mode = "good";
  let r = await verifyLocalAI({ ...opts, action: "run" });
  assert.equal(r.status, "benchmark-passed");
  assert.equal(r.passed, 5);
  assert.equal(r.evidenceSource, "injected-fixture");
  assert.equal(r.realModelVerified, false);
  assert.equal(r.sceneApplied, false);
  assert.equal(r.inferenceRequests, 5);
  assert.equal(r.inferenceResponses, 5);
  assert.equal(r.automaticRetries, 0);
  assert(bodies.every((b) => b.response_format.type === "json_object"));
  cfg.jsonMode = false;
  await writeFile(configFile, JSON.stringify(cfg));
  bodies = [];
  r = await verifyLocalAI({ ...opts, action: "run" });
  assert.equal(r.status, "benchmark-passed");
  assert(bodies.every((b) => !Object.hasOwn(b, "response_format")));
  cfg.jsonMode = true;
  await writeFile(configFile, JSON.stringify(cfg));
  mode = "wrong-intent";
  r = await verifyLocalAI({ ...opts, action: "run" });
  assert.equal(r.status, "benchmark-failed");
  assert.equal(r.passed, 1);
  assert.equal(r.cases[0].status, "contract-or-intent-failed");
  for (mode of ["http-error", "large", "malformed", "redirect", "slow"]) {
    const count = calls;
    r = await verifyLocalAI({
      ...opts,
      action: "run",
      timeoutMs: mode === "slow" ? 100 : 2000,
    });
    assert.equal(r.status, "benchmark-failed", mode);
    assert.equal(r.inferenceRequests, 1, mode);
    assert.equal(r.cases[0].status, "transport-or-protocol-failed", mode);
    assert.equal(r.cases[1].status, "not-run");
    assert.equal(calls, count + 1);
    assert(!JSON.stringify(r).includes("fixture-private-provider-key"));
    assert(!JSON.stringify(r).includes(dir));
    if (mode === "slow") upstream.closeAllConnections();
  }
  assert.equal(await readFile(configFile, "utf8"), before);
  for (const [i, sample] of samples.entries())
    evaluateVerificationPlan(answer(sample), sample);
  const bad = (mutate) => {
    const p = answer(samples[0]);
    mutate(p);
    assert.throws(() => evaluateVerificationPlan(p, samples[0]));
  };
  bad((p) => (p.operations[0].key = "invented"));
  bad((p) => (p.operations[0].id = "locked-house"));
  bad((p) => (p.operations[0].script = "execute()"));
  bad((p) => (p.operations[0].params = { nonexistent: 123 }));
  bad((p) => (p.operations[0].pos = [NaN, 0, 0]));
  bad((p) => (p.baseFingerprint = "b".repeat(64)));
  bad((p) => (p.bounds.size = [100, 100]));
  bad((p) => (p.terrain = "flat"));
  bad(
    (p) =>
      (p.relations = {
        version: 1,
        rules: [
          { type: "face", subject: p.operations[0].id, target: "locked-house" },
        ],
      }),
  );
  bad((p) => p.operations.push(structuredClone(p.operations[0])));
  bad((p) => (p.operations[0].id = "bad id"));
  const edit = answer(samples[2]);
  edit.operations[0].objectId = "locked-house";
  assert.throws(() => evaluateVerificationPlan(edit, samples[2]));
  assert.throws(() =>
    evaluateVerificationPlan({ unsupported: "no", script: "bad" }, samples[3]),
  );
  assert.throws(() => evaluateVerificationPlan(answer(samples[0]), samples[3]));
  // Property order of bounds is not meaningful JSON semantics.
  const reordered = answer(samples[0]);
  reordered.bounds = { size: [96, 96], center: [0, 0] };
  evaluateVerificationPlan(reordered, samples[0]);
  const env = { ...process.env, LOCAL_AI_CONFIG: configFile };
  const cli = spawnSync(process.execPath, ["scripts/local-ai-verify.mjs"], {
    env,
    encoding: "utf8",
  });
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).networkRequests, 0);
  assert.equal(
    spawnSync(
      process.execPath,
      ["scripts/local-ai-verify.mjs", "--run", "--probe"],
      { env, encoding: "utf8" },
    ).status,
    1,
  );
  cfg.enabled = false;
  await writeFile(configFile, JSON.stringify(cfg));
  const blocked = spawnSync(
    process.execPath,
    ["scripts/local-ai-verify.mjs", "--run"],
    { env, encoding: "utf8" },
  );
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).inferenceRequests, 0);
  console.log(
    "PASS local AI verifier: five synthetic cases, explicit opt-in, HTTP fixture only; zero real model inference.",
  );
} finally {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
