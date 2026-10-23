// Server-side only. No model loading, downloads, process execution or browser paths.
import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exact, safeData } from "../src/ai-scene-format.js";
export const LOCAL_AI_ROOT = fileURLToPath(
  new URL("../local-ai/", import.meta.url),
);
export const DEFAULT_LOCAL_AI_CONFIG = {
  version: 1,
  enabled: false,
  runtime: "ollama",
  model: "",
  endpoint: "http://127.0.0.1:11434/v1/chat/completions",
  paths: {
    models: "./models",
    runtimes: "./runtimes",
    cache: "./cache",
    logs: "./logs",
  },
  modelFile: "",
  jsonMode: true,
};
const inside = (root, child) => {
  const relative = path.relative(root, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
};
export function validateLocalAIConfig(input, configFile) {
  safeData(input);
  exact(
    input,
    [
      "version",
      "enabled",
      "runtime",
      "model",
      "endpoint",
      "paths",
      "modelFile",
      "jsonMode",
    ],
    "本地模型配置",
  );
  if (
    input.version !== 1 ||
    typeof input.enabled !== "boolean" ||
    typeof input.jsonMode !== "boolean"
  )
    throw Error("本地模型配置版本或开关无效");
  if (
    !["ollama", "lm-studio", "llama.cpp", "openai-compatible"].includes(
      input.runtime,
    )
  )
    throw Error("未知本地推理运行时");
  if (
    typeof input.model !== "string" ||
    input.model.length > 160 ||
    /[\x00-\x1f]/.test(input.model)
  )
    throw Error("本地模型名称无效");
  if (typeof input.endpoint !== "string" || input.endpoint.length > 2048)
    throw Error("本地接口地址无效");
  if (path.posix.isAbsolute(input.model) || path.win32.isAbsolute(input.model))
    throw Error("model 应填写运行时模型ID，不是磁盘路径");
  const endpoint = new URL(input.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/v1/chat/completions"
  )
    throw Error(
      "本地接口仅允许 localhost/127.0.0.1 的 HTTP /v1/chat/completions；不得填写云地址或URL凭证",
    );
  exact(input.paths, ["models", "runtimes", "cache", "logs"], "本地模型目录");
  const dirs = {};
  for (const key of ["models", "runtimes", "cache", "logs"]) {
    const value = input.paths[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 2048 ||
      /[\x00-\x1f]/.test(value)
    )
      throw Error("目录路径无效：" + key);
    dirs[key] = path.resolve(path.dirname(configFile), value);
  }
  if (
    typeof input.modelFile !== "string" ||
    input.modelFile.length > 1024 ||
    /[\x00-\x1f]/.test(input.modelFile)
  )
    throw Error("模型文件路径无效");
  let modelPath = null;
  if (input.modelFile) {
    if (
      path.isAbsolute(input.modelFile) ||
      path.win32.isAbsolute(input.modelFile) ||
      !input.modelFile.toLowerCase().endsWith(".gguf")
    )
      throw Error("modelFile 必须是 models 目录内的相对 GGUF 路径");
    modelPath = path.resolve(dirs.models, input.modelFile);
    if (!inside(dirs.models, modelPath))
      throw Error("模型文件不能越出 models 目录");
  }
  return {
    ...structuredClone(input),
    endpoint: endpoint.href,
    dirs,
    modelPath,
  };
}
async function existsKind(file, kind) {
  try {
    return (await stat(file))[kind]();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
}
export async function readLocalAIConfig({
  configFile = process.env.LOCAL_AI_CONFIG ||
    path.join(LOCAL_AI_ROOT, "config.local.json"),
} = {}) {
  configFile = path.resolve(configFile);
  let found = true,
    input;
  try {
    if ((await stat(configFile)).size > 16384)
      throw Error("本地模型配置最多16KiB");
    input = JSON.parse(await readFile(configFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    found = false;
    input = structuredClone(DEFAULT_LOCAL_AI_CONFIG);
  }
  const config = validateLocalAIConfig(input, configFile);
  const directories = {};
  for (const [key, dir] of Object.entries(config.dirs))
    directories[key] = await existsKind(dir, "isDirectory");
  let modelFilePresent = null;
  if (config.modelPath) {
    modelFilePresent = await existsKind(config.modelPath, "isFile");
    if (modelFilePresent) {
      const [root, leaf] = await Promise.all([
        realpath(config.dirs.models),
        realpath(config.modelPath),
      ]);
      if (!inside(root, leaf))
        throw Error("模型文件软链接不能越出 models 目录");
    }
  }
  const reasons = [];
  if (!found) reasons.push("尚未初始化本机配置");
  if (!config.enabled) reasons.push("本地模型接口未启用");
  if (!config.model.trim()) reasons.push("尚未填写运行时模型ID");
  if (config.runtime === "llama.cpp" && !config.modelPath)
    reasons.push("llama.cpp 尚未填写 GGUF 相对路径");
  if (modelFilePresent === false) reasons.push("指定的 GGUF 文件不存在");
  return {
    configFile,
    found,
    config,
    directories,
    modelFilePresent,
    readyToConnect: reasons.length === 0,
    reasons,
    runtimeConnection: "not-checked",
    inferenceVerified: false,
  };
}
export function publicLocalAIProfile(info) {
  return {
    runtime: info.config.runtime,
    enabled: info.config.enabled,
    status: info.readyToConnect ? "ready-to-connect" : "not-ready",
    modelFilePresent: info.modelFilePresent,
    inferenceVerified: false,
  };
}
