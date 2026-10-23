import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_LOCAL_AI_CONFIG,
  LOCAL_AI_ROOT,
  readLocalAIConfig,
} from "./local-ai-config.mjs";
export async function initLocalAI(
  configFile = process.env.LOCAL_AI_CONFIG ||
    path.join(LOCAL_AI_ROOT, "config.local.json"),
) {
  configFile = path.resolve(configFile);
  await mkdir(path.dirname(configFile), { recursive: true });
  for (const dir of Object.values(DEFAULT_LOCAL_AI_CONFIG.paths))
    await mkdir(path.resolve(path.dirname(configFile), dir), {
      recursive: true,
    });
  let created = true;
  try {
    await writeFile(
      configFile,
      JSON.stringify(DEFAULT_LOCAL_AI_CONFIG, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    created = false;
  }
  return {
    created,
    configFile,
    notice: "仅准备目录与默认关闭的配置；不覆盖已有配置，不下载/启动/调用模型",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const action = process.argv[2] || "check";
    if (action === "init")
      console.log(JSON.stringify(await initLocalAI(), null, 2));
    else if (action === "check") {
      const info = await readLocalAIConfig();
      console.log(
        JSON.stringify(
          {
            configFile: info.configFile,
            configFound: info.found,
            enabled: info.config.enabled,
            runtime: info.config.runtime,
            model: info.config.model,
            paths: info.config.dirs,
            modelFile: info.config.modelPath,
            directories: info.directories,
            modelFilePresent: info.modelFilePresent,
            readyToConnect: info.readyToConnect,
            reasons: info.reasons,
            runtimeConnection: info.runtimeConnection,
            inferenceVerified: false,
            notice: "仅本机配置/文件检查，未连接模型服务，未加载权重",
          },
          null,
          2,
        ),
      );
    } else throw Error("用法：node scripts/local-ai-setup.mjs init|check");
  } catch (e) {
    console.error("本地模型准备失败：" + e.message);
    process.exitCode = 1;
  }
}
