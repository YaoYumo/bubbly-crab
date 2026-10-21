// Optional bridge to a separately installed local runtime. No spawn, download or auto-inference.
import { pathToFileURL } from "node:url";
import { createAISceneGateway } from "./ai-scene-gateway.mjs";
import { readLocalAIConfig, publicLocalAIProfile } from "./local-ai-config.mjs";
export async function createLocalAIGateway({
  configFile,
  accessToken = process.env.AI_SCENE_GATEWAY_TOKEN,
  providerKey = process.env.LOCAL_AI_PROVIDER_KEY,
  fetcher = fetch,
} = {}) {
  const info = await readLocalAIConfig(configFile ? { configFile } : {});
  const server = createAISceneGateway({
    // Nulls deliberately prevent falling back to cloud AI_SCENE_* env values.
    endpoint: info.readyToConnect ? info.config.endpoint : null,
    key: info.readyToConnect
      ? providerKey || "local-runtime-no-provider-key"
      : null,
    model: info.readyToConnect ? info.config.model.trim() : null,
    accessToken: accessToken || null,
    jsonMode: info.config.jsonMode,
    allowLocal: true,
    localProfile: publicLocalAIProfile(info),
    fetcher,
  });
  return { server, info };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { server, info } = await createLocalAIGateway();
    const port = Number(process.env.AI_SCENE_PORT || 5177);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("AI_SCENE_PORT 无效");
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.on("error", (e) => {
      console.error(
        e.code === "EADDRINUSE"
          ? "5177/指定网关端口已占用；云端与本地网关不能同时使用同一端口。"
          : "本地网关启动失败",
      );
      process.exitCode = 1;
    });
    server.listen(port, "0.0.0.0", () => {
      console.log(
        `Local AI bridge on 0.0.0.0:${port}; profile=${info.readyToConnect ? "ready-to-connect" : "not-ready"}; runtime NOT probed, no weights loaded`,
      );
      if (info.reasons.length) console.log(info.reasons.join("；"));
      if (
        !process.env.AI_SCENE_GATEWAY_TOKEN ||
        process.env.AI_SCENE_GATEWAY_TOKEN.length < 24 ||
        process.env.AI_SCENE_GATEWAY_TOKEN.length > 256
      )
        console.log("尚未设置独立网关口令，推理请求仍禁用。");
    });
  } catch {
    console.error(
      "本地网关配置无效；请先运行 npm run local-ai:check 检查本机配置。没有调用模型。",
    );
    process.exitCode = 1;
  }
}
