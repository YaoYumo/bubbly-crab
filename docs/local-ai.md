# 本地模型接口预留与目录准备

2026-10-20。本轮提供本机目录、配置校验、只读检查命令和可选 loopback 接入网关，方便以后自行下载安装本地模型。**当前没有安装模型、下载权重、运行推理引擎或验证真实模型效果。** 原关键词／配方解析不变，不会自动切换到 LLM。

## 1. 默认行为

- `npm run dev`、`npm run build` 与单文件版不会启动模型、下载文件或扫描权重。
- AI 场景搭建仍默认显示本地模板。「AI 服务」中新增默认折叠的 **本地模型接入（预留）** 说明，不增加默认主流程的配置表单。
- 即使目录已有权重，也不代表模型已启用。必须自行启动运行时、填写配置、明确启用并设置独立网关口令，然后主动提交生成请求。
- 没有后台探测、自动重试、自动提交或自动应用。显示「已配置」不代表服务可达、模型可用或语义质量通过验收。

## 2. 先准备文件夹

在安装了 Node.js 与项目依赖的电脑上运行：

```sh
npm run local-ai:init
npm run local-ai:check
```

项目根目录预留：

| 路径 | 用途 |
| --- | --- |
| `local-ai/config.example.json` | 可分发的无凭证配置样例，默认关闭 |
| `local-ai/config.local.json` | init 创建的本机配置，不覆盖已有文件 |
| `local-ai/models/` | 手动下载的模型文件，如 GGUF；不随应用加载 |
| `local-ai/runtimes/` | 可选推理程序存放位置；项目不会执行这里的二进制 |
| `local-ai/cache/` | 缓存预留位置；当前桥接器不写推理缓存 |
| `local-ai/logs/` | 日志预留位置；当前桥接器不写提示词/结果日志 |

默认目录路径相对于 `config.local.json` 所在文件夹解析，与启动命令的工作目录无关。可以把 `paths.models` 等改为本机绝对路径，例如 Windows 的 `D:/AI/Models` 或 macOS/Linux 的 `/Volumes/AI/Models`。配置由 **Node 后端读取**，不允许网页提交任意磁盘路径。

如需将整套本机配置移到项目外，可设置 `LOCAL_AI_CONFIG` 为配置文件路径；相对值以进程工作目录解析。首次 `init` 只在该配置旁建立默认目录，已有配置不会被重写，也不会根据已有配置去移动或复制模型。

`check` 输出的是本机文件检查结果：`modelFilePresent:true` 只代表普通文件存在，不代表它是有效 GGUF、能加载或模型已运行。`readyToConnect` 仅表示配置条件满足，**不包含运行时连通性或网关口令校验**。输出明确保留 `runtimeConnection:"not-checked"` 与 `inferenceVerified:false`。

## 3. 配置字段

```json
{
  "version": 1,
  "enabled": false,
  "runtime": "ollama",
  "model": "",
  "endpoint": "http://127.0.0.1:11434/v1/chat/completions",
  "paths": {
    "models": "./models",
    "runtimes": "./runtimes",
    "cache": "./cache",
    "logs": "./logs"
  },
  "modelFile": "",
  "jsonMode": true
}
```

- `enabled`：必须手动设 `true` 才可能启用；默认 `false`。
- `runtime`：`ollama`、`lm-studio`、`llama.cpp`、`openai-compatible`，目前共用 OpenAI-compatible Chat Completions 传输，不是四套已经验收的模型适配器。
- `model`：运行时实际识别的模型 ID／别名，不是模型文件绝对路径，也不是任意网页 URL。
- `endpoint`：完整 `/v1/chat/completions` 地址，只允许 `http://localhost` 或 `http://127.0.0.1`；拒绝外网/LAN 地址、URL 凭证、query、hash 与跳转。不在这个预留入口添加云模型回退。
- `modelFile`：可选的、相对 `paths.models` 的 GGUF 文件路径。`llama.cpp` 配置必须填写；其它运行时可留空，由其自己的模型管理器管理权重。拒绝绝对路径、目录穿越和指向 models 外的文件软链接。
- `jsonMode`：是否发送 `response_format:{"type":"json_object"}`。运行时不支持该参数时可明确设 `false`，但返回内容仍必须是合法蓝图。
- 配置最多 16KiB；未知字段、原型字段、错误类型拒绝，不允许在配置里增加 shell 命令、下载 URL 或启动脚本。

## 4. 以后安装模型时怎么接

以下是准备说明，**项目不自动执行这些步骤，也没有完成对应真实引擎兼容性验收**。

### Ollama

自行安装、下载模型并启动其服务。填写实际模型 ID，endpoint 通常为 `http://127.0.0.1:11434/v1/chat/completions`，`modelFile` 可为空。

Ollama 通常自行管理权重；本项目不会自动设置 `OLLAMA_MODELS` 或迁移它的模型目录。如希望用预留的 models 目录，应按运行时自身的说明设置。

### LM Studio

在 LM Studio 中自行下载并加载模型，开启本机 OpenAI-compatible 服务。填写它报告的模型 ID 和服务地址，例如端口 1234 的 `/v1/chat/completions`。不强制把权重复制到本项目。

### llama.cpp / GGUF

可以把程序放到 `local-ai/runtimes/llama.cpp/`，权重放到 `local-ai/models/qwen/model.gguf`。项目不会执行该程序。

