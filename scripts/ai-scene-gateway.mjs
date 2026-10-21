// Single-user development BFF. Shared-token gate only. Production still needs per-user auth, ownership and durable storage.
import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateEnvelope } from "../src/ai-scene-format.js";
import { requestScenePlan } from "./ai-scene-provider.mjs";
const MAX = 4 * 1024 * 1024;
export function createAISceneGateway({
  endpoint = process.env.AI_SCENE_ENDPOINT,
  key = process.env.AI_SCENE_KEY,
  model = process.env.AI_SCENE_MODEL,
  accessToken = process.env.AI_SCENE_GATEWAY_TOKEN,
  jsonMode = process.env.AI_SCENE_JSON_MODE !== "0",
  allowLocal = process.env.AI_SCENE_ALLOW_LOCAL === "1",
  fetcher = fetch,
  localProfile = null,
} = {}) {
  if (endpoint) {
    const u = new URL(endpoint);
    if (
      u.protocol !== "https:" &&
      !(
        allowLocal &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      throw Error("AI endpoint requires HTTPS");
    if (u.username || u.password || u.search || u.hash)
      throw Error("Use server env for credentials, not URL");
  }
  if (localProfile && endpoint) {
    const u = new URL(endpoint);
    if (
      u.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(u.hostname)
    )
      throw Error("Local profile must use a loopback runtime");
  }
  const jobs = new Map(),
    requests = new Map(),
    configured = !!(
      (!localProfile || localProfile.status === "ready-to-connect") &&
      endpoint &&
      key &&
      model &&
      typeof accessToken === "string" &&
      accessToken.length >= 24 &&
      accessToken.length <= 256
    );
  const authorized = (req) => {
    const given = Buffer.from(req.headers.authorization || ""),
      expected = Buffer.from("Bearer " + accessToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };
  let active = 0;
  const view = (job) => ({
    id: job.id,
    status: job.status,
    model: model || "",
    createdAt: job.createdAt,
    blueprint: job.blueprint,
    error: job.error,
  });
  const prune = () => {
    for (const [id, job] of jobs)
      if (
        Date.now() - job.createdAt > 3600000 &&
        !["queued", "running"].includes(job.status)
      ) {
        jobs.delete(id);
        requests.delete(job.requestId);
      }
  };
  const run = async (job, data) => {
    active++;
    job.status = "running";
    try {
      const blueprint = await requestScenePlan({
        endpoint,
        key,
        model,
        prompt: data.prompt,
        workpack: data.workpack,
        jsonMode,
        fetcher,
      });
      if (blueprint.unsupported)
        throw Error(
          "Unsupported request: " + String(blueprint.unsupported).slice(0, 300),
        );
      validateEnvelope(blueprint);
      if (
        blueprint.baseFingerprint !== data.workpack.baseFingerprint ||
        blueprint.mode !== data.workpack.permissions.mode ||
        JSON.stringify([blueprint.bounds.center, blueprint.bounds.size]) !==
          JSON.stringify([
            data.workpack.bounds.center,
            data.workpack.bounds.size,
          ])
      )
        throw Error("AI changed fingerprint / mode / bounds");
      job.blueprint = blueprint;
      job.status = "succeeded";
    } catch (e) {
      job.status = "failed";
      job.error = (
        String(e.message || "AI request failed") +
        "；上游失败/无效返回也可能已计费，本服务不自动重试。"
      ).slice(0, 650);
    } finally {
      active--;
    }
  };
  return http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    try {
      prune();
      const path = new URL(req.url, "http://internal").pathname;
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !==
          (req.headers["x-forwarded-host"] || req.headers.host)
      )
        return reply(403, { error: "Cross-origin request refused" });
      if (req.headers["sec-fetch-site"] === "cross-site")
        return reply(403, { error: "Cross-site request refused" });
      if (req.method === "GET" && path === "/api/ai-scenes/capabilities")
        return reply(200, {
          version: 1,
          configured,
          requiresAuth: true,
          model: model || "",
          input: "text+scene-workpack",
          output: "previz-ai-scene/1",
          maxBytes: MAX,
          remoteCancel: false,
          persistence: "single-process 1h; no restart recovery",
          verification: "adapter only; not proof of real model behavior",
          ...(localProfile
            ? {
                provider: "local",
                localModel: {
                  runtime: localProfile.runtime,
                  enabled: !!localProfile.enabled,
                  status: localProfile.status,
                  modelFilePresent: localProfile.modelFilePresent,
                  inferenceVerified: false,
                },
              }
            : {}),
        });
      if (configured && path.startsWith("/api/ai-scenes/") && !authorized(req))
        return reply(401, { error: "网关访问口令无效；没有调用模型" });
      if (req.method === "POST" && path === "/api/ai-scenes/jobs") {
        if (!configured)
          return reply(503, {
            error: localProfile
              ? "本地模型接口未启用或配置不完整；请运行 npm run local-ai:check 并设置独立网关口令。没有调用模型"
              : "AI搭景网关未完整配置（模型endpoint/key/model及24–256字符独立网关口令），使用本地配方或手动工作包；没有调用模型",
          });
        if (!(req.headers["content-type"] || "").startsWith("application/json"))
          return reply(415, { error: "application/json required" });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX) return reply(413, { error: "Workpack exceeds4MiB" });
          chunks.push(chunk);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          typeof data.requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(data.requestId) ||
          typeof data.prompt !== "string" ||
          !data.prompt.trim() ||
          data.prompt.length > 8000 ||
          data.workpack?.schema !== "previz-ai-workpack/1" ||
          !/^[a-f0-9]{64}$/.test(data.workpack.baseFingerprint || "") ||
          !data.workpack.permissions
        )
          return reply(400, { error: "Invalid request/workpack" });
        const digest = createHash("sha256")
            .update(
              JSON.stringify({ prompt: data.prompt, workpack: data.workpack }),
            )
            .digest("hex"),
          cached = requests.get(data.requestId);
        if (cached) {
          if (cached.digest !== digest)
            return reply(409, {
              error: "Idempotency key reused with different content",
            });
          return reply(200, view(jobs.get(cached.id)));
        }
        if (active >= 2 || jobs.size >= 100)
          return reply(429, {
            error: "Task budget exceeded; no request submitted",
          });
        const job = {
          id: randomUUID(),
          requestId: data.requestId,
          status: "queued",
          createdAt: Date.now(),
        };
        jobs.set(job.id, job);
        requests.set(data.requestId, { digest, id: job.id });
        reply(202, view(job));
        void run(job, data);
        return;
      }
      const requestMatch = path.match(
        /^\/api\/ai-scenes\/requests\/([a-zA-Z0-9_-]{1,100})$/,
      );
      if (req.method === "GET" && requestMatch) {
        const cached = requests.get(requestMatch[1]);
        return cached
          ? reply(200, view(jobs.get(cached.id)))
          : reply(404, {
              error: "请求未找到；可能未到达或网关已重启，请先检查服务商记录。",
            });
      }
      const match = path.match(
        /^\/api\/ai-scenes\/jobs\/([a-zA-Z0-9_-]{1,100})$/,
      );
      if (req.method === "GET" && match) {
        const job = jobs.get(match[1]);
        return job
          ? reply(200, view(job))
          : reply(404, {
              error:
                "任务不存在 / 网关已重启。不要自动重新提交；先检查服务商记录。",
            });
      }
      return reply(405, {
        error:
          "Unsupported route; stop local waiting is not remote cancellation",
      });
    } catch {
      reply(400, { error: "Invalid AI gateway request" });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createAISceneGateway();
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.listen(Number(process.env.AI_SCENE_PORT) || 5177, "0.0.0.0", () =>
    console.log(
      "AI scene gateway on0.0.0.0:" +
        server.address().port +
        "; no server credentials = disabled",
    ),
  );
}
