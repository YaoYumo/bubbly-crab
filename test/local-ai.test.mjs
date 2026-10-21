import assert from "node:assert/strict";
import http from "node:http";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCAL_AI_CONFIG,
  validateLocalAIConfig,
  readLocalAIConfig,
} from "../scripts/local-ai-config.mjs";
import { initLocalAI } from "../scripts/local-ai-setup.mjs";
import { createLocalAIGateway } from "../scripts/local-ai-gateway.mjs";
import { createServer as createViteServer } from "vite";
const root = fileURLToPath(new URL("../", import.meta.url)),
  dir = await mkdtemp(path.join(os.tmpdir(), "previz-local-ai-"));
const configFile = path.join(dir, "config.local.json"),
  defaults = () => structuredClone(DEFAULT_LOCAL_AI_CONFIG);
const servers = [];
let vite;
const listen = (server) =>
  new Promise((resolve) => {
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve("http://127.0.0.1:" + server.address().port),
    );
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
try {
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(root, "local-ai/config.example.json"), "utf8"),
    ),
    defaults(),
  );
  const missing = await readLocalAIConfig({ configFile });
  assert(!missing.found && !missing.readyToConnect && !missing.config.enabled);
  assert((await initLocalAI(configFile)).created);
  assert((await readLocalAIConfig({ configFile })).directories.models);
  const marker = JSON.stringify({ ...defaults(), model: "keep-my-model" });
  await writeFile(configFile, marker);
  assert(!(await initLocalAI(configFile)).created);
  assert.equal(
    await readFile(configFile, "utf8"),
    marker,
    "init never overwrites existing config",
  );
  for (const patch of [
    { endpoint: "https://cloud.example/v1/chat/completions" },
    { endpoint: "http://192.168.0.1:1234/v1/chat/completions" },
    { endpoint: "http://127.0.0.1:1234/v1/chat/completions?key=x" },
    { endpoint: "http://user:pass@localhost:1234/v1/chat/completions" },
    { endpoint: "http://localhost:1234/api/chat" },
    { runtime: "shell" },
    { enabled: "true" },
    { jsonMode: 1 },
    { model: "/private/model.gguf" },
    { modelFile: "../escape.gguf" },
    { modelFile: "/tmp/model.gguf" },
    { modelFile: "model.exe" },
  ])
    assert.throws(() =>
      validateLocalAIConfig({ ...defaults(), ...patch }, configFile),
    );
  assert.throws(
    () =>
      validateLocalAIConfig(
        { ...defaults(), extraCommand: "curl bad" },
        configFile,
      ),
    /未知/,
  );
  assert.throws(
    () =>
      validateLocalAIConfig(
        JSON.parse('{"__proto__":{},"version":1}'),
        configFile,
      ),
    /原型/,
  );
  let cfg = {
    ...defaults(),
    enabled: true,
    runtime: "llama.cpp",
    model: "qwen-local",
    modelFile: "qwen/model.gguf",
  };
  await writeFile(configFile, JSON.stringify(cfg));
  let info = await readLocalAIConfig({ configFile });
  assert(!info.readyToConnect && info.modelFilePresent === false);
  await mkdir(path.join(dir, "models/qwen"), { recursive: true });
  await writeFile(
    path.join(dir, "models/qwen/model.gguf"),
    "TEST ONLY, NOT A REAL MODEL",
  );
  info = await readLocalAIConfig({ configFile });
  assert(info.readyToConnect && info.modelFilePresent);
  assert.equal(info.runtimeConnection, "not-checked");
  assert.equal(info.inferenceVerified, false);
  await writeFile(path.join(dir, "outside.gguf"), "outside");
  await symlink(
    path.join(dir, "outside.gguf"),
    path.join(dir, "models/escape.gguf"),
  );
  await writeFile(
    configFile,
    JSON.stringify({ ...cfg, modelFile: "escape.gguf" }),
  );
  await assert.rejects(() => readLocalAIConfig({ configFile }), /软链接/);
  await writeFile(configFile, " ".repeat(16385));
  await assert.rejects(() => readLocalAIConfig({ configFile }), /16KiB/);
  // Disabled local profile must ignore even fully configured cloud environment variables.
  await writeFile(configFile, JSON.stringify(defaults()));
  const savedEnv = {};
  for (const key of ["AI_SCENE_ENDPOINT", "AI_SCENE_KEY", "AI_SCENE_MODEL"])
    savedEnv[key] = process.env[key];
  Object.assign(process.env, {
    AI_SCENE_ENDPOINT: "https://never-call.example/v1/chat/completions",
    AI_SCENE_KEY: "fixture-cloud-secret",
    AI_SCENE_MODEL: "fixture-cloud-model",
  });
  let calls = 0;
  const disabled = await createLocalAIGateway({
      configFile,
      accessToken: "fixture-local-gateway-access-token",
      fetcher: () => {
        calls++;
        throw Error("must not call");
      },
    }),
    base = await listen(disabled.server);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const capText = await (
      await fetch(base + "/api/ai-scenes/capabilities")
    ).text(),
    cap = JSON.parse(capText);
  assert(
    !cap.configured && cap.provider === "local" && !cap.localModel.enabled,
  );
  assert.equal(calls, 0);
  assert(
    !capText.includes(dir) &&
      !capText.includes("secret") &&
      !capText.includes("11434"),
  );
  assert.equal(
    (
      await fetch(base + "/api/ai-scenes/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    503,
  );
  assert.equal(calls, 0);
  const plan = {
    schema: "previz-ai-scene/1",
    id: "local-fixture",
    baseFingerprint: "a".repeat(64),
    name: "Local fixture, not inference",
    mode: "add",
    bounds: { center: [0, 0], size: [192, 192] },
    seed: 7,
    terrain: "preserve",
    durationSeconds: 6,
    operations: [
      {
        op: "add",
        id: "local-fixture-crate",
        key: "env:crate:木箱",
        pos: [0, 0, 0],
      },
    ],
  };
  const upstream = http.createServer(async (req, res) => {
    calls++;
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(
      req.headers.authorization,
      "Bearer local-runtime-no-provider-key",
    );
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks));
    assert.equal(body.model, "local-test-model");
    assert(body.messages[1].content.includes("workpack"));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(plan) } }],
      }),
    );
  });
  const up = await listen(upstream);
  await writeFile(
    configFile,
    JSON.stringify({
      ...defaults(),
      enabled: true,
      model: "local-test-model",
      endpoint: up + "/v1/chat/completions",
    }),
  );
  const token = "fixture-local-gateway-access-token";
  const enabled = await createLocalAIGateway({
      configFile,
      accessToken: token,
    }),
    api = await listen(enabled.server);
  assert.equal(
    calls,
    0,
    "creating adapter or reading config cannot probe or load a model",
  );
  assert(
    (await (await fetch(api + "/api/ai-scenes/capabilities")).json())
      .configured,
  );
  assert.equal(calls, 0);
  const body = {
    requestId: "local-fixture-request",
    prompt: "Fixture only",
    workpack: {
      schema: "previz-ai-workpack/1",
      baseFingerprint: plan.baseFingerprint,
      permissions: { mode: "add" },
      bounds: plan.bounds,
    },
  };
  assert.equal(
    (
      await fetch(api + "/api/ai-scenes/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await fetch(api + "/api/ai-scenes/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          Origin: "https://evil.example",
        },
        body: JSON.stringify(body),
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const request = () =>
    fetch(api + "/api/ai-scenes/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
  const job = await (await request()).json();
  let result;
  for (let i = 0; i < 100; i++) {
    result = await (
      await fetch(api + "/api/ai-scenes/jobs/" + job.id, {
        headers: { Authorization: "Bearer " + token },
      })
    ).json();
    if (!["queued", "running"].includes(result.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(result.status, "succeeded", result.error);
  assert.deepEqual(result.blueprint, plan);
  await request();
  assert.equal(calls, 1, "idempotent local adapter");
  const noToken = await createLocalAIGateway({ configFile, accessToken: "" }),
    noTokenURL = await listen(noToken.server);
  assert(
    !(await (await fetch(noTokenURL + "/api/ai-scenes/capabilities")).json())
      .configured,
  );
  // Test the actual Vite deny policy, including @fs; no real weights involved.
  const fixtureName = `.deny-fixture-${process.pid}.txt`;
  const storageFiles = ["models", "runtimes", "cache", "logs"].map((d) =>
    path.join(root, "local-ai", d, fixtureName),
  );
  const secretPath = storageFiles[0],
    repoConfig = path.join(root, "local-ai/config.local.json");
  let createdRepoConfig = false;
  try {
    for (const f of storageFiles)
      await writeFile(f, "DO_NOT_SERVE_LOCAL_WEIGHTS", { flag: "wx" });
    try {
      await writeFile(repoConfig, JSON.stringify(defaults()), {
        flag: "wx",
        mode: 0o600,
      });
      createdRepoConfig = true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    vite = await createViteServer({
      root,
      configFile: path.join(root, "vite.config.js"),
      logLevel: "silent",
      server: {
        port: 0,
        host: "127.0.0.1",
        open: false,
        proxy: { "/api/ai-scenes": { target: api, changeOrigin: false } },
      },
    });
    await vite.listen();
    const web = "http://127.0.0.1:" + vite.httpServer.address().port;
    const proxied = await fetch(web + "/api/ai-scenes/capabilities", {
      headers: { Origin: web },
    });
    assert.equal(proxied.status, 200);
    assert.equal((await proxied.json()).provider, "local");
    assert.equal(calls, 1, "same-origin discovery does not invoke the model");
    for (const url of [
      ...["models", "runtimes", "cache", "logs"].map(
        (d) => `/local-ai/${d}/${fixtureName}`,
      ),
      "/@fs" + secretPath,
      "/local-ai/config.local.json",
    ]) {
      const r = await fetch(web + url);
      assert.equal(r.status, 403, url);
      assert(!(await r.text()).includes("DO_NOT_SERVE_LOCAL_WEIGHTS"));
    }
  } finally {
    for (const f of storageFiles) await rm(f, { force: true });
    if (createdRepoConfig) await rm(repoConfig, { force: true });
    await vite?.close();
    vite = null;
  }
  console.log(
    "PASS local AI reserve: disabled defaults, idempotent init, paths/GGUF/symlink/config validation, cloud-env isolation, zero automatic calls, authenticated loopback adapter fixture, no duplicate inference, Vite storage/config denial. NOT real model inference.",
  );
} finally {
  await vite?.close();
  for (const s of servers.reverse()) await close(s);
  await rm(dir, { recursive: true, force: true });
}