自行启动服务时的示意命令（文件名、平台后缀须按实际安装修改）：

```sh
/path/to/llama-server -m /path/to/local-ai/models/qwen/model.gguf --alias qwen-local --host 127.0.0.1 --port 8080
```

本机配置对应设置为：

```json
{
  "runtime": "llama.cpp",
  "model": "qwen-local",
  "modelFile": "qwen/model.gguf",
  "endpoint": "http://127.0.0.1:8080/v1/chat/completions"
}
```

这是应修改的字段片段，不是可以替代整个配置的文件；保留其它必需字段，并在准备好后明确设置 `enabled:true`。

## 5. 可选网关接口已经预留

配置就绪后，设置一个 24–256 字符的独立 `AI_SCENE_GATEWAY_TOKEN` 环境变量。在自己的电脑终端生成随机口令即可，不要写入源码或分享聊天。它不是 GitHub 凭证，也不是云模型 Key。

若本地运行时也要求服务端访问 Key，可通过 **`LOCAL_AI_PROVIDER_KEY` 环境变量**提供；默认无模型 Key 时发送非秘密的本地占位 Bearer 值。该占位值不替代有鉴权运行时的真实凭证。本机 JSON 配置不保存凭证。

然后启动：

```sh
npm run ai:local
```

另一个终端启动 `npm run dev`，在 **AI 场景搭建 → AI 服务** 中检查网关能力，填写独立网关口令。生成仍按：主动提交 → 返回蓝图 → 独立候选预览 → 明确确认应用。

- 本地网关默认绑定 `0.0.0.0:5177`，与现有 Vite `/api/ai-scenes` 同源代理兼容；可用 `AI_SCENE_PORT` 改端口，改动时需同步代理/反向代理配置。
- 模型运行时建议只监听 loopback。网关绑定全网卡是为了兼容预览/代理，**不代表允许无鉴权公网使用**；暴露到非可信网络需自行配置防火墙、TLS 和访问控制。
- `npm run ai:local` 与云端 `npm run ai:gateway` 不能同时占用同一端口。只启动其中一种；本地配置不完整时也不会读取云端 endpoint/key/model 作为回退。
- 仍复用 `GET /api/ai-scenes/capabilities`、`POST /api/ai-scenes/jobs` 及 jobs/requests 查询接口。能力响应额外标识 `provider:"local"`、运行时类型、启用/文件状态，**不发送本机目录、配置路径或 provider Key**。
- 独立口令、同源检查、请求去重、限额、超时和蓝图校验沿用现有网关。没有自动重试；停止本地等待不代表取消运行时任务。
- 网关在启动时读取配置。修改配置后应先确认没有运行任务，再重启网关；本轮没有热切换模型或进程管理器。
- 目前请求输出仍是 **`previz-ai-scene/1` 蓝图**，不是先前讨论的全新语义 IR。未新增自然语言关系求解或模型质量保证；不合规返回会被拒绝，不执行生成代码。

## 6. 单文件与云预览边界

「本地」是指 **运行网关的那台电脑**。Arena 云沙箱的 `127.0.0.1` 不是用户电脑，云预览不能因此直接使用你电脑的模型。

将项目下载到本机运行网页服务、网关和推理运行时，才是这个接口的典型使用方式。浏览器始终请求同源 `/api/ai-scenes`，不直接请求另一台机器的 localhost。

`previz-lab.html` 单文件保持现有离线行为：本地配方、手动蓝图可用，网关访问被明确拒绝。不会从网页读取磁盘路径或把权重打包到 HTML。

## 7. 文件与隐私

默认 models/runtimes/cache/logs 内容及 `config.local.json` 已加入 Git 忽略规则。Vite 开发服务同时拒绝这些默认目录和本机配置的网页访问（包括 `/@fs`），它们也不参与静态/单文件构建。

自定义模型目录推荐放在项目和网页静态目录之外；如果自行放到其它可公开服务的目录，应同步设置相应 Web 服务的访问限制。仓库无法替你控制第三方运行时或其它服务器。

不要把权重放进 `public/` 或 `src/`，不要把 provider Key 写进配置样例。`local-ai:check` 会在终端显示本机路径，分享诊断输出前注意自行脱敏。命令当前不把提示词/推理结果写入预留 logs 目录。

## 8. 验证

- `npm run test:local-ai`：默认关闭、初始化不覆盖、目录/GGUF/软链接/配置校验、云环境变量隔离、零自动调用、鉴权与同源拒绝、本地 HTTP 协议 fixture 与去重、Vite 默认目录/配置文件禁止访问。
- `test/local-ai-ui-regression.mjs`：DEV 和单文件断网的折叠说明、不自动请求、未配置不提交、无模型/配置文件浏览器请求、原工程不变。
- 既有 AI 协议与简化界面回归；`npm run all` 重建单文件。协议 fixture **不是真实本地模型推理验收**。

本轮证据：[local-ai-evidence/manifest.json](local-ai-evidence/manifest.json)。

## 9. 主动联调工具（后续第一阶段）

已新增 `npm run local-ai:verify`（默认仅计划、零联网）、`-- --probe`（只读模型列表）和 `-- --run`（最多五个合成蓝图样本）。需要手动配置并启用运行时；不安装、启动模型，不修改工程，也不把协议模拟视为真实模型验收。完整使用方式、退出码、隐私和测试局限见 [主动联调说明](local-ai-verification.md)。
